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
import { FileText, Eye, Calendar, Search, Package, ArrowRight, Loader2, Send, MapPin, X, File, Download, MessageCircle, User, Pencil, Trash2, RotateCw } from "lucide-react"
import { Link } from "@/i18n/routing"
import { useCollectionPaginated, useFirestore, useUser, useMemoFirebase, useDoc, useCollection } from "@/firebase"
import { collection, query, where, orderBy, doc, updateDoc, deleteDoc, getDocs, writeBatch, arrayRemove } from "firebase/firestore"
import { useSearchParams } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { PREDEFINED_CATEGORIES, SAUDI_CITIES, displayCategory, displayCity, displaySubcategory } from "@/lib/constants"
import { getIncompletePublishFields } from "@/utils/publish-gate"

export default function ContractorRfqsPage() {
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "")
  const [statusFilter, setStatusFilter] = useState<"all" | "Draft" | "New" | "Awarded">("all")
  const [selectedRfqs, setSelectedRfqs] = useState<string[]>([])
  const [isPublishing, setIsPublishing] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [republishTarget, setRepublishTarget] = useState<any>(null)
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
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

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
    if (!firestore || selectedRfqs.length === 0) return;

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

    setIsPublishing(true);
    try {
      for (const rfqId of selectedRfqs) {
        await updateDoc(doc(firestore, "rfqs", rfqId), {
          status: "New",
          visibility: "public",
          publishedAt: new Date().toISOString()
        });
      }
      toast({
        title: t("rfq_batch_publish_title"),
        description: t("rfq_batch_publish_desc", { count: selectedRfqs.length }),
      });
      setSelectedRfqs([]);
    } catch (error) {
      toast({
        title: t("rfq_batch_publish_error"),
        description: t("rfq_batch_publish_error_desc"),
        variant: "destructive"
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const toggleSelectRfq = (id: string) => {
    setSelectedRfqs(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    const draftRfqs = filteredRfqs.filter((rfq: any) => rfq.status === "Draft").map((rfq: any) => rfq.id);
    setSelectedRfqs(draftRfqs);
  };

  const handleDelete = async () => {
    if (!firestore || !deleteTarget) return
    setIsDeleting(true)
    try {
      // Unlock any BOQ items that were pushed to this tender before deleting it —
      // matches the Firestore rule's allowed "unlock" transition.
      if (deleteTarget.projectId) {
        const boqSnap = await getDocs(
          query(collection(firestore, "projects", deleteTarget.projectId, "boqItems"), where("tenderId", "==", deleteTarget.id))
        )
        if (!boqSnap.empty) {
          const batch = writeBatch(firestore)
          boqSnap.docs.forEach((d) => {
            batch.update(d.ref, { tenderId: null, isEditable: true })
          })
          await batch.commit()
        }
        await updateDoc(doc(firestore, "projects", deleteTarget.projectId), { rfqIds: arrayRemove(deleteTarget.id) })
      }

      await deleteDoc(doc(firestore, "rfqs", deleteTarget.id))
      toast({
        title: t("rfq_delete_success"),
      })
      setDeleteTarget(null)
    } catch (error) {
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
      toast({
        title: t("rfq_republish_success"),
      })
      setRepublishTarget(null)
      setRepublishDeadline("")
    } catch (error) {
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
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  }) || [];

  const isExpired = (rfq: any) => {
    if (rfq.status !== "New" || !rfq.deadline) return false
    const deadline = new Date(rfq.deadline)
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return deadline < now
  }

  const canEditOrDelete = (rfq: any) => {
    if (rfq.status === "Awarded") return false
    if (acceptedRfqIds.has(rfq.id)) return false
    return true
  }

  const getStatusBadge = (rfq: any) => {
    if (rfq.status === "Draft") {
      return <Badge className="bg-slate-100 text-slate-600 border-slate-300 font-bold">{t("rfq_badge_draft")}</Badge>;
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
    
    return <Badge className="bg-blue-50 text-blue-600 border-none font-bold">{t("rfq_badge_open")}</Badge>;
  }

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("rfq_all_tenders_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("rfq_all_tenders_desc")}</p>
          </div>
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
          <CardHeader className="bg-white border-b pb-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="text-primary" size={20} />
                  {t("rfq_tender_list")}
                </CardTitle>
                <div className="flex items-center gap-3 flex-wrap">
                  {selectedRfqs.length > 0 && (
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
                  {selectedRfqs.length === 0 && (
                    <div className="relative">
                      <Search className={cn("absolute top-1/2 -translate-y-1/2 text-slate-400", locale === 'ar' ? 'right-3' : 'left-3')} size={18} />
                      <Input
                        placeholder={t("rfq_search_placeholder")}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className={cn("w-full sm:w-64 h-10 rounded-xl bg-slate-50 border-slate-200 focus:bg-white cursor-pointer", locale === 'ar' ? 'pr-10' : 'pl-10')}
                      />
                    </div>
                  )}
                </div>
              </div>
              {/* Filters Row */}
              <div className="flex flex-wrap gap-2">
                {/* Project Filter */}
                <div className="w-[200px]">
                  <SearchableSelect
                    size="md"
                    value={projectFilter}
                    onChange={setProjectFilter}
                    options={[{ value: "all", label: t("rfq_all_projects") }, ...projectOptions]}
                    placeholder={t("rfq_project_filter")}
                    searchPlaceholder={t("rfq_search_project")}
                    noResultsText={t("newrfq_no_results")}
                  />
                </div>

                {/* Category Filter */}
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[200px] h-10 text-sm rounded-xl">
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
                  <SelectTrigger className="w-[200px] h-10 text-sm rounded-xl">
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
                <Select value={deadlineFilter} onValueChange={(v: any) => setDeadlineFilter(v)}>
                  <SelectTrigger className="w-[200px] h-10 text-sm rounded-xl">
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
                    className="h-10 px-3 rounded-xl border border-input bg-white text-sm w-[140px]"
                  />
                )}
                {hasActiveFilters && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={clearFilters}
                    className="h-10 text-xs text-muted-foreground hover:text-destructive gap-1"
                  >
                    <X size={12} />
                    {t("rfq_clear_filters")}
                  </Button>
                )}
              </div>
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
              <div className="p-10 text-center space-y-4 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-red-600 font-bold">{t("rfq_error_fetching")}</p>
                {process.env.NODE_ENV === "development" && (
                  <p className="text-red-500 text-sm break-all" dir="ltr">{error.message}</p>
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
                  <Link href="/contractor/projects">
                    <Button variant="outline">{t("rfq_go_to_projects")}</Button>
                  </Link>
                )}
              </div>
            )}
            {!isLoading && filteredRfqs.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredRfqs.map((rfq: any) => (
                  <Card key={rfq.id} className="group relative overflow-hidden border-slate-200/60 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 bg-white/60 backdrop-blur-xl flex flex-col">
                    <CardContent className="p-5 flex flex-col flex-1">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex flex-wrap gap-2">
                          {rfq.status === "Draft" && (
                            <Checkbox
                              checked={selectedRfqs.includes(rfq.id)}
                              onCheckedChange={() => toggleSelectRfq(rfq.id)}
                              className={cn("cursor-pointer", locale === 'ar' ? 'ml-2' : 'mr-2')}
                            />
                          )}
                          <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-none px-2.5 py-1">
                            {displayCategory(rfq.category, locale)}
                          </Badge>
                          {rfq.subCategory && (
                            <Badge variant="outline" className="text-slate-600 border-slate-200 bg-white/50 px-2.5 py-1">
                              {displaySubcategory(rfq.subCategory, locale)}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-2 py-1 rounded-md">{rfq.id.substring(0, 8)}</span>
                      </div>
                      
                      <div className="space-y-1 mb-5 flex-1">
                        <h3 className="text-lg font-bold text-slate-800 group-hover:text-primary transition-colors line-clamp-2">
                          {rfq.title}
                        </h3>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-600 bg-slate-50 w-fit px-2 py-1 rounded-md">
                            <Package size={14} className="text-primary" />
                            {rfq.products && rfq.products.length > 0 
                              ? t("rfq_products_count", { count: rfq.products.length })
                              : t("rfq_quantity_label", { qty: rfq.quantity, unit: rfq.unitOfMeasure })
                            }
                          </div>
                          <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-600 bg-emerald-50 w-fit px-2 py-1 rounded-md border border-emerald-100">
                            <FileText size={14} className="text-emerald-500" />
                            {rfq.offersCount || 0} {locale === 'ar' ? 'عروض' : 'Offers'}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 pt-4 border-t border-slate-100/80 mb-5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                              <User size={12} className="text-slate-500" />
                            </div>
                            <span className="truncate">{t("rfq_by_label")} <span className="font-bold text-slate-700">{rfq.createdByUserName || t("rfq_admin_label")}</span></span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                            <MapPin size={12} className="text-blue-600" />
                          </div>
                          <span className="truncate">{displayCity(rfq.city, locale)} - {displayCity(rfq.district, locale)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-600" suppressHydrationWarning>
                          <div className="w-6 h-6 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                            <Calendar size={12} className="text-amber-600" />
                          </div>
                          {t("rfq_deadline_label", { date: rfq.deadline ? new Date(rfq.deadline).toLocaleDateString(locale) : t("rfq_not_set") })}
                          {getStatusBadge(rfq)}
                        </div>
                        {rfq.pdfUrl && (
                          <a 
                            href={rfq.pdfUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            download
                            className="flex items-center gap-2 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-100 transition-colors w-fit"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <File size={12} />
                            {t("rfq_download_pdf")}
                          </a>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        <Link href={`/contractor/projects/${rfq.projectId}/tenders/${rfq.id}/offers`} className="flex-1">
                          <Button variant="outline" size="sm" className="w-full gap-1 text-sm h-9 rounded-lg border-slate-200 hover:bg-primary hover:text-white hover:border-primary transition-all">
                            <Eye size={14} />
                            {t("rfq_view_offers")}
                          </Button>
                        </Link>
                        <Link href={`/contractor/projects/${rfq.projectId}/tenders/${rfq.id}/offers?tab=inquiries`} className="flex-1">
                          <Button variant="outline" size="sm" className="w-full gap-1 text-sm h-9 rounded-lg border-slate-200 hover:bg-primary hover:text-white hover:border-primary transition-all">
                            <MessageCircle size={14} />
                            {t("rfq_inquiries")}
                          </Button>
                        </Link>
                      </div>
                      {canEditOrDelete(rfq) && (
                        <div className="flex gap-2 mt-2">
                          <Link href={`/contractor/projects/${rfq.projectId}/tenders/new?edit=${rfq.id}`} className="flex-1">
                            <Button variant="ghost" size="sm" className="w-full gap-1 text-sm h-8 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all">
                              <Pencil size={14} />
                              {t("rfq_edit_tender")}
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1 gap-1 text-sm h-8 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 transition-all"
                            onClick={() => setDeleteTarget(rfq)}
                          >
                            <Trash2 size={14} />
                            {t("rfq_delete_tender")}
                          </Button>
                        </div>
                      )}
                      {isExpired(rfq) && canEditOrDelete(rfq) && (
                        <div className="mt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full gap-1 text-sm h-8 rounded-lg text-amber-600 border-amber-300 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-400 transition-all"
                            onClick={() => { setRepublishTarget(rfq); setRepublishDeadline("") }}
                          >
                            <RotateCw size={14} />
                            {t("rfq_republish")}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
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
                className="h-10 w-full px-3 rounded-xl border border-input bg-white text-sm"
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
    </PortalLayout>
  )
}