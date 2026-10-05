"use client"

// One table for the module screens: a header that stays in view, columns sorted
// in the reader's language, figures that line up under their heading in BOTH
// directions, a totals row, row tones, a "show more" past a page, one empty
// state — and on a phone, a card per row instead of a sideways scroll.
//
// Figures: a cell is never given `dir="ltr"` (that flips what `text-end` means
// inside it, so in Arabic the digits sat on the far side from their heading);
// the digits are isolated in a <bdi dir="ltr"> instead and the cell keeps the
// table's direction. All text comes in as props, as everywhere in module-ui.

import { useMemo, useState, type ReactNode } from "react"
import { useLocale } from "next-intl"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { ShowMoreRow } from "./ShowMoreRow"

export type RowTone = "warn" | "bad" | "mute" | "ok"

export interface DataColumn<T> {
  key: string
  header: ReactNode
  /** The heading as plain text, for the phone card and the sort button's name (defaults to `header` when it is a string). */
  label?: string
  cell: (row: T) => ReactNode
  /** Figures: aligned to the end, tabular digits kept left-to-right. */
  numeric?: boolean
  /** Sortable when given; `null` sorts last. */
  sortValue?: (row: T) => string | number | null | undefined
  /** On a narrow desktop, hide below this width (the phone card still shows it). */
  hideBelow?: "lg" | "xl"
  /** Left out of the phone card (e.g. a column the card's title already says). */
  cardHidden?: boolean
  /** The totals row's cell. */
  footer?: ReactNode
  className?: string
}

export interface DataTableLabels {
  /** "Sort by {column}" — the sort button's accessible name. */
  sortBy: (column: string) => string
  /** "Show {count} more". */
  showMore: (count: number) => string
}

