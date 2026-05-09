"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
import Link from "next/link"

export default function RfqOffersPage() {
  const params = useParams()
  const rfqId = params.id as string
  const router = useRouter()
  const { toast } = useToast()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [openingChat, setOpeningChat] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<"price" | "date" | "duration">("price")

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
          supplierId: offer.supplierId,
          createdAt: new Date().toISOString()
        })
      }
      router.push(`/chat/${offer.id}`)
    } catch (err: any) {
      console.error("❌ openChat failed:", err?.code, err?.message)
      toast({ title: "خطأ", description: "تعذر فتح المحادثة: " + (err?.code || ""), variant: "destructive" })
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

  const handleDecision = async (offerId: string, decision: "مقبول" | "مرفوض" | "مطلوب تخفيض") => {
    if (!firestore || !user) return
    setProcessingId(offerId)

    const offer = offers?.find((o: any) => o.id === offerId)

    // Step 1: Update offer status
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        status: decision,
        decidedAt: new Date().toISOString(),
        readAt: null // reset read status for supplier
      })
    } catch (error: any) {
      console.error("❌ updateDoc offer failed:", error?.code, error?.message)
      toast({ title: "خطأ", description: `فشل تحديث العرض: ${error?.code || error?.message}`, variant: "destructive" })
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
            supplierId: offer.supplierId,
            createdAt: new Date().toISOString()
          })
        }
      } catch (error: any) {
        console.error("❌ setDoc chat failed:", error?.code, error?.message)
        // Don't block the accept flow — offer is already updated
        toast({ title: "تنبيه", description: "تم قبول العرض لكن فشل إنشاء المحادثة. تحقق من قواعد Firestore.", variant: "destructive" })
        setProcessingId(null)
        return
      }
    }

    toast({
      title: decision === "مقبول" ? "✅ تم قبول العرض!" : decision === "مرفوض" ? "❌ تم رفض العرض" : "📉 تم طلب التخفيض",
      description: decision === "مقبول"
        ? "سيتم إشعار المورد. يمكنك التواصل معه من صفحة محادثاتي."
        : decision === "مرفوض"
        ? "تم رفض العرض وسيتم إشعار المورد."
        : "تم إرسال طلب للمورد لتخفيض السعر المقدم.",
    })
    setProcessingId(null)
  }

  const handleSampleAction = async (offerId: string, action: "مطلوبة" | "تم الاستلام") => {
    if (!firestore || !user) return;
    setProcessingId(offerId);
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        sampleStatus: action,
        sampleUpdatedAt: new Date().toISOString(),
        readAt: null // reset read status for supplier
      });
      toast({ 
        title: action === "مطلوبة" ? "تم طلب العينة" : "تم استلام العينة", 
        description: action === "مطلوبة" ? "تم إرسال طلب للمورد لتوفير عينة." : "تم تأكيد استلام العينة بنجاح." 
      });
    } catch (error) {
      toast({ title: "خطأ", description: "حدث خطأ أثناء تحديث حالة العينة.", variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "مقبول": return <Badge className="bg-success/10 text-success border-success/20">مقبول ✅</Badge>
      case "مرفوض": return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none">مرفوض ❌</Badge>
      case "مطلوب تخفيض": return <Badge className="bg-amber-100 text-amber-700 border-none">مطلوب تخفيض السعر 📉</Badge>
      default: return <Badge className="bg-amber-50 text-amber-600 border-amber-100">قيد المراجعة 🕐</Badge>
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
      <div className="space-y-6 text-right">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2 gap-1 text-muted-foreground">
              <ArrowRight size={16} />
              العودة للمناقصات
            </Button>
            <h1 className="text-3xl font-bold text-secondary font-headline">عروض المناقصة</h1>
            <p className="text-muted-foreground mt-1">راجع عروض الأسعار المقدمة من الموردين واتخذ قرارك</p>
          </div>
        </div>
        {rfq && (
          <Card className="border-none shadow-sm bg-white overflow-hidden">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row justify-between gap-6">
                <div className="space-y-4 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="bg-primary/5 text-primary border-none">
                      {rfq.category}
                    </Badge>
                    {rfq.subCategory && (
                      <Badge variant="outline" className="text-muted-foreground border-slate-200">
                        {rfq.subCategory}
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
                        تحميل PDF
                      </a>
                    )}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mr-auto bg-slate-50 px-2 py-1 rounded">
                      <Calendar size={12} />
                      تاريخ الطرح: {rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString('ar-SA') : '-'}
                    </div>
                  </div>
                  
                  <h2 className="text-2xl font-bold text-slate-800">{rfq.title}</h2>
                  
                  <div className="flex flex-wrap items-center gap-6 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <MapPin size={16} className="text-primary" />
                      {rfq.city} - {rfq.district}
                      {rfq.locationCoords && (
                        <a 
                          href={`https://www.google.com/maps/search/?api=1&query=${rfq.locationCoords.lat},${rfq.locationCoords.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary underline mr-2 hover:text-primary/70 transition-colors"
                        >
                          عرض الموقع
                        </a>
                      )}
                    </div>
                    {rfq.isQualityCertificateRequired && (
                      <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">
                        شهادة جودة مطلوبة
                      </Badge>
                    )}
                  </div>

                  {/* Products List */}
                  {rfq.products && rfq.products.length > 0 && (
                    <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
                      <p className="text-xs font-bold text-slate-600 mb-3">المنتجات المطلوبة:</p>
                      <div className="space-y-2">
                        {rfq.products.map((product: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between bg-white p-3 rounded border border-slate-100">
                            <div className="flex-1">
                              <p className="font-bold text-sm text-slate-800">{product.name}</p>
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
                      <p className="text-xs font-bold text-slate-600 mb-2">ملاحظات:</p>
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
                        عرض الملف المرفق (PDF)
                      </a>
                    </div>
                  )}
                </div>

                <div className="md:w-px md:h-24 bg-slate-100 hidden md:block" />

                <div className="space-y-2 min-w-[200px]">
                  <p className="text-xs text-muted-foreground">رقم المناقصة</p>
                  <p className="font-mono text-sm font-bold text-primary bg-primary/5 px-3 py-2 rounded-lg border border-primary/10">
                    {rfqId}
                  </p>
                  {rfq.deadline && (
                    <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/5 px-3 py-2 rounded-lg border border-destructive/10">
                      <Calendar size={14} />
                      الموعد النهائي: {new Date(rfq.deadline).toLocaleDateString('ar-SA')}
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
                <p className="text-xs text-muted-foreground">إجمالي العروض</p>
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
                <p className="text-xs text-muted-foreground">تم قبولها</p>
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
                <p className="text-xs text-muted-foreground">قيد المراجعة</p>
                <p className="text-xl font-bold">{offers?.filter((o: any) => o.status === "قيد المراجعة").length || 0}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Offers and Compare Tabs */}
        <Tabs defaultValue="list" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg text-slate-800">العروض المقدمة</h3>
            <TabsList className="bg-slate-100/50 border border-slate-200">
              <TabsTrigger value="list" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">قائمة العروض</TabsTrigger>
              <TabsTrigger value="compare" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">مقارنة العروض</TabsTrigger>
              <TabsTrigger value="inquiries" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">الاستفسارات</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="list" className="space-y-4 m-0 mt-6">
          {isLoading ? (
            <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="animate-spin" size={40} />
              <p>جاري تحميل العروض...</p>
            </div>
          ) : !offers || offers.length === 0 ? (
            <Card className="border-dashed border-2 border-slate-200 shadow-none">
              <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                <TrendingUp size={48} className="opacity-20" />
                <p className="font-bold text-lg">لا توجد عروض حتى الآن</p>
                <p className="text-sm">عندما يقدم الموردون عروضهم لهذه المناقصة، ستظهر هنا تلقائياً.</p>
              </CardContent>
            </Card>
          ) : (
            offers.map((offer: any) => {
              const isBestOffer = offer.price === lowestPrice && offer.status !== "مرفوض";
              
              return (
                <Card key={offer.id} className={`border shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden relative ${
                  offer.status === "مقبول" ? "border-success/30 bg-success/5" : 
                  offer.status === "مرفوض" ? "opacity-50 grayscale-[50%]" : 
                  isBestOffer ? "border-amber-300 bg-amber-50/20" : "border-slate-100 bg-white"
                }`}>
                  {isBestOffer && offer.status === "قيد المراجعة" && (
                    <div className="absolute top-0 left-0 bg-amber-400 text-amber-950 text-[10px] font-black px-3 py-1 rounded-br-lg rounded-tl-lg z-10 shadow-sm flex items-center gap-1">
                      <TrendingUp size={12} /> أفضل سعر
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
                            <p className="font-bold text-sm text-slate-800">{offer.supplierName || offer.companyName || "مورد مسجل"}</p>
                            <p className="text-xs text-muted-foreground font-mono">{offer.supplierId?.substring(0, 10)}...</p>
                            {offer.supplierWebsite && (
                              <a 
                                href={offer.supplierWebsite.startsWith('http') ? offer.supplierWebsite : `https://${offer.supplierWebsite}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
                              >
                                <Globe size={10} />
                                زيارة الموقع
                              </a>
                            )}
                          </div>
                        </div>
                        {getStatusBadge(offer.status || "قيد المراجعة")}
                      </div>

                      <div className="flex flex-wrap gap-4 text-sm mt-2">
                        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl ${isBestOffer ? "bg-amber-100/50" : "bg-primary/5"}`}>
                          <span className="text-muted-foreground font-medium">السعر المقترح:</span>
                          <span className={`font-black text-xl ${isBestOffer ? "text-amber-600" : "text-primary"}`}>
                            {offer.price} <span className="text-sm font-normal">ر.س</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground" suppressHydrationWarning>
                          <Calendar size={14} />
                          <span>{offer.createdAt ? new Date(offer.createdAt).toLocaleDateString('ar-SA') : "-"}</span>
                        </div>
                        {/* Extra options */}
                        <div className="flex flex-wrap items-center gap-3 mt-4">
                          {offer.isFreeShipping && (
                            <Badge variant="secondary" className="bg-primary/10 text-primary border-none hover:bg-primary/20 transition-colors cursor-default">
                              توصيل مجاني
                            </Badge>
                          )}
                          {offer.includesSample && (
                            <Badge variant="secondary" className="bg-primary/10 text-primary border-none hover:bg-primary/20 transition-colors cursor-default">
                              يتضمن عينة (Sample)
                            </Badge>
                          )}
                          {offer.sampleStatus && (
                            <Badge variant="outline" className={`border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors cursor-default ${offer.sampleStatus === "تم الاستلام" ? "bg-success/10 text-success border-success/30" : ""}`}>
                              العينة: {offer.sampleStatus}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {offer.deliveryLocation && (
                        <div className="mt-4 p-4 bg-slate-50 rounded-lg space-y-3 border border-slate-100">
                          <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                            <Truck size={16} className="text-primary" />
                            تفاصيل التسليم
                          </div>
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                            <div className="flex items-center gap-2">
                              <MapPin size={14} className="text-muted-foreground" />
                              <span className="text-slate-600">موقع التسليم:</span>
                              <span className="font-medium">{offer.deliveryLocation}</span>
                            </div>
                            {offer.deliveryMethod && (
                              <div className="flex items-center gap-2">
                                <Package size={14} className="text-muted-foreground" />
                                <span className="text-slate-600">الطريقة:</span>
                                <span className="font-medium">{offer.deliveryMethod}</span>
                              </div>
                            )}
                            {offer.deliveryFrequency && (
                              <div className="flex items-center gap-2 sm:col-span-2">
                                <Calendar size={14} className="text-muted-foreground" />
                                <span className="text-slate-600">وتيرة التسليم:</span>
                                <span className="font-medium">{offer.deliveryFrequency}</span>
                              </div>
                            )}
                          </div>

                          {offer.deliveryBatches && offer.deliveryBatches.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                              <p className="text-xs font-bold text-slate-600 mb-2">جدول الشحنات:</p>
                              <div className="space-y-2">
                                {offer.deliveryBatches.map((batch: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between bg-white p-2 rounded border border-slate-100 text-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-bold">
                                        شحنة {idx + 1}
                                      </span>
                                      <span className="text-slate-600">{batch.quantity}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Calendar size={12} className="text-muted-foreground" />
                                      <span className="text-slate-600">{batch.deliveryDate}</span>
                                      <span className="font-bold text-success">{batch.price} ر.س</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              {offer.totalBatchesPrice && (
                                <div className="mt-2 flex justify-end">
                                  <span className="text-xs text-muted-foreground">
                                    إجمالي أسعار الشحنات: <span className="font-bold text-success">{offer.totalBatchesPrice} ر.س</span>
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
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
                          قبول العرض
                        </Button>
                        <Button
                          onClick={() => handleDecision(offer.id, "مطلوب تخفيض")}
                          disabled={processingId === offer.id}
                          variant="outline"
                          className="w-full gap-2 rounded-full border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 hover:border-amber-500 hover:text-amber-800 transition-all font-medium"
                          size="sm"
                        >
                          <ArrowDown size={14} />
                          طلب تخفيض
                        </Button>
                        <Button
                          onClick={() => handleDecision(offer.id, "مرفوض")}
                          disabled={processingId === offer.id}
                          variant="ghost"
                          className="w-full gap-2 rounded-full text-red-600 hover:text-red-700 hover:bg-red-50 transition-all"
                          size="sm"
                        >
                          <XCircle size={14} />
                          رفض
                        </Button>
                        {(!offer.sampleStatus || offer.sampleStatus === "تم الاستلام") && (
                          <Button
                            onClick={() => handleSampleAction(offer.id, "مطلوبة")}
                            disabled={processingId === offer.id}
                            variant="outline"
                            className="w-full gap-2 rounded-full border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 hover:border-blue-500 hover:text-blue-800 transition-all font-medium mt-1"
                            size="sm"
                          >
                            <Box size={14} />
                            {offer.sampleStatus ? "طلب عينة أخرى" : "طلب عينة"}
                          </Button>
                        )}
                        {offer.sampleStatus === "تم الإرسال" && (
                          <Button
                            onClick={() => handleSampleAction(offer.id, "تم الاستلام")}
                            disabled={processingId === offer.id}
                            variant="outline"
                            className="w-full gap-2 rounded-full border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-500 hover:text-emerald-800 transition-all font-medium mt-1"
                            size="sm"
                          >
                            <CheckCircle2 size={14} />
                            تأكيد استلام العينة
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Action Buttons - Accepted */}
                    {offer.status === "مقبول" && (
                      <div className="bg-success/5 p-6 grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-col items-center justify-center gap-3 md:border-r border-t md:border-t-0 min-w-[180px]">
                        <Button
                          onClick={() => openChat(offer)}
                          disabled={openingChat === offer.id}
                          className="w-full bg-primary hover:bg-primary/90 gap-2 rounded-full transition-all hover:shadow-lg"
                          size="sm"
                        >
                          {openingChat === offer.id ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                          فتح المحادثة
                        </Button>
                        <SupplierWhatsAppButton supplierId={offer.supplierId} />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )})
          )}
          </TabsContent>

          <TabsContent value="compare" className="m-0 mt-6">
            {!sortedOffers || sortedOffers.length < 2 ? (
              <Card className="border-dashed border-2 border-slate-200 shadow-none">
                <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                  <TrendingUp size={48} className="opacity-20" />
                  <p className="font-bold text-lg">نحتاج عرضين على الأقل للمقارنة</p>
                  <p className="text-sm">لا يوجد عدد كافٍ من العروض لإجراء مقارنة بينها.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-none shadow-sm overflow-hidden bg-white">
                {/* Sorting Buttons */}
                <div className="p-4 border-b flex items-center gap-2 flex-wrap bg-slate-50/50">
                  <span className="text-xs font-bold text-slate-500 ml-2">فرز سريع:</span>
                  <Button 
                    variant={sortBy === "price" ? "default" : "outline"} 
                    size="sm" 
                    onClick={() => setSortBy("price")}
                    className="h-8 text-xs rounded-lg"
                  >
                    حسب السعر (الأقل أولاً)
                  </Button>
                  <Button 
                    variant={sortBy === "date" ? "default" : "outline"} 
                    size="sm" 
                    onClick={() => setSortBy("date")}
                    className="h-8 text-xs rounded-lg"
                  >
                    حسب التاريخ (الأحدث أولاً)
                  </Button>
                  <Button 
                    variant={sortBy === "duration" ? "default" : "outline"} 
                    size="sm" 
                    onClick={() => setSortBy("duration")}
                    className="h-8 text-xs rounded-lg"
                  >
                    حسب مدة التنفيذ (الأقل أولاً)
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-gradient-to-r from-slate-50 to-white border-b-2 border-slate-100">
                      <TableRow>
                        <TableHead className="text-right font-bold text-slate-700 whitespace-nowrap w-40">المعيار</TableHead>
                        {sortedOffers.map((o: any, i: number) => (
                          <TableHead key={o.id} className={`text-center min-w-[160px] ${o.price === lowestPrice ? 'bg-amber-50/50' : ''}`}>
                            <div className="flex flex-col items-center gap-1">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                <User size={16} className="text-primary" />
                              </div>
                              <span className="font-bold text-slate-800">{o.supplierName || `مورد ${i + 1}`}</span>
                              {o.price === lowestPrice && (
                                <div className="text-[10px] text-amber-600 font-bold">أفضل سعر ⭐</div>
                              )}
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">السعر المقترح</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className={`text-center font-bold ${o.price === lowestPrice ? 'text-success text-lg' : 'text-slate-800'}`}>
                            <div className="flex flex-col">
                              <span>{Number(o.price).toLocaleString('ar-SA')}</span>
                              <span className="text-xs text-muted-foreground">ر.س</span>
                            </div>
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">الموقع</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600">
                            <div className="flex items-center justify-center gap-1">
                              <MapPin size={12} className="text-muted-foreground" />
                              {o.deliveryLocation || "—"}
                            </div>
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">طريقة التسليم</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600">
                            {o.deliveryMethod ? (
                              <div className="flex items-center justify-center gap-1">
                                <Truck size={12} className="text-muted-foreground" />
                                {o.deliveryMethod}
                              </div>
                            ) : "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">وتيرة التسليم</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600">
                            {o.deliveryFrequency || "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">توصيل مجاني</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm">
                            {o.isFreeShipping ? (
                              <Badge className="bg-success/10 text-success border-success/20 text-xs">✓ نعم</Badge>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">يتضمن عينة</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm">
                            {o.includesSample ? (
                              <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">✓ نعم</Badge>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">مدة التنفيذ</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600">
                            {o.executionDuration ? `${o.executionDuration} ${o.executionDurationUnit || 'أيام'}` : "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">ملاحظات</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600 max-w-[150px]">
                            <p className="truncate">{o.notes || "—"}</p>
                          </TableCell>
                        ))}
                      </TableRow>
                      {rfq?.products && rfq.products.length > 0 && (
                        <TableRow className="hover:bg-slate-50/50">
                          <TableCell className="font-bold text-slate-700 bg-slate-50/50">عدد المنتجات</TableCell>
                          {sortedOffers.map((o: any) => (
                            <TableCell key={o.id} className="text-center text-sm text-slate-600">
                              <div className="flex items-center justify-center gap-1">
                                <Package size={12} className="text-muted-foreground" />
                                {rfq.products.length} منتج
                              </div>
                            </TableCell>
                          ))}
                        </TableRow>
                      )}
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">تاريخ التقديم</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600" suppressHydrationWarning>
                            <div className="flex items-center justify-center gap-1">
                              <Calendar size={12} className="text-muted-foreground" />
                              {o.createdAt ? new Date(o.createdAt).toLocaleDateString('ar-SA') : "—"}
                            </div>
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">القرار</TableCell>
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
                                قبول
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
            <InquiriesSection rfqId={rfqId} rfqTitle={rfq?.title || ""} />
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  )
}

function InquiriesSection({ rfqId, rfqTitle }: { rfqId: string; rfqTitle: string }) {
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
          repliedBy: user?.uid || ""
        }
      )
      
      // Create notification for the supplier
      if (inquiry?.userId) {
        const notificationData = {
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
      
      toast({ title: "تم الرد", description: "تم إرسال الرد بنجاح على الاستفسار" })
      setReplyText(prev => ({ ...prev, [inquiryId]: "" }))
      setShowReply(null)
    } catch (error) {
      toast({ title: "خطأ", description: "فشل إرسال الرد", variant: "destructive" })
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
          <p className="font-bold text-lg">لا توجد استفسارات حتى الآن</p>
          <p className="text-sm">الاستفسارات من الموردين ستظهر هنا</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="border-b bg-slate-50/50">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageSquare size={20} className="text-primary" />
          الاستفسارات والأسئلة ({inquiries.length})
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          جميع الاستفسارات مرئية للمقاولين والموردين
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
                    <span className="font-bold text-sm text-slate-700">{inq.supplierName || "مورد"}</span>
                    <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                      {new Date(inq.createdAt).toLocaleDateString('ar-SA')}
                    </span>
                  </div>
                  <p className="text-slate-600 text-sm leading-relaxed">{inq.question}</p>
                  
                  {inq.reply ? (
                    <div className="mt-3 p-3 bg-success/5 rounded-lg border border-success/20">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 size={14} className="text-success" />
                        <span className="text-xs font-bold text-success">ردك:</span>
                        <span className="text-xs text-success/70" suppressHydrationWarning>
                          {new Date(inq.repliedAt).toLocaleDateString('ar-SA')}
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
                            placeholder="اكتب ردك هنا... سيتمكن جميع الموردين من رؤية هذا الرد"
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
                              إرسال الرد
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setShowReply(null); setReplyText(prev => ({ ...prev, [inq.id]: "" })) }}
                            >
                              إلغاء
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
                          رد على الاستفسار
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
      واتسآب المورد
    </a>
  )
}
