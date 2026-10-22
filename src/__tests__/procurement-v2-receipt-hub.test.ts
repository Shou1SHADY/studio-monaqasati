/**
 * Procurement 2.0 — the receipts hub «سندات الاستلام» (PRD 2.0 §7.2, prototype `viewRcv`, WP-S5-03a, RCV-02/04, G-01 style counts). Five
 * segments over the same documents: IN TRANSIT (every open notice), AWAITING YOUR FORWARD (nobody told yet), AWAITING COUNT (forwarded and
 * the delivery day reached), RECEIPTS and NO PO. A notice is a day and a note — its number is the stored sequence, and a notice written
 * before that is still read. The printed receipt is digital: no signature boxes, one line saying who recorded it, when and how.
 */

import {
  RECEIPT_SEGMENTS,
  forwardState,
  noticeNumberOf,
  noticePill,
  noticeRows,
  noticeRowsOf,
  receiptRows,
  receiptSegment,
  recordedBy,
  segmentCounts,
  shipmentOrdinal,
  type DeskDelivery,
} from "@/lib/procurement/receipt-desk"
import { buildReceiptPrintHtml, receiptDocumentHtml, receiptPrintInputFromFacts, type ReceiptPrintFacts, type ReceiptPrintInput } from "@/lib/procurement/receipt-print"
import { linesForReceipt } from "@/lib/procurement/receipts"
import type { PurchaseOrder } from "@/lib/procurement/types"

const NOW = new Date("2026-10-21T09:00:00Z")
const fwd = (over: Record<string, unknown> = {}) => ({ linkId: "lk", name: "سامي", userId: "rcv", phoneMasked: "05••", byName: "ريم", at: "2026-10-19T08:00:00Z", ...over })
const notice = (id: string, over: Record<string, unknown> = {}): DeskDelivery =>
  ({ id, status: "pending_confirmation", poId: "po1", poNumber: "PO-2026/021", supplierName: "مصنع الجودة", deliveryDate: "2026-10-23T00:00:00.000Z", seq: 1, ...over }) as DeskDelivery
const po = (over: Record<string, unknown> = {}): PurchaseOrder =>
  ({ id: "po1", organizationId: "o", docNumber: "PO-2026/021", status: "accepted", supplierName: "مصنع الجودة", rfqTitle: "حديد", lines: [{ id: "l1", name: "حديد 12 مم", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0 }], log: [], ...over }) as unknown as PurchaseOrder

describe("the five segments add up — one road, one receiver", () => {
  const all = [
    notice("a", { deliveryDate: "2026-10-25T00:00:00.000Z" }),
    notice("b", { deliveryDate: "2026-10-22T00:00:00.000Z", forwardedTo: fwd() }),
    notice("c", { deliveryDate: "2026-10-21T00:00:00.000Z", forwardedTo: fwd() }),
    notice("d", { deliveryDate: "2026-10-19T00:00:00.000Z", forwardedTo: fwd({ auto: true }) }),
    notice("closed", { closedByReceipt: { deliveryId: "x", docNumber: "GR-1" } }),
    notice("cancelledPo", { poId: "po2" }),
    { id: "r1", status: "confirmed", poId: "po1", docNumber: "GR-2026/001", deliveryDate: "2026-10-18", confirmedAt: "2026-10-18T10:00:00Z", lines: [{ poLineId: "l1", name: "x", unit: "u", noticeQuantity: 0, counted: 2, accepted: 2 }] } as DeskDelivery,
    { id: "m1", status: "confirmed", source: "manual", docNumber: "GR-2026/002", deliveryDate: "2026-10-18", confirmedAt: "2026-10-18T11:00:00Z", items: [{ name: "مسامير", quantity: 5, unit: "كجم" }] } as DeskDelivery,
  ]
  const orders = [po(), po({ id: "po2", status: "cancelled" })]
  const counts = segmentCounts(all, orders, { term: "", projectId: null }, NOW)

  it("names the five and counts them: transit = every open notice (a closed one and one on a cancelled order are not)", () => {
    expect(RECEIPT_SEGMENTS).toEqual(["transit", "fwd", "count", "recs", "nopo"])
    expect(counts).toEqual({ transit: 4, fwd: 1, count: 2, recs: 1, nopo: 1 })
  })

  it("awaiting-forward = no receiver told; awaiting-count = forwarded and the day reached (today or earlier); the rest is on the way", () => {
    const rows = noticeRows(all, orders, NOW, 2)
    expect(noticeRowsOf("fwd", rows).map((r) => r.delivery.id)).toEqual(["a"])
    expect(noticeRowsOf("count", rows).map((r) => r.delivery.id)).toEqual(["d", "c"])
    expect(rows.map((r) => [r.delivery.id, r.stage])).toEqual([["d", "count"], ["c", "count"], ["b", "transit"], ["a", "fwd"]])
    expect(counts.fwd + counts.count).toBeLessThanOrEqual(counts.transit)
  })

  it("a confirmed delivery is a receipt, or «no PO» when it is a manual one naming no order", () => {
    expect(all.map((d) => receiptSegment(d))).toEqual(["transit", "transit", "transit", "transit", "transit", "transit", "recs", "nopo"])
    expect(receiptRows(all, orders, "recs", NOW).map((r) => r.delivery.id)).toEqual(["r1"])
    expect(receiptRows(all, orders, "nopo", NOW).map((r) => r.delivery.id)).toEqual(["m1"])
  })

  it("the search and the place filter narrow every segment alike", () => {
    expect(segmentCounts(all, orders, { term: "مسامير", projectId: null }, NOW)).toEqual({ transit: 0, fwd: 0, count: 0, recs: 0, nopo: 1 })
    expect(segmentCounts(all, orders, { term: "مصنع الجودة", projectId: null }, NOW).transit).toBe(4)
  })
})

