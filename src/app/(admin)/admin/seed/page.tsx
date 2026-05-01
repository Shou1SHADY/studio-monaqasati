
"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useFirebase } from "@/firebase"
import { doc, writeBatch, setDoc, collection, getDocs } from "firebase/firestore"
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
    if (!auth || !firestore) {
      addLog("خطأ: خدمات Firebase غير جاهزة بعد.")
      return
    }

    setIsSeeding(true)
    setDebugLog([])
    addLog("بدء عملية التأسيس...")

    try {
      // 1. تسجيل الدخول
      let currentUser = auth.currentUser;
      if (!currentUser) {
        addLog("جاري تسجيل الدخول...")
        const cred = await signInAnonymously(auth)
        currentUser = cred.user
        addLog(`تم تسجيل الدخول: ${currentUser.uid}`)
      }

      // 2. إنشاء مستند المستخدم فوراً
      addLog("إنشاء ملف Admin...")
      const userRef = doc(firestore, "users", currentUser.uid)
      await setDoc(userRef, {
        id: currentUser.uid,
        role: "Admin",
        name: "مدير النظام",
        email: "admin@munaqasati.sa",
        phoneNumber: "0500000000",
        city: "الرياض",
        joinedAt: new Date().toISOString(),
        isVerified: true
      })
      addLog("تم إنشاء ملف Admin بنجاح.")

      // 3. إنشاء البيانات الأساسية
      addLog("جاري إضافة الفئات والمناقصات...")
      const batch = writeBatch(firestore)

      SAMPLE_CATEGORIES.forEach((cat) => {
        batch.set(doc(firestore, "categories", cat.id), cat)
      })

      const mockRfqs = [
        { id: "rfq-1", title: "توريد حديد سابك - مشروع النرجس", catId: "cat-1" },
        { id: "rfq-2", title: "خرسانة جاهزة K350", catId: "cat-2" }
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
          location: "الرياض",
          area: "حي الملقا",
          paymentTerms: "كاش",
          isQualityCertificateRequired: false,
          status: "New",
          createdAt: new Date().toISOString()
        })
      })

      await batch.commit()
      addLog("تمت عملية التأسيس بنجاح كامل!")
      
      toast({ title: "نجاح", description: "تمت تهيئة البيانات بنجاح." })
    } catch (error: any) {
      addLog(`خطأ: ${error.message}`)
      toast({ title: "فشل", description: error.message, variant: "destructive" })
    } finally {
      setIsSeeding(false)
    }
  }

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto py-10 text-right">
        <Card className="border-none shadow-lg">
          <CardHeader className="text-center">
            <Database size={48} className="mx-auto text-primary mb-2" />
            <CardTitle>تهيئة بيانات المنصة</CardTitle>
            <CardDescription>سيتم إنشاء حسابك كمسؤول وإضافة بيانات تجريبية.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-slate-900 text-blue-400 p-4 rounded-lg font-mono text-xs h-48 overflow-y-auto">
              {debugLog.map((log, i) => <div key={i}>➜ {log}</div>)}
              {debugLog.length === 0 && <div className="text-slate-500 italic">بانتظار البدء...</div>}
            </div>
            <Button onClick={handleSeed} disabled={isSeeding} className="w-full h-12 text-lg">
              {isSeeding ? <Loader2 className="animate-spin ml-2" /> : <RefreshCcw className="ml-2" />}
              تأسيس البيانات الآن
            </Button>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
