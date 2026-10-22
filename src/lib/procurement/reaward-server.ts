// A cancelled order, and what happens to the RFQ behind it (Procurement 2.0 WF-25, R-11, G-13) — generalises the old
// "supplier declined" re-award to ANY cancelled order of an RFQ, split awards included.
//
//  · «أعد ترسيتها من عروض الطلب» (`reawardRfq`): the RFQ returns to the comparison (status `New`, closed to new quotes) WITHOUT
//    the cancelled order's offer — that supplier is left out with the reason `order_cancelled` in the buyer's decision record —
//    while the lines of every order still alive stay locked (`award-locks`). Offers that lost the reopened lines wait for a
//    decision again; the others keep the result they have. The next award is round R<n+1> and tells every bidder again.
//  · «أعِدها إلى الواردة» (`releaseOrderLines`): the order's request lines are let go (`unawardedLines`) and the Incoming
//    entity derives them back as lines to buy; the RFQ stays as the record it is.
// Both run in ONE Admin transaction and leave the request lines to be re-read by the Incoming sync afterwards.

import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { riyadhDay } from "@/lib/hr/format"
import { syncIncoming } from "./incoming-server"
import { OFFER_ORDER_DECLINED } from "./award"
import { OFFER_DECISIONS, type DecisionLogEntry, type OfferDecision } from "./offer-decisions"
import { rfqLogEntry, type RfqLogEntry } from "./rfq-detail"
import { addDays } from "./po"
import type { OnCancel } from "./po-server"
import { PURCHASE_ORDERS, type PurchaseOrder } from "./types"

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))

export interface ReawardBy {
  uid: string
  name: string
}

export type ReawardOutcome = { rfqId: string; reopened: boolean }

const linesOf = (po: Pick<PurchaseOrder, "lines">): number[] => (po.lines || []).map((l) => l.rfqProductIndex).filter((i): i is number => Number.isInteger(i) && (i as number) >= 0)

/** Who cancelled the order, from its own log — the cancel route wrote it in his name. */
export function cancelledBy(po: Pick<PurchaseOrder, "log" | "supplierDecline">): ReawardBy {
  const e = [...(po.log || [])].reverse().find((x) => x.action === "cancelled")
  return { uid: e?.byId || "system", name: e?.byName || "النظام" }
}

/**
 * The RFQ goes back to the comparison without the cancelled order's offer. Idempotent: an RFQ already reopened for this order,
 * or an order whose RFQ is gone or cancelled, changes nothing.
 */
