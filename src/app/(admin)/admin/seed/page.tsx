
"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useFirebase, useUser } from "@/firebase"
import { doc, writeBatch, setDoc } from "firebase/firestore"
import { signInAnonymously } from "firebase/auth"
import { Loader2, Database, AlertTriangle, CheckCircle, RefreshCcw, ShieldCheck } from "lucide-react"
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
  const [status, setStatus] = useState<"idle" | "auth" | "promoting" | "seeding" | "success" | "error">("idle")
  const [debugLog, setDebugLog] = useState<string[]>([])
  
  // استخدام useFirebase مباشرة للحصول على الخدمات بشكل آمن
  const firebase = useFirebase()
  const { user } = useUser()
  const { toast } = useToast()

  const addLog = (msg: string) => setDebugLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`])

  const handleSeed = async () => {
    setIsSeeding(true)
    setDebugLog([])
    addLog("بدء عملية التهيئة...")

    const { auth, firestore } = firebase;

    try {
      // 1. التأكد من تسجيل الدخول
      let currentUser = auth.currentUser;
      if (!currentUser) {
        setStatus("auth")
        addLog("جاري تسجيل الدخول...")
        const cred = await signInAnonymously(auth)
        currentUser = cred.user
        addLog(`تم تسجيل الدخول: ${currentUser.uid}`)
      }

      // 2. ترقية المستخدم إلى Admin
      setStatus("promoting")
      addLog("جاري ترقية حسابك إلى Admin...")
      const userRef = doc(firestore, "users", currentUser.uid)
      
      await setDoc(userRef, {
        id: currentUser.uid,
        role: "Admin",
        name: "مدير النظام",
        email: currentUser.email || `admin@munaqasati.sa`,
        phoneNumber: "0500000000",
        city: "الرياض",
        joinedAt: new Date().toISOString(),
        isVerified: true
      }, { merge: true })
      
      addLog("تمت الترقية بنجاح. انتظار تحديث القواعد (3 ثوانٍ)...")
      await new Promise(resolve => setTimeout(resolve, 3000))

      // 3. إنشاء البيانات
      setStatus("seeding")
      addLog("جاري إنشاء الفئات والمناقصات...")
      const batch = writeBatch(firestore)

      SAMPLE_CATEGORIES.forEach((cat) => {
        const catRef = doc(firestore, "categories", cat.id)
        batch.set(catRef, cat)
      })

      const mockRfqs = [
        { id: "rfq-seed-1", title: "توريد حديد سابك - مشروع النرجس", catId: "حديد ومعادن", qty: 100, unit: "طن" },
        { id: "rfq-seed-2", title: "خرسانة جاهزة K350", catId: "أسمنت وخرسانة", qty: 50, unit: "م3" },
        { id: "rfq-seed-3", title: "أنابيب سباكة PPR", catId: "أدوات صحية", qty: 200, unit: "متر" }
      ]

      mockRfqs.forEach((rfq) => {
        const rfqRef = doc(firestore, "rfqs", rfq.id)
        batch.set(rfqRef, {
          id: rfq.id,
          contractorId: currentUser!.uid,
          title: rfq.title,
          categoryId: rfq.catId,
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
      addLog("تمت العملية بنجاح!")
      setStatus("success")
      toast({ title: "تمت التهيئة بنجاح!" })
    } catch (error: any) {
      addLog(`خطأ: ${error.message}`)
      setStatus("error")
    } finally {
      setIsSeeding(false)
    }
  }

  return (
    <PortalLayout>
      <div className="max-w-3xl mx-auto py-12 text-right">
        <Card className="border-none shadow-xl overflow-hidden bg-white">
          <CardHeader className="text-center">
            <Database size={48} className="mx-auto text-primary mb-4" />
            <CardTitle className="text-2xl font-bold">تهيئة بيانات النظام</CardTitle>
            <CardDescription>اضغط على الزر أدناه لإصلاح الصلاحيات وإضافة بيانات تجريبية</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 min-h-[150px]">
              {debugLog.map((log, i) => <div key={i} className="mb-1">➜ {log}</div>)}
              {debugLog.length === 0 && <p className="opacity-50 italic">بانتظار البدء...</p>}
            </div>
            <Button 
              size="lg" 
              onClick={handleSeed} 
              disabled={isSeeding}
              className="w-full h-16 text-xl font-bold shadow-lg"
            >
              {isSeeding ? <Loader2 className="animate-spin ml-2" /> : <RefreshCcw className="ml-2" />}
              ابدأ الآن
            </Button>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
