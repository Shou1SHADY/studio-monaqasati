// The purchase order's acts that cross a boundary, on the server (Procurement 2.0, WP-S4-07 / WP-S4-09): approve, return, send,
// cancel with its reason and what happens to the materials, close short, decide a rejected quantity, approve an advance to a
// supplier with no record, move the supplier's date, and the supplier's acceptance of a version. Every one re-reads the order
// inside ONE Admin transaction, re-runs the domain rule (`./po`, `./po-state`), writes the patch with its log entry and — for
// what changes the order after it was sent — a new VERSION and the outbox events of the contract (`./event-keys`). Nothing the
// client can do replaces these: the rules ceiling is full, so a new write goes through a route (BUILD-COMMON).
//
// Notifications and the price history ride after the commit, best-effort (a lost notice never undoes the act it reports).
// The order LINK of an off-platform supplier is wave C's: `PoCtx.mintOrderLink` is the hook, null until then.

import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore"
import { riyadhDay } from "@/lib/hr/format"
import { linkUrl } from "@/lib/links/url"
import { permissionHolders, notifyNamed } from "@/lib/supplier-free/server-notify"
import { projectsOn, offListOf } from "./financeless-server"
import { closeOnFor } from "./close-on"
import { buildProcEvent, PROC_EVENTS, procEventDocId, advanceRequestKey, commitmentKey, poAcceptKey, poInboundKey, poRejectKey, poVersionKey, type ProcEvent } from "./event-keys"
import type { ProcEventId } from "./package-data"
import { PRICE_HISTORY, historyRowsForApproval } from "./prices"
import { approvalGateBlocks, gateItemIds, noticeReachesReceiver } from "./policy-enforce"
import { advanceAmount, advanceNeedsOwner, advanceNumber, poActs, selfIssueRefusal, type BoqGateItem, type PurchaseOrderX } from "./po-extras"
import { advanceOwnerRequired, nextVersionPatch, pendingVersion, poDueDate, poVer, poVersions, supplierHasRecord } from "./po-state"
import { resolvePolicies, type ResolvedPolicies } from "./policies"
import { supplierFactsFromProfile } from "./award"
import { SUPPLIER_RECORDS, supplierFactsWithRecord, supplierRecordId, type SupplierRecord } from "./supplier-file"
import { approvalAmount, approvalRefusal, canSend, canUpdateDate, closeIsShort, poBlocks, poValue, type BlockContext } from "./po"
import { applyRejectDecision, sendContactPatch, type SendContact } from "./writes"
import { PROCUREMENT_SETTINGS, PURCHASE_ORDERS, type PoLogEntry, type PoSendChannel, type ProcActor, type PurchaseOrder, type RejectDecision, type SupplierFacts } from "./types"
import { sarText } from "./events"
import { COMPANY_PUBLIC_FACTS } from "@/lib/company-public-facts"
import type { Caller } from "@/lib/receipt-links"

// ---------------------------------------------------------------------------
// Errors — the reasons are the `ProcWriteError` codes the screens already translate (`Portal.Procurement.err_*`)
// ---------------------------------------------------------------------------

export type PoActReason =
  | "order_missing"
  | "no_permission"
  | "wrong_state"
  | "own_order"
  | "owner_only"
  | "above_limit"
  | "blocked"
  | "reason_required"
  | "date_invalid"
  | "has_receipts"
  | "already_cancelled"
  | "line_missing"
  | "nothing_rejected"
  | "price_missing"
  | "owner_read_only"
  | "not_your_order"
  | "pm_budget_pending"
  | "sample_pending"
  | "no_portal"
  | "advance_not_waiting"
  | "version_missing"
  | "items_pending"
  | "no_rfq"

const STATUS: Partial<Record<PoActReason, number>> = { order_missing: 404, no_permission: 403, owner_only: 403, owner_read_only: 403, not_your_order: 403, reason_required: 400, date_invalid: 400, price_missing: 400, no_portal: 400 }

export class PoActError extends Error {
  readonly status: number
  constructor(
    readonly reason: PoActReason,
    readonly params: Record<string, string | number> = {}
  ) {
    super(reason)
    this.name = "PoActError"
    this.status = STATUS[reason] ?? 409
  }
}

// ---------------------------------------------------------------------------
// The context an act runs in
// ---------------------------------------------------------------------------

/** The order link of an off-platform supplier: wave C mints a token, stores its hash and returns the URL; until then null. */
export type OrderLinkMinter = (db: Firestore, po: PurchaseOrder) => Promise<string | null>

export interface PoCtx {
  db: Firestore
  actor: ProcActor
  orgId: string
  orgName: string
  now: Date
  locale: "ar" | "en"
  policies: ResolvedPolicies
  /** The company's package switches that are off. */
  off: string[]
  mintOrderLink: OrderLinkMinter | null
}

