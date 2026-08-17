"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where } from "firebase/firestore"
import { Loader2, FolderOpen, PlusCircle, MapPin, DollarSign, FileText, Search, User, Building2, ArrowDownUp } from "lucide-react"
import { usePermissions } from "@/hooks/usePermissions"
import { PROJECT_STATUSES, PROJECT_STATUS_BADGE_CLASSES, projectStatusLabelKey, resolveProjectStatus, type ProjectStatus } from "@/lib/project-status"

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

type StatusFilter = "all" | ProjectStatus
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

export default function ProjectsListPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [regionFilter, setRegionFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<SortOption>("newest")
  const { can, profile } = usePermissions()

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

  const searchLower = searchQuery.trim().toLowerCase()
  const projects = typedProjects
    .filter((p) => (statusFilter === "all" ? true : resolveProjectStatus(p.status) === statusFilter))
    .filter((p) => (regionFilter === "all" ? true : p.region === regionFilter))
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

  const statusTabs: { value: StatusFilter; label: string }[] = [
    { value: "all", label: t("rfq_all") },
    ...PROJECT_STATUSES.map((s) => ({ value: s as StatusFilter, label: t(projectStatusLabelKey(s)) })),
  ]

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: "newest", label: t("proj_sort_newest") },
    { value: "oldest", label: t("proj_sort_oldest") },
    { value: "budget_desc", label: t("proj_sort_budget_desc") },
    { value: "budget_asc", label: t("proj_sort_budget_asc") },
    { value: "name_asc", label: t("proj_sort_name") },
  ]

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
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("proj_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("proj_desc")}</p>
          </div>
          {can("projects.edit") && (
            <Link href="/contractor/projects/new">
              <Button className="gap-2 font-bold">
                <PlusCircle size={18} />
                {t("proj_new")}
              </Button>
            </Link>
          )}
        </div>

        {/* Status filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {statusTabs.map((tab) => {
            const isActive = statusFilter === tab.value
            const colorClasses = tab.value === "all" ? undefined : PROJECT_STATUS_BADGE_CLASSES[tab.value as ProjectStatus]
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  isActive
                    ? colorClasses
                      ? cn(colorClasses, "ring-2 ring-offset-1 ring-current")
                      : "bg-primary text-primary-foreground border-primary"
                    : colorClasses
                      ? cn(colorClasses, "opacity-60 hover:opacity-100")
                      : "bg-transparent border-input text-foreground hover:bg-muted"
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

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
        {!pageLoading && projects.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {projects.map((p) => (
              <Link key={p.id} href={`/contractor/projects/${p.id}`}>
                <Card className="group relative overflow-hidden hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5 transition-all duration-300 border-slate-200 bg-white h-full rounded-2xl">
                  <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary via-accent to-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                  <CardContent className="p-5 flex flex-col gap-4">
                    {/* Header: icon + name + status */}
                    <div className="flex items-start gap-3">
                      <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                        <Building2 size={20} className="text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-base text-slate-800 group-hover:text-primary transition-colors leading-snug line-clamp-2">
                          {p.name || "—"}
                        </h3>
                        {p.clientName && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                            <User size={11} className="shrink-0" />
                            <span className="truncate">{p.clientName}</span>
                          </div>
                        )}
                      </div>
                      {p.status && <div className="shrink-0">{getStatusBadge(p.status)}</div>}
                    </div>

                    {/* Meta grid: RFQs / budget */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5 flex flex-col gap-0.5">
                        <div className={cn("flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase", isRtl && "flex-row-reverse")}>
                          <FileText size={11} className="text-primary" />
                          {t("proj_linked_rfqs_label")}
                        </div>
                        <span className="text-sm font-black text-slate-700">{p.rfqIds?.length || 0}</span>
                      </div>
                      <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5 flex flex-col gap-0.5">
                        <div className={cn("flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase", isRtl && "flex-row-reverse")}>
                          <DollarSign size={11} className="text-success" />
                          {t("proj_budget_label")}
                        </div>
                        <span className="text-sm font-black text-slate-700 truncate">
                          {p.budget != null ? p.budget.toLocaleString(locale === "ar" ? "ar-SA" : "en-US") : "—"}
                        </span>
                      </div>
                    </div>

                    {/* Location */}
                    {p.location && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <MapPin size={13} className="text-accent shrink-0" />
                        <span className="truncate">{p.location}</span>
                      </div>
                    )}

                    {/* Footer: created date */}
                    <p className="text-[11px] text-muted-foreground pt-3 border-t border-slate-100">
                      {t("proj_created_at")}: {fmtDate(p.createdAt, locale)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  )
}
