/**
 * Procurement PRD 3.0 — the supplier's side of an order: which segment an
 * order sits in (and which orders he never sees), what he may do, the
 * notice's validation (never above what may still arrive), and the delivery
 * document — today's `deliveries` shape kept whole, the order's fields laid
 * over it — plus the notification that carries it and the B1 fix for legacy
 * offers (items from the RFQ, never from the offer).
 */

import {
  buildDeliveryNotice,
  buildDeliveryNoticeNotification,
  defaultNoticeLines,
  deliveryNoticeLink,
  inSupplierSegment,
  legacyItemsFromRfq,
  minPromiseDay,
  noticeDeliveryLines,
  noticeErrors,
  noticeLatenessDays,
  noticeRecipients,
  promiseDateValid,
  supplierCanAccept,
  supplierCanNotify,
  supplierLineView,
  supplierSegmentCounts,
  supplierSegmentOf,
  visibleSupplierOrders,
} from "@/lib/procurement/supplier"
import type { PoLine, PoStoredStatus, PurchaseOrder } from "@/lib/procurement/types"

const NOW = new Date("2026-09-22T08:00:00Z")
const TODAY = "2026-09-22"

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Cement", unit: "bag", quantity: 100, unitPrice: 18, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po1",
  organizationId: "buyer-org",
  docNumber: "PO-2026/014",
  status: "accepted",
  basis: "rfq",
  rfqId: "rfq1",
  rfqTitle: "Cement for slab",
  offerId: "offer1",
  projectId: "proj1",
  supplierOrgId: "sup-org",
  supplierUserId: "sup-user",
  supplierName: "Al Bina",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 1800,
  vatRate: 0.15,
  offersCount: 3,
  lowestOfferTotal: 1800,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: "buyer-1",
  preparedByName: "Ahmed",
  createdAt: "2026-09-10T08:00:00Z",
  approverKind: "manager",
  sentAt: "2026-09-12T08:00:00Z",
  promisedDate: "2026-09-25",
  log: [],
  ...over,
})

describe("segments — what the supplier sees", () => {
  it("classifies by the derived status", () => {
    expect(supplierSegmentOf(po({ status: "sent" }))).toBe("to_accept")
    expect(supplierSegmentOf(po({ status: "accepted" }))).toBe("in_delivery")
    expect(supplierSegmentOf(po({ status: "accepted", lines: [line({ accepted: 40 })] }))).toBe("in_delivery")
    expect(supplierSegmentOf(po({ status: "accepted", lines: [line({ accepted: 100 })] }))).toBe("done")
    expect(supplierSegmentOf(po({ status: "closed" }))).toBe("done")
  })

  it("hides the buyer's drafts: awaiting approval, approved but unsent, cancelled before dispatch", () => {
    for (const status of ["awaiting_approval", "approved"] as PoStoredStatus[]) {
      expect(supplierSegmentOf(po({ status, sentAt: null }))).toBeNull()
    }
    expect(supplierSegmentOf(po({ status: "cancelled", sentAt: null, log: [] }))).toBeNull()
    expect(supplierSegmentOf(po({ status: "cancelled" }))).toBe("done")
    expect(supplierSegmentOf(po({ status: "cancelled", sentAt: null, log: [{ at: "x", byId: "b", byName: "B", action: "sent" }] }))).toBe("done")
  })

  it("counts every visible order once, and 'all' shows everything visible", () => {
    const orders = [po({ id: "a", status: "sent" }), po({ id: "b" }), po({ id: "c", status: "closed" }), po({ id: "d", status: "awaiting_approval", sentAt: null })]
    expect(supplierSegmentCounts(orders)).toEqual({ to_accept: 1, in_delivery: 1, done: 1, all: 3 })
    expect(visibleSupplierOrders(orders).map((o) => o.id)).toEqual(["a", "b", "c"])
    expect(inSupplierSegment(orders[3], "all")).toBe(false)
    expect(inSupplierSegment(orders[0], "all")).toBe(true)
    expect(inSupplierSegment(orders[0], "in_delivery")).toBe(false)
  })

  it("sorts newest dispatch first", () => {
    const orders = [po({ id: "old", sentAt: "2026-09-01T00:00:00Z" }), po({ id: "new", sentAt: "2026-09-20T00:00:00Z" })]
    expect(visibleSupplierOrders(orders).map((o) => o.id)).toEqual(["new", "old"])
  })
})

