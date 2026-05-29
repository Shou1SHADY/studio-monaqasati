"use client"

import { useState, useEffect, useRef } from "react"
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
  Star,
  Award
} from "lucide-react"
import { PREDEFINED_CATEGORIES, SAUDI_CITIES, displayCategory, displayCity, displaySubcategory } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from "@/firebase"
import { collection, query, where, orderBy, doc, addDoc, serverTimestamp } from "firebase/firestore"
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
  const [selectedRfq, setSelectedRfq] = useState<{id: string, title: string, quantity?: string, unitOfMeasure?: string, contractorId?: string, products?: any[], notes?: string, pdfUrl?: string, category?: string, subCategory?: string, city?: string, district?: string, deadline?: string, locationCoords?: any} | null>(null)

  const hasActiveFilters = searchQuery || deadlineFilter !== "all" || selectedCategory !== "all" || selectedCity !== "all"
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
  const [showInquiries, setShowInquiries] = useState(false)
  const [showContractorReviews, setShowContractorReviews] = useState(false)
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

  const inquiriesQuery = useMemoFirebase(() => {
    if (!firestore || !selectedRfq?.id) return null
    return query(
      collection(firestore, "rfqs", selectedRfq.id, "inquiries"),
      orderBy("createdAt", "desc")
    )
  }, [firestore, selectedRfq?.id])

  const { data: inquiries, isLoading: inquiriesLoading } = useCollection(inquiriesQuery)

  const contractorDocRef = useMemoFirebase(() => {
    if (!firestore || !selectedRfq?.contractorId) return null;
    return doc(firestore, "users", selectedRfq.contractorId)
  }, [firestore, selectedRfq?.contractorId])
  const { data: contractorInfo } = useDoc(contractorDocRef)

  const contractorReviewsQuery = useMemoFirebase(() => {
    if (!firestore || !selectedRfq?.contractorId) return null
    return query(
      collection(firestore, "reviews"),
      where("revieweeId", "==", selectedRfq.contractorId)
    )
  }, [firestore, selectedRfq?.contractorId])
  const { data: contractorReviews } = useCollection(contractorReviewsQuery)

  // ✅ تطبيق نمط الحماية: العودة بـ null طالما أن حالة المستخدم لم تكتمل
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    
    let q = query(
      collection(firestore, "rfqs"),
      where("status", "==", "New"),
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

  const { data: allRfqs, isLoading: isCollectionLoading } = useCollection(rfqsQuery)
  const isLoading = isUserLoading || isCollectionLoading

  // Client-side filtering by specializations and sorting
  const rfqs = allRfqs
    ? [...allRfqs]
        .filter((rfq: any) => {
          if (!profile?.specializations?.length) return false;
          return profile.specializations.includes(rfq.category);
        })
        .sort((a: any, b: any) => {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return bTime - aTime
        })
    : [];

  const filteredRfqs = rfqs.filter((rfq: any) => {
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
        supplierName: profile?.companyName || profile?.name || t("generic_supplier"),
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
            <h1 className="text-3xl font-bold text-secondary font-headline">{t("rfqs_page_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("rfqs_page_desc")}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder={t("search_placeholder")} 
                className="pr-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {/* Deadline Filter */}
              <Select value={deadlineFilter} onValueChange={(v: any) => setDeadlineFilter(v)}>
                <SelectTrigger className="w-[140px] h-10 text-sm">
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
                  className="h-10 px-3 rounded-md border border-input bg-white text-sm w-[140px]"
                />
              )}

              {/* Category Filter */}
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-[200px] h-10 text-sm">
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
                <SelectTrigger className="w-[200px] h-10 text-sm">
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
                   className="h-10 text-xs text-muted-foreground hover:text-destructive gap-1"
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
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-2 py-1 rounded-md">{rfq.id.substring(0, 8)}</span>
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
                        setSelectedRfq({
                          id: rfq.id, 
                          title: rfq.title,
                          quantity: rfq.quantity,
                          unitOfMeasure: rfq.unitOfMeasure,
                          contractorId: rfq.contractorId,
                          products: rfq.products,
                          notes: rfq.notes,
                          pdfUrl: rfq.pdfUrl,
                          category: rfq.category,
                          subCategory: rfq.subCategory,
                          city: rfq.city,
                          district: rfq.district,
                          deadline: rfq.deadline,
                          locationCoords: rfq.locationCoords
                        })
                        setShowRfqDetails(true)
                      }}
                      variant="outline"
                      className="flex-1 gap-2 rounded-xl h-11 bg-transparent text-slate-700 hover:bg-transparent hover:text-primary transition-all border-slate-200 hover:border-primary/50"
                    >
                      <Eye size={16} />
                      {t("details")}
                    </Button>
                    <Button 
                      onClick={() => {
                        setSelectedRfq({
                          id: rfq.id, 
                          title: rfq.title,
                          quantity: rfq.quantity,
                          unitOfMeasure: rfq.unitOfMeasure,
                          contractorId: rfq.contractorId,
                          products: rfq.products,
                          notes: rfq.notes,
                          pdfUrl: rfq.pdfUrl,
                          category: rfq.category,
                          subCategory: rfq.subCategory,
                          city: rfq.city,
                          district: rfq.district,
                          deadline: rfq.deadline,
                          locationCoords: rfq.locationCoords
                        })
                        setShowSubmitOffer(true)
                      }}
                      className="flex-[2] gap-2 bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-xl h-11 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 group"
                    >
                      {t("submit_offer")}
                      <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
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
      <Dialog open={showRfqDetails} onOpenChange={(open) => { if (!open) { setShowRfqDetails(false); setShowInquiries(false); setShowContractorReviews(false); } }}>
        <DialogContent
          className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-2xl text-right rounded-2xl p-0 overflow-hidden max-h-[92dvh] flex flex-col gap-0"
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{t("rfq_details_title")}</DialogTitle>
          
          <div className="px-5 pt-5 pb-3 border-b bg-gradient-to-bl from-primary/5 to-white shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">{selectedRfq?.title}</h2>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="secondary" className="bg-primary/10 text-primary">{selectedRfq?.category}</Badge>
              {selectedRfq?.subCategory && <Badge variant="outline">{selectedRfq?.subCategory}</Badge>}
            </div>
          </div>

          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            {/* Products */}
            {selectedRfq?.products && selectedRfq.products.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-bold text-slate-700 flex items-center gap-2">
                  <Package size={16} className="text-primary" />
                  {t("required_products")}
                </h3>
                <div className="space-y-2">
                  {selectedRfq.products.map((prod: any, idx: number) => (
                    <div key={idx} className="p-3 bg-slate-50 rounded-lg border">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-800">{prod.name}</span>
                        <span className="text-sm text-primary font-bold">{prod.quantity} {prod.unitOfMeasure}</span>
                      </div>
                      {prod.subCategory && (
                        <div className="mt-1">
                          <span className="inline-block px-2 py-0.5 bg-slate-200 text-slate-600 text-[10px] font-bold rounded">{displaySubcategory(prod.subCategory, locale)}</span>
                        </div>
                      )}
                      {prod.description && <p className="text-sm text-slate-600 mt-1">{prod.description}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {selectedRfq?.notes && (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                <h3 className="font-bold text-amber-800 text-sm mb-1">{t("additional_notes")}</h3>
                <p className="text-sm text-amber-900">{selectedRfq.notes}</p>
              </div>
            )}

            {/* PDF */}
            {selectedRfq?.pdfUrl && (
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <File size={20} className="text-blue-600" />
                <span className="flex-1 text-sm font-medium text-blue-800">{t("pdf_attached")}</span>
                <a href={selectedRfq.pdfUrl} target="_blank" rel="noopener noreferrer" download>
                  <Button variant="outline" size="sm" className="gap-1">
                    <Download size={14} />
                    {t("download")}
                  </Button>
                </a>
              </div>
            )}

            {/* Location & Deadline */}
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2 text-slate-600">
                <MapPin size={14} className="text-primary" />
                <span>{selectedRfq?.city} - {selectedRfq?.district}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <Calendar size={14} className="text-amber-600" />
                <span>{t("deadline_label")}: {selectedRfq?.deadline ? new Date(selectedRfq.deadline).toLocaleDateString(locale) : t("not_specified")}</span>
              </div>
            </div>

            {/* Inquiries Section */}
            <div className="border-t pt-4">
              <Button 
                variant="ghost" 
                onClick={() => setShowInquiries(!showInquiries)} 
                className="w-full justify-between hover:bg-slate-50"
              >
                <span className="font-bold text-slate-700 flex items-center gap-2">
                  <MessageCircle size={16} className="text-primary" />
                  {t("inquiries")}
                </span>
                {showInquiries ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </Button>

              {showInquiries && (
                <div className="mt-3 space-y-3">
                  {/* Question Form */}
                  <div className="flex gap-2">
                    <Input 
                      placeholder={t("ask_question_placeholder")} 
                      value={newQuestion}
                      onChange={(e) => setNewQuestion(e.target.value)}
                      className="flex-1"
                    />
                    <Button onClick={submitQuestion} disabled={!newQuestion.trim() || isSubmittingQuestion} size="icon">
                      {isSubmittingQuestion ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </Button>
                  </div>

                  {/* Questions List */}
                  {inquiriesLoading ? (
                    <div className="flex justify-center py-4"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
                  ) : inquiries && inquiries.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {inquiries.map((inq: any) => (
                        <div key={inq.id} className={`p-3 rounded-lg ${inq.supplierId === user?.uid ? 'bg-primary/5 border border-primary/20' : 'bg-slate-50'}`}>
                          <div className="flex items-start gap-2">
                            <MessageCircle size={14} className="text-primary mt-1 shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm font-bold text-slate-700">{inq.supplierName}</p>
                              <p className="text-sm text-slate-600">{inq.question}</p>
                              {inq.reply && (
                                <div className="mt-2 p-2 bg-green-50 rounded border border-green-200">
                                  <p className="text-xs font-bold text-green-700">{t("reply_from_contractor")}</p>
                                  <p className="text-sm text-green-800">{inq.reply}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">{t("no_inquiries_yet")}</p>
                  )}
                </div>
              )}
            </div>

            {/* Contractor Info & Reviews */}
            <div className="border-t pt-4">
              <Button 
                variant="ghost" 
                onClick={() => setShowContractorReviews(!showContractorReviews)} 
                className="w-full justify-between hover:bg-slate-50"
              >
                <span className="font-bold text-slate-700 flex items-center gap-2">
                  <Award size={16} className="text-primary" />
                  {t("contractor_info_label", { rating: (contractorInfo as any)?.rating || 0 })}
                </span>
                {showContractorReviews ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </Button>

              {showContractorReviews && (
                <div className="mt-3 space-y-4 px-2">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-800">{(contractorInfo as any)?.companyName || (contractorInfo as any)?.name || t("approved_contractor")}</h4>
                      <p className="text-sm text-slate-500 mt-1">{t("contractor_desc")}</p>
                    </div>
                    {((contractorInfo as any)?.rating || 0) > 0 && (
                      <div className="flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
                        <span className="font-bold text-sm">{(contractorInfo as any)?.rating}</span>
                        <Star size={14} className="fill-amber-400" />
                        <span className="text-[10px] text-amber-600/70 mr-1">{t("reviews_count", { count: contractorReviews?.length || 0 })}</span>
                      </div>
                    )}
                  </div>

                  {contractorReviews && contractorReviews.length > 0 ? (
                    <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                      <h4 className="font-bold text-sm text-slate-700">{t("supplier_opinions")}</h4>
                      {contractorReviews.map((review: any) => (
                        <div key={review.id} className="p-3 bg-white border border-slate-100 rounded-lg shadow-sm">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-slate-700">{review.reviewerName}</span>
                            <div className="flex items-center gap-0.5 text-amber-500">
                              <span className="text-xs font-bold">{review.rating}</span>
                              <Star size={10} className="fill-amber-400" />
                            </div>
                          </div>
                          {review.comment && (
                            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-2 rounded">
                              "{review.comment}"
                            </p>
                          )}
                          <p className="text-[10px] text-slate-400 mt-2 text-left">
                            {new Date(review.createdAt).toLocaleDateString(locale)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4 bg-slate-50 rounded-lg border border-dashed">
                      {t("no_previous_reviews")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="px-5 py-4 border-t bg-white shrink-0 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => { setShowRfqDetails(false); setShowInquiries(false); setShowContractorReviews(false); }}>
              {t("close")}
            </Button>
            <Button className="flex-1 bg-success hover:bg-success/90 gap-2" onClick={() => { setShowRfqDetails(false); setShowSubmitOffer(true) }}>
              {t("submit_price_offer")}
              <ChevronLeft size={16} />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </PortalLayout>
  )
}