// How a request that reaches Procurement becomes `procIncoming` (WP-S2-03): from a team's «طلب مواد», from a project's
// technically approved request, from a work order's shortfall. Each source keeps the facts it owns (the project's lines, its
// stock reply and what it withdrew; the workshop's record of arrival or refusal); `refresh` re-reads those and leaves what
// Procurement wrote (the line's place, its could-not-buy, the log) exactly as it was. Pure: the server passes the documents in.

import { requestChanges, wholeWithdrawal } from "./project-change"
import { lineGot, linePortions, requestOf, type PmMaterialRequest, type ReqLine } from "../pm/supply"
import type { ProjectRequestDoc } from "./needs"
import type { PurchaseRequestRecord } from "../manufacturing-engine"
import { dayOf } from "./po"
import { materialKey } from "./prices"
import { mfgMrKey, pmMrKey, requestOpen, teamMrKey, type IncomingDoc, type IncomingLine, type IncomingPerson } from "./incoming-state"
import type { TeamRequestDoc } from "./team-requests"

const EPS = 0.005
const iso = (v: unknown): string => {
  if (typeof v === "string") return v
  const t = v as { toDate?: () => Date } | null
  return t && typeof t.toDate === "function" ? t.toDate().toISOString() : ""
}

const baseLine = (no: number, l: Pick<IncomingLine, "name" | "unit" | "qty">): IncomingLine => ({ no, name: l.name.trim(), unit: l.unit.trim(), qty: l.qty, v: 1 })

const flat = (doc: Omit<IncomingDoc, "status" | "requesterIds"> & { requesterIds?: string[] }): IncomingDoc => {
  const ids = Array.from(new Set([doc.requestedBy.id, doc.requestedFor.kind === "member" ? doc.requestedFor.id : null].filter((x): x is string => Boolean(x))))
  return { ...doc, requesterIds: ids, status: requestOpen(doc.st) ? "open" : "closed", ...(doc.src === "team" ? { requestedById: doc.requestedBy.id } : {}) }
}

// ── A team's «طلب مواد» ─────────────────────────────────────────────────────

export function fromTeamLegacy(legacy: TeamRequestDoc & { notifiedState?: string | null; stateAt?: string | null }): IncomingDoc {
  const seq = Number(/\/(\d+)$/.exec(legacy.number)?.[1]) || null
  const lines = legacy.lines
    .filter((l) => l.name && Number(l.quantity) > 0)
    .map((l, i): IncomingLine => ({
      ...baseLine(i + 1, { name: l.name, unit: l.unit, qty: Number(l.quantity) }),
      ...(l.material ? { material: l.material } : {}),
      ...(l.needBy ? { needBy: l.needBy.slice(0, 10) } : {}),
    }))
  const by = { id: legacy.requestedById, name: legacy.requestedByName }
  const declined = legacy.status === "declined"
  const failed = declined
    ? lines.map((l) => ({ ...l, ps: "fail" as const, fail: { code: "other" as const, why: legacy.declinedReason || "", alt: "", at: legacy.declinedAt || legacy.createdAt, by: legacy.declinedByName || "" }, v: 2 }))
    : lines
  const withdrawn = legacy.status === "withdrawn" ? { at: legacy.withdrawnAt || legacy.createdAt, by: legacy.requestedById, name: legacy.requestedByName } : null
  return flat({
    organizationId: legacy.organizationId,
    mrKey: teamMrKey(legacy.id),
    src: "team",
    no: legacy.number,
    seq,
    siteId: legacy.siteId ?? null,
    place: legacy.place,
    requestedFor: { kind: "member", id: legacy.requestedById, name: legacy.requestedByName },
    requestedBy: by,
    needBy: legacy.needBy || null,
    note: legacy.note || null,
    createdAt: legacy.createdAt,
    st: declined ? "fail" : withdrawn ? "wd" : "new",
    lines: failed,
    log: [{ at: legacy.createdAt, by: legacy.requestedByName, act: "created" }],
    withdrawn,
    legacyId: legacy.id,
    ...(legacy.notifiedState ? { notifiedState: legacy.notifiedState } : {}),
    ...(legacy.stateAt ? { stateAt: legacy.stateAt } : {}),
  })
}

