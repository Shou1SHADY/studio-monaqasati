import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { projectsOn } from "@/lib/procurement/financeless-server"
import { riyadhDay } from "@/lib/hr/format"
import { can as resolveCan, type TeamGroup } from "@/lib/permissions"
import { teamRequestRefusal, type TeamRequestDoc } from "@/lib/procurement/team-requests"
import { createTeamRequest, myRequests, notifyMoved, resolveRequestedFor, smsText, withdrawIncoming, type Committed } from "@/lib/procurement/incoming-server"
import { sendSms } from "@/lib/sms"
import { PROC_INCOMING, incomingDocId } from "@/lib/procurement/incoming-state"
import { RETURN_REASONS, PROC_TEAM_APPROVALS, teamApprovalDocId } from "@/lib/procurement/team-approval"
import { createPendingTeamRequest, decideTeamRequest, releaseWaiting, resubmitPendingTeamRequest, teamApprovalOn, teamApprovalViews, withdrawPendingTeamRequest } from "@/lib/procurement/team-approval-server"

// «طلب مواد» from the team — a company WITHOUT Project Management (Procurement 2.0, REQ-01..04). The request is the stored
// `procIncoming` document (`src: "team"`), written here only: any member raises it for himself; whoever sources (a buyer) raises it
// ON BEHALF of a member or of a receiver who has no account, who then reads its progress on his phone; its requester withdraws it
// before it is in an RFQ. «تعذّر الشراء» is Procurement's act on the incoming request (/api/procurement/incoming, action `fail`).
// GET returns the caller's own requests with where each stands — the quantities and the dates, never a price or a supplier.
//
// With the optional policy «اعتماد طلبات الفريق قبل المشتريات» on (REQ-05, `team-approval.ts`) a new request WAITS before Incoming:
// the owner, or the site's manager, approves it (`approve`) or returns it with a reason (`return`); its requester withdraws it or,
// returned, edits and sends it again (`resubmit`). The owner turning the policy off releases what waits (`release`). GET also
// returns `approvals` — the waiting requests the caller may read: his own, those he approves, and every one for Procurement.

const line = z.object({
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(40),
  quantity: z.number().positive().max(1e9),
  needBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  material: z.record(z.unknown()).nullable().optional(),
  warrantyMonths: z.number().int().positive().max(120).nullable().optional(),
})
const forWhom = z.discriminatedUnion("kind", [z.object({ kind: z.literal("self") }), z.object({ kind: z.literal("member"), id: z.string().min(1).max(128) }), z.object({ kind: z.literal("receiver"), id: z.string().min(1).max(128) })])
const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    lines: z.array(line).min(1).max(100),
    needBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    siteId: z.string().max(120).nullable().optional(),
    place: z.object({ label: z.string().trim().max(200), city: z.string().trim().max(80), district: z.string().trim().max(120) }),
    note: z.string().trim().max(1000).nullable().optional(),
    requestedFor: forWhom.optional(),
  }),
  z.object({ action: z.literal("withdraw"), id: z.string().min(1).max(300) }),
  z.object({ action: z.literal("approve"), id: z.string().min(1).max(128) }),
  z.object({ action: z.literal("return"), id: z.string().min(1).max(128), code: z.enum(RETURN_REASONS), note: z.string().trim().max(500).nullable().optional() }),
  z.object({
    action: z.literal("resubmit"),
    id: z.string().min(1).max(128),
    lines: z.array(line).min(1).max(100),
    needBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    siteId: z.string().max(120).nullable().optional(),
    place: z.object({ label: z.string().trim().max(200), city: z.string().trim().max(80), district: z.string().trim().max(120) }),
    note: z.string().trim().max(1000).nullable().optional(),
  }),
  z.object({ action: z.literal("release") }),
])
const REFUSAL_STATUS: Record<string, number> = { not_found: 404, not_yours: 403, not_approver: 403, own_request: 403, reason_required: 400, not_waiting: 409, not_returned: 409 }
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

