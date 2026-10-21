/**
 * Procurement 1.5 — closing the gaps in the order and its money (PUR-07, PUR-10):
 * nothing in a company WITHOUT Finance speaks of Finance or waits on it, a fully
 * received order closes there by hand, an advance marked paid clears everywhere,
 * and one lateness number reads the same on every screen.
 */

import { honestDate, inSegment, segmentCounts } from "@/components/procurement/PoModel"
import { deliveryPerformance } from "@/lib/procurement/reports"
import { advanceState, asX, docTrail, type PurchaseOrderX } from "@/lib/procurement/po-extras"
import { payMarkOf } from "@/lib/supplier-free/derive"
import { workQueueCounts } from "@/lib/procurement/shell"
import { NO_SITE, inSiteFilter, openRequestsBySite, orderSiteIds } from "@/lib/procurement/site-counts"
import { spendByProject } from "@/lib/procurement/reports"
import { TODAY_KEYS, todayKpis, todayTasks, todayWaits, type ProcWorld, type TodayActor } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PoLine, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"

const NOW = new Date("2026-10-19T09:00:00Z")

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (over: Partial<PurchaseOrderX> = {}): PurchaseOrder =>
  ({
    id: "po1",
    organizationId: "org",
    docNumber: "PO-2026/001",
    status: "accepted",
    basis: "rfq",
    rfqId: "r1",
    rfqTitle: "حديد",
    offerId: "o1",
    supplierOrgId: "sup1",
    supplierUserId: null,
    supplierName: "مصنع الجودة",
    isGuestSupplier: false,
    lines: [line()],
    totalExVat: 30000,
    vatRate: 0.15,
    offersCount: 2,
    lowestOfferTotal: 30000,
    shortCompetition: false,
    noOfficialQuote: false,
    preparedById: "buyer",
    preparedByName: "سارة",
    createdAt: "2026-09-10T08:00:00Z",
    approverKind: "manager",
    approvedAt: "2026-09-11T08:00:00Z",
    supplierAcceptedAt: "2026-09-12T08:00:00Z",
    promisedDate: "2026-09-24",
    log: [],
    ...over,
  }) as PurchaseOrder
const received = (over: Partial<PurchaseOrderX> = {}) => po({ lines: [line({ accepted: 10 })], ...over })
const notice = (over: Partial<ReceiptFact> = {}): ReceiptFact => ({ id: "d1", status: "pending_confirmation", poId: "po1", poNumber: "PO-2026/001", supplierName: "مصنع الجودة", deliveryDate: "2026-09-24", lines: [], ...over })
const world = (over: Partial<ProcWorld> = {}): ProcWorld => ({ orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, ...over })

