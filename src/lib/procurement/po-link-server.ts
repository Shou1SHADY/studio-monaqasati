// The order link, on the server (Procurement 2.0 WP-S4-08, MSG-03/04, G-06, G-08, G-17, R-22, R-23): for a supplier OUTSIDE the
// platform the order is one address. A token (22 characters, only its hash stored) opens ONE purchase order; what the page shows
// and what the supplier may do come from the order's state (`poLinkActs`), re-checked here inside the transaction of every act.
// He accepts, asks for a change, declines (the order stays alive, red, for the buyer), reports a delivery by a day and a note —
// never a quantity, the receiver counts — and writes to the buyer in the order's conversation. Every act writes the order's log
// and leaves its event key (`./event-keys`); the notice to the buyer follows the commit, best-effort.

import { FieldValue, type DocumentData, type Firestore, type UpdateData } from "firebase-admin/firestore"
import { findLinkByToken, mintLinkToken } from "@/lib/links/hash"
import { consumeRate } from "@/lib/links/rate"
import { linkUrl } from "@/lib/links/url"
import { riyadhDay } from "@/lib/hr/format"
import { notifyNamed } from "@/lib/supplier-free/server-notify"
import { POL_CHANGE_LABEL, POL_DECLINE_TEXT, lineView, poLinkActs, poLinkState, reportDayFor, bareOrderNo, type PoDeclineReason, type PoLinkNotice, type PoLinkView, type PoReportOffset } from "@/lib/po-link"
import { PROC_EVENTS, buildProcEvent, poAcceptKey, poDeclineKey, procEventDocId, type ProcEvent } from "./event-keys"
import type { ProcEventId } from "./package-data"
import { offListOf } from "./financeless-server"
import { MessageRefusal, fileBelongs, markRead, messagesOf, postMessage } from "./po-messages-server"
import { supplierUnreadCount, threadOf, type PoWithChat } from "./po-messages"
import { createDeliveryNotice, NoticeRefusal } from "./notice-server"
import type { FinancelessPo } from "./payment-mark"
import { addDays, dayOf, isLumpSum, poValue } from "./po"
import { pendingVersion, poSiteOf, poVer, poVersions } from "./po-state"
import { readPolicies, type OrderLinkMinter } from "./po-server"
import { PURCHASE_ORDERS, type PoLogEntry, type PurchaseOrder } from "./types"

export const ORDER_LINKS = "orderLinks"

// ---------------------------------------------------------------------------
// Minting — the buyer's «send» on WhatsApp or e-mail hands the composer a real address
// ---------------------------------------------------------------------------

/** One live link per order: its document is the order's id; every call adds a fresh token (only hashes are kept, so the buyer is
 * handed a new address each time he asks for one, and the ones already sent keep working). */
export const mintOrderLink: OrderLinkMinter = async (db, po) => {
  const ref = db.collection(ORDER_LINKS).doc(po.id)
  const snap = await ref.get()
  if (!snap.exists) await ref.set({ poId: po.id, organizationId: po.organizationId, tokenHashes: [], createdAt: new Date().toISOString() })
  return linkUrl("po", await mintLinkToken(db, "po", po.id))
}

// ---------------------------------------------------------------------------
// Resolving the token
// ---------------------------------------------------------------------------

export type LinkRefusalCode = "INVALID_TOKEN" | "NOT_FOUND" | "NOT_SENT" | "RATE_LIMITED" | "RATE_UNAVAILABLE" | "ACTION_NOT_ALLOWED" | "BAD_REQUEST" | "DATE_REQUIRED" | "DATE_PAST" | "VERSION_MISSING" | "CANCELLED" | "FILE_NOT_YOURS"

export class PoLinkError extends Error {
  constructor(
    readonly code: LinkRefusalCode,
    readonly status: number,
    readonly retryAfterSec?: number
  ) {
    super(code)
    this.name = "PoLinkError"
  }
}

const asPo = (id: string, data: Record<string, unknown>): PoWithChat => ({ ...(data as Omit<PoWithChat, "id">), id })

export interface ResolvedOrder {
  poId: string
  po: PoWithChat
}

