import { NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { serverMaterialTree } from "@/lib/materials/tree-server"
import { addSuggestion } from "@/lib/materials/admin-edit"
import { MATERIAL_SUGGESTIONS_DOC, MATERIAL_TREE, type MaterialSuggestion } from "@/lib/materials/types"
import { label } from "@/lib/materials/tree"

// «غير موجود؟ اكتبه كما هو» (PUR-04): a material typed outside the list reaches the
// platform team to be added. Only the words and the sub-category are kept — no company.

const body = z.object({ items: z.array(z.object({ name: z.string().min(1).max(200), subId: z.string().min(1).max(64) })).min(1).max(50) })
const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function POST(req: Request) {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
  try {
    await getAdminAuth().verifyIdToken(idToken)
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Nothing to suggest", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const tree = await serverMaterialTree(db)
    const ref = db.collection(MATERIAL_TREE).doc(MATERIAL_SUGGESTIONS_DOC)
    const at = new Date().toISOString()
    await db.runTransaction(async (tx) => {
      let list = ((await tx.get(ref)).data()?.items as MaterialSuggestion[] | undefined) || []
      for (const it of parsed.data.items) {
        const sub = tree.byId.get(it.subId)
        if (!sub) continue
        list = addSuggestion(list, { name: it.name, subId: it.subId, sub: label(sub, "ar") }, at)
      }
      tx.set(ref, { items: list, updatedAt: at }, { merge: true })
    })
    return NextResponse.json({ success: true, data: {} })
  } catch (error) {
    console.error("material suggestion:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
