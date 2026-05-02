"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  Package
} from "lucide-react"
import { useCollection, useDoc, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy, doc, updateDoc, setDoc, getDoc } from "firebase/firestore"
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

  const handleDecision = async (offerId: string, decision: "مقبول" | "مرفوض") => {
    if (!firestore || !user) return
    setProcessingId(offerId)

    const offer = offers?.find((o: any) => o.id === offerId)

    // Step 1: Update offer status
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        status: decision,
        decidedAt: new Date().toISOString()
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
      title: decision === "مقبول" ? "✅ تم قبول العرض!" : "❌ تم رفض العرض",
      description: decision === "مقبول"
        ? "سيتم إشعار المورد. يمكنك التواصل معه من صفحة محادثاتي."
        : "تم رفض العرض وسيتم إشعار المورد.",
    })
    setProcessingId(null)
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "مقبول": return <Badge className="bg-success/10 text-success border-success/20">مقبول ✅</Badge>
      case "مرفوض": return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none">مرفوض ❌</Badge>
      default: return <Badge className="bg-amber-50 text-amber-600 border-amber-100">قيد المراجعة 🕐</Badge>
    }
  }

  const sortedOffers = offers ? [...offers].sort((a: any, b: any) => a.price - b.price) : []
  const bestOffer = sortedOffers.length > 0 ? sortedOffers[0] : null

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
                    <div className="flex items-center gap-2">
                      <Tag size={16} className="text-muted-foreground" />
                      الكمية: {rfq.quantity} {rfq.unitOfMeasure}
                    </div>
                  </div>
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
            offers.map((offer: any) => (
              <Card key={offer.id} className={`border-none shadow-sm hover:shadow-md transition-all overflow-hidden ${
                offer.status === "مقبول" ? "ring-1 ring-success/30 bg-success/5" : 
                offer.status === "مرفوض" ? "opacity-60" : "bg-white"
              }`}>
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
                            <p className="font-bold text-sm text-slate-800">مورد مسجل</p>
                            <p className="text-xs text-muted-foreground font-mono">{offer.supplierId?.substring(0, 10)}...</p>
                          </div>
                        </div>
                        {getStatusBadge(offer.status || "قيد المراجعة")}
                      </div>

                      <div className="flex flex-wrap gap-4 text-sm">
                        <div className="flex items-center gap-2 bg-primary/5 px-4 py-2 rounded-lg">
                          <span className="text-muted-foreground">السعر المقترح:</span>
                          <span className="font-bold text-xl text-primary">{offer.price} <span className="text-sm font-normal">ر.س</span></span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground" suppressHydrationWarning>
                          <Calendar size={14} />
                          <span>{offer.createdAt ? new Date(offer.createdAt).toLocaleDateString('ar-SA') : "-"}</span>
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
                      <div className="bg-slate-50/70 p-6 flex flex-row md:flex-col items-center justify-center gap-3 md:border-r border-t md:border-t-0 min-w-[180px]">
                        <Button
                          onClick={() => handleDecision(offer.id, "مقبول")}
                          disabled={processingId === offer.id}
                          className="w-full bg-success hover:bg-success/90 gap-2 rounded-full"
                          size="sm"
                        >
                          {processingId === offer.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                          قبول العرض
                        </Button>
                        <Button
                          onClick={() => handleDecision(offer.id, "مرفوض")}
                          disabled={processingId === offer.id}
                          variant="outline"
                          className="w-full gap-2 rounded-full text-destructive border-destructive/30 hover:bg-destructive/5"
                          size="sm"
                        >
                          <XCircle size={14} />
                          رفض
                        </Button>
                      </div>
                    )}

                    {/* Chat Button - Accepted */}
                    {offer.status === "مقبول" && (
                      <div className="bg-success/5 p-6 flex items-center justify-center md:border-r border-t md:border-t-0 min-w-[180px]">
                        <Button
                          onClick={() => openChat(offer)}
                          disabled={openingChat === offer.id}
                          className="w-full bg-primary hover:bg-primary/90 gap-2 rounded-full"
                          size="sm"
                        >
                          {openingChat === offer.id ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                          فتح المحادثة
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
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
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="text-right whitespace-nowrap w-32">المعيار</TableHead>
                        {sortedOffers.map((o: any, i: number) => (
                          <TableHead key={o.id} className={`text-center min-w-[140px] ${o.id === bestOffer?.id ? 'bg-amber-50/50' : ''}`}>
                            مورد {i + 1}
                            {o.id === bestOffer?.id && (
                              <div className="text-[10px] text-amber-600 font-bold mt-1">أفضل سعر ⭐</div>
                            )}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-bold text-slate-600 bg-slate-50/50">السعر / الوحدة</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className={`text-center font-bold ${o.id === bestOffer?.id ? 'text-success' : 'text-slate-800'}`}>
                            {o.price} ر.س
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-bold text-slate-600 bg-slate-50/50">السعر الإجمالي</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className={`text-center text-sm ${o.id === bestOffer?.id ? 'text-success/80 font-bold' : 'text-slate-600'}`}>
                            {rfq?.quantity ? (o.price * rfq.quantity).toLocaleString('en-US') : '-'} ر.س
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-bold text-slate-600 bg-slate-50/50">التسليم</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600">
                            {o.deliveryTime || 3} أيام
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-bold text-slate-600 bg-slate-50/50">شهادة الجودة</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600">
                            {o.qualityCert ? <span className="text-success">✓</span> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-bold text-slate-600 bg-slate-50/50">ملاحظات</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-xs text-slate-500 max-w-[150px] truncate">
                            {o.note || "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-bold text-slate-600 bg-slate-50/50">القرار</TableCell>
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
        </Tabs>
      </div>
    </PortalLayout>
  )
}
