// The server half of «الطلب الوارد» (WP-S2-03/05/08): the stored request `procIncoming/{orgId}__{mrKey}` is written only
// here, with the Admin SDK. Every act re-reads the request inside its transaction, applies a pure rule from `./incoming-state`
// (one line, one place), re-derives the request's state and — for a project's or the workshop's request — leaves the `proc:ST`
// event of each line whose status changed in the outbox (create-only: a repeated key is refused, so a resend never acts twice).
// `syncIncoming` brings in what reached Procurement (a team's «طلب مواد», a project's approved request, a workshop shortfall),
// reads the RFQs and orders that name each request, and tells a requester when his request moved.

import { FieldValue } from "firebase-admin/firestore"
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore"
import { formatYearlyDocNumber } from "@/lib/sales-numbering"
import { sendSms } from "@/lib/sms"
import { PROC_EVENTS, buildProcEvent, procEventDocId, requestStatusKey, workshopStatusKey, type ProcEvent } from "./event-keys"
import { projectSiteId, deliverySites, placeFromText, storedSites } from "./delivery-sites"
import { offListOf, projectsOn, mfgOn as mfgConnectorOn } from "./financeless-server"
import { fromMfgRequest, fromPmRequest, fromTeamLegacy, newTeamRequest, refreshFromSource, refreshMfg, type NewTeamRequest } from "./incoming-ingest"
import {
  PROC_INCOMING,
  buyLineIndexes,
  eventRefOf,
  failLines,
  incomingDocId,
  linkPoLines,
  linkRfqLines,
  lineKind,
  releaseLines,
  replyClockOf,
  requestOpen,
  requesterStep,
  settle,
  hasDraft,
  type ActRefusal,
  type FailReason,
  type IncomingDoc,
  type IncomingLogEntry,
  type IncomingPerson,
  type LinkOrder,
  type LinkRfq,
  type MyRequest,
  type ReplyClock,
} from "./incoming-state"
import { poStatus } from "./po"
import { riyadhYear } from "./numbering"
import { resolvePolicies } from "./policies"
import { TEAM_NOTICE_COPY_AR } from "./team-request-notify-server"
import { TEAM_REQUESTS as LEGACY_TEAM_REQUESTS, type TeamRequestDoc } from "./team-requests"
import { PROCUREMENT_SETTINGS, PURCHASE_ORDERS, type PurchaseOrder } from "./types"
import { reachesProcurement, type ProjectRequestDoc } from "./needs"
import type { PurchaseRequestRecord } from "../manufacturing-engine"
import { PROCUREMENT_RECEIVERS } from "./receivers"

export const MAT_TYPE = "MAT"
const LEGACY_MIGRATED = "migrated"

type Db = Firestore

export interface IncomingWorld {
  rfqs: LinkRfq[]
  orders: LinkOrder[]
}

export interface Actor {
  uid: string
  name: string
}

/** Arabic text of each reason: written on the line (what the requester and the project read), whatever language the buyer's screen was in. */
export const FAIL_REASON_AR: Record<Exclude<FailReason, "other">, string> = {
  nooff: "لا عروض حتى الموعد",
  price: "الأسعار فوق الميزانية بكثير",
  avail: "المادة غير متوفرة في السوق",
}

/** Firestore refuses `undefined`: what is written is exactly its JSON. */
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const iso = (v: unknown): string => {
  if (typeof v === "string") return v
  const t = v as { toDate?: () => Date } | null
  return t && typeof t.toDate === "function" ? t.toDate().toISOString() : ""
}

export const docRef = (db: Db, orgId: string, mrKey: string) => db.collection(PROC_INCOMING).doc(incomingDocId(orgId, mrKey))

// ── What the server reads of the world ──────────────────────────────────────

export async function worldOf(db: Db, orgId: string): Promise<IncomingWorld> {
  const [rfqs, orders] = await Promise.all([db.collection("rfqs").where("organizationId", "==", orgId).get(), db.collection(PURCHASE_ORDERS).where("organizationId", "==", orgId).get()])
  return {
    rfqs: rfqs.docs.map((d) => {
      const r = d.data() as Record<string, unknown>
      return { id: d.id, status: (r.status as string) ?? null, rfqNumber: (r.rfqNumber as string) ?? null, needSources: (r.needSources as LinkRfq["needSources"]) ?? null, purchaseSource: (r.purchaseSource as LinkRfq["purchaseSource"]) ?? null, products: (r.products as LinkRfq["products"]) ?? null, unawardedLines: (r.unawardedLines as number[]) ?? null }
    }),
    orders: orders.docs.map((d) => {
      const po = { id: d.id, ...d.data() } as PurchaseOrder
      return { id: po.id, status: po.status, docNumber: po.docNumber, rfqId: po.rfqId ?? null, purchaseSource: (po.purchaseSource as Record<string, unknown> | null) ?? null, lines: po.lines, derived: poStatus(po), promisedDate: po.promisedDate ?? null }
    }),
  }
}

