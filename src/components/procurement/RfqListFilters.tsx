"use client"

// The head of «طلبات العروض» (PRD 2.0, the prototype's `viewRfq`): the state chips with their counts, the drafts button, the
// tiles/rows toggle, and the filter bar — search · delivery site · category · who it reaches · sort — each option carrying the count it
// would leave. Everything is a controlled value of one `RfqListFilter`; the page owns it and the pure module (`rfq-list.ts`) uses it.

import { useLocale, useTranslations } from "next-intl"
import { LayoutGrid, List, Pencil, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Chip } from "@/components/module-ui/Chip"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { LIST_LAYOUTS, LIST_REACHES, LIST_SORTS, listFilterActive, type ListCounts, type ListFacets, type ListLayout, type ListReach, type ListSort, type ListView, type RfqListFilter } from "@/lib/procurement/rfq-list"
import { cn } from "@/lib/utils"

const CHIPS = ["open", "compare", "awarded", "cancelled", "all"] as const

export function RfqListFilters({
  filter,
  onFilter,
  counts,
  facets,
  siteLabel,
  categoryLabel,
  layout,
  onLayout,
  matched,
  total,
}: {
  filter: RfqListFilter
  onFilter: (next: RfqListFilter) => void
  counts: ListCounts
  facets: ListFacets
  siteLabel: (key: string) => string
  categoryLabel: (key: string) => string
  layout: ListLayout
  onLayout: (next: ListLayout) => void
  matched: number
  total: number
}) {
  const t = useTranslations("Portal.Procurement.rfqlist")
  const tp = useTranslations("Portal.Procurement.rfqpage")
  const locale = useLocale()
  const searching = filter.q.trim().length > 0
  const active = listFilterActive(filter)
  const set = (patch: Partial<RfqListFilter>) => onFilter({ ...filter, ...patch })
  const pick = (view: ListView) => set({ q: "", view })

  const collator = new Intl.Collator(locale === "ar" ? "ar" : "en")
  const options = (rows: Array<[string, number]>, selected: string, label: (k: string) => string) => {
    const shown = rows.filter(([, n]) => n > 0).map(([k, n]) => ({ key: k, text: label(k), n }))
    if (selected && !shown.some((o) => o.key === selected)) shown.push({ key: selected, text: label(selected), n: 0 })
    return shown.sort((a, b) => collator.compare(a.text, b.text))
  }
  const sites = options(facets.sites, filter.site, siteLabel)
  const categories = options(facets.categories, filter.category, categoryLabel)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("status_label")}>
          {CHIPS.filter((c) => c !== "cancelled" || counts.cancelled > 0 || filter.view === "cancelled").map((chip) => (
            <Chip key={chip} selected={filter.view === chip && !searching} count={counts[chip]} onClick={() => pick(chip)}>
              {t(`seg.${chip}`)}
            </Chip>
          ))}
          {(counts.draft > 0 || filter.view === "draft") && (
            <Chip selected={filter.view === "draft" && !searching} count={counts.draft} icon={Pencil} onClick={() => pick("draft")}>
              {t("seg.draft")}
            </Chip>
          )}
        </div>
        <div className="ms-auto flex gap-1" role="group" aria-label={t("layout_label")}>
          {LIST_LAYOUTS.map((l) => (
            <Chip key={l} selected={layout === l} icon={l === "rows" ? List : LayoutGrid} onClick={() => onLayout(l)}>
              {t(l)}
            </Chip>
          ))}
        </div>
      </div>

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
        <NativeSelect aria-label={t("all_sites")} value={filter.site} onChange={(e) => set({ site: e.target.value })} className={cn("w-full min-w-0 sm:w-auto sm:max-w-[14rem]", filter.site && "border-module text-module")}>
          <option value="">{t("all_sites")}</option>
          {sites.map((o) => (
            <option key={o.key} value={o.key}>{`${o.text} · ${o.n}`}</option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t("all_categories")} value={filter.category} onChange={(e) => set({ category: e.target.value })} className={cn("w-full min-w-0 sm:w-auto sm:max-w-[14rem]", filter.category && "border-module text-module")}>
          <option value="">{t("all_categories")}</option>
          {categories.map((o) => (
            <option key={o.key} value={o.key}>{`${o.text} · ${o.n}`}</option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t("all_reaches")} value={filter.reach} onChange={(e) => set({ reach: e.target.value as ListReach | "" })} className={cn("w-full min-w-0 sm:w-auto", filter.reach && "border-module text-module")}>
          <option value="">{t("all_reaches")}</option>
          {LIST_REACHES.map((r) => (
            <option key={r} value={r}>{`${tp(`audience.${r}`)} · ${facets.reaches.find(([k]) => k === r)?.[1] ?? 0}`}</option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t("sort_label")} value={filter.sort} onChange={(e) => set({ sort: e.target.value as ListSort })} className="w-full min-w-0 sm:w-auto">
          {LIST_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`sort_${s}`)}
            </option>
          ))}
        </NativeSelect>
        <span className="text-xs tabular-nums text-muted-foreground" role="status">
          {t("count", { matched, total })}
        </span>
        {active && (
          <button type="button" onClick={() => onFilter({ ...filter, q: "", site: "", category: "", reach: "" })} className="inline-flex items-center gap-1 rounded text-xs font-semibold text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X size={12} aria-hidden="true" />
            {t("clear")}
          </button>
        )}
      </div>
    </div>
  )
}
