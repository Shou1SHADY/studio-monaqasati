/**
 * Today and Reports (Sales PRD HOME-01…03, REP-01…03, INV-04, INV-08): every
 * figure is derived from the documents; sales count on SIGNED delivery; the
 * decision queue shows one action per row, only what the role may do, nearest
 * risk first; cost and margin never reach a viewer without cost access.
 */

import type { CrmQuotation } from "@/lib/crm"
import type { LineCoverage, ManufacturingRequest, SalesDeliveryNote, SalesOrder, SalesReturn } from "@/lib/sales-orders"
import type { QuoteRequest, TransferNotice } from "@/lib/sales-transfers"
import { costDriftsOf, flowStrip, todayDecisions, todayKpis, type SalesWorld, type TodayViewer } from "@/lib/sales-today"
import { clientShares, executionBlocks, monthlySales, orderBook, salesFunnel, staffReport, topProducts, winLoss } from "@/lib/sales-reports"

const TODAY = "2026-09-17"
const NOW = Date.parse("2026-09-17T08:00:00Z")

const MANAGER: TodayViewer = { canSell: true, canDecideReturns: true, seesCost: true }
const REP: TodayViewer = { canSell: true, canDecideReturns: false, seesCost: false }

const order = (over: Partial<SalesOrder>): SalesOrder =>
  ({
    id: "so1",
    organizationId: "org",
    orderNumber: 40,
    type: "standard",
    status: "running",
    contactId: "c1",
    contactName: "Al-Diyar",
    payment: { kind: "credit", creditDays: 30 },
    vatPercent: 15,
    lines: [{ name: "HDF door", unit: "pc", quantity: 120, unitPrice: 1000, unitCost: 700 }],
    promiseDate: "2026-09-25",
    createdByUserId: "reem",
    createdByUserName: "Reem",
    ...over,
  }) as SalesOrder

const note = (over: Partial<SalesDeliveryNote>): SalesDeliveryNote =>
  ({ id: "n1", organizationId: "org", noteNumber: "SD-1", orderId: "so1", orderNumber: 40, contactId: "c1", contactName: "Al-Diyar", status: "delivered", lines: [{ name: "HDF door", quantity: 20 }], deliveredAt: "2026-09-10T09:00:00Z", createdByUserId: "reem", createdByUserName: "Reem", ...over }) as SalesDeliveryNote

const quote = (over: Partial<CrmQuotation>): CrmQuotation =>
  ({ id: "q1", organizationId: "org", contactId: "c1", contactName: "Al-Diyar", quotationNumber: "QT-2026/001", amount: 50000, status: "sent", validUntil: "2026-10-01", createdByUserId: "reem", createdByUserName: "Reem", date: "2026-09-01", ...over }) as CrmQuotation

const world = (over: Partial<SalesWorld> = {}): SalesWorld => ({
  today: TODAY,
  nowMs: NOW,
  quotations: [],
  requests: [],
  orders: [],
  notes: [],
  returns: [],
  notices: [],
  mfgRequests: [],
  coverage: new Map(),
  gates: new Map(),
  answerWindowHours: 24,
  costDrifts: [],
  ...over,
})

const cover = (orderId: string, name: string, c: Partial<LineCoverage>): [string, LineCoverage] => [`${orderId}|${name.toLowerCase()}`, { name, needed: 0, fromStock: 0, fromManufacturing: 0, gap: 0, workOrderIds: [], ...c }]

