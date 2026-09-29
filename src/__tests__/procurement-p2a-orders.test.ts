/**
 * The orders list and drawer against the prototype (proc-index `vPo`/`dPo`):
 * a project chip per line and a project filter that also offers general stock
 * and the workshop, counts taken after it, quantities net of what was
 * cancelled, the approver by name, terms worded for everyone, the award's facts,
 * the receiver's reject reasons, receipts and notices, the schedule's receipt
 * numbers, the printed order's revision/terms/tolerance and the statement's
 * «في الطريق» column — and the cycle report counted from the need's arrival
 * with the saving priced line by line.
 */

import { segmentCounts } from "@/components/procurement/PoModel"
import { purchaseOrderBody, buildReceiptStatementHtml, type PrintCopy } from "@/components/procurement/PoPrint"
import { buildPoPrintModel, buildStatementModel } from "@/components/procurement/PoModel"
import {
  approverNames,
  chosenOfferValidity,
  inProjectFilter,
  lineRejectReasons,
  manualOfferBy,
  netQuantity,
  noticeState,
  poProjectKeys,
  poTerms,
  receiptQuantities,
  registeredOfferCount,
  scheduleStates,
} from "@/lib/procurement/po-extras"
import { cycleAndCompetition, lineSaving, reportWorld } from "@/lib/procurement/reports"
import { GENERAL_STOCK, WORKSHOP } from "@/lib/procurement/rfq-view"
import type { OfferFact, ProcWorld, RfqFact } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PoLine, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"

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
  projectId: null,
  projectName: null,
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
  approverKind: "manager",
  approvedById: "mgr",
  approvedByName: "Manager",
  approvedAt: "2026-09-11T08:00:00Z",
  supplierAcceptedAt: "2026-09-12T08:00:00Z",
  promisedDate: "2026-09-30",
  log: [],
  ...over,
})

const receipt = (over: Partial<ReceiptFact> = {}): ReceiptFact => ({ id: "d1", status: "confirmed", poId: "po1", docNumber: "GR-2026/031", confirmedAt: "2026-09-18T06:00:00Z", lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 40, counted: 40, accepted: 35, rejected: 5, rejectReason: "damaged", held: 0 }], ...over })

describe("#8 #13 — a project per line, and the filter over the lines", () => {
  const rfqs = [{ id: "r1", products: [{ projectId: "pA" }, { projectId: "pB" }, {}] }]

  it("a line serves its RFQ line's project; otherwise the order's; otherwise the workshop or general stock", () => {
    const multi = po({ lines: [line({ id: "l1", rfqProductIndex: 0 }), line({ id: "l2", rfqProductIndex: 1 }), line({ id: "l3", rfqProductIndex: 2 })] })
    expect(poProjectKeys(multi, rfqs)).toEqual(["pA", "pB", GENERAL_STOCK])
    expect(poProjectKeys(po({ projectId: "pX", rfqId: null }), rfqs)).toEqual(["pX"])
    expect(poProjectKeys(po({ rfqId: null, purchaseSource: { kind: "mfg_purchase", workOrderId: "w1" } }), rfqs)).toEqual([WORKSHOP])
    expect(poProjectKeys(po({ rfqId: null, lines: [] }), rfqs)).toEqual([GENERAL_STOCK])
  })

  it("#7 the segment counts are taken after the project filter", () => {
    const orders = [po({ id: "a", projectId: "pA", rfqId: null }), po({ id: "b", projectId: "pB", rfqId: null, status: "awaiting_approval" }), po({ id: "c", rfqId: null })]
    const keys = new Map(orders.map((o) => [o.id, poProjectKeys(o, [])]))
    const only = (f: string) => orders.filter((o) => inProjectFilter(keys.get(o.id) || [], f))
    expect(segmentCounts(only("pA"), NOW).all).toBe(1)
    expect(segmentCounts(only("pB"), NOW).awaiting_approval).toBe(1)
    expect(segmentCounts(only(GENERAL_STOCK), NOW).all).toBe(1)
    expect(segmentCounts(only("all"), NOW).all).toBe(3)
  })

  it("#14 the list shows a line net of what was cancelled", () => {
    expect(netQuantity(line({ quantity: 100, cancelled: 30 }))).toBe(70)
    expect(netQuantity(line({ quantity: 10, cancelled: 12 }))).toBe(0)
  })
})

