"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useFirebase } from "@/firebase"
import { doc, setDoc, addDoc, collection, serverTimestamp } from "firebase/firestore"
import { signInAnonymously } from "firebase/auth"
import { Loader2, Database, RefreshCw, Warehouse } from "lucide-react"
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

  const [whOrgId, setWhOrgId] = useState("")
  const [isSeedingWh, setIsSeedingWh] = useState(false)
  const [whLog, setWhLog] = useState<string[]>([])
  const addWhLog = (msg: string) => setWhLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`])

  const handleSeedWarehouse = async () => {
    if (!firestore) return
    const orgId = whOrgId.trim()
    if (!orgId) { toast({ title: "أدخل معرّف المنظمة أولاً", variant: "destructive" }); return }
    setIsSeedingWh(true)
    setWhLog([])
    try {
      addWhLog(`بدء تأسيس بيانات المستودعات للمنظمة: ${orgId}`)

      const warehouseSeeds = [
        { name: "مستودع المواد الرئيسي", location: "الرياض - حي الصناعية" },
        { name: "مستودع معدات الموقع", location: "جدة - المنطقة الصناعية" },
      ]

      const inventorySeeds: Record<string, Array<{ name: string; sku: string; unit: string; quantity: number; minStockLevel: number }>> = {
        "0": [
          { name: "حديد تسليح 16مم", sku: "STL-16-001", unit: "طن", quantity: 50, minStockLevel: 10 },
          { name: "حديد تسليح 12مم", sku: "STL-12-001", unit: "طن", quantity: 30, minStockLevel: 5 },
          { name: "أسمنت بورتلاندي", sku: "CEM-POR-001", unit: "كيس", quantity: 500, minStockLevel: 100 },
          { name: "رمل ناعم", sku: "SND-FIN-001", unit: "م³", quantity: 80, minStockLevel: 20 },
          { name: "بلاط سيراميك 60×60", sku: "TIL-CER-001", unit: "م²", quantity: 200, minStockLevel: 50 },
          { name: "دهان خارجي أبيض", sku: "PNT-EXT-001", unit: "لتر", quantity: 150, minStockLevel: 30 },
          { name: "أنابيب PVC 4 بوصة", sku: "PVC-04-001", unit: "متر", quantity: 300, minStockLevel: 60 },
          { name: "كابلات كهربائية 4×10", sku: "CAB-410-001", unit: "متر", quantity: 500, minStockLevel: 100 },
        ],
        "1": [
          { name: "خوذات السلامة", sku: "SAF-HLM-001", unit: "قطعة", quantity: 25, minStockLevel: 10 },
          { name: "سقالات معدنية", sku: "SCF-STL-001", unit: "مجموعة", quantity: 8, minStockLevel: 2 },
          { name: "مضخة مياه 3 بوصة", sku: "PMP-WAT-001", unit: "قطعة", quantity: 3, minStockLevel: 1 },
          { name: "مولد كهربائي 50KVA", sku: "GEN-50K-001", unit: "قطعة", quantity: 2, minStockLevel: 1 },
          { name: "خلاطة خرسانة 350L", sku: "MIX-350-001", unit: "قطعة", quantity: 4, minStockLevel: 1 },
        ],
      }

      for (let i = 0; i < warehouseSeeds.length; i++) {
        const wh = warehouseSeeds[i]
        const whRef = doc(collection(firestore, "warehouses"))
        const whId = whRef.id
        await setDoc(whRef, {
          id: whId,
          organizationId: orgId,
          name: wh.name,
          location: wh.location,
          description: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        addWhLog(`✅ تم إنشاء المستودع: ${wh.name} (${whId})`)

        const items = inventorySeeds[String(i)] ?? []
        for (const item of items) {
          await addDoc(collection(firestore, "warehouses", whId, "inventoryItems"), {
            organizationId: orgId,
            warehouseId: whId,
            name: item.name,
            sku: item.sku,
            unit: item.unit,
            quantity: item.quantity,
            minStockLevel: item.minStockLevel,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        }
        addWhLog(`  └─ تمت إضافة ${items.length} صنف مخزني`)
      }

      addWhLog("✅ اكتمل تأسيس بيانات المستودعات!")
      toast({ title: "تم بنجاح", description: "تمت إضافة المستودعات والمخزون بنجاح." })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      addWhLog(`❌ خطأ: ${msg}`)
      toast({ title: "فشل التأسيس", description: msg, variant: "destructive" })
    } finally {
      setIsSeedingWh(false)
    }
  }

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

      // 5. إضافة طلبات عروض الأسعار التجريبية
      addLog("خطوة 4: إضافة طلبات عروض الأسعار التجريبية...")
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
      addLog("✅ تم إضافة طلبات عروض الأسعار بنجاح.")

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
      <div className="max-w-2xl mx-auto py-10 text-right space-y-8">
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
        {/* Warehouse seed */}
        <Card className="border-none shadow-xl bg-white">
          <CardHeader className="text-center border-b pb-6">
            <Warehouse size={48} className="mx-auto text-accent mb-3" />
            <CardTitle className="text-xl font-bold">تأسيس بيانات المستودعات</CardTitle>
            <CardDescription>ينشئ 2 مستودعات + 13 صنف مخزني تجريبي لأي منظمة مقاول</CardDescription>
          </CardHeader>
          <CardContent className="p-8 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="wh-org-id" className="font-semibold">معرّف المنظمة (organizationId)</Label>
              <Input
                id="wh-org-id"
                value={whOrgId}
                onChange={e => setWhOrgId(e.target.value)}
                placeholder="مثال: abc123xyz"
                dir="ltr"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">يمكن العثور عليه في Firestore → users → [uid] → organizationId</p>
            </div>
            <div className="bg-slate-900 text-green-400 p-4 rounded-xl font-mono text-sm h-40 overflow-y-auto shadow-inner border-2 border-slate-800">
              {whLog.map((log, i) => <div key={i} className="mb-1">➜ {log}</div>)}
              {whLog.length === 0 && <div className="text-slate-500 italic">في انتظار التنفيذ...</div>}
            </div>
            <Button
              onClick={handleSeedWarehouse}
              disabled={isSeedingWh || !whOrgId.trim()}
              className="w-full h-12 text-lg font-bold bg-accent hover:bg-accent/90 text-primary shadow-lg"
            >
              {isSeedingWh ? (
                <><Loader2 className="animate-spin ml-2" size={20} />جاري الإنشاء...</>
              ) : (
                <><Warehouse className="ml-2" size={20} />إنشاء مستودعات تجريبية</>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