describe("the row's pill — what Procurement can do about it", () => {
  const rows = (d: DeskDelivery) => noticeRows([d], [po()], NOW, 2)[0]
  it("unforwarded is ours (red from its day on, amber before); forwarded and past the window is red; auto-forwarded is tagged; else how far off", () => {
    expect(noticePill(rows(notice("a")))).toEqual({ kind: "to_forward", tone: "warn" })
    expect(noticePill(rows(notice("a", { deliveryDate: "2026-10-21T00:00:00.000Z" })))).toEqual({ kind: "to_forward", tone: "bad" })
    expect(noticePill(rows(notice("a", { deliveryDate: "2026-10-17T00:00:00.000Z", forwardedTo: fwd() })))).toEqual({ kind: "escalate", days: 4 })
    expect(noticePill(rows(notice("a", { deliveryDate: "2026-10-21T00:00:00.000Z", forwardedTo: fwd() })))).toEqual({ kind: "uncounted", days: 0 })
    expect(noticePill(rows(notice("a", { forwardedTo: fwd({ auto: true }) })))).toEqual({ kind: "auto_forwarded" })
    expect(noticePill(rows(notice("a", { forwardedTo: fwd() })))).toEqual({ kind: "in_days", days: 2 })
  })

  it("a forwarded notice is `forwarded`; there is no «signed» state any more — his confirmation IS the receipt", () => {
    expect(forwardState(notice("a"))).toBe("none")
    expect(forwardState(notice("a", { forwardedTo: fwd() }))).toBe("forwarded")
  })
})

describe("NFR-07 — two trucks on one day are two notices: REP1 · REP2 by the stored sequence", () => {
  const a = notice("a", { seq: 1 })
  const b = notice("b", { seq: 2 })
  it("the number is the stored sequence; «shipment n of m» says m once the order has two", () => {
    expect(noticeNumberOf(a, [a, b], po())).toBe("ASN-2026/021-1")
    expect(noticeNumberOf(b, [a, b], po())).toBe("ASN-2026/021-2")
    expect(shipmentOrdinal(b, [a, b], po())).toEqual({ n: 2, m: 2 })
    expect(shipmentOrdinal(a, [a], po())).toBeNull()
  })

  it("a notice written before the sequence existed is numbered by the order it was written in", () => {
    const old1 = notice("o1", { seq: null, createdAt: "2026-10-01T08:00:00Z" })
    const old2 = notice("o2", { seq: undefined, createdAt: "2026-10-02T08:00:00Z" })
    expect(noticeNumberOf(old2, [old1, old2], po())).toBe("ASN-2026/021-2")
  })
})

