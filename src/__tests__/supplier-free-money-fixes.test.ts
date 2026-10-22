/**
 * Supplier 1.0 — the money side after the audit of 15 Oct 2026: an invoice closes the receipts it names even when it is
 * below their value (BIL-01), an invoice's gross is its own VAT (BIL-03), lateness runs over every invoice's instalments
 * (BIL-05/WF-14), the invoice route is one transaction with a lock per receipt (BIL-02/G-07), the supplier reads bare
 * numbers and each reader formats the amount (NT, NFR-01), ratings stand on a received order (ACC-07), the receipt
 * window (decision 2), the contractor's Today row for a reported delivery, and the rules that changed.
 */

import fs from "fs"
import path from "path"
import { createDealLogic, paidInFull } from "@/lib/supplier-free/deal-logic"
import { deriveWorld, type RawWorld } from "@/lib/supplier-free/derive"
import { invoiceFigures } from "@/lib/supplier-free/invoice-rules"
import { createSupplierInvoice, InvoiceError, issuedByBuyer } from "@/lib/supplier-free/invoice-server"
import { deliveryReviews } from "@/lib/supplier-free/reviews"
import { receiptWindowDue, runReceiptWindow } from "@/lib/supplier-free/receipt-window"
import { permissionHolders, notifyNamed } from "@/lib/supplier-free/server-notify"
import { bareDocNumber, buildProcNotification, sarParam } from "@/lib/procurement/events"
import { displayParam, notificationCopy, type Translator } from "@/lib/mfg-events"
import { todayTasks } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import type { Deal, DealPo } from "@/lib/supplier-free/types"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))

type Doc = Record<string, unknown>
const TODAY = "2026-10-15"
const L = createDealLogic(TODAY)

const dealPo = (over: Partial<DealPo> = {}): DealPo => ({
  no: "2026/044",
  at: "2026-09-01",
  lines: [{ it: "i1", qty: 100, price: 10, got: 100, rej: 0, can: 0 }],
  need: "2026-09-20",
  acc: { at: "2026-09-02", date: "2026-09-20" },
  site: "",
  rcv: "",
  terms: [{ pct: 100, days: 30 }],
  ...over,
})
const deal = (over: Partial<Deal> = {}): Deal => ({
  id: "r1",
  rfq: "2026/031",
  c: "c1",
  title: "t",
  city: "الرياض",
  cat: "طوب وبلوك",
  channel: "public",
  posted: "2026-08-20",
  deadline: "2026-08-25",
  needBy: "2026-09-20",
  pricing: "item",
  items: [{ id: "i1", name: "بلوك", unit: "حبة", qty: 100, spec: "" }],
  files: [],
  qa: [],
  offer: { status: "won", v: [{ at: "2026-08-21", prices: { i1: 10 }, arrive: "", valid: "2026-09-30", note: "" }] },
  po: dealPo(),
  ship: [{ st: "ok", grn: "GR-2026/010", date: "2026-09-10", okAt: "2026-09-10", t: "10:00", by: "Salma", items: { i1: 100 }, got: { i1: 100 } }],
  invs: [],
  pays: [],
  msgs: [],
  log: [],
  ...over,
})

describe("BIL-01 — an invoice below its receipts' value still closes them", () => {
  const short = deal({ invs: [{ no: "F-1", date: "2026-09-12", amt: 900, file: "f.pdf", grns: ["GR-2026/010"], vat: 0.15 }] })

  it("no permanent 'upload the invoice' task once every receipt is named", () => {
    expect(L.canInvoice(short)).toBe(false)
    expect(L.uninvoicedNet(short)).toBe(0)
    expect(L.invSt(short)).toBe("due")
  })

  it("paid in full by its own total, and then 'paid'", () => {
    const paid = { ...short, pays: [{ at: "2026-10-01", amt: 1035, bank: "Rajhi", ref: "T1", st: "ok" as const }] }
    expect(L.isFullyPaid(paid)).toBe(true)
    expect(L.invSt(paid)).toBe("paid")
  })

  it("a receipt no invoice names is still billable; a lump-sum order only once complete", () => {
    expect(L.canInvoice(deal())).toBe(true)
    const lump = deal({ po: dealPo({ lump: 5000, lines: [{ it: "i1", qty: 100, price: null, got: 40, rej: 0, can: 0 }] }) })
    expect(L.canInvoice(lump)).toBe(false)
    expect(L.canInvoice({ ...lump, po: dealPo({ lump: 5000, lines: [{ it: "i1", qty: 100, price: null, got: 100, rej: 0, can: 0 }] }) })).toBe(true)
  })
})

