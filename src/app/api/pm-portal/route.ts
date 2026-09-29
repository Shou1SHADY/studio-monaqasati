import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { SITE_URL } from "@/lib/app-env"
import { callerOf } from "@/lib/receipt-links"
import { isSmsConfigured, isWhatsAppConfigured, normalizePhoneE164, sendDirectMessage } from "@/lib/sms"
import {
  PM_PORTAL_LINKS,
  PORTAL_LINK_TTL_MS,
  createBody,
  maskPhone,
  mayManagePortal,
  newToken,
  projectRefusal,
  riyadhDay,
  type PmPortalLink,
  type PmPortalState,
  type PortalProjectDoc,
} from "@/lib/pm/portal-links"

// The consultant portal's link (PM 1.0). One per project: sending it again
// revokes the one before, so exactly one mobile answers for the consultant.
// The project's `pm.portal` records sent (and resets opened) for the panel's
// gates; the answers already given carry over to the new link's history.

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function POST(req: NextRequest) {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)

  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }

  const parsed = createBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("A name and a mobile number are needed", "BAD_REQUEST", 400)

  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("No profile", "FORBIDDEN", 403)

    const projectRef = db.collection("projects").doc(parsed.data.projectId)
    const project = (await projectRef.get()).data() as PortalProjectDoc | undefined
    const refusal = projectRefusal(project, caller.orgId)
    if (refusal) return fail(refusal === "PROJECT_CLOSED" ? "The project is closed" : "Project not found", refusal, refusal === "PROJECT_CLOSED" ? 409 : 404)
    if (!mayManagePortal(caller, project as PortalProjectDoc)) return fail("Only the owner or the project's manager sends the portal link", "FORBIDDEN", 403)

    const phone = normalizePhoneE164(parsed.data.phone)
    if (!phone) return fail("That mobile number cannot receive a code", "NO_PHONE", 400)

    const now = Date.now()
    const earlier = await db.collection(PM_PORTAL_LINKS).where("projectId", "==", parsed.data.projectId).get()
    const latest = earlier.docs.map((d) => d.data() as PmPortalLink).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
    const token = newToken()
    const linkRef = db.collection(PM_PORTAL_LINKS).doc()
    const name = parsed.data.name.trim()
    const link: PmPortalLink = {
      token,
      projectId: parsed.data.projectId,
      organizationId: caller.orgId,
      consultant: { name, phone },
      status: "open",
      createdById: caller.uid,
      createdByName: caller.name,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PORTAL_LINK_TTL_MS).toISOString(),
      seenAt: null,
      sessions: [],
      history: latest?.history ?? [],
    }
    const portal: PmPortalState = {
      sentOn: riyadhDay(now),
      seenOn: null,
      name,
      phoneMasked: maskPhone(phone),
      linkId: linkRef.id,
      sentBy: caller.uid,
      sentByName: caller.name,
    }

    const batch = db.batch()
    for (const d of earlier.docs) if (d.data().status === "open") batch.update(d.ref, { status: "revoked", sessions: [] })
    batch.set(linkRef, link)
    batch.update(projectRef, { "pm.portal": portal })
    await batch.commit()

    const url = `${SITE_URL}/portal/${token}`
    let sent = false
    if (isSmsConfigured() || isWhatsAppConfigured()) {
      const projectName = project?.name || project?.pm?.no || ""
      const body = `مدماك تيك: ${caller.name} يرسل إليك ما ينتظر ردّك في مشروع «${projectName}». افتح الرابط وأدخل الرمز الذي يصلك على جوالك: ${url}`
      sent = (await sendDirectMessage({ to: phone, body }).catch(() => ({ sent: false }))).sent
    }

    return NextResponse.json({ success: true, data: { url, phoneMasked: portal.phoneMasked, sent, expiresAt: link.expiresAt } })
  } catch (error) {
    console.error("PM portal link create error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
