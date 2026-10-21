import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { FAIL_REASONS } from "@/lib/procurement/incoming-state"
import { failIncoming, linkPo, linkRfq, notifyFailed, notifyMoved, releaseRfq, syncIncoming, withdrawIncoming, worldOf, type Committed } from "@/lib/procurement/incoming-server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// «الطلب الوارد» (Procurement 2.0, WP-S2-03/08): the stored request `procIncoming/{orgId}__{mrKey}` is written here and only here.
// `sync` (and `ingest`, the same pass, named by the approve path that calls it) brings in what reached Procurement and reads the RFQs and orders back onto each request; `link-rfq` · `release` ·
// `link-po` move lines between «للشراء» and the RFQ or order that holds them (one line, one place); `fail` closes what is still to
// be bought as «تعذّر الشراء» with the reason the requester reads; `withdraw` is the requester taking his request back. Each is a
// transaction that re-reads the request and leaves the `proc:ST` event of every line whose status changed.

const mrKey = z.string().min(3).max(300)
const lines = z.array(z.number().int().min(0).max(999)).max(100).optional()
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("ingest"), mrKey: mrKey.optional() }),
  z.object({ action: z.literal("link-rfq"), mrKey, rfqId: z.string().min(1).max(128), rfqNumber: z.string().max(60).nullable().optional(), lines }),
  z.object({ action: z.literal("release"), mrKey, rfqId: z.string().min(1).max(128).nullable().optional(), lines }),
  z.object({ action: z.literal("link-po"), mrKey, poId: z.string().min(1).max(128), poNumber: z.string().min(1).max(60), lines }),
  z.object({ action: z.literal("fail"), mrKey, reason: z.enum(FAIL_REASONS), note: z.string().trim().max(500).nullable().optional(), alt: z.string().trim().max(500).nullable().optional() }),
  z.object({ action: z.literal("withdraw"), mrKey }),
])

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
  if (!parsed.success) return fail("Check the request", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("Sign in first", "UNAUTHENTICATED", 401)
    const by = { uid, name: caller.name }
    const data = parsed.data
    if (data.action === "sync" || data.action === "ingest") {
      const done = await syncIncoming(db, caller.orgId, { by })
      return NextResponse.json({ success: true, data: done })
    }
    if (data.action === "withdraw") {
      const res = await withdrawIncoming(db, caller.orgId, by, { mrKey: data.mrKey })
      return answer(res)
    }
    if (!(caller.can("offers.accept") || caller.can("rfq.manage") || caller.can("rfq.create") || caller.can("po.approve"))) return fail("This is Procurement's", "FORBIDDEN", 403)
    const world = await worldOf(db, caller.orgId)
    let res: Awaited<ReturnType<typeof linkRfq>>
    if (data.action === "link-rfq") res = await linkRfq(db, caller.orgId, by, { mrKey: data.mrKey, rfqId: data.rfqId, rfqNumber: data.rfqNumber ?? null, lines: data.lines }, { world })
    else if (data.action === "release") res = await releaseRfq(db, caller.orgId, by, { mrKey: data.mrKey, rfqId: data.rfqId ?? null, lines: data.lines }, { world })
    else if (data.action === "link-po") res = await linkPo(db, caller.orgId, by, { mrKey: data.mrKey, poId: data.poId, poNumber: data.poNumber, lines: data.lines }, { world })
    else {
      res = await failIncoming(db, caller.orgId, by, { mrKey: data.mrKey, code: data.reason, note: data.note, alt: data.alt }, { world })
      if (typeof res !== "string" && res.moved) await notifyFailed(db, res.next, by).catch((e) => console.error("could-not-buy notice:", e))
    }
    if (typeof res !== "string" && res.moved) await notifyMoved(db, res).catch((e) => console.error("incoming notice:", e))
    return answer(res)
  } catch (error) {
    console.error("incoming:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

function answer(res: Committed | string) {
  if (res === "not_found") return fail("Request not found", "NOT_FOUND", 404)
  if (typeof res === "string") return fail("It cannot be done now", res.toUpperCase(), res === "not_yours" ? 403 : 409)
  return NextResponse.json({ success: true, data: { st: res.next.st, moved: res.moved } })
}
