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
import { ReviewDialog } from "@/components/ReviewDialog"
import { Star } from "lucide-react"
import { displayCategory, displaySubcategory, displayCity } from "@/lib/constants"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"


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
  Download,
  Briefcase,
  ChevronLeft,
  FileCheck
} from "lucide-react"
import { useCollection, useDoc, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy, doc, updateDoc, setDoc, getDoc, addDoc, serverTimestamp, writeBatch } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Link } from "@/i18n/routing"

function fmtDate(val: any, locale: string) {
  if (!val) return '-'
  const d = new Date(val)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export default function RfqOffersPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const params = useParams()
  const rfqId = params.tenderId as string
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
  const [confirmDecisionTarget, setConfirmDecisionTarget] = useState<{ offer: any; decision: "مقبول" | "مرفوض" } | null>(null)
  const [reductionOffer, setReductionOffer] = useState<any | null>(null)
  const [reductionNote, setReductionNote] = useState("")
  const [targetPrice, setTargetPrice] = useState("")
  const [sortBy, setSortBy] = useState<"price" | "date" | "duration">("price")
  const [reviewOffer, setReviewOffer] = useState<any | null>(null)
  const [confirmDeliveryDoc, setConfirmDeliveryDoc] = useState<any | null>(null)
  const [receiverName, setReceiverName] = useState("")
  const [isConfirmingDelivery, setIsConfirmingDelivery] = useState(false)

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

  // Delivery notices for this RFQ's offers
  const deliveriesQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !rfqId) return null
    return query(collection(firestore, "deliveries"), where("rfqId", "==", rfqId))
  }, [firestore, user, isUserLoading, rfqId])
  const { data: deliveries } = useCollection(deliveriesQuery)
  const deliveryByOfferId: Record<string, any> = {}
  ;(deliveries || []).forEach((d: any) => { deliveryByOfferId[d.offerId] = d })

  const handleConfirmDelivery = async () => {
    if (!firestore || !user || !confirmDeliveryDoc || !receiverName.trim()) return
    setIsConfirmingDelivery(true)
    try {
      await updateDoc(doc(firestore, "deliveries", confirmDeliveryDoc.id), {
        status: "confirmed",
        receivedByName: receiverName.trim(),
        confirmedAt: serverTimestamp(),
        confirmedByUserId: user.uid
      })

      if (confirmDeliveryDoc.supplierId) {
        await addDoc(collection(firestore, "users", confirmDeliveryDoc.supplierId, "notifications"), {
          userId: confirmDeliveryDoc.supplierId,
          organizationId: confirmDeliveryDoc.supplierOrgId || confirmDeliveryDoc.supplierId,
          type: "delivery_confirmed",
          title: "✅ تم تأكيد الاستلام",
          message: `أكد المقاول استلام الشحنة لمناقصة: ${confirmDeliveryDoc.rfqTitle || ""}`,
          offerId: confirmDeliveryDoc.offerId,
          rfqId: confirmDeliveryDoc.rfqId,
          createdAt: new Date().toISOString(),
          read: false
        })
      }

      toast({ title: t("delivery_confirm_success"), description: t("delivery_receipt_link") })
      setConfirmDeliveryDoc(null)
      setReceiverName("")
    } catch (err) {
      toast({ title: t("offers_toast_error"), variant: "destructive" })
    } finally {
      setIsConfirmingDelivery(false)
    }
  }

  const handleDecision = async (offerId: string, decision: "مقبول" | "مرفوض" | "مطلوب تخفيض", note?: string, requestedPrice?: string) => {
    if (!firestore || !user) return
    setProcessingId(offerId)

    const offer = offers?.find((o: any) => o.id === offerId)

    // Step 1: Update offer status. When accepting, the offer's own status and the RFQ's
    // "Awarded" status must never go out of sync, so they're committed together as one batch.
    try {
      const updateData: any = {
        status: decision,
        decidedByUserId: user.uid,
        decidedByUserName: profile?.name || user.email || "عضو الإدارة",
        decidedAt: new Date().toISOString(),
        readAt: null // reset read status for supplier
      }
      if (decision === "مطلوب تخفيض") {
        if (requestedPrice) updateData.targetPrice = Number(requestedPrice)
        updateData.reductionNote = note || null
      }

      if (decision === "مقبول") {
        const batch = writeBatch(firestore)
        batch.update(doc(firestore, "offers", offerId), updateData)
        batch.update(doc(firestore, "rfqs", rfqId), {
          status: "Awarded",
          awardedAt: new Date().toISOString()
        })
        await batch.commit()
      } else {
        await updateDoc(doc(firestore, "offers", offerId), updateData)
      }
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
          if (requestedPrice) baseMsg += `\n${t("offers_notif_reduction_target_price", { price: requestedPrice, currency: t("offers_currency_sar") })}`
          if (note) baseMsg += `\n${t("offers_notif_reduction_note", { note })}`
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

      const offerSnap = await getDoc(doc(firestore, "offers", offerId));
      const offerData = offerSnap.data();
      if (action === "مطلوبة") {
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
      } else if (action === "تم الاستلام") {
        if (offerData?.supplierId) {
          await addDoc(collection(firestore, "users", offerData.supplierId, "notifications"), {
            userId: offerData.supplierId,
            organizationId: offerData.organizationId || offerData.supplierId,
            type: "sample_received",
            title: "✅ تم استلام العينة",
            message: `قام المقاول بتأكيد استلام العينة لمناقصة: ${offerData.rfqTitle || ""}`,
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
      await updateDoc(doc(firestore, "rfqs", rfqId), {
        status: "Awarded",
        completedAt: new Date().toISOString()
      })

      // Notify the supplier that the supply has been confirmed as complete
      const offerSnap = await getDoc(doc(firestore, "offers", offerId))
      const offerData = offerSnap.data()
      if (offerData?.supplierId) {
        await addDoc(collection(firestore, "users", offerData.supplierId, "notifications"), {
          userId: offerData.supplierId,
          organizationId: offerData.organizationId || offerData.supplierId,
          type: "supply_completed",
          title: "🎉 تم تأكيد اكتمال التوريد",
          message: `قام المقاول بتأكيد اكتمال التوريد لمناقصة: ${offerData.rfqTitle || ""}`,
          offerId: offerId,
          rfqId: rfqId,
          createdAt: new Date().toISOString(),
          read: false
        })
      }

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

        {/* ── Unified Hero Banner ── */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 text-white shadow-2xl shadow-primary/20">
          <div className={cn("absolute top-0 -mt-20 h-64 w-64 rounded-full bg-accent/20 blur-3xl pointer-events-none", locale === 'ar' ? '-mr-20 right-0' : '-ml-20 left-0')} />
          <div className={cn("absolute bottom-0 -mb-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl pointer-events-none", locale === 'ar' ? '-ml-20 left-0' : '-mr-20 right-0')} />

          <div className="relative z-10 space-y-5">
            {/* Back */}
            <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1.5 text-white/60 hover:text-white hover:bg-white/10 -ms-2 h-8 rounded-xl px-3">
              <ArrowRight size={14} className="rotate-180 rtl:rotate-0 shrink-0" />
              <span className="text-sm">{t("offers_back_to_tenders")}</span>
            </Button>

            {/* Title + stat chips */}
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
              <div className="space-y-1.5 flex-1">
                <h1 className={cn("text-3xl font-black text-white", locale !== 'ar' && "tracking-tight")}>
                  {t("offers_page_title")}
                </h1>
                {rfq && (
                  <p className={cn("text-white/75 text-lg font-semibold", locale === 'ar' ? "leading-[1.6]" : "leading-snug")}>
                    {rfq.title}
                  </p>
                )}
                <p className="text-white/50 text-sm">{t("offers_page_desc")}</p>
              </div>

              {!isLoading && (
                <div className="flex flex-wrap items-start gap-3 shrink-0">
                  <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-5 py-3 text-center min-w-[84px]">
                    <p className="text-[10px] font-bold text-white/50 mb-1">{t("offers_total")}</p>
                    <p className="text-3xl font-black text-white leading-none">{offers?.length || 0}</p>
                  </div>
                  <div className="bg-success/20 backdrop-blur-sm border border-success/20 rounded-2xl px-5 py-3 text-center min-w-[84px]">
                    <p className="text-[10px] font-bold text-success/70 mb-1">{t("offers_accepted_count")}</p>
                    <p className="text-3xl font-black text-success leading-none">{offers?.filter((o: any) => o.status === "مقبول").length || 0}</p>
                  </div>
                  <div className="bg-amber-500/20 backdrop-blur-sm border border-amber-500/20 rounded-2xl px-5 py-3 text-center min-w-[84px]">
                    <p className="text-[10px] font-bold text-amber-300/70 mb-1">{t("offers_under_review_count")}</p>
                    <p className="text-3xl font-black text-amber-300 leading-none">{offers?.filter((o: any) => o.status === "قيد المراجعة").length || 0}</p>
                  </div>
                </div>
              )}
            </div>

            {/* RFQ metadata strip */}
            {rfq && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-4 border-t border-white/10 text-sm text-white/60">
                <Badge className="bg-white/10 text-white/80 border-white/10 font-medium rounded-lg hover:bg-white/20">
                  {displayCategory(rfq.category, locale)}
                </Badge>
                {rfq.subCategory && (
                  <span className="text-white/40 text-xs">{displaySubcategory(rfq.subCategory, locale)}</span>
                )}
                <div className="flex items-center gap-1.5">
                  <MapPin size={13} className="shrink-0" />
                  <span>{displayCity(rfq.city, locale)}{rfq.district ? ` · ${displayCity(rfq.district, locale)}` : ''}</span>
                </div>
                {rfq.deadline && (
                  <div className="flex items-center gap-1.5 bg-red-500/20 text-red-300 rounded-lg px-2.5 py-1 text-xs font-medium">
                    <Calendar size={12} className="shrink-0" />
                    {t("offers_deadline_label", { date: fmtDate(rfq.deadline, locale) })}
                  </div>
                )}
                {rfq.products && rfq.products.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Package size={13} className="shrink-0" />
                    <span>{rfq.products.length} {locale === 'ar' ? 'منتج' : 'products'}</span>
                  </div>
                )}
                {rfq.pdfUrl && (
                  <a href={rfq.pdfUrl} target="_blank" rel="noopener noreferrer" download
                    className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white/80 rounded-lg px-3 py-1 text-xs transition-colors">
                    <File size={12} className="shrink-0" />
                    {t("offers_download_pdf")}
                  </a>
                )}
                {rfq.notes && (
                  <div className="flex items-center gap-1.5 bg-blue-500/15 text-blue-200 rounded-lg px-2.5 py-1 text-xs">
                    <Tag size={11} className="shrink-0" />
                    {locale === 'ar' ? 'يوجد ملاحظات' : 'Has notes'}
                  </div>
                )}
                <div className="ms-auto font-mono text-white/25 text-[11px] bg-white/5 border border-white/5 px-2 py-1 rounded-lg hidden sm:block">
                  #{rfqId.substring(0, 10)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Tabs ── */}
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
                  <Card key={offer.id} className={cn(
                    "shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden relative",
                    offer.status === "مقبول" ? "border-success/30" :
                    offer.status === "مرفوض" ? "border-slate-200 opacity-65" :
                    isBestOffer ? "border-amber-300/70 shadow-amber-50" : "border-slate-100"
                  )} style={{
                    borderInlineStart: `3px solid ${
                      offer.status === "مقبول" ? "hsl(155 80% 35%)" :
                      offer.status === "مرفوض" ? "hsl(215 16% 75%)" :
                      isBestOffer ? "hsl(35 92% 50%)" : "hsl(214 32% 88%)"
                    }`
                  }}>
                    {isBestOffer && offer.status === "قيد المراجعة" && (
                      <div className="absolute top-1 start-3 z-10 flex items-center gap-1 bg-amber-400 text-amber-950 text-[10px] font-black px-2.5 py-1 rounded-full shadow-sm whitespace-nowrap">
                        <TrendingUp size={11} /> {t("offers_best_price")}
                      </div>
                    )}
                    <CardContent className="p-0">
                      <div className="flex flex-col md:flex-row">
                        {/* Offer Details */}
                        <div className="p-6 flex-1 space-y-4">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={cn(
                                "h-11 w-11 rounded-xl flex items-center justify-center text-white font-black text-lg shrink-0 shadow-sm select-none",
                                offer.status === "مقبول" ? "bg-success" :
                                offer.status === "مرفوض" ? "bg-slate-400" :
                                isBestOffer ? "bg-amber-500" : "bg-primary/80"
                              )}>
                                {((offer.companyName || offer.supplierName) || "؟").trim().charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                {offer.supplierId ? (
                                  <Link
                                    href={`/contractor/supplier/profile/${offer.supplierId}`}
                                    className="font-bold text-sm text-slate-800 hover:text-primary transition-colors inline-flex items-center gap-1 group"
                                  >
                                    <span className="truncate">{offer.companyName || offer.supplierName || t("offers_registered_supplier")}</span>
                                    <ChevronLeft size={12} className="opacity-0 -mx-1 group-hover:opacity-100 group-hover:mx-0 transition-all rtl:rotate-0 ltr:rotate-180 shrink-0" />
                                  </Link>
                                ) : (
                                  <p className="font-bold text-sm text-slate-800">{offer.companyName || offer.supplierName || t("offers_registered_supplier")}</p>
                                )}
                                {offer.submittedByUserName && (
                                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
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
                            <div className="flex items-center gap-2 shrink-0">
                              {offer.supplierId && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  asChild
                                  className="h-8 px-3 rounded-lg text-xs font-bold text-primary hover:text-primary hover:bg-primary/10 gap-1"
                                >
                                  <Link href={`/contractor/supplier/profile/${offer.supplierId}`}>
                                    <Briefcase size={12} />
                                    {t("offers_view_supplier_profile")}
                                  </Link>
                                </Button>
                              )}
                              {getStatusBadge(offer.status || "قيد المراجعة")}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-3 text-sm mt-1">
                            <div className={cn(
                              "flex items-baseline gap-2 px-4 py-2.5 rounded-2xl border",
                              isBestOffer ? "bg-amber-50 border-amber-200/60" : "bg-primary/5 border-primary/10"
                            )}>
                              <span className="text-xs text-muted-foreground me-0.5">{t("offers_proposed_price")}:</span>
                              <span className={cn("font-black text-2xl tabular-nums", isBestOffer ? "text-amber-600" : "text-primary")}>
                                {offer.price}
                              </span>
                              <span className="text-sm font-medium text-muted-foreground">{t("offers_currency_sar")}</span>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground" suppressHydrationWarning>
                              <Calendar size={14} />
                              <span suppressHydrationWarning>{fmtDate(offer.createdAt, locale)}</span>
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
                          <div className="bg-slate-50/60 p-5 grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-col items-center justify-center gap-2.5 md:border-s border-t md:border-t-0 min-w-[190px] border-slate-100">
                            <Button
                              onClick={() => setConfirmDecisionTarget({ offer, decision: "مقبول" })}
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
                              onClick={() => setConfirmDecisionTarget({ offer, decision: "مرفوض" })}
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
                          <div className="bg-success/5 p-5 grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-col items-center justify-center gap-2.5 md:border-s border-t md:border-t-0 min-w-[190px] border-success/15">
                            {deliveryByOfferId[offer.id] && deliveryByOfferId[offer.id].status === "pending_confirmation" && (
                              <div className="w-full p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-1.5 mb-1">
                                <p className="font-bold text-amber-800 flex items-center gap-1.5">
                                  <Truck size={12} />
                                  {t("delivery_notice_banner")}
                                </p>
                                <p className="text-amber-700">{t("delivery_notice_driver")}: {deliveryByOfferId[offer.id].deliveryPersonName}</p>
                                <p className="text-amber-700" suppressHydrationWarning>
                                  {t("delivery_notice_date")}: {fmtDate(deliveryByOfferId[offer.id].deliveryDate, locale)}
                                </p>
                              </div>
                            )}
                            {deliveryByOfferId[offer.id] && deliveryByOfferId[offer.id].status === "pending_confirmation" && (
                              <Button
                                onClick={() => setConfirmDeliveryDoc(deliveryByOfferId[offer.id])}
                                className="w-full bg-success hover:bg-success/90 gap-2 rounded-full transition-all text-xs"
                                size="sm"
                              >
                                <CheckCircle2 size={14} />
                                {t("delivery_confirm_btn")}
                              </Button>
                            )}
                            {deliveryByOfferId[offer.id] && deliveryByOfferId[offer.id].status === "confirmed" && (
                              <>
                                <Badge className="w-full justify-center bg-success/10 text-success border-success/20 gap-1.5 py-1.5">
                                  <CheckCircle2 size={12} />
                                  {t("delivery_confirmed_badge")}
                                </Badge>
                                <Link href={`/contractor/receipts/${deliveryByOfferId[offer.id].id}`} className="w-full">
                                  <Button variant="outline" className="w-full gap-2 rounded-full text-xs" size="sm">
                                    <FileCheck size={14} />
                                    {t("delivery_view_receipt")}
                                  </Button>
                                </Link>
                              </>
                            )}
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
                          <div className="bg-blue-50/30 p-5 grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-col items-center justify-center gap-2.5 md:border-s border-t md:border-t-0 min-w-[190px] border-blue-100">
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
              <div className="rounded-2xl border-2 border-dashed border-slate-200 p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                <TrendingUp size={40} className="opacity-20" />
                <p className="font-bold text-base">{t("offers_need_two")}</p>
                <p className="text-sm">{t("offers_need_two_desc")}</p>
              </div>
            ) : (() => {
              const allPrices      = sortedOffers.map((o: any) => parseFloat(o.price) || 0)
              const allDurDays     = sortedOffers.map((o: any) => {
                const n = parseInt(o.executionDuration) || 0
                if (!n) return Infinity
                const u = o.executionDurationUnit
                return n * (u === "أشهر" ? 30 : u === "أسابيع" ? 7 : 1)
              })
              const allDates       = sortedOffers.map((o: any) => o.createdAt ? new Date(o.createdAt).getTime() : 0)
              const lowestPrice    = Math.min(...allPrices)
              const highestPrice   = Math.max(...allPrices)
              const fastestDur     = Math.min(...allDurDays)
              const latestDate     = Math.max(...allDates)

              const wp   = (o: any)            => (parseFloat(o.price) || 0) === lowestPrice
              const wd   = (o: any, i: number) => allDurDays[i] === fastestDur && allDurDays[i] !== Infinity
              const wdat = (o: any)            => o.createdAt ? new Date(o.createdAt).getTime() === latestDate : false
              const sc   = (o: any, i: number) => [wp(o), wd(o, i), wdat(o)].filter(Boolean).length

              const bestIdx = sortedOffers.reduce((best: number, o: any, i: number) => {
                const a = sc(o, i), b = sc(sortedOffers[best], best)
                if (a > b) return i
                if (a === b && (parseFloat(o.price)||0) < (parseFloat(sortedOffers[best].price)||0)) return i
                return best
              }, 0)

              /* ─── palette ─── */
              const NAVY   = "hsl(220 56% 11%)"
              const NAVY2  = "hsl(217 25% 27%)"
              const TEAL   = "hsl(184 74% 48%)"
              const GREEN  = "hsl(155 80% 35%)"
              const BLUE   = "hsl(202 96% 32%)"
              const INK    = "hsl(224 40% 14%)"
              const MUTED  = "hsl(215 16% 47%)"
              const LINE   = "hsl(214 32% 91%)"
              const LINESO = "hsl(214 32% 94%)"
              const SL50   = "hsl(210 40% 98%)"
              const SL100  = "hsl(210 40% 96%)"
              const SL400  = "hsl(215 20% 65%)"

              /* ─── criteria config ─── */
              const CRIT: Record<string, { color: string; tint: string; soft: string; wash: string; label: string; sub: string; win: string }> = {
                price: { color: GREEN, tint: "hsl(155 80% 35% / 0.10)", soft: "hsl(155 50% 40%)", wash: "linear-gradient(90deg, hsl(155 80% 35% / 0.06), transparent 80%)", label: t("offers_price_col"), sub: locale === 'ar' ? 'ريال سعودي' : 'SAR', win: locale === 'ar' ? 'الأوفر' : 'Cheapest' },
                dur:   { color: BLUE,  tint: "hsl(202 96% 32% / 0.10)", soft: "hsl(202 60% 40%)", wash: "linear-gradient(90deg, hsl(202 96% 32% / 0.05), transparent 80%)", label: t("offers_duration_col"), sub: locale === 'ar' ? 'وقت التنفيذ' : 'Execution', win: locale === 'ar' ? 'الأسرع' : 'Fastest' },
                date:  { color: TEAL,  tint: "hsl(184 74% 40% / 0.14)", soft: "hsl(184 60% 32%)", wash: "linear-gradient(90deg, hsl(184 74% 40% / 0.07), transparent 80%)", label: t("offers_date_col"), sub: locale === 'ar' ? 'تاريخ التقديم' : 'Submitted', win: locale === 'ar' ? 'الأحدث' : 'Newest' },
              }

              /* ─── Eastern Arabic-Indic numeral converter ─── */
              const toAr = (n: number | string) => String(n).replace(/[0-9]/g, (d: string) => "٠١٢٣٤٥٦٧٨٩"[Number(d)])

              /* ─── win chip atom ─── */
              const WinChip = ({ type }: { type: string }) => {
                const c = CRIT[type]
                return (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, width: "fit-content", fontSize: 10, fontWeight: 800, borderRadius: 999, padding: "2px 8px", color: c.color, background: c.tint }}>
                    <CheckCircle2 size={10} />
                    {c.win}
                  </span>
                )
              }

              /* ─── score bar atom ─── */
              const ScoreBar = ({ wins }: { wins: { price: boolean; dur: boolean; date: boolean } }) => {
                const dots = [{ on: wins.price, c: GREEN }, { on: wins.dur, c: BLUE }, { on: wins.date, c: TEAL }]
                const n = dots.filter(d => d.on).length
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {dots.map((d, di) => <span key={di} style={{ height: 6, width: d.on ? 22 : 11, borderRadius: 999, background: d.on ? d.c : LINE, transition: "width .3s ease" }} />)}
                    <span style={{ fontSize: 11, fontWeight: 800, color: SL400, marginInlineStart: 3 }}>{toAr(n)}/٣</span>
                  </div>
                )
              }

              /* ─── grid cell factory — composites column-card styling per cell ─── */
              const makeCell = (props: { key: string; row: number; col: number; kind: 'rail' | 'offer'; best?: boolean; last?: boolean; first?: boolean; wash?: string; children: React.ReactNode }): React.ReactElement => {
                const { key, row, col, kind, best = false, last = false, first = false, wash, children } = props
                const base: Record<string, unknown> = { gridColumn: col, gridRow: row, position: "relative", ...(!last && { borderBottom: `1px solid ${LINESO}` }) }
                let style: Record<string, unknown>
                if (kind === "rail") {
                  style = { ...base, background: `linear-gradient(180deg, ${SL50}, #fff)`, borderInlineStart: `1px solid ${LINE}`, borderStartStartRadius: first ? 20 : 0, borderEndStartRadius: last ? 20 : 0 }
                } else {
                  style = { ...base, background: wash ?? (best ? "hsl(220 56% 11% / 0.018)" : "#fff"), borderTop: best ? "1.5px solid hsl(220 56% 11% / 0.16)" : `1px solid ${LINE}`, borderInlineEnd: best ? "1.5px solid hsl(220 56% 11% / 0.16)" : `1px solid ${LINE}`, borderInlineStart: "none" }
                  if (first) { style.borderTopLeftRadius = 20; style.borderTopRightRadius = 20; style.borderTop = "none" }
                  if (last)  { style.borderBottomLeftRadius = 20; style.borderBottomRightRadius = 20; style.borderBottom = best ? "1.5px solid hsl(220 56% 11% / 0.16)" : `1px solid ${LINE}` }
                }
                return <div key={key} style={style as React.CSSProperties}>{children}</div>
              }

              const N = sortedOffers.length
              const PAD = "0 16px"
              const cells: React.ReactElement[] = []

              /* per-offer wins */
              const offerWins = sortedOffers.map((o: any, i: number) => ({ price: wp(o), dur: wd(o, i), date: wdat(o) })) as Array<{ price: boolean; dur: boolean; date: boolean }>

              /* ===== ROW 1: header ===== */
              cells.push(makeCell({ key: "rh", row: 1, col: 1, kind: "rail", first: true,
                children: (
                  <div style={{ padding: "16px 18px 14px", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", minHeight: 140 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, ...(locale !== 'ar' && { letterSpacing: ".08em" }), color: SL400 }}>{locale === 'ar' ? 'المعيار' : 'Criteria'}</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: INK, marginTop: 3 }}>{locale === 'ar' ? 'تفاصيل العرض' : 'Offer Details'}</span>
                  </div>
                ),
              }))

              sortedOffers.forEach((offer: any, i: number) => {
                const best = i === bestIdx
                const wins = offerWins[i]
                const initials = (offer.supplierName || "S").trim().charAt(0).toUpperCase()
                cells.push(makeCell({ key: "h" + offer.id, row: 1, col: 2 + i, kind: "offer", best, first: true,
                  children: (
                    <div style={{ position: "relative" }}>
                      {best && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, borderTopLeftRadius: 20, borderTopRightRadius: 20, background: `linear-gradient(90deg, ${NAVY}, ${NAVY2} 70%, ${TEAL})` }} />}
                      <div style={{ padding: "18px 14px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minHeight: 140, justifyContent: "center" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: "3px 10px", color: best ? "#fff" : SL400, background: best ? `linear-gradient(135deg, ${NAVY}, ${NAVY2})` : SL100, boxShadow: best ? "0 4px 12px -4px hsl(220 56% 11% / 0.5)" : "none" }}>
                          {best && <Star size={10} className="fill-white text-white shrink-0" />}
                          {best ? (locale === 'ar' ? 'الأفضل شاملاً' : 'Overall Best') : `#${toAr(i + 1)}`}
                        </span>
                        <span style={{ width: 44, height: 44, borderRadius: 14, display: "grid", placeItems: "center", fontSize: 18, fontWeight: 900, color: best ? "#fff" : NAVY2, background: best ? `linear-gradient(140deg, ${NAVY}, ${NAVY2})` : SL100, boxShadow: best ? "0 8px 20px -8px hsl(220 56% 11% / 0.6)" : `inset 0 0 0 1px ${LINE}` }}>
                          {initials}
                        </span>
                        {offer.supplierId ? (
                          <Link href={`/contractor/supplier/profile/${offer.supplierId}`} style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.3, textDecoration: "none", color: best ? NAVY : INK, textAlign: "center" }}>
                            {offer.supplierName || t("offers_registered_supplier")}
                          </Link>
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.3, color: best ? NAVY : INK, textAlign: "center" }}>
                            {offer.supplierName || t("offers_registered_supplier")}
                          </span>
                        )}
                        <ScoreBar wins={wins} />
                        {getStatusBadge(offer.status || "قيد المراجعة")}
                      </div>
                    </div>
                  ),
                }))
              })

              /* ===== value row builder ===== */
              const valueRow = (rowNum: number, type: 'price' | 'dur' | 'date', renderCell: (offer: any, best: boolean, isW: boolean, c: { color: string; tint: string; soft: string; wash: string; label: string; sub: string; win: string }) => React.ReactNode) => {
                const c = CRIT[type]
                cells.push(makeCell({ key: "r" + type, row: rowNum, col: 1, kind: "rail",
                  children: (
                    <div style={{ padding: "0 16px", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", color: c.color, background: c.tint }}>
                          {type === 'price' && <Tag size={13} />}
                          {type === 'dur'   && <Truck size={13} />}
                          {type === 'date'  && <Calendar size={13} />}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: INK }}>{c.label}</span>
                      </div>
                      <span style={{ fontSize: 11, color: MUTED, paddingInlineStart: 36 }}>{c.sub}</span>
                    </div>
                  ),
                }))
                sortedOffers.forEach((offer: any, i: number) => {
                  const best = i === bestIdx
                  const isW = offerWins[i][type]
                  cells.push(makeCell({ key: type + offer.id, row: rowNum, col: 2 + i, kind: "offer", best, wash: isW ? c.wash : undefined,
                    children: (
                      <div style={{ position: "relative", height: "100%", padding: PAD, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, minHeight: type === 'price' ? 84 : type === 'dur' ? 72 : 64 }}>
                        {isW && <span style={{ position: "absolute", insetInlineStart: 0, top: "22%", bottom: "22%", width: 3, borderRadius: 999, background: c.color, opacity: 0.6 }} />}
                        {renderCell(offer, best, isW, c)}
                      </div>
                    ),
                  }))
                })
              }

              /* ===== ROW 2: price ===== */
              valueRow(2, 'price', (offer, _best, isW, c) => {
                const price = parseFloat(offer.price) || 0
                const savings = highestPrice > 0 && price < highestPrice ? Math.round(((highestPrice - price) / highestPrice) * 100) : 0
                return (
                  <>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                      <span style={{ fontWeight: 900, lineHeight: 1, letterSpacing: "-.01em", fontSize: isW ? 21 : 19, color: isW ? c.color : SL400 }}>
                        {locale === 'ar' ? toAr(price.toLocaleString('en-US')) : price.toLocaleString('en-US')}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: isW ? c.soft : SL400 }}>{t("offers_currency_sar")}</span>
                    </div>
                    {isW && savings > 0 && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 800, color: c.color }}>
                        <ArrowDown size={11} />
                        {locale === 'ar' ? `أقل من الأعلى بنسبة ${toAr(savings)}٪` : `${savings}% below highest`}
                      </span>
                    )}
                    {isW && <WinChip type="price" />}
                  </>
                )
              })

              /* ===== ROW 3: duration ===== */
              const durUnitMap: Record<string, string> = { 'أيام': 'days', 'أسابيع': 'weeks', 'أشهر': 'months' }
              const fmtDurUnit = (unit?: string) => {
                const raw = unit || 'أيام'
                if (locale === 'ar') return raw
                return durUnitMap[raw] ?? raw
              }
              valueRow(3, 'dur', (offer, _best, isW, c) => (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    <span style={{ fontWeight: 900, lineHeight: 1, fontSize: isW ? 22 : 17, color: isW ? c.color : SL400 }}>
                      {offer.executionDuration ? (locale === 'ar' ? toAr(offer.executionDuration) : offer.executionDuration) : "—"}
                    </span>
                    {offer.executionDuration && <span style={{ fontSize: 11, fontWeight: 600, color: isW ? c.soft : SL400 }}>{fmtDurUnit(offer.executionDurationUnit)}</span>}
                  </div>
                  {isW && <WinChip type="dur" />}
                </>
              ))

              /* ===== ROW 4: date ===== */
              valueRow(4, 'date', (offer, _best, isW, c) => (
                <>
                  <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.4, color: isW ? c.soft : SL400 }} suppressHydrationWarning>
                    {fmtDate(offer.createdAt, locale)}
                  </span>
                  {isW && <WinChip type="date" />}
                </>
              ))

              /* ===== ROW 5: file ===== */
              cells.push(makeCell({ key: "rfile", row: 5, col: 1, kind: "rail",
                children: (
                  <div style={{ padding: "0 16px", height: "100%", minHeight: 52, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", color: SL400, background: SL100 }}><File size={13} /></span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: INK }}>{t("offers_file_col")}</span>
                  </div>
                ),
              }))
              sortedOffers.forEach((offer: any, i: number) => {
                const best = i === bestIdx
                cells.push(makeCell({ key: "file" + offer.id, row: 5, col: 2 + i, kind: "offer", best,
                  children: (
                    <div style={{ height: "100%", minHeight: 52, padding: PAD, display: "flex", alignItems: "center" }}>
                      {offer.offerPdfUrl ? (
                        <a href={offer.offerPdfUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: BLUE, textDecoration: "none" }}>
                          <Download size={14} />{t("offers_view_file")}
                        </a>
                      ) : (
                        <span style={{ fontSize: 18, color: "hsl(213 27% 84%)" }}>—</span>
                      )}
                    </div>
                  ),
                }))
              })

              /* ===== ROW 6: CTA ===== */
              cells.push(makeCell({ key: "rcta", row: 6, col: 1, kind: "rail", last: true,
                children: (
                  <div style={{ padding: "0 16px", height: "100%", minHeight: 68, display: "flex", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: NAVY2 }}>{t("offers_decision_col")}</span>
                  </div>
                ),
              }))
              sortedOffers.forEach((offer: any, i: number) => {
                const best = i === bestIdx
                const isDecided = offer.status === "مقبول" || offer.status === "مرفوض"
                cells.push(makeCell({ key: "cta" + offer.id, row: 6, col: 2 + i, kind: "offer", best, last: true,
                  children: (
                    <div style={{ height: "100%", minHeight: 68, padding: PAD, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {isDecided ? (
                        <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>{getStatusBadge(offer.status)}</div>
                      ) : (
                        <Button
                          onClick={() => setConfirmDecisionTarget({ offer, decision: "مقبول" })}
                          disabled={processingId === offer.id}
                          style={{ width: "auto", minWidth: 130, height: 38, borderRadius: 10, border: "none", cursor: processingId === offer.id ? "default" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 13, fontWeight: 800, paddingLeft: 28, paddingRight: 28, color: best ? "#fff" : NAVY2, background: best ? `linear-gradient(135deg, ${NAVY}, ${NAVY2})` : "#fff", boxShadow: best ? "0 10px 22px -10px hsl(220 56% 11% / 0.55)" : `inset 0 0 0 1.5px ${LINE}`, transition: "transform .15s ease, box-shadow .2s ease", opacity: processingId === offer.id ? 0.7 : 1 }}>
                          {processingId === offer.id ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                          {processingId === offer.id ? (locale === 'ar' ? 'جارٍ القبول…' : 'Processing…') : t("offers_accept_btn")}
                        </Button>
                      )}
                    </div>
                  ),
                }))
              })

              /* ─── render ─── */
              return (
                <div dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                  {/* heading + toolbar */}
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 800, color: TEAL, background: "hsl(184 74% 40% / 0.12)", padding: "5px 12px", borderRadius: 999, marginBottom: 12 }}>
                        <Star size={12} />{locale === 'ar' ? 'مقارنة ذكية' : 'Smart Compare'}
                      </div>
                      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: NAVY, ...(locale !== 'ar' && { letterSpacing: "-.01em" }), lineHeight: 1.6 }}>
                        {locale === 'ar' ? 'مقارنة العروض المقدّمة' : 'Submitted Offer Comparison'}
                      </h2>
                      <p style={{ margin: "6px 0 0", fontSize: 14.5, color: MUTED }}>
                        {locale === 'ar' ? 'راجع العروض جنباً إلى جنب واتخذ قرارك بثقة.' : 'Review offers side by side and decide with confidence.'}
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: MUTED }}>{locale === 'ar' ? 'ترتيب حسب' : 'Sort by'}</span>
                      <div style={{ display: "inline-flex", background: SL100, borderRadius: 14, padding: 5, gap: 3 }}>
                        {([
                          { k: "price",    label: locale === 'ar' ? 'الأقل سعراً'    : 'Lowest Price' },
                          { k: "date",     label: locale === 'ar' ? 'الأحدث'         : 'Newest' },
                          { k: "duration", label: locale === 'ar' ? 'الأسرع تنفيذاً' : 'Fastest' },
                        ] as const).map(tb => (
                          <button key={tb.k} onClick={() => setSortBy(tb.k)} style={{ border: "none", outline: "none", cursor: "pointer", fontFamily: "inherit", padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 800, color: sortBy === tb.k ? NAVY : SL400, background: sortBy === tb.k ? "#fff" : "transparent", boxShadow: sortBy === tb.k ? "0 4px 12px -6px hsl(220 30% 20% / 0.35)" : "none", transition: "all .18s ease" }}>
                            {tb.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* comparison surface */}
                  <div style={{ overflowX: "auto" }}>
                    <div style={{ minWidth: `${190 + N * 200}px` }}>
                      <div style={{ borderRadius: 20, background: "#fff", boxShadow: "0 30px 70px -40px hsl(220 40% 20% / 0.35)", padding: 12 }}>
                        <div style={{ display: "grid", gridTemplateColumns: `190px repeat(${N}, minmax(200px,1fr))`, columnGap: 10, rowGap: 0, alignItems: "stretch" }}>
                          {cells}
                        </div>
                      </div>
                    </div>
                  </div>

                  <p style={{ textAlign: "center", fontSize: 12.5, color: SL400, marginTop: 18 }}>
                    {locale === 'ar' ? 'العمود المميّز يُحدَّد تلقائياً وفق أعلى عدد من نقاط التفوّق (السعر · المدة · التاريخ).' : 'The highlighted column is auto-selected based on the highest number of wins across all criteria.'}
                  </p>
                </div>
              )
            })()}
          </TabsContent>

          <TabsContent value="inquiries" className="m-0 mt-6">
            <InquiriesSection rfqId={rfqId} rfqTitle={rfq?.title || ""} profile={profile} />
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={!!confirmDecisionTarget} onOpenChange={(open) => !open && setConfirmDecisionTarget(null)}>
        <AlertDialogContent dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDecisionTarget?.decision === "مقبول" ? t("offers_confirm_accept_title") : t("offers_confirm_reject_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDecisionTarget?.decision === "مقبول"
                ? t("offers_confirm_accept_desc", { supplier: confirmDecisionTarget?.offer?.companyName || confirmDecisionTarget?.offer?.supplierName || t("offers_registered_supplier") })
                : t("offers_confirm_reject_desc", { supplier: confirmDecisionTarget?.offer?.companyName || confirmDecisionTarget?.offer?.supplierName || t("offers_registered_supplier") })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={confirmDecisionTarget?.decision === "مقبول" ? "bg-success hover:bg-success/90" : "bg-destructive hover:bg-destructive/90"}
              onClick={() => {
                if (confirmDecisionTarget) {
                  handleDecision(confirmDecisionTarget.offer.id, confirmDecisionTarget.decision)
                  setConfirmDecisionTarget(null)
                }
              }}
            >
              {confirmDecisionTarget?.decision === "مقبول" ? t("offers_accept") : t("offers_reject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                {t("offers_target_price_label")} ({t("offers_currency_sar")}) <span className="text-muted-foreground text-xs font-normal">({t("optional")})</span>
              </label>
              <input
                type="number"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                placeholder={t("offers_target_price_placeholder")}
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


      {/* Confirm Delivery Dialog */}
      <Dialog open={!!confirmDeliveryDoc} onOpenChange={(open) => { if (!open) { setConfirmDeliveryDoc(null); setReceiverName("") } }}>
        <DialogContent className="sm:max-w-md" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader className={cn(locale === 'ar' ? 'text-right sm:text-right' : 'text-left sm:text-left')}>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-success" />
              {t("delivery_confirm_title")}
            </DialogTitle>
            <DialogDescription>{t("delivery_confirm_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {confirmDeliveryDoc && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                <p className="text-slate-600">{t("delivery_notice_driver")}: <span className="font-bold">{confirmDeliveryDoc.deliveryPersonName}</span></p>
                <p className="text-slate-600" suppressHydrationWarning>{t("delivery_notice_date")}: <span className="font-bold">{fmtDate(confirmDeliveryDoc.deliveryDate, locale)}</span></p>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("delivery_receiver_label")} <span className="text-destructive">*</span></Label>
              <Input
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder={t("delivery_receiver_placeholder")}
                disabled={isConfirmingDelivery}
              />
            </div>
          </div>
          <DialogFooter className={cn("flex flex-row gap-2 mt-2", locale === 'ar' ? "flex-row-reverse justify-start" : "justify-end")}>
            <Button variant="outline" onClick={() => setConfirmDeliveryDoc(null)} disabled={isConfirmingDelivery}>{t("cancel")}</Button>
            <Button
              onClick={handleConfirmDelivery}
              disabled={isConfirmingDelivery || !receiverName.trim()}
              className="bg-success hover:bg-success/90 gap-2"
            >
              {isConfirmingDelivery ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
              {t("delivery_confirm_submit")}
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
                      {fmtDate(inq.createdAt, locale)}
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
                          {fmtDate(inq.repliedAt, locale)}
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