/** The order a presented token opens — or why it opens none. A cancelled or completed order still resolves: its page says so (G-17). */
export async function resolveOrderLink(db: Firestore, token: string): Promise<ResolvedOrder> {
  const found = await findLinkByToken(db, "po", token)
  if (!found.ok) throw new PoLinkError(found.code, found.status)
  const snap = await db.collection(PURCHASE_ORDERS).doc(found.linkId).get()
  const data = snap.exists ? snap.data() : undefined
  if (!snap.exists || !data || data.organizationId !== found.link.organizationId) throw new PoLinkError("NOT_FOUND", 404)
  const po = asPo(snap.id, data)
  if (!poLinkState(po)) throw new PoLinkError("NOT_SENT", 409)
  return { poId: snap.id, po }
}

/** The link's own cap on acts: a token is not a way to flood an order's log or its buyer's bell. */
export async function limitActs(db: Firestore, poId: string, now = Date.now()): Promise<void> {
  const verdict = await consumeRate(db, `po:${poId}`, { max: 120, windowMs: 3_600_000 }, now)
  if (!verdict.ok) throw new PoLinkError(verdict.code, verdict.status, verdict.code === "RATE_LIMITED" ? verdict.retryAfterSec : undefined)
}

// ---------------------------------------------------------------------------
// What the page shows — one order, nothing of any other (G-06, B-14)
// ---------------------------------------------------------------------------

const companyNameOf = async (db: Firestore, orgId: string): Promise<string> => {
  const d = (await db.collection("users").doc(orgId).get().catch(() => null))?.data() as { companyName?: string; name?: string } | undefined
  return d?.companyName || d?.name || ""
}

const totalOf = (po: PurchaseOrder): PoLinkView["total"] => {
  const exVat = poValue(po)
  if (isLumpSum(po)) return { kind: "lump", amount: exVat, exVat }
  const rate = po.noVat === true ? 0 : Number(po.vatRate) || 0
  return rate === 0 ? { kind: "nvat", amount: exVat, exVat } : { kind: "incl", amount: Math.round((exVat * (1 + rate) + Number.EPSILON) * 100) / 100, exVat }
}

interface DeliveryRow {
  id: string
  status?: string
  seq?: number
  source?: string
  noNotice?: boolean
  deliveryDate?: string | null
  notes?: string | null
  docNumber?: string | null
  confirmedAt?: string | null
  createdAt?: unknown
  closedByReceipt?: { deliveryId?: string } | null
  lines?: Array<{ accepted?: number; rejected?: number; counted?: number }>
}

const sum = (rows: ReadonlyArray<{ accepted?: number; rejected?: number }>, key: "accepted" | "rejected") => Math.round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100

export function noticesOf(po: PurchaseOrder, deliveries: ReadonlyArray<DeliveryRow>): PoLinkNotice[] {
  const byId = new Map(deliveries.map((d) => [d.id, d]))
  const out: PoLinkNotice[] = []
  for (const d of deliveries) {
    if (d.source === "manual" || d.noNotice || !d.deliveryDate) continue
    const receipt = d.status === "confirmed" ? d : d.closedByReceipt?.deliveryId ? byId.get(d.closedByReceipt.deliveryId) : undefined
    const counted = receipt?.lines && receipt.status === "confirmed" ? receipt.lines : null
    out.push({ id: d.id, seq: Number(d.seq) || 0, date: dayOf(d.deliveryDate), note: d.notes || null, count: counted ? { accepted: sum(counted, "accepted"), rejected: sum(counted, "rejected") } : null })
  }
  // The free journey's reports live on the order itself.
  for (const r of po.deliveryReports || []) out.push({ id: r.id, seq: 0, date: dayOf(r.date), note: r.note, count: null })
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq).map((n, i) => (n.seq ? n : { ...n, seq: i + 1 }))
}

