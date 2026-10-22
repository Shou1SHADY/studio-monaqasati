// The visitor's side of an RFQ link, run on the server (Admin SDK): his quote, every edit of it, the answer to a better-price
// round, his questions, and what he is told once the request is decided. A visitor has no account — his verified mobile is
// his identity (LNK-09). Every act re-reads the request in the SAME transaction that writes (G-07), so a quote cannot land
// between the award and the page that was still open; and an edit is the offer's NEXT version, which keeps the one before and
// never touches the buyer's decisions about it — those are a separate record (G-15). Server-only.

import { FieldValue, type DocumentData, type Firestore, type UpdateData } from "firebase-admin/firestore"
import { riyadhDay } from "@/lib/hr/format"
import { isWithdrawnOffer } from "@/lib/procurement/award"
import { rfqOfferKey } from "@/lib/procurement/event-keys"
import { mergeGuestPapers, type GuestPaper } from "@/lib/procurement/guest-supplier"
import { bafoOpen, bafoReplyBy, bafoReplyKind, bafoReplyRefusal, type OfferBafo } from "@/lib/procurement/offer-decisions"
import { buildQuote, currentVersionOf, nextVersions, offerRev, quotingGate, versionFromQuote, type BuiltQuote, type QuoteInput, type QuoteLineInput, type QuoteRfq, type StoredVersion } from "@/lib/procurement/offer-versions"
import { UNDER_REVIEW } from "@/lib/procurement/supplier"
import { rfqKeyPart, sendProcEvent } from "@/lib/procurement/proc-event-server"
import { rfqLogEntry, type RfqLogEntry } from "@/lib/procurement/rfq-detail"
import { linkStateOf, resultOf, type VisitorResult } from "@/lib/procurement/rfq-share-view"
import { readLinkSession, sessionSecretOf, type LinkSessionResult } from "@/lib/links/session"
import { guestVisibleStatus } from "@/lib/guest-offer"
import { ownsQuote, tellAboutAnswer, visitorActor } from "@/lib/supplier-free/server-quote-acts"
import { createInquiry } from "@/lib/procurement/rfq-server/inquiry"
import { notifyNamed } from "@/lib/supplier-free/server-notify"

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))
const withId = (data: unknown, id: string): Rec & { id: string } => ({ ...((data || {}) as Rec), id })

export type VisitorCode =
  | "NO_SESSION"
  | "SESSION_EXPIRED"
  | "SESSION_SCOPE"
  | "RFQ_CLOSED"
  | "DEADLINE_PASSED"
  | "LINK_OFFER_LIMIT"
  | "OFFER_MISSING"
  | "NOT_YOURS"
  | "WRONG_STATE"
  | "REPLY_CLOSED"
  | "PRICE_HIGHER"
  | "NOT_ASKED"
  | "INVALID_INPUT"
  | "PRICE_INVALID"
  | "PRICE_TOO_BIG"
  | "PACK_NOT_OFFERED"
  | "WARRANTY_INVALID"
  | "LINE_PRICES_INCOMPLETE"
  | "LINE_CONTRADICTORY"
  | "NO_LINE_PRICED"
  | "INVALID_DURATION"
  | "VALID_MISSING"
  | "VALID_BEFORE_CLOSE"

export class VisitorError extends Error {
  constructor(
    readonly code: VisitorCode,
    readonly status: number = 400,
    readonly detail?: Rec
  ) {
    super(code)
    this.name = "VisitorError"
  }
}

export const MAX_OFFERS_PER_LINK = 100

const REFUSAL_CODES: Record<string, VisitorCode> = {
  price_invalid: "PRICE_INVALID",
  price_too_big: "PRICE_TOO_BIG",
  pack_not_offered: "PACK_NOT_OFFERED",
  warranty_invalid: "WARRANTY_INVALID",
  line_prices_incomplete: "LINE_PRICES_INCOMPLETE",
  line_contradictory: "LINE_CONTRADICTORY",
  no_line_priced: "NO_LINE_PRICED",
}

/** Why a quote's numbers were refused, as the code the page has a sentence for. */
export const quoteRefusalCode = (code: string): VisitorCode => REFUSAL_CODES[code] ?? "INVALID_INPUT"

