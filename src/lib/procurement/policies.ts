// Procurement policies (PRD §6.4) — `procurementSettings/{orgId}`, read once
// and resolved here. A missing document, a missing field, a string typed into
// a number box or a negative limit all fall back to the PRD's reference value:
// the rules that gate money must never evaluate against `NaN`.
//
// Four operating policies of §6.4 live here rather than on `ProcurementPolicies`
// (types.ts is mirrored into the mobile app): who a supplier's delivery notice
// reaches first, whether a firm with no separate receiver lets the buyer
// receive, the buyer's self-issue limit on a direct order, and how long
// Inventory and the workshop have to answer before we proceed. They are
// optional on the stored document; `resolvePolicies` returns them with their
// reference values, so every existing reader keeps working.

import { DEFAULT_POLICIES, type ProcurementPolicies } from "./types"

/** `procurement`: the notice reaches us and we forward it to the receiver · `both`: it reaches both at once. */
export const NOTICE_ROUTINGS = ["procurement", "both"] as const
export type NoticeRouting = (typeof NOTICE_ROUTINGS)[number]

export interface OperatingPolicies {
  noticeRouting: NoticeRouting
  /** A small firm with no separate receiver: the buyer records the receipt, flagged. */
  buyerReceives: boolean
  /** A direct order up to this value (excl. VAT) the buyer issues in his own name. */
  buyerSelfIssueLimit: number
  /** Inventory's stock check and the workshop's make-or-buy answer — then we proceed. */
  replyWindowDays: number
}

export const DEFAULT_OPERATING_POLICIES: OperatingPolicies = {
  noticeRouting: "procurement",
  buyerReceives: false,
  buyerSelfIssueLimit: 2_000,
  replyWindowDays: 1,
}

export type ResolvedPolicies = ProcurementPolicies & OperatingPolicies
export const DEFAULT_RESOLVED_POLICIES: ResolvedPolicies = { ...DEFAULT_POLICIES, ...DEFAULT_OPERATING_POLICIES }

type NumericPolicy = Exclude<keyof ProcurementPolicies, "sealOffersUntilDeadline" | "sendOnApproval"> | "buyerSelfIssueLimit" | "replyWindowDays"

const NUMERIC: NumericPolicy[] = [
  "managerApprovalLimit",
  "directPurchaseCap",
  "competitionThreshold",
  "minOffers",
  "overReceiptTolerancePercent",
  "rfqWindowDays",
  "awardCycleDays",
  "supplierAcceptanceDays",
  "splitWindowDays",
  "forwardWindowDays",
  "buyerSelfIssueLimit",
  "replyWindowDays",
]

/** Whole-number policies — a window of 2.5 days or 2.5 offers means nothing. */
const INTEGER: ReadonlySet<NumericPolicy> = new Set<NumericPolicy>(["minOffers", "rfqWindowDays", "awardCycleDays", "supplierAcceptanceDays", "splitWindowDays", "forwardWindowDays", "replyWindowDays"])

function sanitise(key: NumericPolicy, raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw.replace(/,/g, "")) : Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RESOLVED_POLICIES[key]
  return INTEGER.has(key) ? Math.round(n) : n
}

/** The stored document, or nothing at all, turned into a complete policy set. */
export function resolvePolicies(raw: Partial<ResolvedPolicies> | null | undefined): ResolvedPolicies {
  const out: ResolvedPolicies = { ...DEFAULT_RESOLVED_POLICIES }
  if (!raw || typeof raw !== "object") return out
  for (const key of NUMERIC) {
    if (raw[key] !== undefined && raw[key] !== null) out[key] = sanitise(key, raw[key])
  }
  if (typeof raw.sealOffersUntilDeadline === "boolean") out.sealOffersUntilDeadline = raw.sealOffersUntilDeadline
  if (typeof raw.sendOnApproval === "boolean") out.sendOnApproval = raw.sendOnApproval
  if (typeof raw.buyerReceives === "boolean") out.buyerReceives = raw.buyerReceives
  if (raw.noticeRouting && (NOTICE_ROUTINGS as readonly string[]).includes(raw.noticeRouting)) out.noticeRouting = raw.noticeRouting
  return out
}

/** The operating four from a policy set that may have been typed as the mirrored `ProcurementPolicies`. */
export const operatingPolicies = (p: ProcurementPolicies | Partial<ResolvedPolicies> | null | undefined): OperatingPolicies => {
  const r = resolvePolicies(p as Partial<ResolvedPolicies> | null | undefined)
  return { noticeRouting: r.noticeRouting, buyerReceives: r.buyerReceives, buyerSelfIssueLimit: r.buyerSelfIssueLimit, replyWindowDays: r.replyWindowDays }
}

/** Who owns each policy — the module the chip names (prototype `ext()`). */
export type PolicyOwner = "gov" | "fin" | "inv"
export const POLICY_OWNER: Record<keyof ResolvedPolicies, PolicyOwner> = {
  sealOffersUntilDeadline: "gov",
  noticeRouting: "gov",
  forwardWindowDays: "gov",
  buyerReceives: "gov",
  directPurchaseCap: "gov",
  competitionThreshold: "gov",
  minOffers: "gov",
  managerApprovalLimit: "fin",
  buyerSelfIssueLimit: "gov",
  replyWindowDays: "gov",
  overReceiptTolerancePercent: "inv",
  rfqWindowDays: "gov",
  awardCycleDays: "gov",
  supplierAcceptanceDays: "gov",
  splitWindowDays: "gov",
  sendOnApproval: "gov",
}
