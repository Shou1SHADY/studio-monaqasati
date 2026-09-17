// The quotation's lifecycle (Sales PRD §5 T2–T9, D6, QC-09…QC-16, INV-04/06).
//
//   draft ──Issue──▶ issued ──Log as sent──▶ sent ──▶ accepted (won, an order is born)
//                                             │   └─▶ rejected (lost, with a written reason)
//                                             └─ validity passes ─▶ expired (derived)
//   issued | sent | expired ──New revision──▶ a NEW draft "…-2"; the old one is superseded
//
// Issuing locks the figures; sending locks the whole document and starts the
// validity clock from the SEND date, not the draft date. A sent document never
// changes — a change is a revision carrying the base number and a suffix, and
// the original stays on record. "Expired" and "superseded" are never typed:
// they are read off `validUntil` and `supersededById`.
//
// Every blocking rule lives here so the composer can show it as you type and
// the write can refuse it again — the same function, not two copies.

import { addDoc, collection, doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import {
  CRM_ACTIVITIES,
  CRM_QUOTATIONS,
  advanceInstallment,
  validateInstallments,
  type CrmQuotation,
  type QuotationInstallment,
  type QuotationItem,
} from "./crm"
import { SALES_QUOTE_REQUESTS, quotationPriceIssues } from "./sales-transfers"
import { baseDocNumber, drawSalesDocNumber, revisionDocNumber, revisionOfNumber } from "./sales-numbering"

export interface Actor {
  id: string
  name: string
}

const nowIso = () => new Date().toISOString()
const dayOf = (iso: string) => iso.slice(0, 10)
const keyOf = (name: string) => name.trim().toLowerCase()

/** Validity counts from the day the quote was logged as sent (QC-09). */
export const DEFAULT_VALIDITY_DAYS = 14
export const VALIDITY_CHOICES = [7, 14, 30] as const
/** "Extend 14 days" on a quote the client accepted late. */
export const EXTENSION_DAYS = 14

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${dayOf(isoDate)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function validUntilFrom(sentAt: string, validityDays: number | null | undefined): string {
  const days = Number(validityDays)
  return addDays(sentAt, Number.isFinite(days) && days > 0 ? Math.round(days) : DEFAULT_VALIDITY_DAYS)
}

// ---------------------------------------------------------------------------
// The state — computed, never typed (INV-04)
// ---------------------------------------------------------------------------

export type QuoteLifecycle = "draft" | "issued" | "sent" | "expired" | "won" | "lost" | "superseded"
export const QUOTE_LIFECYCLES: QuoteLifecycle[] = ["draft", "issued", "sent", "expired", "won", "lost", "superseded"]

type LifecycleFields = Pick<CrmQuotation, "status" | "validUntil" | "supersededById">

export function quoteLifecycle(q: LifecycleFields, today: string): QuoteLifecycle {
  if (q.supersededById) return "superseded"
  if (q.status === "accepted") return "won"
  if (q.status === "rejected") return "lost"
  if (q.status === "issued") return "issued"
  if (q.status === "sent") return q.validUntil && dayOf(q.validUntil) < today ? "expired" : "sent"
  return "draft"
}

/** Sent and still valid — the only quote that may become an order (SO-01). */
export const isLiveQuote = (q: LifecycleFields, today: string): boolean => quoteLifecycle(q, today) === "sent"

/** Whole days until validity ends; negative once it has passed; null when not running. */
export function daysToExpiry(q: LifecycleFields, today: string): number | null {
  if (q.status !== "sent" || q.supersededById || !q.validUntil) return null
  return Math.round((Date.parse(`${dayOf(q.validUntil)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
}

/** What may still be edited: everything in a draft; once issued, the texts
 * only; once sent, nothing (D6). */
export function quoteEditable(q: LifecycleFields, today: string): "all" | "texts" | "none" {
  const s = quoteLifecycle(q, today)
  return s === "draft" ? "all" : s === "issued" ? "texts" : "none"
}

export type QuoteAction = "issue" | "log_sent" | "convert" | "close_lost" | "revise" | "extend"

/** What this quote allows right now — one list for the detail page, the list
 * rows and Today's decisions. */
export function quoteActions(q: LifecycleFields, today: string): QuoteAction[] {
  switch (quoteLifecycle(q, today)) {
    case "draft":
      return ["issue"]
    case "issued":
      return ["log_sent", "revise"]
    case "sent":
      return ["convert", "close_lost", "revise"]
    case "expired":
      return ["extend", "revise", "close_lost"]
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// What blocks Issue (T4) — and conversion re-checks the same (T9, SO-04)
// ---------------------------------------------------------------------------

export type IssueBlock =
  | { kind: "client_required" }
  | { kind: "lines_required" }
  | { kind: "schedule_not_100" }
  | { kind: "schedule_invalid" }
  | { kind: "validity_required" }
  /** Never carries the cost — not every seller may see it (QC-06, INV-08). */
  | { kind: "below_cost"; name: string }
  | { kind: "over_cap"; name: string; discountPercent: number; capPercent: number }
  /** Made-to-order lines with no before-production instalment (QC-13, D8). */
  | { kind: "advance_required"; names: string[] }

export interface IssueContext {
  /** The price list: list price and standard cost by item name. */
  priceItems: Array<{ name: string; unitPrice: number; cost?: number | null }>
  /** The role's discount ceiling — null for the owner. */
  capPercent: number | null
  /** Names that are MADE (they have a workshop product card). */
  manufacturedNames: Iterable<string>
  /** What the stores hold, by item name (any casing). */
  stockByName: Map<string, number> | Record<string, number>
}

const stockOf = (stock: IssueContext["stockByName"], name: string): number => {
  if (stock instanceof Map) {
    for (const [k, v] of stock) if (keyOf(k) === keyOf(name)) return Number(v) || 0
    return 0
  }
  for (const [k, v] of Object.entries(stock)) if (keyOf(k) === keyOf(name)) return Number(v) || 0
  return 0
}

/** Made-to-order lines: manufactured, and asking for more than stock covers. */
export function madeToOrderLines(items: QuotationItem[], ctx: Pick<IssueContext, "manufacturedNames" | "stockByName">): string[] {
  const made = new Set(Array.from(ctx.manufacturedNames, keyOf))
  return items.filter((i) => made.has(keyOf(i.name)) && i.quantity > stockOf(ctx.stockByName, i.name) + 0.005).map((i) => i.name)
}

export function issueBlocks(
  q: Pick<CrmQuotation, "contactId" | "items" | "installments" | "validityDays">,
  ctx: IssueContext
): IssueBlock[] {
  const blocks: IssueBlock[] = []
  const items = (q.items || []).filter((i) => i.name.trim() && i.quantity > 0)
  if (!q.contactId) blocks.push({ kind: "client_required" })
  if (!items.length) blocks.push({ kind: "lines_required" })

  const schedule = q.installments || []
  const scheduleError = validateInstallments(schedule)
  if (scheduleError === "not_100") blocks.push({ kind: "schedule_not_100" })
  else if (scheduleError) blocks.push({ kind: "schedule_invalid" })

  if (!(Number(q.validityDays) > 0)) blocks.push({ kind: "validity_required" })

  for (const issue of quotationPriceIssues(items, ctx.priceItems, ctx.capPercent)) {
    if (issue.kind === "below_cost") blocks.push({ kind: "below_cost", name: issue.name })
    else blocks.push({ kind: "over_cap", name: issue.name, discountPercent: issue.discountPercent ?? 0, capPercent: ctx.capPercent ?? 0 })
  }

  const made = madeToOrderLines(items, ctx)
  if (made.length && !advanceInstallment(schedule)) blocks.push({ kind: "advance_required", names: made })
  return blocks
}

/** The one button behind "advance_required": split 100% into 30% + the rest,
 * or flag the first instalment of an existing schedule (QC-13). */
export function withAdvance(schedule: QuotationInstallment[], labels: { advance: string; balance: string }, newId: () => string): QuotationInstallment[] {
  if (advanceInstallment(schedule)) return schedule
  if (schedule.length <= 1) {
    return [
      { id: newId(), label: labels.advance, percent: 30, beforeProduction: true },
      { id: schedule[0]?.id || newId(), label: schedule[0]?.label || labels.balance, percent: 70, beforeProduction: false },
    ]
  }
  return schedule.map((inst, i) => (i === 0 ? { ...inst, beforeProduction: true } : inst))
}

export type ConvertBlock = "not_sent" | "expired" | "superseded" | "client_required" | "advance_required"

/** An order is born only from a quote logged as sent and still valid; a free
 * name does not convert; availability is re-checked (SO-01, SO-03, SO-04). */
export function convertBlocks(q: CrmQuotation, today: string, ctx: Pick<IssueContext, "manufacturedNames" | "stockByName">): ConvertBlock[] {
  const blocks: ConvertBlock[] = []
  const state = quoteLifecycle(q, today)
  if (state === "superseded") blocks.push("superseded")
  else if (state === "expired") blocks.push("expired")
  else if (state !== "sent") blocks.push("not_sent")
  if (!q.contactId) blocks.push("client_required")
  if (madeToOrderLines(q.items || [], ctx).length && !advanceInstallment(q.installments)) blocks.push("advance_required")
  return blocks
}

// ---------------------------------------------------------------------------
// What CRM hears (INT-01): a done activity on the client's file
// ---------------------------------------------------------------------------

/** CRM owns the opportunity — closing one is `crm.close`'s, in CRM. Sales feeds
 * the client's file with what happened and never writes the deal itself. */
export async function logQuoteEventInCrm(
  firestore: Firestore,
  input: { quotation: Pick<CrmQuotation, "organizationId" | "contactId" | "contactName" | "opportunityId">; title: string; notes?: string | null; actor: Actor }
): Promise<void> {
  if (!input.quotation.contactId) return
  try {
    await addDoc(collection(firestore, CRM_ACTIVITIES), {
      type: "task",
      title: input.title,
      contactId: input.quotation.contactId,
      contactName: input.quotation.contactName ?? null,
      opportunityId: input.quotation.opportunityId ?? null,
      opportunityTitle: null,
      dueDate: dayOf(nowIso()),
      done: true,
      notes: input.notes ?? null,
      ownerId: input.actor.id,
      ownerName: input.actor.name,
      source: "sales",
      organizationId: input.quotation.organizationId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  } catch (err) {
    // The log never undoes the decision it reports.
    console.warn("CRM activity not written:", (err as { code?: string })?.code || err)
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function mutateQuote(firestore: Firestore, id: string, fn: (fresh: CrmQuotation) => Record<string, unknown>): Promise<CrmQuotation> {
  const ref = doc(firestore, CRM_QUOTATIONS, id)
  return runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error("quote_missing")
    const fresh = { ...(snap.data() as CrmQuotation), id: snap.id }
    const update = fn(fresh)
    tx.update(ref, { ...update, updatedAt: serverTimestamp() })
    return { ...fresh, ...update } as CrmQuotation
  })
}

/** T4 — draft → issued. Figures lock; the request it answers is marked quoted. */
export async function issueQuotation(firestore: Firestore, input: { quotationId: string; context: IssueContext; actor: Actor }): Promise<CrmQuotation> {
  const issued = await mutateQuote(firestore, input.quotationId, (fresh) => {
    if (fresh.status !== "draft" || fresh.supersededById) throw new Error("not_draft")
    const blocks = issueBlocks(fresh, input.context)
    if (blocks.length) throw new Error(`blocked:${blocks[0].kind}`)
    return { status: "issued", issuedAt: nowIso(), issuedByUserName: input.actor.name }
  })
  if (issued.requestId) {
    try {
      await runTransaction(firestore, async (tx) => {
        const ref = doc(firestore, SALES_QUOTE_REQUESTS, issued.requestId as string)
        const snap = await tx.get(ref)
        if (!snap.exists() || snap.data().status !== "new") return
        tx.update(ref, { status: "quoted", quotationId: issued.id, quotationNumber: issued.quotationNumber, decidedAt: nowIso(), decidedByUserId: input.actor.id, decidedByUserName: input.actor.name, updatedAt: serverTimestamp() })
      })
    } catch (err) {
      console.warn("quote request not stamped:", (err as { code?: string })?.code || err)
    }
  }
  return issued
}

/** T5 — issued → sent. The whole document locks and validity starts TODAY. */
export async function logQuotationSent(firestore: Firestore, input: { quotationId: string; actor: Actor }): Promise<CrmQuotation> {
  return mutateQuote(firestore, input.quotationId, (fresh) => {
    if (fresh.status !== "issued" || fresh.supersededById) throw new Error("not_issued")
    const sentAt = nowIso()
    const validityDays = Number(fresh.validityDays) > 0 ? Number(fresh.validityDays) : DEFAULT_VALIDITY_DAYS
    return { status: "sent", sentAt, sentByUserName: input.actor.name, validityDays, validUntil: validUntilFrom(sentAt, validityDays) }
  })
}

/** T8 — sent | expired → lost, with a written reason. */
export async function closeQuotationLost(firestore: Firestore, input: { quotationId: string; reason: string; actor: Actor }): Promise<CrmQuotation> {
  if (!input.reason.trim()) throw new Error("reason_required")
  return mutateQuote(firestore, input.quotationId, (fresh) => {
    if (fresh.status !== "sent" || fresh.supersededById) throw new Error("not_sent")
    return { status: "rejected", rejectedAt: nowIso(), lostReason: input.reason.trim(), lostByUserName: input.actor.name }
  })
}

/** An expired quote the client accepted late: the same prices, 14 more days. */
export async function extendQuotation(firestore: Firestore, input: { quotationId: string; today: string; actor: Actor }): Promise<CrmQuotation> {
  return mutateQuote(firestore, input.quotationId, (fresh) => {
    if (quoteLifecycle(fresh, input.today) !== "expired") throw new Error("not_expired")
    return { validUntil: addDays(input.today, EXTENSION_DAYS), extendedAt: nowIso(), extendedByUserName: input.actor.name }
  })
}

/**
 * T6 — a new revision. The old quote is superseded and stays on record; the new
 * one is a DRAFT with the base number and the next suffix, carrying the lines,
 * schedule and texts, and the request link moves to it. Returns the new id.
 */
export async function reviseQuotation(firestore: Firestore, input: { quotationId: string; today: string; actor: Actor }): Promise<string> {
  const oldRef = doc(firestore, CRM_QUOTATIONS, input.quotationId)
  const newRef = doc(collection(firestore, CRM_QUOTATIONS))
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(oldRef)
    if (!snap.exists()) throw new Error("quote_missing")
    const old = { ...(snap.data() as CrmQuotation), id: snap.id }
    const state = quoteLifecycle(old, input.today)
    if (state !== "issued" && state !== "sent" && state !== "expired") throw new Error("cannot_revise")
    const revision = Math.max(Number(old.revision) || 0, revisionOfNumber(old.quotationNumber)) + 1
    const at = nowIso()
    tx.set(newRef, {
      organizationId: old.organizationId,
      contactId: old.contactId,
      contactName: old.contactName ?? null,
      opportunityId: old.opportunityId ?? null,
      requestId: old.requestId ?? null,
      quotationNumber: revisionDocNumber(baseDocNumber(old.quotationNumber), revision),
      revision,
      revisionOf: old.revisionOf || old.id,
      amount: old.amount,
      items: old.items ?? null,
      installments: old.installments ?? null,
      phase: old.phase ?? null,
      date: dayOf(at),
      validityDays: old.validityDays ?? DEFAULT_VALIDITY_DAYS,
      validUntil: null,
      notes: old.notes ?? null,
      terms: old.terms ?? null,
      leadTime: old.leadTime ?? null,
      vatPercent: old.vatPercent ?? null,
      branding: old.branding ?? null,
      status: "draft",
      workOrderId: null,
      workOrderNumber: null,
      createdByUserId: input.actor.id,
      createdByUserName: input.actor.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    tx.update(oldRef, { supersededById: newRef.id, supersededAt: at, updatedAt: serverTimestamp() })
  })
  return newRef.id
}

/** A NEW quotation: the number is drawn in the same transaction that writes
 * it, so a composer closed without saving consumes none (QC-15). */
export async function createQuotation(firestore: Firestore, input: { organizationId: string; data: Record<string, unknown>; actor: Actor }): Promise<{ id: string; quotationNumber: string }> {
  const ref = doc(collection(firestore, CRM_QUOTATIONS))
  const quotationNumber = await runTransaction(firestore, async (tx) => {
    const number = await drawSalesDocNumber(firestore, tx, input.organizationId, "QT")
    tx.set(ref, {
      ...input.data,
      organizationId: input.organizationId,
      quotationNumber: number,
      revision: 1,
      createdByUserId: input.actor.id,
      createdByUserName: input.actor.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return number
  })
  return { id: ref.id, quotationNumber }
}

// ---------------------------------------------------------------------------
// Scope — a rep sees only their own clients (D10, RQ-05)
// ---------------------------------------------------------------------------

export interface SalesViewer {
  userId: string
  /** The owner and the sales manager see every client. */
  seesAll: boolean
}

/** Is a record of this client the viewer's to see? By the client's
 * relationship owner in CRM; a client nobody owns yet is everybody's, and what
 * a rep wrote himself is always his. */
export function inSalesScope(viewer: SalesViewer, record: { contactOwnerId?: string | null; createdByUserId?: string | null }): boolean {
  if (viewer.seesAll) return true
  if (record.createdByUserId && record.createdByUserId === viewer.userId) return true
  return !record.contactOwnerId || record.contactOwnerId === viewer.userId
}