export async function buildLinkView(db: Firestore, po: PoWithChat): Promise<PoLinkView> {
  const state = poLinkState(po)
  if (!state) throw new PoLinkError("NOT_SENT", 409)
  const [company, policies, off, messages, deliverySnap] = await Promise.all([
    companyNameOf(db, po.organizationId),
    readPolicies(db, po.organizationId),
    offListOf(db, po.organizationId),
    messagesOf(db, po.id),
    db.collection("deliveries").where("poId", "==", po.id).get(),
  ])
  const deliveries = deliverySnap.docs.map((d) => ({ ...(d.data() as Omit<DeliveryRow, "id">), id: d.id }) as DeliveryRow)
  const site = poSiteOf(po)
  const accepted = state === "accepted" || state === "complete"
  const pv = pendingVersion(po)
  const mark = (po as FinancelessPo).paymentMark
  const financeIsOn = !off.includes("payments")
  const receipts = deliveries.map((d) => ({ docNumber: d.docNumber ?? null, status: d.status ?? null, confirmedAt: d.confirmedAt ?? null, createdAt: d.createdAt }))
  // The supplier reads the buyer's company as the author of what the buyer's people wrote.
  const visible = messages.map((m) => (m.by === "us" ? { ...m, authorName: company || m.authorName, authorId: "" } : m))
  const cancelledEntry = [...(po.log || [])].reverse().find((e) => e.action === "cancelled")
  return {
    no: bareOrderNo(po.docNumber),
    company,
    supplierName: po.supplierName,
    state,
    ver: poVer(po),
    acts: poLinkActs(po),
    site: site ? { name: site.name, city: site.city ?? null, district: site.district ?? null, address: site.address ?? null, mapUrl: site.mapUrl ?? null } : null,
    access: po.site?.access ?? null,
    needBy: po.requestedDeliveryDate ?? null,
    dueDate: po.dueDate ?? null,
    promisedDate: po.promisedDate ?? null,
    acceptBy: po.sentAt ? addDays(riyadhDay(new Date(po.sentAt)), policies.supplierAcceptanceDays) : null,
    terms: po.paymentTerms ?? null,
    lines: po.lines.map(lineView),
    total: totalOf(po),
    receiver: accepted && site?.receiver ? { name: site.receiver.name, phone: site.receiver.phone ?? null } : null,
    notices: noticesOf(po, deliveries),
    pendingVersion: pv ? { n: pv.n, kind: pv.kind, note: pv.note ?? null, date: typeof pv.params?.date === "string" ? pv.params.date : null } : null,
    cancel: state === "cancelled" ? { at: cancelledEntry?.at || po.closedAt || "", why: po.cancelledReason || cancelledEntry?.note || "" } : null,
    decline: po.supplierDecline ? { at: po.supplierDecline.at, reason: po.supplierDecline.reason, note: po.supplierDecline.note || null } : null,
    payment: !financeIsOn && mark ? { state: mark.state, day: mark.day ?? null } : null,
    thread: threadOf(po, visible, receipts),
    unread: supplierUnreadCount(po, messages),
  }
}

// ---------------------------------------------------------------------------
// Acts
// ---------------------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/

const linkWho = (po: PurchaseOrder) => ({ uid: `link:${po.id}`, name: po.supplierName })

const logOf = (po: PurchaseOrder, action: string, at: string, extra: { note?: string | null; params?: PoLogEntry["params"] } = {}): PoLogEntry => ({ at, byId: linkWho(po).uid, byName: po.supplierName, action, note: extra.note ?? null, params: extra.params ?? null }) as PoLogEntry

const refsOf = (po: PurchaseOrder) => ({ po: po.docNumber, rfq: po.rfqId, offer: po.offerId })

type QueueTx = { create: (ref: ReturnType<Firestore["doc"]>, data: Record<string, unknown>) => void }

function queueEvent(tx: QueueTx, db: Firestore, off: string[], po: PurchaseOrder, id: ProcEventId, key: string, at: string, payload: ProcEvent["payload"]): void {
  const ev = buildProcEvent({ id, key, organizationId: po.organizationId, off, by: linkWho(po).uid, at, refs: refsOf(po), payload })
  if (ev) tx.create(db.collection(PROC_EVENTS).doc(procEventDocId(ev.organizationId, ev.key)), ev as unknown as Record<string, unknown>)
}

async function tellBuyer(db: Firestore, po: PurchaseOrder, kind: Parameters<typeof notifyNamed>[2]["kind"], params: Record<string, string | number>): Promise<void> {
  try {
    await notifyNamed(db, linkWho(po), { kind, organizationId: po.organizationId, params: { supplier: po.supplierName, number: po.docNumber, ...params }, poId: po.id, rfqId: po.rfqId, offerId: po.offerId }, [po.preparedById, po.sentById])
  } catch (err) {
    console.warn("order link notice not sent:", (err as { code?: string })?.code || err)
  }
}

