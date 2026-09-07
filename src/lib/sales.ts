// Sales (المبيعات) domain — a component of its own, deliberately separate
// from Finance. It reads the CRM's quotations (`crmQuotations`) as the sales
// pipeline: an estimate before manufacturing, a price for a finished item
// after it, the payment schedule written inside the quotation, and the
// customer payments recorded against it. There are no invoices and no ledger
// here by decision — Finance is told through notifications until it exists.

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore"
import {
  CRM_QUOTATIONS,
  INSTALLMENT_FULL_ID,
  installmentAmount,
  quotationInstallments,
  quotationPhase,
  type CrmQuotation,
  type QuotationInstallment,
  type QuotationItem,
  type QuotationPayment,
  type QuotationPaymentEntry,
  type QuotationStatus,
} from "./crm"
import { ALL_PERMISSION, type TeamGroup } from "./permissions"
import { createWorkOrderFromQuotation, effectiveOutput, type WorkOrder } from "./manufacturing"

// ---------------------------------------------------------------------------
// Price list — the org's known items with fixed prices, picked into quotations.
// ---------------------------------------------------------------------------

export const SALES_PRICE_ITEMS = "salesPriceItems"

export interface SalesPriceItem {
  id: string
  organizationId: string
  name: string
  unit: string
  unitPrice: number
  notes?: string | null
  createdAt?: unknown
  updatedAt?: unknown
}

export function priceItemToQuotationLine(item: Pick<SalesPriceItem, "name" | "unit" | "unitPrice">, quantity = 1): QuotationItem {
  return { name: item.name, quantity, unit: item.unit, unitPrice: item.unitPrice }
}

/** Exact, case-insensitive name match against the price list. */
export function findPriceItem<T extends { name: string }>(list: T[], name: string): T | undefined {
  const key = name.trim().toLowerCase()
  if (!key) return undefined
  return list.find((p) => p.name.trim().toLowerCase() === key)
}

// ---------------------------------------------------------------------------
// Tabs, search, totals
// ---------------------------------------------------------------------------

export type SalesTab = "all" | "pre" | "post" | "awaiting" | "paid"
export const SALES_TABS: SalesTab[] = ["all", "pre", "post", "awaiting", "paid"]

export interface InstallmentState extends QuotationInstallment {
  amount: number
  /** Running total paid against it — null until the first payment. */
  payment: QuotationPayment | null
  /** The individual payments, oldest first. */
  entries: QuotationPaymentEntry[]
  paid: number
  remaining: number
  /** Fully covered — an installment settles only when its amount is paid. */
  settled: boolean
}

const MONEY_EPSILON = 0.005
const round2 = (n: number) => Math.round(n * 100) / 100

function paymentEntries(p: QuotationPayment | null): QuotationPaymentEntry[] {
  if (!p) return []
  if (p.entries && p.entries.length > 0) return p.entries
  return [{ paidAt: p.paidAt, paidAmount: p.paidAmount, paidByUserId: p.paidByUserId ?? null, paidByUserName: p.paidByUserName ?? null, note: p.note ?? null }]
}

/**
 * Each installment with its computed amount and whatever was paid against it
 * so far. A partial payment leaves a remainder due; the installment settles
 * only when covered. A quotation marked paid before schedules existed reads
 * as its single installment settled, so old records keep their meaning.
 */
export function installmentStates(q: Pick<CrmQuotation, "amount" | "installments" | "payments" | "paidAt" | "paidAmount" | "paidByUserId" | "paidByUserName" | "paymentNote">): InstallmentState[] {
  const payments = q.payments || {}
  return quotationInstallments(q).map((inst) => {
    const amount = installmentAmount(q, inst)
    let payment = payments[inst.id] ?? null
    if (!payment && inst.id === INSTALLMENT_FULL_ID && q.paidAt) {
      payment = {
        paidAt: q.paidAt,
        paidAmount: q.paidAmount ?? amount,
        paidByUserId: q.paidByUserId ?? null,
        paidByUserName: q.paidByUserName ?? null,
        note: q.paymentNote ?? null,
      }
    }
    const paid = round2(Number(payment?.paidAmount) || 0)
    return {
      ...inst,
      amount,
      payment,
      entries: paymentEntries(payment),
      paid,
      remaining: Math.max(0, round2(amount - paid)),
      settled: paid + MONEY_EPSILON >= amount,
    }
  })
}

