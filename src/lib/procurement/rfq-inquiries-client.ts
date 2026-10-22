// The browser's side of /api/procurement/rfq/inquiry: the signed-in user's token goes with the request and a refusal comes
// back as the code the screens already know how to say.

import { getAuth } from "firebase/auth"
import type { InquiryInput, InquiryResult } from "./rfq-server/inquiry"

export class InquiryRefused extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "InquiryRefused"
  }
}

export async function sendInquiryAct(body: InquiryInput): Promise<InquiryResult> {
  const token = await getAuth().currentUser?.getIdToken()
  if (!token) throw new InquiryRefused("UNAUTHENTICATED")
  const res = await fetch("/api/procurement/rfq/inquiry", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: InquiryResult; code?: string } | null
  if (!res.ok || !json?.success || !json.data) throw new InquiryRefused(json?.code || "INTERNAL")
  return json.data
}