/** The actor exactly as `useProcActor` builds it from the same permissions — the owner is the account whose uid is the company. */
export function actorOf(c: Pick<Caller, "uid" | "name" | "orgId" | "can">): ProcActor {
  const isOwner = c.uid === c.orgId
  const canPrepare = isOwner || c.can("offers.accept")
  const canApprove = isOwner || c.can("po.approve")
  return {
    uid: c.uid,
    name: c.name,
    isOwner,
    canApprove,
    canPrepare,
    canExpedite: isOwner || c.can("po.expedite") || canPrepare || canApprove,
    canReceive: isOwner || c.can("deliveries.confirm"),
    seesPrices: isOwner || c.can("offers.view") || canPrepare || canApprove,
  }
}

export async function readPolicies(db: Firestore, orgId: string): Promise<ResolvedPolicies> {
  const snap = await db.collection(PROCUREMENT_SETTINGS).doc(orgId).get()
  return resolvePolicies(snap.exists ? (snap.data() as Partial<ResolvedPolicies>) : null)
}

export async function poCtx(db: Firestore, caller: Pick<Caller, "uid" | "name" | "orgId" | "can">, extra: { now?: Date; locale?: "ar" | "en"; orgName?: string; mintOrderLink?: OrderLinkMinter | null } = {}): Promise<PoCtx> {
  const [policies, off] = await Promise.all([readPolicies(db, caller.orgId), offListOf(db, caller.orgId)])
  const profile = (await db.collection("users").doc(caller.orgId).get()).data() as { companyName?: string; name?: string } | undefined
  return {
    db,
    actor: actorOf(caller),
    orgId: caller.orgId,
    orgName: extra.orgName ?? profile?.companyName ?? profile?.name ?? caller.name,
    now: extra.now ?? new Date(),
    locale: extra.locale ?? "ar",
    policies,
    off,
    mintOrderLink: extra.mintOrderLink ?? null,
  }
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/

const asPo = (id: string, data: Record<string, unknown>): PurchaseOrder => ({ ...(data as Omit<PurchaseOrder, "id">), id })

const refOf = (db: Firestore, poId: string): DocumentReference => db.collection(PURCHASE_ORDERS).doc(poId)

const logEntry = (actor: Pick<ProcActor, "uid" | "name">, action: string, at: string, extra?: { note?: string | null; params?: PoLogEntry["params"] }): PoLogEntry =>
  ({ at, byId: actor.uid, byName: actor.name, action, note: extra?.note ?? null, params: extra?.params ?? null }) as PoLogEntry

const text = (s: string | null | undefined): string => (s || "").trim()

const decides = (a: ProcActor) => a.isOwner || a.canPrepare || a.canApprove

/** R-26: the owner reads somebody else's order; a buyer acts on the orders he prepared. */
function assertActs(po: Pick<PurchaseOrder, "preparedById">, actor: ProcActor): void {
  const a = poActs(po, actor)
  if (a.ownerReadOnly) throw new PoActError("owner_read_only")
  if (a.notMine) throw new PoActError("not_your_order")
}

/** Reads the order inside the transaction, for the caller's company only — another company's order does not exist here. */
async function readOrder(tx: Transaction, ctx: PoCtx, poId: string): Promise<{ ref: DocumentReference; po: PurchaseOrder }> {
  const ref = refOf(ctx.db, poId)
  const snap = await tx.get(ref)
  const data = snap.exists ? snap.data() : undefined
  if (!snap.exists || !data || data.organizationId !== ctx.orgId) throw new PoActError("order_missing")
  return { ref, po: asPo(snap.id, data) }
}

/** Queues a contract event (the outbox) in the act's own transaction — a second send of the same key is refused, not acted on twice. */
function queueEvent(tx: Transaction, ctx: PoCtx, id: ProcEventId, key: string, refs: ProcEvent["refs"], payload: ProcEvent["payload"]): void {
  const ev = buildProcEvent({ id, key, organizationId: ctx.orgId, off: ctx.off, by: ctx.actor.uid, at: ctx.now.toISOString(), refs, payload })
  if (ev) tx.create(ctx.db.collection(PROC_EVENTS).doc(procEventDocId(ev.organizationId, ev.key)), ev as unknown as Record<string, unknown>)
}

const commit = (tx: Transaction, ref: DocumentReference, po: PurchaseOrder, patch: Record<string, unknown>, log: PoLogEntry): PurchaseOrder => {
  const next = { ...po, ...patch, log: [...(po.log || []), log] } as PurchaseOrder
  tx.update(ref, { ...patch, log: next.log, updatedAt: FieldValue.serverTimestamp() })
  return next
}

type TellEvent = Parameters<typeof notifyNamed>[2]
type Permissions = NonNullable<NonNullable<Parameters<typeof notifyNamed>[4]>["permissions"]>

/** Best-effort: tells people about an act after it committed. */
async function tell(ctx: PoCtx, e: Omit<TellEvent, "organizationId">, users: (string | null | undefined)[], permissions: Permissions = []): Promise<void> {
  try {
    await notifyNamed(ctx.db, { uid: ctx.actor.uid, name: ctx.actor.name }, { ...e, organizationId: ctx.orgId }, users, { permissions, owner: false })
  } catch (err) {
    console.warn("po notice not sent:", (err as { code?: string })?.code || err)
  }
}

const refsOf = (po: PurchaseOrder): ProcEvent["refs"] => ({ po: po.docNumber, rfq: po.rfqId, offer: po.offerId })

const eventBase = (po: PurchaseOrder) => ({ poId: po.id, rfqId: po.rfqId, offerId: po.offerId })

/** The supplier's side of a notice: his user and his company's owner, who reads it in the supplier portal. */
const supplierSide = (po: PurchaseOrder): string[] => [...new Set([po.supplierUserId, po.supplierOrgId].filter((u): u is string => Boolean(u) && u !== "guest"))]

// ---------------------------------------------------------------------------
// What the approval reads besides the order
// ---------------------------------------------------------------------------

async function ordersOf(db: Firestore, orgId: string): Promise<PurchaseOrder[]> {
  const snap = await db.collection(PURCHASE_ORDERS).where("organizationId", "==", orgId).get()
  return snap.docs.map((d) => asPo(d.id, d.data() as Record<string, unknown>))
}

/** The supplier's platform facts, with our own record laid over them — the way the approval screen reads them. Null for a guest. */
export async function supplierFactsOf(db: Firestore, orgId: string, po: Pick<PurchaseOrder, "isGuestSupplier" | "supplierOrgId">): Promise<SupplierFacts | null> {
  if (po.isGuestSupplier || !po.supplierOrgId || po.supplierOrgId === "guest") return null
  try {
    let snap = await db.collection("users").doc(po.supplierOrgId).get()
    if (!snap.exists) snap = await db.collection("organizations").doc(po.supplierOrgId).get()
    const pub = snap.exists ? ((await db.collection(COMPANY_PUBLIC_FACTS).doc(po.supplierOrgId).get().catch(() => null))?.data() as Parameters<typeof supplierFactsFromProfile>[2]) : undefined
    const base = supplierFactsFromProfile(po.supplierOrgId, snap.exists ? (snap.data() as Parameters<typeof supplierFactsFromProfile>[1]) : null, pub)
    const record = await db.collection(SUPPLIER_RECORDS).doc(supplierRecordId(orgId, po.supplierOrgId)).get()
    return supplierFactsWithRecord(base, record.exists ? (record.data() as SupplierRecord) : null)
  } catch (err) {
    console.warn("supplier facts not read:", (err as { code?: string })?.code || err)
    return { orgId: po.supplierOrgId, hasVatNumber: null, verified: null, crExpiry: null }
  }
}

async function boqItemsOf(db: Firestore, po: PurchaseOrder): Promise<BoqGateItem[]> {
  const ids = gateItemIds(po)
  if (!ids.length || !po.projectId) return []
  const out: BoqGateItem[] = []
  for (const id of ids) {
    try {
      const snap = await db.collection("projects").doc(po.projectId).collection("boqItems").doc(id).get()
      if (snap.exists) out.push({ ...(snap.data() as Omit<BoqGateItem, "id">), id })
    } catch {
      // an unreadable line gates nothing, as in the client
    }
  }
  return out
}

/** A direct award above the cap skipped competition: it carries its reason and the owner alone approves it (G-16, R-36). */
export const directOverCap = (po: PurchaseOrder, policies: Pick<ResolvedPolicies, "directPurchaseCap">): boolean => Boolean(po.tags?.directOver) || (po.basis === "direct" && !po.agreementId && poValue(po) > policies.directPurchaseCap)

const directReason = (po: PurchaseOrder): string => text(po.tags?.directOver?.why) || text(po.awardReasonText)

// ---------------------------------------------------------------------------
// Approve — the limit INCLUDING VAT (G-18), never the preparer's own, the owner alone above the limit and for a direct order
// above the cap. `asOwner` is «اعتمده الآن بصفتك المالك» of the award window: refused for anyone who is not the owner.
// ---------------------------------------------------------------------------

export interface ApproveInput {
  poId: string
  asOwner?: boolean
  /** R-32: the preparer issues his OWN direct order at or under the company's self-issue limit — no approver, flagged on the order. */
  selfIssue?: boolean
}

const REFUSAL_REASON: Record<string, PoActReason> = { not_awaiting: "wrong_state", no_permission: "no_permission", own_order: "own_order", owner_only_retroactive: "owner_only", above_limit: "above_limit" }

/** The award window offers «اعتمده الآن»: only the owner may press it (the manager's own order always goes to a second hand, PRD §Permissions). */
export const approveOnAwardAllowed = (actor: Pick<ProcActor, "isOwner">): boolean => actor.isOwner

export async function approveOrder(ctx: PoCtx, input: ApproveInput): Promise<PurchaseOrder> {
  const { db, actor, policies, now } = ctx
  if (input.asOwner && !actor.isOwner) throw new PoActError("owner_only")
  const at = now.toISOString()
  const pre = await refOf(db, input.poId).get()
  const preData = pre.exists ? pre.data() : undefined
  if (!pre.exists || !preData || preData.organizationId !== ctx.orgId) throw new PoActError("order_missing")
  const first = asPo(pre.id, preData)
  const [others, supplier, pmOn, receivers] = await Promise.all([
    ordersOf(db, ctx.orgId),
    supplierFactsOf(db, ctx.orgId, first),
    projectsOn(db, ctx.orgId),
    noticeReachesReceiver(policies) ? permissionHolders(db, ctx.orgId, ["deliveries.confirm"]).catch(() => [] as string[]) : Promise.resolve(null),
  ])
  const items = pmOn ? await boqItemsOf(db, first) : []
  const hasRecord = supplierHasRecord(first, others)

  const po = await db.runTransaction(async (tx) => {
    const { ref, po } = await readOrder(tx, ctx, input.poId)
    if (input.selfIssue) {
      const why = selfIssueRefusal(po, actor, policies.buyerSelfIssueLimit, 0)
      if (why === "over_limit") throw new PoActError("above_limit", { value: poValue(po), limit: policies.buyerSelfIssueLimit })
      if (why) throw new PoActError(why === "no_permission" || why === "not_preparer" ? "no_permission" : "wrong_state")
    }
    const refusal = input.selfIssue ? null : approvalRefusal(po, actor, policies)
    if (refusal) throw new PoActError(REFUSAL_REASON[refusal.code] || "wrong_state", refusal.params)
    if (directOverCap(po, policies)) {
      if (!actor.isOwner) throw new PoActError("owner_only")
      if (!directReason(po)) throw new PoActError("reason_required")
    }
    const blocks = poBlocks(po, { supplier, otherOrders: others, policies, now } satisfies BlockContext)
    if (blocks.length) throw new PoActError("blocked", { codes: blocks.map((b) => b.code).join(",") })
    const gates = approvalGateBlocks(po as PurchaseOrderX, items, others, !pmOn)
    if (gates.length) throw new PoActError(gates[0].code, gates[0].params)
    const retro = po.basis === "retroactive"
    const advance = (Number((po as PurchaseOrderX).advancePercent) || 0) > 0
    const needsOwner = !retro && advance && advanceOwnerRequired(po, policies, hasRecord)
    const patch: Record<string, unknown> = {
      status: retro ? "accepted" : "approved",
      approvedById: actor.uid,
      approvedByName: actor.name,
      approvedAt: at,
      returnedReason: null,
      ver: po.ver ?? 1,
      closeOn: closeOnFor(ctx.off),
      ...(input.selfIssue ? { selfIssued: true } : {}),
      ...(retro ? { supplierAcceptedAt: at, acceptanceRecordedBy: "buyer" } : {}),
      ...(receivers && receivers.length && !retro ? { noticeCopyTo: receivers } : {}),
      ...(po.dueDate || retro ? {} : { dueDate: poDueDate(riyadhDay(now), policies.supplierAcceptanceDays, po.leadTimeDays) }),
      ...(needsOwner ? { advanceOwner: { required: true, approvedAt: null } } : {}),
    }
    const next = commit(tx, ref, po, patch, logEntry(actor, "approved", at, { params: input.selfIssue ? { selfIssued: 1, limit: policies.buyerSelfIssueLimit } : po.preparedById === actor.uid ? { selfApproved: 1 } : null }))
    queueEvent(tx, ctx, "fin_commitment", commitmentKey(po.docNumber, 1), refsOf(po), { total: approvalAmount(po), vatRate: po.vatRate })
    queueEvent(tx, ctx, "po_inbound", poInboundKey(po.docNumber, 1), refsOf(po), { lines: po.lines.length })
    if (advance && !needsOwner && !retro) queueEvent(tx, ctx, "fin_advance_request", advanceRequestKey(advanceNumber(po)), refsOf(po), { amount: advanceAmount(next as PurchaseOrderX) })
    return next
  })
  return afterApproval(ctx, po)
}

/** What an approval sets off: Finance's commitment and the receivers' heads-up, the price history, and the order on its way to the supplier. */
async function afterApproval(ctx: PoCtx, po: PurchaseOrder): Promise<PurchaseOrder> {
  const { policies, locale } = ctx
  const amount = sarText(poValue(po), locale)
  await tell(ctx, { kind: "po_approved", params: { number: po.docNumber, supplier: po.supplierName, amount }, ...eventBase(po) }, [po.preparedById], ["invoices.manage"])
  if (po.basis === "retroactive") return po
  await tell(ctx, { kind: "po_expected_arrival", params: { number: po.docNumber, supplier: po.supplierName, lines: po.lines.length }, ...eventBase(po), link: "/contractor/goods-received" }, [], ["deliveries.confirm"])
  await recordApprovedPrices(ctx, po)
  if (policies.sendOnApproval && !po.isGuestSupplier && po.supplierUserId) {
    try {
      return (await sendOrder(ctx, { poId: po.id, channel: "portal" }, { viaApproval: true })).po
    } catch (err) {
      console.warn("order approved but not sent on the portal:", (err as { reason?: string })?.reason || err)
    }
  }
  await tell(ctx, { kind: "po_ready_to_send", params: { number: po.docNumber, supplier: po.supplierName }, ...eventBase(po) }, [po.preparedById], ["po.expedite"])
  return po
}

/** The approved prices enter the price history (PH) — a piece line's price is per piece, so it is left out: the history compares like with like. */
async function recordApprovedPrices(ctx: PoCtx, po: PurchaseOrder): Promise<void> {
  const rows = historyRowsForApproval(po, ctx.now.toISOString()).filter((r) => !po.lines.find((l) => `${po.id}__${l.id}` === r.id)?.pk)
  await Promise.all(
    rows.map(({ id, ...row }) =>
      ctx.db
        .collection(PRICE_HISTORY)
        .doc(id)
        .set(row)
        .catch((err: unknown) => console.warn("price history not recorded:", (err as { code?: string })?.code || err))
    )
  )
}

// ---------------------------------------------------------------------------
// Return
// ---------------------------------------------------------------------------

export async function returnOrder(ctx: PoCtx, input: { poId: string; reason: string }): Promise<PurchaseOrder> {
  const { actor, now } = ctx
  if (!actor.isOwner && !actor.canApprove) throw new PoActError("no_permission")
  const reason = text(input.reason)
  if (!reason) throw new PoActError("reason_required")
  const at = now.toISOString()
  const po = await ctx.db.runTransaction(async (tx) => {
    const { ref, po } = await readOrder(tx, ctx, input.poId)
    if (po.status !== "awaiting_approval") throw new PoActError("wrong_state")
    return commit(tx, ref, po, { returnedReason: reason }, logEntry(actor, "returned", at, { note: reason }))
  })
  await tell(ctx, { kind: "po_returned", params: { number: po.docNumber, reason }, ...eventBase(po) }, [po.preparedById])
  return po
}

// ---------------------------------------------------------------------------
// Send — a registered supplier gets it in his portal; an off-platform one gets the order LINK in a message written from the
// buyer's own device (no integration, B-08). G-16: nothing is sent before it is approved.
// ---------------------------------------------------------------------------

export type SendChannelInput = PoSendChannel | "outside"

export async function sendOrder(ctx: PoCtx, input: { poId: string; channel: SendChannelInput; contact?: SendContact | null }, opts: { viaApproval?: boolean } = {}): Promise<{ po: PurchaseOrder; link: string | null }> {
  const { actor, now } = ctx
  if (!(actor.isOwner || actor.canExpedite || actor.canPrepare || actor.canApprove)) throw new PoActError("no_permission")
  const at = now.toISOString()
  const po = await ctx.db.runTransaction(async (tx) => {
    const { ref, po } = await readOrder(tx, ctx, input.poId)
    if (!opts.viaApproval) assertActs(po, actor)
    if (!canSend(po) || !po.approvedAt) throw new PoActError("wrong_state")
    if (input.channel === "portal" && (po.isGuestSupplier || !po.supplierUserId)) throw new PoActError("no_portal")
    const first = { n: 1, at, byId: actor.uid, byName: actor.name, kind: "sent" as const }
    const patch = {
      status: "sent",
      sentAt: at,
      sentById: actor.uid,
      sentByName: actor.name,
      sentChannel: input.channel === "outside" ? null : input.channel,
      ver: po.ver ?? 1,
      versions: po.versions?.length ? po.versions : [first],
    }
    const next = commit(tx, ref, po, patch, logEntry(actor, "sent", at, { params: input.channel === "outside" ? { outside: 1 } : { channel: input.channel } }))
    queueEvent(tx, ctx, "po_version", poVersionKey(po.docNumber, 1), refsOf(po), { kind: "sent", channel: input.channel })
    return next
  })
  if (po.supplierUserId && input.channel === "portal") {
    await tell(ctx, { kind: "po_sent", params: { number: po.docNumber, company: ctx.orgName }, ...eventBase(po), supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId } }, supplierSide(po))
  }
  const patch = input.channel === "outside" ? null : sendContactPatch(input.channel as PoSendChannel, input.contact, actor, at)
  if (patch && !po.isGuestSupplier && po.supplierOrgId && po.supplierOrgId !== "guest") {
    await ctx.db
      .collection(SUPPLIER_RECORDS)
      .doc(supplierRecordId(po.organizationId, po.supplierOrgId))
      .set({ organizationId: po.organizationId, supplierOrgId: po.supplierOrgId, supplierName: po.supplierName, ...patch }, { merge: true })
      .catch((err: unknown) => console.warn("supplier contact not saved:", (err as { code?: string })?.code || err))
  }
  let link: string | null = null
  if ((input.channel === "whatsapp" || input.channel === "email") && ctx.mintOrderLink) {
    try {
      link = await ctx.mintOrderLink(ctx.db, po)
    } catch (err) {
      console.warn("order link not minted:", (err as { code?: string })?.code || err)
    }
  }
  return { po, link }
}