// ---------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------

export interface Visitor {
  phone: string
  linkId: string
}

/** The visitor behind a request: the session his verified code bought, scoped to this one link. */
export async function visitorOf(db: Firestore, headers: Pick<Headers, "get">, linkId: string, now = Date.now()): Promise<Visitor> {
  const found: LinkSessionResult = await readLinkSession(db, sessionSecretOf(headers), { kind: "rfq", linkId }, now)
  if (!found.ok) throw new VisitorError(found.code, found.status)
  return { phone: found.phone, linkId }
}

/** The company a registered supplier holds under this mobile — a link never renames it (R-04). */
export async function registeredNameOf(db: Firestore, phone: string): Promise<string | null> {
  const snap = await db.collection("users").where("phone", "==", phone).where("role", "==", "Supplier").limit(1).get()
  const user = snap.docs[0]?.data() as Rec | undefined
  return user ? str(user.companyName).trim() || null : null
}

export const offerOfVisitor = (offer: Rec, phone: string): boolean => ownsQuote({ kind: "visitor", phone }, offer)

async function liveOfferOf(db: Firestore, rfqId: string, phone: string): Promise<(Rec & { id: string }) | null> {
  const snap = await db.collection("offers").where("rfqId", "==", rfqId).where("guestContact.phone", "==", phone).get()
  const rows = snap.docs.map((d) => withId(d.data(), d.id)).filter((o) => offerOfVisitor(o, phone) && !isWithdrawnOffer(o as { status?: string | null; withdrawnAt?: unknown }))
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// His quote: first send, and every edit
// ---------------------------------------------------------------------------

export interface VisitorQuoteInput {
  phone: string
  verified: boolean
  company: string
  contactName: string
  email: string
  vatNumber: string | null
  deliveryLocation: string
  deliveryDate: string
  leadDays: number | null
  executionDuration: string
  executionDurationUnit: string
  validUntil: string
  note: string
  quote: QuoteInput
  vatRegistered: boolean
  terms: Rec
  pdfUrl: string | null
  papers: GuestPaper[]
  channel: string
}

export interface VisitorQuoteResult {
  offerId: string
  n: number
  created: boolean
  total: number
  gross: number
  validUntil: string
  companyName: string
  rfq: Rec & { id: string }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The id the offer will have, found before any file is stored under it: his live offer on this request, or a fresh id. */
export async function offerIdFor(db: Firestore, rfqId: string, phone: string): Promise<{ id: string; existing: boolean }> {
  const live = await liveOfferOf(db, rfqId, phone)
  return live ? { id: live.id, existing: true } : { id: db.collection("offers").doc().id, existing: false }
}

export async function writeVisitorQuote(db: Firestore, ctx: { rfqId: string; linkId: string; link: Rec; offerId: string; input: VisitorQuoteInput; now: Date }): Promise<VisitorQuoteResult> {
  const { rfqId, linkId, link, offerId, input, now } = ctx
  const at = now.toISOString()
  const today = riyadhDay(now)
  const rfqRef = db.collection("rfqs").doc(rfqId)
  const offerRef = db.collection("offers").doc(offerId)
  const verifiedAt = input.verified ? at : null

  const out = await db.runTransaction(async (tx) => {
    const rSnap = await tx.get(rfqRef)
    if (!rSnap.exists) throw new VisitorError("RFQ_CLOSED", 409)
    const rfq = withId(rSnap.data(), rSnap.id)
    const gate = quotingGate(rfq as { status?: unknown; deadline?: unknown }, today)
    if (gate) throw new VisitorError(gate === "deadline" ? "DEADLINE_PASSED" : "RFQ_CLOSED", 409)

    const mine = await tx.get(db.collection("offers").where("rfqId", "==", rfqId).where("guestContact.phone", "==", input.phone))
    const live = mine.docs.map((d) => withId(d.data(), d.id)).find((o) => offerOfVisitor(o, input.phone) && !isWithdrawnOffer(o as { status?: string | null; withdrawnAt?: unknown }))

    const built = buildQuote(rfq as QuoteRfq, input.quote, { registered: input.vatRegistered })
    if (!built.ok) throw new VisitorError(quoteRefusalCode(built.refusal.code), 400, { indexes: built.refusal.indexes })
    const quote: BuiltQuote = built.quote
    const version = versionFromQuote(quote, { at: today, arrive: input.deliveryDate || null, valid: input.validUntil, note: input.note, fileUrl: input.pdfUrl, leadDays: input.leadDays, by: "guest", n: 1 })
    const gross = round2(quote.total * (1 + quote.vatRate))

    if (live) {
      const status = str(live.status)
      if (live.poId || status !== UNDER_REVIEW && status !== "مطلوب تخفيض") throw new VisitorError("WRONG_STATE", 409)
      const versions = nextVersions(live, version)
      const n = versions.length
      const previousPrice = Number(live.price)
      const history = Array.isArray(live.priceHistory) ? [...(live.priceHistory as Rec[])] : []
      if (Number.isFinite(previousPrice) && previousPrice > 0) history.push({ price: str(live.price), replacedAt: at, by: "guest" })
      const contact = { ...((live.guestContact as Rec | undefined) || {}) }
      const patch: Rec = {
        price: String(quote.total),
        ...(quote.mode === "line" ? { lines: quote.lines, skippedItems: quote.skipped.length ? quote.skipped : [] } : { lines: [], skippedItems: [] }),
        lump: quote.lump,
        whole: quote.whole,
        vatRegistered: quote.vatRegistered,
        vatRate: quote.vatRate,
        ...(input.leadDays != null ? { leadDays: input.leadDays } : {}),
        validUntil: input.validUntil,
        status: UNDER_REVIEW,
        versions,
        rev: n,
        priceHistory: history,
        updatedAt: at,
        readAt: null,
        guestMessage: input.note || null,
        guestContact: {
          ...contact,
          name: input.contactName || str(contact.name),
          email: input.email || str(contact.email),
          vatNumber: input.vatNumber || (contact.vatNumber as string | null) || null,
          phoneVerified: Boolean(contact.phoneVerified) || input.verified,
          ...(verifiedAt && !contact.phoneVerifiedAt ? { phoneVerifiedAt: verifiedAt } : {}),
        },
        ...(input.papers.length ? { guestPapers: mergeGuestPapers(live.guestPapers as GuestPaper[] | undefined, input.papers) } : {}),
        ...input.terms,
      }
      if (input.pdfUrl) patch.offerPdfUrl = input.pdfUrl
      if (input.executionDuration) {
        patch.executionDuration = input.executionDuration
        patch.executionDurationUnit = input.executionDurationUnit || "أيام"
      }
      if (input.deliveryDate || input.deliveryLocation) {
        const batches = Array.isArray(live.deliveryBatches) ? (live.deliveryBatches as Rec[]) : []
        patch.deliveryBatches = batches.length
          ? batches.map((b, i) => (i === 0 ? { ...b, price: String(quote.total), deliveryDate: input.deliveryDate || str(b.deliveryDate), location: input.deliveryLocation || str(b.location) } : b))
          : [{ location: input.deliveryLocation, deliveryDate: input.deliveryDate, price: String(quote.total), quantity: "" }]
      }
      tx.update(db.collection("offers").doc(live.id), patch as UpdateData<DocumentData>)
      tx.update(rfqRef, { log: [...((Array.isArray(rfq.log) ? rfq.log : []) as RfqLogEntry[]), rfqLogEntry({ uid: `guest:${input.phone}`, name: str(live.companyName) }, "offer_versioned", at, { params: { supplier: str(live.companyName), version: n } })] })
      return { id: live.id, n, created: false, company: str(live.companyName), rfq, total: quote.total, gross }
    }

    if ((Number(link.offersSubmitted) || 0) >= MAX_OFFERS_PER_LINK) throw new VisitorError("LINK_OFFER_LIMIT", 429)
    const company = input.company
    const requiredQuantity = Array.isArray(rfq.products) && rfq.products.length > 0 ? (rfq.products as Rec[]).reduce((sum, p) => sum + (Number(p.quantity) || 0), 0) : Number(rfq.quantity) || 0
    const offerData: Rec = {
      supplierId: "guest",
      organizationId: "guest",
      supplierName: company,
      companyName: company,
      supplierWebsite: null,
      submittedByUserId: null,
      submittedByUserName: input.contactName || company,
      rfqId,
      rfqTitle: str(rfq.title),
      projectId: str(rfq.projectId) || null,
      contractorId: str(rfq.contractorId) || null,
      contractorOrgId: str(rfq.organizationId) || str(rfq.contractorId) || null,
      price: String(quote.total),
      ...(quote.mode === "line" ? { lines: quote.lines } : {}),
      ...(quote.skipped.length ? { skippedItems: quote.skipped } : {}),
      ...(quote.lump != null ? { lump: quote.lump } : {}),
      whole: quote.whole,
      vatRegistered: quote.vatRegistered,
      vatRate: quote.vatRate,
      ...(input.leadDays != null ? { leadDays: input.leadDays } : {}),
      deliveryLocation: input.deliveryLocation,
      deliveryBatches: [{ location: input.deliveryLocation, deliveryDate: input.deliveryDate, price: String(quote.total), quantity: String(requiredQuantity || "") }],
      status: UNDER_REVIEW,
      isGuestOffer: true,
      guestContact: {
        name: input.contactName,
        email: input.email,
        phone: input.phone,
        vatNumber: input.vatNumber,
        phoneVerified: input.verified,
        ...(verifiedAt ? { phoneVerifiedAt: verifiedAt } : {}),
      },
      ...(input.papers.length ? { guestPapers: input.papers } : {}),
      guestMessage: input.note || null,
      shareLinkId: linkId,
      guestChannel: input.channel,
      validUntil: input.validUntil,
      versions: [{ ...version, n: 1 }],
      rev: 1,
      createdAt: at,
      ...input.terms,
    }
    if (input.pdfUrl) offerData.offerPdfUrl = input.pdfUrl
    if (input.executionDuration) {
      offerData.executionDuration = input.executionDuration
      offerData.executionDurationUnit = input.executionDurationUnit || "أيام"
    }
    tx.set(offerRef, offerData)
    tx.update(rfqRef, { offersCount: FieldValue.increment(1) })
    return { id: offerId, n: 1, created: true, company, rfq, total: quote.total, gross }
  })

  const no = rfqKeyPart(out.rfq, rfqId)
  await sendProcEvent(db, {
    id: "rfq_offer",
    key: rfqOfferKey(no, out.id, out.n),
    organizationId: str(out.rfq.organizationId) || str(out.rfq.contractorId),
    by: "guest",
    at,
    refs: { rfq: no, offer: out.id },
    payload: { version: out.n, ...(out.created ? { channel: "link" } : { mode: "edit" }) },
  })
  if (!out.created) {
    await notifyNamed(
      db,
      { uid: `guest:${input.phone}`, name: out.company },
      { kind: "sup_quote_version", organizationId: str(out.rfq.organizationId) || str(out.rfq.contractorId), params: { supplier: out.company, rfq: str(out.rfq.rfqNumber) || str(out.rfq.title), n: out.n }, rfqId, offerId: out.id, link: `/contractor/rfqs/${rfqId}/offers` },
      [str(out.rfq.contractorId) || null]
    ).catch((err) => console.warn("visitor quote notice failed:", (err as { code?: string })?.code || err))
  }
  return { offerId: out.id, n: out.n, created: out.created, total: out.total, gross: out.gross, validUntil: input.validUntil, companyName: out.company, rfq: out.rfq }
}

// ---------------------------------------------------------------------------
// A better price (RFQ-11) — one round, after the close too, until the day he was given
// ---------------------------------------------------------------------------

export interface BafoInput {
  lines?: QuoteLineInput[]
  total?: unknown
  note: string
}

/** The reply keeps everything about his quote but the prices: packs, warranties, what he does not supply, VAT, «for all». */
export async function answerBafo(db: Firestore, visitor: Visitor, rfqId: string, input: BafoInput, now: Date = new Date()): Promise<{ n: number; kind: "lowered" | "kept"; total: number }> {
  const at = now.toISOString()
  const today = riyadhDay(now)
  const live = await liveOfferOf(db, rfqId, visitor.phone)
  if (!live) throw new VisitorError("OFFER_MISSING", 404)
  const rfqRef = db.collection("rfqs").doc(rfqId)
  const offerRef = db.collection("offers").doc(live.id)

  const out = await db.runTransaction(async (tx) => {
    const oSnap = await tx.get(offerRef)
    const offer = withId(oSnap.data(), oSnap.id)
    if (!oSnap.exists || !offerOfVisitor(offer, visitor.phone)) throw new VisitorError("NOT_YOURS", 403)
    const rSnap = await tx.get(rfqRef)
    if (!rSnap.exists) throw new VisitorError("RFQ_CLOSED", 409)
    const rfq = withId(rSnap.data(), rSnap.id)
    if (offer.poId || isWithdrawnOffer(offer as { status?: string | null; withdrawnAt?: unknown })) throw new VisitorError("WRONG_STATE", 409)
    if (!bafoOpen(offer as never)) throw new VisitorError("NOT_ASKED", 409)
    if (str(rfq.status) !== "New") throw new VisitorError("RFQ_CLOSED", 409)
    const by = bafoReplyBy(offer as never)
    if (by && by < today) throw new VisitorError("REPLY_CLOSED", 409)

    const previous = currentVersionOf(offer)
    const kept = new Map((previous.lines || []).map((l) => [l.rfqProductIndex, l]))
    const prices = new Map((input.lines || []).map((l) => [Number(l.rfqProductIndex), l.unitPrice]))
    const lineInputs: QuoteLineInput[] = [...kept.values()].map((l) => ({ rfqProductIndex: l.rfqProductIndex, unitPrice: prices.has(l.rfqProductIndex) ? prices.get(l.rfqProductIndex) : l.unitPrice, packLen: l.packLen, warrantyMonths: l.warrantyMonths }))
    const vatRegistered = offer.vatRegistered !== false
    const built = buildQuote(rfq as QuoteRfq, { lines: lineInputs, skipped: previous.skipped || [], total: input.total ?? previous.total, whole: previous.whole }, { registered: vatRegistered })
    if (!built.ok) throw new VisitorError(quoteRefusalCode(built.refusal.code), 400, { indexes: built.refusal.indexes })
    if (bafoReplyRefusal(previous.total, built.quote.total)) throw new VisitorError("PRICE_HIGHER", 400)

    const version: StoredVersion = {
      ...versionFromQuote(built.quote, { at: today, arrive: previous.arrive, valid: previous.valid, note: input.note, fileUrl: previous.fileUrl, leadDays: previous.leadDays ?? null, by: "guest", bafoReply: bafoReplyKind(previous.total, built.quote.total) }),
    }
    const versions = nextVersions(offer, version)
    const n = versions.length
    const stored = offer.bafo as OfferBafo | undefined
    const history = Array.isArray(offer.priceHistory) ? [...(offer.priceHistory as Rec[])] : []
    history.push({ price: str(offer.price), replacedAt: at, by: "guest" })
    const patch: Rec = {
      price: String(built.quote.total),
      ...(built.quote.mode === "line" ? { lines: built.quote.lines } : {}),
      status: UNDER_REVIEW,
      versions,
      rev: n,
      bafo: { at: stored?.at || str(offer.reductionAt) || at, byId: stored?.byId || "", byName: stored?.byName || "", replyBy: stored?.replyBy || str(offer.reductionBy), note: stored?.note ?? null, round: 1, answered: { at: today, n, kind: version.bafoReply, note: input.note || null } },
      priceHistory: history,
      updatedAt: at,
      revisedAt: at,
      readAt: null,
      guestReplyNote: input.note || null,
    }
    tx.update(offerRef, patch as UpdateData<DocumentData>)
    tx.update(rfqRef, { log: [...((Array.isArray(rfq.log) ? rfq.log : []) as RfqLogEntry[]), rfqLogEntry({ uid: `guest:${visitor.phone}`, name: str(offer.companyName) }, "offer_versioned", at, { params: { supplier: str(offer.companyName), version: n } })] })
    return { n, kind: version.bafoReply ?? "kept", total: built.quote.total, rfq, company: str(offer.companyName) }
  })
  const no = rfqKeyPart(out.rfq, rfqId)
  await sendProcEvent(db, { id: "rfq_offer", key: rfqOfferKey(no, live.id, out.n), organizationId: str(out.rfq.organizationId) || str(out.rfq.contractorId), by: "guest", at, refs: { rfq: no, offer: live.id }, payload: { version: out.n, mode: "reduce" } })
  await notifyNamed(
    db,
    { uid: `guest:${visitor.phone}`, name: out.company },
    { kind: "sup_quote_version", organizationId: str(out.rfq.organizationId) || str(out.rfq.contractorId), params: { supplier: out.company, rfq: str(out.rfq.rfqNumber) || str(out.rfq.title), n: out.n }, rfqId, offerId: live.id, link: `/contractor/rfqs/${rfqId}/offers` },
    [str(out.rfq.contractorId) || null]
  ).catch((err) => console.warn("visitor price notice failed:", (err as { code?: string })?.code || err))
  return { n: out.n, kind: out.kind, total: out.total }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** A question on an open request. Named only when his mobile was verified; an unverified asker is nobody (LNK-08) — the
 * one door a question enters through is the buyer side's `createInquiry`, which keeps that rule. */
export async function askQuestion(db: Firestore, ctx: { rfqId: string; question: string; visitor: Visitor | null; li?: number | null; now?: Date }): Promise<{ id: string; named: boolean }> {
  const snap = await db.collection("rfqs").doc(ctx.rfqId).get()
  if (!snap.exists) throw new VisitorError("RFQ_CLOSED", 409)
  const rfq = withId(snap.data(), snap.id)
  if (str(rfq.status) !== "New") throw new VisitorError("RFQ_CLOSED", 409)
  const named = Boolean(ctx.visitor)
  const mine = ctx.visitor ? await liveOfferOf(db, ctx.rfqId, ctx.visitor.phone) : null
  const company = mine ? str(mine.companyName) : ctx.visitor ? (await registeredNameOf(db, ctx.visitor.phone)) || "" : ""
  const made = await createInquiry(db, { rfq, question: ctx.question, li: ctx.li ?? null, asker: { kind: "visitor", anon: !named, name: company || null, phone: ctx.visitor?.phone ?? null }, at: (ctx.now ?? new Date()).toISOString() })
  return { id: made.id, named }
}

/** The answer to a clarification the buyer asked on HIS offer: it goes back to the buyer on that question and to nobody else. */
export async function answerClarification(db: Firestore, visitor: Visitor, ctx: { rfqId: string; inquiryId: string; answer: string; now?: Date }): Promise<void> {
  const at = (ctx.now ?? new Date()).toISOString()
  const rfqRef = db.collection("rfqs").doc(ctx.rfqId)
  const inqRef = rfqRef.collection("inquiries").doc(ctx.inquiryId)
  const answer = ctx.answer.trim().slice(0, 1000)
  const mine = await liveOfferOf(db, ctx.rfqId, visitor.phone)
  if (!mine) throw new VisitorError("OFFER_MISSING", 404)
  const asked = await db.runTransaction(async (tx) => {
    const rSnap = await tx.get(rfqRef)
    const iSnap = await tx.get(inqRef)
    if (!rSnap.exists || !iSnap.exists) throw new VisitorError("OFFER_MISSING", 404)
    const q = iSnap.data() as Rec
    const to = (q.to || {}) as Rec
    if (q.kind !== "our_question" || str(to.offerId) !== mine.id) throw new VisitorError("NOT_YOURS", 403)
    if (str(q.reply).trim()) throw new VisitorError("WRONG_STATE", 409)
    if (str((rSnap.data() as Rec).status) === "Cancelled") throw new VisitorError("RFQ_CLOSED", 409)
    tx.update(inqRef, { reply: answer, repliedAt: at, repliedBy: `guest:${visitor.phone}`, repliedByUserName: str(mine.companyName), answer: { text: answer, all: false, at, byId: `guest:${visitor.phone}`, byName: str(mine.companyName) } })
    return { rfq: withId(rSnap.data(), rSnap.id), by: str(q.userId) }
  })
  await tellAboutAnswer(db, visitorActor(str(mine.companyName), visitor.phone), asked.rfq, asked.by, ctx.inquiryId, answer, at)
}

// ---------------------------------------------------------------------------
// What he sees on his own: his quote, its result, what is asked of him
// ---------------------------------------------------------------------------

export interface VisitorOfferView {
  id: string
  n: number
  companyName: string
  total: number
  gross: number
  vatRegistered: boolean
  whole: boolean
  validUntil: string
  leadDays: number | null
  lines: Array<{ rfqProductIndex: number; unitPrice: number; packLen?: number; warrantyMonths?: number | null }>
  skipped: number[]
  note: string
  contactName: string
  email: string
  vatNumber: string
  advancePercent: number | null
  creditDays: number | null
  sentAt: string
  verified: boolean
}

export interface VisitorTasks {
  bafo: { replyBy: string; note: string | null; total: number } | null
  questions: Array<{ id: string; question: string }>
}

export interface VisitorMe {
  offer: VisitorOfferView | null
  result: VisitorResult | null
  tasks: VisitorTasks
}

export async function visitorMe(db: Firestore, visitor: Visitor, ctx: { rfqId: string; rfq: Rec; now?: Date; orderUrlOf?: (poId: string) => Promise<string | null> }): Promise<VisitorMe> {
  const now = ctx.now ?? new Date()
  const live = await liveOfferOf(db, ctx.rfqId, visitor.phone)
  if (!live) return { offer: null, result: null, tasks: { bafo: null, questions: [] } }
  const version = currentVersionOf(live)
  const contact = (live.guestContact || {}) as Rec
  const vatRegistered = live.vatRegistered !== false
  const rate = typeof live.vatRate === "number" ? live.vatRate : vatRegistered ? 0.15 : 0
  const total = Number(version.total) || Number(live.price) || 0
  const state = linkStateOf(ctx.rfq, now)
  const shown = await guestVisibleStatus(db, live as never)
  const disclosed = shown === "مقبول" || shown === "تم التسليم"
  const cancelCode = str((ctx.rfq.cancellation as Rec | undefined)?.code) || null
  const result = resultOf(state, live as { poId?: unknown; withdrawnAt?: unknown }, disclosed, cancelCode)
  if (result.kind === "awarded") {
    result.poNumber = str(live.poNumber) || null
    result.orderUrl = ctx.orderUrlOf && typeof live.poId === "string" ? await ctx.orderUrlOf(live.poId).catch(() => null) : null
  }

  const open = str(ctx.rfq.status) === "New"
  const bafo = open && bafoOpen(live as never) ? { replyBy: bafoReplyBy(live as never), note: ((live.bafo as OfferBafo | undefined)?.note ?? null) as string | null, total } : null
  const inquiries = await db.collection("rfqs").doc(ctx.rfqId).collection("inquiries").get()
  const questions = inquiries.docs
    .map((d) => withId(d.data(), d.id))
    .filter((q) => q.kind === "our_question" && str((q.to as Rec | undefined)?.offerId) === live.id && !str(q.reply).trim() && str(ctx.rfq.status) !== "Cancelled")
    .map((q) => ({ id: q.id, question: str(q.question) }))

  return {
    offer: {
      id: live.id,
      n: offerRev(live),
      companyName: str(live.companyName),
      total,
      gross: round2(total * (1 + rate)),
      vatRegistered,
      whole: Boolean(version.whole ?? live.whole),
      validUntil: str(live.validUntil) || version.valid,
      leadDays: typeof live.leadDays === "number" ? live.leadDays : null,
      lines: (version.lines || []).map((l) => ({ rfqProductIndex: l.rfqProductIndex, unitPrice: l.unitPrice, ...(l.packLen != null ? { packLen: l.packLen } : {}), ...(l.warrantyMonths !== undefined ? { warrantyMonths: l.warrantyMonths } : {}) })),
      skipped: version.skipped || (Array.isArray(live.skippedItems) ? (live.skippedItems as number[]) : []),
      note: str(live.guestMessage),
      contactName: str(contact.name),
      email: str(contact.email),
      vatNumber: str(contact.vatNumber),
      advancePercent: typeof live.advancePercent === "number" ? live.advancePercent : null,
      creditDays: typeof live.creditDays === "number" ? live.creditDays : null,
      sentAt: str(version.at),
      verified: Boolean(contact.phoneVerified),
    },
    result,
    tasks: { bafo, questions },
  }
}

