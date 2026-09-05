"use client"

import { useState, useEffect } from "react"
import { useTranslations, useLocale } from 'next-intl'
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
import { FileText, Eye, Calendar, Search, Package, Loader2, Send, MapPin, X, File, MessageCircle, User, Pencil, Trash2, RotateCw, LayoutGrid, List, Share2 } from "lucide-react"
import { ShareRfqLinkDialog } from "@/components/contractor/ShareRfqLinkDialog"
import { Link } from "@/i18n/routing"
import { useCollectionPaginated, useFirestore, useUser, useMemoFirebase, useCollection } from "@/firebase"
import { collection, query, where, doc, updateDoc, deleteDoc, arrayRemove } from "firebase/firestore"
import { releaseBoqDrawsForRfq } from "@/lib/boq-draws"
import { notifyFavoriteSuppliersOfPublish } from "@/lib/notify-favorites"
import { useSearchParams } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { PREDEFINED_CATEGORIES, SAUDI_CITIES, displayCategory, displayCity, displaySubcategory } from "@/lib/constants"
import { getIncompletePublishFields } from "@/utils/publish-gate"
import { usePermissions } from "@/hooks/usePermissions"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"

export default function ContractorRfqsPage() {
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "")
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
  const [republishDeadline, setRepublishDeadline] = useState("")
  const [isRepublishing, setIsRepublishing] = useState(false)
  const [publishingDraftId, setPublishingDraftId] = useState<string | null>(null)
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
        title: locale === "ar" ? "الملف الشخصي غير مكتمل" : "Incomplete Profile",
        description: (locale === "ar" ? "يرجى إكمال الحقول التالية أولاً: " : "Please complete the following fields first: ") + missingFields.join("، "),
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

  const handlePublishDraft = async (rfqId: string) => {
    if (!firestore || publishingDraftId) return
    setPublishingDraftId(rfqId)
    try {
      await updateDoc(doc(firestore, "rfqs", rfqId), {
        status: "New",
        publishedAt: new Date().toISOString()
      })
      void notifyFavoriteSuppliersOfPublish(user, [rfqId])
      toast({ title: t("rfq_publish_draft_success"), description: t("rfq_publish_draft_desc") })
    } catch (err) {
      console.error(err)
      toast({ title: t("offers_toast_error"), variant: "destructive" })
    } finally {
      setPublishingDraftId(null)
    }
  }

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

    if (statusFilter !== "all") {
      q = query(q, where("status", "==", statusFilter));
    }
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
  }, [firestore, user, isUserLoading, statusFilter, categoryFilter, locationFilter, projectFilter, profile?.organizationId])

  // Projects belonging to this org, used only to populate the project filter dropdown.
  const projectsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "projects"),
      where("organizationId", "==", profile?.organizationId || user.uid)
    )
  }, [firestore, user, isUserLoading, profile?.organizationId])
  const { data: projects } = useCollection(projectsQuery)
  const projectOptions = (projects || [])
    .map((p: any) => ({ value: p.id, label: p.name || p.id }))
    .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, locale === "ar" ? "ar" : "en"))

  const acceptedOffersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "offers"),
      where("contractorId", "==", user.uid),
      where("status", "==", "مقبول")
    )
  }, [firestore, user, isUserLoading])

  const { data: acceptedOffers } = useCollection(acceptedOffersQuery)
  const acceptedRfqIds = new Set((acceptedOffers || []).map((o: any) => o.rfqId))

  const { data: rfqs, isLoading: isCollectionLoading, hasMore, loadMore, error } = useCollectionPaginated(rfqsQuery)
  const isLoading = isUserLoading || (isCollectionLoading && !rfqs && !error)
  const isLoadingMore = isCollectionLoading && !!rfqs

