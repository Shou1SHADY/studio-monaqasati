/**
 * Procurement PRD 3.0 — the seven reports (§9), pure over the same world as
 * Today: commitments ex-VAT, never a guessed share of a lump sum; null for
 * "no record"; spend grouped by who asked for it; concentration flagged above
 * 35 %; drift against the last price we paid; the saving against the average
 * offer; exceptions by name; open commitments by PAYMENT due (the supplier's
 * date or the receipt + the terms, advances now).
 */

import { cycleAndCompetition, deliveryPerformance, exceptions, lastDays, openCommitments, orderTerms, presetPeriod, priceDrift, reportWorld, spendByProject, spendBySupplier } from "@/lib/procurement/reports"
import type { OfferFact, ProcWorld, RfqFact } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PoLine, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"

const NOW = new Date("2026-09-22T08:00:00Z")
const PERIOD = { from: "2026-09-01", to: "2026-09-30" }

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
  projectName: "Tower A",
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
  approvedById: "mgr",
  approvedByName: "Manager",
  supplierAcceptedAt: "2026-09-12T08:00:00Z",
  promisedDate: "2026-09-30",
  log: [],
  ...over,
})

const receipt = (over: Partial<ReceiptFact> = {}): ReceiptFact => ({ id: "d1", status: "confirmed", poId: "po1", docNumber: "GR-2026/031", supplierName: "Al-Hadid", confirmedAt: "2026-09-18T06:00:00Z", lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 100, counted: 100, accepted: 100, rejected: 0, held: 0 }], ...over })

const world = (over: Partial<ProcWorld> = {}): ProcWorld => ({ orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, ...over })

describe("1 · spend by project", () => {
  it("ordered, received, open per project; awaiting-approval and cancelled orders are not commitments; a lump sum on its way is 'unknown' received", () => {
    const w = world({
      orders: [
        po({ id: "a", lines: [line({ accepted: 40 })] }),
        po({ id: "b", projectId: "p2", projectName: "Villa", lines: [line({ quantity: 10, accepted: 10 })] }),
        po({ id: "c", lines: [line({ unitPrice: null, accepted: 10 })], totalExVat: 5000 }),
        po({ id: "w", status: "awaiting_approval" }),
        po({ id: "x", status: "cancelled" }),
        po({ id: "old", createdAt: "2026-08-01T08:00:00Z" }),
      ],
    })
    const r = spendByProject(w, PERIOD)
    expect(r.rows.map((x) => [x.projectId, x.orders, x.ordered, x.received, x.open, x.receivedUnknown])).toEqual([
      ["p1", 2, 285000, 112000, 173000, true],
      ["p2", 1, 28000, 28000, 0, false],
    ])
    expect(r.totals).toEqual({ orders: 3, lines: 3, ordered: 313000, received: 140000, open: 173000 })
  })

  it("a need with no project goes under the party that raised it: the workshop's shortfall, Inventory's stock gap, or what a buyer added", () => {
    const one = [line({ quantity: 1 })]
    const w = world({
      orders: [
        po({ id: "src", projectId: null, projectName: null, purchaseSource: { kind: "project_request", projectId: "p9", purchaseRequestId: "pr" }, lines: one }),
        po({ id: "mfg", projectId: null, projectName: null, purchaseSource: { kind: "mfg_purchase", workOrderId: "wo", purchaseRequestId: "x" }, lines: one }),
        po({ id: "inv", projectId: null, projectName: null, purchaseSource: { kind: "stock_gap", warehouseId: "w", itemId: "i" }, lines: one }),
        po({ id: "me", projectId: null, projectName: null, lines: [line({ quantity: 2 })] }),
      ],
    })
    expect(spendByProject(w, PERIOD).rows.map((r) => [r.key, r.kind, r.projectId, r.ordered])).toEqual([
      ["buyers", "buyers", null, 5600],
      ["project:p9", "project", "p9", 2800],
      ["workshop", "workshop", null, 2800],
      ["inventory", "inventory", null, 2800],
    ])
  })
})

