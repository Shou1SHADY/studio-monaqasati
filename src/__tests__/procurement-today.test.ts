/**
 * Procurement PRD 3.0 — Today (§7.2): the "needs your decision" queue, the
 * declared waits and the three numbers, derived from the world on every read.
 * Approvals only I can clear float to the top; red before amber before blue
 * inside a tier; the expediter chases and never sees an amount; the owner
 * gets what is routed to him and a view of the rest.
 */

import { TODAY_KEYS, todayKpis, todayTasks, todayWaits, type OfferFact, type ProcWorld, type RfqFact } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PoLine, type ProcActor, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"

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

describe("T5a/T5b · approvals — mine float to the top, everybody else's wait", () => {
  const small = po({ id: "s", status: "awaiting_approval", lines: [line({ quantity: 1, unitPrice: 3000 })], approverKind: "manager" })
  const big = po({ id: "b", status: "awaiting_approval", lines: [line({ quantity: 60, unitPrice: 2935 })] })
  const w = world({ orders: [small, big] })

  it("the manager approves the small one and sees the big one wait for the owner, with the honest reason", () => {
    const t = todayTasks(w, MANAGER, NOW)
    expect(t.map((x) => [x.kind, x.id])).toEqual([
      ["approve", "approve:s"],
      ["approval_wait", "approval_wait:b"],
    ])
    expect(t[0]).toMatchObject({ priority: 0, severity: "amber", group: "po", amount: 3000, subKey: "task.approve.sub", subParams: { preparer: "Sara", ago: 12 }, href: "/contractor/rfqs/orders?po=s", actionKey: "actions.review" })
    expect(t[1]).toMatchObject({ priority: 3, severity: "blue", subKey: "task.approval_wait.sub.above_limit", subParams: { value: 176100, limit: 150000 }, actionKey: "actions.view" })
  })

  it("the owner may approve both — including one he prepared", () => {
    expect(kinds(w, OWNER)).toEqual(["approve", "approve"])
    expect(kinds(world({ orders: [{ ...small, preparedById: "owner" }] }), OWNER)).toEqual(["approve"])
  })

  it("the preparer sees his own wait with 'own order'; a stranger with no permission sees nothing; the expediter never", () => {
    const t = todayTasks(w, BUYER, NOW)
    expect(t.map((x) => [x.kind, x.subKey])).toEqual([
      ["approval_wait", "task.approval_wait.sub.own_order"],
      ["approval_wait", "task.approval_wait.sub.own_order"],
    ])
    expect(kinds(w, { ...BUYER, uid: "someone", canPrepare: false })).toEqual([])
    expect(kinds(w, EXPEDITER)).toEqual([])
  })

  it("a blocked approval is demoted to blue and its subtitle is the first block, from the Procurement namespace", () => {
    const t = todayTasks(world({ orders: [small], supplierFacts: { sup1: { orgId: "sup1", hasVatNumber: false, verified: true, crExpiry: null } } }), MANAGER, NOW)[0]
    expect(t).toMatchObject({ kind: "approve", severity: "blue", subNs: "Procurement", subKey: "blocks.supplier_no_vat" })
  })
})