export function paidSoFar(q: CrmQuotation): number {
  return round2(installmentStates(q).reduce((sum, s) => sum + s.paid, 0))
}

export function isFullyPaid(q: CrmQuotation): boolean {
  if (q.paidAt) return true
  const states = installmentStates(q)
  return states.length > 0 && states.every((s) => s.settled)
}

/** Back-compat alias — "paid" in the tabs means paid in full. */
export function isQuotationPaid(q: CrmQuotation): boolean {
  return isFullyPaid(q)
}

/** An accepted quotation the customer has not finished paying. */
export function isAwaitingPayment(q: CrmQuotation): boolean {
  return q.status === "accepted" && !isFullyPaid(q)
}

/** The first installment with money still owed on it. */
export function nextUnpaidInstallment(q: CrmQuotation): InstallmentState | null {
  return installmentStates(q).find((s) => !s.settled) ?? null
}

export function quotationMatchesTab(q: CrmQuotation, tab: SalesTab): boolean {
  switch (tab) {
    case "all":
      return true
    case "pre":
      return quotationPhase(q) === "pre_manufacturing"
    case "post":
      return quotationPhase(q) === "post_manufacturing"
    case "awaiting":
      return isAwaitingPayment(q)
    case "paid":
      return isFullyPaid(q)
  }
}

export interface SalesTotals {
  /** Value of quotations out with customers or accepted — the live pipeline. */
  quoted: number
  accepted: number
  awaitingPayment: number
  paid: number
  counts: Record<SalesTab, number>
}

export function salesTotals(quotations: CrmQuotation[]): SalesTotals {
  const totals: SalesTotals = {
    quoted: 0,
    accepted: 0,
    awaitingPayment: 0,
    paid: 0,
    counts: { all: 0, pre: 0, post: 0, awaiting: 0, paid: 0 },
  }
  for (const q of quotations) {
    const amount = Number(q.amount) || 0
    if (q.status === "sent" || q.status === "accepted") totals.quoted += amount
    if (q.status === "accepted") totals.accepted += amount
    const paid = q.status === "accepted" ? paidSoFar(q) : 0
    if (q.status === "accepted") {
      totals.paid += paid
      totals.awaitingPayment += Math.max(0, amount - paid)
    }
    for (const tab of SALES_TABS) if (quotationMatchesTab(q, tab)) totals.counts[tab] += 1
  }
  const round = (n: number) => Math.round(n * 100) / 100
  totals.quoted = round(totals.quoted)
  totals.accepted = round(totals.accepted)
  totals.awaitingPayment = round(totals.awaitingPayment)
  totals.paid = round(totals.paid)
  return totals
}

/** Case-insensitive match on the number, the customer, or the linked order. */
export function quotationMatchesSearch(q: CrmQuotation, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  return (
    q.quotationNumber.toLowerCase().includes(needle) ||
    (q.contactName || "").toLowerCase().includes(needle) ||
    (q.workOrderNumber != null && `#${q.workOrderNumber}`.includes(needle))
  )
}

// ---------------------------------------------------------------------------
// Who in Finance hears about approvals and payments
// ---------------------------------------------------------------------------

/**
 * The org owner and every member whose default group grants
 * `invoices.manage` (the finance people — "Walid wants to know"). The person
 * acting is never told twice.
 */
export function paymentRecipients(input: {
  ownerId: string
  actorId: string
  members: Array<{ id: string; defaultGroupId?: string | null }>
  groups: Array<Pick<TeamGroup, "id" | "permissions">>
}): string[] {
  const financeGroups = new Set(
    input.groups
      .filter((g) => g.permissions.includes(ALL_PERMISSION) || g.permissions.includes("invoices.manage"))
      .map((g) => g.id)
  )
  const out = new Set<string>()
  if (input.ownerId) out.add(input.ownerId)
  for (const m of input.members) {
    if (m.defaultGroupId && financeGroups.has(m.defaultGroupId)) out.add(m.id)
  }
  out.delete(input.actorId)
  return [...out]
}

/** Same rule, resolved from Firestore — for callers (the shared quotation
 * dialog) that don't already hold the team and its groups. */
