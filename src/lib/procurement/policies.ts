// Procurement policies (PRD §6.4) — `procurementSettings/{orgId}`, read once
// and resolved here. A missing document, a missing field, a string typed into
// a number box or a negative limit all fall back to the PRD's reference value:
// the rules that gate money must never evaluate against `NaN`.

import { DEFAULT_POLICIES, type ProcurementPolicies } from "./types"

type NumericPolicy = Exclude<keyof ProcurementPolicies, "sealOffersUntilDeadline">

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
]

/** Whole-number policies — a window of 2.5 days or 2.5 offers means nothing. */
const INTEGER: ReadonlySet<NumericPolicy> = new Set<NumericPolicy>(["minOffers", "rfqWindowDays", "awardCycleDays", "supplierAcceptanceDays", "splitWindowDays", "forwardWindowDays"])

function sanitise(key: NumericPolicy, raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw.replace(/,/g, "")) : Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_POLICIES[key]
  return INTEGER.has(key) ? Math.round(n) : n
}

/** The stored document, or nothing at all, turned into a complete policy set. */
export function resolvePolicies(raw: Partial<ProcurementPolicies> | null | undefined): ProcurementPolicies {
  const out: ProcurementPolicies = { ...DEFAULT_POLICIES }
  if (!raw || typeof raw !== "object") return out
  for (const key of NUMERIC) {
    if (raw[key] !== undefined && raw[key] !== null) out[key] = sanitise(key, raw[key])
  }
  if (typeof raw.sealOffersUntilDeadline === "boolean") out.sealOffersUntilDeadline = raw.sealOffersUntilDeadline
  return out
}
