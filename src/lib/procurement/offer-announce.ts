/**
 * What the contractor is told when an offer arrives — the bell, the push and
 * the text. Prices are never hidden from the buyer (Procurement 2.0, RFQ-03:
 * no seal), so the amount is named whenever the server knows it.
 */

export interface NewOfferNotice {
  i18n: { title: string; message: string; params: Record<string, string> }
  /** Sender-rendered Arabic, for the push and the mobile app. */
  title: string
  message: string
  smsText: string
}

/** `price: null` is the amount-free wording — for a client that could not reach the server and so cannot know it. */
export function newOfferNotice(input: { supplier: string; rfqTitle: string; price: number | null }): NewOfferNotice {
  const supplier = input.supplier.trim() || "مورد"
  const rfq = input.rfqTitle.trim()
  if (input.price == null) {
    return {
      i18n: { title: "pn_new_offer_title", message: "pn_new_offer_plain", params: { supplier, rfq } },
      title: "عرض سعر جديد",
      message: `قدّم المورد ${supplier} عرضاً على طلب عروض الأسعار: ${rfq}`,
      smsText: `مدماك تيك: وصلك عرض سعر جديد على طلب عروض الأسعار: ${rfq}. قم بتسجيل الدخول للمراجعة.`,
    }
  }
  const price = input.price
  return {
    i18n: { title: "pn_new_offer_title", message: "pn_new_offer", params: { supplier, price: price.toLocaleString("en-US"), rfq } },
    title: "عرض سعر جديد",
    message: `قدم المورد ${supplier} عرضاً بمبلغ ${price.toLocaleString("ar-SA")} ر.س على طلب عروض الأسعار: ${rfq}`,
    smsText: `مدماك تيك: وصلك عرض سعر جديد بمبلغ ${price.toLocaleString("ar-SA")} ر.س على طلب عروض الأسعار: ${rfq}. قم بتسجيل الدخول للمراجعة.`,
  }
}

/** One notification per offer: a retried request overwrites, never duplicates. */
export const newOfferNoticeId = (offerId: string) => `new_offer__${offerId}`
