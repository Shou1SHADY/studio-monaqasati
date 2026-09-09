// Integration hooks — what the rest of the app actually calls.
//
// Each function is the accounting consequence of one business event, and each
// is deliberately shaped the same way:
//
//   • fire-and-forget — the caller does not await a decision it can act on;
//   • silent when Accounting is off, so an org that never opens the module is
//     never taxed by it and no call site needs to know whether it is on;
//   • never throwing — the business action has already happened, and failing it
//     retroactively over a bookkeeping problem helps nobody. Failures land in
//     the console and show up on the integrity screen as a missing entry.
//
// The asymmetry is intentional: business truth first, its ledger shadow second.
// Everywhere the write CAN be batched with the business write (manufacturing,
// material issues) it is, and there the two are atomic.

import type { Firestore, WriteBatch } from "firebase/firestore"
import { isAccountingEnabled, postToLedgerSafe } from "./post"
import {
  postIpcClaim,
  postIpcCollection,
  postMaterialIssue,
  postSalesPayment,
  postSalesQuotationAccepted,
  postWorkOrderDelivery,
  postWorkOrderIssue,
  type PostingContext,
} from "./posting-rules"

export interface HookActor {
  organizationId: string
  userId: string
  userName: string
}

const ctxOf = (a: HookActor): PostingContext => ({
  organizationId: a.organizationId,
  userId: a.userId,
  userName: a.userName,
})

const today = () => new Date().toISOString().slice(0, 10)

/** Guard every hook: no settings doc means the org has not switched Accounting
 * on, and nothing should be written. */
async function ifEnabled(firestore: Firestore, organizationId: string, run: () => Promise<unknown>): Promise<void> {
  try {
    if (!(await isAccountingEnabled(firestore, organizationId))) return
    await run()
  } catch (err) {
    console.error("Accounting hook failed:", err)
  }
}

// ---------------------------------------------------------------------------
// Projects — IPC certificates
// ---------------------------------------------------------------------------

export function onIpcClaimSubmitted(
  firestore: Firestore,
  actor: HookActor,
  claim: {
    claimId: string
    claimNumber: number
    projectId: string
    projectName?: string | null
    date?: string
    gross: number
    retention: number
    advanceRecovery: number
    vat: number
    net: number
  }
): void {
  void ifEnabled(firestore, actor.organizationId, () =>
    postToLedgerSafe(firestore, ctxOf(actor), postIpcClaim({ ...claim, date: claim.date || today() }))
  )
}

export function onIpcClaimCollected(
  firestore: Firestore,
  actor: HookActor,
  claim: {
    claimId: string
    claimNumber: number
    projectId: string
    projectName?: string | null
    date?: string
    amount: number
  }
): void {
  void ifEnabled(firestore, actor.organizationId, () =>
    postToLedgerSafe(firestore, ctxOf(actor), postIpcCollection({ ...claim, date: claim.date || today() }))
  )
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export function onQuotationAccepted(
  firestore: Firestore,
  actor: HookActor,
  quotation: {
    quotationId: string
    quotationNumber: string
    date?: string
    amount: number
    vatPercent?: number
    contactId: string
    contactName?: string | null
    phase: "pre_manufacturing" | "post_manufacturing"
  }
): void {
  void ifEnabled(firestore, actor.organizationId, () =>
    postToLedgerSafe(
      firestore,
      ctxOf(actor),
      postSalesQuotationAccepted({
        ...quotation,
        date: quotation.date || today(),
        vatPercent: quotation.vatPercent ?? 15,
      })
    )
  )
}

export function onQuotationPaymentRecorded(
  firestore: Firestore,
  actor: HookActor,
  payment: {
    quotationId: string
    quotationNumber: string
    installmentId: string
    date?: string
    amount: number
    contactId: string
    contactName?: string | null
    /** A pre-manufacturing quotation has not delivered yet, so its money is an
     * advance rather than the settlement of a receivable. */
    isAdvance: boolean
  }
): void {
  void ifEnabled(firestore, actor.organizationId, () =>
    postToLedgerSafe(firestore, ctxOf(actor), postSalesPayment({ ...payment, date: payment.date || today() }))
  )
}

// ---------------------------------------------------------------------------
// Manufacturing
//
// These two take the caller's batch: the stock movement and its journal entry
// are the same fact, and letting them diverge would put the ledger permanently
// out of step with the warehouse.
// ---------------------------------------------------------------------------

export interface BatchPostArgs {
  firestore: Firestore
  batch: WriteBatch
  actor: HookActor
  entryNumber: number
}

export function addWorkOrderIssueToBatch(
  args: BatchPostArgs,
  order: {
    workOrderId: string
    orderNumber: number
    title: string
    date?: string
    materialCost: number
    projectId?: string | null
    projectName?: string | null
  }
): void {
  void postToLedgerSafe(
    args.firestore,
    ctxOf(args.actor),
    postWorkOrderIssue({ ...order, date: order.date || today() }),
    { batch: args.batch, skipPeriodCheck: true }
  )
}

export function onWorkOrderDelivered(
  firestore: Firestore,
  actor: HookActor,
  delivery: {
    workOrderId: string
    orderNumber: number
    deliveryNoteId: string
    date?: string
    value: number
    warehouseName?: string | null
    projectId?: string | null
    projectName?: string | null
    toProject: boolean
  }
): void {
  void ifEnabled(firestore, actor.organizationId, () =>
    postToLedgerSafe(firestore, ctxOf(actor), postWorkOrderDelivery({ ...delivery, date: delivery.date || today() }))
  )
}

// ---------------------------------------------------------------------------
// Inventory — materials issued to a project
// ---------------------------------------------------------------------------

export function onMaterialIssued(
  firestore: Firestore,
  actor: HookActor,
  issue: {
    batchId: string
    date?: string
    projectId?: string | null
    projectName?: string | null
    totalValue: number
    wasteValue: number
    itemName: string
  }
): void {
  void ifEnabled(firestore, actor.organizationId, () =>
    postToLedgerSafe(firestore, ctxOf(actor), postMaterialIssue({ ...issue, date: issue.date || today() }))
  )
}
