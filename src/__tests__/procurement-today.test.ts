/**
 * Procurement 2.0 — Today (TDY-02, R-24): the "needs your decision" queue and the declared waits, derived from the world on every
 * read. RED first, then the nearest date; an order's row says what its next-step sentence says; the expediter chases and never
 * sees an amount; the owner gets what is routed to him and a view of the rest. (The new rows — RFQ states, far requests, the
 * escalation, the route strip — are in procurement-v2-today.test.ts; the three numbers in procurement-v2-kpis.test.ts.)
 */

import { TODAY_KEYS, chipCounts, todayTasks, todayWaits, type OfferFact, type ProcWorld, type RfqFact } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PoLine, type ProcActor, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"
import { AGREEMENT_EXPIRY_WINDOW_DAYS, type PriceAgreement } from "@/lib/procurement/prices"

const NOW = new Date("2026-09-22T08:00:00Z")

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Rebar 12 mm", unit: "t", quantity: 100, unitPrice: 2800, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po1",
  organizationId: "org",
  docNumber: "PO-2026/014",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "Rebar",
  offerId: "o1",
  projectId: "p1",
  supplierOrgId: "sup1",
  supplierUserId: null,
  supplierName: "Al-Hadid",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 280000,
  vatRate: 0.15,
  offersCount: 3,
  lowestOfferTotal: 280000,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: "buyer",
  preparedByName: "Sara",
  createdAt: "2026-09-10T08:00:00Z",
  approverKind: "owner",
  supplierAcceptedAt: "2026-09-12T08:00:00Z",
  promisedDate: "2026-09-30",
  log: [],
  ...over,
})

const receipt = (over: Partial<ReceiptFact> = {}): ReceiptFact => ({ id: "d1", status: "confirmed", poId: "po1", poNumber: "PO-2026/014", docNumber: "GR-2026/031", supplierName: "Al-Hadid", confirmedAt: "2026-09-22T06:00:00Z", deliveryDate: "2026-09-22", lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 50, counted: 50, accepted: 50, rejected: 0, held: 0 }], ...over })

const rfq = (over: Partial<RfqFact> = {}): RfqFact => ({ id: "r1", status: "New", deadline: "2026-09-20", title: "Rebar for Tower A", offersCount: 2, ...over })
const offer = (over: Partial<OfferFact> = {}): OfferFact => ({ id: "o1", rfqId: "r1", status: "قيد المراجعة", price: "12,500", ...over })

const world = (over: Partial<ProcWorld> = {}): ProcWorld => ({ orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, ...over })

