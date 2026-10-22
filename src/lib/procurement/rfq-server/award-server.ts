// The award, on the server (Procurement 2.0 WF-12/13, CMP-06…12, G-04/05/14/16/18, NFR-01). The browser sends WHICH offer version won
// WHICH line and the reasons it gives; it never sends a price, a total or a pack. Everything else is re-read here inside ONE
// Admin transaction and planned again by `planAward` — the same pure function the review dialog shows live:
// the RFQ's state, every offer's stored version, the buyer's decisions, the lines already carried by a live order, the reasons.
// In that one transaction: one order per supplier × delivery site, the winners' `مقبول` with the lines they won, every other
// bidder's result, the RFQ `Awarded` (and, when it was still open, closed early with the date), the project requests told which
// order answers them. After the commit (best-effort, each its own try): the orders that are approved by policy or by the owner
// right now go through the order's approve route, the bidders and the invitees who did not bid are told, the request lines nobody
// won return to «الواردة».

import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore"
import { z } from "zod"
import { riyadhDay } from "@/lib/hr/format"
import { notifyNamed } from "@/lib/supplier-free/server-notify"
import { formatYearlyDocNumber } from "@/lib/sales-numbering"
import { awardLinkPatch, rfqProjectRequests, type AwardedOrder, type AwardedRfq, type ProjectRequestDoc, type ServedRequest } from "../needs"
import { rfqOutcomeKey } from "../event-keys"
import { type ProcEventKind, sarText } from "../events"
import { syncIncoming } from "../incoming-server"
import { isWithdrawnOffer } from "../award"
import { OFFER_DECISIONS, type DecisionMap } from "../offer-decisions"
import { fromHalalas } from "../offer-calc"
import { LOW_COMP_AR, AWARD_WHY_AR, draftOrder, offerIsOut, planAward, planSupplier, reasonText, type AwardPlan, type PinnedPick, type PlanActor, type PlanOffer, type PlanRfq, type PlanRefusalCode, type PlannedGroup } from "../award-plan"
import { approveOrder, poCtx, PoActError, type PoCtx } from "../po-server"
import { supplierKey as poSupplierKey, supplierScore } from "../po"
import { resolvePolicies } from "../policies"
import { rfqLogEntry, type RfqLogEntry } from "../rfq-detail"
import { awardsOnRfq } from "../rfq-access"
import { sendProcEvent, rfqKeyPart } from "../proc-event-server"
import { storedSites } from "../delivery-sites"
import { PROCUREMENT_SETTINGS, PURCHASE_ORDERS, type PoSite, type PurchaseOrder, type ReceiptFact } from "../types"
import { addDays } from "../po"
import { runnerOf, str, type RfqCaller, type Rec } from "./common"
import { listLiveOrdersOf } from "./award-locks"

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export type AwardRefusalCode = PlanRefusalCode | "no_permission" | "rfq_missing" | "rfq_not_open" | "not_yours" | "direct_offer_missing" | "direct_not_allowed"

const STATUS: Partial<Record<AwardRefusalCode, number>> = {
  no_permission: 403,
  not_yours: 403,
  approve_not_owner: 403,
  rfq_missing: 404,
  offer_missing: 404,
  direct_offer_missing: 404,
  rfq_not_open: 409,
  offer_changed: 409,
  offer_excluded: 409,
  offer_taken: 409,
  line_locked: 409,
  offer_expired: 422,
  line_not_covered: 422,
  lump_partial: 422,
  whole_partial: 422,
  nothing_picked: 422,
  reason_required: 422,
  reason_untrue: 422,
  reason_text_short: 422,
  lowcomp_reason_required: 422,
  guest_unregistered: 422,
  direct_not_allowed: 409,
}

export class AwardError extends Error {
  readonly status: number
  constructor(
    readonly code: AwardRefusalCode,
    readonly params: Record<string, string | number> = {}
  ) {
    super(code)
    this.name = "AwardError"
    this.status = STATUS[code] ?? 400
  }
}

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

