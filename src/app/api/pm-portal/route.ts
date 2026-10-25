import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { SITE_URL } from "@/lib/app-env"
import { mintLinkToken } from "@/lib/links/hash"
import { callerOf } from "@/lib/receipt-links"
import { isSmsConfigured, isWhatsAppConfigured, sendDirectMessage } from "@/lib/sms"
import { saudiMobileE164 } from "@/lib/supplier-free/phone-auth"
import { planSend, revokePatch } from "@/lib/pm/consultant-portal-server"
import {
  PM_PORTAL_LINKS,
  PORTAL_LINK_TTL_MS,
  appendLog,
  createBody,
  maskPhone,
  mayManagePortal,
  projectRefusal,
  riyadhDay,
  type PmPortalLink,
  type PmPortalState,
  type PortalProjectDoc,
} from "@/lib/pm/portal-links"

// The consultant portal's link (PM 1.0 → 1.1). One per project, sent to the
// representative's mobile the project's details hold (PRJ-01, CP-02) — never a
// number typed here. A resend is a new code on the SAME link (CP-03): a fresh
// token is added to it (the SMS already in his hand keeps working), the send is
// counted and logged. Only a new mobile — or a revoked or expired link — makes
// a new link, and that revokes every other. The project's `pm.portal` records
// sent (and the opened state of the link it names) for the panel's gates.

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
  if (!parsed.success) return fail("Which project?", "BAD_REQUEST", 400)

  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("No profile", "FORBIDDEN", 403)

    const { projectId } = parsed.data
    const projectRef = db.collection("projects").doc(projectId)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    type Outcome = { ok: true; linkId: string; phone: string; sends: number; projectName: string } | { ok: false; message: string; code: string; status: number }
    const outcome: Outcome = await db.runTransaction(async (tx): Promise<Outcome> => {
      const project = (await tx.get(projectRef)).data() as PortalProjectDoc | undefined
      const refusal = projectRefusal(project, caller.orgId)
      if (refusal) return { ok: false, message: refusal === "PROJECT_CLOSED" ? "The project is closed" : "Project not found", code: refusal, status: refusal === "PROJECT_CLOSED" ? 409 : 404 }
      if (!mayManagePortal(caller, project as PortalProjectDoc)) return { ok: false, message: "Only the owner or the project's manager sends the portal link", code: "FORBIDDEN", status: 403 }
      const rep = project?.consultantRep
      const phone = saudiMobileE164(rep?.phone)
      if (!project?.consultant?.trim() || !phone) return { ok: false, message: "Add the consultant's representative and mobile in the project's details", code: "NO_REP", status: 409 }
      const name = rep?.name?.trim() || project.consultant.trim()

      const earlier = await tx.get(db.collection(PM_PORTAL_LINKS).where("projectId", "==", projectId))
      const links = earlier.docs.map((d) => ({ id: d.id, link: d.data() as PmPortalLink }))
      const plan = planSend(links, phone, now)
      for (const id of plan.revoke) {
        const l = links.find((x) => x.id === id) as { id: string; link: PmPortalLink }
        tx.update(db.collection(PM_PORTAL_LINKS).doc(id), revokePatch(l.link, "replaced", caller.name, nowIso))
      }

      let linkId: string
      let sends: number
      let seenOn: string | null = null
      if (plan.reuse) {
        const live = links.find((x) => x.id === plan.reuse) as { id: string; link: PmPortalLink }
        linkId = live.id
        sends = (live.link.sends ?? 1) + 1
        seenOn = live.link.seenAt ? riyadhDay(Date.parse(live.link.seenAt)) : null
        tx.update(db.collection(PM_PORTAL_LINKS).doc(linkId), { sends, log: appendLog(live.link.log, { t: "send", at: nowIso, byName: caller.name, sends }) })
      } else {
        const ref = db.collection(PM_PORTAL_LINKS).doc()
        linkId = ref.id
        sends = 1
        const latest = links.map((l) => l.link).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
        const link: PmPortalLink = {
          tokenHashes: [],
          projectId,
          organizationId: caller.orgId,
          consultant: { name, phone },
          status: "open",
          createdById: caller.uid,
          createdByName: caller.name,
          createdAt: nowIso,
          expiresAt: new Date(now + PORTAL_LINK_TTL_MS).toISOString(),
          seenAt: null,
          sessions: [],
          history: latest?.history ?? [],
          sends,
          log: [{ t: "send", at: nowIso, byName: caller.name, sends }],
          uploads: [],
        }
        tx.set(ref, link)
      }
      const portal: PmPortalState = { sentOn: riyadhDay(now), seenOn, name, phoneMasked: maskPhone(phone), linkId, sentBy: caller.uid, sentByName: caller.name, sends }
      tx.update(projectRef, { "pm.portal": portal })
      return { ok: true, linkId, phone, sends, projectName: project.name || project.pm?.no || "" }
    })
    if (!outcome.ok) return fail(outcome.message, outcome.code, outcome.status)

    // Only the token's hash is stored; the token itself leaves here once, in the URL.
    const token = await mintLinkToken(db, "pm", outcome.linkId)
    const url = `${SITE_URL}/portal/${token}`
    let sent = false
    if (isSmsConfigured() || isWhatsAppConfigured()) {
      const body = `مدماك تيك: ${caller.name} يرسل إليك ما ينتظر ردّك في مشروع «${outcome.projectName}». افتح الرابط وأدخل الرمز الذي يصلك على جوالك: ${url}`
      sent = (await sendDirectMessage({ to: outcome.phone, body }).catch(() => ({ sent: false }))).sent
    }

    return NextResponse.json({ success: true, data: { url, phoneMasked: maskPhone(outcome.phone), sent, sends: outcome.sends, reused: outcome.sends > 1 } })
  } catch (error) {
    console.error("PM portal link create error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