describe("G-08 — the readers cope with a notice that names no quantity, and with an old one that still does", () => {
  it("a notice with no lines counts against the order's open lines with NO figure to compare to; a legacy notice keeps its own", () => {
    expect(linesForReceipt({}, po())).toEqual([{ poLineId: "l1", name: "حديد 12 مم", unit: "طن", noticeQuantity: 0 }])
    expect(linesForReceipt({ lines: [{ poLineId: "l1", name: "حديد", unit: "طن", noticeQuantity: 6 }] }, po())[0].noticeQuantity).toBe(6)
    expect(() => noticeRows([notice("legacy", { lines: [{ poLineId: "l1", name: "x", unit: "u", noticeQuantity: 6 }] })], [po()], NOW, 2)).not.toThrow()
  })

  it("who recorded a receipt: the module that received it (stored), else the module that keeps the place; a manual one is Procurement's", () => {
    expect(recordedBy({ source: null, receiverModule: "projects" }, "inv")).toBe("projects")
    expect(recordedBy({ source: null }, "prj")).toBe("projects")
    expect(recordedBy({ source: null }, "inv")).toBe("inventory")
    expect(recordedBy({ source: "manual", receiverModule: "inventory" }, "inv")).toBe("procurement")
  })
})

describe("RCV-04 — the receipt PDF is digital: no signature boxes", () => {
  const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(",")}` : k)
  const base = (d: Partial<DeskDelivery> = {}): ReceiptPrintInput => ({
    delivery: { id: "r1", status: "confirmed", docNumber: "GR-2026/001", poId: "po1", poNumber: "PO-2026/021", supplierName: "مصنع الجودة", receivedByName: "سامي الدوسري", confirmedAt: "2026-10-21T08:30:00Z", deliveryDate: "2026-10-20", confirmedVia: "login", lines: [{ poLineId: "l1", name: "حديد 12 مم", unit: "طن", noticeQuantity: 0, counted: 3, rejected: 1, rejectReason: "damaged", accepted: 2 }], ...d } as DeskDelivery,
    po: po(),
    company: { name: "شركة المقاول" },
    placeName: "مستودع البرج",
    projectName: "برج العليا",
    displayNumber: "ا.س-2026/001",
    displayPoNumber: "ط.ش-2026/021",
    withPrices: false,
    locale: "ar",
    t,
    tp: t,
    now: NOW,
  })

  it("no .pdsg block, no signature caption, no «per notice» column; one line says who, when and how", () => {
    const html = buildReceiptPrintHtml(base())
    expect(html).not.toMatch(/pdsg|sig_supplier|sig_receiver|sig_procurement|col_per_notice|class="line"/)
    expect(html).toContain("registered_by")
    expect(html).toContain("سامي الدوسري")
    expect(html).toContain("via_login")
    expect(html).toContain("no_signature_note")
    expect(buildReceiptPrintHtml(base({ confirmedVia: "sms_code" }))).toContain("via_code")
    expect(buildReceiptPrintHtml(base({ source: "manual", confirmedByName: "بدر" }))).toContain("registered_by_procurement")
  })

  it("the archive version of the document does not open the print dialog by itself", () => {
    expect(receiptDocumentHtml(base(), { autoPrint: true })).toContain("window.print()")
    expect(receiptDocumentHtml(base(), { autoPrint: false })).not.toContain("window.print()")
  })

  it("the receiver's own copy is built from the facts the confirm returned — the order's remainder included, no order document needed", () => {
    const facts: ReceiptPrintFacts = { docNumber: "GR-2026/001", supplierName: "مصنع الجودة", poNumber: "PO-2026/021", rfqTitle: "حديد", receiverName: "سامي", at: "2026-10-21T08:30:00Z", lines: base().delivery.lines || [], placeName: "مستودع البرج", selfReceived: false, companyName: "شركة المقاول", via: "sms_code", complete: false, remaining: [{ name: "حديد 12 مم", unit: "طن", quantity: 8 }] }
    const html = buildReceiptPrintHtml(receiptPrintInputFromFacts(facts, { locale: "ar", displayNumber: "ا.س-2026/001", displayPoNumber: "ط.ش-2026/021", t, tp: t, now: NOW }))
    expect(html).toContain("status_partial")
    expect(html).toContain("8 طن حديد 12 مم")
    expect(html).toContain("via_code")
    expect(html).not.toContain("status_no_po")
  })
})