const filteredRfqs = rfqs?.filter((rfq: any) => {
    // Search query filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesSearch = (
        rfq.title?.toLowerCase().includes(q) ||
        rfq.category?.toLowerCase().includes(q) ||
        rfq.subCategory?.toLowerCase().includes(q) ||
        rfq.id?.toLowerCase().includes(q)
      );
      if (!matchesSearch) return false;
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
  }) || [];

  const isExpired = (rfq: any) => {
    if (rfq.status !== "New" || !rfq.deadline) return false
    const deadline = new Date(rfq.deadline)
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return deadline < now
  }

  const canEdit = (rfq: any) => {
    if (rfq.status === "Awarded") return false
    if (acceptedRfqIds.has(rfq.id)) return false
    return true
  }

  const canDelete = (rfq: any) => rfq.status === "Draft"

  const canEditOrDelete = canEdit

  const getStatusBadge = (rfq: any) => {
    if (rfq.status === "Draft") {
      return <Badge className="bg-muted text-muted-foreground border-transparent font-bold">{t("rfq_badge_draft")}</Badge>;
    }

    if (rfq.status === "Awarded") {
      return <Badge className="bg-success/10 text-success border-success/20 font-bold">{t("rfq_badge_awarded")}</Badge>;
    }

    if (rfq.deadline) {
      const deadlineDate = new Date(rfq.deadline);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalize to start of day for accurate comparison
      if (deadlineDate < today) {
        return <Badge className="bg-destructive/10 text-destructive border-none font-bold">{t("rfq_badge_expired")}</Badge>;
      }
    }

    return <Badge className="bg-cta/10 text-cta border-none font-bold">{t("rfq_badge_open")}</Badge>;
  }

  // Colored strip along a grid card's top edge — the status reads at a glance
  // before any text does, and stays visible however tall the card grows.
  const statusAccent = (rfq: any) => {
    if (rfq.status === "Draft") return "bg-muted-foreground/30"
    if (rfq.status === "Awarded") return "bg-success"
    if (isExpired(rfq)) return "bg-destructive"
    return "bg-cta"
  }

  /** Days from today to the deadline, midnight-normalized; null when unset. */
  const daysUntilDeadline = (rfq: any): number | null => {
    if (!rfq.deadline) return null
    const deadline = new Date(rfq.deadline)
    deadline.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Math.round((deadline.getTime() - today.getTime()) / 86400000)
  }

  // Urgency pill next to the deadline — an active tender closing within days is
  // the one thing on this page that has to jump out. Expired tenders already
  // say so through the status badge, so no second pill for them.
  const deadlineUrgency = (rfq: any) => {
    if (rfq.status !== "New") return null
    const days = daysUntilDeadline(rfq)
    if (days === null || days < 0) return null
    if (days === 0) {
      return <span className="text-[10px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded-md whitespace-nowrap">{t("rfq_due_today")}</span>
    }
    if (days <= 3) {
      return <span className="text-[10px] font-bold text-warning bg-warning/10 px-1.5 py-0.5 rounded-md whitespace-nowrap">{t("rfq_days_left", { days })}</span>
    }
    return <span className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap">{t("rfq_days_left", { days })}</span>
  }

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("rfq_all_tenders_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("rfq_all_tenders_desc")}</p>
          </div>
          {can("rfq.create") && (
            <Link href="/contractor/rfqs/new">
              <Button className="gap-2 rounded-xl shadow-lg shadow-primary/20 cursor-pointer">
                <Send size={16} />
                {t("rfq_new_tender")}
              </Button>
            </Link>
          )}
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { value: "all", label: t("rfq_all") },
            { value: "Draft", label: t("rfq_status_draft") },
            { value: "New", label: t("rfq_status_active") },
            { value: "Awarded", label: t("rfq_status_completed") }
          ].map(tab => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? "default" : "outline"}
              size="sm"
              className="rounded-lg cursor-pointer"
              onClick={() => {
                setStatusFilter(tab.value as any);
                setSelectedRfqs([]);
              }}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/30 border-b pb-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="text-primary" size={20} />
                    {t("rfq_tender_list")}
                  </CardTitle>
                  <div className="flex items-center rounded-lg border border-border p-0.5 bg-background">
                    <button
                      type="button"
                      onClick={() => setViewMode("grid")}
                      title={t("rfq_view_grid")}
                      aria-label={t("rfq_view_grid")}
                      aria-pressed={viewMode === "grid"}
                      className={cn(
                        "h-7 w-7 rounded-md flex items-center justify-center transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                        viewMode === "grid" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <LayoutGrid size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("list")}
                      title={t("rfq_view_list")}
                      aria-label={t("rfq_view_list")}
                      aria-pressed={viewMode === "list"}
                      className={cn(
                        "h-7 w-7 rounded-md flex items-center justify-center transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                        viewMode === "list" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <List size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {selectedRfqs.length > 0 && canManageRfqs && (
                    <>
                      {filteredRfqs.some((r: any) => selectedRfqs.includes(r.id) && r.status === "Draft") && (
                        <Button
                          onClick={handleBatchPublish}
                          disabled={isPublishing}
                          className="gap-2 bg-success hover:bg-success/90 rounded-lg"
                          size="sm"
                        >
                          {isPublishing ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                          {t("rfq_batch_publish", { count: selectedRfqs.length })}
                        </Button>
                      )}
                      <Button
                        onClick={() => setShowBulkDeleteDialog(true)}
                        disabled={isBulkDeleting}
                        variant="outline"
                        className="gap-2 rounded-lg border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        size="sm"
                      >
                        <Trash2 size={14} />
                        {t("rfq_delete_selected", { count: selectedRfqs.length })}
                      </Button>
                      <Button
                        onClick={() => setSelectedRfqs([])}
                        variant="ghost"
                        className="gap-2 rounded-lg text-muted-foreground"
                        size="sm"
                      >
                        <X size={14} />
                        {t("rfq_deselect_all")}
                      </Button>
                    </>
                  )}
                  {selectedRfqs.length === 0 && (
                    <div className="relative">
                      <Search className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" size={18} />
                      <Input
                        placeholder={t("rfq_search_placeholder")}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full sm:w-64 h-10 rounded-xl bg-background border-border ps-10"
                      />
                    </div>
                  )}
                </div>
              </div>
              {/* Grid view only — the table carries its own select-all in its header row */}
              {filteredRfqs.length > 0 && viewMode === "grid" && (
                <div className="flex items-center gap-1.5 w-fit">
                  <Checkbox
                    id="rfq-select-all"
                    checked={selectedRfqs.length > 0 && selectedRfqs.length === filteredRfqs.length ? true : selectedRfqs.length > 0 ? "indeterminate" : false}
                    onCheckedChange={selectAll}
                  />
                  <Label htmlFor="rfq-select-all" className="text-xs font-semibold text-muted-foreground cursor-pointer">
                    {t("rfq_select_all")}
                  </Label>
                </div>
              )}
              {/* Filters Row — a grid, not flex-wrap, so filters line up cleanly at
                  every breakpoint instead of wrapping unevenly by cumulative width. */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 items-start">
                {/* Project Filter */}
                <SearchableSelect
                  size="md"
                  value={projectFilter}
                  onChange={setProjectFilter}
                  options={[{ value: "all", label: t("rfq_all_projects") }, ...projectOptions]}
                  placeholder={t("rfq_project_filter")}
                  searchPlaceholder={t("rfq_search_project")}
                  noResultsText={t("newrfq_no_results")}
                />

                {/* Category Filter */}
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-10 text-sm rounded-xl">
                    <SelectValue placeholder={t("rfq_category_filter")} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 overflow-y-auto">
                    <SelectItem value="all">{t("rfq_all_categories")}</SelectItem>
                    {PREDEFINED_CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>{displayCategory(cat, locale)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Location Filter */}
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger className="h-10 text-sm rounded-xl">
                    <SelectValue placeholder={t("rfq_city_filter")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 overflow-y-auto">
                    <SelectItem value="all">{t("rfq_all_cities")}</SelectItem>
                    {SAUDI_CITIES.map(city => (
                      <SelectItem key={city} value={city}>{displayCity(city, locale)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Deadline Filter */}
                <div className="flex items-start gap-2">
                  <Select value={deadlineFilter} onValueChange={(v: any) => setDeadlineFilter(v)}>
                    <SelectTrigger className="h-10 text-sm rounded-xl">
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
                    <input
                      type="date"
                      value={customDeadline}
                      onChange={e => setCustomDeadline(e.target.value)}
                      className="h-10 px-3 rounded-xl border border-input bg-background text-sm w-[140px] shrink-0"
                    />
                  )}
                </div>
              </div>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-8 text-xs text-muted-foreground hover:text-destructive gap-1 w-fit -mt-1"
                >
                  <X size={12} />
                  {t("rfq_clear_filters")}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {isLoading && (
              <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <Loader2 className="animate-spin" size={40} />
                <p>{t("rfq_loading")}</p>
              </div>
            )}
            {error && (
              <div className="p-10 text-center space-y-4 bg-destructive/5 border border-destructive/20 rounded-xl">
                <p className="text-destructive font-bold">{t("rfq_error_fetching")}</p>
                {process.env.NODE_ENV === "development" && (
                  <p className="text-destructive/80 text-sm break-all" dir="ltr">{error.message}</p>
                )}
              </div>
            )}
            {!isLoading && !error && filteredRfqs.length === 0 && (
              <div className="p-20 text-center space-y-4">
                <p className="text-muted-foreground">
                  {hasActiveFilters
                    ? t("rfq_no_matching")
                    : t("rfq_no_tenders")}
                </p>
                {!hasActiveFilters && (
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    {can("rfq.create") && (
                      <Link href="/contractor/rfqs/new">
                        <Button className="gap-2">
                          <Send size={16} />
                          {t("rfq_new_tender")}
                        </Button>
                      </Link>
                    )}
                    <Link href="/contractor/projects">
                      <Button variant="outline">{t("rfq_go_to_projects")}</Button>
                    </Link>
                  </div>
                )}
              </div>
            )}
            {!isLoading && filteredRfqs.length > 0 && viewMode === "grid" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredRfqs.map((rfq: any) => {
                  const isSelected = selectedRfqs.includes(rfq.id)
                  const offersHref = rfq.projectId ? `/contractor/projects/${rfq.projectId}/tenders/${rfq.id}/offers` : `/contractor/rfqs/${rfq.id}/offers`
                  return (
                  <Card
                    key={rfq.id}
                    className={cn(
                      "group relative overflow-hidden border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 flex flex-col",
                      isSelected && "border-primary/60 ring-2 ring-primary/20"
                    )}
                  >
                    <div className={cn("h-1 w-full shrink-0", statusAccent(rfq))} aria-hidden="true" />
                    <CardContent className="p-5 flex flex-col flex-1">
                      {/* Selection, status and id share one calm top row — the status
                          badge used to be buried mid-card next to the deadline. */}
                      <div className="flex items-center gap-2 mb-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelectRfq(rfq.id)}
                          aria-label={rfq.title}
                          className="cursor-pointer"
                        />
                        {getStatusBadge(rfq)}
                        <span className="flex-1" />
                        <span className="text-[10px] text-muted-foreground font-mono bg-muted px-2 py-1 rounded-md" dir="ltr">{rfq.id.substring(0, 8)}</span>
                      </div>

                      <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2">
                        {rfq.title}
                      </h3>

                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/15 border-none">
                          {displayCategory(rfq.category, locale)}
                        </Badge>
                        {rfq.subCategory && (
                          <Badge variant="outline" className="text-muted-foreground border-border">
                            {displaySubcategory(rfq.subCategory, locale)}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-muted/60 px-2 py-1 rounded-md">
                          <Package size={13} className="text-primary" />
                          {rfq.products && rfq.products.length > 0
                            ? t("rfq_products_count", { count: rfq.products.length })
                            : t("rfq_quantity_label", { qty: rfq.quantity, unit: rfq.unitOfMeasure })
                          }
                        </div>
                        {/* The offers count is the number the contractor came to check —
                            it links straight to the offers page and goes green once bids exist. */}
                        <Link
                          href={offersHref}
                          className={cn(
                            "flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-md transition-colors",
                            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            (rfq.offersCount || 0) > 0
                              ? "text-success bg-success/10 border border-success/20 hover:bg-success/20"
                              : "text-muted-foreground bg-muted/60 hover:bg-muted"
                          )}
                        >
                          <FileText size={13} />
                          {t("rfq_offers_count", { count: rfq.offersCount || 0 })}
                        </Link>
                      </div>

                      <div className="space-y-2 pt-3 border-t border-border/60 mt-4 mb-4">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin size={13} className="text-cta shrink-0" />
                          <span className="truncate">{displayCity(rfq.city, locale)}{rfq.district ? ` — ${displayCity(rfq.district, locale)}` : ""}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap" suppressHydrationWarning>
                          <Calendar size={13} className="text-warning shrink-0" />
                          <span>{t("rfq_deadline_label", { date: rfq.deadline ? new Date(rfq.deadline).toLocaleDateString(locale) : t("rfq_not_set") })}</span>
                          {deadlineUrgency(rfq)}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <User size={13} className="shrink-0" />
                          <span className="truncate">{t("rfq_by_label")} <span className="font-bold text-foreground">{rfq.createdByUserName || t("rfq_admin_label")}</span></span>
                        </div>
                        {rfq.pdfUrl && (
                          <a
                            href={rfq.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            download
                            className="flex items-center gap-1.5 text-xs font-semibold bg-cta/10 text-cta px-2 py-1 rounded-md hover:bg-cta/20 transition-colors w-fit focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <File size={12} />
                            {t("rfq_download_pdf")}
                          </a>
                        )}
                      </div>

                      <div className="flex gap-2 mt-auto">
                        <Link href={offersHref} className="flex-1">
                          <Button variant="outline" size="sm" className="w-full gap-1 text-sm h-9 rounded-lg border-border hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all">
                            <Eye size={14} />
                            {t("rfq_view_offers")}
                          </Button>
                        </Link>
                        <Link href={`${offersHref}?tab=inquiries`} className="flex-1">
                          <Button variant="outline" size="sm" className="w-full gap-1 text-sm h-9 rounded-lg border-border hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all">
                            <MessageCircle size={14} />
                            {t("rfq_inquiries")}
                          </Button>
                        </Link>
                        {rfq.status === "New" && !isExpired(rfq) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShareTarget(rfq)}
                                aria-label={t("rfq_share_title")}
                                className="h-9 w-9 p-0 rounded-lg border-border text-accent hover:bg-accent hover:text-accent-foreground hover:border-accent transition-all shrink-0"
                              >
                                <Share2 size={14} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t("rfq_share_title")}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {canManageRfqs && (canEdit(rfq) || canDelete(rfq)) && (
                        <div className="flex flex-col gap-2 mt-2">
                          {rfq.status === "Draft" && (
                            <Button
                              size="sm"
                              className="w-full gap-1 text-sm h-8 rounded-lg bg-success hover:bg-success/90 text-success-foreground transition-all"
                              onClick={() => handlePublishDraft(rfq.id)}
                              disabled={publishingDraftId === rfq.id}
                            >
                              {publishingDraftId === rfq.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                              {t("rfq_publish_draft")}
                            </Button>
                          )}
                          {/* Compact labels: the full "edit/delete RFQ" wording overflows
                              the card and gets clipped — icons + card context carry the meaning */}
                          <div className="flex gap-2">
                          {canEdit(rfq) && (
                            <Link href={rfq.projectId ? `/contractor/projects/${rfq.projectId}/tenders/new?edit=${rfq.id}` : `/contractor/rfqs/new?edit=${rfq.id}`} className="flex-1 min-w-0">
                              <Button variant="ghost" size="sm" title={t("rfq_edit_tender")} className="w-full gap-1 text-sm h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                                <Pencil size={14} className="shrink-0" />
                                <span className="truncate">{t("rfq_edit_short")}</span>
                              </Button>
                            </Link>
                          )}
                          {canDelete(rfq) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title={t("rfq_delete_tender")}
                              className="flex-1 min-w-0 gap-1 text-sm h-8 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10 transition-all"
                              onClick={() => setDeleteTarget(rfq)}
                            >
                              <Trash2 size={14} className="shrink-0" />
                              <span className="truncate">{t("rfq_delete_short")}</span>
                            </Button>
                          )}
                          </div>
                        </div>
                      )}
                      {canManageRfqs && isExpired(rfq) && canEdit(rfq) && (
                        <div className="mt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full gap-1 text-sm h-8 rounded-lg text-warning border-warning/40 hover:bg-warning/10 hover:text-warning hover:border-warning/60 transition-all"
                            onClick={() => { setRepublishTarget(rfq); setRepublishDeadline("") }}
                          >
                            <RotateCw size={14} />
                            {t("rfq_republish")}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )})}
              </div>
            )}
            {!isLoading && filteredRfqs.length > 0 && viewMode === "list" && (
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    {/* text-start (not text-right) so the table aligns correctly in BOTH
                        directions — the hardcoded right-alignment broke the English view */}
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedRfqs.length > 0 && selectedRfqs.length === filteredRfqs.length ? true : selectedRfqs.length > 0 ? "indeterminate" : false}
                          onCheckedChange={selectAll}
                          aria-label={t("rfq_select_all")}
                        />
                      </TableHead>
                      <TableHead className="text-start">{t("rfq_id_col")}</TableHead>
                      <TableHead className="text-start">{t("proj_rfqs")}</TableHead>
                      <TableHead className="text-start">{t("rfq_category_filter")}</TableHead>
                      <TableHead className="text-start">{t("rfq_city_filter")}</TableHead>
                      <TableHead className="text-start">{t("rfq_deadline_col")}</TableHead>
                      <TableHead className="text-start">{t("proj_status")}</TableHead>
                      <TableHead className="text-center">{t("proj_offers_count_label")}</TableHead>
                      <TableHead className="text-end"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRfqs.map((rfq: any) => {
                      const isSelected = selectedRfqs.includes(rfq.id)
                      const offersHref = rfq.projectId ? `/contractor/projects/${rfq.projectId}/tenders/${rfq.id}/offers` : `/contractor/rfqs/${rfq.id}/offers`
                      return (
                      <TableRow key={rfq.id} className={cn(isSelected && "bg-primary/5 hover:bg-primary/10")}>
                        <TableCell>
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleSelectRfq(rfq.id)} aria-label={rfq.title} />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground" dir="ltr">{rfq.id.substring(0, 8)}</TableCell>
                        <TableCell className="max-w-[260px]">
                          <Link
                            href={offersHref}
                            title={rfq.title}
                            className="block truncate font-bold text-foreground hover:text-primary transition-colors rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {rfq.title}
                          </Link>
                          {rfq.subCategory && (
                            <span className="block truncate text-[11px] text-muted-foreground">{displaySubcategory(rfq.subCategory, locale)}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{displayCategory(rfq.category, locale)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{displayCity(rfq.city, locale)}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap" suppressHydrationWarning>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">{rfq.deadline ? new Date(rfq.deadline).toLocaleDateString(locale) : t("rfq_not_set")}</span>
                            {deadlineUrgency(rfq)}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(rfq)}</TableCell>
                        <TableCell className="text-center">
                          <span
                            className={cn(
                              "inline-flex items-center justify-center min-w-7 h-6 px-1.5 rounded-md text-xs font-bold tabular-nums",
                              (rfq.offersCount || 0) > 0 ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                            )}
                            dir="ltr"
                          >
                            {rfq.offersCount || 0}
                          </span>
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link href={offersHref} aria-label={t("rfq_view_offers")} className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
                                  <Eye size={14} />
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent>{t("rfq_view_offers")}</TooltipContent>
                            </Tooltip>
                            {rfq.status === "New" && !isExpired(rfq) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => setShareTarget(rfq)}
                                    aria-label={t("rfq_share_title")}
                                    className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                                  >
                                    <Share2 size={14} />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>{t("rfq_share_title")}</TooltipContent>
                              </Tooltip>
                            )}
                            {canManageRfqs && canEdit(rfq) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Link href={rfq.projectId ? `/contractor/projects/${rfq.projectId}/tenders/new?edit=${rfq.id}` : `/contractor/rfqs/new?edit=${rfq.id}`} aria-label={t("rfq_edit_tender")} className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
                                    <Pencil size={14} />
                                  </Link>
                                </TooltipTrigger>
                                <TooltipContent>{t("rfq_edit_tender")}</TooltipContent>
                              </Tooltip>
                            )}
                            {canManageRfqs && rfq.status === "Draft" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => handlePublishDraft(rfq.id)}
                                    disabled={publishingDraftId === rfq.id}
                                    aria-label={t("rfq_publish_draft")}
                                    className="h-7 w-7 rounded-lg flex items-center justify-center text-success hover:bg-success/10 transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                                  >
                                    {publishingDraftId === rfq.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>{t("rfq_publish_draft")}</TooltipContent>
                              </Tooltip>
                            )}
                            {canManageRfqs && canDelete(rfq) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => setDeleteTarget(rfq)}
                                    aria-label={t("rfq_delete_tender")}
                                    className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>{t("rfq_delete_tender")}</TooltipContent>
                              </Tooltip>
                            )}
                            {canManageRfqs && isExpired(rfq) && canEdit(rfq) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => { setRepublishTarget(rfq); setRepublishDeadline("") }}
                                    aria-label={t("rfq_republish")}
                                    className="h-7 w-7 rounded-lg flex items-center justify-center text-warning hover:bg-warning/10 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                                  >
                                    <RotateCw size={14} />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>{t("rfq_republish")}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )})}
                  </TableBody>
                </Table>
              </div>
            )}
            {hasMore && filteredRfqs.length > 0 && (
              <div className="p-4 text-center">
                <Button 
                  onClick={loadMore} 
                  disabled={isLoadingMore}
                  variant="outline"
                  className="font-bold"
                >
                  {isLoadingMore && <Loader2 className={cn("animate-spin", locale === 'ar' ? 'ml-2' : 'mr-2')} size={16} />}
                  {t("rfq_load_more")}
                </Button>
              </div>
            )}
        </CardContent>
        </Card>
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