describe("#41 — the approver by name", () => {
  const members = [
    { id: "org", name: "Owner", isOwner: true, canApprove: true },
    { id: "buyer", name: "Sara", isOwner: false, canApprove: true },
    { id: "mgr", name: "Khaled", isOwner: false, canApprove: true },
    { id: "x", name: "Expediter", isOwner: false, canApprove: false },
  ]
  it("the owner's order names the owner; a manager's names who holds po.approve and did not prepare it", () => {
    expect(approverNames(po({ approverKind: "owner" }), members)).toEqual(["Owner"])
    expect(approverNames(po({ approverKind: "manager", preparedById: "buyer" }), members)).toEqual(["Khaled"])
  })
  it("nobody else approves: the owner does", () => {
    expect(approverNames(po({ approverKind: "manager", preparedById: "mgr" }), members.filter((m) => m.id !== "buyer"))).toEqual(["Owner"])
  })
})

describe("#64 — terms are terms, not prices", () => {
  it("advance with credit, credit alone, the written string, nothing", () => {
    expect(poTerms({ advancePercent: 30, creditDays: 60 })).toEqual({ kind: "advance", percent: 30, days: 60 })
    expect(poTerms({ advancePercent: 100, creditDays: 60 })).toEqual({ kind: "advance", percent: 100, days: 0 })
    expect(poTerms({ creditDays: 45 })).toEqual({ kind: "credit", days: 45 })
    expect(poTerms({ paymentTerms: " 30 days " })).toEqual({ kind: "text", text: "30 days" })
    expect(poTerms({})).toBeNull()
  })
})

describe("#36 #38 — the award's facts", () => {
  const offers = [
    { id: "o1", rfqId: "r1", validUntil: "2026-10-05T00:00:00Z", isManualOffer: true, recordedByName: "Sara" },
    { id: "o2", rfqId: "r1" },
    { id: "o3", rfqId: "r1", isGuestOffer: true },
    { id: "o4", rfqId: "r9" },
  ]
  it("counts registered offers only; reads the chosen offer's validity and who keyed it in", () => {
    expect(registeredOfferCount(po(), offers)).toBe(2)
    expect(registeredOfferCount(po({ rfqId: "none" }), offers)).toBe(3)
    expect(chosenOfferValidity(po(), offers)).toBe("2026-10-05")
    expect(chosenOfferValidity(po({ offerId: "o2" }), offers)).toBeNull()
    expect(manualOfferBy(po(), offers)).toBe("Sara")
    expect(manualOfferBy(po({ offerId: "o2" }), offers)).toBeNull()
  })
})

describe("#71 #74 #86 #87 — what the deliveries say", () => {
  it("the receiver's reject reasons on the line, each once", () => {
    const ds = [receipt(), receipt({ id: "d2", lines: [{ poLineId: "l1", name: "x", unit: "t", noticeQuantity: 5, rejected: 2, rejectReason: "damaged" }] }), receipt({ id: "d3", status: "pending_confirmation" })]
    expect(lineRejectReasons(po(), line(), ds)).toEqual([{ code: "damaged", note: null }])
  })

  it("a receipt's accepted per line and its rejected total", () => {
    expect(receiptQuantities(receipt())).toEqual({ accepted: [35], rejected: 5 })
  })

  it("a notice: received, passed with no receipt, after the supplier's date, on its way", () => {
    const today = "2026-09-22"
    expect(noticeState({ status: "confirmed", deliveryDate: "2026-09-01" }, po(), today)).toEqual({ kind: "received" })
    expect(noticeState({ status: "pending_confirmation", deliveryDate: "2026-09-20" }, po(), today)).toEqual({ kind: "passed" })
    expect(noticeState({ status: "pending_confirmation", deliveryDate: "2026-10-03" }, po(), today)).toEqual({ kind: "after_promise", days: 3 })
    expect(noticeState({ status: "pending_confirmation", deliveryDate: "2026-09-25" }, po(), today)).toEqual({ kind: "on_the_way" })
  })

  it("the agreed schedule: shipment n is the n-th delivery sent; a received one carries its receipt number", () => {
    const ds = [
      receipt({ id: "late", status: "pending_confirmation", docNumber: null, createdAt: "2026-09-20T08:00:00Z" } as Partial<ReceiptFact>),
      receipt({ id: "first", docNumber: "GR-2026/031", createdAt: "2026-09-15T08:00:00Z" } as Partial<ReceiptFact>),
    ]
    const sched = [{ date: "2026-09-15" }, { date: "2026-09-20" }, { date: "2026-09-21" }, { date: "2026-10-01" }]
    expect(scheduleStates(sched, po(), ds, "2026-09-22")).toEqual([{ kind: "received", number: "GR-2026/031" }, { kind: "notified" }, { kind: "no_notice" }, { kind: "pending" }])
  })
})

