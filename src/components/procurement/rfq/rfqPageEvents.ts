// The page's pieces talk to the lifecycle bar through one browser event: «مدّد الموعد» beside an unanswered question opens the
// bar's extend dialog without the two knowing each other.

export const RFQ_EXTEND_EVENT = "proc:rfq:extend"

export function requestExtend(rfqId: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(RFQ_EXTEND_EVENT, { detail: { rfqId } }))
}
