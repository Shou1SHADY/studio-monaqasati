// The questions on an RFQ, written on the server only (Procurement 2.0 QA-01…04, WF-11, G-06): a supplier's question
// from the portal or the visitors' link (`createInquiry`, the one door both use), the buyer's answer «للجميع» or
// «للسائل فقط», and a clarification from us to every invitee. The `inquiries` rules give a browser no write path any more.
// Each act re-reads the RFQ and the question in ONE transaction and re-runs the rule from `rfq-inquiries.ts`; the
// notices and the outbox event ride after the commit, best-effort.

import type { DocumentData, Firestore, UpdateData } from "firebase-admin/firestore"
import { z } from "zod"
import type { PermissionId } from "@/lib/permissions"
import { permissionHolders } from "@/lib/supplier-free/server-notify"
import { rfqAnswerKey, rfqAskKey } from "../event-keys"
import { rfqKeyPart, sendProcEvent } from "../proc-event-server"
import { rfqMine, runsRfqs, type RfqRunner } from "../rfq-access"
import { answerRecipients, rfqLogEntry, type RfqLogEntry } from "../rfq-detail"
import { ANSWER_SCOPES, INQUIRY_TEXT_MAX, answerRefusal, type AnswerRefusal, type AnswerScope, type InquiryDoc } from "../rfq-inquiries"

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))
const cut = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s)

export interface InquiryCaller {
  uid: string
  name: string
  orgId: string
  can: (permission: PermissionId) => boolean
}

export type InquiryErrorCode = AnswerRefusal | "no_permission" | "rfq_missing" | "inquiry_missing" | "rfq_not_open" | "question_missing"

export class InquiryError extends Error {
  constructor(readonly code: InquiryErrorCode) {
    super(code)
    this.name = "InquiryError"
  }
}

const id = z.string().trim().min(1).max(128)
const body = z.string().trim().min(1).max(INQUIRY_TEXT_MAX)

export const inquirySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answer"), rfqId: id, inquiryId: id, text: body, scope: z.enum(ANSWER_SCOPES), question: z.string().trim().max(INQUIRY_TEXT_MAX).optional() }),
  z.object({ action: z.literal("note"), rfqId: id, text: body }),
])
export type InquiryInput = z.infer<typeof inquirySchema>

const runnerOf = (c: InquiryCaller): RfqRunner => ({
  uid: c.uid,
  isOwner: c.uid === c.orgId,
  canPrepare: c.can("offers.accept"),
  canApprove: c.can("po.approve"),
  managesRfqs: c.can("rfq.manage") || c.can("rfq.create"),
})

const rfqOrgOf = (rfq: Rec): string => str(rfq.organizationId) || str(rfq.contractorId)

// ---------------------------------------------------------------------------
// A question arrives — from the supplier's portal or the visitors' link
// ---------------------------------------------------------------------------

export type InquiryAsker =
  | { kind: "supplier"; uid: string; name: string; orgId: string; company: string }
  | { kind: "visitor"; anon: boolean; name?: string | null; phone?: string | null }

export interface NewInquiry {
  rfq: Rec & { id: string }
  question: string
  /** The material the question is about (an RFQ line), when it names one. */
  li?: number | null
  asker: InquiryAsker
  at?: string
}

/** The buying side hears of a question: the request's creator and the holders of rfq.manage (the owner among them). */
async function tellAboutQuestion(db: Firestore, rfq: Rec & { id: string }, inquiryId: string, label: string, question: string, actorUid: string, at: string): Promise<void> {
  try {
    const orgId = rfqOrgOf(rfq)
    const holders = await permissionHolders(db, orgId, ["rfq.manage"]).catch(() => [] as string[])
    const to = [...new Set([str(rfq.createdByUserId), str(rfq.contractorId), ...holders].filter((u) => !!u && u !== actorUid))]
    const rfqName = str(rfq.rfqNumber) || str(rfq.title)
    const params = { supplier: label, rfq: rfqName, question: cut(question) }
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
            title: `سؤال من ${label} على ${rfqName}`,
            message: params.question,
            i18n: { title: "pn_rfq_question_title", message: "pn_rfq_question", params },
            link: `/contractor/rfqs/${rfq.id}/offers?tab=inquiries`,
            rfqId: rfq.id,
            actorId: actorUid,
            actorName: label,
            read: false,
            createdAt: at,
          })
      )
    )
  } catch (err) {
    console.warn("question notice failed:", (err as { code?: string })?.code || err)
  }
}

export const VISITOR_LABEL = "زائر من الرابط"

/**
 * The one door a question enters through. A supplier's carries his company; a visitor's is nameless (`anon`) unless his
 * mobile was verified, so «للسائل فقط» is possible only where there is someone to answer. The buyer is told and the
 * `rfq_ask` event leaves under its own counter.
 */
