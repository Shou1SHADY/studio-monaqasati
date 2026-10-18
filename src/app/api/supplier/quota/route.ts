import { NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { quoteUsage } from "@/lib/supplier-approval-server"

// What the caller's company has used of the free plan's monthly quote allowance (supplier-approval.ts) — the count
// lives in a server-only collection, so the quote form reads it here. `limit: null` = no limit.

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function GET(req: Request) {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }
  try {
    const db = getAdminFirestore()
    const user = (await db.collection("users").doc(uid).get()).data() as { role?: string; organizationId?: string } | undefined
    if (!user || user.role !== "Supplier") return fail("Suppliers only", "no_permission", 403)
    return NextResponse.json({ success: true, data: await quoteUsage(db, user.organizationId || uid) })
  } catch (error) {
    console.error("Supplier quota read error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