export interface NewTeamRequest {
  organizationId: string
  id: string
  no: string
  seq: number | null
  lines: Array<{ name: string; unit: string; quantity: number; needBy?: string | null; material?: IncomingLine["material"]; warrantyMonths?: number | null }>
  needBy: string
  siteId?: string | null
  place: { label: string; city: string; district: string }
  note?: string | null
  requestedBy: { id: string; name: string }
  requestedFor: IncomingPerson
  at: string
}

export function newTeamRequest(r: NewTeamRequest): IncomingDoc {
  return flat({
    organizationId: r.organizationId,
    mrKey: teamMrKey(r.id),
    src: "team",
    no: r.no,
    seq: r.seq,
    siteId: r.siteId ?? null,
    place: r.place,
    requestedFor: r.requestedFor,
    requestedBy: r.requestedBy,
    needBy: r.needBy,
    note: r.note || null,
    createdAt: r.at,
    st: "new",
    lines: r.lines.map((l, i) => ({
      ...baseLine(i + 1, { name: l.name, unit: l.unit, qty: l.quantity }),
      ...(l.material ? { material: l.material } : {}),
      ...(l.needBy ? { needBy: l.needBy.slice(0, 10) } : {}),
      ...(l.warrantyMonths != null ? { warrantyMonths: l.warrantyMonths } : {}),
    })),
    log: [{ at: r.at, by: r.requestedBy.name, act: r.requestedFor.kind === "member" && r.requestedFor.id === r.requestedBy.id ? "created" : "created_for", note: r.requestedFor.name }],
  })
}

// ── A project's request ─────────────────────────────────────────────────────

export interface PmFacts {
  /** The manufacturing request the project's request was routed to, when it was. */
  mfgRequest?: { status: string; at: string | null } | null
}

const held = (l: ReqLine) => l.chg?.st === "wait"
const refused = (l: ReqLine) => l.chg?.st === "no"

function pmLine(raw: ProjectRequestDoc, l: ReqLine, index: number): IncomingLine {
  const out = baseLine(index + 1, { name: l.name, unit: l.unit, qty: Number(l.qty) || 0 })
  if (l.material) out.material = l.material
  if (l.itemId) out.boqItemId = l.itemId
  const want = materialKey(l.name, l.unit)
  const item = (raw.items || []).find((i) => materialKey(i.name, i.unit) === want && (!i.itemId || i.itemId === l.itemId))
  if (item?.category) out.category = item.category
  if (item?.samplePending) out.samplePending = true
  if (item?.needBy) out.needBy = item.needBy.slice(0, 10)
  const got = lineGot(l)
  if (held(l)) out.gone = { kind: "held", on: l.chg?.on ?? null, by: l.chg?.byName ?? null }
  else if (refused(l)) out.gone = { kind: "refused", on: l.chg?.on ?? null, by: l.chg?.byName ?? null }
  else if (l.cl && !(got > 0)) out.gone = { kind: l.cl.t === "cancel" && l.cl.why !== "chg" ? "withdrawn" : "closed", on: l.cl.on ?? null, by: l.cl.byName ?? null }
  if (l.inv?.k === "issue") {
    const give = Math.max(0, Math.min(Number(l.inv.q) || 0, out.qty))
    out.stk = { st: give >= out.qty - EPS ? "issue" : "part", give, at: l.inv.on, by: l.inv.byName ?? null, why: l.inv.why ?? null }
  } else if (l.inv?.k === "none") out.stk = { st: "none", at: l.inv.on, by: l.inv.byName ?? null, why: l.inv.why ?? null }
  const buy = linePortions(l).find((p) => p.k === "buy")
  if (!out.gone && (l.cl ? got > 0 : buy ? buy.got >= buy.q - EPS && buy.q > 0 : got >= out.qty - EPS)) out.rcv = true
  return out
}