describe("T5c–T5e · send, not accepted, late — the chasing tasks", () => {
  it("approved not sent · sent and silent past the window · late with the open lines listed", () => {
    const w = world({
      orders: [
        po({ id: "a", status: "approved", approvedAt: "2026-09-20T08:00:00Z" }),
        po({ id: "b", status: "sent", sentAt: "2026-09-20T08:00:00Z" }),
        po({ id: "c", status: "sent", sentAt: "2026-09-21T08:00:00Z" }), // inside the window → a wait, not a task
        po({ id: "d", promisedDate: "2026-09-19", lines: [line({ accepted: 40 }), line({ id: "l2", name: "Mesh", unit: "pc", quantity: 10, accepted: 10 })] }),
      ],
    })
    const t = todayTasks(w, MANAGER, NOW)
    expect(t.map((x) => x.kind)).toEqual(["send", "late", "not_accepted"])
    expect(t[0]).toMatchObject({ priority: 1, severity: "amber", amount: 280000, actionKey: "actions.send", sortDays: -2 })
    expect(t[1]).toMatchObject({ priority: 2, severity: "red", titleParams: { number: "PO-2026/014", supplier: "Al-Hadid", days: 3 }, subParams: { lines: "Rebar 12 mm 60 t" }, amount: 60 * 2800, actionKey: "actions.updateDate" })
    expect(t[2]).toMatchObject({ priority: 2, severity: "amber", titleParams: { days: 2 } })
    expect(todayWaits(w, MANAGER, NOW).map((x) => [x.kind, x.id])).toEqual([["supplier_acceptance", "w_accept:c"]])
  })

  it("the expediter sees exactly these — and never an amount", () => {
    const w = world({
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
    const t = todayTasks(w, EXPEDITER, NOW)
    expect(t.map((x) => x.kind).sort()).toEqual(["late", "not_accepted", "notice_incoming", "send"])
    expect(t.every((x) => x.amount === null)).toBe(true)
    expect(todayKpis(w, EXPEDITER, NOW).tiles.every((k) => k.unit === "count")).toBe(true)
  })
})

describe("T5h/T5i/T10 · confirm before the date · rejected at the gate · rate", () => {
  it("a poor on-time supplier due within two days gets a pre-emptive confirm; a good one does not", () => {
    // Three earlier orders of the same supplier, two of them late → 33 % on time.
    const history = [
      po({ id: "h1", promisedDate: "2026-08-01", lines: [line({ accepted: 100 })] }),
      po({ id: "h2", promisedDate: "2026-08-01", lines: [line({ accepted: 100 })] }),
      po({ id: "h3", promisedDate: "2026-09-01", lines: [line({ accepted: 100 })] }),
    ]
    const receipts = [receipt({ id: "x1", poId: "h1", confirmedAt: "2026-08-05T08:00:00Z" }), receipt({ id: "x2", poId: "h2", confirmedAt: "2026-08-05T08:00:00Z" }), receipt({ id: "x3", poId: "h3", confirmedAt: "2026-08-30T08:00:00Z" })]
    const due = po({ id: "due", promisedDate: "2026-09-23" })
    const t = todayTasks(world({ orders: [...history, due], receipts }), MANAGER, NOW).filter((x) => x.kind === "confirm_before_date")
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ severity: "blue", titleParams: { inDays: 1 }, subParams: { percent: 50 }, amount: null }) // 2 late of 4 accepted (the due one counts, on time so far)
    // With no record at all: no task (null is not "poor").
    expect(kinds(world({ orders: [due] }), MANAGER)).toEqual([])
    // An expediter is not asked to confirm ahead.
    expect(kinds(world({ orders: [...history, due], receipts }), EXPEDITER)).toEqual([])
  })

  it("a rejected line with no decision is a priority-1 amber decision, carrying the reason code and the value", () => {
    const j = po({ id: "j", lines: [line({ accepted: 90, rejected: 10 })] })
    const w = world({ orders: [j], receipts: [receipt({ poId: "j", confirmedAt: "2026-09-20T08:00:00Z", lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 100, counted: 100, accepted: 90, rejected: 10, held: 0, rejectReason: "damaged" }] })] })
    const t = todayTasks(w, MANAGER, NOW)
    expect(t.map((x) => x.kind)).toEqual(["reject_decide"])
    expect(t[0]).toMatchObject({ priority: 1, severity: "amber", group: "delivery", titleParams: { qty: 10, unit: "t", name: "Rebar 12 mm" }, amount: 28000, reasonCode: "damaged", actionKey: "actions.decide" })
    expect(kinds(world({ orders: [{ ...j, lines: [line({ accepted: 90, rejected: 10, rejectDecision: "replace" })] }] }), MANAGER)).toEqual([])
    // The owner sees it too; the expediter does not.
    expect(kinds(w, OWNER)).toEqual(["reject_decide"])
    expect(kinds(w, EXPEDITER)).toEqual([])
  })

  it("fully received with a receipt → rate (blue, last); Finance's payment is a declared wait", () => {
    const done = po({ id: "r", lines: [line({ accepted: 100 })] })
    const w = world({ orders: [done], receipts: [receipt({ poId: "r", confirmedAt: "2026-09-20T08:00:00Z" })] })
    expect(todayTasks(w, MANAGER, NOW).map((x) => [x.kind, x.priority, x.severity])).toEqual([["rate", 3, "blue"]])
    expect(todayWaits(w, MANAGER, NOW).map((x) => [x.kind, x.module])).toEqual([["finance_payment", "finance"]])
    expect(kinds(w, EXPEDITER)).toEqual([])
  })
})

