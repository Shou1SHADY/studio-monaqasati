"use client"

// The offers tab's list (RFQ-05/06): header row, filters and sort, one compact row per offer, thirty at a time. Built for dozens
// of offers: nothing in a row loads anything, and the rows are memoised on the offer's own model.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { filterCounts, matchesFilter, sortRows, type OfferFilter, type OfferRowModel, type OfferSort } from "@/lib/procurement/rfq-offers-view"
import { OfferRow } from "./OfferRow"
import { RfqOfferFilters } from "./RfqOfferFilters"
import type { RfqView } from "./rfqOfferView"

export const PAGE = 30

export interface OfferListProps {
  rows: OfferRowModel[]
  rfq: RfqView
  today: string
  showPrices: boolean
  canShortlist: boolean
  canAsk: boolean
  fallbackName: string
  hasRecord: (row: OfferRowModel) => boolean
  onOpen: (id: string) => void
  onToggleShortlist: (row: OfferRowModel) => void
  onClarify: (row: OfferRowModel) => void
  /** Open the shortlist filter from outside (the comparison's «القائمة القصيرة فقط»). */
  initialFilter?: OfferFilter
}

export function RfqOfferList({ rows, rfq, today, showPrices, canShortlist, canAsk, fallbackName, hasRecord, onOpen, onToggleShortlist, onClarify, initialFilter = "all" }: OfferListProps) {
  const t = useTranslations("Portal.Procurement.rfqpage.list")
  const [filter, setFilter] = useState<OfferFilter>(initialFilter)
  const [sort, setSort] = useState<OfferSort>("price")
  const [shown, setShown] = useState(PAGE)
  const counts = useMemo(() => filterCounts(rows), [rows])
  const visible = useMemo(() => sortRows(rows.filter((r) => matchesFilter(r, filter)), sort), [rows, filter, sort])
  const page = visible.slice(0, shown)

  return (
    <div className="space-y-3">
      <RfqOfferFilters counts={counts} filter={filter} onFilter={(f) => (setFilter(f), setShown(PAGE))} sort={sort} onSort={setSort} />
      <div role="table" aria-label={t("aria")} className="overflow-hidden rounded-xl border bg-card">
        <div role="row" className="hidden gap-x-3 border-b bg-muted/50 px-3 py-2 text-[11px] font-black text-muted-foreground md:grid md:grid-cols-[2.25rem_minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_auto]">
          <span role="columnheader" aria-hidden="true" />
          <span role="columnheader">{t("head_supplier")}</span>
          <span role="columnheader">{t("head_total")}</span>
          <span role="columnheader">{t("head_priced")}</span>
          <span role="columnheader">{t("head_lead")}</span>
          <span role="columnheader">{t("head_valid")}</span>
          <span role="columnheader" className="w-32" aria-hidden="true" />
        </div>
        {page.map((row) => (
          <OfferRow key={row.id} row={row} rfq={rfq} today={today} showPrices={showPrices} canShortlist={canShortlist} canAsk={canAsk} fallbackName={fallbackName} hasRecord={hasRecord(row)} onOpen={onOpen} onToggleShortlist={onToggleShortlist} onClarify={onClarify} />
        ))}
        {!page.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("none_here")}</p>}
      </div>
      {visible.length > shown && (
        <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <span>{t("showing", { shown: page.length, total: visible.length })}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
            {t("show_more")}
          </Button>
        </div>
      )}
    </div>
  )
}
