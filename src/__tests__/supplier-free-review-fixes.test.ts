/**
 * @jest-environment node
 *
 * Supplier 1.0 — the fixes after the correctness review of 15 Oct 2026: the company an act runs for is the ACTIVE one
 * (a member, a secondary company), one VAT rule for quotes and invoices, no direct price write on a closed RFQ, no
 * self-made connection, one live quote per company even on a double submit (and an old withdrawal does not block),
 * a receipt that accepted nothing never holds "paid in full" back, a cut reply that skips an item never leaves the old
 * figures behind, the receipt window counts from the report, a receipt without a number shows none, the payment
 * reminder and the questions run on the server.
 */

import fs from "fs"
import path from "path"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"
import { supplierCompanyOf } from "@/lib/supplier-free/supplier-company"
import { createSupplierInvoice } from "@/lib/supplier-free/invoice-server"
import { QuoteActError, questionsFor, quoteActSchema, runQuoteAct, type QuoteAct, type QuoteSupplier } from "@/lib/supplier-free/server-quote-acts"
import { ActError, actSchema, runSupplierAct, type Act } from "@/lib/supplier-free/server-acts"
import { quoteBlocks, quoteShapeOf } from "@/lib/supplier-free/quote-rules"
import { createDealLogic } from "@/lib/supplier-free/deal-logic"
import { deriveWorld, type RawWorld } from "@/lib/supplier-free/derive"
import { receiptWindowDue } from "@/lib/supplier-free/receipt-window"
import type { Deal, DealPo } from "@/lib/supplier-free/types"
import type { PurchaseOrder } from "@/lib/procurement/types"

jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))

let adminDb: FakeAdminDb = new FakeAdminDb()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (!token.startsWith("uid:")) throw new Error("bad token")
      return { uid: token.slice(4) }
    },
  }),
  getAdminFirestore: () => adminDb,
}))
jest.mock("@/lib/supplier-free/invoice-server", () => {
  const actual = jest.requireActual("@/lib/supplier-free/invoice-server")
  return { ...actual, createSupplierInvoice: jest.fn(actual.createSupplierInvoice) }
})
jest.mock("@/lib/supplier-free/server-quote-acts", () => {
  const actual = jest.requireActual("@/lib/supplier-free/server-quote-acts")
  return { ...actual, runQuoteAct: jest.fn(actual.runQuoteAct) }
})

type Doc = Record<string, unknown>
const NOW = new Date("2026-10-13T06:00:00Z") // 09:00 in Riyadh
const rulesText = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\/\/[^\n]*/g, "")
const block = (start: string) => {
  const i = rulesText.indexOf(start)
  expect(i).toBeGreaterThan(-1)
  const rest = rulesText.slice(i + 1)
  const next = rest.search(/\n {4}match \//)
  return (next < 0 ? rest : rest.slice(0, next)).replace(/\s+/g, " ")
}
const refusal = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof QuoteActError || e instanceof ActError ? e.code : String(e)))

beforeEach(() => jest.clearAllMocks())

// ---- 1. The active company --------------------------------------------------------------------------------------

