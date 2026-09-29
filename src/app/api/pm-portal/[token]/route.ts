import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { maskPhone, resolvePortalLink, type PortalProjectDoc } from "@/lib/pm/portal-links"

// Public: enough for the consultant to know the link is his before the code —
// the project's name and number, his name, and the last digits of the mobile
// the code goes to. Nothing the project holds comes back before the code.

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const db = getAdminFirestore()
    const resolved = await resolvePortalLink(db, token)
    if (!resolved.ok) return fail("This link is invalid, replaced, or has expired", resolved.code, resolved.status)
    const { link } = resolved
    const project = (await db.collection("projects").doc(link.projectId).get()).data() as PortalProjectDoc | undefined
    return NextResponse.json({
      success: true,
      data: {
        projectName: project?.name || "",
        projectNo: project?.pm?.no || null,
        consultantName: link.consultant.name,
        phoneMasked: maskPhone(link.consultant.phone),
      },
    })
  } catch (error) {
    console.error("PM portal link read error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
