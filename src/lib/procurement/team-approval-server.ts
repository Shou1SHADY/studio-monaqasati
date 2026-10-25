// The team-approval acts on the server (REQ-05; the pure rules are `team-approval.ts`). Every act re-reads the request inside its
// transaction and re-runs the rule; the waiting requests live in `procTeamApprovals`, which no client rule reads or writes. Approved
// (or released when the policy is turned off), a request becomes the incoming request `team:{id}` in the SAME transaction — its
// number, its lines and its history carried over — and the buyers are told. Notices go through `notifyNamed` (procurement events
// `team_request_*`, i18n keys + the Arabic table — never an amount).

import type { Firestore, Transaction } from "firebase-admin/firestore"
import { riyadhYear } from "./numbering"
import { storedSites } from "./delivery-sites"
import { projectsOn } from "./financeless-server"
import { drawMatNumber, landTeamRequest, policiesOf, type Actor } from "./incoming-server"
import type { IncomingDoc, IncomingPerson } from "./incoming-state"
import { PROCUREMENT_SETTINGS } from "./types"
import {
  PROC_TEAM_APPROVALS,
  approveTeamRequest,
  approversFor,
  decisionRefusal,
  escalateTeamRequest,
  needsEscalation,
  newTeamApproval,
  releaseTeamRequest,
  resubmitRefusal,
  resubmitTeamRequest,
  returnTeamRequest,
  returnWhy,
  teamApprovalDocId,
  teamApprovalView,
  waitingDays,
  withdrawRefusal,
  withdrawTeamRequest,
  type DecisionActor,
  type ReturnReason,
  type TeamApprovalDoc,
  type TeamApprovalInput,
  type TeamApprovalRefusal,
  type TeamApprover,
  type TeamApprovalView,
} from "./team-approval"
import { notifyNamed } from "../supplier-free/server-notify"
import { notifyArrived } from "./upcoming-watch-server"

type Db = Firestore

const ref = (db: Db, orgId: string, id: string) => db.collection(PROC_TEAM_APPROVALS).doc(teamApprovalDocId(orgId, id))
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const MY_REQUESTS = "/contractor/rfqs/my-requests"
const approvalLink = (id: string) => `${MY_REQUESTS}?approval=${encodeURIComponent(id)}`

/** The policy is on and the company has no Projects (with Projects the project manager approves). */
export async function teamApprovalOn(db: Db, orgId: string): Promise<boolean> {
  const [policies, pm] = await Promise.all([policiesOf(db, orgId), projectsOn(db, orgId)])
  return policies.teamApproval && !pm
}

/** The owner, and the site's manager when the site names one who belongs to the company. */
export async function approversOf(db: Db, orgId: string, siteId: string | null | undefined): Promise<TeamApprover[]> {
  const [owner, settings] = await Promise.all([db.collection("users").doc(orgId).get(), siteId ? db.collection(PROCUREMENT_SETTINGS).doc(orgId).get() : Promise.resolve(null)])
  const ownerName = String(owner.data()?.name || owner.data()?.email || "")
  const site = siteId && settings ? storedSites(settings.data()?.deliverySites).find((s) => s.id === siteId) : null
  let manager: { uid: string; name: string } | null = null
  if (site?.managerId) {
    const m = (await db.collection("users").doc(site.managerId).get()).data()
    if (m && ((m.organizationId as string) || site.managerId) === orgId) manager = { uid: site.managerId, name: String(m.name || m.email || "") }
  }
  return approversFor({ uid: orgId, name: ownerName }, manager)
}

const tellApprovers = (db: Db, by: Actor, doc: TeamApprovalDoc) =>
  notifyNamed(db, by, { kind: "team_request_awaiting", organizationId: doc.organizationId, params: { number: doc.no, name: doc.requestedFor.name || doc.requestedBy.name, place: doc.place.label }, link: approvalLink(doc.id) }, doc.approvers.map((a) => a.uid), { owner: false })

/** «طلب مواد» with the policy on: the number is drawn now, the request waits for approval. */
export async function createPendingTeamRequest(db: Db, orgId: string, by: Actor, input: TeamApprovalInput & { requestedFor: IncomingPerson }, now = new Date()): Promise<TeamApprovalDoc> {
  const id = db.collection(PROC_TEAM_APPROVALS).doc().id
  const approvers = await approversOf(db, orgId, input.siteId)
  const doc = await db.runTransaction(async (tx) => {
    const n = await drawMatNumber(db, tx, orgId, riyadhYear(now))
    const made = newTeamApproval({ ...input, organizationId: orgId, id, no: n.number, seq: n.seq, requestedBy: { id: by.uid, name: by.name }, approvers, at: now.toISOString() })
    tx.create(ref(db, orgId, id), clean(made) as unknown as Record<string, unknown>)
    return made
  })
  await tellApprovers(db, by, doc).catch((e) => console.warn("team approval notice:", e))
  return doc
}