async function actOn(db: Firestore, poId: string, run: (po: PoWithChat) => { patch: Record<string, unknown>; log: PoLogEntry; events?: Array<[ProcEventId, string, ProcEvent["payload"]]> }, off: string[], at: string): Promise<PoWithChat> {
  const ref = db.collection(PURCHASE_ORDERS).doc(poId)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? snap.data() : undefined
    if (!snap.exists || !data) throw new PoLinkError("NOT_FOUND", 404)
    const po = asPo(snap.id, data)
    const { patch, log, events } = run(po)
    const nextLog = [...(po.log || []), log]
    tx.update(ref, { ...patch, log: nextLog, updatedAt: FieldValue.serverTimestamp() } as UpdateData<DocumentData>)
    for (const [id, key, payload] of events || []) queueEvent(tx, db, off, po, id, key, at, payload)
    return { ...po, ...patch, log: nextLog } as PoWithChat
  })
}

const refuse = (): never => {
  throw new PoLinkError("ACTION_NOT_ALLOWED", 409)
}

export async function linkAccept(db: Firestore, resolved: ResolvedOrder, input: { date?: string | null }, now: Date = new Date()): Promise<PoWithChat> {
  const at = now.toISOString()
  const off = await offListOf(db, resolved.po.organizationId)
  const po = await actOn(
    db,
    resolved.poId,
    (p) => {
      if (!poLinkActs(p).accept) return refuse()
      const date = p.dueDate || p.requestedDeliveryDate || input.date || null
      if (!date) throw new PoLinkError("DATE_REQUIRED", 400)
      if (!DAY.test(date)) throw new PoLinkError("BAD_REQUEST", 400)
      if (!p.dueDate && !p.requestedDeliveryDate && date < riyadhDay(now)) throw new PoLinkError("DATE_PAST", 400)
      const ver = poVer(p)
      const versions = p.versions?.length ? poVersions(p).map((v) => (v.n === ver && !v.acceptedAt ? { ...v, acceptedAt: at, acceptedByName: p.supplierName } : v)) : undefined
      return {
        patch: { status: "accepted", supplierAcceptedAt: at, promisedDate: date, acceptanceRecordedBy: "link", ...(versions ? { versions } : {}) },
        log: logOf(p, "supplier_accepted", at, { params: { date, recordedBy: "link" } }),
        events: [["po_accept", poAcceptKey(p.docNumber, ver), { version: ver, date, via: "link" }]],
      }
    },
    off,
    at
  )
  await tellBuyer(db, po, "po_supplier_accepted", { date: po.promisedDate || "" })
  return po
}

export async function linkDecline(db: Firestore, resolved: ResolvedOrder, input: { reason: PoDeclineReason; note?: string | null; locale?: "ar" | "en" }, now: Date = new Date()): Promise<PoWithChat> {
  const at = now.toISOString()
  const note = (input.note || "").trim().slice(0, 500)
  if (input.reason === "other" && note.length < 4) throw new PoLinkError("BAD_REQUEST", 400)
  const reasonText = POL_DECLINE_TEXT[input.locale ?? "ar"][input.reason]
  const off = await offListOf(db, resolved.po.organizationId)
  const po = await actOn(
    db,
    resolved.poId,
    (p) => {
      if (!poLinkActs(p).decline) return refuse()
      // PO-13: the order is NOT cancelled — it stays «اعتذر المورّد», red, until the buyer re-awards or returns the materials.
      return {
        patch: { supplierDecline: { at, reason: input.reason, note: note || reasonText, byId: linkWho(p).uid, byName: p.supplierName } },
        log: logOf(p, "supplier_declined", at, { note: note || reasonText, params: { reason: input.reason, via: "link" } }),
        events: [["po_decline", poDeclineKey(p.docNumber, poVer(p)), { reason: input.reason, via: "link" }]],
      }
    },
    off,
    at
  )
  await tellBuyer(db, po, "po_supplier_declined", { reason: reasonText, note })
  return po
}

