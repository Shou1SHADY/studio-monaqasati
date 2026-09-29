import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import {
  PORTAL_SESSION_HEADER,
  PortalAnswerError,
  answerBody,
  applyPortalAnswer,
  resolvePortalSession,
} from "@/lib/pm/portal-links"

// The consultant answers one record. The write is the internal one re-done in
// a single Admin transaction (`applyPortalAnswer`): the record re-read, the
// same rule re-run, refused when it no longer waits on him or the project is
// closed. The project's manager — or whoever sent the link, on a project with
// none — is told at once.

const fail = (message: string, code: string, status: number, extra?: Record<string, unknown>) => NextResponse.json({ error: true, message, code, ...extra }, { status })

const STATUS: Record<PortalAnswerError["code"], number> = {
  NOT_FOUND: 404,
  NOT_PM_PROJECT: 404,
  NOT_WAITING: 409,
  BLOCKED: 400,
  PROJECT_CLOSED: 409,
  LINK_REVOKED: 410,
  LINK_EXPIRED: 410,
}

const KIND_AR = { subm: "عيّنة", wir: "طلب فحص", punch: "ملاحظة", corr: "خطاب", ncr: "عدم مطابقة" } as const

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const parsed = answerBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail("Check the answer", "BAD_REQUEST", 400)

    const db = getAdminFirestore()
    const now = Date.now()
    const resolved = await resolvePortalSession(db, token, req.headers.get(PORTAL_SESSION_HEADER), now)
    if (!resolved.ok) return fail("Enter the code again", resolved.code, resolved.status)

    let applied: Awaited<ReturnType<typeof applyPortalAnswer>>
    try {
      applied = await applyPortalAnswer(db, resolved.linkId, parsed.data, now)
    } catch (err) {
      if (err instanceof PortalAnswerError) return fail("This answer cannot be recorded", err.code, STATUS[err.code], { blocks: err.blocks })
      throw err
    }

    const { entry, link, project } = applied
    const to = project.projectManagerId || link.createdById
    const projectName = project.name || project.pm?.no || ""
    const record = `${KIND_AR[entry.kind]} ${entry.no}`
    await db
      .collection("users")
      .doc(to)
      .collection("notifications")
      .add({
        userId: to,
        organizationId: link.organizationId,
        type: "pm_portal_answer",
        i18n: {
          title: "pn_portal_answer_title",
          message: "pn_portal_answer",
          params: { name: entry.byName, project: projectName, record: `${entry.no} — ${entry.title}` },
        },
        title: "ردّ الاستشاري عبر البوابة",
        message: `ردّ ${entry.byName} عبر بوابة الاستشاري في مشروع ${projectName}: ${record} — ${entry.title}`,
        projectId: link.projectId,
        link: `/contractor/projects/${link.projectId}?tab=pmCorr`,
        createdAt: entry.at,
        read: false,
      })
      .catch((e) => console.warn("portal answer notification failed:", e?.code || e))

    return NextResponse.json({ success: true, data: { entry } })
  } catch (error) {
    console.error("PM portal answer error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
