// «مورّدونا» and «دليل موردي المنصة» are ONE list with one method (SUP-01, prototype `supList`): search · specialty from
// the material tree · city · status · sort, "N of M", and 24 at a time then «عرض N أخرى». The two lists differ only in
// their status sets. Pure — the page filters what it already holds, and the directory route runs the SAME functions over
// the platform's supplier cards, so what the server returns and what the screen would have filtered agree (NFR-03).

import { matchesSearch } from "../search-text"

export const SUPPLIER_PAGE_SIZE = 24

export type SupplierListKind = "ours" | "dir"

export const OURS_STATUSES = ["all", "pref", "ver", "unver", "off"] as const
export const DIR_STATUSES = ["all", "prof", "works", "certs", "notours"] as const
export type OursStatus = (typeof OURS_STATUSES)[number]
export type DirStatus = (typeof DIR_STATUSES)[number]
export type SupplierStatus = OursStatus | DirStatus

export const SUPPLIER_SORTS = ["deals", "rate", "new", "name"] as const
export type SupplierSort = (typeof SUPPLIER_SORTS)[number]

export const STATUSES_OF: Record<SupplierListKind, readonly SupplierStatus[]> = { ours: OURS_STATUSES, dir: DIR_STATUSES }

export interface SupplierListItem {
  id: string
  name: string
  city: string | null
  /** The material tree's sub-category ids he chose plus any old category name that names no sub-category. */
  specialties: string[]
  onPlatform: boolean
  /** Ours: our manager vouched for him (or he is a legacy supplier). Directory: the platform verified him. */
  verified: boolean
  preferred: boolean
  ours: boolean
  /** Operations completed on the PLATFORM, all buyers; null = no platform profile, nothing to count. */
  deals: number | null
  onTimePercent: number | null
  /** Computed from his orders — never typed stars. */
  rating: number | null
  /** `YYYY-MM-DD` he joined. */
  since: string | null
  hasProfile: boolean
  hasWorks: boolean
  hasCerts: boolean
}

export interface SupplierFilter {
  q: string
  specialty: string
  city: string
  status: SupplierStatus
  sort: SupplierSort
}

export const EMPTY_SUPPLIER_FILTER: SupplierFilter = { q: "", specialty: "", city: "", status: "all", sort: "deals" }

/** Any narrowing applied — the sort alone does not count. */
export const supplierFilterActive = (f: SupplierFilter): boolean => Boolean(f.q.trim() || f.specialty || f.city || f.status !== "all")

export const statusOf = (kind: SupplierListKind, raw: string | null | undefined): SupplierStatus => (STATUSES_OF[kind] as readonly string[]).includes(raw || "") ? (raw as SupplierStatus) : "all"

export const sortOf = (raw: string | null | undefined): SupplierSort => ((SUPPLIER_SORTS as readonly string[]).includes(raw || "") ? (raw as SupplierSort) : "deals")

function statusOk(kind: SupplierListKind, s: SupplierListItem, status: SupplierStatus): boolean {
  if (status === "all") return true
  if (kind === "ours") {
    if (status === "pref") return s.preferred
    if (status === "ver") return s.onPlatform && s.verified
    if (status === "unver") return s.onPlatform && !s.verified
    if (status === "off") return !s.onPlatform
    return true
  }
  if (status === "prof") return s.hasProfile
  if (status === "works") return s.hasWorks
  if (status === "certs") return s.hasCerts
  if (status === "notours") return !s.ours
  return true
}

type Label = (key: string) => string
const same: Label = (k) => k

type Skip = "specialty" | "city" | null

function passes(kind: SupplierListKind, s: SupplierListItem, f: SupplierFilter, label: Label, skip: Skip = null): boolean {
  if (skip !== "specialty" && f.specialty && !s.specialties.includes(f.specialty)) return false
  if (skip !== "city" && f.city && s.city !== f.city) return false
  if (!statusOk(kind, s, f.status)) return false
  return matchesSearch(f.q, [s.name, s.city, ...s.specialties, ...s.specialties.map(label)])
}

export function filterSuppliers<T extends SupplierListItem>(items: readonly T[], f: SupplierFilter, kind: SupplierListKind, label: Label = same): T[] {
  return items.filter((s) => passes(kind, s, f, label))
}

const nameOrder = (a: SupplierListItem, b: SupplierListItem) => a.name.localeCompare(b.name, "ar")

const SORTERS: Record<SupplierSort, (a: SupplierListItem, b: SupplierListItem) => number> = {
  deals: (a, b) => (b.deals ?? -1) - (a.deals ?? -1) || nameOrder(a, b),
  rate: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.deals ?? -1) - (a.deals ?? -1) || nameOrder(a, b),
  new: (a, b) => (b.since || "").localeCompare(a.since || "") || nameOrder(a, b),
  name: nameOrder,
}

export function sortSuppliers<T extends SupplierListItem>(items: readonly T[], sort: SupplierSort): T[] {
  return [...items].sort(SORTERS[sort])
}

export interface SupplierFacets {
  /** Each option with the count it would show given every OTHER filter, so a choice that empties the list is seen before it is made. */
  specialties: Array<[string, number]>
  cities: Array<[string, number]>
}

export function supplierFacets<T extends SupplierListItem>(items: readonly T[], f: SupplierFilter, kind: SupplierListKind, label: Label = same): SupplierFacets {
  const specs = new Map<string, number>()
  const cities = new Map<string, number>()
  for (const s of items) {
    if (passes(kind, s, f, label, "specialty")) for (const k of new Set(s.specialties)) specs.set(k, (specs.get(k) || 0) + 1)
    if (s.city && passes(kind, s, f, label, "city")) cities.set(s.city, (cities.get(s.city) || 0) + 1)
  }
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar"))
  return { specialties: sorted(specs), cities: sorted(cities) }
}

export interface SupplierPage<T> {
  rows: T[]
  /** How many match the filters — the «N» of «N من M». */
  matched: number
  /** How many there are before any filter — the «M». */
  total: number
  /** What is still hidden behind «عرض N أخرى». */
  remaining: number
  /** N on the button: the next page, or what is left if less. */
  more: number
}

/** Filter, sort, and cut to the first `limit` rows (24 by default). */
export function listSuppliers<T extends SupplierListItem>(items: readonly T[], f: SupplierFilter, kind: SupplierListKind, opts: { limit?: number; label?: Label } = {}): SupplierPage<T> {
  const limit = Math.max(1, opts.limit ?? SUPPLIER_PAGE_SIZE)
  const matched = sortSuppliers(filterSuppliers(items, f, kind, opts.label), f.sort)
  const remaining = Math.max(0, matched.length - limit)
  return { rows: matched.slice(0, limit), matched: matched.length, total: items.length, remaining, more: Math.min(SUPPLIER_PAGE_SIZE, remaining) }
}

/** The platform stars as the list prints them: one decimal, a point, never a trailing zero twice. */
export const ratingText = (r: number | null): string => (r == null ? "—" : r.toFixed(1))