/** The order link's address once a token exists — wave C's `/po/<token>` page. The placeholder route constant lives here so the composer and the message agree. */
export const PO_LINK_PATH = "/po"
export const poLinkUrl = (token: string): string => linkUrl("po", token)

// ---------------------------------------------------------------------------
// Cancel — a structured reason, and what happens to its materials (WF-25). The re-award / return-to-Incoming mechanics are wave C's:
// this records the choice on the order with its version and calls the typed hook, so nothing is lost meanwhile.
// ---------------------------------------------------------------------------

export const CANCEL_WHY = ["nacc", "dec", "chg", "need", "other"] as const
export type CancelWhy = (typeof CANCEL_WHY)[number]
export const CANCEL_THEN = ["reaward", "back", "none"] as const
export type CancelThen = (typeof CANCEL_THEN)[number]

/** The listed reasons in the words the supplier and the log read — the buyer's own words win when he wrote some. */
export const CANCEL_WHY_TEXT: Record<"ar" | "en", Record<CancelWhy, string>> = {
  ar: { nacc: "لم يقبله المورد في مهلته", dec: "اعتذر المورّد", chg: "طلب تعديلاً لا نقبله", need: "لم تعد الحاجة قائمة", other: "سبب آخر" },
  en: { nacc: "He did not accept in time", dec: "The supplier declined", chg: "Asked for a change we refuse", need: "No longer needed", other: "Other" },
}

