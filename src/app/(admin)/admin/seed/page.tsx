
"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useFirebase } from "@/firebase"
import { doc, writeBatch, setDoc } from "firebase/firestore"
import { signInAnonymously } from "firebase/auth"
import { Loader2, Database, RefreshCcw, CheckCircle2, AlertCircle } from "lucide-react"
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
  const [debugLog, setDebugLog] = useState<string[]>([])
  const { auth, firestore } = useFirebase()
  const { toast } = useToast()

  const addLog = (msg: string) => setDebugLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`])

  const handleSeed = async () => {
    setIsSeeding(true)
    setDebugLog([])
    addLog("بدء عملية التهيئة القوية...")

    try {
      // 1. التأكد من تسجيل الدخول
      let currentUser = auth.currentUser;
      if (!currentUser) {
        addLog("محاولة تسجيل دخول مجهول...")
        const cred = await signInAnonymously(auth)
        currentUser = cred.user
        addLog(`تم تسجيل الدخول بنجاح: ${currentUser.uid}`)
      } else {
        addLog(`المستخدم مسجل دخول بالفعل: ${currentUser.uid}`)
      }

      // 2. ترقية المستخدم إلى Admin (بشكل منفصل لفتح الصلاحيات)
      addLog("خطوة 1: ترقية الحساب إلى Admin...")
      const userRef = doc(firestore, "users", currentUser.uid)
      await setDoc(userRef, {
        id: currentUser.uid,
        role: "Admin",
        name: "مدير النظام الأساسي",
        email: currentUser.email || `admin-${currentUser.uid.slice(0,5)}@munaqasati.sa`,
        phoneNumber: "0500000000",
        city: "الرياض",
        joinedAt: new Date().toISOString(),
        isVerified: true
      }, { merge: true })
      
      addLog("تمت الترقية لـ Admin. انتظار تحديث قواعد Firestore (2 ثانية)...")
      await new Promise(resolve => setTimeout(resolve, 2000))

      // 3. إنشاء البيانات في دفعة واحدة (Batch)
      addLog("خطوة 2: إنشاء الفئات والمناقصات...")
      const batch = writeBatch(firestore)

      SAMPLE_CATEGORIES.forEach((cat) => {
        const catRef = doc(firestore, "categories", cat.id)
        batch.set(catRef, cat)
      })

      const mockRfqs = [
        { id: "rfq-seed-1", title: "توريد حديد سابك - مشروع النرجس", catId: "cat-1", qty: 100, unit: "طن" },
        { id: "rfq-seed-2", title: "خرسانة جاهزة K350", catId: "cat-2", qty: 50, unit: "م3" },
        { id: "rfq-seed-3", title: "أنابيب سباكة PPR", catId: "cat-4", qty: 200, unit: "متر" },
        { id: "rfq-seed-4", title: "دهانات داخلية جوتن", catId: "cat-3", qty: 150, unit: "جالون" }
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
          deadline: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
          location: "الرياض",
          area: "حي الملقا",
          paymentTerms: "كاش",
          isQualityCertificateRequired: true,
          status: "New",
          createdAt: new Date().toISOString()
        })
      })

      await batch.commit()
      addLog("تم إنشاء جميع البيانات بنجاح!")
      
      toast({ 
        title: "تمت التهيئة بنجاح!", 
        description: "أنت الآن Admin ويمكنك تصفح جميع الأقسام." 
      })
    } catch (error: any) {
      addLog(`خطأ فادح: ${error.message}`)
      console.error(error)
      toast({ 
        title: "فشلت العملية", 
        description: error.message, 
        variant: "destructive" 
      })
    } finally {
      setIsSeeding(false)
    }
  }

  return (
    <PortalLayout>
      <div className="max-w-3xl mx-auto py-12 text-right">
        <Card className="border-none shadow-xl overflow-hidden bg-white">
          <CardHeader className="text-center bg-slate-50 border-b pb-8">
            <Database size={56} className="mx-auto text-primary mb-4" />
            <CardTitle className="text-2xl font-bold">تأسيس بيانات المنصة</CardTitle>
            <CardDescription className="text-md">
              هذه الأداة ستقوم بتفعيل حسابك كمسؤول وإضافة البيانات الأساسية لتشغيل التطبيق.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-8">
            <div className="bg-slate-900 rounded-xl p-5 font-mono text-sm text-blue-400 min-h-[200px] shadow-inner">
              <div className="flex items-center gap-2 mb-3 text-slate-400 border-b border-slate-800 pb-2 text-xs">
                <CheckCircle2 size={14} />
                سجل العمليات (Debug Console)
              </div>
              {debugLog.map((log, i) => (
                <div key={i} className="mb-1 animate-in fade-in slide-in-from-right-2 duration-300">
                  <span className="text-slate-500 mr-2">➜</span> {log}
                </div>
              ))}
              {debugLog.length === 0 && (
                <div className="flex flex-col items-center justify-center h-32 text-slate-600 gap-2">
                  <AlertCircle size={32} className="opacity-20" />
                  <p className="opacity-50 italic">اضغط على الزر أدناه لبدء التأسيس</p>
                </div>
              )}
            </div>
            
            <Button 
              size="lg" 
              onClick={handleSeed} 
              disabled={isSeeding}
              className="w-full h-18 text-xl font-bold shadow-xl bg-primary hover:bg-primary/90 transition-all hover:scale-[1.01] active:scale-[0.99]"
            >
              {isSeeding ? (
                <>
                  <Loader2 className="animate-spin ml-3 h-6 w-6" />
                  جاري معالجة البيانات...
                </>
              ) : (
                <>
                  <RefreshCcw className="ml-3 h-6 w-6" />
                  ابدأ عملية التأسيس الآن
                </>
              )}
            </Button>
            
            <p className="text-center text-xs text-muted-foreground">
              ملاحظة: تأكد من تفعيل "Anonymous Sign-in" في لوحة تحكم Firebase أولاً.
            </p>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