export async function clockOf(db: Db, orgId: string, now = new Date()): Promise<ReplyClock> {
  const settings = (await db.collection(PROCUREMENT_SETTINGS).doc(orgId).get()).data()
  return replyClockOf(now, resolvePolicies(settings as Parameters<typeof resolvePolicies>[0]))
}

// ── Numbering: ONE sequence for everything that has no project number ──────

export async function drawMatNumber(db: Db, tx: Transaction, orgId: string, year: number): Promise<{ number: string; seq: number }> {
  const counter = db.collection("mfgCounters").doc(`${orgId}__${MAT_TYPE}__${year}`)
  const snap = await tx.get(counter)
  const seq = (snap.exists ? Number(snap.data()?.last) || 0 : 0) + 1
  tx.set(counter, { organizationId: orgId, type: MAT_TYPE, year, last: seq, updatedAt: FieldValue.serverTimestamp() })
  return { number: formatYearlyDocNumber(MAT_TYPE, year, seq), seq }
}

// ── The one writer ──────────────────────────────────────────────────────────

/** Key order and absent-versus-null must not look like a change. */
const canon = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined && x !== null).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]))
  return v
}
const comparable = (d: IncomingDoc) => JSON.stringify(canon({ lines: d.lines, st: d.st, status: d.status, changes: d.changes ?? [], w: d.withdrawal, a: d.approvedBy, n: d.needBy, note: d.note, m: d.mfgRequestId, wd: d.withdrawn }))

function logChanges(prev: IncomingDoc, next: IncomingDoc, by: string, at: string, clock: ReplyClock): IncomingLogEntry[] {
  const out: IncomingLogEntry[] = []
  next.lines.forEach((l, i) => {
    const before = prev.lines[i]
    if (!before) return
    const was = lineKind(before, clock)
    const now = lineKind(l, clock)
    if (was === now) return
    out.push({ at, by, act: now === "buy" && was === "rfq" ? "released" : now, line: l.no, note: now === "fail" ? l.fail?.why ?? null : now === "rfq" ? l.rfqNumber ?? null : now === "po" || now === "done" ? l.poNumber ?? null : null })
  })
  return out
}

interface EventPlan {
  ref: DocumentReference
  event: ProcEvent
}

function statusEvents(db: Db, off: string[], prev: IncomingDoc, next: IncomingDoc, by: Actor, at: string, clock: ReplyClock): EventPlan[] {
  if (next.src !== "pm" && next.src !== "mfg") return []
  const out: EventPlan[] = []
  next.lines.forEach((l, i) => {
    const before = prev.lines[i]
    if (!before || l.v <= before.v) return
    const id = next.src === "pm" ? ("pm_status" as const) : ("mfg_status" as const)
    const ref = eventRefOf(next.mrKey)
    const key = (next.src === "pm" ? requestStatusKey : workshopStatusKey)(ref, l.no, l.v)
    const event = buildProcEvent({
      id,
      key,
      organizationId: next.organizationId,
      off,
      by: by.uid,
      at,
      refs: { mrKey: next.mrKey, no: next.no, line: l.no },
      payload: { state: lineKind(l, clock), rfq: l.rfqNumber ?? null, po: l.poNumber ?? null, ...(l.fail ? { why: l.fail.why, alt: l.fail.alt } : {}) },
    })
    if (event) out.push({ ref: db.collection(PROC_EVENTS).doc(procEventDocId(event.organizationId, event.key)), event })
  })
  return out
}

export interface Committed {
  prev: IncomingDoc
  next: IncomingDoc
  moved: boolean
}

/**
 * Re-reads the request, applies `rule`, re-derives its state and writes it in ONE transaction, with the `proc:ST` events of the
 * lines whose status changed. `rule` returns the new lines (and an optional log line) or a refusal. A request not changed by
 * the rule and the world is not written.
 */
