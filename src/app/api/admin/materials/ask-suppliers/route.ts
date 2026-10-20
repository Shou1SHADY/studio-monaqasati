import { NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { choseFromTree } from "@/lib/materials/reach"

// «يُطلب منهم مرة واحدة اختيار تخصصاتهم من الشجرة، برسالة من المنصة» (PUR-04): the
// platform admin tells every supplier company that has not chosen yet. A company that
// was told already is not told again (`specialtiesAskedAt`).

export const maxDuration = 60
const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })
type Rec = Record<string, unknown>

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
  try {
    const db = getAdminFirestore()
    const sender = (await db.collection("users").doc(uid).get()).data() as Rec | undefined
    if (!sender || sender.role !== "Admin") return fail("Admins only", "FORBIDDEN", 403)

    const suppliers = await db.collection("users").where("role", "==", "Supplier").get()
    const at = new Date().toISOString()
    let told = 0
    let batch = db.batch()
    let n = 0
    for (const d of suppliers.docs) {
      const u = d.data() as Rec
      // The company's owner is told; a member's company is his owner's.
      const owner = !u.organizationId || u.organizationId === d.id || u.organizationRole === "owner"
      if (!owner || u.specialtiesAskedAt) continue
      // A secondary company keeps its own specialties on its organizations document.
      const org = typeof u.organizationId === "string" && u.organizationId !== d.id ? ((await db.collection("organizations").doc(u.organizationId).get()).data() as Rec | undefined) : undefined
      if (choseFromTree(u, org)) continue
      batch.set(d.ref.collection("notifications").doc(), {
        userId: d.id,
        organizationId: (u.organizationId as string) || d.id,
        type: "platform_notice",
        i18n: { title: "pn_choose_specialties_title", message: "pn_choose_specialties", params: {} },
        title: "اختر تخصصاتك من شجرة المواد",
        message: "طلبات العروض صارت تُكتب بشجرة مواد واحدة. اختر الفئات الفرعية التي تورّدها مرة واحدة لتصلك الطلبات العامة فيها.",
        link: "/supplier/profile?tab=specs",
        createdAt: at,
        read: false,
      })
      batch.set(d.ref, { specialtiesAskedAt: at }, { merge: true })
      told += 1
      n += 2
      if (n >= 400) {
        await batch.commit()
        batch = db.batch()
        n = 0
      }
    }
    if (n) await batch.commit()
    return NextResponse.json({ success: true, data: { told } })
  } catch (error) {
    console.error("ask suppliers for specialties:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
