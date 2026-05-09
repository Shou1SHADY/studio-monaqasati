"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  FileText,
  MapPin,
  ClipboardCheck,
  Zap,
  Loader2,
  Plus,
  Trash2,
  Upload,
  File,
  Save,
  Send,
  AlertCircle
} from "lucide-react"
import { draftRfqDescription } from "@/ai/flows/draft-rfq-description-flow"
import { useToast } from "@/hooks/use-toast"
import { useFirestore, useUser, useStorage, addDocumentNonBlocking } from "@/firebase"
import { collection } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"
import { CATEGORIES_DATA } from "@/lib/constants"

const SAUDI_CITIES = [
  "الرياض", "جدة", "مكة المكرمة", "المدينة المنورة", "الدمام", "الخبر", "الظهران",
  "الأحساء", "الجبيل", "تبوك", "حائل", "القصيم", "بريدة", "عنيزة", "أبها", "خميس مشيط",
  "جازان", "نجران", "الباحة", "سكاكا", "عرعر"
]

const CITIES_DISTRICTS: Record<string, string[]> = {
  "الرياض": ["شمال الرياض", "جنوب الرياض", "شرق الرياض", "غرب الرياض", "وسط الرياض", "جميع الرياض"],
  "جدة": ["شمال جدة", "جنوب جدة", "وسط جدة", "أبحر", "جميع جدة"],
  "مكة المكرمة": ["العزيزية", "الشوقية", "العوالي", "بطحاء قريش", "جميع مكة"],
  "المدينة المنورة": ["العزيزية", "الخالدية", "الحرة الشرقية", "جميع المدينة"],
  "الدمام": ["شرق الدمام", "غرب الدمام", "وسط الدمام", "جميع الدمام"],
  "الخبر": ["شمال الخبر", "الخبر الجنوبية", "العقربية", "جميع الخبر"],
  "الظهران": ["حي الدانة", "حي الدوحة", "حي القصور", "جميع الظهران"],
  "الأحساء": ["الهفوف", "المبرز", "العيون", "العمران", "جميع الأحساء"],
  "الجبيل": ["الجبيل الصناعية", "الجبيل البلد", "جميع الجبيل"],
  "تبوك": ["المروج", "الروضة", "السليمانية", "جميع تبوك"],
  "حائل": ["صديان", "أجا", "النقرة", "جميع حائل"],
  "القصيم": ["بريدة", "عنيزة", "الرس", "البدائع", "جميع القصيم"],
  "أبها": ["حي المنسك", "حي الموظفين", "حي الخالدية", "جميع أبها"],
  "خميس مشيط": ["الرصراص", "الشباعة", "شكر", "جميع خميس مشيط"],
  "جازان": ["حي السويس", "حي الروضة", "حي الشاطئ", "جميع جازان"],
  "نجران": ["الفيصلية", "الخالدية", "الفهد", "جميع نجران"],
}

interface ValidationError {
  field: string
  message: string
}

function RequiredStar() {
  return <span className="text-destructive mr-1">*</span>
}

