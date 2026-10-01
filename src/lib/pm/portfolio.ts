// PM 1.0 — the portfolio list (the prototype's «سجل المشاريع»). The state is
// one property, so its chips are exclusive; «الكل» is every project still in
// play and never the archive, which is a view of its own (frozen figures, a
// dense table, a close year, CSV). The filters are multi-select and combine:
// OR inside a filter, AND across filters. Pure: no I/O.

import { matchesSearch } from "../search-text"
import type { PmLifecycle } from "./lifecycle"

export const PORTFOLIO_STATES = ["all", "live", "hold", "plan", "done", "arch"] as const
export type PortfolioState = (typeof PORTFOLIO_STATES)[number]

export function inPortfolioState(lifecycle: PmLifecycle, st: PortfolioState): boolean {
  if (st === "all") return lifecycle !== "closed"
  if (st === "arch") return lifecycle === "closed"
  return lifecycle === st
}

export const PORTFOLIO_FILTERS = ["kind", "reg", "pm", "yr"] as const
export type PortfolioFilter = (typeof PORTFOLIO_FILTERS)[number]
export type FilterSelection = Partial<Record<PortfolioFilter, string[]>>

/** The close year only means something in the archive. */
export const filtersFor = (st: PortfolioState): PortfolioFilter[] => (st === "arch" ? ["kind", "reg", "pm", "yr"] : ["kind", "reg", "pm"])

/** The final figures frozen at archive — exactly what closing stores in `pm.fin`
 * (closeout.ts `ArchiveSnapshot`): the actual cost, the realised margin (earned −
 * actual) and its %. They are absent when the closer could not see cost — never
 * invented, and never recomputed here. */
export interface PortfolioFin {
  contractValue: number
  actualCost?: number | null
  margin?: number | null
  marginPct?: number | null
  /** An older shape some rows carried; read only when `actualCost` is absent. */
  cost?: number | null
  contractDays: number | null
  actualDays: number | null
  delayDays: number | null
  closedOn: string | null
  retentionHeld: number
}

export interface PortfolioRow {
  id: string
  no: string | null
  noDisplay: string | null
  name: string
  client: string | null
  kind: string | null
  region: string | null
  managerId: string | null
  managerName: string | null
  lifecycle: PmLifecycle
  value: number
  fin: PortfolioFin | null
}

export function filterValue(row: PortfolioRow, key: PortfolioFilter): string | null {
  switch (key) {
    case "kind":
      return row.kind
    case "reg":
      return row.region
    case "pm":
      return row.managerId
    case "yr":
      return row.fin?.closedOn ? row.fin.closedOn.slice(0, 4) : null
  }
}

/** What a filter offers: the values present in the chosen state, before any other filter. */
export function filterOptions(rows: PortfolioRow[], st: PortfolioState, key: PortfolioFilter): string[] {
  const out = new Set<string>()
  for (const r of rows) {
    if (!inPortfolioState(r.lifecycle, st)) continue
    const v = filterValue(r, key)
    if (v) out.add(v)
  }
  return Array.from(out).sort((a, b) => (key === "yr" ? b.localeCompare(a) : a.localeCompare(b)))
}

export function toggleOption(sel: FilterSelection, key: PortfolioFilter, value: string): FilterSelection {
  const cur = sel[key] ?? []
  return { ...sel, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] }
}

export const activeFilters = (sel: FilterSelection, st: PortfolioState) => filtersFor(st).filter((k) => (sel[k] ?? []).length > 0).length

export function portfolioCounts(rows: PortfolioRow[]): Record<PortfolioState, number> {
  const out = { all: 0, live: 0, hold: 0, plan: 0, done: 0, arch: 0 } as Record<PortfolioState, number>
  for (const r of rows) for (const st of PORTFOLIO_STATES) if (inPortfolioState(r.lifecycle, st)) out[st]++
  return out
}

/** The list the view shows: state, then each active filter, then the search
 * (name · number · client · region, Arabic-folded). */
export function portfolioList<R extends PortfolioRow>(rows: R[], input: { st: PortfolioState; sel: FilterSelection; q: string }): R[] {
  const keys = filtersFor(input.st)
  return rows.filter((r) => {
    if (!inPortfolioState(r.lifecycle, input.st)) return false
    for (const k of keys) {
      const chosen = input.sel[k] ?? []
      if (chosen.length && !chosen.includes(filterValue(r, k) ?? "")) return false
    }
    return !input.q.trim() || matchesSearch(input.q, [r.name, r.no, r.noDisplay, r.client, r.region])
  })
}