describe("what the supplier may do", () => {
  it("accepts only a sent order; notifies only an accepted one with something left", () => {
    expect(supplierCanAccept(po({ status: "sent" }))).toBe(true)
    expect(supplierCanAccept(po({ status: "accepted" }))).toBe(false)
    expect(supplierCanNotify(po())).toBe(true)
    expect(supplierCanNotify(po({ status: "sent" }))).toBe(false)
    expect(supplierCanNotify(po({ lines: [line({ accepted: 100 })] }))).toBe(false)
    expect(supplierCanNotify(po({ lines: [line({ cancelled: 100 })] }))).toBe(false)
    // held goods are on the buyer's floor — not to be shipped again
    expect(supplierCanNotify(po({ lines: [line({ held: 100 })] }))).toBe(false)
  })

  it("the promise is today or later, as a calendar day", () => {
    expect(minPromiseDay(NOW)).toBe(TODAY)
    expect(promiseDateValid(TODAY, NOW)).toBe(true)
    expect(promiseDateValid("2026-09-21", NOW)).toBe(false)
    expect(promiseDateValid("2026-10-01", NOW)).toBe(true)
    expect(promiseDateValid("", NOW)).toBe(false)
    expect(promiseDateValid("22/09/2026", NOW)).toBe(false)
  })

  it("reads the line the way the gate wrote it", () => {
    expect(supplierLineView(line({ accepted: 30, rejected: 5, held: 10, cancelled: 20 }))).toEqual({
      id: "l1",
      name: "Cement",
      unit: "bag",
      ordered: 100,
      accepted: 30,
      rejected: 5,
      held: 10,
      cancelled: 20,
      outstanding: 50,
      toArrive: 40,
    })
  })

  it("lateness of a notice against the promise", () => {
    expect(noticeLatenessDays(po(), "2026-09-25")).toBe(0)
    expect(noticeLatenessDays(po(), "2026-09-23")).toBe(0)
    expect(noticeLatenessDays(po(), "2026-09-28")).toBe(3)
    expect(noticeLatenessDays(po({ promisedDate: null }), "2026-09-28")).toBe(0)
  })
})

describe("the notice's lines — never above what may still arrive", () => {
  it("defaults to what is left per line, dropping finished lines", () => {
    const order = po({ lines: [line(), line({ id: "l2", name: "Sand", unit: "m3", quantity: 20, accepted: 20 }), line({ id: "l3", name: "Rebar", unit: "t", quantity: 10, accepted: 4, held: 1 })] })
    expect(defaultNoticeLines(order)).toEqual([
      { poLineId: "l1", quantity: 100 },
      { poLineId: "l3", quantity: 5 },
    ])
  })

  it("passes a valid form", () => {
    expect(noticeErrors(po(), [{ poLineId: "l1", quantity: 60 }], "2026-09-25", NOW)).toEqual([])
  })

  it("refuses a line above what may still arrive — refused, not trimmed", () => {
    const errs = noticeErrors(po({ lines: [line({ accepted: 30 })] }), [{ poLineId: "l1", quantity: 71 }], TODAY, NOW)
    expect(errs).toEqual([{ code: "over_outstanding", poLineId: "l1", params: { line: "Cement", quantity: 71, max: 70, unit: "bag" } }])
    expect(noticeErrors(po({ lines: [line({ accepted: 30 })] }), [{ poLineId: "l1", quantity: 70 }], TODAY, NOW)).toEqual([])
  })

  it("needs a date that has not passed and at least one quantity", () => {
    expect(noticeErrors(po(), [{ poLineId: "l1", quantity: 0 }], "", NOW).map((e) => e.code)).toEqual(["date_missing", "nothing_to_ship"])
    expect(noticeErrors(po(), [{ poLineId: "l1", quantity: 10 }], "2026-09-21", NOW).map((e) => e.code)).toEqual(["date_past"])
    expect(noticeErrors(po(), [], TODAY, NOW).map((e) => e.code)).toEqual(["nothing_to_ship"])
  })

  it("refuses a line the order does not have, and an order that cannot be notified", () => {
    expect(noticeErrors(po(), [{ poLineId: "l9", quantity: 1 }], TODAY, NOW).map((e) => e.code)).toEqual(["unknown_line", "nothing_to_ship"])
    expect(noticeErrors(po({ status: "sent" }), [{ poLineId: "l1", quantity: 1 }], TODAY, NOW).map((e) => e.code)).toEqual(["not_accepted"])
  })

  it("keeps only lines with a quantity, in the order's shape", () => {
    const order = po({ lines: [line(), line({ id: "l2", name: "Sand", unit: "m3", quantity: 20 })] })
    expect(noticeDeliveryLines(order, [{ poLineId: "l1", quantity: 0 }, { poLineId: "l2", quantity: 7.5 }, { poLineId: "zz", quantity: 3 }])).toEqual([
      { poLineId: "l2", name: "Sand", unit: "m3", noticeQuantity: 7.5 },
    ])
  })
})

