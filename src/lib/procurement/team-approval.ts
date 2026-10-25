// «اعتماد طلبات الفريق قبل المشتريات» (Procurement 2.0, REQ-05 — the prototype's optional policy, off by default, a company without
// Projects only: «يعتمدها مدير الموقع أو المالك»). With the policy on, a team «طلب مواد» waits here BEFORE it becomes an incoming
// request: `procTeamApprovals/{orgId}__{id}` — server-only (no rule reads or writes it; /api/procurement/team-requests does). It
// keeps its number «ط.م-…» from the moment it is sent, and its id: approved, it lands in Incoming as `team:{id}` «جديدة», its log
// carried over. Pure: the shape, who may decide, and every refusal — the server re-runs them inside its transaction.
//
// The decisions follow the platform's approval patterns (PO approval, HR requests, PM certificates):
//   · who: the org owner, and the delivery site's manager when the site names one (`DeliverySite.managerId`); else the owner alone;
//   · nobody approves his own request — the owner excepted, and flagged («اعتمده المالك وهو طلبه»), as on a purchase order;
//   · approve, or return with a reason (a code, «سبب آخر» written out); the requester withdraws while it waits, or edits a returned
//     one and sends it again, which waits again;
//   · a request waiting past the window (`escalateAfterDays`, the policy's existing 2-day number) is escalated to the owner ONCE;
//   · turning the policy off — or Projects on — releases whatever waits straight to Incoming, logged as such. Turning it on touches
//     only new requests.

import type { IncomingLogEntry, IncomingPerson } from "./incoming-state"
import type { NewTeamRequest } from "./incoming-ingest"

export const PROC_TEAM_APPROVALS = "procTeamApprovals"
export const teamApprovalDocId = (orgId: string, id: string) => `${orgId}__${id}`

/** wait · ret (returned for changes) · appr (approved — now in Incoming) · rel (released by the policy turned off) · wd (withdrawn). */
export type TeamApprovalSt = "wait" | "ret" | "appr" | "rel" | "wd"

export const RETURN_REASONS = ["qty", "spec", "stock", "dup", "other"] as const
export type ReturnReason = (typeof RETURN_REASONS)[number]
/** «سبب آخر» is written by the approver and needs this many characters. */
export const RETURN_OTHER_MIN = 4

/** The Arabic sentence each reason is stored as — what the requester reads, whatever language the approver's screen was in. */
export const RETURN_REASON_AR: Record<Exclude<ReturnReason, "other">, string> = {
  qty: "راجع الكميات",
  spec: "المواصفة غير واضحة",
  stock: "متوفر في المخزون أو الموقع",
  dup: "مكرر مع طلب آخر",
}

export interface TeamApprover {
  uid: string
  name: string
  role: "owner" | "site"
}

export type TeamApprovalInput = Pick<NewTeamRequest, "lines" | "needBy" | "siteId" | "place" | "note">

export interface TeamApprovalDoc extends TeamApprovalInput {
  organizationId: string
  id: string
  /** `team:{id}` — the incoming request it becomes. */
  mrKey: string
  no: string
  seq: number | null
  requestedBy: { id: string; name: string }
  requestedFor: IncomingPerson
  /** Who may read it as «طلباتي». */
  requesterIds: string[]
  createdAt: string
  /** The last time it was sent for approval (created, or edited and sent again): the waiting clock. */
  sentAt: string
  st: TeamApprovalSt
  approvers: TeamApprover[]
  returned?: { code: ReturnReason; why: string; byId: string; byName: string; at: string } | null
  decided?: { byId: string; byName: string; at: string; ownerSelf: boolean } | null
  escalatedAt?: string | null
  log: IncomingLogEntry[]
}

export type TeamApprovalRefusal = "not_found" | "not_waiting" | "not_returned" | "not_approver" | "own_request" | "reason_required" | "not_yours"

export interface DecisionActor {
  uid: string
  name: string
  isOwner: boolean
}

/** The owner always; the site's manager too when the site names one who is in the company and is not the owner. */
export function approversFor(owner: { uid: string; name: string }, siteManager: { uid: string; name: string } | null): TeamApprover[] {
  const out: TeamApprover[] = [{ uid: owner.uid, name: owner.name, role: "owner" }]
  if (siteManager && siteManager.uid && siteManager.uid !== owner.uid) out.push({ uid: siteManager.uid, name: siteManager.name, role: "site" })
  return out
}

