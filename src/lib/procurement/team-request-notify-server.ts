import type { Firestore } from "firebase-admin/firestore"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"
import { TEAM_REQUESTS, teamProgress, teamRequestState, type TeamLinkedRfq, type TeamRequestDoc, type TeamRequestState } from "@/lib/procurement/team-requests"

// The requester hears when his «طلب مواد» moves (PUR-10): in an RFQ · in an order · on the way ·
// received. The state is never stored — it is read from the RFQs and orders that name the
// request — so nobody "writes" the change. This reads it and tells him once per move, then
// records what it told him (`notifiedState`, server-only) so the next look is quiet and his
// «مهامي» can show where it stands. It runs when somebody looks: a Procurement page, the daily
// job, the requester's own list.

export type TeamNoticeState = Extract<TeamRequestState, "rfq" | "order" | "on_way" | "received">

const RANK: Record<string, number> = { sent: 0, rfq: 1, order: 2, on_way: 3, received: 4 }

/** The sender-rendered text of each notice — the same words as `Portal.Shared.pn_team_request_*`. */
export const TEAM_NOTICE_COPY_AR: Record<TeamNoticeState, { title: string; message: string }> = {
  rfq: { title: "طلب المواد {number} في طلب عروض", message: "نُشر طلبك في طلب العروض {ref}." },
  order: { title: "طلب المواد {number} في أمر شراء", message: "صار طلبك في أمر الشراء {ref}." },
  on_way: { title: "طلب المواد {number} في الطريق", message: "بدأ توريد طلبك — أمر الشراء {ref}." },
  received: { title: "استُلم طلب المواد {number}", message: "استُلمت مواد طلبك — أمر الشراء {ref}." },
}

const fill = (text: string, params: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? "")

export async function orgWorld(db: Firestore, orgId: string) {
  const [rfqs, orders] = await Promise.all([db.collection("rfqs").where("organizationId", "==", orgId).get(), db.collection(PURCHASE_ORDERS).where("organizationId", "==", orgId).get()])
  return {
    rfqs: rfqs.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamLinkedRfq),
    orders: orders.docs.map((d) => ({ id: d.id, ...d.data() }) as PurchaseOrder),
  }
}

type World = Awaited<ReturnType<typeof orgWorld>>

/** Tells the requester of each request whose state moved forward since he was last told. */
export async function notifyTeamRequestMoves(db: Firestore, docs: TeamRequestDoc[], world: World, nowIso = new Date().toISOString()): Promise<number> {
  let told = 0
  for (const doc of docs) {
    if (doc.status !== "open") continue
    const progress = teamProgress(doc.id, world.rfqs, world.orders)
    const state = teamRequestState(doc, progress)
    const previous = (doc as TeamRequestDoc & { notifiedState?: string }).notifiedState ?? "sent"
    if (state === previous) continue
    await db.collection(TEAM_REQUESTS).doc(doc.id).update({ notifiedState: state, stateAt: nowIso })
    if ((RANK[state] ?? 0) <= (RANK[previous] ?? 0) || !(state in TEAM_NOTICE_COPY_AR)) continue
    const copy = TEAM_NOTICE_COPY_AR[state as TeamNoticeState]
    const ref = (state === "rfq" ? progress.rfq?.number : progress.po?.docNumber) || ""
    const params = { number: doc.number, ref }
    await db
      .collection("users")
      .doc(doc.requestedById)
      .collection("notifications")
      .add({
        userId: doc.requestedById,
        organizationId: doc.organizationId,
        type: "team_request_moved",
        i18n: { title: `pn_team_request_${state}_title`, message: `pn_team_request_${state}`, params },
        title: fill(copy.title, params),
        message: fill(copy.message, params),
        link: "/contractor/rfqs/my-requests",
        createdAt: nowIso,
        read: false,
      })
      .then(() => void (told += 1))
      .catch((err: { code?: string }) => console.warn("team request move notice failed:", err?.code || err))
  }
  return told
}

/** Every open request of one company (or of all): reads the state, tells what moved. */
export async function syncTeamRequests(db: Firestore, onlyOrgId?: string, nowIso?: string): Promise<{ checked: number; told: number }> {
  const base = db.collection(TEAM_REQUESTS).where("status", "==", "open")
  const snap = await (onlyOrgId ? base.where("organizationId", "==", onlyOrgId) : base).get()
  const byOrg = new Map<string, TeamRequestDoc[]>()
  for (const d of snap.docs) {
    const doc = { id: d.id, ...d.data() } as TeamRequestDoc
    byOrg.set(doc.organizationId, [...(byOrg.get(doc.organizationId) || []), doc])
  }
  let told = 0
  for (const [orgId, docs] of byOrg) {
    try {
      told += await notifyTeamRequestMoves(db, docs, await orgWorld(db, orgId), nowIso)
    } catch (error) {
      console.error("Team request sync failed for org", orgId, error)
    }
  }
  return { checked: snap.size, told }
}