export async function mutateIncoming(
  db: Db,
  orgId: string,
  mrKey: string,
  by: Actor,
  rule: (doc: IncomingDoc, ctx: { clock: ReplyClock; world: IncomingWorld; now: Date }) => { doc: IncomingDoc; log?: Array<Pick<IncomingLogEntry, "act" | "line" | "note">> } | ActRefusal,
  opts: { world?: IncomingWorld; now?: Date; off?: string[]; clock?: ReplyClock } = {}
): Promise<Committed | ActRefusal | "not_found"> {
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const [world, clock, off] = await Promise.all([opts.world ?? worldOf(db, orgId), opts.clock ?? clockOf(db, orgId, now), opts.off ?? offListOf(db, orgId)])
  const ref = docRef(db, orgId, mrKey)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return "not_found" as const
    const prev = snap.data() as IncomingDoc
    const ruled = rule(prev, { clock, world, now })
    if (typeof ruled === "string") return ruled
    const settled = settle(ruled.doc, world, clock)
    const entries = [...(ruled.log || []).map((e) => ({ at, by: by.name, ...e })), ...logChanges(prev, settled, by.name, at, clock)]
    const next: IncomingDoc = { ...settled, log: [...(prev.log || []), ...entries].slice(-200) }
    const moved = comparable(prev) !== comparable(next)
    if (!moved) return { prev, next: prev, moved: false }
    const plans = statusEvents(db, off, prev, next, by, at, clock)
    const existing = await Promise.all(plans.map((p) => tx.get(p.ref)))
    tx.set(ref, clean(next))
    plans.forEach((p, i) => {
      if (!existing[i].exists) tx.create(p.ref, clean(p.event) as unknown as Record<string, unknown>)
    })
    return { prev, next, moved: true }
  })
}

// ── Acts ────────────────────────────────────────────────────────────────────

const indexesOf = (doc: IncomingDoc, lines: number[] | undefined, clock: ReplyClock): number[] => (lines && lines.length ? lines : buyLineIndexes(doc.lines, clock))

export const linkRfq = (db: Db, orgId: string, by: Actor, input: { mrKey: string; rfqId: string; rfqNumber: string | null; lines?: number[] }, opts?: Parameters<typeof mutateIncoming>[5]) =>
  mutateIncoming(db, orgId, input.mrKey, by, (doc, { clock, world }) => {
    if (!requestOpen(doc.st)) return "closed"
    if (!world.rfqs.some((r) => r.id === input.rfqId && r.status !== "Cancelled")) return "holder_missing"
    const idx = indexesOf(doc, input.lines, clock)
    const res = linkRfqLines(doc.lines, idx, { id: input.rfqId, number: input.rfqNumber })
    return typeof res === "string" ? res : { doc: { ...doc, lines: res.lines }, log: [{ act: "link_rfq", note: input.rfqNumber }] }
  }, opts)

export const releaseRfq = (db: Db, orgId: string, by: Actor, input: { mrKey: string; rfqId: string | null; lines?: number[] }, opts?: Parameters<typeof mutateIncoming>[5]) =>
  mutateIncoming(db, orgId, input.mrKey, by, (doc) => {
    const idx = input.lines && input.lines.length ? input.lines : doc.lines.flatMap((l, i) => (l.ps === "rfq" && (!input.rfqId || l.rfqId === input.rfqId) ? [i] : []))
    return { doc: { ...doc, lines: releaseLines(doc.lines, idx, input.rfqId) } }
  }, opts)

export const linkPo = (db: Db, orgId: string, by: Actor, input: { mrKey: string; poId: string; poNumber: string; lines?: number[] }, opts?: Parameters<typeof mutateIncoming>[5]) =>
  mutateIncoming(db, orgId, input.mrKey, by, (doc, { world }) => {
    if (!requestOpen(doc.st)) return "closed"
    if (!world.orders.some((o) => o.id === input.poId && o.status !== "cancelled")) return "holder_missing"
    const idx = input.lines && input.lines.length ? input.lines : doc.lines.flatMap((l, i) => (!l.gone && !l.ps ? [i] : []))
    const res = linkPoLines(doc.lines, idx, { id: input.poId, number: input.poNumber })
    return typeof res === "string" ? res : { doc: { ...doc, lines: res.lines }, log: [{ act: "link_po", note: input.poNumber }] }
  }, opts)