/** His own: he raised it, or it was raised for him. */
export const isOwnRequest = (doc: Pick<TeamApprovalDoc, "requestedBy" | "requestedFor">, uid: string): boolean => doc.requestedBy.id === uid || (doc.requestedFor.kind === "member" && doc.requestedFor.id === uid)

/** The approvers who may act now — the owner always; any other approver never on his own request. */
export const mayDecide = (doc: Pick<TeamApprovalDoc, "approvers" | "requestedBy" | "requestedFor">, a: Pick<DecisionActor, "uid" | "isOwner">): boolean => a.isOwner || (doc.approvers.some((x) => x.uid === a.uid) && !isOwnRequest(doc, a.uid))

export function decisionRefusal(doc: TeamApprovalDoc | null, a: DecisionActor, act: { kind: "approve" } | { kind: "return"; code?: ReturnReason | null; note?: string | null }): TeamApprovalRefusal | null {
  if (!doc) return "not_found"
  if (doc.st !== "wait") return "not_waiting"
  if (!a.isOwner && !doc.approvers.some((x) => x.uid === a.uid)) return "not_approver"
  if (!a.isOwner && isOwnRequest(doc, a.uid)) return "own_request"
  if (act.kind === "return" && !returnWhy(act.code, act.note)) return "reason_required"
  return null
}

/** The sentence the requester reads: the code's, or the approver's own words for «سبب آخر» (a note beside a code is appended). */
export function returnWhy(code: ReturnReason | null | undefined, note: string | null | undefined): string | null {
  const text = (note || "").trim()
  if (!code) return null
  if (code === "other") return text.length >= RETURN_OTHER_MIN ? text : null
  return text ? `${RETURN_REASON_AR[code]} — ${text}` : RETURN_REASON_AR[code]
}

export function withdrawRefusal(doc: TeamApprovalDoc | null, uid: string): TeamApprovalRefusal | null {
  if (!doc) return "not_found"
  if (!doc.requesterIds.includes(uid)) return "not_yours"
  return doc.st === "wait" || doc.st === "ret" ? null : "not_waiting"
}

export function resubmitRefusal(doc: TeamApprovalDoc | null, uid: string): TeamApprovalRefusal | null {
  if (!doc) return "not_found"
  if (!doc.requesterIds.includes(uid)) return "not_yours"
  return doc.st === "ret" ? null : "not_returned"
}

const entry = (at: string, by: string, act: string, note?: string | null): IncomingLogEntry => ({ at, by, act, ...(note ? { note } : {}) })

export function newTeamApproval(input: TeamApprovalInput & { organizationId: string; id: string; no: string; seq: number | null; requestedBy: { id: string; name: string }; requestedFor: IncomingPerson; approvers: TeamApprover[]; at: string }): TeamApprovalDoc {
  const self = input.requestedFor.kind === "member" && input.requestedFor.id === input.requestedBy.id
  return {
    organizationId: input.organizationId,
    id: input.id,
    mrKey: `team:${input.id}`,
    no: input.no,
    seq: input.seq,
    lines: input.lines,
    needBy: input.needBy,
    siteId: input.siteId ?? null,
    place: input.place,
    note: input.note ?? null,
    requestedBy: input.requestedBy,
    requestedFor: input.requestedFor,
    requesterIds: Array.from(new Set([input.requestedBy.id, ...(input.requestedFor.kind === "member" && input.requestedFor.id ? [input.requestedFor.id] : [])])),
    createdAt: input.at,
    sentAt: input.at,
    st: "wait",
    approvers: input.approvers,
    returned: null,
    decided: null,
    escalatedAt: null,
    log: [entry(input.at, input.requestedBy.name, self ? "created" : "created_for", self ? null : input.requestedFor.name), entry(input.at, input.requestedBy.name, "submitted")],
  }
}

export const approveTeamRequest = (doc: TeamApprovalDoc, a: DecisionActor, at: string): TeamApprovalDoc => {
  const ownerSelf = a.isOwner && isOwnRequest(doc, a.uid)
  return { ...doc, st: "appr", decided: { byId: a.uid, byName: a.name, at, ownerSelf }, log: [...doc.log, entry(at, a.name, ownerSelf ? "approved_own" : "approved")] }
}