export interface CancelInput {
  poId: string
  why: CancelWhy
  note?: string | null
  then: CancelThen
}

/** «ألغِ الأمر»: wave C's hook receives the cancelled order and the buyer's choice about its materials. */
export type OnCancel = (db: Firestore, po: PurchaseOrder, choice: { then: CancelThen; why: CancelWhy; version: number }) => Promise<void>

export async function cancelOrder(ctx: PoCtx, input: CancelInput, onCancel: OnCancel | null = null): Promise<PurchaseOrder> {
  const { actor, now } = ctx
  if (!decides(actor)) throw new PoActError("no_permission")
  const note = text(input.note)
  if (input.why === "other" && note.length < 4) throw new PoActError("reason_required")
  const at = now.toISOString()
  const po = await ctx.db.runTransaction(async (tx) => {
    const { ref, po } = await readOrder(tx, ctx, input.poId)
    assertActs(po, actor)
    if (po.status === "cancelled") throw new PoActError("already_cancelled")
    if (po.status === "closed") throw new PoActError("wrong_state")
    if (po.lines.some((l) => Number(l.accepted) > 0 || Number(l.held) > 0)) throw new PoActError("has_receipts")
    if (input.then === "reaward" && (!po.rfqId || !po.offerId)) throw new PoActError("no_rfq")
    // Materials that came from a request would be left in the air: they must go back (or be re-awarded), never "nothing".
    if (input.then === "none" && po.purchaseSource) throw new PoActError("items_pending")
    const v = nextVersionPatch(po, "cancel", actor, at, { note: note || null, params: { why: input.why, then: input.then } })
    const reasonText = note || CANCEL_WHY_TEXT[ctx.locale][input.why]
    const next = commit(
      tx,
      ref,
      po,
      { status: "cancelled", cancelledReason: reasonText, cancelChoice: { why: input.why, then: input.then, at, byName: actor.name, version: v.ver, resolved: false }, ver: v.ver, versions: v.versions },
      logEntry(actor, "cancelled", at, { note: reasonText, params: { from: po.status, why: input.why, then: input.then, ver: v.ver } })
    )
    if (po.approvedAt) {
      queueEvent(tx, ctx, "po_version", poVersionKey(po.docNumber, v.ver), refsOf(po), { kind: "cancel", why: input.why })
      queueEvent(tx, ctx, "fin_commitment", commitmentKey(po.docNumber, v.ver), refsOf(po), { total: 0, cancelled: true })
      queueEvent(tx, ctx, "po_inbound", poInboundKey(po.docNumber, v.ver), refsOf(po), { cancelled: true })
    }
    return next
  })
  const reached = Boolean(po.sentAt)
  await tell(
    ctx,
    { kind: "po_cancelled", params: { number: po.docNumber, supplier: po.supplierName, reason: text(po.cancelledReason) }, ...eventBase(po), supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId } },
    [po.preparedById, reached ? po.supplierUserId : null, reached ? po.supplierOrgId : null],
    po.approvedAt ? ["invoices.manage", "deliveries.confirm"] : []
  )
  if (onCancel) {
    try {
      await onCancel(ctx.db, po, { then: input.then, why: input.why, version: poVer(po) })
    } catch (err) {
      console.warn("cancel hook failed:", (err as { code?: string })?.code || err)
    }
  }
  return po
}

