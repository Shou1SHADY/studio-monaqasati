"use client"

// Project Management's portfolio (the PM 1.0 prototype's «المشاريع» view): the
// state chips (الكل never includes the archive, which is a view of its own),
// multi-select filters with their chip bar, a search by name · number · client ·
// region with «N من M», cards or a table for projects in play, and the archive's
// dense table of frozen figures with its sort, CSV and paging. Only projects the
// viewer may see are listed (pmSeesProject via usePmVisibleProjects).

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Activity, ArrowDownUp, Coins, Download, FolderKanban, FolderOpen, LayoutGrid, List, Loader2, PlusCircle, Search, TrendingUp } from "lucide-react"
import { collection, query, where } from "firebase/firestore"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { ModuleHeader, type ModuleKpi } from "@/components/module-ui/ModuleHeader"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { PmProjectCard } from "@/components/pm/PmProjectCard"
import { PmArchiveTable, PmFilterBar, PmFilterDropdown, PmPortfolioTable } from "@/components/pm/PmPortfolioViews"
import { PmSeatChip } from "@/components/pm/PmSeatChip"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { usePmAccess } from "@/hooks/usePmAccess"
import { usePmRail } from "@/hooks/usePmRail"
import { usePmVisibleProjects } from "@/hooks/usePmVisibleProjects"
import type { PortfolioFeed, PortfolioProject } from "@/hooks/usePortfolioFeed"
import { Link } from "@/i18n/routing"
import { pmMoney, todayDay } from "@/lib/pm/format"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import {
  activeFilters,
  ARCHIVE_PAGE,
  ARCHIVE_SORTS,
  archiveCsvRows,
  archiveKpis,
  filterOptions,
  filtersFor,
  PORTFOLIO_STATES,
  portfolioCounts,
  portfolioList,
  sortArchive,
  toCsv,
  toggleOption,
  type ArchiveSort,
  type FilterSelection,
  type PortfolioFilter,
  type PortfolioRow,
  type PortfolioState,
} from "@/lib/pm/portfolio"
import { displayDocNumber } from "@/lib/sales-numbering"
import { cn } from "@/lib/utils"

type ViewMode = "grid" | "table"
const VIEW_MODE_STORAGE_KEY = "contractor_projects_view_mode"
type SortOption = "newest" | "oldest" | "budget_desc" | "budget_asc" | "name_asc"

function getTimeMs(v: unknown): number {
  if (!v) return 0
  if (typeof v === "object" && v !== null && "toDate" in v) return (v as { toDate: () => Date }).toDate().getTime()
  const parsed = new Date(v as string | number).getTime()
  return isNaN(parsed) ? 0 : parsed
}

const feedSig = (f: PortfolioFeed) => `${f.ready}|${f.progress}|${f.planned}|${f.behind}|${f.budget}`

