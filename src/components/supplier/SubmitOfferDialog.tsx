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
  AlertCircle
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useTranslations, useLocale } from 'next-intl'
import { useFirestore, useUser, useDoc, useMemoFirebase, useStorage } from "@/firebase"
import { collection, addDoc, doc, getDoc, updateDoc, increment } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"

interface DeliveryBatch {
  id: string
  quantity?: string
  deliveryDate: string
  price: string
  location?: string
  coords?: { lat: number; lng: number } | null
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

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  
  const { data: profile } = useDoc(userDocRef)

  const [offerPrice, setOfferPrice] = useState("")
  const [deliveryBatches, setDeliveryBatches] = useState<DeliveryBatch[]>([
    { id: "1", deliveryDate: new Date().toISOString().split('T')[0], price: "", location: "" }
  ])
  const [mapBatchId, setMapBatchId] = useState<string | null>(null)
  const [tempLocation, setTempLocation] = useState<{lat: number, lng: number} | null>(null)
  const [executionDuration, setExecutionDuration] = useState("")
  const [executionDurationUnit, setExecutionDurationUnit] = useState("أيام")
  const [offerPdfFile, setOfferPdfFile] = useState<File | null>(null)
  const [offerPdfUrl, setOfferPdfUrl] = useState<string | null>(null)
  const [isUploadingPdf, setIsUploadingPdf] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [supplierWebsite, setSupplierWebsite] = useState(profile?.website || "")
  const offerPdfInputRef = useRef<HTMLInputElement>(null)

  const resetForm = () => {
    setOfferPrice("")
    setDeliveryBatches([{ id: "1", deliveryDate: "", price: "", location: "" }])
    setMapBatchId(null)
    setTempLocation(null)
    setExecutionDuration("")
    setExecutionDurationUnit("أيام")
    setOfferPdfFile(null)
    setOfferPdfUrl(null)
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

    setIsSubmitting(true)
    try {
      const offerData: any = {
        supplierId: user.uid,
        organizationId: profile?.organizationId || user.uid,
        supplierName: profile?.name || profile?.companyName || "مورد",
        companyName: profile?.companyName || "",
        supplierWebsite: supplierWebsite || profile?.website || null,
        submittedByUserId: user.uid,
        submittedByUserName: profile?.name || user.email || "عضو الفريق",
        rfqId: selectedRfq.id,
        rfqTitle: selectedRfq.title,
        contractorId: selectedRfq.contractorId || null,
        contractorOrgId: selectedRfq.organizationId || selectedRfq.contractorId || null,
        price: offerPrice,
        deliveryLocation: deliveryBatches[0].location,
        deliveryBatches: deliveryBatches.map((b, i) => ({
          location: b.location,
          deliveryDate: b.deliveryDate,
          price: i === 0 ? offerPrice : b.price,
        })),
        status: "قيد المراجعة",
        createdAt: new Date().toISOString()
      };

      if (executionDuration) {
        offerData.executionDuration = executionDuration;
        offerData.executionDurationUnit = executionDurationUnit;
      }
      if (offerPdfUrl) {
        offerData.offerPdfUrl = offerPdfUrl;
      }

      await addDoc(collection(firestore, "offers"), offerData);

      // Notify contractor of new offer
      try {
        if (selectedRfq.contractorId) {
          // 1. In-app notification
          await addDoc(collection(firestore, "users", selectedRfq.contractorId, "notifications"), {
            userId: selectedRfq.contractorId,
            organizationId: selectedRfq.organizationId || selectedRfq.contractorId,
            type: "new_offer",
            title: "عرض سعر جديد",
            message: `قدم المورد ${profile?.companyName || profile?.name || 'مورد'} عرضاً بمبلغ ${Number(offerPrice).toLocaleString('ar-SA')} ر.س على طلب عروض الأسعار: ${selectedRfq.title}`,
            offerId: null,
            rfqId: selectedRfq.id,
            createdAt: new Date().toISOString(),
            read: false
          });

          // 2. Queue SMS/WhatsApp via Twilio Extension
          const contractorDoc = await getDoc(doc(firestore, "users", selectedRfq.contractorId));
          const contractorData = contractorDoc.data();
          if (contractorData) {
            const phone = contractorData.phone || contractorData.whatsapp || contractorData.mobile;
            if (phone) {
              // Ensure phone starts with + for Twilio
              let formattedPhone = phone.replace(/\D/g, "");
              if (formattedPhone.startsWith("0")) formattedPhone = "966" + formattedPhone.slice(1);
              if (!formattedPhone.startsWith("+")) formattedPhone = "+" + formattedPhone;

              try {
                const smsRes = await fetch("/api/sms", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    to: formattedPhone,
                    body: `مدماك تيك: وصلك عرض سعر جديد بمبلغ ${Number(offerPrice).toLocaleString('ar-SA')} ر.س على طلب عروض الأسعار: ${selectedRfq.title}. قم بتسجيل الدخول للمراجعة.`
                  })
                });
                if (!smsRes.ok) {
                  console.error("SMS API returned error:", smsRes.status);
                }
              } catch (smsError) {
                console.error("Failed to call SMS API:", smsError);
              }
            }
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

          {profile && !profile.profileCompleted ? (
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
            {selectedRfq?.contractorId && <ContractorInfo contractorId={selectedRfq.contractorId} />}
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
                    className="w-full h-12 px-4 ps-4 pe-12 rounded-xl border-2 border-input bg-white text-xl font-black text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    placeholder="0"
                    min="0"
                  />
                  <span className="absolute end-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">{t("offer_sar")}</span>
                </div>
              </div>
            </div>

            {/* Delivery Location */}
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

            {/* PDF Upload */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">{t("offer_upload_pdf")}</Label>
              {offerPdfUrl ? (
                <div className="flex items-center gap-4 p-4 bg-blue-50/50 border border-blue-200/50 rounded-xl">
                  <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <File size={20} className="text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-blue-800">{t("offer_pdf_attached")}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={removeOfferPdf} className="text-red-500 rounded-lg"><Trash2 size={16} /></Button>
                </div>
              ) : (
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
  
  if (!contractor) return null
  
  return (
    <div className="mt-2 p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col gap-3 shadow-inner">
      <div className="flex justify-between items-center">
        <span className="text-sm font-bold text-slate-500">{t("offer_rfq_owner_label")}</span>
        <span className="text-md font-bold text-slate-800">{contractor.name || contractor.companyName || t("offer_contractor_label")}</span>
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