export const failIncoming = (db: Db, orgId: string, by: Actor, input: { mrKey: string; code: FailReason; note?: string | null; alt?: string | null }, opts?: Parameters<typeof mutateIncoming>[5]) => {
  const at = (opts?.now ?? new Date()).toISOString()
  return mutateIncoming(db, orgId, input.mrKey, by, (doc, { clock }) => {
    if (!requestOpen(doc.st)) return "closed"
    const why = input.code === "other" ? (input.note || "").trim() : FAIL_REASON_AR[input.code]
    const res = failLines(doc.lines, { code: input.code, note: input.note, alt: input.alt, why, at, by: by.name }, clock)
    return typeof res === "string" ? res : { doc: { ...doc, lines: res.lines }, log: [{ act: "fail", note: why }] }
  }, opts)
}

/** Its requester takes it back — only while nothing of it is in an RFQ (a draft counts: Procurement has prepared it) or an order. */
export const withdrawIncoming = (db: Db, orgId: string, by: Actor, input: { mrKey: string }, opts?: Parameters<typeof mutateIncoming>[5]) => {
  const at = (opts?.now ?? new Date()).toISOString()
  return mutateIncoming(db, orgId, input.mrKey, by, (doc, { world }) => {
    if (!doc.requesterIds.includes(by.uid)) return "not_yours"
    if (doc.st === "done" || doc.st === "fail" || doc.st === "wd") return "closed"
    if (doc.lines.some((l) => l.ps === "rfq" || l.ps === "po") || hasDraft(doc, world.rfqs)) return "in_rfq"
    return { doc: { ...doc, withdrawn: { at, by: by.uid, name: by.name }, st: "wd", status: "closed" }, log: [{ act: "withdrawn" }] }
  }, opts)
}

// ── A team's «طلب مواد» ─────────────────────────────────────────────────────

export type RequestedForInput = { kind: "self" } | { kind: "member"; id: string } | { kind: "receiver"; id: string }

/** Who the request is for: himself, a member of the company, or a receiver who may have no account (REQ-03). Null = not found in this company. */
export async function resolveRequestedFor(db: Db, orgId: string, caller: Actor, input: RequestedForInput | undefined): Promise<IncomingPerson | null> {
  if (!input || input.kind === "self") return { kind: "member", id: caller.uid, name: caller.name }
  if (input.kind === "member") {
    const u = (await db.collection("users").doc(input.id).get()).data()
    if (!u || ((u.organizationId as string) || input.id) !== orgId) return null
    return { kind: "member", id: input.id, name: (u.name as string) || (u.email as string) || "", phone: (u.phone as string) || null }
  }
  const r = (await db.collection(PROCUREMENT_RECEIVERS).doc(input.id).get()).data()
  if (!r || r.organizationId !== orgId) return null
  const userId = (r.userId as string) || null
  return userId ? { kind: "member", id: userId, name: r.name as string, phone: (r.phone as string) || null } : { kind: "receiver", id: input.id, name: r.name as string, phone: (r.phone as string) || null }
}

export async function createTeamRequest(
  db: Db,
  orgId: string,
  by: Actor,
  input: Omit<NewTeamRequest, "organizationId" | "id" | "no" | "seq" | "requestedBy" | "at"> & { requestedFor: IncomingPerson },
  now = new Date()
): Promise<IncomingDoc> {
  const year = riyadhYear(now)
  const id = db.collection(PROC_INCOMING).doc().id
  return db.runTransaction(async (tx) => {
    const n = await drawMatNumber(db, tx, orgId, year)
    const doc = newTeamRequest({ ...input, organizationId: orgId, id, no: n.number, seq: n.seq, requestedBy: { id: by.uid, name: by.name }, at: now.toISOString() })
    tx.create(docRef(db, orgId, doc.mrKey), clean(doc) as unknown as Record<string, unknown>)
    return doc
  })
}

// ── Telling the people the request is for ───────────────────────────────────

const fill = (text: string, params: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? "")
const RANK: Record<string, number> = { placed: 0, rfq: 1, order: 2, arrived: 3 }

