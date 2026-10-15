// «لكل عرض نتيجة» (Supplier 1.0 OFR-07, G-06): every quote ends with a result, and its supplier is told. This file
// builds the `rfq_outcome` notice for the two results the contractor's own acts produce:
// - awarded to another (at the award, with the buyer's reason when he gave one: price · delivery time · specifications);
// - closed with no award (when the RFQ is cancelled, with the cancellation's reason).
// "Won" travels WITH the order (`po_sent`, when the approved order reaches him) — an award is never announced to the
// winner before its order is approved (the free journey hides it until then too), so it is not sent here.
//
// The contractor is named first and the request's number reaches the supplier as a word and a number («2026/031»,
// never the RFQ- code). A guest has no account to tell: his offer page shows the result.

import type { Firestore } from "firebase/firestore"
import type { Translator } from "../mfg-events"
import { isWithdrawnOffer, OFFER_REJECTED } from "./award"
import { bareDocNumber, emitProcEvent, type ProcEvent } from "./events"

export type RfqOutcomeResult = "lost" | "noaward"
/** The award's loss reasons and the cancellation's codes, as the supplier reads them. */
export const RFQ_OUTCOME_WHY = ["price", "time", "spec", "need", "reissue"] as const
export type RfqOutcomeWhy = (typeof RFQ_OUTCOME_WHY)[number]

export interface OutcomeOffer {
  id: string
  status?: string | null
  supplierId?: string | null
  organizationId?: string | null
  supplierOrgId?: string | null
  isGuestOffer?: boolean | null
  withdrawnAt?: unknown
}

export interface RfqOutcomeInput {
  /** The buying organisation. */
  organizationId: string
  rfqId: string
  rfqNumber?: string | null
  rfqTitle?: string | null
  /** The contractor's company name, as the supplier knows it. */
  contractor: string
  result: RfqOutcomeResult
  why?: string | null
  copy?: Translator | null
}

const isWhy = (v: unknown): v is RfqOutcomeWhy => typeof v === "string" && (RFQ_OUTCOME_WHY as readonly string[]).includes(v)

/** The supplier's user and his company (whose owner's uid IS the org id); null for a guest. */
export function outcomeRecipient(offer: OutcomeOffer): { userId: string; orgId: string } | null {
  if (offer.isGuestOffer || !offer.supplierId || offer.supplierId === "guest" || offer.supplierId === "mdmak-system") return null
  const orgId = offer.supplierOrgId || offer.organizationId || offer.supplierId
  return { userId: offer.supplierId, orgId: orgId && orgId !== "guest" ? orgId : offer.supplierId }
}

/** A quote that can still be told a result: not withdrawn by its supplier, not already excluded with its reason. */
export const awaitsOutcome = (offer: OutcomeOffer): boolean => offer.status !== OFFER_REJECTED && !isWithdrawnOffer(offer)

/** The notice to one supplier, or null when there is nobody to tell. */
export function rfqOutcomeEvent(offer: OutcomeOffer, input: RfqOutcomeInput): ProcEvent | null {
  const to = outcomeRecipient(offer)
  if (!to) return null
  const rfq = input.rfqNumber ? bareDocNumber(input.rfqNumber) : (input.rfqTitle || "").trim()
  return {
    kind: "rfq_outcome",
    organizationId: input.organizationId,
    to: [{ users: [...new Set([to.userId, to.orgId])] }],
    supplier: { userId: to.userId, orgId: to.orgId },
    params: {
      contractor: input.contractor,
      rfq,
      result: `@pn_rfq_outcome_${input.result}`,
      reason: isWhy(input.why) ? `@pn_rfq_outcome_why_${input.why}` : "",
    },
    rfqId: input.rfqId,
    offerId: offer.id,
    // His quotes, where the result shows — the contractor's request is not his to open.
    link: "/supplier/offers",
    copy: input.copy ?? null,
  }
}

/** Best-effort, after the act's own write: a notice that fails never undoes the award or the cancellation. */
export async function emitRfqOutcomes(firestore: Firestore, actor: { uid: string; name: string }, offers: OutcomeOffer[], input: RfqOutcomeInput): Promise<number> {
  const events = offers.map((o) => rfqOutcomeEvent(o, input)).filter((e): e is ProcEvent => e != null)
  const told = await Promise.all(events.map((e) => emitProcEvent(firestore, actor, e)))
  return told.reduce((s, n) => s + n, 0)
}
