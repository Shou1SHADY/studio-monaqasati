// The free supplier's quote acts, run on the server (Admin SDK) so every blocking rule of the quote is enforced where
// it cannot be skipped (NFR-08): a new quote, a new version (edit or the reply to a price cut), "my price is final",
// withdraw, "sample sent" and declining an invitation. Each re-reads the request and the quote in ONE transaction:
// the request is open, its deadline has not passed (end of the day, Riyadh) — except a cut reply, whose clock is the
// reply-by date — and it reaches him (invited, or public in his field); `quoteBlocks` runs again; the version is
// written and the contractor is told afterwards (best-effort). The rules no longer let a supplier set any field the
// buying side owns, so this is the only door for these acts.

import { FieldValue, type DocumentData, type Firestore, type UpdateData } from "firebase-admin/firestore"
import { z } from "zod"
import { riyadhDay } from "@/lib/hr/format"
import { OFFER_WITHDRAWN, isWithdrawnOffer } from "@/lib/procurement/award"
import { rfqOfferKey } from "@/lib/procurement/event-keys"
import { newOfferNotice, newOfferNoticeId } from "@/lib/procurement/offer-announce"
import { bafoOpen, bafoReplyKind, bafoReplyRefusal, revalOpen, type OfferBafo, type OfferReval } from "@/lib/procurement/offer-decisions"
import { currentVersionOf, nextVersions, offerRev, quotingGate, totalFields, type StoredVersion } from "@/lib/procurement/offer-versions"
import { rfqKeyPart, sendProcEvent } from "@/lib/procurement/proc-event-server"
import { createInquiry } from "@/lib/procurement/rfq-server/inquiry"
import { answerOf, inquiryKind, publicInquiry, type InquiryDoc } from "@/lib/procurement/rfq-inquiries"
import { rfqLogEntry, type RfqLogEntry } from "@/lib/procurement/rfq-detail"
import { UNDER_REVIEW } from "@/lib/procurement/supplier"
import { notifyNamed } from "./server-notify"
import { QUOTE_COUNTS, quoteCountId, riyadhMonth } from "@/lib/supplier-approval"
import { daysBetween, namesSupplier, quoteBlocks, quoteShapeOf, replyByOf, requestReaches, versionOf, type QuoteValues } from "./quote-rules"

export { OFFER_WITHDRAWN }
const REDUCE = "مطلوب تخفيض"

export type QuoteActCode =
  | "not_approved"
  | "quota"
  | "rfq_missing"
  | "rfq_closed"
  | "deadline"
  | "reply_closed"
  | "not_reached"
  | "already_quoted"
  | "offer_missing"
  | "not_yours"
  | "wrong_state"
  | "blocked"
  | "date_future"
  | "price_higher"
  | "not_asked"
  | "invalid"

export class QuoteActError extends Error {
  constructor(
    readonly code: QuoteActCode,
    readonly detail?: string
  ) {
    super(code)
    this.name = "QuoteActError"
  }
}

const id = z.string().trim().min(1).max(128)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const values = z.object({
  prices: z.record(z.string().max(32)).default({}),
  skip: z.record(z.boolean()).default({}),
  total: z.string().max(32).default(""),
  arrive: z.union([day, z.literal("")]).default(""),
  valid: z.union([day, z.literal("")]).default(""),
  note: z.string().max(1000).default(""),
  packs: z.record(z.string().max(32)).default({}),
  warranty: z.record(z.string().max(8)).default({}),
  whole: z.boolean().default(false),
})
const file = z.string().url().max(2000).nullable().optional()
const papers = z.array(z.object({ kind: z.string().max(40), url: z.string().url().max(2000), name: z.string().max(200).optional() })).max(10).optional()

export const quoteActSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("quote.new"), rfqId: id, values, fileUrl: file, papers }),
  z.object({ action: z.literal("quote.version"), offerId: id, mode: z.enum(["edit", "reduce", "reval"]), values, fileUrl: file }),
  z.object({ action: z.literal("quote.final"), offerId: id, note: z.string().trim().max(500).default("") }),
  z.object({ action: z.literal("quote.withdraw"), offerId: id }),
  z.object({ action: z.literal("quote.sample"), offerId: id, sentAt: day, receivedBy: z.string().trim().max(120).default(""), note: z.string().trim().max(500).default("") }),
  z.object({ action: z.literal("quote.decline"), rfqId: id, note: z.string().trim().max(500).default("") }),
  z.object({ action: z.literal("quote.ask"), rfqId: id, question: z.string().trim().min(1).max(1000), li: z.number().int().min(0).max(500).optional() }),
  z.object({ action: z.literal("quote.answer"), inquiryId: id, rfqId: id, answer: z.string().trim().min(1).max(1000) }),
])
export type QuoteAct = z.infer<typeof quoteActSchema>

