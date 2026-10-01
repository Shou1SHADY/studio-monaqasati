// The order's second-layer acts (R-21, R-24, R-25, R-27, R-29, R-32), each ONE
// transaction that re-reads the order and re-runs its rule. Procurement's:
// logging a dispatch made outside the system, a buyer's self-issue under his
// limit (the limit and Projects' gates re-read inside the transaction),
// cancelling a remainder with the supplier's fee, the decision on a payment
// Finance held, and referring a budget overrun to Projects. Projects': the
// budget decision and "stop what has not arrived" on a material. Finance's:
// recording a payment (the advance included) and holding / releasing an
// invoice. The rules mirror each branch (scratchpad rules/rfqpo.rules, enforce.rules).
//
// Log entries of the acts `types.ts` does not name yet (`hold_decided`,
// `budget_referred`, `budget_decided`, `stop_requested`) are typed locally:
// `PoLogEntry` is mirrored into the mobile app.

import { doc, runTransaction, serverTimestamp, setDoc, type DocumentReference, type Firestore, type Transaction } from "firebase/firestore"
import { emitProcEvent, sarText } from "./events"
import { canCancelRemainder, lineToArrive, poBlocks, round2, type BlockContext } from "./po"
import { acceptsHoldPrice, closesOnPayment, HOLD_DECISIONS, HOLD_OWNER, holdVariance, type HoldPricePending, budgetOverrun, overrunTotal, pmBudgetAsk, selfIssueRefusal, type HoldReason, type PaymentKind, type PmCancel, type PoFinanceHold, type PoFinancePayment, type PurchaseOrderX } from "./po-extras"
import { resolvePolicies, type ResolvedPolicies } from "./policies"
import { materialKey, PRICE_HISTORY } from "./prices"
import { approvalGateBlocks } from "./policy-enforce"
import { PROCUREMENT_SETTINGS, PURCHASE_ORDERS, type PoLogEntry, type ProcActor, type PurchaseOrder } from "./types"
import { afterApproval, assertActs, ProcWriteError, readGateItems, type WriteOpts } from "./writes"

export type PoLogAction = PoLogEntry["action"] | "hold_decided" | "hold_price_asked" | "hold_price_accepted" | "hold_price_refused" | "budget_referred" | "budget_decided" | "stop_requested"
export type PoLogEntryX = Omit<PoLogEntry, "action"> & { action: PoLogAction }

const entry = (actor: Pick<ProcActor, "uid" | "name">, action: PoLogAction, at: string, extra?: { note?: string | null; params?: PoLogEntry["params"] }): PoLogEntryX => ({
  at,
  byId: actor.uid,
  byName: actor.name,
  action,
  note: extra?.note ?? null,
  params: extra?.params ?? null,
})

type Step = { patch: Record<string, unknown>; log?: PoLogEntryX }

function commit(tx: Transaction, ref: DocumentReference, po: PurchaseOrderX, { patch, log }: Step): PurchaseOrderX {
  const next = { ...po, ...patch, ...(log ? { log: [...(po.log || []), log] } : {}) } as PurchaseOrderX
  tx.update(ref, { ...patch, ...(log ? { log: next.log } : {}), updatedAt: serverTimestamp() })
  return next
}

async function readOrder(tx: Transaction, ref: DocumentReference): Promise<PurchaseOrderX> {
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new ProcWriteError("order_missing")
  return { ...(snap.data() as Omit<PurchaseOrderX, "id">), id: snap.id } as PurchaseOrderX
}

async function apply(firestore: Firestore, poId: string, fn: (po: PurchaseOrderX) => Step): Promise<PurchaseOrderX> {
  const ref = doc(firestore, PURCHASE_ORDERS, poId) as DocumentReference
  return runTransaction(firestore, async (tx) => {
    const po = await readOrder(tx, ref)
    return commit(tx, ref, po, fn(po))
  })
}