export async function loadFinanceRecipients(firestore: Firestore, orgId: string, actorId: string): Promise<string[]> {
  const [users, groups] = await Promise.all([
    getDocs(query(collection(firestore, "users"), where("organizationId", "==", orgId))),
    getDocs(query(collection(firestore, "teamGroups"), where("organizationId", "==", orgId))),
  ])
  return paymentRecipients({
    ownerId: orgId,
    actorId,
    members: users.docs.map((d) => ({ id: d.id, defaultGroupId: (d.data().defaultGroupId as string | null) ?? null })),
    groups: groups.docs.map((d) => ({ id: d.id, permissions: (d.data().permissions as TeamGroup["permissions"]) || [] })),
  })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Seed a post-manufacturing quotation from a finished work order: its output
 * becomes the single line (price left for Sales to fill), and the customer is
 * the one the order was made for, when it came from a quotation. */
export function quotationPrefillFromWorkOrder(order: WorkOrder): {
  items: QuotationItem[]
  workOrderId: string
  workOrderNumber: number
  contactId: string | null
  contactName: string | null
} {
  const out = effectiveOutput(order)
  return {
    items: [{ name: out.name, quantity: out.quantity, unit: out.unit, unitPrice: 0 }],
    workOrderId: order.id,
    workOrderNumber: order.orderNumber,
    contactId: order.source?.contactId ?? null,
    contactName: order.source?.contactName ?? null,
  }
}

type NotificationCopy = { title: string; message: string }

function queueNotifications(
  firestore: Firestore,
  batch: ReturnType<typeof writeBatch>,
  recipients: string[],
  payload: Record<string, unknown> & { type: string; organizationId: string; createdAt: string } & NotificationCopy
) {
  for (const uid of recipients) {
    batch.set(doc(collection(firestore, "users", uid, "notifications")), { ...payload, userId: uid, read: false })
  }
}

/**
 * The "reflection" to Finance when a customer approves: no ledger exists yet,
 * so the deposit and schedule reach the finance people as a notification —
 * the placeholder the meeting agreed on until Finance is built.
 */
export async function notifyQuotationApproved(
  firestore: Firestore,
  input: {
    quotation: Pick<CrmQuotation, "id" | "quotationNumber" | "contactName" | "organizationId" | "amount">
    recipients: string[]
    notification: NotificationCopy
  }
): Promise<void> {
  if (input.recipients.length === 0) return
  const batch = writeBatch(firestore)
  queueNotifications(firestore, batch, input.recipients, {
    type: "quotation_approved",
    organizationId: input.quotation.organizationId,
    title: input.notification.title,
    message: input.notification.message,
    quotationId: input.quotation.id,
    quotationNumber: input.quotation.quotationNumber,
    contactName: input.quotation.contactName ?? null,
    amount: input.quotation.amount,
    createdAt: new Date().toISOString(),
  })
  await batch.commit()
}

export interface RecordPaymentInput {
  quotation: CrmQuotation
  installmentId: string
  amount: number
  note: string | null
  actor: { id: string; name: string }
  recipients: string[]
  /** Localised by the caller — the notification page renders it verbatim. */
  notification: NotificationCopy
}

/** Pure half of `recordInstallmentPayment`: the fields the quotation gets.
 * The entry ADDS to what the installment already received; the quotation is
 * paid only when every installment is fully covered. */
export function applyInstallmentPayment(
  quotation: CrmQuotation,
  installmentId: string,
  entry: QuotationPaymentEntry
): { payments: Record<string, QuotationPayment>; paidAmount: number; paidAt: string | null; allPaid: boolean; installmentSettled: boolean } {
  const states = installmentStates(quotation)
  const payments: Record<string, QuotationPayment> = { ...(quotation.payments || {}) }
  // Carry a pre-schedule "paid" mark into the map so it is not lost.
  for (const s of states) if (s.payment && !payments[s.id]) payments[s.id] = s.payment
  const target = states.find((s) => s.id === installmentId) ?? null
  const entries = [...(target?.entries ?? []), entry]
  const paidOnInstallment = round2(entries.reduce((sum, e) => sum + (Number(e.paidAmount) || 0), 0))
  payments[installmentId] = {
    paidAt: entry.paidAt,
    paidAmount: paidOnInstallment,
    paidByUserId: entry.paidByUserId,
    paidByUserName: entry.paidByUserName,
    note: entry.note,
    entries,
  }
  const installmentSettled = !!target && paidOnInstallment + MONEY_EPSILON >= target.amount
  const allPaid = !!target && states.every((s) => (s.id === installmentId ? installmentSettled : s.settled))
  const paidAmount = round2(Object.values(payments).reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0))
  return { payments, paidAmount, paidAt: allPaid ? entry.paidAt : quotation.paidAt ?? null, allPaid, installmentSettled }
}

