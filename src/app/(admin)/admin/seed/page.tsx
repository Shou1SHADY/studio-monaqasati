"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useFirebase } from "@/firebase"
import { doc, setDoc, writeBatch } from "firebase/firestore"
import { signInAnonymously } from "firebase/auth"
import { Loader2, Database, RefreshCcw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

const SAMPLE_CATEGORIES = [
  { id: "cat-1", name: "حديد ومعادن", description: "جميع أنواع حديد التسليح والصلب" },
  { id: "cat-2", name: "أسمنت وخرسانة", description: "الأسمنت البورتلاندي والخرسانة الجاهزة" },
  { id: "cat-3", name: "دهانات", description: "الدهانات الداخلية والخارجية ومواد العزل" },
  { id: "cat-4", name: "أدوات صحية", description: "مستلزمات السباكة والأدوات الصحية" }
]

export default function SeedPage() {
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
        addLog("جاري محاولة تسجيل الدخول...")
        const cred = await signInAnonymously(auth)
        currentUser = cred.user
        addLog(`تم تسجيل الدخول بنجاح: ${currentUser.uid}`)
      }

      // 2. إنشاء ملف المشرف أولاً (بشكل منفصل لفتح الصلاحيات)
      addLog("خطوة 1: إنشاء ملف Admin وفتح الصلاحيات...")
      const userRef = doc(firestore, "users", currentUser.uid)
      await setDoc(userRef, {
        id: currentUser.uid,
        role: "Admin",
        name: "مدير النظام الرئيسي",
        email: "admin@munaqasati.sa",
        phoneNumber: "0500000000",
        city: "الرياض",
        joinedAt: new Date().toISOString(),
        isVerified: true
      })
      addLog("✅ تم إنشاء ملف Admin بنجاح.")

      // انتظار بسيط لتحديث خوادم جوجل لصلاحياتك الجديدة
      addLog("جاري انتظار تحديث الصلاحيات في النظام (3 ثوانٍ)...")
      await new Promise(r => setTimeout(r, 3000))

      // 3. إضافة بقية البيانات باستخدام Batch
      addLog("خطوة 2: إضافة الفئات والمناقصات...")
      const batch = writeBatch(firestore)

      SAMPLE_CATEGORIES.forEach((cat) => {
        batch.set(doc(firestore, "categories", cat.id), cat)
      })

      const mockRfqs = [
        { id: "rfq-demo-1", title: "توريد حديد سابك - مشروع نيوم", catId: "cat-1", area: "الرياض" },
        { id: "rfq-demo-2", title: "خرسانة جاهزة K350", catId: "cat-2", area: "جدة" },
        { id: "rfq-demo-3", title: "أدوات سباكة لمجمع سكني", catId: "cat-4", area: "الدمام" }
      ]

      mockRfqs.forEach((rfq) => {
        batch.set(doc(firestore, "rfqs", rfq.id), {
          id: rfq.id,
          contractorId: currentUser!.uid,
          title: rfq.title,
          categoryId: rfq.catId,
          quantity: 100,
          unitOfMeasure: "وحدة",
          deadline: new Date(Date.now() + 864000000).toISOString(),
          location: rfq.area,
          area: "الحي الرئيسي",
          paymentTerms: "كاش",
          isQualityCertificateRequired: false,
          status: "New",
          createdAt: new Date().toISOString()
        })
      })

      await batch.commit()
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
            <CardTitle className="text-2xl font-bold">تهيئة بيانات منصة مناقصتي</CardTitle>
            <CardDescription className="text-lg">سيتم إعداد حسابك كمسؤول وإضافة المناقصات التجريبية فوراً.</CardDescription>
          </CardHeader>
          <CardContent className="p-8 space-y-6">
            <div className="bg-slate-900 text-green-400 p-5 rounded-xl font-mono text-sm h-64 overflow-y-auto shadow-inner border-2 border-slate-800">
              {debugLog.map((log, i) => <div key={i} className="mb-1">➜ {log}</div>)}
              {debugLog.length === 0 && <div className="text-slate-500 italic">بانتظار الضغط على زر التأسيس...</div>}
            </div>
            
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-blue-800 text-sm">
              <strong>تنبيه:</strong> يرجى عدم إغلاق الصفحة أثناء عملية التأسيس لضمان اكتمال جميع الخطوات.
            </div>

            <Button 
              onClick={handleSeed} 
              disabled={isSeeding} 
              className="w-full h-14 text-xl font-bold bg-primary hover:bg-primary/90 shadow-lg transition-all"
            >
              {isSeeding ? (
                <>
                  <Loader2 className="animate-spin ml-3" size={24} />
                  جاري التأسيس...
                </>
              ) : (
                <>
                  <RefreshCcw className="ml-3" size={24} />
                  تأسيس البيانات الآن
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}