export interface QuoteSupplier {
  uid: string
  name: string
  orgId: string
  company: string
  /** His specialties and coverage cities — what makes a public request his (RFQ-01). */
  field: { specs: string[]; cities: string[]; subIds?: string[] }
  /** The VAT rate his company charges (15% with a VAT number, else 0), stored on every version (decision 9). */
  vatRate?: number
  /** The platform admin approved his company (supplier-approval.ts). The route always says; false refuses a new quote. */
  approved?: boolean
  /** The free plan's monthly allowance when the admin set one — counted on `supplierQuoteCounts` with the quote. */
  monthlyLimit?: number | null
}

type Rec = Record<string, unknown>
const withId = (data: unknown, id: string): Rec & { id: string } => ({ ...((data || {}) as Rec), id })
const str =(v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))

/** His arrival date as a duration in days (1 to 365, NFR-07), or none. */
function leadDaysOf(arrive: string, today: string): number | null {
  if (!arrive) return null
  const days = daysBetween(arrive, today)
  return days >= 1 && days <= 365 ? days : null
}

/** The request as the offer carries it, marked answered — an offer cut the old way (by status) gets the record now. */
function answeredBafo(offer: Rec, answered: NonNullable<OfferBafo["answered"]>): OfferBafo {
  const stored = offer.bafo as OfferBafo | undefined
  return { at: stored?.at || str(offer.reductionAt) || answered.at, byId: stored?.byId || str(offer.decidedByUserId), byName: stored?.byName || str(offer.decidedByUserName), replyBy: stored?.replyBy || str(offer.reductionBy), note: stored?.note ?? (str(offer.reductionNote) || null), round: 1, answered }
}

/** The request is still taking quotes: open, and its deadline (a day) not yet past in Riyadh. */
function assertOpen(rfq: Rec, today: string) {
  const gate = quotingGate(rfq, today)
  if (gate) throw new QuoteActError(gate)
}

function assertOwn(offer: Rec | undefined, s: QuoteSupplier): Rec {
  if (!offer) throw new QuoteActError("offer_missing")
  if (!ownsQuote({ kind: "supplier", supplier: s }, offer)) throw new QuoteActError("not_yours")
  return offer
}

/** His company's quotes on a request — a withdrawn one (by status, or only the `withdrawnAt` an older withdrawal left) is not live. */
const liveQuotesOf = (db: Firestore, rfqId: string, orgId: string) => db.collection("offers").where("rfqId", "==", rfqId).where("organizationId", "==", orgId)

const tellOwner = (db: Firestore, s: QuoteSupplier, rfq: Rec & { id: string }, kind: Parameters<typeof notifyNamed>[2]["kind"], params: Record<string, string | number>, offerId?: string | null) =>
  notifyNamed(
    db,
    { uid: s.uid, name: s.name },
    { kind, organizationId: str(rfq.organizationId) || str(rfq.contractorId), params: { supplier: s.company, rfq: str(rfq.rfqNumber) || str(rfq.title), ...params }, rfqId: rfq.id, offerId: offerId ?? null, link: `/contractor/rfqs/${rfq.id}/offers` },
    [str(rfq.contractorId) || null]
  ).catch((err) => {
    console.warn("quote notice failed:", (err as { code?: string })?.code || err)
    return 0
  })

function blocksOrThrow(rfq: Rec, v: QuoteValues, mode: "new" | "edit" | "reduce" | "reval", today: string) {
  const check = quoteBlocks(quoteShapeOf(rfq), v, mode, { daysTo: (iso, from) => daysBetween(iso, from ?? today) })
  if (check.blocks.length) throw new QuoteActError(check.blocks[0].code === "deadline" ? "deadline" : "blocked", check.blocks[0].code)
}

