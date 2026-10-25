"use client"

// The portfolio's table, archive table and multi-select filters (the PM 1.0
// prototype's portTable, archTable and fdrop/fbar). Money columns stay for
// everyone; without money their amounts read «•••» (the prototype's money()).

import { ShowMoreRow } from "@/components/module-ui/ShowMoreRow"
import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, ChevronDown, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { LIFECYCLE_TONE, ProgressLine, projectHref } from "@/components/pm/PmProjectCard"
import { usePortfolioFeed, type PortfolioFeed, type PortfolioProject } from "@/hooks/usePortfolioFeed"
import { useTableLabels } from "@/hooks/useTableLabels"
import { Link, useRouter } from "@/i18n/routing"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { costOf, marginOf, type FilterSelection, type PortfolioFilter, type PortfolioRow } from "@/lib/pm/portfolio"
import { displayDocNumber } from "@/lib/sales-numbering"
import { cn } from "@/lib/utils"

const mask = (money: boolean, v: number) => (money ? pmMoney(v) : "•••")

/** Reads one project's feed for the table (a hook per project) and hands it up — renders nothing. */
function FeedProbe({ project, onFeed }: { project: PortfolioProject; onFeed: (id: string, f: PortfolioFeed) => void }) {
  const feed = usePortfolioFeed(project)
  useEffect(() => onFeed(project.id, feed), [onFeed, project.id, feed])
  return null
}

const nameLink = "rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

