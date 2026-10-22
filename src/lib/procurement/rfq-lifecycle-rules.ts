// The rules of an RFQ's life after it is published that need no server: which date may replace the deadline, which suppliers an
// extension adds, and when a cancellation's reason is enough. The route runs them again (`rfq-server/lifecycle.ts`). Pure.

import { CANCEL_OTHER_MIN, type RfqCancelCode } from "./rfq-detail"

/** The deadline moves later than today and later than it stands. */
export function deadlineRefusal(current: string | null | undefined, next: string, today: string): "date_invalid" | null {
  const cur = (current || "").slice(0, 10)
  if (next < today) return "date_invalid"
  if (cur && next <= cur) return "date_invalid"
  return null
}

/** The suppliers an extension adds to a private round (never to a public one, which has no list). */
export function extendPatch(rfq: { visibility?: string | null; allowedSupplierOrgIds?: string[] | null; invitedSupplierOrgIds?: string[] | null }, add: string[]) {
  const allowed = rfq.allowedSupplierOrgIds || []
  const invited = rfq.invitedSupplierOrgIds || []
  const fresh = Array.from(new Set(add.filter((x) => x && !allowed.includes(x) && !invited.includes(x))))
  return {
    fresh,
    invitedSupplierOrgIds: [...invited, ...fresh],
    ...(rfq.visibility === "private" ? { allowedSupplierOrgIds: [...allowed, ...fresh] } : {}),
  }
}

export function cancelReasonRefusal(code: RfqCancelCode, note: string | undefined): "reason_required" | null {
  if (code === "other" && (note || "").trim().length < CANCEL_OTHER_MIN) return "reason_required"
  return null
}
