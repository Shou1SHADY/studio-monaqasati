"use client"

import { useState } from "react"
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
import { 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2,
  FileText,
  MapPin,
  ClipboardCheck,
  Zap
} from "lucide-react"
import { draftRfqDescription } from "@/ai/flows/draft-rfq-description-flow"
import { useToast } from "@/hooks/use-toast"

export default function NewRfqPage() {
  const [step, setStep] = useState(1)
  const [isGenerating, setIsGenerating] = useState(false)
  const { toast } = useToast()
  
  const [formData, setFormData] = useState({
    title: "",
    category: "",
    quantity: "",
    unit: "",
    location: "",
    area: "",
    deadline: "",
    paymentTerms: "",
    notes: "",
    certRequired: false
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
                    <Select onValueChange={v => setFormData({...formData, category: v})}>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر الفئة" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="حديد ومعادن">حديد ومعادن</SelectItem>
                        <SelectItem value="أسمنت وخرسانة">أسمنت وخرسانة</SelectItem>
                        <SelectItem value="دهانات">دهانات</SelectItem>
                        <SelectItem value="أدوات صحية">أدوات صحية</SelectItem>
                      </SelectContent>
                    </Select>
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
                        placeholder="طن / متر" 
                        value={formData.unit}
                        onChange={e => setFormData({...formData, unit: e.target.value})}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>المدينة</Label>
                    <Input 
                      placeholder="الرياض، جدة، الخ..." 
                      value={formData.location}
                      onChange={e => setFormData({...formData, location: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>منطقة الخدمة (الحي)</Label>
                    <Input 
                      placeholder="مثال: حي النرجس" 
                      value={formData.area}
                      onChange={e => setFormData({...formData, area: e.target.value})}
                    />
                  </div>
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
                
                <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg flex items-start gap-3">
                  <CheckCircle2 className="text-primary mt-1 shrink-0" size={18} />
                  <p className="text-sm text-blue-800">
                    بمجرد النشر، سيصل إشعار لجميع الموردين المسجلين في فئة <span className="font-bold">"{formData.category || 'المختارة'}"</span> في منطقة <span className="font-bold">"{formData.location || 'المختارة'}"</span>.
                  </p>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex items-center justify-between border-t bg-slate-50/30 p-6">
            <Button 
              variant="ghost" 
              onClick={prevStep} 
              disabled={step === 1}
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
              <Button className="bg-success hover:bg-success/90 gap-2 px-10">
                نشر المناقصة الآن
                <CheckCircle2 size={18} />
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </PortalLayout>
  )
}
