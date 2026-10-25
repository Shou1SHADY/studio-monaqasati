import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { PROC_SOON_NOTIFY, soonNotifyId } from "@/lib/procurement/soon-notify"

// «أبلغني حين يُطلق» on a «قريباً» window: the member asks to be told when the feature launches. One entry per member and topic,
// written here with the Admin SDK — the collection has no client rule at all, so a browser can neither read nor write it.

const body = z.object({ topic: z.enum(["bnpl"]) })
const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function POST(req: NextRequest) {
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
  if (!parsed.success) return fail("Unknown topic", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const profile = (await db.collection("users").doc(uid).get()).data() as { organizationId?: string } | undefined
    if (!profile) return fail("Sign in first", "UNAUTHENTICATED", 401)
    await db
      .collection(PROC_SOON_NOTIFY)
      .doc(soonNotifyId(uid, parsed.data.topic))
      .set({ userId: uid, organizationId: profile.organizationId || uid, topic: parsed.data.topic, createdAt: FieldValue.serverTimestamp() }, { merge: true })
    return NextResponse.json({ success: true, data: { topic: parsed.data.topic } })
  } catch {
    return fail("Could not save the request", "SERVER_ERROR", 500)
  }
}