// PM 1.1 UX-12: the portfolio and archive tables are module-ui DataTables — the header stays in view, secondary
// columns step aside on a narrow desktop (never Status), and a phone gets a card per project instead of a sideways
// scroll. The whole row opens the project; the name is the real link for the keyboard.
export function PmPortfolioTable({ projects, money, onFeed }: { projects: PortfolioProject[]; money: boolean; onFeed: (id: string, f: PortfolioFeed) => void }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const router = useRouter()
  const labels = useTableLabels()
  const [feeds, setFeeds] = useState<Record<string, PortfolioFeed>>({})
  const take = useCallback(
    (id: string, f: PortfolioFeed) => {
      setFeeds((prev) => (prev[id] === f ? prev : { ...prev, [id]: f }))
      onFeed(id, f)
    },
    [onFeed]
  )
  const columns: DataColumn<PortfolioProject>[] = [
    {
      key: "project",
      header: t("list.col_project"),
      cell: (p) => (
        <div className="min-w-0 max-w-[260px]">
          <Link href={projectHref(p)} className={cn("block truncate text-sm font-bold", nameLink)} dir="auto">
            {p.name || "—"}
          </Link>
          <p className="truncate text-xs text-muted-foreground" dir="auto">
            {[p.pm?.no ? displayDocNumber(p.pm.no, locale) : null, p.clientName].filter(Boolean).join(" · ")}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: t("list.col_status"),
      cell: (p) => {
        const lifecycle = lifecycleOf(p as { pm?: { lifecycle?: string }; status?: string })
        return <StatusPill tone={LIFECYCLE_TONE[lifecycle]}>{t(`lifecycle.${lifecycle}`)}</StatusPill>
      },
    },
    { key: "progress", header: t("list.col_progress"), className: "min-w-40", cell: (p) => (feeds[p.id] ? <ProgressLine feed={feeds[p.id]} /> : "—") },
    {
      key: "value",
      header: t("list.contract_value"),
      numeric: true,
      sortValue: money ? (p) => feeds[p.id]?.contract ?? null : undefined,
      cell: (p) => {
        const v = feeds[p.id]?.contract ?? 0
        return v > 0 ? mask(money, v) : "—"
      },
    },
    {
      key: "unbilled",
      header: t("list.unbilled"),
      numeric: true,
      hideBelow: "lg",
      sortValue: money ? (p) => feeds[p.id]?.unbilled ?? null : undefined,
      cell: (p) => {
        const f = feeds[p.id]
        return <span className={cn(money && (f?.unbilled ?? 0) > 50_000 && "font-bold text-destructive")}>{mask(money, f?.unbilled ?? 0)}</span>
      },
    },
    {
      key: "cash",
      header: t("list.cash"),
      numeric: true,
      hideBelow: "lg",
      cell: (p) => {
        const f = feeds[p.id]
        return <span className={cn(money && f && (f.cash < 0 ? "text-destructive" : "text-success"))}>{mask(money, f?.cash ?? 0)}</span>
      },
    },
    { key: "alerts", header: t("list.col_alerts"), cell: (p) => (feeds[p.id]?.red ? <StatusPill tone="bad">{feeds[p.id].red}</StatusPill> : <span className="text-xs text-muted-foreground">—</span>) },
  ]
  return (
    <>
      {projects.map((p) => (
        <FeedProbe key={p.id} project={p} onFeed={take} />
      ))}
      <DataTable columns={columns} rows={projects} rowKey={(p) => p.id} caption={t("list.col_project")} labels={labels} empty={null} onRowClick={(p) => router.push(projectHref(p))} />
    </>
  )
}

export function PmArchiveTable({ rows, money, kindLabel, managerLabel, shown, onMore }: { rows: PortfolioRow[]; money: boolean; kindLabel: (k: string | null) => string; managerLabel: (r: PortfolioRow) => string; shown: number; onMore: () => void }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const router = useRouter()
  const labels = useTableLabels()
  const page = rows.slice(0, shown)
  const left = rows.length - page.length
  const href = (r: PortfolioRow) => `/contractor/projects/${r.id}?tab=pmToday`
  const columns: DataColumn<PortfolioRow>[] = [
    { key: "no", header: t("list.arch.no"), cell: (r) => <bdi className="text-xs font-bold tabular-nums">{r.noDisplay ?? "—"}</bdi> },
    {
      key: "project",
      header: t("list.arch.project"),
      cell: (r) => (
        <div className="min-w-0 max-w-[240px]">
          <Link href={href(r)} className={cn("block truncate text-sm font-bold", nameLink)} dir="auto">
            {r.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground" dir="auto">
            {r.client ?? "—"}
          </p>
        </div>
      ),
    },
    { key: "kind", header: t("list.arch.kind"), hideBelow: "xl", cell: (r) => <span className="text-xs text-muted-foreground">{kindLabel(r.kind)}</span> },
    {
      key: "region",
      header: t("list.arch.region"),
      hideBelow: "xl",
      cell: (r) => (
        <span className="text-xs text-muted-foreground" dir="auto">
          {r.region ?? "—"}
        </span>
      ),
    },
    { key: "value", header: t("list.contract_value"), numeric: true, cell: (r) => mask(money, r.fin?.contractValue ?? r.value) },
    { key: "cost", header: t("list.arch.cost"), numeric: true, hideBelow: "lg", cell: (r) => (costOf(r.fin) != null ? mask(money, costOf(r.fin) as number) : "—") },
    {
      key: "margin",
      header: t("list.arch.margin"),
      className: "text-end",
      cell: (r) => {
        const m = marginOf(r.fin)
        return !money ? (
          <span className="text-sm tabular-nums text-muted-foreground">•••</span>
        ) : m ? (
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
        )
      },
    },
    {
      key: "duration",
      header: t("list.arch.duration"),
      cell: (r) => {
        const late = r.fin?.delayDays ?? 0
        return (
          <>
            <span className="text-sm font-semibold tabular-nums">{r.fin?.actualDays ?? "—"}</span>
            <span className="text-xs tabular-nums text-muted-foreground"> / {r.fin?.contractDays ?? "—"}</span>
            <div className="mt-0.5">
              {late > 0 ? <StatusPill tone="bad">{t("list.arch.late", { count: late })}</StatusPill> : r.fin?.actualDays != null ? <StatusPill tone="ok">{t("list.arch.on_time")}</StatusPill> : null}
            </div>
          </>
        )
      },
    },
    { key: "closed", header: t("list.arch.closed"), hideBelow: "lg", cell: (r) => <span className="text-xs text-muted-foreground">{pmDate(r.fin?.closedOn, locale)}</span> },
    { key: "retention", header: t("list.arch.retention"), numeric: true, hideBelow: "xl", cell: (r) => mask(money, r.fin?.retentionHeld ?? 0) },
    {
      key: "manager",
      header: t("list.arch.manager"),
      hideBelow: "xl",
      cell: (r) => (
        <span className="text-xs text-muted-foreground" dir="auto">
          {managerLabel(r)}
        </span>
      ),
    },
  ]
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <DataTable columns={columns} rows={page} rowKey={(r) => r.id} caption={t("list.arch.project")} labels={labels} bordered={false} empty={null} cardTitleKey="project" onRowClick={(r) => router.push(href(r))} />
      {left > 0 && (
        <ShowMoreRow onClick={onMore}>
          {t("list.arch.more", { n: Math.min(12, left), left })}
        </ShowMoreRow>
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