const OWNER: TodayActor = { uid: "owner", name: "O", isOwner: true, canApprove: true, canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true }
const MANAGER: TodayActor = { uid: "mgr", name: "M", isOwner: false, canApprove: true, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
const BUYER: TodayActor = { uid: "buyer", name: "B", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }

const kinds = (w: ProcWorld, a: TodayActor) => todayTasks(w, a, NOW).map((t) => t.kind)

describe("F1 · without Finance nothing waits on Finance and no text names it", () => {
  const order = received()

  it("a fully received order waits on «سداد وإقفال» only where Finance is in the package", () => {
    expect(todayWaits(world({ orders: [order] }), MANAGER, NOW).map((x) => x.kind)).toContain("finance_payment")
    expect(todayWaits(world({ orders: [order], financeOn: true }), MANAGER, NOW).map((x) => x.kind)).toContain("finance_payment")
    expect(todayWaits(world({ orders: [order], financeOn: false }), MANAGER, NOW).map((x) => x.kind)).not.toContain("finance_payment")
  })

  it("an advance with Finance waits on Finance; without it the wait is gone", () => {
    const advance = po({ advancePercent: 30 })
    expect(todayWaits(world({ orders: [advance], financeOn: true }), MANAGER, NOW).map((x) => x.kind)).toContain("supplier_advance")
    expect(todayWaits(world({ orders: [advance], financeOn: false }), MANAGER, NOW).map((x) => x.kind)).not.toContain("supplier_advance")
  })

  it("a held invoice is Finance's: neither a wait nor a task without Finance", () => {
    const held = po({ financeHolds: [{ id: "h1", invoiceNo: "INV-1", amount: 100, reason: "dup", text: "x", need: "", at: "2026-10-01T08:00:00Z", byName: "F", state: "open" }] })
    expect(todayWaits(world({ orders: [held], financeOn: true }), MANAGER, NOW).map((x) => x.kind)).toContain("invoice_hold")
    expect(todayWaits(world({ orders: [held], financeOn: false }), MANAGER, NOW).map((x) => x.kind)).not.toContain("invoice_hold")
    const procHold = po({ financeHolds: [{ id: "h1", invoiceNo: "INV-1", amount: 100, reason: "nopo", text: "x", need: "", at: "2026-10-01T08:00:00Z", byName: "F", state: "open" }] })
    expect(kinds(world({ orders: [procHold], financeOn: true }), MANAGER)).toContain("finance_hold")
    expect(kinds(world({ orders: [procHold], financeOn: false }), MANAGER)).not.toContain("finance_hold")
  })

  it("the «أرسِله» task does not say the order reached Finance", () => {
    const approved = po({ status: "approved", approvedAt: "2026-10-18T08:00:00Z" })
    const t = (financeOn: boolean) => todayTasks(world({ orders: [approved], financeOn }), MANAGER, NOW).find((x) => x.kind === "send")
    expect(t(true)?.titleKey).toBe("task.send.title")
    expect(t(false)?.titleKey).toBe("task.send.title_nofin")
  })

  it("every key the new rows emit is declared", () => {
    expect(TODAY_KEYS).toEqual(expect.arrayContaining(["task.send.title_nofin", "task.close_received.title", "task.close_received.sub", "task.advance_unpaid.title", "task.advance_unpaid.sub", "actions.closeOrder"]))
  })

  it("the document trail drops Finance's steps", () => {
    const withFin = docTrail(asX(received({ advancePercent: 20 })), [], true).map((s) => s.key)
    const noFin = docTrail(asX(received({ advancePercent: 20 })), [], false).map((s) => s.key)
    expect(withFin).toEqual(expect.arrayContaining(["finance", "advance", "invoice"]))
    expect(noFin).not.toContain("finance")
    expect(noFin).not.toContain("invoice")
    expect(noFin).toContain("advance")
  })
})

describe("F2 · a received order is closed here when Finance is off", () => {
  it("Today asks the owner and the approvers to close it, with the payment status never in the way", () => {
    const order = received({ paymentMark: { state: "unpaid", day: "2026-10-10", byName: "O", at: "x" } } as Partial<PurchaseOrderX>)
    const off = world({ orders: [order], financeOn: false })
    expect(kinds(off, OWNER)).toContain("close_received")
    expect(kinds(off, MANAGER)).toContain("close_received")
    expect(kinds(off, BUYER)).not.toContain("close_received")
    expect(kinds(world({ orders: [order], financeOn: true }), MANAGER)).not.toContain("close_received")
    expect(todayTasks(off, MANAGER, NOW).find((x) => x.kind === "close_received")).toMatchObject({ href: "/contractor/rfqs/orders?po=po1", actionKey: "actions.closeOrder", titleKey: "task.close_received.title" })
  })

  it("a closed order is no longer asked for", () => {
    const closed = received({ status: "closed", closedAt: "2026-10-18T08:00:00Z" })
    expect(kinds(world({ orders: [closed], financeOn: false }), MANAGER)).not.toContain("close_received")
  })
})

describe("F3 · the advance marked paid clears everywhere", () => {
  const unpaid = po({ advancePercent: 30 })
  const paid = po({ advancePercent: 30, advancePaidDay: "2026-10-15" } as Partial<PurchaseOrderX>)

  it("advanceState reads the day the buyer marked it", () => {
    expect(advanceState(asX(unpaid))).toBe("requested")
    expect(advanceState(asX(paid))).toBe("paid")
  })

  it("the wait, the task and the trail follow it", () => {
    expect(todayWaits(world({ orders: [unpaid], financeOn: true }), MANAGER, NOW).map((x) => x.kind)).toContain("supplier_advance")
    expect(todayWaits(world({ orders: [paid], financeOn: true }), MANAGER, NOW).map((x) => x.kind)).not.toContain("supplier_advance")
    expect(kinds(world({ orders: [unpaid], financeOn: false }), MANAGER)).toContain("advance_unpaid")
    expect(kinds(world({ orders: [paid], financeOn: false }), MANAGER)).not.toContain("advance_unpaid")
    expect(kinds(world({ orders: [unpaid], financeOn: true }), MANAGER)).not.toContain("advance_unpaid")
    const step = docTrail(asX(paid), [], false).find((s) => s.key === "advance")
    expect(step).toMatchObject({ state: "ok", at: "2026-10-15" })
  })
})

describe("F6 · one lateness number", () => {
  // ط.ش-2026/001: the supplier notified in time (24 Sep) and the notice waits for our count.
  const order = po()
  const waiting = [notice()]

  it("a notice in time that waits for our count is nobody's lateness", () => {
    expect(honestDate(order, NOW)).toMatchObject({ kind: "promised", daysLate: 25 })
    expect(honestDate(order, NOW, waiting)).toMatchObject({ kind: "promised", daysLate: 0 })
    const ctx = (notices: typeof waiting) => ({ notices: notices as never, financeOn: true, acceptanceDays: 1, now: NOW })
    expect(inSegment(order, "late", ctx([]))).toBe(true)
    expect(inSegment(order, "late", ctx(waiting))).toBe(false)
    expect(segmentCounts([order], ctx(waiting)).late).toBe(0)
  })

  it("Today, the reports and the dashboard count read the same", () => {
    const w = world({ orders: [order], receipts: waiting })
    expect(kinds(w, MANAGER)).not.toContain("late")
    const committed = todayKpis(w, MANAGER, NOW).tiles.find((t) => t.id === "committed")
    expect(committed?.noteKey).toBe("kpi.committed.note_none")
    expect(deliveryPerformance(w, null, NOW).orders[0]).toMatchObject({ state: "on_time_so_far" })
    expect(deliveryPerformance(world({ orders: [order] }), null, NOW).orders[0]).toMatchObject({ state: "late", gap: 25 })
    const queue = { uid: "m", isOwner: true }
    expect(workQueueCounts([order], DEFAULT_POLICIES, queue, NOW).attention.late).toBe(1)
    expect(workQueueCounts([order], DEFAULT_POLICIES, queue, NOW, waiting).attention.late).toBe(0)
  })
})

describe("F7 · since when", () => {
  it("the list says how long an order has waited on its approver and on the supplier", () => {
    expect(honestDate(po({ status: "awaiting_approval", createdAt: "2026-10-17T08:00:00Z" }), NOW)).toMatchObject({ kind: "with_approver", days: 2 })
    expect(honestDate(po({ status: "sent", sentAt: "2026-10-16T08:00:00Z" }), NOW)).toMatchObject({ kind: "no_acceptance", days: 3 })
  })

  it("Today's «بانتظار الاعتماد» row carries the days", () => {
    const waiting = po({ status: "awaiting_approval", createdAt: "2026-10-16T08:00:00Z", approverKind: "owner" })
    const row = todayTasks(world({ orders: [waiting] }), BUYER, NOW).find((x) => x.kind === "approval_wait")
    expect(row?.titleParams).toMatchObject({ days: 3 })
  })
})

describe("F12 · a notice nobody can be forwarded to", () => {
  it("says there is no receiver for the site only when the register named none", () => {
    const w = (receiver: string | null) => world({ orders: [po()], receipts: [notice({ deliveryDate: "2026-10-25" })], forwardFacts: { d1: { place: "المستودع المركزي", receiver } } })
    const row = (receiver: string | null) => todayTasks(w(receiver), MANAGER, NOW).find((x) => x.kind === "notice_forward")
    expect(row(null)?.subParams).toMatchObject({ hasReceiver: 0, noReceiver: 1, place: "المستودع المركزي" })
    expect(row("أحمد العتيبي")?.subParams).toMatchObject({ hasReceiver: 1, noReceiver: 0, receiver: "أحمد العتيبي" })
  })
})

describe("F10 · delivery sites without Project Management", () => {
  const rfqs = [{ id: "r1", products: [{ deliverySiteId: "s1" }, { deliverySiteId: "s2" }] }]
  const order = po({ lines: [line({ id: "a", rfqProductIndex: 0 } as Partial<PoLine>), line({ id: "b", rfqProductIndex: 1 } as Partial<PoLine>)] })

  it("an order serves the sites its RFQ lines named; else its project's site; else none", () => {
    expect(orderSiteIds(order, rfqs)).toEqual(["s1", "s2"])
    expect(orderSiteIds(po({ projectId: "p9", lines: [line()] }), [])).toEqual(["prj_p9"])
    expect(orderSiteIds(po({ projectId: null, lines: [line()] }), [])).toEqual([])
  })

  it("the orders filter passes by site, «بلا موقع» and all", () => {
    expect(inSiteFilter(["s1"], "all")).toBe(true)
    expect(inSiteFilter(["s1", "s2"], "s2")).toBe(true)
    expect(inSiteFilter(["s1"], "s2")).toBe(false)
    expect(inSiteFilter([], NO_SITE)).toBe(true)
    expect(inSiteFilter(["s1"], NO_SITE)).toBe(false)
  })

  it("the spend report groups by delivery site when asked", () => {
    const w = world({ orders: [order, po({ id: "po2", docNumber: "PO-2026/002", projectId: null, lines: [line()] })] })
    const report = spendByProject(w, null, { site: (o) => (o.id === "po1" ? { id: "s1", name: "مجمع الياسمين" } : null) })
    expect(report.rows.map((r) => [r.kind, r.projectName, r.orders])).toEqual(expect.arrayContaining([["site", "مجمع الياسمين", 1], ["buyers", "", 1]]))
  })

  it("the settings count the real open requests at each site (a finished one is not open)", () => {
    const needs = [
      { state: "action", siteId: "s1", projectId: null },
      { state: "rfq", siteId: "s1", projectId: null },
      { state: "done", siteId: "s1", projectId: null },
      { state: "action", siteId: null, projectId: "p1" },
    ] as Parameters<typeof openRequestsBySite>[0]
    expect(openRequestsBySite(needs, [{ id: "s1", projectId: null }, { id: "prj_p1", projectId: "p1" }, { id: "s3", projectId: null }])).toEqual({ s1: 2, prj_p1: 1, s3: 0 })
  })
})

describe("F4 · the supplier reads the payment mark", () => {
  it("a payment status and the advance day come through; nothing marked says nothing", () => {
    expect(payMarkOf({})).toEqual({})
    expect(payMarkOf({ paymentMark: { state: "part", day: "2026-10-10" }, advancePaidDay: "2026-10-01" })).toEqual({ pay: { state: "part", day: "2026-10-10", advanceDay: "2026-10-01" } })
    expect(payMarkOf({ advancePaidDay: "2026-10-01" })).toEqual({ pay: { state: "unpaid", day: "", advanceDay: "2026-10-01" } })
  })
})
