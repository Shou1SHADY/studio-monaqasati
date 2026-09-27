"use client"

import { useState, useEffect } from "react"
import { useTranslations, useLocale } from 'next-intl'
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { RfqCard } from "@/components/procurement/RfqCard"
import { RfqTable } from "@/components/procurement/RfqTable"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { offersSealed } from "@/lib/procurement/award"
import { chipCounts, estimateAtLastPrice } from "@/lib/procurement/rfq-view"
import { cn } from "@/lib/utils"
import { matchesSearch } from "@/lib/search-text"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Search, Loader2, Send, X, Trash2, RotateCw, LayoutGrid, List } from "lucide-react"
import { ShareRfqLinkDialog } from "@/components/contractor/ShareRfqLinkDialog"
import { MfgPurchaseRequestsPanel } from "@/components/contractor/MfgPurchaseRequestsPanel"
import { RfqOffersSheet, type SheetRfq } from "@/components/contractor/RfqOffersSheet"
import { Link } from "@/i18n/routing"
import { useCollectionPaginated, useFirestore, useUser, useMemoFirebase, useCollection } from "@/firebase"
import { collection, query, where, doc, updateDoc, deleteDoc, arrayRemove } from "firebase/firestore"
import { releaseBoqDrawsForRfq } from "@/lib/boq-draws"
import { notifyFavoriteSuppliersOfPublish } from "@/lib/notify-favorites"
import { useSearchParams } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { PREDEFINED_CATEGORIES, SAUDI_CITIES, displayCategory, displayCity } from "@/lib/constants"
import { getIncompletePublishFields } from "@/utils/publish-gate"
import { usePermissions } from "@/hooks/usePermissions"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"

export default function ContractorRfqsPage() {
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "")
  const searching = searchQuery.trim().length > 0
  const [statusFilter, setStatusFilter] = useState<"all" | "Draft" | "New" | "Awarded">("all")
  const [selectedRfqs, setSelectedRfqs] = useState<string[]>([])
  const [isPublishing, setIsPublishing] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [republishTarget, setRepublishTarget] = useState<any>(null)
  const [shareTarget, setShareTarget] = useState<any>(null)
  // Offers at a glance: the RFQ whose offers are open side by side (customer review, 27 Sep 2026).
  const [glanceRfq, setGlanceRfq] = useState<SheetRfq | null>(null)
  const [republishDeadline, setRepublishDeadline] = useState("")
  const [isRepublishing, setIsRepublishing] = useState(false)
  const [deadlineFilter, setDeadlineFilter] = useState<"all" | "week" | "month" | "custom">("all")
  const [customDeadline, setCustomDeadline] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [locationFilter, setLocationFilter] = useState<string>("all")
  const [projectFilter, setProjectFilter] = useState<string>("all")
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { user, isUserLoading } = useUser()
  const { can } = usePermissions()
  const canManageRfqs = can("rfq.manage")
  const { profile } = useResolvedProfile(isUserLoading ? null : user?.uid)

  const hasActiveFilters = searchQuery || statusFilter !== "all" || deadlineFilter !== "all" || categoryFilter !== "all" || locationFilter !== "all" || projectFilter !== "all"
  const clearFilters = () => {
    setSearchQuery("")
    setStatusFilter("all")
    setDeadlineFilter("all")
    setCategoryFilter("all")
    setLocationFilter("all")
    setProjectFilter("all")
    setCustomDeadline("")
    setSelectedRfqs([])
  }

  useEffect(() => {
    setSearchQuery(searchParams.get("search") || "")
  }, [searchParams])

