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
import { revisePrice, pricedProducts } from "@/lib/procurement/offer-pricing"
import { OFFER_WITHDRAWN, isWithdrawnOffer, offersSealed } from "@/lib/procurement/award"
import { newOfferNotice, newOfferNoticeId } from "@/lib/procurement/offer-announce"
import { resolvePolicies } from "@/lib/procurement/policies"
import type { ProcurementPolicies } from "@/lib/procurement/types"
import { UNDER_REVIEW } from "@/lib/procurement/supplier"
import { notifyNamed, permissionHolders } from "./server-notify"
import { daysBetween, namesSupplier, nextVersions, quoteBlocks, quoteShapeOf, replyByOf, requestReaches, versionOf, type QuoteValues } from "./quote-rules"

export { OFFER_WITHDRAWN }
const REDUCE = "مطلوب تخفيض"

export type QuoteActCode =
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
})
const file = z.string().url().max(2000).nullable().optional()
const papers = z.array(z.object({ kind: z.string().max(40), url: z.string().url().max(2000), name: z.string().max(200).optional() })).max(10).optional()

export const quoteActSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("quote.new"), rfqId: id, values, fileUrl: file, papers }),
  z.object({ action: z.literal("quote.version"), offerId: id, mode: z.enum(["edit", "reduce"]), values, fileUrl: file }),
  z.object({ action: z.literal("quote.final"), offerId: id, note: z.string().trim().max(500).default("") }),
  z.object({ action: z.literal("quote.withdraw"), offerId: id }),
  z.object({ action: z.literal("quote.sample"), offerId: id, sentAt: day, receivedBy: z.string().trim().max(120).default(""), note: z.string().trim().max(500).default("") }),
  z.object({ action: z.literal("quote.decline"), rfqId: id, note: z.string().trim().max(500).default("") }),
  z.object({ action: z.literal("quote.ask"), rfqId: id, question: z.string().trim().min(1).max(1000) }),
])
export type QuoteAct = z.infer<typeof quoteActSchema>

export interface QuoteSupplier {
  uid: string
  name: string
  orgId: string
  company: string
  /** His specialties and coverage cities — what makes a public request his (RFQ-01). */
  field: { specs: string[]; cities: string[] }
  /** The VAT rate his company charges (15% with a VAT number, else 0), stored on every version (decision 9). */
  vatRate?: number
}

type Rec = Record<string, unknown>
const withId = (data: unknown, id: string): Rec & { id: string } => ({ ...((data || {}) as Rec), id })
const str =(v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))

/** The request is still taking quotes: open, and its deadline (a day) not yet past in Riyadh. */
function assertOpen(rfq: Rec, today: string) {
  if (str(rfq.status) !== "New") throw new QuoteActError("rfq_closed")
  const deadline = str(rfq.deadline).slice(0, 10)
  if (deadline && daysBetween(deadline, today) < 0) throw new QuoteActError("deadline")
}