/** NFR-06: who did what to a quote, and when. One document per act under `offers/{id}/log`, written only here — no rule
 * opens that path to a client, so an entry can be neither written nor changed from a browser (append-only by construction,
 * and it costs the size-capped ruleset nothing). */
export interface QuoteLogEntry {
  at: string
  byId: string
  byName: string
  orgId: string
  action: "quote.new" | "quote.version" | "quote.final" | "quote.withdraw" | "quote.sample"
  /** What changed — figures as stored on the quote (totals before VAT), dates as days. */
  detail: Record<string, string | number | null>
}

export async function runQuoteAct(db: Firestore, s: QuoteSupplier, act: QuoteAct, now: Date = new Date()): Promise<Record<string, unknown>> {
  const at = now.toISOString()
  const today = riyadhDay(now)
  const rfqRef = (rfqId: string) => db.collection("rfqs").doc(rfqId)
  const offerRef = (offerId: string) => db.collection("offers").doc(offerId)
  const logEntry = (action: QuoteLogEntry["action"], detail: QuoteLogEntry["detail"] = {}): QuoteLogEntry => ({ at, byId: s.uid, byName: s.name, orgId: s.orgId, action, detail })
  const logRef = (offerId: string) => offerRef(offerId).collection("log").doc()

  switch (act.action) {
    case "quote.new": {
      // No quotation before the admin approves the company (onboarding, 18 Oct 2026).
      if (s.approved === false) throw new QuoteActError("not_approved")
      const v = act.values as QuoteValues
      const ref = db.collection("offers").doc()
      const countRef = s.monthlyLimit ? db.collection(QUOTE_COUNTS).doc(quoteCountId(s.orgId, riyadhMonth(now))) : null
      const { rfq, total } = await db.runTransaction(async (tx) => {
        const snap = await tx.get(rfqRef(act.rfqId))
        if (!snap.exists) throw new QuoteActError("rfq_missing")
        // The free plan's monthly allowance, counted in the transaction that writes the quote — two at once cannot both pass.
        const used = countRef ? Number((await tx.get(countRef)).data()?.count) || 0 : 0
        if (countRef && s.monthlyLimit && used >= s.monthlyLimit) throw new QuoteActError("quota", String(s.monthlyLimit))
        // One live quote per company per request: a second one is an edit. Read INSIDE the transaction, which also
        // writes the request (its count) — two submits at once collide on it, and the retry sees the first quote.
        const mine = await tx.get(liveQuotesOf(db, act.rfqId, s.orgId))
        if (mine.docs.some((d) => !isWithdrawnOffer(d.data() as Rec))) throw new QuoteActError("already_quoted")
        const r = withId(snap.data(), snap.id)
        assertOpen(r, today)
        if (!requestReaches(r, s.orgId, s.field)) throw new QuoteActError("not_reached")
        blocksOrThrow(r, v, "new", today)
        const shape = quoteShapeOf(r)
        const lead = leadDaysOf(v.arrive, today)
        const version: StoredVersion = { ...versionOf(shape, v, today, act.fileUrl, s.vatRate), by: "supplier", ...(lead != null ? { leadDays: lead } : {}) }
        const price = String(version.total)
        const location = str(r.deliveryLocation) || str(r.district) || str(r.city)
        const data: Rec = {
          supplierId: s.uid,
          organizationId: s.orgId,
          supplierName: s.company || "—",
          companyName: s.company || "",
          submittedByUserId: s.uid,
          submittedByUserName: s.name,
          rfqId: r.id,
          rfqTitle: str(r.title),
          projectId: str(r.projectId) || null,
          contractorId: str(r.contractorId) || null,
          contractorOrgId: str(r.organizationId) || str(r.contractorId) || null,
          price,
          deliveryLocation: location,
          deliveryBatches: [{ location, deliveryDate: v.arrive || "", price, quantity: String(shape.items.reduce((sum, i) => sum + i.qty, 0) || "") }],
          validUntil: v.valid,
          status: UNDER_REVIEW,
          versions: [version],
          rev: 1,
          whole: Boolean(v.whole),
          vatRegistered: s.vatRate == null ? true : s.vatRate > 0,
          vatRate: s.vatRate == null ? 0.15 : s.vatRate,
          ...(lead != null ? { leadDays: lead } : {}),
          createdAt: at,
          updatedAt: at,
        }
        if (shape.pricing === "item") data.lines = version.lines
        if (act.fileUrl) data.offerPdfUrl = act.fileUrl
        if (v.note.trim()) data.supplierNote = v.note.trim().slice(0, 1000)
        if (act.papers?.length) data.supplierPapers = act.papers
        const skipped = shape.items.map((i, n) => (v.skip[i.id] ? n : -1)).filter((n) => n >= 0)
        if (skipped.length) data.skippedItems = skipped
        tx.set(ref, data)
        tx.set(logRef(ref.id), logEntry("quote.new", { total: version.total, validUntil: v.valid, arrive: v.arrive || null }))
        tx.update(rfqRef(r.id), { offersCount: FieldValue.increment(1) })
        if (countRef) tx.set(countRef, { orgId: s.orgId, month: riyadhMonth(now), count: used + 1, updatedAt: at }, { merge: true })
        return { rfq: r, total: version.total }
      })
      await sendProcEvent(db, { id: "rfq_offer", key: rfqOfferKey(rfqKeyPart(rfq, rfq.id), s.orgId, 1), organizationId: str(rfq.organizationId) || str(rfq.contractorId), by: s.uid, at, refs: { rfq: rfqKeyPart(rfq, rfq.id), offer: ref.id }, payload: { version: 1 } })
      // The amount is always named: prices are never hidden from the buyer (RFQ-03).
      const contractorId = str(rfq.contractorId)
      if (contractorId) {
        const orgId = str(rfq.organizationId) || contractorId
        const notice = newOfferNotice({ supplier: s.company, rfqTitle: str(rfq.title), price: total })
        await db
          .collection("users")
          .doc(contractorId)
          .collection("notifications")
          .doc(newOfferNoticeId(ref.id))
          .set({ userId: contractorId, organizationId: orgId, type: "new_offer", i18n: notice.i18n, title: notice.title, message: notice.message, offerId: ref.id, rfqId: rfq.id, createdAt: at, read: false })
          .catch((err: unknown) => console.warn("new offer notice failed:", (err as { code?: string })?.code || err))
      }
      return { offerId: ref.id }
    }

    case "quote.version": {
      const v = act.values as QuoteValues
      let n = 2
      const rfq = await db.runTransaction(async (tx) => {
        const oSnap = await tx.get(offerRef(act.offerId))
        const offer = assertOwn(oSnap.exists ? (oSnap.data() as Rec) : undefined, s)
        const rSnap = await tx.get(rfqRef(str(offer.rfqId)))
        if (!rSnap.exists) throw new QuoteActError("rfq_missing")
        const r = withId(rSnap.data(), rSnap.id)
        if (offer.poId || offer.withdrawnAt) throw new QuoteActError("wrong_state")
        // The buyer's decisions are not in the status (G-15): an offer he shortlisted, excluded or asked a better price of
        // is still «under review» here, and its owner may keep editing it — the decisions stay where they are.
        const status = str(offer.status)
        if (status !== UNDER_REVIEW && status !== REDUCE) throw new QuoteActError("wrong_state")
        if (act.mode === "reduce") {
          if (!bafoOpen(offer)) throw new QuoteActError("wrong_state")
          if (str(r.status) !== "New") throw new QuoteActError("rfq_closed")
          const by = replyByOf(offer)
          if (by && daysBetween(by, today) < 0) throw new QuoteActError("reply_closed")
        } else if (act.mode === "reval") {
          if (!revalOpen(offer)) throw new QuoteActError("not_asked")
          if (str(r.status) !== "New") throw new QuoteActError("rfq_closed")
        } else {
          assertOpen(r, today)
        }
        blocksOrThrow(r, v, act.mode, today)
        if (act.mode === "reval" && v.valid < today) throw new QuoteActError("blocked", "valid")
        const shape = quoteShapeOf(r)
        const lead = leadDaysOf(v.arrive, today)
        const previous = currentVersionOf(offer)
        const version: StoredVersion = { ...versionOf(shape, v, today, act.fileUrl, s.vatRate), by: "supplier", ...(lead != null ? { leadDays: lead } : {}) }
        if (act.mode === "reduce") {
          // One round, one direction (RFQ-11): the reply is a lower price or the same one, never a higher.
          if (bafoReplyRefusal(previous.total, version.total)) throw new QuoteActError("price_higher")
          version.bafoReply = bafoReplyKind(previous.total, version.total)
        }
        if (act.mode === "reval") version.reval = true
        const skippedNow = shape.items.map((i, k) => (v.skip[i.id] ? k : -1)).filter((k) => k >= 0)
        // The same fields every contractor-side reader expects: price, rates and batches that agree.
        const fields: Rec = { ...totalFields(offer, version.total) }
        if (shape.pricing === "item" && version.lines) fields.lines = version.lines
        if (shape.pricing === "item" && (skippedNow.length || (Array.isArray(offer.skippedItems) && offer.skippedItems.length))) fields.skippedItems = skippedNow
        const versions = nextVersions(offer, version)
        n = versions.length
        const prev = Number(offer.price)
        const history = Array.isArray(offer.priceHistory) ? [...(offer.priceHistory as Rec[])] : []
        if (Number.isFinite(prev) && prev > 0) history.push({ price: String(offer.price), replacedAt: at, by: s.uid })
        const patch: Rec = {
          ...fields,
          price: String(version.total),
          validUntil: v.valid,
          status: UNDER_REVIEW,
          versions,
          rev: n,
          whole: Boolean(v.whole),
          vatRegistered: s.vatRate == null ? offer.vatRegistered !== false : s.vatRate > 0,
          vatRate: s.vatRate == null ? (typeof offer.vatRate === "number" ? offer.vatRate : 0.15) : s.vatRate,
          ...(lead != null ? { leadDays: lead } : {}),
          priceHistory: history,
          updatedAt: at,
          supplierNote: v.note.trim().slice(0, 1000),
        }
        if (act.fileUrl) patch.offerPdfUrl = act.fileUrl
        if (v.arrive) {
          const batches = (fields.deliveryBatches as Rec[] | undefined) || (offer.deliveryBatches as Rec[] | undefined) || []
          patch.deliveryBatches = batches.length ? batches.map((b, i) => (i === 0 ? { ...b, deliveryDate: v.arrive } : b)) : [{ location: str(r.city), deliveryDate: v.arrive, price: String(version.total), quantity: "" }]
        }
        if (act.mode === "reduce") {
          patch.reductionReply = { at: today, kind: "lowered" }
          patch.bafo = answeredBafo(offer, { at: today, n, kind: version.bafoReply || "lowered", note: null })
        }
        if (act.mode === "reval") patch.reval = { ...(offer.reval as OfferReval), answered: { at: today, n } }
        tx.update(offerRef(act.offerId), patch as UpdateData<DocumentData>)
        tx.set(logRef(act.offerId), logEntry("quote.version", { mode: act.mode, version: n, total: version.total, from: Number.isFinite(prev) ? prev : null, validUntil: v.valid }))
        tx.update(rfqRef(r.id), { log: [...((Array.isArray(r.log) ? r.log : []) as RfqLogEntry[]), rfqLogEntry({ uid: s.uid, name: s.name }, act.mode === "reval" ? "price_confirmed" : "offer_versioned", at, { params: { supplier: s.company, version: n } })] })
        return r
      })
      await tellOwner(db, s, rfq, "sup_quote_version", { n }, act.offerId)
      await sendProcEvent(db, { id: "rfq_offer", key: rfqOfferKey(rfqKeyPart(rfq, rfq.id), s.orgId, n), organizationId: str(rfq.organizationId) || str(rfq.contractorId), by: s.uid, at, refs: { rfq: rfqKeyPart(rfq, rfq.id), offer: act.offerId }, payload: { version: n, mode: act.mode } })
      return { n }
    }

    case "quote.final": {
      const note = act.note.trim().slice(0, 500)
      const rfq = await db.runTransaction(async (tx) => {
        const oSnap = await tx.get(offerRef(act.offerId))
        const offer = assertOwn(oSnap.exists ? (oSnap.data() as Rec) : undefined, s)
        const rSnap = await tx.get(rfqRef(str(offer.rfqId)))
        if (!rSnap.exists) throw new QuoteActError("rfq_missing")
        const r = withId(rSnap.data(), rSnap.id)
        if (!bafoOpen(offer) || offer.poId || offer.withdrawnAt) throw new QuoteActError("wrong_state")
        if (str(r.status) !== "New") throw new QuoteActError("rfq_closed")
        const by = replyByOf(offer)
        if (by && daysBetween(by, today) < 0) throw new QuoteActError("reply_closed")
        tx.update(offerRef(act.offerId), { status: UNDER_REVIEW, reductionReply: { at: today, kind: "final", note }, bafo: answeredBafo(offer, { at: today, n: offerRev(offer), kind: "kept", note: note || null }), updatedAt: at })
        tx.set(logRef(act.offerId), logEntry("quote.final", { note: note || null, total: Number(offer.price) || null }))
        return r
      })
      await tellOwner(db, s, rfq, "sup_quote_final", { note }, act.offerId)
      return {}
    }

    case "quote.withdraw": {
      const rfq = await db.runTransaction(async (tx) => {
        const oSnap = await tx.get(offerRef(act.offerId))
        const offer = assertOwn(oSnap.exists ? (oSnap.data() as Rec) : undefined, s)
        const rSnap = await tx.get(rfqRef(str(offer.rfqId)))
        if (!rSnap.exists) throw new QuoteActError("rfq_missing")
        const r = withId(rSnap.data(), rSnap.id)
        const status = str(offer.status)
        if (offer.poId || offer.withdrawnAt || (status !== UNDER_REVIEW && status !== REDUCE)) throw new QuoteActError("wrong_state")
        // Only while submissions are open (WF-03): after the deadline the buttons are gone and so is the act.
        assertOpen(r, today)
        tx.update(offerRef(act.offerId), { status: OFFER_WITHDRAWN, withdrawnAt: at, withdrawnById: s.uid, withdrawnByName: s.name, updatedAt: at })
        tx.set(logRef(act.offerId), logEntry("quote.withdraw", { from: status }))
        return r
      })
      await tellOwner(db, s, rfq, "sup_quote_withdrawn", {}, act.offerId)
      return {}
    }

    case "quote.sample": {
      if (act.sentAt > today) throw new QuoteActError("date_future")
      const rfq = await db.runTransaction(async (tx) => {
        const oSnap = await tx.get(offerRef(act.offerId))
        const offer = assertOwn(oSnap.exists ? (oSnap.data() as Rec) : undefined, s)
        const rSnap = await tx.get(rfqRef(str(offer.rfqId)))
        if (!rSnap.exists) throw new QuoteActError("rfq_missing")
        if (str(offer.sampleStatus) !== "مطلوبة") throw new QuoteActError("wrong_state")
        tx.update(offerRef(act.offerId), {
          sampleStatus: "تم الإرسال",
          sampleSentAt: act.sentAt,
          sampleReceivedBy: act.receivedBy,
          sampleNote: act.note || null,
          sampleUpdatedAt: at,
        })
        tx.set(logRef(act.offerId), logEntry("quote.sample", { sentAt: act.sentAt, receivedBy: act.receivedBy || null, note: act.note || null }))
        return withId(rSnap.data(), rSnap.id)
      })
      await tellOwner(db, s, rfq, "sup_sample_sent", { date: act.sentAt, by: act.receivedBy, note: act.note }, act.offerId)
      return {}
    }

    case "quote.decline": {
      const snap = await rfqRef(act.rfqId).get()
      if (!snap.exists) throw new QuoteActError("rfq_missing")
      const rfq = withId(snap.data(), snap.id)
      if (!namesSupplier(rfq, s.orgId)) throw new QuoteActError("not_reached")
      assertOpen(rfq, today)
      const mine = await liveQuotesOf(db, act.rfqId, s.orgId).get()
      if (mine.docs.some((d) => !isWithdrawnOffer(d.data() as Rec))) throw new QuoteActError("already_quoted")
      await db
        .collection("supplierWorkspace")
        .doc(s.orgId)
        .set({ organizationId: s.orgId, declined: { [act.rfqId]: { at: today, note: act.note, byId: s.uid, byName: s.name, atTime: at } }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      await tellOwner(db, s, rfq, "sup_invite_declined", { note: act.note })
      return {}
    }
    case "quote.ask": {
      // A question on a request he can see, while it is open (RFQ-04). The one `createInquiry` writes it and tells the
      // buying side — the same door the visitors' link uses — so the asker's company is the one he acts for.
      const snap = await rfqRef(act.rfqId).get()
      if (!snap.exists) throw new QuoteActError("rfq_missing")
      const rfq = withId(snap.data(), snap.id)
      if (str(rfq.status) !== "New") throw new QuoteActError("rfq_closed")
      if (!(await seesRequest(db, rfq, s.orgId))) throw new QuoteActError("not_reached")
      const made = await createInquiry(db, { rfq, question: act.question, li: act.li ?? null, asker: { kind: "supplier", uid: s.uid, name: s.name, orgId: s.orgId, company: s.company }, at })
      return { id: made.id }
    }
    case "quote.answer": {
      // The answer to a clarification the buyer asked on HIS offer («اطلب توضيحاً»): it goes back to the buyer on that
      // question, and to nobody else — a question about one offer is not served to the other suppliers.
      const inqRef = rfqRef(act.rfqId).collection("inquiries").doc(act.inquiryId)
      const asked = await db.runTransaction(async (tx) => {
        const rSnap = await tx.get(rfqRef(act.rfqId))
        const iSnap = await tx.get(inqRef)
        if (!rSnap.exists || !iSnap.exists) throw new QuoteActError("rfq_missing")
        const q = iSnap.data() as Rec
        const to = (q.to || {}) as Rec
        if (q.kind !== "our_question" || str(to.orgId) !== s.orgId) throw new QuoteActError("not_yours")
        if (str(q.reply).trim()) throw new QuoteActError("wrong_state")
        const status = str((rSnap.data() as Rec).status)
        if (status === "Cancelled") throw new QuoteActError("rfq_closed")
        tx.update(inqRef, { reply: act.answer, repliedAt: at, repliedBy: s.uid, repliedByUserName: s.name, answer: { text: act.answer, all: false, at, byId: s.uid, byName: s.name } })
        return { rfq: withId(rSnap.data(), rSnap.id), by: str(q.userId) }
      })
      await tellAboutAnswer(db, s, asked.rfq, asked.by, act.inquiryId, act.answer, at)
      return {}
    }
    default:
      throw new QuoteActError("invalid")
  }
}

/** The other subject of a quote act: a visitor on the RFQ link, known by the mobile he verified (LNK-09). He owns the quote
 * made with that mobile and nothing else; the notices the buyer receives name him by his company, or «زائر» when he asked
 * a question unverified. The visitor's own acts live in `visitor-offer-server.ts` and run the same gates. */
export type QuoteSubject = { kind: "supplier"; supplier: QuoteSupplier } | { kind: "visitor"; phone: string }

export const visitorActor = (company: string, phone: string): QuoteSupplier => ({ uid: phone ? `guest:${phone}` : "guest", name: company || "زائر", orgId: "guest", company: company || "زائر", field: { specs: [], cities: [] } })

export function ownsQuote(subject: QuoteSubject, offer: Rec): boolean {
  if (subject.kind === "supplier") return str(offer.organizationId) === subject.supplier.orgId && offer.supplierId !== "guest"
  return offer.isGuestOffer === true && offer.supplierId === "guest" && str((offer.guestContact as Rec | undefined)?.phone) === subject.phone
}

/** Whether a supplier's company sees a request: a public one, one that names him, or one he has quoted on. */
export async function seesRequest(db: Firestore, rfq: Rec & { id: string }, orgId: string): Promise<boolean> {
  if (rfq.visibility !== "private" || namesSupplier(rfq, orgId)) return true
  return !(await liveQuotesOf(db, rfq.id, orgId).limit(1).get()).empty
}

export interface SupplierQuestion {
  id: string
  question: string
  reply: string | null
  repliedAt: string | null
  createdAt: string | null
  /** Asked by his own company; the others' are shown without who asked. */
  mine: boolean
  /** A clarification the buyer asked on his offer, waiting for his answer. */
  fromBuyer?: boolean
  offerId?: string | null
  /** A clarification from the buyer to every invitee: no question behind it. */
  note?: boolean
}

/** The questions on a request as a supplier may read them (decision 10): his company's own with their state, the answers
 * given «للجميع» and the buyer's clarifications — never who asked, never an answer given to the asker alone. */
export async function questionsFor(db: Firestore, orgId: string, rfqId: string): Promise<SupplierQuestion[]> {
  const ref = db.collection("rfqs").doc(rfqId)
  const snap = await ref.get()
  if (!snap.exists) throw new QuoteActError("rfq_missing")
  if (!(await seesRequest(db, withId(snap.data(), snap.id), orgId))) throw new QuoteActError("not_reached")
  const rows = await ref.collection("inquiries").get()
  const out: SupplierQuestion[] = []
  for (const d of rows.docs) {
    const q: Rec & { id: string } = { ...(d.data() as Rec), id: d.id }
    const doc = q as unknown as InquiryDoc & Rec
    const kind = inquiryKind(doc)
    const createdAt = str(q.createdAt) || null
    if (kind === "our_question") {
      if (str((q.to as Rec | undefined)?.orgId) !== orgId) continue
      out.push({ id: d.id, question: str(q.question), reply: str(q.reply).trim() || null, repliedAt: str(q.repliedAt) || null, createdAt, mine: false, fromBuyer: true, offerId: str((q.to as Rec).offerId) || null })
      continue
    }
    const pub = publicInquiry(doc)
    if (kind === "note") {
      if (pub) out.push({ id: d.id, question: "", reply: pub.answer, repliedAt: pub.answeredAt, createdAt, mine: false, note: true })
      continue
    }
    const mine = str(q.organizationId) === orgId || str((q.from as Rec | undefined)?.orgId) === orgId
    if (mine) out.push({ id: d.id, question: str(q.question), reply: answerOf(doc)?.text ?? null, repliedAt: answerOf(doc)?.at ?? null, createdAt, mine: true })
    else if (pub) out.push({ id: d.id, question: pub.question, reply: pub.answer, repliedAt: pub.answeredAt, createdAt, mine: false })
  }
  return out.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
}

/** The buyer who asked hears the supplier's answer: he and the request's owner. */
export async function tellAboutAnswer(db: Firestore, s: QuoteSupplier, rfq: Rec & { id: string }, asker: string, inquiryId: string, answer: string, at: string): Promise<void> {
  try {
    const orgId = str(rfq.organizationId) || str(rfq.contractorId)
    const to = [...new Set([asker, str(rfq.contractorId)].filter((u) => !!u && u !== s.uid))]
    const rfqName = str(rfq.rfqNumber) || str(rfq.title)
    const text = answer.length > 120 ? `${answer.slice(0, 120)}…` : answer
    await Promise.all(
      to.map((uid) =>
        db
          .collection("users")
          .doc(uid)
          .collection("notifications")
          .doc(`rfq_clarify_answer__${inquiryId}`)
          .set({
            userId: uid,
            organizationId: orgId,
            type: "rfq_clarify_answer",
            title: `ردّ ${s.company} على توضيحك في ${rfqName}`,
            message: text,
            i18n: { title: "pn_rfq_clarify_answer_title", message: "pn_rfq_clarify_answer", params: { supplier: s.company, rfq: rfqName, answer: text } },
            link: `/contractor/rfqs/${rfq.id}/offers?tab=inquiries`,
            rfqId: rfq.id,
            actorId: s.uid,
            actorName: s.name,
            read: false,
            createdAt: at,
          })
      )
    )
  } catch (err) {
    console.warn("answer notice failed:", (err as { code?: string })?.code || err)
  }
}

/** His field, read the way his screens read it: the user's profile, with a secondary company's own lists over it. */
export async function supplierFieldOf(db: Firestore, user: Rec, orgId: string, uid: string): Promise<QuoteSupplier["field"]> {
  const list = (v: unknown) => (Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [])
  let specs = list(user.specializations)
  let cities = list(user.coverageCities)
  let subIds = list(user.specialtyIds)
  if (orgId && orgId !== uid) {
    const org = (await db.collection("organizations").doc(orgId).get().catch(() => null))?.data() as Rec | undefined
    if (org && list(org.specializations).length) specs = list(org.specializations)
    if (org && list(org.coverageCities).length) cities = list(org.coverageCities)
    if (org && list(org.specialtyIds).length) subIds = list(org.specialtyIds)
    // ED-21: with no coverage list, his company's own city is where he serves.
    if (!cities.length && org && typeof org.city === "string" && org.city) cities = [org.city]
  }
  if (!cities.length && typeof user.city === "string" && user.city) cities = [user.city]
  return { specs, cities, subIds }
}

export const isQuoteAct = (body: unknown): boolean => typeof (body as { action?: unknown } | null)?.action === "string" && String((body as { action: string }).action).startsWith("quote.")