export const returnTeamRequest = (doc: TeamApprovalDoc, a: DecisionActor, code: ReturnReason, why: string, at: string): TeamApprovalDoc => ({
  ...doc,
  st: "ret",
  returned: { code, why, byId: a.uid, byName: a.name, at },
  log: [...doc.log, entry(at, a.name, "returned", why)],
})

export const withdrawTeamRequest = (doc: TeamApprovalDoc, by: { name: string }, at: string): TeamApprovalDoc => ({ ...doc, st: "wd", log: [...doc.log, entry(at, by.name, "withdrawn")] })

export const resubmitTeamRequest = (doc: TeamApprovalDoc, input: TeamApprovalInput, by: { name: string }, at: string, approvers: TeamApprover[]): TeamApprovalDoc => ({
  ...doc,
  ...input,
  siteId: input.siteId ?? null,
  note: input.note ?? null,
  st: "wait",
  sentAt: at,
  approvers,
  returned: null,
  escalatedAt: null,
  log: [...doc.log, entry(at, by.name, "resubmitted")],
})

export const releaseTeamRequest = (doc: TeamApprovalDoc, at: string): TeamApprovalDoc => ({ ...doc, st: "rel", log: [...doc.log, entry(at, "النظام", "released_policy_off")] })

export const escalateTeamRequest = (doc: TeamApprovalDoc, at: string): TeamApprovalDoc => ({ ...doc, escalatedAt: at, log: [...doc.log, entry(at, "النظام", "escalated")] })

const DAY = 86_400_000
/** Whole days it has waited since it was (last) sent. */
export const waitingDays = (doc: Pick<TeamApprovalDoc, "sentAt">, now: Date): number => Math.max(0, Math.floor((now.getTime() - Date.parse(doc.sentAt)) / DAY))

/** Waiting past the window and not escalated yet — told to the owner once (the daily job). */
export const needsEscalation = (doc: Pick<TeamApprovalDoc, "st" | "sentAt" | "escalatedAt">, now: Date, windowDays: number): boolean => doc.st === "wait" && !doc.escalatedAt && waitingDays(doc, now) >= windowDays

/** What «قادمة», Today and «طلباتي» are told of a request still before Procurement — quantities and dates, never a price. */
export interface TeamApprovalView {
  id: string
  mrKey: string
  no: string
  st: "wait" | "ret"
  place: TeamApprovalDoc["place"]
  siteId: string | null
  needBy: string
  note: string | null
  lines: Array<{ name: string; unit: string; qty: number; needBy: string | null; material: TeamApprovalDoc["lines"][number]["material"] | null }>
  requestedBy: string
  requestedFor: string
  sentAt: string
  createdAt: string
  waitingDays: number
  approvers: string[]
  returned: { why: string; byName: string; at: string } | null
  /** The viewer may approve or return it now. */
  canDecide: boolean
  /** The viewer is its requester: he may withdraw it, or edit and send a returned one again. */
  mine: boolean
  overdue: boolean
}

export function teamApprovalView(doc: TeamApprovalDoc, viewer: Pick<DecisionActor, "uid" | "isOwner">, now: Date, windowDays: number): TeamApprovalView {
  return {
    id: doc.id,
    mrKey: doc.mrKey,
    no: doc.no,
    st: doc.st === "ret" ? "ret" : "wait",
    place: doc.place,
    siteId: doc.siteId ?? null,
    needBy: doc.needBy,
    note: doc.note ?? null,
    lines: doc.lines.map((l) => ({ name: l.name, unit: l.unit, qty: l.quantity, needBy: l.needBy ?? null, material: l.material ?? null })),
    requestedBy: doc.requestedBy.name,
    requestedFor: doc.requestedFor.name,
    sentAt: doc.sentAt,
    createdAt: doc.createdAt,
    waitingDays: waitingDays(doc, now),
    approvers: doc.approvers.map((a) => a.name),
    returned: doc.returned ? { why: doc.returned.why, byName: doc.returned.byName, at: doc.returned.at } : null,
    canDecide: doc.st === "wait" && mayDecide(doc, viewer),
    mine: doc.requesterIds.includes(viewer.uid),
    overdue: doc.st === "wait" && waitingDays(doc, now) >= windowDays,
  }
}
