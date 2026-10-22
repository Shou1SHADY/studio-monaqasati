/**
 * The new-offer notice (bell, push and text). Prices are never hidden from the buyer (Procurement 2.0, RFQ-03): the amount is
 * named in every channel whenever the server knows it, and the old "sealed" wording is gone.
 */

import { newOfferNotice, newOfferNoticeId } from "@/lib/procurement/offer-announce"

const everywhere = (n: ReturnType<typeof newOfferNotice>) => [n.title, n.message, n.smsText, n.i18n.message, ...Object.values(n.i18n.params)].join(" | ")

describe("newOfferNotice", () => {
  test("an open round names the amount in every channel", () => {
    const n = newOfferNotice({ supplier: "مصنع الجودة", rfqTitle: "حديد", price: 8700 })
    expect(n.i18n).toEqual({ title: "pn_new_offer_title", message: "pn_new_offer", params: { supplier: "مصنع الجودة", price: "8,700", rfq: "حديد" } })
    expect(n.message).toContain("٨٬٧٠٠")
    expect(n.smsText).toContain("٨٬٧٠٠")
  })

  test("there is no sealed wording any more — the amount is always named when known", () => {
    const n = newOfferNotice({ supplier: "مصنع الجودة", rfqTitle: "حديد", price: 8700 })
    expect(n.i18n.message).toBe("pn_new_offer")
    expect(everywhere(n)).not.toMatch(/مغلق|sealed/)
  })

  test("with no price known it is plain — no amount", () => {
    const n = newOfferNotice({ supplier: "X", rfqTitle: "Y", price: null })
    expect(n.i18n.message).toBe("pn_new_offer_plain")
    expect(everywhere(n)).not.toMatch(/مغلق|sealed/)
  })

  test("falls back to a name when the supplier is unnamed", () => {
    expect(newOfferNotice({ supplier: "  ", rfqTitle: "Y", price: 1 }).i18n.params.supplier).toBe("مورد")
  })

  test("one id per offer, so a retry overwrites instead of adding a second", () => {
    expect(newOfferNoticeId("abc")).toBe("new_offer__abc")
  })
})
