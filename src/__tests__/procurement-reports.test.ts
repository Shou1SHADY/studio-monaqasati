/**
 * Procurement PRD 3.0 — the seven reports (§9), pure over the same world as
 * Today: commitments ex-VAT, never a guessed share of a lump sum; null for
 * "no record"; concentration flagged above 30 %; drift against the last price
 * we paid; exceptions by name; open commitments by the supplier's date.
 */

import { cycleAndCompetition, deliveryPerformance, exceptions, lastDays, openCommitments, priceDrift, spendByProject, spendBySupplier } from "@/lib/procurement/reports"
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
})

describe("2 · spend by supplier — concentration above 30 %", () => {
  it("shares, on-time from the record (null without one), and the flag on the top supplier", () => {
    const w = world({
      orders: [
        po({ id: "a", lines: [line({ quantity: 10, accepted: 10 })], promisedDate: "2026-09-19" }), // 28,000, late (receipt 20th)
        po({ id: "b", supplierOrgId: "sup2", supplierName: "Beta", lines: [line({ quantity: 5 })] }), // 14,000
        po({ id: "c", supplierOrgId: "sup3", supplierName: "Gamma", lines: [line({ quantity: 5 })], supplierAcceptedAt: null, status: "approved" }), // 14,000
      ],
      receipts: [receipt({ poId: "a", confirmedAt: "2026-09-20T08:00:00Z" })],
    })
    const r = spendBySupplier(w, PERIOD, NOW)
    expect(r.rows.map((x) => [x.supplierName, x.value, x.sharePercent, x.onTimePercent, x.concentrated])).toEqual([
      ["Al-Hadid", 28000, 50, 0, true],
      ["Beta", 14000, 25, 100, false],
      ["Gamma", 14000, 25, null, false],
    ])
    expect(r.totals.value).toBe(56000)
    expect(r.concentration).toEqual({ supplierName: "Al-Hadid", sharePercent: 50 })
    // Three equal suppliers: nobody is concentrated.
    const even = spendBySupplier(world({ orders: [po({ id: "a", lines: [line({ quantity: 1 })] }), po({ id: "b", supplierOrgId: "s2", supplierName: "B", lines: [line({ quantity: 1 })] }), po({ id: "c", supplierOrgId: "s3", supplierName: "C", lines: [line({ quantity: 1 })] }), po({ id: "d", supplierOrgId: "s4", supplierName: "D", lines: [line({ quantity: 1 })] })] }), PERIOD, NOW)
    expect(even.concentration).toBeNull()
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
    // Al-Hadid: a and c late of four → 50 %; days late over the judged (3, 0, 3) → 2; rejects 5 of 200 counted.
    expect(r.suppliers).toEqual([
      { supplierKey: "sup1", supplierName: "Al-Hadid", orders: 4, onTimePercent: 50, avgDaysLate: 2, rejectPercent: 2.5 },
      { supplierKey: "s2", supplierName: "Beta", orders: 1, onTimePercent: 100, avgDaysLate: null, rejectPercent: null },
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
    expect(r.totals).toEqual({ rfqs: 3, awarded: 2, avgDays: 5, avgOffers: 1.67, shortCompetition: 2 })
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
    expect(rows.find((r) => r.kind === "no_po" && r.receiptId === "cash")?.byName).toBe("Omar")
    expect(rows.find((r) => r.kind === "cash_expense")?.byName).toBe("Lina")
    // Written before the name was stored: still listed, just unnamed.
    expect(rows.find((r) => r.kind === "no_po" && r.receiptId === "before")?.byName).toBe("")
  })
})

describe("7 · open commitments by due date", () => {
  it("live orders bucketed by the supplier's date, overdue in the first week; lump sums at their total", () => {
    const w = world({
      orders: [
        po({ id: "over", promisedDate: "2026-09-19", lines: [line({ quantity: 1 })] }), // 2,800 overdue → within7
        po({ id: "wk", promisedDate: "2026-09-29", lines: [line({ quantity: 2 })] }), // 5,600 → within7
        po({ id: "mo", promisedDate: "2026-10-20", lines: [line({ quantity: 3, accepted: 1 })] }), // 5,600 → within30
        po({ id: "two", promisedDate: "2026-11-15", lines: [line({ unitPrice: null })], totalExVat: 9000 }), // lump → within60
        po({ id: "far", promisedDate: "2027-01-01", status: "approved", lines: [line({ quantity: 1 })] }), // 2,800 → later
        po({ id: "nd", promisedDate: null, status: "sent", lines: [line({ quantity: 1 })] }), // 2,800 → noDate
        po({ id: "done", lines: [line({ accepted: 100 })] }),
        po({ id: "w", status: "awaiting_approval" }),
      ],
    })
    const r = openCommitments(w, NOW)
    expect(r.rows.map((x) => [x.orderId, x.daysToDue, x.value, x.bucket])).toEqual([
      ["over", -3, 2800, "within7"],
      ["wk", 7, 5600, "within7"],
      ["mo", 28, 5600, "within30"],
      ["two", 54, 9000, "within60"],
      ["far", 101, 2800, "later"],
      ["nd", null, 2800, "noDate"],
    ])
    expect(r.buckets).toEqual({ within7: { count: 2, value: 8400 }, within30: { count: 1, value: 5600 }, within60: { count: 1, value: 9000 }, later: { count: 1, value: 2800 }, noDate: { count: 1, value: 2800 } })
    expect(r.total).toBe(28600)
  })

  it("lastDays builds the period the segment means", () => {
    expect(lastDays(30, NOW)).toEqual({ from: "2026-08-23", to: "2026-09-22" })
  })
})
