// Transfer notices (إشعار الحوالة) and quote requests (طلب تقديم العرض) —
// the two doors of the Sales module's boundary.
//
// The seller never invoices and never collects: when a client says they paid,
// the seller files a TRANSFER NOTICE and only Finance verifies the deposit and
// answers "confirmed" or "not found". A confirmed before-production advance is
// what releases an order gated on its deposit — the same rule Manufacturing
// enforces. The instalment's state is DERIVED: settled money comes from the
// quotation's payment records, everything in between from the notices.
//
// Quote requests arrive from CRM only — Sales prices them or returns them
// with one of five factual reasons; it never registers a client of its own.

import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore"
import {
  CRM_QUOTATIONS,
  INSTALLMENT_DEPOSIT_ID,
  type CrmQuotation,
} from "./crm"
import { applyInstallmentPayment, type InstallmentState } from "./sales"
import { SALES_ORDERS, type SalesOrder } from "./sales-orders"
import { ALL_PERMISSION, type PermissionId, type TeamGroup } from "./permissions"
import { onQuotationPaymentRecorded } from "./accounting/hooks"

export const SALES_TRANSFER_NOTICES = "salesTransferNotices"
export const SALES_QUOTE_REQUESTS = "salesQuoteRequests"

const nowIso = () => new Date().toISOString()
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
function randomSuffix(): string {
  let s = ""
  for (let i = 0; i < 6; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)]
  return s
}
export const generateTransferNoticeNumber = (): string => `TN-${randomSuffix()}`
export const generateQuoteRequestNumber = (): string => `RQ-${randomSuffix()}`

export interface Actor {
  id: string
  name: string
}

// ---------------------------------------------------------------------------
// Transfer notices
// ---------------------------------------------------------------------------

export type TransferNoticeStatus = "reported" | "confirmed" | "not_found"

export interface TransferNotice {
  id: string
  organizationId: string
  noticeNumber: string
  quotationId: string
  quotationNumber: string
  /** The sales order the quotation became, when one exists — the release target. */
  orderId?: string | null
  orderNumber?: number | null
  installmentId: string
  installmentLabel: string
  contactId: string | null
  contactName?: string | null
  /** What the client SAID they transferred — Finance matches what arrived. */
  amountStated: number
  /** ISO date of the transfer as the client stated it. Never in the future. */
  transferDate: string
  bankRef?: string | null
  note?: string | null
  status: TransferNoticeStatus
  /** Finance's message back — the "we found 12,000 not 13,082" text. */
  financeMessage?: string | null
  answeredAt?: string | null
  answeredByUserId?: string | null
  answeredByUserName?: string | null
  reportedAt: string
  createdByUserId: string
  createdByUserName: string
  createdAt?: unknown
  updatedAt?: unknown
}

export type TransferReportError = "bad_amount" | "future_date"

/** The two facts the dialog must not accept wrong: a positive amount and a
 * transfer date that is not in the future (PRD PAY-02, blocking). */
export function validateTransferReport(input: { amount: number; transferDate: string; today: string }): TransferReportError | null {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return "bad_amount"
  if (!input.transferDate || input.transferDate > input.today) return "future_date"
  return null
}

export type InstallmentNoticeState = "not_reported" | "awaiting_finance" | "confirmed" | "not_found"

/**
 * One instalment's state on the notice ladder. Settled money on the quotation
 * is the ground truth for "confirmed" (Finance may also have recorded the
 * payment directly); otherwise the NEWEST notice for the instalment speaks.
 */
export function installmentNoticeState(
  installment: Pick<InstallmentState, "id" | "settled">,
  notices: TransferNotice[]
): InstallmentNoticeState {
  if (installment.settled) return "confirmed"
  const mine = notices
    .filter((n) => n.installmentId === installment.id)
    .sort((a, b) => (b.reportedAt || "").localeCompare(a.reportedAt || ""))
  const latest = mine[0]
  if (!latest) return "not_reported"
  if (latest.status === "reported") return "awaiting_finance"
  if (latest.status === "not_found") return "not_found"
  return "confirmed"
}

/**
 * Which instalment may be reported next (PRD PAY-05): only the FIRST unsettled
 * one that is not already sitting with Finance — plus any "not found", which
 * always accepts a fresh report. Everything later carries no button.
 */
export function reportableInstallments(
  installments: InstallmentState[],
  notices: TransferNotice[]
): InstallmentState[] {
  const out: InstallmentState[] = []
  let nextTaken = false
  for (const inst of installments) {
    if (inst.settled) continue
    const state = installmentNoticeState(inst, notices)
    if (state === "not_found") {
      out.push(inst)
      nextTaken = true
    } else if (state === "not_reported" && !nextTaken) {
      out.push(inst)
      nextTaken = true
    } else if (state === "awaiting_finance") {
      nextTaken = true
    }
  }
  return out
}