/** Procurement's people — the owner and whoever prepares orders or runs RFQs — told of a new request. */
async function tellProcurement(db: FirebaseFirestore.Firestore, orgId: string, fromUid: string, n: { number: string; byName: string }) {
  const [members, groupsSnap] = await Promise.all([db.collection("users").where("organizationId", "==", orgId).get(), db.collection("teamGroups").where("organizationId", "==", orgId).get()])
  const groups = groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamGroup)
  const to = new Set<string>([orgId])
  for (const m of members.docs) {
    const p = m.data()
    const ctx = { organizationRole: !("organizationRole" in p) ? "owner" : ((p.organizationRole as string | null) || null), defaultGroupId: (p.defaultGroupId as string | null) || null, groups }
    if (resolveCan("offers.accept", ctx) || resolveCan("rfq.manage", ctx)) to.add(m.id)
  }
  to.delete(fromUid)
  const at = new Date().toISOString()
  await Promise.all(
    Array.from(to).map((uid) =>
      db
        .collection("users")
        .doc(uid)
        .collection("notifications")
        .add({
          userId: uid,
          organizationId: orgId,
          type: "team_request",
          i18n: { title: "pn_team_request_title", message: "pn_team_request", params: { number: n.number, name: n.byName } },
          title: "طلب مواد جديد",
          message: `أرسل ${n.byName} طلب المواد ${n.number} إلى المشتريات.`,
          link: "/contractor/rfqs/requests",
          createdAt: at,
          read: false,
        })
        .catch((err: { code?: string }) => console.warn("team request notice failed:", err?.code || err))
    )
  )
}