describe("BIL-03 — the invoice's own VAT", () => {
  it("a supplier with no tax number: gross = net, and that is what 'paid' measures", () => {
    const noVat = deal({ invs: [{ no: "F-1", date: "2026-09-12", amt: 1000, file: "f.pdf", grns: ["GR-2026/010"], vat: 0 }], pays: [{ at: "2026-10-01", amt: 1000, bank: "B", ref: "T", st: "ok" }] })
    expect(L.invGross(noVat.invs[0])).toBe(1000)
    expect(L.isFullyPaid(noVat)).toBe(true)
    expect(paidInFull({ lines: [{ qty: 1, got: 1, can: 0 }], receipts: ["G"], invoices: [{ amt: 1000, vat: null, grns: ["G"] }], paidOk: 1000 })).toBe(false)
  })

  it("the stored invoice's figures (contractor side) read its own rate", () => {
    expect(invoiceFigures({ amountNet: 1000, vat: 0 })).toEqual({ net: 1000, vatRate: 0, vat: 0, gross: 1000 })
    expect(invoiceFigures({ amountNet: 1000, vat: 0.15 })).toEqual({ net: 1000, vatRate: 0.15, vat: 150, gross: 1150 })
  })

  it("derive maps the invoice's VAT and closes a short, VAT-free, paid deal as 'paid'", () => {
    const raw: RawWorld = {
      today: TODAY,
      myOrgId: "sup1",
      myUid: "sup1",
      rfqs: [{ id: "r1", organizationId: "con1", rfqNumber: "RFQ-2026/031", title: "بلوك", status: "Awarded", pricingMode: "line", products: [{ name: "بلوك", quantity: 100, unitOfMeasure: "حبة" }] }],
      offers: [{ id: "o1", rfqId: "r1", organizationId: "sup1", status: "مقبول", poId: "p1", lines: [{ rfqProductIndex: 0, unitPrice: 10 }], updatedAt: "2026-08-21" }],
      pos: [
        {
          id: "p1",
          organizationId: "con1",
          docNumber: "PO-2026/044",
          status: "accepted",
          rfqId: "r1",
          offerId: "o1",
          supplierOrgId: "sup1",
          supplierUserId: "sup1",
          lines: [{ id: "l1", name: "بلوك", unit: "حبة", quantity: 100, unitPrice: 10, accepted: 100, rejected: 0, held: 0, cancelled: 0, rfqProductIndex: 0 }],
          totalExVat: 1000,
          sentAt: "2026-09-01T08:00:00.000Z",
          supplierAcceptedAt: "2026-09-02T08:00:00.000Z",
          promisedDate: "2026-09-20",
          termsList: [{ pct: 100, days: 30 }],
          log: [],
        } as unknown as PurchaseOrder,
      ],
      deliveries: [{ id: "d1", poId: "p1", status: "confirmed", docNumber: "GR-2026/010", confirmedAt: "2026-09-10T08:00:00.000Z", lines: [{ poLineId: "l1", counted: 100, accepted: 100 }] }],
      invoices: [{ id: "i1", poId: "p1", number: "F-1", date: "2026-09-12", amountNet: 950, vat: 0, grns: ["GR-2026/010"] }],
      transfers: [{ id: "t1", poId: "p1", state: "ok", amount: 950, reportedAt: "2026-10-01T08:00:00.000Z", confirmedAt: "2026-10-02T08:00:00.000Z" }],
      warranties: [],
      chats: [],
      contractors: {},
      links: [],
      invitations: [],
      archived: {},
      seen: {},
      declined: {},
      questions: {},
    }
    const d = deriveWorld(raw).deals[0]
    expect(d.invs[0].vat).toBe(0)
    expect(d.closed).toEqual({ k: "paid", at: "2026-10-02" })
  })
})

