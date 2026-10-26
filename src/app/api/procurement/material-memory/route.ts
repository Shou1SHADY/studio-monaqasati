import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { MATERIAL_MEMORY, rememberPick, storedMemory } from "@/lib/boq-import/materials-memory"

// «يتذكّر» (IMP 1.3, IMP-09): what a buyer picks for a text of an uploaded file is recognised in the company's next files.
// One document per company, written and read here only — no client rule: the file never leaves the browser, only the
// text, the material's id and the values chosen. Whoever can raise an RFQ reads and writes it; nobody else.

const entry = z
  .object({
    text: z.string().trim().min(1).max(300),
    nodeId: z.string().trim().min(1).max(128),
    specs: z.array(z.object({ spec: z.string().max(200), option: z.string().max(200) })).max(20),
    brand: z.string().max(200).nullable(),
  })
  .strict()

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

type Caller = NonNullable<Awaited<ReturnType<typeof callerOf>>>

async function authorised(req: NextRequest): Promise<NextResponse | { db: FirebaseFirestore.Firestore; caller: Caller }> {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }
  const db = getAdminFirestore()
  const caller = await callerOf(db, uid)
  if (!caller) return fail("Sign in first", "UNAUTHENTICATED", 401)
  const mayRaise = caller.can("rfq.create") || caller.can("rfq.manage") || caller.can("projects.publish") || caller.can("offers.accept") || caller.can("po.approve")
  if (!mayRaise) return fail("Uploading materials is for whoever can create RFQs", "FORBIDDEN", 403)
  return { db, caller }
}

export async function GET(req: NextRequest) {
  const auth = await authorised(req)
  if (auth instanceof NextResponse) return auth
  try {
    const snap = await auth.db.collection(MATERIAL_MEMORY).doc(auth.caller.orgId).get()
    return NextResponse.json({ success: true, data: { entries: storedMemory(snap.data()?.entries) } })
  } catch (error) {
    console.error("material memory (read):", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorised(req)
  if (auth instanceof NextResponse) return auth
  const parsed = entry.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Check the pick", "BAD_REQUEST", 400)
  try {
    const ref = auth.db.collection(MATERIAL_MEMORY).doc(auth.caller.orgId)
    const at = new Date().toISOString()
    const entries = await auth.db.runTransaction(async (tx) => {
      const next = rememberPick(storedMemory((await tx.get(ref)).data()?.entries), parsed.data, at, auth.caller.uid)
      tx.set(ref, { organizationId: auth.caller.orgId, entries: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return next
    })
    return NextResponse.json({ success: true, data: { count: entries.length } })
  } catch (error) {
    console.error("material memory (write):", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