export async function linkRequestChange(db: Firestore, resolved: ResolvedOrder, input: { text: string; locale?: "ar" | "en" }, now: Date = new Date()): Promise<PoWithChat> {
  if (!poLinkActs(resolved.po).requestChange) refuse()
  const text = input.text.trim()
  if (text.length < 3) throw new PoLinkError("BAD_REQUEST", 400)
  const label = POL_CHANGE_LABEL[input.locale ?? "ar"]
  return (await linkPost(db, resolved, { text: `${label}: ${text}`, kind: "change", locale: input.locale }, now)).po
}

export async function linkReportDelivery(db: Firestore, resolved: ResolvedOrder, input: { offset: PoReportOffset; note?: string | null }, now: Date = new Date()): Promise<{ seq: number }> {
  const date = reportDayFor(input.offset, now)
  try {
    const res = await createDeliveryNotice(
      db,
      {
        poId: resolved.poId,
        deliveryDate: date,
        note: input.note,
        by: { source: "link", ...linkWho(resolved.po) },
        authorize: (po) => {
          if (!poLinkActs(po).report) throw new NoticeRefusal("not_accepted")
        },
      },
      now
    )
    await tellBuyer(db, res.po, "po_delivery_reported", { date, note: (input.note || "").trim() })
    return { seq: res.seq }
  } catch (err) {
    if (err instanceof NoticeRefusal) throw new PoLinkError(err.code === "order_missing" ? "NOT_FOUND" : "ACTION_NOT_ALLOWED", err.code === "order_missing" ? 404 : 409)
    throw err
  }
}

export async function linkPost(db: Firestore, resolved: ResolvedOrder, input: { text?: string | null; file?: { name: string; url: string } | null; kind?: "change" | null; locale?: "ar" | "en" }, now: Date = new Date()) {
  const { po } = resolved
  if (input.file && !fileBelongs(input.file.url, po)) throw new PoLinkError("FILE_NOT_YOURS", 400)
  try {
    return await postMessage(
      db,
      {
        poId: resolved.poId,
        by: "sup",
        author: { id: linkWho(po).uid, name: po.supplierName },
        text: input.text,
        file: input.file ?? null,
        channel: "link",
        kind: input.kind ?? null,
        locale: input.locale,
        authorize: (p) => {
          if (!poLinkActs(p).reply) throw new MessageRefusal("cancelled")
        },
      },
      now
    )
  } catch (err) {
    if (err instanceof MessageRefusal) throw new PoLinkError(err.code === "order_missing" ? "NOT_FOUND" : err.code === "empty" ? "BAD_REQUEST" : "CANCELLED", err.status)
    throw err
  }
}

/** PO-15 on the link: «قبلت الإصدار n» — the supplier's acceptance of a change the buyer made after sending. */
export async function linkAcceptVersion(db: Firestore, resolved: ResolvedOrder, input: { version: number }, now: Date = new Date()): Promise<PoWithChat> {
  const at = now.toISOString()
  const off = await offListOf(db, resolved.po.organizationId)
  const po = await actOn(
    db,
    resolved.poId,
    (p) => {
      if (p.status === "cancelled") return refuse()
      const open = pendingVersion(p)
      if (!open || open.n !== input.version) throw new PoLinkError("VERSION_MISSING", 409)
      const versions = poVersions(p).map((v) => (v.n === open.n ? { ...v, acceptedAt: at, acceptedByName: p.supplierName } : v))
      return { patch: { versions }, log: logOf(p, "version_accepted", at, { params: { ver: open.n, via: "link" } }), events: [["po_accept", poAcceptKey(p.docNumber, open.n), { version: open.n, via: "link" }]] }
    },
    off,
    at
  )
  await tellBuyer(db, po, "po_supplier_accepted", { date: po.promisedDate || "" })
  return po
}

/** The supplier opened the conversation: what the buyer wrote is read. */
export async function linkRead(db: Firestore, resolved: ResolvedOrder): Promise<PoWithChat> {
  return markRead(db, resolved.poId, { kind: "supplier" }, () => undefined)
}


/** The order as it stands now — the answer of an act that wrote beside the order (a notice, a message). */
export async function reloadOrder(db: Firestore, poId: string): Promise<PoWithChat> {
  const snap = await db.collection(PURCHASE_ORDERS).doc(poId).get()
  const data = snap.exists ? snap.data() : undefined
  if (!snap.exists || !data) throw new PoLinkError("NOT_FOUND", 404)
  return asPo(snap.id, data)
}
