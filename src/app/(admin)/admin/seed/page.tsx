"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useFirestore, useUser } from "@/firebase"
import { doc, writeBatch } from "firebase/firestore"
import { Loader2, Database, CheckCircle2, AlertTriangle, UserCircle } from "lucide-react"
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
        title: "خطأ",
        description: "جاري التحقق من هويتك، يرجى الانتظار ثانية ثم المحاولة مرة أخرى.",
        variant: "destructive"
      })
      return
    }

    setIsSeeding(true)
    try {
      const batch = writeBatch(firestore)

      // 1. First, make current user an Admin
      const userRef = doc(firestore, "users", user.uid)
      batch.set(userRef, {
        id: user.uid,
        role: "Admin",
        name: "مدير النظام التجريبي",
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
        description: "تم تحديث صلاحياتك كمسؤول وإنشاء البيانات التجريبية.",
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
              استخدم هذه الأداة لإنشاء البيانات الأساسية وتعيين حسابك كمسؤول للنظام.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isUserLoading ? (
              <div className="flex items-center justify-center p-8 gap-3 text-muted-foreground">
                <Loader2 className="animate-spin" />
                <span>جاري التحقق من الاتصال بـ Firebase...</span>
              </div>
            ) : user ? (
              <div className="p-4 bg-success/5 border border-success/20 rounded-lg flex items-center gap-3">
                <UserCircle className="text-success" size={20} />
                <p className="text-sm text-success">
                  أنت متصل الآن بمعرف: <span className="font-mono text-xs">{user.uid}</span>
                </p>
              </div>
            ) : (
              <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg flex items-center gap-3">
                <AlertTriangle className="text-destructive" size={20} />
                <p className="text-sm text-destructive">لم يتم العثور على جلسة دخول. يرجى تحديث الصفحة.</p>
              </div>
            )}

            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
              <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={20} />
              <p className="text-sm text-amber-700">
                سيتم تعيين حسابك كـ "Admin" لتمكن من الوصول لجميع الأقسام، وسيتم إنشاء 5 فئات و3 مناقصات تجريبية.
              </p>
            </div>
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
