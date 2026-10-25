import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { riyadhDay } from "@/lib/pm/portal-links"
import { closePermitServer, PermitCloseError, permitCloseSchema } from "@/lib/pm/permit-close-server"

// PM 1.1 (HSE-01): close a work permit early. Safety (`hse`) on the project, never on an
// archived one; the guard and the rule run again inside the transaction (permit-close-server.ts).

const fail = (message: string, code: string, status: number, blocks?: string[]) => NextResponse.json({ error: true, message, code, ...(blocks?.length ? { blocks } : {}) }, { status })

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

  const parsed = permitCloseSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("A project and a permit are needed", "BAD_REQUEST", 400)

  try {
    const data = await closePermitServer(getAdminFirestore(), uid, parsed.data, riyadhDay(Date.now()))
    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof PermitCloseError) return fail(error.code === "BLOCKED" ? "The permit cannot be closed" : error.code === "FORBIDDEN" ? "Closing a permit is safety's" : "Not found", error.code, error.status, error.blocks)
    console.error("PM permit close error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