const optsOf = (o: WriteOpts | Date | undefined): WriteOpts => (o instanceof Date ? { now: o } : o || {})
const expedites = (a: ProcActor) => a.isOwner || a.canExpedite || a.canPrepare || a.canApprove
const decides = (a: ProcActor) => a.isOwner || a.canPrepare || a.canApprove
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** «أُرسل خارج النظام — سجّل ذلك»: approved → sent, with no channel. */
export async function logSentOutside(firestore: Firestore, actor: ProcActor, poId: string, now = new Date()): Promise<PurchaseOrderX> {
  if (!expedites(actor)) throw new ProcWriteError("no_permission")
  const at = now.toISOString()
  return apply(firestore, poId, (po) => {
    assertActs(po, actor)
    if (po.status !== "approved") throw new ProcWriteError("wrong_state")
    return {
      patch: { status: "sent", sentAt: at, sentById: actor.uid, sentByName: actor.name, sentChannel: null },
      log: entry(actor, "sent", at, { params: { outside: 1 } }),
    }
  })
}

export interface SelfIssueInput {
  /** The screen's `poBlocks` context (split orders need the org's other orders). */
  blocks?: Omit<BlockContext, "policies" | "now"> | null
}

/**
 * A buyer issues his own DIRECT order at or under the self-issue limit — no
 * approver, flagged on the order and in the exceptions report. The limit is
 * read from the org's policies INSIDE the transaction (never the screen's), and
 * Projects' gates run on the BOQ lines read there too. Then it sets off what
 * any approval does: Finance's commitment, the receivers, the price history,
 * the send (`afterApproval`).
 */
export async function selfIssuePurchaseOrder(firestore: Firestore, actor: ProcActor, poId: string, input: SelfIssueInput = {}, opts: WriteOpts = {}): Promise<PurchaseOrderX> {
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const ref = doc(firestore, PURCHASE_ORDERS, poId) as DocumentReference
  let policies: ResolvedPolicies = resolvePolicies(null)
  const po = await runTransaction(firestore, async (tx) => {
    const po = await readOrder(tx, ref)
    const settings = await tx.get(doc(firestore, PROCUREMENT_SETTINGS, po.organizationId))
    policies = resolvePolicies(settings.exists() ? (settings.data() as Partial<ResolvedPolicies>) : null)
    const blocks = input.blocks ? poBlocks(po, { ...input.blocks, policies, now }).length : 0
    const gates = approvalGateBlocks(po, await readGateItems(tx, firestore, po), input.blocks?.otherOrders ?? [])
    const refusal = selfIssueRefusal(po, actor, policies.buyerSelfIssueLimit, blocks + gates.length)
    if (refusal === "over_limit") throw new ProcWriteError("above_limit", { limit: policies.buyerSelfIssueLimit })
    if (refusal === "blocked") throw gates.length ? new ProcWriteError(gates[0].code, gates[0].params) : new ProcWriteError("blocked")
    if (refusal === "not_awaiting" || refusal === "returned" || refusal === "retroactive" || refusal === "not_direct") throw new ProcWriteError("wrong_state")
    if (refusal) throw new ProcWriteError("no_permission")
    return commit(tx, ref, po, {
      patch: { status: "approved", approvedById: actor.uid, approvedByName: actor.name, approvedAt: at, selfIssued: true },
      log: entry(actor, "approved", at, { params: { selfIssued: 1, limit: policies.buyerSelfIssueLimit } }),
    })
  })
  return (await afterApproval(firestore, actor, po, policies, opts, at)) as PurchaseOrderX
}

/** «أكّد الإلغاء مع المورد»: the rest will not arrive, with the fee the supplier
 * charged (if any). The supplier, Finance and Inventory hear of it — the revised
 * order — as the plain cancel-remainder always told them. */
