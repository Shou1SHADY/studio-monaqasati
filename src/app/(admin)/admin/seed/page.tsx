
"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useFirestore, useUser } from "@/firebase"
import { doc, writeBatch, setDoc } from "firebase/firestore"
import { Loader2, Database, AlertTriangle, CheckCircle } from "lucide-react"
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
  const { firestore } = useFirestore()
  const { user, isUserLoading, userError } = useUser()
  const { toast } = useToast()

  // تتبع حالة الاتصال في وحدة التحكم للمساعدة في التصحيح
  useEffect(() => {
    if (!isUserLoading) {
      console.log("Firebase Auth State:", { user: user?.uid, error: userError });
    }
  }, [user, isUserLoading, userError]);

  const handleSeed = async () => {
    if (!firestore || !user) {
      toast({
        title: "خطأ في الاتصال",
        description: "لا يوجد مستخدم نشط. يرجى التأكد من تفعيل Anonymous Auth في Firebase Console.",
        variant: "destructive"
      })
      return
    }

    setIsSeeding(true)
    try {
      console.log("Starting seed process for user:", user.uid);

      // 1. الترقية إلى Admin أولاً (عملية منفصلة لضمان تحديث القواعد)
      const userRef = doc(firestore, "users", user.uid)
      await setDoc(userRef, {
        id: user.uid,
        role: "Admin",
        name: "مدير النظام التجريبي",
        email: user.email || `guest_${user.uid.slice(0, 5)}@munaqasati.sa`,
        phoneNumber: "0500000000",
        city: "الرياض",
        joinedAt: new Date().toISOString(),
        isVerified: true
      }, { merge: true })

      console.log("User promoted to Admin successfully.");

      // 2. إنشاء البيانات الأخرى في دفعة واحدة (Batch)
      const batch = writeBatch(firestore)

      SAMPLE_CATEGORIES.forEach((cat) => {
        const catRef = doc(firestore, "categories", cat.id)
        batch.set(catRef, cat)
      })

      const mockRfqs = [
        { id: "rfq-seed-1", title: "توريد حديد سابك - مشروع النرجس", cat: "حديد ومعادن", qty: 100, unit: "طن" },
        { id: "rfq-seed-2", title: "خرسانة جاهزة K350", cat: "أسمنت وخرسانة", qty: 50, unit: "م3" },
        { id: "rfq-seed-3", title: "أنابيب سباكة PPR", cat: "أدوات صحية", qty: 200, unit: "متر" }
      ]

      mockRfqs.forEach((rfq) => {
        const rfqRef = doc(firestore, "rfqs", rfq.id)
        batch.set(rfqRef, {
          id: rfq.id,
          contractorId: user.uid,
          title: rfq.title,
          categoryId: rfq.cat,
          quantity: rfq.qty,
          unitOfMeasure: rfq.unit,
          deadline: new Date(Date.now() + 604800000).toISOString(),
          location: "الرياض",
          area: "حي الملقا",
          paymentTerms: "كاش",
          isQualityCertificateRequired: true,
          status: "New",
          createdAt: new Date().toISOString()
        })
      })

      await batch.commit()
      console.log("Categories and RFQs seeded successfully.");

      toast({
        title: "تمت التهيئة بنجاح!",
        description: "أنت الآن Admin وتم إنشاء البيانات التجريبية.",
      })
    } catch (error: any) {
      console.error("Critical Seed Error:", error)
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
        <Card className="border-2 border-primary/10 shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 text-primary">
              <Database size={32} />
            </div>
            <CardTitle className="text-2xl font-bold">تهيئة قاعدة البيانات</CardTitle>
            <CardDescription>
              هذه الأداة ستقوم بتفعيل حسابك كمسؤول وإنشاء بيانات تجريبية فوراً.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isUserLoading ? (
              <div className="flex items-center justify-center p-8 gap-3 text-muted-foreground bg-slate-50 rounded-lg">
                <Loader2 className="animate-spin" />
                <span>جاري الاتصال بـ Firebase...</span>
              </div>
            ) : user ? (
              <div className="p-4 bg-success/5 border border-success/20 rounded-lg flex items-center gap-3">
                <CheckCircle className="text-success" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-success font-bold">متصل بنجاح</p>
                  <p className="text-[10px] text-success/70 font-mono">UID: {user.uid}</p>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg space-y-2">
                <div className="flex items-center gap-3 text-destructive">
                  <AlertTriangle size={20} />
                  <p className="text-sm font-bold">خطأ في الجلسة</p>
                </div>
                <p className="text-xs text-muted-foreground pr-8">
                  لم يتم اكتشاف مستخدم. يرجى تفعيل <strong>Anonymous Authentication</strong> في لوحة تحكم Firebase ثم تحديث الصفحة.
                </p>
              </div>
            )}
          </CardContent>
          <CardContent className="flex justify-center pb-8">
            <Button 
              size="lg" 
              onClick={handleSeed} 
              disabled={isSeeding || isUserLoading || !user}
              className="px-12 py-6 text-lg font-bold gap-2 shadow-lg"
            >
              {isSeeding ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  جاري التهيئة...
                </>
              ) : (
                <>
                  <Database size={20} />
                  ابدأ التهيئة الآن
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