/** The sentence a person without an account reads on his phone (never WhatsApp automation, MSG-05). */
export const smsText = (kind: "received" | "rfq" | "order" | "arrived" | "failed", p: { no: string; ref?: string; why?: string; alt?: string }): string => {
  switch (kind) {
    case "received":
      return `وصل طلب المواد ${p.no} إلى المشتريات في مدماك.`
    case "rfq":
      return `طلب المواد ${p.no} في طلب عروض ${p.ref || ""}.`
    case "order":
      return `طلب المواد ${p.no} في أمر شراء ${p.ref || ""}.`
    case "arrived":
      return `وصلت مواد الطلب ${p.no}.`
    default:
      return `تعذّر شراء طلب المواد ${p.no}: ${p.why || ""}${p.alt ? ` — البديل المقترح: ${p.alt}` : ""}`
  }
}

async function tellPerson(db: Db, doc: IncomingDoc, notice: { type: string; i18nKey: string; params: Record<string, string>; title: string; message: string; sms: string }, at: string): Promise<void> {
  const who = doc.requestedFor
  if (who.kind === "member" && who.id) {
    await db
      .collection("users")
      .doc(who.id)
      .collection("notifications")
      .add({
        userId: who.id,
        organizationId: doc.organizationId,
        type: notice.type,
        i18n: { title: `${notice.i18nKey}_title`, message: notice.i18nKey, params: notice.params },
        title: notice.title,
        message: notice.message,
        link: "/contractor/rfqs/my-requests",
        createdAt: at,
        read: false,
      })
      .catch((err: { code?: string }) => console.warn("incoming notice failed:", err?.code || err))
    return
  }
  if (who.kind === "receiver" && who.phone) await sendSms({ to: who.phone, body: notice.sms }).catch((err) => console.warn("incoming sms failed:", err))
}

/** Tells a team request's requester when it moved FORWARD — in an RFQ · in an order · arrived — once per move; writes what it told (`notifiedState`). */
export async function notifyMoved(db: Db, committed: Committed | null, at = new Date().toISOString()): Promise<boolean> {
  if (!committed || !committed.moved) return false
  const doc = committed.next
  if (doc.src !== "team" || doc.requestedFor.kind === "system") return false
  const step = requesterStep(doc.st)
  const previous = doc.notifiedState || "placed"
  if (step === "placed" || step === "failed" || step === "withdrawn") return false
  if ((RANK[step] ?? 0) <= (RANK[previous] ?? 0)) return false
  await docRef(db, doc.organizationId, doc.mrKey).update({ notifiedState: step, stateAt: at })
  const state = step === "arrived" ? "received" : step
  const copy = TEAM_NOTICE_COPY_AR[state as keyof typeof TEAM_NOTICE_COPY_AR]
  const ref = (step === "rfq" ? doc.lines.find((l) => l.rfqNumber)?.rfqNumber : doc.lines.find((l) => l.poNumber)?.poNumber) || ""
  const params = { number: doc.no, ref }
  await tellPerson(db, doc, { type: "team_request_moved", i18nKey: `pn_team_request_${state}`, params, title: fill(copy.title, params), message: fill(copy.message, params), sms: smsText(step, { no: doc.no, ref }) }, at)
  return true
}

/** «تعذّر الشراء»: the requester reads the reason and the alternative (an account notification, or an SMS to who has none). */
export async function notifyFailed(db: Db, doc: IncomingDoc, by: Actor, at = new Date().toISOString()): Promise<void> {
  if (doc.requestedFor.kind === "system") return
  const f = doc.lines.find((l) => l.fail)?.fail
  if (!f) return
  const params = { number: doc.no, reason: f.why, alt: f.alt || "—", name: by.name }
  await tellPerson(db, doc, {
    type: "team_request_declined",
    i18nKey: "pn_team_request_failed",
    params,
    title: "تعذّر شراء طلب المواد",
    message: `${doc.no} — ${by.name}: ${f.why}${f.alt ? ` — البديل المقترح: ${f.alt}` : ""}`,
    sms: smsText("failed", { no: doc.no, why: f.why, alt: f.alt }),
  }, at)
}

// ── Bringing requests in, and reading the world back onto them ──────────────

export interface SyncResult {
  created: number
  refreshed: number
  told: number
  migrated: number
}

async function createIfAbsent(db: Db, doc: IncomingDoc, number?: { allocate: (tx: Transaction) => Promise<{ number: string; seq: number }> }): Promise<IncomingDoc | null> {
  const ref = docRef(db, doc.organizationId, doc.mrKey)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists) return null
    let next = doc
    if (number) {
      const n = await number.allocate(tx)
      next = { ...doc, no: n.number, seq: n.seq }
    }
    tx.create(ref, clean(next) as unknown as Record<string, unknown>)
    return next
  })
}

