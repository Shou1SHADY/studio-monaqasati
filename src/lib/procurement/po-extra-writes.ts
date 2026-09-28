// The order's second-layer acts (R-21, R-24, R-27, R-29, R-32), each ONE
// transaction that re-reads the order and re-runs its rule. Procurement's:
// logging a dispatch made outside the system, a buyer's self-issue under his
// limit, cancelling a remainder with the supplier's fee, and the decision on a
// payment Finance held. Finance's: recording a payment (the advance included)
// and holding / releasing an invoice. The rules mirror each branch
// (scratchpad rules/rfqpo.rules).

import { doc, runTransaction, serverTimestamp, type DocumentReference, type Firestore } from "firebase/firestore"
import { canCancelRemainder, lineToArrive, round2 } from "./po"
import { HOLD_DECISIONS, HOLD_OWNER, selfIssueRefusal, type HoldReason, type PaymentKind, type PoFinanceHold, type PoFinancePayment, type PurchaseOrderX } from "./po-extras"
import { PURCHASE_ORDERS, type PoLogEntry, type ProcActor, type PurchaseOrder } from "./types"
import { ProcWriteError } from "./writes"

const entry = (actor: Pick<ProcActor, "uid" | "name">, action: PoLogEntry["action"], at: string, extra?: { note?: string | null; params?: PoLogEntry["params"] }): PoLogEntry => ({
  at,
  byId: actor.uid,
  byName: actor.name,
  action,
  note: extra?.note ?? null,
  params: extra?.params ?? null,
})

async function apply(firestore: Firestore, poId: string, fn: (po: PurchaseOrderX) => { patch: Record<string, unknown>; log?: PoLogEntry }): Promise<PurchaseOrderX> {
  const ref = doc(firestore, PURCHASE_ORDERS, poId) as DocumentReference
  return runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ProcWriteError("order_missing")
    const po = { ...(snap.data() as Omit<PurchaseOrderX, "id">), id: snap.id } as PurchaseOrderX
    const { patch, log } = fn(po)
    const next = { ...po, ...patch, ...(log ? { log: [...(po.log || []), log] } : {}) } as PurchaseOrderX
    tx.update(ref, { ...patch, ...(log ? { log: next.log } : {}), updatedAt: serverTimestamp() })
    return next
  })
}

const expedites = (a: ProcActor) => a.isOwner || a.canExpedite || a.canPrepare || a.canApprove
const decides = (a: ProcActor) => a.isOwner || a.canPrepare || a.canApprove
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** «أُرسل خارج النظام — سجّل ذلك»: approved → sent, with no channel. */
export async function logSentOutside(firestore: Firestore, actor: ProcActor, poId: string, now = new Date()): Promise<PurchaseOrderX> {
  if (!expedites(actor)) throw new ProcWriteError("no_permission")
  const at = now.toISOString()
  return apply(firestore, poId, (po) => {
    if (po.status !== "approved") throw new ProcWriteError("wrong_state")
    return {
      patch: { status: "sent", sentAt: at, sentById: actor.uid, sentByName: actor.name, sentChannel: null },
      log: entry(actor, "sent", at, { params: { outside: 1 } }),
    }
  })
}

/** A buyer issues his own order at or under the self-issue limit — no approver, flagged on the order. */
export async function selfIssuePurchaseOrder(firestore: Firestore, actor: ProcActor, poId: string, input: { limit: number; blocks: number }, now = new Date()): Promise<PurchaseOrderX> {
  const at = now.toISOString()
  return apply(firestore, poId, (po) => {
    const refusal = selfIssueRefusal(po, actor, input.limit, input.blocks)
    if (refusal === "over_limit") throw new ProcWriteError("above_limit")
    if (refusal === "blocked") throw new ProcWriteError("blocked")
    if (refusal === "not_awaiting" || refusal === "returned" || refusal === "retroactive") throw new ProcWriteError("wrong_state")
    if (refusal) throw new ProcWriteError("no_permission")
    return {
      patch: { status: "approved", approvedById: actor.uid, approvedByName: actor.name, approvedAt: at, selfIssued: true },
      log: entry(actor, "approved", at, { params: { selfIssued: 1 } }),
    }
  })
}

/** «أكّد الإلغاء مع المورد»: the rest will not arrive, with the fee the supplier charged (if any). */
export async function cancelRemainderWithFee(firestore: Firestore, actor: ProcActor, poId: string, input: { lineId: string; reason: string; fee?: number | null }, now = new Date()): Promise<PurchaseOrderX> {
  if (!decides(actor)) throw new ProcWriteError("no_permission")
  const reason = (input.reason || "").trim()
  if (!reason) throw new ProcWriteError("reason_required")
  const fee = Number(input.fee) > 0 ? round2(Number(input.fee)) : 0
  const at = now.toISOString()
  return apply(firestore, poId, (po) => {
    if (!canCancelRemainder(po)) throw new ProcWriteError("wrong_state")
    const line = po.lines.find((l) => l.id === input.lineId)
    if (!line) throw new ProcWriteError("line_missing")
    const qty = lineToArrive(line)
    if (qty <= 0) throw new ProcWriteError("nothing_outstanding")
    const lines = po.lines.map((l) => (l.id === line.id ? { ...l, cancelled: round2(l.cancelled + qty), cancelReason: reason } : l))
    const patch: Record<string, unknown> = { lines }
    if (fee) patch.cancelFees = [...(po.cancelFees || []), { lineId: line.id, amount: fee, at, byName: actor.name }]
    return { patch, log: entry(actor, "remainder_cancelled", at, { note: reason, params: { line: line.name, qty, unit: line.unit, ...(fee ? { fee } : {}) } }) }
  })
}