describe("the company an act runs for is the ACTIVE one, never the caller's own doc", () => {
  it("a team member acts for the owner's company: its name, its field, and its VAT number from companyIdentity", async () => {
    const db = new FakeAdminDb()
      .seed("users/own", { organizationId: "own", role: "Supplier", companyName: "Al Noor", specializations: ["حديد"], coverageCities: ["جدة"] })
      .seed("companyIdentity/own", { taxNumber: "300000000000003" })
    const c = await supplierCompanyOf(db as never, "mem", { organizationId: "own", organizationRole: "member", role: "Supplier", name: "Sami" })
    expect(c).toMatchObject({ orgId: "own", company: "Al Noor", name: "Sami", hasVat: true, vatRate: 0.15, field: { specs: ["حديد"], cities: ["جدة"] } })
  })

  it("a secondary company never takes the primary's VAT number or name; its public yes/no counts", async () => {
    const user = { organizationId: "org2", organizationRole: "owner", role: "Supplier", name: "Sami", companyName: "Primary Co", taxNumber: "300000000000003" }
    const db = new FakeAdminDb().seed("organizations/org2", { companyName: "Second Co" })
    expect(await supplierCompanyOf(db as never, "own", user)).toMatchObject({ orgId: "org2", company: "Second Co", hasVat: false, vatRate: 0 })
    db.seed("companyPublicFacts/org2", { hasVat: true })
    expect(await supplierCompanyOf(db as never, "own", user)).toMatchObject({ hasVat: true, vatRate: 0.15 })
  })

  it("the invoice route stores the member's company VAT (not 0 because HIS doc has no tax number)", async () => {
    adminDb = new FakeAdminDb()
      .seed("users/own", { organizationId: "own", role: "Supplier", companyName: "Al Noor" })
      .seed("users/mem", { organizationId: "own", organizationRole: "member", role: "Supplier", name: "Sami" })
      .seed("companyIdentity/own", { taxNumber: "300000000000003" })
    const { POST } = await import("@/app/api/supplier-free/invoice/route")
    const body = { poId: "po1", grns: ["GR-1"], number: "INV-1", date: "2026-10-12", amountNet: 10, fileName: "f.pdf", fileUrl: "https://x.test/f.pdf" }
    await POST(new Request("https://x.test/api", { method: "POST", headers: { authorization: "Bearer uid:mem" }, body: JSON.stringify(body) }))
    expect(createSupplierInvoice).toHaveBeenCalledWith(adminDb, expect.objectContaining({ orgId: "own", company: "Al Noor", vatRate: 0.15 }), expect.anything())
  })

  it("the act route hands the quote acts the active company and its VAT rate", async () => {
    adminDb = new FakeAdminDb()
      .seed("users/own", { organizationId: "own", role: "Supplier", companyName: "Al Noor", specializations: ["طوب وبلوك"], coverageCities: ["الرياض"] })
      .seed("users/mem", { organizationId: "own", organizationRole: "member", role: "Supplier", name: "Sami" })
    const { POST } = await import("@/app/api/supplier-free/act/route")
    await POST(new Request("https://x.test/api", { method: "POST", headers: { authorization: "Bearer uid:mem" }, body: JSON.stringify({ action: "quote.withdraw", offerId: "o1" }) }))
    expect(runQuoteAct).toHaveBeenCalledWith(adminDb, expect.objectContaining({ orgId: "own", company: "Al Noor", vatRate: 0, field: { specs: ["طوب وبلوك"], cities: ["الرياض"] } }), expect.anything())
  })
})

// ---- 2, 5, 7, 11. The quote acts ---------------------------------------------------------------------------------

const SUP: QuoteSupplier = { uid: "su", name: "Sami", orgId: "sup", company: "Al Noor", field: { specs: ["طوب وبلوك"], cities: ["الرياض"] }, vatRate: 0 }
const rfq = (over: Doc = {}): Doc => ({
  organizationId: "con",
  contractorId: "con",
  rfqNumber: "RFQ-2026/031",
  title: "بلوك",
  category: "طوب وبلوك",
  city: "الرياض",
  status: "New",
  visibility: "public",
  pricingMode: "line",
  deadline: "2026-10-13",
  products: [
    { name: "بلوك مفرغ", quantity: 100, unitOfMeasure: "حبة" },
    { name: "بلوك مصمت", quantity: 50, unitOfMeasure: "حبة" },
  ],
  offersCount: 0,
  ...over,
})
const values = (over: Doc = {}) => ({ prices: { i1: "2.5", i2: "3" }, skip: {}, total: "", arrive: "", valid: "2026-10-27", note: "", ...over })
const quote = (db: FakeAdminDb, act: Record<string, unknown>, s: QuoteSupplier = SUP, now = NOW) => runQuoteAct(db as never, s, quoteActSchema.parse(act) as QuoteAct, now)

