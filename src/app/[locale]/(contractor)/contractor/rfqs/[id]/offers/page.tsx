"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { useRouter } from "@/i18n/routing"
import { useTranslations, useLocale } from 'next-intl'
import { cn } from "@/lib/utils"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ReviewDialog } from "@/components/ReviewDialog"
import { Star } from "lucide-react"
import { displayCategory, displaySubcategory, displayCity } from "@/lib/constants"


import {
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  TrendingUp,
  User,
  Calendar,
  MessageSquare,
  MapPin,
  Tag,
  Truck,
  Package,
  Phone,
  ArrowDown,
  Box,
  File,
  Send,
  Globe,
  Download
} from "lucide-react"
import { useCollection, useDoc, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy, doc, updateDoc, setDoc, getDoc, addDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Link } from "@/i18n/routing"

export default function RfqOffersPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const params = useParams()
  const rfqId = params.id as string
  const router = useRouter()
  const { toast } = useToast()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [openingChat, setOpeningChat] = useState<string | null>(null)
  const [sampleRequestOffer, setSampleRequestOffer] = useState<any | null>(null)
  const [reductionOffer, setReductionOffer] = useState<any | null>(null)
  const [reductionNote, setReductionNote] = useState("")
  const [targetPrice, setTargetPrice] = useState("")
  const [sortBy, setSortBy] = useState<"price" | "date" | "duration">("price")
  const [reviewOffer, setReviewOffer] = useState<any | null>(null)

  const openChat = async (offer: any) => {
    if (!firestore || !user) return
    setOpeningChat(offer.id)
    try {
      // Create chat doc if it doesn't exist (fallback for offers accepted before this fix)
      const chatRef = doc(firestore, "chats", offer.id)
      const snap = await getDoc(chatRef)
      if (!snap.exists()) {
        await setDoc(chatRef, {
          offerId: offer.id,
          rfqId: rfqId,
          rfqTitle: offer.rfqTitle || offer.title || "",
          contractorId: user.uid,
          contractorOrgId: profile?.organizationId || user.uid,
          supplierId: offer.supplierId,
          supplierOrgId: offer.organizationId || offer.supplierId,
          createdAt: new Date().toISOString()
        })
      }
      router.push(`/contractor/chat/${offer.id}`)
    } catch (err: any) {
      console.error("❌ openChat failed:", err?.code, err?.message)
      toast({ title: t("offers_toast_error"), description: t("offers_toast_error_desc", { message: err?.code || "" }), variant: "destructive" })
      setOpeningChat(null)
    }
  }

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "offers"),
      where("rfqId", "==", rfqId),
      orderBy("createdAt", "desc")
    )
  }, [firestore, user, isUserLoading, rfqId])

  const rfqDocRef = useMemoFirebase(() => {
    if (!firestore || !rfqId) return null
    return doc(firestore, "rfqs", rfqId)
  }, [firestore, rfqId])

  const { data: rfq, isLoading: isRfqLoading } = useDoc(rfqDocRef)

  const { data: offers, isLoading: isOffersLoading } = useCollection(offersQuery)
  const isLoading = isOffersLoading || isRfqLoading

  const handleDecision = async (offerId: string, decision: "مقبول" | "مرفوض" | "مطلوب تخفيض", note?: string, requestedPrice?: string) => {
    if (!firestore || !user) return
    setProcessingId(offerId)

    const offer = offers?.find((o: any) => o.id === offerId)

    // Step 1: Update offer status
    try {
      const updateData: any = {
        status: decision,
        decidedByUserId: user.uid,
        decidedByUserName: profile?.name || user.email || "عضو الإدارة",
        decidedAt: new Date().toISOString(),
        readAt: null // reset read status for supplier
      }
      if (decision === "مطلوب تخفيض" && requestedPrice) {
        updateData.targetPrice = Number(requestedPrice)
      }
      
      await updateDoc(doc(firestore, "offers", offerId), updateData)
    } catch (error: any) {
      console.error("❌ updateDoc offer failed:", error?.code, error?.message)
      toast({ title: t("offers_toast_error"), description: t("offers_toast_error_desc", { message: error?.code || error?.message }), variant: "destructive" })
      setProcessingId(null)
      return
    }

    // Step 2: Auto-create chat when accepting
    if (decision === "مقبول" && offer) {
      try {
        const chatRef = doc(firestore, "chats", offerId)
        const snap = await getDoc(chatRef)
        if (!snap.exists()) {
          await setDoc(chatRef, {
            offerId: offerId,
            rfqId: rfqId,
            rfqTitle: offer.rfqTitle || offer.title || "",
            contractorId: user.uid,
            contractorOrgId: profile?.organizationId || user.uid,
            supplierId: offer.supplierId,
            supplierOrgId: offer.organizationId || offer.supplierId,
            createdAt: new Date().toISOString()
          })
        }
      } catch (error: any) {
        console.error("❌ setDoc chat failed:", error?.code, error?.message)
        // Don't block the accept flow — offer is already updated
        toast({ title: t("offers_toast_chat_alert"), description: t("offers_toast_chat_alert_desc"), variant: "destructive" })
        setProcessingId(null)
        return
      }
    }

    // Step 3: Write notification to supplier's subcollection
    if (offer?.supplierId) {
      try {
        let notifType = "offer_rejected"
        let notifTitle = t("offers_notif_rejected_title")
        let notifMessage = t("offers_notif_rejected_msg", { title: offer.rfqTitle || "" })
        if (decision === "مقبول") {
          notifType = "offer_accepted"
          notifTitle = t("offers_notif_accepted_title")
          notifMessage = t("offers_notif_accepted_msg", { title: offer.rfqTitle || "" })
        } else if (decision === "مطلوب تخفيض") {
          notifType = "price_reduction"
          notifTitle = t("offers_notif_reduction_title")
          let baseMsg = t("offers_notif_reduction_msg", { title: offer.rfqTitle || "" })
          if (requestedPrice) baseMsg += `\nالسعر المستهدف: ${requestedPrice} ${t("offers_currency_sar")}`
          if (note) baseMsg += `\nملاحظة: ${note}`
          notifMessage = baseMsg
        }
        await addDoc(collection(firestore, "users", offer.supplierId, "notifications"), {
          userId: offer.supplierId,
          organizationId: offer.organizationId || offer.supplierId,
          type: notifType,
          title: notifTitle,
          message: notifMessage,
          offerId: offerId,
          rfqId: rfqId,
          rfqTitle: offer.rfqTitle || "",
          createdAt: new Date().toISOString(),
          read: false
        })
      } catch (notifErr) {
        console.warn("⚠️ Failed to write supplier notification (non-critical):", notifErr)
      }
    }

    toast({
      title: decision === "مقبول" ? t("offers_toast_accepted_title") : decision === "مرفوض" ? t("offers_toast_rejected_title") : t("offers_toast_reduction_title"),
      description: decision === "مقبول"
        ? t("offers_toast_accepted_desc")
        : decision === "مرفوض"
          ? t("offers_toast_rejected_desc")
          : t("offers_toast_reduction_desc"),
    })
    setProcessingId(null)
  }

  const handleSampleAction = async (offerId: string, action: "مطلوبة" | "تم الاستلام") => {
    if (!firestore || !user) return;
    setProcessingId(offerId);
    try {
       await updateDoc(doc(firestore, "offers", offerId), {
         sampleStatus: action,
         sampleUpdatedAt: new Date().toISOString()
       });

      if (action === "مطلوبة") {
        const offerSnap = await getDoc(doc(firestore, "offers", offerId));
        const offerData = offerSnap.data();
        if (offerData?.supplierId) {
          await addDoc(collection(firestore, "users", offerData.supplierId, "notifications"), {
            userId: offerData.supplierId,
            organizationId: offerData.organizationId || offerData.supplierId,
            type: "sample_requested",
            title: "طلب عينة جديد",
            message: `قام المقاول بطلب عينة لمناقصة: ${offerData.rfqTitle || ""}`,
            offerId: offerId,
            rfqId: rfqId,
            createdAt: new Date().toISOString(),
            read: false
          });
        }
      }

      toast({
        title: action === "مطلوبة" ? t("offers_toast_sample_req") : t("offers_toast_sample_rcv"),
        description: action === "مطلوبة" ? t("offers_toast_sample_req_desc") : t("offers_toast_sample_rcv_desc")
      });
    } catch (error: any) {
      console.error("❌ handleSampleAction failed:", error);
      toast({ title: t("offers_toast_error"), description: `${t("offers_toast_sample_error")} ${error?.message || ""}`, variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  }

  const handleMarkAsCompleted = async (offerId: string) => {
    if (!firestore || !user) return
    setProcessingId(offerId)
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        status: "تم التسليم",
        completedAt: new Date().toISOString()
      })
      toast({
        title: t("offers_toast_completed_title"),
        description: t("offers_toast_completed_desc")
      })
    } catch (error: any) {
      toast({
        title: t("offers_toast_error"),
        description: t("offers_toast_error_desc", { message: error.message }),
        variant: "destructive"
      })
    } finally {
      setProcessingId(null)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "مقبول": return <Badge className="bg-success/10 text-success border-success/20">{t("offers_status_accepted")}</Badge>
      case "تم التسليم": return <Badge className="bg-blue-50 text-blue-600 border-blue-100">{t("offers_status_completed")}</Badge>
      case "مرفوض": return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none">{t("offers_status_rejected")}</Badge>
      case "مطلوب تخفيض": return <Badge className="bg-amber-100 text-amber-700 border-none">{t("offers_status_reduction")}</Badge>
      default: return <Badge className="bg-amber-50 text-amber-600 border-amber-100">{t("offers_status_review")}</Badge>
    }
  }

  const sortedOffers = offers ? [...offers].sort((a: any, b: any) => {
    if (sortBy === "price") {
      return (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
    } else if (sortBy === "date") {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    } else if (sortBy === "duration") {
      const durA = (parseInt(a.executionDuration) || 9999) * (a.executionDurationUnit === "أشهر" ? 30 : a.executionDurationUnit === "أسابيع" ? 7 : 1);
      const durB = (parseInt(b.executionDuration) || 9999) * (b.executionDurationUnit === "أشهر" ? 30 : b.executionDurationUnit === "أسابيع" ? 7 : 1);
      return durA - durB;
    }
    return 0;
  }) : []
  const lowestPrice = sortedOffers.length > 0 ? sortedOffers[0].price : null

  return (
    <PortalLayout>
      <div className={cn("space-y-6", locale === 'ar' ? 'text-right' : 'text-left')}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2 gap-1 text-muted-foreground">
              <ArrowRight size={16} />
              {t("offers_back_to_tenders")}
            </Button>
            <h1 className="text-3xl font-bold text-secondary font-headline">{t("offers_page_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("offers_page_desc")}</p>
          </div>
        </div>
        {rfq && (
          <Card className="border-none shadow-sm bg-white overflow-hidden">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row justify-between gap-6">
                <div className="space-y-4 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="bg-primary/5 text-primary border-none">
                      {displayCategory(rfq.category, locale)}
                    </Badge>
                    {rfq.subCategory && (
                      <Badge variant="outline" className="text-muted-foreground border-slate-200">
                        {displaySubcategory(rfq.subCategory, locale)}
                      </Badge>
                    )}
                    {rfq.pdfUrl && (
                      <a
                        href={rfq.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="flex items-center gap-1.5 text-xs bg-blue-50 text-blue-600 px-2.5 py-1 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        <File size={12} />
                        {t("offers_download_pdf")}
                      </a>
                    )}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mr-auto bg-slate-50 px-2 py-1 rounded">
                      <Calendar size={12} />
                      {t("offers_created_date", { date: rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString(locale) : '-' })}
                    </div>
                  </div>

                  <h2 className="text-2xl font-bold text-slate-800">{rfq.title}</h2>

                  <div className="flex flex-wrap items-center gap-6 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <MapPin size={16} className="text-primary" />
                      {displayCity(rfq.city, locale)} - {displayCity(rfq.district, locale)}
                      {rfq.locationCoords && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${rfq.locationCoords.lat},${rfq.locationCoords.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary underline mr-2 hover:text-primary/70 transition-colors"
                        >
                          {t("offers_view_location")}
                        </a>
                      )}
                    </div>
                    {rfq.isQualityCertificateRequired && (
                      <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">
                        {t("offers_quality_cert")}
                      </Badge>
                    )}
                  </div>

                  {/* Products List */}
                  {rfq.products && rfq.products.length > 0 && (
                    <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
                      <p className="text-xs font-bold text-slate-600 mb-3">{t("offers_requested_products")}</p>
                      <div className="space-y-2">
                        {rfq.products.map((product: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between bg-white p-3 rounded border border-slate-100">
                            <div className="flex-1">
                              <p className="font-bold text-sm text-slate-800">{product.name}</p>
                              {product.subCategory && (
                                <div className="mt-1">
                                  <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded">{displaySubcategory(product.subCategory, locale)}</span>
                                </div>
                              )}
                              {product.description && (
                                <p className="text-xs text-muted-foreground mt-1">{product.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-bold text-primary">{product.quantity}</span>
                              <span className="text-muted-foreground">{product.unitOfMeasure}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  {rfq.notes && (
                    <div className="mt-4 p-4 bg-blue-50/50 rounded-lg border border-blue-100">
                      <p className="text-xs font-bold text-slate-600 mb-2">{t("offers_notes_label")}</p>
                      <p className="text-sm text-slate-700">{rfq.notes}</p>
                    </div>
                  )}

                  {/* PDF Attachment */}
                  {rfq.pdfUrl && (
                    <div className="mt-4">
                      <a
                        href={rfq.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm"
                      >
                        <File size={16} />
                        {t("offers_view_pdf")}
                      </a>
                    </div>
                  )}
                </div>

                <div className="md:w-px md:h-24 bg-slate-100 hidden md:block" />

                <div className="space-y-2 min-w-[200px]">
                  <p className="text-xs text-muted-foreground">{t("offers_tender_number")}</p>
                  <p className="font-mono text-sm font-bold text-primary bg-primary/5 px-3 py-2 rounded-lg border border-primary/10">
                    {rfqId}
                  </p>
                  {rfq.deadline && (
                    <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/5 px-3 py-2 rounded-lg border border-destructive/10">
                      <Calendar size={14} />
                      {t("offers_deadline_label", { date: new Date(rfq.deadline).toLocaleDateString(locale) })}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-none shadow-sm">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                <TrendingUp size={18} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("offers_total")}</p>
                <p className="text-xl font-bold">{offers?.length || 0}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-success/10 flex items-center justify-center text-success">
                <CheckCircle2 size={18} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("offers_accepted_count")}</p>
                <p className="text-xl font-bold">{offers?.filter((o: any) => o.status === "مقبول").length || 0}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                <Loader2 size={18} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("offers_under_review_count")}</p>
                <p className="text-xl font-bold">{offers?.filter((o: any) => o.status === "قيد المراجعة").length || 0}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Offers and Compare Tabs */}
        <Tabs defaultValue="list" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg text-slate-800">{t("offers_title")}</h3>
            <TabsList className="bg-slate-100/50 border border-slate-200">
              <TabsTrigger value="list" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">{t("offers_tab_list")}</TabsTrigger>
              <TabsTrigger value="compare" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">{t("offers_tab_compare")}</TabsTrigger>
              <TabsTrigger value="inquiries" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">{t("offers_tab_inquiries")}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="list" className="space-y-4 m-0 mt-6">
            {isLoading ? (
              <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <Loader2 className="animate-spin" size={40} />
                <p>{t("offers_loading")}</p>
              </div>
            ) : !offers || offers.length === 0 ? (
              <Card className="border-dashed border-2 border-slate-200 shadow-none">
                <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                  <TrendingUp size={48} className="opacity-20" />
                  <p className="font-bold text-lg">{t("offers_no_data")}</p>
                  <p className="text-sm">{t("offers_no_data_desc")}</p>
                </CardContent>
              </Card>
            ) : (
              offers.map((offer: any) => {
                const isBestOffer = offer.price === lowestPrice && offer.status !== "مرفوض";

                return (
                  <Card key={offer.id} className={`border shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden relative ${offer.status === "مقبول" ? "border-success/30 bg-success/5" :
                    offer.status === "مرفوض" ? "opacity-50 grayscale-[50%]" :
                      isBestOffer ? "border-amber-300 bg-amber-50/20" : "border-slate-100 bg-white"
                    }`}>
                    {isBestOffer && offer.status === "قيد المراجعة" && (
                      <div className="absolute top-0 left-0 bg-amber-400 text-amber-950 text-[10px] font-black px-3 py-1 rounded-br-lg rounded-tl-lg z-10 shadow-sm flex items-center gap-1">
                        <TrendingUp size={12} /> {t("offers_best_price")}
                      </div>
                    )}
                    <CardContent className="p-0">
                      <div className="flex flex-col md:flex-row">
                        {/* Offer Details */}
                        <div className="p-6 flex-1 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                                <User size={18} />
                              </div>
                              <div>
                                <p className="font-bold text-sm text-slate-800">{offer.companyName || offer.supplierName || t("offers_registered_supplier")}</p>
                                {offer.submittedByUserName && (
                                  <p className="text-[11px] text-slate-500 mt-0.5">
                                    {t("offers_submitted_by", { name: offer.submittedByUserName })}
                                  </p>
                                )}
                                <p className="text-xs text-muted-foreground font-mono mt-0.5">{offer.supplierId?.substring(0, 10)}...</p>
                                {offer.supplierWebsite && (
                                  <a
                                    href={offer.supplierWebsite.startsWith('http') ? offer.supplierWebsite : `https://${offer.supplierWebsite}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
                                  >
                                    <Globe size={10} />
                                    {t("offers_visit_website")}
                                  </a>
                                )}
                              </div>
                            </div>
                            {getStatusBadge(offer.status || "قيد المراجعة")}
                          </div>

                          <div className="flex flex-wrap gap-4 text-sm mt-2">
                            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl ${isBestOffer ? "bg-amber-100/50" : "bg-primary/5"}`}>
                              <span className="text-muted-foreground font-medium">{t("offers_proposed_price")}</span>
                              <span className={`font-black text-xl ${isBestOffer ? "text-amber-600" : "text-primary"}`}>
                                {offer.price} <span className="text-sm font-normal">{t("offers_currency_sar")}</span>
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground" suppressHydrationWarning>
                              <Calendar size={14} />
                              <span>                            {offer.createdAt ? new Date(offer.createdAt).toLocaleDateString(locale) : "-"}</span>
                            </div>
                            {offer.deliveryFrequency && (
                              <div className="flex items-center gap-2 sm:col-span-2">
                                <Calendar size={14} className="text-muted-foreground" />
                                <span className="text-slate-600">{t("offers_delivery_frequency")}</span>
                                <span className="font-medium">{offer.deliveryFrequency}</span>
                              </div>
                            )}
                          </div>

                          {offer.deliveryBatches && offer.deliveryBatches.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                              <p className="text-xs font-bold text-slate-600 mb-2">{t("offers_batches")}</p>
                              <div className="space-y-2">
                                {offer.deliveryBatches.map((batch: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between bg-white p-2 rounded border border-slate-100 text-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-bold">
                                        {t("offers_batch_no", { number: idx + 1 })}
                                      </span>
                                      <span className="text-slate-600">{batch.quantity}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Calendar size={12} className="text-muted-foreground" />
                                      <span className="text-slate-600">{batch.deliveryDate}</span>
                                      <span className="font-bold text-success">{batch.price} {t("offers_currency_sar")}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              {offer.totalBatchesPrice && (
                                <div className="mt-2 flex justify-end">
                                  <span className="text-xs text-muted-foreground">
                                    {t("offers_total_batches_price")} <span className="font-bold text-success">{offer.totalBatchesPrice} {t("offers_currency_sar")}</span>
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {offer.offerPdfUrl && (
                            <div className="mt-4 p-3 bg-blue-50/50 rounded-xl border border-blue-100 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <File size={18} className="text-blue-600" />
                                <span className="text-sm font-bold text-slate-700">{t("offers_attached_file")}</span>
                              </div>
                              <Button variant="outline" size="sm" asChild className="h-8 rounded-lg bg-white border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white transition-all">
                                <a href={offer.offerPdfUrl} target="_blank" rel="noopener noreferrer">
                                  <Download size={12} className="ml-1" />
                                  {t("offers_view_file")}
                                </a>
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Action Buttons - Pending */}
                        {offer.status === "قيد المراجعة" && (
                          <div className="bg-slate-50/70 p-6 grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-col items-center justify-center gap-3 md:border-r border-t md:border-t-0 min-w-[180px]">
                            <Button
                              onClick={() => handleDecision(offer.id, "مقبول")}
                              disabled={processingId === offer.id}
                              className="w-full bg-success hover:bg-success/90 gap-2 rounded-full transition-all hover:shadow-lg hover:shadow-success/20"
                              size="sm"
                            >
                              {processingId === offer.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                              {t("offers_accept")}
                            </Button>
                            <Button
                              onClick={() => setReductionOffer(offer)}
                              disabled={processingId === offer.id}
                              variant="outline"
                              className="w-full gap-2 rounded-full border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 hover:border-amber-500 hover:text-amber-800 transition-all font-medium"
                              size="sm"
                            >
                              <ArrowDown size={14} />
                              {t("offers_request_reduction")}
                            </Button>
                            <Button
                              onClick={() => handleDecision(offer.id, "مرفوض")}
                              disabled={processingId === offer.id}
                              variant="ghost"
                              className="w-full gap-2 rounded-full text-red-600 hover:text-red-700 hover:bg-red-50 transition-all"
                              size="sm"
                            >
                              <XCircle size={14} />
                              {t("offers_reject")}
                            </Button>
                            {(!offer.sampleStatus || offer.sampleStatus === "تم الاستلام") && (
                              <Button
                                onClick={() => offer.sampleStatus ? handleSampleAction(offer.id, "مطلوبة") : setSampleRequestOffer(offer)}
                                disabled={processingId === offer.id}
                                variant="outline"
                                className="w-full gap-2 rounded-full border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 hover:border-blue-500 hover:text-blue-800 transition-all font-medium mt-1"
                                size="sm"
                              >
                                <Box size={14} />
                                {offer.sampleStatus ? t("offers_request_another_sample") : t("offers_request_sample")}
                              </Button>
                            )}
                            {offer.sampleStatus === "تم الإرسال" && (
                              <div className="w-full space-y-2">
                                <Button
                                  onClick={() => handleSampleAction(offer.id, "تم الاستلام")}
                                  disabled={processingId === offer.id}
                                  variant="outline"
                                  className="w-full gap-2 rounded-full border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-500 hover:text-emerald-800 transition-all font-medium mt-1"
                                  size="sm"
                                >
                                  <CheckCircle2 size={14} />
                                  {t("offers_confirm_receipt")}
                                </Button>
                                <Button
                                  onClick={() => openChat(offer)}
                                  disabled={openingChat === offer.id}
                                  className="w-full bg-primary hover:bg-primary/90 gap-2 rounded-full transition-all"
                                  size="sm"
                                >
                                  <MessageSquare size={14} />
                                  {t("offers_chat_sample")}
                                </Button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Action Buttons - Accepted */}
                        {offer.status === "مقبول" && (
                          <div className="bg-success/5 p-6 grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-col items-center justify-center gap-3 md:border-r border-t md:border-t-0 min-w-[180px]">
                            <Button
                              onClick={() => openChat(offer)}
                              disabled={openingChat === offer.id}
                              className="w-full bg-primary hover:bg-primary/90 gap-2 rounded-full transition-all hover:shadow-lg text-xs"
                              size="sm"
                            >
                              {openingChat === offer.id ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                              {t("offers_open_chat")}
                            </Button>
                            <SupplierWhatsAppButton supplierId={offer.supplierId} />
                            <Button
                              onClick={() => handleMarkAsCompleted(offer.id)}
                              disabled={processingId === offer.id}
                              className="w-full bg-blue-600 hover:bg-blue-700 gap-2 rounded-full transition-all text-xs"
                              size="sm"
                            >
                              {processingId === offer.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                              {t("offers_confirm_completion")}
                            </Button>
                          </div>
                        )}

                        {/* Action Buttons - Completed */}
                        {offer.status === "تم التسليم" && (
                          <div className="bg-blue-50/20 p-6 grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-col items-center justify-center gap-3 md:border-r border-t md:border-t-0 min-w-[180px]">
                            <Button
                              onClick={() => openChat(offer)}
                              disabled={openingChat === offer.id}
                              className="w-full bg-primary hover:bg-primary/90 gap-2 rounded-full transition-all hover:shadow-lg text-xs"
                              size="sm"
                            >
                              {openingChat === offer.id ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                              {t("offers_open_chat")}
                            </Button>
                            <SupplierWhatsAppButton supplierId={offer.supplierId} />
                            {offer.contractorRated ? (
                              <Button
                                disabled
                                className="w-full bg-slate-100 text-slate-400 gap-2 rounded-full border-none text-xs"
                                size="sm"
                              >
                                <Star size={14} className="fill-slate-300 text-slate-300" />
                                {t("offers_supplier_rated")}
                              </Button>
                            ) : (
                              <Button
                                onClick={() => setReviewOffer(offer)}
                                className="w-full bg-amber-500 hover:bg-amber-600 gap-2 rounded-full transition-all hover:shadow-lg hover:shadow-amber-500/20 text-xs"
                                size="sm"
                              >
                                <Star size={14} className="fill-white" />
                                {t("offers_rate_supplier")}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </TabsContent>

          <TabsContent value="compare" className="m-0 mt-6">
            {!sortedOffers || sortedOffers.length < 2 ? (
              <Card className="border-dashed border-2 border-slate-200 shadow-none">
                <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                  <TrendingUp size={48} className="opacity-20" />
                  <p className="font-bold text-lg">{t("offers_need_two")}</p>
                  <p className="text-sm">{t("offers_need_two_desc")}</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-none shadow-sm overflow-hidden bg-white">
                {/* Sorting Buttons */}
                <div className="p-4 border-b flex items-center gap-2 flex-wrap bg-slate-50/50">
                  <span className="text-xs font-bold text-slate-500 ml-2">{t("offers_sort")}</span>
                  <Button
                    variant={sortBy === "price" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSortBy("price")}
                    className="h-8 text-xs rounded-lg"
                  >
                    {t("offers_sort_price")}
                  </Button>
                  <Button
                    variant={sortBy === "date" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSortBy("date")}
                    className="h-8 text-xs rounded-lg"
                  >
                    {t("offers_sort_date")}
                  </Button>
                  <Button
                    variant={sortBy === "duration" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSortBy("duration")}
                    className="h-8 text-xs rounded-lg"
                  >
                    {t("offers_sort_duration")}
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-gradient-to-r from-slate-50 to-white border-b-2 border-slate-100">
                      <TableRow>
                        <TableHead className="text-right font-bold text-slate-700 whitespace-nowrap w-40">{t("offers_criteria")}</TableHead>
                        {sortedOffers.map((o: any, i: number) => (
                          <TableHead key={o.id} className={`text-center min-w-[160px] ${o.price === lowestPrice ? 'bg-amber-50/50' : ''}`}>
                            <div className="flex flex-col items-center gap-1">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                <User size={16} className="text-primary" />
                              </div>
                              <span className="font-bold text-slate-800">{o.supplierName || `${t("offers_registered_supplier")} ${i + 1}`}</span>
                              {o.price === lowestPrice && (
                                <div className="text-[10px] text-amber-600 font-bold">{t("offers_best_price")} ⭐</div>
                              )}
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">{t("offers_price_col")}</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className={`text-center font-bold ${o.price === lowestPrice ? 'text-success text-lg' : 'text-slate-800'}`}>
                            <div className="flex flex-col">
                              <span>{Number(o.price).toLocaleString('ar-SA')}</span>
                              <span className="text-xs text-muted-foreground">{t("offers_currency_sar")}</span>
                            </div>
                          </TableCell>
                        ))}
                      </TableRow>
                      {/* Removed Location, Delivery, and Sample rows for simplicity */}
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">{t("offers_duration_col")}</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600">
                            {o.executionDuration ? `${o.executionDuration} ${o.executionDurationUnit || 'أيام'}` : "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">{t("offers_notes_col")}</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600 max-w-[150px]">
                            <p className="truncate">{o.notes || "—"}</p>
                          </TableCell>
                        ))}
                      </TableRow>
                      {/* Removed Products Count row for simplicity */}
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">{t("offers_date_col")}</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600" suppressHydrationWarning>
                            <div className="flex items-center justify-center gap-1">
                              <Calendar size={12} className="text-muted-foreground" />
                              {o.createdAt ? new Date(o.createdAt).toLocaleDateString(locale) : "—"}
                            </div>
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">{t("offers_file_col")}</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center">
                            {o.offerPdfUrl ? (
                              <Button variant="outline" size="sm" asChild className="h-8 rounded-lg bg-white border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white transition-all text-[10px]">
                                <a href={o.offerPdfUrl} target="_blank" rel="noopener noreferrer">
                                  <Download size={10} className="ml-1" />
                                  {t("offers_view_file")}
                                </a>
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">{t("offers_not_available")}</span>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">{t("offers_decision_col")}</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center">
                            <div className="flex justify-center">{getStatusBadge(o.status || "قيد المراجعة")}</div>
                            {o.status !== "مقبول" && o.status !== "مرفوض" && (
                              <Button
                                onClick={() => handleDecision(o.id, "مقبول")}
                                disabled={processingId === o.id}
                                className="mt-3 w-full bg-success hover:bg-success/90 gap-2 rounded-full text-xs h-8"
                                size="sm"
                              >
                                {processingId === o.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                {t("offers_accept_btn")}
                              </Button>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="inquiries" className="m-0 mt-6">
            <InquiriesSection rfqId={rfqId} rfqTitle={rfq?.title || ""} profile={profile} />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!sampleRequestOffer} onOpenChange={(open) => !open && setSampleRequestOffer(null)}>
        <DialogContent className="sm:max-w-md" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t("offers_sample_dialog_title")}</DialogTitle>
            <DialogDescription className="text-right mt-2 text-slate-600">
              {t("offers_sample_dialog_desc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-row justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={async () => {
                if (sampleRequestOffer) {
                  await handleSampleAction(sampleRequestOffer.id, "مطلوبة");
                  setSampleRequestOffer(null);
                }
              }}
              disabled={!!processingId}
            >
              {t("offers_send_notification")}
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-white"
              onClick={async () => {
                if (sampleRequestOffer) {
                  await handleSampleAction(sampleRequestOffer.id, "مطلوبة");
                  openChat(sampleRequestOffer);
                  setSampleRequestOffer(null);
                }
              }}
              disabled={!!processingId || !!openingChat}
            >
              {t("offers_send_and_chat")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Price Reduction Dialog */}
      <Dialog open={!!reductionOffer} onOpenChange={(open) => {
        if (!open) {
          setReductionOffer(null);
          setReductionNote("");
        }
      }}>
        <DialogContent className="sm:max-w-md" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader className={cn(locale === 'ar' ? 'text-right sm:text-right' : 'text-left sm:text-left')}>
            <DialogTitle>{t("offers_request_reduction")}</DialogTitle>
            <DialogDescription className="text-right mt-2 text-slate-600">
              {t("offers_reduction_dialog_desc", { supplier: reductionOffer?.supplierName || reductionOffer?.companyName || t("offers_registered_supplier") })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center justify-between bg-amber-50 p-4 rounded-xl border border-amber-100 mb-4">
              <span className="text-sm font-medium text-amber-800">{t("offers_proposed_price")}</span>
              <span className="font-bold text-lg text-amber-700">{reductionOffer?.price} {t("offers_currency_sar")}</span>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                السعر المستهدف ({t("offers_currency_sar")}) <span className="text-muted-foreground text-xs font-normal">({t("optional")})</span>
              </label>
              <input
                type="number"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                placeholder="أدخل السعر المطلوب..."
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
              />
            </div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t("offers_reduction_note_label")} <span className="text-muted-foreground text-xs font-normal">({t("optional")})</span>
            </label>
            <textarea
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 min-h-[100px] resize-y"
              placeholder={t("offers_reduction_note_placeholder")}
              value={reductionNote}
              onChange={(e) => setReductionNote(e.target.value)}
            />
          </div>
          <DialogFooter className={cn("flex flex-row gap-2", locale === 'ar' ? "flex-row-reverse justify-start" : "justify-end")}>
            <Button
              variant="ghost"
              onClick={() => {
                setReductionOffer(null);
                setReductionNote("");
                setTargetPrice("");
              }}
              disabled={!!processingId}
            >
              {t("cancel")}
            </Button>
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={async () => {
                if (reductionOffer) {
                  await handleDecision(reductionOffer.id, "مطلوب تخفيض", reductionNote, targetPrice);
                  setReductionOffer(null);
                  setReductionNote("");
                  setTargetPrice("");
                }
              }}
              disabled={!!processingId}
            >
              {processingId === reductionOffer?.id ? <Loader2 size={14} className="animate-spin ms-2" /> : <ArrowDown size={14} className="ms-2" />}
              {t("offers_send_request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Review Dialog */}
      {reviewOffer && (
        <ReviewDialog
          open={!!reviewOffer}
          onOpenChange={(open) => !open && setReviewOffer(null)}
          offerId={reviewOffer.id}
          rfqId={rfqId}
          reviewerId={user?.uid || ""}
          reviewerName={profile?.companyName || profile?.name || ""}
          reviewerRole="Contractor"
          revieweeId={reviewOffer.supplierId}
          revieweeName={reviewOffer.supplierName || "المورد"}
          revieweeRole="Supplier"
          onSubmitSuccess={() => setReviewOffer(null)}
        />
      )}
    </PortalLayout>
  )
}

function InquiriesSection({ rfqId, rfqTitle, profile }: { rfqId: string; rfqTitle: string; profile: any }) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const [replyText, setReplyText] = useState<{ [key: string]: string }>({})
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [showReply, setShowReply] = useState<string | null>(null)
  const { toast } = useToast()
  const firestore = useFirestore()
  const { user } = useUser()

  const inquiriesQuery = useMemoFirebase(() => {
    if (!firestore || !rfqId) return null
    return query(
      collection(firestore, "rfqs", rfqId, "inquiries"),
      orderBy("createdAt", "desc")
    )
  }, [firestore, rfqId])

  const { data: inquiries, isLoading } = useCollection(inquiriesQuery)

  const handleReply = async (inquiryId: string) => {
    if (!firestore || !replyText[inquiryId]?.trim()) return
    setReplyingTo(inquiryId)
    try {
      // Get the inquiry to find supplier ID for notification
      const inquiry = inquiries?.find((i: any) => i.id === inquiryId)

      await updateDoc(
        doc(firestore, "rfqs", rfqId, "inquiries", inquiryId),
        {
          reply: replyText[inquiryId].trim(),
          repliedAt: new Date().toISOString(),
          repliedBy: user?.uid || "",
          repliedByUserName: profile?.name || user?.email || "عضو الإدارة"
        }
      )

      // Create notification for the supplier
      if (inquiry?.userId) {
        const notificationData = {
          userId: inquiry.userId,
          organizationId: inquiry.organizationId || inquiry.userId,
          type: "inquiry_reply",
          title: "رد على استفسارك",
          description: `رد المقاول على استفسارك في "${rfqTitle}": ${replyText[inquiryId].trim().substring(0, 100)}${replyText[inquiryId].trim().length > 100 ? "..." : ""}`,
          rfqId: rfqId,
          rfqTitle: rfqTitle,
          inquiryId: inquiryId,
          createdAt: new Date().toISOString(),
          read: false
        }
        await addDoc(collection(firestore, "users", inquiry.userId, "notifications"), notificationData)
      } else {
        console.warn("⚠️ No userId found for inquiry notification", inquiry)
      }

      toast({ title: t("offers_inq_sent_title"), description: t("offers_inq_sent_desc") })
      setReplyText(prev => ({ ...prev, [inquiryId]: "" }))
      setShowReply(null)
    } catch (error) {
      toast({ title: t("offers_toast_error"), description: t("offers_inq_failed"), variant: "destructive" })
    } finally {
      setReplyingTo(null)
    }
  }

  if (isLoading) {
    return (
      <Card className="border-none shadow-sm">
        <CardContent className="p-12 flex justify-center">
          <Loader2 className="animate-spin text-primary" size={32} />
        </CardContent>
      </Card>
    )
  }

  if (!inquiries || inquiries.length === 0) {
    return (
      <Card className="border-dashed border-2 border-slate-200 shadow-none">
        <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
          <MessageSquare size={48} className="opacity-20" />
          <p className="font-bold text-lg">{t("offers_inq_no_data")}</p>
          <p className="text-sm">{t("offers_inq_no_data_desc")}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="border-b bg-slate-50/50">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageSquare size={20} className="text-primary" />
          {t("offers_inquiries_title", { count: inquiries.length })}
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          {t("offers_inquiries_desc")}
        </p>
      </CardHeader>
      <CardContent className="p-6">
        <div className="space-y-4">
          {inquiries.map((inq: any) => (
            <div key={inq.id} className="p-4 bg-white rounded-xl border border-slate-200 hover:border-primary/30 transition-colors">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <MessageSquare size={18} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-bold text-sm text-slate-700">
                      {inq.supplierName || t("offers_registered_supplier")}
                      {inq.submittedByUserName && <span className="text-[11px] font-normal text-slate-500 mr-2">({inq.submittedByUserName})</span>}
                    </span>
                    <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                      {new Date(inq.createdAt).toLocaleDateString(locale)}
                    </span>
                  </div>
                  <p className="text-slate-600 text-sm leading-relaxed">{inq.question}</p>

                  {inq.reply ? (
                    <div className="mt-3 p-3 bg-success/5 rounded-lg border border-success/20">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 size={14} className="text-success" />
                        <span className="text-xs font-bold text-success">{t("offers_inq_reply_label")}</span>
                        {inq.repliedByUserName && <span className="text-[11px] text-success/80">({inq.repliedByUserName})</span>}
                        <span className="text-xs text-success/70" suppressHydrationWarning>
                          {new Date(inq.repliedAt).toLocaleDateString(locale)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700">{inq.reply}</p>
                    </div>
                  ) : (
                    <div className="mt-3">
                      {showReply === inq.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={replyText[inq.id] || ""}
                            onChange={(e) => setReplyText(prev => ({ ...prev, [inq.id]: e.target.value }))}
                            placeholder={t("offers_inq_reply_placeholder")}
                            rows={3}
                            className="text-sm"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleReply(inq.id)}
                              disabled={!replyText[inq.id]?.trim() || replyingTo === inq.id}
                              className="gap-2"
                            >
                              {replyingTo === inq.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                              {t("offers_inq_send_reply")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setShowReply(null); setReplyText(prev => ({ ...prev, [inq.id]: "" })) }}
                            >
                              {t("offers_inq_cancel")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowReply(inq.id)}
                          className="gap-2 mt-2"
                        >
                          <MessageSquare size={14} />
                          {t("offers_inq_reply_btn")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function SupplierWhatsAppButton({ supplierId }: { supplierId: string }) {
  const firestore = useFirestore()
  const t = useTranslations("Portal.Contractor")
  const docRef = useMemoFirebase(() => {
    if (!firestore || !supplierId) return null
    return doc(firestore, "users", supplierId)
  }, [firestore, supplierId])
  const { data: supplier } = useDoc(docRef)

  const phone = supplier?.phone || supplier?.mobile || supplier?.whatsapp
  if (!phone) return null

  const cleaned = phone.replace(/\D/g, "")
  const waNumber = cleaned.startsWith("0") ? "966" + cleaned.slice(1) : cleaned

  return (
    <a
      href={`https://wa.me/${waNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full flex items-center justify-center gap-2 h-8 rounded-full bg-[#25D366] hover:bg-[#20ba5a] text-white text-xs font-bold transition-colors"
    >
      <Phone size={13} />
      {t("offers_supplier_whatsapp")}
    </a>
  )
}