/** The incoming request a decided (or released) one becomes, written in the transaction that decides it. */
function landFrom(next: TeamApprovalDoc, approvedBy: { name: string; on: string } | null) {
  return {
    input: { lines: next.lines, needBy: next.needBy, siteId: next.siteId ?? null, place: next.place, note: next.note ?? null, requestedFor: next.requestedFor },
    preset: { id: next.id, no: next.no, seq: next.seq, requestedBy: next.requestedBy, createdAt: next.createdAt, approvedBy, log: next.log },
  }
}

async function tellLanded(db: Db, by: Actor, doc: TeamApprovalDoc, approved: boolean, at: string) {
  await Promise.all([
    notifyNamed(db, by, { kind: "team_request_released", organizationId: doc.organizationId, params: { number: doc.no, name: doc.requestedFor.name || doc.requestedBy.name }, link: "/contractor/rfqs/requests" }, [], { permissions: ["offers.accept", "rfq.manage"] }),
    approved ? notifyNamed(db, by, { kind: "team_request_approved", organizationId: doc.organizationId, params: { number: doc.no, actor: by.name }, link: MY_REQUESTS }, doc.requesterIds, { owner: false }) : Promise.resolve(0),
    notifyArrived(db, doc.organizationId, [{ key: doc.mrKey, ref: doc.no }], at),
  ]).catch((e) => console.warn("team approval landed notice:", e))
}

export type DecideInput = { id: string; kind: "approve" } | { id: string; kind: "return"; code: ReturnReason; note?: string | null }

/** Approve (→ Incoming «جديدة») or return with a reason (→ the requester edits and sends again). */
export async function decideTeamRequest(db: Db, orgId: string, actor: DecisionActor, input: DecideInput, now = new Date()): Promise<{ doc: TeamApprovalDoc; incoming: IncomingDoc | null } | TeamApprovalRefusal> {
  const at = now.toISOString()
  const r = ref(db, orgId, input.id)
  if (input.kind === "return") {
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(r)
      const doc = snap.exists ? (snap.data() as TeamApprovalDoc) : null
      const refusal = decisionRefusal(doc, actor, { kind: "return", code: input.code, note: input.note })
      if (refusal) return refusal
      const next = returnTeamRequest(doc as TeamApprovalDoc, actor, input.code, returnWhy(input.code, input.note) as string, at)
      tx.set(r, clean(next) as unknown as Record<string, unknown>)
      return next
    })
    if (typeof out === "string") return out
    await notifyNamed(db, actor, { kind: "team_request_returned", organizationId: orgId, params: { number: out.no, actor: actor.name, reason: out.returned?.why || "" }, link: MY_REQUESTS }, out.requesterIds, { owner: false }).catch(() => 0)
    return { doc: out, incoming: null }
  }
  let decided: TeamApprovalDoc | null = null
  const landed = await landTeamRequest(
    db,
    orgId,
    actor,
    async (tx: Transaction) => {
      const snap = await tx.get(r)
      const doc = snap.exists ? (snap.data() as TeamApprovalDoc) : null
      const refusal = decisionRefusal(doc, actor, { kind: "approve" })
      if (refusal) return refusal
      const next = approveTeamRequest(doc as TeamApprovalDoc, actor, at)
      tx.set(r, clean(next) as unknown as Record<string, unknown>)
      decided = next
      return landFrom(next, { name: actor.name, on: at.slice(0, 10) })
    },
    now
  )
  if (typeof landed === "string") return landed as TeamApprovalRefusal
  const doc = decided as unknown as TeamApprovalDoc
  await tellLanded(db, actor, doc, true, at)
  return { doc, incoming: landed }
}

export async function withdrawPendingTeamRequest(db: Db, orgId: string, by: Actor, id: string, now = new Date()): Promise<TeamApprovalDoc | TeamApprovalRefusal> {
  const r = ref(db, orgId, id)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(r)
    const doc = snap.exists ? (snap.data() as TeamApprovalDoc) : null
    const refusal = withdrawRefusal(doc, by.uid)
    if (refusal) return refusal
    const next = withdrawTeamRequest(doc as TeamApprovalDoc, by, now.toISOString())
    tx.set(r, clean(next) as unknown as Record<string, unknown>)
    return next
  })
}

