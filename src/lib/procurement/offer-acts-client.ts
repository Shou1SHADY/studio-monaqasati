// The browser's side of `POST /api/procurement/offers/act`: one call with the signed-in user's token. A refusal throws with the reason the
// screens translate.

import { getAuth } from "firebase/auth"
import type { OfferActInput } from "./offer-acts-server"

export class OfferActRefused extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = "OfferActRefused"
  }
}

export async function offerAct(input: OfferActInput): Promise<void> {
  const user = getAuth().currentUser
  if (!user) throw new OfferActRefused("no_permission")
  const res = await fetch("/api/procurement/offers/act", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify(input) })
  const json = (await res.json().catch(() => null)) as { success?: boolean; reason?: string; code?: string } | null
  if (res.ok && json?.success) return
  throw new OfferActRefused(json?.reason || json?.code?.toLowerCase() || "internal")
}
