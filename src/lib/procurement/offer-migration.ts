// What moves an offer written before Procurement 2.0 onto the new shape: its price history becomes versions (an old offer
// reads as V1 and every replaced price is a version before it), and the buyer's decisions that were overloaded into its
// `status` — `مرفوض` for an exclusion, `مطلوب تخفيض` for a better-price request — go to their own places (S3 §9.2).
// Pure: the scripts read the documents, ask these functions what to write, and apply it only with `--apply`.

import { LEGACY_EXCLUDED, LEGACY_REDUCTION, UNDER_REVIEW_STATUS, bafoOf, legacyExclusionOf, type OfferBafo } from "./offer-decisions"
import { legacyVersionOf, type StoredVersion } from "./offer-versions"
import { toAmount } from "./offer-calc"

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))
const day = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : "")

/** The versions an offer without any should carry: each replaced price (oldest first), then the live one. Null when it has them. */
export function planVersions(offer: Rec): { versions: StoredVersion[]; rev: number } | null {
  if (Array.isArray(offer.versions) && offer.versions.length) return null
  const live = legacyVersionOf(offer)
  const created = day(offer.createdAt) || day(offer.updatedAt)
  const history = (Array.isArray(offer.priceHistory) ? (offer.priceHistory as Rec[]) : [])
    .map((h) => ({ at: day(h.replacedAt) || created, total: Math.round(toAmount(h.price) * 100) / 100 }))
    .filter((h) => h.total > 0)
    .sort((a, b) => a.at.localeCompare(b.at))
  const older: StoredVersion[] = history.map((h) => ({ n: 0, at: h.at, arrive: live.arrive, valid: live.valid, note: "", fileUrl: null, total: h.total }))
  const versions = [...older, { ...live, at: day(offer.updatedAt) || live.at }].map((v, i) => ({ ...v, n: i + 1 }))
  return { versions, rev: versions.length }
}

export interface DecisionMove {
  /** The decision record to create (`offerDecisions/{offerId}`), when the offer was excluded. */
  decision: { exclusion: NonNullable<ReturnType<typeof legacyExclusionOf>> } | null
  /** The fields to set on the offer. */
  offerPatch: Rec
}

/** Moves one offer's overloaded status to its own places; null when it carries nothing to move. */
export function planDecisionMove(offer: Rec): DecisionMove | null {
  const status = str(offer.status)
  if (status === LEGACY_EXCLUDED) {
    const exclusion = legacyExclusionOf(offer as never)
    if (!exclusion) return null
    return { decision: { exclusion: { ...exclusion, byName: str(offer.decidedByUserName) } }, offerPatch: { status: UNDER_REVIEW_STATUS, exclusion: null } }
  }
  if (status === LEGACY_REDUCTION) {
    const asked = bafoOf(offer as never)
    const bafo: OfferBafo = { at: asked.at || "", byId: str(offer.decidedByUserId), byName: str(offer.decidedByUserName), replyBy: asked.replyBy || "", note: asked.note, round: 1, answered: null }
    return { decision: null, offerPatch: { status: UNDER_REVIEW_STATUS, bafo } }
  }
  const reply = offer.reductionReply as Rec | undefined
  if (!offer.bafo && reply && typeof reply.kind === "string") {
    const asked = bafoOf(offer as never)
    const n = Array.isArray(offer.versions) && offer.versions.length ? offer.versions.length : 1
    const bafo: OfferBafo = {
      at: asked.at || str(reply.at),
      byId: str(offer.decidedByUserId),
      byName: str(offer.decidedByUserName),
      replyBy: asked.replyBy || "",
      note: asked.note,
      round: 1,
      answered: { at: day(reply.at), n, kind: reply.kind === "final" ? "kept" : "lowered", note: str(reply.note) || null },
    }
    return { decision: null, offerPatch: { bafo } }
  }
  return null
}