export default function NewRfqPage() {
  const [step, setStep] = useState(1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const { toast } = useToast()
  const router = useRouter()
  const firestore = useFirestore()
  const { user } = useUser()

  const isAiEnabled = process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY

  const [formData, setFormData] = useState({
    title: "",
    category: "",
    subCategory: "",
    city: "",
    district: "",
    deadline: "",
    notes: "",
    certRequired: false,
    visibility: "public" as "public" | "favorites",
    pdfUrl: null as string | null,
    pdfStoragePath: null as string | null
  })

  interface Product {
    id: string
    name: string
    quantity: string
    unit: string
    description: string
  }

  const [products, setProducts] = useState<Product[]>([
    { id: "1", name: "", quantity: "", unit: "", description: "" }
  ])

  const [isUploadingPdf, setIsUploadingPdf] = useState(false)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const addProduct = () => {
    setProducts([...products, { id: Date.now().toString(), name: "", quantity: "", unit: "", description: "" }])
  }

  const removeProduct = (id: string) => {
    if (products.length > 1) {
      setProducts(products.filter(p => p.id !== id))
    }
  }

  const updateProduct = (id: string, field: keyof Product, value: string) => {
    setProducts(products.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  const storage = useStorage()

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== "application/pdf") {
      toast({ title: "خطأ", description: "يرجى رفع ملف PDF فقط", variant: "destructive" })
      return
    }
    setIsUploadingPdf(true)
    try {
      if (!storage) throw new Error("Storage not initialized")
      const storagePath = `rfqs/pdfs/${Date.now()}-${file.name}`
      const fileRef = ref(storage, storagePath)
      await uploadBytes(fileRef, file)
      const downloadUrl = await getDownloadURL(fileRef)
      setFormData(prev => ({ ...prev, pdfUrl: downloadUrl, pdfStoragePath: storagePath }))
      toast({ title: "تم الرفع", description: "تم إرفاق الملف بنجاح" })
    } catch (error) {
      console.error("PDF upload failed:", error)
      toast({ title: "خطأ", description: "فشل رفع الملف", variant: "destructive" })
    } finally {
      setIsUploadingPdf(false)
    }
  }

  const removePdf = async () => {
    if (formData.pdfStoragePath && storage) {
      try {
        const fileRef = ref(storage, formData.pdfStoragePath)
        await deleteObject(fileRef)
      } catch (error) {
        console.warn("Could not delete PDF from storage:", error)
      }
    }
    setFormData(prev => ({ ...prev, pdfUrl: null, pdfStoragePath: null }))
    if (pdfInputRef.current) pdfInputRef.current.value = ""
  }

  const clearError = (field: string) => {
    setValidationErrors(prev => prev.filter(e => e.field !== field))
  }

  const validateStep1 = (): ValidationError[] => {
    const errors: ValidationError[] = []
    
    if (!formData.title.trim()) {
      errors.push({ field: "title", message: "يرجى إدخال عنوان للمناقصة" })
    }
    
    if (!formData.category) {
      errors.push({ field: "category", message: "يرجى اختيار الفئة الرئيسية" })
    }
    
    const validProducts = products.filter(p => p.name.trim() && p.quantity.trim() && p.unit.trim())
    if (validProducts.length === 0) {
      errors.push({ field: "products", message: "يرجى إدخال منتج واحد على الأقل مع تحديد الكمية والوحدة" })
    }
    
    return errors
  }

  const validateStep2 = (): ValidationError[] => {
    const errors: ValidationError[] = []
    
    if (!formData.city) {
      errors.push({ field: "city", message: "يرجى اختيار المدينة" })
    }
    
    if (!formData.deadline) {
      errors.push({ field: "deadline", message: "يرجى تحديد الموعد النهائي للعروض" })
    } else {
      const deadlineDate = new Date(formData.deadline)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (deadlineDate < today) {
        errors.push({ field: "deadline", message: "الموعد النهائي يجب أن يكون في المستقبل" })
      }
    }
    
    return errors
  }

  const showErrors = (errors: ValidationError[]) => {
    setValidationErrors(errors)
    if (errors.length > 0) {
      const firstError = errors[0]
      const fieldElement = document.getElementById(firstError.field)
      if (fieldElement) {
        fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      
      toast({
        title: "بيانات ناقصة",
        description: errors[0].message,
        variant: "destructive"
      })
    }
  }

  const nextStep = () => {
    const errors = step === 1 ? validateStep1() : step === 2 ? validateStep2() : []
    
    if (errors.length > 0) {
      showErrors(errors)
      return
    }
    
    setValidationErrors([])
    setStep(s => s + 1)
  }

  const prevStep = () => {
    setStep(s => s - 1)
    setValidationErrors([])
  }

  const handleAiDraft = async () => {
    clearError("title")
    if (!formData.title || !formData.category) {
      toast({
        title: "بيانات ناقصة",
        description: "يرجى إدخال العنوان والفئة ليتمكن الذكاء الاصطناعي من مساعدتك.",
        variant: "destructive"
      })
      return
    }

    setIsGenerating(true)
    try {
      const firstProduct = products[0]
      const result = await draftRfqDescription({
        keywords: formData.title,
        category: formData.category,
        quantity: Number(firstProduct?.quantity) || 1,
        unit: firstProduct?.unit || "عدد",
        notes: formData.notes
      })

      setFormData(prev => ({
        ...prev,
        title: result.title,
        notes: result.description
      }))

      toast({
        title: "تم التحسين!",
        description: "قام الذكاء الاصطناعي بصياغة طلب احترافي لك.",
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('API key') || errorMessage.includes('GEMINI_API_KEY') || errorMessage.includes('GOOGLE_API_KEY')) {
        toast({
          title: "الذكاء الاصطناعي غير متاح",
          description: "يرجى إضافة مفتاح API للذكاء الاصطناعي في إعدادات المشروع.",
          variant: "destructive"
        })
      } else {
        toast({
          title: "خطأ",
          description: "فشل إنشاء الوصف بالذكاء الاصطناعي.",
          variant: "destructive"
        })
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSubmit = async (status: "Draft" | "New" = "New") => {
    if (!firestore || !user) return

    const validProducts = products.filter(p => p.name && p.quantity && p.unit)
    if (validProducts.length === 0) {
      toast({ title: "بيانات ناقصة", description: "يرجى إضافة منتج واحد على الأقل", variant: "destructive" })
      return
    }
    if (!formData.title || !formData.category || !formData.city || !formData.deadline) {
      toast({ title: "بيانات ناقصة", description: "يرجى إكمال بيانات المناقصة الأساسية", variant: "destructive" })
      return
    }

    setIsSubmitting(true)
    const rfqsRef = collection(firestore, "rfqs")

    const rfqData = {
      contractorId: user.uid,
      title: formData.title,
      category: formData.category,
      subCategory: formData.subCategory,
      products: validProducts.map(p => ({
        name: p.name,
        quantity: Number(p.quantity),
        unitOfMeasure: p.unit,
        description: p.description
      })),
      deadline: formData.deadline,
      city: formData.city,
      district: formData.district || "",
      isQualityCertificateRequired: formData.certRequired,
      visibility: formData.visibility,
      notes: formData.notes,
      pdfUrl: formData.pdfUrl,
      pdfStoragePath: formData.pdfStoragePath,
      status: status,
      createdAt: new Date().toISOString()
    }

    addDocumentNonBlocking(rfqsRef, rfqData)

    if (status === "Draft") {
      toast({
        title: "تم الحفظ!",
        description: "تم حفظ المناقصة كمسودة. يمكنك نشرها لاحقاً من قائمة المناقصات.",
      })
      setFormData({
        title: "",
        category: "",
        subCategory: "",
        city: "",
        district: "",
        deadline: "",
        notes: "",
        certRequired: false,
        visibility: "public",
        pdfUrl: null,
        pdfStoragePath: null
      })
      setProducts([{ id: "1", name: "", quantity: "", unit: "", description: "" }])
      setStep(1)
      setIsSubmitting(false)
    } else {
      toast({
        title: "تم النشر!",
        description: "تم نشر المناقصة بنجاح وهي الآن متاحة للموردين.",
      })
      router.push("/contractor/rfqs")
    }
  }

  const hasError = (field: string) => validationErrors.some(e => e.field === field)

  return (
    <PortalLayout>
      <div className="max-w-4xl mx-auto py-8 text-right">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-secondary font-headline">طرح مناقصة جديدة</h1>
          <p className="text-muted-foreground mt-2">املأ البيانات التالية للوصول إلى أفضل الموردين</p>
        </div>

        <div className="flex items-center justify-center gap-4 mb-8">
          {[
            { step: 1, label: "تفاصيل المنتج", icon: FileText },
            { step: 2, label: "الموقع والمواعيد", icon: MapPin },
            { step: 3, label: "تأكيد النشر", icon: ClipboardCheck }
          ].map(({ step: s, label, icon: Icon }, idx) => (
            <div key={s} className="flex items-center">
              <button
                onClick={() => step >= s && setStep(s)}
                disabled={step < s}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300 ${
                  step === s 
                    ? "bg-primary text-white shadow-lg shadow-primary/25 cursor-pointer" 
                    : step > s 
                      ? "bg-success/10 text-success border border-success/20 cursor-pointer hover:bg-success/20" 
                      : "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                }`}
              >
                {step > s ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                <span className="font-bold text-sm">{label}</span>
              </button>
              {idx < 2 && (
                <ChevronLeft size={20} className="mx-2 text-slate-300" />
              )}
            </div>
          ))}
        </div>

        {validationErrors.length > 0 && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-start gap-3">
            <AlertCircle className="text-destructive shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <p className="font-bold text-destructive text-sm">يرجى إصلاح الأخطاء التالية:</p>
              <ul className="mt-2 space-y-1 text-sm text-destructive/80">
                {validationErrors.map((error, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <Card className="shadow-xl border-0 overflow-hidden">
          <CardContent className="p-0">
            {step === 1 && (
              <div className="p-8 space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-bold text-slate-700">
                      عنوان المناقصة<RequiredStar />
                    </Label>
                    {isAiEnabled && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAiDraft}
                        disabled={isGenerating}
                        className={`text-xs h-8 gap-2 border border-amber-400 bg-amber-50 text-amber-700 rounded-lg transition-all duration-200 ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-amber-500 hover:text-white hover:border-amber-500 cursor-pointer'}`}
                      >
                        <Zap size={14} className={isGenerating ? "animate-pulse" : ""} />
                        تحسين بالذكاء الاصطناعي
                      </Button>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="title"
                      placeholder="مثال: توريد حديد تسليح لمشروع في الرياض"
                      value={formData.title}
                      onChange={e => {
                        setFormData({ ...formData, title: e.target.value })
                        clearError("title")
                      }}
                      className={`h-12 text-lg border-slate-200 focus:border-primary focus:ring-primary/20 rounded-xl ${hasError("title") ? 'border-destructive ring-1 ring-destructive' : ''}`}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">عنوان واضح يسهل على الموردين البحث والفرز</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">
                      الفئة الرئيسية<RequiredStar />
                    </Label>
                    <Select 
                      value={formData.category}
                      onValueChange={v => {
                        setFormData({ ...formData, category: v, subCategory: "" })
                        clearError("category")
                      }}
                    >
                      <SelectTrigger className={`h-12 rounded-xl border-slate-200 cursor-pointer ${hasError("category") ? 'border-destructive ring-1 ring-destructive' : ''}`}>
                        <SelectValue placeholder="اختر الفئة" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(CATEGORIES_DATA).map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">التصنيف الفرعي</Label>
                    <Select
                      disabled={!formData.category}
                      onValueChange={v => setFormData({ ...formData, subCategory: v })}
                      value={formData.subCategory}
                    >
                      <SelectTrigger className="h-12 rounded-xl border-slate-200 cursor-pointer">
                        <SelectValue placeholder={formData.category ? "اختر النوع" : "اختر الفئة أولاً"} />
                      </SelectTrigger>
                      <SelectContent>
                        {formData.category && (CATEGORIES_DATA[formData.category] || []).map(sub => (
                          <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent pointer-events-none" style={{ height: '1px' }} />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <FileText size={20} className="text-primary" />
                      </div>
                      <div>
                        <Label className="text-lg font-bold text-slate-800">
                          المنتجات المطلوبة<RequiredStar />
                        </Label>
                        <p className="text-xs text-slate-500 mt-0.5">أضف كل المنتجات التي تحتاجها في هذه المناقصة</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={addProduct} className="gap-2 border-slate-300 bg-white hover:bg-primary hover:text-white hover:border-primary rounded-xl h-10 px-4 cursor-pointer transition-colors duration-200">
                      <Plus size={16} />
                      إضافة منتج
                    </Button>
                  </div>
                  {hasError("products") && (
                    <div className="mb-4 p-3 bg-destructive/5 border border-destructive/20 rounded-lg text-sm text-destructive flex items-center gap-2">
                      <AlertCircle size={16} />
                      {validationErrors.find(e => e.field === "products")?.message}
                    </div>
                  )}
                  <div className="space-y-4">
                    {products.map((product, index) => (
                      <div key={product.id} className="p-6 bg-gradient-to-br from-white to-slate-50 rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-md transition-all duration-200">
                        <div className="flex items-center justify-between mb-5">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold">
                              {index + 1}
                            </div>
                            <span className="text-base font-bold text-slate-700">المنتج</span>
                          </div>
                          {products.length > 1 && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => removeProduct(product.id)} 
                              className="text-red-500 hover:bg-red-50 hover:text-red-600 h-8 px-3 rounded-lg cursor-pointer transition-colors"
                            >
                              <Trash2 size={16} />
                              <span className="mr-1 text-xs">حذف</span>
                            </Button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-slate-600">
                              اسم المنتج<RequiredStar />
                            </Label>
                            <Input
                              placeholder="مثال: حديد تسليح طولي"
                              value={product.name}
                              onChange={e => updateProduct(product.id, "name", e.target.value)}
                              className="h-11 rounded-xl border-slate-200"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-slate-600">
                              الكمية المطلوبة<RequiredStar />
                            </Label>
                            <Input
                              type="number"
                              placeholder="0"
                              value={product.quantity}
                              onChange={e => updateProduct(product.id, "quantity", e.target.value)}
                              className="h-11 rounded-xl border-slate-200"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-slate-600">
                              وحدة القياس<RequiredStar />
                            </Label>
                            <Input
                              placeholder="طن - متر - قطعة"
                              value={product.unit}
                              onChange={e => updateProduct(product.id, "unit", e.target.value)}
                              className="h-11 rounded-xl border-slate-200"
                            />
                          </div>
                        </div>
                        <div className="mt-5">
                          <Label className="text-xs font-semibold text-slate-600">المواصفات التقنية (اختياري)</Label>
                          <Textarea
                            placeholder="اكتب أي مواصفات فنية، معايير، أو متطلبات خاصة..."
                            rows={2}
                            value={product.description}
                            onChange={e => updateProduct(product.id, "description", e.target.value)}
                            className="mt-2 rounded-xl border-slate-200 resize-none"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 p-6 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <Label className="text-base font-bold text-slate-700">ملاحظات إضافية</Label>
                  <Textarea
                    rows={3}
                    placeholder="أي ملاحظات عامة، شروط خاصة، أو معلومات إضافية للموردين..."
                    value={formData.notes}
                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                    className="rounded-xl border-slate-200 bg-white"
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-blue-50 flex items-center justify-center">
                      <FileText size={18} className="text-blue-600" />
                    </div>
                    <Label className="text-base font-bold text-slate-700">ملفات PDF مرفقة (اختياري)</Label>
                  </div>
                  {formData.pdfUrl ? (
                    <div className="flex items-center gap-4 p-5 bg-blue-50/50 border border-blue-200/50 rounded-2xl">
                      <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center">
                        <File size={24} className="text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-semibold text-blue-800">تم إرفاق ملف PDF</span>
                        <p className="text-xs text-blue-600/70 mt-0.5">ملف PDF جاهز للإرسال مع المناقصة</p>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={removePdf} 
                        className="text-red-500 hover:bg-red-50 hover:text-red-600 cursor-pointer rounded-lg"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        ref={pdfInputRef}
                        type="file"
                        accept=".pdf"
                        onChange={handlePdfUpload}
                        disabled={isUploadingPdf}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                      />
                      <div className="flex items-center justify-center gap-3 h-28 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 text-slate-500 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group">
                        {isUploadingPdf ? (
                          <Loader2 size={24} className="animate-spin text-primary" />
                        ) : (
                          <>
                            <div className="h-12 w-12 rounded-xl bg-slate-100 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                              <Upload size={20} className="text-slate-400 group-hover:text-primary transition-colors" />
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-semibold text-slate-700 block">اضغط لرفع ملف PDF</span>
                              <span className="text-xs text-slate-400">الرسومات والمواصفات الفنية</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="p-8 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">
                      المدينة<RequiredStar />
                    </Label>
                    <Select 
                      value={formData.city} 
                      onValueChange={v => {
                        setFormData({ ...formData, city: v, district: "" })
                        clearError("city")
                      }}
                    >
                      <SelectTrigger className={`h-12 rounded-xl border-slate-200 cursor-pointer ${hasError("city") ? 'border-destructive ring-1 ring-destructive' : ''}`}>
                        <SelectValue placeholder="اختر المدينة" />
                      </SelectTrigger>
                      <SelectContent>
                        {SAUDI_CITIES.map(city => (
                          <SelectItem key={city} value={city}>{city}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">المنطقة / الحي</Label>
                    <Select
                      disabled={!formData.city}
                      onValueChange={v => setFormData({ ...formData, district: v })}
                      value={formData.district}
                    >
                      <SelectTrigger className="h-12 rounded-xl border-slate-200 cursor-pointer">
                        <SelectValue placeholder={formData.city ? "اختر الحي" : "اختر المدينة أولاً"} />
                      </SelectTrigger>
                      <SelectContent>
                        {formData.city && (CITIES_DISTRICTS[formData.city] || ["شمال", "جنوب", "شرق", "غرب", "وسط", "جميع"]).map(dist => (
                          <SelectItem key={dist} value={dist}>{dist}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-4 p-6 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-amber-50 flex items-center justify-center">
                      <MapPin size={18} className="text-amber-600" />
                    </div>
                    <div>
                      <Label className="text-base font-bold text-slate-700">معلومات التوريد</Label>
                      <p className="text-xs text-slate-500 mt-0.5">سيتمكن الموردون من رؤية المدينة والمنطقة فقط</p>
                    </div>
                  </div>
                  <div className="p-4 bg-amber-50/50 rounded-xl border border-amber-200/50">
                    <p className="text-sm text-amber-800 flex items-center gap-2">
                      <AlertCircle size={16} className="shrink-0" />
                      <span>يتم عرض موقع التوريد على مستوى المدينة فقط للحفاظ على خصوصية المشروع</span>
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">
                      الموعد النهائي للعروض<RequiredStar />
                    </Label>
                    <input
                      type="date"
                      id="deadline"
                      value={formData.deadline}
                      onChange={e => {
                        setFormData({ ...formData, deadline: e.target.value })
                        clearError("deadline")
                      }}
                      className={`flex h-12 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm cursor-pointer ${hasError("deadline") ? 'border-destructive ring-1 ring-destructive' : ''}`}
                      dir="ltr"
                      min={new Date().toISOString().split('T')[0]}
                    />
                    {formData.deadline && (
                      <p className="text-xs text-muted-foreground">
                        الموعد النهائي: {new Date(formData.deadline).toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="p-8 space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <ClipboardCheck size={18} className="text-primary" />
                    </div>
                    <Label className="text-base font-bold text-slate-700">نطاق نشر المناقصة</Label>
                  </div>
                  <RadioGroup 
                    value={formData.visibility} 
                    onValueChange={(v) => setFormData({...formData, visibility: v as "public" | "favorites"})}
                    className="space-y-3 mt-2"
                  >
                    <div className="flex items-start gap-4 p-5 rounded-2xl border-2 border-slate-200 cursor-pointer hover:bg-slate-50 hover:border-primary/30 transition-all group">
                      <RadioGroupItem value="public" id="r-public" className="mt-1 cursor-pointer" />
                      <div className="flex-1">
                        <Label htmlFor="r-public" className="font-bold text-base text-slate-800 cursor-pointer block">عام (جميع الموردين)</Label>
                        <p className="text-sm text-slate-500 mt-2">تظهر المناقصة لجميع الموردين المتخصصين في نفس الفئة</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4 p-5 rounded-2xl border-2 border-slate-200 cursor-pointer hover:bg-slate-50 hover:border-primary/30 transition-all group">
                      <RadioGroupItem value="favorites" id="r-favorites" className="mt-1 cursor-pointer" />
                      <div className="flex-1">
                        <Label htmlFor="r-favorites" className="font-bold text-base text-slate-800 cursor-pointer block">خاص (الموردون المفضلون)</Label>
                        <p className="text-sm text-slate-500 mt-2">تظهر المناقصة حصرياً للموردين في قائمتك المفضلة</p>
                      </div>
                    </div>
                  </RadioGroup>
                </div>

                <div className="relative flex items-center justify-between p-6 bg-gradient-to-r from-amber-50/50 to-orange-50/50 rounded-2xl border border-amber-200/50">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                      <FileText size={24} className="text-amber-600" />
                    </div>
                    <div>
                      <Label className="text-base font-bold text-slate-800">شهادة جودة مطلوبة</Label>
                      <p className="text-sm text-slate-500 mt-1">حصر المشاركة على الموردين الحاصلين على شهادات معتمدة</p>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <Switch
                      checked={formData.certRequired}
                      onCheckedChange={v => setFormData({ ...formData, certRequired: v })}
                    />
                  </div>
                </div>

                <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200">
                  <h4 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                    <FileText size={18} className="text-primary" />
                    ملخص المناقصة
                  </h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="p-3 bg-white rounded-lg">
                      <span className="text-muted-foreground">العنوان:</span>
                      <span className="font-bold mr-2">{formData.title || "-"}</span>
                    </div>
                    <div className="p-3 bg-white rounded-lg">
                      <span className="text-muted-foreground">الفئة:</span>
                      <span className="font-bold mr-2">{formData.category || "-"}</span>
                    </div>
                    <div className="p-3 bg-white rounded-lg">
                      <span className="text-muted-foreground">المدينة:</span>
                      <span className="font-bold mr-2">{formData.city || "-"}</span>
                    </div>
                    <div className="p-3 bg-white rounded-lg">
                      <span className="text-muted-foreground">المنطقة:</span>
                      <span className="font-bold mr-2">{formData.district || "-"}</span>
                    </div>
                    <div className="p-3 bg-white rounded-lg">
                      <span className="text-muted-foreground">الموعد النهائي:</span>
                      <span className="font-bold mr-2">{formData.deadline ? new Date(formData.deadline).toLocaleDateString('ar-SA') : "-"}</span>
                    </div>
                    <div className="p-3 bg-white rounded-lg">
                      <span className="text-muted-foreground">المنتجات:</span>
                      <span className="font-bold mr-2">{products.filter(p => p.name).length} منتج</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>

          <div className="flex items-center justify-between border-t bg-slate-50/50 p-6">
            <Button
              variant="outline"
              onClick={prevStep}
              disabled={step === 1 || isSubmitting}
              className={`gap-2 px-6 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 ${step === 1 || isSubmitting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              <ChevronRight size={18} />
              السابق
            </Button>

            {step < 3 ? (
              <Button onClick={nextStep} className="gap-2 px-8 rounded-xl cursor-pointer shadow-lg shadow-primary/25">
                التالي
                <ChevronLeft size={18} />
              </Button>
            ) : (
              <div className="flex gap-3 flex-wrap">
                <Button
                  onClick={() => handleSubmit("Draft")}
                  disabled={isSubmitting}
                  variant="outline"
                  className={`gap-2 px-8 rounded-xl ${isSubmitting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-primary/5'}`}
                >
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  حفظ كمسودة
                </Button>
                <Button
                  onClick={() => handleSubmit("New")}
                  disabled={isSubmitting}
                  className={`bg-success hover:bg-success/90 gap-2 px-10 rounded-xl shadow-lg shadow-success/25 ${isSubmitting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                >
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                  نشر المناقصة الآن
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </PortalLayout>
  )
}