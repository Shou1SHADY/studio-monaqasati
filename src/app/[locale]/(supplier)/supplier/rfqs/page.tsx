"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { useTranslations, useLocale } from 'next-intl'
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MapPicker } from "@/components/ui/map-picker"
import { 
  Search,
  MapPin,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  Plus,
  Trash2,
  Package,
  File,
  Download,
  MessageCircle,
  Send,
  Eye,
  EyeOff,
  Upload,
  X,
  Tag,
  ShieldCheck,
  Globe,
  CheckCircle2,
  TrendingUp,
  Archive,
  ChevronDown,
  ChevronUp
} from "lucide-react"
import { PREDEFINED_CATEGORIES, SAUDI_CITIES, displayCategory, displayCity, displaySubcategory } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useActiveCompanyName } from "@/hooks/useActiveCompanyName"
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from "@/firebase"
import { collection, query, where, orderBy, doc, addDoc, serverTimestamp, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore"
import { useSearchParams } from "next/navigation"
import { useRouter } from "@/i18n/routing"
import { useStorage } from "@/firebase"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import { SubmitOfferDialog } from "@/components/supplier/SubmitOfferDialog"

export default function AvailableRfqsPage() {
  const t = useTranslations("Portal.Supplier")
  const locale = useLocale()
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "")
  const [deadlineFilter, setDeadlineFilter] = useState<"all" | "week" | "month" | "custom">("all")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [selectedCity, setSelectedCity] = useState<string>("all")
  const [customDeadline, setCustomDeadline] = useState("")
  const [selectedRfq, setSelectedRfq] = useState<{id: string, title: string, quantity?: string, unitOfMeasure?: string, contractorId?: string, products?: any[], notes?: string, pdfUrl?: string, category?: string, subCategory?: string, city?: string, district?: string, deadline?: string, locationCoords?: any, offersCount?: number, status?: string, paymentTerms?: string, createdAt?: string, requiresWarranty?: boolean, isFromMdmak?: boolean, estimatedBudget?: number} | null>(null)

  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const activeFilterCount = [deadlineFilter !== "all", selectedCategory !== "all", selectedCity !== "all"].filter(Boolean).length
  const hasActiveFilters = searchQuery || activeFilterCount > 0
  const clearFilters = () => {
    setSearchQuery("")
    setDeadlineFilter("all")
    setSelectedCategory("all")
    setSelectedCity("all")
    setCustomDeadline("")
  }
  const getRemainingTime = (dateString: string) => {
    if (!dateString) return "";
    const deadline = new Date(dateString);
    deadline.setHours(23, 59, 59, 999);
    const now = new Date();
    const diff = deadline.getTime() - now.getTime();
    if (diff < 0) return t("expired");
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return t("expires_today");
    if (days === 1) return t("expires_tomorrow");
    if (days === 2) return t("expires_in_two_days");
    return t("remaining_days", { count: days });
  }

  const [showRfqDetails, setShowRfqDetails] = useState(false)
  const [showSubmitOffer, setShowSubmitOffer] = useState(false)
  const [archivingRfqId, setArchivingRfqId] = useState<string | null>(null)
  const [showArchivedRfqs, setShowArchivedRfqs] = useState(false)
  const [showInquiries, setShowInquiries] = useState(false)
  const [newQuestion, setNewQuestion] = useState("")
  const [isSubmittingQuestion, setIsSubmittingQuestion] = useState(false)
  
  const firestore = useFirestore()
  const storage = useStorage()
  const { user, isUserLoading } = useUser()

  useEffect(() => {
    setSearchQuery(searchParams.get("search") || "")
  }, [searchParams])

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  
  const { data: profile } = useDoc(userDocRef)
  const activeCompanyName = useActiveCompanyName(profile, user?.uid)

  const inquiriesQuery = useMemoFirebase(() => {
    if (!firestore || !selectedRfq?.id) return null
    return query(
      collection(firestore, "rfqs", selectedRfq.id, "inquiries"),
      orderBy("createdAt", "desc")
    )
  }, [firestore, selectedRfq?.id])

  const { data: inquiries, isLoading: inquiriesLoading } = useCollection(inquiriesQuery)

  // ✅ تطبيق نمط الحماية: العودة بـ null طالما أن حالة المستخدم لم تكتمل
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null

    let q = query(
      collection(firestore, "rfqs"),
      where("status", "in", ["New", "Awarded"]),
      where("visibility", "==", "public")
    )

    if (selectedCategory !== "all") {
      q = query(q, where("category", "==", selectedCategory))
    }
    if (selectedCity !== "all") {
      q = query(q, where("city", "==", selectedCity))
    }

    return q
  }, [firestore, user, isUserLoading, selectedCategory, selectedCity])

  const supplierOrgId = (profile as any)?.organizationId || user?.uid

  // Private RFQ query: RFQs where this supplier's org is in allowedSupplierOrgIds
  const privateRfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !profile || !supplierOrgId) return null
    return query(
      collection(firestore, "rfqs"),
      where("allowedSupplierOrgIds", "array-contains", supplierOrgId)
    )
  }, [firestore, user, isUserLoading, profile, supplierOrgId])

  const { data: allRfqs, isLoading: isCollectionLoading } = useCollection(rfqsQuery)
  const { data: privateRfqs, isLoading: isPrivateLoading } = useCollection(privateRfqsQuery)
  const isLoading = isUserLoading || isCollectionLoading || isPrivateLoading

  // Merge public + private RFQs, deduplicate by id, filter to active statuses
  const allCombinedRfqs = useMemo(() => {
    const combined = [...(allRfqs || []), ...(privateRfqs || []).filter((r: any) => ["New", "Awarded"].includes(r.status))]
    const seen = new Set<string>()
    return combined.filter((rfq: any) => {
      if (seen.has(rfq.id)) return false
      seen.add(rfq.id)
      return true
    })
  }, [allRfqs, privateRfqs])

  const archivedRfqIds: string[] = (profile as any)?.archivedRfqIds || []

  // Client-side filtering by specializations and sorting.
  // A supplier explicitly targeted via allowedSupplierOrgIds (invited/connected
  // to the publishing contractor) sees the RFQ regardless of specialization —
  // being invited is itself the relevance signal, not a category match.
  const allMatchingRfqs = allCombinedRfqs
    ? [...allCombinedRfqs]
        .filter((rfq: any) => {
          if (supplierOrgId && (rfq.allowedSupplierOrgIds || []).includes(supplierOrgId)) return true;
          if (!profile?.specializations?.length) return false;
          return profile.specializations.includes(rfq.category);
        })
        .sort((a: any, b: any) => {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return bTime - aTime
        })
    : [];

  const rfqs = allMatchingRfqs.filter((rfq: any) => !archivedRfqIds.includes(rfq.id))
  const archivedRfqsList = allMatchingRfqs.filter((rfq: any) => archivedRfqIds.includes(rfq.id))

  // Auto-archive awarded RFQs
  useEffect(() => {
    if (!firestore || !user || !allMatchingRfqs.length) return
    const toArchive = allMatchingRfqs
      .filter((rfq: any) => rfq.status === "Awarded" && !archivedRfqIds.includes(rfq.id))
      .map((rfq: any) => rfq.id)
    if (!toArchive.length) return
    updateDoc(doc(firestore, "users", user.uid), {
      archivedRfqIds: arrayUnion(...toArchive)
    }).catch(() => {})
  }, [allMatchingRfqs, archivedRfqIds, firestore, user])

  const handleArchiveRfq = async (rfqId: string) => {
    if (!firestore || !user) return
    setArchivingRfqId(rfqId)
    try {
      await updateDoc(doc(firestore, "users", user.uid), {
        archivedRfqIds: arrayUnion(rfqId)
      })
      toast({ title: t("rfq_archive_success"), description: t("rfq_archive_success_desc") })
    } catch {
      toast({ title: t("error_title"), description: t("rfq_archive_failed"), variant: "destructive" })
    } finally {
      setArchivingRfqId(null)
    }
  }

  const filteredRfqs = rfqs.filter((rfq: any) => {
    // Exclude expired tenders only for New status (Awarded ones may have passed deadline)
    if (rfq.status === "New" && rfq.deadline) {
      const deadline = new Date(rfq.deadline);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      if (deadline < now) return false;
    }

    // Search query filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesSearch = (
        rfq.title?.toLowerCase().includes(q) ||
        rfq.category?.toLowerCase().includes(q) ||
        rfq.subCategory?.toLowerCase().includes(q) ||
        rfq.city?.toLowerCase().includes(q) ||
        rfq.district?.toLowerCase().includes(q)
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
  }) || [];

  const submitQuestion = async () => {
    if (!user || !firestore || !selectedRfq?.id || !newQuestion.trim()) return
    setIsSubmittingQuestion(true)
    try {
      await addDoc(collection(firestore, "rfqs", selectedRfq.id, "inquiries"), {
        question: newQuestion.trim(),
        supplierId: user.uid,
        organizationId: profile?.organizationId || user.uid,
        userId: user.uid,
        supplierName: activeCompanyName || t("generic_supplier"),
        submittedByUserId: user.uid,
        submittedByUserName: profile?.name || user.email || t("generic_team_member"),
        createdAt: new Date().toISOString(),
        reply: null,
        repliedAt: null
      })
      setNewQuestion("")
      toast({ title: t("question_sent_title"), description: t("question_sent_desc") })
    } catch (error) {
      toast({ title: t("error_title"), description: t("question_failed"), variant: "destructive" })
    } finally {
      setIsSubmittingQuestion(false)
    }
  }


  return (
    <PortalLayout>
      <div className={cn("space-y-8", locale === 'ar' ? 'text-right' : 'text-left')}>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("rfqs_page_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("rfqs_page_desc")}</p>
          </div>
          <div className="flex flex-col gap-2 w-full md:w-auto">
            {/* Search bar + mobile filter toggle */}
            <div className="flex gap-2">
              <div className="relative flex-1 md:w-64">
                <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder={t("search_placeholder")}
                  className="pe-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {/* Filter toggle button — mobile only */}
              <Button
                variant="outline"
                onClick={() => setShowMobileFilters(v => !v)}
                className={cn(
                  "md:hidden h-10 w-10 rounded-lg p-0 shrink-0 relative",
                  showMobileFilters && "bg-primary text-white border-primary hover:bg-primary/90 hover:text-white"
                )}
                aria-label="filters"
              >
                <Filter size={16} />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -end-1.5 h-4 w-4 rounded-full bg-accent text-white text-[9px] font-black flex items-center justify-center leading-none">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </div>

            {/* Filter controls — always visible on md+, toggle on mobile */}
            <div className={cn(
              "flex-col gap-2 md:flex md:flex-row md:flex-wrap",
              showMobileFilters ? "flex" : "hidden md:flex"
            )}>
              {/* Deadline Filter */}
              <Select value={deadlineFilter} onValueChange={(v: any) => setDeadlineFilter(v)}>
                <SelectTrigger className="w-full md:w-[140px] h-10 text-sm">
                  <SelectValue placeholder={t("deadline_filter")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("all_deadlines")}</SelectItem>
                  <SelectItem value="week">{t("within_week")}</SelectItem>
                  <SelectItem value="month">{t("within_month")}</SelectItem>
                  <SelectItem value="custom">{t("custom_date")}</SelectItem>
                </SelectContent>
              </Select>
              {deadlineFilter === "custom" && (
                <input
                  type="date"
                  value={customDeadline}
                  onChange={e => setCustomDeadline(e.target.value)}
                  className="h-10 px-3 rounded-md border border-input bg-white text-sm w-full md:w-[140px]"
                />
              )}

              {/* Category Filter */}
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-full md:w-[200px] h-10 text-sm">
                  <SelectValue placeholder={t("category")} />
                </SelectTrigger>
                <SelectContent className="max-h-72 overflow-y-auto">
                  <SelectItem value="all">{t("all_categories")}</SelectItem>
                  {PREDEFINED_CATEGORIES.map(cat => (
                    <SelectItem key={cat} value={cat}>{displayCategory(cat, locale)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* City Filter */}
              <Select value={selectedCity} onValueChange={setSelectedCity}>
                <SelectTrigger className="w-full md:w-[200px] h-10 text-sm">
                  <SelectValue placeholder={t("city")} />
                </SelectTrigger>
                <SelectContent className="max-h-72 overflow-y-auto">
                  <SelectItem value="all">{t("all_cities")}</SelectItem>
                  {SAUDI_CITIES.map(city => (
                    <SelectItem key={city} value={city}>{displayCity(city, locale)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-10 text-xs text-muted-foreground hover:text-destructive gap-1 w-full md:w-auto justify-center"
                >
                  <X size={12} />
                  {t("clear_filters")}
                </Button>
              )}
            </div>
          </div>
         </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {isLoading ? (
            <div className="col-span-full p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="animate-spin text-primary" size={40} />
              <p className="font-medium animate-pulse">{t("loading_rfqs")}</p>
            </div>
          ) : filteredRfqs.length === 0 ? (
            <div className="col-span-full p-20 text-center flex flex-col items-center gap-3 text-muted-foreground bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200">
              <Search size={48} className="opacity-20" />
              <p className="text-lg font-bold text-slate-600">{t("no_matching_rfqs")}</p>
              <p className="text-sm">{t("no_matching_rfqs_desc")}</p>
            </div>
          ) : (
            filteredRfqs.map((rfq: any) => (
              <Card key={rfq.id} className="group relative overflow-hidden border-slate-200/60 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 bg-white/60 backdrop-blur-xl flex flex-col">
                <CardContent className="p-5 flex flex-col flex-1">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-none px-2.5 py-1">
                        {displayCategory(rfq.category, locale)}
                      </Badge>
                      {rfq.subCategory && (
                        <Badge variant="outline" className="text-slate-600 border-slate-200 bg-white/50 px-2.5 py-1">
                          {displaySubcategory(rfq.subCategory, locale)}
                        </Badge>
                      )}
                      {rfq.requiresWarranty && (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200 px-2.5 py-1 gap-1">
                          <ShieldCheck size={11} />
                          {t("rfq_warranty_required_badge")}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {rfq.status === "Awarded" ? (
                        <Badge className="bg-blue-50 text-blue-600 border-blue-200 text-[10px] px-2 py-0.5 gap-1">
                          <CheckCircle2 size={9} />
                          {t("rfq_status_awarded")}
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-50 text-emerald-600 border-emerald-200 text-[10px] px-2 py-0.5 gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {t("rfq_status_new")}
                        </Badge>
                      )}
                      <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-2 py-1 rounded-md">{rfq.id.substring(0, 8)}</span>
                    </div>
                  </div>
                  
                  <div className="space-y-1 mb-5 flex-1">
                    <h3 className="text-lg font-bold text-slate-800 group-hover:text-primary transition-colors line-clamp-2">
                      {rfq.title}
                    </h3>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-slate-600 bg-slate-50 w-fit px-2 py-1 rounded-md mt-2">
                      <Package size={14} className="text-primary" />
                      {rfq.products && rfq.products.length > 0 
                        ? t("products_count", { count: rfq.products.length })
                        : t("quantity_label", { quantity: rfq.quantity, unit: rfq.unitOfMeasure })
                      }
                    </div>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-slate-100/80 mb-5">
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                        <MapPin size={12} className="text-blue-600" />
                      </div>
                      <span className="truncate">{displayCity(rfq.city, locale)} - {displayCity(rfq.district, locale)}</span>
                      {rfq.locationCoords && (
                        <a 
                          href={`https://www.google.com/maps/search/?api=1&query=${rfq.locationCoords.lat},${rfq.locationCoords.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] bg-blue-100/50 text-blue-700 px-2 py-0.5 rounded-full hover:bg-blue-200 transition-colors mr-auto shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t("map_label")}
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-600" suppressHydrationWarning>
                      <div className="w-6 h-6 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                        <Calendar size={12} className="text-amber-600" />
                      </div>
                      {t("deadline_label")}: <span className="font-bold text-slate-700">{rfq.deadline ? new Date(rfq.deadline).toLocaleDateString(locale) : t("not_specified")}</span>
                      {rfq.deadline && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold mr-1 ${
                          new Date(rfq.deadline).getTime() < new Date().getTime() 
                            ? 'bg-red-100 text-red-600' 
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {getRemainingTime(rfq.deadline)}
                        </span>
                      )}
                      {rfq.pdfUrl && (
                        <a 
                          href={rfq.pdfUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          download
                          className="mr-auto flex items-center gap-1 text-[10px] bg-blue-100/50 text-blue-700 px-2 py-0.5 rounded-full hover:bg-blue-200 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <File size={10} />
                          PDF
                        </a>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        setSelectedRfq({ id: rfq.id, title: rfq.title, quantity: rfq.quantity, unitOfMeasure: rfq.unitOfMeasure, contractorId: rfq.contractorId, products: rfq.products, notes: rfq.notes, pdfUrl: rfq.pdfUrl, category: rfq.category, subCategory: rfq.subCategory, city: rfq.city, district: rfq.district, deadline: rfq.deadline, locationCoords: rfq.locationCoords, offersCount: rfq.offersCount, status: rfq.status, paymentTerms: rfq.paymentTerms, createdAt: rfq.createdAt, requiresWarranty: rfq.requiresWarranty, isFromMdmak: rfq.isFromMdmak })
                        setShowRfqDetails(true)
                      }}
                      variant="outline"
                      className="flex-1 gap-2 rounded-xl h-11 bg-transparent text-slate-700 hover:bg-transparent hover:text-primary transition-all border-slate-200 hover:border-primary/50"
                    >
                      <Eye size={16} />
                      {t("details")}
                    </Button>
                    {rfq.status === "Awarded" ? (
                      <Button
                        onClick={() => handleArchiveRfq(rfq.id)}
                        disabled={archivingRfqId === rfq.id}
                        variant="outline"
                        className="flex-[2] gap-2 rounded-xl h-11 border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-all"
                      >
                        {archivingRfqId === rfq.id
                          ? <Loader2 size={15} className="animate-spin" />
                          : <Archive size={15} />}
                        {t("rfq_archive_btn")}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => {
                          setSelectedRfq({ id: rfq.id, title: rfq.title, quantity: rfq.quantity, unitOfMeasure: rfq.unitOfMeasure, contractorId: rfq.contractorId, products: rfq.products, notes: rfq.notes, pdfUrl: rfq.pdfUrl, category: rfq.category, subCategory: rfq.subCategory, city: rfq.city, district: rfq.district, deadline: rfq.deadline, locationCoords: rfq.locationCoords, offersCount: rfq.offersCount, status: rfq.status, paymentTerms: rfq.paymentTerms, createdAt: rfq.createdAt, requiresWarranty: rfq.requiresWarranty, isFromMdmak: rfq.isFromMdmak })
                          setShowSubmitOffer(true)
                        }}
                        className="flex-[2] gap-2 bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-xl h-11 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 group"
                      >
                        {t("submit_offer")}
                        <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform rtl:rotate-0 ltr:rotate-180" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
        {/* Archived RFQs Section */}
        {archivedRfqsList.length > 0 && (
          <div>
            <button
              onClick={() => setShowArchivedRfqs(v => !v)}
              className={cn("flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3", locale === 'ar' ? 'flex-row-reverse' : '')}
            >
              {showArchivedRfqs ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              <Archive size={14} />
              {t("archived_rfqs_title")} ({archivedRfqsList.length})
            </button>
            {showArchivedRfqs && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {archivedRfqsList.map((rfq: any) => (
                  <Card key={rfq.id} className="relative overflow-hidden border-dashed border-slate-200 bg-slate-50/50 opacity-60 flex flex-col">
                    <CardContent className="p-5 flex flex-col flex-1">
                      <div className="flex items-start justify-between mb-3">
                        <Badge variant="secondary" className="bg-primary/10 text-primary border-none text-xs">
                          {displayCategory(rfq.category, locale)}
                        </Badge>
                        <Badge className="bg-slate-100 text-slate-500 border-none text-[10px] gap-1">
                          <Archive size={9} />
                          {t("archived_label")}
                        </Badge>
                      </div>
                      <h3 className="text-sm font-bold text-slate-700 line-clamp-2 flex-1 mb-3">{rfq.title}</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs text-muted-foreground hover:text-destructive gap-1.5"
                        onClick={async () => {
                          if (!firestore || !user) return
                          await updateDoc(doc(firestore, "users", user.uid), {
                            archivedRfqIds: arrayRemove(rfq.id)
                          })
                        }}
                      >
                        {t("unarchive_rfq")}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <SubmitOfferDialog 
        selectedRfq={selectedRfq} 
        isOpen={showSubmitOffer}
        onClose={() => {
          setShowSubmitOffer(false)
          if (!showRfqDetails) setSelectedRfq(null)
        }} 
        onSuccess={() => {
          setShowSubmitOffer(false)
          setSelectedRfq(null)
        }}
      />

      {/* RFQ Details Dialog */}
      <Dialog open={showRfqDetails} onOpenChange={(open) => { if (!open) { setShowRfqDetails(false); setShowInquiries(false); } }}>
        <DialogContent
          className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-3xl text-right rounded-2xl p-0 overflow-hidden max-h-[94dvh] flex flex-col gap-0 border-none shadow-2xl"
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{t("rfq_details_title")}</DialogTitle>

          {/* HERO HEADER */}
          <div className="relative px-5 pl-12 pt-5 pb-5 border-b bg-gradient-to-bl from-primary/8 via-primary/3 to-white shrink-0 overflow-hidden">
            <div className="absolute -top-8 -end-8 w-32 h-32 bg-primary/5 rounded-full blur-2xl pointer-events-none" />
            <div className="relative flex items-start gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Tag size={16} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 text-[10px] font-black px-2 py-0.5 rounded-full border border-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {t("rfq_status_new")}
                  </span>
                  {selectedRfq?.id && (
                    <span className="text-[10px] text-slate-400 font-mono bg-white/70 px-2 py-0.5 rounded-md border border-slate-200">
                      #{selectedRfq.id.substring(0, 8).toUpperCase()}
                    </span>
                  )}
                  {selectedRfq?.requiresWarranty && (
                    <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-full border border-amber-200">
                      <ShieldCheck size={10} />
                      {t("rfq_warranty_required_badge")}
                    </span>
                  )}
                </div>
                <h2 className="text-lg sm:text-xl font-black text-slate-800 leading-tight">{selectedRfq?.title}</h2>
                <div className="flex flex-wrap items-center gap-2 mt-2.5">
                  {selectedRfq?.category && (
                    <Badge variant="secondary" className="bg-primary/10 text-primary border-none font-bold text-xs">
                      {displayCategory(selectedRfq.category, locale)}
                    </Badge>
                  )}
                  {selectedRfq?.subCategory && (
                    <Badge variant="outline" className="text-slate-600 border-slate-200 bg-white/70 font-medium text-xs">
                      {displaySubcategory(selectedRfq.subCategory, locale)}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 px-5 py-5 space-y-4">
            {/* HERO STATS: Location & Deadline + Offers Count */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="flex flex-col gap-1.5 p-3.5 rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/5 to-transparent">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  <MapPin size={11} className="text-primary" />
                  <span>{t("city_label")}</span>
                </div>
                <p className="text-sm font-bold text-slate-800 leading-tight">
                  {selectedRfq?.city && selectedRfq?.district
                    ? `${displayCity(selectedRfq.city, locale)} - ${displayCity(selectedRfq.district, locale)}`
                    : selectedRfq?.city
                      ? displayCity(selectedRfq.city, locale)
                      : t("not_specified")}
                </p>
                {selectedRfq?.locationCoords && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${selectedRfq.locationCoords.lat},${selectedRfq.locationCoords.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-primary underline hover:text-primary/70 transition-colors font-medium w-fit mt-0.5"
                  >
                    {t("view_on_map")}
                  </a>
                )}
              </div>
              <div className="flex flex-col gap-1.5 p-3.5 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50/60 to-transparent">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                  <Calendar size={11} className="text-amber-600" />
                  <span>{t("deadline_label")}</span>
                </div>
                <p className="text-sm font-bold text-slate-800 leading-tight" suppressHydrationWarning>
                  {selectedRfq?.deadline ? new Date(selectedRfq.deadline).toLocaleDateString(locale) : t("not_specified")}
                </p>
                {selectedRfq?.deadline && (
                  <span className="text-[11px] text-amber-700 font-bold mt-0.5">
                    {getRemainingTime(selectedRfq.deadline)}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5 p-3.5 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-transparent">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <TrendingUp size={11} className="text-slate-500" />
                  <span>{t("estimated_budget_label")}</span>
                </div>
                <p className="text-sm font-bold text-slate-800 leading-tight" dir="ltr">
                  {selectedRfq?.estimatedBudget ? (
                    <span className="text-xl font-black text-primary">{Number(selectedRfq.estimatedBudget).toLocaleString(locale === "ar" ? "ar-SA" : "en-US")} {locale === "ar" ? "ر.س" : "SAR"}</span>
                  ) : (
                    <span className="text-sm font-bold text-slate-400">{t("estimated_budget_not_set")}</span>
                  )}
                </p>
              </div>
            </div>

            {/* Products */}
            {selectedRfq?.products && selectedRfq.products.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className={`font-bold text-slate-700 flex items-center gap-2 text-sm ${locale === 'ar' ? 'text-right' : ''}`}>
                    <Package size={15} className="text-primary" />
                    {t("required_products")}
                  </h3>
                  <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20 font-bold">
                    {selectedRfq.products.length}
                  </Badge>
                </div>
                <div className="grid gap-2">
                  {selectedRfq.products.map((prod: any, idx: number) => (
                    <div key={idx} className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-primary/30 hover:shadow-md transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <span className="bg-primary text-white text-[10px] font-black w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5">{idx + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-sm text-slate-800">{prod.name}</p>
                            {prod.subCategory && (
                              <div className="mt-1">
                                <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded">{displaySubcategory(prod.subCategory, locale)}</span>
                              </div>
                            )}
                            {prod.description && <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{prod.description}</p>}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 bg-primary/5 px-3 py-2 rounded-lg shrink-0 min-w-[80px]">
                          <span className="font-black text-primary text-base leading-none" dir="ltr">{prod.quantity}</span>
                          <span className="text-[10px] text-slate-500 font-medium">{prod.unitOfMeasure}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {selectedRfq?.notes && (
              <div className="p-4 bg-gradient-to-br from-amber-50/60 to-white rounded-xl border border-amber-100 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <MessageCircle size={14} className="text-amber-700" />
                  <h3 className={`font-bold text-amber-800 text-sm ${locale === 'ar' ? 'text-right' : ''}`}>
                    {t("additional_notes")}
                  </h3>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{selectedRfq.notes}</p>
              </div>
            )}

            {/* PDF */}
            {selectedRfq?.pdfUrl && (
              <div className="flex items-center gap-3 p-4 bg-blue-50/60 rounded-xl border border-blue-100 shadow-sm">
                <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                  <File size={20} className="text-blue-600" />
                </div>
                <span className="flex-1 text-sm font-bold text-slate-700">{t("pdf_attached")}</span>
                <a href={selectedRfq.pdfUrl} target="_blank" rel="noopener noreferrer" download>
                  <Button variant="outline" size="sm" className="gap-1 bg-white border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all">
                    <Download size={14} />
                    {t("download")}
                  </Button>
                </a>
              </div>
            )}

            {/* Inquiries Section */}
            <div className="border-t border-slate-100 pt-3">
              <Button
                variant="ghost"
                onClick={() => setShowInquiries(!showInquiries)}
                className="w-full justify-between hover:bg-slate-50 h-11 rounded-xl px-3"
              >
                <span className={`font-bold text-slate-700 flex items-center gap-2 text-sm ${locale === 'ar' ? 'text-right' : ''}`}>
                  <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <MessageCircle size={14} className="text-primary" />
                  </div>
                  {t("inquiries")}
                  {inquiries && inquiries.length > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20 font-bold h-5">
                      {inquiries.length}
                    </Badge>
                  )}
                </span>
                {showInquiries ? <ChevronRight size={16} className="text-slate-400" /> : <ChevronLeft size={16} className="text-slate-400" />}
              </Button>

              {showInquiries && (
                <div className="mt-2.5 space-y-2.5">
                  {/* Question Form */}
                  <div className="flex gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                    <Input
                      placeholder={t("ask_question_placeholder")}
                      value={newQuestion}
                      onChange={(e) => setNewQuestion(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && newQuestion.trim() && !isSubmittingQuestion) submitQuestion() }}
                      className="flex-1 h-10 rounded-lg bg-white border-slate-200"
                    />
                    <Button onClick={submitQuestion} disabled={!newQuestion.trim() || isSubmittingQuestion} size="icon" className="h-10 w-10 rounded-lg shadow-sm">
                      {isSubmittingQuestion ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </Button>
                  </div>

                  {/* Questions List */}
                  {inquiriesLoading ? (
                    <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
                  ) : inquiries && inquiries.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {inquiries.map((inq: any) => (
                        <div key={inq.id} className={`p-3 rounded-xl ${inq.supplierId === user?.uid ? 'bg-primary/5 border border-primary/20' : 'bg-slate-50 border border-slate-100'}`}>
                          <div className="flex items-start gap-2">
                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <MessageCircle size={12} className="text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-700">{inq.supplierName}</p>
                              <p className="text-sm text-slate-600 leading-relaxed">{inq.question}</p>
                              {inq.reply && (
                                <div className="mt-2 p-2.5 bg-green-50 rounded-lg border border-green-200">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <CheckCircle2 size={12} className="text-green-600" />
                                    <p className="text-xs font-bold text-green-700">{t("reply_from_contractor")}</p>
                                  </div>
                                  <p className="text-sm text-green-800 leading-relaxed">{inq.reply}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6 bg-slate-50 rounded-xl border border-dashed">{t("no_inquiries_yet")}</p>
                  )}
                </div>
              )}
            </div>

          </div>

          {/* Sticky Bottom CTA */}
          <div className="px-5 py-3.5 border-t bg-gradient-to-t from-slate-50/50 to-white shrink-0 flex gap-2.5 shadow-[0_-4px_20px_rgba(15,23,42,0.04)]">
            <Button variant="outline" className="flex-1 h-11 rounded-xl border-slate-200 hover:bg-slate-50 font-bold" onClick={() => { setShowRfqDetails(false); setShowInquiries(false); }}>
              {t("close")}
            </Button>
            <Button className="flex-[2.5] bg-gradient-to-l from-success to-emerald-600 hover:from-success/90 hover:to-emerald-600/90 gap-2 h-11 rounded-xl shadow-lg shadow-success/25 hover:shadow-xl hover:shadow-success/30 transition-all font-black text-white group active:scale-[0.98]" onClick={() => { setShowRfqDetails(false); setShowSubmitOffer(true) }}>
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
              {t("submit_price_offer")}
              <ChevronLeft size={16} className="rtl:rotate-0 ltr:rotate-180 group-hover:-translate-x-1 transition-transform" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </PortalLayout>
  )
}