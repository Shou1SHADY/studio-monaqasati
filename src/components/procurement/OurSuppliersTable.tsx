"use client"

// «مورّدونا» — the suppliers we work with, in the one list every supplier screen shares (PRD 2.0 SUP-01). What is OURS
// stays here: the status column also names the first thing that would stop an order (an expired CR, a missing VAT number,
// a CR about to end), computed from our record, and how many orders are open with him. The platform's own numbers (how many
// operations he completed across all buyers, his on-time share, his computed rating) come from the daily cards.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import type { PlatformSupplier } from "@/hooks/useSupplierDirectory"
import type { SupplierScore } from "@/lib/procurement/po"
import { effectiveCrExpiry, effectiveVat, isOffPlatform, isUnverified, profileVatMark, supplierDocs, type DocsState } from "@/lib/procurement/supplier-file"
import { SUPPLIER_PAGE_SIZE, listSuppliers, supplierFacets, type SupplierFilter, type SupplierListItem } from "@/lib/procurement/supplier-list"
import type { SupplierCard } from "@/lib/procurement/supplier-stats"
import { useDateText } from "./PoBits"
import { SupplierList, type SupplierLayout } from "./SupplierList"

export type SupplierRow = PlatformSupplier & { score: SupplierScore; open: number }

type OursItem = SupplierListItem & { docs: ReturnType<typeof supplierDocs>; open: number }

const DOCS_TONE: Record<DocsState, PillTone> = { ok: "ok", cr_expired: "bad", no_vat: "warn", cr_ending: "warn" }

/** A supplier we keep, as a row of the shared list. */
export function ourItem(s: SupplierRow, specialties: string[], card: SupplierCard | undefined, today: string): OursItem {
  const off = isOffPlatform(s)
  return {
    id: s.orgId,
    name: s.name,
    city: s.city,
    specialties,
    onPlatform: !off,
    verified: s.record ? !isUnverified(s.record) : s.platformVerified,
    preferred: s.isFavorite,
    ours: true,
    deals: off ? null : (card?.completedOps ?? null),
    onTimePercent: off ? null : (card?.onTimePercent ?? null),
    rating: off ? null : (card?.rating ?? null),
    since: s.since,
    hasProfile: Boolean(s.bio),
    hasWorks: s.worksCount > 0,
    hasCerts: s.certificates.length > 0,
    docs: supplierDocs(effectiveVat(s.record, profileVatMark(s)), effectiveCrExpiry(s.record, s.profileCrExpiry), today),
    open: s.open,
  }
}

export function OurSuppliersTable({
  rows,
  cards,
  today,
  filter,
  onFilter,
  layout,
  onLayout,
  specialtiesOf,
  specialtyLabel,
  onOpen,
  emptyAll,
}: {
  rows: SupplierRow[]
  cards: ReadonlyMap<string, SupplierCard>
  today: string
  filter: SupplierFilter
  onFilter: (next: SupplierFilter) => void
  layout: SupplierLayout
  onLayout: (next: SupplierLayout) => void
  /** The material tree's keys a supplier is filtered and counted by. */
  specialtiesOf: (s: SupplierRow) => string[]
  specialtyLabel: (key: string) => string
  onOpen: (orgId: string) => void
  emptyAll?: React.ReactNode
}) {
  const t = useTranslations("Portal.ProcSuppliers")
  const fmt = useDateText()
  const [limit, setLimit] = useState(SUPPLIER_PAGE_SIZE)
  const filterKey = `${filter.q}|${filter.specialty}|${filter.city}|${filter.status}|${filter.sort}`
  useEffect(() => setLimit(SUPPLIER_PAGE_SIZE), [filterKey])

  const items = useMemo(() => rows.map((s) => ourItem(s, specialtiesOf(s), cards.get(s.orgId), today)), [rows, specialtiesOf, cards, today])
  const page = useMemo(() => listSuppliers(items, filter, "ours", { limit, label: specialtyLabel }), [items, filter, limit, specialtyLabel])
  const facets = useMemo(() => supplierFacets(items, filter, "ours", specialtyLabel), [items, filter, specialtyLabel])

  return (
    <SupplierList
      kind="ours"
      rows={page.rows}
      matched={page.matched}
      total={page.total}
      more={page.more}
      facets={facets}
      filter={filter}
      onFilter={onFilter}
      layout={layout}
      onLayout={onLayout}
      specialtyLabel={specialtyLabel}
      onOpen={onOpen}
      onShowMore={() => setLimit((n) => n + SUPPLIER_PAGE_SIZE)}
      emptyAll={emptyAll}
      statusExtra={(s) =>
        !s.onPlatform ? null : (
          <>
            <StatusPill tone={DOCS_TONE[s.docs.state]} className="px-2 py-0 text-[10.5px]">
              {s.docs.state === "cr_ending" ? t("docs.cr_ending", { date: fmt(s.docs.crExpiry) }) : t(`docs.${s.docs.state}`)}
            </StatusPill>
            {s.open > 0 && <span className="text-[11px] text-muted-foreground">{t("open_orders", { count: s.open })}</span>}
          </>
        )
      }
    />
  )
}
