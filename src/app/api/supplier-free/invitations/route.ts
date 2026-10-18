import { NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { normalizePhoneE164 } from "@/lib/sms"
import { notifyNamed } from "@/lib/supplier-free/server-notify"
import { supplierCompanyOf } from "@/lib/supplier-free/supplier-company"

// A contractor's connection invitations to this supplier (PRD CON-02, WF-17). They are addressed by e-mail OR by mobile
// (a free account is created with a mobile and may have no e-mail), so the supplier cannot read them under the rules
// that key on the token's e-mail: the server finds those that are his — by either — and records his answer.

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

interface Caller {
  uid: string
  orgId: string
  email: string
  phone: string
  company: string
  name: string
  specs: string[]
}

async function caller(req: Request, db: Firestore): Promise<Caller | NextResponse> {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }
  const user = (await db.collection("users").doc(uid).get()).data() as Record<string, unknown> | undefined
  if (!user || user.role !== "Supplier") return fail("Suppliers only", "FORBIDDEN", 403)
  // The link names the ACTIVE company (a member's or a secondary company's own name and field), not the caller's doc.
  const c = await supplierCompanyOf(db, uid, user)
  return {
    uid,
    orgId: c.orgId,
    email: String(user.email || "").toLowerCase(),
    phone: normalizePhoneE164(String(user.phone || "")) || "",
    company: c.company,
    name: String(user.name || ""),
    specs: c.field.specs,
  }
}

const mine = (c: Caller, inv: Record<string, unknown>): boolean => {
  const email = String(inv.email || "").toLowerCase()
  const phone = normalizePhoneE164(String(inv.phone || ""))
  return (!!email && email === c.email) || (!!phone && !!c.phone && phone === c.phone)
}

export async function GET(req: Request) {
  const db = getAdminFirestore()
  const c = await caller(req, db)
  if (c instanceof NextResponse) return c
  const found = new Map<string, Record<string, unknown>>()
  const run = async (field: string, value: string) => {
    if (!value) return
    const snap = await db.collection("invitations").where(field, "==", value).where("status", "==", "pending").get()
    for (const d of snap.docs) found.set(d.id, { id: d.id, ...d.data() })
  }
  await Promise.all([run("email", c.email), run("phone", c.phone), run("phone", c.phone.replace(/^\+966/, "0"))])
  const data = [...found.values()]
    .filter((i) => (i.type === "supplier_invite" || i.type == null) && mine(c, i))
    .map((i) => ({ id: i.id, contractorOrgId: i.contractorOrgId || null, contractorName: i.contractorName || null, invitedBy: i.invitedBy || null, message: i.message || "", createdAt: i.createdAt || null }))
  return NextResponse.json({ success: true, data })
}

const body = z.object({ id: z.string().min(1).max(128), answer: z.enum(["accepted", "declined"]) })

export async function POST(req: Request) {
  const db = getAdminFirestore()
  const c = await caller(req, db)
  if (c instanceof NextResponse) return c
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Bad request", "BAD_REQUEST", 400)
  const ref = db.collection("invitations").doc(parsed.data.id)
  const inv = (await ref.get()).data() as Record<string, unknown> | undefined
  if (!inv || !mine(c, inv)) return fail("Not your invitation", "FORBIDDEN", 403)
  if ((inv.status || "pending") !== "pending") return fail("Already answered", "WRONG_STATE", 409)
  const contractorOrgId = String(inv.contractorOrgId || "")
  const inviter = String(inv.invitedBy || "")

  if (parsed.data.answer === "accepted") {
    if (!contractorOrgId) return fail("Invitation has no contractor", "BAD_REQUEST", 400)
    const existing = await db.collection("contractorSupplierLinks").where("contractorOrgId", "==", contractorOrgId).where("supplierOrgId", "==", c.orgId).get()
    const active = existing.docs.find((d) => d.data().status === "active")
    if (!active) {
      const stale = existing.docs[0]
      const link = { contractorOrgId, supplierOrgId: c.orgId, supplierName: c.company, supplierCategories: c.specs, status: "active", requestedBy: "contractor", connectedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }
      if (stale) await stale.ref.set(link, { merge: true })
      else await db.collection("contractorSupplierLinks").add({ ...link, requestedAt: FieldValue.serverTimestamp() })
    }
    await ref.update({ status: "accepted", acceptedAt: FieldValue.serverTimestamp() })
  } else {
    await ref.update({ status: "declined", declinedAt: FieldValue.serverTimestamp() })
  }
  if (inviter && contractorOrgId) {
    await notifyNamed(
      db,
      { uid: c.uid, name: c.name || c.company },
      {
        kind: parsed.data.answer === "accepted" ? "sup_connection_accepted" : "sup_connection_declined",
        organizationId: contractorOrgId,
        params: { supplier: c.company },
        link: "/contractor/suppliers",
      },
      [inviter]
    )
  }
  return NextResponse.json({ success: true, data: { answer: parsed.data.answer } })
}