// ---------------------------------------------------------------------------
// Close short — «أقفله بما استُلم»: a new version, and the supplier is told
// ---------------------------------------------------------------------------

export async function closeShort(ctx: PoCtx, input: { poId: string; reason: string }): Promise<PurchaseOrder> {
  const { actor, now } = ctx
  if (!decides(actor)) throw new PoActError("no_permission")
  const reason = text(input.reason)
  if (!reason) throw new PoActError("reason_required")
  const at = now.toISOString()
  const po = await ctx.db.runTransaction(async (tx) => {
    const { ref, po } = await readOrder(tx, ctx, input.poId)
    assertActs(po, actor)
    if (po.status !== "accepted" || !closeIsShort(po)) throw new PoActError("wrong_state")
    const v = nextVersionPatch(po, "close_short", actor, at, { note: reason })
    const next = commit(tx, ref, po, { status: "closed", closedAt: at, closedShort: true, closeReason: reason, ver: v.ver, versions: v.versions }, logEntry(actor, "closed", at, { note: reason, params: { short: 1, ver: v.ver } }))
    queueEvent(tx, ctx, "po_version", poVersionKey(po.docNumber, v.ver), refsOf(po), { kind: "close_short" })
    queueEvent(tx, ctx, "fin_commitment", commitmentKey(po.docNumber, v.ver), refsOf(po), { total: poValue(next), closedShort: true })
    return next
  })
  await tell(ctx, { kind: "po_closed", params: { number: po.docNumber, outcome: "@pn_po_closed_short_flag", reason }, ...eventBase(po), supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId } }, [po.preparedById, ...supplierSide(po)], ["invoices.manage"])
  return po
}

