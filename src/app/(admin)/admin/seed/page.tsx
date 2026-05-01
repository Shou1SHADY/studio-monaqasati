
"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useFirestore, useUser, useAuth } from "@/firebase"
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
  
  // استخدام الخطافات بحذر للتأكد من توفر الخدمات
  const firestore = useFirestore()
  const auth = useAuth()
  const { user } = useUser()
  const { toast } = useToast()

  const addLog = (msg: string) => setDebugLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`])

  useEffect(() => {
    if (user) {
      addLog(`تم اكتشاف جلسة نشطة: ${user.uid}`)
    }
  }, [user])

  const handleSeed = async () => {
    setIsSeeding(true)
    setDebugLog([])
    addLog("بدء عملية التهيئة...")

    if (!auth || !firestore) {
      addLog("خطأ فني: لم يتم العثور على محرك Firebase. يرجى التأكد من تهيئة التطبيق.")
      setStatus("error")
      setIsSeeding(false)
      return
    }

    try {
      // 1. التأكد من تسجيل الدخول
      let currentUser = auth.currentUser;
      if (!currentUser) {
        setStatus("auth")
        addLog("جاري محاولة تسجيل الدخول مجهولاً...")
        try {
          const cred = await signInAnonymously(auth)
          currentUser = cred.user
          addLog(`تم تسجيل الدخول بنجاح: ${currentUser.uid}`)
        } catch (authError: any) {
          addLog(`فشل تسجيل الدخول: ${authError.message}`)
          throw authError
        }
      }

      // 2. ترقية المستخدم إلى Admin
      setStatus("promoting")
      addLog("جاري ترقية الحساب إلى Admin في Firestore...")
      const userRef = doc(firestore, "users", currentUser.uid)
      
      await setDoc(userRef, {
        id: currentUser.uid,
        role: "Admin",
        name: "مدير النظام التجريبي",
        email: currentUser.email || `admin_${currentUser.uid.slice(0, 5)}@munaqasati.sa`,
        phoneNumber: "0500000000",
        city: "الرياض",
        joinedAt: new Date().toISOString(),
        isVerified: true
      }, { merge: true })
      
      addLog("تم تحديث الرتبة بنجاح. انتظار تحديث قواعد الأمان (3 ثوانٍ)...")
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
        { id: "rfq-seed-3", title: "أنابيب سباكة PPR", catId: "أدوات صحية", qty: 200, unit: "متر" },
        { id: "rfq-seed-4", title: "دهانات داخلية - فندق الرياض", catId: "دهانات", qty: 500, unit: "جالون" },
        { id: "rfq-seed-5", title: "كابلات كهربائية 10 ملم", catId: "كهرباء وإنارة", qty: 1000, unit: "متر" }
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
      addLog("تم إنشاء جميع البيانات بنجاح!")
      
      setStatus("success")
      toast({
        title: "اكتملت التهيئة!",
        description: "أنت الآن Admin وجميع البيانات التجريبية جاهزة.",
      })
    } catch (error: any) {
      console.error("Seed Error:", error)
      addLog(`خطأ فادح: ${error.message}`)
      setStatus("error")
    } finally {
      setIsSeeding(false)
    }
  }

  return (
    <PortalLayout>
      <div className="max-w-3xl mx-auto py-12 text-right">
        <Card className="border-none shadow-2xl overflow-hidden bg-white">
          <div className="h-2 bg-slate-100 w-full">
            <div 
              className="h-full bg-primary transition-all duration-700" 
              style={{ width: 
                status === 'idle' ? '5%' : 
                status === 'auth' ? '20%' : 
                status === 'promoting' ? '50%' : 
                status === 'seeding' ? '80%' : '100%' 
              }}
            />
          </div>
          
          <CardHeader className="text-center pt-10">
            <div className={`mx-auto w-24 h-24 rounded-3xl flex items-center justify-center mb-6 transition-all ${
              status === 'success' ? 'bg-success/10 text-success' : 
              status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
            }`}>
              {status === 'success' ? <CheckCircle size={48} /> : 
               status === 'error' ? <AlertTriangle size={48} /> : <Database size={48} />}
            </div>
            <CardTitle className="text-3xl font-bold">مركز تهيئة النظام</CardTitle>
            <CardDescription className="text-lg mt-2 px-12">
              هذه الأداة مخصصة للمطورين فقط لضبط الصلاحيات وإضافة بيانات تجريبية لمرة واحدة.
            </CardDescription>
          </CardHeader>
          
          <CardContent className="px-10 py-6">
            <div className="bg-slate-900 rounded-xl p-6 font-mono text-xs text-slate-300 min-h-[200px] overflow-y-auto">
              {debugLog.map((log, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <span className="text-success">➜</span>
                  <span>{log}</span>
                </div>
              ))}
              {isSeeding && (
                <div className="flex items-center gap-2 text-primary mt-2 animate-pulse">
                  <Loader2 className="animate-spin" size={14} />
                  <span>جاري المعالجة...</span>
                </div>
              )}
              {debugLog.length === 0 && <p className="opacity-50 italic">بانتظار الضغط على زر البدء...</p>}
            </div>

            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="p-4 rounded-xl border bg-slate-50 flex items-center gap-3">
                <div className={`h-3 w-3 rounded-full ${user ? 'bg-success' : 'bg-slate-300'}`} />
                <span className="text-sm font-medium">حالة الاتصال: {user ? 'متصل' : 'جاري التحقق'}</span>
              </div>
              <div className="p-4 rounded-xl border bg-slate-50 flex items-center gap-3">
                <ShieldCheck className={status === 'success' ? 'text-success' : 'text-slate-300'} size={20} />
                <span className="text-sm font-medium">صلاحيات المسؤول: {status === 'success' ? 'مفعلة' : 'غير نشطة'}</span>
              </div>
            </div>
          </CardContent>

          <CardContent className="flex flex-col items-center pb-12 px-10">
            {!user && status === 'idle' && (
              <div className="mb-6 p-4 bg-amber-50 text-amber-700 rounded-lg text-sm flex items-start gap-3 border border-amber-100">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <p>تنبيه: لم يتم اكتشاف جلسة بعد. سيحاول الزر أدناه تسجيل دخولك تلقائياً قبل البدء.</p>
              </div>
            )}
            
            <Button 
              size="lg" 
              onClick={handleSeed} 
              disabled={isSeeding}
              className="px-20 py-8 text-xl font-bold w-full max-w-md shadow-lg"
            >
              {isSeeding ? <Loader2 className="animate-spin mr-2" /> : <RefreshCcw className="mr-2" />}
              {status === 'success' ? "إعادة تشغيل التهيئة" : "ابدأ تهيئة البيانات الآن"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
