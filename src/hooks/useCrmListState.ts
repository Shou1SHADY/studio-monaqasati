"use client"

import { useCallback, useMemo, useState } from "react"

/** A multi-select filter dimension: one key, many selectable values. */
export interface FacetDef<T> {
  key: string
  label: string
  options: Array<{ value: string; label: string }>
  /** Which value(s) of the record this facet matches on. */
  valueOf: (row: T) => string | string[] | null | undefined
}

/** A named subset of the whole list, rendered as the segmented control. */
export interface SegmentDef<T> {
  key: string
  label: string
  predicate: (row: T) => boolean
}

/** A one-click preset: a segment, a set of facet values, a sort and a grouping. */
export interface SavedViewDef {
  key: string
  label: string
  segment: string
  facets?: Record<string, string[]>
  sort?: { key: string; direction: 1 | -1 }
  group?: string
}

export interface GroupDef<T> {
  key: string
  label: string
  keyOf: (row: T) => string
}

export interface SortDef<T> {
  key: string
  /** Comparable primitive. Strings compare with the locale collator. */
  valueOf: (row: T) => string | number
}

export interface CrmListConfig<T> {
  segments: Array<SegmentDef<T>>
  facets: Array<FacetDef<T>>
  savedViews: SavedViewDef[]
  groups?: Array<GroupDef<T>>
  sorts?: Array<SortDef<T>>
  /** Free-text haystack for the search box. */
  searchText: (row: T) => string
  /** True when the row belongs to the signed-in member — powers "mine only". */
  isMine?: (row: T) => boolean
  defaultSegment?: string
  defaultSort?: { key: string; direction: 1 | -1 }
  defaultGroup?: string
  pageSize?: number
}

const DEFAULT_PAGE = 15

/**
 * The state behind every CRM list: segments, saved views, faceted filters,
 * grouping, sorting, density, "mine only" and progressive disclosure.
 *
 * It exists as one hook because three pages were each about to grow their own
 * slightly different version of the same nine pieces of state, and because
 * "why does the leads list filter differently from the pipeline" is a bug
 * report nobody should have to file.
 *
 * Everything is client-side and derived in one pass — these lists are an
 * organization's own pipeline, not an unbounded dataset, and the Firestore
 * listeners already hold the rows in memory.
 */
