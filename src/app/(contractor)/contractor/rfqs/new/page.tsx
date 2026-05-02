
"use client"

import { useState } from "react"
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { MapPicker } from "@/components/ui/map-picker"
import { 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2,
  FileText,
  MapPin,
  ClipboardCheck,
  Zap,
  Loader2
} from "lucide-react"
import { draftRfqDescription } from "@/ai/flows/draft-rfq-description-flow"
import { useToast } from "@/hooks/use-toast"
import { useFirestore, useUser, addDocumentNonBlocking } from "@/firebase"
import { collection } from "firebase/firestore"

const CATEGORIES_DATA = {
  "حديد ومعادن": ["حديد تسليح", "حديد صناعي", "ألواح صاج", "شبك حديد", "ألمنيوم"],
  "أسمنت وخرسانة": ["أسمنت بورتلاندي", "أسمنت أبيض", "أسمنت مقاوم", "خرسانة جاهزة", "بلوك أسمنتي"],
  "أرضيات وتشطيبات": ["سيراميك", "بورسلان", "رخام", "جرانيت", "باركيه"],
  "كهرباء وإنارة": ["كابلات وأسلاك", "لوحات توزيع", "أفياش ومفاتيح", "إضاءة داخلية", "إضاءة خارجية"],
  "أدوات صحية وسباكة": ["مواسير حرارية", "مواسير صرف", "أطقم حمامات", "محابس وعوامات", "مضخات مياه", "خزانات مياه"],
  "عزل وأسقف": ["عزل مائي", "عزل حراري", "رولات عزل", "ألواح عزل", "أسقف مستعارة", "جبس بورد"],
  "أبواب ونوافذ": ["أبواب خشبية", "أبواب حديد", "نوافذ ألمنيوم", "زجاج سيكوريت", "أبواب مقاومة للحريق"],
  "دهانات": ["دهانات داخلية", "دهانات خارجية", "عوازل دهانات", "معجون", "أدوات طلاء"],
  "خرسانة جاهزة": ["خرسانة عادية", "خرسانة مقاومة", "مضخات خرسانة", "خرسانة مسبقة الصنع"],
  "معدات وآليات": ["رافعات شوكية", "مولدات كهربائية", "معدات حفر", "سقالات", "معدات خلط"],
}

const SAUDI_CITIES = [
  "الرياض", "جدة", "مكة المكرمة", "المدينة المنورة", "الدمام", "الخبر", "الظهران", 
  "الأحساء", "الجبيل", "تبوك", "حائل", "القصيم", "بريدة", "عنيزة", "أبها", "خميس مشيط", 
  "جازان", "نجران", "الباحة", "سكاكا", "عرعر"
]