const MANAGER: ProcActor = { uid: "mgr", name: "Manager", isOwner: false, canApprove: true, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
const BUYER: ProcActor = { uid: "buyer", name: "Sara", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
const OWNER: ProcActor = { uid: "owner", name: "Owner", isOwner: true, canApprove: true, canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true }
const EXPEDITER: ProcActor = { uid: "exp", name: "Exp", isOwner: false, canApprove: false, canPrepare: false, canExpedite: true, canReceive: false, seesPrices: false }
const RECEIVER: ProcActor = { uid: "rcv", name: "Store", isOwner: false, canApprove: false, canPrepare: false, canExpedite: false, canReceive: true, seesPrices: false }

const kinds = (w: ProcWorld, a: ProcActor) => todayTasks(w, a, NOW).map((t) => t.kind)

describe("appr · approvals — mine are rows, everybody else's wait on the approver", () => {
  const small = po({ id: "s", status: "awaiting_approval", lines: [line({ quantity: 1, unitPrice: 3000 })], approverKind: "manager" })
  const big = po({ id: "b", status: "awaiting_approval", lines: [line({ quantity: 60, unitPrice: 2935 })] })
  const w = world({ orders: [small, big] })

  it("the manager approves the small one and sees the big one wait for the owner, with the honest reason", () => {
    const t = todayTasks(w, MANAGER, NOW)
    expect(t.map((x) => [x.kind, x.id])).toEqual([["approve", "approve:s"]])
    expect(t[0]).toMatchObject({
      chip: "po",
      tier: "normal",
      severity: "blue",
      due: 0,
      amount: 3450,
      basis: "incl",
      subNs: "ProcOrders",
      subKey: "step.appr",
      step: { state: { k: "appr" } },
      href: "/contractor/rfqs/orders?po=s",
      actionKey: "actions.approvePo",
    })
    expect(todayWaits(w, MANAGER, NOW).filter((x) => x.kind === "approval_wait")).toMatchObject([{ id: "w_approval:b", module: "approver", subKey: "task.approval_wait.sub.above_limit", subParams: { value: 202515, limit: 150000 } }])
  })

  it("the owner may approve both — including one he prepared", () => {
    expect(kinds(w, OWNER)).toEqual(["approve", "approve"])
    expect(kinds(world({ orders: [{ ...small, preparedById: "owner" }] }), OWNER)).toEqual(["approve"])
  })

  it("the preparer sees his own order wait (own order); a stranger with no permission sees nothing; the expediter never", () => {
    expect(kinds(w, BUYER)).toEqual([])
    expect(todayWaits(w, BUYER, NOW).filter((x) => x.kind === "approval_wait").map((x) => x.subKey)).toEqual(["task.approval_wait.sub.own_order", "task.approval_wait.sub.own_order"])
    expect(kinds(w, { ...BUYER, uid: "someone", canPrepare: false })).toEqual([])
    expect(todayWaits(w, { ...BUYER, uid: "someone", canPrepare: false }, NOW).filter((x) => x.kind === "approval_wait")).toEqual([])
    expect(kinds(w, EXPEDITER)).toEqual([])
    expect(todayWaits(w, EXPEDITER, NOW).filter((x) => x.kind === "approval_wait")).toEqual([])
  })

  it("a blocked approval says why in place of the step sentence, from the Procurement namespace", () => {
    const t = todayTasks(world({ orders: [small], supplierFacts: { sup1: { orgId: "sup1", hasVatNumber: true, verified: false, crExpiry: null } } }), MANAGER, NOW)[0]
    expect(t).toMatchObject({ kind: "approve", severity: "blue", subNs: "Procurement", subKey: "blocks.supplier_unverified" })
    expect(t.step).toBeUndefined()
    // No VAT number is optional (Supplier 1.0 B-11): the approval keeps its step sentence.
    const noVat = todayTasks(world({ orders: [small], supplierFacts: { sup1: { orgId: "sup1", hasVatNumber: false, verified: true, crExpiry: null } } }), MANAGER, NOW)[0]
    expect(noVat).toMatchObject({ kind: "approve", subKey: "step.appr" })
  })

  it("an order sent back to its preparer is HIS row — the approvers no longer see «اعتمده» on it", () => {
    const returned = po({ id: "ret", status: "awaiting_approval", returnedReason: "price", lines: [line({ quantity: 1, unitPrice: 3000 })] })
    expect(kinds(world({ orders: [returned] }), BUYER)).toEqual(["returned"])
    expect(kinds(world({ orders: [returned] }), MANAGER)).toEqual(["returned"])
    expect(todayTasks(world({ orders: [returned] }), BUYER, NOW)[0]).toMatchObject({ actionKey: "actions.resubmit", severity: "amber" })
    expect(kinds(world({ orders: [returned] }), EXPEDITER)).toEqual([])
  })
})

describe("send · not accepted · late — the chasing rows, red first", () => {
  const w = world({
    orders: [
      po({ id: "a", status: "approved", approvedAt: "2026-09-20T08:00:00Z" }),
      po({ id: "b", status: "sent", sentAt: "2026-09-20T08:00:00Z" }),
      po({ id: "c", status: "sent", sentAt: "2026-09-22T06:00:00Z" }), // inside the one-day window → a wait, not a row
      po({ id: "d", promisedDate: "2026-09-19", lines: [line({ accepted: 40 }), line({ id: "l2", name: "Mesh", unit: "pc", quantity: 10, accepted: 10 })] }),
    ],
  })

  it("late is red and first; then by date: approved-not-sent, then sent-and-silent", () => {
    const t = todayTasks(w, MANAGER, NOW)
    expect(t.map((x) => x.kind)).toEqual(["late", "send", "not_accepted"])
    expect(t[0]).toMatchObject({ tier: "red", severity: "red", due: -3, amount: 193200, basis: "incl", subKey: "task.late.sub_part", subParams: { days: 3, lines: "Rebar 12 mm 60 t" }, actionKey: "actions.remindSupplier" })
    expect(t[1]).toMatchObject({ severity: "amber", due: -2, amount: 322000, actionKey: "actions.send", href: "/contractor/rfqs/orders?po=a&act=send" })
    expect(t[2]).toMatchObject({ severity: "amber", subKey: "step.nacc", step: { params: { days: 2 } }, actionKey: "actions.remindSupplier" })
    expect(todayWaits(w, MANAGER, NOW).filter((x) => x.module === "supplier").map((x) => x.id)).toEqual(["w_po:b", "w_po:c", "w_po:d"])
  })

  it("a late order the supplier never notified reads as its step sentence: «المورد متأخر … ولم يُشعر بالتسليم»", () => {
    const t = todayTasks(world({ orders: [po({ promisedDate: "2026-09-16" })] }), MANAGER, NOW)
    expect(t).toMatchObject([{ kind: "late", tier: "red", due: -6, subKey: "step.late", step: { state: { k: "late" }, params: { days: 6 } }, actionKey: "actions.remindSupplier" }])
  })

  it("the expediter sees exactly the chasing rows — and never an amount", () => {
    const x = world({
      orders: [
        po({ id: "a", status: "approved" }),
        po({ id: "b", status: "sent", sentAt: "2026-09-15T08:00:00Z" }),
        po({ id: "d", promisedDate: "2026-09-19" }),
        po({ id: "w", status: "awaiting_approval" }),
        po({ id: "r", lines: [line({ accepted: 100 })] }),
        po({ id: "j", lines: [line({ accepted: 90, rejected: 10 })] }),
      ],
      receipts: [receipt({ id: "n", status: "pending_confirmation", deliveryDate: "2026-09-24" }), receipt({ id: "today" })],
      rfqs: [rfq({ status: "Draft" })],
    })
    const t = todayTasks(x, EXPEDITER, NOW)
    expect(t.map((r) => r.kind).sort()).toEqual(["late", "not_accepted", "notice_forward", "send"])
    expect(t.every((r) => r.amount === null && r.basis === null)).toBe(true)
  })
})

describe("confirm before the date · rejected at the gate · rate", () => {
  it("a poor on-time supplier due within two days gets a pre-emptive confirm; a good one does not", () => {
    // Three earlier orders of the same supplier, two of them late → 33 % on time.
    const history = [
      po({ id: "h1", promisedDate: "2026-08-01", lines: [line({ accepted: 100 })] }),
      po({ id: "h2", promisedDate: "2026-08-01", lines: [line({ accepted: 100 })] }),
      po({ id: "h3", promisedDate: "2026-09-01", lines: [line({ accepted: 100 })] }),
    ]
    // On time is judged by the day delivered — the notice's date (PUR-07), here the same as the receipt's.
    const receipts = [receipt({ id: "x1", poId: "h1", confirmedAt: "2026-08-05T08:00:00Z", deliveryDate: "2026-08-05" }), receipt({ id: "x2", poId: "h2", confirmedAt: "2026-08-05T08:00:00Z", deliveryDate: "2026-08-05" }), receipt({ id: "x3", poId: "h3", confirmedAt: "2026-08-30T08:00:00Z", deliveryDate: "2026-08-30" })]
    const due = po({ id: "due", promisedDate: "2026-09-23" })
    const t = todayTasks(world({ orders: [...history, due], receipts }), MANAGER, NOW).filter((x) => x.kind === "confirm_before_date")
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ severity: "blue", due: 1, titleParams: { inDays: 1 }, subParams: { percent: 33 }, amount: null }) // 2 late of the 3 with a verdict (the due one is not judged yet)
    // With no record at all: no row (null is not "poor").
    expect(kinds(world({ orders: [due] }), MANAGER)).toEqual([])
    // An expediter is not asked to confirm ahead.
    expect(kinds(world({ orders: [...history, due], receipts }), EXPEDITER)).toEqual([])
  })

  it("a rejected line with no decision is a RED row, carrying the reason code and the value; «اطلب استبدالاً»", () => {
    const j = po({ id: "j", lines: [line({ accepted: 90, rejected: 10 })] })
    const w = world({ orders: [j], receipts: [receipt({ poId: "j", confirmedAt: "2026-09-20T08:00:00Z", lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 100, counted: 100, accepted: 90, rejected: 10, held: 0, rejectReason: "damaged" }] })] })
    const t = todayTasks(w, MANAGER, NOW)
    expect(t.map((x) => x.kind)).toEqual(["reject_decide"])
    expect(t[0]).toMatchObject({ chip: "po", tier: "red", severity: "red", titleParams: { number: "PO-2026/014", supplier: "Al-Hadid" }, subKey: "task.reject_decide.sub", subParams: { qty: 10, unit: "t", name: "Rebar 12 mm" }, amount: 32200, basis: "incl", reasonCode: "damaged", actionKey: "actions.askReplace" })
    expect(kinds(world({ orders: [{ ...j, lines: [line({ accepted: 90, rejected: 10, rejectDecision: "replace" })] }] }), MANAGER)).toEqual([])
    // The owner sees it too; the expediter does not.
    expect(kinds(w, OWNER)).toEqual(["reject_decide"])
    expect(kinds(w, EXPEDITER)).toEqual([])
  })

  it("fully received with a receipt → rate (blue); Finance's payment is a declared wait on «المالية»", () => {
    const done = po({ id: "r", lines: [line({ accepted: 100 })] })
    const w = world({ orders: [done], receipts: [receipt({ poId: "r", confirmedAt: "2026-09-20T08:00:00Z" })] })
    expect(todayTasks(w, MANAGER, NOW).map((x) => [x.kind, x.severity])).toEqual([["rate", "blue"]])
    expect(todayWaits(w, MANAGER, NOW).map((x) => [x.kind, x.module, x.subKey])).toEqual([["po_step", "finance", "step.unpaid"]])
    expect(kinds(w, EXPEDITER)).toEqual([])
  })
})

