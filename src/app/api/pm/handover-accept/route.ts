import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { acceptHandoverCore, AcceptCoreError } from "@/lib/pm/handover-accept"
import { adminAcceptStore } from "@/lib/pm/handover-accept-server"
import { BOQ_SOURCES, PROJECT_KINDS } from "@/lib/pm/handover"

// PM 1.1 — accepting a handover FILE (HO-02, WF-01, CON-01). The project, its number, the advance term (frozen,
// IPC-07) and its BOQ are written in ONE transaction here: the rules cannot let a client create a project and its
// lines together, and a later client batch could fail half-way. A file that carries the winning bid's priced BOQ is
// accepted only with that BOQ, as sent — whatever the request says. The seats, the site store and the notices
// follow from the client, as they did. Answers `{ success, data: { projectId, projectNo, storeId, … } }`.

const termsSchema = z
  .object({
    payer: z.string().max(20),
    basis: z.string().max(20),
    advance: z.number().min(0).max(1),
    advanceRecovery: z.string().max(20),
    retention: z.number().min(0).max(1),
    retentionCap: z.number().min(0).max(1),
    retentionRelease: z.string().max(20),
    paymentDays: z.number().int().min(0).max(3650),
    consultantDays: z.number().int().min(0).max(3650),
    claimNoticeDays: z.number().int().min(0).max(3650),
    defectsDays: z.number().int().min(0).max(3650),
    damages: z.object({ on: z.boolean(), weeklyRate: z.number().min(0).max(1), cap: z.number().min(0).max(1) }),
  })
  .passthrough()

const line = z.object({
  itemNo: z.string().trim().max(60),
  descriptionAr: z.string().max(2000),
  descriptionEn: z.string().max(2000),
  unit: z.string().max(40),
  quantity: z.number().finite().min(0).max(1e12),
  unitPrice: z.number().finite().min(0).max(1e12),
  groupId: z.string().max(200).nullable(),
  extra: z.record(z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()])).optional(),
})

const body = z.object({
  handoverId: z.string().min(1).max(128),
  kind: z.enum(PROJECT_KINDS),
  location: z.string().max(300).nullable(),
  region: z.string().max(120).nullable().optional(),
  enabledSections: z.array(z.string().max(40)).max(80),
  terms: termsSchema.optional(),
  manager: z.object({ uid: z.string().min(1).max(128), name: z.string().max(200).nullable() }),
  note: z.string().max(2000).nullable().optional(),
  wantsStore: z.boolean().optional(),
  source: z.enum(BOQ_SOURCES),
  lines: z.array(line).max(5000).optional(),
  groups: z.array(z.object({ id: z.string().min(1).max(200), titleAr: z.string().max(500), categoryAr: z.string().max(500) })).max(500).optional(),
})

const STATUS: Record<string, number> = { missing: 404, not_yours: 403, not_waiting: 409, blocked: 409, invalid: 400, boq_from_crm: 409, boq_empty: 400 }
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

export async function POST(req: NextRequest) {
  const uid = await uidOf(req)
  if (!uid) return fail("Sign in first", "UNAUTHENTICATED", 401)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Invalid request", "invalid", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("Sign in first", "UNAUTHENTICATED", 401)
    const { handoverId, ...input } = parsed.data
    const data = await acceptHandoverCore(
      adminAcceptStore(db),
      // The organisation's owner is the account the organisation is named after (a legacy solo account included).
      { uid, owner: caller.orgId === uid, organizationId: caller.orgId },
      handoverId,
      { ...input, terms: input.terms as Parameters<typeof acceptHandoverCore>[3]["terms"] }
    )
    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof AcceptCoreError) return fail(error.code, error.code, STATUS[error.code] ?? 400)
    console.error("pm handover accept:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
