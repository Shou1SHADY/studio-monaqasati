"use client"

// «دليل موردي المنصة» (PRD 2.0 SUP-01, prototype vSup:dir) — every supplier on the Mdmak platform that the platform
// verified, with the same list as «مورّدونا». The browser never holds the platform: each filter change asks the server
// (`GET /api/procurement/suppliers`) for 24 rows plus the counts, and «عرض N أخرى» asks for the next 24. An off-platform
// supplier is never here — the directory is built from platform accounts only.

import { useEffect, useMemo } from "react"
import { useTranslations } from "next-intl"
import { usePlatformDirectory } from "@/hooks/useSupplierDirectory"
import { cardToItem } from "@/lib/procurement/supplier-stats"
import type { SupplierFilter, SupplierListItem } from "@/lib/procurement/supplier-list"
import { SupplierList, type SupplierLayout } from "./SupplierList"

export function SupplierDirectory({
  filter,
  onFilter,
  layout,
  onLayout,
  specialtyLabel,
  mineIds,
  onOpen,
  onAdd,
  onTotal,
  searchless,
}: {
  filter: SupplierFilter
  onFilter: (next: SupplierFilter) => void
  layout: SupplierLayout
  onLayout: (next: SupplierLayout) => void
  specialtyLabel: (key: string) => string
  /** Every supplier the viewer keeps — the server only knows links, records and explicit favourites. */
  mineIds: ReadonlySet<string>
  onOpen: (orgId: string) => void
  onAdd?: (orgId: string) => void
  /** The directory's size, for the segment's count. */
  onTotal?: (total: number) => void
  /** The page's head searches: no box in the list. */
  searchless?: boolean
}) {
  const t = useTranslations("Portal.ProcSuppliers")
  const dir = usePlatformDirectory(filter)
  useEffect(() => {
    if (dir.ready) onTotal?.(dir.total)
  }, [dir.ready, dir.total, onTotal])
  const rows = useMemo<SupplierListItem[]>(() => dir.rows.map((r) => cardToItem(r, { ours: r.ours || mineIds.has(r.orgId) })), [dir.rows, mineIds])

  return (
    <div className="space-y-2">
      <SupplierList
        kind="dir"
        rows={rows}
        matched={dir.matched}
        total={dir.total}
        more={dir.more}
        facets={dir.facets}
        filter={filter}
        onFilter={onFilter}
        layout={layout}
        onLayout={onLayout}
        specialtyLabel={specialtyLabel}
        onOpen={onOpen}
        onAdd={onAdd}
        searchless={searchless}
        onShowMore={dir.loadMore}
        loading={dir.loading || (!dir.ready && !dir.failed)}
        failed={dir.failed}
      />
      <p className="text-xs text-muted-foreground">{t("list.dir_caption")}</p>
    </div>
  )
}