describe("T6/T8/T9/T11 · receipts and notices", () => {
  it("arrived today rolls up into one row; a pending notice is on the way, overdue when its date passed, flagged when dated after the promise", () => {
    const w = world({
      orders: [po()],
      receipts: [
        receipt({ id: "a" }),
        receipt({ id: "b", docNumber: "GR-2026/032" }),
        receipt({ id: "old", confirmedAt: "2026-09-20T08:00:00Z" }),
        receipt({ id: "n1", status: "pending_confirmation", deliveryDate: "2026-09-24", confirmedAt: null }),
        receipt({ id: "n2", status: "pending_confirmation", deliveryDate: "2026-09-20", confirmedAt: null }),
        receipt({ id: "n3", status: "pending_confirmation", deliveryDate: "2026-10-02", confirmedAt: null }),
      ],
    })
    const t = todayTasks(w, MANAGER, NOW)
    expect(t.map((x) => [x.kind, x.id])).toEqual([
      ["notice_overdue", "notice_overdue:n2"],
      ["notice_late_date", "notice_late_date:n3"],
      ["arrived_today", "arrived:2026-09-22"],
      ["notice_incoming", "notice:n1"],
    ])
    expect(t[0]).toMatchObject({ priority: 1, severity: "red", subParams: { number: "PO-2026/014", date: "2026-09-20", daysAgo: 2 }, href: "/contractor/goods-received?tab=incoming&delivery=n2", actionKey: "actions.open" })
    expect(t[1]).toMatchObject({ priority: 1, severity: "amber", titleParams: { supplier: "Al-Hadid", days: 2 }, subParams: { promised: "2026-09-30" } })
    expect(t[2]).toMatchObject({ titleParams: { count: 2 }, subParams: { list: "Al-Hadid GR-2026/031 · Al-Hadid GR-2026/032" }, href: "/contractor/goods-received?tab=log" })
    expect(t[3]).toMatchObject({ priority: 2, severity: "blue", titleParams: { inDays: 2, hasDate: 1 }, subParams: { lines: "Rebar 12 mm 50 t" } })
    // A receiver's button is "record receipt".
    expect(todayTasks(w, RECEIVER, NOW).find((x) => x.kind === "notice_incoming")?.actionKey).toBe("actions.receive")
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
    expect(t.map((x) => [x.kind, x.id, x.priority])).toEqual([["receipt_no_po", "nopo:m1", 3]])
    expect(kinds(w, EXPEDITER)).toEqual([])
  })
})

