// An RFQ's life after it is published, on the server (Procurement 2.0, WP-S3-09; RFQ-13, RFQ-14, RFQ-15, WF-26, R-12):
// «مدّد» (a later date — the invitees are told, those who quoted may update), «أعد فتحه» (the same act when the date has
// passed: the link works again, an excluded offer stays excluded), «ألغِ الطلب» (a reason; the lines go back to «الواردة»,
// the invitees and the bidders are told, nothing is deleted), «ذكّر من لم يقدّم» and the rename. Each is ONE Admin transaction
// that re-reads the RFQ and re-runs the rule; the notices, the lines going back and the outbox event follow the commit,
// best-effort — a lost notice never undoes the act it reports.

import { FieldValue, type DocumentData, type Firestore, type UpdateData } from "firebase-admin/firestore"
import { z } from "zod"
import { riyadhDay } from "@/lib/hr/format"
import { mintLinkToken } from "@/lib/links/hash"
import { linkUrl } from "@/lib/links/url"
import { rfqPublishKey } from "../event-keys"
import { awaitsOutcome, rfqOutcomeEvent } from "../rfq-outcome"
import { notifyNamed } from "@/lib/supplier-free/server-notify"
import { shareLinkState } from "../guest-supplier"
import { cancelReasonRefusal, deadlineRefusal, extendPatch } from "../rfq-lifecycle-rules"
import { mrKeysOfRfq, releaseRfqNeeds } from "./release"
import { sendProcEvent, rfqKeyPart } from "../proc-event-server"
import { RFQ_CANCEL_CODES, rfqLogEntry, type RfqCancelCode, type RfqLogEntry } from "../rfq-detail"
import { bidderUsers, fill, invitedOrgIds, mayRun, RFQ_NOTICE_AR, RfqError, str, tellUsers, type Rec, type RfqCaller, type RfqNotice } from "./common"

export type RfqCancelReason = RfqCancelCode
const RFQ_CANCEL_WHY_AR: Record<Exclude<RfqCancelReason, "other">, string> = {
  need: " — السبب: لم تعد الحاجة قائمة",
  price: " — السبب: الأسعار فوق الميزانية",
  spec: " — السبب: تغيّرت المواصفة",
}

const id = z.string().trim().min(1).max(128)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const lifecycleSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("extend"), rfqId: id, deadline: day, addSupplierOrgIds: z.array(id).max(50).optional() }),
  z.object({ action: z.literal("reopen"), rfqId: id, deadline: day }),
  z.object({ action: z.literal("cancel"), rfqId: id, code: z.enum(RFQ_CANCEL_CODES), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("remind"), rfqId: id }),
])
export type LifecycleInput = z.infer<typeof lifecycleSchema>

export const renameSchema = z.object({ rfqId: id, title: z.string().trim().min(3).max(200) })
export type RenameInput = z.infer<typeof renameSchema>

export interface LifecycleResult {
  action: LifecycleInput["action"]
  rfqId: string
  /** extend/reopen: the new deadline. */
  deadline?: string
  /** extend/reopen: the suppliers added; cancel: the lines that went back to «الواردة»; remind: the non-bidders told. */
  count?: number
  /** Who was told on the platform. */
  told?: number
  /** remind: a fresh visitor-link URL for the message to an off-platform supplier, when the RFQ has a link. */
  link?: string | null
  /** extend/reopen: the act was the reopening of a closed round. */
  reopened?: boolean
}

const LOG_LIMIT = 200
const keepLog = (log: RfqLogEntry[]): RfqLogEntry[] => log.slice(-LOG_LIMIT)

const fmtDay = (d: string) => d

async function bidders(db: Firestore, orgId: string, rfqId: string): Promise<Rec[]> {
  const snap = await db.collection("offers").where("rfqId", "==", rfqId).where("contractorOrgId", "==", orgId).get()
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Rec) }))
}

async function loadRfq(db: Firestore, caller: RfqCaller, rfqId: string): Promise<Rec> {
  const snap = await db.collection("rfqs").doc(rfqId).get()
  if (!snap.exists) throw new RfqError("rfq_missing")
  const rfq = snap.data() as Rec
  if (!mayRun(caller, rfq as never)) throw new RfqError("no_permission")
  return rfq
}

