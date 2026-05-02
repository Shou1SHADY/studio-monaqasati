
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
  Plus,
  Award,
  FolderOpen,
  Calendar,
  Trash2
} from "lucide-react"
import { suggestSupplierSpecializations } from "@/ai/flows/suggest-supplier-specializations-flow"
import { useToast } from "@/hooks/use-toast"

interface Certificate {
  id: string
  name: string
  issuer: string
  issueDate: string
  expiryDate: string
}

interface Project {
  id: string
  name: string
  client: string
  description: string
  value: string
  startDate: string
  endDate: string
}

const PREDEFINED_CATEGORIES = [
  "حديد ومعادن",
  "أسمنت وخرسانة",
  "دهانات",
  "أدوات صحية",
  "كهرباء وإنارة",
  "أرضيات وتشطبيات",
  "عزل وأسقف",
  "نجارة وأبواب"
]

export default function SupplierProfilePage() {
  const { toast } = useToast()
  const [isGenerating, setIsGenerating] = useState(false)
  const [showCertForm, setShowCertForm] = useState(false)
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [newCert, setNewCert] = useState({ name: "", issuer: "", issueDate: "", expiryDate: "" })
  const [newProject, setNewProject] = useState({ name: "", client: "", description: "", value: "", startDate: "", endDate: "" })
  const [profile, setProfile] = useState({
    name: "المورد المتكامل",
    description: "نحن شركة رائدة في توريد مواد البناء الأساسية، نركز بشكل أساسي على الحديد والصلب عالي الجودة من سابك، بالإضافة إلى توريد الخرسانة الجاهزة ومواد العزل.",
    location: "الرياض، المملكة العربية السعودية",
    specializations: ["حديد ومعادن", "أسمنت وخرسانة"],
    certificates: [
      { id: "1", name: "شهادة ISO 9001", issuer: "منظمة الجودة العالمية", issueDate: "2024-01-15", expiryDate: "2026-01-15" },
      { id: "2", name: "شهادة اعتماد سابك", issuer: "شركة سابك", issueDate: "2023-06-01", expiryDate: "2025-06-01" }
    ] as Certificate[],
    projects: [
      { id: "1", name: "مشروع تطوير حي النرجس", client: "شركة الأهلي للتطوير العقاري", description: "توريد حديد التسليح لبناء 50 فيلا", value: "2,500,000", startDate: "2024-03-01", endDate: "2024-08-30" },
      { id: "2", name: "مجمع التجارية الشرقية", client: "مجموعة المتحدة العقارية", description: "توريد الخرسانة الجاهزة والأ cement", value: "4,200,000", startDate: "2023-09-15", endDate: "2024-02-28" }
    ] as Project[]
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

  const addCertificate = () => {
    if (!newCert.name || !newCert.issuer) {
      toast({ title: "خطأ", description: "يرجى填写 название и издатель الشهادة", variant: "destructive" })
      return
    }
    setProfile(prev => ({
      ...prev,
      certificates: [...prev.certificates, { ...newCert, id: Date.now().toString() }]
    }))
    setNewCert({ name: "", issuer: "", issueDate: "", expiryDate: "" })
    setShowCertForm(false)
    toast({ title: "تم", description: "تمت إضافة الشهادة بنجاح" })
  }

  const removeCertificate = (id: string) => {
    setProfile(prev => ({
      ...prev,
      certificates: prev.certificates.filter(c => c.id !== id)
    }))
  }

  const addProject = () => {
    if (!newProject.name || !newProject.client) {
      toast({ title: "خطأ", description: "يرجى填写 название и العميل للمشروع", variant: "destructive" })
      return
    }
    setProfile(prev => ({
      ...prev,
      projects: [...prev.projects, { ...newProject, id: Date.now().toString() }]
    }))
    setNewProject({ name: "", client: "", description: "", value: "", startDate: "", endDate: "" })
    setShowProjectForm(false)
    toast({ title: "تم", description: "تمت إضافة المشروع بنجاح" })
  }

  const removeProject = (id: string) => {
    setProfile(prev => ({
      ...prev,
      projects: prev.projects.filter(p => p.id !== id)
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

            <Card className="shadow-sm border-none">
              <CardHeader className="border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Award size={20} className="text-primary" />
                  الشهادات والجوائز
                </CardTitle>
                <CardDescription>أضف شهاداتك المهنية واعتماداتك الصناعية</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {profile.certificates.map(cert => (
                  <div key={cert.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="space-y-1">
                      <p className="font-bold text-slate-800">{cert.name}</p>
                      <p className="text-sm text-muted-foreground">{cert.issuer}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar size={12} />
                        <span>تاريخ الإصدار: {cert.issueDate} - الانتهاء: {cert.expiryDate}</span>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-50" onClick={() => removeCertificate(cert.id)}>
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}
                
                {showCertForm ? (
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>اسم الشهادة</Label>
                        <Input 
                          value={newCert.name}
                          onChange={e => setNewCert({...newCert, name: e.target.value})}
                          placeholder="مثال: ISO 9001"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>الجهة المُصدِرة</Label>
                        <Input 
                          value={newCert.issuer}
                          onChange={e => setNewCert({...newCert, issuer: e.target.value})}
                          placeholder="مثال: منظمة الجودة العالمية"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>تاريخ الإصدار</Label>
                        <Input 
                          type="date"
                          value={newCert.issueDate}
                          onChange={e => setNewCert({...newCert, issueDate: e.target.value})}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>تاريخ الانتهاء</Label>
                        <Input 
                          type="date"
                          value={newCert.expiryDate}
                          onChange={e => setNewCert({...newCert, expiryDate: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" size="sm" onClick={() => setShowCertForm(false)}>إلغاء</Button>
                      <Button size="sm" onClick={addCertificate}>حفظ الشهادة</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full border-dashed" onClick={() => setShowCertForm(true)}>
                    <Plus size={16} className="ml-2" />
                    إضافة شهادة جديدة
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm border-none">
              <CardHeader className="border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FolderOpen size={20} className="text-primary" />
                  المشاريع السابقة
                </CardTitle>
                <CardDescription>أعرض أعمالك ومشاريعك المنجزة لزيادة مصداقيتك</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {profile.projects.map(project => (
                  <div key={project.id} className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2 flex-1">
                        <p className="font-bold text-slate-800">{project.name}</p>
                        <p className="text-sm text-muted-foreground">العميل: {project.client}</p>
                        <p className="text-sm text-slate-600">{project.description}</p>
                        <div className="flex items-center gap-4 pt-2">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar size={12} />
                            <span>{project.startDate} - {project.endDate}</span>
                          </div>
                          <Badge className="bg-success/10 text-success border-success/20">
                            {project.value} ر.س
                          </Badge>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-50" onClick={() => removeProject(project.id)}>
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                ))}
                
                {showProjectForm ? (
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>اسم المشروع</Label>
                        <Input 
                          value={newProject.name}
                          onChange={e => setNewProject({...newProject, name: e.target.value})}
                          placeholder="مثال: تطوير حي النرجس"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>اسم العميل</Label>
                        <Input 
                          value={newProject.client}
                          onChange={e => setNewProject({...newProject, client: e.target.value})}
                          placeholder="مثال: شركة الأهلي للتطوير"
                        />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>وصف المشروع</Label>
                        <Textarea 
                          value={newProject.description}
                          onChange={e => setNewProject({...newProject, description: e.target.value})}
                          placeholder="اشرح طبيعة العمل الذي أنجزته..."
                          rows={2}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>قيمة المشروع (ر.س)</Label>
                        <Input 
                          type="number"
                          value={newProject.value}
                          onChange={e => setNewProject({...newProject, value: e.target.value})}
                          placeholder="مثال: 500000"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>الفترة</Label>
                        <div className="flex gap-2">
                          <Input 
                            type="date"
                            value={newProject.startDate}
                            onChange={e => setNewProject({...newProject, startDate: e.target.value})}
                            placeholder="من"
                          />
                          <Input 
                            type="date"
                            value={newProject.endDate}
                            onChange={e => setNewProject({...newProject, endDate: e.target.value})}
                            placeholder="إلى"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" size="sm" onClick={() => setShowProjectForm(false)}>إلغاء</Button>
                      <Button size="sm" onClick={addProject}>حفظ المشروع</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full border-dashed" onClick={() => setShowProjectForm(true)}>
                    <Plus size={16} className="ml-2" />
                    إضافة مشروع جديد
                  </Button>
                )}
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
