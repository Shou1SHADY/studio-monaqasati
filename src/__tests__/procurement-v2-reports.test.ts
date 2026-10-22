/**
 * Procurement 2.0, WP-S5-09 / G-18 / R-25 / R-26 — the reports page in the prototype's words: the seven reports with their 2.0
 * names, order tags (not the lowest, short competition, direct over the cap, lump sum, not VAT-registered) as columns and as a
 * filter, the delivery site as a filter, the exceptions list with the new direct-over-cap kind, the drift report read as
 * savings, and — without Finance — «مستلَم ودُفع» for the accountant. Every figure stays before VAT and says so.
 */

import fs from "fs"
import path from "path"
import {
  ORDER_TAGS,
  committedOrders,
  deliveryPerformance,
  exceptions,
  openCommitments,
  orderTags,
  priceDrift,
  receivedAndPaid,
  savingsSummary,
  spendByProject,
  spendBySupplier,
  type ReportFilter,
} from "@/lib/procurement/reports"
import { REPORT_IDS } from "@/lib/procurement/shell"
import type { ProcWorld } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PoLine, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"

const NOW = new Date("2026-09-22T08:00:00Z")
const PERIOD = { from: "2026-09-01", to: "2026-09-30" }

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 1000, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
  ({
    id: "po1",
    organizationId: "org",
    docNumber: "PO-2026/001",
    status: "accepted",
    basis: "rfq",
    rfqId: "r1",
    rfqTitle: "حديد",
    offerId: "o1",
    projectId: "p1",
    projectName: "برج",
    supplierOrgId: "s1",
    supplierUserId: null,
    supplierName: "مورد",
    isGuestSupplier: false,
    lines: [line()],
    totalExVat: 10000,
    vatRate: 0.15,
    offersCount: 3,
    lowestOfferTotal: 10000,
    shortCompetition: false,
    noOfficialQuote: false,
    preparedById: "buyer",
    preparedByName: "سارة",
    createdAt: "2026-09-10T08:00:00Z",
    approverKind: "owner",
    approvedById: "mgr",
    approvedByName: "المدير",
    approvedAt: "2026-09-11T08:00:00Z",
    supplierAcceptedAt: "2026-09-12T08:00:00Z",
    promisedDate: "2026-09-30",
    log: [],
    ...over,
  }) as PurchaseOrder
const world = (orders: PurchaseOrder[], receipts: ReceiptFact[] = []): ProcWorld => ({ orders, receipts, rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {} })

describe("the tags of an order", () => {
  it("five, by the order's own record", () => {
    expect(ORDER_TAGS).toEqual(["not_lowest", "short_competition", "direct_over", "lump", "unregistered"])
    expect(orderTags(po())).toEqual([])
    expect(orderTags(po({ tags: { notLowest: { why: "ضمان" } } }))).toEqual(["not_lowest"])
    expect(orderTags(po({ awardReasonCode: "quality" as never }))).toEqual(["not_lowest"])
    expect(orderTags(po({ tags: { lowComp: { n: 2, why: "قليلة" } } }))).toEqual(["short_competition"])
    expect(orderTags(po({ shortCompetition: true }))).toEqual(["short_competition"])
    expect(orderTags(po({ basis: "direct", tags: { directOver: { why: "عاجل" } } }))).toEqual(["direct_over"])
    expect(orderTags(po({ lines: [line({ unitPrice: null })] }))).toEqual(["lump"])
    expect(orderTags(po({ noVat: true, vatRate: 0 }))).toEqual(["unregistered"])
  })

  it("a direct order's reason is not a «not the lowest» award", () => {
    expect(orderTags(po({ basis: "direct", awardReasonText: "لا عروض" }))).toEqual([])
  })
})