describe("one VAT rule for quotes and invoices (decision 9)", () => {
  it("the quote form charges 15% only with a VAT number", () => {
    const shape = quoteShapeOf(rfq())
    const L = { daysTo: () => 1 }
    expect(quoteBlocks(shape, values(), "new", L, 0)).toMatchObject({ net: 400, vat: 0, gross: 400 })
    expect(quoteBlocks(shape, values(), "new", L, 0.15)).toMatchObject({ net: 400, vat: 60, gross: 460 })
  })

  it("the rate is stored on the version, and the deal reads it back", async () => {
    const db = new FakeAdminDb().seed("rfqs/r1", rfq())
    const { offerId } = (await quote(db, { action: "quote.new", rfqId: "r1", values: values() })) as { offerId: string }
    const saved = db.get(`offers/${offerId}`) as { versions: Doc[] }
    expect(saved.versions[0]).toMatchObject({ total: 400, vatRate: 0 })
    const world = deriveWorld({ ...rawWorld(), rfqs: [{ ...rfq(), id: "r1" }], offers: [{ ...(saved as Doc), id: offerId }] } as RawWorld)
    const deal = world.deals.find((d) => d.id === "r1") as Deal
    // Today the company has a VAT number, but this version was quoted without one.
    expect(createDealLogic("2026-10-13", 0.15).quoteVatRate(deal)).toBe(0)
  })

  it("an invoice carries the rate it was given", async () => {
    const db = new FakeAdminDb()
      .seed("purchaseOrders/po1", { organizationId: "buyer", supplierOrgId: "sup", status: "accepted", docNumber: "PO-2026/001", rfqId: "r1", offerId: "o1", lines: [{ id: "l1", name: "B", unit: "pc", quantity: 10, unitPrice: 2, accepted: 10 }], log: [], totalExVat: 20 })
      .seed("deliveries/d1", { poId: "po1", status: "confirmed", docNumber: "GR-1", confirmedByUserId: "buyer", confirmedAt: "2026-10-12T08:00:00Z", lines: [{ poLineId: "l1", accepted: 10 }] })
      .seed("users/buyer", { organizationId: "buyer" })
    const r = await createSupplierInvoice(db as never, { uid: "su", orgId: "sup", name: "S", company: "Al Noor", vatRate: 0.15 }, { poId: "po1", grns: ["GR-1"], number: "INV-1", date: "2026-10-12", amountNet: 20, fileName: "f", fileUrl: "https://x.test/f" }, NOW)
    expect(db.get(`supplierInvoices/${r.id}`)).toMatchObject({ vat: 0.15 })
  })
})

describe("one live quote per company", () => {
  it("a double submit writes ONE quote: the check runs inside the transaction", async () => {
    const db = new FakeAdminDb().seed("rfqs/r1", rfq())
    db.serialTx = true
    const results = await Promise.allSettled([quote(db, { action: "quote.new", rfqId: "r1", values: values() }), quote(db, { action: "quote.new", rfqId: "r1", values: values() })])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(db.list("offers")).toHaveLength(1)
    expect(db.get("rfqs/r1")?.offersCount).toBe(1)
  })

  it("an older withdrawal that only stamped withdrawnAt does not block a new quote or a decline", async () => {
    const db = new FakeAdminDb().seed("rfqs/r1", rfq({ invitedSupplierOrgIds: ["sup"] })).seed("offers/old", { rfqId: "r1", organizationId: "sup", status: "قيد المراجعة", withdrawnAt: "2026-10-11T08:00:00Z" })
    await expect(quote(db, { action: "quote.decline", rfqId: "r1" })).resolves.toEqual({})
    await expect(quote(db, { action: "quote.new", rfqId: "r1", values: values() })).resolves.toHaveProperty("offerId")
  })
})

describe("a cut reply that leaves an item out", () => {
  it("revises the batches and totalBatchesPrice to the new total — the award never reads the pre-cut figure", async () => {
    const db = new FakeAdminDb().seed("rfqs/r1", rfq()).seed("offers/o1", {
      rfqId: "r1",
      supplierId: "su",
      organizationId: "sup",
      status: "مطلوب تخفيض",
      reductionAt: "2026-10-13T05:00:00Z",
      reductionBy: "2026-10-16",
      price: "400",
      lines: [{ rfqProductIndex: 0, unitPrice: 2.5 }, { rfqProductIndex: 1, unitPrice: 3 }],
      deliveryBatches: [{ location: "a", deliveryDate: "", price: "300", quantity: "100" }, { location: "b", deliveryDate: "", price: "100", quantity: "50" }],
      totalBatchesPrice: 400,
      validUntil: "2026-10-27",
    })
    await quote(db, { action: "quote.version", offerId: "o1", mode: "reduce", values: values({ prices: { i1: "2" }, skip: { i2: true } }) })
    const saved = db.get("offers/o1") as Doc & { deliveryBatches: { price: string }[] }
    expect(saved.price).toBe("200")
    expect(saved.totalBatchesPrice).toBe(200)
    expect(saved.deliveryBatches.map((b) => b.price)).toEqual(["150", "50"])
    expect(saved.lines).toEqual([{ rfqProductIndex: 0, unitPrice: 2 }])
  })
})

