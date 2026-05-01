
"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useFirestore, useUser } from "@/firebase"
import { doc, writeBatch, setDoc, getDoc } from "firebase/firestore"
import { Loader2, Database, AlertTriangle, CheckCircle, RefreshCcw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

const SAMPLE_CATEGORIES = [
  { id: "cat-1", name: "حديد ومعادن", description: "جميع أنواع حديد التسليح والصلب" },
  { id: "cat-2", name: "أسمنت وخرسانة", description: "الأسمنت البورتلاندي والخرسانة الجاهزة" },
  { id: "cat-3", name: "دهانات", description: "الدهانات الداخلية والخارجية ومواد العزل" },
  { id: "cat-4", name: "أدوات صحية", description: "مستلزمات السباكة والأدوات الصحية" },
  { id: "cat-5", name: "كهرباء وإنارة", description: "الكابلات والمفاتيح وأنظمة الإنارة" }
]

export default function SeedPage() {
  const [isSeeding, setIsSeeding] = useState(false)
  const [status, setStatus] = useState<"idle" | "promoting" | "seeding" | "success" | "error">("idle")
  const { firestore } = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

  const handleSeed = async () => {
    if (!firestore || !user) {
      toast({
        title: "خطأ في الاتصال",
        description: "لا يوجد مستخدم نشط. يرجى التأكد من تفعيل Anonymous Auth.",
        variant: "destructive"
      })
      return
    }

    setIsSeeding(true)
    setStatus("promoting")
    
    try {
      console.log("Step 1: Promoting user to Admin...");
      const userRef = doc(firestore, "users", user.uid)
      
      // نستخدم setDoc مع merge لضمان إنشاء الملف الشخصي برتبة Admin
      await setDoc(userRef, {
        id: user.uid,
        role: "Admin",
        name: "مدير النظام التجريبي",
        email: user.email || `admin_${user.uid.slice(0, 5)}@munaqasati.sa`,
        phoneNumber: "0500000000",
        city: "الرياض",
        joinedAt: new Date().toISOString(),
        isVerified: true
      }, { merge: true })

      // ننتظر قليلاً لضمان تحديث القواعد في طرف Firebase
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      console.log("Step 2: Seeding Categories and RFQs...");
      setStatus("seeding")
      
      const batch = writeBatch(firestore)

      // إضافة الفئات
      SAMPLE_CATEGORIES.forEach((cat) => {
        const catRef = doc(firestore, "categories", cat.id)
        batch.set(catRef, cat)
      })

      // إضافة مناقصات تجريبية مرتبطة بالفئات أعلاه
      const mockRfqs = [
        { id: "rfq-seed-1", title: "توريد حديد سابك - مشروع النرجس", catId: "cat-1", qty: 100, unit: "طن" },
        { id: "rfq-seed-2", title: "خرسانة جاهزة K350", catId: "cat-2", qty: 50, unit: "م3" },
        { id: "rfq-seed-3", title: "أنابيب سباكة PPR", catId: "cat-4", qty: 200, unit: "متر" },
        { id: "rfq-seed-4", title: "دهانات داخلية - فندق الرياض", catId: "cat-3", qty: 500, unit: "جالون" },
        { id: "rfq-seed-5", title: "كابلات كهربائية 10 ملم", catId: "cat-5", qty: 1000, unit: "متر" }
      ]

      mockRfqs.forEach((rfq) => {
        const rfqRef = doc(firestore, "rfqs", rfq.id)
        batch.set(rfqRef, {
          id: rfq.id,
          contractorId: user.uid,
          title: rfq.title,
          categoryId: rfq.catId, // الآن نستخدم الـ ID الصحيح للفئة
          quantity: rfq.qty,
          unitOfMeasure: rfq.unit,
          deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
          location: "الرياض",
          area: "حي الملقا",
          paymentTerms: "كاش",
          isQualityCertificateRequired: true,
          status: "New",
          createdAt: new Date().toISOString()
        })
      })

      await batch.commit()
      
      setStatus("success")
      toast({
        title: "تمت التهيئة بنجاح!",
        description: "أنت الآن Admin والبيانات التجريبية جاهزة للاستخدام.",
      })
    } catch (error: any) {
      console.error("Critical Seed Error:", error)
      setStatus("error")
      toast({
        title: "فشل في إنشاء البيانات",
        description: error.message || "تأكد من إعدادات الـ Firestore وقواعد الأمان.",
        variant: "destructive"
      })
    } finally {
      setIsSeeding(false)
    }
  }

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto py-12 text-right">
        <Card className="border-2 border-primary/10 shadow-xl overflow-hidden">
          <div className="h-2 bg-slate-100 w-full">
            <div 
              className="h-full bg-primary transition-all duration-500" 
              style={{ width: status === 'idle' ? '0%' : status === 'promoting' ? '40%' : status === 'seeding' ? '80%' : '100%' }}
            />
          </div>
          <CardHeader className="text-center pt-10">
            <div className={`mx-auto w-20 h-20 rounded-2xl flex items-center justify-center mb-6 transition-colors ${
              status === 'success' ? 'bg-success/10 text-success' : 
              status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
            }`}>
              {status === 'success' ? <CheckCircle size={40} /> : 
               status === 'error' ? <AlertTriangle size={40} /> : <Database size={40} />}
            </div>
            <CardTitle className="text-3xl font-bold">تهيئة الميدان</CardTitle>
            <CardDescription className="text-base mt-2">
              هذا الإجراء سيقوم بتفعيل صلاحياتك الإدارية وتوليد بيانات حقيقية لتجربة المنصة.
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6 px-10">
            <div className="space-y-4">
              <div className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${user ? 'bg-success/5 border-success/20' : 'bg-slate-50 border-slate-200'}`}>
                {isUserLoading ? <Loader2 className="animate-spin text-slate-400" size={20} /> : 
                 user ? <CheckCircle className="text-success" size={20} /> : <AlertTriangle className="text-amber-500" size={20} />}
                <div className="flex-1">
                  <p className="text-sm font-bold">{user ? "تم اكتشاف جلسة المستخدم" : "بانتظار تسجيل الدخول..."}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{user?.uid || "Anonymous Authentication required"}</p>
                </div>
              </div>

              {status !== 'idle' && (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span>حالة العملية:</span>
                    <span className="text-primary">
                      {status === 'promoting' && "جاري منح صلاحيات Admin..."}
                      {status === 'seeding' && "جاري إنشاء الفئات والمناقصات..."}
                      {status === 'success' && "اكتملت العملية بنجاح!"}
                      {status === 'error' && "حدث خطأ أثناء التنفيذ"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>

          <CardContent className="flex flex-col items-center pb-12 gap-4">
            <Button 
              size="lg" 
              onClick={handleSeed} 
              disabled={isSeeding || isUserLoading || !user}
              className="px-16 py-8 text-xl font-bold gap-3 shadow-xl hover:scale-105 transition-transform"
            >
              {isSeeding ? <Loader2 className="animate-spin" size={24} /> : <RefreshCcw size={24} />}
              {status === 'success' ? "إعادة التهيئة" : "ابدأ التشغيل الآن"}
            </Button>
            
            {status === 'error' && (
              <p className="text-xs text-destructive font-medium">تأكد من تفعيل "Anonymous Auth" و "Firestore Test Mode" في Console.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
