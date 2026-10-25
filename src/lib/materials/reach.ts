// Who an RFQ reaches (PUR-03/04). One RFQ carries every category it was written with:
// it reaches every supplier who supplies ANY of its sub-categories, matched by id
// (`subCategoryIds` on the RFQ ∩ `specialtyIds` on the supplier). An RFQ written before
// the tree keeps its one category name and still meets the suppliers who chose that
// name (`specializations`). There is no table between the two lists: a supplier is
// asked once to choose his specialties from the tree, and until he does, only private
// RFQs and guest links reach him. Pure.

import type { MaterialPick } from "./types"

type Rec = Record<string, unknown>
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [])
const str = (v: unknown) => (typeof v === "string" ? v : "")

/** A supplier's field: his tree sub-categories, his older category names, and his cities. */
export interface SupplierField {
  subIds: string[]
  specs: string[]
  cities: string[]
}

/** The sub-categories an RFQ was written with (none for one written before the tree). */
export const rfqSubIds = (rfq: Rec): string[] => list(rfq.subCategoryIds)

/** The supplier's tree specialties — a secondary company's own list over its owner's. */
export function supplierSubIds(profile: Rec | null | undefined, org?: Rec | null): string[] {
  const own = list(org?.specialtyIds)
  return own.length ? own : list(profile?.specialtyIds)
}

/** Has he chosen from the tree yet? Until he has, the platform asks him to (PUR-04). */
export const choseFromTree = (profile: Rec | null | undefined, org?: Rec | null): boolean => supplierSubIds(profile, org).length > 0

/** Does his field cover what the RFQ asks for? */
export function fieldCovers(field: Pick<SupplierField, "subIds" | "specs">, rfq: Rec): boolean {
  const subs = rfqSubIds(rfq)
  if (subs.length) return subs.some((s) => field.subIds.includes(s))
  return field.specs.includes(str(rfq.category))
}

// ---------------------------------------------------------------------------
// The delivery city (ED-21, PRD ED-06: «عام — كل المختصين في الفئة والمدينة»)
// ---------------------------------------------------------------------------
// ONE rule for the editor's reach count, the publish server's re-check (and the reminders that read what it
// stored), and the supplier's «open requests in my field» lists. It never shrinks reach on missing data: an RFQ
// that names no city is nationwide, and a supplier who gave no city at all is still reached.

const cityKey = (c: string) => c.trim().replace(/\s+/g, " ").replace(/[أإآ]/g, "ا").replace(/ة$/g, "ه").toLowerCase()

/** The cities a supplier covers: his coverage list (a secondary company's own over its owner's), else his own city. */
export function supplierCities(profile: Rec | null | undefined, org?: Rec | null): string[] {
  const coverage = list(org?.coverageCities).length ? list(org?.coverageCities) : list(profile?.coverageCities)
  if (coverage.length) return coverage
  const own = str(org?.city) || str(profile?.city)
  return own ? [own] : []
}

/** Every city an RFQ delivers to (several places → several cities), else its one city; none = nationwide. */
export function rfqCities(rfq: Rec): string[] {
  const many = list(rfq.cities)
  if (many.length) return many
  const one = str(rfq.city)
  return one ? [one] : []
}

/** Does a delivery in `rfqCityList` reach a supplier covering `cities`? Yes when either side names no city. */
export function cityCovers(cities: readonly string[], rfqCityList: readonly string[]): boolean {
  if (!rfqCityList.length || !cities.length) return true
  const mine = new Set(cities.map(cityKey))
  return rfqCityList.some((c) => mine.has(cityKey(c)))
}

/** The one public-reach rule: his field covers the RFQ AND he serves one of its delivery cities (ED-21). */
export function publicFieldReaches(field: SupplierField, rfq: Rec): boolean {
  return fieldCovers(field, rfq) && cityCovers(field.cities, rfqCities(rfq))
}

/** The fields an RFQ stores about its materials: the tree ids it reaches by, and words for older readers. */
export function rfqMaterialFields(lines: Array<{ material?: MaterialPick | null; category?: string | null; subCategory?: string | null }>): {
  subCategoryIds: string[]
  categoryIds: string[]
  categories: string[]
  /** The categories in both languages, for readers in English. */
  categoryLabels: Array<{ ar: string; en: string }>
  category: string
  subCategory: string
} {
  const subIds = new Set<string>()
  const rootIds = new Set<string>()
  const roots: string[] = []
  const labels: Array<{ ar: string; en: string }> = []
  const subs: string[] = []
  for (const l of lines) {
    const m = l.material
    if (m) {
      subIds.add(m.subId)
      rootIds.add(m.rootId)
      const root = m.path[0]?.ar || ""
      const sub = (m.path[1] || m.path[0])?.ar || ""
      if (root && !roots.includes(root)) roots.push(root)
      if (sub && !subs.includes(sub)) subs.push(sub)
    } else {
      const root = str(l.category)
      if (root && !roots.includes(root)) {
        roots.push(root)
        labels.push({ ar: root, en: root })
      }
      const sub = str(l.subCategory)
      if (sub && !subs.includes(sub)) subs.push(sub)
    }
  }
  return {
    subCategoryIds: [...subIds],
    categoryIds: [...rootIds],
    categories: roots,
    categoryLabels: labels,
    category: roots[0] || "",
    subCategory: subs.length === 1 ? subs[0] : subs.length ? "متعدد" : "",
  }
}

/** Firestore takes 30 values in `array-contains-any`/`in`: a long list is read in slices. */
export function slices<T>(items: T[], size = 30): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Every category an RFQ names: the list one written on the tree carries, else its one category. */
export function rfqCategoryNames(rfq: Rec): string[] {
  const many = list(rfq.categories)
  if (many.length) return many
  const one = str(rfq.category)
  return one ? [one] : []
}

/** A category's name in the reader's language — from the RFQ's own labels when it has them. */
export function categoryText(rfq: Rec, name: string, locale: string, fallback: (name: string, locale: string) => string): string {
  const labels = Array.isArray(rfq.categoryLabels) ? (rfq.categoryLabels as Array<{ ar?: string; en?: string }>) : []
  const hit = labels.find((l) => l.ar === name)
  if (hit) return locale === "ar" ? hit.ar || name : hit.en || hit.ar || name
  return fallback(name, locale)
}