describe("HOME-01 · three KPIs", () => {
  const w = world({
    orders: [order({})],
    // 20 signed inside the window; 30 signed long ago; 10 only authorised.
    notes: [note({}), note({ id: "n0", deliveredAt: "2026-06-01T09:00:00Z", lines: [{ name: "HDF door", quantity: 30 }] }), note({ id: "n2", status: "authorized", deliveredAt: null, lines: [{ name: "HDF door", quantity: 10 }] })],
    quotations: [quote({}), quote({ id: "q2", validUntil: "2026-09-20", amount: 10000 }), quote({ id: "q3", validUntil: "2026-09-01" }), quote({ id: "q4", status: "draft" })],
    coverage: new Map([cover("so1", "HDF door", { gap: 15 })]),
  })

  it("sales count on SIGNED delivery in the window — an authorised note is not a sale", () => {
    const k = todayKpis(w, MANAGER)
    expect(k.delivered30).toBe(20000)
    expect(k.margin30Percent).toBe(30) // (1000 − 700) / 1000
  })

  it("promised, and how much of it nothing covers", () => {
    const k = todayKpis(w, MANAGER)
    expect(k.promised).toBe(70000) // 120 − 50 delivered = 70 still owed
    expect(k.promisedNoSupply).toBe(15000)
  })

  it("live quotes, and how many expire within 7 days — expired and drafts are not live", () => {
    const k = todayKpis(w, MANAGER)
    expect(k.liveQuotes).toBe(2)
    expect(k.liveQuotesValue).toBe(60000)
    expect(k.expiringIn7).toBe(1)
  })

  it("INV-08 · a rep gets the sales figure and never the margin", () => {
    const k = todayKpis(w, REP)
    expect(k.delivered30).toBe(20000)
    expect(k.margin30Percent).toBeNull()
  })
})

describe("HOME-02 · the flow strip", () => {
  it("transfers awaiting Finance, and what Finance confirmed in 30 days", () => {
    const notice = (over: Partial<TransferNotice>) => ({ id: "t", quotationId: "q1", installmentId: "deposit", amountStated: 5000, status: "reported", ...over }) as TransferNotice
    const f = flowStrip(
      world({
        notices: [notice({}), notice({ id: "t2", amountStated: 3000 }), notice({ id: "t3", status: "confirmed", amountStated: 9000, answeredAt: "2026-09-05T10:00:00Z" }), notice({ id: "t4", status: "confirmed", amountStated: 7000, answeredAt: "2026-05-01T10:00:00Z" }), notice({ id: "t5", status: "not_found", amountStated: 1 })],
      })
    )
    expect(f.transfersAwaiting).toBe(8000)
    expect(f.confirmed30).toBe(9000)
  })
})