/** A legacy (pre-PM-1.0) request: its items become lines; a pending one waits for the warehouse's approval, a decision lifts that wait. */
function legacyLines(pr: PmMaterialRequest, raw: ProjectRequestDoc): IncomingLine[] {
  const decision = raw.procDecision ?? null
  const at = iso(raw.createdAt)
  return pr.lines.map((l, i) => {
    const line = baseLine(i + 1, { name: l.name, unit: l.unit, qty: Number(l.qty) || 0 })
    const item = (raw.items || [])[i]
    if (item?.category) line.category = item.category
    if (item?.samplePending) line.samplePending = true
    if (item?.itemId) line.boqItemId = item.itemId
    if (item?.material) line.material = item.material
    if (pr.status === "pending" && !decision) line.stk = { st: "wait", at }
    else if (decision?.kind === "proceed_short") {
      const give = Math.max(0, Number(decision.cover?.[i]) || 0)
      line.stk = give > 0 ? { st: give >= line.qty - EPS ? "issue" : "part", give, at: decision.at } : { st: "none", at: decision.at }
    } else if (decision?.kind === "proceed_full") line.stk = { st: "none", at: decision.at }
    return line
  })
}

/** The workshop's answer on a project request routed to it: asked, making it (nothing to buy), or sent back to be bought. */
function workshopOn(lines: IncomingLine[], raw: ProjectRequestDoc, facts: PmFacts): IncomingLine[] {
  const decision = raw.procDecision ?? null
  if (decision?.kind === "buy") return lines.map((l) => ({ ...l, mk: { st: "buy" as const, at: decision.at } }))
  const mr = facts.mfgRequest
  if (!raw.mfgRequestId || !mr) return lines
  if (mr.status === "rejected" || mr.status === "moved") return lines.map((l) => ({ ...l, mk: { st: "buy" as const, at: mr.at || "" } }))
  if (mr.status === "new") return lines.map((l) => ({ ...l, mk: { st: "ask" as const, at: mr.at || "" } }))
  return lines.map((l) => ({ ...l, mk: { st: "make" as const, make: l.qty, at: mr.at || "" } }))
}

export function fromPmRequest(
  organizationId: string,
  project: { id: string; name: string },
  rawDoc: ProjectRequestDoc & Record<string, unknown>,
  facts: PmFacts = {},
  place?: { siteId?: string | null; label: string; city: string; district: string }
): IncomingDoc {
  const pr = requestOf(rawDoc as unknown as Parameters<typeof requestOf>[0])
  const pm = Boolean(rawDoc.pm)
  const base = pm ? pr.lines.map((l, i) => pmLine(rawDoc, l, i)) : legacyLines(pr, rawDoc)
  const lines = workshopOn(base, rawDoc, facts)
  const changes = requestChanges(rawDoc, null)
  const withdrawal = wholeWithdrawal(rawDoc)
  const rejected = rawDoc.status === "rejected"
  const requestedBy = { id: String(rawDoc.requestedByUserId || ""), name: String(rawDoc.requestedByUserName || "") }
  return flat({
    organizationId,
    mrKey: pmMrKey(project.id, pr.id),
    src: "pm",
    no: pm ? `MR ${pr.id}` : pr.id,
    seq: pm && typeof pr.seq === "number" ? pr.seq : null,
    siteId: place?.siteId ?? null,
    place: place ? { label: place.label, city: place.city, district: place.district } : { label: project.name, city: "", district: "" },
    projectId: project.id,
    projectName: project.name,
    requestedFor: { kind: "member", id: requestedBy.id || null, name: requestedBy.name },
    requestedBy,
    approvedBy: pm && rawDoc.status === "approved" ? { name: String(rawDoc.approvedByName || rawDoc.decidedByUserName || ""), on: String(rawDoc.approvedOn || "") } : null,
    needBy: rawDoc.needBy ? String(rawDoc.needBy).slice(0, 10) : null,
    note: rawDoc.notes || null,
    createdAt: iso(rawDoc.createdAt) || pr.day || "",
    st: rejected ? (rawDoc.withdrawn ? "wd" : "fail") : "new",
    lines: rejected ? lines.map((l) => ({ ...l, gone: { kind: rawDoc.withdrawn ? ("withdrawn" as const) : ("refused" as const), on: dayOf(iso(rawDoc.decidedAt)) || null, by: rawDoc.decidedByUserName ?? null } })) : lines,
    log: [{ at: iso(rawDoc.createdAt) || pr.day || "", by: requestedBy.name, act: "ingested" }],
    ...(rawDoc.mfgRequestId ? { mfgRequestId: rawDoc.mfgRequestId } : {}),
    ...(changes.length ? { changes } : {}),
    ...(withdrawal ? { withdrawal } : {}),
  })
}