describe("BIL-05 / WF-14 — how late each transfer was, over every invoice's instalments", () => {
  it("the second invoice's transfer is measured against its own due date, not the first invoice's", () => {
    const d = deal({
      ship: [
        { st: "ok", grn: "G1", date: "2026-08-30", okAt: "2026-08-30", t: "", by: "", items: { i1: 50 }, got: { i1: 50 } },
        { st: "ok", grn: "G2", date: "2026-09-09", okAt: "2026-09-09", t: "", by: "", items: { i1: 50 }, got: { i1: 50 } },
      ],
      invs: [
        { no: "F-1", date: "2026-09-01", amt: 1000, file: "a", grns: ["G1"], vat: 0 },
        { no: "F-2", date: "2026-09-10", amt: 500, file: "b", grns: ["G2"], vat: 0 },
      ],
      pays: [
        { at: "2026-10-03", amt: 1000, bank: "B", ref: "T1", st: "ok" },
        { at: "2026-10-15", amt: 500, bank: "B", ref: "T2", st: "ok" },
      ],
    })
    expect(L.payLateness(d)).toEqual([2, 5])
  })

  it("a transfer that did not arrive is never late and covers nothing", () => {
    const d = deal({
      invs: [{ no: "F-1", date: "2026-09-01", amt: 1000, file: "a", grns: ["GR-2026/010"], vat: 0 }],
      pays: [
        { at: "2026-10-05", amt: 1000, bank: "B", ref: "T1", st: "miss" },
        { at: "2026-10-06", amt: 1000, bank: "B", ref: "T2", st: "ok" },
      ],
    })
    expect(L.payLateness(d)).toEqual([0, 5])
  })
})

describe("BIL-02 / G-07 — the invoice is one transaction with a lock per receipt", () => {
  const SUP = { uid: "su", orgId: "sup", name: "Sami", company: "Al Noor", vatRate: 0 }
  const input = { poId: "po1", grns: ["GR-2026/004"], number: "INV-77", date: "2026-10-14", amountNet: 150, fileName: "f.pdf", fileUrl: "https://x.test/f.pdf" }
  const world = () =>
    new FakeAdminDb()
      .seed("purchaseOrders/po1", { organizationId: "buyer", supplierOrgId: "sup", status: "accepted", docNumber: "PO-2026/001", rfqId: "r1", offerId: "o1", preparedById: "p1", lines: [{ id: "l1", name: "Block", unit: "pc", quantity: 100, unitPrice: 2, accepted: 100, rejected: 0, held: 0, cancelled: 0 }], log: [], totalExVat: 200 })
      .seed("deliveries/d1", { poId: "po1", status: "confirmed", docNumber: "GR-2026/004", confirmedByUserId: "fin", confirmedAt: "2026-10-13T08:00:00.000Z", lines: [{ poLineId: "l1", accepted: 100 }] })
      .seed("users/buyer", { organizationId: "buyer" })
      .seed("users/fin", { organizationId: "buyer", organizationRole: "member", defaultGroupId: "g-fin" })
      .seed("teamGroups/g-fin", { organizationId: "buyer", permissions: ["invoices.manage"] })
  const NOW = new Date("2026-10-15T09:00:00Z")

  it("writes the invoice with its VAT (0 without a tax number), the locks and the order's log; Finance is told", async () => {
    const db = world()
    const r = await createSupplierInvoice(db as never, SUP, input, NOW)
    expect(db.get(`supplierInvoices/${r.id}`)).toMatchObject({ poId: "po1", number: "INV-77", amountNet: 150, vat: 0, grns: ["GR-2026/004"], createdById: "su" })
    expect(db.list("supplierInvoiceLocks")).toHaveLength(2)
    const log = (db.get("purchaseOrders/po1") as { log: { action: string; byId: string; params: Doc }[] }).log
    expect(log).toEqual([expect.objectContaining({ action: "invoice_uploaded", byId: "su", params: expect.objectContaining({ invoice: "INV-77", receipts: "GR-2026/004" }) })])
    const fin = db.list("users/fin/notifications")
    expect(fin.map((n) => n.type)).toEqual(["po_invoice_uploaded"])
    expect((fin[0].i18n as { params: Doc }).params.amount).toBe("sar:150")
  })

  it("two requests at once cannot bill one receipt twice: the second finds the lock", async () => {
    const db = world()
    const results = await Promise.allSettled([createSupplierInvoice(db as never, SUP, input, NOW), createSupplierInvoice(db as never, SUP, { ...input, number: "INV-78" }, NOW)])
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1)
    expect(db.list("supplierInvoices")).toHaveLength(1)
    // And afterwards the rule itself refuses it, naming why.
    const again = await createSupplierInvoice(db as never, SUP, { ...input, number: "INV-79" }, NOW).catch((e: unknown) => e)
    expect(again).toBeInstanceOf(InvoiceError)
    expect((again as InvoiceError).blocks).toContain("billed")
  })

  it("a delivery the supplier marked confirmed himself is no receipt (B-01): nothing to invoice against", async () => {
    const db = world().seed("deliveries/d1", { poId: "po1", status: "confirmed", docNumber: "GR-2026/004", confirmedByUserId: "su", confirmedAt: "2026-10-13T08:00:00.000Z", lines: [{ poLineId: "l1", accepted: 100 }] }).seed("users/su", { organizationId: "sup" })
    const r = await createSupplierInvoice(db as never, SUP, input, NOW).catch((e: unknown) => e)
    expect(r).toBeInstanceOf(InvoiceError)
    expect(db.list("supplierInvoices")).toHaveLength(0)
    expect(issuedByBuyer("buyer", "buyer")).toBe(true)
    expect(issuedByBuyer("sup", "buyer")).toBe(false)
    expect(issuedByBuyer(undefined, "buyer")).toBe(false)
  })

  it("an invoice number is used once by a supplier — even across orders", async () => {
    const db = world().seed("supplierInvoiceLocks/x", {})
    await createSupplierInvoice(db as never, SUP, input, NOW)
    db.seed("purchaseOrders/po2", { ...(db.get("purchaseOrders/po1") as Doc), log: [] }).seed("deliveries/d2", { poId: "po2", status: "confirmed", docNumber: "GR-2026/005", confirmedByUserId: "fin", confirmedAt: "2026-10-13T08:00:00.000Z", lines: [{ poLineId: "l1", accepted: 100 }] })
    const dup = await createSupplierInvoice(db as never, SUP, { ...input, poId: "po2", grns: ["GR-2026/005"] }, NOW).catch((e: unknown) => e)
    expect((dup as InvoiceError).blocks).toContain("duplicate")
  })
})

