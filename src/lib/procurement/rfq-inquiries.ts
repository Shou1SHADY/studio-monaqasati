// The questions on an RFQ (Procurement 2.0 QA-01…05, WF-11, G-06), kept in `rfqs/{id}/inquiries`:
//  - `ask`          a supplier's question — from the portal or the visitors' link, maybe nameless, maybe about one material;
//  - `our_question` a clarification WE asked of one supplier on his offer («اطلب توضيحاً»): it waits on HIS answer;
//  - `note`         a clarification from us to every invitee (no question behind it).
// An answer is `{ text, all, … }`: «أجب للجميع» (every invitee and the visitors' link read it, never who asked) or
// «للسائل فقط» (the asker alone). Every write goes through the server (`rfq-server/inquiry.ts`); this file is the shape
// and the rules both the screen and the server read. Pure: no I/O.

export const INQUIRY_KINDS = ["ask", "our_question", "note"] as const
export type InquiryKind = (typeof INQUIRY_KINDS)[number]

export const ANSWER_SCOPES = ["all", "asker"] as const
export type AnswerScope = (typeof ANSWER_SCOPES)[number]

export const INQUIRY_TEXT_MAX = 1000

export interface InquiryAnswer {
  text: string
  all: boolean
  at: string
  byId: string
  byName: string
}

export interface InquiryDoc {
  id?: string
  kind?: InquiryKind | null
  /** What was asked; for a `note` the clarification itself. */
  question?: string | null
  /** The buyer's own wording of the question, published in place of the asker's (LNK-08). */
  editedQuestion?: string | null
  /** The material the question is about (the RFQ line), when it names one. */
  li?: number | null
  from?: { orgId: string | null; anon: boolean } | null
  to?: { orgId: string | null; offerId: string } | null
  answer?: InquiryAnswer | null
  /** The answer as the older readers know it. */
  reply?: string | null
  repliedAt?: string | null
  repliedByUserName?: string | null
  sentToAll?: boolean | null
  via?: "portal" | "link" | "buyer" | null
  organizationId?: string | null
  userId?: string | null
  supplierName?: string | null
  submittedByUserName?: string | null
  createdAt?: unknown
}

export const inquiryKind = (q: Pick<InquiryDoc, "kind">): InquiryKind => (q.kind === "our_question" ? "our_question" : q.kind === "note" ? "note" : "ask")

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/** When it was asked, as an ISO string — Firestore hands back either a string or a Timestamp. */
export const createdIso = (q: InquiryDoc): string => {
  const c = q.createdAt as { toDate?: () => Date } | string | null | undefined
  if (typeof c === "string") return c
  return c && typeof c.toDate === "function" ? c.toDate().toISOString() : ""
}

/** The answer that stands: the new `answer`, else an older `reply` (those were always published to everyone). */
export function answerOf(q: InquiryDoc): { text: string; all: boolean; at: string | null; byName: string | null } | null {
  const a = q.answer
  if (a && text(a.text)) return { text: text(a.text), all: a.all === true, at: a.at || null, byName: a.byName || null }
  const reply = text(q.reply)
  if (!reply) return null
  return { text: reply, all: q.sentToAll !== false && inquiryKind(q) !== "our_question", at: q.repliedAt || null, byName: q.repliedByUserName || null }
}

/** A note is its own answer; a question is answered once it has one. */
export const isAnswered = (q: InquiryDoc): boolean => inquiryKind(q) === "note" || answerOf(q) != null

/** What waits on US: a supplier's question with no answer yet. Our own questions wait on him; a note waits on nobody. */
export const needsAnswer = (q: InquiryDoc): boolean => inquiryKind(q) === "ask" && answerOf(q) == null

export const unansweredQuestions = <T extends InquiryDoc>(list: T[] | null | undefined): T[] => (list || []).filter(needsAnswer)

/** A question from the link with no verified mobile behind it — nobody to answer alone. */
export const isAnonymous = (q: InquiryDoc): boolean => inquiryKind(q) === "ask" && (q.from ? q.from.anon === true : !q.organizationId && !q.userId)

/** The words everyone reads: the buyer's edit when he made one. */
export const publicQuestion = (q: InquiryDoc): string => text(q.editedQuestion) || text(q.question)

export type AnswerRefusal = "not_a_question" | "already_answered" | "anonymous_to_all" | "text_missing"

/** QA-02: «للسائل فقط» needs an asker to answer; a nameless question can only be answered for everyone. */
export function answerRefusal(q: InquiryDoc, scope: AnswerScope, answerText: string): AnswerRefusal | null {
  if (inquiryKind(q) !== "ask") return "not_a_question"
  if (answerOf(q)) return "already_answered"
  if (!text(answerText)) return "text_missing"
  if (scope === "asker" && isAnonymous(q)) return "anonymous_to_all"
  return null
}

/** What the visitors' link and every other bidder may read of an inquiry — never who asked, never an answer given to the asker alone. */
export function publicInquiry(q: InquiryDoc): { question: string; answer: string; answeredAt: string | null; note: boolean } | null {
  const kind = inquiryKind(q)
  if (kind === "our_question") return null
  const a = answerOf(q)
  if (kind === "note") {
    const body = a?.text || text(q.question)
    return body ? { question: "", answer: body, answeredAt: a?.at || createdIso(q) || null, note: true } : null
  }
  if (!a || !a.all) return null
  const question = publicQuestion(q)
  return question ? { question, answer: a.text, answeredAt: a.at, note: false } : null
}

/** The tab's order: what waits on us first, then newest first. */
export function inquiryOrder<T extends InquiryDoc>(list: T[]): T[] {
  return list.slice().sort((a, b) => Number(needsAnswer(b)) - Number(needsAnswer(a)) || createdIso(b).localeCompare(createdIso(a)))
}

export interface InquiryCounts {
  total: number
  unanswered: number
}

export const inquiryCounts = (list: InquiryDoc[] | null | undefined): InquiryCounts => ({ total: (list || []).length, unanswered: unansweredQuestions(list).length })