describe("2 · spend by supplier — concentration above 35 %", () => {
  it("shares, on-time from the record (null without one), and the flag on the top supplier", () => {
    const w = world({
      orders: [
        po({ id: "a", lines: [line({ quantity: 10, accepted: 10 })], promisedDate: "2026-09-19" }), // 28,000, late (receipt 20th)
        po({ id: "b", supplierOrgId: "sup2", supplierName: "Beta", lines: [line({ quantity: 5 })] }), // 14,000, nothing arrived and not due → no verdict
        po({ id: "c", supplierOrgId: "sup3", supplierName: "Gamma", lines: [line({ quantity: 5 })], supplierAcceptedAt: null, status: "approved" }), // 14,000
      ],
      receipts: [receipt({ poId: "a", confirmedAt: "2026-09-20T08:00:00Z" })],
    })
    const r = spendBySupplier(w, PERIOD, NOW)
    expect(r.rows.map((x) => [x.supplierName, x.value, x.sharePercent, x.onTimePercent, x.concentrated])).toEqual([
      ["Al-Hadid", 28000, 50, 0, true],
      ["Beta", 14000, 25, null, false],
      ["Gamma", 14000, 25, null, false],
    ])
    expect(r.totals.value).toBe(56000)
    expect(r.concentration).toEqual({ supplierName: "Al-Hadid", sharePercent: 50 })
    // Three equal suppliers: nobody is concentrated.
    const even = spendBySupplier(world({ orders: [po({ id: "a", lines: [line({ quantity: 1 })] }), po({ id: "b", supplierOrgId: "s2", supplierName: "B", lines: [line({ quantity: 1 })] }), po({ id: "c", supplierOrgId: "s3", supplierName: "C", lines: [line({ quantity: 1 })] }), po({ id: "d", supplierOrgId: "s4", supplierName: "D", lines: [line({ quantity: 1 })] })] }), PERIOD, NOW)
    expect(even.concentration).toBeNull()
    // A third of the spend is below the prototype's 35 %.
    const third = spendBySupplier(world({ orders: [po({ id: "a", lines: [line({ quantity: 1 })] }), po({ id: "b", supplierOrgId: "s2", supplierName: "B", lines: [line({ quantity: 1 })] }), po({ id: "c", supplierOrgId: "s3", supplierName: "C", lines: [line({ quantity: 1 })] })] }), PERIOD, NOW)
    expect(third.rows[0].sharePercent).toBe(33.33)
    expect(third.concentration).toBeNull()
  })
})

describe("3 · delivery performance", () => {
  it("per order: the gap once complete, 'on time so far' or 'late' while open; per supplier: on-time %, average days late, reject %", () => {
    const w = world({
      orders: [
        po({ id: "a", promisedDate: "2026-09-15", lines: [line({ accepted: 95, rejected: 5, cancelled: 5 })] }), // complete (the rejects were reduced off), receipt 18th → 3 late
        po({ id: "b", promisedDate: "2026-09-25", lines: [line({ accepted: 100 })] }), // complete, receipt 18th → early
        po({ id: "c", promisedDate: "2026-09-19" }), // open, late by 3
        po({ id: "d", promisedDate: "2026-09-29" }), // open, on time so far
        po({ id: "e", supplierOrgId: "s2", supplierName: "Beta", promisedDate: null }), // no date
        po({ id: "n", status: "sent", supplierAcceptedAt: null }), // not judged
      ],
      receipts: [receipt({ id: "ra", poId: "a", lines: [{ poLineId: "l1", name: "", unit: "t", noticeQuantity: 100, counted: 100, accepted: 95, rejected: 5, held: 0 }] }), receipt({ id: "rb", poId: "b" })],
    })
    const r = deliveryPerformance(w, PERIOD, NOW)
    expect(r.orders.map((o) => [o.orderId, o.gap, o.state])).toEqual([
      ["a", 3, "late"],
      ["b", -7, "on_time"],
      ["c", 3, "late"],
      ["d", null, "on_time_so_far"],
      ["e", null, "pending"],
    ])
    // Al-Hadid: a and c late of the three with a verdict (d is not due and nothing came) → 33 %;
    // days late over the judged (3, 0, 3) → 2; rejects 5 of 200 counted. Beta has no verdict yet.
    expect(r.suppliers).toEqual([
      { supplierKey: "sup1", supplierName: "Al-Hadid", orders: 4, onTimePercent: 33, avgDaysLate: 2, rejectPercent: 2.5 },
      { supplierKey: "s2", supplierName: "Beta", orders: 1, onTimePercent: null, avgDaysLate: null, rejectPercent: null },
    ])
  })
})

