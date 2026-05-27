"use client"

import { useState, useRef } from "react"
import { useRouter } from "@/i18n/routing"
import { useTranslations, useLocale } from 'next-intl'
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
import { useFirestore, useUser, useStorage, addDocumentNonBlocking, useDoc, useMemoFirebase } from "@/firebase"
import { collection, doc } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"
import { CATEGORIES_DATA, displayCity, displayCategory, displaySubcategory } from "@/lib/constants"
import { cn } from "@/lib/utils"

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
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const [step, setStep] = useState(1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const { toast } = useToast()
  const router = useRouter()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const storage = useStorage()
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile, isLoading: isProfileLoading } = useDoc(userDocRef)

  // ── All useState/useRef hooks MUST be declared before any early returns ──
  const [formData, setFormData] = useState({
    title: "",
    city: "",
    district: "",
    deadline: "",
    notes: "",
    pdfUrl: null as string | null,
    pdfStoragePath: null as string | null
  })

  interface Product {
    id: string
    name: string
    quantity: string
    unit: string
    description: string
    category: string
    subCategory: string
    otherSubCategory?: string
  }

  const [products, setProducts] = useState<Product[]>([
    { id: "1", name: "", quantity: "", unit: "", description: "", category: "", subCategory: "" }
  ])

  const [isUploadingPdf, setIsUploadingPdf] = useState(false)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  if (isUserLoading || isProfileLoading) {
    return (
      <PortalLayout>
        <div className="flex justify-center items-center h-[60vh]">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      </PortalLayout>
    )
  }

  if (profile && !profile.profileCompleted) {
    return (
      <PortalLayout>
        <div className="max-w-md mx-auto py-12 text-center space-y-6 bg-white rounded-[2rem] p-8 border border-slate-100 shadow-xl mt-12" dir="rtl">
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-200">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-2xl font-black text-slate-800 font-headline">{t("newrfq_profile_incomplete")}</h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            {t("newrfq_profile_incomplete_desc")}
          </p>
          <div className="pt-4">
            <Button
              onClick={() => router.push("/contractor/profile")}
              className="w-full h-12 bg-primary hover:bg-secondary text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-xl"
            >
              {t("newrfq_go_to_profile")}
            </Button>
          </div>
        </div>
      </PortalLayout>
    )
  }

  if (profile && !profile.isVerified) {
    return (
      <PortalLayout>
        <div className="max-w-md mx-auto py-12 text-center space-y-6 bg-white rounded-[2rem] p-8 border border-slate-100 shadow-xl mt-12" dir="rtl">
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-200">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-2xl font-black text-slate-800 font-headline">{t("newrfq_verification_required")}</h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            {t("newrfq_verification_required_desc")}
          </p>
          <div className="pt-4">
            <Button
              onClick={() => router.push("/contractor/profile")}
              className="w-full h-12 bg-primary hover:bg-secondary text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-xl"
            >
              {t("newrfq_go_to_profile_verify")}
            </Button>
          </div>
        </div>
      </PortalLayout>
    )
  }

  const isAiEnabled = process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY

  const addProduct = () => {
    setProducts([...products, { id: Date.now().toString(), name: "", quantity: "", unit: "", description: "", category: "", subCategory: "" }])
  }

  const removeProduct = (id: string) => {
    if (products.length > 1) {
      setProducts(products.filter(p => p.id !== id))
    }
  }

  const updateProduct = (id: string, field: keyof Product, value: string) => {
    setProducts(products.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== "application/pdf") {
      toast({ title: t("newrfq_upload_error"), variant: "destructive" })
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
      toast({ title: t("newrfq_upload_success"), description: t("newrfq_upload_success_desc") })
    } catch (error) {
      console.error("PDF upload failed:", error)
      toast({ title: t("newrfq_incomplete_data"), description: t("newrfq_upload_failed"), variant: "destructive" })
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
      errors.push({ field: "title", message: t("newrfq_val_title_required") })
    }

    const validProducts = products.filter(p => 
      p.name.trim() && 
      p.quantity.trim() && 
      p.unit.trim() && 
      p.category && 
      (p.subCategory === "أخرى" ? p.otherSubCategory?.trim() : p.subCategory)
    )
    if (validProducts.length === 0) {
      errors.push({ field: "products", message: t("newrfq_val_product_required") })
    }
    
    return errors
  }

  const validateStep2 = (): ValidationError[] => {
    const errors: ValidationError[] = []
    
    if (!formData.city) {
      errors.push({ field: "city", message: t("newrfq_val_city_required") })
    }
    
    if (!formData.deadline) {
      errors.push({ field: "deadline", message: t("newrfq_val_deadline_required") })
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
        title: t("newrfq_incomplete_data"),
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
    const firstProduct = products[0]
    if (!formData.title || !firstProduct?.category) {
      toast({
        title: t("newrfq_incomplete_data"),
        description: t("newrfq_ai_not_available_desc"),
        variant: "destructive"
      })
      return
    }

    setIsGenerating(true)
    try {
      const result = await draftRfqDescription({
        keywords: formData.title,
        category: firstProduct.category,
        quantity: Number(firstProduct.quantity) || 1,
        unit: firstProduct.unit || "عدد",
        notes: formData.notes
      })

      setFormData(prev => ({
        ...prev,
        title: result.title,
        notes: result.description
      }))

      toast({
        title: t("newrfq_ai_enhanced"),
        description: t("newrfq_ai_enhanced_desc"),
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('API key') || errorMessage.includes('GEMINI_API_KEY') || errorMessage.includes('GOOGLE_API_KEY')) {
        toast({
          title: t("newrfq_ai_not_available"),
          description: t("newrfq_ai_not_available_desc"),
          variant: "destructive"
        })
      } else {
        toast({
          title: t("newrfq_incomplete_data"),
          description: t("newrfq_ai_draft_failed"),
          variant: "destructive"
        })
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSubmit = async (status: "Draft" | "New" = "New") => {
    if (!firestore || !user) return

    // Perform full validation
    const step1Errors = validateStep1()
    const step2Errors = validateStep2()
    const allErrors = [...step1Errors, ...step2Errors]

    if (allErrors.length > 0) {
      // If we are at step 1 but there are errors in step 2 (shouldn't happen often)
      // or if we are at step 2 and there are errors in step 1.
      showErrors(allErrors)
      return
    }

    const validProducts = products.filter(p => 
      p.name.trim() && 
      p.quantity.trim() && 
      p.unit.trim() && 
      p.category && 
      (p.subCategory === "أخرى" ? p.otherSubCategory?.trim() : p.subCategory)
    )

    setIsSubmitting(true)
    const rfqsRef = collection(firestore, "rfqs")

    // Group products by their main category
    const groupedProducts = validProducts.reduce((acc, product) => {
      const cat = product.category
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(product)
      return acc
    }, {} as Record<string, typeof validProducts>)

    const categories = Object.keys(groupedProducts)

    for (const cat of categories) {
      const catProducts = groupedProducts[cat]
      const rfqTitle = categories.length > 1 ? `${formData.title} - ${cat}` : formData.title

      const rfqData = {
        contractorId: user.uid,
        organizationId: profile?.organizationId || user.uid, // Fallback to UID if orgId not present
        title: rfqTitle,
        category: cat,
        // If there's only one product or all products share the same subcategory, use it. Otherwise, leave empty.
        subCategory: catProducts.every(p => p.subCategory === catProducts[0].subCategory) 
          ? (catProducts[0].subCategory === "أخرى" ? catProducts[0].otherSubCategory : catProducts[0].subCategory) 
          : "متعدد",
        products: catProducts.map(p => ({
          name: p.name,
          quantity: Number(p.quantity),
          unitOfMeasure: p.unit,
          description: p.description,
          category: p.category,
          subCategory: p.subCategory === "أخرى" ? p.otherSubCategory : p.subCategory
        })),
        deadline: formData.deadline,
        city: formData.city,
        district: formData.district,
        notes: formData.notes,
        pdfUrl: formData.pdfUrl,
        pdfStoragePath: formData.pdfStoragePath,
        status: status,
        visibility: "public",
        createdByUserId: user.uid,
        createdByUserName: profile?.name || user.email || "عضو الفريق",
        createdAt: new Date().toISOString()
      }

      addDocumentNonBlocking(rfqsRef, rfqData)
    }

    if (status === "Draft") {
      toast({
        title: t("newrfq_toast_saved"),
        description: t("newrfq_toast_saved_desc"),
      })
      setFormData({
        title: "",
        city: "",
        district: "",
        deadline: "",
        notes: "",
        pdfUrl: null,
        pdfStoragePath: null
      })
      setProducts([{ id: "1", name: "", quantity: "", unit: "", description: "", category: "", subCategory: "" }])
      setStep(1)
      setIsSubmitting(false)
    } else {
      toast({
        title: t("newrfq_toast_published"),
        description: t("newrfq_toast_published_desc"),
      })
      router.push("/contractor/rfqs")
    }
  }

  const hasError = (field: string) => validationErrors.some(e => e.field === field)

  return (
    <PortalLayout>
      <div className={cn("max-w-4xl mx-auto py-8", locale === 'ar' ? 'text-right' : 'text-left')}>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-secondary font-headline">{t("newrfq_page_title")}</h1>
          <p className="text-muted-foreground mt-2">{t("newrfq_page_desc")}</p>
        </div>

        <div className="flex items-center justify-center gap-4 mb-8">
          {[
            { step: 1, label: t("newrfq_step_request_details"), icon: FileText },
            { step: 2, label: t("newrfq_step_location_date"), icon: MapPin },
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
              {idx < 1 && (
                locale === 'ar' ? <ChevronLeft size={20} className="mx-2 text-slate-300" /> : <ChevronRight size={20} className="mx-2 text-slate-300" />
              )}
            </div>
          ))}
        </div>

        {validationErrors.length > 0 && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-start gap-3">
            <AlertCircle className="text-destructive shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <p className="font-bold text-destructive text-sm">{t("newrfq_errors_title")}</p>
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
                      {t("newrfq_tender_title")}<RequiredStar />
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
                        {t("newrfq_ai_enhance")}
                      </Button>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="title"
                      placeholder={t("newrfq_tender_title_placeholder")}
                      value={formData.title}
                      onChange={e => {
                        setFormData({ ...formData, title: e.target.value })
                        clearError("title")
                      }}
                      className={`h-12 text-lg border-slate-200 focus:border-primary focus:ring-primary/20 rounded-xl ${hasError("title") ? 'border-destructive ring-1 ring-destructive' : ''}`}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{t("newrfq_tender_title_help")}</p>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent pointer-events-none" style={{ height: '1px' }} />
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
                          {t("newrfq_requested_products")}<RequiredStar />
                        </Label>
                        <p className="text-xs text-slate-500 mt-0.5">{t("newrfq_products_help")}</p>
                      </div>
                    </div>
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
                            <span className="text-base font-bold text-slate-700">{t("newrfq_product_label")}</span>
                          </div>
                          {products.length > 1 && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => removeProduct(product.id)} 
                              className="text-red-500 hover:bg-red-50 hover:text-red-600 h-8 px-3 rounded-lg cursor-pointer transition-colors"
                            >
                              <Trash2 size={16} />
                              <span className="mr-1 text-xs">{t("newrfq_delete_label")}</span>
                            </Button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-slate-600">
                              {t("newrfq_main_category")}<RequiredStar />
                            </Label>
                            <Select 
                              value={product.category}
                              onValueChange={v => updateProduct(product.id, "category", v)}
                            >
                              <SelectTrigger className="h-11 rounded-xl border-slate-200">
                                <SelectValue placeholder={t("newrfq_select_category")} />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.keys(CATEGORIES_DATA).map(cat => (
                                  <SelectItem key={cat} value={cat}>{displayCategory(cat, locale)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-slate-600">
                              {t("newrfq_sub_category")}<RequiredStar />
                            </Label>
                            <Select 
                              value={product.subCategory}
                              onValueChange={v => updateProduct(product.id, "subCategory", v)}
                            >
                              <SelectTrigger className="h-11 rounded-xl border-slate-200">
                                <SelectValue placeholder={t("newrfq_select_sub_category")} />
                              </SelectTrigger>
                              <SelectContent>
                                {product.category && CATEGORIES_DATA[product.category]?.map(sub => (
                                  <SelectItem key={sub} value={sub}>{displaySubcategory(sub, locale)}</SelectItem>
                                ))}
                                <SelectItem value="أخرى">{t("newrfq_other_category")}</SelectItem>
                              </SelectContent>
                            </Select>
                            {product.subCategory === "أخرى" && (
                              <Input
                                placeholder={t("newrfq_other_category_placeholder")}
                                value={product.otherSubCategory || ""}
                                onChange={e => updateProduct(product.id, "otherSubCategory", e.target.value)}
                                className="h-11 rounded-xl border-slate-200 mt-2"
                              />
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-slate-600">
                              {t("newrfq_product_name")}<RequiredStar />
                            </Label>
                            <Input
                              placeholder={t("newrfq_product_name_placeholder")}
                              value={product.name}
                              onChange={e => updateProduct(product.id, "name", e.target.value)}
                              className="h-11 rounded-xl border-slate-200"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-slate-600">
                              {t("newrfq_quantity")}<RequiredStar />
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
                              {t("newrfq_unit_of_measure")}<RequiredStar />
                            </Label>
                            <Input
                              placeholder={t("newrfq_unit_placeholder")}
                              value={product.unit}
                              onChange={e => updateProduct(product.id, "unit", e.target.value)}
                              className="h-11 rounded-xl border-slate-200"
                            />
                          </div>
                        </div>
                        <div className="mt-5">
                          <Label className="text-xs font-semibold text-slate-600">{t("newrfq_specifications")}</Label>
                          <Textarea
                            placeholder={t("newrfq_spec_placeholder")}
                            rows={2}
                            value={product.description}
                            onChange={e => updateProduct(product.id, "description", e.target.value)}
                            className="mt-2 rounded-xl border-slate-200 resize-none"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-8 flex justify-center">
                    <Button variant="outline" size="sm" onClick={addProduct} className="gap-2 border-slate-300 bg-white hover:bg-primary hover:text-white hover:border-primary rounded-xl h-11 px-8 cursor-pointer transition-all shadow-sm">
                      <Plus size={18} />
                      {t("newrfq_add_product")}
                    </Button>
                  </div>
                </div>

                <div className="space-y-4 p-6 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <Label className="text-base font-bold text-slate-700">{t("newrfq_additional_notes")}</Label>
                  <Textarea
                    rows={3}
                    placeholder={t("newrfq_notes_placeholder")}
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
                    <Label className="text-base font-bold text-slate-700">{t("newrfq_pdf_files")}</Label>
                  </div>
                  {formData.pdfUrl ? (
                    <div className="flex items-center gap-4 p-5 bg-blue-50/50 border border-blue-200/50 rounded-2xl">
                      <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center">
                        <File size={24} className="text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-semibold text-blue-800">{t("newrfq_pdf_attached")}</span>
                        <p className="text-xs text-blue-600/70 mt-0.5">{t("newrfq_pdf_attached_desc")}</p>
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
                              <span className="text-sm font-semibold text-slate-700 block">{t("newrfq_click_upload_pdf")}</span>
                              <span className="text-xs text-slate-400">{t("newrfq_pdf_technical_desc")}</span>
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
                      {t("newrfq_city_label")}
                    </Label>
                    <Select 
                      value={formData.city} 
                      onValueChange={v => {
                        setFormData({ ...formData, city: v, district: "" })
                        clearError("city")
                      }}
                    >
                      <SelectTrigger className={`h-12 rounded-xl border-slate-200 cursor-pointer ${hasError("city") ? 'border-destructive ring-1 ring-destructive' : ''}`}>
                        <SelectValue placeholder={t("newrfq_select_city")} />
                      </SelectTrigger>
                      <SelectContent className="max-h-72 overflow-y-auto">
                        {SAUDI_CITIES.map(city => (
                          <SelectItem key={city} value={city}>{displayCity(city, locale)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {formData.city && CITIES_DISTRICTS[formData.city] && (
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold text-slate-700">
                        {t("newrfq_district_label")}
                      </Label>
                      <Select 
                        value={formData.district} 
                        onValueChange={v => {
                          setFormData({ ...formData, district: v })
                          clearError("district")
                        }}
                      >
                        <SelectTrigger className={`h-12 rounded-xl border-slate-200 cursor-pointer ${hasError("district") ? 'border-destructive ring-1 ring-destructive' : ''}`}>
                          <SelectValue placeholder={t("newrfq_select_district")} />
                        </SelectTrigger>
                        <SelectContent>
                          {CITIES_DISTRICTS[formData.city].map(dist => (
                            <SelectItem key={dist} value={dist}>{dist}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="space-y-4 p-6 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-amber-50 flex items-center justify-center">
                      <MapPin size={18} className="text-amber-600" />
                    </div>
                    <div>
                      <Label className="text-base font-bold text-slate-700">{t("newrfq_supply_info")}</Label>
                      <p className="text-xs text-slate-500 mt-0.5">{t("newrfq_supply_info_help")}</p>
                    </div>
                  </div>
                  <div className="p-4 bg-amber-50/50 rounded-xl border border-amber-200/50">
                    <p className="text-sm text-amber-800 flex items-center gap-2">
                      <AlertCircle size={16} className="shrink-0" />
                      <span>{t("newrfq_supply_info_note")}</span>
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">
                      {t("newrfq_deadline_label")}<RequiredStar />
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
                        {t("newrfq_deadline_display", { date: new Date(formData.deadline).toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) })}
                      </p>
                    )}
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
              {locale === 'ar' ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              {t("newrfq_prev")}
            </Button>

            {step === 1 ? (
              <Button onClick={nextStep} className="gap-2 px-8 rounded-xl cursor-pointer shadow-lg shadow-primary/25">
                {t("newrfq_next")}
                {locale === 'ar' ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
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
                  {t("newrfq_save_draft")}
                </Button>
                <Button
                  onClick={() => handleSubmit("New")}
                  disabled={isSubmitting}
                  className={`bg-success hover:bg-success/90 gap-2 px-10 rounded-xl shadow-lg shadow-success/25 ${isSubmitting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                >
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                  {t("newrfq_publish_now")}
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </PortalLayout>
  )
}