describe("what the supplier reads in a notification (WF-11, NFR-01)", () => {
  it("bare numbers for the supplier, the contractor keeps his codes", () => {
    expect(bareDocNumber("PO-2026/031")).toBe("2026/031")
    expect(bareDocNumber("GR-2026/1187")).toBe("2026/1187")
    const e = { kind: "po_payment_reported" as const, organizationId: "buyer", to: [], supplier: { userId: "su", orgId: "sup" }, params: { contractor: "Binaa", number: "PO-2026/031", amount: sarParam(1150), bank: "B", ref: "T" }, poId: "po1" }
    const sup = buildProcNotification(e, { uid: "fin", name: "Fin" }, "su", "2026-10-15T00:00:00Z")
    expect(sup.i18n.params.number).toBe("2026/031")
    expect(sup.title).toBe("أبلغ Binaa بحوالة — أمر الشراء 2026/031")
    expect(sup.message).toContain("1,150 ر.س")
    expect(`${sup.title}${sup.message}`).not.toMatch(/PO-|sar:/)
    const buyer = buildProcNotification(e, { uid: "fin", name: "Fin" }, "buyer", "2026-10-15T00:00:00Z")
    expect(buyer.i18n.params.number).toBe("PO-2026/031")
  })

  it("the amount is written in each reader's language, never fixed in Arabic by the sender", () => {
    expect(displayParam(sarParam(12500.5), "ar")).toBe("12,500.5 ر.س")
    expect(displayParam(sarParam(12500), "en")).toBe("SAR 12,500")
    const t = Object.assign((key: string, p?: Record<string, string | number>) => `${key}:${p?.amount}`, { has: () => true }) as Translator
    expect(notificationCopy({ i18n: { title: "pn_po_payment_reported_title", message: "pn_po_payment_reported", params: { amount: sarParam(900) } } }, t, "en").message).toBe("pn_po_payment_reported:SAR 900")
  })
})

