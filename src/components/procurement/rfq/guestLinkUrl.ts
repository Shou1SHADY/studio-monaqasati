import type { User } from "firebase/auth"

/** The RFQ's guest link — minted, or the live one reused (`/api/rfq-share/create`).
 * Only an open round that asks for offers has one; null when it cannot be had. */
export async function guestLinkUrl(user: User | null | undefined, rfq: { id: string; status?: string | null; directAward?: boolean | null }): Promise<string | null> {
  if (!user || rfq.status !== "New" || rfq.directAward) return null
  const idToken = await user.getIdToken()
  const res = await fetch("/api/rfq-share/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ rfqId: rfq.id }),
  })
  const json = (await res.json().catch(() => null)) as { data?: { url?: string } } | null
  return res.ok ? json?.data?.url || null : null
}