/** The facts a project owns, read again onto a stored request: its lines (by position), its stock reply, what it withdrew. Procurement's own marks stay. */
export function refreshFromSource(stored: IncomingDoc, fresh: IncomingDoc): IncomingDoc {
  const lines = fresh.lines.map((f, i): IncomingLine => {
    const own = stored.lines[i]
    if (!own) return f
    const changed = own.qty !== f.qty || JSON.stringify(own.gone ?? null) !== JSON.stringify(f.gone ?? null) || JSON.stringify(own.stk ?? null) !== JSON.stringify(f.stk ?? null) || JSON.stringify(own.mk ?? null) !== JSON.stringify(f.mk ?? null) || Boolean(own.rcv) !== Boolean(f.rcv) || Boolean(own.samplePending) !== Boolean(f.samplePending)
    return {
      ...own,
      name: f.name,
      unit: f.unit,
      qty: f.qty,
      material: f.material ?? own.material ?? null,
      boqItemId: f.boqItemId ?? own.boqItemId ?? null,
      needBy: f.needBy ?? own.needBy ?? null,
      category: f.category ?? own.category ?? null,
      samplePending: Boolean(f.samplePending),
      stk: f.stk ?? null,
      mk: f.mk ?? null,
      gone: f.gone ?? null,
      rcv: own.ps === "po" ? own.rcv : f.rcv,
      v: changed ? own.v + 1 : own.v,
    }
  })
  return {
    ...stored,
    lines: lines.length >= stored.lines.length ? lines : [...lines, ...stored.lines.slice(lines.length)],
    needBy: fresh.needBy,
    note: fresh.note,
    approvedBy: fresh.approvedBy ?? stored.approvedBy ?? null,
    mfgRequestId: fresh.mfgRequestId ?? null,
    changes: fresh.changes ?? [],
    withdrawal: fresh.withdrawal ?? null,
  }
}

// ── A work order's shortfall ────────────────────────────────────────────────

export function fromMfgRequest(
  organizationId: string,
  order: { id: string; ref: string; context: string; projectId?: string | null; projectName?: string | null },
  r: PurchaseRequestRecord,
  no: { number: string; seq: number | null }
): IncomingDoc {
  const line: IncomingLine = { ...baseLine(1, { name: r.itemName, unit: r.unit, qty: Number(r.quantity) || 0 }) }
  if (r.state === "arrived") line.rcv = true
  if (r.state === "declined") {
    line.ps = "fail"
    line.fail = { code: "other", why: r.declinedReason || "", alt: "", at: r.declinedAt || r.at, by: r.declinedBy || "" }
    line.v = 2
  }
  return flat({
    organizationId,
    mrKey: mfgMrKey(order.id, r.id),
    src: "mfg",
    no: no.number,
    seq: no.seq,
    place: { label: order.context || order.ref, city: "", district: "" },
    projectId: order.projectId ?? null,
    projectName: order.projectName ?? null,
    workOrderId: order.id,
    workOrderNo: order.ref,
    productName: order.context || null,
    requestedFor: { kind: "system", name: r.by },
    requestedBy: { id: r.byId || "", name: r.by },
    needBy: r.needBy ? r.needBy.slice(0, 10) : null,
    note: r.note || null,
    createdAt: r.at,
    st: r.state === "declined" ? "fail" : "new",
    lines: [line],
    log: [{ at: r.at, by: r.by, act: "ingested" }],
  })
}

/** A shortfall's own facts read again: arrived, or sent back with a reason. */
export function refreshMfg(stored: IncomingDoc, fresh: IncomingDoc): IncomingDoc {
  const f = fresh.lines[0]
  const own = stored.lines[0]
  if (!f || !own) return stored
  const wasRcv = Boolean(own.rcv)
  const wasFail = own.ps === "fail"
  if ((Boolean(f.rcv) === wasRcv && (f.ps === "fail") === wasFail) || (wasFail && f.ps !== "fail")) return stored
  const next: IncomingLine = { ...own, rcv: f.rcv ?? false, v: own.v + 1 }
  if (f.ps === "fail") {
    next.ps = "fail"
    next.fail = f.fail
  }
  return { ...stored, lines: [next], note: fresh.note, needBy: fresh.needBy }
}