/**
 * Record a customer payment against one installment and tell Finance, in one
 * batch. The quotation counts as paid only when every installment is.
 */
export async function recordInstallmentPayment(firestore: Firestore, input: RecordPaymentInput): Promise<void> {
  const paidAt = new Date().toISOString()
  const entry: QuotationPaymentEntry = {
    paidAt,
    paidAmount: input.amount,
    paidByUserId: input.actor.id,
    paidByUserName: input.actor.name,
    note: input.note,
  }
  const next = applyInstallmentPayment(input.quotation, input.installmentId, entry)
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, CRM_QUOTATIONS, input.quotation.id), {
    payments: next.payments,
    paidAmount: next.paidAmount,
    paidAt: next.paidAt,
    ...(next.allPaid ? { paidByUserId: input.actor.id, paidByUserName: input.actor.name, paymentNote: input.note } : {}),
    updatedAt: serverTimestamp(),
  })
  queueNotifications(firestore, batch, input.recipients, {
    type: "quotation_paid",
    organizationId: input.quotation.organizationId,
    title: input.notification.title,
    message: input.notification.message,
    quotationId: input.quotation.id,
    quotationNumber: input.quotation.quotationNumber,
    contactName: input.quotation.contactName ?? null,
    installmentId: input.installmentId,
    amount: input.amount,
    fullyPaid: next.allPaid,
    installmentSettled: next.installmentSettled,
    createdAt: paidAt,
  })
  await batch.commit()
}

// ---------------------------------------------------------------------------
// Status workflow, timeline, and the data the Sales pages read
// ---------------------------------------------------------------------------


/** Where a quotation may go next. Accepted is final; a rejected one can be re-sent. */
export const QUOTATION_STATUS_ACTIONS: Record<QuotationStatus, QuotationStatus[]> = {
  draft: ["sent", "accepted", "rejected"],
  sent: ["accepted", "rejected"],
  accepted: [],
  rejected: ["sent"],
}

/** The timestamp a status change writes, so the timeline can tell the story. */
export function statusStamp(from: QuotationStatus | undefined, to: QuotationStatus, now: string): Partial<Record<"sentAt" | "acceptedAt" | "rejectedAt", string>> {
  if (from === to) return {}
  if (to === "sent") return { sentAt: now }
  if (to === "accepted") return { acceptedAt: now }
  if (to === "rejected") return { rejectedAt: now }
  return {}
}

export interface InstallmentDue {
  quotation: CrmQuotation
  installment: InstallmentState
  /** Set on "received" rows: the individual payment this row is. */
  entry?: QuotationPaymentEntry
}

/** Every installment of every accepted quotation, split into what customers
 * still owe (oldest quotation first — partially paid ones included, with
 * their remainder) and each payment that came in (latest first). */
export function collectInstallments(quotations: CrmQuotation[]): { due: InstallmentDue[]; received: InstallmentDue[] } {
  const due: InstallmentDue[] = []
  const received: InstallmentDue[] = []
  for (const quotation of quotations) {
    if (quotation.status !== "accepted") continue
    for (const installment of installmentStates(quotation)) {
      if (!installment.settled) due.push({ quotation, installment })
      for (const entry of installment.entries) received.push({ quotation, installment, entry })
    }
  }
  due.sort((a, b) => (a.quotation.date || "").localeCompare(b.quotation.date || ""))
  received.sort((a, b) => (b.entry?.paidAt || "").localeCompare(a.entry?.paidAt || ""))
  return { due, received }
}

export interface SalesDashboardData {
  totals: SalesTotals
  statusCounts: Record<QuotationStatus, number>
  recent: CrmQuotation[]
  due: InstallmentDue[]
  dueCount: number
}