/** Moves the team's legacy requests (`procTeamRequests`) into the entity, once each; the legacy document is marked `migrated` and never read again. */
export async function migrateLegacyTeam(db: Db, orgId: string): Promise<number> {
  const snap = await db.collection(LEGACY_TEAM_REQUESTS).where("organizationId", "==", orgId).get()
  let moved = 0
  for (const d of snap.docs) {
    const legacy = { id: d.id, ...(d.data() as Omit<TeamRequestDoc, "id">) } as TeamRequestDoc
    if ((legacy.status as string) === LEGACY_MIGRATED) continue
    const made = await createIfAbsent(db, fromTeamLegacy(legacy))
    await db.collection(LEGACY_TEAM_REQUESTS).doc(d.id).update({ status: LEGACY_MIGRATED, migratedAt: new Date().toISOString() })
    if (made) moved++
  }
  return moved
}

async function pmSources(db: Db, orgId: string): Promise<Array<{ project: { id: string; name: string; location?: string | null }; requests: Array<ProjectRequestDoc & Record<string, unknown>> }>> {
  const projects = await db.collection("projects").where("organizationId", "==", orgId).get()
  return Promise.all(
    projects.docs.map(async (p) => {
      const data = p.data() as { name?: string; location?: string }
      const reqs = await db.collection(`projects/${p.id}/purchaseRequests`).get()
      return { project: { id: p.id, name: data.name || "", location: data.location ?? null }, requests: reqs.docs.map((r) => ({ id: r.id, ...r.data() }) as ProjectRequestDoc & Record<string, unknown>) }
    })
  )
}

/** The state of each manufacturing request a project request was routed to. */
async function mfgRequestFacts(db: Db, orgId: string): Promise<Map<string, { status: string; at: string | null }>> {
  const snap = await db.collection("manufacturingRequests").where("organizationId", "==", orgId).get()
  return new Map(snap.docs.map((d) => {
    const r = d.data() as { status?: string; requestedAt?: string; createdAt?: unknown }
    return [d.id, { status: r.status || "new", at: r.requestedAt || iso(r.createdAt) || null }] as const
  }))
}

interface Fresh {
  doc: IncomingDoc
  isNew: boolean
}

/** What the sources hold now, as stored requests: a project's approved requests and a work order's shortfalls. A connector that is closed brings in nothing NEW; what is open keeps being read (NFR-08). */
async function readSources(db: Db, orgId: string, existing: Map<string, IncomingDoc>, open: { pm: boolean; mfg: boolean }): Promise<Fresh[]> {
  const hasExisting = (src: IncomingDoc["src"]) => [...existing.values()].some((d) => d.src === src)
  const settings = (await db.collection(PROCUREMENT_SETTINGS).doc(orgId).get()).data() as { deliverySites?: unknown } | undefined
  const fresh: Fresh[] = []
  const pm = hasExisting("pm") || open.pm ? await pmSources(db, orgId) : []
  const mrFacts = pm.length ? await mfgRequestFacts(db, orgId) : new Map<string, { status: string; at: string | null }>()
  const sites = deliverySites({ stored: storedSites(settings?.deliverySites), warehouses: [], projects: pm.map((p) => ({ id: p.project.id, name: p.project.name, location: p.project.location })), pmOn: true })
  for (const { project, requests } of pm) {
    const site = sites.find((s) => s.projectId === project.id)
    const where = placeFromText(project.location)
    const place = { siteId: site?.id ?? projectSiteId(project.id), label: project.name, city: site?.city || where.city, district: site?.district || where.district }
    for (const pr of requests) {
      if (!reachesProcurement({ pm: Boolean(pr.pm), status: pr.status })) continue
      const mr = pr.mfgRequestId ? mrFacts.get(String(pr.mfgRequestId)) ?? null : null
      const doc = fromPmRequest(orgId, project, pr, { mfgRequest: mr }, place)
      const isNew = !existing.has(doc.mrKey)
      if (!isNew || open.pm) fresh.push({ doc, isNew })
    }
  }
  if (hasExisting("mfg") || open.mfg) {
    const orders = await db.collection("workOrders").where("organizationId", "==", orgId).get()
    for (const o of orders.docs) {
      const w = o.data() as { docNumber?: string; orderNumber?: number; productId?: string; productName?: string; projectId?: string | null; projectName?: string | null; source?: { contactName?: string }; purchaseRequests?: PurchaseRequestRecord[] }
      if (!w.productId || !Array.isArray(w.purchaseRequests)) continue
      const ref = w.docNumber || `#${w.orderNumber}`
      for (const r of w.purchaseRequests) {
        const doc = fromMfgRequest(orgId, { id: o.id, ref, context: w.productName || w.projectName || w.source?.contactName || "", projectId: w.projectId ?? null, projectName: w.projectName ?? null }, r, { number: "", seq: null })
        const isNew = !existing.has(doc.mrKey)
        if (!isNew || open.mfg) fresh.push({ doc, isNew })
      }
    }
  }
  return fresh
}