describe("receipts and notices", () => {
  it("arrived today rolls up into one row; a notice dated after the promise is flagged; one on its way is no decision", () => {
    const w = world({
      orders: [po()],
      receipts: [
        receipt({ id: "a" }),
        receipt({ id: "b", docNumber: "GR-2026/032" }),
        receipt({ id: "old", confirmedAt: "2026-09-20T08:00:00Z" }),
        receipt({ id: "n1", status: "pending_confirmation", deliveryDate: "2026-09-24", confirmedAt: null, forwardedTo: { name: "ماجد" } }),
        receipt({ id: "n3", status: "pending_confirmation", deliveryDate: "2026-10-02", confirmedAt: null, forwardedTo: { name: "ماجد" } }),
      ],
    })
    const t = todayTasks(w, MANAGER, NOW)
    expect(t.map((x) => [x.kind, x.id, x.chip])).toEqual([
      ["arrived_today", "arrived:2026-09-22", "rcv"],
      ["notice_late_date", "notice_late_date:n3", "rcv"],
    ])
    expect(t[0]).toMatchObject({ titleParams: { count: 2 }, subKey: "task.arrived_today.sub_flags", subParams: { list: "Al-Hadid GR-2026/031 · Al-Hadid GR-2026/032", rejects: 0 }, href: "/contractor/goods-received?tab=recs" })
    expect(t[1]).toMatchObject({ severity: "amber", due: 10, titleParams: { supplier: "Al-Hadid", days: 2 }, subParams: { promised: "2026-09-30" }, href: "/contractor/goods-received?delivery=n3", actionKey: "actions.openNotice" })
    // The late-date row is for those who see the order's money (the prototype's `see`).
    expect(todayTasks(w, RECEIVER, NOW).map((x) => x.kind)).toEqual([])
  })

  it("a manual receipt with no order is informational and ages out after 30 days; one tied to a legacy award is not one", () => {
    const w = world({
      receipts: [
        receipt({ id: "m1", source: "manual", poId: null, poNumber: null, confirmedAt: "2026-09-15T08:00:00Z" }),
        receipt({ id: "m2", source: "manual", poId: null, poNumber: null, confirmedAt: "2026-07-01T08:00:00Z" }),
        receipt({ id: "m3", source: "manual", poId: null, poNumber: null, offerId: "legacy", confirmedAt: "2026-09-15T08:00:00Z" }),
      ],
    })
    const t = todayTasks(w, MANAGER, NOW)
    expect(t.map((x) => [x.kind, x.id, x.chip, x.severity])).toEqual([["receipt_no_po", "nopo:m1", "rcv", "amber"]])
    expect(kinds(w, EXPEDITER)).toEqual([])
  })
})