describe("HOME-03 · needs your decision", () => {
  const kinds = (w: SalesWorld, v: TodayViewer = MANAGER) => todayDecisions(w, v).map((d) => d.kind)
  const request = (over: Partial<QuoteRequest>) => ({ id: "r1", organizationId: "org", requestNumber: "RQ-2026/031", contactId: "c1", contactName: "Al-Diyar", lines: [], status: "new", requestedByUserId: "crm", requestedByUserName: "Huda", requestedAt: "2026-09-15T08:00:00Z", ...over }) as QuoteRequest

  it("1 · a request awaits pricing — red past due; 'finish the draft' once one exists; answered ones are gone", () => {
    const d = todayDecisions(world({ requests: [request({ dueDate: "2026-09-10" }), request({ id: "r2", draftQuotationId: "qd" }), request({ id: "r3", status: "quoted" })] }), MANAGER)
    expect(d.map((x) => [x.kind, x.tone, x.href])).toEqual([
      ["request_to_price", "danger", "quotations/new?request=r1"],
      ["request_draft", "info", "quotations/new?draft=qd"],
    ])
  })

  it("2–4 · issued not sent · a draft never issued · expiring within 3 days · expired undecided", () => {
    const w = world({
      requests: [request({ draftQuotationId: "qd" })],
      quotations: [
        quote({ id: "qi", status: "issued", validUntil: null }),
        quote({ id: "qd", status: "draft", validUntil: null }), // the request's draft: row 1, not row 3
        quote({ id: "qf", status: "draft", validUntil: null }),
        quote({ id: "qe", validUntil: "2026-09-19" }),
        quote({ id: "qx", validUntil: "2026-09-10" }),
        quote({ id: "ok", validUntil: "2026-12-01" }),
        quote({ id: "qs", validUntil: "2026-09-10", supersededById: "r2" }),
      ],
    })
    expect(kinds(w).sort()).toEqual(["draft_not_issued", "quote_expired", "quote_expiring", "quote_not_sent", "request_draft"])
  })

  it("5 · an order awaits its advance only until the transfer is reported — then it is Finance's", () => {
    const gated = order({ status: "awaiting_deposit", quotationId: "q1", payment: { kind: "deposit", depositPercent: 30, advanceInstallmentId: "deposit" } })
    const q = quote({ status: "accepted", installments: [{ id: "deposit", label: "Advance", percent: 30, beforeProduction: true }, { id: "balance", label: "Rest", percent: 70 }] })
    expect(kinds(world({ orders: [gated], quotations: [q] }))).toEqual(["order_awaits_advance"])
    const reported = { id: "t1", quotationId: "q1", installmentId: "deposit", amountStated: 15000, status: "reported" } as TransferNotice
    expect(kinds(world({ orders: [gated], quotations: [q], notices: [reported] }))).toEqual([])
    // 6 · not found comes back as ONE decision — "check with the client and
    // report again" is the action for that advance; it is not doubled.
    const back = todayDecisions(world({ orders: [gated], quotations: [q], notices: [{ ...reported, status: "not_found", financeMessage: "No such transfer", answeredAt: "2026-09-16T10:00:00Z" }] }), MANAGER)
    expect(back.map((d) => d.kind)).toEqual(["transfer_not_found"])
    expect(back[0].facts.message).toBe("No such transfer")
  })

  it("7 · 13 · held (until release is asked) and authorised-unsigned shipments", () => {
    const w = world({ orders: [order({})], notes: [note({ id: "h", status: "held", deliveredAt: null }), note({ id: "h2", status: "held", deliveredAt: null, releaseRequestedAt: "2026-09-16T10:00:00Z" }), note({ id: "a", status: "authorized", deliveredAt: null })] })
    expect(kinds(w).filter((k) => k.startsWith("shipment"))).toEqual(["shipment_held", "shipment_to_sign"])
  })

  it("8 · a line with no supply — silent while a request is with the plant; a decline asks us to adjust", () => {
    const o = order({})
    const gap = new Map([cover("so1", "HDF door", { gap: 40 })])
    const mr = (status: ManufacturingRequest["status"]) => ({ id: "m1", requestNumber: "MR-2026/087", orderId: "so1", orderNumber: 40, itemName: "HDF door", quantity: 40, status, sourceKind: "sales", requestedAt: "2026-09-17T07:00:00Z", rejectionReason: "No capacity before October" }) as ManufacturingRequest
    expect(kinds(world({ orders: [o], coverage: gap }))).toEqual(["line_no_supply"])
    expect(kinds(world({ orders: [o], coverage: gap, mfgRequests: [mr("new")] }))).toEqual([])
    const declined = todayDecisions(world({ orders: [o], coverage: gap, mfgRequests: [mr("rejected")] }), MANAGER)
    expect(declined.map((d) => d.kind)).toEqual(["mfg_request_declined"])
    expect(declined[0].facts.reason).toBe("No capacity before October")
  })

  it("9 · 11 · a closed gate, and a promise that has passed with goods still owed", () => {
    const late = order({ promiseDate: "2026-09-10" })
    expect(kinds(world({ orders: [late], gates: new Map([["so1", "approval"]]) })).sort()).toEqual(["gate_closed", "promise_overdue"])
    // Fully delivered: nothing is owed, so nothing is late.
    expect(kinds(world({ orders: [late], notes: [note({ lines: [{ name: "HDF door", quantity: 120 }] })] }))).toEqual([])
  })

  it("10 · PAY-07 · the plant's clock does not run while the order still waits for its advance", () => {
    const mr = { id: "m1", requestNumber: "MR-2026/087", orderId: "so1", itemName: "Canopy", quantity: 4, status: "new", sourceKind: "sales", requestedAt: "2026-09-14T08:00:00Z" } as ManufacturingRequest
    expect(kinds(world({ orders: [order({})], mfgRequests: [mr] }))).toEqual(["mfg_request_unanswered"])
    expect(kinds(world({ orders: [order({ status: "awaiting_deposit", payment: { kind: "deposit", depositPercent: 30, depositReportedAt: "2026-09-14T08:00:00Z" } })], mfgRequests: [mr] }))).toEqual([])
    expect(kinds(world({ orders: [order({})], mfgRequests: [{ ...mr, requestedAt: "2026-09-17T01:00:00Z" }] }))).toEqual([])
  })

  it("14 · 15 · S8 · returns and price reviews show only to whoever may act on them", () => {
    const ret = { id: "rt1", returnNumber: "RT-1", orderId: "so1", contactName: "Al-Diyar", deliveryNoteId: "n1", lines: [{ name: "HDF door", quantity: 2 }], reason: "Scratched", status: "awaiting_decision" } as SalesReturn
    const w = world({ orders: [order({})], returns: [ret], costDrifts: [{ name: "HDF door", standard: 700, actual: 760, driftPercent: 8.57 }, { name: "Frame", standard: 100, actual: 102, driftPercent: 2 }] })
    expect(kinds(w, MANAGER).sort()).toEqual(["price_to_review", "return_to_decide"])
    expect(kinds(w, REP)).toEqual([])
    expect(JSON.stringify(todayDecisions(w, REP))).not.toContain("700")
  })

  it("nearest risk first", () => {
    const w = world({
      requests: [request({ dueDate: "2026-09-10" })],
      quotations: [quote({ id: "qe", validUntil: "2026-09-19" })],
      orders: [order({})],
      notes: [note({ id: "a", status: "authorized", deliveredAt: null })],
    })
    const risks = todayDecisions(w, MANAGER).map((d) => d.risk)
    expect(risks).toEqual([...risks].sort((a, b) => a - b))
    expect(todayDecisions(w, MANAGER)[0].kind).toBe("request_to_price")
  })
})