describe("tags and sites as columns and as filters", () => {
  const orders = [
    po({ id: "a", supplierOrgId: "s1", supplierName: "الأول", tags: { notLowest: { why: "x" } } }),
    po({ id: "b", supplierOrgId: "s1", supplierName: "الأول", lines: [line({ unitPrice: null })] }),
    po({ id: "c", supplierOrgId: "s2", supplierName: "الثاني", noVat: true, vatRate: 0 }),
    po({ id: "d", supplierOrgId: "s2", supplierName: "الثاني" }),
  ]
  const sites: Record<string, string[]> = { a: ["site1"], b: ["site1"], c: ["site2"], d: [] }
  const siteOf = (p: PurchaseOrder) => sites[p.id] || []

  it("the supplier and project rows count their orders by tag", () => {
    const sup = spendBySupplier(world(orders), PERIOD, NOW)
    const first = sup.rows.find((r) => r.supplierName === "الأول")!
    expect(first.tags).toMatchObject({ not_lowest: 1, lump: 1, unregistered: 0 })
    expect(sup.rows.find((r) => r.supplierName === "الثاني")!.tags.unregistered).toBe(1)
    expect(spendByProject(world(orders), PERIOD).rows[0].tags).toMatchObject({ not_lowest: 1, lump: 1, unregistered: 1 })
  })

  it("a tag filter leaves only the orders that carry it — in every order-based report", () => {
    const f: ReportFilter = { ...PERIOD, tag: "unregistered" }
    expect(committedOrders(world(orders), f).map((o) => o.id)).toEqual(["c"])
    expect(spendBySupplier(world(orders), f, NOW).rows.map((r) => r.supplierName)).toEqual(["الثاني"])
    expect(deliveryPerformance(world(orders), f, NOW).orders.map((o) => o.orderId)).toEqual(["c"])
    expect([...new Set(openCommitments(world(orders), NOW, { tag: "lump" }).rows.map((r) => r.orderId))]).toEqual(["b"])
  })

  it("a delivery-site filter leaves the orders that serve the site; «بلا موقع» the ones that name none", () => {
    expect(committedOrders(world(orders), { ...PERIOD, siteId: "site1", siteOf }).map((o) => o.id)).toEqual(["a", "b"])
    expect(committedOrders(world(orders), { ...PERIOD, siteId: "__no_site__", siteOf }).map((o) => o.id)).toEqual(["d"])
    expect(committedOrders(world(orders), { ...PERIOD, siteId: null, siteOf }).map((o) => o.id)).toEqual(["a", "b", "c", "d"])
  })

  it("the tag and the site together narrow further; the delivery and exception rows carry the site", () => {
    const f: ReportFilter = { ...PERIOD, tag: "lump", siteId: "site1", siteOf }
    expect(committedOrders(world(orders), f).map((o) => o.id)).toEqual(["b"])
    const d = deliveryPerformance(world(orders), { ...PERIOD, siteOf }, NOW).orders.find((o) => o.orderId === "a")!
    expect(d.siteIds).toEqual(["site1"])
    expect(d.tags).toEqual(["not_lowest"])
    const e = exceptions(world(orders), { ...PERIOD, siteOf }).find((r) => r.orderId === "a" && r.kind === "non_lowest")!
    expect(e.siteIds).toEqual(["site1"])
    expect(e.tags).toEqual(["not_lowest"])
  })
})

describe("exceptions: the direct order over the cap is its own kind, with its reason", () => {
  it("lists it once, as «مباشر فوق السقف», not also as a plain direct order", () => {
    const rows = exceptions(world([po({ id: "d", basis: "direct", rfqId: null, tags: { directOver: { why: "حاجة عاجلة" } } })]), PERIOD)
    expect(rows.map((r) => r.kind)).toEqual(["direct_over"])
    expect(rows[0].params).toEqual({ reason: "حاجة عاجلة" })
    expect(exceptions(world([po({ id: "d", basis: "direct", rfqId: null })]), PERIOD).map((r) => r.kind)).toEqual(["direct"])
  })

  it("the tag-set not-lowest and short-competition read the same as the award record", () => {
    const rows = exceptions(world([po({ tags: { notLowest: { why: "ضمان أطول" }, lowComp: { n: 2, why: "عرضان" } } })]), PERIOD)
    expect(rows.map((r) => r.kind).sort()).toEqual(["non_lowest", "short_competition"])
    expect(rows.find((r) => r.kind === "non_lowest")!.params.reason).toBe("ضمان أطول")
    expect(rows.find((r) => r.kind === "short_competition")!.params.count).toBe(2)
  })
})

describe("the drift report read as savings (التوفير عن آخر سعر)", () => {
  it("a later order below the last price is a saving; above it, higher; equal, flat", () => {
    const earlier = po({ id: "e", createdAt: "2026-08-01T08:00:00Z", lines: [line({ unitPrice: 1000 })] })
    const cheaper = po({ id: "c", createdAt: "2026-09-10T08:00:00Z", lines: [line({ unitPrice: 900 })] })
    const saved = savingsSummary(priceDrift(world([earlier, cheaper]), PERIOD))
    expect(saved).toEqual({ direction: "saved", amount: 1000, percent: 10 })
    const dearer = po({ id: "d", createdAt: "2026-09-10T08:00:00Z", lines: [line({ unitPrice: 1100 })] })
    expect(savingsSummary(priceDrift(world([earlier, dearer]), PERIOD))).toEqual({ direction: "higher", amount: 1000, percent: 10 })
    expect(savingsSummary(priceDrift(world([earlier]), PERIOD))).toMatchObject({ direction: "flat", amount: 0, percent: null })
  })
})