const existingOf = async (db: Db, orgId: string): Promise<Map<string, IncomingDoc>> => {
  const snap = await db.collection(PROC_INCOMING).where("organizationId", "==", orgId).get()
  return new Map(snap.docs.map((d) => [(d.data() as IncomingDoc).mrKey, d.data() as IncomingDoc]))
}

export interface IncomingPlan {
  legacy: number
  pm: number
  mfg: number
  /** The state each request would start in, counted. */
  states: Record<string, number>
}

/** READ-ONLY: what `syncIncoming` would bring in for a company — the backfill's dry run. */
export async function planIncoming(db: Db, orgId: string, now = new Date()): Promise<IncomingPlan> {
  const [pmOpen, mfgOpen] = await Promise.all([projectsOn(db, orgId), mfgConnectorOn(db, orgId)])
  const legacy = (await db.collection(LEGACY_TEAM_REQUESTS).where("organizationId", "==", orgId).get()).docs.filter((d) => (d.data() as { status?: string }).status !== LEGACY_MIGRATED)
  const existing = await existingOf(db, orgId)
  const fresh = (await readSources(db, orgId, existing, { pm: pmOpen, mfg: mfgOpen })).filter((f) => f.isNew)
  const [world, clock] = await Promise.all([worldOf(db, orgId), clockOf(db, orgId, now)])
  const docs = [
    ...legacy.map((d) => fromTeamLegacy({ id: d.id, ...(d.data() as Omit<TeamRequestDoc, "id">) } as TeamRequestDoc)).filter((d) => !existing.has(d.mrKey)),
    ...fresh.map((f) => f.doc),
  ].map((d) => settle(d, world, clock))
  const states: Record<string, number> = {}
  for (const d of docs) states[d.st] = (states[d.st] || 0) + 1
  return { legacy: legacy.length, pm: fresh.filter((f) => f.doc.src === "pm").length, mfg: fresh.filter((f) => f.doc.src === "mfg").length, states }
}

export async function syncIncoming(db: Db, orgId: string, opts: { now?: Date; by?: Actor } = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const by = opts.by ?? { uid: "system", name: "النظام" }
  const result: SyncResult = { created: 0, refreshed: 0, told: 0, migrated: 0 }
  const [off, pmOpen, mfgOpen] = await Promise.all([offListOf(db, orgId), projectsOn(db, orgId), mfgConnectorOn(db, orgId)])
  result.migrated = await migrateLegacyTeam(db, orgId)
  const existing = await existingOf(db, orgId)
  const clock = await clockOf(db, orgId, now)
  const fresh = await readSources(db, orgId, existing, { pm: pmOpen, mfg: mfgOpen })

  const world = await worldOf(db, orgId)
  const year = riyadhYear(now)
  for (const { doc, isNew } of fresh) {
    if (!isNew) continue
    const made = await createIfAbsent(db, settle(doc, world, clock), doc.src === "mfg" ? { allocate: (tx) => drawMatNumber(db, tx, orgId, year) } : undefined)
    if (made) {
      result.created++
      existing.set(made.mrKey, made)
    }
  }
  const sources = new Map(fresh.map((f) => [f.doc.mrKey, f.doc]))
  const reread = (doc: IncomingDoc): IncomingDoc => {
    const source = sources.get(doc.mrKey)
    if (!source) return doc
    return doc.src === "mfg" ? refreshMfg(doc, source) : doc.src === "pm" ? refreshFromSource(doc, source) : doc
  }
  for (const stored of existing.values()) {
    if (stored.st === "done" || stored.st === "fail" || stored.st === "wd") continue
    const committed = await mutateIncoming(db, orgId, stored.mrKey, by, (doc) => ({ doc: reread(doc) }), { world, now, off, clock })
    if (committed && typeof committed !== "string" && committed.moved) {
      result.refreshed++
      if (await notifyMoved(db, committed, at)) result.told++
    }
  }
  return result
}