/** A returned request, edited and sent again: it waits again (with the approvers of its — perhaps new — site). */
export async function resubmitPendingTeamRequest(db: Db, orgId: string, by: Actor, id: string, input: TeamApprovalInput, now = new Date()): Promise<TeamApprovalDoc | TeamApprovalRefusal> {
  const approvers = await approversOf(db, orgId, input.siteId)
  const r = ref(db, orgId, id)
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(r)
    const doc = snap.exists ? (snap.data() as TeamApprovalDoc) : null
    const refusal = resubmitRefusal(doc, by.uid)
    if (refusal) return refusal
    const next = resubmitTeamRequest(doc as TeamApprovalDoc, input, by, now.toISOString(), approvers)
    tx.set(r, clean(next) as unknown as Record<string, unknown>)
    return next
  })
  if (typeof out !== "string") await tellApprovers(db, by, out).catch(() => 0)
  return out
}

/** The policy turned off (or Projects on): whatever waits lands in Incoming, logged «أُطلق حين أُوقفت سياسة الاعتماد». A returned
 * request stays with its requester — he sends it again, and with the policy off it then goes straight in. */
export async function releaseWaiting(db: Db, orgId: string, now = new Date()): Promise<number> {
  const snap = await db.collection(PROC_TEAM_APPROVALS).where("organizationId", "==", orgId).get()
  const at = now.toISOString()
  const system: Actor = { uid: "system", name: "النظام" }
  let released = 0
  for (const d of snap.docs) {
    if ((d.data() as TeamApprovalDoc).st !== "wait") continue
    let next: TeamApprovalDoc | null = null
    const landed = await landTeamRequest(
      db,
      orgId,
      system,
      async (tx) => {
        const fresh = await tx.get(d.ref)
        const doc = fresh.data() as TeamApprovalDoc | undefined
        if (!doc || doc.st !== "wait") return "not_waiting"
        next = releaseTeamRequest(doc, at)
        tx.set(d.ref, clean(next) as unknown as Record<string, unknown>)
        return landFrom(next, null)
      },
      now
    ).catch((e) => (console.warn("team approval release:", e), "failed"))
    if (typeof landed === "string" || !next) continue
    released++
    await tellLanded(db, system, next, false, at)
  }
  return released
}

/** The daily job: release where the policy is off; tell the owner ONCE of a request waiting past the window. */
export async function sweepTeamApprovals(db: Db, now = new Date()): Promise<{ released: number; escalated: number }> {
  const snap = await db.collection(PROC_TEAM_APPROVALS).where("st", "==", "wait").get()
  const orgs = Array.from(new Set(snap.docs.map((d) => String(d.data().organizationId || "")).filter(Boolean)))
  let released = 0
  let escalated = 0
  for (const orgId of orgs) {
    if (!(await teamApprovalOn(db, orgId))) {
      released += await releaseWaiting(db, orgId, now)
      continue
    }
    const windowDays = (await policiesOf(db, orgId)).escalateAfterDays
    for (const d of snap.docs.filter((x) => x.data().organizationId === orgId)) {
      const told = await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(d.ref)).data() as TeamApprovalDoc | undefined
        if (!fresh || !needsEscalation(fresh, now, windowDays)) return null
        const next = escalateTeamRequest(fresh, now.toISOString())
        tx.set(d.ref, clean(next) as unknown as Record<string, unknown>)
        return next
      })
      if (!told) continue
      escalated++
      await notifyNamed(db, { uid: "system", name: "النظام" }, { kind: "team_request_escalated", organizationId: orgId, params: { number: told.no, name: told.requestedFor.name || told.requestedBy.name, days: String(waitingDays(told, now)) }, link: approvalLink(told.id) }, [], { owner: true }).catch(() => 0)
    }
  }
  return { released, escalated }
}

/** What the caller may read of the requests still before Procurement: procurement's people see every one waiting (for «قادمة»);
 * an approver sees those he approves; a requester sees his own, returned ones included (for «طلباتي»). */
export async function teamApprovalViews(db: Db, orgId: string, viewer: DecisionActor & { procurement: boolean }, now = new Date()): Promise<TeamApprovalView[]> {
  const [snap, policies] = await Promise.all([db.collection(PROC_TEAM_APPROVALS).where("organizationId", "==", orgId).get(), policiesOf(db, orgId)])
  const out: TeamApprovalView[] = []
  for (const d of snap.docs) {
    const doc = d.data() as TeamApprovalDoc
    if (doc.st !== "wait" && doc.st !== "ret") continue
    const mine = doc.requesterIds.includes(viewer.uid)
    const approver = viewer.isOwner || doc.approvers.some((a) => a.uid === viewer.uid)
    if (!(mine || approver || (viewer.procurement && doc.st === "wait"))) continue
    out.push(teamApprovalView(doc, viewer, now, policies.escalateAfterDays))
  }
  return out.sort((a, b) => a.sentAt.localeCompare(b.sentAt))
}