describe("server-side team: who holds a permission", () => {
  it("the owner, members whose default group grants it, and legacy owners", async () => {
    const db = new FakeAdminDb()
      .seed("users/org1", { organizationId: "org1" })
      .seed("users/rcv", { organizationId: "org1", organizationRole: "member", defaultGroupId: "g1" })
      .seed("users/other", { organizationId: "org1", organizationRole: "member", defaultGroupId: "g2" })
      .seed("teamGroups/g1", { organizationId: "org1", permissions: ["deliveries.confirm"] })
      .seed("teamGroups/g2", { organizationId: "org1", permissions: ["rfq.create"] })
    expect((await permissionHolders(db as never, "org1", ["deliveries.confirm"])).sort()).toEqual(["org1", "rcv"])
    const n = await notifyNamed(db as never, { uid: "su", name: "S" }, { kind: "po_delivery_reported", organizationId: "org1", params: {}, poId: "po1" }, ["p1"], { permissions: ["deliveries.confirm"] })
    expect(n).toBe(3)
    expect(db.list("users/rcv/notifications")).toHaveLength(1)
  })
})

describe("ACC-07 — a rating stands on a completed delivery and names its material", () => {
  const po = (id: string, accepted: number, status = "accepted") => ({ id, docNumber: `PO-2026/${id}`, status, lines: [{ id: "l1", name: "بلوك مفرغ", unit: "حبة", quantity: 100, unitPrice: 2, accepted, rejected: 0, held: 0, cancelled: 0 }] }) as unknown as PurchaseOrder
  it("only reviews by a contractor, carrying an order of his that was received", () => {
    const out = deliveryReviews(
      [
        { reviewerRole: "Contractor", rating: 5, poId: "a" },
        { reviewerRole: "Contractor", rating: 1, poId: "b" },
        { reviewerRole: "Contractor", rating: 3 },
        { reviewerRole: "Supplier", rating: 4, poId: "a" },
        { reviewerRole: "Contractor", rating: 2, poId: "zzz" },
      ],
      [po("a", 100), po("b", 40)]
    )
    expect(out).toEqual([expect.objectContaining({ rating: 5, poId: "a", material: "بلوك مفرغ", poNumber: "PO-2026/a" })])
  })
})

describe("decision 2 — the receipt window", () => {
  const order = (reports: Doc[], status = "accepted") => ({ id: "po1", organizationId: "buyer", docNumber: "PO-2026/001", supplierName: "Al Noor", status, preparedById: "p1", lines: [], deliveryReports: reports, log: [] }) as unknown as PurchaseOrder
  const rep = (over: Doc = {}) => ({ id: "r1", at: "2026-10-01T00:00:00Z", date: "2026-10-10", note: null, byId: "su", byName: "S", reminders: [], closedAt: null, ...over })

  it("reminds after 2 days, escalates after 5, each once, never on a closed report or a closed order", () => {
    expect(receiptWindowDue([order([rep({ date: "2026-10-14" })])], TODAY)).toEqual([])
    expect(receiptWindowDue([order([rep({ date: "2026-10-13" })])], TODAY)).toEqual([{ poId: "po1", reportId: "r1", stage: "remind", days: 2 }])
    expect(receiptWindowDue([order([rep({ date: "2026-10-13", nudgedAt: "x" })])], TODAY)).toEqual([])
    expect(receiptWindowDue([order([rep({ date: "2026-10-10", nudgedAt: "x" })])], TODAY)).toEqual([{ poId: "po1", reportId: "r1", stage: "escalate", days: 5 }])
    expect(receiptWindowDue([order([rep({ date: "2026-10-10", nudgedAt: "x", escalatedAt: "y" })])], TODAY)).toEqual([])
    expect(receiptWindowDue([order([rep({ date: "2026-10-01", closedAt: "z" })])], TODAY)).toEqual([])
    expect(receiptWindowDue([order([rep({ date: "2026-10-01" })], "closed")], TODAY)).toEqual([])
  })

  it("the job stamps the report and tells the receivers, then the procurement manager — and a second run tells nobody", async () => {
    const db = new FakeAdminDb()
      .seed("purchaseOrders/po1", { ...(order([rep({ date: "2026-10-10" })]) as unknown as Doc) })
      .seed("users/buyer", { organizationId: "buyer" })
      .seed("users/rcv", { organizationId: "buyer", organizationRole: "member", defaultGroupId: "g-rcv" })
      .seed("users/mgr", { organizationId: "buyer", organizationRole: "member", defaultGroupId: "g-mgr" })
      .seed("teamGroups/g-rcv", { organizationId: "buyer", permissions: ["deliveries.confirm"] })
      .seed("teamGroups/g-mgr", { organizationId: "buyer", permissions: ["po.approve"] })
    const now = new Date("2026-10-15T06:00:00Z")
    expect(await runReceiptWindow(db as never, now)).toMatchObject({ open: 1, reminded: 1, escalated: 1, failed: 0 })
    const r = (db.get("purchaseOrders/po1") as { deliveryReports: Doc[] }).deliveryReports[0]
    expect(r).toMatchObject({ nudgedAt: now.toISOString(), escalatedAt: now.toISOString() })
    expect(db.list("users/rcv/notifications").map((n) => n.type)).toEqual(["po_receipt_window_remind"])
    expect(db.list("users/mgr/notifications").map((n) => n.type)).toEqual(["po_receipt_window_escalated"])
    expect(await runReceiptWindow(db as never, now)).toMatchObject({ reminded: 0, escalated: 0 })
    expect(db.list("users/rcv/notifications")).toHaveLength(1)
  })
})

