import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { verifyOtp } from "@/lib/otp"
import {
  PM_PORTAL_LINKS,
  addSession,
  hashSecret,
  linkRefusal,
  newSessionSecret,
  resolvePortalLink,
  riyadhDay,
  verifyBody,
  type PmPortalLink,
  type PortalProjectDoc,
} from "@/lib/pm/portal-links"

// The code proves the phone and opens a 12-hour session; its secret goes back
// to the browser once and is stored only as a hash. The first opening is
// recorded on the project (`pm.portal.seenOn`) — what ends "I never got it".

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const parsed = verifyBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail("Enter the six-digit code", "BAD_REQUEST", 400)

    const db = getAdminFirestore()
    const resolved = await resolvePortalLink(db, token)
    if (!resolved.ok) return fail("This link is invalid, replaced, or has expired", resolved.code, resolved.status)
    const { linkId, link } = resolved

    const verdict = await verifyOtp(db, parsed.data.challengeId, { purpose: "pm_portal", subjectId: linkId }, parsed.data.code)
    if (verdict === "wrong") return fail("Wrong code", "WRONG_CODE", 400)
    if (verdict === "unavailable") return fail("The code could not be checked — try again", "CODE_UNCHECKED", 503)
    if (verdict !== "ok") return fail("The code has expired — ask for a new one", "CODE_EXPIRED", 410)

    const now = Date.now()
    const secret = newSessionSecret()
    const linkRef = db.collection(PM_PORTAL_LINKS).doc(linkId)
    const projectRef = db.collection("projects").doc(link.projectId)
    const expiresAt = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(linkRef)).data() as PmPortalLink | undefined
      if (!fresh || linkRefusal(fresh, now)) return null
      const project = (await tx.get(projectRef)).data() as PortalProjectDoc | undefined
      const session = addSession(fresh.sessions, hashSecret(secret), now)
      tx.update(linkRef, { sessions: session.sessions, seenAt: fresh.seenAt ?? new Date(now).toISOString() })
      const portal = project?.pm?.portal
      if (portal && portal.linkId === linkId && !portal.seenOn) tx.update(projectRef, { "pm.portal.seenOn": riyadhDay(now) })
      return session.expiresAt
    })
    if (!expiresAt) return fail("This link has been replaced", "LINK_REVOKED", 410)

    return NextResponse.json({ success: true, data: { session: secret, expiresAt } })
  } catch (error) {
    console.error("PM portal verify error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