function assertOwn(offer: Rec | undefined, s: QuoteSupplier): Rec {
  if (!offer) throw new QuoteActError("offer_missing")
  if (str(offer.organizationId) !== s.orgId || offer.supplierId === "guest") throw new QuoteActError("not_yours")
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

function blocksOrThrow(rfq: Rec, v: QuoteValues, mode: "new" | "edit" | "reduce", today: string) {
  const check = quoteBlocks(quoteShapeOf(rfq), v, mode, { daysTo: (iso, from) => daysBetween(iso, from ?? today) })
  if (check.blocks.length) throw new QuoteActError(check.blocks[0].code === "deadline" ? "deadline" : "blocked", check.blocks[0].code)
}

export async function runQuoteAct(db: Firestore, s: QuoteSupplier, act: QuoteAct, now: Date = new Date()): Promise<Record<string, unknown>> {
  const at = now.toISOString()
  const today = riyadhDay(now)
  const rfqRef = (rfqId: string) => db.collection("rfqs").doc(rfqId)
  const offerRef = (offerId: string) => db.collection("offers").doc(offerId)

  switch (act.action) {
    case "quote.new": {
      const v = act.values as QuoteValues
      const ref = db.collection("offers").doc()
      const { rfq, total } = await db.runTransaction(async (tx) => {
        const snap = await tx.get(rfqRef(act.rfqId))
        if (!snap.exists) throw new QuoteActError("rfq_missing")
        // One live quote per company per request: a second one is an edit. Read INSIDE the transaction, which also
        // writes the request (its count) — two submits at once collide on it, and the retry sees the first quote.
        const mine = await tx.get(liveQuotesOf(db, act.rfqId, s.orgId))
        if (mine.docs.some((d) => !isWithdrawnOffer(d.data() as Rec))) throw new QuoteActError("already_quoted")
        const r = withId(snap.data(), snap.id)
        assertOpen(r, today)
        if (!requestReaches(r, s.orgId, s.field)) throw new QuoteActError("not_reached")
        blocksOrThrow(r, v, "new", today)
        const shape = quoteShapeOf(r)
        const version = versionOf(shape, v, today, act.fileUrl, s.vatRate)
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
        tx.update(rfqRef(r.id), { offersCount: FieldValue.increment(1) })
        return { rfq: r, total: version.total }
      })
      // The amount is named only when the round is not sealed — only the server can tell.
      const contractorId = str(rfq.contractorId)
      if (contractorId) {
        const orgId = str(rfq.organizationId) || contractorId
        const settings = (await db.collection("procurementSettings").doc(orgId).get().catch(() => null))?.data()
        const sealed = offersSealed(rfq as Parameters<typeof offersSealed>[0], resolvePolicies(settings as Partial<ProcurementPolicies> | undefined), now)
        const notice = newOfferNotice({ supplier: s.company, rfqTitle: str(rfq.title), price: sealed ? null : total, sealed })
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
        const status = str(offer.status)
        if (act.mode === "reduce") {
          if (status !== REDUCE) throw new QuoteActError("wrong_state")
          if (str(r.status) !== "New") throw new QuoteActError("rfq_closed")
          const by = replyByOf(offer)
          if (by && daysBetween(by, today) < 0) throw new QuoteActError("reply_closed")
        } else {
          if (status !== UNDER_REVIEW && status !== REDUCE) throw new QuoteActError("wrong_state")
          assertOpen(r, today)
        }
        blocksOrThrow(r, v, act.mode, today)
        const shape = quoteShapeOf(r)
        const version = versionOf(shape, v, today, act.fileUrl, s.vatRate)
        const rates: Record<number, string> = {}
        shape.items.forEach((i, k) => {
          if (!v.skip[i.id] && String(v.prices[i.id] ?? "").trim() !== "") rates[k] = v.prices[i.id]
        })
        // The same revision every contractor-side reader expects: price, rates and batches that agree.
        const current = { price: offer.price as string, lines: (offer.lines as never) || [], deliveryBatches: (offer.deliveryBatches as never) || [], totalBatchesPrice: offer.totalBatchesPrice as never }
        const byRates = revisePrice(
          current,
          shape.pricing === "item" ? pricedProducts({ pricingMode: str(r.pricingMode), shipmentMode: str(r.shipmentMode), products: (r.products as never) || [] }) : null,
          { total: String(version.total), rates: shape.pricing === "item" ? rates : undefined }
        )
        // A version that leaves an item out cannot be revised rate by rate (LINE_PRICES_INCOMPLETE): revise it on its
        // total, so the batches and `totalBatchesPrice` — which the award reads first — never keep the old figures.
        const rev = byRates.ok ? byRates : revisePrice(current, null, { total: String(version.total) })
        const fields: Rec = rev.ok ? { ...rev.fields } : {}
        if (shape.pricing === "item" && version.lines) fields.lines = version.lines
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
          priceHistory: history,
          updatedAt: at,
          supplierNote: v.note.trim().slice(0, 1000),
        }
        if (act.fileUrl) patch.offerPdfUrl = act.fileUrl
        if (v.arrive) {
          const batches = (fields.deliveryBatches as Rec[] | undefined) || (offer.deliveryBatches as Rec[] | undefined) || []
          patch.deliveryBatches = batches.length ? batches.map((b, i) => (i === 0 ? { ...b, deliveryDate: v.arrive } : b)) : [{ location: str(r.city), deliveryDate: v.arrive, price: String(version.total), quantity: "" }]
        }
        if (act.mode === "reduce") patch.reductionReply = { at: today, kind: "lowered" }
        tx.update(offerRef(act.offerId), patch as UpdateData<DocumentData>)
        return r
      })
      await tellOwner(db, s, rfq, "sup_quote_version", { n }, act.offerId)
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
        if (str(offer.status) !== REDUCE || offer.poId) throw new QuoteActError("wrong_state")
        if (str(r.status) !== "New") throw new QuoteActError("rfq_closed")
        const by = replyByOf(offer)
        if (by && daysBetween(by, today) < 0) throw new QuoteActError("reply_closed")
        tx.update(offerRef(act.offerId), { status: UNDER_REVIEW, reductionReply: { at: today, kind: "final", note }, updatedAt: at })
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
        .set({ organizationId: s.orgId, declined: { [act.rfqId]: { at: today, note: act.note, byId: s.uid } }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      await tellOwner(db, s, rfq, "sup_invite_declined", { note: act.note })
      return {}
    }
    case "quote.ask": {
      // A question on a request he can see, while it is open (RFQ-04). Written by the server so the buying side is told
      // — the request's creator and whoever runs its RFQs — and so the asker's company is the one he acts for.
      const snap = await rfqRef(act.rfqId).get()
      if (!snap.exists) throw new QuoteActError("rfq_missing")
      const rfq = withId(snap.data(), snap.id)
      if (str(rfq.status) !== "New") throw new QuoteActError("rfq_closed")
      if (!(await seesRequest(db, rfq, s.orgId))) throw new QuoteActError("not_reached")
      const question = act.question.trim().slice(0, 1000)
      const ref = rfqRef(rfq.id).collection("inquiries").doc()
      await ref.set({
        question,
        supplierId: s.uid,
        userId: s.uid,
        organizationId: s.orgId,
        supplierName: s.company,
        submittedByUserId: s.uid,
        submittedByUserName: s.name,
        reply: null,
        repliedAt: null,
        createdAt: at,
      })
      await tellAboutQuestion(db, s, rfq, ref.id, question, at)
      return { id: ref.id }
    }
    default:
      throw new QuoteActError("invalid")
  }
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
}

/** The questions on a request as a supplier may read them (decision 10): his company's own with their state, and the
 * answered ones of others — without who asked. */
export async function questionsFor(db: Firestore, orgId: string, rfqId: string): Promise<SupplierQuestion[]> {
  const ref = db.collection("rfqs").doc(rfqId)
  const snap = await ref.get()
  if (!snap.exists) throw new QuoteActError("rfq_missing")
  if (!(await seesRequest(db, withId(snap.data(), snap.id), orgId))) throw new QuoteActError("not_reached")
  const rows = await ref.collection("inquiries").get()
  return rows.docs
    .map((d): Rec & { id: string } => ({ ...(d.data() as Rec), id: d.id }))
    .map((q) => ({ id: q.id, question: str(q.question), reply: str(q.reply).trim() || null, repliedAt: str(q.repliedAt) || null, createdAt: str(q.createdAt) || null, mine: str(q.organizationId) === orgId }))
    .filter((q) => q.mine || !!q.reply)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
}

/** The buying side hears of a question: the request's creator and the holders of rfq.manage (the owner among them). */
async function tellAboutQuestion(db: Firestore, s: QuoteSupplier, rfq: Rec & { id: string }, inquiryId: string, question: string, at: string): Promise<void> {
  try {
    const orgId = str(rfq.organizationId) || str(rfq.contractorId)
    const holders = await permissionHolders(db, orgId, ["rfq.manage"]).catch(() => [] as string[])
    const to = [...new Set([str(rfq.createdByUserId), str(rfq.contractorId), ...holders].filter((u) => !!u && u !== s.uid))]
    const rfqName = str(rfq.rfqNumber) || str(rfq.title)
    const params = { supplier: s.company, rfq: rfqName, question: question.length > 120 ? `${question.slice(0, 120)}…` : question }
    await Promise.all(
      to.map((uid) =>
        db
          .collection("users")
          .doc(uid)
          .collection("notifications")
          .doc(`rfq_question__${inquiryId}`)
          .set({
            userId: uid,
            organizationId: orgId,
            type: "rfq_question",
            title: `سؤال من ${s.company} على ${rfqName}`,
            message: params.question,
            i18n: { title: "pn_rfq_question_title", message: "pn_rfq_question", params },
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
    console.warn("question notice failed:", (err as { code?: string })?.code || err)
  }
}

/** His field, read the way his screens read it: the user's profile, with a secondary company's own lists over it. */
export async function supplierFieldOf(db: Firestore, user: Rec, orgId: string, uid: string): Promise<QuoteSupplier["field"]> {
  const list = (v: unknown) => (Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [])
  let specs = list(user.specializations)
  let cities = list(user.coverageCities)
  if (orgId && orgId !== uid) {
    const org = (await db.collection("organizations").doc(orgId).get().catch(() => null))?.data() as Rec | undefined
    if (org && list(org.specializations).length) specs = list(org.specializations)
    if (org && list(org.coverageCities).length) cities = list(org.coverageCities)
  }
  return { specs, cities }
}

export const isQuoteAct = (body: unknown): boolean => typeof (body as { action?: unknown } | null)?.action === "string" && String((body as { action: string }).action).startsWith("quote.")