export default function NewRfqPage() {
  const [step, setStep] = useState(1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isMapModalOpen, setIsMapModalOpen] = useState(false)
  const [tempCoords, setTempCoords] = useState<{ lat: number, lng: number } | null>(null)
  const { toast } = useToast()
  const router = useRouter()
  const firestore = useFirestore()
  const { user } = useUser()
  
  const [formData, setFormData] = useState({
    title: "",
    category: "",
    subCategory: "",
    quantity: "",
    unit: "",
    city: "",
    district: "",
    deadline: "",
    paymentTerms: "",
    notes: "",
    certRequired: false,
    locationCoords: null as { lat: number, lng: number } | null
  })

  const nextStep = () => setStep(s => s + 1)
  const prevStep = () => setStep(s => s - 1)

  const handleAiDraft = async () => {
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
      const result = await draftRfqDescription({
        keywords: formData.title,
        category: formData.category,
        quantity: Number(formData.quantity) || 1,
        unit: formData.unit || "عدد",
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
    } catch (error) {
      toast({
        title: "خطأ",
        description: "فشل إنشاء الوصف بالذكاء الاصطناعي.",
        variant: "destructive"
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSubmit = async () => {
    if (!firestore || !user) return

    setIsSubmitting(true)
    const rfqsRef = collection(firestore, "rfqs")
    
    const rfqData = {
      contractorId: user.uid,
      title: formData.title,
      category: formData.category,
      subCategory: formData.subCategory,
      quantity: Number(formData.quantity),
      unitOfMeasure: formData.unit,
      deadline: formData.deadline,
      city: formData.city,
      district: formData.district,
      locationCoords: formData.locationCoords ? { lat: formData.locationCoords.lat, lng: formData.locationCoords.lng } : null,
      paymentTerms: formData.paymentTerms,
      isQualityCertificateRequired: formData.certRequired,
      notes: formData.notes,
      status: "New",
      createdAt: new Date().toISOString()
    }

    addDocumentNonBlocking(rfqsRef, rfqData)
    
    toast({
      title: "تم النشر!",
      description: "تم نشر المناقصة بنجاح وهي الآن متاحة للموردين.",
    })
    
    router.push("/contractor/rfqs")
  }

  return (
    <PortalLayout>
      <div className="max-w-3xl mx-auto py-8 text-right">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">طرح مناقصة جديدة</h1>
            <p className="text-muted-foreground mt-1">اتبع الخطوات لإرسال طلب عرض السعر للموردين</p>
          </div>
          <div className="flex gap-2">
            {[1, 2, 3].map(i => (
              <div 
                key={i} 
                className={`h-2 w-12 rounded-full transition-all duration-300 ${
                  step >= i ? "bg-primary" : "bg-slate-200"
                }`} 
              />
            ))}
          </div>
        </div>

        <Card className="shadow-lg border-none">
          <CardHeader className="border-b bg-slate-50/50">
            <CardTitle className="flex items-center gap-2">
              {step === 1 && <><FileText className="text-primary" /> تفاصيل المنتج</>}
              {step === 2 && <><MapPin className="text-primary" /> الموقع والمواعيد</>}
              {step === 3 && <><ClipboardCheck className="text-primary" /> تأكيد النشر</>}
            </CardTitle>
            <CardDescription>الخطوة {step} من 3</CardDescription>
          </CardHeader>

          <CardContent className="p-8">
            {step === 1 && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="title">عنوان المناقصة</Label>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleAiDraft}
                      disabled={isGenerating}
                      className="text-xs h-7 gap-1 border-primary/20 hover:bg-primary/5 text-primary"
                    >
                      <Zap size={14} className={isGenerating ? "animate-pulse" : ""} />
                      تحسين بالذكاء الاصطناعي
                    </Button>
                  </div>
                  <Input 
                    id="title" 
                    placeholder="مثال: توريد حديد سابك مشروع الرياض" 
                    value={formData.title}
                    onChange={e => setFormData({...formData, title: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>الفئة</Label>
                    <Select onValueChange={v => setFormData({...formData, category: v, subCategory: ""})}>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر الفئة" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(CATEGORIES_DATA).map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>النوع (التصنيف الفرعي)</Label>
                    <Select 
                      disabled={!formData.category}
                      onValueChange={v => setFormData({...formData, subCategory: v})}
                      value={formData.subCategory}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={formData.category ? "اختر النوع" : "اختر الفئة أولاً"} />
                      </SelectTrigger>
                      <SelectContent>
                        {formData.category && CATEGORIES_DATA[formData.category as keyof typeof CATEGORIES_DATA].map(sub => (
                          <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>الكمية</Label>
                    <Input 
                      type="number" 
                      placeholder="0" 
                      value={formData.quantity}
                      onChange={e => setFormData({...formData, quantity: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>الوحدة</Label>
                    <Input 
                      placeholder="طن أو متر" 
                      value={formData.unit}
                      onChange={e => setFormData({...formData, unit: e.target.value})}
                    />
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>المدينة</Label>
                    <Select onValueChange={v => setFormData({...formData, city: v})}>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر المدينة" />
                      </SelectTrigger>
                      <SelectContent>
                        {SAUDI_CITIES.map(city => (
                          <SelectItem key={city} value={city}>{city}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>الحي أو المنطقة</Label>
                    <Input 
                      placeholder="مثال: حي النرجس" 
                      value={formData.district}
                      onChange={e => setFormData({...formData, district: e.target.value})}
                    />
                  </div>
                </div>

                  <div className="space-y-2">
                    <Label>موقع التوريد الدقيق على الخريطة</Label>
                    
                    {formData.locationCoords ? (
                      <div className="relative h-48 rounded-xl border border-success/30 bg-success/5 flex flex-col items-center justify-center text-center p-4">
                        <MapPin className="text-success mb-2" size={32} />
                        <p className="text-success font-bold">تم تحديد الموقع بنجاح</p>
                        <p className="text-xs text-success/80 mt-1 font-mono">
                          {formData.locationCoords.lat.toFixed(4)}, {formData.locationCoords.lng.toFixed(4)}
                        </p>
                        <div className="flex gap-2 mt-4">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-xs"
                            onClick={() => {
                              setTempCoords(formData.locationCoords)
                              setIsMapModalOpen(true)
                            }}
                          >
                            تعديل الموقع
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => setFormData({...formData, locationCoords: null})}
                          >
                            إلغاء التحديد
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Dialog open={isMapModalOpen} onOpenChange={setIsMapModalOpen}>
                        <DialogTrigger asChild>
                          <div className="relative h-48 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-center p-4 group hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer">
                            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3 group-hover:scale-110 transition-transform">
                              <MapPin size={24} />
                            </div>
                            <h3 className="font-bold text-slate-800">تحديد الموقع على الخريطة</h3>
                            <p className="text-xs text-muted-foreground max-w-[200px] mt-1">انقر لفتح الخريطة واختيار موقع المشروع بدقة لتسهيل التوصيل</p>
                            <Button variant="secondary" size="sm" className="mt-4 rounded-full pointer-events-none">
                              فتح الخريطة
                            </Button>
                          </div>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[600px] w-[95vw] h-[80vh] flex flex-col">
                          <DialogHeader>
                            <DialogTitle className="text-right">تحديد الموقع الدقيق</DialogTitle>
                          </DialogHeader>
                          <div className="flex-1 relative rounded-xl overflow-hidden border border-slate-200 min-h-0 my-4">
                            <MapPicker 
                              className="w-full h-full"
                              initialPosition={tempCoords || { lat: 24.7136, lng: 46.6753 }}
                              onLocationSelect={(loc) => setTempCoords(loc)}
                            />
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur text-xs font-bold px-4 py-2 rounded-full shadow-lg z-[400] pointer-events-none border border-slate-200">
                              انقر على الخريطة لتحديد الموقع
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-2 border-t mt-auto">
                            <Button variant="outline" onClick={() => setIsMapModalOpen(false)}>
                              إلغاء
                            </Button>
                            <Button 
                              disabled={!tempCoords} 
                              onClick={() => {
                                if (tempCoords) {
                                  setFormData({...formData, locationCoords: tempCoords})
                                  toast({ title: "تم تأكيد الموقع", description: "تم حفظ الإحداثيات بنجاح" })
                                  setIsMapModalOpen(false)
                                }
                              }}
                            >
                              تأكيد الموقع
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>الموعد النهائي للعروض</Label>
                    <Input 
                      type="date" 
                      value={formData.deadline}
                      onChange={e => setFormData({...formData, deadline: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>شروط الدفع</Label>
                    <Select onValueChange={v => setFormData({...formData, paymentTerms: v})}>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر الشروط" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="كاش">كاش (نقداً)</SelectItem>
                        <SelectItem value="آجل 30 يوم">آجل 30 يوم</SelectItem>
                        <SelectItem value="آجل 60 يوم">آجل 60 يوم</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label>ملاحظات إضافية</Label>
                  <Textarea 
                    rows={4} 
                    placeholder="اكتب أي مواصفات فنية إضافية هنا..." 
                    value={formData.notes}
                    onChange={e => setFormData({...formData, notes: e.target.value})}
                  />
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-dashed">
                  <div className="space-y-0.5">
                    <Label className="text-base">شهادة جودة مطلوبة</Label>
                    <p className="text-xs text-muted-foreground">تفعيل هذا الخيار يحصر المناقصة للموردين الحاصلين على شهادات معتمدة</p>
                  </div>
                  <Switch 
                    checked={formData.certRequired}
                    onCheckedChange={v => setFormData({...formData, certRequired: v})}
                  />
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex items-center justify-between border-t bg-slate-50/30 p-6">
            <Button 
              variant="ghost" 
              onClick={prevStep} 
              disabled={step === 1 || isSubmitting}
              className="gap-2"
            >
              <ChevronRight size={18} />
              السابق
            </Button>
            
            {step < 3 ? (
              <Button onClick={nextStep} className="gap-2 px-8">
                التالي
                <ChevronLeft size={18} />
              </Button>
            ) : (
              <Button 
                onClick={handleSubmit} 
                disabled={isSubmitting}
                className="bg-success hover:bg-success/90 gap-2 px-10"
              >
                {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                نشر المناقصة الآن
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </PortalLayout>
  )
}