function notice(kind: RfqNotice["kind"], params: Record<string, string | number>): RfqNotice {
  const copy = RFQ_NOTICE_AR[kind]
  return { kind, title: fill(copy.title, params), message: fill(copy.message, params), params }
}

const eventPart = (rfq: Rec, rfqId: string) => rfqKeyPart(rfq, rfqId)

async function leaveEvent(db: Firestore, caller: RfqCaller, rfq: Rec, rfqId: string, ver: number, change: "extended" | "reopened" | "cancelled", at: string, extra: Rec = {}) {
  await sendProcEvent(db, {
    id: "rfq_publish",
    key: rfqPublishKey(eventPart(rfq, rfqId), ver),
    organizationId: caller.orgId,
    by: caller.uid,
    at,
    refs: { rfqId, rfqNo: str(rfq.rfqNumber) || null },
    payload: { change, ...extra },
  })
}

// ── Extend and reopen ───────────────────────────────────────────────────────

async function moveDeadline(db: Firestore, caller: RfqCaller, input: { rfqId: string; deadline: string; addSupplierOrgIds?: string[] }, now: Date): Promise<LifecycleResult> {
  const at = now.toISOString()
  const today = riyadhDay(now)
  const ref = db.collection("rfqs").doc(input.rfqId)
  const done = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new RfqError("rfq_missing")
    const rfq = snap.data() as Rec
    if (!mayRun(caller, rfq as never)) throw new RfqError("no_permission")
    if (rfq.status !== "New") throw new RfqError("rfq_not_open")
    const refusal = deadlineRefusal(str(rfq.deadline), input.deadline, today)
    if (refusal) throw new RfqError(refusal)
    const passed = Boolean(rfq.closedEarly) || (!!str(rfq.deadline) && str(rfq.deadline).slice(0, 10) < today)
    const add = rfq.visibility === "private" || Array.isArray(rfq.invitedSupplierOrgIds) ? extendPatch(rfq as never, input.addSupplierOrgIds || []) : { fresh: [] as string[], invitedSupplierOrgIds: (rfq.invitedSupplierOrgIds as string[]) || [] }
    const ver = (Number(rfq.pubVer) || 1) + 1
    const entry = rfqLogEntry({ uid: caller.uid, name: caller.name }, passed ? "reopened" : "extended", at, { params: { date: input.deadline, added: add.fresh.length } })
    const patch: UpdateData<DocumentData> = {
      deadline: input.deadline,
      pubVer: ver,
      ...(add.fresh.length ? { invitedSupplierOrgIds: add.invitedSupplierOrgIds, ...("allowedSupplierOrgIds" in add ? { allowedSupplierOrgIds: add.allowedSupplierOrgIds } : {}) } : {}),
      ...(rfq.closedEarly ? { closedEarly: null } : {}),
      log: keepLog([...(((rfq.log as RfqLogEntry[]) || []) as RfqLogEntry[]), entry]),
      updatedAt: FieldValue.serverTimestamp(),
    }
    tx.update(ref, patch)
    return { rfq, passed, ver, fresh: add.fresh }
  })

  const offers = await bidders(db, caller.orgId, input.rfqId).catch(() => [] as Rec[])
  const title = str(done.rfq.title)
  const params = { contractor: caller.name, rfq: str(done.rfq.rfqNumber) || title, date: fmtDay(input.deadline) }
  const kind = done.passed ? "rfq_reopened" : "rfq_extended"
  const known = [...invitedOrgIds(done.rfq), ...bidderUsers(offers)].filter((u) => !done.fresh.includes(u))
  const told = await tellUsers(db, caller, { id: input.rfqId, title }, known, notice(kind, params), done.ver, at)
  // The suppliers an extension adds hear of the RFQ as an invitee does.
  const invited = done.fresh.length
    ? await tellUsers(
        db,
        caller,
        { id: input.rfqId, title },
        done.fresh,
        { kind: "rfq_extended", title: "دعوة لتقديم عرض", message: `دُعيت لتقديم عرض في «${title}» حتى ${input.deadline}`, params: { rfq: title, date: input.deadline } },
        done.ver,
        at
      )
    : 0
  await leaveEvent(db, caller, done.rfq, input.rfqId, done.ver, done.passed ? "reopened" : "extended", at, { deadline: input.deadline })
  return { action: done.passed ? "reopen" : "extend", rfqId: input.rfqId, deadline: input.deadline, count: done.fresh.length, told: told + invited, reopened: done.passed }
}

