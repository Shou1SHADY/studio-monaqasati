"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "@/i18n/routing"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MapPicker } from "@/components/ui/map-picker"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Package,
  MapPin,
  Calendar,
  CalendarClock,
  Banknote,
  File,
  Upload,
  Loader2,
  Trash2,
  Plus,
  Globe,
  AlertCircle,
  ShieldCheck,
  Handshake,
  BookmarkPlus,
  FileStack,
  Layers,
  ListOrdered,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useActiveCompanyName, useCompanyNameFor } from "@/hooks/useActiveCompanyName"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useTranslations, useLocale } from 'next-intl'
import { useFirestore, useUser, useDoc, useMemoFirebase, useStorage, useCollection } from "@/firebase"
import { collection, addDoc, doc, setDoc, updateDoc, increment, serverTimestamp } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"
import { REQUIRE_COMPLETE_PROFILE } from "@/lib/app-env"
import { offerPricingFields, priceOffer, pricedProducts, pricingModeOf } from "@/lib/procurement/offer-pricing"
import { newOfferNotice, newOfferNoticeId } from "@/lib/procurement/offer-announce"

interface DeliveryBatch {
  id: string
  quantity?: string
  deliveryDate: string
  price: string
  location?: string
  coords?: { lat: number; lng: number } | null
}

// RFQ's own required quantity — always summed from its line items (products[].quantity),
// falling back to the pre-aggregated `quantity` field only for RFQs published before the
// per-item products array existed. Never derive this from anything else (e.g. offer price).
function getRfqRequiredQuantity(rfq: any | null): number {
  if (!rfq) return 0
  if (Array.isArray(rfq.products) && rfq.products.length > 0) {
    return rfq.products.reduce((sum: number, p: any) => sum + (Number(p.quantity) || 0), 0)
  }
  return Number(rfq.quantity) || 0
}

function getRfqUnitLabel(rfq: any | null): string {
  if (!rfq) return ""
  if (Array.isArray(rfq.products) && rfq.products.length > 0) {
    return rfq.products[0].unitOfMeasure || ""
  }
  return rfq.unitOfMeasure || ""
}