export function useCrmListState<T>(rows: T[], config: CrmListConfig<T>, locale: string) {
  const pageSize = config.pageSize ?? DEFAULT_PAGE

  const [segment, setSegment] = useState(config.defaultSegment ?? config.segments[0]?.key ?? "all")
  const [search, setSearch] = useState("")
  const [facets, setFacets] = useState<Record<string, string[]>>({})
  const [group, setGroup] = useState(config.defaultGroup ?? "")
  const [sort, setSort] = useState<{ key: string; direction: 1 | -1 }>(
    config.defaultSort ?? { key: "", direction: 1 }
  )
  const [mineOnly, setMineOnly] = useState(false)
  const [dense, setDense] = useState(false)
  const [limit, setLimit] = useState(pageSize)
  const [activeView, setActiveView] = useState<string>("")

  const toggleFacet = useCallback((key: string, value: string) => {
    setFacets((prev) => {
      const current = prev[key] ?? []
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
      const updated = { ...prev }
      if (next.length === 0) delete updated[key]
      else updated[key] = next
      return updated
    })
    // Any hand-edit means this is no longer the saved view it started from.
    setActiveView("")
    setLimit(pageSize)
  }, [pageSize])

  const clearFacet = useCallback((key: string) => {
    setFacets((prev) => {
      const updated = { ...prev }
      delete updated[key]
      return updated
    })
    setActiveView("")
  }, [])

  const clearAll = useCallback(() => {
    setFacets({})
    setSearch("")
    setMineOnly(false)
    setSegment(config.defaultSegment ?? config.segments[0]?.key ?? "all")
    setActiveView("")
    setLimit(pageSize)
  }, [config.defaultSegment, config.segments, pageSize])

  const applyView = useCallback(
    (viewKey: string) => {
      const view = config.savedViews.find((v) => v.key === viewKey)
      if (!view) return
      setActiveView(viewKey)
      setSegment(view.segment)
      setFacets(view.facets ? { ...view.facets } : {})
      if (view.sort) setSort({ ...view.sort })
      setGroup(view.group ?? "")
      setSearch("")
      setLimit(pageSize)
    },
    [config.savedViews, pageSize]
  )

  const toggleSort = useCallback((key: string) => {
    setSort((prev) => (prev.key === key ? { key, direction: (prev.direction * -1) as 1 | -1 } : { key, direction: 1 }))
    setActiveView("")
  }, [])

  const matchesFacets = useCallback(
    (row: T) => {
      for (const [key, selected] of Object.entries(facets)) {
        if (selected.length === 0) continue
        const facet = config.facets.find((f) => f.key === key)
        if (!facet) continue
        const raw = facet.valueOf(row)
        const values = raw == null ? [] : Array.isArray(raw) ? raw : [raw]
        if (!values.some((v) => selected.includes(v))) return false
      }
      return true
    },
    [facets, config.facets]
  )

  /** Rows surviving everything except the segment — used for the per-segment
   * counts, so each segment shows how many rows the CURRENT filters leave in
   * it rather than an unfiltered total that never matches what you get. */
  const preSegment = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (mineOnly && config.isMine && !config.isMine(row)) return false
      if (!matchesFacets(row)) return false
      if (q && !config.searchText(row).toLowerCase().includes(q)) return false
      return true
    })
    // `config` is rebuilt each render by callers; depending on the functions
    // themselves would recompute constantly, so the data and the state drive it.
  }, [rows, search, mineOnly, matchesFacets])

  const segmentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const seg of config.segments) counts[seg.key] = preSegment.filter(seg.predicate).length
    return counts
  }, [preSegment])

  const filtered = useMemo(() => {
    const seg = config.segments.find((s) => s.key === segment) ?? config.segments[0]
    const result = seg ? preSegment.filter(seg.predicate) : [...preSegment]

    const sortDef = config.sorts?.find((s) => s.key === sort.key)
    if (!sortDef) return result

    const collator = new Intl.Collator(locale === "ar" ? "ar" : "en")
    return [...result].sort((a, b) => {
      const av = sortDef.valueOf(a)
      const bv = sortDef.valueOf(b)
      const cmp =
        typeof av === "string" || typeof bv === "string"
          ? collator.compare(String(av), String(bv))
          : (av as number) - (bv as number)
      return cmp * sort.direction
    })
  }, [preSegment, segment, sort, locale])

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit])

  /** Visible rows folded into groups, or a single unnamed group when grouping
   * is off — so the renderer has exactly one shape to handle. */
  const grouped = useMemo(() => {
    const groupDef = config.groups?.find((g) => g.key === group)
    if (!groupDef) return [{ key: "", label: "", rows: visible }]
    const buckets = new Map<string, T[]>()
    for (const row of visible) {
      const key = groupDef.keyOf(row) || "—"
      const bucket = buckets.get(key)
      if (bucket) bucket.push(row)
      else buckets.set(key, [row])
    }
    return [...buckets.entries()].map(([key, groupRows]) => ({ key, label: key, rows: groupRows }))
  }, [visible, group])

  const activeChips = useMemo(
    () =>
      Object.entries(facets).flatMap(([key, values]) => {
        const facet = config.facets.find((f) => f.key === key)
        if (!facet) return []
        return values.map((value) => ({
          facetKey: key,
          value,
          label: facet.options.find((o) => o.value === value)?.label ?? value,
        }))
      }),
    [facets]
  )

  const hasActiveFilters =
    !!search || mineOnly || activeChips.length > 0 || segment !== (config.defaultSegment ?? config.segments[0]?.key)

  return {
    // state
    segment,
    search,
    facets,
    group,
    sort,
    mineOnly,
    dense,
    limit,
    activeView,
    // derived
    filtered,
    visible,
    grouped,
    segmentCounts,
    activeChips,
    hasActiveFilters,
    total: rows.length,
    shown: visible.length,
    matching: filtered.length,
    hasMore: filtered.length > limit,
    // actions
    setSegment: (key: string) => { setSegment(key); setActiveView(""); setLimit(pageSize) },
    setSearch: (value: string) => { setSearch(value); setLimit(pageSize) },
    toggleFacet,
    clearFacet,
    clearAll,
    applyView,
    setGroup: (key: string) => { setGroup(key); setActiveView("") },
    toggleSort,
    setMineOnly: (value: boolean) => { setMineOnly(value); setActiveView(""); setLimit(pageSize) },
    setDense,
    showMore: () => setLimit((prev) => prev + pageSize),
  }
}

export type CrmListState<T> = ReturnType<typeof useCrmListState<T>>
