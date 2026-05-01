"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useFirestore, useUser, setDocumentNonBlocking } from "@/firebase"
import { doc, writeBatch, collection, setDoc } from "firebase/firestore"
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
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

  const handleSeed = async () => {
    if (!firestore || !user) {
      toast({
        title: "خطأ في الاتصال",
        description: "يرجى الانتظار حتى يتم التحقق من هويتك.",
        variant: "destructive"
      })
      return
    }

    setIsSeeding(true)
    try {
      // 1. Step ONE: Promote current user to Admin first (Critical for permissions)
      // We use await here to ensure the user is an admin before seeding other collections
      const userRef = doc(firestore, "users", user.uid)
      await setDoc(userRef, {
        id: user.uid,
        role: "Admin",
        name: "مدير النظام التجريبي",
        email: user.email || "guest@munaqasati.sa",
        phoneNumber: "0500000000",
        city: "الرياض",
        joinedAt: new Date().toISOString()
      }, { merge: true })

      toast({
        title: "تمت الترقية",
        description: "أنت الآن مسؤول النظام. جاري إنشاء بقية البيانات...",
      })

      // 2. Step TWO: Seed Categories and Mock RFQs using a batch
      const batch = writeBatch(firestore)

      SAMPLE_CATEGORIES.forEach((cat) => {
        const catRef = doc(firestore, "categories", cat.id)
        batch.set(catRef, cat)
      })

      const rfqIds = ["rfq-mock-1", "rfq-mock-2", "rfq-mock-3"]
      rfqIds.forEach((id, index) => {
        const rfqRef = doc(firestore, "rfqs", id)
        batch.set(rfqRef, {
          id: id,
          contractorId: user.uid,
          title: index === 0 ? "توريد حديد سابك - مشروع النرجس" : index === 1 ? "خرسانة جاهزة K350" : "أنابيب سباكة PPR",
          categoryId: index === 0 ? "حديد ومعادن" : index === 1 ? "أسمنت وخرسانة" : "أدوات صحية",
          quantity: (index + 1) * 50,
          unitOfMeasure: index === 0 ? "طن" : index === 1 ? "م3" : "متر",
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
        title: "تمت التهيئة بنجاح!",
        description: "تم إنشاء كافة البيانات التجريبية بنجاح.",
      })
    } catch (error: any) {
      console.error("Seed error:", error)
      toast({
        title: "فشل التهيئة",
        description: "حدث خطأ بسبب قيود الصلاحيات. يرجى المحاولة مرة أخرى بعد ثوانٍ.",
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
              استخدم هذه الأداة لإنشاء البيانات الأساسية وتعيين حسابك كمسؤول للنظام.
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
                <p className="text-sm text-success">
                  أنت متصل الآن وجاهز للتهيئة. معرفك: <span className="font-mono text-xs">{user.uid}</span>
                </p>
              </div>
            ) : (
              <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg flex items-center gap-3">
                <AlertTriangle className="text-destructive" size={20} />
                <p className="text-sm text-destructive">فشل التعرف على الجلسة. يرجى إعادة تحميل الصفحة.</p>
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