/** A confirmed advance releases the order only when the order is actually
 * gated on its deposit and this notice is the deposit instalment. */
export function shouldReleaseOrder(
  order: Pick<SalesOrder, "status" | "payment"> | null | undefined,
  installmentId: string
): boolean {
  if (!order) return false
  if (order.status !== "awaiting_deposit") return false
  if (order.payment.kind !== "deposit") return false
  return installmentId === INSTALLMENT_DEPOSIT_ID
}

// ---------------------------------------------------------------------------
// Discount policy (PRD D10 / QC-05 / QC-06) — caps by role, below cost never
// ---------------------------------------------------------------------------

/** SAR discount ceiling for the current user: owner unlimited (null), an
 * approver 8%, everyone else who can quote 3%. */
export function discountCapPercent(input: { isOwner: boolean; canApprove: boolean }): number | null {
  if (input.isOwner) return null
  return input.canApprove ? 8 : 3
}

export type PriceIssueKind = "below_cost" | "over_cap"

export interface PriceIssue {
  name: string
  kind: PriceIssueKind
  /** The discount off the list price, when the issue is the cap. */
  discountPercent?: number
}

const keyOf = (name: string) => name.trim().toLowerCase()
const EPS = 0.005

/**
 * Check quoted lines against the price list: selling below standard cost is
 * blocked for EVERYONE; a discount off the list price beyond the role's cap is
 * blocked for capped roles. Lines with no matching list item pass — a free
 * line is a service with no cost and no list price. The below-cost message
 * must never reveal the cost to a role without cost access; that is the UI's
 * contract, this only names the line.
 */