describe("questions on a request (decision 10, RFQ-04)", () => {
  const world = () =>
    new FakeAdminDb()
      .seed("rfqs/r1", rfq({ createdByUserId: "buyer1" }))
      .seed("users/con", { organizationId: "con" })
      .seed("users/buyer1", { organizationId: "con", organizationRole: "member", defaultGroupId: "g-buy" })
      .seed("users/rm", { organizationId: "con", organizationRole: "member", defaultGroupId: "g-rfq" })
      .seed("teamGroups/g-rfq", { organizationId: "con", permissions: ["rfq.manage"] })
      .seed("teamGroups/g-buy", { organizationId: "con", permissions: [] })

  it("asking writes the question in his company's name and tells the creator and whoever runs RFQs", async () => {
    const db = world()
    const { id } = (await quote(db, { action: "quote.ask", rfqId: "r1", question: "ما المقاس؟" })) as { id: string }
    expect(db.get(`rfqs/r1/inquiries/${id}`)).toMatchObject({ question: "ما المقاس؟", organizationId: "sup", supplierName: "Al Noor", reply: null })
    for (const u of ["con", "buyer1", "rm"]) expect(db.get(`users/${u}/notifications/rfq_question__${id}`)).toMatchObject({ type: "rfq_question", i18n: { title: "pn_rfq_question_title" } })
  })

  it("is refused on a closed request and on a private one that does not name him", async () => {
    expect(await refusal(quote(world().seed("rfqs/r1", rfq({ status: "Awarded" })), { action: "quote.ask", rfqId: "r1", question: "x" }))).toBe("rfq_closed")
    expect(await refusal(quote(world().seed("rfqs/r1", rfq({ visibility: "private", allowedSupplierOrgIds: ["other"] })), { action: "quote.ask", rfqId: "r1", question: "x" }))).toBe("not_reached")
  })

  it("a supplier reads his own and the answered ones of others — never another's unanswered question or who asked", async () => {
    const db = world()
      .seed("rfqs/r1/inquiries/q1", { question: "mine", organizationId: "sup", supplierName: "Al Noor", reply: null, createdAt: "1" })
      .seed("rfqs/r1/inquiries/q2", { question: "theirs answered", organizationId: "x", supplierName: "Rival", reply: "yes", createdAt: "2" })
      .seed("rfqs/r1/inquiries/q3", { question: "theirs open", organizationId: "x", supplierName: "Rival", reply: null, createdAt: "3" })
    const rows = await questionsFor(db as never, "sup", "r1")
    expect(rows.map((r) => [r.id, r.mine])).toEqual([
      ["q1", true],
      ["q2", false],
    ])
    expect(JSON.stringify(rows)).not.toContain("Rival")
  })

  it("the rules no longer let any signed-in user read a request's questions", () => {
    const inq = block("match /inquiries/{inquiryId} {")
    expect(inq).not.toContain("allow read: if isSignedIn();")
    expect(inq).toContain("allow read: if isSignedIn() && (resource.data.get('organizationId', '') == getOrganizationId() || rfqOrg() || isAdmin());")
  })
})

// ---- 3, 4. The rules ---------------------------------------------------------------------------------------------

describe("the rules", () => {
  it("a supplier's own price write needs an open RFQ (the legacy cut reply still passes while it is New)", () => {
    const offers = block("match /offers/{offerId} {")
    expect(offers).toContain("&& rfqData(resource.data.rfqId).status == 'New')))")
  })

  it("a supplier never creates an active link — only a pending request in his own name", () => {
    const links = block("match /contractorSupplierLinks/{linkId} {")
    expect(links).toContain("(rd().supplierOrgId == getOrganizationId() && rd().requestedBy == \"supplier\" && rd().status == 'pending')")
    expect(links).not.toContain('rd().requestedBy == "contractor")')
  })

  it("the legacy connections page accepts an invitation through the server, not by writing the link", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/[locale]/(supplier)/supplier/connections/page.tsx"), "utf8")
    expect(page).not.toMatch(/addDoc\(collection\(firestore, "contractorSupplierLinks"\)/)
    expect(page).toContain('answerInvitation(inv.id, "accepted")')
  })

  it("stays under the release ceiling", () => {
    let s = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8")
    s = s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ")
    expect(s.length).toBeLessThanOrEqual(147_603)
  })
})