export default function ProjectsListPage() {
  const t = useTranslations("Portal.Contractor")
  const tPm = useTranslations("Portal.PM")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const { user, isUserLoading } = useUser()
  const { profile } = usePermissions()
  const portfolio = usePmAccess(undefined, null)
  const money = portfolio.has("money")
  const [st, setSt] = useState<PortfolioState>("all")
  const [sel, setSel] = useState<FilterSelection>({})
  const [q, setQ] = useState("")
  const [sortBy, setSortBy] = useState<SortOption>("newest")
  const [archSort, setArchSort] = useState<ArchiveSort>("d")
  const [shown, setShown] = useState(ARCHIVE_PAGE)
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [feeds, setFeeds] = useState<Record<string, PortfolioFeed>>({})
  const onFeed = useCallback((id: string, f: PortfolioFeed) => setFeeds((prev) => (prev[id] && feedSig(prev[id]) === feedSig(f) ? prev : { ...prev, [id]: f })), [])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)
      if (stored === "grid" || stored === "table") setViewMode(stored)
    } catch {
      /* storage blocked */
    }
  }, [])
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode)
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
    } catch {
      /* storage blocked */
    }
  }

  const orgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid
  const projectsQuery = useMemoFirebase(() => (isUserLoading || !firestore || !orgId ? null : query(collection(firestore, "projects"), where("organizationId", "==", orgId))), [firestore, isUserLoading, orgId])
  const { data: allProjects, isLoading: projectsLoading } = useCollection(projectsQuery)
  const orgProjects = useMemo(() => (allProjects || []) as unknown as PortfolioProject[], [allProjects])
  const { visible: typedProjects, isLoading: visibilityLoading } = usePmVisibleProjects(orgProjects)
  const rail = usePmRail()

  const rows = useMemo<Array<PortfolioRow & { createdMs: number }>>(
    () =>
      typedProjects.map((p) => ({
        id: p.id,
        no: p.pm?.no ?? null,
        noDisplay: p.pm?.no ? displayDocNumber(p.pm.no, locale) : null,
        name: p.name || "—",
        client: p.clientName ?? null,
        kind: p.pm?.kind ?? p.projectType ?? null,
        region: p.region || p.location || null,
        managerId: p.projectManagerId ?? null,
        managerName: p.projectManagerName ?? null,
        lifecycle: lifecycleOf(p as { pm?: { lifecycle?: string }; status?: string }),
        value: p.budget ?? 0,
        fin: p.pm?.fin ?? null,
        createdMs: getTimeMs(p.createdAt),
      })),
    [typedProjects, locale]
  )
  const byId = useMemo(() => new Map(typedProjects.map((p) => [p.id, p])), [typedProjects])
  const counts = portfolioCounts(rows)
  const arch = st === "arch"
  const keys = filtersFor(st)
  const filtered = portfolioList(rows, { st, sel, q })
  const list = arch
    ? sortArchive(filtered, archSort)
    : filtered.slice().sort((a, b) => {
        switch (sortBy) {
          case "oldest":
            return a.createdMs - b.createdMs
          case "budget_desc":
            return b.value - a.value
          case "budget_asc":
            return a.value - b.value
          case "name_asc":
            return a.name.localeCompare(b.name, isRtl ? "ar" : "en")
          default:
            return b.createdMs - a.createdMs
        }
      })
  const listProjects = list.map((r) => byId.get(r.id)).filter((p): p is PortfolioProject => Boolean(p))

  const kindLabel = (k: string | null) => (k && ["bld", "infra", "road", "ind", "mep", "mnt", "own"].includes(k) ? tShared(`pm_kind_${k}`) : k || "—")
  const managerLabel = (r: PortfolioRow) => r.managerName || "—"
  const managerNames = useMemo(() => new Map(rows.map((r) => [r.managerId ?? "", r.managerName ?? "—"])), [rows])
  const optionLabel = (k: PortfolioFilter, v: string) => (k === "kind" ? kindLabel(v) : k === "pm" ? managerNames.get(v) || "—" : v)

  const pickState = (next: PortfolioState) => {
    setSt(next)
    setShown(ARCHIVE_PAGE)
    if (next !== "arch" && archSort === "m") setArchSort("d")
  }
  const clearAll = () => {
    setSel({})
    setQ("")
  }

  const exportCsv = () => {
    const head = ["no", "project", "client", "kind", "region", "contract", "cost", "margin", "actual_days", "contract_days", "closed", "manager"].map((h) => tPm(`list.csv.${h}`))
    const csv = toCsv([head, ...archiveCsvRows(list, { kind: kindLabel, manager: managerLabel })])
    try {
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `mdmak-archive-${todayDay()}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (err) {
      console.error(err)
    }
    toast({ title: tPm("list.csv_done", { count: list.length }) })
  }

  // KPIs: projects in play from their feeds; the archive from its frozen figures.
  const kpis: ModuleKpi[] = (() => {
    if (arch) {
      const k = archiveKpis(list, counts.arch)
      const countKpi: ModuleKpi = { id: "count", label: tPm("list.kpi_archived"), value: String(k.count), note: k.count < k.of ? tPm("list.kpi_archived_of", { of: k.of }) : tPm("list.kpi_archived_all"), tone: "neutral", icon: FolderKanban }
      const late: ModuleKpi = { id: "late", label: tPm("list.kpi_overran"), value: String(k.late), note: tPm("list.kpi_overran_note", { late: k.late, count: k.count }), tone: k.late ? "warn" : "good", icon: Activity }
      if (!money) return [countKpi, late]
      return [
        countKpi,
        { id: "value", label: tPm("list.kpi_arch_value"), value: pmMoney(k.value), note: k.cost !== null ? tPm("list.kpi_at_cost", { cost: pmMoney(k.cost) }) : tPm("list.kpi_cost_pending"), tone: "neutral", icon: Coins },
        {
          id: "margin",
          label: tPm("list.kpi_margin"),
          value: k.marginPct !== null ? `${k.marginPct}%` : "—",
          note: tPm("list.kpi_overran_note", { late: k.late, count: k.count }),
          tone: k.marginPct !== null && k.marginPct > 9 ? "good" : "warn",
          icon: TrendingUp,
        },
      ]
    }
    const withProgress = list.map((r) => feeds[r.id]).filter((f): f is PortfolioFeed => Boolean(f) && f.progress !== null)
    const avg = withProgress.length ? withProgress.reduce((a, f) => a + (f.progress ?? 0), 0) / withProgress.length : 0
    const behind = list.filter((r) => (feeds[r.id]?.planned ?? null) !== null && (feeds[r.id]?.behind ?? 0) > 4).length
    const budget = list.reduce((a, r) => a + (feeds[r.id]?.budget ?? 0), 0)
    const stateLabel = st === "all" ? tPm("list.chip_all") : tPm(`list.chip.${st}`)
    return [
      { id: "shown", label: tPm("list.kpi_shown"), value: String(list.length), note: stateLabel, tone: "neutral", icon: FolderKanban },
      ...(money
        ? [{ id: "value", label: tPm("list.kpi_value"), value: pmMoney(list.reduce((a, r) => a + r.value, 0)), note: budget > 0 ? tPm("list.kpi_at_budget", { budget: pmMoney(budget) }) : tPm("list.kpi_no_budget"), tone: "neutral" as const, icon: Coins }]
        : []),
      { id: "progress", label: tPm("list.kpi_progress"), value: `${Math.round(avg)}%`, note: tPm("list.kpi_behind", { count: behind }), tone: behind ? ("warn" as const) : ("good" as const), icon: TrendingUp },
    ]
  })()

  const census = tPm("list.census", { live: counts.live, hold: counts.hold, done: counts.done, closed: counts.arch })
  const pageLoading = isUserLoading || ((projectsLoading || visibilityLoading) && !allProjects)
  const canCreate = portfolio.has("create")
  const sortOptions: { value: SortOption; label: string }[] = [
    { value: "newest", label: t("proj_sort_newest") },
    { value: "oldest", label: t("proj_sort_oldest") },
    { value: "budget_desc", label: t("proj_sort_budget_desc") },
    { value: "budget_asc", label: t("proj_sort_budget_asc") },
    { value: "name_asc", label: t("proj_sort_name") },
  ]

  return (
    <PortalLayout>
      <div className="space-y-5">
        <ModuleHeader
          status={<PmSeatChip />}
          icon={FolderKanban}
          title={t("proj_title")}
          description={census}
          actions={
            canCreate && (
              <Button asChild className="gap-2 rounded-xl bg-module text-module-foreground hover:bg-module/90">
                <Link href="/contractor/projects/new">
                  <PlusCircle size={16} />
                  {tPm("list.new_project")}
                </Link>
              </Button>
            )
          }
          kpisLabel={t("proj_title")}
          kpis={kpis}
          tabs={rail.tabs}
          activeTab="projects"
          tabsLabel={t("proj_title")}
        />

        <ProcChipGroup
          items={PORTFOLIO_STATES.map((c) => ({ id: c, label: c === "all" ? tPm("list.chip_all") : tPm(`list.chip.${c}`), count: counts[c] }))}
          active={st}
          onPick={pickState}
          label={t("proj_title")}
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tPm("list.search_ph")} aria-label={tPm("list.search_ph")} className="h-10 rounded-xl ps-9" dir="auto" />
          </div>
          {keys.map((k) => (
            <PmFilterDropdown
              key={k}
              label={tPm(`list.filter.${k}`)}
              options={filterOptions(rows, st, k)}
              selected={sel[k] ?? []}
              optionLabel={(v) => optionLabel(k, v)}
              onToggle={(v) => setSel((s) => toggleOption(s, k, v))}
              onClear={() => setSel((s) => ({ ...s, [k]: [] }))}
            />
          ))}
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {arch ? (
              <Select value={archSort} onValueChange={(v) => setArchSort(v as ArchiveSort)}>
                <SelectTrigger className="h-10 w-auto gap-1.5 rounded-xl" aria-label={tPm("list.sort_label")}>
                  <ArrowDownUp size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ARCHIVE_SORTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tPm(`list.sort.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                <SelectTrigger className="h-10 w-auto gap-1.5 rounded-xl" aria-label={tPm("list.sort_label")}>
                  <ArrowDownUp size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">{tPm("list.n_of_m", { n: list.length, m: counts.all + counts.arch })}</span>
            {!arch && (
              <div className="flex h-10 items-center rounded-xl border p-0.5">
                {(["grid", "table"] as const).map((m) => {
                  const Icon = m === "grid" ? LayoutGrid : List
                  const label = m === "grid" ? t("proj_view_grid") : t("proj_view_table")
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleViewModeChange(m)}
                      title={label}
                      aria-label={label}
                      aria-pressed={viewMode === m}
                      className={cn(
                        "flex h-8 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        viewMode === m ? "bg-module/10 text-module" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon size={16} aria-hidden="true" />
                    </button>
                  )
                })}
              </div>
            )}
            {arch && (
              <Button variant="outline" className="h-10 gap-1.5 rounded-xl" onClick={exportCsv} disabled={!list.length}>
                <Download size={15} aria-hidden="true" />
                {tPm("list.export")}
              </Button>
            )}
          </div>
        </div>

        {activeFilters(sel, st) > 0 && <PmFilterBar keys={keys} sel={sel} optionLabel={optionLabel} onToggle={(k, v) => setSel((s) => toggleOption(s, k, v))} onClearAll={clearAll} />}

        {pageLoading ? (
          <div className="flex items-center justify-center p-20 text-muted-foreground">
            <Loader2 className="animate-spin" size={32} aria-hidden="true" />
          </div>
        ) : typedProjects.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={t("proj_empty")}
            description={t("proj_empty_desc")}
            action={
              canCreate && (
                <Button asChild variant="outline" className="gap-2">
                  <Link href="/contractor/projects/new">
                    <PlusCircle size={16} />
                    {tPm("list.new_project")}
                  </Link>
                </Button>
              )
            }
          />
        ) : list.length === 0 ? (
          <EmptyState icon={Search} title={tPm("list.no_match")} description={tPm("list.no_match_desc")} />
        ) : arch ? (
          <PmArchiveTable rows={list} money={money} kindLabel={kindLabel} managerLabel={managerLabel} shown={shown} onMore={() => setShown((n) => n + ARCHIVE_PAGE)} />
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {listProjects.map((p) => (
              <PmProjectCard key={p.id} project={p} onFeed={onFeed} />
            ))}
          </div>
        ) : (
          <PmPortfolioTable projects={listProjects} money={money} onFeed={onFeed} />
        )}
      </div>
    </PortalLayout>
  )
}
