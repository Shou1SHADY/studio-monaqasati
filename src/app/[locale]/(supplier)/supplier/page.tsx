"use client"

import { useState, useEffect } from "react"
import { useTranslations, useLocale } from 'next-intl'
import { displayCategory, displayCity, displaySubcategory } from "@/lib/constants"

import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { 
  MessageCircle,
  TrendingUp,
  Clock,
  History,
  ArrowUpRight,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  Activity,
  Package, 
  Handshake, 
  Send, 
  DollarSign, 
  Search,
  ChevronLeft,
  Calendar,
  MapPin,
  Eye,
  File,
  Download,
  Loader2
} from "lucide-react"
import { SubmitOfferDialog } from "@/components/supplier/SubmitOfferDialog"
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, addDoc, doc, orderBy } from "firebase/firestore"
import { useRouter } from "@/i18n/routing"
import { useToast } from "@/hooks/use-toast"

export default function SupplierDashboard() {
   const t = useTranslations("Portal.Supplier")
   const locale = useLocale()
   const router = useRouter()
   const { toast } = useToast()
   const firestore = useFirestore();
   const { user, isUserLoading } = useUser();
   const [selectedRfq, setSelectedRfq] = useState<any | null>(null)
   const [showRfqDetails, setShowRfqDetails] = useState(false)
   const [showSubmitOffer, setShowSubmitOffer] = useState(false)
   const [showInquiries, setShowInquiries] = useState(false)
   const [newQuestion, setNewQuestion] = useState("")
   const [isSubmittingQuestion, setIsSubmittingQuestion] = useState(false)
   const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

   useEffect(() => {
     if (typeof window !== "undefined") {
       const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
       setPrefersReducedMotion(mediaQuery.matches);
       const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
       mediaQuery.addEventListener("change", handler);
       return () => mediaQuery.removeEventListener("change", handler);
     }
   }, []);

   const formatActivityDate = (date: Date | null) => {
     if (!date) return null;
     const now = new Date();
     const diffMs = now.getTime() - date.getTime();
     const diffMins = Math.floor(diffMs / 60000);
     if (diffMins < 1) return t("now");
     if (diffMins < 60) return t("minutes_ago", { count: diffMins });
     const diffHours = Math.floor(diffMins / 60);
     if (diffHours < 24) return t("hours_ago", { count: diffHours });
     const diffDays = Math.floor(diffHours / 24);
     if (diffDays < 7) return t("days_ago", { count: diffDays });
     return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
   }

   const getLastActivityDate = () => {
     if (!offers || offers.length === 0) return null;
     const sortedOffers = [...offers].sort((a: any, b: any) => {
       const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
       const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
       return dateB - dateA;
     });
     const lastOffer = sortedOffers[0];
     return lastOffer?.createdAt ? new Date(lastOffer.createdAt) : null;
   }
   // Fetch supplier profile from Firestore
   const userDocRef = useMemoFirebase(() => {
     if (isUserLoading || !user || !firestore) return null
     return doc(firestore, "users", user.uid)
   }, [firestore, user, isUserLoading])
   const { data: userData } = useDoc(userDocRef)

   const rfqsQuery = useMemoFirebase(() => {
     if (isUserLoading || !user || !firestore) return null
     const specializations = userData?.specializations || []
     if (specializations.length > 0) {
       return query(
         collection(firestore, "rfqs"), 
         where("status", "==", "New"),
         where("category", "in", specializations.slice(0, 30))
       )
     }
     return query(collection(firestore, "rfqs"), where("status", "==", "New"))
   }, [firestore, user, isUserLoading, userData])

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "offers"), where("supplierId", "==", user.uid))
  }, [firestore, user, isUserLoading, userData?.organizationId])

  const inquiriesQuery = useMemoFirebase(() => {
    if (!firestore || !selectedRfq?.id) return null
    return query(
      collection(firestore, "rfqs", selectedRfq.id, "inquiries"),
      orderBy("createdAt", "desc")
    )
  }, [firestore, selectedRfq?.id])

  const { data: rfqs } = useCollection(rfqsQuery)
  const { data: offers } = useCollection(offersQuery)
  const { data: inquiries, isLoading: inquiriesLoading } = useCollection(inquiriesQuery)

  const submitQuestion = async () => {
    if (!user || !firestore || !selectedRfq?.id || !newQuestion.trim()) return
    setIsSubmittingQuestion(true)
    try {
      await addDoc(collection(firestore, "rfqs", selectedRfq.id, "inquiries"), {
        question: newQuestion.trim(),
        supplierId: user.uid,
        organizationId: userData?.organizationId || user.uid,
        userId: user.uid,
        supplierName: userData?.companyName || userData?.name || t("generic_supplier"),
        submittedByUserId: user.uid,
        submittedByUserName: userData?.name || user.email || t("generic_team_member"),
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
  
  const pendingCount = offers?.filter((o: any) => o.status === "قيد المراجعة" || o.status === "New").length || 0
  const acceptedCount = offers?.filter((o: any) => o.status === "مقبول" || o.status === "Accepted").length || 0
  const totalValue = offers?.filter((o: any) => o.status === "مقبول" || o.status === "Accepted")
    .reduce((sum: number, o: any) => sum + (parseFloat(o.price?.replace(/,/g, '')) || 0), 0) || 0

  const activeRfqs = rfqs?.filter((rfq: any) => {
    if (!rfq.deadline) return true
    const deadline = new Date(rfq.deadline)
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return deadline >= now
  }) || []

  const activeRfqsCount = activeRfqs.length
  const lastActivityDate = getLastActivityDate();

  const stats = [
    { title: t("active_orders"), value: activeRfqsCount.toString(), icon: Activity, color: "text-accent", bg: "bg-accent/10", glow: "group-hover:shadow-[0_0_20px_rgba(32,203,213,0.15)]", gradient: "group-hover:from-accent/5 group-hover:to-cyan-50/50", actionUrl: "/supplier/rfqs" },
    { title: t("pending_offers"), value: pendingCount.toString(), icon: Send, color: "text-amber-600", bg: "bg-amber-50", glow: "group-hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]", gradient: "group-hover:from-amber-50 group-hover:to-amber-100/50", actionUrl: "/supplier/offers" },
    { title: t("accepted_offers"), value: acceptedCount.toString(), icon: Handshake, color: "text-emerald-600", bg: "bg-emerald-50", glow: "group-hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]", gradient: "group-hover:from-emerald-50 group-hover:to-emerald-100/50", actionUrl: "/supplier/offers?status=Accepted" },
    { title: t("total_contracts"), value: totalValue > 1000 ? `${(totalValue/1000).toFixed(1)}k` : totalValue.toString(), icon: DollarSign, color: "text-violet-600", bg: "bg-violet-50", glow: "group-hover:shadow-[0_0_20px_rgba(139,92,246,0.15)]", gradient: "group-hover:from-violet-50 group-hover:to-violet-100/50", actionUrl: "/supplier/offers" },
  ]

  const recommendedRfqs = activeRfqs.slice(0, 3)
  return (
    <PortalLayout>
      <div className={cn("space-y-8 max-w-7xl mx-auto pb-10", locale === 'ar' ? 'text-right' : 'text-left')}>
        {/* Animated Header Section */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 sm:p-10 text-white shadow-xl">
          {!prefersReducedMotion && (
            <>
              <div className="absolute top-0 right-0 -mt-20 -mr-20 h-64 w-64 rounded-full bg-accent/20 blur-3xl mix-blend-screen" />
              <div className="absolute bottom-0 left-0 -mb-20 -ml-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl mix-blend-screen" />
            </>
          )}
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
                  {t("welcome")}، <span className="text-transparent bg-clip-text bg-gradient-to-l from-accent to-cyan-300">{userData?.companyName || userData?.name || t("partner_name")}</span>
                </h1>
                {lastActivityDate && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-xs font-medium text-white/80">
                    <Clock className="h-3 w-3" />
                    {t("last_activity")}: {formatActivityDate(new Date(lastActivityDate))}
                  </span>
                )}
              </div>
              <p className="text-slate-200 text-lg font-medium max-w-xl leading-relaxed">
                {t("dashboard_desc")}
              </p>
            </div>
            <Link href="/supplier/rfqs" className="shrink-0">
              <Button className="bg-white text-secondary hover:bg-slate-100 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_25px_rgba(255,255,255,0.5)] transition-all duration-300 h-12 px-6 rounded-xl font-bold text-base group">
                <Search className={cn("ml-2 h-5 w-5", !prefersReducedMotion && "transition-transform group-hover:scale-110")} />
                {t("browse_tenders")}
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat) => (
            <Card key={stat.title} className={cn("glass-card border-none shadow-sm overflow-hidden group hover:-translate-y-1 hover:shadow-xl transition-all duration-300", stat.gradient)}>
              <CardContent className="p-6">
                <Link href={stat.actionUrl || "#"} className="block">
                  <div className="flex items-center justify-between mb-4">
                    <div className={cn("p-3.5 rounded-lg transition-all duration-300", stat.bg, stat.glow)}>
                      <stat.icon className={cn("h-6 w-6", stat.color)} strokeWidth={2.5} />
                    </div>
                    <ArrowUpRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 group-hover:-translate-y-1 transition-all duration-300" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-bold text-muted-foreground">{stat.title}</p>
                    <p className="text-3xl font-black text-foreground tracking-tight">{stat.value}</p>
                  </div>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recommended RFQs */}
          <Card className="lg:col-span-2 shadow-sm border-slate-100 overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b bg-slate-50/50 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                  <Search size={20} />
                </div>
                <div>
                  <CardTitle className="text-lg font-bold">{t("rfqs_in_your_specialization")}</CardTitle>
                  <p className="text-xs text-muted-foreground">{t("rfqs_based_on_specialization")}</p>
                </div>
              </div>
              <Link href="/supplier/rfqs">
                <Button variant="outline" size="sm">{t("browse_all")}</Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {recommendedRfqs.length > 0 ? recommendedRfqs.map((rfq: any) => (
                  <div key={rfq.id} className="p-6 hover:bg-slate-50 transition-colors">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-3">
                        <h3 className="font-bold text-lg text-slate-800">{rfq.title}</h3>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary" className="bg-blue-50 text-blue-600 border-none px-3">
                            {displayCategory(rfq.category || rfq.categoryId, locale)}
                          </Badge>
                          <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none px-3">
                            {displayCity(rfq.city, locale)} - {displayCity(rfq.district, locale)}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-3 shrink-0">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground" suppressHydrationWarning>
                          <Calendar size={16} />
                          <span>{t("deadline")}: {rfq.deadline ? new Date(rfq.deadline).toLocaleDateString(locale) : "-"}</span>
                        </div>
                        <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0">
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
                            className="flex-1 md:flex-none gap-2 rounded-full h-9 text-slate-700 bg-transparent hover:bg-transparent hover:text-primary transition-all border-slate-200 hover:border-primary/50 text-xs px-4"
                          >
                            <Eye size={14} />
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
                            className="flex-[2] md:flex-none bg-primary hover:bg-primary/90 rounded-full h-9 px-6 text-xs gap-2 group"
                          >
                            {t("submit_offer")}
                            <ChevronLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="p-10 text-center text-muted-foreground">{t("no_suggested_rfqs")}</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Profile Completion / Specializations */}
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-bold">{t("your_specializations")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap gap-2">
                 {userData?.specializations?.length > 0 ? userData.specializations.map((spec: string) => (
                  <Badge key={spec} className="bg-success/10 text-success border-success/20 hover:bg-success/20 px-3 py-1">
                    {spec}
                  </Badge>
                )) : (
                  <p className="text-sm text-muted-foreground">{t("no_specializations_yet")}</p>
                )}
              </div>
              <div className="h-px bg-slate-100" />
              <div className="space-y-3">
                <p className="text-sm font-bold text-slate-700">{t("coverage_areas")}</p>
                <div className="flex flex-wrap gap-2">
                  {userData?.coverageCities?.length > 0 ? (
                    userData.coverageCities.slice(0, 6).map((city: string) => (
                      <span key={city} className="text-xs text-muted-foreground bg-slate-100 px-2 py-1 rounded hover:bg-slate-200 transition-colors cursor-default">
                        <MapPin size={10} className="inline ml-1" />
                        {displayCity(city, locale)}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">{t("no_cities_added")}</span>
                  )}
                  {userData?.coverageCities && userData.coverageCities.length > 6 && (
                    <span className="text-xs text-primary font-medium">{t("other_cities", { count: userData.coverageCities.length - 6 })}</span>
                  )}
                </div>
              </div>
              <Link href="/supplier/profile" className="block pt-4">
                <Button variant="ghost" className="w-full text-primary font-bold hover:bg-primary/5">
                  {t("edit_profile")}
                  <ChevronLeft className="mr-1 h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      <SubmitOfferDialog 
        selectedRfq={selectedRfq} 
        isOpen={showSubmitOffer}
        onClose={() => {
          setShowSubmitOffer(false)
          if (!showRfqDetails) setSelectedRfq(null)
        }} 
        onSuccess={() => router.push("/supplier/offers")}
      />

      {/* RFQ Details Dialog */}
      <Dialog open={showRfqDetails} onOpenChange={(open) => { if (!open) { setShowRfqDetails(false); setShowInquiries(false) } }}>
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
                {showInquiries ? <ChevronLeft size={16} className="-rotate-90 transition-transform" /> : <ChevronLeft size={16} className="transition-transform" />}
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
          </div>

          <div className="px-5 py-4 border-t bg-white shrink-0 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => { setShowRfqDetails(false); setShowInquiries(false) }}>
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
