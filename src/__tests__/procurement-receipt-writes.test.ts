/**
 * Procurement PRD 2.0 — the receipt's rules and the desk's pure helpers. The WRITE of a receipt is no longer Procurement's: the receiver's
 * confirmation makes it on the server (`procurement-v2-receipt-confirm.test.ts` — recordReceipt, the arrival with no notice and the manual
 * form it replaced are tested there, as routes and as the core). What stays here: the rules the count is checked by (pure), what Procurement
 * can still write from the browser on a receipt with no order (rule it a cash expense), the desk's segments and counts, and the printed receipt.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)
jest.mock("@/lib/accounting/hooks", () => ({ onGoodsReceived: jest.fn(() => undefined) }))

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { DEFAULT_POLICIES, type DeliveryLine, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import { ProcWriteError } from "@/lib/procurement/writes"
import { markReceiptAsExpense } from "@/lib/procurement/receipt-writes"
import { countedLines, stockItemsOf, trimNotices, validateReceiptLines } from "@/lib/procurement/receipt-count"
import { legacyLinesOf, linesForReceipt } from "@/lib/procurement/receipts"
import { noticeRows, receiptRows, receiptSegment, segmentCounts, type DeskDelivery } from "@/lib/procurement/receipt-desk"
import { buildReceiptPrintHtml } from "@/lib/procurement/receipt-print"

const db = fakeFirestore as unknown as Firestore
const NOW = new Date("2026-09-22T09:00:00Z")
const ORG = "owner-uid"

const gate: ProcActor = { uid: "gate", name: "Salma", isOwner: false, canApprove: false, canPrepare: false, canExpedite: false, canReceive: true, seesPrices: false }
const buyer: ProcActor = { ...gate, uid: "buyer", name: "Badr", canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true }
const nobody: ProcActor = { ...gate, uid: "x", name: "X", canReceive: false }

function order(over: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: "po1",
    organizationId: ORG,
    docNumber: "PO-2026/001",
    status: "accepted",
    basis: "rfq",
    rfqId: "rfq1",
    rfqTitle: "حديد تسليح",
    offerId: "of1",
    projectId: "p1",
    projectName: "برج",
    purchaseSource: { kind: "mfg_purchase", workOrderId: "wo1", purchaseRequestId: "pr1" },
    supplierOrgId: "sup-org",
    supplierUserId: "sup-user",
    supplierName: "شركة الحديد",
    isGuestSupplier: false,
    lines: [
      { id: "l1", name: "حديد 12مم", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0 },
      { id: "l2", name: "حديد 16مم", unit: "طن", quantity: 5, unitPrice: 3200, accepted: 0, rejected: 0, held: 0, cancelled: 0 },
    ],
    totalExVat: 46000,
    vatRate: 0.15,
    offersCount: 2,
    lowestOfferTotal: 46000,
    shortCompetition: false,
    noOfficialQuote: false,
    preparedById: "buyer",
    preparedByName: "Badr",
    createdAt: "2026-09-01T00:00:00Z",
    approverKind: "manager",
    supplierAcceptedAt: "2026-09-02T00:00:00Z",
    promisedDate: "2026-09-20",
    log: [],
    ...over,
  }
}

beforeEach(() => {
  resetFakeDb()
  jest.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Pure pieces
// ─────────────────────────────────────────────────────────────────────────────

describe("lines for the count", () => {
  it("a legacy delivery's items become lines counted in full; a notice with lines keeps them; an order alone gives its open lines with no notice figure (G-08)", () => {
    const legacy = legacyLinesOf({ items: [{ name: "أسمنت", quantity: "50", unitOfMeasure: "كيس" }, { name: "", quantity: 3 }] })
    expect(legacy).toEqual([{ poLineId: "i1", name: "أسمنت", unit: "كيس", noticeQuantity: 50, counted: 50 }])
    expect(linesForReceipt({ lines: [{ poLineId: "l1", name: "x", unit: "u", noticeQuantity: 4, counted: 99 }] }, null)).toEqual([{ poLineId: "l1", name: "x", unit: "u", noticeQuantity: 4 }])
    const fromPo = linesForReceipt({}, order({ lines: [{ id: "l1", name: "a", unit: "u", quantity: 10, unitPrice: 1, accepted: 10, rejected: 0, held: 0, cancelled: 0 }, { id: "l2", name: "b", unit: "u", quantity: 5, unitPrice: 1, accepted: 0, rejected: 0, held: 0, cancelled: 0 }] }))
    expect(fromPo).toEqual([{ poLineId: "l2", name: "b", unit: "u", noticeQuantity: 0 }])
  })

  it("countedLines skips blank lines, computes accepted and drops reasons that have no quantity", () => {
    const out = countedLines([
      { poLineId: "l1", name: "a", unit: "u", noticeQuantity: 6, counted: 6, rejected: 1, rejectReason: "damaged", held: 2, holdReason: "test" },
      { poLineId: "l2", name: "b", unit: "u", noticeQuantity: 5, rejectReason: "damaged" },
      { poLineId: "l3", name: "c", unit: "u", noticeQuantity: 5, counted: 5, rejected: 0, rejectReason: "damaged" },
    ])
    expect(out.map((l) => l.poLineId)).toEqual(["l1", "l3"])
    expect(out[0]).toMatchObject({ accepted: 3, rejected: 1, held: 2, rejectReason: "damaged", holdReason: "test" })
    expect(out[1]).toMatchObject({ accepted: 5, rejectReason: null })
  })

  it("«نقص في العبوة» is a rejection reason like the others", () => {
    const out = countedLines([{ poLineId: "l1", name: "a", unit: "u", noticeQuantity: 0, counted: 10, rejected: 2, rejectReason: "short" }])
    expect(out[0]).toMatchObject({ rejectReason: "short", accepted: 8 })
    expect(validateReceiptLines(order(), out, DEFAULT_POLICIES)).toEqual([])
  })

  it("validateReceiptLines: over-receipt beyond the tolerance is refused, on the order's numbers", () => {
    const errs = validateReceiptLines(order(), [{ poLineId: "l1", name: "a", unit: "u", noticeQuantity: 0, counted: 11 }], DEFAULT_POLICIES)
    expect(errs).toEqual([{ code: "over_receipt", poLineId: "l1", params: { counted: 11, limit: 10.5, outstanding: 10, tolerance: 5 } }])
    expect(validateReceiptLines(order(), [{ poLineId: "l1", name: "a", unit: "u", noticeQuantity: 0, counted: 10.5 }], DEFAULT_POLICIES)).toEqual([])
    expect(validateReceiptLines(null, [{ poLineId: "i1", name: "a", unit: "u", noticeQuantity: 6 }], DEFAULT_POLICIES)).toEqual([{ code: "nothing_counted", params: {} }])
  })

  it("stockItemsOf: accepted quantity at the order's unit price; a one-line legacy lot gets its price per unit; never a total split across lines", () => {
    const lines: DeliveryLine[] = [
      { poLineId: "l1", name: "a", unit: "طن", noticeQuantity: 0, counted: 6, rejected: 1, held: 2 },
      { poLineId: "l2", name: "b", unit: "طن", noticeQuantity: 0, counted: 0 },
    ]
    expect(stockItemsOf(lines, order())).toEqual([{ name: "a", unit: "طن", quantity: 3, unitCost: 3000 }])
    expect(stockItemsOf([{ poLineId: "i1", name: "x", unit: "u", noticeQuantity: 4, counted: 4 }], null, 1000)).toEqual([{ name: "x", unit: "u", quantity: 4, unitCost: 250 }])
    expect(stockItemsOf([{ poLineId: "i1", name: "x", unit: "u", noticeQuantity: 4, counted: 4 }, { poLineId: "i2", name: "y", unit: "u", noticeQuantity: 1, counted: 1 }], null, 1000).map((i) => i.unitCost)).toEqual([null, null])
  })

  it("trimNotices: a notice that names a day and a note (no lines) is closed by the first receipt that counts anything, once; a legacy one is trimmed per line", () => {
    const received: DeliveryLine[] = [{ poLineId: "l1", name: "a", unit: "u", noticeQuantity: 0, counted: 4 }]
    expect(trimNotices([{ lines: [] }, { lines: [] }], received).map((t) => [t.closed, t.changed])).toEqual([[true, true], [false, false]])
    expect(trimNotices([{ lines: [] }], [{ poLineId: "l1", name: "a", unit: "u", noticeQuantity: 0, counted: 0 }]).map((t) => t.closed)).toEqual([false])
    const legacy = trimNotices([{ lines: [{ poLineId: "l1", name: "a", unit: "u", noticeQuantity: 6 }] }], received)
    expect(legacy[0]).toMatchObject({ closed: false, changed: true, lines: [{ noticeQuantity: 2 }] })
    expect(trimNotices([{ lines: [{ poLineId: "l1", name: "a", unit: "u", noticeQuantity: 4 }] }], received)[0]).toMatchObject({ closed: true })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// What Procurement may still write on a receipt: rule a no-PO receipt a cash expense
// ─────────────────────────────────────────────────────────────────────────────

describe("a receipt with no order, ruled a cash expense", () => {
  it("only Procurement (a buyer or the owner), only a manual receipt naming no order, only once", async () => {
    seed("users/owner-uid", { organizationId: ORG })
    seed("deliveries/m1", { contractorOrgId: ORG, source: "manual", status: "confirmed", docNumber: "GR-2026/001", supplierName: "محل الحي" })
    await expect(markReceiptAsExpense(db, gate, "m1")).rejects.toMatchObject({ code: "no_permission" })
    await markReceiptAsExpense(db, buyer, "m1", { now: NOW })
    expect(readDoc<{ regularisation: string; regularisedById: string }>("deliveries/m1")).toMatchObject({ regularisation: "expense", regularisedById: "buyer" })
    await expect(markReceiptAsExpense(db, buyer, "m1")).rejects.toMatchObject({ code: "not_no_po" })
    await expect(markReceiptAsExpense(db, nobody, "m1")).rejects.toBeInstanceOf(ProcWriteError)
    seed("deliveries/r1", { contractorOrgId: ORG, status: "confirmed", poId: "po1", docNumber: "GR-2026/002" })
    await expect(markReceiptAsExpense(db, buyer, "r1")).rejects.toMatchObject({ code: "not_no_po" })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The hub — segments, counts, print
// ─────────────────────────────────────────────────────────────────────────────

describe("the desk's pure helpers", () => {
  const pending: DeskDelivery = { id: "n1", status: "pending_confirmation", poId: "po1", supplierName: "شركة الحديد", deliveryDate: "2026-09-23", seq: 1 }
  const latePending: DeskDelivery = { id: "n2", status: "pending_confirmation", poId: null, offerId: "of3", supplierName: "مصنع", deliveryDate: "2026-09-10", items: [{ name: "أسمنت", quantity: 50, unit: "كيس" }] }
  const received: DeskDelivery = { id: "g1", status: "confirmed", poId: "po1", poNumber: "PO-2026/001", docNumber: "GR-2026/001", supplierName: "شركة الحديد", confirmedAt: "2026-09-21T10:00:00Z", receivedByName: "سلمى", landedWarehouseId: "wh-p1", projectId: "p1", lines: [{ poLineId: "l1", name: "حديد 12مم", unit: "طن", noticeQuantity: 0, counted: 6, rejected: 1, held: 2, accepted: 3, rejectReason: "damaged", holdReason: "test" }] }
  const manual: DeskDelivery = { id: "m1", status: "confirmed", source: "manual", docNumber: "GR-2026/002", supplierName: "محل الحي", deliveryDate: "2026-09-22", receivedByName: "بدر", items: [{ name: "زوايا", quantity: 20, unit: "حبة" }], noNotice: false }
  const legacy: DeskDelivery = { id: "o1", status: "confirmed", offerId: "of5", supplierName: "قديم", confirmedAt: "2026-08-01T00:00:00Z", items: [{ name: "رمل", quantity: 3, unit: "م3" }] }
  const all = [pending, latePending, received, manual, legacy]
  const orders = [order()]

  it("segments: pending → on the way; manual without an order → nopo; the rest → receipts", () => {
    expect(all.map(receiptSegment)).toEqual(["transit", "transit", "recs", "nopo", "recs"])
  })

  it("the notices still open, soonest day first, with the stage each is at", () => {
    const rows = noticeRows(all, orders, NOW)
    expect(rows.map((r) => r.id)).toEqual(["n:n2", "n:n1"])
    expect(rows[0]).toMatchObject({ state: "late_notice", stage: "fwd" })
    expect(rows[1]).toMatchObject({ state: "on_the_way", stage: "fwd", daysFromNow: 1 })
  })

  it("counts respect the search and the project filter across segments", () => {
    expect(segmentCounts(all, orders, { term: "", projectId: null }, NOW)).toEqual({ transit: 2, fwd: 2, count: 0, recs: 2, nopo: 1 })
    expect(segmentCounts(all, orders, { term: "حديد", projectId: null }, NOW)).toEqual({ transit: 1, fwd: 1, count: 0, recs: 1, nopo: 0 })
    expect(segmentCounts(all, orders, { term: "", projectId: "p1" }, NOW).recs).toBe(1)
  })

  it("the receipt rows carry the state and the flags", () => {
    const rows = receiptRows(all, orders, "recs", NOW)
    expect(rows.map((r) => r.delivery.id)).toEqual(["g1", "o1"])
    expect(rows[0]).toMatchObject({ state: "received_held", rejected: 1, held: 2, complete: false })
    expect(rows[1]).toMatchObject({ state: "received", complete: null })
    expect(receiptRows(all, orders, "nopo", NOW)[0]).toMatchObject({ state: "manual_no_po" })
  })

  it("the printed receipt: status banner, the quantity table, the checklist, no riyal glyph, value only for a reader who sees prices — and no signature boxes", () => {
    const t = (k: string, p?: Record<string, string | number>) => `[${k}${p ? ":" + Object.values(p).join("|") : ""}]`
    const base = { delivery: { ...received, checklist: ["delivery_note" as const], deliveryPersonName: "أبو خالد", vehiclePlate: "ABC 123" }, po: order(), company: { name: "النخبة", cr: "1010", vat: "3001" }, placeName: "مستودع البرج", projectName: "برج", displayNumber: "ا.س-2026/001", displayPoNumber: "ط.ش-2026/001", locale: "ar", t, tp: t, now: NOW }
    const html = buildReceiptPrintHtml({ ...base, withPrices: true })
    expect(html).toContain("[status_partial:")
    expect(html).toContain("[rejectReason.damaged]")
    expect(html).toContain("[holdReason.test]")
    expect(html).toContain("☑ [checklist.delivery_note]")
    expect(html).toContain("☐ [checklist.weighbridge]")
    expect(html).toContain("ABC 123")
    expect(html).not.toContain("[signature]")
    expect(html).not.toContain("[col_per_notice]")
    expect(html).toContain("[no_signature_note]")
    expect(html).toContain("9,000 ر.س") // 3 accepted × 3000
    expect(html).not.toMatch(/[⃁﷼]/)
    expect(buildReceiptPrintHtml({ ...base, withPrices: false })).not.toContain("9,000")
    const noPo = buildReceiptPrintHtml({ ...base, delivery: manual, po: null, withPrices: true })
    expect(noPo).toContain("[status_no_po]")
    expect(noPo).toContain("[title_no_po]")
    expect(noPo).toContain("[footer_no_po]")
    expect(noPo).toContain("[registered_by_procurement]")
  })

  it("the printed receipt names the supplier in full, our notice number and who forwarded it", () => {
    const t = (k: string, p?: Record<string, string | number>) => `[${k}${p ? ":" + Object.values(p).join("|") : ""}]`
    const fw = { linkId: "k", name: "ناصر", userId: null, phoneMasked: "•••12", byName: "Badr", at: "2026-09-20T08:00:00Z" }
    const base = { delivery: { ...received, paperNoteNumber: "DN-77", forwardedTo: fw, confirmedVia: "sms_code" as const }, po: order(), company: { name: "النخبة" }, placeName: null, projectName: null, displayNumber: "ا.س-2026/001", displayPoNumber: "ط.ش-2026/001", withPrices: false, locale: "ar", t, tp: t, now: NOW }
    const html = buildReceiptPrintHtml({ ...base, supplier: { cr: "1010999", vat: "300111", city: "الرياض", phone: "0551234567" }, noticeNumber: "إ.ت-2026/001-1" })
    for (const s of ["1010999", "300111", "الرياض", "0551234567", "إ.ت-2026/001-1", "DN-77", "[forwarded_title]", "•••12", "[forwarded_by:Badr]", "[via_code]"]) expect(html).toContain(s)
    expect(buildReceiptPrintHtml({ ...base, delivery: { ...base.delivery, confirmedVia: "login" } })).toContain("[via_login]")
  })

  it("a no-PO print: its stored CR/VAT (else not registered) and, for a price reader, the invoice as typed", () => {
    const t = (k: string, p?: Record<string, string | number>) => `[${k}${p ? ":" + Object.values(p).join("|") : ""}]`
    const priced: DeskDelivery = { ...manual, items: [{ name: "زوايا", quantity: 20, unit: "حبة", unitPrice: 12 }, { name: "براغي", quantity: 3, unit: "علبة", unitPrice: null }] }
    const base = { po: null, company: { name: "النخبة" }, placeName: null, projectName: null, displayNumber: "ا.س-2026/002", displayPoNumber: null, locale: "ar", t, tp: t, now: NOW }
    const withIds = buildReceiptPrintHtml({ ...base, delivery: { ...priced, supplierCrNumber: "7001", supplierVatNumber: "3999" } as DeskDelivery, withPrices: true })
    expect(withIds).toContain("7001")
    expect(withIds).toContain("3999")
    expect(withIds).not.toContain("[not_registered]")
    expect(withIds).toContain("[col_unit_price]")
    expect(withIds).toContain("240 ر.س")
    expect(withIds).toContain("[invoice_as_received]")
    const blind = buildReceiptPrintHtml({ ...base, delivery: priced, withPrices: false })
    expect(blind).toContain("[not_registered]")
    expect(blind).not.toContain("[col_unit_price]")
    expect(blind).not.toContain("240")
  })
})