// ── The requester's own list («طلباتي») ─────────────────────────────────────

/** His requests, read fresh from the RFQs and orders that name them — the quantities and the dates, never a price or a supplier. */
export async function myRequests(db: Db, orgId: string, uid: string, now = new Date()): Promise<MyRequest[]> {
  await migrateLegacyTeam(db, orgId)
  const snap = await db.collection(PROC_INCOMING).where("organizationId", "==", orgId).where("requesterIds", "array-contains", uid).get()
  const docs = snap.docs.map((d) => d.data() as IncomingDoc)
  if (!docs.length) return []
  const [world, clock] = await Promise.all([worldOf(db, orgId), clockOf(db, orgId, now)])
  const out: MyRequest[] = []
  for (const stored of docs) {
    let doc = settle(stored, world, clock)
    if (comparable(doc) !== comparable(stored)) {
      const committed = await mutateIncoming(db, orgId, stored.mrKey, { uid: "system", name: "النظام" }, (d) => ({ doc: d }), { world, now, clock })
      if (committed && typeof committed !== "string") {
        doc = committed.next
        if (await notifyMoved(db, committed, now.toISOString())) doc = { ...doc, notifiedState: requesterStep(doc.st) }
      }
    }
    const po = world.orders.find((o) => o.id === doc.lines.find((l) => l.poId)?.poId)
    const failed = doc.lines.find((l) => l.fail)?.fail
    out.push({
      id: doc.mrKey,
      mrKey: doc.mrKey,
      no: doc.no,
      src: doc.src,
      place: doc.place,
      needBy: doc.needBy,
      createdAt: doc.createdAt,
      requestedFor: { kind: doc.requestedFor.kind, name: doc.requestedFor.name },
      requestedBy: doc.requestedBy.name,
      note: doc.note,
      st: doc.st,
      step: requesterStep(doc.st),
      lines: doc.lines.filter((l) => !l.gone).map((l) => ({ name: l.name, unit: l.unit, qty: l.qty, kind: lineKind(l, clock) })),
      rfqNumber: doc.lines.find((l) => l.rfqNumber)?.rfqNumber ?? null,
      poNumber: doc.lines.find((l) => l.poNumber)?.poNumber ?? null,
      promisedDate: po?.promisedDate ?? null,
      failed: failed ? { why: failed.why, alt: failed.alt } : null,
      withdrawable: doc.src === "team" && (doc.st === "new" || doc.st === "prep") && !doc.lines.some((l) => l.ps === "rfq" || l.ps === "po") && !hasDraft(doc, world.rfqs),
    })
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ── The daily job ───────────────────────────────────────────────────────────

/** Every company that has something to bring in or to read back: a stored request still open, a legacy team request, a project, a work order in hand. */
export async function orgsToSync(db: Db): Promise<string[]> {
  const [open, legacy, projects, orders] = await Promise.all([
    db.collection(PROC_INCOMING).where("status", "==", "open").get(),
    db.collection(LEGACY_TEAM_REQUESTS).where("status", "==", "open").get(),
    db.collection("projects").get(),
    db.collection("workOrders").where("status", "==", "open").get(),
  ])
  const ids = new Set<string>()
  for (const snap of [open, legacy, projects, orders]) for (const d of snap.docs) if (typeof d.data()?.organizationId === "string") ids.add(d.data()?.organizationId as string)
  return Array.from(ids)
}

export async function syncAllIncoming(db: Db, now = new Date()): Promise<{ orgs: number; created: number; refreshed: number; told: number; failed: number }> {
  const totals = { orgs: 0, created: 0, refreshed: 0, told: 0, failed: 0 }
  for (const orgId of await orgsToSync(db)) {
    try {
      const r = await syncIncoming(db, orgId, { now })
      totals.orgs++
      totals.created += r.created
      totals.refreshed += r.refreshed
      totals.told += r.told
    } catch (error) {
      totals.failed++
      console.error("Incoming sync failed for org", orgId, error)
    }
  }
  return totals
}
