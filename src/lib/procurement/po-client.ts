// The browser's side of the purchase-order routes (`/api/procurement/po/*`): one call with the signed-in user's token, and a
// refusal that comes back as the `err_*` reason the screens already translate.

import { getAuth } from "firebase/auth"

export type PoAct = "approve" | "self-issue" | "return" | "send" | "cancel" | "close-short" | "reject-decision" | "advance-approve" | "date" | "accept-version"

export class PoRouteError extends Error {
  constructor(
    readonly reason: string,
    readonly params: Record<string, string | number> = {}
  ) {
    super(reason)
    this.name = "PoRouteError"
  }
}

export interface PoActResult {
  poId: string
  status: string
  ver: number
  link?: string | null
}

export async function poAct(act: PoAct, body: Record<string, unknown>, locale?: "ar" | "en"): Promise<PoActResult> {
  const user = getAuth().currentUser
  if (!user) throw new PoRouteError("no_permission")
  const res = await fetch(`/api/procurement/po/${act}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify({ ...body, locale }) })
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: PoActResult; reason?: string; params?: Record<string, string | number>; code?: string } | null
  if (res.ok && json?.success && json.data) return json.data
  if (json?.reason) throw new PoRouteError(json.reason, json.params || {})
  throw new Error(json?.code || `po ${act} failed`)
}
