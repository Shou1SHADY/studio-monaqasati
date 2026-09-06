// Sales (المبيعات) domain — a component of its own, deliberately separate
// from Finance. It reads the CRM's quotations (`crmQuotations`) as the sales
// pipeline: an estimate before manufacturing, a price for a finished item
// after it, and the customer payment recorded against either. Invoices and
// finance postings are out of scope here by decision.

import { collection, doc, writeBatch, serverTimestamp, type Firestore } from "firebase/firestore"
import { CRM_QUOTATIONS, type CrmQuotation, type QuotationItem, quotationPhase } from "./crm"
import { ALL_PERMISSION, type TeamGroup } from "./permissions"
import { effectiveOutput, type WorkOrder } from "./manufacturing"

export type SalesTab = "all" | "pre" | "post" | "awaiting" | "paid"
export const SALES_TABS: SalesTab[] = ["all", "pre", "post", "awaiting", "paid"]

export function isQuotationPaid(q: Pick<CrmQuotation, "paidAt">): boolean {
  return !!q.paidAt
}

/** An accepted quotation the customer has not paid yet. */
export function isAwaitingPayment(q: Pick<CrmQuotation, "status" | "paidAt">): boolean {
  return q.status === "accepted" && !q.paidAt
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
      return isQuotationPaid(q)
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
    if (isAwaitingPayment(q)) totals.awaitingPayment += amount
    if (isQuotationPaid(q)) totals.paid += q.paidAmount != null ? Number(q.paidAmount) || 0 : amount
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

/**
 * Who hears that a customer paid: the org owner and every member whose
 * default group grants `invoices.manage` (the finance people — "Walid wants
 * to know"). The person recording the payment is never told twice.
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

export interface MarkPaidInput {
  quotation: Pick<CrmQuotation, "id" | "quotationNumber" | "contactName" | "organizationId">
  amount: number
  note: string | null
  actor: { id: string; name: string }
  recipients: string[]
  /** Localised by the caller — the notification page renders it verbatim. */
  notification: { title: string; message: string }
}

/**
 * Record a customer payment and tell finance, in one batch: the quotation is
 * stamped and every recipient gets an in-app notification. No invoice, no
 * ledger entry — those live elsewhere by decision.
 */
export async function markQuotationPaid(firestore: Firestore, input: MarkPaidInput): Promise<void> {
  const paidAt = new Date().toISOString()
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, CRM_QUOTATIONS, input.quotation.id), {
    paidAt,
    paidAmount: input.amount,
    paidByUserId: input.actor.id,
    paidByUserName: input.actor.name,
    paymentNote: input.note,
    updatedAt: serverTimestamp(),
  })
  for (const uid of input.recipients) {
    batch.set(doc(collection(firestore, "users", uid, "notifications")), {
      userId: uid,
      organizationId: input.quotation.organizationId,
      type: "quotation_paid",
      title: input.notification.title,
      message: input.notification.message,
      quotationId: input.quotation.id,
      quotationNumber: input.quotation.quotationNumber,
      contactName: input.quotation.contactName ?? null,
      amount: input.amount,
      createdAt: paidAt,
      read: false,
    })
  }
  await batch.commit()
}
