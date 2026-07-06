"use client"

import { useState, useEffect } from "react"
import { useTranslations, useLocale } from 'next-intl'
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { History, Eye, Clock, CheckCircle2, XCircle, MoreVertical, Loader2, Trash2, Calendar, Tag, DollarSign, MessageSquare, Phone, ArrowDown, Box, FileText, CircleDot, Check, AlertCircle, Archive, ChevronDown, ChevronUp, Truck } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, orderBy, deleteDoc, doc, setDoc, getDoc, updateDoc, addDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "@/i18n/routing"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"

export default function SupplierOffersPage() {
  const t = useTranslations("Portal.Supplier")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const { toast } = useToast()
  const router = useRouter()
  const [viewOffer, setViewOffer] = useState<any | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [openingChat, setOpeningChat] = useState<string | null>(null)
  const [updatePriceOffer, setUpdatePriceOffer] = useState<any | null>(null)
  const [newPrice, setNewPrice] = useState("")
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false)
  const [confirmSampleOffer, setConfirmSampleOffer] = useState<any | null>(null)
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [deliveryOffer, setDeliveryOffer] = useState<any | null>(null)
  const [deliveryPersonName, setDeliveryPersonName] = useState("")
  const [handoverRecipientName, setHandoverRecipientName] = useState("")
  const [deliveryDate, setDeliveryDate] = useState("")
  const [deliveryNotes, setDeliveryNotes] = useState("")
  const [isSendingDelivery, setIsSendingDelivery] = useState(false)

  const openChat = async (offer: any) => {
    if (!user) return
    router.push(`/supplier/chat/${offer.id}`)
  }

  const handleArchive = async (offerId: string) => {
    if (!firestore) return
    setArchivingId(offerId)
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        archived: true,
        archivedAt: new Date().toISOString()
      })
      toast({ title: t("archive_success"), description: t("archive_success_desc") })
    } catch {
      toast({ title: t("error_title"), description: t("archive_failed"), variant: "destructive" })
    } finally {
      setArchivingId(null)
    }
  }

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    if (profile?.organizationId) {
      return query(
        collection(firestore, "offers"),
        where("organizationId", "==", profile.organizationId)
      )
    }
    
    return query(
      collection(firestore, "offers"),
      where("supplierId", "==", user.uid)
    )
  }, [firestore, user, isUserLoading, profile?.organizationId])

  const { data: rawOffers, isLoading: isCollectionLoading } = useCollection(offersQuery)
  const isLoading = isUserLoading || isCollectionLoading

  // Deliveries for this supplier — used to show delivery notice status per offer
  const deliveriesQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "deliveries"),
      where("supplierOrgId", "==", profile?.organizationId || user.uid)
    )
  }, [firestore, user, isUserLoading, profile?.organizationId])
  const { data: deliveries } = useCollection(deliveriesQuery)
  const deliveryByOfferId: Record<string, any> = {}
  ;(deliveries || []).forEach((d: any) => { deliveryByOfferId[d.offerId] = d })

  const handleSendDelivery = async () => {
    if (!firestore || !user || !deliveryOffer || !deliveryPersonName.trim() || !deliveryDate) return
    setIsSendingDelivery(true)
    try {
      await addDoc(collection(firestore, "deliveries"), {
        rfqId: deliveryOffer.rfqId || null,
        offerId: deliveryOffer.id,
        contractorOrgId: deliveryOffer.contractorOrgId || deliveryOffer.contractorId,
        contractorId: deliveryOffer.contractorId || null,
        supplierOrgId: profile?.organizationId || user.uid,
        supplierId: user.uid,
        supplierName: profile?.companyName || profile?.name || t("generic_supplier"),
        deliveryPersonName: deliveryPersonName.trim(),
        handoverRecipientName: handoverRecipientName.trim() || null,
        deliveryDate: new Date(deliveryDate).toISOString(),
        notes: deliveryNotes.trim() || null,
        rfqTitle: deliveryOffer.rfqTitle || "",
        items: deliveryOffer.products || [],
        status: "pending_confirmation",
        createdAt: serverTimestamp()
      })

      if (deliveryOffer.contractorId) {
        await addDoc(collection(firestore, "users", deliveryOffer.contractorId, "notifications"), {
          userId: deliveryOffer.contractorId,
          organizationId: deliveryOffer.contractorOrgId || deliveryOffer.contractorId,
          type: "delivery_notice",
          title: "🚚 إشعار تسليم جديد",
          message: `قام المورد بإرسال إشعار تسليم لطلب عروض الأسعار: ${deliveryOffer.rfqTitle || ""}`,
          offerId: deliveryOffer.id,
          rfqId: deliveryOffer.rfqId || null,
          createdAt: new Date().toISOString(),
          read: false
        })
      }

      toast({ title: t("delivery_sent_toast"), description: t("delivery_sent_desc") })
      setDeliveryOffer(null)
      setDeliveryPersonName("")
      setHandoverRecipientName("")
      setDeliveryDate("")
      setDeliveryNotes("")
    } catch (err) {
      toast({ title: t("error_title"), variant: "destructive" })
    } finally {
      setIsSendingDelivery(false)
    }
  }

  // Auto-delete archived offers older than 30 days
  useEffect(() => {
    if (!firestore || !rawOffers) return
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
    const expired = rawOffers.filter((o: any) => {
      if (!o.archived || !o.archivedAt) return false
      return Date.now() - new Date(o.archivedAt).getTime() > THIRTY_DAYS
    })
    expired.forEach((o: any) => {
      deleteDoc(doc(firestore, "offers", o.id)).catch(() => {})
    })
  }, [firestore, rawOffers])
  const allOffers = rawOffers
    ? [...rawOffers].sort((a: any, b: any) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return bTime - aTime
      })
    : []
  const offers = allOffers.filter((o: any) => !o.archived)
  const archivedOffers = allOffers.filter((o: any) => o.archived)

  // Stats
  const pendingCount = offers.filter((o: any) => o.status === "قيد المراجعة").length
  const acceptedCount = offers.filter((o: any) => o.status === "مقبول").length
  const rejectedCount = offers.filter((o: any) => o.status === "مرفوض").length

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "مقبول":   
        return (
          <Badge className="bg-success/10 text-success border-success/20 gap-1">
            <Check size={12} />{t("accepted_status")}
          </Badge>
        )
      case "مرفوض":  
        return (
          <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none gap-1">
            <XCircle size={12} />{t("rejected_status")}
          </Badge>
        )
      case "مطلوب تخفيض":
        return (
          <Badge className="bg-amber-100 text-amber-700 border-none gap-1">
            <AlertCircle size={12} />{t("price_reduction_requested")}
          </Badge>
        )
      case "تم التسليم":
        return (
          <Badge className="bg-blue-50 text-blue-600 border-blue-100 gap-1">
            <CheckCircle2 size={12} />{t("delivered_status")}
          </Badge>
        )
      default:
        return (
          <Badge className="bg-amber-50 text-amber-600 border-amber-100 gap-1">
            <CircleDot size={12} />{t("pending_review")}
          </Badge>
        )
    }
  }

  const handleWithdraw = async (offerId: string) => {
    if (!firestore) return
    setDeletingId(offerId)
    try {
      // Fetch offer data before deleting so we can notify the contractor
      let contractorId: string | null = null
      let rfqTitle = ""
      try {
        const snap = await getDoc(doc(firestore, "offers", offerId))
        if (snap.exists()) {
          contractorId = snap.data()?.contractorId || null
          rfqTitle = snap.data()?.rfqTitle || ""
        }
      } catch {}

      await deleteDoc(doc(firestore, "offers", offerId))

      // Notify contractor of withdrawal
      if (contractorId) {
        try {
          await addDoc(collection(firestore, "users", contractorId, "notifications"), {
            userId: contractorId,
            type: "offer_withdrawn",
            title: t("withdraw_notif_title"),
            message: t("withdraw_notif_msg", { title: rfqTitle }),
            createdAt: new Date().toISOString(),
            read: false
          })
        } catch {}
      }

      toast({ title: t("withdraw_success"), description: t("withdraw_success_desc") })
    } catch {
      toast({ title: t("error_title"), description: t("withdraw_failed"), variant: "destructive" })
    } finally {
      setDeletingId(null)
    }
  }

  const handleUpdatePrice = async () => {
    if (!firestore || !updatePriceOffer || !newPrice) return;
    setIsUpdatingPrice(true);
    try {
      await updateDoc(doc(firestore, "offers", updatePriceOffer.id), {
        price: newPrice,
        status: "قيد المراجعة",
        updatedAt: new Date().toISOString()
      });

      // Notify the contractor that the supplier submitted a new lower price
      if (updatePriceOffer.contractorId) {
        await addDoc(collection(firestore, "users", updatePriceOffer.contractorId, "notifications"), {
          userId: updatePriceOffer.contractorId,
          organizationId: updatePriceOffer.contractorOrgId || updatePriceOffer.contractorId,
          type: "price_updated",
          title: "💰 قام المورد بتحديث سعر عرضه",
          message: `تم تحديث السعر لطلب عروض الأسعار: ${updatePriceOffer.rfqTitle || ""}. السعر الجديد: ${newPrice} ر.س`,
          offerId: updatePriceOffer.id,
          rfqId: updatePriceOffer.rfqId,
          rfqTitle: updatePriceOffer.rfqTitle || "",
          createdAt: new Date().toISOString(),
          read: false
        });
      }

      toast({ title: t("price_updated"), description: t("price_updated_desc") });
      setUpdatePriceOffer(null);
      setNewPrice("");
    } catch (error) {
      toast({ title: t("error_title"), description: t("price_update_failed"), variant: "destructive" });
    } finally {
      setIsUpdatingPrice(false);
    }
  }

  const handleSampleAction = async (offerId: string, action: "تم الإرسال") => {
    if (!firestore || !user) return;
    setDeletingId(offerId); // Reusing deletingId as a loading state for this quick action
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        sampleStatus: action,
        sampleUpdatedAt: new Date().toISOString()
      });
      
      const offerSnap = await getDoc(doc(firestore, "offers", offerId));
      const offerData = offerSnap.data();
      if (offerData?.contractorId) {
        // Use hardcoded strings — never use t() for Firestore writes, keys may fail
        const rfqTitle = offerData.rfqTitle || ""
        await addDoc(collection(firestore, "users", offerData.contractorId, "notifications"), {
          userId: offerData.contractorId,
          organizationId: offerData.contractorOrgId || offerData.contractorId,
          type: "sample_sent",
          title: "📦 تم إرسال العينة من المورد",
          message: `قام المورد بإرسال العينة لطلب عروض الأسعار: ${rfqTitle}. يرجى تأكيد الاستلام.`,
          offerId: offerId,
          rfqId: offerData.rfqId,
          createdAt: new Date().toISOString(),
          read: false
        });
      }

      toast({ title: t("sample_confirmed_title"), description: t("sample_confirmed_desc") });
      setConfirmSampleOffer(null);
      // Open chat dialog after sending
      setOpeningChat(offerId);
    } catch (error) {
      toast({ title: t("error_title"), description: t("sample_error"), variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <PortalLayout>
      <div className={cn("space-y-6", locale === 'ar' ? 'text-right' : 'text-left')}>
        {/* Header */}
        <div>
          <h1 className="text-3xl font-black text-foreground font-headline">{t("offers_page_title")}</h1>
          <p className="text-muted-foreground mt-1">{t("offers_page_desc")}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                <Clock size={20} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("offers_pending")}</p>
                <p className="text-xl font-bold text-slate-800">{pendingCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-success/10 flex items-center justify-center text-success">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("offers_accepted")}</p>
                <p className="text-xl font-bold text-slate-800">{acceptedCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
                <XCircle size={20} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("offers_rejected")}</p>
                <p className="text-xl font-bold text-slate-800">{rejectedCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="bg-white border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="text-primary" size={20} />
              {t("offers_history")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-10 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Loader2 className="animate-spin" size={36} />
                <p>{t("loading_offers")}</p>
              </div>
            ) : offers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div className="h-20 w-20 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                  <FileText size={36} className="text-slate-300" />
                </div>
                <h3 className="font-semibold text-lg text-slate-700 mb-2">{t("no_offers")}</h3>
                <p className="text-muted-foreground text-sm mb-6 max-w-sm">
                  {t("no_offers_desc")}
                </p>
                <Link href="/supplier/rfqs">
                  <Button size="sm">{t("browse_tenders")}</Button>
                </Link>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className={cn("hidden md:table-cell", locale === 'ar' ? 'text-right' : 'text-left')}>{t("offers_id")}</TableHead>
                    <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("offers_tender")}</TableHead>
                    <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("offers_price")}</TableHead>
                    <TableHead className={cn("hidden sm:table-cell", locale === 'ar' ? 'text-right' : 'text-left')}>{t("offers_date")}</TableHead>
                    <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("offers_status")}</TableHead>
                    <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("offers_actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offers.map((offer: any) => (
                    <TableRow key={offer.id} className={cn("hover:bg-slate-50/50", offer.status === "مطلوب تخفيض" && "bg-amber-50/60 hover:bg-amber-50")}>
                      <TableCell className={cn("font-mono text-xs hidden md:table-cell", locale === 'ar' ? 'text-right' : 'text-left')}>{offer.id.substring(0, 8)}</TableCell>
                      <TableCell className={cn("font-bold", locale === 'ar' ? 'text-right' : 'text-left')}>{offer.rfqTitle || t("offer_undefined")}</TableCell>
                      <TableCell className={cn("font-bold", locale === 'ar' ? 'text-right' : 'text-left')}>
                        <div className="flex items-center gap-1 justify-start">
                          <span className="text-primary font-bold">{offer.price ? `${offer.price}` : t("price_not_available")}</span>
                          {offer.price && <span className="text-xs text-muted-foreground">{t("sar")}</span>}
                        </div>
                      </TableCell>
                      <TableCell className={cn("text-xs text-muted-foreground hidden sm:table-cell", locale === 'ar' ? 'text-right' : 'text-left')} suppressHydrationWarning>
                        {offer.createdAt ? new Date(offer.createdAt).toLocaleDateString(locale) : "-"}
                      </TableCell>
                      <TableCell className={locale === 'ar' ? 'text-right' : 'text-left'}>
                        <div className="flex flex-col gap-1 items-start">
                          {getStatusBadge(offer.status || "قيد المراجعة")}
                          {offer.sampleStatus && (
                            <Badge variant="outline" className={`text-[10px] ${
                              offer.sampleStatus === "مطلوبة" ? "border-blue-200 bg-blue-50 text-blue-700" :
                              offer.sampleStatus === "تم الإرسال" ? "border-amber-200 bg-amber-50 text-amber-700" :
                              "border-success/30 bg-success/10 text-success"
                            }`}>
                              {t("sample_label")} {offer.sampleStatus}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={locale === 'ar' ? 'text-right' : 'text-left'}>
                        <div className="flex items-center gap-1 justify-start">
                          {/* View Details */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="hover:bg-slate-100 hover text-secondary transition-colors cursor-pointer"
                            title={t("view_details_tooltip")}
                            onClick={() => setViewOffer(offer)}
                          >
                            <Eye size={16} />
                          </Button>

                          {/* Open Chat + WhatsApp for accepted offers */}
                          {offer.status === "مقبول" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="hover:bg-primary/10 text-primary hover:text-primary transition-colors cursor-pointer"
                                title={t("chat_tooltip")}
                                onClick={() => openChat(offer)}
                                disabled={openingChat === offer.id}
                              >
                                {openingChat === offer.id
                                  ? <Loader2 size={16} className="animate-spin" />
                                  : <MessageSquare size={16} />}
                              </Button>
                              <ContractorWhatsAppButton contractorId={offer.contractorId} />
                              {deliveryByOfferId[offer.id] ? (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "h-8 px-2.5 gap-1 text-[11px] font-bold",
                                    deliveryByOfferId[offer.id].status === "confirmed"
                                      ? "border-success/30 bg-success/10 text-success"
                                      : "border-blue-200 bg-blue-50 text-blue-700"
                                  )}
                                >
                                  <Truck size={12} />
                                  {deliveryByOfferId[offer.id].status === "confirmed"
                                    ? t("delivery_status_confirmed")
                                    : t("delivery_status_pending")}
                                </Badge>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="hover:bg-blue-50 text-blue-600 hover:text-blue-700 transition-colors cursor-pointer"
                                  title={t("delivery_btn")}
                                  onClick={() => setDeliveryOffer(offer)}
                                >
                                  <Truck size={16} />
                                </Button>
                              )}
                            </>
                          )}

                          {/* Action for Price Reduction */}
                          {offer.status === "مطلوب تخفيض" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-3 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800 transition-colors cursor-pointer font-bold text-xs gap-1.5"
                              onClick={() => { setUpdatePriceOffer(offer); setNewPrice(offer.price || ""); }}
                            >
                              <ArrowDown size={13} />
                              {t("update_price_btn")}
                            </Button>
                          )}

                          {/* Archive for completed offers */}
                          {offer.status === "تم التسليم" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                              title={t("archive_tooltip")}
                              onClick={() => handleArchive(offer.id)}
                              disabled={archivingId === offer.id}
                            >
                              {archivingId === offer.id ? <Loader2 size={16} className="animate-spin" /> : <Archive size={16} />}
                            </Button>
                          )}

                          {/* Action for Sample Request */}
                          {offer.sampleStatus === "مطلوبة" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="hover:bg-blue-100 text-blue-600 hover:text-blue-700 transition-colors cursor-pointer"
                              title={t("confirm_sample_tooltip")}
                              onClick={() => setConfirmSampleOffer(offer)}
                              disabled={deletingId === offer.id}
                            >
                              {deletingId === offer.id ? <Loader2 size={16} className="animate-spin" /> : <Box size={16} />}
                            </Button>
                          )}

                          {/* More Actions */}
                          {offer.status === "قيد المراجعة" && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="hover:bg-slate-100 transition-colors cursor-pointer">
                                  {deletingId === offer.id
                                    ? <Loader2 size={16} className="animate-spin" />
                                    : <MoreVertical size={16} />}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className={locale === 'ar' ? 'text-right' : 'text-left'} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                                <DropdownMenuItem
                                  className="text-destructive cursor-pointer gap-2 focus:bg-destructive/10"
                                  onClick={() => handleWithdraw(offer.id)}
                                >
                                  <Trash2 size={14} />
                                  {t("withdraw_offer")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Archived Offers Section */}
      {archivedOffers.length > 0 && (
        <div className="max-w-5xl">
          <button
            onClick={() => setShowArchived(v => !v)}
            className={cn("flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3", locale === 'ar' ? 'flex-row-reverse' : '')}
          >
            {showArchived ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            <Archive size={14} />
            {t("archived_offers_title")} ({archivedOffers.length})
          </button>
          {showArchived && (
            <Card className="border-dashed border-slate-200 shadow-none">
              <CardContent className="p-0">
                <p className={cn("text-xs text-muted-foreground px-4 pt-3 pb-2", locale === 'ar' ? 'text-right' : 'text-left')}>
                  {t("archived_offers_desc")}
                </p>
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead className={cn("hidden md:table-cell", locale === 'ar' ? 'text-right' : 'text-left')}>{t("offers_id")}</TableHead>
                      <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("offers_tender")}</TableHead>
                      <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("offers_price")}</TableHead>
                      <TableHead className={cn("hidden sm:table-cell", locale === 'ar' ? 'text-right' : 'text-left')}>{t("archived_on")}</TableHead>
                      <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("auto_delete_on")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {archivedOffers.map((offer: any) => {
                      const archivedDate = offer.archivedAt ? new Date(offer.archivedAt) : null
                      const deleteDate = archivedDate ? new Date(archivedDate.getTime() + 30 * 24 * 60 * 60 * 1000) : null
                      const daysLeft = deleteDate ? Math.max(0, Math.ceil((deleteDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : null
                      return (
                        <TableRow key={offer.id} className="opacity-60">
                          <TableCell className={cn("font-mono text-xs hidden md:table-cell", locale === 'ar' ? 'text-right' : 'text-left')}>{offer.id.substring(0, 8)}</TableCell>
                          <TableCell className={cn("font-bold text-sm", locale === 'ar' ? 'text-right' : 'text-left')}>{offer.rfqTitle || t("offer_undefined")}</TableCell>
                          <TableCell className={cn("text-sm", locale === 'ar' ? 'text-right' : 'text-left')}>
                            {offer.price ? `${offer.price} ${t("sar")}` : "-"}
                          </TableCell>
                          <TableCell className={cn("text-xs text-muted-foreground hidden sm:table-cell", locale === 'ar' ? 'text-right' : 'text-left')} suppressHydrationWarning>
                            {archivedDate ? archivedDate.toLocaleDateString(locale) : "-"}
                          </TableCell>
                          <TableCell className={locale === 'ar' ? 'text-right' : 'text-left'} suppressHydrationWarning>
                            {daysLeft !== null ? (
                              <span className={`text-xs font-medium ${daysLeft <= 7 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                {t("days_left", { count: daysLeft })}
                              </span>
                            ) : "-"}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Offer Detail Dialog */}
      <Dialog open={!!viewOffer} onOpenChange={(open) => !open && setViewOffer(null)}>
        <DialogContent className={cn("sm:max-w-md", locale === 'ar' ? 'text-right' : 'text-left')} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader className={cn(locale === 'ar' ? 'text-right sm:text-right' : 'text-left sm:text-left')}>
            <DialogTitle>{t("offer_details_title")}</DialogTitle>
            <DialogDescription>{t("offer_details_desc")}</DialogDescription>
          </DialogHeader>
          {viewOffer && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <span className="text-muted-foreground text-sm">{t("offer_status_label")}</span>
                {getStatusBadge(viewOffer.status || "قيد المراجعة")}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-primary/5 rounded-lg space-y-1">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <DollarSign size={12} />
                    {t("offer_price_label")}
                  </div>
                  <p className="font-bold text-2xl text-primary">
                    {viewOffer.price} <span className="text-sm font-normal text-muted-foreground">{t("sar")}</span>
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg space-y-1">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar size={12} />
                    {t("offer_date_label")}
                  </div>
                  <p className="font-bold text-sm" suppressHydrationWarning>
                    {viewOffer.createdAt ? new Date(viewOffer.createdAt).toLocaleDateString(locale) : "-"}
                  </p>
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg space-y-1">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Tag size={12} />
                  {t("offer_tender")}
                </div>
                <p className="font-bold">{viewOffer.rfqTitle || t("offer_undefined")}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg space-y-1">
                <p className="text-xs text-muted-foreground">{t("offer_id_label")}</p>
                <p className="font-mono text-xs text-slate-500">{viewOffer.id}</p>
              </div>
              {viewOffer.offerPdfUrl && (
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-blue-600" />
                    <span className="text-sm font-bold text-slate-700">{t("attached_file_label")}</span>
                  </div>
                  <Button variant="outline" size="sm" asChild className="h-8 rounded-lg bg-white border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white transition-all text-xs">
                    <a href={viewOffer.offerPdfUrl} target="_blank" rel="noopener noreferrer">
                      {t("view_file")}
                    </a>
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOffer(null)}>{t("close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Update Price Dialog */}
      <Dialog open={!!updatePriceOffer} onOpenChange={(open) => !open && setUpdatePriceOffer(null)}>
        <DialogContent className={cn("sm:max-w-md", locale === 'ar' ? 'text-right' : 'text-left')} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader className={cn(locale === 'ar' ? 'text-right sm:text-right' : 'text-left sm:text-left')}>
            <DialogTitle>{t("update_price_title")}</DialogTitle>
            <DialogDescription>
              {t("update_price_desc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("previous_price")}</Label>
              <div className="p-3 bg-slate-50 text-slate-500 rounded-md font-bold">
                {updatePriceOffer?.price} {t("sar")}
              </div>
            </div>
            {updatePriceOffer?.targetPrice != null && (
              <div className="space-y-2">
                <Label>{t("contractor_suggested_price")}</Label>
                <div className="p-3 bg-amber-50 text-amber-700 rounded-md font-bold border border-amber-200">
                  {updatePriceOffer.targetPrice} {t("sar")}
                </div>
              </div>
            )}
            {updatePriceOffer?.reductionNote && (
              <div className="space-y-2">
                <Label>{t("contractor_reduction_note")}</Label>
                <div className="p-3 bg-slate-50 text-slate-700 rounded-md text-sm border border-slate-200 leading-relaxed">
                  {updatePriceOffer.reductionNote}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("new_price_label")}</Label>
              <Input 
                type="number" 
                value={newPrice} 
                onChange={(e) => setNewPrice(e.target.value)} 
                placeholder={t("new_price_placeholder")}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className={cn("flex flex-row gap-2 mt-4", locale === 'ar' ? "flex-row-reverse justify-start" : "justify-end")}>
            <Button variant="outline" onClick={() => setUpdatePriceOffer(null)} disabled={isUpdatingPrice}>{t("cancel")}</Button>
            <Button onClick={handleUpdatePrice} disabled={isUpdatingPrice || !newPrice || newPrice === updatePriceOffer?.price}>
              {isUpdatingPrice ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
              {t("confirm_new_price")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Sample Sending Alert */}
      <AlertDialog open={!!confirmSampleOffer} onOpenChange={(open) => !open && setConfirmSampleOffer(null)}>
        <AlertDialogContent className={locale === 'ar' ? 'text-right' : 'text-left'} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <AlertDialogHeader className={cn(locale === 'ar' ? 'text-right sm:text-right' : 'text-left sm:text-left')}>
            <AlertDialogTitle>{t("confirm_sample_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirm_sample_desc", { title: confirmSampleOffer?.rfqTitle || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-row gap-3 justify-end sm:justify-end mt-2">
            <AlertDialogCancel className="mt-0 sm:mt-0">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-white hover:bg-primary/90"
              onClick={(e) => {
                e.preventDefault();
                if (confirmSampleOffer) {
                  handleSampleAction(confirmSampleOffer.id, "تم الإرسال");
                }
              }}
            >
              {deletingId === confirmSampleOffer?.id ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
              {t("yes_sent")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delivery Notice Dialog */}
      <Dialog open={!!deliveryOffer} onOpenChange={(open) => { if (!open) { setDeliveryOffer(null); setDeliveryPersonName(""); setHandoverRecipientName(""); setDeliveryDate(""); setDeliveryNotes("") } }}>
        <DialogContent className={cn("sm:max-w-md", locale === 'ar' ? 'text-right' : 'text-left')} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader className={cn(locale === 'ar' ? 'text-right sm:text-right' : 'text-left sm:text-left')}>
            <DialogTitle className="flex items-center gap-2">
              <Truck size={18} className="text-blue-600" />
              {t("delivery_dialog_title")}
            </DialogTitle>
            <DialogDescription>{t("delivery_dialog_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t("delivery_person_label")} <span className="text-destructive">*</span></Label>
              <Input
                value={deliveryPersonName}
                onChange={(e) => setDeliveryPersonName(e.target.value)}
                placeholder={t("delivery_person_placeholder")}
                disabled={isSendingDelivery}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("delivery_handover_recipient_label")}</Label>
              <Input
                value={handoverRecipientName}
                onChange={(e) => setHandoverRecipientName(e.target.value)}
                placeholder={t("delivery_handover_recipient_placeholder")}
                disabled={isSendingDelivery}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("delivery_date_label")} <span className="text-destructive">*</span></Label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                dir="ltr"
                disabled={isSendingDelivery}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("delivery_notes_label")}</Label>
              <Textarea
                value={deliveryNotes}
                onChange={(e) => setDeliveryNotes(e.target.value)}
                placeholder={t("delivery_notes_placeholder")}
                rows={3}
                className="resize-none"
                disabled={isSendingDelivery}
              />
            </div>
          </div>
          <DialogFooter className={cn("flex flex-row gap-2 mt-2", locale === 'ar' ? "flex-row-reverse justify-start" : "justify-end")}>
            <Button variant="outline" onClick={() => setDeliveryOffer(null)} disabled={isSendingDelivery}>{t("cancel")}</Button>
            <Button
              onClick={handleSendDelivery}
              disabled={isSendingDelivery || !deliveryPersonName.trim() || !deliveryDate}
              className="bg-blue-600 hover:bg-blue-700 gap-2"
            >
              {isSendingDelivery ? <Loader2 className="animate-spin" size={16} /> : <Truck size={16} />}
              {t("delivery_send_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chat Redirect Dialog after sample sent - must be sibling, NOT nested */}
      <AlertDialog open={!!openingChat} onOpenChange={(open) => { if (!open) setOpeningChat(null) }}>
        <AlertDialogContent dir={locale === 'ar' ? 'rtl' : 'ltr'} className={locale === 'ar' ? 'text-right' : 'text-left'}>
          <AlertDialogHeader className={cn(locale === 'ar' ? 'text-right sm:text-right' : 'text-left sm:text-left')}>
            <AlertDialogTitle>{t("sample_sent_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sample_sent_desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2">
            <AlertDialogCancel onClick={() => setOpeningChat(null)}>{t("later")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const id = openingChat;
              setOpeningChat(null);
              router.push(`/supplier/chat/${id}`);
            }}>
              {t("open_chat")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  )
}

function ContractorWhatsAppButton({ contractorId }: { contractorId?: string }) {
  const t = useTranslations("Portal.Supplier")
  const firestore = useFirestore()
  const docRef = useMemoFirebase(() => {
    if (!firestore || !contractorId) return null
    return doc(firestore, "users", contractorId)
  }, [firestore, contractorId])
  const { data: contractor } = useDoc(docRef)

  const phone = contractor?.phone || contractor?.mobile || contractor?.whatsapp
  if (!phone) return null

  const cleaned = phone.replace(/\D/g, "")
  const waNumber = cleaned.startsWith("0") ? "966" + cleaned.slice(1) : cleaned

  return (
    <a
      href={`https://wa.me/${waNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      title={t("wa_tooltip")}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-[#25D366]/10 text-[#25D366] transition-colors"
    >
      <Phone size={16} />
    </a>
  )
}
