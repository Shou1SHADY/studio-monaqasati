"use client"

import { useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"
import { Link, useRouter } from "@/i18n/routing"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where } from "firebase/firestore"
import { Loader2, FolderOpen, PlusCircle, Search, Building2, ArrowDownUp, LayoutGrid, List, ChevronRight, ChevronUp, ChevronDown } from "lucide-react"
import { usePermissions } from "@/hooks/usePermissions"
import { usePmRail } from "@/hooks/usePmRail"
import { ModuleHeader } from "@/components/module-ui/ModuleHeader"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { PmProjectCard, type PmListProject } from "@/components/pm/PmProjectCard"
import { lifecycleOf, PM_LIFECYCLE, type PmLifecycle } from "@/lib/pm/lifecycle"
import { pmMoney } from "@/lib/pm/format"
import { Activity, Coins, FolderKanban } from "lucide-react"
import { PROJECT_STATUS_BADGE_CLASSES, projectStatusLabelKey, resolveProjectStatus } from "@/lib/project-status"

type ViewMode = "grid" | "table"
const VIEW_MODE_STORAGE_KEY = "contractor_projects_view_mode"

function fmtDate(val: unknown, locale: string) {
  if (!val) return "–"
  const d =
    val && typeof val === "object" && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date(val as string | number)
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

type SortOption = "newest" | "oldest" | "budget_desc" | "budget_asc" | "name_asc"

type ProjectListItem = {
  id: string
  name?: string
  clientName?: string
  status?: string
  rfqIds?: string[]
  location?: string
  region?: string
  budget?: number
  createdAt?: unknown
}

function getTimeMs(v: unknown): number {
  if (!v) return 0
  if (typeof v === "object" && v !== null && "toDate" in v) return (v as { toDate: () => Date }).toDate().getTime()
  const parsed = new Date(v as string | number).getTime()
  return isNaN(parsed) ? 0 : parsed
}

const LIFECYCLE_CHIPS = ["all", "live", "hold", "plan", "done", "closed"] as const

export default function ProjectsListPage() {
  const t = useTranslations("Portal.Contractor")
  const tPm = useTranslations("Portal.PM")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<"all" | PmLifecycle>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [regionFilter, setRegionFilter] = useState<string>("all")
  const [monthFilter, setMonthFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<SortOption>("newest")
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const { can, profile } = usePermissions()

  // Remember the member's preferred layout across visits.
  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (stored === "grid" || stored === "table") setViewMode(stored)
  }, [])
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode)
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
  }

  const projectsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "projects"),
      where("organizationId", "==", (profile as { organizationId?: string } | null)?.organizationId || user.uid)
    )
  }, [firestore, user, isUserLoading, (profile as { organizationId?: string } | null)?.organizationId])

  const { data: allProjects, isLoading } = useCollection(projectsQuery)
  const typedProjects = (allProjects || []) as ProjectListItem[]

  const regionOptions = Array.from(new Set(typedProjects.map((p) => p.region).filter(Boolean))) as string[]

  // "YYYY-MM" key per project's creation month, for the month filter — derived
  // client-side rather than queried, since the project list is already small
  // enough to filter in memory (same approach as the region filter above).
  const monthKey = (v: unknown): string | null => {
    const ms = getTimeMs(v)
    if (!ms) return null
    const d = new Date(ms)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  }
  const monthOptions = Array.from(
    new Set(typedProjects.map((p) => monthKey(p.createdAt)).filter((k): k is string => !!k))
  ).sort((a, b) => (a < b ? 1 : -1))
  const monthLabel = (key: string) => {
    const [year, month] = key.split("-").map(Number)
    return new Date(year, month - 1, 1).toLocaleDateString(isRtl ? "ar-SA" : "en-US", { month: "long", year: "numeric" })
  }

  // The portfolio by stage (PM 1.0 §7): a project made before PM 1.0 reads its kanban status as a stage.
  const byLifecycle = PM_LIFECYCLE.reduce(
    (acc, l) => ({ ...acc, [l]: typedProjects.filter((p) => lifecycleOf(p as { pm?: { lifecycle?: string }; status?: string }) === l).length }),
    {} as Record<PmLifecycle, number>
  )
  const census = tPm("list.census", { live: byLifecycle.live, hold: byLifecycle.hold, done: byLifecycle.done, closed: byLifecycle.closed })
  const rail = usePmRail()

  const searchLower = searchQuery.trim().toLowerCase()
  const projects = typedProjects
    .filter((p) => (statusFilter === "all" ? true : lifecycleOf(p as { pm?: { lifecycle?: string }; status?: string }) === statusFilter))
    .filter((p) => (regionFilter === "all" ? true : p.region === regionFilter))
    .filter((p) => (monthFilter === "all" ? true : monthKey(p.createdAt) === monthFilter))
    .filter((p) => {
      if (!searchLower) return true
      return (p.name || "").toLowerCase().includes(searchLower) || (p.clientName || "").toLowerCase().includes(searchLower)
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return getTimeMs(a.createdAt) - getTimeMs(b.createdAt)
        case "budget_desc":
          return (b.budget || 0) - (a.budget || 0)
        case "budget_asc":
          return (a.budget || 0) - (b.budget || 0)
        case "name_asc":
          return (a.name || "").localeCompare(b.name || "", isRtl ? "ar" : "en")
        case "newest":
        default:
          return getTimeMs(b.createdAt) - getTimeMs(a.createdAt)
      }
    })


  const sortOptions: { value: SortOption; label: string }[] = [
    { value: "newest", label: t("proj_sort_newest") },
    { value: "oldest", label: t("proj_sort_oldest") },
    { value: "budget_desc", label: t("proj_sort_budget_desc") },
    { value: "budget_asc", label: t("proj_sort_budget_asc") },
    { value: "name_asc", label: t("proj_sort_name") },
  ]

  // Table column headers double as sort controls for the columns that have a
  // matching SortOption pair — clicking toggles direction, a second click on
  // a different column switches to it. Columns without a symmetric asc/desc
  // pair (there's only one) aren't toggleable, just selectable.
  const toggleNameSort = () => setSortBy("name_asc")
  const toggleBudgetSort = () => setSortBy(sortBy === "budget_desc" ? "budget_asc" : "budget_desc")
  const toggleDateSort = () => setSortBy(sortBy === "newest" ? "oldest" : "newest")
  function SortIndicator({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
    if (!active) return null
    return direction === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />
  }

  function getStatusBadge(status: string) {
    const resolved = resolveProjectStatus(status)
    return (
      <Badge className={cn(PROJECT_STATUS_BADGE_CLASSES[resolved], "font-semibold")}>
        {t(projectStatusLabelKey(resolved))}
      </Badge>
    )
  }

  const pageLoading = isUserLoading || (isLoading && !allProjects)

  return (
    <PortalLayout>
      <div className="space-y-6">
        <ModuleHeader
          icon={FolderKanban}
          title={t("proj_title")}
          description={census}
          actions={
            can("projects.edit") && (
              <Button asChild className="gap-2 rounded-xl bg-module text-module-foreground hover:bg-module/90">
                <Link href="/contractor/projects/new">
                  <PlusCircle size={16} />
                  {t("proj_new")}
                </Link>
              </Button>
            )
          }
          kpisLabel={t("proj_title")}
          kpis={[
            { id: "shown", label: tPm("list.kpi_shown"), value: String(projects.length), note: tPm("list.kpi_all"), tone: "neutral", icon: FolderKanban },
            ...(can("projects.edit") || can("invoices.manage")
              ? [{ id: "value", label: tPm("list.kpi_value"), value: pmMoney(projects.reduce((a, p) => a + (p.budget || 0), 0)), note: tPm("list.kpi_value_note"), tone: "neutral" as const, icon: Coins }]
              : []),
            { id: "live", label: tPm("list.kpi_live"), value: String(byLifecycle.live), note: tPm("list.kpi_hold", { count: byLifecycle.hold }), tone: byLifecycle.hold ? ("warn" as const) : ("good" as const), icon: Activity },
          ]}
          tabs={rail.tabs}
          activeTab="projects"
          tabsLabel={t("proj_title")}
        />

        <ProcChipGroup
          items={LIFECYCLE_CHIPS.map((c) => ({ id: c, label: c === "all" ? tPm("list.chip_all") : tPm(`lifecycle.${c}`), count: c === "all" ? typedProjects.length : byLifecycle[c] }))}
          active={statusFilter}
          onPick={setStatusFilter}
          label={t("proj_title")}
        />

        {/* Search / region / sort filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("proj_search_placeholder")}
              className="ps-9 h-10 rounded-xl"
            />
          </div>
          {regionOptions.length > 0 && (
            <Select value={regionFilter} onValueChange={setRegionFilter}>
              <SelectTrigger className="w-full sm:w-[180px] h-10 rounded-xl">
                <SelectValue placeholder={t("proj_region_filter")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("proj_all_regions")}</SelectItem>
                {regionOptions.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {monthOptions.length > 0 && (
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="w-full sm:w-[180px] h-10 rounded-xl">
                <SelectValue placeholder={t("proj_month_filter")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("proj_all_months")}</SelectItem>
                {monthOptions.map((m) => (
                  <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-full sm:w-[180px] h-10 rounded-xl gap-1.5">
              <ArrowDownUp size={14} className="text-muted-foreground shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center rounded-xl border border-input h-10 p-0.5 shrink-0 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => handleViewModeChange("grid")}
              title={t("proj_view_grid")}
              aria-label={t("proj_view_grid")}
              aria-pressed={viewMode === "grid"}
              className={cn(
                "h-8 w-9 rounded-lg flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                viewMode === "grid" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange("table")}
              title={t("proj_view_table")}
              aria-label={t("proj_view_table")}
              aria-pressed={viewMode === "table"}
              className={cn(
                "h-8 w-9 rounded-lg flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                viewMode === "table" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {/* Loading */}
        {pageLoading && (
          <div className="flex flex-col items-center justify-center p-20 text-muted-foreground">
            <Loader2 className="animate-spin mb-4" size={32} />
          </div>
        )}

        {/* Empty state */}
        {!pageLoading && projects.length === 0 && (
          <div
            className={cn(
              "flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-4"
            )}
          >
            <FolderOpen size={48} className="text-muted-foreground/40" />
            <div>
              <p className="font-bold text-lg text-foreground">{t("proj_empty")}</p>
              <p className="text-muted-foreground text-sm mt-1">{t("proj_empty_desc")}</p>
            </div>
            {can("projects.edit") && (
              <Link href="/contractor/projects/new">
                <Button variant="outline" className="gap-2">
                  <PlusCircle size={16} />
                  {t("proj_new")}
                </Button>
              </Link>
            )}
          </div>
        )}

        {/* Filtered-to-empty state */}
        {!pageLoading && typedProjects.length > 0 && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center p-16 bg-slate-50 rounded-xl border border-dashed text-center gap-2">
            <Search size={36} className="text-muted-foreground/40" />
            <p className="font-bold text-foreground">{t("proj_no_results")}</p>
            <p className="text-muted-foreground text-sm">{t("proj_no_results_desc")}</p>
          </div>
        )}

        {/* Project cards */}
        {!pageLoading && projects.length > 0 && viewMode === "grid" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <PmProjectCard key={p.id} project={p as unknown as PmListProject} />
            ))}
          </div>
        )}

        {/* Project table */}
        {!pageLoading && projects.length > 0 && viewMode === "table" && (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-start">
                    <button
                      type="button"
                      onClick={toggleNameSort}
                      className="inline-flex items-center gap-1 font-semibold hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded"
                    >
                      {t("proj_table_name")}
                      <SortIndicator active={sortBy === "name_asc"} direction="asc" />
                    </button>
                  </TableHead>
                  <TableHead className="text-start hidden md:table-cell">{t("proj_table_client")}</TableHead>
                  <TableHead className="text-start">{t("proj_table_status")}</TableHead>
                  <TableHead className="text-start hidden lg:table-cell">{t("proj_table_region")}</TableHead>
                  <TableHead className="text-center hidden sm:table-cell">{t("proj_linked_rfqs_label")}</TableHead>
                  <TableHead className="text-end">
                    <button
                      type="button"
                      onClick={toggleBudgetSort}
                      className="inline-flex items-center gap-1 font-semibold hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded"
                    >
                      {t("proj_budget_label")}
                      <SortIndicator active={sortBy === "budget_desc" || sortBy === "budget_asc"} direction={sortBy === "budget_asc" ? "asc" : "desc"} />
                    </button>
                  </TableHead>
                  <TableHead className="text-end hidden md:table-cell">
                    <button
                      type="button"
                      onClick={toggleDateSort}
                      className="inline-flex items-center gap-1 font-semibold hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded"
                    >
                      {t("proj_created_at")}
                      <SortIndicator active={sortBy === "newest" || sortBy === "oldest"} direction={sortBy === "oldest" ? "asc" : "desc"} />
                    </button>
                  </TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/contractor/projects/${p.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        router.push(`/contractor/projects/${p.id}`)
                      }
                    }}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <TableCell className="max-w-[260px]">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Building2 size={14} className="text-primary" />
                        </div>
                        <span className="font-bold text-slate-800 truncate">{p.name || "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate hidden md:table-cell">
                      {p.clientName || "—"}
                    </TableCell>
                    <TableCell>{p.status ? getStatusBadge(p.status) : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground hidden lg:table-cell">
                      {p.region || p.location || "—"}
                    </TableCell>
                    <TableCell className="text-center text-sm font-semibold text-slate-700 hidden sm:table-cell">
                      {p.rfqIds?.length || 0}
                    </TableCell>
                    <TableCell className="text-end text-sm font-black text-slate-700" dir="ltr">
                      {p.budget != null ? p.budget.toLocaleString(locale === "ar" ? "ar-SA" : "en-US") : "—"}
                    </TableCell>
                    <TableCell className="text-end text-xs text-muted-foreground hidden md:table-cell" suppressHydrationWarning>
                      {fmtDate(p.createdAt, locale)}
                    </TableCell>
                    <TableCell className="w-10">
                      <ChevronRight size={16} className={cn("text-muted-foreground/60", isRtl && "rtl-flip")} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </PortalLayout>
  )
}
