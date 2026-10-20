import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { projectsOn } from "@/lib/procurement/financeless-server"
import { riyadhYear } from "@/lib/procurement/numbering"
import { todayOf } from "@/lib/procurement/po"
import { can as resolveCan, type TeamGroup } from "@/lib/permissions"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"
import {
  TEAM_REQUESTS,
  rfqNamesRequest,
  teamProgress,
  teamRequestRefusal,
  teamRequestState,
  teamSource,
  withdrawRefusal,
  type TeamLinkedRfq,
  type TeamRequestDoc,
} from "@/lib/procurement/team-requests"
import { formatYearlyDocNumber } from "@/lib/sales-numbering"

// «طلب مواد» from the team (Procurement 1.5, PUR-10, question 4) — a company WITHOUT Project
// Management. The document is written here only: any member raises it, its requester withdraws
// it before it is in an RFQ, Procurement declines it with a reason. Its progress is read from
// the RFQs and orders that name it (`teamProgress`) — GET returns the caller's own, with it.

const MAT_TYPE = "MAT"
const line = z.object({
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(40),
  quantity: z.number().positive().max(1e9),
  needBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  material: z.record(z.unknown()).nullable().optional(),
})
const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    lines: z.array(line).min(1).max(100),
    needBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    siteId: z.string().max(120).nullable().optional(),
    place: z.object({ label: z.string().trim().max(200), city: z.string().trim().max(80), district: z.string().trim().max(120) }),
    note: z.string().trim().max(1000).nullable().optional(),
  }),
  z.object({ action: z.literal("withdraw"), id: z.string().min(1).max(128) }),
  z.object({ action: z.literal("decline"), id: z.string().min(1).max(128), reason: z.string().trim().min(3).max(500) }),
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
        .catch((err) => console.warn("team request notice failed:", err?.code || err))
    )
  )
}

async function orgWorld(db: FirebaseFirestore.Firestore, orgId: string) {
  const [rfqs, orders] = await Promise.all([db.collection("rfqs").where("organizationId", "==", orgId).get(), db.collection(PURCHASE_ORDERS).where("organizationId", "==", orgId).get()])
  return {
    rfqs: rfqs.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamLinkedRfq),
    orders: orders.docs.map((d) => ({ id: d.id, ...d.data() }) as PurchaseOrder),
  }
}

export async function GET(req: NextRequest) {
  const uid = await uidOf(req)
  if (!uid) return fail("Sign in first", "UNAUTHENTICATED", 401)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("Sign in first", "UNAUTHENTICATED", 401)
    const mine = await db.collection(TEAM_REQUESTS).where("organizationId", "==", caller.orgId).where("requestedById", "==", uid).get()
    const docs = mine.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamRequestDoc)
    if (!docs.length) return NextResponse.json({ success: true, data: { requests: [] } })
    const world = await orgWorld(db, caller.orgId)
    const requests = docs
      .map((r) => {
        const progress = teamProgress(r.id, world.rfqs, world.orders)
        // The requester reads what became of his request — never the order's prices.
        return { ...r, state: teamRequestState(r, progress), rfqNumber: progress.rfq?.number ?? null, poNumber: progress.po?.docNumber ?? null, promisedDate: progress.po?.promisedDate ?? null, preparedByName: progress.po?.preparedByName ?? null }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return NextResponse.json({ success: true, data: { requests } })
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
    const at = now.toISOString()

    if (data.action === "create") {
      if (await projectsOn(db, caller.orgId)) return fail("Materials are requested from the project", "PROJECTS_ON", 409)
      const input = { lines: data.lines.map((l) => ({ name: l.name, unit: l.unit, quantity: l.quantity, needBy: l.needBy ?? null, material: (l.material as TeamRequestDoc["lines"][number]["material"]) ?? null })), needBy: data.needBy, place: data.place }
      const refusal = teamRequestRefusal(input, todayOf(now))
      if (refusal) return fail("Check the request", `BAD_${refusal.toUpperCase()}`, 400)
      const year = riyadhYear(now)
      const counter = db.collection("mfgCounters").doc(`${caller.orgId}__${MAT_TYPE}__${year}`)
      const ref = db.collection(TEAM_REQUESTS).doc()
      const number = await db.runTransaction(async (tx) => {
        const snap = await tx.get(counter)
        const seq = (snap.exists ? Number(snap.data()?.last) || 0 : 0) + 1
        tx.set(counter, { organizationId: caller.orgId, type: MAT_TYPE, year, last: seq, updatedAt: FieldValue.serverTimestamp() })
        const n = formatYearlyDocNumber(MAT_TYPE, year, seq)
        const doc: Omit<TeamRequestDoc, "id"> = {
          organizationId: caller.orgId,
          number: n,
          lines: input.lines,
          needBy: data.needBy,
          siteId: data.siteId ?? null,
          place: data.place,
          note: data.note || null,
          requestedById: uid,
          requestedByName: caller.name,
          createdAt: at,
          status: "open",
        }
        tx.create(ref, doc)
        return n
      })
      await tellProcurement(db, caller.orgId, uid, { number, byName: caller.name }).catch((e) => console.error("team request notice:", e))
      return NextResponse.json({ success: true, data: { id: ref.id, number } })
    }

    const ref = db.collection(TEAM_REQUESTS).doc(data.id)
    const snap = await ref.get()
    const doc = snap.exists ? ({ id: snap.id, ...snap.data() } as TeamRequestDoc) : null
    if (!doc || doc.organizationId !== caller.orgId) return fail("Request not found", "NOT_FOUND", 404)

    if (data.action === "withdraw") {
      // Any RFQ naming it — a draft too: Procurement has prepared it, so it is no longer only his.
      const rfqs = (await db.collection("rfqs").where("organizationId", "==", caller.orgId).where("needSources", "array-contains", teamSource(doc.id)).get()).docs.map((d) => ({ id: d.id, ...d.data() }) as TeamLinkedRfq)
      const refusal = withdrawRefusal(doc, uid, rfqs.some((r) => rfqNamesRequest(r, doc.id)))
      if (refusal) return fail("It cannot be withdrawn now", refusal.toUpperCase(), 409)
      await ref.update({ status: "withdrawn", withdrawnAt: at })
      return NextResponse.json({ success: true, data: {} })
    }

    // Declined by Procurement — «تعذّر الشراء» with the reason the requester reads.
    if (!(caller.can("offers.accept") || caller.can("rfq.manage") || caller.can("po.approve"))) return fail("Declining is Procurement's", "FORBIDDEN", 403)
    if (doc.status !== "open") return fail("It is closed", "CLOSED", 409)
    const world = await orgWorld(db, caller.orgId)
    if (teamProgress(doc.id, world.rfqs, world.orders).po) return fail("It is already in an order", "IN_ORDER", 409)
    await ref.update({ status: "declined", declinedAt: at, declinedByName: caller.name, declinedReason: data.reason })
    await db
      .collection("users")
      .doc(doc.requestedById)
      .collection("notifications")
      .add({
        userId: doc.requestedById,
        organizationId: caller.orgId,
        type: "team_request_declined",
        i18n: { title: "pn_team_request_declined_title", message: "pn_team_request_declined", params: { number: doc.number, reason: data.reason, name: caller.name } },
        title: "تعذّر شراء طلب المواد",
        message: `${doc.number} — ${caller.name}: ${data.reason}`,
        link: "/contractor/rfqs/requests?seg=mine",
        createdAt: at,
        read: false,
      })
      .catch((e) => console.error("decline notice:", e))
    return NextResponse.json({ success: true, data: {} })
  } catch (error) {
    console.error("team request:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
