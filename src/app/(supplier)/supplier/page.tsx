"use client"

import { useState } from "react"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { 
  Package, 
  Handshake, 
  Send, 
  DollarSign, 
  Search,
  ChevronLeft,
  Calendar
} from "lucide-react"
import Link from "next/link"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, addDoc } from "firebase/firestore"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"

export default function SupplierDashboard() {
  const router = useRouter()
  const { toast } = useToast()
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();
  const [selectedRfq, setSelectedRfq] = useState<{id: string, title: string} | null>(null)
  const [offerPrice, setOfferPrice] = useState("")

  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"), where("status", "==", "New"))
  }, [firestore, user, isUserLoading])

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "offers"), where("supplierId", "==", user.uid))
  }, [firestore, user, isUserLoading])

  const { data: rfqs } = useCollection(rfqsQuery)
  const { data: offers } = useCollection(offersQuery)
  
  const pendingCount = offers?.filter((o: any) => o.status === "قيد المراجعة" || o.status === "New").length || 0
  const acceptedCount = offers?.filter((o: any) => o.status === "مقبول" || o.status === "Accepted").length || 0
  const totalValue = offers?.filter((o: any) => o.status === "مقبول" || o.status === "Accepted")
    .reduce((sum: number, o: any) => sum + (parseFloat(o.price?.replace(/,/g, '')) || 0), 0) || 0

  const activeRfqsCount = rfqs?.length || 0

  const stats = [
    { title: "الطلبات النشطة", value: activeRfqsCount.toString(), icon: Package, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "عروض قيد الانتظار", value: pendingCount.toString(), icon: Send, color: "text-amber-600", bg: "bg-amber-50" },
    { title: "عروض تم قبولها", value: acceptedCount.toString(), icon: Handshake, color: "text-success", bg: "bg-success/10" },
    { title: "إجمالي العقود", value: totalValue > 1000 ? `${(totalValue/1000).toFixed(1)}k` : totalValue.toString(), icon: DollarSign, color: "text-success", bg: "bg-success/10" },
  ]

  const recommendedRfqs = rfqs?.slice(0, 3) || []

  const submitOffer = async () => {
    if (!user || !firestore) {
      toast({ title: "خطأ", description: "يجب تسجيل الدخول أولاً", variant: "destructive" });
      return;
    }

    if (!selectedRfq || !offerPrice) return;

    try {
      await addDoc(collection(firestore, "offers"), {
        supplierId: user.uid,
        rfqId: selectedRfq.id,
        rfqTitle: selectedRfq.title,
        price: offerPrice,
        status: "قيد المراجعة",
        createdAt: new Date().toISOString()
      });

      toast({
        title: "تم تقديم العرض بنجاح!",
        description: `تم إرسال عرضك بنجاح بمبلغ ${offerPrice} ر.س.`,
      })
      setSelectedRfq(null);
      setOfferPrice("");
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
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">أهلاً بك، المورد المتكامل</h1>
          <p className="text-muted-foreground mt-1">إليك ملخص لنشاطك التجاري اليوم</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat) => (
            <Card key={stat.title} className="border-none shadow-sm group hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={cn("p-3 rounded-xl", stat.bg)}>
                    <stat.icon className={cn("h-6 w-6", stat.color)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                  <p className="text-2xl font-bold text-slate-800">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recommended RFQs */}
          <Card className="lg:col-span-2 shadow-sm border-slate-100 overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b bg-slate-50/50 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                  <Search size={20} />
                </div>
                <div>
                  <CardTitle className="text-lg font-bold">مناقصات مقترحة لك</CardTitle>
                  <p className="text-xs text-muted-foreground">بناءً على تخصصاتك ومناطق الخدمة</p>
                </div>
              </div>
              <Link href="/supplier/rfqs">
                <Button variant="outline" size="sm">تصفح الكل</Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {recommendedRfqs.length > 0 ? recommendedRfqs.map((rfq: any) => (
                  <div key={rfq.id} className="p-6 hover:bg-slate-50 transition-colors">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-3">
                        <h3 className="font-bold text-lg text-slate-800">{rfq.title}</h3>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary" className="bg-blue-50 text-blue-600 border-none px-3">{rfq.categoryId || rfq.category}</Badge>
                          <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none px-3">{rfq.area}</Badge>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-3 shrink-0">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground" suppressHydrationWarning>
                          <Calendar size={16} />
                          <span>الموعد النهائي: {rfq.deadline ? new Date(rfq.deadline).toLocaleDateString('ar-SA') : "-"}</span>
                        </div>
                        <Button 
                          onClick={() => setSelectedRfq({id: rfq.id, title: rfq.title})}
                          className="w-full md:w-auto bg-primary hover:bg-primary/90 rounded-full h-9 px-6 text-sm"
                        >
                          تقديم عرض سعر
                        </Button>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="p-10 text-center text-muted-foreground">لا توجد مناقصات مقترحة حالياً.</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Profile Completion / Specializations */}
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-bold">تخصصاتك المسجلة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap gap-2">
                {['حديد ومعادن', 'أسمنت وخرسانة', 'خرسانة جاهزة'].map((spec) => (
                  <Badge key={spec} className="bg-success/10 text-success border-success/20 hover:bg-success/20 px-3 py-1">
                    {spec}
                  </Badge>
                ))}
              </div>
              <div className="h-px bg-slate-100" />
              <div className="space-y-3">
                <p className="text-sm font-bold text-slate-700">مناطق التغطية:</p>
                <div className="flex flex-wrap gap-2">
                  {['الرياض', 'المنطقة الشرقية', 'جدة'].map((area) => (
                    <span key={area} className="text-xs text-muted-foreground bg-slate-100 px-2 py-1 rounded">
                      {area}
                    </span>
                  ))}
                </div>
              </div>
              <Link href="/supplier/profile" className="block pt-4">
                <Button variant="ghost" className="w-full text-primary font-bold hover:bg-primary/5">
                  تعديل الملف الشخصي
                  <ChevronLeft className="mr-1 h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!selectedRfq} onOpenChange={(open) => !open && setSelectedRfq(null)}>
        <DialogContent className="sm:max-w-[425px] text-right" dir="rtl">
          <DialogHeader>
            <DialogTitle>تقديم عرض سعر</DialogTitle>
            <DialogDescription className="mt-2">
              أدخل السعر المقترح لمناقصة: <span className="font-bold text-slate-800">{selectedRfq?.title}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col sm:grid sm:grid-cols-4 items-start sm:items-center gap-2 sm:gap-4">
              <Label htmlFor="price-dashboard" className="text-right sm:col-span-1 font-bold">
                السعر (ر.س)
              </Label>
              <Input
                id="price-dashboard"
                type="number"
                value={offerPrice}
                onChange={(e) => setOfferPrice(e.target.value)}
                className="sm:col-span-3 w-full"
                placeholder="مثال: 50000"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
            <Button variant="outline" onClick={() => setSelectedRfq(null)}>إلغاء</Button>
            <Button onClick={submitOffer} disabled={!offerPrice}>تأكيد وإرسال</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  )
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ")
}
