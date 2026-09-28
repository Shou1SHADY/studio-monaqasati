// An RFQ's own acts beside the award (PRD 3.0 §5.1, the prototype's RFQ page):
// close early and unseal, cancel, exclude an offer with its reason, answer a
// supplier's query to every invitee, the one reduction round, and an offer
// that arrived off the platform. Each is ONE transaction that re-reads the
// RFQ, re-runs the rule from `./rfq-detail` and appends to the RFQ's `log` —
// a stale screen is refused, never half-applied. Notifications ride after the
// write, best-effort, carrying i18n keys so each reader sees his own language.

import { addDoc, collection, doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import type { Translator } from "../mfg-events"
import { buildExclusion } from "./award"
import {
  canCancelRfq,
  canCloseEarly,
  canRunRfq,
  earlyCloseFields,
  isRfqCancelCode,
  manualOfferDoc,
  manualOfferRefusal,
  rfqLogEntry,
  RFQ_CANCELLED,
  type ManualOfferInput,
  type ReductionRound,
  type RfqCancelCode,
  type RfqEarlyClose,
  type RfqLogEntry,
} from "./rfq-detail"
import type { ProcActor } from "./types"
import { ProcWriteError } from "./writes"

interface RfqDoc {
  status?: string
  deadline?: string | null
  title?: string
  closedEarly?: RfqEarlyClose | null
  log?: RfqLogEntry[]
}

const rfqRef = (firestore: Firestore, rfqId: string) => doc(firestore, "rfqs", rfqId)

/** «أغلِق الآن وافتح الأسعار» — the manager's, with a reason, logged in his name. */
export async function closeRfqNow(firestore: Firestore, actor: ProcActor, rfqId: string, reason: string, now = new Date()): Promise<void> {
  if (!canCloseEarly(actor)) throw new ProcWriteError("no_permission")
  if (!reason.trim()) throw new ProcWriteError("reason_required")
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(rfqRef(firestore, rfqId))
    if (!snap.exists()) throw new ProcWriteError("rfq_missing")
    const rfq = snap.data() as RfqDoc
    const fields = earlyCloseFields(rfq, actor, reason, now)
    if (!fields) throw new ProcWriteError("rfq_not_open")
    const at = now.toISOString()
    tx.update(rfqRef(firestore, rfqId), {
      ...fields,
      log: [...(rfq.log || []), rfqLogEntry(actor, "closed_early", at, { note: fields.closedEarly.reason })],
      updatedAt: serverTimestamp(),
    })
  })
}

/** «ألغِ الطلب» — before any award, with one of three reasons. The status
 * becomes "Cancelled" (counted under completed); a stock need reads only open
 * RFQs and so returns to the needs by itself. */
export async function cancelRfq(firestore: Firestore, actor: ProcActor, rfqId: string, code: RfqCancelCode, now = new Date()): Promise<void> {
  if (!canRunRfq(actor)) throw new ProcWriteError("no_permission")
  if (!isRfqCancelCode(code)) throw new ProcWriteError("reason_required")
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(rfqRef(firestore, rfqId))
    if (!snap.exists()) throw new ProcWriteError("rfq_missing")
    const rfq = snap.data() as RfqDoc
    if (!canCancelRfq(rfq)) throw new ProcWriteError("rfq_not_open")
    const at = now.toISOString()
    tx.update(rfqRef(firestore, rfqId), {
      status: RFQ_CANCELLED,
      cancellation: { code, byId: actor.uid, byName: actor.name, at },
      cancelledAt: at,
      log: [...(rfq.log || []), rfqLogEntry(actor, "cancelled", at, { params: { reason: `@rfqCancel.${code}` } })],
      updatedAt: serverTimestamp(),
    })
  })
}

export interface ExcludeInput {
  rfqId: string
  offerId: string
  supplierName: string
  code: string
  note?: string | null
}

/** «استبعاد عرض» — the offer leaves the comparison as `مرفوض` with its reason
 * (`exclusion`), and the RFQ's log names who and why. */
