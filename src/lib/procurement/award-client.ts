// The browser's side of /api/procurement/rfq/award: the signed-in user's token goes with the picks (each pinned to the version it was
// made on); a refusal comes back as the code the review dialog already knows how to say.

import { getAuth } from "firebase/auth"
import type { AwardInput, AwardResult } from "./rfq-server/award-server"

export class AwardRefused extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string | number> = {}
  ) {
    super(code)
    this.name = "AwardRefused"
  }
}

export type AwardRequest = Omit<AwardInput, "approveNow" | "acceptGuest"> & { approveNow?: string[]; acceptGuest?: boolean }

export async function awardRfq(body: AwardRequest): Promise<AwardResult> {
  const token = await getAuth().currentUser?.getIdToken()
  if (!token) throw new AwardRefused("UNAUTHENTICATED")
  const res = await fetch("/api/procurement/rfq/award", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: AwardResult; code?: string; params?: Record<string, string | number> } | null
  if (!res.ok || !json?.success || !json.data) throw new AwardRefused(json?.code || "INTERNAL", json?.params)
  return json.data
}

/** The editor's direct award: the accepted offer it created becomes its order here (the browser creates no order). */
export const awardDirectOffer = (rfqId: string, offerId: string, reason: string | null, locale?: "ar" | "en"): Promise<AwardResult> => awardRfq({ rfqId, picks: [], direct: { offerId, reason }, locale })