const TONE_ROW: Record<RowTone, string> = { warn: "bg-warning/5", bad: "bg-destructive/5", mute: "text-muted-foreground", ok: "" }
/** The row's accent: a bar on its first cell, on the reading side. */
const TONE_EDGE: Record<RowTone, string> = { warn: "border-s-4 border-s-warning", bad: "border-s-4 border-s-destructive", mute: "", ok: "" }
const TONE_CARD: Record<RowTone, string> = {
  warn: "border-s-4 border-s-warning",
  bad: "border-s-4 border-s-destructive",
  mute: "opacity-70",
  ok: "",
}
const HIDE: Record<NonNullable<DataColumn<unknown>["hideBelow"]>, string> = { lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" }

/** Digits isolated left-to-right inside a cell that keeps the table's direction. */
export function Figure({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={cn("tabular-nums", className)}>
      {children}
    </bdi>
  )
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  labels,
  empty,
  rowTone,
  initialSort,
  pageSize,
  maxHeight,
  dense,
  cardTitleKey,
  bordered = true,
  className,
}: {
  columns: DataColumn<T>[]
  rows: readonly T[]
  rowKey: (row: T) => string
  /** What the table is — read by screen readers, not shown. */
  caption: string
  labels: DataTableLabels
  /** Shown instead of the table when there are no rows. */
  empty: ReactNode
  rowTone?: (row: T) => RowTone | undefined
  initialSort?: { key: string; dir: "asc" | "desc" }
  /** Rows shown before "show more" (all when absent). */
  pageSize?: number
  /** A height past which the body scrolls under its header (e.g. "70vh"). */
  maxHeight?: string
  dense?: boolean
  /** The column that titles a row's card on a phone (the first one by default). */
  cardTitleKey?: string
  /** False inside a Panel that already draws the frame. */
  bordered?: boolean
  className?: string
}) {
  const locale = useLocale()
  const mobile = useIsMobile()
  const [sort, setSort] = useState(initialSort ?? null)
  const [limit, setLimit] = useState(pageSize ?? Number.POSITIVE_INFINITY)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" })
    const value = col.sortValue
    const dir = sort.dir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = value(a)
      const y = value(b)
      if (x == null || x === "") return y == null || y === "" ? 0 : 1
      if (y == null || y === "") return -1
      return (typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y))) * dir
    })
  }, [rows, columns, sort, locale])

  const shown = sorted.slice(0, limit)
  const rest = sorted.length - shown.length
  const hasFooter = columns.some((c) => c.footer !== undefined)
  const textOf = (c: DataColumn<T>) => c.label ?? (typeof c.header === "string" ? c.header : c.key)
  const pad = dense ? "px-3 py-2" : "px-4 py-3"
  const frame = bordered ? "rounded-xl border bg-card" : ""

  if (rows.length === 0) return <div className={className}>{empty}</div>

  const more = rest > 0 && <ShowMoreRow onClick={() => setLimit((n) => n + (pageSize ?? rest))}>{labels.showMore(Math.min(rest, pageSize ?? rest))}</ShowMoreRow>

  if (mobile) {
    const title = columns.find((c) => c.key === cardTitleKey) ?? columns[0]
    const others = columns.filter((c) => c !== title)
    return (
      <div className={cn(frame, "overflow-hidden", className)}>
        <ul className="divide-y" aria-label={caption}>
          {shown.map((r) => {
            const tone = rowTone?.(r)
            return (
              <li key={rowKey(r)} className={cn("space-y-2 px-4 py-3", tone && TONE_CARD[tone])}>
                <div className="text-sm font-semibold">{title.cell(r)}</div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  {others
                    .filter((c) => !c.cardHidden)
                    .map((c) => (
                      <div key={c.key} className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{textOf(c)}</dt>
                        <dd className={cn("min-w-0 break-words", c.numeric && "font-semibold")}>{c.numeric ? <Figure>{c.cell(r)}</Figure> : c.cell(r)}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            )
          })}
        </ul>
        {hasFooter && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t bg-muted/50 px-4 py-3 text-sm font-bold">
            {columns
              .filter((c) => c.footer !== undefined)
              .map((c) => (
                <div key={c.key}>
                  <dt className="text-xs font-normal text-muted-foreground">{textOf(c)}</dt>
                  <dd>{c.numeric ? <Figure>{c.footer}</Figure> : c.footer}</dd>
                </div>
              ))}
          </dl>
        )}
        {more}
      </div>
    )
  }

  return (
    <div className={cn(frame, "overflow-hidden", className)}>
      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key
                const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : c.sortValue ? "none" : undefined
                return (
                  <th key={c.key} scope="col" aria-sort={ariaSort} className={cn(pad, "whitespace-nowrap font-semibold", c.numeric ? "text-end" : "text-start", c.hideBelow && HIDE[c.hideBelow], c.className)}>
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => setSort(active && sort.dir === "asc" ? { key: c.key, dir: "desc" } : { key: c.key, dir: "asc" })}
                        aria-label={labels.sortBy(textOf(c))}
                        className={cn(
                          "inline-flex min-h-8 items-center gap-1 rounded-md px-1 -mx-1 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active && "text-foreground"
                        )}
                      >
                        <span>{c.header}</span>
                        {active ? sort.dir === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" /> : <ChevronsUpDown size={13} className="opacity-40" aria-hidden="true" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r) => {
              const tone = rowTone?.(r)
              return (
                <tr key={rowKey(r)} className={cn("transition-colors hover:bg-muted/40", tone && TONE_ROW[tone])}>
                  {columns.map((c, i) => (
                    <td key={c.key} className={cn(pad, "align-middle", c.numeric ? "text-end" : "text-start", c.hideBelow && HIDE[c.hideBelow], i === 0 && tone && TONE_EDGE[tone], c.className)}>
                      {c.numeric ? <Figure>{c.cell(r)}</Figure> : c.cell(r)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          {hasFooter && (
            <tfoot className="border-t-2 bg-muted/50 font-bold">
              <tr>
                {columns.map((c) => (
                  <td key={c.key} className={cn(pad, c.numeric ? "text-end" : "text-start", c.hideBelow && HIDE[c.hideBelow], c.className)}>
                    {c.footer === undefined ? null : c.numeric ? <Figure>{c.footer}</Figure> : c.footer}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {more}
    </div>
  )
}