export async function excludeOffer(firestore: Firestore, actor: ProcActor, input: ExcludeInput, now = new Date()): Promise<void> {
  if (!canRunRfq(actor)) throw new ProcWriteError("no_permission")
  const at = now.toISOString()
  const exclusion = buildExclusion({ code: input.code, note: input.note, byId: actor.uid, at })
  if (!exclusion) throw new ProcWriteError("reason_required")
  await runTransaction(firestore, async (tx) => {
    const rSnap = await tx.get(rfqRef(firestore, input.rfqId))
    if (!rSnap.exists()) throw new ProcWriteError("rfq_missing")
    const oRef = doc(firestore, "offers", input.offerId)
    const oSnap = await tx.get(oRef)
    if (!oSnap.exists()) throw new ProcWriteError("offer_missing")
    const offer = oSnap.data() as { status?: string; poId?: string }
    if (offer.poId || offer.status === "مقبول") throw new ProcWriteError("offer_taken")
    const rfq = rSnap.data() as RfqDoc
    tx.update(oRef, {
      status: "مرفوض",
      exclusion,
      decidedByUserId: actor.uid,
      decidedByUserName: actor.name,
      decidedAt: at,
      readAt: null,
    })
    tx.update(rfqRef(firestore, input.rfqId), {
      log: [...(rfq.log || []), rfqLogEntry(actor, "offer_excluded", at, { note: exclusion.note, params: { supplier: input.supplierName, reason: `@exclusion.${exclusion.code}` } })],
      updatedAt: serverTimestamp(),
    })
  })
}

export interface AnswerInput {
  rfqId: string
  rfqTitle: string
  inquiryId: string
  answer: string
  /** Every invitee's inbox (`answerRecipients`). */
  recipients: string[]
}

/** The answer is published on the query and sent to every invitee — no
 * supplier gets an informational edge (§5.1). Returns how many were told. */
export async function answerQuery(firestore: Firestore, actor: ProcActor, input: AnswerInput, opts: { copy?: Translator | null; now?: Date } = {}): Promise<number> {
  if (!canRunRfq(actor)) throw new ProcWriteError("no_permission")
  const answer = input.answer.trim()
  if (!answer) throw new ProcWriteError("reason_required")
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  await runTransaction(firestore, async (tx) => {
    const rSnap = await tx.get(rfqRef(firestore, input.rfqId))
    if (!rSnap.exists()) throw new ProcWriteError("rfq_missing")
    const rfq = rSnap.data() as RfqDoc
    tx.update(doc(firestore, "rfqs", input.rfqId, "inquiries", input.inquiryId), {
      reply: answer,
      repliedAt: at,
      repliedBy: actor.uid,
      repliedByUserName: actor.name,
      sentToAll: true,
      sentToCount: input.recipients.length,
    })
    tx.update(rfqRef(firestore, input.rfqId), {
      log: [...(rfq.log || []), rfqLogEntry(actor, "query_answered", at, { params: { recipients: input.recipients.length } })],
      updatedAt: serverTimestamp(),
    })
  })
  const short = answer.length > 100 ? `${answer.slice(0, 100)}…` : answer
  const params = { rfq: input.rfqTitle || "", reply: short }
  const title = opts.copy?.has("pn_rfq_answer_all_title") ? opts.copy("pn_rfq_answer_all_title", params) : "جواب على استفسار في طلب عروض"
  const message = opts.copy?.has("pn_rfq_answer_all") ? opts.copy("pn_rfq_answer_all", params) : `نُشر جواب على استفسار في «${params.rfq}»: ${short}`
  let told = 0
  await Promise.all(
    input.recipients.map((uid) =>
      addDoc(collection(firestore, "users", uid, "notifications"), {
        userId: uid,
        organizationId: uid,
        type: "inquiry_reply",
        i18n: { title: "pn_rfq_answer_all_title", message: "pn_rfq_answer_all", params },
        title,
        message,
        rfqId: input.rfqId,
        rfqTitle: input.rfqTitle,
        inquiryId: input.inquiryId,
        link: `/supplier/rfqs?rfq=${input.rfqId}`,
        createdAt: at,
        read: false,
      })
        .then(() => {
          told++
        })
        .catch((err) => console.warn("answer notification failed:", (err as { code?: string })?.code || err))
    )
  )
  return told
}

