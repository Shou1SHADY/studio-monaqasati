"use client"

// «مورّدونا» and «دليل موردي المنصة» in one component (SUP-01, prototype `supList`): the same filter bar — search ·
// specialty from the tree · city · status · sort · «N من M» · rows or cards — over a list that shows 24 and offers
// «عرض N أخرى». The page hands it the rows to show and the counts; WHO filtered them (the screen, for the few suppliers
// we keep, or the server, for the whole platform) is not this component's business — which is what lets the directory
// scale (NFR-03). All words come from `Portal.ProcSuppliers.list`.

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { LayoutGrid, List, Loader2, Plus, Search, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Chip } from "@/components/module-ui/Chip"
import { DataTable, Figure, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { displayCity } from "@/lib/constants"
import { DIR_STATUSES, OURS_STATUSES, SUPPLIER_SORTS, EMPTY_SUPPLIER_FILTER, ratingText, supplierFilterActive, type SupplierFacets, type SupplierFilter, type SupplierListItem, type SupplierListKind, type SupplierSort, type SupplierStatus } from "@/lib/procurement/supplier-list"
import { cn } from "@/lib/utils"
import { Stars } from "./SupplierFileDrawer"

export type SupplierLayout = "rows" | "cards"

const SHOWN_SPECIALTIES = 3

export interface SupplierListProps<T extends SupplierListItem> {
  kind: SupplierListKind
  /** The rows to show — already filtered, sorted and cut. */
  rows: readonly T[]
  matched: number
  total: number
  /** The N on «عرض N أخرى»; 0 hides the button. */
  more: number
  facets: SupplierFacets
  filter: SupplierFilter
  onFilter: (next: SupplierFilter) => void
  layout: SupplierLayout
  onLayout: (next: SupplierLayout) => void
  specialtyLabel: (key: string) => string
  onOpen: (id: string) => void
  onAdd?: (id: string) => void
  onShowMore: () => void
  loading?: boolean
  failed?: boolean
  /** Under the status pill in the row and the card — our own docs state, open orders. */
  statusExtra?: (row: T) => ReactNode
  /** Shown instead of the empty-filter state when there is nothing at all. */
  emptyAll?: ReactNode
  caption?: string
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-module/10 text-xs font-black text-module" aria-hidden="true">
      {name.trim().slice(0, 2)}
    </span>
  )
}