describe("waits — held quantities", () => {
  it("a held line waits on Inventory with its hold reason", () => {
    const w = world({ orders: [po({ lines: [line({ accepted: 90, held: 10 })] })], receipts: [receipt({ lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 100, counted: 100, accepted: 90, held: 10, holdReason: "certificate" }] })] })
    expect(todayWaits(w, MANAGER, NOW).filter((x) => x.kind === "held_inspection")).toMatchObject([{ module: "inventory", titleParams: { qty: 10, unit: "t", name: "Rebar 12 mm" }, reasonCode: "certificate" }])
  })
})

describe("SS4 `AGR` · an agreement about to end", () => {
  const agreement = (over: Partial<PriceAgreement> = {}): PriceAgreement =>
    ({
      id: "a1",
      organizationId: "org",
      docNumber: "AG-2026/003",
      supplierOrgId: "sup1",
      supplierName: "الراجحي",
      from: "2026-01-01",
      until: "2026-09-28",
      lines: [{ name: "حديد 12مم", unit: "طن", price: 2780 }],
      preparedById: "mgr",
      preparedByName: "Manager",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...over,
    }) as PriceAgreement

  const day = (n: number) => {
    const d = new Date("2026-09-22T00:00:00Z")
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }

  it("reaches the queue inside the renewal window, with the number and what it covers", () => {
    const t = todayTasks(world({ agreements: [agreement()] }), MANAGER, NOW)
    const task = t.find((x) => x.kind === "agreement_expiring")
    expect(task).toMatchObject({ severity: "blue", chip: "po", due: 6, titleParams: { supplier: "الراجحي", inDays: 6 }, subParams: { number: "AG-2026/003", materials: 1 }, amount: null })
    expect(task?.href).toContain("segment=agreements")
  })

  it("stays quiet while it is not near its end, and once it is over", () => {
    expect(kinds(world({ agreements: [agreement({ until: day(AGREEMENT_EXPIRY_WINDOW_DAYS + 1) })] }), MANAGER)).not.toContain("agreement_expiring")
    expect(kinds(world({ agreements: [agreement({ until: day(-1) })] }), MANAGER)).not.toContain("agreement_expiring")
  })

  it("is shown to whoever could renew it, and to nobody else", () => {
    const w = world({ agreements: [agreement()] })
    expect(kinds(w, OWNER)).toContain("agreement_expiring")
    // P-24: the manager renews; a buyer does not.
    expect(kinds(w, BUYER)).not.toContain("agreement_expiring")
    // The expediter chases dates and the store receives; neither signs a price.
    expect(kinds(w, EXPEDITER)).not.toContain("agreement_expiring")
    expect(kinds(w, RECEIVER)).not.toContain("agreement_expiring")
  })

  it("says nothing when the screen loaded no agreements at all", () => {
    expect(kinds(world({}), MANAGER)).not.toContain("agreement_expiring")
  })
})