export async function GET(req: NextRequest) {
  const uid = await uidOf(req)
  if (!uid) return fail("Sign in first", "UNAUTHENTICATED", 401)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("Sign in first", "UNAUTHENTICATED", 401)
    const procurement = caller.can("offers.accept") || caller.can("rfq.manage") || caller.can("rfq.create") || caller.can("po.approve")
    const [requests, approvals] = await Promise.all([myRequests(db, caller.orgId, uid), teamApprovalViews(db, caller.orgId, { uid, name: caller.name, isOwner: uid === caller.orgId, procurement })])
    return NextResponse.json({ success: true, data: { requests, approvals } })
  } catch (error) {
    console.error("team requests (mine):", error)
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
    const data = parsed.data
    const now = new Date()
    const by = { uid, name: caller.name }

    if (data.action === "create") {
      if (await projectsOn(db, caller.orgId)) return fail("Materials are requested from the project", "PROJECTS_ON", 409)
      const input = { lines: data.lines.map((l) => ({ name: l.name, unit: l.unit, quantity: l.quantity, needBy: l.needBy ?? null, material: (l.material as TeamRequestDoc["lines"][number]["material"]) ?? null })), needBy: data.needBy, place: data.place }
      const refusal = teamRequestRefusal(input, riyadhDay(now))
      if (refusal) return fail("Check the request", `BAD_${refusal.toUpperCase()}`, 400)
      const onBehalf = data.requestedFor && data.requestedFor.kind !== "self" && data.requestedFor.id !== uid
      if (onBehalf && !(caller.can("offers.accept") || caller.can("rfq.manage") || caller.can("po.approve"))) return fail("Asking on behalf of someone is Procurement's", "FORBIDDEN", 403)
      const requestedFor = await resolveRequestedFor(db, caller.orgId, by, onBehalf ? data.requestedFor : { kind: "self" })
      if (!requestedFor) return fail("That person is not in this company", "BAD_REQUESTED_FOR", 400)
      if (requestedFor.kind === "receiver" && !requestedFor.phone) return fail("A receiver without an account needs a mobile number", "NO_PHONE", 400)
      if (await teamApprovalOn(db, caller.orgId)) {
        // REQ-05: it waits for the owner or the site's manager — numbered now, in Incoming only once approved.
        const pending = await createPendingTeamRequest(db, caller.orgId, by, { lines: data.lines.map((l) => ({ name: l.name, unit: l.unit, quantity: l.quantity, needBy: l.needBy ?? null, material: (l.material as TeamRequestDoc["lines"][number]["material"]) ?? null, warrantyMonths: l.warrantyMonths ?? null })), needBy: data.needBy, siteId: data.siteId ?? null, place: data.place, note: data.note || null, requestedFor }, now)
        return NextResponse.json({ success: true, data: { id: pending.mrKey, number: pending.no, pending: true } })
      }
      const doc = await createTeamRequest(db, caller.orgId, by, {
        lines: data.lines.map((l) => ({ name: l.name, unit: l.unit, quantity: l.quantity, needBy: l.needBy ?? null, material: (l.material as TeamRequestDoc["lines"][number]["material"]) ?? null, warrantyMonths: l.warrantyMonths ?? null })),
        needBy: data.needBy,
        siteId: data.siteId ?? null,
        place: data.place,
        note: data.note || null,
        requestedFor,
      }, now)
      await tellProcurement(db, caller.orgId, uid, { number: doc.no, byName: caller.name }).catch((e) => console.error("team request notice:", e))
      if (requestedFor.kind === "receiver" && requestedFor.phone) await sendSms({ to: requestedFor.phone, body: smsText("received", { no: doc.no }) }).catch((e) => console.error("team request sms:", e))
      return NextResponse.json({ success: true, data: { id: doc.mrKey, number: doc.no } })
    }

    const actor = { uid, name: caller.name, isOwner: uid === caller.orgId }
    const refused = (code: string) => fail("It cannot be done now", code.toUpperCase(), REFUSAL_STATUS[code] ?? 409)
    if (data.action === "approve" || data.action === "return") {
      const res = await decideTeamRequest(db, caller.orgId, actor, data.action === "approve" ? { id: data.id, kind: "approve" } : { id: data.id, kind: "return", code: data.code, note: data.note ?? null }, now)
      if (typeof res === "string") return refused(res)
      return NextResponse.json({ success: true, data: { number: res.doc.no, st: res.doc.st } })
    }
    if (data.action === "resubmit") {
      const input = { lines: data.lines.map((l) => ({ name: l.name, unit: l.unit, quantity: l.quantity, needBy: l.needBy ?? null, material: (l.material as TeamRequestDoc["lines"][number]["material"]) ?? null, warrantyMonths: l.warrantyMonths ?? null })), needBy: data.needBy, place: data.place }
      const bad = teamRequestRefusal(input, riyadhDay(now))
      if (bad) return fail("Check the request", `BAD_${bad.toUpperCase()}`, 400)
      // With the policy switched off meanwhile, sending it again releases it straight to Incoming.
      const res = await resubmitPendingTeamRequest(db, caller.orgId, by, data.id, { ...input, siteId: data.siteId ?? null, note: data.note || null }, now)
      if (typeof res === "string") return refused(res)
      if (!(await teamApprovalOn(db, caller.orgId))) await releaseWaiting(db, caller.orgId, now)
      return NextResponse.json({ success: true, data: { id: res.mrKey, number: res.no } })
    }
    if (data.action === "release") {
      if (!actor.isOwner) return fail("The policies are the owner's", "FORBIDDEN", 403)
      if (await teamApprovalOn(db, caller.orgId)) return fail("The approval policy is still on", "POLICY_ON", 409)
      return NextResponse.json({ success: true, data: { released: await releaseWaiting(db, caller.orgId, now) } })
    }

    const mrKey = data.id.includes(":") ? data.id : `team:${data.id}`
    // A request still awaiting approval is withdrawn where it waits.
    const pendingId = mrKey.startsWith("team:") ? mrKey.slice(5) : ""
    if (pendingId && (await db.collection(PROC_TEAM_APPROVALS).doc(teamApprovalDocId(caller.orgId, pendingId)).get()).exists && !(await db.collection(PROC_INCOMING).doc(incomingDocId(caller.orgId, mrKey)).get()).exists) {
      const res = await withdrawPendingTeamRequest(db, caller.orgId, by, pendingId, now)
      if (typeof res === "string") return refused(res)
      return NextResponse.json({ success: true, data: {} })
    }
    const res: Committed | string = await withdrawIncoming(db, caller.orgId, by, { mrKey })
    if (res === "not_found") return fail("Request not found", "NOT_FOUND", 404)
    if (typeof res === "string") return fail("It cannot be withdrawn now", res.toUpperCase(), res === "not_yours" ? 403 : 409)
    await notifyMoved(db, res).catch(() => undefined)
    return NextResponse.json({ success: true, data: {} })
  } catch (error) {
    console.error("team request:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
