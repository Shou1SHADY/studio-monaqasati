import { awaitsSupplier } from "@/lib/supplier-notifications"

describe("awaitsSupplier — 'action required' follows the offer, not the notice", () => {
  const notice = { type: "price_reduction" }

  it("a reduction request is open while the offer still asks for one", () => {
    expect(awaitsSupplier(notice, { status: "مطلوب تخفيض" }).reduction).toBe(true)
  })

  it("closes once the supplier has answered with a new price", () => {
    expect(awaitsSupplier(notice, { status: "قيد المراجعة" }).reduction).toBe(false)
  })

  it("stays open while the offer has not loaded", () => {
    expect(awaitsSupplier(notice, undefined).reduction).toBe(true)
  })

  it("a sample request closes once the sample is sent", () => {
    expect(awaitsSupplier({ type: "sample_requested" }, { sampleStatus: "مطلوبة" }).sample).toBe(true)
    expect(awaitsSupplier({ type: "sample_requested" }, { sampleStatus: "تم الإرسال" }).sample).toBe(false)
  })

  it("an offer entry reads its own live status", () => {
    expect(awaitsSupplier({ type: "offer", status: "مطلوب تخفيض" }, null)).toEqual({ reduction: true, sample: false })
    expect(awaitsSupplier({ type: "offer", status: "مقبول" }, null)).toEqual({ reduction: false, sample: false })
  })
})
