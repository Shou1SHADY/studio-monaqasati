// The browser's side of `/api/procurement/incoming`: one call with the signed-in user's token. A refusal comes back as the lower-case
// reason the server gave (`window_lapsed`, `not_asked`, …), which the screens translate under `Portal.Procurement.before_err_*`.

import { getAuth } from "firebase/auth"

export type IncomingActResult = { ok: true } | { ok: false; reason: string }

export async function incomingAct(body: Record<string, unknown>): Promise<IncomingActResult> {
  try {
    const token = await getAuth().currentUser?.getIdToken()
    if (!token) return { ok: false, reason: "unauthenticated" }
    const res = await fetch("/api/procurement/incoming", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    if (res.ok) return { ok: true }
    const json = (await res.json().catch(() => null)) as { code?: string } | null
    return { ok: false, reason: (json?.code || "failed").toLowerCase() }
  } catch {
    return { ok: false, reason: "failed" }
  }
}

/** A project request was approved: bring it in now rather than at the next opening of the desk. Best effort — the daily job and every opening of the desk do the same pass. */
export const ingestIncoming = (): Promise<IncomingActResult> => incomingAct({ action: "ingest" })