export async function cancelRemainderWithFee(firestore: Firestore, actor: ProcActor, poId: string, input: { lineId: string; reason: string; fee?: number | null }, opts?: WriteOpts | Date): Promise<PurchaseOrderX> {
  const o = optsOf(opts)
  if (!decides(actor)) throw new ProcWriteError("no_permission")
  const reason = (input.reason || "").trim()
  if (!reason) throw new ProcWriteError("reason_required")
  const fee = Number(input.fee) > 0 ? round2(Number(input.fee)) : 0
  const at = (o.now ?? new Date()).toISOString()
  let qty = 0
  let lineName = ""
  let unit = ""
  const po = await apply(firestore, poId, (po) => {
    assertActs(po, actor)
    if (!canCancelRemainder(po)) throw new ProcWriteError("wrong_state")
    const line = po.lines.find((l) => l.id === input.lineId)
    if (!line) throw new ProcWriteError("line_missing")
    qty = lineToArrive(line)
    if (qty <= 0) throw new ProcWriteError("nothing_outstanding")
    lineName = line.name
    unit = line.unit
    const lines = po.lines.map((l) => (l.id === line.id ? { ...l, cancelled: round2(l.cancelled + qty), cancelReason: reason } : l))
    const patch: Record<string, unknown> = { lines }
    if (fee) patch.cancelFees = [...(po.cancelFees || []), { lineId: line.id, amount: fee, at, byName: actor.name }]
    return { patch, log: entry(actor, "remainder_cancelled", at, { note: reason, params: { line: line.name, qty, unit: line.unit, ...(fee ? { fee } : {}) } }) }
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_remainder_cancelled",
    organizationId: po.organizationId,
    to: [{ users: [po.supplierUserId, po.preparedById] }, { permission: "invoices.manage" }, { permission: "warehouses.manage" }],
    supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId },
    params: { number: po.docNumber, company: o.orgName || actor.name, line: lineName, qty, unit, reason },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: o.copy,
  })
  return po
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
    const financePayments = [...(po.financePayments || []), payment]
    // Paid in full on a received order: Finance's payment closes it (prototype «أقفلته المالية بالسداد»).
    if (closesOnPayment({ ...po, financePayments }))
      return {
        patch: { financePayments, status: "closed", closedAt: at, closedShort: false, closedByPayment: true },
        log: entry(actor, "closed", at, { params: { byPayment: 1, payment: payment.no } }),
      }
    return { patch: { financePayments } }
  })
}

export interface HoldInput {
  invoiceNo: string
  amount: number
  reason: HoldReason
  text: string
  need: string
  /** A price hold: the invoice's unit price, and the order line it prices. */
  price?: number | null
  lineId?: string | null
}