const handleBatchPublish = async () => {
    if (isPublishing || !firestore || selectedRfqs.length === 0) return;

    // Gate: profile must have mandatory fields filled before publishing
    const missingFields = getIncompletePublishFields(profile, locale)
    if (missingFields.length > 0) {
      toast({
        title: t("rfqs_profile_incomplete_title"),
        description: t("rfqs_profile_incomplete_desc", { fields: missingFields.join(locale === "ar" ? "، " : ", ") }),
        variant: "destructive",
      })
      return
    }

    const candidates = filteredRfqs.filter((rfq: any) => selectedRfqs.includes(rfq.id));
    const eligible = candidates.filter((rfq: any) => rfq.status === "Draft");
    const skipped = candidates.length - eligible.length;
    if (eligible.length === 0) {
      toast({ title: t("rfq_bulk_publish_none_eligible"), variant: "destructive" });
      return
    }

    setIsPublishing(true);
    let published = 0;
    const failedIds: string[] = [];
    for (const rfq of eligible) {
      try {
        await updateDoc(doc(firestore, "rfqs", rfq.id), {
          status: "New",
          visibility: "public",
          publishedAt: new Date().toISOString()
        });
        published++;
      } catch (error) {
        console.error(error)
        failedIds.push(rfq.id)
      }
    }
    toast({
      title: t("rfq_batch_publish_title"),
      description: t("rfq_bulk_publish_result", { published, skipped })
        + (failedIds.length > 0 ? t("rfq_bulk_publish_failed_suffix", { failed: failedIds.length }) : ""),
      variant: failedIds.length > 0 ? "destructive" : undefined,
    });
    void notifyFavoriteSuppliersOfPublish(user, eligible.map((r: any) => r.id).filter((id: string) => !failedIds.includes(id)))
    // Keep failed items selected so the user can retry; drop everything else.
    setSelectedRfqs(failedIds);
    setIsPublishing(false);
  };

  const toggleSelectRfq = (id: string) => {
    setSelectedRfqs(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    const allIds = filteredRfqs.map((rfq: any) => rfq.id);
    setSelectedRfqs(prev => prev.length === allIds.length ? [] : allIds);
  };

  const handleBatchDelete = async () => {
    if (isBulkDeleting || !firestore) return
    const candidates = filteredRfqs.filter((rfq: any) => selectedRfqs.includes(rfq.id));
    const eligible = candidates.filter((rfq: any) => canEditOrDelete(rfq));
    const skipped = candidates.length - eligible.length;
    if (eligible.length === 0) {
      toast({ title: t("rfq_bulk_delete_none_eligible"), variant: "destructive" });
      setShowBulkDeleteDialog(false)
      return
    }

    setIsBulkDeleting(true)
    let deleted = 0
    const failedIds: string[] = []
    for (const rfq of eligible) {
      try {
        if (rfq.projectId) {
          // Hand the RFQ's BOQ draws back before it goes.
          await releaseBoqDrawsForRfq(firestore, rfq.projectId, rfq.id)
          await updateDoc(doc(firestore, "projects", rfq.projectId), { rfqIds: arrayRemove(rfq.id) })
        }
        await deleteDoc(doc(firestore, "rfqs", rfq.id))
        deleted++
      } catch (error) {
        console.error(error)
        failedIds.push(rfq.id)
      }
    }
    toast({
      title: t("rfq_delete_success"),
      description: t("rfq_bulk_delete_result", { deleted, skipped })
        + (failedIds.length > 0 ? t("rfq_bulk_delete_failed_suffix", { failed: failedIds.length }) : ""),
      variant: failedIds.length > 0 ? "destructive" : undefined,
    })
    // Keep failed items selected so the user can retry; drop everything else.
    setSelectedRfqs(failedIds)
    setIsBulkDeleting(false)
    setShowBulkDeleteDialog(false)
  };

  const handleDelete = async () => {
    if (!firestore || !deleteTarget) return
    setIsDeleting(true)
    try {
      // Hand the tender's BOQ draws back before deleting it — matches the
      // Firestore rule's allowed "release" transition on a locked row.
      if (deleteTarget.projectId) {
        await releaseBoqDrawsForRfq(firestore, deleteTarget.projectId, deleteTarget.id)
        await updateDoc(doc(firestore, "projects", deleteTarget.projectId), { rfqIds: arrayRemove(deleteTarget.id) })
      }

      await deleteDoc(doc(firestore, "rfqs", deleteTarget.id))
      toast({
        title: t("rfq_delete_success"),
      })
      setDeleteTarget(null)
    } catch (error) {
      console.error(error)
      toast({
        title: t("rfq_delete_failed"),
        variant: "destructive"
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleRepublish = async () => {
    if (!firestore || !republishTarget || !republishDeadline) return
    setIsRepublishing(true)
    try {
      await updateDoc(doc(firestore, "rfqs", republishTarget.id), {
        deadline: republishDeadline,
        status: "New",
        visibility: "public",
        publishedAt: new Date().toISOString()
      })
      void notifyFavoriteSuppliersOfPublish(user, [republishTarget.id])
      toast({
        title: t("rfq_republish_success"),
      })
      setRepublishTarget(null)
      setRepublishDeadline("")
    } catch (error) {
      console.error(error)
      toast({
        title: t("rfq_republish_failed"),
        variant: "destructive"
      })
    } finally {
      setIsRepublishing(false)
    }
  }

  // الإصلاح: منع إرسال الاستعلام حتى يكتمل تحميل حالة المستخدم من Firebase Auth
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null;
    
    let q = query(
      collection(firestore, "rfqs"),
      where("organizationId", "==", profile?.organizationId || user.uid)
    );

    if (categoryFilter !== "all") {
      q = query(q, where("category", "==", categoryFilter));
    }
    if (locationFilter !== "all") {
      q = query(q, where("city", "==", locationFilter));
    }
    if (projectFilter !== "all") {
      q = query(q, where("projectId", "==", projectFilter));
    }

    return q;
  }, [firestore, user, isUserLoading, categoryFilter, locationFilter, projectFilter, profile?.organizationId])

  // Projects belonging to this org, used only to populate the project filter dropdown.
  const projectsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "projects"),
      where("organizationId", "==", profile?.organizationId || user.uid)
    )
  }, [firestore, user, isUserLoading, profile?.organizationId])
  const { data: projects } = useCollection(projectsQuery)
  const projectNameOf = (id: string | null | undefined): string | null => (id ? ((projects || []).find((p: any) => p.id === id) as { name?: string } | undefined)?.name ?? null : null)
  // Sealed rounds and the estimate at the last price paid (the prototype's list).
  const procWorld = useProcurementWorld()
  const { history: priceHistory } = useProcurementPrices(procWorld.orgId)
  const [now] = useState(() => new Date())
  const projectOptions = (projects || [])
    .map((p: any) => ({ value: p.id, label: p.name || p.id }))
    .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, locale === "ar" ? "ar" : "en"))

  const acceptedOffersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "offers"),
      // The org's accepted offers, not only those on tenders this member
      // created — a colleague's awarded tender must not become editable.
      where("contractorOrgId", "==", profile?.organizationId || user.uid),
      where("status", "==", "مقبول")
    )
  }, [firestore, user, isUserLoading, profile?.organizationId])

  const { data: acceptedOffers } = useCollection(acceptedOffersQuery)
  const acceptedRfqIds = new Set((acceptedOffers || []).map((o: any) => o.rfqId))

  const { data: rfqs, isLoading: isCollectionLoading, hasMore, loadMore, error } = useCollectionPaginated(rfqsQuery)
  const isLoading = isUserLoading || (isCollectionLoading && !rfqs && !error)
  const isLoadingMore = isCollectionLoading && !!rfqs

  // Every status is loaded so the chips can count; the chip filters here. A
  // search looks in every status: whoever types a tender's name does not know
  // — and should not need to know — whether it is a draft or awarded.
  const allRfqs = (rfqs || []) as any[]
  const counts = chipCounts(allRfqs)
  const filteredRfqs = allRfqs.filter((rfq: any) => {
    if (!searching && statusFilter !== "all" && rfq.status !== statusFilter) return false
    // Search query filter
    if (searching && !matchesSearch(searchQuery, [rfq.title, rfq.category, rfq.subCategory, rfq.city, rfq.id, rfq.description, ...(Array.isArray(rfq.products) ? rfq.products.map((p: { name?: string; description?: string }) => p?.name || p?.description) : [])])) {
      return false
    }

    // Deadline filter
    if (deadlineFilter !== "all" && rfq.deadline) {
      const deadline = new Date(rfq.deadline);
      const now = new Date();
      if (deadlineFilter === "week") {
        const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (deadline > weekFromNow) return false;
      } else if (deadlineFilter === "month") {
        const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        if (deadline > monthFromNow) return false;
      } else if (deadlineFilter === "custom" && customDeadline) {
        const customDate = new Date(customDeadline);
        if (deadline > customDate) return false;
      }
    }

    return true;
  }).sort((a: any, b: any) => {
    const getTs = (ts: any): number => {
      if (!ts) return 0
      if (typeof ts === 'string' || typeof ts === 'number') return new Date(ts).getTime()
      if (typeof ts === 'object' && 'toDate' in ts) return ts.toDate().getTime()
      if (typeof ts === 'object' && 'seconds' in ts) return ts.seconds * 1000
      return 0
    }
    return getTs(b.createdAt) - getTs(a.createdAt)
  })



  const canEdit = (rfq: any) => {
    if (rfq.status === "Awarded") return false
    if (acceptedRfqIds.has(rfq.id)) return false
    return true
  }

  const canDelete = (rfq: any) => rfq.status === "Draft"

  const canEditOrDelete = canEdit

  const glanceHref = glanceRfq ? (glanceRfq.projectId ? `/contractor/projects/${glanceRfq.projectId}/tenders/${glanceRfq.id}/offers` : `/contractor/rfqs/${glanceRfq.id}/offers`) : ""

  return (
    <PortalLayout>
      <RfqOffersSheet rfq={glanceRfq} offersHref={glanceHref} open={glanceRfq !== null} onOpenChange={(o) => !o && setGlanceRfq(null)} />
      <div className="space-y-5">
        <ProcurementHeader
          title={t("rfqv_title")}
          description={t("rfqv_desc")}
          action={
            can("rfq.create") && (
              <Button asChild className="gap-2 rounded-xl bg-module text-module-foreground hover:bg-module/90">
                <Link href="/contractor/rfqs/new">
                  <Send size={16} aria-hidden="true" />
                  {t("rfqv_new")}
                </Link>
              </Button>
            )
          }
        />

        {/* Manufacturing's material shortfalls and supplier claims — Procurement acts on them here (MAT-05) */}
        <MfgPurchaseRequestsPanel
          canStartRfq={can("rfq.manage") || can("rfq.create")}
          canMarkArrived={can("rfq.manage") || can("warehouses.manage")}
          canClaim={can("rfq.manage") || can("rfq.create")}
        />

        {/* Status chips with their counts · the view toggle (the prototype's list head). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className={cn("inline-flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1", searching && "opacity-60")} role="group" aria-label={t("rfq_status_filter")}>
            {(["all", "Draft", "New", "Awarded"] as const).map((chip) => {
              const on = statusFilter === chip && !searching
              return (
                <button
                  key={chip}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setSearchQuery("")
                    setStatusFilter(chip)
                    setSelectedRfqs([])
                  }}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "bg-module/10 text-module" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(`rfqv_chip_${chip}`)}
                  <span className="text-xs tabular-nums">{counts[chip]}</span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} aria-hidden="true" />
              <Input placeholder={t("rfq_search_placeholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-9 w-full rounded-xl bg-card ps-9 sm:w-60" aria-label={t("rfq_search_placeholder")} />
            </div>
            <div className="flex items-center rounded-xl border bg-card p-1">
              {(["grid", "list"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  title={t(mode === "grid" ? "rfqv_view_cards" : "rfqv_view_list")}
                  aria-label={t(mode === "grid" ? "rfqv_view_cards" : "rfqv_view_list")}
                  aria-pressed={viewMode === mode}
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    viewMode === mode ? "bg-module/10 text-module" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode === "grid" ? <LayoutGrid size={15} aria-hidden="true" /> : <List size={15} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filters · how many are shown */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto lg:min-w-[720px]">
            <SearchableSelect
              size="md"
              value={projectFilter}
              onChange={setProjectFilter}
              options={[{ value: "all", label: t("rfq_all_projects") }, ...projectOptions]}
              placeholder={t("rfq_project_filter")}
              searchPlaceholder={t("rfq_search_project")}
              noResultsText={t("newrfq_no_results")}
              ariaLabel={t("rfq_project_filter")}
            />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-10 rounded-xl bg-card text-sm" aria-label={t("rfq_category_filter")}>
                <SelectValue placeholder={t("rfq_category_filter")} />
              </SelectTrigger>
              <SelectContent className="max-h-72 overflow-y-auto">
                <SelectItem value="all">{t("rfq_all_categories")}</SelectItem>
                {PREDEFINED_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {displayCategory(cat, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="h-10 rounded-xl bg-card text-sm" aria-label={t("rfq_city_filter")}>
                <SelectValue placeholder={t("rfq_city_filter")} />
              </SelectTrigger>
              <SelectContent className="max-h-72 overflow-y-auto">
                <SelectItem value="all">{t("rfq_all_cities")}</SelectItem>
                {SAUDI_CITIES.map((city) => (
                  <SelectItem key={city} value={city}>
                    {displayCity(city, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-start gap-2">
              <Select value={deadlineFilter} onValueChange={(v) => setDeadlineFilter(v as typeof deadlineFilter)}>
                <SelectTrigger className="h-10 rounded-xl bg-card text-sm" aria-label={t("rfq_deadline_filter")}>
                  <SelectValue placeholder={t("rfq_deadline_filter")} />
                </SelectTrigger>
                <SelectContent className="max-h-72 overflow-y-auto">
                  <SelectItem value="all">{t("rfq_all_deadlines")}</SelectItem>
                  <SelectItem value="week">{t("rfq_within_week")}</SelectItem>
                  <SelectItem value="month">{t("rfq_within_month")}</SelectItem>
                  <SelectItem value="custom">{t("rfq_custom_date")}</SelectItem>
                </SelectContent>
              </Select>
              {deadlineFilter === "custom" && (
                <input type="date" value={customDeadline} onChange={(e) => setCustomDeadline(e.target.value)} aria-label={t("rfq_custom_date")} className="h-10 w-[140px] shrink-0 rounded-xl border border-input bg-card px-3 text-sm" />
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 rounded font-semibold hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X size={12} aria-hidden="true" />
                {t("rfq_clear_filters")}
              </button>
            )}
            <span>{t("rfqv_shown", { shown: filteredRfqs.length, total: allRfqs.length })}</span>
          </div>
        </div>

        {/* Bulk actions — the list view carries the selection. */}
        {selectedRfqs.length > 0 && canManageRfqs && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-module/30 bg-module/5 px-3 py-2">
            {filteredRfqs.some((r: any) => selectedRfqs.includes(r.id) && r.status === "Draft") && (
              <Button onClick={handleBatchPublish} disabled={isPublishing} size="sm" className="gap-2 rounded-lg bg-module text-module-foreground hover:bg-module/90">
                {isPublishing ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                {t("rfq_batch_publish", { count: selectedRfqs.length })}
              </Button>
            )}
            <Button onClick={() => setShowBulkDeleteDialog(true)} disabled={isBulkDeleting} variant="outline" size="sm" className="gap-2 rounded-lg border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive">
              <Trash2 size={14} />
              {t("rfq_delete_selected", { count: selectedRfqs.length })}
            </Button>
            <Button onClick={() => setSelectedRfqs([])} variant="ghost" size="sm" className="gap-2 rounded-lg text-muted-foreground">
              <X size={14} />
              {t("rfq_deselect_all")}
            </Button>
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center gap-4 p-20 text-muted-foreground">
            <Loader2 className="animate-spin" size={40} />
            <p>{t("rfq_loading")}</p>
          </div>
        )}
        {error && (
          <div className="space-y-4 rounded-xl border border-destructive/20 bg-destructive/5 p-10 text-center">
            <p className="font-bold text-destructive">{t("rfq_error_fetching")}</p>
            {process.env.NODE_ENV === "development" && <p className="break-all text-sm text-destructive/80" dir="ltr">{error.message}</p>}
          </div>
        )}
        {!isLoading && !error && filteredRfqs.length === 0 && (
          <div className="space-y-4 rounded-2xl border border-dashed bg-card p-16 text-center">
            <p className="text-muted-foreground">{hasActiveFilters ? t("rfq_no_matching") : t("rfq_no_tenders")}</p>
            {!hasActiveFilters && (
              <div className="flex flex-wrap items-center justify-center gap-3">
                {can("rfq.create") && (
                  <Button asChild className="gap-2 rounded-xl bg-module text-module-foreground hover:bg-module/90">
                    <Link href="/contractor/rfqs/new">
                      <Send size={16} />
                      {t("rfqv_new")}
                    </Link>
                  </Button>
                )}
                <Button asChild variant="outline" className="rounded-xl">
                  <Link href="/contractor/projects">{t("rfq_go_to_projects")}</Link>
                </Button>
              </div>
            )}
          </div>
        )}

        {!isLoading && filteredRfqs.length > 0 && viewMode === "grid" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredRfqs.map((rfq: any) => {
              const offersHref = rfq.projectId ? `/contractor/projects/${rfq.projectId}/tenders/${rfq.id}/offers` : `/contractor/rfqs/${rfq.id}/offers`
              const editHref = rfq.projectId ? `/contractor/projects/${rfq.projectId}/tenders/new?edit=${rfq.id}` : `/contractor/rfqs/new?edit=${rfq.id}`
              return (
                <RfqCard
                  key={rfq.id}
                  rfq={rfq}
                  projectName={projectNameOf(rfq.projectId)}
                  sealed={offersSealed(rfq, procWorld.policies, now)}
                  now={now}
                  offersHref={offersHref}
                  editHref={editHref}
                  canManage={canManageRfqs}
                  canEdit={canEdit(rfq)}
                  canDelete={canDelete(rfq)}
                  onGlance={() => setGlanceRfq(rfq)}
                  onShare={() => setShareTarget(rfq)}
                  onDelete={() => setDeleteTarget(rfq)}
                  onRepublish={() => {
                    setRepublishTarget(rfq)
                    setRepublishDeadline("")
                  }}
                />
              )
            })}
          </div>
        )}

        {!isLoading && filteredRfqs.length > 0 && viewMode === "list" && (
          <RfqTable
            rows={filteredRfqs.map((rfq: any) => ({
              rfq,
              projectName: projectNameOf(rfq.projectId),
              sealed: offersSealed(rfq, procWorld.policies, now),
              estimate: procWorld.actor.seesPrices ? estimateAtLastPrice(rfq, priceHistory) : null,
            }))}
            now={now}
            seesPrices={procWorld.actor.seesPrices}
            selected={selectedRfqs}
            onToggle={toggleSelectRfq}
            onToggleAll={selectAll}
            onGlance={(rfq) => setGlanceRfq(rfq as SheetRfq)}
          />
        )}

        {hasMore && filteredRfqs.length > 0 && (
          <div className="p-2 text-center">
            <Button onClick={loadMore} disabled={isLoadingMore} variant="outline" className="rounded-xl font-bold">
              {isLoadingMore && <Loader2 className="me-2 animate-spin" size={16} />}
              {t("rfq_load_more")}
            </Button>
          </div>
        )}
      </div>

      <ShareRfqLinkDialog
        rfq={shareTarget}
        isOpen={!!shareTarget}
        onClose={() => setShareTarget(null)}
      />

      <Dialog open={!!republishTarget} onOpenChange={(open) => { if (!open) { setRepublishTarget(null); setRepublishDeadline("") } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rfq_republish_title")}</DialogTitle>
            <DialogDescription>
              {t("rfq_republish_desc", { title: republishTarget?.title || "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("rfq_republish_deadline_label")}</Label>
              <input
                type="date"
                value={republishDeadline}
                onChange={e => setRepublishDeadline(e.target.value)}
                className="h-10 w-full px-3 rounded-xl border border-input bg-background text-sm"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRepublishTarget(null); setRepublishDeadline("") }} disabled={isRepublishing}>{t("cancel")}</Button>
            <Button onClick={handleRepublish} disabled={!republishDeadline || isRepublishing}>
              {isRepublishing ? <Loader2 className="animate-spin" size={14} /> : <RotateCw size={14} />}
              {t("rfq_republish_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rfq_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rfq_delete_confirm_desc", { title: deleteTarget?.title || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="animate-spin" size={14} /> : null}
              {t("rfq_delete_tender")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showBulkDeleteDialog} onOpenChange={(open) => !open && setShowBulkDeleteDialog(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rfq_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rfq_bulk_delete_confirm_desc", { count: selectedRfqs.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBatchDelete}
              disabled={isBulkDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isBulkDeleting ? <Loader2 className="animate-spin" size={14} /> : null}
              {t("rfq_delete_selected", { count: selectedRfqs.length })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  )
}