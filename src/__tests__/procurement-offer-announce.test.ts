/**
 * The new-offer notice (bell, push and text) — and the seal it must keep.
 *
 * UAT, 23 Sep: with sealing on, the offers page hid an 8,700 offer while the
 * bell read "قدم المورد … عرضاً بمبلغ ٨٬٧٠٠ ر.س". A sealed notice may carry no
 * amount in ANY of its fields, since each is rendered somewhere.
 */

import { newOfferNotice, newOfferNoticeId } from "@/lib/procurement/offer-announce"

const everywhere = (n: ReturnType<typeof newOfferNotice>) => [n.title, n.message, n.smsText, n.i18n.message, ...Object.values(n.i18n.params)].join(" | ")

describe("newOfferNotice", () => {
  test("an open round names the amount in every channel", () => {
    const n = newOfferNotice({ supplier: "مصنع الجودة", rfqTitle: "حديد", price: 8700, sealed: false })
    expect(n.i18n).toEqual({ title: "pn_new_offer_title", message: "pn_new_offer", params: { supplier: "مصنع الجودة", price: "8,700", rfq: "حديد" } })
    expect(n.message).toContain("٨٬٧٠٠")
    expect(n.smsText).toContain("٨٬٧٠٠")
  })

  test("a sealed round names no amount anywhere — not even in the params", () => {
    const n = newOfferNotice({ supplier: "مصنع الجودة", rfqTitle: "حديد", price: 8700, sealed: true })
    expect(n.i18n.message).toBe("pn_new_offer_sealed")
    expect(n.i18n.params).toEqual({ supplier: "مصنع الجودة", rfq: "حديد" })
    expect(everywhere(n)).not.toMatch(/8700|8,700|٨٬٧٠٠|٨٧٠٠/)
  })

  test("with no price known it is plain — no amount, and no claim of a seal", () => {
    const n = newOfferNotice({ supplier: "X", rfqTitle: "Y", price: null, sealed: false })
    expect(n.i18n.message).toBe("pn_new_offer_plain")
    expect(everywhere(n)).not.toMatch(/مغلق|sealed/)
  })

  test("falls back to a name when the supplier is unnamed", () => {
    expect(newOfferNotice({ supplier: "  ", rfqTitle: "Y", price: 1, sealed: false }).i18n.params.supplier).toBe("مورد")
  })

  test("one id per offer, so a retry overwrites instead of adding a second", () => {
    expect(newOfferNoticeId("abc")).toBe("new_offer__abc")
  })
})
