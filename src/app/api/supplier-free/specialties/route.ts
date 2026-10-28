import { NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { SAUDI_CITIES } from "@/lib/constants"
import { isSecondaryOrgAdmin } from "@/lib/org-identity-admin"
import { serverMaterialTree } from "@/lib/materials/tree-server"
import { planOf, type PlanDoc } from "@/lib/supplier-plan"

// A free supplier's specialties (sub-categories of the material tree, PUR-04) and coverage cities (PRD ACC-02): at
// least one of each, and the quote requests that reach him follow AT ONCE. On the full portal the same fields wait for the platform's approval, so this route
// refuses a company that is not on the free journey.

const body = z.object({
  subIds: z.array(z.string().min(1).max(64)).min(1).max(120),
  coverageCities: z.array(z.string().min(1).max(60)).min(1).max(60),
})

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
  if (!parsed.success) return fail("Choose at least one specialty and one city", "BAD_REQUEST", 400)
  const subIds = [...new Set(parsed.data.subIds)]
  const cities = [...new Set(parsed.data.coverageCities)]
  if (cities.some((c) => !(SAUDI_CITIES as readonly string[]).includes(c))) return fail("Unknown specialty or city", "BAD_REQUEST", 400)

  const db = getAdminFirestore()
  const tree = await serverMaterialTree(db)
  const known = new Set(tree.subs.map((s) => s.id))
  if (subIds.some((id) => !known.has(id))) return fail("Unknown specialty or city", "BAD_REQUEST", 400)
  const user = (await db.collection("users").doc(uid).get()).data() as { role?: string; organizationId?: string; organizationRole?: string } | undefined
  if (!user || user.role !== "Supplier") return fail("Suppliers only", "FORBIDDEN", 403)
  const orgId = user.organizationId || uid
  const isOwner = orgId === uid || user.organizationRole === "owner"
  if (!isOwner) return fail("Only the company owner edits specialties", "FORBIDDEN", 403)
  const plan = (await db.collection("companyPlans").doc(orgId).get()).data() as PlanDoc | undefined
  if (planOf(plan) === "full") return fail("This company's specialties go through approval", "FORBIDDEN", 403)

  const target = isSecondaryOrgAdmin(user.organizationId, uid, user.organizationRole) ? db.collection("organizations").doc(orgId) : db.collection("users").doc(uid)
  await target.set(
    { specialtyIds: subIds, coverageCities: cities, pendingSpecializations: FieldValue.delete(), pendingCoverageCities: FieldValue.delete(), specialtyIdsUpdatedAt: new Date().toISOString() },
    { merge: true }
  )
  return NextResponse.json({ success: true, data: { subIds, coverageCities: cities } })
}
