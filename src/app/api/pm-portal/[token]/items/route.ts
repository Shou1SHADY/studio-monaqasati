import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import {
  PORTAL_HISTORY_SHOWN,
  PORTAL_SESSION_HEADER,
  portalView,
  projectRefusal,
  readPortalSources,
  resolvePortalSession,
  riyadhDay,
  type PortalProjectDoc,
} from "@/lib/pm/portal-links"

// What waits on the consultant, with what he needs to answer it — through
// `portalView`, which copies named fields only and never a price, cost or
// amount — and the last answers he gave through the link. A closed project
// is shown read-only.

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const db = getAdminFirestore()
    const now = Date.now()
    const resolved = await resolvePortalSession(db, token, req.headers.get(PORTAL_SESSION_HEADER), now)
    if (!resolved.ok) return fail("Enter the code again", resolved.code, resolved.status)
    const { link } = resolved

    const project = (await db.collection("projects").doc(link.projectId).get()).data() as PortalProjectDoc | undefined
    const refusal = projectRefusal(project, link.organizationId)
    if (refusal && refusal !== "PROJECT_CLOSED") return fail("Project not found", refusal, 404)
    const readOnly = refusal === "PROJECT_CLOSED"

    const items = readOnly ? [] : portalView(await readPortalSources(db, link.projectId), riyadhDay(now))
    return NextResponse.json({
      success: true,
      data: {
        projectName: project?.name || "",
        projectNo: project?.pm?.no || null,
        consultantName: link.consultant.name,
        today: riyadhDay(now),
        readOnly,
        items,
        history: (link.history ?? []).slice(0, PORTAL_HISTORY_SHOWN),
      },
    })
  } catch (error) {
    console.error("PM portal items error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
