import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { answerStoreTransfer, StoreTransferRefusal } from "@/lib/pm/store-transfer-server"

export const dynamic = "force-dynamic"

// PM 1.1 STK-11 — the receiving project's engineer confirms or refuses a material
// moved in from another of the company's projects. The sender's ledger line
// belongs to the other project, so the answer is written here (Admin SDK), after
// the guard and the rule are re-run in one transaction.

const body = z.object({
  projectId: z.string().min(1).max(200),
  storeId: z.string().min(1).max(200),
  index: z.number().int().min(0),
  answer: z.enum(["confirm", "refuse"]),
  why: z.string().max(500).nullable().optional(),
  costHint: z.number().finite().nonnegative().nullable().optional(),
})

const STATUS = { NOT_FOUND: 404, REFUSED: 403, BLOCKED: 409 } as const
const fail = (message: string, code: string, status: number, blocks?: string[]) => NextResponse.json({ error: true, message, code, ...(blocks ? { blocks } : {}) }, { status })

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
  if (!parsed.success) return fail("Check the request", "BAD_REQUEST", 400)
  try {
    const d = parsed.data
    const answer = await answerStoreTransfer(getAdminFirestore(), uid, { projectId: d.projectId, storeId: d.storeId, index: d.index, answer: d.answer, why: d.why ?? null, costHint: d.costHint ?? null })
    return NextResponse.json({ success: true, data: { answer } })
  } catch (error) {
    if (error instanceof StoreTransferRefusal) return fail(error.code, error.code, STATUS[error.code], error.blocks)
    console.error("pm store transfer:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