describe("without Finance: «مستلَم ودُفع — للمحاسب»", () => {
  const receipt = (over: Partial<ReceiptFact> = {}): ReceiptFact => ({ id: "d1", status: "confirmed", poId: "a", confirmedAt: "2026-09-18T06:00:00Z", lines: [], ...over }) as ReceiptFact
  it("per approved order: before VAT, the VAT, the total, what was accepted and what the buyer marked paid", () => {
    const paid = po({ id: "a", docNumber: "PO-2026/001", lines: [line({ quantity: 10, accepted: 4 })], paymentMark: { state: "paid", day: "2026-09-20" } } as never)
    const open = po({ id: "b", docNumber: "PO-2026/002", totalExVat: 5000, lines: [line({ quantity: 5, accepted: 0 })] })
    const r = receivedAndPaid(world([paid, open], [receipt()]), PERIOD)
    expect(r.rows.map((x) => [x.docNumber, x.exVat, x.vat, x.total, x.received, x.payment, x.paidDay])).toEqual([
      ["PO-2026/001", 10000, 1500, 11500, 4000, "paid", "2026-09-20"],
      ["PO-2026/002", 5000, 750, 5750, 0, "unpaid", null],
    ])
    expect(r.totals).toEqual({ exVat: 15000, vat: 2250, total: 17250, received: 4000, paid: 11500 })
  })

  it("leaves out an order awaiting approval or cancelled, one approved outside the period, and honours the tag filter", () => {
    const orders = [po({ id: "a" }), po({ id: "w", status: "awaiting_approval", approvedAt: null }), po({ id: "x", status: "cancelled" }), po({ id: "o", approvedAt: "2026-08-02T08:00:00Z" }), po({ id: "u", noVat: true, vatRate: 0 })]
    expect(receivedAndPaid(world(orders), PERIOD).rows.map((x) => x.orderId).sort()).toEqual(["a", "u"])
    expect(receivedAndPaid(world(orders), { ...PERIOD, tag: "unregistered" }).rows.map((x) => x.orderId)).toEqual(["u"])
  })
})

describe("G-11 / G-18: the seven reports in the prototype's words, each money column stating its basis", () => {
  const load = (l: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", `${l}.json`), "utf8")) as { Portal: { ProcReports: { report: Record<string, string>; basis: { excl: string }; tag: Record<string, string>; cols: Record<string, string> } } }
  const ar = load("ar").Portal.ProcReports
  const en = load("en").Portal.ProcReports

  it("the Arabic names are the prototype's", () => {
    expect(REPORT_IDS).toHaveLength(7)
    expect([ar.report.supplier, ar.report.project, ar.report.project_site, ar.report.delivery, ar.report.cycle, ar.report.exceptions, ar.report.drift, ar.report.commitments, ar.report.commitments_nofin]).toEqual([
      "ما اشتريناه بحسب المورد",
      "بحسب المشروع والجهة",
      "بحسب موقع التسليم",
      "الالتزام بالمواعيد",
      "المنافسة على الطلبات",
      "الاستثناءات",
      "التوفير عن آخر سعر",
      "الالتزامات والمستحقات",
      "مستلَم ودُفع — للمحاسب",
    ])
  })

  it("the English names are the prototype's", () => {
    expect([en.report.supplier, en.report.project, en.report.project_site, en.report.delivery, en.report.cycle, en.report.exceptions, en.report.drift, en.report.commitments, en.report.commitments_nofin]).toEqual([
      "Spend by supplier",
      "By project and party",
      "By delivery location",
      "On-time delivery",
      "Competition on RFQs",
      "Exceptions",
      "Savings vs last price",
      "Commitments and dues",
      "Received and paid — for the accountant",
    ])
  })

  it("the basis is stated in both languages, and every tag has a word", () => {
    expect(ar.basis.excl).toBe("قبل الضريبة")
    expect(en.basis.excl).toBe("before VAT")
    for (const tag of ORDER_TAGS) {
      expect(ar.tag[tag]).toBeTruthy()
      expect(en.tag[tag]).toBeTruthy()
    }
  })
})
