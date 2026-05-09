"use client"

import { useState, useRef, useEffect } from "react"
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
  File,
  Upload,
  Loader2,
  Trash2,
  Plus,
  Globe
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useFirestore, useUser, useDoc, useMemoFirebase, useStorage } from "@/firebase"
import { collection, addDoc, doc } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"

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
  onClose: () => void
  onSuccess?: () => void
}

export function SubmitOfferDialog({ selectedRfq, onClose, onSuccess }: SubmitOfferDialogProps) {
  const { toast } = useToast()
  const { user, isUserLoading } = useUser()
  const firestore = useFirestore()
  const storage = useStorage()

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  
  const { data: profile } = useDoc(userDocRef)

  const [offerPrice, setOfferPrice] = useState("")
  const [deliveryLocation, setDeliveryLocation] = useState("")
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [deliveryBatches, setDeliveryBatches] = useState<DeliveryBatch[]>([
    { id: "1", deliveryDate: "", price: "", location: "" }
  ])
  const [mapBatchId, setMapBatchId] = useState<string | null>(null)
  const [tempLocation, setTempLocation] = useState<{lat: number, lng: number} | null>(null)
  const [executionDuration, setExecutionDuration] = useState("")
  const [executionDurationUnit, setExecutionDurationUnit] = useState("أيام")
  const [offerPdfFile, setOfferPdfFile] = useState<File | null>(null)
  const [offerPdfUrl, setOfferPdfUrl] = useState<string | null>(null)
  const [isUploadingPdf, setIsUploadingPdf] = useState(false)
  const [supplierWebsite, setSupplierWebsite] = useState("")
  const offerPdfInputRef = useRef<HTMLInputElement>(null)

  const resetForm = () => {
    setOfferPrice("")
    setDeliveryLocation("")
    setDeliveryCoords(null)
    setDeliveryBatches([{ id: "1", deliveryDate: "", price: "", location: "" }])
    setMapBatchId(null)
    setTempLocation(null)
    setExecutionDuration("")
    setExecutionDurationUnit("أيام")
    setOfferPdfFile(null)
    setOfferPdfUrl(null)
    setSupplierWebsite(profile?.website || "")
    if (offerPdfInputRef.current) offerPdfInputRef.current.value = ""
  }

  useEffect(() => {
    if (selectedRfq) {
      resetForm()
    }
  }, [selectedRfq])

  useEffect(() => {
    if (profile?.website && !supplierWebsite) {
      setSupplierWebsite(profile.website)
    }
  }, [profile])

  const addBatch = () => {
    setDeliveryBatches(prev => [...prev, { id: Date.now().toString(), deliveryDate: "", price: "", location: "", coords: null }])
  }

  const removeBatch = (id: string) => {
    if (deliveryBatches.length > 1) {
      setDeliveryBatches(deliveryBatches.filter(b => b.id !== id))
    }
  }

  const updateBatch = (id: string, field: keyof DeliveryBatch, value: string) => {
    setDeliveryBatches(deliveryBatches.map(b => b.id === id ? { ...b, [field]: value } : b))
  }

  const handleOfferPdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== "application/pdf") {
      toast({ title: "خطأ", description: "يرجى رفع ملف PDF فقط", variant: "destructive" })
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
      toast({ title: "تم الرفع", description: "تم إرفاق ملف عرض السعر بنجاح" })
    } catch (error) {
      console.error("PDF upload failed:", error)
      toast({ title: "خطأ", description: "فشل رفع الملف", variant: "destructive" })
    } finally {
      setIsUploadingPdf(false)
    }
  }

  const removeOfferPdf = () => {
    setOfferPdfFile(null)
    setOfferPdfUrl(null)
    if (offerPdfInputRef.current) offerPdfInputRef.current.value = ""
  }

  const submitOffer = async () => {
    if (!user || !firestore) {
      toast({ title: "خطأ", description: "يجب تسجيل الدخول أولاً", variant: "destructive" });
      return;
    }

    if (!selectedRfq) {
      toast({ title: "بيانات ناقصة", description: "يرجى اختيار مناقصة", variant: "destructive" });
      return;
    }

    const invalidBatch = deliveryBatches.find(b => !b.deliveryDate || !b.price)
    if (invalidBatch) {
      toast({ title: "بيانات ناقصة", description: "يرجى إكمال بيانات جميع الشحنات (التاريخ، السعر)", variant: "destructive" });
      return;
    }

    const totalFromBatches = deliveryBatches.reduce((sum, b) => sum + (parseFloat(b.price) || 0), 0)
    const finalPrice = offerPrice || String(totalFromBatches)

    if (!finalPrice || parseFloat(finalPrice) <= 0) {
      toast({ title: "بيانات ناقصة", description: "يرجى إدخال السعر الإجمالي", variant: "destructive" });
      return;
    }

    try {
      const offerData: any = {
        supplierId: user.uid,
        organizationId: profile?.organizationId || user.uid,
        supplierName: profile?.name || profile?.companyName || "مورد",
        companyName: profile?.companyName || "",
        supplierWebsite: supplierWebsite || profile?.website || null,
        rfqId: selectedRfq.id,
        rfqTitle: selectedRfq.title,
        contractorId: selectedRfq.contractorId || null,
        contractorOrgId: selectedRfq.organizationId || selectedRfq.contractorId || null,
        price: finalPrice,
        deliveryLocation: deliveryBatches[0].location,
        deliveryBatches: deliveryBatches.map(b => ({
          location: b.location,
          deliveryDate: b.deliveryDate,
          price: b.price,
        })),
        totalBatchesPrice: totalFromBatches,
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

      toast({
        title: "تم تقديم العرض بنجاح!",
        description: `تم إرسال عرضك بمبلغ ${Number(finalPrice).toLocaleString('ar-SA')} ر.س.`,
      })
      onClose()
      if (onSuccess) onSuccess()
    } catch (error) {
      console.error(error);
      toast({ title: "خطأ", description: "حدث خطأ أثناء تقديم العرض", variant: "destructive" })
    }
  }

  return (
    <>
      <Dialog open={!!selectedRfq} onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent
          className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-lg text-right rounded-2xl p-0 overflow-hidden max-h-[92dvh] flex flex-col gap-0"
          dir="rtl"
        >
          <DialogTitle className="sr-only">تقديم عرض سعر</DialogTitle>

          <div className="px-5 pl-12 pt-5 pb-4 border-b bg-gradient-to-bl from-primary/5 to-white shrink-0">
            <h2 className="text-lg font-bold text-slate-800">تقديم عرض سعر</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              طلب: <span className="font-semibold text-slate-700">{selectedRfq?.title}</span>
            </p>
            {selectedRfq?.contractorId && <ContractorInfo contractorId={selectedRfq.contractorId} />}
          </div>

          <div className="overflow-y-auto flex-1 px-5 py-5 space-y-5">
            {/* Removed Delivery Options for simplicity */}

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">الشحنات</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            <div className="space-y-3">
              {deliveryBatches.map((batch, index) => (
                <div key={batch.id} className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-slate-100/80 border-b border-slate-200">
                    <span className="text-sm font-bold text-primary flex items-center gap-1.5">
                      <Package size={14} />
                      الشحنة {index + 1}
                    </span>
                    {deliveryBatches.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeBatch(batch.id)}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium"
                      >
                        <Trash2 size={12} />
                        حذف
                      </button>
                    )}
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">موقع التسليم (اختياري)</Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <Input 
                            className="h-10 pr-10 text-xs"
                            value={batch.location || ""}
                            onChange={(e) => updateBatch(batch.id, "location", e.target.value)}
                            placeholder="اكتب الموقع أو اختر من الخريطة"
                          />
                        </div>
                        <Button 
                          type="button"
                          variant="outline"
                          size="icon"
                          className={`h-10 w-10 shrink-0 border-slate-200 ${batch.coords ? 'bg-success/10 border-success/30 text-success' : ''}`}
                          onClick={() => setMapBatchId(batch.id)}
                          title="تحديد من الخريطة"
                        >
                          <MapPin size={16} />
                        </Button>
                      </div>
                      {batch.coords && (
                        <p className="text-[10px] text-success font-medium">✓ تم تحديد الإحداثيات من الخريطة</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-600">تاريخ التسليم <span className="text-red-500">*</span></Label>
                        <input
                          type="date"
                          value={batch.deliveryDate}
                          onChange={(e) => updateBatch(batch.id, "deliveryDate", e.target.value)}
                          className="w-full h-10 px-3 rounded-lg border border-input bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                          min={new Date().toISOString().split('T')[0]}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-600">سعر الشحنة (ر.س) <span className="text-red-500">*</span></Label>
                        <div className="relative">
                          <input
                            type="number"
                            value={batch.price}
                            onChange={(e) => updateBatch(batch.id, "price", e.target.value)}
                            className="w-full h-10 px-3 pl-14 rounded-lg border border-input bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                            placeholder="0"
                            min="0"
                          />
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">ر.س</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addBatch}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border-2 border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-primary hover:text-primary transition-colors"
              >
                <Plus size={14} />
                إضافة شحنة أخرى
              </button>

              {deliveryBatches.length > 1 && (
                <div className="flex items-center justify-between px-4 py-3 bg-primary/5 border border-primary/15 rounded-xl">
                  <span className="text-sm font-semibold text-slate-600">إجمالي الشحنات</span>
                  <span className="text-xl font-black text-primary">
                    {deliveryBatches.reduce((s, b) => s + (parseFloat(b.price) || 0), 0).toLocaleString('ar-SA')}
                    <span className="text-sm font-semibold mr-1">ر.س</span>
                  </span>
                </div>
              )}
            </div>

            {/* Removed Free Shipping and Sample options for simplicity */}

            <div className="space-y-3">
              <Label className="text-sm font-semibold">مدة التنفيذ</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <input
                    type="number"
                    value={executionDuration}
                    onChange={(e) => setExecutionDuration(e.target.value)}
                    className="w-full h-11 px-3 pr-16 rounded-xl border border-input bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="0"
                    min="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">المدة</span>
                </div>
                <Select value={executionDurationUnit} onValueChange={setExecutionDurationUnit}>
                  <SelectTrigger className="h-11 text-sm rounded-xl">
                    <SelectValue placeholder="الوحدة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="أيام">أيام</SelectItem>
                    <SelectItem value="أشهر">أشهر</SelectItem>
                    <SelectItem value="أسابيع">أسابيع</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-semibold flex items-center gap-2">
                رابط الموقع الإلكتروني للمورد
                <span className="text-[10px] text-muted-foreground font-normal">(اختياري)</span>
              </Label>
              <div className="relative">
                <input
                  type="url"
                  value={supplierWebsite}
                  onChange={(e) => setSupplierWebsite(e.target.value)}
                  className="w-full h-11 px-3 pr-10 rounded-xl border border-input bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="https://example.com"
                  dir="ltr"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Globe size={16} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-semibold">رفع ملف عرض السعر (PDF)</Label>
              {offerPdfUrl ? (
                <div className="flex items-center gap-4 p-4 bg-blue-50/50 border border-blue-200/50 rounded-xl">
                  <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <File size={20} className="text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-blue-800">تم إرفاق ملف PDF</span>
                    <p className="text-xs text-blue-600/70 mt-0.5">ملف عرض السعر جاهز للإرسال</p>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={removeOfferPdf} 
                    className="text-red-500 hover:bg-red-50 hover:text-red-600 rounded-lg"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    ref={offerPdfInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={handleOfferPdfUpload}
                    disabled={isUploadingPdf}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <div className="flex items-center justify-center gap-3 h-24 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 text-slate-500 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group">
                    {isUploadingPdf ? (
                      <Loader2 size={24} className="animate-spin text-primary" />
                    ) : (
                      <>
                        <div className="h-10 w-10 rounded-lg bg-slate-100 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                          <Upload size={18} className="text-slate-400 group-hover:text-primary transition-colors" />
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-semibold text-slate-700 block">اضغط لرفع ملف PDF</span>
                          <span className="text-xs text-slate-400">عرض السعر بصيغة PDF</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">السعر الإجمالي (ر.س) <span className="text-red-500">*</span></Label>
              <div className="relative">
                <input
                  type="number"
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                  className="w-full h-12 px-4 pl-16 rounded-xl border-2 border-input bg-white text-base font-bold focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  placeholder={deliveryBatches.length > 1 ? String(deliveryBatches.reduce((s, b) => s + (parseFloat(b.price) || 0), 0)) : "0"}
                  min="0"
                />
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">ر.س</span>
              </div>
              {deliveryBatches.length > 1 && (
                <p className="text-xs text-muted-foreground">اتركه فارغاً ليُحسب تلقائياً من مجموع الشحنات، أو أدخل قيمة مخصصة</p>
              )}
            </div>

          </div>

          <div className="px-5 py-4 border-t bg-white shrink-0 flex flex-col sm:flex-row gap-3">
            <Button variant="outline" className="flex-1 order-2 sm:order-1" onClick={onClose}>
              إلغاء
            </Button>
            <Button
              onClick={submitOffer}
              disabled={
                deliveryBatches.some(b => !b.location || !b.deliveryDate || !b.price) ||
                (!offerPrice && deliveryBatches.every(b => !b.price))
              }
              className="flex-[2] order-1 sm:order-2"
            >
              تأكيد وإرسال العرض
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!mapBatchId} onOpenChange={(open) => { 
        if (!open) {
          setMapBatchId(null);
          setTempLocation(null);
        }
      }}>
        <DialogContent className="sm:max-w-[600px]" dir="rtl">
          <DialogHeader>
            <DialogTitle>تحديد موقع التسليم</DialogTitle>
            <DialogDescription>اضغط على الخريطة لتحديد الموقع، ثم اضغط تأكيد</DialogDescription>
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
            <Button variant="outline" onClick={() => { setMapBatchId(null); setTempLocation(null); }}>إلغاء</Button>
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
              تأكيد الموقع
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ContractorInfo({ contractorId }: { contractorId: string }) {
  const firestore = useFirestore()
  const docRef = useMemoFirebase(() => {
    if (!firestore || !contractorId) return null
    return doc(firestore, "users", contractorId)
  }, [firestore, contractorId])
  
  const { data: contractor } = useDoc(docRef)
  
  if (!contractor) return null
  
  return (
    <div className="mt-2 p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col gap-3 shadow-inner">
      <div className="flex justify-between items-center">
        <span className="text-sm font-bold text-slate-500">صاحب المناقصة:</span>
        <span className="text-md font-bold text-slate-800">{contractor.name || contractor.companyName || "مقاول"}</span>
      </div>
      
      {(contractor.certificates?.length > 0 || contractor.profileCompleted) && (
        <div className="flex gap-2 flex-wrap">
          {contractor.profileCompleted && (
            <Badge variant="outline" className="bg-success/10 text-success border-success/30 px-3 py-1">
              السجل التجاري موثق ✓
            </Badge>
          )}
          {contractor.certificates?.map((cert: any, idx: number) => (
            <Badge key={idx} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 px-3 py-1">
              {cert.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
