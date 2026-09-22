import { NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"

// The second sign-in step, checked where the code cannot be read.
//
// The code lives at users/{uid}/2fa/current, written by /api/sms and closed to
// every browser by the rules. This page used to read it back and compare in
// the browser — which meant anyone holding the password could simply read the
// answer. Five wrong guesses retire the code; a right one consumes it.

const body = z.object({ code: z.string().regex(/^\d{6}$/) })
const MAX_ATTEMPTS = 5

const fail = (message: string, code: string, status: number) =>
  NextResponse.json({ error: true, message, code }, { status })

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
  if (!parsed.success) return fail("The code is six digits", "BAD_CODE", 400)

  const db = getAdminFirestore()
  const ref = db.collection("users").doc(uid).collection("2fa").doc("current")

  const verdict = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const stored = snap.data() as { code?: string; expiresAt?: string; attempts?: number } | undefined
    if (!stored?.code) return "missing" as const
    if ((stored.attempts ?? 0) >= MAX_ATTEMPTS) {
      tx.delete(ref)
      return "exhausted" as const
    }
    if (!stored.expiresAt || new Date() > new Date(stored.expiresAt)) {
      tx.delete(ref)
      return "expired" as const
    }
    const a = Buffer.from(stored.code)
    const b = Buffer.from(parsed.data.code)
    if (a.length === b.length && timingSafeEqual(a, b)) {
      tx.delete(ref)
      return "ok" as const
    }
    tx.update(ref, { attempts: (stored.attempts ?? 0) + 1 })
    return "wrong" as const
  })

  if (verdict === "ok") return NextResponse.json({ success: true, data: { verified: true } })
  if (verdict === "wrong") return fail("Wrong code", "WRONG", 400)
  if (verdict === "missing") return fail("No code was requested", "NOT_FOUND", 404)
  return fail("The code has expired — ask for a new one", verdict === "expired" ? "EXPIRED" : "EXHAUSTED", 410)
}
