/**
 * Procurement PRD 3.0 — the orders screen's own helpers (PoModel): segments
 * and their counts, the honest date, the line bar's partition, the ready
 * message, the print models. Pure over the domain; the clock is a parameter.
 */

import {
  buildPoPrintModel,
  buildSendMessage,
  buildStatementModel,
  canCancelOrder,
  honestDate,
  inSegment,
  lineActions,
  lineParts,
  mailtoUrl,
  moneyTrail,
  segmentCounts,
  sortOrders,
  visibleOrders,
  whatsappNumber,
  whatsappUrl,
} from "@/components/procurement/PoModel"
import type { PoLine, ProcActor, PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"

const NOW = new Date("2026-09-22T09:00:00+03:00")

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "أسمنت", unit: "كيس", quantity: 100, unitPrice: 20, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po1",
  organizationId: "org",
  docNumber: "PO-2026/014",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "مواد الأساسات",
  offerId: "o1",
  projectId: "p1",
  projectName: "برج النخيل",
  supplierOrgId: "sup1",
  supplierUserId: "u-sup",
  supplierName: "شركة الأفق",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 2000,
  vatRate: 0.15,
  offersCount: 3,
  lowestOfferTotal: 2000,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: "u1",
  preparedByName: "سعد",
  createdAt: "2026-09-01T08:00:00.000Z",
  approverKind: "manager",
  approvedById: "u2",
  approvedByName: "منى",
  approvedAt: "2026-09-02T08:00:00.000Z",
  sentAt: "2026-09-03T08:00:00.000Z",
  sentChannel: "portal",
  supplierAcceptedAt: "2026-09-04T08:00:00.000Z",
  promisedDate: "2026-09-30",
  log: [],
  ...over,
})

const actor = (over: Partial<ProcActor> = {}): ProcActor => ({ uid: "u1", name: "سعد", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true, ...over })

const display = (n: string) => n.replace("PO", "ط.ش")

describe("segments", () => {
  const awaiting = po({ id: "a", status: "awaiting_approval", approvedAt: null, promisedDate: null })
  const approved = po({ id: "b", status: "approved", promisedDate: null })
  const late = po({ id: "c", promisedDate: "2026-09-10" })
  const received = po({ id: "d", lines: [line({ accepted: 100 })] })
  const closed = po({ id: "e", status: "closed" })
  const cancelled = po({ id: "f", status: "cancelled" })
  const all = [awaiting, approved, late, received, closed, cancelled]

  it("routes every state to its segment; late is a subset of live", () => {
    expect(inSegment(awaiting, "awaiting_approval", NOW)).toBe(true)
    expect(inSegment(approved, "live", NOW)).toBe(true)
    expect(inSegment(late, "live", NOW)).toBe(true)
    expect(inSegment(late, "late", NOW)).toBe(true)
    expect(inSegment(approved, "late", NOW)).toBe(false)
    expect(inSegment(received, "received", NOW)).toBe(true)
    expect(inSegment(received, "live", NOW)).toBe(false)
    expect(inSegment(closed, "received", NOW)).toBe(true)
    expect(inSegment(cancelled, "received", NOW)).toBe(true)
  })

  it("counts", () => {
    expect(segmentCounts(all, NOW)).toEqual({ awaiting_approval: 1, live: 2, late: 1, received: 3, all: 6 })
  })

  it("a search spans every segment and folds Arabic", () => {
    expect(visibleOrders(all, "live", "افق", NOW, display).map((o) => o.id)).toHaveLength(6)
    expect(visibleOrders(all, "live", "ط.ش-2026", NOW, display)).toHaveLength(6)
    expect(visibleOrders(all, "live", "لا شيء", NOW, display)).toHaveLength(0)
    expect(visibleOrders(all, "late", "", NOW, display).map((o) => o.id)).toEqual(["c"])
  })

  it("sorts by the supplier's date, undated last", () => {
    const ids = sortOrders([approved, late, po({ id: "z", promisedDate: "2026-10-05" })]).map((o) => o.id)
    expect(ids).toEqual(["c", "z", "b"])
  })
})