interface SubmitOfferDialogProps {
  selectedRfq: any | null
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function SubmitOfferDialog({ selectedRfq, isOpen, onClose, onSuccess }: SubmitOfferDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const { user, isUserLoading } = useUser()
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const storage = useStorage()

  const { profile } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const activeCompanyName = useActiveCompanyName(profile, user?.uid)

  const [offerPrice, setOfferPrice] = useState("")
  // When the RFQ asked to be quoted per material (PRD SS4), these rates ARE the
  // offer and the total is derived from them — the same way a multi-shipment
  // offer's total is derived from its batches. Keyed by the product's index in
  // the RFQ, which is its identity (`rfqProductIndex`).
  const [lineRates, setLineRates] = useState<Record<number, string>>({})
  const [deliveryBatches, setDeliveryBatches] = useState<DeliveryBatch[]>([
    { id: "1", deliveryDate: new Date().toISOString().split('T')[0], price: "", location: "" }
  ])
  const [mapBatchId, setMapBatchId] = useState<string | null>(null)
  const isMultiShipment = selectedRfq?.shipmentMode === "multiple"
  const byLine = pricingModeOf(selectedRfq) === "line"
  const lineProducts = byLine ? pricedProducts(selectedRfq) : []
  const linePricing = priceOffer(lineProducts, lineRates)
  const requiredQuantity = getRfqRequiredQuantity(selectedRfq)
  const unitLabel = getRfqUnitLabel(selectedRfq)
  const allocatedQuantity = deliveryBatches.reduce((sum, b) => sum + (parseFloat(b.quantity || "0") || 0), 0)
  const remainingQuantity = requiredQuantity - allocatedQuantity
  const [tempLocation, setTempLocation] = useState<{lat: number, lng: number} | null>(null)
  const [executionDuration, setExecutionDuration] = useState("")
  const [executionDurationUnit, setExecutionDurationUnit] = useState("أيام")
  const [offerPdfFile, setOfferPdfFile] = useState<File | null>(null)
  const [offerPdfUrl, setOfferPdfUrl] = useState<string | null>(null)
  const [isUploadingPdf, setIsUploadingPdf] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [supplierWebsite, setSupplierWebsite] = useState(profile?.website || "")
  const offerPdfInputRef = useRef<HTMLInputElement>(null)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState("")
  const [showSaveTemplateInput, setShowSaveTemplateInput] = useState(false)

  const templatesQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null
    return collection(firestore, "users", user.uid, "quotationTemplates")
  }, [firestore, user])
  const { data: quotationTemplates } = useCollection(templatesQuery)

  const resetForm = () => {
    setOfferPrice("")
    setDeliveryBatches(
      selectedRfq?.shipmentMode === "multiple"
        ? [
            { id: "1", deliveryDate: "", price: "", location: "", quantity: "" },
            { id: "2", deliveryDate: "", price: "", location: "", quantity: "" },
          ]
        : [{ id: "1", deliveryDate: "", price: "", location: "" }]
    )
    setMapBatchId(null)
    setTempLocation(null)
    setExecutionDuration("")
    setExecutionDurationUnit("أيام")
    setOfferPdfFile(null)
    setOfferPdfUrl(null)
    setOfferPdfStoragePath(null)
    setShowSaveTemplateInput(false)
    setNewTemplateName("")
    setSupplierWebsite(profile?.website || "")
    setIsSubmitting(false)
    if (offerPdfInputRef.current) offerPdfInputRef.current.value = ""
  }

  useEffect(() => {
    if (selectedRfq) {
      resetForm()
    }
  }, [selectedRfq])

  useEffect(() => {
    if (profile?.website) {
      setSupplierWebsite((prev: string) => prev || profile.website)
    }
  }, [profile?.website])

  // Multi-shipment mode: the total offer price is never entered directly — it's always
  // the sum of what each shipment batch costs, so it can't drift from the batch breakdown.
  useEffect(() => {
    if (isMultiShipment) {
      setOfferPrice(String(deliveryBatches.reduce((sum, b) => sum + (parseFloat(b.price) || 0), 0)))
    }
  }, [isMultiShipment, deliveryBatches])

  useEffect(() => {
    if (byLine) setOfferPrice(linePricing.total > 0 ? String(linePricing.total) : "")
  }, [byLine, linePricing.total])

  const addShipmentBatch = () => {
    setDeliveryBatches((prev) => [
      ...prev,
      { id: String(Date.now()), deliveryDate: "", price: "", location: "", quantity: "" },
    ])
  }

  const removeShipmentBatch = (id: string) => {
    setDeliveryBatches((prev) => (prev.length <= 1 ? prev : prev.filter((b) => b.id !== id)))
  }

  const updateShipmentBatch = (id: string, field: keyof DeliveryBatch, value: string) => {
    setDeliveryBatches((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)))
  }

  const [offerPdfStoragePath, setOfferPdfStoragePath] = useState<string | null>(null)

  const handleOfferPdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== "application/pdf") {
      toast({ title: t("offer_error"), description: t("offer_pdf_only"), variant: "destructive" })
      return
    }
    setIsUploadingPdf(true)
    try {
      if (!storage) throw new Error("Storage not initialized")
      const storagePath = `offers/pdfs/${Date.now()}-${file.name}`
      const fileRef = ref(storage, storagePath)
      await uploadBytes(fileRef, file)
      const downloadUrl = await getDownloadURL(fileRef)
      setOfferPdfUrl(downloadUrl)
      setOfferPdfFile(file)
      setOfferPdfStoragePath(storagePath)
      toast({ title: t("offer_pdf_uploaded"), description: t("offer_pdf_uploaded") })
    } catch (error) {
      console.error("PDF upload failed:", error)
      toast({ title: t("offer_error"), description: t("offer_upload_failed"), variant: "destructive" })
    } finally {
      setIsUploadingPdf(false)
    }
  }

  const removeOfferPdf = async () => {
    if (offerPdfStoragePath && storage) {
      try {
        const fileRef = ref(storage, offerPdfStoragePath)
        await deleteObject(fileRef)
      } catch (error) {
        console.warn("Could not delete from storage:", error)
      }
    }
    setOfferPdfFile(null)
    setOfferPdfUrl(null)
    setOfferPdfStoragePath(null)
    if (offerPdfInputRef.current) offerPdfInputRef.current.value = ""
  }

  const handleSelectTemplate = (templateId: string) => {
    const template = (quotationTemplates || []).find((tpl: any) => tpl.id === templateId)
    if (!template) return
    // Template-sourced attachments get no storagePath: removeOfferPdf() only deletes
    // from Storage when a path is set, so picking a template never deletes the
    // shared template file — only a fresh per-offer upload can be deleted this way.
    setOfferPdfUrl(template.fileUrl)
    setOfferPdfStoragePath(null)
    setOfferPdfFile(null)
  }

  const handleSaveAsTemplate = async () => {
    if (!firestore || !user || !offerPdfUrl || !newTemplateName.trim()) return
    setIsSavingTemplate(true)
    try {
      await addDoc(collection(firestore, "users", user.uid, "quotationTemplates"), {
        name: newTemplateName.trim(),
        fileUrl: offerPdfUrl,
        createdAt: serverTimestamp(),
      })
      toast({ title: t("offer_template_saved") })
      setNewTemplateName("")
      setShowSaveTemplateInput(false)
    } catch (err) {
      console.error("Failed to save template:", err)
      toast({ title: t("offer_error"), variant: "destructive" })
    } finally {
      setIsSavingTemplate(false)
    }
  }

  const submitOffer = async () => {
    if (!user || !firestore) {
      toast({ title: t("offer_error"), description: t("offer_login_required"), variant: "destructive" });
      return;
    }

    if (!selectedRfq) {
      toast({ title: t("offer_incomplete_data"), description: t("offer_select_rfq"), variant: "destructive" });
      return;
    }

    if (!offerPrice || parseFloat(offerPrice) <= 0) {
      toast({ title: t("offer_incomplete_data"), description: t("offer_enter_price"), variant: "destructive" });
      return;
    }

    if (byLine && !linePricing.complete) {
      // Half a breakdown is not one: `buildPoLines` keeps no unit price unless
      // every line has one, so a partial quote would silently go out lump-sum.
      toast({ title: t("offer_incomplete_data"), description: t("offer_line_prices_incomplete"), variant: "destructive" });
      return;
    }

    if (isMultiShipment) {
      const incomplete = deliveryBatches.some((b) => !b.location || !b.deliveryDate || !b.price || !(parseFloat(b.quantity || "0") > 0))
      if (incomplete) {
        toast({ title: t("offer_incomplete_data"), description: t("offer_validation_complete_batches"), variant: "destructive" });
        return;
      }
      if (Math.abs(remainingQuantity) > 0.01) {
        toast({ title: t("offer_incomplete_data"), description: t("offer_shipment_qty_mismatch", { qty: requiredQuantity, unit: unitLabel }), variant: "destructive" });
        return;
      }
    }

    setIsSubmitting(true)
    try {
      const offerData: any = {
        supplierId: user.uid,
        organizationId: profile?.organizationId || user.uid,
        supplierName: activeCompanyName || "مورد",
        companyName: activeCompanyName || "",
        supplierWebsite: supplierWebsite || profile?.website || null,
        submittedByUserId: user.uid,
        submittedByUserName: profile?.name || user.email || "عضو الفريق",
        rfqId: selectedRfq.id,
        rfqTitle: selectedRfq.title,
        projectId: selectedRfq.projectId || null,
        contractorId: selectedRfq.contractorId || null,
        contractorOrgId: selectedRfq.organizationId || selectedRfq.contractorId || null,
        price: offerPrice,
        deliveryLocation: deliveryBatches[0].location,
        deliveryBatches: deliveryBatches.map((b) => ({
          location: b.location,
          deliveryDate: b.deliveryDate,
          price: isMultiShipment ? b.price : offerPrice,
          quantity: isMultiShipment ? b.quantity : String(requiredQuantity || ""),
        })),
        status: "قيد المراجعة",
        createdAt: new Date().toISOString()
      };

      if (isMultiShipment) {
        offerData.totalBatchesPrice = deliveryBatches.reduce((sum, b) => sum + (parseFloat(b.price) || 0), 0)
      }

      // The rates travel with the offer; `price` stays the one field every
      // existing reader has always used, so nothing downstream needs to know.
      if (byLine) {
        const fields = offerPricingFields(linePricing)
        offerData.lines = fields.lines
        offerData.price = fields.price
      }

      if (executionDuration) {
        offerData.executionDuration = executionDuration;
        offerData.executionDurationUnit = executionDurationUnit;
      }
      if (offerPdfUrl) {
        offerData.offerPdfUrl = offerPdfUrl;
      }

      const offerRef = await addDoc(collection(firestore, "offers"), offerData);

      // Tell the contractor. The SERVER writes the notification and the text:
      // only it can read the contractor's policy, and a sealed round must name
      // no amount (the client used to write "عرضاً بمبلغ …" into the bell of a
      // buyer the seal was meant to keep from seeing it). One per offer.
      try {
        if (selectedRfq.contractorId) {
          let told = false
          try {
            const idToken = await user?.getIdToken().catch(() => null)
            if (idToken) {
              const res = await fetch("/api/sms", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ kind: "new_offer", offerId: offerRef.id }),
              })
              told = res.ok
              if (!res.ok) console.error("Offer notice API returned error:", res.status)
            }
          } catch (noticeError) {
            console.error("Failed to call the offer notice API:", noticeError)
          }
          // The server could not be reached: still tell the contractor, with no
          // amount and no claim about a seal. Same id, so a later server run
          // overwrites this rather than adding a second.
          if (!told) {
            const notice = newOfferNotice({ supplier: activeCompanyName || "", rfqTitle: selectedRfq.title || "", price: null, sealed: false })
            await setDoc(doc(firestore, "users", selectedRfq.contractorId, "notifications", newOfferNoticeId(offerRef.id)), {
              userId: selectedRfq.contractorId,
              organizationId: selectedRfq.organizationId || selectedRfq.contractorId,
              type: "new_offer",
              i18n: notice.i18n,
              title: notice.title,
              message: notice.message,
              offerId: offerRef.id,
              rfqId: selectedRfq.id,
              createdAt: new Date().toISOString(),
              read: false,
            })
          }
        }
      } catch (err) {
        console.error("Failed to send offer notification:", err);
      }
      try {
        const rfqRef = doc(firestore, "rfqs", selectedRfq.id);
        await updateDoc(rfqRef, { offersCount: increment(1) });
      } catch (err) {
        console.error("Failed to update offersCount:", err);
      }

      toast({
        title: t("offer_submitted_title"),
        description: t("offer_submitted_desc", { price: Number(offerPrice).toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US') }),
      })
      onClose()
      if (onSuccess) onSuccess()
    } catch (error) {
      console.error(error);
      toast({ title: t("offer_error"), description: t("offer_submit_failed"), variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent
          className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-lg text-right rounded-2xl p-0 overflow-hidden max-h-[92dvh] flex flex-col gap-0 [&>button:last-child]:left-4 [&>button:last-child]:right-auto"
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{t("offer_submit_title")}</DialogTitle>

          {REQUIRE_COMPLETE_PROFILE && profile && !profile.profileCompleted ? (
            <div className="p-8 text-center space-y-6">
              <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto border border-amber-200">
                <AlertCircle size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-800">{t("offer_profile_incomplete_title")}</h2>
              <p className="text-slate-600 text-sm leading-relaxed">
                {t("offer_profile_incomplete_desc")}
              </p>
              <div className="pt-4 flex flex-col gap-2">
                <Button
                  onClick={() => {
                    onClose();
                    router.push("/supplier/profile");
                  }}
                  className="w-full h-12 bg-primary hover:bg-secondary text-white font-bold rounded-xl transition-all shadow-lg"
                >
                  {t("offer_complete_profile")}
                </Button>
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="w-full h-11 rounded-xl"
                >
                  {t("offer_close")}
                </Button>
              </div>
            </div>
          ) : profile && !profile.isVerified ? (
            <div className="p-8 text-center space-y-6">
              <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto border border-amber-200">
                <AlertCircle size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-800">{t("offer_verification_required_title")}</h2>
              <p className="text-slate-600 text-sm leading-relaxed">
                {t("offer_verification_required_desc")}
              </p>
              <div className="pt-4 flex flex-col gap-2">
                <Button
                  onClick={() => {
                    onClose();
                    router.push("/supplier/profile");
                  }}
                  className="w-full h-12 bg-primary hover:bg-secondary text-white font-bold rounded-xl transition-all shadow-lg"
                >
                  {t("offer_go_to_profile")}
                </Button>
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="w-full h-11 rounded-xl"
                >
                  {t("offer_close")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="px-5 pl-12 pt-5 pb-4 border-b bg-gradient-to-bl from-primary/5 to-white shrink-0">
            <h2 className="text-lg font-bold text-slate-800">{t("offer_submit_title")}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {selectedRfq?.title}
            </p>
            {selectedRfq?.requiresWarranty && (
              <Badge className="mt-2 bg-amber-100 text-amber-700 border-amber-200 gap-1.5 font-semibold">
                <ShieldCheck size={12} />
                {t("offer_warranty_required_badge")}
              </Badge>
            )}
            {selectedRfq?.isFromMdmak ? (
              <div className="mt-2 p-4 bg-accent/5 border border-accent/20 rounded-lg flex items-center gap-3 shadow-inner">
                <div className="h-9 w-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                  <Handshake size={16} className="text-accent" />
                </div>
                <div>
                  <p className="text-sm font-bold text-accent">{t("offer_mdmak_rfq_badge")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t("offer_mdmak_rfq_desc")}</p>
                </div>
              </div>
            ) : (
              selectedRfq?.contractorId && <ContractorInfo contractorId={selectedRfq.contractorId} />
            )}
            {selectedRfq?.pdfUrl && (
              <div className="mt-3 flex items-center justify-between p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <div className="flex items-center gap-2">
                  <File size={16} className="text-blue-600" />
                  <span className="text-sm font-semibold text-blue-800">{t("offer_rfq_attachments")}</span>
                </div>
                <Button variant="outline" size="sm" asChild className="h-8 rounded-lg bg-white border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white transition-all text-xs">
                  <a href={selectedRfq.pdfUrl} target="_blank" rel="noopener noreferrer">
                    {t("offer_view_attachment")}
                  </a>
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-y-auto flex-1 px-5 py-5 space-y-5">
            {/* HERO STATS: Execution Period & Total Price as the first two items */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/5 via-primary/3 to-transparent">
              {/* Execution Period */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  <CalendarClock size={12} className="text-primary" />
                  <span>{t("offer_execution_duration")}</span>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder={t("offer_duration_placeholder")}
                    value={executionDuration}
                    onChange={(e) => setExecutionDuration(e.target.value)}
                    className="h-12 text-lg font-black rounded-xl border-2 border-input focus:border-primary transition-colors bg-white"
                  />
                  <Select value={executionDurationUnit} onValueChange={setExecutionDurationUnit}>
                    <SelectTrigger className="w-28 h-12 text-sm font-bold rounded-xl border-2 border-input bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="أيام">{t("offer_days")}</SelectItem>
                      <SelectItem value="أسابيع">{t("offer_weeks")}</SelectItem>
                      <SelectItem value="أشهر">{t("offer_months")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* Total Price */}
              <div className="flex flex-col gap-2 sm:border-s sm:border-slate-200/70 sm:ps-4">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  <Banknote size={12} className="text-primary" />
                  <span>{t("offer_total_price")}</span>
                  <span className="text-red-500 normal-case">*</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={offerPrice}
                    onChange={(e) => setOfferPrice(e.target.value)}
                    readOnly={isMultiShipment || byLine}
                    className="w-full h-12 px-4 ps-4 pe-12 rounded-xl border-2 border-input bg-white text-xl font-black text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary read-only:bg-slate-50 read-only:text-slate-500"
                    placeholder="0"
                    min="0"
                  />
                  <span className="absolute end-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">{t("offer_sar")}</span>
                </div>
                {isMultiShipment && (
                  <p className="text-[11px] text-muted-foreground">{t("offer_shipment_price_auto_note")}</p>
                )}
                {byLine && (
                  <p className="text-[11px] text-muted-foreground">{t("offer_line_price_auto_note")}</p>
                )}
              </div>
            </div>

            {byLine && (
              /* Quoted per material (PRD SS4): a rate each, and the total above is
                 their sum. This is what gives the order a real unit price — and so
                 a price history, a drift report and a comparison next time. */
              <div className="space-y-3">
                <Label className="text-sm font-semibold flex items-center gap-1.5">
                  <ListOrdered size={14} className="text-primary" />
                  {t("offer_line_prices_title")}
                </Label>
                <div className="rounded-xl border divide-y overflow-hidden">
                  {lineProducts.map((prod) => {
                    const rate = lineRates[prod.rfqProductIndex] ?? ""
                    const subtotal = (Number(rate) || 0) * prod.quantity
                    return (
                      <div key={prod.rfqProductIndex} className="flex flex-wrap items-center gap-2 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold" dir="auto">{prod.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {t("offer_line_qty", { qty: prod.quantity, unit: prod.unit })}
                          </p>
                        </div>
                        <div className="relative w-32">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            dir="ltr"
                            aria-label={t("offer_line_rate_for", { name: prod.name })}
                            value={rate}
                            onChange={(e) => setLineRates({ ...lineRates, [prod.rfqProductIndex]: e.target.value })}
                            className="w-full h-10 ps-3 pe-10 rounded-lg border-2 border-input bg-white text-sm font-bold text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                            placeholder="0"
                          />
                          <span className="absolute end-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">{t("offer_sar")}</span>
                        </div>
                        <span className="w-24 text-end text-xs font-bold tabular-nums text-muted-foreground" dir="ltr">
                          {subtotal > 0 ? Math.round(subtotal * 100) / 100 : "\u2014"}
                        </span>
                      </div>
                    )
                  })}
                </div>
                {!linePricing.complete && (
                  <p className="text-[11px] text-amber-700 flex items-center gap-1.5 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200 w-fit">
                    <AlertCircle size={11} className="shrink-0" />
                    {t("offer_line_prices_incomplete")}
                  </p>
                )}
              </div>
            )}

            {isMultiShipment ? (
              /* Multiple shipments — each batch splits the RFQ's own required quantity, never a whole-order total */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold flex items-center gap-1.5">
                    <Layers size={14} className="text-primary" />
                    {t("offer_shipments_title")}
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    {t("offer_shipment_required_qty", { qty: requiredQuantity, unit: unitLabel })}
                  </span>
                </div>

                <div className="space-y-3">
                  {deliveryBatches.map((batch, idx) => (
                    <div key={batch.id} className="p-3 rounded-xl border-2 border-input bg-slate-50/50 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-bold">
                          {t("offer_shipment_batch_no", { number: idx + 1 })}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:bg-red-50 rounded-lg"
                          onClick={() => removeShipmentBatch(batch.id)}
                          disabled={deliveryBatches.length <= 1}
                          aria-label={t("offer_shipment_remove")}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">{t("offer_shipment_qty")}</Label>
                          <Input
                            type="number"
                            min="0"
                            value={batch.quantity || ""}
                            onChange={(e) => updateShipmentBatch(batch.id, "quantity", e.target.value)}
                            placeholder={unitLabel}
                            className="h-9 rounded-lg text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">{t("offer_shipment_price")}</Label>
                          <Input
                            type="number"
                            min="0"
                            value={batch.price}
                            onChange={(e) => updateShipmentBatch(batch.id, "price", e.target.value)}
                            placeholder="0"
                            className="h-9 rounded-lg text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">{t("offer_shipment_date")}</Label>
                          <Input
                            type="date"
                            value={batch.deliveryDate}
                            onChange={(e) => updateShipmentBatch(batch.id, "deliveryDate", e.target.value)}
                            className="h-9 rounded-lg text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">{t("offer_shipment_location")}</Label>
                          <div className="flex gap-1">
                            <Input
                              value={batch.location || ""}
                              onChange={(e) => updateShipmentBatch(batch.id, "location", e.target.value)}
                              placeholder={t("offer_city_district")}
                              className="h-9 rounded-lg text-sm"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="shrink-0 h-9 w-9 rounded-lg border-2 hover:bg-primary/5"
                              onClick={() => setMapBatchId(batch.id)}
                            >
                              <MapPin size={14} className="text-primary" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <Button type="button" variant="outline" size="sm" onClick={addShipmentBatch} className="w-full gap-1.5 h-9 rounded-xl">
                  <Plus size={14} />
                  {t("offer_shipment_add_btn")}
                </Button>

                <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold ${
                  Math.abs(remainingQuantity) < 0.01
                    ? "bg-success/10 text-success"
                    : remainingQuantity < 0
                      ? "bg-destructive/10 text-destructive"
                      : "bg-amber-50 text-amber-700"
                }`}>
                  <span>{t("offer_shipment_remaining_qty")}</span>
                  <span dir="ltr">{remainingQuantity} {unitLabel}</span>
                </div>
              </div>
            ) : (
              /* Delivery Location */
              <div className="space-y-1.5 flex-1">
                <Label className="text-sm font-semibold">{t("offer_delivery_location")}</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder={t("offer_city_district")}
                    value={deliveryBatches[0].location}
                    onChange={(e) => setDeliveryBatches(prev => prev.map(b => b.id === "1" ? { ...b, location: e.target.value } : b))}
                    className="h-11 rounded-xl border-2 border-input focus:ring-2 focus:ring-primary/30"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0 h-11 w-11 rounded-xl border-2 hover:bg-primary/5"
                    onClick={() => setMapBatchId("1")}
                  >
                    <MapPin size={18} className="text-primary" />
                  </Button>
                </div>
              </div>
            )}

            {/* PDF Upload */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">{t("offer_upload_pdf")}</Label>
              {offerPdfUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-4 p-4 bg-blue-50/50 border border-blue-200/50 rounded-xl">
                    <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                      <File size={20} className="text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <span className="text-sm font-semibold text-blue-800">{t("offer_pdf_attached")}</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={removeOfferPdf} className="text-red-500 rounded-lg"><Trash2 size={16} /></Button>
                  </div>
                  {/* Only freshly-uploaded PDFs (not ones picked from an existing template) can be saved as a new template */}
                  {offerPdfStoragePath && (
                    showSaveTemplateInput ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={newTemplateName}
                          onChange={(e) => setNewTemplateName(e.target.value)}
                          placeholder={t("offer_template_name_placeholder")}
                          className="h-9 rounded-lg text-sm"
                        />
                        <Button size="sm" onClick={handleSaveAsTemplate} disabled={isSavingTemplate || !newTemplateName.trim()} className="h-9 gap-1.5 shrink-0">
                          {isSavingTemplate ? <Loader2 size={14} className="animate-spin" /> : <BookmarkPlus size={14} />}
                          {t("offer_template_save_btn")}
                        </Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setShowSaveTemplateInput(true)} className="gap-1.5 h-8 text-xs text-primary">
                        <BookmarkPlus size={13} />
                        {t("offer_template_save_prompt")}
                      </Button>
                    )
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      ref={offerPdfInputRef}
                      type="file"
                      accept=".pdf"
                      onChange={handleOfferPdfUpload}
                      disabled={isUploadingPdf}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="flex items-center justify-center gap-3 h-24 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 text-slate-500 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group">
                      {isUploadingPdf ? <Loader2 size={24} className="animate-spin text-primary" /> : (
                        <>
                          <div className="h-10 w-10 rounded-lg bg-slate-100 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                            <Upload size={18} className="text-slate-400 group-hover:text-primary transition-colors" />
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-semibold text-slate-700 block">{t("offer_click_to_upload_pdf")}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  {quotationTemplates && quotationTemplates.length > 0 && (
                    <div className="flex items-center gap-2">
                      <FileStack size={14} className="text-muted-foreground shrink-0" />
                      <Select onValueChange={handleSelectTemplate}>
                        <SelectTrigger className="h-9 rounded-lg text-sm">
                          <SelectValue placeholder={t("offer_template_pick_placeholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {quotationTemplates.map((tpl: any) => (
                            <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Website */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-700">{t("offer_website_label")}</Label>
              <div className="relative">
                <Globe className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder={t("offer_website_placeholder")}
                  value={supplierWebsite}
                  onChange={(e) => setSupplierWebsite(e.target.value)}
                  className="h-11 pl-4 pr-10 rounded-xl border-2 border-input focus:border-primary transition-colors text-left"
                  dir="ltr"
                />
              </div>
              <p className="text-xs text-slate-500">{t("offer_website_help")}</p>
            </div>
          </div>

          <div className="px-5 py-4 border-t bg-white shrink-0 flex flex-col sm:flex-row gap-3">
            <Button variant="outline" className="flex-1 order-2 sm:order-1" onClick={onClose}>
              {t("offer_cancel")}
            </Button>
            <Button
              onClick={submitOffer}
              disabled={!offerPrice || isSubmitting || isUploadingPdf}
              className="flex-[2] order-1 sm:order-2"
            >
              {isSubmitting ? <Loader2 size={18} className="ml-2 animate-spin" /> : null}
              {t("offer_confirm_submit")}
            </Button>
          </div>
        </>
      )}
    </DialogContent>
  </Dialog>

      <Dialog open={!!mapBatchId} onOpenChange={(open) => { 
        if (!open) {
          setMapBatchId(null);
          setTempLocation(null);
        }
      }}>
        <DialogContent className="sm:max-w-[600px]" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t("offer_select_location_title")}</DialogTitle>
            <DialogDescription>{t("offer_select_location_desc")}</DialogDescription>
          </DialogHeader>
          {mapBatchId && (
            <MapPicker
              key={mapBatchId}
              initialPosition={tempLocation}
              onLocationSelect={(loc) => {
                setTempLocation(loc)
              }}
              className="h-72 w-full rounded-xl overflow-hidden border"
            />
          )}
          <DialogFooter className="flex gap-2 sm:justify-start">
            <Button variant="outline" onClick={() => { setMapBatchId(null); setTempLocation(null); }}>{t("offer_cancel")}</Button>
            <Button 
              disabled={!tempLocation} 
              onClick={async () => {
                if (!tempLocation || !mapBatchId) return;
                try {
                  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${tempLocation.lat}&lon=${tempLocation.lng}&format=json`)
                  const data = await res.json()
                  const address = data.display_name || `${tempLocation.lat.toFixed(4)}, ${tempLocation.lng.toFixed(4)}`
                  setDeliveryBatches(prev => prev.map(b => b.id === mapBatchId ? { ...b, location: address, coords: tempLocation } : b))
                  setMapBatchId(null)
                  setTempLocation(null)
                } catch {
                  setDeliveryBatches(prev => prev.map(b => b.id === mapBatchId ? { ...b, location: `${tempLocation.lat.toFixed(4)}, ${tempLocation.lng.toFixed(4)}`, coords: tempLocation } : b))
                  setMapBatchId(null)
                  setTempLocation(null)
                }
              }}
            >
              {t("offer_confirm_location")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ContractorInfo({ contractorId }: { contractorId: string }) {
  const firestore = useFirestore()
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const docRef = useMemoFirebase(() => {
    if (!firestore || !contractorId) return null
    return doc(firestore, "users", contractorId)
  }, [firestore, contractorId])
  
  const { data: contractor } = useDoc(docRef)
  const resolvedContractorName = useCompanyNameFor(contractor ? { id: contractorId, ...contractor } : null)

  if (!contractor) return null

  return (
    <div className="mt-2 p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col gap-3 shadow-inner">
      <div className="flex justify-between items-center">
        <span className="text-sm font-bold text-slate-500">{t("offer_rfq_owner_label")}</span>
        <span className="text-md font-bold text-slate-800">{resolvedContractorName || t("offer_contractor_label")}</span>
      </div>
      
      {contractor.profileCompleted && (
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="bg-success/10 text-success border-success/30 px-3 py-1">
            {t("offer_cr_verified")}
          </Badge>
        </div>
      )}
    </div>
  )
}
