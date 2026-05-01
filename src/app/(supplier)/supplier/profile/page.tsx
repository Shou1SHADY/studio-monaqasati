
"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { 
  User, 
  Briefcase, 
  MapPin, 
  CheckCircle2, 
  Zap, 
  X,
  Plus
} from "lucide-react"
import { suggestSupplierSpecializations } from "@/ai/flows/suggest-supplier-specializations-flow"
import { useToast } from "@/hooks/use-toast"

const PREDEFINED_CATEGORIES = [
  "حديد ومعادن",
  "أسمنت وخرسانة",
  "دهانات",
  "أدوات صحية",
  "كهرباء وإنارة",
  "أرضيات وتشطيبات",
  "عزل وأسقف",
  "نجارة وأبواب"
]

export default function SupplierProfilePage() {
  const { toast } = useToast()
  const [isGenerating, setIsGenerating] = useState(false)
  const [profile, setProfile] = useState({
    name: "المورد المتكامل",
    description: "نحن شركة رائدة في توريد مواد البناء الأساسية، نركز بشكل أساسي على الحديد والصلب عالي الجودة من سابك، بالإضافة إلى توريد الخرسانة الجاهزة ومواد العزل.",
    location: "الرياض، المملكة العربية السعودية",
    specializations: ["حديد ومعادن", "أسمنت وخرسانة"]
  })

  const handleAiSuggest = async () => {
    if (!profile.description) {
      toast({
        title: "وصف مفقود",
        description: "يرجى كتابة وصف عملك ليتمكن الذكاء الاصطناعي من اقتراح التخصصات.",
        variant: "destructive"
      })
      return
    }

    setIsGenerating(true)
    try {
      const result = await suggestSupplierSpecializations({
        businessDescription: profile.description,
        predefinedCategories: PREDEFINED_CATEGORIES
      })
      
      const newSpecs = Array.from(new Set([...profile.specializations, ...result.suggestedCategories]))
      setProfile(prev => ({ ...prev, specializations: newSpecs }))
      
      toast({
        title: "اقتراحات ناجحة",
        description: "تم تحديث تخصصاتك بناءً على وصف العمل الخاص بك.",
      })
    } catch (error) {
      toast({
        title: "خطأ",
        description: "فشل الحصول على اقتراحات من الذكاء الاصطناعي.",
        variant: "destructive"
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const removeSpec = (spec: string) => {
    setProfile(prev => ({
      ...prev,
      specializations: prev.specializations.filter(s => s !== spec)
    }))
  }

  return (
    <PortalLayout>
      <div className="max-w-4xl mx-auto py-8 text-right space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">الملف الشخصي للمورد</h1>
          <p className="text-muted-foreground mt-1">إدارة معلومات شركتك وتخصصاتك التجارية</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-sm border-none">
              <CardHeader className="border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Briefcase size={20} className="text-primary" />
                  بيانات الشركة
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="name">اسم الشركة</Label>
                  <Input 
                    id="name" 
                    value={profile.name}
                    onChange={e => setProfile({...profile, name: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="desc">وصف العمل</Label>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleAiSuggest}
                      disabled={isGenerating}
                      className="text-xs h-7 gap-1 border-primary/20 hover:bg-primary/5 text-primary"
                    >
                      <Zap size={14} className={isGenerating ? "animate-pulse" : ""} />
                      تحليل التخصصات (AI)
                    </Button>
                  </div>
                  <Textarea 
                    id="desc" 
                    rows={5}
                    placeholder="اشرح طبيعة عملك والمنتجات التي توفرها..."
                    value={profile.description}
                    onChange={e => setProfile({...profile, description: e.target.value})}
                  />
                  <p className="text-[10px] text-muted-foreground">يساعد وصف العمل المفصل الذكاء الاصطناعي في مطابقتك مع المناقصات المناسبة.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="loc">المقر الرئيسي</Label>
                  <div className="relative">
                    <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      id="loc" 
                      className="pr-10"
                      value={profile.location}
                      onChange={e => setProfile({...profile, location: e.target.value})}
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="border-t bg-slate-50/50 justify-end p-4">
                <Button className="gap-2">
                  حفظ التغييرات
                  <CheckCircle2 size={18} />
                </Button>
              </CardFooter>
            </Card>

            <Card className="shadow-sm border-none">
              <CardHeader className="border-b">
                <CardTitle className="text-lg">تخصصات العمل</CardTitle>
                <CardDescription>هذه التخصصات تحدد المناقصات التي ستظهر لك في المقترحات</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div className="flex flex-wrap gap-2">
                  {profile.specializations.map(spec => (
                    <Badge key={spec} className="bg-primary/10 text-primary border-none px-3 py-1 flex items-center gap-1">
                      {spec}
                      <button onClick={() => removeSpec(spec)} className="hover:text-destructive">
                        <X size={14} />
                      </button>
                    </Badge>
                  ))}
                  <Button variant="outline" size="sm" className="rounded-full h-8 border-dashed">
                    <Plus size={14} className="ml-1" />
                    إضافة تخصص
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="shadow-sm border-none bg-secondary text-white">
              <CardContent className="p-6 space-y-4">
                <div className="h-20 w-20 rounded-2xl bg-white/10 flex items-center justify-center mx-auto">
                  <User size={40} className="text-primary" />
                </div>
                <div className="text-center">
                  <h3 className="font-bold text-lg">{profile.name}</h3>
                  <p className="text-sm text-white/60">مورد معتمد منذ 2023</p>
                </div>
                <div className="pt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/60">حالة التحقق</span>
                    <Badge className="bg-success text-white border-none">موثوق</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/60">التقييم</span>
                    <span className="font-bold">4.8 / 5.0</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-slate-100">
              <CardHeader className="pb-2">
                <CardTitle className="text-md font-bold">قوة الملف الشخصي</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-primary w-[85%]" />
                </div>
                <p className="text-xs text-muted-foreground">ملفك الشخصي مكتمل بنسبة 85%، أضف شهادات الجودة للوصول إلى 100%.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PortalLayout>
  )
}
