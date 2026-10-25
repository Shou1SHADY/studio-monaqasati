import { NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { countPortalView } from "@/lib/procurement/portal-views"

// A registered supplier opened an RFQ in his portal (RFQ-02, «اطّلع عليه»): counted once per supplier company, on the server —
// `viewsCount` is not a field any client may write, and the dedupe mark is server-only (portal-views.ts).

const Body = z.object({ rfqId: z.string().min(1).max(128) })

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function POST(req: Request) {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Bad request", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const user = (await db.collection("users").doc(uid).get()).data() as { role?: string; organizationId?: string } | undefined
    if (!user || user.role !== "Supplier") return fail("Suppliers only", "NO_PERMISSION", 403)
    const r = await countPortalView(db, parsed.data.rfqId, user.organizationId || uid)
    if (r.refusal === "not_found") return fail("Not found", "NOT_FOUND", 404)
    return NextResponse.json({ success: true, data: { counted: r.counted } })
  } catch (error) {
    console.error("RFQ portal view not counted:", (error as { code?: string })?.code || error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