describe("fwd · a notice nobody has been told to receive", () => {
  const pending = (over: Partial<ReceiptFact> = {}) => receipt({ id: "n1", status: "pending_confirmation", confirmedAt: null, deliveryDate: "2026-09-23", ...over })
  const fwd = (over: Partial<ReceiptFact>, policies = DEFAULT_POLICIES) => todayTasks({ ...world({ orders: [po()], receipts: [pending(over)] }), policies }, MANAGER, NOW).find((t) => t.kind === "notice_forward")

  it("the chaser gets «حوّل للمستلم»: red when the forward window has closed, amber while it is open — and it leads to the forward dialog", () => {
    // The auto-forward runs one day before the delivery (policy): tomorrow's delivery is due now.
    expect(fwd({})).toMatchObject({ chip: "rcv", severity: "red", due: 0, titleParams: { number: "PO-2026/014", supplier: "Al-Hadid" }, actionKey: "actions.forward", href: "/contractor/goods-received?delivery=n1&forward=1" })
    expect(fwd({ deliveryDate: "2026-09-22" })).toMatchObject({ severity: "red", due: -1 })
    expect(fwd({ deliveryDate: "2026-09-30" })).toMatchObject({ severity: "amber", due: 7 })
    expect(fwd({ forwardedTo: { name: "ماجد" } })).toBeUndefined()
  })

  it("carries the place the goods land in and the register's receiver — or says there is none", () => {
    const w = (facts: Record<string, { place: string | null; receiver: string | null }>) => todayTasks({ ...world({ orders: [po()], receipts: [pending()] }), forwardFacts: facts }, MANAGER, NOW).find((t) => t.kind === "notice_forward")
    expect(w({ n1: { place: "المستودع الرئيسي", receiver: "ماجد" } })?.subParams).toMatchObject({ place: "المستودع الرئيسي", hasPlace: 1, receiver: "ماجد", hasReceiver: 1, noReceiver: 0 })
    expect(w({ n1: { place: "فيلا الملقا", receiver: null } })?.subParams).toMatchObject({ hasReceiver: 0, noReceiver: 1 })
  })

  it("a notice somebody was told about is no row — nor one nobody was told about, for a viewer who does not chase", () => {
    const noChase = (w: ProcWorld) => todayTasks(w, { ...MANAGER, canExpedite: false }, NOW).filter((t) => t.chip === "rcv")
    expect(noChase(world({ orders: [po()], receipts: [pending({ forwardedTo: { name: "ماجد" } })] }))).toEqual([])
    expect(noChase(world({ orders: [po()], receipts: [pending({ receiverReport: { signedAt: "2026-09-22T06:00:00Z" } })] }))).toEqual([])
    expect(noChase(world({ orders: [po()], receipts: [pending()] }))).toEqual([])
  })

  it("honours a wider window from the policy", () => {
    expect(fwd({ deliveryDate: "2026-09-27" }, { ...DEFAULT_POLICIES, forwardWindowDays: 7 })).toMatchObject({ severity: "red", due: -2 })
  })
})