describe("PRC-03 · actual cost against standard", () => {
  it("averages closed work orders per product; ignores what has no standard or no actual", () => {
    expect(
      costDriftsOf(
        [{ name: "HDF door", cost: 700 }, { name: "Frame", cost: null }, { name: "Handle", cost: 50 }],
        [{ productName: "HDF door", quantity: 10, frozenCost: { cost: 7600 } }, { productName: "hdf DOOR", quantity: 10, frozenCost: { cost: 7400 } }, { productName: "Frame", quantity: 5, frozenCost: { cost: 900 } }, { productName: "Handle", quantity: 5, frozenCost: null }]
      )
    ).toEqual([{ name: "HDF door", standard: 700, actual: 750, driftPercent: 7.14 }])
  })
})

describe("REP-01 · company reports", () => {
  const w = world({
    orders: [order({}), order({ id: "so2", orderNumber: 41, contactId: "c2", contactName: "Bina", lines: [{ name: "Frame", unit: "pc", quantity: 50, unitPrice: 200, unitCost: null }], promiseDate: "2026-09-10" }), order({ id: "so3", orderNumber: 42, type: "internal", contactId: null })],
    notes: [note({}), note({ id: "n2", orderId: "so2", lines: [{ name: "Frame", quantity: 10 }], deliveredAt: "2026-08-20T09:00:00Z" }), note({ id: "n3", orderId: "so3", lines: [{ name: "HDF door", quantity: 99 }] })],
  })

  it("six months, recognised on signed delivery, external only", () => {
    const m = monthlySales(w, true)
    expect(m).toHaveLength(6)
    expect(m.map((x) => x.month).slice(-2)).toEqual(["2026-08", "2026-09"])
    expect(m[5]).toEqual({ month: "2026-09", sales: 20000, marginPercent: 30 })
    // Frames carry no standard cost: they sell, and are excluded from margin (PRC-04).
    expect(m[4]).toEqual({ month: "2026-08", sales: 2000, marginPercent: null })
    expect(monthlySales(w, false).every((x) => x.marginPercent === null)).toBe(true)
  })

  it("top products by real margin; the uncosted part is named, never guessed", () => {
    const t = topProducts(w, 30, true)
    expect(t.rows).toEqual([{ name: "HDF door", quantity: 20, value: 20000, marginPercent: 30, uncostedValue: 0 }, { name: "Frame", quantity: 10, value: 2000, marginPercent: null, uncostedValue: 2000 }])
    expect(t.total).toBe(22000)
    expect(t.marginPercent).toBe(30)
    expect(topProducts(w, 30, false).rows.every((r) => r.marginPercent === null)).toBe(true)
  })

  it("client shares — a share above 40% is a concentration figure", () => {
    expect(clientShares(w, 30)).toEqual([{ contactId: "c1", name: "Al-Diyar", value: 20000, sharePercent: 90.91 }, { contactId: "c2", name: "Bina", value: 2000, sharePercent: 9.09 }])
  })

  it("the order book by promise horizon", () => {
    const b = orderBook(w)
    expect(b.rows).toEqual({ past_due: 8000, this_week: 0, next_two_weeks: 100000, later: 0, no_promise: 0 })
    expect(b.total).toBe(108000)
  })
})

