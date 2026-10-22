// What the PLATFORM knows about a supplier, across every buyer (SUP-02): «أتمّ N عملية على المنصة», his on-time share and a
// rating computed from his orders — never stars someone typed. Pure: the server job feeds it each supplier's orders and
// receipts; the screens only read the result from `supplierStats/{orgId}` (written by the Admin SDK, served by
// `GET /api/procurement/suppliers`).
//
// A supplier with too little behind him gets NO rating and NO on-time share rather than a flattering default: a record
// is a record of orders (the same rule `supplierScore` follows for our own file of him).

import { poStatus, supplierScore } from "./po"
import type { PurchaseOrder, ReceiptFact } from "./types"
import type { SupplierListItem } from "./supplier-list"

/** The collection and the document that says when the numbers were last rebuilt. */
export const SUPPLIER_STATS = "supplierStats"
export const SUPPLIER_STATS_META = "_meta"
/** The numbers are rebuilt at most once a day. */
export const SUPPLIER_STATS_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Fewer judged orders than this and a rating would be an opinion about one delivery. */
export const RATING_MIN_ORDERS = 3
/** On time weighs more than quality of what arrived; both come from the orders themselves. */
const ON_TIME_WEIGHT = 0.6

export interface PlatformStats {
  /** Orders he accepted and that ended with goods received (or were closed). */
  completedOps: number
  /** Orders he accepted — the ones that can be judged. */
  judgedOrders: number
  onTimePercent: number | null
  rejectPercent: number | null
  /** 1–5 with one decimal, from on-time and what was accepted at the gate; null below `RATING_MIN_ORDERS`. */
  rating: number | null
}

export const NO_STATS: PlatformStats = { completedOps: 0, judgedOrders: 0, onTimePercent: null, rejectPercent: null, rating: null }

/** «محسوب من أوامره»: 60 % on-time, 40 % accepted at the gate, mapped onto 1–5. */
export function computedRating(score: { orders: number; onTimePercent: number | null; rejectPercent: number | null }): number | null {
  if (score.orders < RATING_MIN_ORDERS || score.onTimePercent == null) return null
  const accepted = 100 - Math.min(100, Math.max(0, score.rejectPercent ?? 0))
  const composite = ON_TIME_WEIGHT * score.onTimePercent + (1 - ON_TIME_WEIGHT) * accepted
  return Math.round((1 + (4 * composite) / 100) * 10) / 10
}

const completed = (po: PurchaseOrder): boolean => {
  if (!po.supplierAcceptedAt || po.status === "cancelled") return false
  const st = poStatus(po)
  return st === "received" || st === "closed"
}

/** One supplier's platform numbers over ALL his orders and their receipts. */
export function platformStats(orders: readonly PurchaseOrder[], receipts: readonly ReceiptFact[], now: Date): PlatformStats {
  if (!orders.length) return NO_STATS
  const score = supplierScore([...orders], [...receipts], now)
  return {
    completedOps: orders.filter(completed).length,
    judgedOrders: score.orders,
    onTimePercent: score.onTimePercent,
    rejectPercent: score.rejectPercent,
    rating: computedRating(score),
  }
}

/** A supplier card as `supplierStats/{orgId}` keeps it: public facts only — no phone, no e-mail, no tax number. */
export interface SupplierCard extends PlatformStats {
  orgId: string
  name: string
  city: string | null
  coverageCities: string[]
  /** Tree sub-category ids and old category names, as the lists filter by. */
  specialties: string[]
  /** `YYYY-MM-DD`. */
  since: string | null
  /** The platform verified him (admin). Only these are in the directory. */
  verified: boolean
  hasProfile: boolean
  hasWorks: boolean
  hasCerts: boolean
  /** What contractors typed about him, kept beside the computed rating as a secondary line. */
  reviewAvg: number | null
  reviewCount: number
  updatedAt: string
}

/** A card as a list row. `ours` and `preferred` are the viewer's own and are laid on by the caller. */
export const cardToItem = (c: SupplierCard, mine: { ours: boolean; preferred?: boolean } = { ours: false }): SupplierListItem => ({
  id: c.orgId,
  name: c.name,
  city: c.city,
  specialties: c.specialties,
  onPlatform: true,
  verified: c.verified,
  preferred: Boolean(mine.preferred),
  ours: mine.ours,
  deals: c.completedOps,
  onTimePercent: c.onTimePercent,
  rating: c.rating,
  since: c.since,
  hasProfile: c.hasProfile,
  hasWorks: c.hasWorks,
  hasCerts: c.hasCerts,
})

/** The fields of a supplier's own account the card reads. */
export interface SupplierAccountFacts {
  orgId: string
  name: string
  city: string | null
  coverageCities: string[]
  specialties: string[]
  since: string | null
  verified: boolean
  bio: string | null
  worksCount: number
  certificatesCount: number
  hasProfileFile: boolean
}

export function buildCard(account: SupplierAccountFacts, stats: PlatformStats, reviews: { avg: number | null; count: number }, now: Date): SupplierCard {
  return {
    orgId: account.orgId,
    name: account.name,
    city: account.city,
    coverageCities: account.coverageCities,
    specialties: account.specialties,
    since: account.since,
    verified: account.verified,
    hasProfile: account.hasProfileFile || Boolean(account.bio),
    hasWorks: account.worksCount > 0,
    hasCerts: account.certificatesCount > 0,
    completedOps: stats.completedOps,
    judgedOrders: stats.judgedOrders,
    onTimePercent: stats.onTimePercent,
    rejectPercent: stats.rejectPercent,
    rating: stats.rating,
    reviewAvg: reviews.avg,
    reviewCount: reviews.count,
    updatedAt: now.toISOString(),
  }
}

export const statsAreFresh = (updatedAt: string | null | undefined, now: Date): boolean => {
  const t = updatedAt ? Date.parse(updatedAt) : NaN
  return Number.isFinite(t) && now.getTime() - t < SUPPLIER_STATS_MAX_AGE_MS
}