describe("the honest date", () => {
  it("names why there is no date before the supplier promised one", () => {
    expect(honestDate(po({ status: "awaiting_approval", approverKind: "owner" }), NOW)).toEqual({ kind: "with_approver", approver: "owner" })
    expect(honestDate(po({ status: "approved" }), NOW)).toEqual({ kind: "not_sent" })
    expect(honestDate(po({ status: "sent" }), NOW)).toEqual({ kind: "no_acceptance" })
    expect(honestDate(po({ promisedDate: null }), NOW)).toEqual({ kind: "no_date" })
  })
  it("shows the promise, with lateness only while goods are owed", () => {
    expect(honestDate(po({ promisedDate: "2026-09-10" }), NOW)).toEqual({ kind: "promised", date: "2026-09-10", daysLate: 12 })
    expect(honestDate(po({ promisedDate: "2026-09-10", lines: [line({ accepted: 100 })] }), NOW)).toEqual({ kind: "promised", date: "2026-09-10", daysLate: 0 })
    expect(honestDate(po({ status: "closed", closedAt: "2026-09-20T10:00:00Z" }), NOW)).toEqual({ kind: "closed", date: "2026-09-20" })
    expect(honestDate(po({ status: "cancelled" }), NOW)).toEqual({ kind: "cancelled" })
  })
})

describe("line parts", () => {
  it("partitions the ordered quantity exactly", () => {
    const p = lineParts(line({ accepted: 40, held: 10, rejected: 5, cancelled: 20 }))
    expect(p).toEqual({ ordered: 100, accepted: 40, held: 10, rejected: 5, cancelled: 20, toArrive: 25 })
    expect(p.accepted + p.held + p.rejected + p.cancelled + p.toArrive).toBe(p.ordered)
  })
  it("a decided reject leaves the rejected segment", () => {
    expect(lineParts(line({ rejected: 5, rejectDecision: "replace" })).rejected).toBe(0)
    expect(lineParts(line({ rejected: 5, rejectDecision: "replace" })).toArrive).toBe(100)
  })
})

describe("what may happen", () => {
  it("line actions follow the state and the permission", () => {
    const a = actor()
    expect(lineActions(po(), line({ rejected: 5 }), a)).toEqual({ cancelRemainder: true, decideReject: true })
    expect(lineActions(po(), line({ rejected: 5, rejectDecision: "reduce" }), a).decideReject).toBe(false)
    expect(lineActions(po(), line({ accepted: 100 }), a).cancelRemainder).toBe(false)
    expect(lineActions(po(), line({ rejected: 5 }), actor({ canPrepare: false, canApprove: false })).decideReject).toBe(false)
    expect(lineActions(po({ status: "sent" }), line({ rejected: 5 }), a).cancelRemainder).toBe(false)
  })
  it("the whole order cancels only before anything arrived", () => {
    expect(canCancelOrder(po({ status: "sent" }), actor())).toBe(true)
    expect(canCancelOrder(po({ lines: [line({ accepted: 1 })] }), actor())).toBe(false)
    expect(canCancelOrder(po({ status: "closed" }), actor())).toBe(false)
    expect(canCancelOrder(po({ status: "sent" }), actor({ canPrepare: false }))).toBe(false)
  })
})

describe("money trail", () => {
  it("ex-VAT, VAT, commitment, accepted ceiling, open", () => {
    expect(moneyTrail(po({ lines: [line({ accepted: 40, cancelled: 10 })] }))).toEqual({ exVat: 1800, vat: 270, commitment: 2070, accepted: 800, open: 1000, lumpSum: false })
  })
  it("a lump sum never invents a proportional figure", () => {
    const m = moneyTrail(po({ lines: [line({ unitPrice: null, accepted: 40 })], totalExVat: 5000 }))
    expect(m).toMatchObject({ exVat: 5000, accepted: null, open: 5000, lumpSum: true })
  })
})

