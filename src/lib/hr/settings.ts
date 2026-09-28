// HR 1.0 — the module's settings (PRD ST-01…06, WF-26). One document per org:
// which of the six optional features are on, the company's policies, the
// establishment file and business type. A new company starts with the core;
// the business type sets the default features ONCE (ST-06); switching a
// feature off hides its tab, decisions and sections and keeps its data (ST-02).
// Pure: no I/O.

import { resolveHrPolicies, type HrPolicies } from "./statutory"

/** `hrSettings/{orgId}`. */
export const HR_SETTINGS = "hrSettings"

export const HR_FEATURES = ["hire", "perf", "train", "punch", "gov", "mudad"] as const
export type HrFeature = (typeof HR_FEATURES)[number]

export const BUSINESS_TYPES = ["contractor", "supplier", "developer"] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

/** §2 decision 11 — contractor & supplier: all but performance; developer: all but training. */
export function defaultFeatures(type: BusinessType | null): HrFeature[] {
  if (type === "developer") return HR_FEATURES.filter((f) => f !== "train")
  if (type === "contractor" || type === "supplier") return HR_FEATURES.filter((f) => f !== "perf")
  return []
}

export interface Establishment {
  name?: string | null
  cr?: string | null
  /** Ministry (MHRSD) establishment number. */
  mol?: string | null
  gosi?: string | null
  /** Unused work visas in the establishment file, entered by hand with its as-of day (ST-04). */
  visas?: number | null
  visasAsOf?: string | null
}

export interface HrSettings {
  features: HrFeature[]
  policies: HrPolicies
  businessType: BusinessType | null
  /** Set when the defaults for the business type were applied — they apply once. */
  defaultsAppliedFor: BusinessType | null
  establishment: Establishment
}

export function normalizeHrSettings(raw: Partial<HrSettings> | null | undefined): HrSettings {
  const features = Array.isArray(raw?.features) ? HR_FEATURES.filter((f) => raw!.features!.includes(f)) : []
  const type = BUSINESS_TYPES.includes(raw?.businessType as BusinessType) ? (raw!.businessType as BusinessType) : null
  const est = raw?.establishment && typeof raw.establishment === "object" ? raw.establishment : {}
  return {
    features,
    policies: resolveHrPolicies(raw?.policies),
    businessType: type,
    defaultsAppliedFor: BUSINESS_TYPES.includes(raw?.defaultsAppliedFor as BusinessType) ? (raw!.defaultsAppliedFor as BusinessType) : null,
    establishment: {
      name: est.name ?? null,
      cr: est.cr ?? null,
      mol: est.mol ?? null,
      gosi: est.gosi ?? null,
      visas: typeof est.visas === "number" && Number.isInteger(est.visas) && est.visas >= 0 ? est.visas : null,
      visasAsOf: typeof est.visasAsOf === "string" ? est.visasAsOf : null,
    },
  }
}

/** Choosing a business type sets its default features the first time only (ST-06);
 * afterwards the features are the manager's own choice. */
export function withBusinessType(s: HrSettings, type: BusinessType): HrSettings {
  if (s.defaultsAppliedFor) return { ...s, businessType: type }
  return { ...s, businessType: type, features: defaultFeatures(type), defaultsAppliedFor: type }
}

export const featureSet = (s: Pick<HrSettings, "features">) => new Set<HrFeature>(s.features)
