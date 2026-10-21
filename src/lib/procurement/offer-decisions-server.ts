// The buyer's decisions about an offer, run on the server (Admin SDK) — the only door that writes them (G-15, G-16).
// Each act re-reads the RFQ, the offer and its decision record in ONE transaction, re-runs the rule from
// `offer-decisions.ts`, writes the record, appends to the RFQ's log in the caller's name, and afterwards (best-effort)
// tells the supplier or leaves the event in the outbox. A supplier's edit never touches the record: it is a separate
// document with no client write path.

import type { DocumentData, Firestore, UpdateData } from "firebase-admin/firestore"
import { z } from "zod"
import { riyadhDay } from "@/lib/hr/format"
import type { PermissionId } from "@/lib/permissions"
import { rfqCutKey, rfqAnswerKey } from "./event-keys"
import {
  BAFO_NOTE_MAX,
  OFFER_DECISIONS,
  UNDER_REVIEW_STATUS,
  bafoAskRefusal,
  exclusionOf,
  exclusionRefusal,
  isShortlisted,
  revalAskRefusal,
  type DecisionKind,
  type DecisionLogEntry,
  type OfferBafo,
  type OfferDecision,
  type OfferReval,
} from "./offer-decisions"
import { sendProcEvent, rfqKeyPart } from "./proc-event-server"
import { rfqLogEntry, type RfqLogAction, type RfqLogEntry } from "./rfq-detail"
import { rfqMine, runsRfqs, type RfqRunner } from "./rfq-access"

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))

export interface DecisionCaller {
  uid: string
  name: string
  orgId: string
  can: (permission: PermissionId) => boolean
}

export type DecisionRefusalCode =
  | "no_permission"
  | "offer_missing"
  | "rfq_missing"
  | "offer_taken"
  | "offer_withdrawn"
  | "offer_excluded"
  | "not_excluded"
  | "already_excluded"
  | "already_asked"
  | "already_shortlisted"
  | "not_shortlisted"
  | "rfq_not_open"
  | "date_invalid"
  | "reason_required"
  | "reason_text_short"

export class DecisionError extends Error {
  constructor(readonly code: DecisionRefusalCode) {
    super(code)
    this.name = "DecisionError"
  }
}

const id = z.string().trim().min(1).max(128)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const decideSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("shortlist"), offerId: id }),
  z.object({ action: z.literal("unshortlist"), offerId: id }),
  z.object({ action: z.literal("exclude"), offerId: id, code: z.string().trim().max(40), text: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("restore"), offerId: id }),
  z.object({ action: z.literal("bafo"), offerId: id, replyBy: day, note: z.string().trim().max(BAFO_NOTE_MAX).optional() }),
  z.object({ action: z.literal("confirm-price"), offerId: id, note: z.string().trim().max(BAFO_NOTE_MAX).optional() }),
  z.object({ action: z.literal("clarify"), offerId: id, question: z.string().trim().min(1).max(1000) }),
])
export type DecideInput = z.infer<typeof decideSchema>

const LOG_LIMIT = 100

const runnerOf = (c: DecisionCaller): RfqRunner => ({
  uid: c.uid,
  isOwner: c.uid === c.orgId,
  canPrepare: c.can("offers.accept"),
  canApprove: c.can("po.approve"),
  managesRfqs: c.can("rfq.manage") || c.can("rfq.create"),
})

/** Reading and shortlisting are open to whoever sees offers; every other act is the RFQ runner's. */
function mayAct(c: DecisionCaller, action: DecideInput["action"]): boolean {
  const r = runnerOf(c)
  if (r.isOwner) return true
  if (action === "shortlist" || action === "unshortlist") return c.can("offers.view") || runsRfqs(r)
  return runsRfqs(r)
}

const supplierRecipients = (offer: Rec, actor: string): string[] =>
  [...new Set([str(offer.supplierId), str(offer.organizationId), str(offer.submittedByUserId)].filter((u) => !!u && u !== "guest" && u !== actor))]

async function tellSupplier(db: Firestore, offer: Rec & { id: string }, rfq: Rec & { id: string }, caller: DecisionCaller, n: { type: string; key: string; docId: string; params: Record<string, string | number>; title: string; message: string; link: string }, at: string) {
  try {
    const orgId = str(offer.organizationId) && str(offer.organizationId) !== "guest" ? str(offer.organizationId) : ""
    await Promise.all(
      supplierRecipients(offer, caller.uid).map((uid) =>
        db
          .collection("users")
          .doc(uid)
          .collection("notifications")
          .doc(n.docId)
          .set({
            userId: uid,
            organizationId: orgId || uid,
            type: n.type,
            title: n.title,
            message: n.message,
            i18n: { title: `${n.key}_title`, message: n.key, params: n.params },
            link: n.link,
            rfqId: rfq.id,
            offerId: offer.id,
            actorId: caller.uid,
            actorName: caller.name,
            read: false,
            createdAt: at,
          })
      )
    )
  } catch (err) {
    console.warn("supplier notice not sent:", (err as { code?: string })?.code || err)
  }
}