describe("T3/T4 · RFQ tasks", () => {
  it("draft · compare and award once closed with pending offers (red past the award cycle) · closed with nothing · closing soon and thin", () => {
    const w = world({
      rfqs: [
        rfq({ id: "draft", status: "Draft", deadline: null }),
        rfq({ id: "ready", deadline: "2026-09-21" }),
        rfq({ id: "stale", deadline: "2026-09-18" }),
        rfq({ id: "empty", deadline: "2026-09-20", offersCount: 0 }),
        rfq({ id: "thin", deadline: "2026-09-23", offersCount: 1 }),
        rfq({ id: "fine", deadline: "2026-09-23", offersCount: 3 }),
        rfq({ id: "awarded", status: "Awarded", deadline: "2026-09-01" }),
        rfq({ id: "openfar", deadline: "2026-10-10", offersCount: 0 }),
      ],
      offers: [offer({ id: "a", rfqId: "ready", price: "12,500" }), offer({ id: "b", rfqId: "ready", price: "11000" }), offer({ id: "c", rfqId: "ready", status: "مرفوض", price: "9000" }), offer({ id: "d", rfqId: "stale" }), offer({ id: "e", rfqId: "thin" }), offer({ id: "f", rfqId: "fine" }), offer({ id: "g", rfqId: "fine" }), offer({ id: "h", rfqId: "fine" })],
    })
    const t = todayTasks(w, MANAGER, NOW)
    expect(t.map((x) => [x.kind, x.id, x.severity])).toEqual([
      ["rfq_award", "rfq_award:stale", "red"],
      ["rfq_no_offers", "rfq_no_offers:empty", "red"],
      ["rfq_award", "rfq_award:ready", "amber"],
      ["rfq_closing_thin", "rfq_closing_thin:thin", "blue"],
      ["rfq_draft", "rfq_draft:draft", "blue"], // no deadline → sorts last among the blues
    ])
    const ready = t.find((x) => x.id === "rfq_award:ready")!
    expect(ready).toMatchObject({ group: "rfq", titleParams: { title: "Rebar for Tower A", count: 2 }, subParams: { ago: 1 }, amount: 11000, href: "/contractor/rfqs/ready/offers", actionKey: "actions.compare" })
    expect(t.find((x) => x.id === "rfq_closing_thin:thin")).toMatchObject({ titleParams: { inDays: 1, count: 1 } })
    // A buyer sees them; an expediter does not.
    expect(kinds(w, BUYER)).toHaveLength(5)
    expect(kinds(w, EXPEDITER)).toEqual([])
  })
})

describe("ordering — priority, then severity, then age", () => {
  it("a priority-0 blue approval outranks a priority-2 red late order; within a tier red first, then the oldest", () => {
    const w = world({
      orders: [
        po({ id: "late", promisedDate: "2026-09-19" }),
        po({ id: "appr", status: "awaiting_approval", lines: [line({ quantity: 1, unitPrice: 100 })] }),
        po({ id: "send_old", status: "approved", approvedAt: "2026-09-01T08:00:00Z" }),
        po({ id: "send_new", status: "approved", approvedAt: "2026-09-21T08:00:00Z" }),
        po({ id: "silent", status: "sent", sentAt: "2026-09-10T08:00:00Z" }),
      ],
      supplierFacts: { sup1: { orgId: "sup1", hasVatNumber: false, verified: true, crExpiry: null } },
    })
    expect(todayTasks(w, MANAGER, NOW).map((x) => x.id)).toEqual(["approve:appr", "send:send_old", "send:send_new", "late:late", "not_accepted:silent"])
  })
})

describe("waits — held quantities", () => {
  it("a held line waits on Inventory with its hold reason", () => {
    const w = world({ orders: [po({ lines: [line({ accepted: 90, held: 10 })] })], receipts: [receipt({ lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 100, counted: 100, accepted: 90, held: 10, holdReason: "certificate" }] })] })
    expect(todayWaits(w, MANAGER, NOW)).toMatchObject([{ kind: "held_inspection", module: "inventory", titleParams: { qty: 10, unit: "t", name: "Rebar 12 mm" }, reasonCode: "certificate" }])
  })
})

