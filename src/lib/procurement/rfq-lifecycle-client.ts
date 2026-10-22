// The browser's side of the RFQ routes (`/api/procurement/rfq/{publish,lifecycle,rename}`): one call with the signed-in user's
// token; a refusal comes back as the reason the screens translate (`Portal.Procurement.err_*`).

import { getAuth } from "firebase/auth"
import type { LifecycleInput, LifecycleResult } from "./rfq-server/lifecycle"
import type { PublishInput, PublishResult } from "./rfq-server/publish"

export class RfqRouteError extends Error {
  constructor(
    readonly reason: string,
    readonly params: Record<string, string | number> = {}
  ) {
    super(reason)
    this.name = "RfqRouteError"
  }
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const user = getAuth().currentUser
  if (!user) throw new RfqRouteError("no_permission")
  const res = await fetch(`/api/procurement/rfq/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; reason?: string; params?: Record<string, string | number>; code?: string } | null
  if (res.ok && json?.success && json.data !== undefined) return json.data
  throw new RfqRouteError(json?.reason || (json?.code ? json.code.toLowerCase() : "internal"), json?.params || {})
}

export const publishRfqCall = (input: PublishInput): Promise<PublishResult> => call<PublishResult>("publish", input)
export const lifecycleCall = (input: LifecycleInput): Promise<LifecycleResult> => call<LifecycleResult>("lifecycle", input)
export const renameRfqCall = (input: { rfqId: string; title: string }): Promise<{ rfqId: string; title: string }> => call("rename", input)