export async function reawardRfq(db: Firestore, po: PurchaseOrder, by: ReawardBy, now: Date = new Date()): Promise<ReawardOutcome | null> {
  if (!po.rfqId || !po.offerId) return null
  const at = now.toISOString()
  const today = riyadhDay(now)
  const rfqRef = db.collection("rfqs").doc(po.rfqId)
  const poRef = db.collection(PURCHASE_ORDERS).doc(po.id)
  const reopened = await db.runTransaction(async (tx) => {
    const rSnap = await tx.get(rfqRef)
    if (!rSnap.exists) return null
    const rfq = rSnap.data() as Rec
    if (str(rfq.status) === "Cancelled" || str(rfq.organizationId || rfq.contractorId) !== po.organizationId) return null
    const offers = (await tx.get(db.collection("offers").where("rfqId", "==", po.rfqId))).docs.map((d) => ({ id: d.id, data: (d.data() || {}) as Rec }))
    const dSnap = await tx.get(db.collection(OFFER_DECISIONS).doc(po.offerId as string))
    const mine = offers.find((o) => o.id === po.offerId)
    const reopenedLines = new Set(linesOf(po))
    const prices = (o: Rec): boolean => o.lump != null || (Array.isArray(o.lines) && (o.lines as Rec[]).some((l) => reopenedLines.has(Number(l.rfqProductIndex)))) || !Array.isArray(o.lines) || !(o.lines as Rec[]).length

    const existing = dSnap.exists ? (dSnap.data() as Partial<OfferDecision>) : null
    const entry: DecisionLogEntry = { at, byId: by.uid, byName: by.name, kind: "exclude", meta: { code: "order_cancelled", po: po.docNumber } }
    const decision: OfferDecision = {
      offerId: po.offerId as string,
      rfqId: po.rfqId as string,
      organizationId: po.organizationId,
      shortlist: existing?.shortlist ?? null,
      exclusion: { at, byId: by.uid, byName: by.name, code: "order_cancelled", text: po.cancelledReason || null },
      log: [...(Array.isArray(existing?.log) ? (existing?.log as DecisionLogEntry[]) : []), entry].slice(-100),
      updatedAt: at,
    }
    tx.set(db.collection(OFFER_DECISIONS).doc(po.offerId as string), decision as unknown as Rec)

    if (mine) {
      tx.update(db.collection("offers").doc(mine.id), {
        awaitingOrderApproval: false,
        outcome: null,
        ...(po.supplierDecline ? { status: OFFER_ORDER_DECLINED, declinedOrder: { poId: po.id, poNumber: po.docNumber, at: po.supplierDecline.at, reason: po.supplierDecline.reason } } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    // Only the bidders who competed for the reopened lines wait for a decision again.
    for (const o of offers) {
      if (o.id === po.offerId) continue
      const out = o.data.outcome as { k?: string } | null | undefined
      if (out?.k === "lost" && prices(o.data)) tx.update(db.collection("offers").doc(o.id), { outcome: null, updatedAt: FieldValue.serverTimestamp() })
    }

    const log: RfqLogEntry[] = Array.isArray(rfq.log) ? (rfq.log as RfqLogEntry[]) : []
    const stillOpen = str(rfq.deadline).slice(0, 10) >= today
    tx.update(rfqRef, {
      status: "New",
      awardReopened: { poId: po.id, poNumber: po.docNumber, at, byId: by.uid, byName: by.name, round: Number(rfq.awardRound) || 1 },
      // The round stays closed to new quotes: a re-award chooses among the offers already in, nothing new.
      ...(stillOpen ? { deadline: addDays(today, -1), closedEarly: rfq.closedEarly ?? { at, byId: by.uid, byName: by.name, reason: "award", originalDeadline: str(rfq.deadline).slice(0, 10) || null } } : {}),
      log: [...log, rfqLogEntry(by, "award_reopened", at, { params: { number: po.docNumber, supplier: po.supplierName } })],
      updatedAt: FieldValue.serverTimestamp(),
    })
    tx.update(poRef, { cancelChoice: { ...((po as unknown as Rec).cancelChoice as Rec), resolved: true, resolvedAt: at }, updatedAt: FieldValue.serverTimestamp() })
    return { rfqId: po.rfqId as string, reopened: true }
  })
  if (reopened) await refreshIncoming(db, po.organizationId, by, now)
  return reopened
}

/** «أعِدها إلى الواردة»: the cancelled order's lines are let go by its RFQ and become lines to buy again. */
export async function releaseOrderLines(db: Firestore, po: PurchaseOrder, by: ReawardBy, now: Date = new Date()): Promise<ReawardOutcome | null> {
  if (!po.rfqId) return null
  const at = now.toISOString()
  const rfqRef = db.collection("rfqs").doc(po.rfqId)
  const poRef = db.collection(PURCHASE_ORDERS).doc(po.id)
  const out = await db.runTransaction(async (tx) => {
    const rSnap = await tx.get(rfqRef)
    if (!rSnap.exists) return null
    const rfq = rSnap.data() as Rec
    const prev = Array.isArray(rfq.unawardedLines) ? (rfq.unawardedLines as number[]) : []
    tx.update(rfqRef, { unawardedLines: [...new Set([...prev, ...linesOf(po)])].sort((a, b) => a - b), updatedAt: FieldValue.serverTimestamp() })
    tx.update(poRef, { cancelChoice: { ...((po as unknown as Rec).cancelChoice as Rec), resolved: true, resolvedAt: at }, updatedAt: FieldValue.serverTimestamp() })
    return { rfqId: po.rfqId as string, reopened: false }
  })
  if (out) await refreshIncoming(db, po.organizationId, by, now)
  return out
}

async function refreshIncoming(db: Firestore, orgId: string, by: ReawardBy, now: Date): Promise<void> {
  try {
    await syncIncoming(db, orgId, { now, by })
  } catch (err) {
    console.warn("incoming not refreshed after the cancel:", (err as { code?: string })?.code || err)
  }
}

/** The cancel route's hook: acts on the choice the buyer made (`po-server.cancelOrder`). `none` needs nothing: the route refused it where a request points at the order. */
export const onCancelChoiceImpl: OnCancel = async (db, po, choice) => {
  const by = cancelledBy(po)
  if (choice.then === "reaward") await reawardRfq(db, po, by)
  else if (choice.then === "back") await releaseOrderLines(db, po, by)
}
