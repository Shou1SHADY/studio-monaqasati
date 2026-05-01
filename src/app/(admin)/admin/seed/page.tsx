
"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useFirestore, useUser } from "@/firebase"
import { doc, setDoc, collection, writeBatch } from "firebase/firestore"
import { Loader2, Database, CheckCircle2, AlertTriangle } from "lucide-react"
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
  const { user } = useUser()
  const { toast } = useToast()

  const handleSeed = async () => {
    if (!firestore || !user) {
      toast({
        title: "خطأ",
        description: "يجب تسجيل الدخول أولاً للتمكن من تهيئة البيانات.",
        variant: "destructive"
      })
      return
    }

    setIsSeeding(true)
    try {
      const batch = writeBatch(firestore)

      // 1. First, make current user an Admin so they can manage categories
      const userRef = doc(firestore, "users", user.uid)
      batch.set(userRef, {
        id: user.uid,
        role: "Admin",
        name: "مدير النظام (أنت)",
        email: user.email || "admin@munaqasati.sa",
        phoneNumber: "0500000000",
        city: "الرياض",
        joinedAt: new Date().toISOString()
      }, { merge: true })

      // 2. Seed Categories
      SAMPLE_CATEGORIES.forEach((cat) => {
        const catRef = doc(firestore, "categories", cat.id)
        batch.set(catRef, cat)
      })

      // 3. Seed some mock RFQs
      const rfqIds = ["rfq-mock-1", "rfq-mock-2"]
      rfqIds.forEach((id, index) => {
        const rfqRef = doc(firestore, "rfqs", id)
        batch.set(rfqRef, {
          id: id,
          contractorId: user.uid,
          title: index === 0 ? "توريد حديد سابك - مشروع النرجس" : "خرسانة جاهزة K350",
          categoryId: index === 0 ? "حديد ومعادن" : "أسمنت وخرسانة",
          quantity: index === 0 ? 50 : 200,
          unitOfMeasure: index === 0 ? "طن" : "م3",
          deadline: new Date(Date.now() + 86400000 * 7).toISOString(),
          location: "الرياض",
          area: "حي الملقا",
          paymentTerms: "كاش",
          isQualityCertificateRequired: true,
          status: "New",
          createdAt: new Date().toISOString()
        })
      })

      await batch.commit()

      toast({
        title: "تمت التهيئة!",
        description: "تم تحديث صلاحياتك كمسؤول وإنشاء الفئات والمناقصات التجريبية بنجاح.",
      })
    } catch (error: any) {
      console.error(error)
      toast({
        title: "فشل التهيئة",
        description: error.message || "حدث خطأ أثناء محاولة تهيئة البيانات.",
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
              استخدم هذه الأداة لإنشاء البيانات الأساسية (الفئات، المناقصات التجريبية) وتعيين حسابك كمسؤول للنظام.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
              <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={20} />
              <p className="text-sm text-amber-700">
                سيؤدي هذا الإجراء إلى تحديث صلاحيات حسابك الحالي لتصبح "Admin" في قاعدة البيانات، مما يسمح لك بإدارة كافة أقسام المنصة.
              </p>
            </div>

            <div className="space-y-4">
              <h4 className="font-bold flex items-center gap-2">
                <CheckCircle2 size={18} className="text-success" />
                ما سيتم إنشاؤه:
              </h4>
              <ul className="list-disc list-inside text-sm text-muted-foreground pr-4 space-y-1">
                <li>ملف مستخدم (مسؤول) لحسابك الحالي.</li>
                <li>5 فئات رئيسية للمناقصات.</li>
                <li>مناقصات تجريبية لعرضها في لوحة التحكم.</li>
              </ul>
            </div>
          </CardContent>
          <CardContent className="flex justify-center pb-8">
            <Button 
              size="lg" 
              onClick={handleSeed} 
              disabled={isSeeding}
              className="px-12 py-6 text-lg font-bold gap-2 shadow-lg"
            >
              {isSeeding ? (
                <>
                  <Loader2 className="animate-spin" />
                  جاري التهيئة...
                </>
              ) : (
                <>
                  <Database size={20} />
                  ابدأ تهيئة البيانات الآن
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
