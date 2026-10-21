// The supplier's quote and what blocks it (PRD OFR-01…05). `quoteBlocks` is the one list of reasons the form shows
// live; the act itself runs on the server (`/api/supplier-free/act`, `server-quote-acts.ts`), which re-reads the
// request and the quote and runs the same rules again (NFR-08) — the rules refuse a supplier who writes a field the
// buying side owns. The server writes the fields every older reader has always used (`price` as a string, `lines`,
// `deliveryBatches`, `validUntil`, `status`) beside `versions`, so the contractor's comparison, award and mobile app
// keep working without knowing this journey exists.

import { doc, setDoc, type Firestore } from "firebase/firestore"
import { newOfferNotice, newOfferNoticeId } from "@/lib/procurement/offer-announce"
import { ActRefused, callAct } from "./act-client"
import type { SupplierSide } from "./events"
import type { QuoteMode, QuoteValues } from "./quote-rules"
import type { Deal } from "./types"

export { quoteBlocks, versionOf, packLenOf, type QuoteBlock, type QuoteCheck, type QuoteMode, type QuoteValues } from "./quote-rules"

/** A refusal from the server, by its code (`deadline`, `rfq_closed`, `reply_closed`, `already_quoted`…). */
export class QuoteRefused extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "QuoteRefused"
  }
}

export interface QuoteContext {
  firestore: Firestore
  uid: string
  orgId: string
  userName: string
  companyName: string
  today: string
  /** The request document as stored (`products[]`, `deliveryLocation`, `projectId`…). */
  rfq: Record<string, unknown> & { id: string }
  deal: Deal
  /** The supplier's CR and VAT certificates travel with the quote. */
  papers: { kind: string; url: string; name?: string }[]
  fileUrl?: string | null
  side: SupplierSide
}

async function act<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  try {
    return await callAct<T>(body)
  } catch (err) {
    throw new QuoteRefused(err instanceof ActRefused ? err.code : "INTERNAL")
  }
}

/** A first quote: the server writes the document every reader of `offers` understands, plus `versions`. */
export async function submitNewQuote(ctx: QuoteContext, v: QuoteValues): Promise<string> {
  const { offerId } = await act<{ offerId: string }>({ action: "quote.new", rfqId: ctx.rfq.id, values: v, fileUrl: ctx.fileUrl || null, papers: ctx.papers })
  // The text to the contractor (and his bell, if the server's notice was lost) — the SMS route knows whether the round is sealed.
  const contractorId = (ctx.rfq.contractorId as string) || null
  if (contractorId) {
    let told = false
    try {
      const { getAuth } = await import("firebase/auth")
      const token = await getAuth().currentUser?.getIdToken()
      if (token) {
        const res = await fetch("/api/sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ kind: "new_offer", offerId }) })
        told = res.ok
      }
    } catch (err) {
      console.error("new_offer notice", err)
    }
    if (!told) {
      const notice = newOfferNotice({ supplier: ctx.companyName, rfqTitle: String(ctx.rfq.title || ""), price: null, sealed: false })
      await setDoc(doc(ctx.firestore, "users", contractorId, "notifications", newOfferNoticeId(offerId)), {
        userId: contractorId,
        organizationId: (ctx.rfq.organizationId as string) || contractorId,
        type: "new_offer",
        i18n: notice.i18n,
        title: notice.title,
        message: notice.message,
        offerId,
        rfqId: ctx.rfq.id,
        createdAt: new Date().toISOString(),
        read: false,
      }).catch((e) => console.error("offer notice fallback", e))
    }
  }
  return offerId
}

/** A new version of an open quote: an edit before the deadline, or the reply to a price cut (WF-03, WF-04). */
export async function submitNextVersion(ctx: QuoteContext, offerId: string, v: QuoteValues, mode: Exclude<QuoteMode, "new">): Promise<void> {
  await act({ action: "quote.version", offerId, mode, values: v, fileUrl: ctx.fileUrl || null })
}

/** "My price is final": the supplier keeps his price and the quote returns to awaiting decision (WF-04). */
export async function submitFinalPrice(_ctx: QuoteContext, offerId: string, note: string): Promise<void> {
  await act({ action: "quote.final", offerId, note: note.trim().slice(0, 500) })
}

/** Withdraw a quote while submissions are open (WF-03): it leaves the contractor's comparison and award. */
export async function withdrawQuote(_ctx: QuoteContext, offerId: string): Promise<void> {
  await act({ action: "quote.withdraw", offerId })
}

/** "Sample sent": the date it left, who received it, and a note (WF-05). */
export async function confirmSample(_ctx: QuoteContext, offerId: string, input: { sentAt: string; receivedBy: string; note?: string }): Promise<void> {
  await act({ action: "quote.sample", offerId, sentAt: input.sentAt, receivedBy: input.receivedBy.trim().slice(0, 120), note: (input.note || "").trim().slice(0, 500) })
}

/** "I will not quote": an invitation that names him closes as declined, leaves the list and the tasks, and the contractor is told (WF-02). */
export async function declineInvitation(ctx: Omit<QuoteContext, "fileUrl" | "papers">, note: string): Promise<void> {
  await act({ action: "quote.decline", rfqId: ctx.rfq.id, note: note.trim().slice(0, 500) })
}
