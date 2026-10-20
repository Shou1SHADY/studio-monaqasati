import { NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { isSecondaryOrgAdmin } from "@/lib/org-identity-admin"
import { serverMaterialTree } from "@/lib/materials/tree-server"

// A supplier's specialties on the material tree (PUR-04): the sub-categories his company
// supplies, chosen once from the tree — an RFQ reaches him by them, matched by id. Free
// or subscribed, the company's owner sets them; each id must be a sub-category of the tree.

const body = z.object({ subIds: z.array(z.string().min(1).max(64)).min(1).max(120) })

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
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Choose at least one sub-category", "BAD_REQUEST", 400)

  try {
    const db = getAdminFirestore()
    const user = (await db.collection("users").doc(uid).get()).data() as { role?: string; organizationId?: string; organizationRole?: string } | undefined
    if (!user || user.role !== "Supplier") return fail("Suppliers only", "FORBIDDEN", 403)
    const orgId = user.organizationId || uid
    const isOwner = orgId === uid || user.organizationRole === "owner"
    if (!isOwner) return fail("Only the company owner edits specialties", "FORBIDDEN", 403)

    const tree = await serverMaterialTree(db)
    const known = new Set(tree.subs.map((s) => s.id))
    const subIds = [...new Set(parsed.data.subIds)]
    if (subIds.some((id) => !known.has(id))) return fail("Unknown sub-category", "BAD_REQUEST", 400)

    const target = isSecondaryOrgAdmin(user.organizationId, uid, user.organizationRole) ? db.collection("organizations").doc(orgId) : db.collection("users").doc(uid)
    await target.set({ specialtyIds: subIds, specialtyIdsUpdatedAt: new Date().toISOString() }, { merge: true })
    return NextResponse.json({ success: true, data: { subIds } })
  } catch (error) {
    console.error("supplier specialties:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
