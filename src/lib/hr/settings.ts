// HR 1.0 — the module's settings (PRD ST-01…06, WF-26). One document per org:
// which of the six optional features are on, the company's policies, the
// establishment file and business type. A new company starts with the core;
// the business type sets the default features ONCE (ST-06); switching a
// feature off hides its tab, decisions and sections and keeps its data (ST-02).
// Every policy change is logged — who, when, from what to what (ST-01). The
// establishment's Saudization band is entered by hand from Qiwa; the Saudi
// ratio and the safety margin are computed from the record (ST-04).
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

/** ST-06 — do the features differ from the business type's defaults (the reset is offered)? */
export function differsFromDefaults(s: Pick<HrSettings, "features" | "businessType">): boolean {
  if (!s.businessType) return false
  const d = new Set(defaultFeatures(s.businessType))
  return s.features.length !== d.size || s.features.some((f) => !d.has(f))
}

/** ST-06 — the per-company word for workplaces, as `Portal.HR.tab.<key>`: contractor «المواقع» · supplier
 * «الفروع والمستودعات» · developer «الإدارات والمشاريع» · not chosen «أماكن العمل». The Sites tab and the Sites
 * page read the same key. */
export function sitesLabelKey(type: BusinessType | null): "sites" | "sites_contractor" | "sites_supplier" | "sites_developer" {
  return type ? `sites_${type}` : "sites"
}

/** The growth tab's label by which of its features is on (`Portal.HR.tab.<key>`). */
export function perfLabelKey(features: ReadonlySet<HrFeature>): "perf" | "perf_only" | "train_only" {
  if (features.has("perf") && !features.has("train")) return "perf_only"
  if (features.has("train") && !features.has("perf")) return "train_only"
  return "perf"
}

/** Saudization bands as Qiwa names them (ST-04) — entered by hand; we do not connect to Qiwa. */
export const NITAQAT_BANDS = ["platinum", "high_green", "mid_green", "low_green", "yellow", "red"] as const
export type NitaqatBand = (typeof NITAQAT_BANDS)[number]
export const isGreenBand = (b: NitaqatBand | null | undefined) => b === "platinum" || b === "high_green" || b === "mid_green" || b === "low_green"

export interface Establishment {
  name?: string | null
  /** The English name (letters, the Mudad file). */
  nameEn?: string | null
  cr?: string | null
  /** Ministry (MHRSD) establishment number. */
  mol?: string | null
  gosi?: string | null
  /** The Mudad (wage protection) establishment number — printed in the wage file. */
  mudad?: string | null
  /** Unused work visas in the establishment file, entered by hand with its as-of day (ST-04). */
  visas?: number | null
  visasAsOf?: string | null
  /** The Saudization band from Qiwa, its as-of day, and the green band's threshold (%) for the activity. */
  band?: NitaqatBand | null
  bandAsOf?: string | null
  minPct?: number | null
  /** Of those, the visas manpower plans reserved (WF-12) — not offered again; an arrival takes one back. */
  visasReserved?: number | null
}

/** One logged change (ST-01: "a policy is editable and logged"). No money is ever a policy. */
export interface SettingsLogEntry {
  at: string
  by: string
  byName?: string | null
  field: string
  from: string | number | boolean | null
  to: string | number | boolean | null
}

/** The log keeps the latest changes on the document itself. */
export const SETTINGS_LOG_MAX = 200

export interface HrSettings {
  features: HrFeature[]
  policies: HrPolicies
  businessType: BusinessType | null
  /** Set when the defaults for the business type were applied — they apply once. */
  defaultsAppliedFor: BusinessType | null
  establishment: Establishment
  /** Appended by every save, newest last — never typed (always present once normalised). */
  log?: SettingsLogEntry[]
  /** GV-03 — the platforms the company follows (feature `gov`): absent = the default (all but HRDF). */
  platforms?: Partial<Record<(typeof HR_PLATFORMS)[number], boolean>>
}

/** The government platforms the `gov` feature follows (GV-03; their tasks in `platforms.ts`). */
export const HR_PLATFORMS = ["qiwa", "mudad", "gosi", "muqeem", "chi", "traffic", "hrdf"] as const

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