describe("4 · price drift vs last buy", () => {
  it("one row per priced line with an earlier price of the same name+unit; the previous may sit before the period; the impact is signed", () => {
    const w = world({
      orders: [
        po({ id: "jan", createdAt: "2026-01-10T08:00:00Z", status: "closed", lines: [line({ unitPrice: 2500 }), line({ id: "l2", name: "Cement", unit: "bag", quantity: 100, unitPrice: 18 })] }),
        po({ id: "sep", createdAt: "2026-09-10T08:00:00Z", lines: [line({ quantity: 10, unitPrice: 2800, cancelled: 2 }), line({ id: "l2", name: "cement ", unit: "BAG", quantity: 50, unitPrice: 17 }), line({ id: "l3", name: "Sand", unit: "m³", quantity: 5, unitPrice: 90 }), line({ id: "l4", name: "Lump", unit: "lot", quantity: 1, unitPrice: null })] }),
        po({ id: "later", createdAt: "2026-09-15T08:00:00Z", lines: [line({ quantity: 1, unitPrice: 2700 })] }),
        po({ id: "w", status: "awaiting_approval", createdAt: "2026-09-16T08:00:00Z", lines: [line({ unitPrice: 1 })] }),
      ],
    })
    const r = priceDrift(w, PERIOD)
    expect(r.rows.map((x) => [x.name, x.docNumber, x.previous, x.current, x.quantity, x.impact])).toEqual([
      ["Rebar 12 mm", "PO-2026/014", 2500, 2800, 8, 2400],
      ["cement ", "PO-2026/014", 18, 17, 50, -50],
      ["Rebar 12 mm", "PO-2026/014", 2800, 2700, 1, -100],
    ])
    expect(r.totals).toEqual({ impact: 2250, base: 2500 * 8 + 18 * 50 + 2800, percent: 9.49 })
    expect(priceDrift(world(), PERIOD).totals.percent).toBeNull()
  })
})

describe("5 · cycle time & competition", () => {
  const rfq = (over: Partial<RfqFact> = {}): RfqFact => ({ id: "r1", status: "Awarded", deadline: "2026-09-08", title: "Rebar", createdAt: "2026-09-05T08:00:00Z", awardedAt: "2026-09-10T08:00:00Z", invitedCount: 5, ...over })
  const offer = (over: Partial<OfferFact> = {}): OfferFact => ({ id: "o1", rfqId: "r1", status: "مقبول", price: "280000", ...over })

  it("days publish → award when dates exist; offers counted; short competition from the order, else from the lowest offer", () => {
    const w = world({
      rfqs: [rfq(), rfq({ id: "r2", status: "New", awardedAt: null, offersCount: 2, title: "Cement" }), rfq({ id: "r3", createdAt: null, awardedAt: null, title: "Sand" }), rfq({ id: "d", status: "Draft" }), rfq({ id: "old", createdAt: "2026-01-01T08:00:00Z" })],
      offers: [offer(), offer({ id: "o2", status: "مرفوض", price: "300000" }), offer({ id: "o3", rfqId: "r2", status: "قيد المراجعة", price: "25,000" }), offer({ id: "o4", rfqId: "r2", status: "قيد المراجعة", price: "26,000" }), offer({ id: "o5", rfqId: "r3", price: "1000" })],
      orders: [po({ id: "a", rfqId: "r1", offersCount: 2, shortCompetition: true }), po({ id: "c", rfqId: "r3", createdAt: "2026-09-20T08:00:00Z", lines: [line({ quantity: 1, unitPrice: 1000 })] })],
    })
    const r = cycleAndCompetition(w, PERIOD)
    expect(r.rows.map((x) => [x.rfqId, x.offersCount, x.awarded, x.publishToAwardDays, x.awardedTotal, x.shortCompetition])).toEqual([
      ["r1", 2, true, 5, 280000, true],
      ["r2", 2, false, null, null, true], // 25,000 with two offers: short if awarded as is
      ["r3", 1, true, null, 1000, false],
    ])
    expect(r.totals).toEqual({ rfqs: 3, awarded: 2, avgDays: 5, avgOffers: 1.67, shortCompetition: 2, saving: 0 })
    expect(r.rows.map((x) => [x.averageOffer, x.saving])).toEqual([
      [280000, 0], // the rejected offer is out of the running
      [25500, null],
      [1000, 0],
    ])
  })

  it("the saving is the average of the offers in the running less everything awarded — a split award counts every order", () => {
    const w = world({
      rfqs: [rfq({ id: "r4" })],
      offers: [offer({ id: "a", rfqId: "r4", price: "100" }), offer({ id: "b", rfqId: "r4", status: "قيد المراجعة", price: "120" }), offer({ id: "c", rfqId: "r4", status: "قيد المراجعة", price: "140" })],
      orders: [po({ id: "x", rfqId: "r4", lines: [line({ quantity: 1, unitPrice: 50 })] }), po({ id: "y", rfqId: "r4", lines: [line({ quantity: 1, unitPrice: 45 })] }), po({ id: "z", rfqId: "r4", status: "cancelled", lines: [line({ quantity: 1, unitPrice: 999 })] })],
    })
    const r = cycleAndCompetition(w, PERIOD)
    expect(r.rows[0]).toMatchObject({ awardedTotal: 95, averageOffer: 120, saving: 25 })
    expect(r.totals.saving).toBe(25)
  })
})