// ---------------------------------------------------------------------------
// The supplier's new date — a version he accepts
// ---------------------------------------------------------------------------

export async function changeDate(ctx: PoCtx, input: { poId: string; date: string; note?: string | null }): Promise<PurchaseOrder> {
  const { actor, now } = ctx
  if (!(actor.isOwner || actor.canExpedite || actor.canPrepare || actor.canApprove)) throw new PoActError("no_permission")
  if (!DAY.test(input.date)) throw new PoActError("date_invalid")
  const note = text(input.note) || null
  const at = now.toISOString()
  const po = await ctx.db.runTransaction(async (tx) => {
    const { ref, po } = await readOrder(tx, ctx, input.poId)
    assertActs(po, actor)
    if (!canUpdateDate(po)) throw new PoActError("wrong_state")
    const v = nextVersionPatch(po, "date", actor, at, { note, params: { from: po.promisedDate || "", date: input.date } })
    const next = commit(tx, ref, po, { promisedDate: input.date, ver: v.ver, versions: v.versions }, logEntry(actor, "date_updated", at, { note, params: { from: po.promisedDate || "", date: input.date, ver: v.ver } }))
    queueEvent(tx, ctx, "po_version", poVersionKey(po.docNumber, v.ver), refsOf(po), { kind: "date", date: input.date })
    return next
  })
  await tell(ctx, { kind: "po_date_updated", params: { number: po.docNumber, supplier: po.supplierName, date: input.date, note: note || "" }, ...eventBase(po), supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId } }, [po.preparedById, ...supplierSide(po)], ["deliveries.confirm"])
  return po
}

