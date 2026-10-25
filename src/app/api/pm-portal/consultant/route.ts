import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { saudiMobileE164 } from "@/lib/supplier-free/phone-auth"
import { pmAllowed } from "@/lib/pm/access"
import type { ConsultantRep } from "@/lib/pm/consultant-portal"
import { pmCallerContext, repChangeRevokes, revokePatch } from "@/lib/pm/consultant-portal-server"
import { PM_PORTAL_LINKS, consultantBody, type PmPortalLink, type PortalProjectDoc } from "@/lib/pm/portal-links"

// PRJ-01 — the project's consultant and his representative (name, mobile,
// e-mail; each optional), edited by whoever approves (`project.edit`). The
// mobile is 05XXXXXXXX or +9665XXXXXXXX and stored as E.164; anything else is
// refused here. Written on the server because a new representative or mobile —
// or removing the consultant — revokes the open portal link in the same
// transaction and logs why (CP-03); the links are server-only.

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

  const parsed = consultantBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const emailBad = parsed.error.issues.some((i) => i.path[0] === "repEmail")
    return fail(emailBad ? "That e-mail address is not valid" : "Check the consultant's details", emailBad ? "BAD_EMAIL" : "BAD_REQUEST", 400)
  }
  const input = parsed.data
  const phone = input.repPhone ? saudiMobileE164(input.repPhone) : null
  if (input.repPhone && !phone) return fail("A Saudi mobile: 05XXXXXXXX or +9665XXXXXXXX", "BAD_PHONE", 400)

  try {
    const db = getAdminFirestore()
    const projectRef = db.collection("projects").doc(input.projectId)
    const first = (await projectRef.get()).data() as PortalProjectDoc | undefined
    if (!first?.pm) return fail("Project not found", "NOT_FOUND", 404)
    const caller = await pmCallerContext(db, uid, input.projectId, first)
    if (!caller) return fail("Project not found", "NOT_FOUND", 404)
    if (!pmAllowed(caller.ctx, "project.edit")) return fail(caller.ctx.archived ? "The project is closed" : "Only whoever approves edits the project's details", caller.ctx.archived ? "PROJECT_CLOSED" : "FORBIDDEN", 403)

    const consultant = input.consultant || null
    const rep: ConsultantRep | null = input.repName || phone || input.repEmail ? { name: input.repName || null, phone, email: input.repEmail || null } : null
    const nowIso = new Date().toISOString()

    const revoked = await db.runTransaction(async (tx) => {
      const project = (await tx.get(projectRef)).data() as PortalProjectDoc | undefined
      if (!project?.pm) return null
      const why = repChangeRevokes({ consultant: project.consultant, rep: project.consultantRep }, { consultant, rep })
      const open = why ? await tx.get(db.collection(PM_PORTAL_LINKS).where("projectId", "==", input.projectId).where("status", "==", "open")) : null
      const revoking = Boolean(why && open && !open.empty)
      if (revoking && open && why) for (const d of open.docs) tx.update(d.ref, revokePatch(d.data() as PmPortalLink, why, caller.name, nowIso))
      tx.update(projectRef, { consultant, consultantRep: rep, updatedAt: FieldValue.serverTimestamp(), ...(revoking ? { "pm.portal": null } : {}) })
      return revoking ? why : null
    })

    return NextResponse.json({ success: true, data: { revoked } })
  } catch (error) {
    console.error("PM consultant details error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
