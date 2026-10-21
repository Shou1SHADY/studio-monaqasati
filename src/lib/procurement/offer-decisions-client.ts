// The browser's side of /api/procurement/offers/decide: the signed-in user's token goes with the request and a refusal
// comes back as the code the screens already know how to say.

import { getAuth } from "firebase/auth"
import type { DecideInput, DecisionResult } from "./offer-decisions-server"

export class DecisionRefused extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "DecisionRefused"
  }
}

export async function decideOffer(body: DecideInput): Promise<DecisionResult> {
  const token = await getAuth().currentUser?.getIdToken()
  if (!token) throw new DecisionRefused("UNAUTHENTICATED")
  const res = await fetch("/api/procurement/offers/decide", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: DecisionResult; code?: string } | null
  if (!res.ok || !json?.success || !json.data) throw new DecisionRefused(json?.code || "INTERNAL")
  return json.data
}