// ── Cancel ──────────────────────────────────────────────────────────────────

async function cancel(db: Firestore, caller: RfqCaller, input: { rfqId: string; code: RfqCancelReason; note?: string }, now: Date): Promise<LifecycleResult> {
  const refusal = cancelReasonRefusal(input.code, input.note)
  if (refusal) throw new RfqError(refusal)
  const at = now.toISOString()
  const ref = db.collection("rfqs").doc(input.rfqId)
  const note = input.code === "other" ? (input.note || "").trim() : ""
  const done = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new RfqError("rfq_missing")
    const rfq = snap.data() as Rec
    if (!mayRun(caller, rfq as never)) throw new RfqError("no_permission")
    if (rfq.status !== "New") throw new RfqError("rfq_not_open")
    const ver = (Number(rfq.pubVer) || 1) + 1
    const entry = rfqLogEntry({ uid: caller.uid, name: caller.name }, "cancelled", at, { params: { reason: note || `@rfqCancel.${input.code}` } })
    tx.update(ref, {
      status: "Cancelled",
      cancellation: { code: input.code, ...(note ? { note } : {}), byId: caller.uid, byName: caller.name, at },
      cancelledAt: at,
      pubVer: ver,
      log: keepLog([...(((rfq.log as RfqLogEntry[]) || []) as RfqLogEntry[]), entry]),
      updatedAt: FieldValue.serverTimestamp(),
    } as UpdateData<DocumentData>)
    return { rfq, ver }
  })

  const released = await releaseRfqNeeds(db, caller, input.rfqId, done.rfq).catch((err) => {
    console.error("rfq cancel: lines not released:", err)
    return 0
  })
  const offers = await bidders(db, caller.orgId, input.rfqId).catch(() => [] as Rec[])
  const title = str(done.rfq.title)
  const company = (await db.collection("users").doc(caller.orgId).get().catch(() => null))?.data() as { companyName?: string; name?: string } | undefined
  const contractor = company?.companyName || company?.name || caller.name
  // Every live quote closes with no award and the reason (OFR-07) — the notice the supplier's "my quotes" already reads.
  const outcome = offers.filter((o) => awaitsOutcome(o as never))
  let told = 0
  for (const o of outcome) {
    const e = rfqOutcomeEvent(o as never, { organizationId: caller.orgId, rfqId: input.rfqId, rfqNumber: str(done.rfq.rfqNumber) || null, rfqTitle: title, contractor, result: "noaward", why: input.code })
    if (!e) continue
    const { to, ...rest } = e
    told += await notifyNamed(db, caller, rest, to.flatMap((x) => ("users" in x ? x.users : [])), { owner: false })
  }
  // The invitees who never quoted hear that it closed.
  const offered = new Set(bidderUsers(offers))
  const reason = note ? ` — ${note}` : `@pn_rfq_cancel_why_${input.code}`
  const params = { contractor, rfq: str(done.rfq.rfqNumber) || title, reason }
  const copy = notice("rfq_cancelled", { ...params, reason: note ? reason : RFQ_CANCEL_WHY_AR[input.code as Exclude<RfqCancelReason, "other">] })
  told += await tellUsers(db, caller, { id: input.rfqId, title }, invitedOrgIds(done.rfq).filter((o) => !offered.has(o)), { ...copy, params }, done.ver, at)
  await leaveEvent(db, caller, done.rfq, input.rfqId, done.ver, "cancelled", at, { reason: input.code })
  return { action: "cancel", rfqId: input.rfqId, count: released, told }
}

// ── Remind ──────────────────────────────────────────────────────────────────

export function nonBidders(rfq: Rec, offers: Rec[]): string[] {
  const reached = Array.isArray(rfq.reachedOrgIds) ? (rfq.reachedOrgIds as unknown[]).map(str).filter(Boolean) : []
  const offered = new Set(bidderUsers(offers))
  return [...new Set([...invitedOrgIds(rfq), ...reached])].filter((o) => !offered.has(o))
}