// ---------------------------------------------------------------------------
// A rejected quantity is a decision with the supplier: replace · discount · return
// ---------------------------------------------------------------------------

export interface RejectDecisionInput {
  poId: string
  lineId: string
  decision: RejectDecision
  note?: string | null
  replaceBy?: string | null
  discountPrice?: number | null
}

export async function decideRejected(ctx: PoCtx, input: RejectDecisionInput): Promise<PurchaseOrder> {
  const { actor, now } = ctx
  if (!decides(actor)) throw new PoActError("no_permission")
  const at = now.toISOString()
  const note = text(input.note) || null
  const replaceBy = input.decision === "replace" && input.replaceBy ? input.replaceBy : null
  if (replaceBy && !DAY.test(replaceBy)) throw new PoActError("date_invalid")
  const discountPrice = input.decision === "discount" ? Number(input.discountPrice) : null
  if (input.decision === "discount" && !(Number.isFinite(discountPrice) && (discountPrice as number) > 0)) throw new PoActError("price_missing")
  let lineName = ""
  let qty = 0
  let n = 1
  const po = await ctx.db.runTransaction(async (tx) => {
    const { ref, po } = await readOrder(tx, ctx, input.poId)
    assertActs(po, actor)
    if (po.status !== "accepted") throw new PoActError("wrong_state")
    const line = po.lines.find((l) => l.id === input.lineId)
    if (!line) throw new PoActError("line_missing")
    if (!(Number(line.rejected) > 0)) throw new PoActError("nothing_rejected")
    lineName = line.name
    qty = line.rejected
    n = (po.log || []).filter((e) => e.action === "reject_decided").length + 1
    const params: Record<string, string | number> = { line: line.name, lineId: line.id, qty: line.rejected, decision: input.decision }
    if (replaceBy) params.replaceBy = replaceBy
    if (discountPrice != null) params.price = discountPrice
    const next = commit(tx, ref, po, { lines: applyRejectDecision(po.lines, input.lineId, input.decision, note, at, { replaceBy, discountPrice }) }, logEntry(actor, "reject_decided", at, { note, params }))
    queueEvent(tx, ctx, "po_reject", poRejectKey(po.docNumber, n), refsOf(po), { line: line.id, decision: input.decision })
    return next
  })
  await tell(
    ctx,
    { kind: "po_rejects_decided", params: { number: po.docNumber, company: ctx.orgName, line: lineName, qty, decision: `@pn_po_decision_${input.decision}`, note: [replaceBy, note].filter(Boolean).join(" — ") }, ...eventBase(po), supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId } },
    [...supplierSide(po)],
    input.decision === "discount" ? ["invoices.manage", "warehouses.manage", "deliveries.confirm"] : ["invoices.manage"]
  )
  return po
}

