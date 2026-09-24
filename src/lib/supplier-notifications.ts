export interface AskFacts {
  type?: string | null
  status?: string | null
  sampleStatus?: string | null
}

const REDUCTION = "مطلوب تخفيض"
const SAMPLE_ASKED = "مطلوبة"

/** Whether a notification still waits on the supplier. A request notice is a
 * moment in time; the offer it names says whether the ask is still open, so
 * "action required" stops once he has answered (UAT, 23 Sep). An offer not
 * loaded yet keeps the notice open rather than hiding a real ask. */
export function awaitsSupplier(notif: AskFacts, offerNow: AskFacts | null | undefined): { reduction: boolean; sample: boolean } {
  const reduction = notif.type === "price_reduction" ? (offerNow ? offerNow.status === REDUCTION : true) : notif.status === REDUCTION
  const sample = notif.type === "sample_requested" ? (offerNow ? offerNow.sampleStatus === SAMPLE_ASKED : true) : notif.sampleStatus === SAMPLE_ASKED
  return { reduction, sample }
}
