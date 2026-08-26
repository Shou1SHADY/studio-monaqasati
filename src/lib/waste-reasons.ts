/**
 * Canonical waste-reason categories.
 *
 * A free-text reason answers "why did this happen" for one reader, once. A category
 * answers "where is our waste coming from" across a whole project — which is the
 * question the waste target exists to serve. Both are stored: the category drives
 * aggregation, the free text keeps the detail.
 */
export const WASTE_REASON_CODES = [
  "cutting",   // قص وتقطيع — offcuts, the normal and expected kind
  "breakage",  // كسر أثناء النقل أو التنفيذ
  "defect",    // عيب مصنعي — supplier's fault, may be claimable
  "loss",      // فقد أو سرقة
  "weather",   // تلف بسبب الطقس
  "rework",    // إعادة تنفيذ
  "other",     // أخرى
] as const

export type WasteReasonCode = (typeof WASTE_REASON_CODES)[number]

/** Message key for a reason code, e.g. "cutting" -> "waste_reason_cutting". */
export function wasteReasonMessageKey(code: string): `waste_reason_${string}` {
  return `waste_reason_${code}`
}

export function isKnownWasteReason(code: string | null | undefined): code is WasteReasonCode {
  return !!code && (WASTE_REASON_CODES as readonly string[]).includes(code)
}
