"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useFirebase } from "@/firebase"
import { doc, setDoc } from "firebase/firestore"
import { signInAnonymously } from "firebase/auth"
import { Loader2, Database, RefreshCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useTranslations, useLocale } from 'next-intl'

const SAMPLE_CATEGORIES = [
  { id: "cat-1", name: "حديد ومعادن", description: "جميع أنواع حديد التسليح والصلب" },
  { id: "cat-2", name: "أسمنت وخرسانة", description: "الأسمنت البورتلاندي والخرسانة الجاهزة" },
  { id: "cat-3", name: "دهانات", description: "الدهانات الداخلية والخارجية ومواد العزل" },
  { id: "cat-4", name: "أدوات صحية", description: "مستلزمات السباكة والأدوات الصحية" }
]

const SAUDI_CITIES_SEED = [
  "الرياض", "جدة", "مكة المكرمة", "المدينة المنورة", "الدمام", "الخبر", "الظهران",
  "الأحساء", "الجبيل", "تبوك", "حائل", "القصيم", "بريدة", "عنيزة", "أبها", "خميس مشيط",
  "جازان", "نجران", "الباحة", "سكاكا", "عرعر"
]

export default function SeedPage() {
  const t = useTranslations("Portal.Admin.Seed")
  const locale = useLocale()
  const [isSeeding, setIsSeeding] = useState(false)
  const [debugLog, setDebugLog] = useState<string[]>([])
  const { auth, firestore } = useFirebase()
  const { toast } = useToast()

  const addLog = (msg: string) => setDebugLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`])

  const handleSeed = async () => {
    if (!auth || !firestore) {
      addLog("خطأ: خدمات Firebase غير جاهزة بعد.")
      return
    }

    setIsSeeding(true)
    setDebugLog([])
    addLog("بدء عملية التأسيس الشاملة...")

    try {
      // 1. التأكد من تسجيل الدخول
      let currentUser = auth.currentUser;
      if (!currentUser) {
        addLog("جاري محاولة تسجيل الدخول مجهولاً...")
        const cred = await signInAnonymously(auth)
        currentUser = cred.user
        addLog(`تم تسجيل الدخول بنجاح: ${currentUser.uid}`)
      }

      // 2. إنشاء ملف المستخدم (Admin)
      addLog("خطوة 1: إنشاء مستند المستخدم (Admin) لفتح الصلاحيات...")
      const userRef = doc(firestore, "users", currentUser.uid)
      await setDoc(userRef, {
        id: currentUser.uid,
        role: "Admin",
        name: "مدير النظام الرئيسي",
        email: "admin@mdmak-tech.sa",
        phoneNumber: "0500000000",
        city: "الرياض",
        joinedAt: new Date().toISOString(),
        isVerified: true
      })
      addLog("✅ تم إنشاء ملف Admin بنجاح.")

      // انتظار بسيط لتحديث الصلاحيات
      addLog("جاري انتظار تحديث الصلاحيات (3 ثوانٍ)...")
      await new Promise(r => setTimeout(r, 3000))

      // 3. إضافة الفئات
      addLog("خطوة 2: إضافة الفئات...")
      for (const cat of SAMPLE_CATEGORIES) {
        await setDoc(doc(firestore, "categories", cat.id), cat)
      }
      addLog("✅ تم إضافة الفئات بنجاح.")

      // 4. إضافة المدن
      addLog("خطوة 3: إضافة المدن...")
      for (let i = 0; i < SAUDI_CITIES_SEED.length; i++) {
        const city = SAUDI_CITIES_SEED[i]
        await setDoc(doc(firestore, "cities", `city-${i}`), {
          name: city,
          country: "المملكة العربية السعودية",
          isActive: true,
          createdAt: new Date().toISOString()
        })
      }
      addLog("✅ تم إضافة المدن بنجاح.")

      // 5. إضافة المناقصات التجريبية
      addLog("خطوة 4: إضافة المناقصات التجريبية...")
      const mockRfqs = [
        { id: "rfq-demo-1", title: "توريد حديد سابك - مشروع نيوم", catId: "cat-1", area: "الرياض" },
        { id: "rfq-demo-2", title: "خرسانة جاهزة K350", catId: "cat-2", area: "جدة" },
        { id: "rfq-demo-3", title: "أدوات سباكة لمجمع سكني", catId: "cat-4", area: "الدمام" }
      ]
      for (const rfq of mockRfqs) {
        await setDoc(doc(firestore, "rfqs", rfq.id), {
          id: rfq.id,
          contractorId: currentUser!.uid,
          title: rfq.title,
          categoryId: rfq.catId,
          quantity: 100,
          unitOfMeasure: "وحدة",
          deadline: new Date(Date.now() + 864000000).toISOString(),
          location: rfq.area,
          area: "الحي الرئيسي",
          isQualityCertificateRequired: false,
          status: "New",
          createdAt: new Date().toISOString()
        })
      }
      addLog("✅ تم إضافة المناقصات بنجاح.")

      // 6. إضافة الموردين التجريبيين
      addLog("خطوة 5: إضافة الموردين التجريبيين...")
      const mockSuppliers = [
        { id: "sup-1", name: "شركة مصنع الرياض للحديد", role: "Supplier", email: "riyadh.steel@example.com", joinedAt: new Date().toISOString() },
        { id: "sup-2", name: "أسمنت اليمامة", role: "Supplier", email: "yamama.cement@example.com", joinedAt: new Date().toISOString() },
        { id: "sup-3", name: "الشركة الوطنية للدهانات", role: "Supplier", email: "national.paints@example.com", joinedAt: new Date().toISOString() },
      ]
      for (const sup of mockSuppliers) {
        await setDoc(doc(firestore, "users", sup.id), sup)
      }
      addLog("✅ تم إضافة الموردين بنجاح.")

      addLog("✅ تمت إضافة كافة البيانات بنجاح!")
      toast({ title: "نجاح باهر", description: "تم تأسيس النظام بالكامل وهو جاهز للعمل." })
    } catch (error: any) {
      addLog(`❌ خطأ في التنفيذ: ${error.message}`)
      toast({ title: "فشل في التأسيس", description: error.message, variant: "destructive" })
    } finally {
      setIsSeeding(false)
    }
  }

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto py-10 text-right">
        <Card className="border-none shadow-xl bg-white">
          <CardHeader className="text-center border-b pb-6">
            <Database size={60} className="mx-auto text-primary mb-4" />
            <CardTitle className="text-2xl font-bold">{t("page_title")}</CardTitle>
            <CardDescription className="text-lg">{t("page_desc")}</CardDescription>
          </CardHeader>
          <CardContent className="p-8 space-y-6">
            <div className="bg-slate-900 text-green-400 p-5 rounded-xl font-mono text-sm h-64 overflow-y-auto shadow-inner border-2 border-slate-800">
              {debugLog.map((log, i) => <div key={i} className="mb-1">➜ {log}</div>)}
              {debugLog.length === 0 && <div className="text-slate-500 italic">{t("waiting_for_seed")}</div>}
            </div>
            
            <Button 
              onClick={handleSeed} 
              disabled={isSeeding} 
              className="w-full h-14 text-xl font-bold bg-primary hover:bg-primary/90 shadow-lg"
            >
              {isSeeding ? (
                <>
                  <Loader2 className="animate-spin ml-3" size={24} />
                  {t("seeding")}
                </>
              ) : (
                <>
                  <RefreshCw className="ml-3" size={24} />
                  {t("seed_now")}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
