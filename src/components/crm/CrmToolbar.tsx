"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Check, ChevronDown, Layers, ListFilter, Rows3, Search, User, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { CrmListConfig, CrmListState } from "@/hooks/useCrmListState"

/**
 * The control surface every CRM list shares: saved views, segments with live
 * counts, search, faceted filters with removable chips, grouping, "mine only"
 * and a density toggle.
 *
 * It renders from the same config the state hook consumes, so a page cannot
 * offer a filter the state does not understand — or hold state no control can
 * reach.
 */
export function CrmToolbar<T>({
  config,
  state,
  extra,
}: {
  config: CrmListConfig<T>
  state: CrmListState<T>
  /** Page-specific controls (a board/table switch, for instance). */
  extra?: ReactNode
}) {
  const t = useTranslations("Portal.Shared")
  const activeViewLabel =
    config.savedViews.find((v) => v.key === state.activeView)?.label ?? t("crm_view_custom")
  const activeGroupLabel = config.groups?.find((g) => g.key === state.group)?.label ?? t("crm_group_none")

  return (
    <div className="space-y-3">
      {/* Segments — the coarse cut, with counts that reflect the filters
          currently applied rather than an unfiltered total. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg border p-0.5 gap-0.5">
          {config.segments.map((seg) => (
            <button
              key={seg.key}
              type="button"
              onClick={() => state.setSegment(seg.key)}
              aria-pressed={state.segment === seg.key}
              className={cn(
                "px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                state.segment === seg.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              {seg.label}
              <span
                className={cn(
                  "ms-1.5 rounded-full px-1.5 text-[10px]",
                  state.segment === seg.key ? "bg-white/20" : "bg-muted"
                )}
                dir="ltr"
              >
                {state.segmentCounts[seg.key] ?? 0}
              </span>
            </button>
          ))}
        </div>

        {config.isMine && (
          <Button
            type="button"
            variant={state.mineOnly ? "default" : "outline"}
            size="sm"
            className="gap-1.5 h-9"
            aria-pressed={state.mineOnly}
            onClick={() => state.setMineOnly(!state.mineOnly)}
          >
            <User size={13} />
            {t("crm_mine_only")}
          </Button>
        )}
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
          <Input
            value={state.search}
            onChange={(e) => state.setSearch(e.target.value)}
            placeholder={t("crm_search_placeholder")}
            className="ps-9"
            aria-label={t("crm_search_placeholder")}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {config.savedViews.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-9 max-w-[220px]">
                  <ListFilter size={13} className="shrink-0" />
                  <span className="truncate">{activeViewLabel}</span>
                  <ChevronDown size={13} className="shrink-0 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-1">
                <p className="px-2 py-1.5 text-[11px] font-bold text-muted-foreground">{t("crm_saved_views")}</p>
                {config.savedViews.map((view) => (
                  <OptionRow
                    key={view.key}
                    label={view.label}
                    selected={state.activeView === view.key}
                    onSelect={() => state.applyView(view.key)}
                  />
                ))}
              </PopoverContent>
            </Popover>
          )}

          {config.facets.map((facet) => {
            const selected = state.facets[facet.key] ?? []
            return (
              <Popover key={facet.key}>
                <PopoverTrigger asChild>
                  <Button
                    variant={selected.length > 0 ? "secondary" : "outline"}
                    size="sm"
                    className="gap-1.5 h-9"
                  >
                    {facet.label}
                    {selected.length > 0 && (
                      <span className="rounded-full bg-primary/15 text-primary px-1.5 text-[10px] font-bold" dir="ltr">
                        {selected.length}
                      </span>
                    )}
                    <ChevronDown size={13} className="opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60 p-1 max-h-80 overflow-y-auto">
                  {facet.options.map((option) => (
                    <OptionRow
                      key={option.value}
                      label={option.label}
                      selected={selected.includes(option.value)}
                      onSelect={() => state.toggleFacet(facet.key, option.value)}
                    />
                  ))}
                  {selected.length > 0 && (
                    <button
                      type="button"
                      onClick={() => state.clearFacet(facet.key)}
                      className="mt-1 w-full rounded-md border-t px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t("crm_clear_filters")}
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            )
          })}

          {config.groups && config.groups.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant={state.group ? "secondary" : "outline"} size="sm" className="gap-1.5 h-9 max-w-[200px]">
                  <Layers size={13} className="shrink-0" />
                  <span className="truncate">{activeGroupLabel}</span>
                  <ChevronDown size={13} className="shrink-0 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-1">
                <OptionRow label={t("crm_group_none")} selected={!state.group} onSelect={() => state.setGroup("")} />
                {config.groups.map((g) => (
                  <OptionRow
                    key={g.key}
                    label={g.label}
                    selected={state.group === g.key}
                    onSelect={() => state.setGroup(g.key)}
                  />
                ))}
              </PopoverContent>
            </Popover>
          )}

          <Button
            type="button"
            variant={state.dense ? "secondary" : "outline"}
            size="sm"
            className="gap-1.5 h-9"
            aria-pressed={state.dense}
            onClick={() => state.setDense(!state.dense)}
          >
            <Rows3 size={13} />
            {t("crm_density")}
          </Button>

          {extra}
        </div>
      </div>

      {state.activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {state.activeChips.map((chip) => (
            <span
              key={`${chip.facetKey}:${chip.value}`}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground"
            >
              {chip.label}
              <button
                type="button"
                onClick={() => state.toggleFacet(chip.facetKey, chip.value)}
                aria-label={`${t("crm_clear_filters")} — ${chip.label}`}
                className="rounded-full text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={state.clearAll}
            className="h-7 gap-1 text-muted-foreground hover:text-destructive"
          >
            <X size={12} />
            {t("crm_clear_all_filters")}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t("crm_showing_count", { shown: state.shown, total: state.matching })}
        {state.matching < state.total && ` — ${t("crm_of_total", { total: state.total })}`}
      </p>
    </div>
  )
}

function OptionRow({
  label,
  selected,
  onSelect,
}: {
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
      )}
    >
      <span
        className={cn(
          "grid place-items-center h-4 w-4 shrink-0 rounded border",
          selected ? "bg-primary border-primary text-primary-foreground" : "border-input"
        )}
        aria-hidden="true"
      >
        {selected && <Check size={11} />}
      </span>
      <span className="truncate">{label}</span>
    </button>
  )
}

/** Sortable column header for a CRM table. */
export function CrmSortHeader<T>({
  state,
  sortKey,
  label,
  className,
}: {
  state: CrmListState<T>
  sortKey: string
  label: string
  className?: string
}) {
  const active = state.sort.key === sortKey
  return (
    <button
      type="button"
      onClick={() => state.toggleSort(sortKey)}
      aria-sort={active ? (state.sort.direction === 1 ? "ascending" : "descending") : "none"}
      className={cn(
        "inline-flex items-center gap-1 font-semibold rounded transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {label}
      <span aria-hidden="true" className={cn("text-[9px]", !active && "opacity-30")}>
        {active && state.sort.direction === -1 ? "▼" : "▲"}
      </span>
    </button>
  )
}

/** "Show more" footer — progressive disclosure instead of rendering
 * everything an organization has ever recorded. */
export function CrmShowMore<T>({ state }: { state: CrmListState<T> }) {
  const t = useTranslations("Portal.Shared")
  if (!state.hasMore) return null
  return (
    <div className="p-3 border-t">
      <Button variant="outline" size="sm" className="w-full" onClick={state.showMore}>
        {t("crm_show_more", { count: state.matching - state.shown })}
      </Button>
    </div>
  )
}
