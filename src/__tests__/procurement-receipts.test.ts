/**
 * Procurement PRD 3.0 — the goods receipt (§5.2, §6.1-6): accepted is what
 * was counted less rejects and holds; no receipt beyond the outstanding
 * quantity plus the tolerance; the variance against the notice; the receipt's
 * state; what a receipt is worth to the books (never a guessed share of a
 * lump sum); and the default notice lines for the supplier's form.
 */

import {
  acceptedOf,
  noticeLinesFromPo,
  overReceiptRefusal,
  receiptErrors,
  receiptLineErrors,
  receiptNetValue,
  receiptState,
  shortVsNotice,
  varianceVsNotice,
} from "@/lib/procurement/receipts"
import { DEFAULT_POLICIES, type DeliveryLine, type PoLine, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"

const NOW = new Date("2026-09-22T08:00:00Z")
const POL = DEFAULT_POLICIES

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Cement", unit: "bag", quantity: 650, unitPrice: 18, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const dl = (over: Partial<DeliveryLine> = {}): DeliveryLine => ({ poLineId: "l1", name: "Cement", unit: "bag", noticeQuantity: 650, ...over })

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po1",
  organizationId: "org",
  docNumber: "PO-2026/020",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "Cement",
  offerId: "o1",
  projectId: "p1",
  supplierOrgId: "sup1",
  supplierUserId: null,
  supplierName: "Al-Asmant",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 11700,
  vatRate: 0.15,
  offersCount: 3,
  lowestOfferTotal: 11700,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: "buyer",
  preparedByName: "Sara",
  createdAt: "2026-09-10T08:00:00Z",
  approverKind: "manager",
  supplierAcceptedAt: "2026-09-12T08:00:00Z",
  promisedDate: "2026-09-25",
  log: [],
  ...over,
})

const delivery = (over: Partial<ReceiptFact> = {}): ReceiptFact => ({ id: "d1", status: "pending_confirmation", poId: "po1", deliveryDate: "2026-09-25", lines: [dl()], ...over })

describe("acceptedOf and the line validation", () => {
  it("demo GRN 886: notice 650, counted 645, rejected 45 → accepted 600; short of the notice by 5", () => {
    const l = dl({ counted: 645, rejected: 45, held: 0 })
    expect(acceptedOf(l)).toBe(600)
    expect(varianceVsNotice(l)).toBe(-5)
    expect(shortVsNotice(l)).toBe(5)
  })

  it("never negative; null variance before the count", () => {
    expect(acceptedOf({ counted: 10, rejected: 8, held: 5 })).toBe(0)
    expect(varianceVsNotice(dl())).toBeNull()
    expect(shortVsNotice(dl())).toBe(0)
  })

  it("errors are codes: missing count, negatives, over-deducted, missing reasons", () => {
    expect(receiptLineErrors(dl()).map((e) => e.code)).toEqual(["count_missing"])
    expect(receiptLineErrors(dl({ counted: -1 })).map((e) => e.code)).toEqual(["negative_quantity"])
    expect(receiptLineErrors(dl({ counted: 10, rejected: 8, held: 5, rejectReason: "damaged", holdReason: "test" })).map((e) => e.code)).toEqual(["over_deducted"])
    expect(receiptLineErrors(dl({ counted: 10, rejected: 2, held: 1 })).map((e) => e.code)).toEqual(["reject_reason_missing", "hold_reason_missing"])
    expect(receiptLineErrors(dl({ counted: 10, rejected: 2, held: 1, rejectReason: "damaged", holdReason: "certificate" }))).toEqual([])
  })
})

describe("over-receipt — outstanding + 5 %, and no more", () => {
  it("accepts up to the limit, refuses beyond it, and subtracts what is already held", () => {
    expect(overReceiptRefusal(line(), 682.5, POL)).toBeNull()
    const over = overReceiptRefusal(line(), 683, POL)
    expect(over?.code).toBe("over_receipt")
    expect(over?.params).toEqual({ counted: 683, limit: 682.5, outstanding: 650, tolerance: 5 })
    // 200 accepted, 50 held: 400 may still arrive → 420 with tolerance.
    expect(overReceiptRefusal(line({ accepted: 200, held: 50 }), 420, POL)).toBeNull()
    expect(overReceiptRefusal(line({ accepted: 200, held: 50 }), 421, POL)?.code).toBe("over_receipt")
    // A complete line takes nothing more.
    expect(overReceiptRefusal(line({ accepted: 650 }), 1, POL)?.code).toBe("over_receipt")
    expect(overReceiptRefusal(line({ accepted: 650 }), 0, POL)).toBeNull()
  })

  it("the policy's tolerance is honoured", () => {
    expect(overReceiptRefusal(line(), 700, { ...POL, overReceiptTolerancePercent: 10 })).toBeNull()
    expect(overReceiptRefusal(line(), 651, { ...POL, overReceiptTolerancePercent: 0 })?.code).toBe("over_receipt")
  })
})

