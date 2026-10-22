/**
 * Procurement PRD 3.0 — the supplier's side of an order: which segment an
 * order sits in (and which orders he never sees), what he may do, the
 * notice's validation (never above what may still arrive), and the delivery
 * document — today's `deliveries` shape kept whole, the order's fields laid
 * over it — plus the notification that carries it and the B1 fix for legacy
 * offers (items from the RFQ, never from the offer).
 */

import {
  AWARDED,
  UNDER_REVIEW,
  CLOSED_UNAWARDED,
  asSupplierSees,
  awardDisclosed,
  supplierOfferStatus,
  buildDeliveryNotice,
  buildDeliveryNoticeNotification,
  deliveryNoticeLink,
  inSupplierSegment,
  legacyItemsFromRfq,
  minPromiseDay,
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

describe("the notice — a day and a note, never a quantity (G-08)", () => {
  it("passes a valid form", () => {
    expect(noticeErrors(po(), "2026-09-25", NOW)).toEqual([])
    expect(noticeErrors(po(), TODAY, NOW)).toEqual([])
  })

  it("needs a date that has not passed", () => {
    expect(noticeErrors(po(), "", NOW).map((e) => e.code)).toEqual(["date_missing"])
    expect(noticeErrors(po(), "2026-09-21", NOW).map((e) => e.code)).toEqual(["date_past"])
  })

  it("refuses an order that cannot be notified", () => {
    expect(noticeErrors(po({ status: "sent" }), TODAY, NOW).map((e) => e.code)).toEqual(["not_accepted"])
    expect(noticeErrors(po({ lines: [line({ accepted: 100 })] }), TODAY, NOW).map((e) => e.code)).toEqual(["not_accepted"])
  })
})

describe("the delivery document", () => {
  const created = { kind: "server-timestamp" }
  const built = () =>
    buildDeliveryNotice({
      po: po({ lines: [line(), line({ id: "l2", name: "Sand", unit: "m3", quantity: 20 })] }),
      deliveryDate: "2026-09-25",
      note: "  crane needed ",
      seq: 2,
      reportedBy: "link",
      supplier: { uid: "sup-user", orgId: "sup-org", name: "Al Bina" },
      contractorId: "rfq-creator",
      createdAt: created,
    })

  it("keeps today's shape — every field the confirm flow, the queue and the money flow read — with the order's number and the notice's", () => {
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
      deliveryPersonName: null,
      handoverRecipientName: null,
      deliveryDate: "2026-09-25T00:00:00.000Z",
      notes: "crane needed",
      rfqTitle: "Cement for slab",
      status: "pending_confirmation",
      createdAt: created,
      poId: "po1",
      poNumber: "PO-2026/014",
      seq: 2,
      reportedBy: "link",
    })
    expect(d.items).toEqual([])
  })

  it("carries no quantity, driver, plate, paper or window (G-08)", () => {
    const keys = Object.keys(built())
    expect(keys.filter((k) => /qty|quantit|driver|plate|paper|window|lines|attachment/i.test(k))).toEqual([])
  })

  it("omits what was not given — null, not an empty string; the preparer stands in for an unknown RFQ creator", () => {
    const d = buildDeliveryNotice({ po: po(), deliveryDate: "2026-09-25", seq: 1, supplier: { uid: "u", orgId: "o", name: "S" }, createdAt: null })
    expect(d.notes).toBeNull()
    expect(d.contractorId).toBe("buyer-1")
    expect(d.reportedBy).toBe("supplier")
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

/**
 * The 22 Sep review: Procurement's award goes to Finance as a purchase order,
 * and the supplier is told nothing until Finance has approved it and it has
 * been sent. In the demo the supplier saw "accepted" the moment Procurement
 * pressed Accept — before Finance, who might have no money for it, had seen
 * anything. Every supplier screen reads the award through these.
 */
describe("the award, as the supplier may know it", () => {
  const orders = (...list: PurchaseOrder[]) => new Map(list.map((o) => [o.id, o]))
  const award = { status: AWARDED, poId: "po1", awaitingOrderApproval: true }

  it("is hidden while its order waits for Finance, or is approved but unsent", () => {
    for (const status of ["awaiting_approval", "approved"] as PoStoredStatus[]) {
      expect(awardDisclosed(award, orders(po({ status, sentAt: null })))).toBe(false)
      expect(supplierOfferStatus(award, orders(po({ status, sentAt: null })))).toBe(UNDER_REVIEW)
    }
  })

  it("is told the moment the order is sent, and stays told", () => {
    expect(supplierOfferStatus(award, orders(po({ status: "sent", sentAt: "2026-09-22T09:00:00Z" })))).toBe(AWARDED)
    expect(supplierOfferStatus(award, orders(po({ status: "accepted", sentAt: "2026-09-22T09:00:00Z" })))).toBe(AWARDED)
  })

  it("stays hidden when Finance cancels the order before it is ever sent — and reads closed, not under review forever", () => {
    expect(awardDisclosed(award, orders(po({ status: "cancelled", sentAt: null, log: [] })))).toBe(false)
    expect(supplierOfferStatus(award, orders(po({ status: "cancelled", sentAt: null, log: [] })))).toBe(CLOSED_UNAWARDED)
  })

  it("stays hidden while the order has not been raised, or has not loaded", () => {
    expect(awardDisclosed({ status: AWARDED, awaitingOrderApproval: true }, orders())).toBe(false)
    expect(awardDisclosed(award, orders())).toBe(false)
  })

  it("leaves an award from before purchase orders exactly as it was", () => {
    expect(supplierOfferStatus({ status: AWARDED }, orders())).toBe(AWARDED)
  })

  it("never touches a status that is not an award", () => {
    for (const status of ["مطلوب تخفيض", "قيد المراجعة", "تم التسليم"]) {
      expect(supplierOfferStatus({ status, poId: "po1", awaitingOrderApproval: true }, orders())).toBe(status)
    }
  })

  it("never tells a supplier he was excluded: an offer excluded the old way (G-15) reads «under review»", () => {
    expect(supplierOfferStatus({ status: "مرفوض" }, orders())).toBe(UNDER_REVIEW)
  })

  it("an open «better price» request reads as the reduction request the supplier's screens answer; an answered one does not", () => {
    const asked = { at: "2026-10-13", byId: "u", byName: "n", replyBy: "2026-10-16", note: null, round: 1 as const }
    expect(supplierOfferStatus({ status: UNDER_REVIEW, bafo: { ...asked, answered: null } }, orders())).toBe("مطلوب تخفيض")
    expect(supplierOfferStatus({ status: UNDER_REVIEW, bafo: { ...asked, answered: { at: "2026-10-14", n: 2, kind: "lowered" } } }, orders())).toBe(UNDER_REVIEW)
  })

  it("rewrites a list without disturbing anything else on each offer", () => {
    const offers = [
      { id: "a", status: AWARDED, poId: "po1", awaitingOrderApproval: true, price: 900 },
      { id: "b", status: "مرفوض", price: 1200 },
    ]
    const seen = asSupplierSees(offers, orders(po({ status: "awaiting_approval", sentAt: null })))
    expect(seen.map((o) => o.status)).toEqual([UNDER_REVIEW, UNDER_REVIEW])
    expect(seen[0].price).toBe(900)
    expect(seen[1].price).toBe(1200)
    expect(offers[1].status).toBe("مرفوض")
    expect(offers[0].status).toBe(AWARDED)
  })
})