describe("REP-02 · sales reports", () => {
  it("the funnel, win/loss with its reasons, and what blocks execution", () => {
    const w = world({
      requests: [{ id: "r1", status: "new", requestedAt: "2026-09-01T08:00:00Z" } as QuoteRequest],
      quotations: [
        quote({ id: "w1", status: "accepted", acceptedAt: "2026-09-05T08:00:00Z", requestId: "r1", issuedAt: "2026-09-03T08:00:00Z" }),
        quote({ id: "l1", status: "rejected", rejectedAt: "2026-09-06T08:00:00Z", lostReason: "Price", amount: 30000 }),
        quote({ id: "l2", status: "rejected", rejectedAt: "2026-09-07T08:00:00Z", lostReason: "price ", amount: 20000 }),
        quote({ id: "l3", status: "rejected", rejectedAt: "2026-01-07T08:00:00Z", lostReason: "Old" }),
        quote({ id: "x1", validUntil: "2026-09-01" }),
        quote({ id: "s1" }),
      ],
      orders: [order({}), order({ id: "so2", status: "awaiting_deposit", payment: { kind: "deposit", depositPercent: 30 } })],
      notes: [note({ id: "h", status: "held", deliveredAt: null })],
      coverage: new Map([cover("so1", "HDF door", { gap: 5 })]),
      gates: new Map([["so1", "measurement"]]),
    })
    expect(salesFunnel(w).map((f) => [f.key, f.count])).toEqual([["requests", 1], ["live_quotes", 1], ["confirmed", 1], ["transfers", 0]])
    const o = winLoss(w, 30)
    expect(o).toMatchObject({ won: 1, lost: 2, winRatePercent: 33.33, expiredUndecided: 1, responseDays: 2 })
    expect(o.reasons).toEqual([{ reason: "Price", count: 2, value: 50000 }])
    expect(executionBlocks(w)).toEqual({ uncoveredOrders: 1, gatedOrders: 1, unansweredRequests: 0, awaitingAdvance: 1, heldShipments: 1 })
  })
})

describe("REP-03 · staff reports", () => {
  const w = world({
    quotations: [
      quote({ id: "a", status: "accepted", sentAt: "2026-09-02", items: [{ name: "HDF door", quantity: 10, unit: "pc", unitPrice: 950 }] }),
      quote({ id: "b", status: "rejected", sentAt: "2026-09-02", rejectedAt: "2026-09-09" }),
      quote({ id: "c", createdByUserId: "majed", createdByUserName: "Majed", status: "draft", validUntil: null }),
    ],
    orders: [order({ quotationId: "a", lines: [{ name: "HDF door", unit: "pc", quantity: 10, unitPrice: 950, unitCost: 700 }] })],
  })
  const people = [{ id: "reem", name: "Reem" }, { id: "majed", name: "Majed" }]

  it("what each did — quotes, sent, won, win rate, order value, average discount", () => {
    const rows = staffReport(w, 30, people, [{ name: "HDF door", unitPrice: 1000 }], null)
    expect(rows[0]).toMatchObject({ userId: "reem", quotes: 2, sent: 2, won: 1, lost: 1, winRatePercent: 50, orderValue: 9500, avgDiscountPercent: 5 })
    expect(rows[1]).toMatchObject({ userId: "majed", quotes: 1, sent: 0, won: 0, winRatePercent: null, orderValue: 0 })
  })

  it("a rep sees only himself, and no list-price figure he was not given", () => {
    const rows = staffReport(w, 30, people, null, "majed")
    expect(rows.map((r) => r.userId)).toEqual(["majed"])
    expect(rows[0].avgDiscountPercent).toBeNull()
  })
})