describe("receiptErrors — the whole form against the order", () => {
  it("unknown lines, nothing counted, and the over-receipt of one line", () => {
    expect(receiptErrors(po(), [dl({ poLineId: "zz", counted: 1 })], POL).map((e) => e.code)).toEqual(["unknown_line"])
    expect(receiptErrors(po(), [dl({ counted: 0 })], POL).map((e) => e.code)).toEqual(["nothing_counted"])
    expect(receiptErrors(po(), [dl({ counted: 700 })], POL).map((e) => e.code)).toEqual(["over_receipt"])
    expect(receiptErrors(po(), [dl({ counted: 600, rejected: 10, rejectReason: "wrong_spec" })], POL)).toEqual([])
  })
})

describe("receiptState — first match wins", () => {
  it("manual with no order outranks everything; a pending notice is on the way until its date passes", () => {
    expect(receiptState(delivery({ source: "manual", poId: null, status: "confirmed" }), NOW)).toBe("manual_no_po")
    expect(receiptState(delivery(), NOW)).toBe("on_the_way")
    expect(receiptState(delivery({ deliveryDate: "2026-09-22" }), NOW)).toBe("on_the_way")
    expect(receiptState(delivery({ deliveryDate: "2026-09-21" }), NOW)).toBe("late_notice")
    expect(receiptState(delivery({ deliveryDate: null }), NOW)).toBe("on_the_way")
  })

  it("at the gate: rejects > held > short > matched; a legacy delivery with no lines is received", () => {
    const confirmed = (l: Partial<DeliveryLine>) => delivery({ status: "confirmed", lines: [dl({ counted: 645, ...l })] })
    expect(receiptState(confirmed({ rejected: 45, held: 10 }), NOW)).toBe("received_with_rejects")
    expect(receiptState(confirmed({ held: 10 }), NOW)).toBe("received_held")
    expect(receiptState(confirmed({}), NOW)).toBe("received_short")
    expect(receiptState(confirmed({ counted: 650 }), NOW)).toBe("received")
    expect(receiptState(delivery({ status: "confirmed", lines: undefined }), NOW)).toBe("received")
  })
})

describe("receiptNetValue — what the books get, ex-VAT", () => {
  it("priced lines: Σ accepted × unit price", () => {
    expect(receiptNetValue(po(), [dl({ counted: 645, rejected: 45 })])).toBe(600 * 18)
    expect(receiptNetValue(po(), [dl({ counted: 0 })])).toBe(0)
  })

  it("a lump sum: null until this receipt completes the order, then total − already posted", () => {
    const lump = po({ totalExVat: 11700, lines: [line({ unitPrice: null })] })
    expect(receiptNetValue(lump, [dl({ counted: 300 })])).toBeNull()
    expect(receiptNetValue({ ...lump, lines: [line({ unitPrice: null, accepted: 300 })] }, [dl({ counted: 350 })], 0)).toBe(11700)
    expect(receiptNetValue({ ...lump, lines: [line({ unitPrice: null, accepted: 300 })] }, [dl({ counted: 350 })], 4000)).toBe(7700)
    // 0.5 % short still completes it.
    expect(receiptNetValue({ ...lump, lines: [line({ unitPrice: null, accepted: 300 })] }, [dl({ counted: 347 })], 0)).toBe(11700)
    expect(receiptNetValue({ ...lump, lines: [line({ unitPrice: null, accepted: 300 })] }, [dl({ counted: 340 })], 0)).toBeNull()
  })

  it("a mixed order: the unpriced line with goods on it makes the value null, a priced-only receipt is fine", () => {
    const mixed = po({ lines: [line(), line({ id: "l2", name: "Pallets", unit: "pc", quantity: 10, unitPrice: null })] })
    expect(receiptNetValue(mixed, [dl({ counted: 100 })])).toBe(1800)
    expect(receiptNetValue(mixed, [dl({ counted: 100 }), dl({ poLineId: "l2", counted: 5 })])).toBeNull()
  })
})

describe("noticeLinesFromPo — what may still arrive, per line", () => {
  it("outstanding less held; complete lines are left out", () => {
    const p = po({ lines: [line({ accepted: 200, held: 50 }), line({ id: "l2", name: "Sand", unit: "m³", quantity: 30, accepted: 30 }), line({ id: "l3", name: "Gravel", unit: "m³", quantity: 40, cancelled: 15 })] })
    expect(noticeLinesFromPo(p)).toEqual([
      { poLineId: "l1", name: "Cement", unit: "bag", noticeQuantity: 400 },
      { poLineId: "l3", name: "Gravel", unit: "m³", noticeQuantity: 25 },
    ])
  })
})