// ---------------------------------------------------------------------------
// Finance's side
// ---------------------------------------------------------------------------

export interface PaymentInput {
  kind: PaymentKind
  amount: number
  net?: number | null
  vat?: number | null
  recovered?: number | null
  invoiceNo?: string | null
  valueDate: string
  bank?: string | null
  reference: string
  account?: string | null
}

export function paymentRefusal(po: Pick<PurchaseOrder, "status" | "approvedAt">, input: PaymentInput): "wrong_state" | "price_missing" | "date_invalid" | "reason_required" | null {
  if (!po.approvedAt || po.status === "cancelled" || po.status === "awaiting_approval") return "wrong_state"
  if (!(Number(input.amount) > 0)) return "price_missing"
  if (!DAY.test(input.valueDate || "")) return "date_invalid"
  if (!(input.reference || "").trim()) return "reason_required"
  return null
}

export async function recordFinancePayment(firestore: Firestore, actor: ProcActor, isFinance: boolean, poId: string, input: PaymentInput, now = new Date()): Promise<PurchaseOrderX> {
  if (!isFinance) throw new ProcWriteError("no_permission")
  const at = now.toISOString()
  return apply(firestore, poId, (po) => {
    const refusal = paymentRefusal(po, input)
    if (refusal) throw new ProcWriteError(refusal)
    if (input.kind === "adv" && (po.financePayments || []).some((p) => p.kind === "adv")) throw new ProcWriteError("wrong_state")
    const seq = (po.financePayments || []).length + 1
    const payment: PoFinancePayment = {
      no: `${(po.docNumber || "").replace(/^[A-Z]+-/, "PAY-")}-${seq}`,
      kind: input.kind,
      amount: round2(Number(input.amount)),
      net: input.net != null ? round2(Number(input.net)) : null,
      vat: input.vat != null ? round2(Number(input.vat)) : null,
      recovered: input.recovered != null && Number(input.recovered) > 0 ? round2(Number(input.recovered)) : null,
      invoiceNo: input.invoiceNo?.trim() || null,
      valueDate: input.valueDate,
      bank: input.bank?.trim() || null,
      reference: input.reference.trim(),
      account: input.account?.trim() || null,
      byName: actor.name,
      at,
    }
    return { patch: { financePayments: [...(po.financePayments || []), payment] } }
  })
}

export interface HoldInput {
  invoiceNo: string
  amount: number
  reason: HoldReason
  text: string
  need: string
}

export async function holdInvoice(firestore: Firestore, actor: ProcActor, isFinance: boolean, poId: string, input: HoldInput, now = new Date()): Promise<PurchaseOrderX> {
  if (!isFinance) throw new ProcWriteError("no_permission")
  if (!input.invoiceNo.trim() || !input.text.trim() || !(Number(input.amount) > 0) || !(input.reason in HOLD_OWNER)) throw new ProcWriteError("reason_required")
  const at = now.toISOString()
  return apply(firestore, poId, (po) => {
    if (!po.approvedAt) throw new ProcWriteError("wrong_state")
    const hold: PoFinanceHold = {
      id: `h${(po.financeHolds || []).length + 1}`,
      invoiceNo: input.invoiceNo.trim(),
      amount: round2(Number(input.amount)),
      reason: input.reason,
      text: input.text.trim(),
      need: input.need.trim(),
      at,
      byName: actor.name,
      state: "open",
    }
    return { patch: { financeHolds: [...(po.financeHolds || []), hold] } }
  })
}

export async function releaseHold(firestore: Firestore, actor: ProcActor, isFinance: boolean, poId: string, holdId: string, now = new Date()): Promise<PurchaseOrderX> {
  if (!isFinance) throw new ProcWriteError("no_permission")
  const at = now.toISOString()
  return apply(firestore, poId, (po) => {
    const hold = (po.financeHolds || []).find((h) => h.id === holdId)
    if (!hold || hold.state === "released") throw new ProcWriteError("wrong_state")
    return { patch: { financeHolds: (po.financeHolds || []).map((h) => (h.id === holdId ? { ...h, state: "released", decidedAt: h.decidedAt ?? at } : h)) } }
  })
}

/** «قرّر وأبلغ المالية»: Procurement's answer to a hold it owns (or the supplier's, which it chases). */
export async function decideHold(firestore: Firestore, actor: ProcActor, poId: string, input: { holdId: string; decision: string; note?: string | null }, now = new Date()): Promise<PurchaseOrderX> {
  if (!decides(actor)) throw new ProcWriteError("no_permission")
  const at = now.toISOString()
  return apply(firestore, poId, (po) => {
    const hold = (po.financeHolds || []).find((h) => h.id === input.holdId)
    if (!hold || hold.state !== "open") throw new ProcWriteError("wrong_state")
    const owner = HOLD_OWNER[hold.reason]
    if (owner !== "proc" && owner !== "sup") throw new ProcWriteError("no_permission")
    if (!HOLD_DECISIONS[hold.reason].includes(input.decision)) throw new ProcWriteError("reason_required")
    return {
      patch: {
        financeHolds: (po.financeHolds || []).map((h) =>
          h.id === hold.id ? { ...h, state: "decided", decision: input.decision, decisionNote: input.note?.trim() || null, decidedByName: actor.name, decidedAt: at } : h
        ),
      },
    }
  })
}
