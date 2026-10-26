import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { riyadhDay } from "@/lib/pm/portal-links"
import { applyBoqImport, BoqImportError, boqImportSchema } from "@/lib/pm/boq-import-server"

// PM 1.0 (BOQ Import): the lines of a bill of quantities, written from the review window — a file
// as received, the Mdmak template or items typed by hand. Replacing or editing removes lines, so it
// runs here with the Admin SDK; the guard (`boq.import`) and the freeze (still planning, nothing
// measured, no line locked into a tender) run again inside the transaction (boq-import-server.ts).

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

  const parsed = boqImportSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("A project and its lines are needed", "BAD_REQUEST", 400)

  try {
    const data = await applyBoqImport(getAdminFirestore(), uid, parsed.data, riyadhDay(Date.now()))
    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof BoqImportError) return fail(error.code === "FORBIDDEN" ? "Importing a BOQ is for whoever prepares the contract" : error.code === "BLOCKED" ? "The BOQ can no longer be changed this way" : "The BOQ could not be written", error.code, error.status, error.blocks)
    console.error("PM BOQ import error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
