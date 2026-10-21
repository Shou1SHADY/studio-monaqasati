import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { loadPending } from "@/lib/company-modules-pending-server"

// Admin-only: what a company still has in flight inside each optional module, counted on the server because the
// admin account does not read a company's own records. Counts only — no names, no amounts.

const errorResponse = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function GET(req: NextRequest) {
  try {
    const header = req.headers.get("authorization") || ""
    const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
    if (!idToken) return errorResponse("Authentication required", "UNAUTHENTICATED", 401)
    let uid: string
    try {
      uid = (await getAdminAuth().verifyIdToken(idToken)).uid
    } catch {
      return errorResponse("Invalid or expired session", "UNAUTHENTICATED", 401)
    }
    const db = getAdminFirestore()
    const sender = (await db.collection("users").doc(uid).get()).data()
    if (!sender || sender.role !== "Admin") return errorResponse("Only admins can read this", "FORBIDDEN", 403)

    const orgId = req.nextUrl.searchParams.get("orgId")?.trim() || ""
    if (!orgId || orgId.includes("/")) return errorResponse("orgId is required", "INVALID_INPUT", 400)

    return NextResponse.json({ success: true, data: await loadPending(db, orgId) })
  } catch (err) {
    console.error("company-modules pending failed:", err)
    return errorResponse("Could not read the pending items", "SERVER_ERROR", 500)
  }
}
