// The publish rules that need no server: what a row must have, the deadline, the direct award's estimate and its reason, and the
// payment-term presets. The editor shows them live; `rfq-server/publish.ts` runs them again where they cannot be skipped.
// Pure: no I/O, no Admin SDK.

import { foldSearchText } from "@/lib/search-text"
import { lastPaid, type PriceHistoryEntry } from "./prices"
import type { FrozenTerm } from "./terms-freeze"

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))

export const DIRECT_WHY_CODES = ["only", "urgent", "cont", "other"] as const
export type DirectWhyCode = (typeof DIRECT_WHY_CODES)[number]
export const DIRECT_OTHER_MIN = 4
/** What the order and the reports read as the reason (the prototype's `DIR_WHY`). */
export const DIRECT_WHY_AR: Record<Exclude<DirectWhyCode, "other">, string> = {
  only: "مورّد وحيد لهذه المادة",
  urgent: "عاجل لا يحتمل طلب عروض",
  cont: "استكمال أمر سابق بسعره",
}
export const VAT_FOR_ESTIMATE = 1.15

export interface PublishProblem {
  code: "rows_missing" | "city_missing" | "date_invalid" | "recipients_missing" | "direct_supplier_missing" | "reason_required" | "terms_invalid"
  params?: Record<string, string | number>
}

const hasMaterial = (p: Rec): boolean => {
  const m = p.material as Rec | undefined
  return Boolean((m && str(m.subId)) || str(p.category).trim())
}

/** Row by row (ED-01): a material or its category, a quantity above zero, a unit; and a city for every place. */
export function rowProblems(products: Rec[], fallbackCity: string): PublishProblem | null {
  if (!products.length) return { code: "rows_missing" }
  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    if (!hasMaterial(p) || !(Number(p.quantity) > 0) || !str(p.unitOfMeasure).trim()) return { code: "rows_missing", params: { no: i + 1 } }
    if (!str(p.deliveryCity).trim() && !fallbackCity.trim()) return { code: "city_missing", params: { no: i + 1 } }
  }
  return null
}

/** «الموعد النهائي مضى: اختر اليوم أو بعده» — the day itself is allowed (R-32). */
export const deadlineProblem = (deadline: string, today: string): PublishProblem | null => (deadline < today ? { code: "date_invalid" } : null)

export function directReasonRefusal(why: { code: DirectWhyCode; text?: string } | null | undefined, over: boolean): PublishProblem | null {
  if (!over) return null
  if (!why) return { code: "reason_required" }
  if (why.code === "other" && (why.text || "").trim().length < DIRECT_OTHER_MIN) return { code: "reason_required" }
  return null
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface DirectEstimate {
  /** Σ last price × quantity × 1.15, rounded. */
  total: number
  /** The products with no past price at all. */
  missing: number
}

/**
 * The estimate of a direct award (ED-06): for each row the last price we paid for THIS material (name and unit), else the last
 * paid for its category — never anything the buyer typed. Rows with no past price add nothing and are counted in `missing`.
 */
export function directEstimate(products: Rec[], history: PriceHistoryEntry[]): DirectEstimate {
  let net = 0
  let missing = 0
  for (const p of products) {
    const qty = Number(p.quantity) || 0
    const name = str(p.name)
    const unit = str(p.unitOfMeasure)
    let price = lastPaid(history, name, unit)?.price ?? null
    if (price == null) {
      const words = [str(p.subCategory), str(p.category)].map((w) => foldSearchText(w)).filter(Boolean)
      const same = history
        .filter((h) => foldSearchText(h.unit) === foldSearchText(unit) && words.some((w) => foldSearchText(h.name).includes(w)))
        .sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))
      price = same.length ? same[same.length - 1].price : null
    }
    if (price && price > 0) net += price * qty
    else missing++
  }
  return { total: round2(net * VAT_FOR_ESTIMATE), missing }
}

export const directWhyText = (why: { code: DirectWhyCode; text?: string }): string => (why.code === "other" ? (why.text || "").trim() : DIRECT_WHY_AR[why.code])


/** The three payment-term chips (ED-07): stored as the list the award freezes (`terms-freeze.ts`). */
export const TERM_PRESETS = {
  t30: [{ pct: 100, days: 30 }],
  tdel: [{ pct: 100, days: 0 }],
  tadv: [
    { pct: 30, days: 0 },
    { pct: 70, days: 0 },
  ],
} as const satisfies Record<string, readonly FrozenTerm[]>
export type TermPreset = keyof typeof TERM_PRESETS
export const TERM_PRESET_IDS = Object.keys(TERM_PRESETS) as TermPreset[]

/** Which chip the rows are, or null for a custom schedule. */
export function presetOfTerms(rows: Array<{ pct: string | number; days: string | number }>): TermPreset | null {
  const norm = rows.map((r) => `${Number(r.pct)}:${Number(r.days)}`).join("|")
  return TERM_PRESET_IDS.find((id) => TERM_PRESETS[id].map((r) => `${r.pct}:${r.days}`).join("|") === norm) ?? null
}
