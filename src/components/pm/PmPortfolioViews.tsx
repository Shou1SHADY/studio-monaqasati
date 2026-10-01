"use client"

// The portfolio's table, archive table and multi-select filters (the PM 1.0
// prototype's portTable, archTable and fdrop/fbar). Money columns appear only
// for holders of money.

import { useEffect } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, ChevronDown, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { LIFECYCLE_TONE, ProgressLine, projectHref } from "@/components/pm/PmProjectCard"
import { usePortfolioFeed, type PortfolioFeed, type PortfolioProject } from "@/hooks/usePortfolioFeed"
import { useRouter } from "@/i18n/routing"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { costOf, marginOf, type FilterSelection, type PortfolioFilter, type PortfolioRow } from "@/lib/pm/portfolio"
import { displayDocNumber } from "@/lib/sales-numbering"
import { cn } from "@/lib/utils"

const rowClick = (go: () => void) => ({
  role: "link" as const,
  tabIndex: 0,
  onClick: go,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      go()
    }
  },
  className: "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
})

function PortfolioRowView({ project, money, onFeed }: { project: PortfolioProject; money: boolean; onFeed: (id: string, f: PortfolioFeed) => void }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const router = useRouter()
  const feed = usePortfolioFeed(project)
  const lifecycle = lifecycleOf(project as { pm?: { lifecycle?: string }; status?: string })
  const value = project.budget ?? 0
  useEffect(() => onFeed(project.id, feed), [onFeed, project.id, feed])
  return (
    <TableRow {...rowClick(() => router.push(projectHref(project)))}>
      <TableCell className="sticky start-0 max-w-[260px] bg-card">
        <p className="truncate text-sm font-bold" dir="auto">
          {project.name || "—"}
        </p>
        <p className="truncate text-xs text-muted-foreground" dir="auto">
          {[project.pm?.no ? displayDocNumber(project.pm.no, locale) : null, project.clientName].filter(Boolean).join(" · ")}
        </p>
      </TableCell>
      <TableCell>
        <StatusPill tone={LIFECYCLE_TONE[lifecycle]}>{t(`lifecycle.${lifecycle}`)}</StatusPill>
      </TableCell>
      <TableCell className="min-w-[160px]">
        <ProgressLine feed={feed} />
      </TableCell>
      {money && (
        <>
          <TableCell className="text-end text-sm tabular-nums" dir="ltr">
            {value > 0 ? pmMoney(value) : "—"}
          </TableCell>
          <TableCell className={cn("text-end text-sm tabular-nums", feed.unbilled > 50_000 && "font-bold text-destructive")} dir="ltr">
            {pmMoney(feed.unbilled)}
          </TableCell>
          <TableCell className={cn("text-end text-sm tabular-nums", feed.cash < 0 ? "text-destructive" : "text-success")} dir="ltr">
            {pmMoney(feed.cash)}
          </TableCell>
        </>
      )}
      <TableCell className="text-center">{feed.red ? <StatusPill tone="bad">{feed.red}</StatusPill> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
    </TableRow>
  )
}

export function PmPortfolioTable({ projects, money, onFeed }: { projects: PortfolioProject[]; money: boolean; onFeed: (id: string, f: PortfolioFeed) => void }) {
  const t = useTranslations("Portal.PM")
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky start-0 bg-card text-start">{t("list.col_project")}</TableHead>
            <TableHead className="text-start">{t("list.col_status")}</TableHead>
            <TableHead className="text-start">{t("list.col_progress")}</TableHead>
            {money && (
              <>
                <TableHead className="text-end">{t("list.contract_value")}</TableHead>
                <TableHead className="text-end">{t("list.unbilled")}</TableHead>
                <TableHead className="text-end">{t("list.cash")}</TableHead>
              </>
            )}
            <TableHead className="text-center">{t("list.col_alerts")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((p) => (
            <PortfolioRowView key={p.id} project={p} money={money} onFeed={onFeed} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function PmArchiveTable({ rows, money, kindLabel, managerLabel, shown, onMore }: { rows: PortfolioRow[]; money: boolean; kindLabel: (k: string | null) => string; managerLabel: (r: PortfolioRow) => string; shown: number; onMore: () => void }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const router = useRouter()
  const page = rows.slice(0, shown)
  const left = rows.length - page.length
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky start-0 bg-card text-start">{t("list.arch.no")}</TableHead>
              <TableHead className="text-start">{t("list.arch.project")}</TableHead>
              <TableHead className="text-start">{t("list.arch.kind")}</TableHead>
              <TableHead className="text-start">{t("list.arch.region")}</TableHead>
              {money && <TableHead className="text-end">{t("list.contract_value")}</TableHead>}
              {money && <TableHead className="text-end">{t("list.arch.cost")}</TableHead>}
              {money && <TableHead className="text-end">{t("list.arch.margin")}</TableHead>}
              <TableHead className="text-center">{t("list.arch.duration")}</TableHead>
              <TableHead className="text-start">{t("list.arch.closed")}</TableHead>
              {money && <TableHead className="text-end">{t("list.arch.retention")}</TableHead>}
              <TableHead className="text-start">{t("list.arch.manager")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.map((r) => {
              const m = marginOf(r.fin)
              const late = r.fin?.delayDays ?? 0
              return (
                <TableRow key={r.id} {...rowClick(() => router.push(`/contractor/projects/${r.id}?tab=pmToday`))}>
                  <TableCell className="sticky start-0 bg-card text-xs font-bold tabular-nums">{r.noDisplay ?? "—"}</TableCell>
                  <TableCell className="max-w-[240px]">
                    <p className="truncate text-sm font-bold" dir="auto">
                      {r.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground" dir="auto">
                      {r.client ?? "—"}
                    </p>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{kindLabel(r.kind)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground" dir="auto">
                    {r.region ?? "—"}
                  </TableCell>
                  {money && (
                    <TableCell className="text-end text-sm tabular-nums" dir="ltr">
                      {pmMoney(r.fin?.contractValue ?? r.value)}
                    </TableCell>
                  )}
                  {money && (
                    <TableCell className="text-end text-sm tabular-nums" dir="ltr">
                      {costOf(r.fin) != null ? pmMoney(costOf(r.fin) as number) : "—"}
                    </TableCell>
                  )}
                  {money && (
                    <TableCell className="text-end">
                      {m ? (
                        <>
                          <StatusPill tone={m.pct > 12 ? "ok" : m.pct > 7 ? "warn" : "bad"}>
                            <span dir="ltr">{m.pct}%</span>
                          </StatusPill>
                          <p className="text-[11px] tabular-nums text-muted-foreground" dir="ltr">
                            {pmMoney(m.amount)}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground" title={t("list.arch.cost_pending")}>
                          —
                        </span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-center">
                    <span className="text-sm font-semibold tabular-nums">{r.fin?.actualDays ?? "—"}</span>
                    <span className="text-xs tabular-nums text-muted-foreground"> / {r.fin?.contractDays ?? "—"}</span>
                    <div className="mt-0.5">
                      {late > 0 ? <StatusPill tone="bad">{t("list.arch.late", { count: late })}</StatusPill> : r.fin?.actualDays != null ? <StatusPill tone="ok">{t("list.arch.on_time")}</StatusPill> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{pmDate(r.fin?.closedOn, locale)}</TableCell>
                  {money && (
                    <TableCell className="text-end text-sm tabular-nums" dir="ltr">
                      {pmMoney(r.fin?.retentionHeld ?? 0)}
                    </TableCell>
                  )}
                  <TableCell className="text-xs text-muted-foreground" dir="auto">
                    {managerLabel(r)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {left > 0 && (
        <button type="button" onClick={onMore} className="w-full border-t py-3 text-sm font-semibold text-module hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          {t("list.arch.more", { n: Math.min(12, left), left })}
        </button>
      )}
    </div>
  )
}

export function PmFilterDropdown({
  label,
  options,
  selected,
  optionLabel,
  onToggle,
  onClear,
}: {
  label: string
  options: string[]
  selected: string[]
  optionLabel: (v: string) => string
  onToggle: (v: string) => void
  onClear: () => void
}) {
  const t = useTranslations("Portal.PM")
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected.length ? "border-module bg-module/10 text-module" : "bg-card hover:border-module/40"
          )}
        >
          {label}
          {selected.length > 0 && <span className="rounded-full bg-module px-1.5 text-[11px] tabular-nums text-module-foreground">{selected.length}</span>}
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        {options.length === 0 && <p className="p-2 text-xs text-muted-foreground">{t("list.no_options")}</p>}
        <div className="max-h-64 overflow-y-auto">
          {options.map((o) => {
            const on = selected.includes(o)
            return (
              <button
                key={o}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => onToggle(o)}
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-module bg-module text-module-foreground" : "border-input")}>{on && <Check size={11} aria-hidden="true" />}</span>
                <span className="truncate" dir="auto">
                  {optionLabel(o)}
                </span>
              </button>
            )
          })}
        </div>
        {selected.length > 0 && (
          <div className="border-t p-1">
            <button type="button" onClick={onClear} className="w-full rounded-md px-2 py-1.5 text-start text-xs font-semibold text-destructive hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("list.clear")}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function PmFilterBar({ keys, sel, optionLabel, onToggle, onClearAll }: { keys: PortfolioFilter[]; sel: FilterSelection; optionLabel: (k: PortfolioFilter, v: string) => string; onToggle: (k: PortfolioFilter, v: string) => void; onClearAll: () => void }) {
  const t = useTranslations("Portal.PM")
  const chips = keys.flatMap((k) => (sel[k] ?? []).map((v) => ({ k, v })))
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map(({ k, v }) => (
        <span key={`${k}:${v}`} className="inline-flex items-center gap-1 rounded-full border border-module/30 bg-module/5 py-0.5 pe-1 ps-2.5 text-xs font-semibold">
          <span dir="auto">{optionLabel(k, v)}</span>
          <button type="button" onClick={() => onToggle(k, v)} aria-label={t("list.remove_filter", { name: optionLabel(k, v) })} className="grid h-5 w-5 place-items-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X size={11} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClearAll} className="rounded px-1.5 text-xs font-semibold text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("list.clear_all")}
      </button>
    </div>
  )
}
