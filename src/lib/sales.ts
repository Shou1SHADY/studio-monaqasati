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
} from "./crm"
import { ALL_PERMISSION, type TeamGroup } from "./permissions"
import { effectiveOutput, type WorkOrder } from "./manufacturing"

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
  payment: QuotationPayment | null
}

/**
 * Each installment with its computed amount and whatever was paid against it.
 * A quotation marked paid before schedules existed reads as its single
 * installment paid, so old records keep their meaning.
 */
export function installmentStates(q: Pick<CrmQuotation, "amount" | "installments" | "payments" | "paidAt" | "paidAmount" | "paidByUserId" | "paidByUserName" | "paymentNote">): InstallmentState[] {
  const payments = q.payments || {}
  return quotationInstallments(q).map((inst) => {
    let payment = payments[inst.id] ?? null
    if (!payment && inst.id === INSTALLMENT_FULL_ID && q.paidAt) {
      payment = {
        paidAt: q.paidAt,
        paidAmount: q.paidAmount ?? (Number(q.amount) || 0),
        paidByUserId: q.paidByUserId ?? null,
        paidByUserName: q.paidByUserName ?? null,
        note: q.paymentNote ?? null,
      }
    }
    return { ...inst, amount: installmentAmount(q, inst), payment }
  })
}

export function paidSoFar(q: CrmQuotation): number {
  const total = installmentStates(q).reduce((sum, s) => sum + (s.payment ? (s.payment.paidAmount ?? s.amount) : 0), 0)
  return Math.round(total * 100) / 100
}

export function isFullyPaid(q: CrmQuotation): boolean {
  if (q.paidAt) return true
  const states = installmentStates(q)
  return states.length > 0 && states.every((s) => !!s.payment)
}

/** Back-compat alias — "paid" in the tabs means paid in full. */
export function isQuotationPaid(q: CrmQuotation): boolean {
  return isFullyPaid(q)
}

/** An accepted quotation the customer has not finished paying. */
export function isAwaitingPayment(q: CrmQuotation): boolean {
  return q.status === "accepted" && !isFullyPaid(q)
}

export function nextUnpaidInstallment(q: CrmQuotation): InstallmentState | null {
  return installmentStates(q).find((s) => !s.payment) ?? null
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

/** Pure half of `recordInstallmentPayment`: the fields the quotation gets. */
export function applyInstallmentPayment(
  quotation: CrmQuotation,
  installmentId: string,
  payment: QuotationPayment
): { payments: Record<string, QuotationPayment>; paidAmount: number; paidAt: string | null; allPaid: boolean } {
  const states = installmentStates(quotation)
  const payments: Record<string, QuotationPayment> = { ...(quotation.payments || {}) }
  // Carry a pre-schedule "paid" mark into the map so it is not lost.
  for (const s of states) if (s.payment && !payments[s.id]) payments[s.id] = s.payment
  payments[installmentId] = payment
  const known = states.some((s) => s.id === installmentId)
  const allPaid = known && states.every((s) => !!payments[s.id])
  const paidAmount = Math.round(Object.values(payments).reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0) * 100) / 100
  return { payments, paidAmount, paidAt: allPaid ? payment.paidAt : quotation.paidAt ?? null, allPaid }
}

/**
 * Record a customer payment against one installment and tell Finance, in one
 * batch. The quotation counts as paid only when every installment is.
 */
export async function recordInstallmentPayment(firestore: Firestore, input: RecordPaymentInput): Promise<void> {
  const paidAt = new Date().toISOString()
  const payment: QuotationPayment = {
    paidAt,
    paidAmount: input.amount,
    paidByUserId: input.actor.id,
    paidByUserName: input.actor.name,
    note: input.note,
  }
  const next = applyInstallmentPayment(input.quotation, input.installmentId, payment)
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
    createdAt: paidAt,
  })
  await batch.commit()
}