export interface ReductionRoundInput {
  rfqId: string
  /** The competing offers the round goes to — re-read inside the transaction. */
  offerIds: string[]
  targets: ReductionRound["targets"]
  /** What the supplier reads; the same text is given to copy for guests. */
  message: string
}

/**
 * «اطلب جولة تخفيض من كل العروض»: every live offer is asked at once, once per
 * RFQ, without revealing a competitor's price — the targets, when given, are
 * our own last prices. Each offer goes `مطلوب تخفيض` exactly like a single
 * reduction request (the supplier's portal and guest page already answer it);
 * the RFQ records the round so it cannot be asked twice. Returns the offers
 * the round reached.
 */
export async function requestReductionRound(firestore: Firestore, actor: ProcActor, input: ReductionRoundInput, now = new Date()): Promise<string[]> {
  if (!canRunRfq(actor)) throw new ProcWriteError("no_permission")
  const at = now.toISOString()
  return runTransaction(firestore, async (tx) => {
    const rSnap = await tx.get(rfqRef(firestore, input.rfqId))
    if (!rSnap.exists()) throw new ProcWriteError("rfq_missing")
    const rfq = rSnap.data() as RfqDoc & { reductionRound?: ReductionRound | null }
    if (rfq.status !== "New" || rfq.reductionRound) throw new ProcWriteError("rfq_not_open")
    const reached: string[] = []
    for (const id of input.offerIds) {
      const snap = await tx.get(doc(firestore, "offers", id))
      if (!snap.exists()) continue
      const o = snap.data() as { status?: string; poId?: string }
      if (o.poId || o.status === "مرفوض" || o.status === "مقبول" || o.status === "تم التسليم") continue
      reached.push(id)
    }
    if (!reached.length) throw new ProcWriteError("nothing_outstanding")
    for (const id of reached) {
      tx.update(doc(firestore, "offers", id), {
        status: "مطلوب تخفيض",
        reductionNote: input.message.trim() || null,
        reductionTargets: input.targets,
        reductionRound: true,
        decidedByUserId: actor.uid,
        decidedByUserName: actor.name,
        decidedAt: at,
        readAt: null,
      })
    }
    const round: ReductionRound = { at, byId: actor.uid, byName: actor.name, targets: input.targets, offers: reached.length }
    tx.update(rfqRef(firestore, input.rfqId), {
      reductionRound: round,
      log: [...(rfq.log || []), rfqLogEntry(actor, "reduction_round", at, { params: { offers: reached.length } })],
      updatedAt: serverTimestamp(),
    })
    return reached
  })
}

/** «سجّل عرضاً وصل خارج المنصة»: the offer enters the comparison in the
 * buyer's name; the RFQ counts it and logs who keyed it in. */
export async function recordManualOffer(firestore: Firestore, actor: ProcActor, input: ManualOfferInput, products: Array<{ rfqProductIndex: number; quantity: number }>, now = new Date()): Promise<string> {
  if (!canRunRfq(actor)) throw new ProcWriteError("no_permission")
  const refusal = manualOfferRefusal(input)
  if (refusal === "supplier_missing") throw new ProcWriteError("supplier_missing")
  if (refusal) throw new ProcWriteError("price_missing")
  const at = now.toISOString()
  const offerRef = doc(collection(firestore, "offers"))
  await runTransaction(firestore, async (tx) => {
    const rSnap = await tx.get(rfqRef(firestore, input.rfq.id))
    if (!rSnap.exists()) throw new ProcWriteError("rfq_missing")
    const rfq = rSnap.data() as RfqDoc & { offersCount?: number }
    if (rfq.status !== "New") throw new ProcWriteError("rfq_not_open")
    tx.set(offerRef, manualOfferDoc(input, products, actor, at))
    tx.update(rfqRef(firestore, input.rfq.id), {
      offersCount: (Number(rfq.offersCount) || 0) + 1,
      log: [...(rfq.log || []), rfqLogEntry(actor, "offer_recorded", at, { params: { supplier: input.supplier.name.trim() } })],
      updatedAt: serverTimestamp(),
    })
  })
  return offerRef.id
}