export async function createInquiry(db: Firestore, input: NewInquiry): Promise<{ id: string; n: number }> {
  const question = input.question.trim().slice(0, INQUIRY_TEXT_MAX)
  if (!question) throw new InquiryError("question_missing")
  const at = input.at ?? new Date().toISOString()
  const rfqRef = db.collection("rfqs").doc(input.rfq.id)
  const ref = rfqRef.collection("inquiries").doc()
  const products = Array.isArray(input.rfq.products) ? (input.rfq.products as unknown[]).length : 0
  const li = Number.isInteger(input.li) && (input.li as number) >= 0 && (input.li as number) < products ? (input.li as number) : null
  const a = input.asker
  const supplier = a.kind === "supplier"
  const anon = supplier ? false : a.anon
  const label = supplier ? a.company : !anon && a.name ? a.name : VISITOR_LABEL

  const n = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rfqRef)
    if (!snap.exists) throw new InquiryError("rfq_missing")
    const count = (Number((snap.data() as Rec).askCount) || 0) + 1
    tx.set(ref, {
      kind: "ask",
      question,
      li,
      from: { orgId: supplier ? a.orgId : null, anon },
      to: null,
      answer: null,
      via: supplier ? "portal" : "link",
      ...(supplier
        ? { supplierId: a.uid, userId: a.uid, organizationId: a.orgId, supplierName: a.company, submittedByUserId: a.uid, submittedByUserName: a.name }
        : { supplierName: anon ? null : a.name || null, visitorPhone: anon ? null : a.phone || null }),
      reply: null,
      repliedAt: null,
      createdAt: at,
    } as DocumentData)
    tx.update(rfqRef, { askCount: count } as UpdateData<DocumentData>)
    return count
  })

  await tellAboutQuestion(db, input.rfq, ref.id, label, question, supplier ? a.uid : "", at)
  await sendProcEvent(db, {
    id: "rfq_ask",
    key: rfqAskKey(rfqKeyPart(input.rfq, input.rfq.id), n),
    organizationId: rfqOrgOf(input.rfq),
    by: supplier ? a.uid : "link",
    at,
    refs: { rfq: rfqKeyPart(input.rfq, input.rfq.id), inquiry: ref.id },
    payload: { li, anon, via: supplier ? "portal" : "link" },
  })
  return { id: ref.id, n }
}

// ---------------------------------------------------------------------------
// The buyer's side: an answer, a clarification to everyone
// ---------------------------------------------------------------------------

async function notify(db: Firestore, uids: string[], docId: string, n: { type: string; key: string; title: string; message: string; params: Record<string, string | number>; rfqId: string; inquiryId: string; link: string }, caller: InquiryCaller, at: string): Promise<number> {
  let told = 0
  await Promise.all(
    uids.map((uid) =>
      db
        .collection("users")
        .doc(uid)
        .collection("notifications")
        .doc(docId)
        .set({
          userId: uid,
          organizationId: uid,
          type: n.type,
          title: n.title,
          message: n.message,
          i18n: { title: `${n.key}_title`, message: n.key, params: n.params },
          link: n.link,
          rfqId: n.rfqId,
          inquiryId: n.inquiryId,
          actorId: caller.uid,
          actorName: caller.name,
          read: false,
          createdAt: at,
        })
        .then(() => void told++)
        .catch((err) => console.warn("answer notification failed:", (err as { code?: string })?.code || err))
    )
  )
  return told
}

const supplierLink = (rfqId: string) => `/supplier/rfqs?rfq=${rfqId}`

export interface InquiryResult {
  action: InquiryInput["action"]
  rfqId: string
  id: string
  scope: AnswerScope
  told: number
}

