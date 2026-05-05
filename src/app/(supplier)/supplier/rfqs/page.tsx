"use client"

import { useState, useEffect, useRef } from "react"
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
  X
} from "lucide-react"
import { PREDEFINED_CATEGORIES, SAUDI_CITIES } from "@/lib/constants"
import { useToast } from "@/hooks/use-toast"
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from "@/firebase"
import { collection, query, where, orderBy, doc, addDoc, serverTimestamp } from "firebase/firestore"
import { useRouter, useSearchParams } from "next/navigation"
import { useStorage } from "@/firebase"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"

interface DeliveryBatch {
  id: string
  quantity: string
  deliveryDate: string
  price: string
  location: string
  coords: { lat: number; lng: number } | null
}

const getRemainingTime = (dateString: string) => {
  if (!dateString) return "";
  const deadline = new Date(dateString);
  // Set to end of day
  deadline.setHours(23, 59, 59, 999);
  
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();
  
  if (diff < 0) return "انتهى الموعد";
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "ينتهي اليوم";
  if (days === 1) return "ينتهي غداً";
  if (days === 2) return "ينتهي بعد يومين";
  if (days <= 10) return `متبقي ${days} أيام`;
  return `متبقي ${days} يوماً`;
}

export default function AvailableRfqsPage() {
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
  const [showRfqDetails, setShowRfqDetails] = useState(false)
  const [showInquiries, setShowInquiries] = useState(false)
  const [newQuestion, setNewQuestion] = useState("")
  const [isSubmittingQuestion, setIsSubmittingQuestion] = useState(false)
  const [offerPrice, setOfferPrice] = useState("")
  const [deliveryLocation, setDeliveryLocation] = useState("")
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [deliveryMethod, setDeliveryMethod] = useState("")
  const [deliveryFrequency, setDeliveryFrequency] = useState("")
  const [deliveryBatches, setDeliveryBatches] = useState<DeliveryBatch[]>([
    { id: "1", quantity: "", deliveryDate: "", price: "", location: "", coords: null }
  ])
  const [mapBatchId, setMapBatchId] = useState<string | null>(null)
  const [tempLocation, setTempLocation] = useState<{lat: number, lng: number} | null>(null)
  const [isFreeShipping, setIsFreeShipping] = useState(false)
  const [includesSample, setIncludesSample] = useState(false)
  const [executionDuration, setExecutionDuration] = useState("")
  const [executionDurationUnit, setExecutionDurationUnit] = useState("أيام")
  const [offerPdfFile, setOfferPdfFile] = useState<File | null>(null)
  const [offerPdfUrl, setOfferPdfUrl] = useState<string | null>(null)
  const [isUploadingPdf, setIsUploadingPdf] = useState(false)
  const offerPdfInputRef = useRef<HTMLInputElement>(null)

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

  // ✅ تطبيق نمط الحماية: العودة بـ null طالما أن حالة المستخدم لم تكتمل
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    
    let q = query(
      collection(firestore, "rfqs"),
      where("status", "==", "New"),
      where("visibility", "==", "public"),
      orderBy("createdAt", "desc")
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

  // Client-side filtering by specializations
  const rfqs = allRfqs?.filter((rfq: any) => {
    if (!profile?.specializations?.length) return false;
    return profile.specializations.includes(rfq.category);
  }) || [];

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

  const resetForm = () => {
    setOfferPrice("")
    setDeliveryLocation("")
    setDeliveryCoords(null)
    setDeliveryMethod("")
    setDeliveryFrequency("")
    setDeliveryBatches([{ id: "1", quantity: "", deliveryDate: "", price: "", location: "", coords: null }])
    setMapBatchId(null)
    setIsFreeShipping(false)
    setIncludesSample(false)
    setExecutionDuration("")
    setExecutionDurationUnit("أيام")
    setOfferPdfFile(null)
    setOfferPdfUrl(null)
    if (offerPdfInputRef.current) offerPdfInputRef.current.value = ""
  }

  const addBatch = () => {
    setDeliveryBatches(prev => [...prev, { id: Date.now().toString(), quantity: "", deliveryDate: "", price: "", location: "", coords: null }])
  }

  const removeBatch = (id: string) => {
    if (deliveryBatches.length > 1) {
      setDeliveryBatches(deliveryBatches.filter(b => b.id !== id))
    }
  }

  const updateBatch = (id: string, field: keyof DeliveryBatch, value: string) => {
    setDeliveryBatches(deliveryBatches.map(b => b.id === id ? { ...b, [field]: value } : b))
  }

  const submitQuestion = async () => {
    if (!user || !firestore || !selectedRfq?.id || !newQuestion.trim()) return
    setIsSubmittingQuestion(true)
    try {
      await addDoc(collection(firestore, "rfqs", selectedRfq.id, "inquiries"), {
        question: newQuestion.trim(),
        supplierId: user.uid,
        supplierName: profile?.name || "مورد",
        createdAt: new Date().toISOString(),
        reply: null,
        repliedAt: null
      })
      setNewQuestion("")
      toast({ title: "تم الإرسال", description: "تم إرسال سؤالك للمقاول ينتظر الرد." })
    } catch (error) {
      toast({ title: "خطأ", description: "فشل إرسال السؤال", variant: "destructive" })
    } finally {
      setIsSubmittingQuestion(false)
    }
  }

  const submitOffer = async () => {
    if (!user || !firestore) {
      toast({ title: "خطأ", description: "يجب تسجيل الدخول أولاً", variant: "destructive" });
      return;
    }

    if (!selectedRfq || !deliveryMethod || !deliveryFrequency) {
      toast({ title: "بيانات ناقصة", description: "يرجى اختيار طريقة ووتيرة التسليم", variant: "destructive" });
      return;
    }

    const invalidBatch = deliveryBatches.find(b => !b.location || !b.deliveryDate || !b.price)
    if (invalidBatch) {
      toast({ title: "بيانات ناقصة", description: "يرجى إكمال بيانات جميع الشحنات (الموقع، التاريخ، السعر)", variant: "destructive" });
      return;
    }

    const totalFromBatches = deliveryBatches.reduce((sum, b) => sum + (parseFloat(b.price) || 0), 0)
    const finalPrice = offerPrice || String(totalFromBatches)

    if (!finalPrice || parseFloat(finalPrice) <= 0) {
      toast({ title: "بيانات ناقصة", description: "يرجى إدخال السعر الإجمالي", variant: "destructive" });
      return;
    }

    try {
      const { addDoc } = await import("firebase/firestore");

      const offerData: any = {
        supplierId: user.uid,
        supplierName: profile?.name || profile?.companyName || "مورد",
        companyName: profile?.companyName || "",
        rfqId: selectedRfq.id,
        rfqTitle: selectedRfq.title,
        contractorId: selectedRfq.contractorId || null,
        price: finalPrice,
        deliveryLocation,
        deliveryCoords,
        deliveryMethod,
        deliveryFrequency,
        isFreeShipping,
        includesSample,
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
      setSelectedRfq(null);
      resetForm();
      setTimeout(() => { router.push("/supplier/offers") }, 1000)
    } catch (error) {
      console.error(error);
      toast({ title: "خطأ", description: "حدث خطأ أثناء تقديم العرض", variant: "destructive" })
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-8 text-right">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">المناقصات المتاحة</h1>
            <p className="text-muted-foreground mt-1">تصفح الفرص الجديدة المتاحة في السوق لمجالات تخصصك</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="بحث في المناقصات..." 
                className="pr-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {/* Deadline Filter */}
              <Select value={deadlineFilter} onValueChange={(v: any) => setDeadlineFilter(v)}>
                <SelectTrigger className="w-[140px] h-10 text-sm">
                  <SelectValue placeholder="الموعد النهائي" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المواعيد</SelectItem>
                  <SelectItem value="week">خلال أسبوع</SelectItem>
                  <SelectItem value="month">خلال شهر</SelectItem>
                  <SelectItem value="custom">تاريخ محدد</SelectItem>
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
                <SelectTrigger className="w-[140px] h-10 text-sm">
                  <SelectValue placeholder="التصنيف" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل التصنيفات</SelectItem>
                  {PREDEFINED_CATEGORIES.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* City Filter */}
              <Select value={selectedCity} onValueChange={setSelectedCity}>
                <SelectTrigger className="w-[140px] h-10 text-sm">
                  <SelectValue placeholder="المدينة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المدن</SelectItem>
                  {SAUDI_CITIES.map(city => (
                    <SelectItem key={city} value={city}>{city}</SelectItem>
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
                   مسح الفلاتر
                 </Button>
               )}
             </div>
           </div>
         </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {isLoading ? (
            <div className="col-span-full p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="animate-spin text-primary" size={40} />
              <p className="font-medium animate-pulse">جاري تحميل المناقصات المتاحة...</p>
            </div>
          ) : filteredRfqs.length === 0 ? (
            <div className="col-span-full p-20 text-center flex flex-col items-center gap-3 text-muted-foreground bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200">
              <Search size={48} className="opacity-20" />
              <p className="text-lg font-bold text-slate-600">لا توجد مناقصات مطابقة لبحثك</p>
              <p className="text-sm">حاول تغيير كلمات البحث أو تصفية التخصصات</p>
            </div>
          ) : (
            filteredRfqs.map((rfq: any) => (
              <Card key={rfq.id} className="group relative overflow-hidden border-slate-200/60 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 bg-white/60 backdrop-blur-xl flex flex-col">
                <CardContent className="p-5 flex flex-col flex-1">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-none px-2.5 py-1">
                        {rfq.category}
                      </Badge>
                      {rfq.subCategory && (
                        <Badge variant="outline" className="text-slate-600 border-slate-200 bg-white/50 px-2.5 py-1">
                          {rfq.subCategory}
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
                        ? `${rfq.products.length} منتج`
                        : `الكمية: ${rfq.quantity} ${rfq.unitOfMeasure}`
                      }
                    </div>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-slate-100/80 mb-5">
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                        <MapPin size={12} className="text-blue-600" />
                      </div>
                      <span className="truncate">{rfq.city} - {rfq.district}</span>
                      {rfq.locationCoords && (
                        <a 
                          href={`https://www.google.com/maps/search/?api=1&query=${rfq.locationCoords.lat},${rfq.locationCoords.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] bg-blue-100/50 text-blue-700 px-2 py-0.5 rounded-full hover:bg-blue-200 transition-colors mr-auto shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          خريطة
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-600" suppressHydrationWarning>
                      <div className="w-6 h-6 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                        <Calendar size={12} className="text-amber-600" />
                      </div>
                      الموعد: <span className="font-bold text-slate-700">{rfq.deadline ? new Date(rfq.deadline).toLocaleDateString('ar-SA') : 'غير محدد'}</span>
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
                    className="w-full gap-2 bg-slate-900 hover:bg-primary text-white rounded-xl h-11 transition-all group-hover:shadow-md"
                  >
                    تقديم عرض سعر
                    <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <Dialog open={!!selectedRfq} onOpenChange={(open) => { if (!open) { setSelectedRfq(null); resetForm() } }}>
        <DialogContent
          className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-lg text-right rounded-2xl p-0 overflow-hidden max-h-[92dvh] flex flex-col gap-0"
          dir="rtl"
        >
          {/* Hidden DialogTitle for accessibility */}
          <DialogTitle className="sr-only">تقديم عرض سعر</DialogTitle>

          {/* Sticky Header */}
          <div className="px-5 pl-12 pt-5 pb-4 border-b bg-gradient-to-bl from-primary/5 to-white shrink-0">
            <h2 className="text-lg font-bold text-slate-800">تقديم عرض سعر</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              طلب: <span className="font-semibold text-slate-700">{selectedRfq?.title}</span>
            </p>
            {selectedRfq?.contractorId && <ContractorInfo contractorId={selectedRfq.contractorId} />}
          </div>

          {/* Scrollable Body */}
          <div className="overflow-y-auto flex-1 px-5 py-5 space-y-5">

            {/* Method + Frequency */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">طريقة التسليم <span className="text-red-500">*</span></Label>
                <Select value={deliveryMethod} onValueChange={setDeliveryMethod}>
                  <SelectTrigger className="w-full h-10 text-sm">
                    <SelectValue placeholder="اختر..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="شاحنات خاصة">شاحنات خاصة</SelectItem>
                    <SelectItem value="تسليم مباشر">تسليم مباشر</SelectItem>
                    <SelectItem value="نقل بالرافعة">نقل بالرافعة</SelectItem>
                    <SelectItem value="شحن دولي">شحن دولي</SelectItem>
                    <SelectItem value="خدمة التوصيل">خدمة التوصيل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">وتيرة التسليم <span className="text-red-500">*</span></Label>
                <Select value={deliveryFrequency} onValueChange={setDeliveryFrequency}>
                  <SelectTrigger className="w-full h-10 text-sm">
                    <SelectValue placeholder="اختر..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="دفعة واحدة">دفعة واحدة</SelectItem>
                    <SelectItem value="أسبوعية">أسبوعية</SelectItem>
                    <SelectItem value="نصف شهرية">نصف شهرية</SelectItem>
                    <SelectItem value="شهرية">شهرية</SelectItem>
                    <SelectItem value="حسب الطلب">حسب الطلب</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Section Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">الشحنات</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            {/* Batches */}
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
                    {/* Location picker */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">موقع التسليم <span className="text-red-500">*</span></Label>
                      {batch.location ? (
                        <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                          <MapPin size={14} className="text-green-600 shrink-0 mt-0.5" />
                          <span className="text-green-800 text-xs font-medium flex-1 leading-relaxed break-words min-w-0">{batch.location}</span>
                          <button
                            type="button"
                            onClick={() => setDeliveryBatches(prev => prev.map(b => b.id === batch.id ? { ...b, location: "", coords: null } : b))}
                            className="text-[10px] text-red-500 hover:underline shrink-0 font-medium"
                          >تغيير</button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setMapBatchId(batch.id)}
                          className="w-full flex items-center justify-center gap-2 h-11 rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-primary hover:text-primary transition-colors font-medium"
                        >
                          <MapPin size={15} />
                          تحديد الموقع على الخريطة
                        </button>
                      )}
                    </div>

                    {/* Date + Price — stack on mobile */}
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

              {/* Add Batch */}
              <button
                type="button"
                onClick={addBatch}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border-2 border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-primary hover:text-primary transition-colors"
              >
                <Plus size={14} />
                إضافة شحنة أخرى
              </button>

              {/* Auto total badge */}
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

            {/* Extra Options */}
            <div className="flex flex-col sm:flex-row gap-3">
              <label className="flex-1 flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors">
                <input 
                  type="checkbox" 
                  checked={isFreeShipping}
                  onChange={(e) => setIsFreeShipping(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-semibold text-slate-700">توصيل مجاني</span>
              </label>
              <label className="flex-1 flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors">
                <input 
                  type="checkbox" 
                  checked={includesSample}
                  onChange={(e) => setIncludesSample(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-semibold text-slate-700">توفير عينة (Sample)</span>
              </label>
            </div>

            {/* Execution Duration */}
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

            {/* Upload Offer PDF */}
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

            {/* Grand Total */}
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

          {/* Sticky Footer */}
          <div className="px-5 py-4 border-t bg-white shrink-0 flex flex-col sm:flex-row gap-3">
            <Button variant="outline" className="flex-1 order-2 sm:order-1" onClick={() => { setSelectedRfq(null); resetForm() }}>
              إلغاء
            </Button>
            <Button
              onClick={submitOffer}
              disabled={
                !deliveryMethod ||
                !deliveryFrequency ||
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

      {/* RFQ Details Dialog */}
      <Dialog open={showRfqDetails} onOpenChange={(open) => { if (!open) { setShowRfqDetails(false); setShowInquiries(false) } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-2xl text-right rounded-2xl p-0 overflow-hidden max-h-[92dvh] flex flex-col gap-0" dir="rtl">
          <DialogTitle className="sr-only">تفاصيل المناقصة</DialogTitle>
          
          <div className="px-5 pt-5 pb-3 border-b bg-gradient-to-bl from-primary/5 to-white shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">{selectedRfq?.title}</h2>
              <Button variant="ghost" size="sm" onClick={() => { setShowRfqDetails(false); setShowInquiries(false) }} className="shrink-0">
                ✕
              </Button>
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
                  المنتجات المطلوبة
                </h3>
                <div className="space-y-2">
                  {selectedRfq.products.map((prod: any, idx: number) => (
                    <div key={idx} className="p-3 bg-slate-50 rounded-lg border">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-800">{prod.name}</span>
                        <span className="text-sm text-primary font-bold">{prod.quantity} {prod.unitOfMeasure}</span>
                      </div>
                      {prod.description && <p className="text-sm text-slate-600 mt-1">{prod.description}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {selectedRfq?.notes && (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                <h3 className="font-bold text-amber-800 text-sm mb-1">ملاحظات إضافية</h3>
                <p className="text-sm text-amber-900">{selectedRfq.notes}</p>
              </div>
            )}

            {/* PDF */}
            {selectedRfq?.pdfUrl && (
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <File size={20} className="text-blue-600" />
                <span className="flex-1 text-sm font-medium text-blue-800">ملف PDF مرفق</span>
                <a href={selectedRfq.pdfUrl} target="_blank" rel="noopener noreferrer" download>
                  <Button variant="outline" size="sm" className="gap-1">
                    <Download size={14} />
                    تحميل
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
                <span>الموعد: {selectedRfq?.deadline ? new Date(selectedRfq.deadline).toLocaleDateString('ar-SA') : 'غير محدد'}</span>
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
                  الاستفسارات والأسئلة
                </span>
                {showInquiries ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </Button>

              {showInquiries && (
                <div className="mt-3 space-y-3">
                  {/* Question Form */}
                  <div className="flex gap-2">
                    <Input 
                      placeholder="اكتب سؤالك للمقاول..." 
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
                                  <p className="text-xs font-bold text-green-700">رد المقاول:</p>
                                  <p className="text-sm text-green-800">{inq.reply}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">لا توجد استفسارات بعد. كن أول من يسأل!</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="px-5 py-4 border-t bg-white shrink-0 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => { setShowRfqDetails(false); setShowInquiries(false) }}>
              إغلاق
            </Button>
            <Button className="flex-1 bg-success hover:bg-success/90 gap-2" onClick={() => { setShowRfqDetails(false); setSelectedRfq(selectedRfq) }}>
              تقديم عرض سعر
              <ChevronLeft size={16} />
            </Button>
          </div>
        </DialogContent>
      </Dialog>


      {/* Shared Map Dialog — only ONE Leaflet instance, only mounted when open */}
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

    </PortalLayout>
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