export function SupplierList<T extends SupplierListItem>(props: SupplierListProps<T>) {
  const { kind, rows, matched, total, more, facets, filter, onFilter, layout, onLayout, specialtyLabel, onOpen, onAdd, onShowMore, loading, failed, statusExtra, emptyAll, caption } = props
  const t = useTranslations("Portal.ProcSuppliers.list")
  const locale = useLocale()
  const statuses: readonly SupplierStatus[] = kind === "ours" ? OURS_STATUSES : DIR_STATUSES
  const set = (patch: Partial<SupplierFilter>) => onFilter({ ...filter, ...patch })
  const statusText = (s: SupplierStatus) => t(kind === "ours" ? `st_${s}` : `dst_${s}`)
  const active = supplierFilterActive(filter)

  const statusPill = (s: T) =>
    !s.onPlatform ? <StatusPill tone="mute">{t("off")}</StatusPill> : s.verified ? <StatusPill tone="ok">{t("verified")}</StatusPill> : <StatusPill tone="warn">{t("unverified")}</StatusPill>

  const specialtyPills = (s: T) => (
    <span className="flex flex-wrap gap-1">
      {s.specialties.slice(0, SHOWN_SPECIALTIES).map((k) => (
        <StatusPill key={k} tone="mute" className="px-2 py-0 text-[10.5px]">
          {specialtyLabel(k)}
        </StatusPill>
      ))}
      {s.specialties.length > SHOWN_SPECIALTIES && <span className="text-[11px] text-muted-foreground">{t("more_specialties", { count: s.specialties.length - SHOWN_SPECIALTIES })}</span>}
      {!s.specialties.length && <span className="text-muted-foreground">—</span>}
    </span>
  )

  const nameCell = (s: T) => (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={s.name} />
      <span className="min-w-0">
        <button
          type="button"
          onClick={() => onOpen(s.id)}
          className="max-w-full rounded text-start font-bold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          dir="auto"
        >
          {s.preferred && (
            <span className="me-1 text-warning" aria-hidden="true">
              ★
            </span>
          )}
          {s.name}
        </button>
        <span className="block text-xs text-muted-foreground">{[s.city ? displayCity(s.city, locale) : null, s.since ? t("since", { year: s.since.slice(0, 4) }) : null].filter(Boolean).join(" · ") || "—"}</span>
      </span>
    </span>
  )

  const addButton = (s: T) =>
    !s.ours && onAdd ? (
      <Button size="sm" className="gap-1.5" onClick={() => onAdd(s.id)}>
        <Plus size={14} aria-hidden="true" />
        {t("add")}
      </Button>
    ) : null

  const columns: DataColumn<T>[] = [
    { key: "supplier", header: t("col_supplier"), cell: nameCell },
    { key: "specialties", header: t("col_specialties"), cell: specialtyPills },
    {
      key: "platform",
      header: t("col_platform"),
      cell: (s) =>
        s.deals == null ? (
          <span className="text-xs text-muted-foreground">{t("no_platform_file")}</span>
        ) : (
          <span>
            <b className="tabular-nums">
              <Figure>{s.deals.toLocaleString("en-US")}</Figure>
            </b>{" "}
            <span className="text-xs text-muted-foreground">{t("ops", { count: s.deals })}</span>
          </span>
        ),
    },
    {
      key: "on_time",
      header: t("col_on_time"),
      cell: (s) => (s.onTimePercent == null ? <span className="text-muted-foreground">—</span> : <b className={cn("tabular-nums", s.onTimePercent < 80 ? "text-destructive" : s.onTimePercent < 90 ? "text-warning" : "text-success")}><Figure>{s.onTimePercent}%</Figure></b>),
    },
    {
      key: "rating",
      header: t("col_rating"),
      cell: (s) =>
        s.rating == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Stars value={s.rating} />
            <b className="tabular-nums">
              <Figure>{ratingText(s.rating)}</Figure>
            </b>
          </span>
        ),
    },
    {
      key: "status",
      header: t("col_status"),
      cell: (s) => (
        <span className="flex flex-col items-start gap-1">
          <span className="flex flex-wrap items-center gap-1">
            {statusPill(s)}
            {kind === "dir" && s.ours && <StatusPill tone="module">{t("ours")}</StatusPill>}
          </span>
          {statusExtra?.(s)}
        </span>
      ),
    },
    { key: "actions", header: <span className="sr-only">{t("open_file")}</span>, label: t("open_file"), cardHidden: false, cell: (s) => <span className="flex flex-wrap items-center gap-2">{addButton(s)}</span> },
  ]

  const bar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={filter.q} onChange={(e) => set({ q: e.target.value })} placeholder={t("search")} aria-label={t("search")} className="pe-8 ps-10" dir="auto" />
        {filter.q && (
          <button
            type="button"
            onClick={() => set({ q: "" })}
            aria-label={t("clear_search")}
            className="absolute end-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <NativeSelect aria-label={t("all_specialties")} value={filter.specialty} onChange={(e) => set({ specialty: e.target.value })} className={cn("max-w-full", filter.specialty && "border-module text-module")}>
        <option value="">{t("all_specialties")}</option>
        {facets.specialties.map(([k, n]) => (
          <option key={k} value={k}>{`${specialtyLabel(k)} · ${n}`}</option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label={t("all_cities")} value={filter.city} onChange={(e) => set({ city: e.target.value })} className={cn("max-w-full", filter.city && "border-module text-module")}>
        <option value="">{t("all_cities")}</option>
        {facets.cities.map(([c, n]) => (
          <option key={c} value={c}>{`${displayCity(c, locale)} · ${n}`}</option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label={t("status_label")} value={filter.status} onChange={(e) => set({ status: e.target.value as SupplierStatus })} className={cn("max-w-full", filter.status !== "all" && "border-module text-module")}>
        {statuses.map((s) => (
          <option key={s} value={s}>
            {statusText(s)}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label={t("sort_label")} value={filter.sort} onChange={(e) => set({ sort: e.target.value as SupplierSort })} className="max-w-full">
        {SUPPLIER_SORTS.map((s) => (
          <option key={s} value={s}>
            {t(`sort_${s}`)}
          </option>
        ))}
      </NativeSelect>
      <span className="text-xs tabular-nums text-muted-foreground" role="status">
        {t("count", { matched, total })}
      </span>
      <div className="ms-auto flex gap-1" role="group" aria-label={t("view_label")}>
        <Chip selected={layout === "rows"} icon={List} onClick={() => onLayout("rows")}>
          {t("view_rows")}
        </Chip>
        <Chip selected={layout === "cards"} icon={LayoutGrid} onClick={() => onLayout("cards")}>
          {t("view_cards")}
        </Chip>
      </div>
    </div>
  )

  const showMore =
    more > 0 ? (
      <div className="flex justify-center pt-1">
        <Button variant="outline" onClick={onShowMore} disabled={loading} className="gap-2">
          {loading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {t("show_more", { count: more })}
        </Button>
      </div>
    ) : null

  const empty = (
    <EmptyState
      icon={Users}
      title={t("empty")}
      action={
        active ? (
          <Button variant="outline" size="sm" onClick={() => onFilter({ ...EMPTY_SUPPLIER_FILTER, sort: filter.sort })}>
            {t("clear")}
          </Button>
        ) : undefined
      }
    />
  )

  if (total === 0 && !loading && emptyAll) return <>{emptyAll}</>

  return (
    <div className="space-y-3">
      {bar}
      {failed && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{t("failed")}</p>}
      {rows.length === 0 ? (
        loading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            <Loader2 className="animate-spin" size={24} aria-hidden="true" />
          </div>
        ) : (
          empty
        )
      ) : layout === "rows" ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          caption={caption ?? t("table")}
          labels={{ sortBy: (c) => c, showMore: (n) => t("show_more", { count: n }) }}
          empty={empty}
          cardTitleKey="supplier"
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={caption ?? t("table")}>
          {rows.map((s) => (
            <li key={s.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                {nameCell(s)}
                <span className="shrink-0">{statusPill(s)}</span>
              </div>
              {specialtyPills(s)}
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {s.rating != null ? (
                  <span className="inline-flex items-center gap-1">
                    <Stars value={s.rating} />
                    <b className="tabular-nums text-foreground">
                      <Figure>{ratingText(s.rating)}</Figure>
                    </b>
                  </span>
                ) : null}
                {s.deals != null ? <span>{t("ops_done", { count: s.deals })}</span> : <span>{t("no_platform_file")}</span>}
                {s.onTimePercent != null && <span>{t("on_time_text", { percent: s.onTimePercent })}</span>}
              </p>
              <div className="flex flex-wrap gap-1">
                {s.hasProfile && <StatusPill tone="info" className="px-2 py-0 text-[10.5px]">{t("chip_profile")}</StatusPill>}
                {s.hasWorks && <StatusPill tone="info" className="px-2 py-0 text-[10.5px]">{t("chip_works")}</StatusPill>}
                {s.hasCerts && <StatusPill tone="info" className="px-2 py-0 text-[10.5px]">{t("chip_certs")}</StatusPill>}
                {kind === "dir" && s.ours && <StatusPill tone="module" className="px-2 py-0 text-[10.5px]">{t("ours")}</StatusPill>}
              </div>
              {statusExtra?.(s)}
              <div className="mt-auto flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => onOpen(s.id)}>
                  {t("open_file")}
                </Button>
                {addButton(s)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {showMore}
    </div>
  )
}