describe("the contractor's Today — a delivery the supplier reported is the receivers' to record", () => {
  const actor: ProcActor = { uid: "rcv", name: "R", isOwner: false, canApprove: false, canPrepare: false, canExpedite: false, canReceive: true, seesPrices: false }
  const po = { id: "po1", organizationId: "buyer", docNumber: "PO-2026/001", supplierName: "Al Noor", status: "accepted", supplierOrgId: "sup", lines: [{ id: "l1", name: "x", unit: "u", quantity: 10, unitPrice: 1, accepted: 0, rejected: 0, held: 0, cancelled: 0 }], deliveryReports: [{ id: "r1", at: "", date: "2026-10-12", note: "At the gate", byId: "su", byName: "S", reminders: ["2026-10-14T00:00:00Z"], closedAt: null }], log: [], createdAt: "2026-10-01" } as unknown as PurchaseOrder
  const world = (orders: PurchaseOrder[]) => ({ orders, receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {} }) as unknown as Parameters<typeof todayTasks>[0]

  it("one row per open report, amber after 2 days — the receiver counts it on his own page; Procurement only follows it up", () => {
    const rows = todayTasks(world([po]), actor, new Date("2026-10-15T09:00:00Z")).filter((t) => t.kind === "delivery_reported")
    expect(rows).toEqual([expect.objectContaining({ severity: "amber", chip: "rcv", actionKey: "actions.count", href: "/contractor/receive/po/po1", titleParams: { supplier: "Al Noor", number: "PO-2026/001" }, subParams: expect.objectContaining({ date: "2026-10-12", daysAgo: 3, reminded: 1, hasNote: 1 }) })])
    const follower = { ...actor, canReceive: false, canExpedite: true }
    expect(todayTasks(world([po]), follower, new Date("2026-10-15T09:00:00Z")).find((t) => t.kind === "delivery_reported")).toMatchObject({ actionKey: "actions.openNotice", href: "/contractor/goods-received" })
    const closed = { ...po, deliveryReports: [{ ...po.deliveryReports![0], closedAt: "x" }] } as PurchaseOrder
    expect(todayTasks(world([closed]), actor, new Date("2026-10-15T09:00:00Z")).filter((t) => t.kind === "delivery_reported")).toEqual([])
  })
})

describe("the rules that changed (the ruleset stays under its size ceiling)", () => {
  const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\/\/[^\n]*/g, "")
  const block = (start: string) => {
    const i = rules.indexOf(start)
    expect(i).toBeGreaterThan(-1)
    const rest = rules.slice(i + 1)
    const next = rest.search(/\n {4}match \//)
    return next < 0 ? rest : rest.slice(0, next)
  }

  it("frozen terms cannot change (ORD-01), and no supplier writes an order (ORD-02 — the server accepts)", () => {
    expect(rules).toMatch(/function poIdentityUntouched\(ck\)[\s\S]*?'termsList'\]\);/)
    expect(rules).not.toContain("poSupplierAccepts")
  })

  it("a review is written in one's own name (the free supplier's is the server's, one per order)", () => {
    expect(block("match /reviews/{reviewId} {")).toContain("allow create: if isSignedIn() && rd().reviewerId == request.auth.uid;")
  })

  it("a supplier only re-asks to connect — never activates himself (CON-03); no rule hangs a function off `request`", () => {
    const links = block("match /contractorSupplierLinks/{linkId} {")
    expect(links).toContain("(isSupplierOrg() && rd().status == 'pending' && rd().supplierOrgId == resource.data.supplierOrgId)")
    expect(links).not.toMatch(/request\.is(Supplier|Contractor)Org\(\)/)
  })
})