describe("6 · exceptions — by name, not violations", () => {
  it("every kind the data supports, newest first", () => {
    const w = world({
      orders: [
        po({ id: "retro", basis: "retroactive", createdAt: "2026-09-01T08:00:00Z" }),
        po({ id: "direct", basis: "direct", awardReasonText: "only stockist", createdAt: "2026-09-02T08:00:00Z" }),
        po({ id: "nonlow", awardReasonCode: "delivery_time", offersCount: 2, shortCompetition: true, noOfficialQuote: true, createdAt: "2026-09-03T08:00:00Z" }),
        po({ id: "self", approvedById: "buyer", approvedAt: "2026-09-05T08:00:00Z", createdAt: "2026-09-04T08:00:00Z" }),
        po({ id: "short", status: "closed", closedShort: true, closeReason: "supplier out of stock", closedAt: "2026-09-06T08:00:00Z", createdAt: "2026-09-04T08:00:00Z" }),
        po({ id: "clean", createdAt: "2026-09-07T08:00:00Z" }),
        po({ id: "old", basis: "retroactive", createdAt: "2026-08-07T08:00:00Z" }),
      ],
      receipts: [
        receipt({ id: "m", source: "manual", poId: "clean", confirmedAt: "2026-09-08T08:00:00Z" }),
        receipt({ id: "n", source: "manual", poId: null, confirmedAt: "2026-09-09T08:00:00Z" }),
        receipt({ id: "s", poId: "clean", selfReceived: true, confirmedAt: "2026-09-10T08:00:00Z" }),
        receipt({ id: "legacy", source: "manual", poId: null, offerId: "o", confirmedAt: "2026-09-11T08:00:00Z" }),
        receipt({ id: "ok", poId: "clean", confirmedAt: "2026-09-12T08:00:00Z" }),
      ],
    })
    const rows = exceptions(w, PERIOD)
    expect(rows.map((r) => [r.kind, r.orderId ?? r.receiptId, r.day])).toEqual([
      ["self_received", "clean", "2026-09-10"],
      ["no_po", "n", "2026-09-09"],
      ["manual_receipt", "clean", "2026-09-08"],
      ["closed_short", "short", "2026-09-06"],
      ["self_approval", "self", "2026-09-05"],
      ["non_lowest", "nonlow", "2026-09-03"],
      ["short_competition", "nonlow", "2026-09-03"],
      ["no_official_quote", "nonlow", "2026-09-03"],
      ["direct", "direct", "2026-09-02"],
      ["retroactive", "retro", "2026-09-01"],
    ])
    expect(rows.find((r) => r.kind === "non_lowest")?.params).toEqual({ reasonCode: "delivery_time", reason: "" })
    expect(rows.find((r) => r.kind === "self_received")?.byName).toBe("Sara")
  })

  it("names who recorded a no-order receipt and who sent it as a cash expense (UAT: both read '—')", () => {
    const w = world({
      receipts: [
        receipt({ id: "cash", source: "manual", poId: null, confirmedAt: "2026-09-09T08:00:00Z", confirmedByName: "Omar", regularisation: "expense", regularisedByName: "Lina" }),
        receipt({ id: "before", source: "manual", poId: null, confirmedAt: "2026-09-10T08:00:00Z" }),
      ],
    })
    const rows = exceptions(w, PERIOD)
    // Expensed, it is listed once — as the expense, by whoever sent it.
    expect(rows.filter((r) => r.receiptId === "cash").map((r) => r.kind)).toEqual(["cash_expense"])
    expect(rows.find((r) => r.kind === "cash_expense")?.byName).toBe("Lina")
    // Written before the name was stored: still listed, just unnamed.
    expect(rows.find((r) => r.kind === "no_po" && r.receiptId === "before")?.byName).toBe("")
  })
})