export interface DecisionResult {
  action: DecideInput["action"]
  offerId: string
  rfqId: string
  /** A guest has no inbox: the buyer reaches him on the channel he shared the link on. */
  guest: boolean
  decision: Pick<OfferDecision, "shortlist" | "exclusion">
  id?: string
}

export async function runOfferDecision(db: Firestore, caller: DecisionCaller, input: DecideInput, now: Date = new Date()): Promise<DecisionResult> {
  if (!mayAct(caller, input.action)) throw new DecisionError("no_permission")
  const at = now.toISOString()
  const today = riyadhDay(now)
  const offerRef = db.collection("offers").doc(input.offerId)
  const decisionRef = db.collection(OFFER_DECISIONS).doc(input.offerId)
  const actor = { uid: caller.uid, name: caller.name }
  const mark = { at, byId: caller.uid, byName: caller.name }

  let inquiryId: string | undefined
  let notice: Parameters<typeof tellSupplier>[4] | null = null
  let eventAfter: (() => Promise<unknown>) | null = null

  const out = await db.runTransaction(async (tx) => {
    const oSnap = await tx.get(offerRef)
    if (!oSnap.exists) throw new DecisionError("offer_missing")
    const offer: Rec & { id: string } = { ...(oSnap.data() as Rec), id: oSnap.id }
    const rfqId = str(offer.rfqId)
    const rfqRef = db.collection("rfqs").doc(rfqId || "_")
    const [rSnap, dSnap] = await Promise.all([tx.get(rfqRef), tx.get(decisionRef)])
    if (!rSnap.exists) throw new DecisionError("rfq_missing")
    const rfq: Rec & { id: string } = { ...(rSnap.data() as Rec), id: rSnap.id }
    const buyerOrg = str(rfq.organizationId) || str(rfq.contractorId)
    if (buyerOrg !== caller.orgId) throw new DecisionError("offer_missing")
    // The ★ is a reader's note; every other act is the RFQ's runner's, and a buyer runs only the RFQs he raised.
    const readerAct = input.action === "shortlist" || input.action === "unshortlist"
    if (!readerAct && !rfqMine({ createdByUserId: str(rfq.createdByUserId), contractorId: str(rfq.contractorId) }, runnerOf(caller))) throw new DecisionError("no_permission")

    const existing = dSnap.exists ? (dSnap.data() as Partial<OfferDecision>) : null
    const decision: OfferDecision = {
      offerId: offer.id,
      rfqId,
      organizationId: buyerOrg,
      shortlist: existing?.shortlist ?? null,
      exclusion: existing?.exclusion ?? null,
      log: Array.isArray(existing?.log) ? (existing?.log as DecisionLogEntry[]) : [],
      updatedAt: at,
    }
    const supplier = str(offer.companyName) || str(offer.supplierName) || "—"
    const rfqName = str(rfq.rfqNumber) || str(rfq.title)
    const guest = Boolean(offer.isGuestOffer) || str(offer.supplierId) === "guest"
    const rfqLog: RfqLogEntry[] = Array.isArray(rfq.log) ? (rfq.log as RfqLogEntry[]) : []
    const logged = (kind: DecisionKind, action: RfqLogAction, params: Record<string, string | number>, note?: string | null, meta?: DecisionLogEntry["meta"]) => {
      decision.log = [...decision.log, { ...mark, kind, ...(meta ? { meta } : {}) }].slice(-LOG_LIMIT)
      return [...rfqLog, rfqLogEntry(actor, action, at, { note: note ?? null, params })]
    }
    const taken = Boolean(offer.poId) || str(offer.status) === "مقبول" || str(offer.status) === "تم التسليم"
    const withdrawn = Boolean(offer.withdrawnAt) || str(offer.status) === "مسحوب"
    const excluded = exclusionOf(offer as never, decision) != null
    let offerPatch: Rec | null = null
    let nextLog: RfqLogEntry[] = rfqLog
    let qCount = Number(rfq.qCount) || 0

    switch (input.action) {
      case "shortlist": {
        if (excluded) throw new DecisionError("offer_excluded")
        if (isShortlisted(decision)) throw new DecisionError("already_shortlisted")
        decision.shortlist = mark
        nextLog = logged("shortlist", "shortlisted", { supplier })
        break
      }
      case "unshortlist": {
        if (!isShortlisted(decision)) throw new DecisionError("not_shortlisted")
        decision.shortlist = null
        nextLog = logged("unshortlist", "unshortlisted", { supplier })
        break
      }
      case "exclude": {
        const refusal = exclusionRefusal(input.code, input.text)
        if (refusal) throw new DecisionError(refusal)
        if (taken) throw new DecisionError("offer_taken")
        if (excluded) throw new DecisionError("already_excluded")
        decision.exclusion = { ...mark, code: input.code as never, text: (input.text || "").trim() || null }
        nextLog = logged("exclude", "offer_excluded", { supplier, reason: `@exclusion.${input.code}` }, decision.exclusion.text, { code: input.code })
        break
      }
      case "restore": {
        if (!excluded) throw new DecisionError("not_excluded")
        const legacy = str(offer.status) === "مرفوض"
        decision.exclusion = null
        if (legacy) offerPatch = { status: UNDER_REVIEW_STATUS, exclusion: null }
        nextLog = logged("restore", "offer_restored", { supplier })
        break
      }
      case "bafo": {
        const refusal = bafoAskRefusal({ offer: offer as never, decision, rfqStatus: str(rfq.status), replyBy: input.replyBy, today })
        if (refusal) throw new DecisionError(refusal)
        const bafo: OfferBafo = { ...mark, replyBy: input.replyBy, note: (input.note || "").trim() || null, round: 1, answered: null }
        offerPatch = { bafo, updatedAt: at }
        nextLog = logged("bafo", "bafo_asked", { supplier, date: input.replyBy }, bafo.note)
        const rfqNo = rfqKeyPart(rfq, rfq.id)
        const supplierKey = str(offer.organizationId) && str(offer.organizationId) !== "guest" ? str(offer.organizationId) : offer.id
        notice = {
          type: "rfq_bafo",
          key: "pn_rfq_bafo",
          docId: `rfq_bafo__${offer.id}`,
          params: { rfq: rfqName, date: input.replyBy, note: bafo.note || "" },
          title: `طُلب منك سعر أفضل في ${rfqName}`,
          message: `يطلب المشتري سعراً أفضل لعرضك في «${rfqName}» — ردّك حتى ${input.replyBy}${bafo.note ? `: ${bafo.note}` : ""}`,
          link: `/supplier/offers`,
        }
        eventAfter = () => sendProcEvent(db, { id: "rfq_cut", key: rfqCutKey(rfqNo, supplierKey), organizationId: buyerOrg, by: caller.uid, at, refs: { rfq: rfqNo, offer: offer.id }, payload: { replyBy: input.replyBy, note: bafo.note } })
        break
      }
      case "confirm-price": {
        const refusal = revalAskRefusal({ offer: offer as never, decision, rfqStatus: str(rfq.status) })
        if (refusal) throw new DecisionError(refusal)
        const reval: OfferReval = { ...mark, note: (input.note || "").trim() || null, answered: null }
        offerPatch = { reval, updatedAt: at }
        nextLog = logged("reval", "reval_asked", { supplier })
        notice = {
          type: "rfq_reval",
          key: "pn_rfq_reval",
          docId: `rfq_reval__${offer.id}__${at}`,
          params: { rfq: rfqName },
          title: `طُلب منك تأكيد السعر في ${rfqName}`,
          message: `انتهت صلاحية عرضك في «${rfqName}» — أكّد سعرك بصلاحية جديدة ليدخل الترسية.`,
          link: `/supplier/offers`,
        }
        break
      }
      case "clarify": {
        if (taken) throw new DecisionError("offer_taken")
        if (withdrawn) throw new DecisionError("offer_withdrawn")
        qCount += 1
        const ref = rfqRef.collection("inquiries").doc()
        inquiryId = ref.id
        tx.set(ref, {
          kind: "our_question",
          question: input.question,
          organizationId: buyerOrg,
          userId: caller.uid,
          submittedByUserId: caller.uid,
          submittedByUserName: caller.name,
          to: { orgId: str(offer.organizationId) || null, offerId: offer.id },
          supplierName: supplier,
          reply: null,
          repliedAt: null,
          createdAt: at,
        })
        nextLog = logged("clarify", "message", { supplier }, input.question)
        const rfqNo = rfqKeyPart(rfq, rfq.id)
        notice = {
          type: "rfq_clarify",
          key: "pn_rfq_clarify",
          docId: `rfq_clarify__${ref.id}`,
          params: { rfq: rfqName, question: input.question.length > 120 ? `${input.question.slice(0, 120)}…` : input.question },
          title: `طلب توضيح على عرضك في ${rfqName}`,
          message: input.question.length > 120 ? `${input.question.slice(0, 120)}…` : input.question,
          link: `/supplier/rfqs?rfq=${rfq.id}`,
        }
        eventAfter = () => sendProcEvent(db, { id: "rfq_answer", key: rfqAnswerKey(rfqNo, qCount), organizationId: buyerOrg, by: caller.uid, at, refs: { rfq: rfqNo, offer: offer.id }, payload: { audience: "offer", inquiry: ref.id } })
        break
      }
    }

    tx.set(decisionRef, decision as unknown as DocumentData)
    if (offerPatch) tx.update(offerRef, offerPatch as UpdateData<DocumentData>)
    tx.update(rfqRef, { log: nextLog, ...(input.action === "clarify" ? { qCount } : {}), updatedAt: at })
    return { offer: offer as Rec & { id: string }, rfq: rfq as Rec & { id: string }, decision, guest }
  })

  if (notice && !out.guest) await tellSupplier(db, out.offer, out.rfq, caller, notice, at)
  if (eventAfter) await (eventAfter as () => Promise<unknown>)()
  return { action: input.action, offerId: input.offerId, rfqId: out.rfq.id, guest: out.guest, decision: { shortlist: out.decision.shortlist, exclusion: out.decision.exclusion }, ...(inquiryId ? { id: inquiryId } : {}) }
}