export async function runInquiry(db: Firestore, caller: InquiryCaller, input: InquiryInput, now: Date = new Date()): Promise<InquiryResult> {
  const runner = runnerOf(caller)
  if (!runsRfqs(runner)) throw new InquiryError("no_permission")
  const at = now.toISOString()
  const actor = { uid: caller.uid, name: caller.name }
  const rfqRef = db.collection("rfqs").doc(input.rfqId)
  const inquiries = rfqRef.collection("inquiries")
  const inqRef = input.action === "answer" ? inquiries.doc(input.inquiryId) : inquiries.doc()

  const out = await db.runTransaction(async (tx) => {
    const [rSnap, iSnap] = await Promise.all([tx.get(rfqRef), input.action === "answer" ? tx.get(inqRef) : Promise.resolve(null)])
    if (!rSnap.exists) throw new InquiryError("rfq_missing")
    const rfq: Rec & { id: string } = { ...(rSnap.data() as Rec), id: rSnap.id }
    if (rfqOrgOf(rfq) !== caller.orgId) throw new InquiryError("rfq_missing")
    if (!rfqMine({ createdByUserId: str(rfq.createdByUserId), contractorId: str(rfq.contractorId) }, runner)) throw new InquiryError("no_permission")
    const log: RfqLogEntry[] = Array.isArray(rfq.log) ? (rfq.log as RfqLogEntry[]) : []
    const qCount = (Number(rfq.qCount) || 0) + 1

    if (input.action === "note") {
      if (str(rfq.status) !== "New") throw new InquiryError("rfq_not_open")
      tx.set(inqRef, {
        kind: "note",
        question: input.text,
        answer: { text: input.text, all: true, at, byId: caller.uid, byName: caller.name },
        reply: input.text,
        repliedAt: at,
        repliedBy: caller.uid,
        repliedByUserName: caller.name,
        sentToAll: true,
        via: "buyer",
        organizationId: caller.orgId,
        userId: caller.uid,
        submittedByUserId: caller.uid,
        submittedByUserName: caller.name,
        from: { orgId: caller.orgId, anon: false },
        createdAt: at,
      } as DocumentData)
      tx.update(rfqRef, { qCount, log: [...log, rfqLogEntry(actor, "message", at, { note: cut(input.text, 200), params: { audience: "all" } })], updatedAt: at } as UpdateData<DocumentData>)
      return { rfq, qCount, inquiry: null as (InquiryDoc & Rec) | null, scope: "all" as AnswerScope, text: input.text }
    }

    if (!iSnap || !iSnap.exists) throw new InquiryError("inquiry_missing")
    const inquiry = iSnap.data() as InquiryDoc & Rec
    const refusal = answerRefusal(inquiry, input.scope, input.text)
    if (refusal) throw new InquiryError(refusal)
    const edited = input.scope === "all" && input.question && input.question.trim() !== str(inquiry.question).trim() ? input.question.trim() : null
    tx.update(inqRef, {
      answer: { text: input.text, all: input.scope === "all", at, byId: caller.uid, byName: caller.name },
      reply: input.text,
      repliedAt: at,
      repliedBy: caller.uid,
      repliedByUserName: caller.name,
      sentToAll: input.scope === "all",
      ...(edited ? { editedQuestion: edited } : {}),
    } as UpdateData<DocumentData>)
    tx.update(rfqRef, { qCount, log: [...log, rfqLogEntry(actor, "query_answered", at, { params: { audience: input.scope } })], updatedAt: at } as UpdateData<DocumentData>)
    return { rfq, qCount, inquiry: { ...inquiry, ...(edited ? { editedQuestion: edited } : {}) }, scope: input.scope, text: input.text }
  })

  const rfqName = str(out.rfq.rfqNumber) || str(out.rfq.title)
  const offers = (await db.collection("offers").where("rfqId", "==", input.rfqId).get()).docs.map((d) => d.data() as Rec)
  const invitees = { allowedSupplierOrgIds: (out.rfq.allowedSupplierOrgIds as string[] | undefined) || [], invitedSupplierOrgIds: (out.rfq.invitedSupplierOrgIds as string[] | undefined) || [] }
  const asker = out.inquiry ? { userId: str(out.inquiry.userId) || null, organizationId: str(out.inquiry.organizationId) || null } : null
  const everyone = answerRecipients(invitees, offers as never, asker as never, caller.uid)
  const recipients = out.scope === "all" ? everyone : [...new Set([asker?.userId, asker?.organizationId].filter((u): u is string => !!u && u !== caller.uid))]

  let told = 0
  if (input.action === "note") {
    const params = { rfq: rfqName, reply: cut(out.text, 100) }
    told = await notify(db, recipients, `rfq_clarification__${inqRef.id}`, { type: "rfq_clarification", key: "pn_rfq_clarification", title: "توضيح من المشتري في طلب عروض", message: `توضيح من المشتري على «${rfqName}»: ${params.reply}`, params, rfqId: input.rfqId, inquiryId: inqRef.id, link: supplierLink(input.rfqId) }, caller, at)
  } else {
    const params = { rfq: rfqName, reply: cut(out.text, 100) }
    const all = out.scope === "all"
    told = await notify(
      db,
      recipients,
      `rfq_answer__${inqRef.id}`,
      {
        type: "inquiry_reply",
        key: all ? "pn_rfq_answer_all" : "pn_rfq_answer_asker",
        title: all ? "جواب على استفسار في طلب عروض" : "جواب على استفسارك في طلب عروض",
        message: all ? `نُشر جواب على استفسار في «${rfqName}»: ${params.reply}` : `جواب على استفسارك في «${rfqName}»: ${params.reply}`,
        params,
        rfqId: input.rfqId,
        inquiryId: inqRef.id,
        link: supplierLink(input.rfqId),
      },
      caller,
      at
    )
  }
  await sendProcEvent(db, {
    id: "rfq_answer",
    key: rfqAnswerKey(rfqKeyPart(out.rfq, out.rfq.id), out.qCount),
    organizationId: caller.orgId,
    by: caller.uid,
    at,
    refs: { rfq: rfqKeyPart(out.rfq, out.rfq.id), inquiry: inqRef.id },
    payload: { audience: out.scope, kind: input.action === "note" ? "note" : "answer" },
  })
  return { action: input.action, rfqId: input.rfqId, id: inqRef.id, scope: out.scope, told }
}