export function normalizeHrSettings(raw: Partial<HrSettings> | null | undefined): HrSettings {
  const features = Array.isArray(raw?.features) ? HR_FEATURES.filter((f) => raw!.features!.includes(f)) : []
  const type = BUSINESS_TYPES.includes(raw?.businessType as BusinessType) ? (raw!.businessType as BusinessType) : null
  const est: Establishment = raw?.establishment && typeof raw.establishment === "object" ? raw.establishment : {}
  const log = Array.isArray(raw?.log) ? raw!.log!.filter((x) => x && typeof x.field === "string" && typeof x.at === "string").slice(-SETTINGS_LOG_MAX) : []
  return {
    features,
    policies: resolveHrPolicies(raw?.policies),
    businessType: type,
    defaultsAppliedFor: BUSINESS_TYPES.includes(raw?.defaultsAppliedFor as BusinessType) ? (raw!.defaultsAppliedFor as BusinessType) : null,
    establishment: {
      name: est.name ?? null,
      nameEn: str(est.nameEn),
      cr: est.cr ?? null,
      mol: est.mol ?? null,
      gosi: est.gosi ?? null,
      mudad: str(est.mudad),
      visas: typeof est.visas === "number" && Number.isInteger(est.visas) && est.visas >= 0 ? est.visas : null,
      visasAsOf: typeof est.visasAsOf === "string" ? est.visasAsOf : null,
      band: NITAQAT_BANDS.includes(est.band as NitaqatBand) ? (est.band as NitaqatBand) : null,
      bandAsOf: day(est.bandAsOf),
      minPct: typeof est.minPct === "number" && Number.isFinite(est.minPct) && est.minPct >= 0 && est.minPct <= 100 ? est.minPct : null,
      visasReserved: typeof est.visasReserved === "number" && Number.isInteger(est.visasReserved) && est.visasReserved > 0 ? est.visasReserved : null,
    },
    log,
    platforms: Object.fromEntries(HR_PLATFORMS.filter((k) => typeof raw?.platforms?.[k] === "boolean").map((k) => [k, raw!.platforms![k] as boolean])),
  }
}

/** Choosing a business type sets its default features the first time only (ST-06);
 * afterwards the features are the manager's own choice. */
export function withBusinessType(s: HrSettings, type: BusinessType): HrSettings {
  if (s.defaultsAppliedFor) return { ...s, businessType: type }
  return { ...s, businessType: type, features: defaultFeatures(type), defaultsAppliedFor: type }
}

/** «أعد إلى الافتراضي» — the business type's default features again. */
export const withDefaultFeatures = (s: HrSettings): HrSettings => (s.businessType ? { ...s, features: defaultFeatures(s.businessType) } : s)

export const featureSet = (s: Pick<HrSettings, "features">) => new Set<HrFeature>(s.features)

type Scalar = string | number | boolean | null

/** ST-01 — what a save changes, field by field (`policies.payDay`, `features.gov`, `establishment.band`…). */
export function settingsChanges(before: HrSettings, after: HrSettings): Array<{ field: string; from: Scalar; to: Scalar }> {
  const out: Array<{ field: string; from: Scalar; to: Scalar }> = []
  const cmp = (field: string, a: unknown, b: unknown) => {
    const x = (a ?? null) as Scalar
    const y = (b ?? null) as Scalar
    if (x !== y) out.push({ field, from: x, to: y })
  }
  cmp("businessType", before.businessType, after.businessType)
  for (const f of HR_FEATURES) cmp(`features.${f}`, before.features.includes(f), after.features.includes(f))
  for (const k of Object.keys(after.policies) as Array<keyof HrPolicies>) cmp(`policies.${k}`, before.policies[k], after.policies[k])
  for (const k of HR_PLATFORMS) if (before.platforms?.[k] !== after.platforms?.[k]) cmp(`platforms.${k}`, before.platforms?.[k] ?? null, after.platforms?.[k] ?? null)
  for (const k of ["name", "nameEn", "cr", "mol", "gosi", "mudad", "visas", "visasAsOf", "band", "bandAsOf", "minPct"] as const) cmp(`establishment.${k}`, before.establishment[k], after.establishment[k])
  return out
}

/** Appends a save's changes to the log, keeping the latest `SETTINGS_LOG_MAX`. */
export function appendSettingsLog(before: HrSettings, after: HrSettings, who: { uid: string; name?: string | null }, at: string): SettingsLogEntry[] {
  const entries = settingsChanges(before, after).map((c) => ({ ...c, at, by: who.uid, byName: who.name ?? null }))
  return [...(before.log ?? []), ...entries].slice(-SETTINGS_LOG_MAX)
}

/** ST-04 — the establishment's Saudization from the record: Saudis of the people on it, the green threshold,
 * and the safety margin (Saudis short of the band, or how many it could lose and stay green). */
export function nitaqatOf(employees: ReadonlyArray<{ nationality: string; status?: string | null }>, est: Pick<Establishment, "minPct">) {
  const live = employees.filter((e) => e.status !== "left" && e.status !== "expected")
  const total = live.length
  const saudis = live.filter((e) => e.nationality === "sa").length
  const pct = total ? Math.round((saudis / total) * 100) : 0
  const min = est.minPct ?? null
  if (min == null || !total) return { total, saudis, pct, min, short: null, spare: null }
  const need = (total * min) / 100
  const short = Math.max(0, Math.ceil(need) - saudis)
  return { total, saudis, pct, min, short, spare: short ? 0 : Math.max(0, Math.floor(saudis - need)) }
}
