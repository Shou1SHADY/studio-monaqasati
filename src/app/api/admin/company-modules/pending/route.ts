import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import type { PendingByModule, PendingItem } from "@/lib/company-modules-pending"

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

    const count = async (collection: string, field: string, value: string | string[]): Promise<number> => {
      const base = db.collection(collection).where("organizationId", "==", orgId)
      const snap = await (Array.isArray(value) ? base.where(field, "in", value) : base.where(field, "==", value)).count().get()
      return snap.data().count
    }

    // Equipment requests approved and not yet answered by the desk, across the company's projects.
    const projects = await db.collection("projects").where("organizationId", "==", orgId).select().limit(300).get()
    let plant = 0
    for (const p of projects.docs) {
      const reqs = await p.ref.collection("pmPlantRequests").where("status", "==", "go").get()
      plant += reqs.docs.filter((d) => !d.data().rep && !d.data().got).length
    }

    const [handover, exits, advances, payroll, notes, requests] = await Promise.all([
      count("pmHandovers", "status", "wait"),
      count("hrExits", "state", "leaving"),
      db.collection("hrRequests").where("organizationId", "==", orgId).where("kind", "==", "advance").where("state", "==", "finance").count().get().then((s) => s.data().count),
      count("hrPayrolls", "state", ["prepared", "approved", "posted"]),
      count("deliveryNotes", "status", "in_transit"),
      count("manufacturingRequests", "status", "new"),
    ])

    const keep = (items: PendingItem[]) => items.filter((i) => i.count > 0)
    const pending: PendingByModule = {
      "project-management": keep([{ key: "plant", count: plant }, { key: "handover", count: handover }]),
      hr: keep([{ key: "exits", count: exits }, { key: "advances", count: advances }, { key: "payroll", count: payroll }]),
      manufacturing: keep([{ key: "notes", count: notes }, { key: "requests", count: requests }]),
    }
    return NextResponse.json({ success: true, data: pending })
  } catch (err) {
    console.error("company-modules pending failed:", err)
    return errorResponse("Could not read the pending items", "SERVER_ERROR", 500)
  }
}
