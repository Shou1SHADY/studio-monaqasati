import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { setWatch, watchedKeys } from "@/lib/procurement/upcoming-watch-server"

export const dynamic = "force-dynamic"

// «نبّهني حين يصل» (Procurement 2.0, INC-06): the caller's own watches on what is not in Incoming yet. GET lists the keys he watches;
// POST puts one on or takes it off. The documents are written and read here only.

const body = z.object({ key: z.string().min(3).max(300), on: z.boolean() })
const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

async function uidOf(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return null
  try {
    return (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const uid = await uidOf(req)
  if (!uid) return fail("Sign in first", "UNAUTHENTICATED", 401)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("Sign in first", "UNAUTHENTICATED", 401)
    return NextResponse.json({ success: true, data: { keys: await watchedKeys(db, caller.orgId, uid) } })
  } catch (error) {
    console.error("upcoming watch (list):", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

export async function POST(req: NextRequest) {
  const uid = await uidOf(req)
  if (!uid) return fail("Sign in first", "UNAUTHENTICATED", 401)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Check the request", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("Sign in first", "UNAUTHENTICATED", 401)
    const res = await setWatch(db, caller.orgId, uid, parsed.data.key, parsed.data.on)
    if (res === "bad_key") return fail("Check the request", "BAD_REQUEST", 400)
    return NextResponse.json({ success: true, data: { key: parsed.data.key, on: parsed.data.on } })
  } catch (error) {
    console.error("upcoming watch:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