describe("6b · exceptions the raw documents add — keyed-in offers, awards on them, early closes", () => {
  it("reads them through reportWorld; a receipt names the order's approver; the supplier is its own column", () => {
    const base = world({
      rfqs: [{ id: "r1", status: "Awarded", title: "Rebar", createdAt: "2026-09-05T08:00:00Z" }],
      offers: [{ id: "o1", rfqId: "r1", status: "مقبول", price: "280000" }, { id: "o2", rfqId: "r1", status: "مرفوض", price: "300000" }],
      orders: [po({ id: "a", offerId: "o1", createdAt: "2026-09-10T08:00:00Z" })],
      receipts: [receipt({ id: "s", poId: "a", selfReceived: true, confirmedAt: "2026-09-12T08:00:00Z" })],
    })
    const w = reportWorld(base, {
      rfqs: [{ id: "r1", closedEarly: { at: "2026-09-07T10:00:00Z", byName: "Huda", reason: "all invitees quoted" } }],
      offers: [{ id: "o1", isManualOffer: true, recordedByName: "Turki", companyName: "Al-Hadid", createdAt: "2026-09-06T08:00:00Z" }, { id: "o2", supplierName: "Beta" }],
    })
    const rows = exceptions(w, PERIOD)
    expect(rows.map((r) => [r.kind, r.docNumber, r.supplierName, r.byName, r.day])).toEqual([
      ["self_received", "GR-2026/031", "Al-Hadid", "Sara", "2026-09-12"],
      ["awarded_manual_offer", "PO-2026/014", "Al-Hadid", "Sara", "2026-09-10"],
      ["early_close", "Rebar", "", "Huda", "2026-09-07"],
      ["manual_offer", "Rebar", "Al-Hadid", "Turki", "2026-09-06"],
    ])
    expect(rows[0].approvedByName).toBe("Manager")
    expect(rows.find((r) => r.kind === "early_close")?.params).toEqual({ reason: "all invitees quoted" })
    // Without the raw documents the same world lists none of the three.
    expect(exceptions(base, PERIOD).map((r) => r.kind)).toEqual(["self_received"])
  })
})

