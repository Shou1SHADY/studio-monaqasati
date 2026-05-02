"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { 
  Search, 
  MapPin, 
  Calendar, 
  ChevronLeft, 
  Filter,
  Loader2,
  Plus,
  Trash2,
  Truck
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { collection, query, where, orderBy } from "firebase/firestore"
import { useRouter, useSearchParams } from "next/navigation"

interface DeliveryBatch {
  id: string
  quantity: string
  deliveryDate: string
  price: string
}

export default function AvailableRfqsPage() {
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "")
  const [selectedRfq, setSelectedRfq] = useState<{id: string, title: string, quantity?: string, unitOfMeasure?: string} | null>(null)
  const [offerPrice, setOfferPrice] = useState("")
  const [deliveryLocation, setDeliveryLocation] = useState("")
  const [deliveryMethod, setDeliveryMethod] = useState("")
  const [deliveryFrequency, setDeliveryFrequency] = useState("")
  const [deliveryBatches, setDeliveryBatches] = useState<DeliveryBatch[]>([
    { id: "1", quantity: "", deliveryDate: "", price: "" }
  ])
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  useEffect(() => {
    setSearchQuery(searchParams.get("search") || "")
  }, [searchParams])

  // ✅ تطبيق نمط الحماية: العودة بـ null طالما أن حالة المستخدم لم تكتمل
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    
    return query(
      collection(firestore, "rfqs"),
      where("status", "==", "New"),
      orderBy("createdAt", "desc")
    )
  }, [firestore, user, isUserLoading])

  const { data: rfqs, isLoading: isCollectionLoading } = useCollection(rfqsQuery)
  const isLoading = isUserLoading || isCollectionLoading

  const filteredRfqs = rfqs?.filter((rfq: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      rfq.title?.toLowerCase().includes(q) ||
      rfq.category?.toLowerCase().includes(q) ||
      rfq.subCategory?.toLowerCase().includes(q) ||
      rfq.city?.toLowerCase().includes(q) ||
      rfq.district?.toLowerCase().includes(q)
    );
  }) || [];

  const resetForm = () => {
    setOfferPrice("")
    setDeliveryLocation("")
    setDeliveryMethod("")
    setDeliveryFrequency("")
    setDeliveryBatches([{ id: "1", quantity: "", deliveryDate: "", price: "" }])
  }

  const addBatch = () => {
    setDeliveryBatches([...deliveryBatches, { id: Date.now().toString(), quantity: "", deliveryDate: "", price: "" }])
  }

  const removeBatch = (id: string) => {
    if (deliveryBatches.length > 1) {
      setDeliveryBatches(deliveryBatches.filter(b => b.id !== id))
    }
  }

  const updateBatch = (id: string, field: keyof DeliveryBatch, value: string) => {
    setDeliveryBatches(deliveryBatches.map(b => b.id === id ? { ...b, [field]: value } : b))
  }

  const submitOffer = async () => {
    if (!user || !firestore) {
      toast({ title: "خطأ", description: "يجب تسجيل الدخول أولاً", variant: "destructive" });
      return;
    }

    if (!selectedRfq || !offerPrice || !deliveryLocation || !deliveryMethod) {
      toast({ title: "بيانات ناقصة", description: "يرجى填写 جميع الحقول المطلوبة", variant: "destructive" });
      return;
    }

    const validBatches = deliveryBatches.filter(b => b.quantity && b.deliveryDate && b.price)
    if (validBatches.length === 0) {
      toast({ title: "بيانات ناقصة", description: "يرجى إضافة دفعة تسليم واحدة على الأقل", variant: "destructive" });
      return;
    }

    try {
      const { addDoc } = await import("firebase/firestore");
      
      const totalBatchesPrice = validBatches.reduce((sum, b) => sum + (parseFloat(b.price) || 0), 0)

      await addDoc(collection(firestore, "offers"), {
        supplierId: user.uid,
        rfqId: selectedRfq.id,
        rfqTitle: selectedRfq.title,
        price: offerPrice,
        deliveryLocation: deliveryLocation,
        deliveryMethod: deliveryMethod,
        deliveryFrequency: deliveryFrequency,
        deliveryBatches: validBatches.map(b => ({
          quantity: b.quantity,
          deliveryDate: b.deliveryDate,
          price: b.price
        })),
        totalBatchesPrice: totalBatchesPrice,
        status: "قيد المراجعة",
        createdAt: new Date().toISOString()
      });

      toast({
        title: "تم تقديم العرض بنجاح!",
        description: `تم إرسال عرضك بنجاح بمبلغ ${offerPrice} ر.س.`,
      })
      setSelectedRfq(null);
      resetForm();
      setTimeout(() => {
        router.push("/supplier/offers")
      }, 1000)
    } catch (error) {
      console.error(error);
      toast({
        title: "خطأ",
        description: "حدث خطأ أثناء تقديم العرض",
        variant: "destructive"
      })
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
            <Button variant="outline" className="gap-2">
              <Filter size={18} />
              تصفية التخصصات
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {isLoading ? (
            <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="animate-spin" size={40} />
              <p>جاري تحميل المناقصات المتاحة...</p>
            </div>
          ) : filteredRfqs.length === 0 ? (
            <div className="p-20 text-center text-muted-foreground bg-white rounded-lg shadow-sm border border-dashed">
              لا توجد مناقصات مطابقة لبحثك.
            </div>
          ) : (
            filteredRfqs.map((rfq: any) => (
              <Card key={rfq.id} className="hover:shadow-md transition-all border-slate-100 overflow-hidden group">
                <CardContent className="p-0">
                  <div className="flex flex-col md:flex-row">
                    <div className="p-6 flex-1 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="bg-primary/5 text-primary border-none">
                          {rfq.category}
                        </Badge>
                        {rfq.subCategory && (
                          <Badge variant="outline" className="text-muted-foreground border-slate-200">
                            {rfq.subCategory}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground font-mono mr-auto">{rfq.id.substring(0, 8)}</span>
                      </div>
                      
                      <div className="space-y-1">
                        <h3 className="text-xl font-bold text-slate-800 group-hover:text-primary transition-colors">
                          {rfq.title}
                        </h3>
                        <p className="text-sm text-muted-foreground">الكمية: {rfq.quantity} {rfq.unitOfMeasure}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-6 pt-2">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <MapPin size={16} className="text-primary" />
                          {rfq.city} - {rfq.district}
                          {rfq.locationCoords && (
                            <a 
                              href={`https://www.google.com/maps/search/?api=1&query=${rfq.locationCoords.lat},${rfq.locationCoords.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary underline mr-2 hover:text-primary/70 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              عرض الخريطة
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-600" suppressHydrationWarning>
                          <Calendar size={16} className="text-muted-foreground" />
                          الموعد النهائي: {rfq.deadline ? new Date(rfq.deadline).toLocaleDateString('ar-SA') : 'غير محدد'}
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-slate-50/50 p-6 flex items-center justify-center md:border-r border-t md:border-t-0 min-w-[200px]">
                      <Button 
                        onClick={() => setSelectedRfq({
                          id: rfq.id, 
                          title: rfq.title,
                          quantity: rfq.quantity,
                          unitOfMeasure: rfq.unitOfMeasure
                        })}
                        className="w-full md:w-auto gap-2 bg-primary hover:bg-primary/90 rounded-full h-11 px-8 shadow-sm"
                      >
                        تقديم عرض سعر
                        <ChevronLeft size={18} />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <Dialog open={!!selectedRfq} onOpenChange={(open) => { if (!open) { setSelectedRfq(null); resetForm() } }}>
        <DialogContent className="sm:max-w-[600px] text-right max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>تقديم عرض سعر</DialogTitle>
            <DialogDescription className="mt-2">
              أدخل التفاصيل الكاملة لعرضك على: <span className="font-bold text-slate-800">{selectedRfq?.title}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-4">
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-primary flex items-center gap-2">
                <Truck size={16} />
                معلومات التسليم
              </h3>
              
              <div className="grid gap-3">
                <div className="flex flex-col sm:grid sm:grid-cols-4 items-start sm:items-center gap-2">
                  <Label htmlFor="deliveryLocation" className="text-right sm:col-span-1 font-medium">
                    موقع التسليم <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="deliveryLocation"
                    value={deliveryLocation}
                    onChange={(e) => setDeliveryLocation(e.target.value)}
                    className="sm:col-span-3 w-full"
                    placeholder="مثال: الرياض - حي النرجس"
                  />
                </div>

                <div className="flex flex-col sm:grid sm:grid-cols-4 items-start sm:items-center gap-2">
                  <Label htmlFor="deliveryMethod" className="text-right sm:col-span-1 font-medium">
                    طريقة التسليم <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="deliveryMethod"
                    value={deliveryMethod}
                    onChange={(e) => setDeliveryMethod(e.target.value)}
                    className="sm:col-span-3 w-full"
                    placeholder="مثال: شاحنات متخصصة / تسليم يدوي"
                  />
                </div>

                <div className="flex flex-col sm:grid sm:grid-cols-4 items-start sm:items-center gap-2">
                  <Label htmlFor="deliveryFrequency" className="text-right sm:col-span-1 font-medium">
                    وتيرة التسليم
                  </Label>
                  <Input
                    id="deliveryFrequency"
                    value={deliveryFrequency}
                    onChange={(e) => setDeliveryFrequency(e.target.value)}
                    className="sm:col-span-3 w-full"
                    placeholder="مثال: أسبوعية / شهرية / دفعة واحدة"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-bold text-sm text-primary flex items-center gap-2">
                <Calendar size={16} />
                جدول الشحنات والتسعير
              </h3>
              
              <div className="space-y-3">
                {deliveryBatches.map((batch, index) => (
                  <div key={batch.id} className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-600">الشحنة {index + 1}</span>
                      {deliveryBatches.length > 1 && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => removeBatch(batch.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs font-medium text-slate-600">
                          الكمية <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          type="number"
                          value={batch.quantity}
                          onChange={(e) => updateBatch(batch.id, "quantity", e.target.value)}
                          placeholder={selectedRfq?.unitOfMeasure ? `مثال: 50 ${selectedRfq.unitOfMeasure}` : "الكمية"}
                        />
                      </div>
                      
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs font-medium text-slate-600">
                          تاريخ التسليم <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          type="date"
                          value={batch.deliveryDate}
                          onChange={(e) => updateBatch(batch.id, "deliveryDate", e.target.value)}
                        />
                      </div>
                      
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs font-medium text-slate-600">
                          السعر (ر.س) <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          type="number"
                          value={batch.price}
                          onChange={(e) => updateBatch(batch.id, "price", e.target.value)}
                          placeholder="سعر الشحنة"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={addBatch}
              >
                <Plus size={16} />
                إضافة شحنة أخرى
              </Button>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <h3 className="font-bold text-sm text-primary">السعر الإجمالي</h3>
              <div className="flex flex-col sm:grid sm:grid-cols-4 items-start sm:items-center gap-2">
                <Label htmlFor="price" className="text-right sm:col-span-1 font-bold">
                  السعر الكلي (ر.س) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="price"
                  type="number"
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                  className="sm:col-span-3 w-full"
                  placeholder="مثال: 50000"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
            <Button variant="outline" onClick={() => { setSelectedRfq(null); resetForm() }}>إلغاء</Button>
            <Button 
              onClick={submitOffer} 
              disabled={!offerPrice || !deliveryLocation || !deliveryMethod}
            >
              تأكيد وإرسال العرض
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  )
}