describe("KPIs — three per role", () => {
  const w = world({
    orders: [
      po({ id: "live1", lines: [line({ accepted: 40 })] }), // 60 × 2,800 = 168,000 open
      po({ id: "late1", promisedDate: "2026-09-19", lines: [line({ quantity: 10 })] }), // 28,000 open and late
      po({ id: "recv", lines: [line({ accepted: 100 })] }), // received: Finance will need 280,000
      po({ id: "sent", status: "sent", sentAt: "2026-09-21T08:00:00Z", lines: [line({ quantity: 1 })] }), // 2,800 open
      po({ id: "wait", status: "awaiting_approval", lines: [line({ quantity: 1, unitPrice: 500 })] }),
      po({ id: "prev", createdAt: "2026-08-01T08:00:00Z", status: "closed", lines: [line({ name: "Cement", unit: "bag", unitPrice: 2500, accepted: 100 })] }),
      po({ id: "drift", createdAt: "2026-09-15T08:00:00Z", lines: [line({ name: "Cement", unit: "bag", quantity: 10, unitPrice: 2750, accepted: 10 })] }), // received: 27,500; drift (2,750 − 2,500) × 10
    ],
    rfqs: [rfq()],
    offers: [offer()],
  })

  it("manager: needs (RFQs awaiting award without Manufacturing's requests) · committed with the late part · drift over 30 days", () => {
    const k = todayKpis(w, MANAGER, NOW)
    expect(k.kind).toBe("buyer")
    expect(k.tiles.map((t) => [t.id, t.value, t.unit])).toEqual([
      ["needs", 1, "count"],
      ["committed", 168000 + 28000 + 2800, "money"],
      ["drift", 2500, "money"],
    ])
    expect(k.tiles[1]).toMatchObject({ noteKey: "kpi.committed.note_late", noteParams: { amount: 28000, count: 1 }, tone: "bad" })
    // The rebar orders repeat one price: zero drift, but they widen the base (2,500 over 587,800).
    expect(k.tiles[2]).toMatchObject({ noteKey: "kpi.drift.note_up", noteParams: { percent: 0.43 }, tone: "warn" })
    // With Manufacturing's requests loaded, the first tile counts the open ones.
    const k2 = todayKpis({ ...w, mfgPurchaseRequests: [{ id: "a", status: "sent" }, { id: "b", status: "ordered" }, { id: "c", status: "sent" }] }, MANAGER, NOW)
    expect(k2.tiles[0]).toMatchObject({ id: "needs", value: 2, labelKey: "kpi.needs.label_requests", href: "/contractor/rfqs/requests" })
  })

  it("owner: awaiting my approval · what Finance will need · late orders", () => {
    const k = todayKpis(w, OWNER, NOW)
    expect(k.kind).toBe("owner")
    expect(k.tiles.map((t) => [t.id, t.value])).toEqual([
      ["my_approval", 500],
      ["finance_due", 307500],
      ["late", 1],
    ])
    expect(k.tiles[0]).toMatchObject({ noteKey: "kpi.my_approval.note_some", noteParams: { count: 1 } })
    expect(k.tiles[2]).toMatchObject({ noteKey: "kpi.late.note_value", noteParams: { amount: 28000 } })
  })

  it("expediter: counts only — with suppliers · late · sent not accepted", () => {
    const k = todayKpis(w, EXPEDITER, NOW)
    expect(k.kind).toBe("expediter")
    expect(k.tiles.map((t) => [t.id, t.value, t.unit])).toEqual([
      ["with_suppliers", 2, "count"],
      ["late", 1, "count"],
      ["sent_not_accepted", 1, "count"],
    ])
  })
})

describe("TODAY_KEYS — every key the queue and the tiles emit is declared", () => {
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
      }
      for (const x of todayWaits(w, a, NOW)) {
        used.add(x.titleKey)
        used.add(x.subKey)
      }
      for (const k of todayKpis(w, a, NOW).tiles) {
        used.add(k.labelKey)
        used.add(k.noteKey)
      }
    }
    expect([...used].filter((k) => !declared.has(k))).toEqual([])
    expect(used.size).toBeGreaterThan(40)
  })
})