// ---- 6, 9. The deal on the supplier's screen ---------------------------------------------------------------------

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
  ship: [
    { st: "ok", grn: "GR-1", date: "2026-09-08", okAt: "2026-09-08", t: "", by: "", items: { i1: 20 }, got: { i1: 0 } },
    { st: "ok", grn: "GR-2", date: "2026-09-10", okAt: "2026-09-10", t: "", by: "", items: { i1: 100 }, got: { i1: 100 } },
  ],
  invs: [{ no: "F-1", date: "2026-09-12", amt: 1000, file: "f.pdf", grns: ["GR-2"], vat: 0 }],
  pays: [{ at: "2026-10-01", amt: 1000, bank: "B", ref: "T", st: "ok" }],
  msgs: [],
  log: [],
  ...over,
})

describe("a receipt that accepted nothing", () => {
  const L = createDealLogic("2026-10-15")
  it("is never an invoice to upload, and never holds 'paid in full' back", () => {
    const d = deal()
    expect(L.uninvoicedReceipts(d).map((r) => r.grn)).toEqual([])
    expect(L.canInvoice(d)).toBe(false)
    expect(L.isFullyPaid(d)).toBe(true)
    expect(L.invSt(d)).toBe("paid")
  })

  it("the server agrees: the rating opens once the accepted receipts are invoiced and paid", async () => {
    const db = new FakeAdminDb()
      .seed("purchaseOrders/po1", { organizationId: "buyer", supplierOrgId: "sup", status: "closed", docNumber: "PO-2026/001", offerId: "o1", lines: [{ id: "l1", name: "B", quantity: 100, unitPrice: 10, accepted: 100, cancelled: 0 }], log: [] })
      .seed("deliveries/d0", { poId: "po1", status: "confirmed", docNumber: "GR-1", lines: [{ poLineId: "l1", counted: 20, rejected: 15, held: 5 }] })
      .seed("deliveries/d1", { poId: "po1", status: "confirmed", docNumber: "GR-2", lines: [{ poLineId: "l1", accepted: 100 }] })
      .seed("supplierInvoices/i1", { poId: "po1", amountNet: 1000, vat: 0, grns: ["GR-2"] })
      .seed("supplierTransfers/t1", { poId: "po1", state: "ok", amount: 1000 })
      .seed("users/buyer", { organizationId: "buyer" })
    await expect(runSupplierAct(db as never, { uid: "su", name: "S", orgId: "sup", company: "Al Noor" }, actSchema.parse({ action: "po.rate", poId: "po1", stars: 5 }) as Act, NOW)).resolves.toEqual({})
  })
})

describe("a receipt without a number (G-10)", () => {
  it("keeps its id as the key invoices name, and shows no number", () => {
    const po = { id: "po1", organizationId: "con", supplierOrgId: "sup", rfqId: "r1", offerId: "o1", status: "accepted", docNumber: "PO-2026/001", lines: [{ id: "l1", name: "B", unit: "pc", quantity: 10, unitPrice: 2, rfqProductIndex: 0 }], log: [], totalExVat: 20 } as unknown as PurchaseOrder
    const w = deriveWorld({
      ...rawWorld(),
      rfqs: [{ ...rfq(), id: "r1" }],
      offers: [{ id: "o1", rfqId: "r1", organizationId: "sup", status: "مقبول", price: "20", poId: "po1" }],
      pos: [po],
      deliveries: [{ id: "abcDEF123", poId: "po1", status: "confirmed", confirmedAt: "2026-10-12T08:00:00Z", lines: [{ poLineId: "l1", accepted: 10 }] }],
    } as RawWorld)
    const r = w.deals[0].ship.find((s) => s.st === "ok") as { grn: string; no?: string }
    expect(r.grn).toBe("abcDEF123")
    expect(r.no).toBe("")
  })
})

// ---- 8. The receipt window ---------------------------------------------------------------------------------------