describe("chips", () => {
  it("every row sits in exactly one chip and the counts add up", () => {
    const w = world({
      orders: [po({ id: "a", status: "awaiting_approval", lines: [line({ quantity: 1, unitPrice: 100 })] }), po({ id: "late", promisedDate: "2026-09-19" })],
      receipts: [receipt({ id: "n", status: "pending_confirmation", deliveryDate: "2026-09-24", poId: "elsewhere" })],
      rfqs: [rfq({ id: "x", status: "Draft" })],
    })
    const t = todayTasks(w, MANAGER, NOW)
    const c = chipCounts(t)
    expect(c.all).toBe(t.length)
    expect(c.req + c.rfq + c.po + c.rcv).toBe(c.all)
    expect(c).toMatchObject({ rfq: 1, po: 2, rcv: 1 })
  })
})

describe("TODAY_KEYS — every key the queue emits is declared", () => {
  it("emitted keys ⊆ TODAY_KEYS", () => {
    const w = world({
      orders: [
        po({ id: "a", status: "awaiting_approval", lines: [line({ quantity: 1, unitPrice: 100 })] }),
        po({ id: "b", status: "awaiting_approval", lines: [line({ quantity: 60, unitPrice: 2935 })] }),
        po({ id: "c", status: "approved" }),
        po({ id: "d", status: "sent", sentAt: "2026-09-10T08:00:00Z" }),
        po({ id: "e", status: "sent", sentAt: "2026-09-21T08:00:00Z" }),
        po({ id: "f", promisedDate: "2026-09-19" }),
        po({ id: "g", lines: [line({ accepted: 90, rejected: 5, held: 5 })] }),
        po({ id: "h", lines: [line({ accepted: 100 })] }),
      ],
      receipts: [receipt({ poId: "h", confirmedAt: "2026-09-20T08:00:00Z" }), receipt({ id: "t" }), receipt({ id: "n", status: "pending_confirmation", deliveryDate: "2026-09-25" }), receipt({ id: "o", status: "pending_confirmation", deliveryDate: "2026-09-15" }), receipt({ id: "m", source: "manual", poId: null })],
      rfqs: [rfq({ id: "x", status: "Draft" }), rfq({ id: "y" }), rfq({ id: "z", deadline: "2026-09-10", offersCount: 0 }), rfq({ id: "q", deadline: "2026-09-23", offersCount: 0 })],
      offers: [offer({ rfqId: "y" })],
    })
    const declared = new Set<string>(TODAY_KEYS)
    const used = new Set<string>()
    for (const a of [MANAGER, BUYER, OWNER, EXPEDITER]) {
      for (const t of todayTasks(w, a, NOW)) {
        used.add(t.titleKey)
        if (t.subNs === "ProcToday") used.add(t.subKey)
        used.add(t.actionKey)
        if (t.secondary) used.add(t.secondary.actionKey)
      }
      for (const x of todayWaits(w, a, NOW)) {
        used.add(x.titleKey)
        if (!x.step) used.add(x.subKey)
      }
    }
    expect([...used].filter((k) => !declared.has(k))).toEqual([])
    expect(used.size).toBeGreaterThan(15)
  })
})