describe("the ready message", () => {
  const input = { number: "PO-2026/014", orgName: "آفاق فنية", lines: [{ name: "أسمنت", quantity: 100, unit: "كيس" }] }
  it("Arabic, with the value when the sender may see it", () => {
    const s = buildSendMessage({ ...input, locale: "ar", commitment: 2300 })
    expect(s).toContain("أمر شراء PO-2026/014 من آفاق فنية بقيمة 2,300 ر.س شاملاً الضريبة.")
    expect(s).toContain("• أسمنت — 100 كيس")
    expect(s).toContain("نرجو تأكيد القبول وموعد التوريد.")
    expect(s).not.toContain("⃁")
  })
  it("English, without a value for an expediter, with the portal link and a note", () => {
    const s = buildSendMessage({ ...input, locale: "en", commitment: null, portalUrl: "https://mdmaktech.sa/supplier/orders?po=po1", note: "Deliver in the morning" })
    expect(s.startsWith("Deliver in the morning\n\nPurchase order PO-2026/014 from آفاق فنية.")).toBe(true)
    expect(s).not.toContain("SAR")
    expect(s).toContain("https://mdmaktech.sa/supplier/orders?po=po1")
    expect(s.endsWith("Please confirm acceptance and the delivery date.")).toBe(true)
  })
  it("phone normalisation and the two URLs", () => {
    expect(whatsappNumber("0501234567")).toBe("966501234567")
    expect(whatsappNumber("+966 50 123 4567")).toBe("966501234567")
    expect(whatsappNumber("00966501234567")).toBe("966501234567")
    expect(whatsappUrl("0501234567", "hi there")).toBe("https://wa.me/966501234567?text=hi%20there")
    expect(mailtoUrl("a@b.co", "S", "B")).toBe("mailto:a%40b.co?subject=S&body=B")
  })
})

describe("print models", () => {
  const company = { name: "آفاق فنية", cr: "1010", vat: "3000" }
  it("the PO with prices, and the expediter's copy without", () => {
    const priced = buildPoPrintModel(po({ lines: [line({ cancelled: 10 })] }), company, true)
    expect(priced.lines[0]).toMatchObject({ quantity: 90, unitPrice: 20, total: 1800 })
    expect(priced).toMatchObject({ exVat: 1800, vat: 270, total: 2070, date: "2026-09-02", approvedBy: "منى", selfApproved: false })
    const blank = buildPoPrintModel(po(), company, false)
    expect(blank.withPrices).toBe(false)
    expect(blank.lines[0].unitPrice).toBeNull()
    expect(blank.total).toBeNull()
  })
  it("a lump sum prints no unit prices even for a viewer who sees money", () => {
    const m = buildPoPrintModel(po({ lines: [line({ unitPrice: null })], totalExVat: 5000 }), company, true)
    expect(m.lumpSum).toBe(true)
    expect(m.lines[0].unitPrice).toBeNull()
    expect(m.exVat).toBe(5000)
  })
  it("the statement: quantities per line and the receipts oldest first", () => {
    const receipts: ReceiptFact[] = [
      { id: "d2", status: "confirmed", poId: "po1", docNumber: "GR-2026/002", confirmedAt: "2026-09-15T10:00:00Z", lines: [{ poLineId: "l1", name: "أسمنت", unit: "كيس", noticeQuantity: 30, accepted: 30 }] },
      { id: "d1", status: "confirmed", poId: "po1", docNumber: "GR-2026/001", confirmedAt: "2026-09-10T10:00:00Z", lines: [{ poLineId: "l1", name: "أسمنت", unit: "كيس", noticeQuantity: 30, accepted: 25, rejected: 5 }] },
      { id: "x", status: "pending_confirmation", poId: "po1", deliveryDate: "2026-09-25" },
    ]
    const m = buildStatementModel(po({ lines: [line({ accepted: 55, rejected: 5 })] }), receipts, company, NOW)
    expect(m.receipts.map((r) => r.number)).toEqual(["GR-2026/001", "GR-2026/002"])
    expect(m.receipts[0]).toMatchObject({ accepted: 25, rejected: 5, date: "2026-09-10" })
    expect(m.lines[0]).toMatchObject({ ordered: 100, accepted: 55, rejected: 5, outstanding: 45 })
    expect(m.complete).toBe(false)
    expect(m.outstanding).toEqual([{ name: "أسمنت", quantity: 45, unit: "كيس" }])
  })
})
