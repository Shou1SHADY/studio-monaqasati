import { NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { RfqError, type RfqCaller } from "@/lib/procurement/rfq-server/common"

export const fail = (message: string, code: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error: true, message, code, ...extra }, { status })

export async function rfqRoute<T>(
  req: Request,
  label: string,
  parse: (raw: unknown) => { success: true; data: T } | { success: false },
  run: (db: ReturnType<typeof getAdminFirestore>, caller: RfqCaller, input: T) => Promise<unknown>
): Promise<NextResponse> {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }
  const parsed = parse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Check the request", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("Account not found", "FORBIDDEN", 403)
    return NextResponse.json({ success: true, data: await run(db, caller, parsed.data) })
  } catch (error) {
    if (error instanceof RfqError) return fail(error.code.replace(/_/g, " "), error.code.toUpperCase(), error.status, { reason: error.code, params: error.params })
    console.error(`${label}:`, error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