const id = z.string().trim().min(1).max(128)
const reason = z.object({ code: z.string().trim().min(1).max(40), text: z.string().trim().max(500).nullish() })

export const awardSchema = z.object({
  rfqId: id,
  picks: z.array(z.object({ li: z.number().int().min(0).max(500), offerId: id, rev: z.number().int().min(1).max(10_000) })).max(500),
  why: reason.nullish(),
  lowComp: reason.nullish(),
  approveNow: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  lossReason: z.enum(["price", "time", "spec"]).nullish(),
  acceptGuest: z.boolean().default(false),
  budgetReason: z.string().trim().max(500).nullish(),
  /** The editor's direct award: the accepted offer it created, ordered here so no browser creates an order. */
  direct: z.object({ offerId: id, reason: z.string().trim().max(300).nullish() }).nullish(),
  locale: z.enum(["ar", "en"]).optional(),
})
export type AwardInput = z.infer<typeof awardSchema>

export interface AwardedOrderOut {
  id: string
  docNumber: string
  offerId: string
  key: string
  /** `sent`: approved and on its way · `waiting`: it waits for the approver, with the reason. */
  state: "sent" | "approved" | "waiting"
  waitingFor?: "owner" | "manager" | string
}

export interface AwardResult {
  orders: AwardedOrderOut[]
  /** Ex-VAT, riyals. */
  total: number
  closedEarly: boolean
  unawarded: number[]
  round: number
  budgetReason: string | null
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const asOffer = (snap: { id: string; data: () => unknown }): PlanOffer => ({ ...(snap.data() as Omit<PlanOffer, "id">), id: snap.id })

const asPo = (snap: { id: string; data: () => unknown }): PurchaseOrder => ({ ...(snap.data() as Omit<PurchaseOrder, "id">), id: snap.id })

/** The numbers drawn from the yearly sequence INSIDE the transaction, as the client-side `drawProcDocNumbers` did. */
async function drawPoNumbers(db: Firestore, tx: Transaction, orgId: string, count: number, year: number): Promise<{ numbers: string[]; write: () => void }> {
  const ref = db.collection("mfgCounters").doc(`${orgId}__PO__${year}`)
  const snap = await tx.get(ref)
  const last = snap.exists ? Number(snap.data()?.last) || 0 : 0
  return {
    numbers: Array.from({ length: count }, (_, k) => formatYearlyDocNumber("PO", year, last + k + 1)),
    write: () => void tx.set(ref, { organizationId: orgId, type: "PO", year, last: last + count, updatedAt: FieldValue.serverTimestamp() }),
  }
}

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

interface Served {
  served: ServedRequest
  ref: DocumentReference
  request: ProjectRequestDoc
}

/** The project requests the RFQ answers, read before the first write; one on a closed project, or unreadable, is left alone. */
async function readServed(db: Firestore, tx: Transaction, rfq: AwardedRfq): Promise<Served[]> {
  const out: Served[] = []
  const open = new Map<string, boolean>()
  for (const served of rfqProjectRequests(rfq)) {
    try {
      if (!open.has(served.projectId)) {
        const project = await tx.get(db.collection("projects").doc(served.projectId))
        open.set(served.projectId, project.exists && (project.data() as { pm?: { lifecycle?: string | null } | null }).pm?.lifecycle !== "closed")
      }
      if (!open.get(served.projectId)) continue
      const ref = db.collection("projects").doc(served.projectId).collection("purchaseRequests").doc(served.purchaseRequestId)
      const snap = await tx.get(ref)
      if (snap.exists) out.push({ served, ref, request: { ...(snap.data() as Omit<ProjectRequestDoc, "id">), id: snap.id } })
    } catch (err) {
      console.warn("project request not read for the award:", (err as { code?: string })?.code || err)
    }
  }
  return out
}

interface World {
  orders: PurchaseOrder[]
  receipts: ReceiptFact[]
  sites: ReturnType<typeof storedSites>
  policies: ReturnType<typeof resolvePolicies>
}

async function readWorld(db: Firestore, orgId: string): Promise<World> {
  const [orders, deliveries, settings] = await Promise.all([
    db.collection(PURCHASE_ORDERS).where("organizationId", "==", orgId).get(),
    db.collection("deliveries").where("contractorOrgId", "==", orgId).get(),
    db.collection(PROCUREMENT_SETTINGS).doc(orgId).get(),
  ])
  const data = (settings.data() || {}) as Rec
  return {
    orders: orders.docs.map(asPo),
    receipts: deliveries.docs.map((d) => ({ ...(d.data() as Omit<ReceiptFact, "id">), id: d.id }) as unknown as ReceiptFact),
    sites: storedSites(data.deliverySites),
    policies: resolvePolicies(settings.exists ? (data as never) : null),
  }
}

function contextFor(world: World, actor: PlanActor, decisions: DecisionMap, locks: Awaited<ReturnType<typeof listLiveOrdersOf>>, today: string, now: Date) {
  const scores = new Map<string, number | null>()
  const onTimeOf = (o: PlanOffer): number | null => {
    const key = (() => {
      const s = planSupplier(o)
      return poSupplierKey({ supplierOrgId: s.supplierOrgId, supplierName: s.supplierName, isGuestSupplier: s.isGuestSupplier })
    })()
    if (!scores.has(key)) {
      const mine = world.orders.filter((p) => poSupplierKey(p) === key)
      scores.set(key, supplierScore(mine, world.receipts, now).onTimePercent)
    }
    return scores.get(key) ?? null
  }
  const hasRecord = (o: PlanOffer): boolean => {
    const s = planSupplier(o)
    const key = poSupplierKey({ supplierOrgId: s.supplierOrgId, supplierName: s.supplierName, isGuestSupplier: s.isGuestSupplier })
    return world.orders.some((p) => poSupplierKey(p) === key && p.status !== "cancelled" && Boolean(p.supplierAcceptedAt))
  }
  return { today, policies: world.policies, decisions, locked: locks.locked, liveOfferIds: locks.liveOfferIds, actor, onTimeOf, hasRecord }
}

const siteFor = (world: World, group: PlannedGroup): PoSite | null => {
  const s = group.site.id ? world.sites.find((x) => x.id === group.site.id) : null
  if (s) return { id: s.id, name: s.name, city: s.city || null, district: s.district || null, address: s.address || null, mapUrl: s.mapUrl || null, receiver: null }
  if (group.site.city || group.site.district) return { id: group.site.id, name: [group.site.city, group.site.district].filter(Boolean).join(" — "), city: group.site.city || null, district: group.site.district || null }
  return null
}

// ---------------------------------------------------------------------------
// The award
// ---------------------------------------------------------------------------

export async function runAward(db: Firestore, caller: RfqCaller, input: AwardInput, now: Date = new Date()): Promise<AwardResult> {
  const runner = runnerOf(caller)
  if (!runner.isOwner && !runner.canPrepare) throw new AwardError("no_permission")
  const at = now.toISOString()
  const today = riyadhDay(now)
  const year = Number(today.slice(0, 4))
  const world = await readWorld(db, caller.orgId)
  const actor: PlanActor = { uid: caller.uid, isOwner: runner.isOwner, canPrepare: runner.canPrepare, canApprove: runner.canApprove }
  const direct = Boolean(input.direct)
  const rfqRef = db.collection("rfqs").doc(input.rfqId)

  type Committed = {
    rfq: Rec & { id: string }
    offers: PlanOffer[]
    plan: AwardPlan
    orders: Array<{ id: string; docNumber: string; draft: ReturnType<typeof draftOrder>; group: PlannedGroup }>
    round: number
    early: boolean
    losers: PlanOffer[]
    winners: Map<string, PlanOffer>
    existing?: { id: string; docNumber: string }
  }

  const done = await db.runTransaction(async (tx): Promise<Committed> => {
    const rSnap = await tx.get(rfqRef)
    if (!rSnap.exists) throw new AwardError("rfq_missing")
    const rfq: Rec & { id: string } = { ...(rSnap.data() as Rec), id: rSnap.id }
    const org = str(rfq.organizationId) || str(rfq.contractorId)
    if (org !== caller.orgId) throw new AwardError("rfq_missing")
    if (!awardsOnRfq({ createdByUserId: str(rfq.createdByUserId), contractorId: str(rfq.contractorId) }, runner) && !(runner.isOwner || runner.canApprove)) throw new AwardError("not_yours")
    if (direct) {
      if (rfq.directAward !== true || str(rfq.status) !== "Awarded") throw new AwardError("direct_not_allowed")
    } else if (str(rfq.status) !== "New") throw new AwardError("rfq_not_open")

    const offerSnaps = await tx.get(db.collection("offers").where("rfqId", "==", input.rfqId))
    const offers = offerSnaps.docs.map(asOffer).filter((o) => str((o as unknown as Rec).contractorOrgId || org) === org)
    const decisionSnaps = await Promise.all(offers.map((o) => tx.get(db.collection(OFFER_DECISIONS).doc(o.id))))
    const decisions: DecisionMap = {}
    offers.forEach((o, i) => {
      if (decisionSnaps[i].exists) decisions[o.id] = decisionSnaps[i].data() as DecisionMap[string]
    })
    const locks = await listLiveOrdersOf(db, tx, input.rfqId)
    // Lines an earlier round let go (back to «الواردة») are not this round's to award.
    const released = Array.isArray(rfq.unawardedLines) ? (rfq.unawardedLines as number[]).filter((n) => Number.isInteger(n)) : []
    if (!direct) for (const li of released) if (!locks.locked[li]) locks.locked[li] = { poId: "", poNumber: "" }
    const served = await readServed(db, tx, rfq as AwardedRfq)

    const picks: PinnedPick[] = direct
      ? (() => {
          const o = offers.find((x) => x.id === input.direct?.offerId)
          if (!o) throw new AwardError("direct_offer_missing")
          if (!(o as unknown as Rec).directAward || str((o as unknown as Rec).poId)) {
            const existingId = str((o as unknown as Rec).poId)
            if (existingId) return []
            throw new AwardError("direct_offer_missing")
          }
          const lines = Array.isArray(rfq.products) && (rfq.products as unknown[]).length ? (rfq.products as unknown[]).map((_, i) => i) : [0]
          const rev = Array.isArray(o.versions) && o.versions.length ? o.versions.length : 1
          return lines.map((li) => ({ li, offerId: o.id, rev }))
        })()
      : input.picks

    if (direct && !picks.length) {
      const o = offers.find((x) => x.id === input.direct?.offerId) as PlanOffer
      return { rfq, offers, plan: null as never, orders: [], round: 0, early: false, losers: [], winners: new Map(), existing: { id: str((o as unknown as Rec).poId), docNumber: str((o as unknown as Rec).poNumber) } }
    }

    const ctx = contextFor(world, actor, decisions, locks, today, now)
    const plan = planAward({ rfq: rfq as unknown as PlanRfq, offers, picks, why: input.why, lowComp: input.lowComp, approveNow: input.approveNow, acceptGuest: input.acceptGuest || direct }, ctx)
    const hard: PlanRefusalCode[] = direct ? ["offer_missing", "offer_taken", "line_not_covered", "nothing_picked", "approve_not_owner"] : []
    const refusal = direct ? plan.refusals.find((r) => hard.includes(r)) ?? null : plan.refusal
    if (refusal) throw new AwardError(refusal)
    if (!plan.groups.length) throw new AwardError("nothing_picked")
    const directGroup = plan.groups.find((g) => g.approval === "direct_over")
    if (direct && directGroup && !str(input.direct?.reason).trim()) throw new AwardError("reason_required")

    const round = (Number(rfq.awardRound) || 0) + 1
    const early = !direct && plan.warnings.closesEarly
    const liveOffers = offers.filter((o) => !offerIsOut(o, decisions[o.id]))
    const lowestOfferTotal = (g: PlannedGroup): number | null => {
      if (g.lump) return plan.evaluation.lowestComplete?.netH != null ? fromHalalas(plan.evaluation.lowestComplete.netH) : null
      let sum = 0
      for (const l of g.lines) {
        const best = plan.evaluation.lines.find((x) => x.rfqProductIndex === l.li)?.bestH
        if (best == null) return null
        sum += best
      }
      return fromHalalas(sum)
    }
    const whyText = reasonText(input.why, AWARD_WHY_AR)
    const lowCompText = reasonText(input.lowComp, LOW_COMP_AR)
    const numbers = await drawPoNumbers(db, tx, caller.orgId, plan.groups.length, year)

    const winners = new Map<string, PlanOffer>()
    const drafts = plan.groups.map((g, k) => {
      const offer = offers.find((o) => o.id === g.offerId) as PlanOffer
      winners.set(offer.id, offer)
      const draft = draftOrder({
        rfq: rfq as unknown as PlanRfq,
        offer,
        group: g,
        plan,
        offersCount: liveOffers.length,
        lowestOfferTotal: lowestOfferTotal(g),
        why: input.why,
        lowComp: input.lowComp,
        whyText,
        lowCompText,
        preparer: { uid: caller.uid, name: caller.name },
        actor,
        policies: world.policies,
        now: at,
        round,
        site: siteFor(world, g),
        directReason: input.direct?.reason ?? null,
      })
      return { group: g, draft, docNumber: numbers.numbers[k], ref: db.collection(PURCHASE_ORDERS).doc() }
    })

    // ── writes ──
    numbers.write()
    for (const d of drafts) {
      const log = {
        at,
        byId: caller.uid,
        byName: caller.name,
        action: "created",
        note: input.budgetReason || null,
        params: { basis: d.draft.basis, number: d.docNumber, round, ...(input.budgetReason ? { budget: 1 } : {}) },
      }
      tx.set(d.ref, clean({ ...d.draft, docNumber: d.docNumber, log: [log], updatedAt: FieldValue.serverTimestamp() }) as Rec)
    }
    const byOffer = new Map<string, typeof drafts>()
    for (const d of drafts) byOffer.set(d.group.offerId, [...(byOffer.get(d.group.offerId) || []), d])
    for (const [offerId, list] of byOffer) {
      const first = list[0]
      const prior = offers.find((o) => o.id === offerId) as unknown as Rec
      // A supplier who already has a live order on this RFQ may win other lines: his offer keeps the first order and lists them all.
      const live = locks.liveOfferIds.has(offerId)
      const priorIds = live ? (Array.isArray(prior.poIds) ? (prior.poIds as string[]) : str(prior.poId) ? [str(prior.poId)] : []) : []
      const priorLines = live && Array.isArray(prior.awardedLines) ? (prior.awardedLines as number[]) : []
      const lines = [...new Set([...priorLines, ...list.flatMap((d) => d.group.lines.map((l) => l.li))])].sort((a, b) => a - b)
      const offLowest = list.some((d) => d.group.offLowest)
      const ids = [...priorIds, ...list.map((d) => d.ref.id)]
      tx.update(db.collection("offers").doc(offerId), clean({
        status: "مقبول",
        decidedByUserId: caller.uid,
        decidedByUserName: caller.name,
        decidedAt: at,
        readAt: null,
        awaitingOrderApproval: true,
        ...(offLowest && input.why ? { awardReason: { code: input.why.code, text: whyText, byId: caller.uid, at } } : {}),
        awardedLines: lines,
        awardedTotal: fromHalalas(list.reduce((s, d) => s + d.group.netH, 0)) + (live ? Number(prior.awardedTotal) || 0 : 0),
        awardedRev: first.group.rev,
        requestedDeliveryDate: first.group.needBy,
        poId: priorIds[0] || first.ref.id,
        poNumber: priorIds[0] ? str(prior.poNumber) : first.docNumber,
        ...(ids.length > 1 ? { poIds: ids } : {}),
        outcome: { k: "won", at, round, poId: priorIds[0] || first.ref.id, poNumber: priorIds[0] ? str(prior.poNumber) : first.docNumber },
        updatedAt: FieldValue.serverTimestamp(),
      }))
    }
    const losers = direct ? [] : liveOffers.filter((o) => !winners.has(o.id) && !str((o as unknown as Rec).poId) && o.status !== "مقبول" && !isWithdrawnOffer(o))
    for (const o of losers) tx.update(db.collection("offers").doc(o.id), { outcome: { k: "lost", at, why: input.lossReason || null, round }, updatedAt: FieldValue.serverTimestamp() })

    if (!direct) {
      const rfqLog: RfqLogEntry[] = Array.isArray(rfq.log) ? (rfq.log as RfqLogEntry[]) : []
      const entries: RfqLogEntry[] = [rfqLogEntry(caller, "awarded", at, { params: { orders: drafts.map((d) => d.docNumber).join(" · "), suppliers: drafts.map((d) => d.draft.supplierName).join(" · "), unawarded: plan.unawarded.length, round } })]
      if (early) entries.unshift(rfqLogEntry(caller, "closed_early", at, { note: "award" }))
      if (input.why && plan.nonLowest.length) entries.push(rfqLogEntry(caller, "award_reason", at, { note: whyText }))
      tx.update(rfqRef, clean({
        status: "Awarded",
        awardedAt: at,
        awardRound: round,
        unawardedLines: [...new Set([...released, ...plan.unawarded])].sort((a, b) => a - b),
        awardSplit: drafts.length > 1,
        ...(early ? { deadline: addDays(today, -1), closedEarly: { at, byId: caller.uid, byName: caller.name, reason: "award", originalDeadline: str(rfq.deadline).slice(0, 10) || null } } : {}),
        log: [...rfqLog, ...entries],
        updatedAt: FieldValue.serverTimestamp(),
      }))
    }
    const awarded: AwardedOrder[] = drafts.map((d) => ({ id: d.ref.id, docNumber: d.docNumber, products: d.group.lines.map((l) => l.li) }))
    for (const s of served) {
      const patch = awardLinkPatch(input.rfqId, rfq as AwardedRfq, s.served, s.request, awarded)
      if (patch) tx.update(s.ref, { ...patch, updatedAt: FieldValue.serverTimestamp() })
    }
    return { rfq, offers, plan, orders: drafts.map((d) => ({ id: d.ref.id, docNumber: d.docNumber, draft: d.draft, group: d.group })), round, early, losers, winners }
  })

  if (done.existing) return { orders: done.existing.id ? [{ id: done.existing.id, docNumber: done.existing.docNumber, offerId: input.direct?.offerId || "", key: "", state: "waiting" }] : [], total: 0, closedEarly: false, unawarded: [], round: 0, budgetReason: null }

  const out = await afterAward(db, caller, input, done, world, actor, at, now)
  return out
}

// ---------------------------------------------------------------------------
// After the commit
// ---------------------------------------------------------------------------

type Done = {
  rfq: Rec & { id: string }
  offers: PlanOffer[]
  plan: AwardPlan
  orders: Array<{ id: string; docNumber: string; draft: ReturnType<typeof draftOrder>; group: PlannedGroup }>
  round: number
  early: boolean
  losers: PlanOffer[]
  winners: Map<string, PlanOffer>
}

const WON_AR = (contractor: string, rfq: string, po: string) => ({ title: `${contractor} — رُسّي الطلب ${rfq} عليك`, message: `رُسّي عليك الطلب، وصدر لك أمر الشراء ${po}. افتح الأمر لتقبله وتحدّد موعد التسليم.` })
const LOST_AR = (contractor: string, rfq: string, why: string) => ({ title: `${contractor} — نتيجة عرضك على الطلب ${rfq}`, message: `لم يُرسَ الطلب عليك${why}.` })
const CLOSED_AR = (contractor: string, rfq: string) => ({ title: `${contractor} — أُغلق الطلب ${rfq} مبكراً`, message: "رُسّي الطلب قبل موعده وأُغلق باب التقديم. لن يُقبل عرض جديد عليه." })
const WHY_AR: Record<string, string> = { price: " — السبب: السعر", time: " — السبب: موعد التوريد", spec: " — السبب: المواصفات" }

async function note(db: Firestore, uid: string, docId: string, body: Record<string, unknown>): Promise<void> {
  await db
    .collection("users")
    .doc(uid)
    .collection("notifications")
    .doc(docId)
    .set({ userId: uid, read: false, ...body })
    .catch((err: unknown) => console.warn("award notice failed:", (err as { code?: string })?.code || err))
}

const usersOf = (o: Rec): string[] => [...new Set([str(o.supplierId), str(o.organizationId), str(o.supplierOrgId)].filter((u) => !!u && u !== "guest" && u !== "mdmak-system"))]

async function afterAward(db: Firestore, caller: RfqCaller, input: AwardInput, done: Done, world: World, actor: PlanActor, at: string, now: Date): Promise<AwardResult> {
  const { rfq, plan, orders } = done
  const orgId = caller.orgId
  const rfqNo = rfqKeyPart(rfq, rfq.id)
  const rfqLabel = str(rfq.rfqNumber).replace(/^RFQ-/, "") || str(rfq.title)
  const profile = ((await db.collection("users").doc(orgId).get().catch(() => null))?.data() || {}) as Rec
  const contractor = str(profile.companyName) || caller.name
  const locale = input.locale ?? "ar"
  const result: AwardedOrderOut[] = []

  // The orders approved at the award: within the limit (by policy) or approved now by the owner.
  const ownerCtx = await poCtx(db, caller, { now, locale }).catch(() => null)
  for (const o of orders) {
    const g = o.group
    let state: AwardedOrderOut["state"] = "waiting"
    let waitingFor: string | undefined = o.draft.approverKind
    if (g.sendsNow && ownerCtx) {
      try {
        const ctx: PoCtx = actor.isOwner
          ? ownerCtx
          : { ...ownerCtx, actor: { ...ownerCtx.actor, uid: "policy", name: "ضمن حدّ الاعتماد", isOwner: false, canApprove: true, canPrepare: false, canExpedite: true } }
        const po = await approveOrder(ctx, { poId: o.id, asOwner: actor.isOwner && g.approval !== "sent" })
        state = po.status === "sent" ? "sent" : "approved"
        waitingFor = undefined
      } catch (err) {
        waitingFor = err instanceof PoActError ? err.reason : "error"
        console.warn("order not approved at the award:", waitingFor)
      }
    }
    if (state === "waiting") {
      await notifyNamed(
        db,
        { uid: caller.uid, name: caller.name },
        { kind: "po_awaiting_approval" as ProcEventKind, organizationId: orgId, params: { number: o.docNumber, supplier: o.draft.supplierName, amount: sarText(o.draft.totalExVat * (1 + o.draft.vatRate), locale), rfq: o.draft.rfqTitle }, poId: o.id, rfqId: o.draft.rfqId, offerId: o.draft.offerId },
        [],
        o.draft.approverKind === "owner" ? { owner: true } : { owner: false, permissions: ["po.approve"] }
      ).catch((err: unknown) => console.warn("approval notice failed:", (err as { code?: string })?.code || err))
    }
    result.push({ id: o.id, docNumber: o.docNumber, offerId: g.offerId, key: g.key, state, ...(waitingFor ? { waitingFor } : {}) })
  }

  const direct = Boolean(input.direct)
  if (!direct) {
    // Every bidder hears his result, with the order's number when he won (the key carries the round, so a re-award tells again).
    for (const [offerId, offer] of done.winners) {
      const mine = orders.filter((o) => o.group.offerId === offerId)
      const t = WON_AR(contractor, rfqLabel, mine.map((m) => m.docNumber.replace(/^PO-/, "")).join(" · "))
      const supplier = str(offer.organizationId) && str(offer.organizationId) !== "guest" ? str(offer.organizationId) : offerId
      for (const uid of usersOf(offer as unknown as Rec)) await note(db, uid, `rfq_out__${offerId}__R${done.round}`, { organizationId: supplier, type: "rfq_outcome", title: t.title, message: t.message, i18n: { title: "pn_rfq_won_title", message: "pn_rfq_won", params: { contractor, rfq: rfqLabel, number: mine.map((m) => m.docNumber).join(" · ") } }, link: "/supplier/orders", rfqId: rfq.id, offerId, poId: mine[0]?.id ?? null, actorId: caller.uid, actorName: caller.name, createdAt: at })
      await sendProcEvent(db, { id: "rfq_outcome", key: rfqOutcomeKey(rfqNo, supplier, done.round), organizationId: orgId, by: caller.uid, at, refs: { rfq: rfqNo, offer: offerId, po: mine[0]?.docNumber ?? "" }, payload: { result: "won", round: done.round } })
    }
    for (const offer of done.losers) {
      const t = LOST_AR(contractor, rfqLabel, input.lossReason ? WHY_AR[input.lossReason] : "")
      const supplier = str(offer.organizationId) && str(offer.organizationId) !== "guest" ? str(offer.organizationId) : offer.id
      for (const uid of usersOf(offer as unknown as Rec)) await note(db, uid, `rfq_out__${offer.id}__R${done.round}`, { organizationId: supplier, type: "rfq_outcome", title: t.title, message: t.message, i18n: { title: "pn_rfq_outcome_title", message: "pn_rfq_outcome", params: { contractor, rfq: rfqLabel, result: "@pn_rfq_outcome_lost", reason: input.lossReason ? `@pn_rfq_outcome_why_${input.lossReason}` : "" } }, link: "/supplier/offers", rfqId: rfq.id, offerId: offer.id, actorId: caller.uid, actorName: caller.name, createdAt: at })
      await sendProcEvent(db, { id: "rfq_outcome", key: rfqOutcomeKey(rfqNo, supplier, done.round), organizationId: orgId, by: caller.uid, at, refs: { rfq: rfqNo, offer: offer.id }, payload: { result: "lost", round: done.round, why: input.lossReason || null } })
    }
    // Early award: the invitees who never bid are told the request closed (G-07 — the link refuses from now on).
    if (done.early) {
      const bidders = new Set(done.offers.flatMap((o) => usersOf(o as unknown as Rec)))
      const invited = [...new Set([...(Array.isArray(rfq.allowedSupplierOrgIds) ? (rfq.allowedSupplierOrgIds as unknown[]) : []), ...(Array.isArray(rfq.invitedSupplierOrgIds) ? (rfq.invitedSupplierOrgIds as unknown[]) : [])].map(str).filter(Boolean))]
      const t = CLOSED_AR(contractor, rfqLabel)
      for (const uid of invited.filter((u) => !bidders.has(u))) {
        await note(db, uid, `rfq_closed_early__${rfq.id}`, { organizationId: uid, type: "rfq_outcome", title: t.title, message: t.message, i18n: { title: "pn_rfq_closed_early_title", message: "pn_rfq_closed_early", params: { contractor, rfq: rfqLabel } }, link: `/supplier/rfqs?rfq=${rfq.id}`, rfqId: rfq.id, actorId: caller.uid, actorName: caller.name, createdAt: at })
        await sendProcEvent(db, { id: "rfq_outcome", key: rfqOutcomeKey(rfqNo, uid, done.round), organizationId: orgId, by: caller.uid, at, refs: { rfq: rfqNo }, payload: { result: "closed_early", round: done.round } })
      }
    }
  }

  // The lines nobody won (and no live order carries) go back to «الواردة»; each request is re-read from the world.
  try {
    await syncIncoming(db, orgId, { now, by: { uid: caller.uid, name: caller.name } })
  } catch (err) {
    console.warn("incoming not refreshed after the award:", (err as { code?: string })?.code || err)
  }

  return {
    orders: result,
    total: fromHalalas(plan.netH),
    closedEarly: done.early,
    unawarded: plan.unawarded,
    round: done.round,
    budgetReason: input.budgetReason || null,
  }
}