export const ARCHIVE_SORTS = ["d", "v", "m", "l"] as const
export type ArchiveSort = (typeof ARCHIVE_SORTS)[number]

/** Value and margin order the archive by money: only a holder of money is offered them. */
export const archiveSortsFor = (money: boolean): ArchiveSort[] => (money ? [...ARCHIVE_SORTS] : ["d", "l"])

/** The frozen actual cost. */
export const costOf = (fin: PortfolioFin | null): number | null => fin?.actualCost ?? fin?.cost ?? null

/** The frozen margin as closing computed it (earned − actual cost); only a row
 * frozen before the margin was stored falls back to contract − cost. */
export function marginOf(fin: PortfolioFin | null): { amount: number; pct: number } | null {
  if (!fin || !(fin.contractValue > 0)) return null
  const pct = (amount: number) => Math.round((amount / fin.contractValue) * 1000) / 10
  if (fin.margin != null) return { amount: fin.margin, pct: fin.marginPct ?? pct(fin.margin) }
  const cost = costOf(fin)
  return cost != null ? { amount: fin.contractValue - cost, pct: pct(fin.contractValue - cost) } : null
}

/** Recently closed · highest value · best margin · most delayed. */
export function sortArchive<R extends PortfolioRow>(rows: R[], sort: ArchiveSort): R[] {
  const val = (r: R) => r.fin?.contractValue ?? r.value
  const out = rows.slice()
  out.sort((a, b) => {
    if (sort === "v") return val(b) - val(a)
    if (sort === "m") return (marginOf(b.fin)?.pct ?? -Infinity) - (marginOf(a.fin)?.pct ?? -Infinity)
    if (sort === "l") return (b.fin?.delayDays ?? 0) - (a.fin?.delayDays ?? 0)
    return (b.fin?.closedOn ?? "").localeCompare(a.fin?.closedOn ?? "")
  })
  return out
}

export const ARCHIVE_PAGE = 12

export interface ArchiveKpis {
  count: number
  of: number
  value: number
  /** Null while any shown project has no frozen cost. */
  cost: number | null
  marginPct: number | null
  late: number
}

export function archiveKpis(list: PortfolioRow[], archivedTotal: number): ArchiveKpis {
  const value = list.reduce((a, r) => a + (r.fin?.contractValue ?? r.value), 0)
  const costed = list.length > 0 && list.every((r) => costOf(r.fin) != null)
  const cost = costed ? list.reduce((a, r) => a + (costOf(r.fin) ?? 0), 0) : null
  // The average realised margin: the frozen margins over the value shown.
  const margin = costed ? list.reduce((a, r) => a + (marginOf(r.fin)?.amount ?? 0), 0) : null
  return {
    count: list.length,
    of: archivedTotal,
    value,
    cost,
    marginPct: margin !== null && value > 0 ? Math.round((margin / value) * 1000) / 10 : null,
    late: list.filter((r) => (r.fin?.delayDays ?? 0) > 0).length,
  }
}

/** CSV that Excel opens in Arabic: a BOM, every cell quoted, raw numbers without separators. */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const q = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`
  return "﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n")
}

const CSV_MONEY = new Set(["contract", "cost", "margin"])
const CSV_HEAD = ["no", "project", "client", "kind", "region", "contract", "cost", "margin", "actual_days", "contract_days", "closed", "manager"] as const

/** The archive CSV's columns: contract, cost and margin only for a holder of money. */
export const archiveCsvHead = (money: boolean): string[] => CSV_HEAD.filter((h) => money || !CSV_MONEY.has(h))

export function archiveCsvRows(
  list: PortfolioRow[],
  label: { kind: (k: string | null) => string; manager: (r: PortfolioRow) => string },
  money: boolean
): Array<Array<string | number | null>> {
  return list.map((r) => {
    const m = marginOf(r.fin)
    const cells: Record<(typeof CSV_HEAD)[number], string | number | null> = {
      no: r.no ?? "",
      project: r.name,
      client: r.client ?? "",
      kind: label.kind(r.kind),
      region: r.region ?? "",
      contract: Math.round(r.fin?.contractValue ?? r.value),
      cost: costOf(r.fin) != null ? Math.round(costOf(r.fin) as number) : "",
      margin: m ? m.pct : "",
      actual_days: r.fin?.actualDays ?? "",
      contract_days: r.fin?.contractDays ?? "",
      closed: r.fin?.closedOn ?? "",
      manager: label.manager(r),
    }
    return archiveCsvHead(money).map((h) => cells[h as (typeof CSV_HEAD)[number]])
  })
}
