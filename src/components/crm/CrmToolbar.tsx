"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Check, ChevronDown, ListFilter, Search, SlidersHorizontal, User, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { CrmListConfig, CrmListState } from "@/hooks/useCrmListState"

/**
 * The control surface every CRM list shares.
 *
 * Deliberately three controls wide, not nine. An earlier version put every
 * facet on the bar as its own dropdown — four filters, a grouping menu, a
 * density toggle, saved views and a search box all competing on one row, which
 * on a laptop wrapped into a second row of chrome above the actual data and on
 * a phone was unusable. Filtering now lives behind one button that carries a
 * count, view preferences behind another, and the row a person reads first —
 * the segments — sits on its own line where it belongs.
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

  const activeViewLabel = config.savedViews.find((v) => v.key === state.activeView)?.label
  const activeGroupLabel = config.groups?.find((g) => g.key === state.group)?.label
  // One number for everything narrowing the list, so the button says how much
  // is hidden without the user opening it.
  const filterCount = state.activeChips.length + (state.mineOnly ? 1 : 0)

  return (
    <div className="space-y-3">
      {/* Segments — the coarse cut, and the thing people reach for first.
          Scrolls rather than wraps so it stays one predictable line. */}
      <div className="-mx-1 px-1 overflow-x-auto">
        <div className="flex w-max min-w-full rounded-lg border p-0.5 gap-0.5">
          {config.segments.map((seg) => (
            <button
              key={seg.key}
              type="button"
              onClick={() => state.setSegment(seg.key)}
              aria-pressed={state.segment === seg.key}
              className={cn(
                "flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap",
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
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
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

        <div className="flex items-center gap-2 shrink-0">
          {config.savedViews.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-10 gap-1.5 max-w-[180px]">
                  <ListFilter size={14} className="shrink-0" />
                  <span className="truncate">{activeViewLabel ?? t("crm_saved_views")}</span>
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

          {/* Every facet behind one button. The badge is what makes this
              honest: a filtered list never looks unfiltered. */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant={filterCount > 0 ? "secondary" : "outline"} size="sm" className="h-10 gap-1.5">
                <SlidersHorizontal size={14} />
                <span className="hidden sm:inline">{t("crm_filters")}</span>
                {filterCount > 0 && (
                  <span className="rounded-full bg-primary/15 text-primary px-1.5 text-[10px] font-bold" dir="ltr">
                    {filterCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0 max-h-[70vh] overflow-y-auto">
              {config.isMine && (
                <div className="p-1 border-b">
                  <OptionRow
                    label={t("crm_mine_only")}
                    selected={state.mineOnly}
                    onSelect={() => state.setMineOnly(!state.mineOnly)}
                    icon={<User size={13} className="shrink-0 opacity-60" />}
                  />
                </div>
              )}
              {config.facets.map((facet) => {
                const selected = state.facets[facet.key] ?? []
                return (
                  <div key={facet.key} className="p-1 border-b last:border-b-0">
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <p className="text-[11px] font-bold text-muted-foreground flex-1 truncate">{facet.label}</p>
                      {selected.length > 0 && (
                        <button
                          type="button"
                          onClick={() => state.clearFacet(facet.key)}
                          className="text-[10px] font-semibold text-muted-foreground hover:text-destructive rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {t("crm_clear_filters")}
                        </button>
                      )}
                    </div>
                    {facet.options.map((option) => (
                      <OptionRow
                        key={option.value}
                        label={option.label}
                        selected={selected.includes(option.value)}
                        onSelect={() => state.toggleFacet(facet.key, option.value)}
                      />
                    ))}
                  </div>
                )
              })}
              {filterCount > 0 && (
                <div className="p-1 border-t sticky bottom-0 bg-popover">
                  <Button variant="ghost" size="sm" className="w-full gap-1.5 text-muted-foreground hover:text-destructive" onClick={state.clearAll}>
                    <X size={13} />
                    {t("crm_clear_all_filters")}
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>

          {/* Grouping and density are preferences, not filters — they change
              how the same rows look, so they get their own menu. */}
          {(config.groups?.length || 0) > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={state.group || state.dense ? "secondary" : "outline"}
                  size="sm"
                  className="h-10 gap-1.5"
                  aria-label={t("crm_view_options")}
                >
                  <Rows />
                  <span className="hidden lg:inline truncate max-w-[110px]">
                    {activeGroupLabel ?? t("crm_view_options")}
                  </span>
                  <ChevronDown size={13} className="shrink-0 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-1">
                <p className="px-2 py-1.5 text-[11px] font-bold text-muted-foreground">{t("crm_group_by")}</p>
                <OptionRow label={t("crm_group_none")} selected={!state.group} onSelect={() => state.setGroup("")} />
                {config.groups?.map((g) => (
                  <OptionRow
                    key={g.key}
                    label={g.label}
                    selected={state.group === g.key}
                    onSelect={() => state.setGroup(g.key)}
                  />
                ))}
                <div className="border-t mt-1 pt-1">
                  <OptionRow
                    label={t("crm_density")}
                    selected={state.dense}
                    onSelect={() => state.setDense(!state.dense)}
                  />
                </div>
              </PopoverContent>
            </Popover>
          )}

          {extra}
        </div>
      </div>

      {/* Active filters stay visible outside the popover — otherwise a list
          filtered down to three rows looks like a list with three rows. */}
      {(state.activeChips.length > 0 || state.mineOnly) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {state.mineOnly && (
            <FilterChip label={t("crm_mine_only")} onRemove={() => state.setMineOnly(false)} />
          )}
          {state.activeChips.map((chip) => (
            <FilterChip
              key={`${chip.facetKey}:${chip.value}`}
              label={chip.label}
              onRemove={() => state.toggleFacet(chip.facetKey, chip.value)}
            />
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

/** Three stacked lines — the conventional "view options" glyph. */
function Rows() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const t = useTranslations("Portal.Shared")
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${t("crm_clear_filters")} — ${label}`}
        className="rounded-full text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X size={11} />
      </button>
    </span>
  )
}

function OptionRow({
  label,
  selected,
  onSelect,
  icon,
}: {
  label: string
  selected: boolean
  onSelect: () => void
  icon?: ReactNode
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
      {icon}
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
        "inline-flex items-center gap-1 font-semibold rounded transition-colors whitespace-nowrap",
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