async function remind(db: Firestore, caller: RfqCaller, input: { rfqId: string }, now: Date): Promise<LifecycleResult> {
  const at = now.toISOString()
  const rfq = await loadRfq(db, caller, input.rfqId)
  if (rfq.status !== "New") throw new RfqError("rfq_not_open")
  const deadline = str(rfq.deadline).slice(0, 10)
  if (deadline && deadline < riyadhDay(now)) throw new RfqError("rfq_not_open")
  const offers = await bidders(db, caller.orgId, input.rfqId)
  const targets = nonBidders(rfq, offers)
  const count = (Number(rfq.remindCount) || 0) + 1
  const title = str(rfq.title)
  const params = { contractor: caller.name, rfq: str(rfq.rfqNumber) || title, date: deadline }
  const told = targets.length ? await tellUsers(db, caller, { id: input.rfqId, title }, targets, notice("rfq_remind", params), count, at) : 0

  // The link message to an off-platform supplier: a fresh token on the RFQ's own link (the old ones are never stored in clear).
  let link: string | null = null
  const links = await db.collection("rfqShareLinks").where("rfqId", "==", input.rfqId).where("revoked", "==", false).limit(5).get()
  const live = links.docs.find((d) => shareLinkState(d.data() as never, rfq as never, now) === "open")
  if (live) link = linkUrl("rfq", await mintLinkToken(db, "rfq", live.id))

  if (!targets.length && !link) throw new RfqError("nothing_to_remind")
  await db
    .collection("rfqs")
    .doc(input.rfqId)
    .update({
      remindCount: count,
      log: keepLog([...(((rfq.log as RfqLogEntry[]) || []) as RfqLogEntry[]), rfqLogEntry({ uid: caller.uid, name: caller.name }, "reminded", at, { params: { count: told } })]),
      updatedAt: FieldValue.serverTimestamp(),
    })
  return { action: "remind", rfqId: input.rfqId, told, count: targets.length, link }
}

export async function runLifecycle(db: Firestore, caller: RfqCaller, input: LifecycleInput, now = new Date()): Promise<LifecycleResult> {
  switch (input.action) {
    case "extend":
      return moveDeadline(db, caller, { rfqId: input.rfqId, deadline: input.deadline, addSupplierOrgIds: input.addSupplierOrgIds }, now)
    case "reopen":
      return moveDeadline(db, caller, { rfqId: input.rfqId, deadline: input.deadline }, now)
    case "cancel":
      return cancel(db, caller, input, now)
    case "remind":
      return remind(db, caller, input, now)
  }
}

// ── Rename ──────────────────────────────────────────────────────────────────

/** «✎»: the name suppliers read in the request and on the link. Offers and links keep a copy of it, kept in step best-effort. */
export async function renameRfq(db: Firestore, caller: RfqCaller, input: RenameInput, now = new Date()): Promise<{ rfqId: string; title: string }> {
  const title = input.title.trim()
  if (title.length < 3) throw new RfqError("title_invalid")
  const at = now.toISOString()
  const ref = db.collection("rfqs").doc(input.rfqId)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new RfqError("rfq_missing")
    const rfq = snap.data() as Rec
    if (!mayRun(caller, rfq as never)) throw new RfqError("no_permission")
    if (rfq.status === "Cancelled") throw new RfqError("rfq_not_open")
    if (str(rfq.title) === title) return
    tx.update(ref, {
      title,
      titleEditedAt: at,
      log: keepLog([...(((rfq.log as RfqLogEntry[]) || []) as RfqLogEntry[]), rfqLogEntry({ uid: caller.uid, name: caller.name }, "renamed", at, { params: { title } })]),
      updatedAt: FieldValue.serverTimestamp(),
    } as UpdateData<DocumentData>)
  })
  try {
    const [offers, links] = await Promise.all([
      db.collection("offers").where("rfqId", "==", input.rfqId).where("contractorOrgId", "==", caller.orgId).get(),
      db.collection("rfqShareLinks").where("rfqId", "==", input.rfqId).get(),
    ])
    await Promise.all([...offers.docs.map((d) => d.ref.update({ rfqTitle: title })), ...links.docs.map((d) => d.ref.update({ rfqTitle: title }))])
  } catch (err) {
    console.warn("rfq rename: copies not updated:", (err as { code?: string })?.code || err)
  }
  return { rfqId: input.rfqId, title }
}

export { mrKeysOfRfq }