describe("#90 #92 — the printed order and the statement", () => {
  const copy: PrintCopy = (key, params) => (params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(",")})` : key)
  const company = { name: "Afaq" }

  it("the order prints its revision, the terms worded, and the tolerance in the clause", () => {
    const html = purchaseOrderBody(buildPoPrintModel(po({ paymentTerms: "raw" }), company, true), "PO-2026/014", "en", copy, NOW, { revision: 2, paymentTerms: "30% advance, rest 60 days", tolerancePercent: 5 })
    expect(html).toContain("revision(n=2)")
    expect(html).toContain("30% advance, rest 60 days")
    expect(html).not.toContain(">raw<")
    expect(html).toContain("po_clause(pct=5)")
    expect(purchaseOrderBody(buildPoPrintModel(po(), company, true), "PO-2026/014", "en", copy, NOW)).not.toContain("revision(")
  })

  it("the statement has an «on the way» column per line", () => {
    const html = buildReceiptStatementHtml(buildStatementModel(po(), [receipt(), receipt({ id: "n1", status: "pending_confirmation", docNumber: null, confirmedAt: null, lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 20 }] })], company, NOW), "PO-2026/014", (n) => n, "en", copy)
    expect(html).toContain("st_col_on_the_way")
    expect(html).toMatch(/<td class="num">20<\/td>/)
  })
})

describe("R8 — the cycle from the need's arrival, the saving line by line", () => {
  const world = (over: Partial<ProcWorld> = {}): ProcWorld => ({ orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, ...over })
  const rfq = (over: Partial<RfqFact> = {}): RfqFact => ({ id: "r1", status: "Awarded", title: "Rebar", createdAt: "2026-09-05T08:00:00Z", awardedAt: "2026-09-10T08:00:00Z", ...over })
  const offer = (over: Partial<OfferFact> = {}): OfferFact => ({ id: "o1", rfqId: "r1", status: "مقبول", price: "280000", ...over })

  it("counts from when the need reached us; an RFQ no need raised counts from publication", () => {
    const base = world({ rfqs: [rfq(), rfq({ id: "r2" })], orders: [po({ id: "a", rfqId: "r1" }), po({ id: "b", rfqId: "r2" })] })
    const w = reportWorld(base, { needArrivals: { r1: "2026-09-01T10:00:00Z" } })
    const r = cycleAndCompetition(w, { from: "2026-09-01", to: "2026-09-30" })
    expect(r.rows.map((x) => [x.rfqId, x.publishToAwardDays, x.daysToAward, x.fromNeed])).toEqual([
      ["r1", 5, 9, true],
      ["r2", 5, 5, false],
    ])
    expect(r.totals.avgDays).toBe(7)
  })

  it("per awarded line: (mean quoted rate − awarded rate) × quantity; totals only when nobody quoted rates", () => {
    const orders = [po({ lines: [line({ id: "l1", rfqProductIndex: 0, quantity: 10, unitPrice: 90 }), line({ id: "l2", rfqProductIndex: 1, quantity: 5, unitPrice: 20 })] })]
    const offers = [
      { id: "a", rfqId: "r1", status: "مقبول", lines: [{ rfqProductIndex: 0, unitPrice: 90 }, { rfqProductIndex: 1, unitPrice: 20 }] },
      { id: "b", rfqId: "r1", status: "قيد المراجعة", lines: [{ rfqProductIndex: 0, unitPrice: 110 }, { rfqProductIndex: 1, unitPrice: 30 }] },
      { id: "c", rfqId: "r1", status: "مرفوض", lines: [{ rfqProductIndex: 0, unitPrice: 999 }] },
    ]
    // line 1: (100 − 90) × 10 = 100; line 2: (25 − 20) × 5 = 25
    expect(lineSaving(orders, offers)).toBe(125)
    expect(lineSaving(orders, [{ id: "a", rfqId: "r1" }])).toBeNull()

    const base = world({ rfqs: [rfq()], offers: [offer({ id: "a", price: "1000" }), offer({ id: "b", status: "قيد المراجعة", price: "1300" })], orders })
    const raw = { offers: [{ id: "a", lines: offers[0].lines }, { id: "b", lines: offers[1].lines }] }
    const row = cycleAndCompetition(reportWorld(base, raw), { from: "2026-09-01", to: "2026-09-30" }).rows[0]
    expect(row).toMatchObject({ saving: 125, savingByLine: true })
  })
})
