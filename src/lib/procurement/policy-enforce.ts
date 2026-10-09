// Where the four operating policies of §6.4 (`./policies`) change what happens,
// and the approval gates Projects owns (R-25) re-run at the write. Pure: every
// write and screen asks these, so the button, the transaction and the task
// list cannot disagree.
//
// - noticeRouting `both`: the supplier's notice reaches the receiver with us —
//   nothing waits to be forwarded. The receivers are named ON THE ORDER at
//   approval (`noticeCopyTo`), because the supplier who writes the notice
//   cannot read our team.
// - buyerReceives: a firm with no separate receiver lets whoever prepares
//   orders record a receipt; every such receipt is flagged `selfReceived` and
//   lands in the exceptions report. Never a silent permission.
// - replyWindowDays: Inventory's stock check and the workshop's answer both
//   fail OPEN after it — Procurement may proceed.
// - buyerSelfIssueLimit: read by `selfIssueRefusal` (./po-extras) from the
//   resolved policy, re-read inside the self-issue transaction.

import { operatingPolicies, type OperatingPolicies } from "./policies"
import { awaitsPmBudget, budgetOverrun, overrunTotal, samplePending, type BoqGateItem, type PurchaseOrderX } from "./po-extras"
import type { ProcActor, ProcurementPolicies, PurchaseOrder } from "./types"

type PolicySource = ProcurementPolicies | Partial<OperatingPolicies> | null | undefined

// ---------------------------------------------------------------------------
// Delivery-notice routing
// ---------------------------------------------------------------------------

export const noticeReachesReceiver = (p: PolicySource): boolean => operatingPolicies(p).noticeRouting === "both"

/** The receiver already knows: forwarded, signed by link, or the notice reached him directly. */
export function noticeTold(d: { forwardedTo?: unknown; receiverReport?: unknown }, p: PolicySource): boolean {
  return Boolean(d.forwardedTo) || Boolean(d.receiverReport) || noticeReachesReceiver(p)
}

/** The receivers the order was stamped with at approval — the supplier's notice copies them. */
export function noticeCopyOf(po: { noticeCopyTo?: unknown } | null | undefined): string[] {
  const raw = po?.noticeCopyTo
  return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === "string" && u.length > 0) : []
}

/** Who the supplier's notice reaches: the usual contractor side, then the stamped receivers, once each. */
export function noticeAudience(base: string[], po: { noticeCopyTo?: unknown } | null | undefined): string[] {
  const out: string[] = []
  for (const uid of [...base, ...noticeCopyOf(po)]) if (uid && !out.includes(uid)) out.push(uid)
  return out
}

// ---------------------------------------------------------------------------
// Who records a receipt
// ---------------------------------------------------------------------------

/** `receiver` = the gate's own right · `buyer` = allowed only by `buyerReceives`, flagged. */
export type ReceiveRight = "receiver" | "buyer" | null

export function receiveRight(actor: Pick<ProcActor, "isOwner" | "canReceive" | "canPrepare">, p: PolicySource): ReceiveRight {
  if (actor.isOwner || actor.canReceive) return "receiver"
  if (actor.canPrepare && operatingPolicies(p).buyerReceives) return "buyer"
  return null
}

/** The receipt carries «استلمه مُعِدّ الأمر» when the buyer received under the policy, or received his own order. */
export function selfReceivedFlag(actor: Pick<ProcActor, "uid">, right: ReceiveRight, po: Pick<PurchaseOrder, "preparedById"> | null): boolean {
  return right === "buyer" || Boolean(po && po.preparedById === actor.uid)
}

// ---------------------------------------------------------------------------
// The reply window of Inventory and the workshop
// ---------------------------------------------------------------------------

export const replyWindowHours = (p: PolicySource): number => operatingPolicies(p).replyWindowDays * 24

/** Strictly past the window — the moment it ends is still theirs. */
export function replyLapsed(sinceMs: number | null, now: Date, p: PolicySource): boolean {
  if (sinceMs == null || !Number.isFinite(sinceMs)) return false
  return now.getTime() - sinceMs > replyWindowHours(p) * 3_600_000
}

// ---------------------------------------------------------------------------
// Projects' gates on approval (R-25), re-run inside the write
// ---------------------------------------------------------------------------

export type GateCode = "pm_budget_pending" | "sample_pending"
export interface GateBlock {
  code: GateCode
  params: Record<string, string | number>
}

/** A budget decision Projects was asked for and has not given (or asked to renegotiate), or a
 * line whose sample is not approved. An overrun nobody referred does not block (see `pmBudgetAsk`). */
export function approvalGateBlocks(po: PurchaseOrderX, items: BoqGateItem[], otherOrders: PurchaseOrder[], projectManagementOff = false): GateBlock[] {
  // Projects switched off for the company: its budget and sample gates have nobody left to clear them, so they do not stand.
  if (projectManagementOff) return []
  const out: GateBlock[] = []
  if (awaitsPmBudget(po)) {
    const overrun = budgetOverrun(po, items, otherOrders)
    out.push({ code: "pm_budget_pending", params: { over: overrun.length ? overrunTotal(overrun) : Math.round(Number(po.pmBudget?.over) || 0), state: po.pmBudget?.state || "pending" } })
  }
  const samples = samplePending(po, items)
  if (samples.length) out.push({ code: "sample_pending", params: { count: samples.length, items: samples.map((i) => i.description || i.name || i.id).join(" · ") } })
  return out
}

/** The BOQ lines an approval must read: the order's project, each item once. */
export function gateItemIds(po: Pick<PurchaseOrder, "projectId" | "lines">): string[] {
  if (!po.projectId) return []
  return Array.from(new Set(po.lines.map((l) => l.boqItemId).filter((x): x is string => Boolean(x))))
}