describe("the delivery document", () => {
  const created = { kind: "server-timestamp" }
  const built = () =>
    buildDeliveryNotice({
      po: po({ lines: [line(), line({ id: "l2", name: "Sand", unit: "m3", quantity: 20 })] }),
      lines: [
        { poLineId: "l1", quantity: 60 },
        { poLineId: "l2", quantity: 0 },
      ],
      deliveryDate: "2026-09-25",
      deliveryWindow: "morning",
      driverName: "  Salem ",
      vehiclePlate: "ABC 1234",
      paperNoteNumber: "DN-77",
      notes: "crane needed",
      fileUrl: "https://storage/x.pdf",
      supplier: { uid: "sup-user", orgId: "sup-org", name: "Al Bina" },
      contractorId: "rfq-creator",
      createdAt: created,
    })

  it("keeps today's shape exactly — every field the confirm flow, the queue and the money flow read", () => {
    const d = built()
    expect(d).toMatchObject({
      rfqId: "rfq1",
      offerId: "offer1",
      projectId: "proj1",
      contractorOrgId: "buyer-org",
      contractorId: "rfq-creator",
      supplierOrgId: "sup-org",
      supplierId: "sup-user",
      supplierName: "Al Bina",
      deliveryPersonName: "Salem",
      handoverRecipientName: null,
      deliveryDate: "2026-09-25T00:00:00.000Z",
      notes: "crane needed",
      rfqTitle: "Cement for slab",
      status: "pending_confirmation",
      createdAt: created,
    })
    // legacy items: populated from the lines (B1 never again), in the guest route's shape
    expect(d.items).toEqual([{ name: "Cement", quantity: 60, unitOfMeasure: "bag" }])
  })

  it("lays the order's fields over it", () => {
    const d = built()
    expect(d.poId).toBe("po1")
    expect(d.poNumber).toBe("PO-2026/014")
    expect(d.lines).toEqual([{ poLineId: "l1", name: "Cement", unit: "bag", noticeQuantity: 60 }])
    expect(d.vehiclePlate).toBe("ABC 1234")
    expect(d.paperNoteNumber).toBe("DN-77")
    expect(d.deliveryWindow).toBe("morning")
    expect(d.attachmentUrls).toEqual(["https://storage/x.pdf"])
  })

  it("omits what was not given — nulls, not empty strings; no attachment key without a file", () => {
    const d = buildDeliveryNotice({
      po: po(),
      lines: [{ poLineId: "l1", quantity: 10 }],
      deliveryDate: "2026-09-25",
      supplier: { uid: "u", orgId: "o", name: "S" },
      createdAt: null,
    })
    expect(d.deliveryPersonName).toBeNull()
    expect(d.vehiclePlate).toBeNull()
    expect(d.paperNoteNumber).toBeNull()
    expect(d.deliveryWindow).toBeNull()
    expect(d.notes).toBeNull()
    expect("attachmentUrls" in d).toBe(false)
    // the preparer stands in for an unknown RFQ creator
    expect(d.contractorId).toBe("buyer-1")
  })

  it("never writes undefined into Firestore", () => {
    const d = built() as unknown as Record<string, unknown>
    for (const [k, v] of Object.entries(d)) expect([k, v === undefined]).toEqual([k, false])
  })
})

describe("who hears of the notice", () => {
  it("the RFQ's creator and the order's preparer, once each", () => {
    expect(noticeRecipients(po(), "rfq-creator")).toEqual(["rfq-creator", "buyer-1"])
    expect(noticeRecipients(po(), "buyer-1")).toEqual(["buyer-1"])
    expect(noticeRecipients(po(), null)).toEqual(["buyer-1"])
  })

  it("is today's `delivery_notice`, with the order's number and a link to the goods-received desk", () => {
    const n = buildDeliveryNoticeNotification(po(), "buyer-1", "del-9", "2026-09-22T08:00:00.000Z")
    expect(n).toEqual({
      userId: "buyer-1",
      organizationId: "buyer-org",
      type: "delivery_notice",
      i18n: { title: "pn_delivery_notice_title", message: "pn_delivery_notice", params: { rfq: "Cement for slab", number: "PO-2026/014" } },
      title: "🚚 إشعار تسليم جديد",
      message: "قام المورد بإرسال إشعار تسليم لطلب عروض الأسعار: Cement for slab — أمر الشراء PO-2026/014",
      offerId: "offer1",
      rfqId: "rfq1",
      poId: "po1",
      poNumber: "PO-2026/014",
      deliveryId: "del-9",
      link: "/contractor/goods-received?tab=incoming&delivery=del-9",
      createdAt: "2026-09-22T08:00:00.000Z",
      read: false,
    })
    expect(deliveryNoticeLink("abc")).toBe("/contractor/goods-received?tab=incoming&delivery=abc")
  })
})

describe("legacy offers — B1: items from the RFQ", () => {
  it("copies the RFQ's products the way the guest route does", () => {
    expect(legacyItemsFromRfq([{ name: " Cement ", quantity: "1,200", unitOfMeasure: "bag" }, { name: "Sand", quantity: 8, unit: "m3" }, { name: "", quantity: 1 }, null as unknown as { name: string }])).toEqual([
      { name: "Cement", quantity: 1200, unitOfMeasure: "bag" },
      { name: "Sand", quantity: 8, unitOfMeasure: "m3" },
    ])
    expect(legacyItemsFromRfq(null)).toEqual([])
    expect(legacyItemsFromRfq([{ name: "X", quantity: "abc" }])).toEqual([{ name: "X", quantity: 0, unitOfMeasure: "" }])
  })
})