describe("7 · open commitments by payment due", () => {
  it("advances now, received-unpaid at the last receipt + terms, the rest at the supplier's date + terms; terms from our record, else the offer, else the order", () => {
    const one = (over: Partial<PoLine> = {}) => [line({ quantity: 10, unitPrice: 100, ...over })]
    const base = world({
      orders: [
        po({ id: "a", docNumber: "PO-A", offerId: "oa", promisedDate: "2026-09-25", lines: one() }),
        po({ id: "b", docNumber: "PO-B", supplierOrgId: "sup2", offerId: "oa", promisedDate: "2026-09-20", lines: one({ accepted: 4 }) }),
        po({ id: "c", docNumber: "PO-C", status: "sent", offerId: null, paymentTerms: "آجل 15 يوم", promisedDate: null, lines: one() }),
        po({ id: "d", docNumber: "PO-D", offerId: null, lines: one({ accepted: 10 }) }),
        po({ id: "e", docNumber: "PO-E", status: "closed", lines: one({ accepted: 10 }) }),
        po({ id: "f", docNumber: "PO-F", status: "awaiting_approval", lines: one() }),
        po({ id: "g", docNumber: "PO-G", offerId: null, promisedDate: "2026-12-31", totalExVat: 5000, lines: [line({ quantity: 10, unitPrice: null, accepted: 5 })] }),
        po({ id: "h", docNumber: "PO-H", offerId: "ob", promisedDate: "2026-10-01", lines: [line({ quantity: 1, unitPrice: 500 })] }),
      ],
      offers: [{ id: "oa", rfqId: "r" }, { id: "ob", rfqId: "r" }],
      receipts: [receipt({ id: "rb", poId: "b", confirmedAt: "2026-09-18T06:00:00Z" }), receipt({ id: "rd", poId: "d", confirmedAt: "2026-09-10T06:00:00Z" })],
    })
    const w = reportWorld(base, { offers: [{ id: "oa", creditDays: 30, advancePercent: "20" }, { id: "ob", advancePercent: 100 }], supplierRecords: [{ supplierOrgId: "sup2", paymentTermsDays: 60 }] })
    expect(orderTerms(w.orders[0], w)).toEqual({ days: 30, advancePercent: 20, source: "offer" })
    expect(orderTerms(w.orders[1], w)).toEqual({ days: 60, advancePercent: 20, source: "supplier" })
    expect(orderTerms(w.orders[2], w)).toEqual({ days: 15, advancePercent: 0, source: "order" })
    expect(orderTerms(w.orders[3], w)).toEqual({ days: 0, advancePercent: 0, source: "none" })

    const r = openCommitments(w, NOW)
    expect(r.rows.map((x) => [x.orderId, x.part, x.dueDate, x.daysToDue, x.value, x.bucket])).toEqual([
      ["d", "received", "2026-09-10", -12, 1000, "within7"],
      ["a", "advance", "2026-09-22", 0, 200, "within7"],
      ["h", "advance", "2026-09-22", 0, 500, "within7"],
      ["a", "undelivered", "2026-10-25", 33, 800, "within60"],
      ["b", "received", "2026-11-17", 56, 400, "within60"],
      ["b", "undelivered", "2026-11-19", 58, 600, "within60"], // part-received: the advance is no longer asked for
      ["g", "undelivered", "2026-12-31", 100, 5000, "later"],
      ["c", "undelivered", null, null, 1000, "noDate"],
    ])
    expect(r.buckets).toEqual({
      within7: { advance: 700, received: 1000, undelivered: 0, total: 1700 },
      within30: { advance: 0, received: 0, undelivered: 0, total: 0 },
      within60: { advance: 0, received: 400, undelivered: 1400, total: 1800 },
      later: { advance: 0, received: 0, undelivered: 5000, total: 5000 },
      noDate: { advance: 0, received: 0, undelivered: 1000, total: 1000 },
    })
    expect(r.totals).toEqual({ advance: 700, received: 1400, undelivered: 7400, total: 9500 })
    // The lump sum with goods accepted but no breakdown is not guessed.
    expect(r.receivedUnknown).toBe(1)
  })

  it("with no terms anywhere, the due date is the supplier's date", () => {
    const r = openCommitments(world({ orders: [po({ id: "over", promisedDate: "2026-09-19", lines: [line({ quantity: 1 })] })] }), NOW)
    expect(r.rows.map((x) => [x.part, x.dueDate, x.daysToDue, x.value, x.bucket, x.termsSource])).toEqual([["undelivered", "2026-09-19", -3, 2800, "within7", "none"]])
  })

  it("lastDays builds the period the segment means", () => {
    expect(lastDays(30, NOW)).toEqual({ from: "2026-08-23", to: "2026-09-22" })
    expect(presetPeriod("all", NOW)).toEqual({ from: null, to: null })
    expect(presetPeriod("year", NOW)).toEqual({ from: "2026-01-01", to: "2026-09-22" })
    expect(presetPeriod("custom", NOW, { from: "2026-02-01", to: "" })).toEqual({ from: "2026-02-01", to: null })
  })
})