export function quotationPriceIssues(
  items: Array<{ name: string; unitPrice: number }>,
  priceItems: Array<{ name: string; unitPrice: number; cost?: number | null }>,
  capPercent: number | null
): PriceIssue[] {
  const byName = new Map(priceItems.map((p) => [keyOf(p.name), p]))
  const issues: PriceIssue[] = []
  for (const item of items) {
    const listed = byName.get(keyOf(item.name))
    if (!listed) continue
    if (listed.cost != null && item.unitPrice < listed.cost - EPS) {
      issues.push({ name: item.name, kind: "below_cost" })
      continue
    }
    if (capPercent != null && listed.unitPrice > 0 && item.unitPrice < listed.unitPrice - EPS) {
      const discount = ((listed.unitPrice - item.unitPrice) / listed.unitPrice) * 100
      if (discount > capPercent + EPS) {
        issues.push({ name: item.name, kind: "over_cap", discountPercent: Math.round(discount * 10) / 10 })
      }
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
// Quote requests — CRM asks, Sales prices or declines with a reason
// ---------------------------------------------------------------------------

export type QuoteRequestStatus = "new" | "quoted" | "declined"

export const QUOTE_DECLINE_REASONS = ["not_in_line", "capacity", "spec", "bought_in", "closed_in_crm"] as const
export type QuoteDeclineReason = (typeof QUOTE_DECLINE_REASONS)[number]

export interface QuoteRequestLine {
  name: string
  unit: string
  quantity: number
}

export interface QuoteRequest {
  id: string
  organizationId: string
  requestNumber: string
  contactId: string
  contactName?: string | null
  opportunityId?: string | null
  opportunityTitle?: string | null
  lines: QuoteRequestLine[]
  note?: string | null
  /** When CRM needs the quote submitted by. */
  dueDate?: string | null
  status: QuoteRequestStatus
  quotationId?: string | null
  quotationNumber?: string | null
  declineReason?: QuoteDeclineReason | null
  declineNote?: string | null
  requestedByUserId: string
  requestedByUserName: string
  requestedAt: string
  decidedAt?: string | null
  decidedByUserId?: string | null
  decidedByUserName?: string | null
  createdAt?: unknown
  updatedAt?: unknown
}

// ---------------------------------------------------------------------------
// Notification plumbing
// ---------------------------------------------------------------------------

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

/** Org owner + every member whose default group carries one of the given
 * permissions — the generic form of `loadFinanceRecipients`. */
export async function loadPermissionRecipients(
  firestore: Firestore,
  orgId: string,
  actorId: string,
  permissions: PermissionId[]
): Promise<string[]> {
  const [users, groups] = await Promise.all([
    getDocs(query(collection(firestore, "users"), where("organizationId", "==", orgId))),
    getDocs(query(collection(firestore, "teamGroups"), where("organizationId", "==", orgId))),
  ])
  const matching = new Set(
    groups.docs
      .filter((d) => {
        const perms = ((d.data().permissions as TeamGroup["permissions"]) || []) as string[]
        return perms.includes(ALL_PERMISSION) || permissions.some((p) => perms.includes(p))
      })
      .map((d) => d.id)
  )
  const out = new Set<string>()
  if (orgId) out.add(orgId)
  for (const u of users.docs) {
    const groupId = (u.data().defaultGroupId as string | null) ?? null
    if (groupId && matching.has(groupId)) out.add(u.id)
  }
  out.delete(actorId)
  return [...out]
}

// ---------------------------------------------------------------------------
// Writes — transfer notices
// ---------------------------------------------------------------------------

export async function reportTransfer(
  firestore: Firestore,
  input: {
    quotation: Pick<CrmQuotation, "id" | "quotationNumber" | "contactId" | "contactName" | "organizationId">
    order: Pick<SalesOrder, "id" | "orderNumber"> | null
    installment: { id: string; label: string }
    amountStated: number
    transferDate: string
    bankRef?: string | null
    note?: string | null
    actor: Actor
    recipients: string[]
    notification: NotificationCopy
  }
): Promise<string> {
  const error = validateTransferReport({
    amount: input.amountStated,
    transferDate: input.transferDate,
    today: nowIso().slice(0, 10),
  })
  if (error) throw new Error(error)

  const ref = doc(collection(firestore, SALES_TRANSFER_NOTICES))
  const reportedAt = nowIso()
  const batch = writeBatch(firestore)
  batch.set(ref, {
    organizationId: input.quotation.organizationId,
    noticeNumber: generateTransferNoticeNumber(),
    quotationId: input.quotation.id,
    quotationNumber: input.quotation.quotationNumber,
    orderId: input.order?.id ?? null,
    orderNumber: input.order?.orderNumber ?? null,
    installmentId: input.installment.id,
    installmentLabel: input.installment.label,
    contactId: input.quotation.contactId ?? null,
    contactName: input.quotation.contactName ?? null,
    amountStated: input.amountStated,
    transferDate: input.transferDate,
    bankRef: input.bankRef?.trim() || null,
    note: input.note?.trim() || null,
    status: "reported",
    financeMessage: null,
    answeredAt: null,
    answeredByUserId: null,
    answeredByUserName: null,
    reportedAt,
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  queueNotifications(firestore, batch, input.recipients, {
    type: "transfer_notice_reported",
    organizationId: input.quotation.organizationId,
    title: input.notification.title,
    message: input.notification.message,
    quotationId: input.quotation.id,
    quotationNumber: input.quotation.quotationNumber,
    contactName: input.quotation.contactName ?? null,
    amount: input.amountStated,
    createdAt: reportedAt,
  })
  await batch.commit()
  return ref.id
}

/**
 * Finance's answer — the only hand that moves a notice past "reported".
 * "Confirmed" records the stated amount as a payment on the quotation's
 * instalment (the same advance the direct recording path writes, so invoices
 * recover the deposit identically) and, when this was the deposit gating an
 * order, releases the order in the same batch. "Not found" sends the seller
 * back to the client with Finance's message; the notice stays on record.
 */
export async function answerTransferNotice(
  firestore: Firestore,
  input: {
    notice: TransferNotice
    quotation: CrmQuotation | null
    order: SalesOrder | null
    result: Extract<TransferNoticeStatus, "confirmed" | "not_found">
    message?: string | null
    actor: Actor
    notification: NotificationCopy
  }
): Promise<void> {
  if (input.notice.status !== "reported") throw new Error("already_answered")
  const answeredAt = nowIso()
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_TRANSFER_NOTICES, input.notice.id), {
    status: input.result,
    financeMessage: input.message?.trim() || null,
    answeredAt,
    answeredByUserId: input.actor.id,
    answeredByUserName: input.actor.name,
    updatedAt: serverTimestamp(),
  })

  if (input.result === "confirmed" && input.quotation) {
    const next = applyInstallmentPayment(input.quotation, input.notice.installmentId, {
      paidAt: answeredAt,
      paidAmount: input.notice.amountStated,
      paidByUserId: input.actor.id,
      paidByUserName: input.actor.name,
      note: input.notice.noticeNumber,
    })
    batch.update(doc(firestore, CRM_QUOTATIONS, input.quotation.id), {
      payments: next.payments,
      paidAmount: next.paidAmount,
      paidAt: next.paidAt,
      ...(next.allPaid ? { paidByUserId: input.actor.id, paidByUserName: input.actor.name, paymentNote: input.notice.noticeNumber } : {}),
      updatedAt: serverTimestamp(),
    })
    if (shouldReleaseOrder(input.order, input.notice.installmentId)) {
      batch.update(doc(firestore, SALES_ORDERS, (input.order as SalesOrder).id), {
        "payment.depositPaid": true,
        "payment.depositPaidAt": answeredAt,
        status: "running",
        updatedAt: serverTimestamp(),
      })
    }
  }

  queueNotifications(firestore, batch, [input.notice.createdByUserId].filter((id) => id && id !== input.actor.id), {
    type: input.result === "confirmed" ? "transfer_notice_confirmed" : "transfer_notice_not_found",
    organizationId: input.notice.organizationId,
    title: input.notification.title,
    message: input.notification.message,
    quotationId: input.notice.quotationId,
    quotationNumber: input.notice.quotationNumber,
    noticeNumber: input.notice.noticeNumber,
    amount: input.notice.amountStated,
    financeMessage: input.message?.trim() || null,
    createdAt: answeredAt,
  })
  await batch.commit()

  if (input.result === "confirmed" && input.quotation) {
    onQuotationPaymentRecorded(
      firestore,
      { organizationId: input.notice.organizationId, userId: input.actor.id, userName: input.actor.name },
      {
        quotationId: input.quotation.id,
        quotationNumber: input.quotation.quotationNumber,
        installmentId: input.notice.installmentId,
        amount: input.notice.amountStated,
        contactId: input.quotation.contactId,
        contactName: input.quotation.contactName,
        isAdvance: true,
      }
    )
  }
}

// ---------------------------------------------------------------------------
// Writes — quote requests
// ---------------------------------------------------------------------------

export async function createQuoteRequest(
  firestore: Firestore,
  input: {
    organizationId: string
    contact: { id: string; name: string | null }
    opportunityId?: string | null
    opportunityTitle?: string | null
    lines: QuoteRequestLine[]
    note?: string | null
    dueDate?: string | null
    actor: Actor
    recipients: string[]
    notification: NotificationCopy
  }
): Promise<string> {
  const lines = input.lines.filter((l) => l.name.trim() && l.quantity > 0)
  if (lines.length === 0) throw new Error("no_lines")
  const ref = doc(collection(firestore, SALES_QUOTE_REQUESTS))
  const requestedAt = nowIso()
  const batch = writeBatch(firestore)
  batch.set(ref, {
    organizationId: input.organizationId,
    requestNumber: generateQuoteRequestNumber(),
    contactId: input.contact.id,
    contactName: input.contact.name ?? null,
    opportunityId: input.opportunityId ?? null,
    opportunityTitle: input.opportunityTitle ?? null,
    lines,
    note: input.note?.trim() || null,
    dueDate: input.dueDate || null,
    status: "new",
    quotationId: null,
    quotationNumber: null,
    declineReason: null,
    declineNote: null,
    requestedByUserId: input.actor.id,
    requestedByUserName: input.actor.name,
    requestedAt,
    decidedAt: null,
    decidedByUserId: null,
    decidedByUserName: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  queueNotifications(firestore, batch, input.recipients, {
    type: "quote_request_created",
    organizationId: input.organizationId,
    title: input.notification.title,
    message: input.notification.message,
    quoteRequestId: ref.id,
    contactName: input.contact.name ?? null,
    createdAt: requestedAt,
  })
  await batch.commit()
  return ref.id
}

/** "Cannot price" — one of five factual reasons goes back to CRM; no apology. */
export async function declineQuoteRequest(
  firestore: Firestore,
  input: {
    request: QuoteRequest
    reason: QuoteDeclineReason
    note?: string | null
    actor: Actor
    notification: NotificationCopy
  }
): Promise<void> {
  const decidedAt = nowIso()
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_QUOTE_REQUESTS, input.request.id), {
    status: "declined",
    declineReason: input.reason,
    declineNote: input.note?.trim() || null,
    decidedAt,
    decidedByUserId: input.actor.id,
    decidedByUserName: input.actor.name,
    updatedAt: serverTimestamp(),
  })
  queueNotifications(
    firestore,
    batch,
    [input.request.requestedByUserId].filter((id) => id && id !== input.actor.id),
    {
      type: "quote_request_declined",
      organizationId: input.request.organizationId,
      title: input.notification.title,
      message: input.notification.message,
      quoteRequestId: input.request.id,
      requestNumber: input.request.requestNumber,
      reason: input.reason,
      createdAt: decidedAt,
    }
  )
  await batch.commit()
}

/** The request produced a quotation — it leaves the inbox as "quoted". */
export async function markQuoteRequestQuoted(
  firestore: Firestore,
  input: { requestId: string; quotationId: string; quotationNumber: string; actor: Actor }
): Promise<void> {
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_QUOTE_REQUESTS, input.requestId), {
    status: "quoted",
    quotationId: input.quotationId,
    quotationNumber: input.quotationNumber,
    decidedAt: nowIso(),
    decidedByUserId: input.actor.id,
    decidedByUserName: input.actor.name,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}