// ---------------------------------------------------------------------------
// An advance to a supplier with no supply record: the owner approves it BEFORE it is asked for (PO-14)
// ---------------------------------------------------------------------------

export async function approveAdvance(ctx: PoCtx, input: { poId: string }): Promise<PurchaseOrder> {
  const { actor, now } = ctx
  if (!actor.isOwner) throw new PoActError("owner_only")
  const at = now.toISOString()
  const po = await ctx.db.runTransaction(async (tx) => {
    const { ref, po } = await readOrder(tx, ctx, input.poId)
    if (po.status === "cancelled" || po.status === "closed" || po.status === "awaiting_approval") throw new PoActError("wrong_state")
    if (!advanceNeedsOwner(po)) throw new PoActError("advance_not_waiting")
    const next = commit(tx, ref, po, { advanceOwner: { required: true, approvedAt: at, approvedById: actor.uid, approvedByName: actor.name } }, logEntry(actor, "advance_owner_approved", at))
    queueEvent(tx, ctx, "fin_advance_request", advanceRequestKey(advanceNumber(po)), refsOf(po), { amount: advanceAmount(next as PurchaseOrderX) })
    return next
  })
  await tell(ctx, { kind: "po_advance_reminder", params: { number: po.docNumber, supplier: po.supplierName, amount: sarText(advanceAmount(po as PurchaseOrderX), ctx.locale), percent: Number((po as PurchaseOrderX).advancePercent) || 0 }, ...eventBase(po) }, [po.preparedById], ["invoices.manage"])
  return po
}

// ---------------------------------------------------------------------------
// The supplier accepts a version (`proc:PO:<no>:V<n>:ACC`) — from his portal; the order link does the same through `acceptVersionOf`
// ---------------------------------------------------------------------------

export interface SupplierSide {
  uid: string
  name: string
  orgId: string
}

export async function acceptVersion(db: Firestore, who: SupplierSide, input: { poId: string; version: number }, now: Date = new Date()): Promise<PurchaseOrder> {
  const at = now.toISOString()
  const ref = refOf(db, input.poId)
  const off = await (async () => {
    const snap = await ref.get()
    return snap.exists ? offListOf(db, String(snap.data()?.organizationId || "")) : []
  })()
  const po = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? snap.data() : undefined
    if (!snap.exists || !data) throw new PoActError("order_missing")
    const po = asPo(snap.id, data)
    if (po.supplierOrgId === "guest" || (po.supplierOrgId !== who.orgId && po.supplierUserId !== who.uid)) throw new PoActError("not_your_order")
    const open = pendingVersion(po)
    if (!open || open.n !== input.version) throw new PoActError("version_missing")
    const versions = poVersions(po).map((v) => (v.n === open.n ? { ...v, acceptedAt: at, acceptedByName: who.name } : v))
    const next = commit(tx, ref, po, { versions }, logEntry(who, "version_accepted", at, { params: { ver: open.n } }))
    const ev = buildProcEvent({ id: "po_accept", key: poAcceptKey(po.docNumber, open.n), organizationId: po.organizationId, off, by: who.uid, at, refs: refsOf(po), payload: { version: open.n } })
    if (ev) tx.create(db.collection(PROC_EVENTS).doc(procEventDocId(ev.organizationId, ev.key)), ev as unknown as Record<string, unknown>)
    return next
  })
  try {
    await notifyNamed(db, who, { kind: "po_supplier_accepted", organizationId: po.organizationId, params: { number: po.docNumber, supplier: po.supplierName, date: po.promisedDate || "" }, poId: po.id, rfqId: po.rfqId, offerId: po.offerId }, [po.preparedById, po.sentById])
  } catch (err) {
    console.warn("version acceptance not told:", (err as { code?: string })?.code || err)
  }
  return po
}
