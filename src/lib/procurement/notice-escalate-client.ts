// «صعّد» on Today: an uncounted delivery past the policy window is escalated to the project manager — or the owner without Projects
// (TDY-05). The write is the server's (`POST /api/procurement/notice/escalate`); this is the browser's one call to it.

import { getAuth } from "firebase/auth"

export interface EscalateResult {
  toName: string | null
}

export class EscalateError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "EscalateError"
  }
}

export async function escalateNoticeCall(deliveryId: string): Promise<EscalateResult> {
  const user = getAuth().currentUser
  if (!user) throw new EscalateError("no_permission")
  const res = await fetch("/api/procurement/notice/escalate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify({ deliveryId }) })
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: { toName?: string | null } | null; code?: string; reason?: string } | null
  if (res.ok && json?.success) return { toName: json.data?.toName ?? null }
  throw new EscalateError(json?.reason || (json?.code ? json.code.toLowerCase() : "internal"))
}