describe("the receipt window counts from the report, not from a back-dated delivery", () => {
  const order = (reports: Doc[]) => ({ id: "po1", status: "accepted", deliveryReports: reports }) as unknown as PurchaseOrder
  it("a report filed yesterday for a delivery last week is not late yet", () => {
    const rep = { id: "r1", at: "2026-10-14T07:00:00Z", date: "2026-10-05", reminders: [], closedAt: null }
    expect(receiptWindowDue([order([rep])], "2026-10-15")).toEqual([])
    expect(receiptWindowDue([order([rep])], "2026-10-16")).toEqual([{ poId: "po1", reportId: "r1", stage: "remind", days: 2 }])
  })
})

// ---- 10. The payment reminder ------------------------------------------------------------------------------------

describe("remind about the payment (WF-14) — on the server", () => {
  const world = () =>
    new FakeAdminDb()
      .seed("purchaseOrders/po1", { organizationId: "buyer", supplierOrgId: "sup", status: "closed", docNumber: "PO-2026/001", rfqId: "r1", offerId: "o1", preparedById: "p1", lines: [], log: [] })
      .seed("supplierInvoices/i1", { poId: "po1", supplierOrgId: "sup", number: "INV-1", amountNet: 1000, vat: 0.15 })
      .seed("supplierInvoices/i2", { poId: "po1", supplierOrgId: "sup", number: "INV-2", amountNet: 500, vat: 0.15 })
      .seed("offers/o1", { rfqId: "r1", contractorId: "buyer", organizationId: "sup" })
      .seed("users/buyer", { organizationId: "buyer" })
      .seed("users/fin", { organizationId: "buyer", organizationRole: "member", defaultGroupId: "g-fin" })
      .seed("teamGroups/g-fin", { organizationId: "buyer", permissions: ["invoices.manage"] })
  const S = { uid: "su", name: "S", orgId: "sup", company: "Al Noor" }
  const remind = (db: FakeAdminDb, invoiceId: string, at = NOW) => runSupplierAct(db as never, S, actSchema.parse({ action: "po.payremind", poId: "po1", invoiceId, amount: 1150, due: "2026-10-10", message: "تذكير" }) as Act, at)

  it("is logged on the order, posted in the conversation, and Finance and the owner hear it — once a day per invoice", async () => {
    const db = world()
    await remind(db, "i1")
    const log = (db.get("purchaseOrders/po1") as { log: { action: string; params: Doc }[] }).log
    expect(log).toEqual([expect.objectContaining({ action: "payment_reminded", params: { invoice: "INV-1", amount: 1150, date: "2026-10-10" } })])
    expect(db.get("supplierInvoices/i1")).toMatchObject({ reminders: [NOW.toISOString()] })
    expect(db.list("users/fin/notifications").map((n) => n.type)).toEqual(["po_payment_reminder"])
    expect(db.list("users/buyer/notifications").map((n) => n.type)).toContain("po_payment_reminder")
    expect(db.list("chats/o1/messages")).toEqual([expect.objectContaining({ text: "تذكير", senderId: "su" })])
    expect(await refusal(remind(db, "i1", new Date("2026-10-13T18:00:00Z")))).toBe("reminded_today")
    // Another invoice the same day, or the same one the next day, goes.
    await expect(remind(db, "i2")).resolves.toEqual({})
    await expect(remind(db, "i1", new Date("2026-10-14T06:00:00Z"))).resolves.toEqual({})
  })

  it("never on another company's invoice or one of another order", async () => {
    const db = world().seed("supplierInvoices/x", { poId: "po9", supplierOrgId: "sup", number: "X", amountNet: 1 })
    expect(await refusal(remind(db, "x"))).toBe("not_found")
    expect(await refusal(runSupplierAct(db as never, { ...S, orgId: "other" }, actSchema.parse({ action: "po.payremind", poId: "po1", invoiceId: "i1", amount: 1, due: "2026-10-10" }) as Act, NOW))).toBe("not_yours")
  })
})

function rawWorld(): RawWorld {
  return {
    today: "2026-10-13",
    myOrgId: "sup",
    rfqs: [],
    offers: [],
    pos: [],
    deliveries: [],
    invoices: [],
    transfers: [],
    warranties: [],
    chats: [],
    contractors: {},
    links: [],
    invitations: [],
    archived: {},
    seen: {},
    declined: {},
    myUid: "su",
    questions: {},
  } as unknown as RawWorld
}
