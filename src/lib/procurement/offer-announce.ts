/**
 * What the contractor is told when an offer arrives — the bell, the push and
 * the text — and the one rule it obeys: a sealed round names no amount.
 *
 * The offers page kept sealed prices hidden, but the new-offer notification
 * carried "عرضاً بمبلغ ٨٬٧٠٠ ر.س" into the bell (and the push, and the SMS) the
 * moment the offer landed, so the buyer the seal exists to keep in the dark was
 * told anyway. Sealing needs the contractor's policy, which the supplier cannot
 * read — so the server builds this, never the quoting client.
 */

export interface NewOfferNotice {
  i18n: { title: string; message: string; params: Record<string, string> }
  /** Sender-rendered Arabic, for the push and the mobile app. */
  title: string
  message: string
  smsText: string
}

/**
 * `price: null` is the amount-free wording that claims nothing about a seal —
 * for a client that could not reach the server and so cannot know.
 */
export function newOfferNotice(input: { supplier: string; rfqTitle: string; price: number | null; sealed: boolean }): NewOfferNotice {
  const supplier = input.supplier.trim() || "مورد"
  const rfq = input.rfqTitle.trim()
  if (!input.sealed && input.price == null) {
    return {
      i18n: { title: "pn_new_offer_title", message: "pn_new_offer_plain", params: { supplier, rfq } },
      title: "عرض سعر جديد",
      message: `قدّم المورد ${supplier} عرضاً على طلب عروض الأسعار: ${rfq}`,
      smsText: `مدماك تيك: وصلك عرض سعر جديد على طلب عروض الأسعار: ${rfq}. قم بتسجيل الدخول للمراجعة.`,
    }
  }
  if (input.sealed || input.price == null) {
    return {
      i18n: { title: "pn_new_offer_title", message: "pn_new_offer_sealed", params: { supplier, rfq } },
      title: "عرض سعر جديد",
      message: `قدّم المورد ${supplier} عرضاً على طلب عروض الأسعار: ${rfq} — والسعر مغلق حتى الموعد النهائي`,
      smsText: `مدماك تيك: وصلك عرض سعر جديد على طلب عروض الأسعار: ${rfq}. السعر مغلق حتى الموعد النهائي.`,
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