export async function holdInvoice(firestore: Firestore, actor: ProcActor, isFinance: boolean, poId: string, input: HoldInput, now = new Date()): Promise<PurchaseOrderX> {
  if (!isFinance) throw new ProcWriteError("no_permission")
  if (!input.invoiceNo.trim() || !input.text.trim() || !(Number(input.amount) > 0) || !(input.reason in HOLD_OWNER)) throw new ProcWriteError("reason_required")
  if (input.reason === "price" && !(Number(input.price) > 0)) throw new ProcWriteError("reason_required")
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
      ...(input.reason === "price" ? { price: round2(Number(input.price)), lineId: input.lineId && po.lines.some((l) => l.id === input.lineId) ? input.lineId : (po.lines[0]?.id ?? null) } : {}),
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

/** «قرّر وأبلغ المالية»: Procurement's answer to a hold it owns (or the supplier's,
 * which it chases). Logged on the order, and Finance is told — the hold stays
 * on Finance's desk as «decided» until Finance releases it. A price hold settled
 * above the PO price (an agreed middle price, or the invoice's) needs the reason
 * and is the order approver's to accept: from anyone else it waits as `pend`
 * (the prototype's «لا يقبل رفعَ السعر مَن أعدّ الأمر»). The settled price enters
 * the price history. */
export async function decideHold(
  firestore: Firestore,
  actor: ProcActor,
  poId: string,
  input: { holdId: string; decision: string; note?: string | null; price?: number | null },
  opts?: WriteOpts | Date
): Promise<PurchaseOrderX> {
  const o = optsOf(opts)
  if (!decides(actor)) throw new ProcWriteError("no_permission")
  const at = (o.now ?? new Date()).toISOString()
  let decided: PoFinanceHold | null = null
  const po = await apply(firestore, poId, (po) => {
    assertActs(po, actor)
    const hold = (po.financeHolds || []).find((h) => h.id === input.holdId)
    if (!hold || hold.state !== "open" || hold.pend) throw new ProcWriteError("wrong_state")
    const owner = HOLD_OWNER[hold.reason]
    if (owner !== "proc" && owner !== "sup") throw new ProcWriteError("no_permission")
    if (!HOLD_DECISIONS[hold.reason].includes(input.decision)) throw new ProcWriteError("reason_required")
    const note = input.note?.trim() || null
    const raises = hold.reason === "price" && (input.decision === "new_price" || input.decision === "inv_price")
    if (raises) {
      const price = input.decision === "inv_price" ? Number(hold.price) : Number(input.price)
      if (!(price > 0) || !note) throw new ProcWriteError("reason_required")
      if (!acceptsHoldPrice(po, actor)) {
        const pend: HoldPricePending = { price: round2(price), why: note, byUid: actor.uid, byName: actor.name, at }
        return {
          patch: { financeHolds: (po.financeHolds || []).map((h) => (h.id === hold.id ? { ...h, pend } : h)) },
          log: entry(actor, "hold_price_asked", at, { note, params: { invoice: hold.invoiceNo, price: round2(price) } }),
        }
      }
      decided = { ...hold, state: "decided", decision: input.decision, decisionNote: note, decidedByName: actor.name, decidedAt: at, newPrice: round2(price), pend: null }
    } else {
      decided = { ...hold, state: "decided", decision: input.decision, decisionNote: note, decidedByName: actor.name, decidedAt: at, pend: null }
    }
    const done = decided
    return {
      patch: { financeHolds: (po.financeHolds || []).map((h) => (h.id === hold.id ? done : h)) },
      log: entry(actor, "hold_decided", at, { note, params: { invoice: hold.invoiceNo, reason: hold.reason, decision: input.decision } }),
    }
  })
  if (decided) await afterHoldDecided(firestore, actor, po, decided, at, o)
  return po
}

/** The order's approver answers a higher price someone else asked for: accept
 * it (settled at that price) or refuse it (the supplier honours the PO price). */
export async function answerHoldPrice(firestore: Firestore, actor: ProcActor, poId: string, input: { holdId: string; accept: boolean; note?: string | null }, opts?: WriteOpts | Date): Promise<PurchaseOrderX> {
  const o = optsOf(opts)
  const at = (o.now ?? new Date()).toISOString()
  let decided: PoFinanceHold | null = null
  const po = await apply(firestore, poId, (po) => {
    const hold = (po.financeHolds || []).find((h) => h.id === input.holdId)
    if (!hold || hold.state !== "open" || !hold.pend) throw new ProcWriteError("wrong_state")
    if (!acceptsHoldPrice(po, actor) || (hold.pend.byUid === actor.uid && !actor.isOwner)) throw new ProcWriteError("no_permission")
    const pend = hold.pend
    const note = input.note?.trim() || null
    const done: PoFinanceHold = input.accept
      ? { ...hold, state: "decided", decision: round2(pend.price) === round2(Number(hold.price)) ? "inv_price" : "new_price", decisionNote: pend.why, decidedByName: actor.name, decidedAt: at, newPrice: pend.price, pend: null }
      : { ...hold, state: "decided", decision: "po_price", decisionNote: note, decidedByName: actor.name, decidedAt: at, pend: null }
    decided = done
    return {
      patch: { financeHolds: (po.financeHolds || []).map((h) => (h.id === hold.id ? done : h)) },
      log: entry(actor, input.accept ? "hold_price_accepted" : "hold_price_refused", at, { note, params: { invoice: hold.invoiceNo, price: pend.price, by: pend.byName } }),
    }
  })
  if (decided) await afterHoldDecided(firestore, actor, po, decided, at, o)
  return po
}

/** Finance hears the decision; a settled price enters the price history (best-effort). */
async function afterHoldDecided(firestore: Firestore, actor: ProcActor, po: PurchaseOrderX, hold: PoFinanceHold, at: string, o: WriteOpts): Promise<void> {
  await emitProcEvent(firestore, actor, {
    kind: "po_hold_decided",
    organizationId: po.organizationId,
    to: [{ permission: "invoices.manage" }, { permission: "accounting.post" }],
    params: { number: po.docNumber, invoice: hold.invoiceNo, decision: `@pn_po_hold_${hold.decision}`, note: hold.decisionNote || "" },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    link: "/contractor/accounting/procurement-desk",
    copy: o.copy,
  })
  const v = hold.newPrice ? holdVariance(po, hold) : null
  if (v && hold.newPrice) {
    await setDoc(doc(firestore, PRICE_HISTORY, `${po.id}__${v.line.id}__${hold.id}`), {
      organizationId: po.organizationId,
      materialKey: materialKey(v.line.name, v.line.unit),
      name: v.line.name,
      unit: v.line.unit,
      supplierOrgId: po.supplierOrgId,
      supplierName: po.supplierName,
      price: hold.newPrice,
      day: at.slice(0, 10),
      kind: "variance",
      poId: po.id,
      poNumber: po.docNumber,
    }).catch((err) => console.warn("price history not recorded:", (err as { code?: string })?.code || err))
  }
}

// ---------------------------------------------------------------------------
// Projects' budget decision (R-25) — referred by Procurement, answered by the
// project's manager. Nothing waits on a decision nobody asked for.
// ---------------------------------------------------------------------------

export interface BudgetReferInput {
  /** The BOQ lines the order names and the org's other orders — the overrun is shown to Projects. */
  items: Parameters<typeof budgetOverrun>[1]
  otherOrders: PurchaseOrder[]
}

/** «أحِله لقرار مدير المشروع»: the preparer or an approver refers an overrun; the order then waits. */
export async function referBudgetToProjects(firestore: Firestore, actor: ProcActor, poId: string, input: BudgetReferInput, opts: WriteOpts = {}): Promise<PurchaseOrderX> {
  if (!decides(actor)) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  let over = 0
  const po = await apply(firestore, poId, (po) => {
    if (!actor.canApprove && !actor.isOwner) assertActs(po, actor)
    const overrun = budgetOverrun(po, input.items, input.otherOrders)
    if (!pmBudgetAsk(po, overrun)) throw new ProcWriteError("nothing_to_refer")
    over = overrunTotal(overrun)
    return {
      patch: { pmBudget: { state: "pending", over, askedByName: actor.name, askedAt: at } },
      log: entry(actor, "budget_referred", at, { params: { over } }),
    }
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_budget_referred",
    organizationId: po.organizationId,
    to: [{ projectPermission: "projects.edit", projectId: po.projectId || "" }, { owner: true }],
    params: { number: po.docNumber, supplier: po.supplierName, project: po.projectName || "", over: sarText(over, opts.locale) },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    link: po.projectId ? `/contractor/projects/${po.projectId}` : null,
    copy: opts.copy,
  })
  return po
}

export type BudgetDecision = "accepted" | "renegotiate"

/**
 * The project's answer (PM side): accept the overrun — the order goes on to its
 * approver — or send it back to renegotiate the price. Called from a PM screen;
 * who may answer is the PM guard's (`approve` on the project) and the rules'.
 */
export async function decidePmBudget(firestore: Firestore, actor: { uid: string; name: string }, poId: string, input: { decision: BudgetDecision; note?: string | null }, opts: WriteOpts = {}): Promise<PurchaseOrderX> {
  const at = (opts.now ?? new Date()).toISOString()
  const note = input.note?.trim() || null
  if (input.decision === "renegotiate" && !note) throw new ProcWriteError("reason_required")
  const po = await apply(firestore, poId, (po) => {
    if (po.status !== "awaiting_approval" || po.pmBudget?.state !== "pending") throw new ProcWriteError("wrong_state")
    return {
      patch: { pmBudget: { ...po.pmBudget, state: input.decision, byName: actor.name, at, note } },
      log: entry(actor, "budget_decided", at, { note, params: { decision: input.decision } }),
    }
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_budget_decided",
    organizationId: po.organizationId,
    to: [{ users: [po.preparedById] }, { permission: "po.approve" }],
    params: { number: po.docNumber, decision: `@pn_po_budget_${input.decision}`, note: note || "" },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: opts.copy,
  })
  return po
}

// ---------------------------------------------------------------------------
// Projects closed a material: stop what has not arrived (R-29, P-19)
// ---------------------------------------------------------------------------

/**
 * Inside the PM's own transaction (`stopLine` in src/lib/pm/supply-writes.ts):
 * reads the order, finds the line of that material, and records the request on
 * the ORDER — `pmCancels[lineId]` + `pmCancelKey` — so the buyer's drawer shows
 * «أكّد الإلغاء مع المورد» and Procurement Today raises its task. Nothing is
 * cancelled here: only Procurement cancels with the supplier (and his fee).
 * Recorded at whatever stage the order is — awaiting approval, approved, sent or
 * accepted: the project's line closes in this same transaction, and an order
 * that goes on without the stop on it would bring what nobody wants any more.
 * Returns the line id, or null when the order has nothing of it left to arrive.
 * Reads first, then writes — the caller must have done all its own reads.
 */
export async function requestPmStopInTx(
  tx: Transaction,
  firestore: Firestore,
  poId: string,
  match: { name: string; unit: string; boqItemId?: string | null },
  cancel: { reason: string; byName: string; at: string; projectId: string; requestId: string; line?: number | null }
): Promise<string | null> {
  const ref = doc(firestore, PURCHASE_ORDERS, poId) as DocumentReference
  const po = await readOrder(tx, ref)
  // An order born of an RFQ names its lines as the RFQ did — often the category
  // picked on the form, with the material itself in the line's description.
  const rfq = po.rfqId ? await tx.get(doc(firestore, "rfqs", po.rfqId)) : null
  const products = (rfq?.exists() ? (rfq.data() as { products?: Array<{ description?: string | null } | null> | null }).products : null) || []
  const line = pmStopLine(po, match, (l) => (l.rfqProductIndex == null ? null : products[l.rfqProductIndex]?.description ?? null))
  if (!line) return null
  // `line` — the request line it was — lets the rules follow a line that names its
  // own order (`lineLinks`) back to this one when the order serves several projects.
  const entryValue: PmCancel & { line?: string } = { reason: cancel.reason, byName: cancel.byName, at: cancel.at, projectId: cancel.projectId, requestId: cancel.requestId, ...(cancel.line == null ? {} : { line: String(cancel.line) }) }
  tx.update(ref, { pmCancels: { ...(po.pmCancels || {}), [line.id]: entryValue }, pmCancelKey: line.id, updatedAt: serverTimestamp() })
  return line.id
}

/** An order still lives — and takes Projects' stop — until it is closed or cancelled. */
const PM_STOPPABLE: ReadonlyArray<PurchaseOrder["status"]> = ["awaiting_approval", "approved", "sent", "accepted"]

/**
 * The order's line for a material Projects stopped, only while something of it
 * is still to arrive. The MATERIAL decides (name + unit, folded as the price
 * history folds them — or the description of the RFQ line it came from, through
 * `describedAs`); the BOQ item only tells two lines of that material apart. An
 * order carrying blocks and cement on one item must never take cement's stop on
 * its blocks, so the item alone matches nothing.
 */
export function pmStopLine(
  po: Pick<PurchaseOrder, "lines" | "status">,
  match: { name: string; unit: string; boqItemId?: string | null },
  describedAs?: (line: PurchaseOrder["lines"][number]) => string | null | undefined
): PurchaseOrder["lines"][number] | null {
  if (!PM_STOPPABLE.includes(po.status)) return null
  const want = materialKey(match.name, match.unit)
  const is = (name: string | null | undefined, unit: string) => Boolean(name) && materialKey(name, unit) === want
  const same = po.lines.filter((l) => lineToArrive(l) > 0 && (is(l.name, l.unit) || is(describedAs?.(l), l.unit)))
  return (match.boqItemId ? same.find((l) => l.boqItemId === match.boqItemId) : undefined) ?? same[0] ?? null
}
