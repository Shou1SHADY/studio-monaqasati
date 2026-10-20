// PUR-07: the next step from the facts — the supplier is not blamed for our count.
import { STEP_WAITS_ON, deliveryStep, type StepNotice } from "@/lib/procurement/next-step"
import { daysLate } from "@/lib/procurement/po"
import type { PurchaseOrder } from "@/lib/procurement/types"

const NOW = new Date("2026-10-19T09:00:00Z")
const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
  ({ id: "po1", status: "accepted", promisedDate: "2026-09-24", isGuestSupplier: false, supplierName: "مصنع الجودة", lines: [{ id: "l1", name: "حديد", unit: "طن", quantity: 10, accepted: 0, rejected: 0, held: 0, cancelled: 0 }], ...over }) as unknown as PurchaseOrder
const notice = (over: Partial<StepNotice> = {}): StepNotice => ({ id: "d1", poId: "po1", status: "pending_confirmation", deliveryDate: "2026-09-24", ...over })

describe("the order on its way", () => {
  it("a notice forwarded in time and never counted waits on the RECEIVER, not the supplier (ط.ش-2026/001)", () => {
    const n = notice({ forwardedTo: { name: "سالم القحطاني", userId: null, at: "2026-09-23T10:00:00Z" } })
    const s = deliveryStep(po(), [n], NOW)
    expect(s).toEqual({ kind: "receiver_late", deliveryId: "d1", receiver: "سالم القحطاني", days: 25, noticeDay: "2026-09-24", forwardedDay: "2026-09-23", byLink: true })
    expect(STEP_WAITS_ON[s!.kind]).toBe("receiver")
    // …and the lateness clock agrees: the supplier is not late while the notice waits for our count.
    expect(daysLate(po(), NOW, [n])).toBe(0)
    expect(daysLate(po(), NOW)).toBe(25)
  })
  it("a notice with us asks to forward it; one whose day is ahead is on its way", () => {
    expect(deliveryStep(po(), [notice()], NOW)?.kind).toBe("notice_to_forward")
    expect(deliveryStep(po({ promisedDate: "2026-11-05" }), [notice({ deliveryDate: "2026-11-05", forwardedTo: { name: "أحمد" } })], NOW)).toMatchObject({ kind: "in_transit", day: "2026-11-05", receiver: "أحمد" })
  })
  it("with no notice: late past his promise, due before it, and a guest is ours to ask", () => {
    expect(deliveryStep(po({ promisedDate: "2026-10-13" }), [], NOW)).toEqual({ kind: "supplier_late", days: 6 })
    expect(deliveryStep(po({ promisedDate: "2026-11-05" }), [], NOW)).toEqual({ kind: "supplier_due", day: "2026-11-05" })
    expect(deliveryStep(po({ isGuestSupplier: true, promisedDate: "2026-10-19" }), [], NOW)).toEqual({ kind: "guest_due", day: "2026-10-19" })
  })
  it("says what is left of a part received, and a reject waits for our decision", () => {
    expect(deliveryStep(po({ lines: [{ id: "l1", name: "حديد", unit: "طن", quantity: 10, accepted: 6, rejected: 0, held: 0, cancelled: 0 }] as PurchaseOrder["lines"] }), [], NOW)).toEqual({ kind: "part_received", received: 6, ordered: 10, left: 4, unit: "طن" })
    expect(deliveryStep(po({ lines: [{ id: "l1", name: "حديد", unit: "طن", quantity: 10, accepted: 5, rejected: 1, held: 0, cancelled: 0 }] as PurchaseOrder["lines"] }), [], NOW)).toMatchObject({ kind: "rejected", qty: 1 })
  })
})