export function salesDashboard(quotations: CrmQuotation[], limit = 5): SalesDashboardData {
  const statusCounts: Record<QuotationStatus, number> = { draft: 0, sent: 0, accepted: 0, rejected: 0 }
  for (const q of quotations) statusCounts[q.status] += 1
  const { due } = collectInstallments(quotations)
  return {
    totals: salesTotals(quotations),
    statusCounts,
    recent: [...quotations].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, limit),
    due: [...due].sort((a, b) => b.installment.remaining - a.installment.remaining).slice(0, limit),
    dueCount: due.length,
  }
}

export interface TimelineEntry {
  at: string
  kind: "created" | "sent" | "accepted" | "rejected" | "payment" | "work_order"
  /** Installment label for payments. */
  label?: string
  amount?: number
  number?: number
}

function isoOf(value: unknown): string | null {
  if (!value) return null
  if (typeof value === "string") return value
  if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return null
}

/** The quotation's story in order: created, sent, accepted/rejected, work
 * order opened, each payment. Only what was actually recorded appears. */
export function quotationTimeline(q: CrmQuotation): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  const created = isoOf(q.createdAt) || q.date
  if (created) entries.push({ at: created, kind: "created" })
  if (q.sentAt) entries.push({ at: q.sentAt, kind: "sent" })
  if (q.acceptedAt) entries.push({ at: q.acceptedAt, kind: "accepted" })
  if (q.rejectedAt) entries.push({ at: q.rejectedAt, kind: "rejected" })
  if (q.workOrderNumber != null && q.workOrderId && quotationPhase(q) === "pre_manufacturing") {
    entries.push({ at: q.acceptedAt || q.sentAt || created || "", kind: "work_order", number: q.workOrderNumber })
  }
  for (const s of installmentStates(q)) {
    for (const e of s.entries) entries.push({ at: e.paidAt, kind: "payment", label: s.label, amount: e.paidAmount })
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at))
}

export interface AcceptanceInput {
  orgId: string
  user: { id: string; name: string }
  quotation: {
    id: string
    quotationNumber: string
    contactId: string
    contactName: string | null
    opportunityId?: string | null
    amount: number
    items: QuotationItem[] | null
    installments: QuotationInstallment[] | null
    phase: "pre_manufacturing" | "post_manufacturing"
    /** A linked order (spawned earlier, or the finished one being sold) means no new one. */
    workOrderId: string | null
  }
  /** Localised by the caller. `message` receives the first installment so it can name the deposit. */
  notification: { title: string; message: (deposit: InstallmentState | null) => string }
}

/**
 * Everything that happens when the customer approves, shared by the dialog
 * and the detail page: Finance hears about the deposit (best-effort — a
 * failed notification never blocks the sale) and, for a pre-manufacturing
 * quotation without a linked order, the goods not in stock become a work
 * order. Errors from the work order propagate so the caller can say so.
 */
export async function runQuotationAcceptance(
  firestore: Firestore,
  input: AcceptanceInput
): Promise<{ notified: number; notifyFailed: boolean; workOrderId: string | null }> {
  let notified = 0
  let notifyFailed = false
  try {
    const recipients = await loadFinanceRecipients(firestore, input.orgId, input.user.id)
    const first = installmentStates({ amount: input.quotation.amount, installments: input.quotation.installments, payments: null })[0] ?? null
    await notifyQuotationApproved(firestore, {
      quotation: { id: input.quotation.id, quotationNumber: input.quotation.quotationNumber, contactName: input.quotation.contactName, organizationId: input.orgId, amount: input.quotation.amount },
      recipients,
      notification: { title: input.notification.title, message: input.notification.message(first) },
    })
    notified = recipients.length
  } catch (err) {
    console.error("Finance approval notification failed:", err)
    notifyFailed = true
  }

  let workOrderId: string | null = null
  if (input.quotation.phase !== "post_manufacturing" && !input.quotation.workOrderId) {
    workOrderId = await createWorkOrderFromQuotation(firestore, {
      organizationId: input.orgId,
      quotationId: input.quotation.id,
      quotationNumber: input.quotation.quotationNumber,
      amount: input.quotation.amount,
      contactId: input.quotation.contactId,
      contactName: input.quotation.contactName,
      opportunityId: input.quotation.opportunityId ?? null,
      items: input.quotation.items ? input.quotation.items.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit })) : undefined,
      userId: input.user.id,
      userName: input.user.name,
    })
  }
  return { notified, notifyFailed, workOrderId }
}
