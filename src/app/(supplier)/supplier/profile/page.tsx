
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
  Trash2,
  Image as ImageIcon,
  FileText,
  ChevronDown,
  Loader2,
  ShieldCheck
} from "lucide-react"
import { PREDEFINED_CATEGORIES, SAUDI_CITIES } from "@/lib/constants"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { suggestSupplierSpecializations } from "@/ai/flows/suggest-supplier-specializations-flow"
import { useToast } from "@/hooks/use-toast"
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from "@/firebase"
import { doc, updateDoc, collection, query as firestoreQuery, orderBy } from "firebase/firestore"
import { useEffect } from "react"

interface Certificate {
  id: string
  name: string
  issuer: string
  issueDate: string
  expiryDate: string
  documentUrl?: string
}

interface Project {
  id: string
  name: string
  description: string
  images: string[]
}

interface CompanyFile {
  id: string
  name: string
  type: 'image' | 'document'
  url: string
}

export default function SupplierProfilePage() {
  const { toast } = useToast()
  const [isGenerating, setIsGenerating] = useState(false)
  const [showCertForm, setShowCertForm] = useState(false)
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [isUploadingFile, setIsUploadingFile] = useState(false)
  const [isUploadingProjImg, setIsUploadingProjImg] = useState(false)
  const [isUploadingCert, setIsUploadingCert] = useState(false)
  const [newCert, setNewCert] = useState({ name: "", issuer: "", issueDate: "", expiryDate: "", documentUrl: "" })
  const [newProject, setNewProject] = useState({ name: "", description: "", images: [] as string[] })
  const { user, isUserLoading } = useUser()
  const firestore = useFirestore()
  const [isLoading, setIsLoading] = useState(false)
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    phone: "",
    crNumber: "",
    description: "",
    location: "", // headquarters
    coverageCities: [] as string[], // additional coverage cities
    specializations: [] as string[],
    certificates: [] as Certificate[],
    projects: [] as Project[],
    companyFiles: [] as CompanyFile[],
    isVerified: false,
    isPremium: false,
    commitmentScore: 0,
    verificationRequested: false
  })

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  
  const { data: userData, isLoading: isUserDataLoading } = useDoc(userDocRef)

  // Fetch cities from Firestore (temporary fallback to hardcoded if Firebase not ready)
  const citiesQuery = useMemoFirebase(() => {
    if (!firestore) return null
    return firestoreQuery(collection(firestore, "cities"), orderBy("name", "asc"))
  }, [firestore])
  
  const { data: citiesFromDB, isLoading: isCitiesLoading } = useCollection(citiesQuery)
  
  // Debug log
  console.log("Cities Status:", { 
    loading: isCitiesLoading, 
    fromDB: citiesFromDB, 
    fromDBLength: citiesFromDB?.length, 
    fallbackLength: SAUDI_CITIES.length 
  })
  
  // SIMPLE FIX: Always use hardcoded list for now (Caveman approach)
  // Once Firebase rules are deployed and seed is run, you can switch to dynamic
  const cities = SAUDI_CITIES
  // Uncomment below for dynamic version:
  // const cities = (!citiesFromDB || citiesFromDB.length === 0) 
  //   ? SAUDI_CITIES 
  //   : citiesFromDB.map((c: any) => c.name)

  // Sync with user data
  useEffect(() => {
    if (userData) {
      setProfile(prev => ({
        ...prev,
        name: userData.name || userData.companyName || user?.displayName || "",
        email: userData.email || user?.email || "",
        phone: userData.phone || "",
        crNumber: userData.crNumber || "",
        location: userData.city || userData.location || "",
        coverageCities: userData.coverageCities || [],
        description: userData.description || "",
        specializations: userData.specializations || [],
        certificates: userData.certificates || [],
        projects: userData.projects || [],
        companyFiles: userData.companyFiles || [],
        isVerified: userData.isVerified || false,
        isPremium: userData.isPremium || false,
        commitmentScore: userData.commitmentScore || 0,
        verificationRequested: userData.verificationRequested || false
      }))
    }
  }, [userData, user])

  const handleSave = async () => {
    if (!user || !firestore) return
    setIsLoading(true)
    try {
      await updateDoc(doc(firestore, "users", user.uid), {
        name: profile.name,
        companyName: profile.name,
        phone: profile.phone,
        crNumber: profile.crNumber,
        city: profile.location,
        location: profile.location,
        coverageCities: profile.coverageCities,
        description: profile.description,
        specializations: profile.specializations,
        certificates: profile.certificates,
        projects: profile.projects,
        companyFiles: profile.companyFiles,
        profileCompleted: true
      })
      toast({ title: "تم الحفظ", description: "تم تحديث بيانات الملف الشخصي بنجاح." })
    } catch (e: any) {
      toast({ title: "خطأ", description: e.message, variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
   }

  const requestVerification = async () => {
    if (!user || !firestore) return
    if (profile.isVerified || profile.verificationRequested) {
      toast({ title: "تنبيه", description: "لقد قمت بالطلب مسبقاً أو أنك موثق بالفعل" })
      return
    }
    if (!profile.crNumber || profile.certificates.length === 0) {
      toast({ title: "بيانات ناقصة", description: "يجب رفع السجل التجاري وشهادة واحدة على الأقل", variant: "destructive" })
      return
    }
    try {
      await updateDoc(doc(firestore, "users", user.uid), {
        verificationRequested: true
      })
      setProfile(prev => ({ ...prev, verificationRequested: true }))
      toast({ title: "تم إرسال الطلب", description: "سيتم مراجعة وثائقك من قبل الإدارة" })
    } catch (e: any) {
      toast({ title: "خطأ", description: e.message, variant: "destructive" })
    }
  }

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

  const addSpec = (spec: string) => {
    if (!profile.specializations.includes(spec)) {
      setProfile(prev => ({
        ...prev,
        specializations: [...prev.specializations, spec]
      }))
    }
  }

  const addCertificate = () => {
    if (!newCert.name || !newCert.issuer) {
      toast({ title: "خطأ", description: "يرجى تعبئة الحقول المطلوبة", variant: "destructive" })
      return
    }
    setProfile(prev => ({
      ...prev,
      certificates: [...prev.certificates, { ...newCert, id: Date.now().toString() }]
    }))
    setNewCert({ name: "", issuer: "", issueDate: "", expiryDate: "", documentUrl: "" })
    setShowCertForm(false)
    toast({ title: "تم", description: "تمت إضافة الشهادة بنجاح" })
  }

  const handleCertUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploadingCert(true)
    setTimeout(() => {
      setNewCert(prev => ({
        ...prev,
        documentUrl: URL.createObjectURL(file) // Mock URL
      }))
      setIsUploadingCert(false)
      toast({ title: "تم الرفع", description: "تم إرفاق مستند الشهادة بنجاح" })
    }, 1500)
  }

  const removeCertificate = (id: string) => {
    setProfile(prev => ({
      ...prev,
      certificates: prev.certificates.filter(c => c.id !== id)
    }))
  }

  const addProject = () => {
    if (!newProject.name) {
      toast({ title: "خطأ", description: "يرجى كتابة اسم المشروع", variant: "destructive" })
      return
    }
    setProfile(prev => ({
      ...prev,
      projects: [...prev.projects, { ...newProject, id: Date.now().toString() }]
    }))
    setNewProject({ name: "", description: "", images: [] })
    setShowProjectForm(false)
    toast({ title: "تم", description: "تمت إضافة المشروع بنجاح" })
  }

  const handleProjectImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploadingProjImg(true)
    setTimeout(() => {
      setNewProject(prev => ({
        ...prev,
        images: [...prev.images, URL.createObjectURL(file)]
      }))
      setIsUploadingProjImg(false)
    }, 1000)
  }

  const removeProjectImage = (index: number) => {
    setNewProject(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)
    }))
  }

  const removeProject = (id: string) => {
    setProfile(prev => ({
      ...prev,
      projects: prev.projects.filter(p => p.id !== id)
    }))
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    setIsUploadingFile(true)
    setTimeout(() => {
      const isImage = file.type.startsWith('image/')
      const newFile: CompanyFile = {
        id: Date.now().toString(),
        name: file.name,
        type: isImage ? 'image' : 'document',
        url: URL.createObjectURL(file) // Mock URL
      }
      setProfile(prev => ({
        ...prev,
        companyFiles: [...prev.companyFiles, newFile]
      }))
      setIsUploadingFile(false)
      toast({ title: "تم الرفع", description: "تم رفع الملف بنجاح." })
    }, 1500)
  }

  const removeFile = (id: string) => {
    setProfile(prev => ({
      ...prev,
      companyFiles: prev.companyFiles.filter(f => f.id !== id)
    }))
  }

  if (isUserLoading || isUserDataLoading) {
    return (
      <PortalLayout>
        <div className="flex justify-center items-center h-[60vh]">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout>
      <div className="max-w-6xl mx-auto py-8 text-right space-y-8">
        <div className="bg-gradient-to-l from-primary/10 via-primary/5 to-transparent p-8 rounded-3xl border border-primary/10 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">الملف الشخصي للشركة</h1>
            <p className="text-muted-foreground mt-2 text-lg">أكمل ملفك لتعزيز فرصك في الحصول على مناقصات متميزة</p>
          </div>
          <div className="hidden md:block h-24 w-24 bg-white rounded-full shadow-sm flex items-center justify-center p-2 border">
            <div className="w-full h-full rounded-full bg-slate-50 flex items-center justify-center text-primary/50">
              <Briefcase size={40} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 space-y-8">
            <Card className="shadow-md border-slate-100 overflow-hidden">
              <CardHeader className="bg-slate-50/50 border-b pb-4">
                <CardTitle className="text-xl flex items-center gap-2 text-slate-800">
                  <Briefcase size={22} className="text-primary" />
                  البيانات الأساسية والتخصصات
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">اسم الشركة</Label>
                    <Input 
                      id="name" 
                      value={profile.name}
                      onChange={e => setProfile({...profile, name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">البريد الإلكتروني</Label>
                    <Input 
                      id="email" 
                      value={profile.email}
                      disabled
                      className="bg-slate-50 text-slate-500 dir-ltr text-left"
                    />
                    <p className="text-[10px] text-muted-foreground">لا يمكن تغيير البريد الإلكتروني الخاص بالحساب</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">رقم الجوال</Label>
                    <Input 
                      id="phone" 
                      value={profile.phone}
                      onChange={e => setProfile({...profile, phone: e.target.value})}
                      className="dir-ltr text-left"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="crNumber">رقم السجل التجاري</Label>
                    <Input 
                      id="crNumber-input" 
                      value={profile.crNumber}
                      onChange={e => setProfile({...profile, crNumber: e.target.value})}
                      className="dir-ltr text-left"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="loc">المقر الرئيسي / المدينة</Label>
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
<div className="space-y-2 md:col-span-2">
                    <Label>مدن التغطية الإضافية</Label>
                    <div className="p-4 bg-accent/5 rounded-xl border border-accent/20">
                      {/* Selected Cities Display */}
                      <div className="flex flex-wrap gap-2 mb-4 min-h-[36px]">
                        {profile.coverageCities.length > 0 ? (
                          profile.coverageCities.map(city => (
                            <Badge key={city} className="bg-accent text-white px-3 py-1.5 flex items-center gap-2 hover:bg-accent/80 transition-all text-sm shadow-sm group">
                              <MapPin size={12} className="group-hover:scale-110 transition-transform" />
                              {city}
                              <button 
                                onClick={() => setProfile(prev => ({ ...prev, coverageCities: prev.coverageCities.filter(c => c !== city) }))} 
                                className="hover:text-white hover:bg-white/20 rounded-full p-0.5 transition-colors"
                                aria-label={`حذف ${city}`}
                              >
                                <X size={14} />
                              </button>
                            </Badge>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground italic">لم تتم إضافة أي مدن بعد</p>
                        )}
                      </div>
                      
                      {/* Add City Section */}
                      <div className="flex gap-2">
                        <Input 
                          placeholder="أضف مدينة..."
                          className="h-9 flex-1 bg-white border-accent/20 focus:border-accent"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              const input = e.target as HTMLInputElement
                              const city = input.value.trim()
                              if (city && !profile.coverageCities.includes(city)) {
                                setProfile(prev => ({ ...prev, coverageCities: [...prev.coverageCities, city] }))
                                input.value = ''
                                toast({ title: "تم الإضافة", description: `تم إضافة ${city} لقائمة التغطية` })
                              }
                            }
                          }}
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-9 border-accent/20 bg-white gap-1">
                              <span className="text-xs">اختر من القائمة</span>
                              <ChevronDown size={14} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-56 text-right max-h-72 overflow-y-auto" dir="rtl">
                            {isCitiesLoading ? (
                              <div className="flex items-center justify-center p-4">
                                <Loader2 size={20} className="animate-spin text-muted-foreground" />
                              </div>
                            ) : (
                              <>
                                <div className="p-2 border-b">
                                  <Input 
                                    placeholder="بحث في المدن..."
                                    className="h-8 text-xs"
                                    onChange={(e) => {
                                      const searchTerm = e.target.value.toLowerCase()
                                      // Filter logic will be handled by the map below
                                    }}
                                  />
                                </div>
                                {cities
                                  .filter(c => !profile.coverageCities.includes(c))
                                  .map(city => (
                                    <DropdownMenuItem 
                                      key={city} 
                                      onClick={() => {
                                        if (!profile.coverageCities.includes(city)) {
                                          setProfile(prev => ({ ...prev, coverageCities: [...prev.coverageCities, city] }))
                                          toast({ title: "تم الإضافة", description: `تم إضافة ${city} لقائمة التغطية` })
                                        }
                                      }} 
                                      className="cursor-pointer hover:bg-accent/10"
                                    >
                                      <MapPin size={12} className="ml-2 text-muted-foreground" />
                                      {city}
                                    </DropdownMenuItem>
                                  ))}
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">أضف المدن التي يمكنك التوصيل إليها. اكتب المدينة أو اخترها من القائمة</p>
                  </div>

                  <div className="space-y-2 pt-4 border-t border-slate-100">
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
                    rows={4}
                    placeholder="اشرح طبيعة عملك والمنتجات التي توفرها..."
                    value={profile.description}
                    onChange={e => setProfile({...profile, description: e.target.value})}
                    className="bg-white"
                  />
                  <p className="text-[11px] text-muted-foreground">يساعد وصف العمل المفصل الذكاء الاصطناعي في مطابقتك مع المناقصات المناسبة.</p>
                </div>
                
                <div className="pt-4 border-t border-slate-100 space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-bold text-slate-700">تخصصات العمل <span className="text-destructive">*</span></Label>
                    <span className="text-xs text-muted-foreground">التخصصات تحدد المناقصات التي تظهر لك</span>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 p-4 bg-slate-50 rounded-xl border border-slate-100 min-h-[80px]">
                    {profile.specializations.length > 0 ? profile.specializations.map(spec => (
                      <Badge key={spec} className="bg-primary/10 text-primary border-primary/20 px-3 py-1.5 flex items-center gap-2 hover:bg-primary/20 transition-colors text-sm">
                        {spec}
                        <button onClick={() => removeSpec(spec)} className="hover:text-destructive hover:bg-white/50 rounded-full p-0.5 transition-colors">
                          <X size={14} />
                        </button>
                      </Badge>
                    )) : (
                      <div className="w-full h-full flex items-center justify-center text-sm text-slate-400">
                        لم تقم بإضافة أي تخصصات بعد
                      </div>
                    )}
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="rounded-full h-8 border-dashed bg-white">
                          <Plus size={14} className="ml-1" />
                          إضافة تخصص
                          <ChevronDown size={14} className="mr-1 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48 text-right" dir="rtl">
                        {PREDEFINED_CATEGORIES.filter(c => !profile.specializations.includes(c)).map(cat => (
                          <DropdownMenuItem key={cat} onClick={() => addSpec(cat)} className="cursor-pointer">
                            {cat}
                          </DropdownMenuItem>
                        ))}
                        {PREDEFINED_CATEGORIES.filter(c => !profile.specializations.includes(c)).length === 0 && (
                          <div className="p-2 text-xs text-muted-foreground text-center">تمت إضافة جميع التخصصات المتاحة</div>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                     </div>
                   </div>
                 </div>
               </CardContent>
              <CardFooter className="border-t bg-slate-50/80 justify-end p-5">
                <Button className="gap-2 h-11 px-8 text-md shadow-md shadow-primary/20" onClick={handleSave} disabled={isLoading}>
                  حفظ البيانات الأساسية
                  {isLoading ? <Zap className="animate-pulse" size={18} /> : <CheckCircle2 size={18} />}
                </Button>
              </CardFooter>
            </Card>
            <Card className="shadow-sm border-none" id="certificates-section">
              <CardHeader className="border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Award size={20} className="text-primary" />
                  الشهادات والجوائز
                </CardTitle>
                <CardDescription>أضف شهاداتك المهنية واعتماداتك الصناعية</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {profile.certificates.map(cert => (
                  <div key={cert.id} className="p-4 bg-slate-50 rounded-lg border border-slate-100 flex items-start justify-between">
                    <div className="flex gap-4">
                      <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                        <Award size={24} />
                      </div>
                      <div className="space-y-1">
                        <p className="font-bold text-slate-800">{cert.name}</p>
                        <p className="text-sm text-muted-foreground">{cert.issuer}</p>
                        <p className="text-xs text-slate-500">
                          {cert.issueDate && `تاريخ الإصدار: ${cert.issueDate}`}
                          {cert.expiryDate && ` | صالح حتى: ${cert.expiryDate}`}
                        </p>
                        {cert.documentUrl && (
                          <a href={cert.documentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1 hover:underline mt-2">
                            <FileText size={12} />
                            عرض المستند المرفق
                          </a>
                        )}
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
                        <Label>اسم الشهادة <span className="text-destructive">*</span></Label>
                        <Input 
                          value={newCert.name}
                          onChange={e => setNewCert({...newCert, name: e.target.value})}
                          placeholder="مثال: ISO 9001"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>جهة الإصدار <span className="text-destructive">*</span></Label>
                        <Input 
                          value={newCert.issuer}
                          onChange={e => setNewCert({...newCert, issuer: e.target.value})}
                          placeholder="مثال: هيئة المواصفات"
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
                      <div className="space-y-2 sm:col-span-2">
                        <Label>مستند الشهادة (اختياري)</Label>
                        <div className="flex items-center gap-3">
                          <Button variant="outline" className="relative overflow-hidden w-full sm:w-auto">
                            <input 
                              type="file" 
                              accept=".pdf,.jpg,.png" 
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              onChange={handleCertUpload}
                              disabled={isUploadingCert}
                            />
                            {isUploadingCert ? <Zap className="animate-pulse ml-2" size={16} /> : <FileText size={16} className="ml-2" />}
                            {newCert.documentUrl ? "تم إرفاق الملف ✓" : "اختر ملف (PDF, JPG)..."}
                          </Button>
                        </div>
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

            <Card className="shadow-sm border-none overflow-hidden">
              <CardHeader className="border-b bg-slate-50/50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FolderOpen size={20} className="text-primary" />
                  المشاريع السابقة المميزة
                </CardTitle>
                <CardDescription>أبرز مشاريعك وأعمالك لزيادة الثقة وبناء سجل أعمال قوي</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {profile.projects.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {profile.projects.map(project => (
                      <div key={project.id} className="group relative bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
                        {project.images && project.images.length > 0 ? (
                          <div className="h-40 w-full bg-cover bg-center" style={{ backgroundImage: `url(${project.images[0]})` }} />
                        ) : (
                          <div className="h-40 w-full bg-slate-100 flex items-center justify-center text-slate-300">
                            <ImageIcon size={48} />
                          </div>
                        )}
                        <div className="p-4 flex-1 flex flex-col">
                          <h4 className="font-bold text-slate-800 line-clamp-1">{project.name}</h4>
                          <p className="text-sm text-slate-600 line-clamp-2 mt-1 flex-1">{project.description}</p>
                          {project.images && project.images.length > 1 && (
                            <div className="flex gap-1 mt-3">
                              {project.images.slice(1, 4).map((img, idx) => (
                                <div key={idx} className="h-10 w-10 rounded border bg-cover bg-center" style={{ backgroundImage: `url(${img})` }} />
                              ))}
                              {project.images.length > 4 && (
                                <div className="h-10 w-10 rounded border bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">
                                  +{project.images.length - 4}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <Button 
                          variant="destructive" 
                          size="icon" 
                          className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 rounded-full shadow-md" 
                          onClick={() => removeProject(project.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                
                {showProjectForm ? (
                  <div className="p-5 bg-slate-50 rounded-xl border border-slate-200 space-y-5 shadow-inner">
                    <h4 className="font-bold text-slate-800 border-b pb-2">إضافة مشروع جديد</h4>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="font-bold text-slate-700">اسم المشروع <span className="text-destructive">*</span></Label>
                        <Input 
                          value={newProject.name}
                          onChange={e => setNewProject({...newProject, name: e.target.value})}
                          placeholder="مثال: توريد مواد بناء لمشروع الفيلات"
                          className="bg-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold text-slate-700">تفاصيل المشروع (اختياري)</Label>
                        <Textarea 
                          value={newProject.description}
                          onChange={e => setNewProject({...newProject, description: e.target.value})}
                          placeholder="أبرز ما تم إنجازه، نوع المواد، والكميات..."
                          rows={3}
                          className="bg-white"
                        />
                      </div>
                      
                      <div className="space-y-2 pt-2 border-t">
                        <Label className="font-bold text-slate-700">صور المشروع (اختياري)</Label>
                        {newProject.images.length > 0 && (
                          <div className="flex gap-2 flex-wrap mb-3">
                            {newProject.images.map((img, idx) => (
                              <div key={idx} className="relative h-20 w-20 rounded-lg border shadow-sm group overflow-hidden">
                                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${img})` }} />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <button onClick={() => removeProjectImage(idx)} className="text-white hover:text-red-400">
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="relative border-2 border-dashed border-slate-300 rounded-lg p-6 flex flex-col items-center justify-center text-center hover:bg-slate-100 transition-colors bg-white">
                          <input 
                            type="file" 
                            accept="image/*" 
                            onChange={handleProjectImageUpload}
                            disabled={isUploadingProjImg}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" 
                          />
                          {isUploadingProjImg ? (
                            <Zap className="animate-pulse text-primary" size={24} />
                          ) : (
                            <>
                              <ImageIcon size={24} className="text-slate-400 mb-2" />
                              <p className="text-sm font-bold text-slate-600">انقر هنا لإضافة صورة للمشروع</p>
                              <p className="text-xs text-muted-foreground mt-1">يُفضل رفع صور واضحة للمنتجات أو موقع العمل</p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                      <Button variant="ghost" onClick={() => setShowProjectForm(false)}>إلغاء</Button>
                      <Button onClick={addProject} className="gap-2">
                        <CheckCircle2 size={16} />
                        حفظ المشروع
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full h-14 border-dashed border-2 text-slate-500 hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-colors text-md font-bold" onClick={() => setShowProjectForm(true)}>
                    <Plus size={18} className="ml-2" />
                    إضافة مشروع جديد
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm border-none">
              <CardHeader className="border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ImageIcon size={20} className="text-primary" />
                  معرض الصور وملفات الشركة
                </CardTitle>
                <CardDescription>أضف صور لمصانعك، منتجاتك، أو أي ملفات تعريفية</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {profile.companyFiles.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
                    {profile.companyFiles.map(file => (
                      <div key={file.id} className="relative group border rounded-lg overflow-hidden aspect-square bg-slate-50 flex flex-col items-center justify-center text-center p-2">
                        {file.type === 'image' ? (
                          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${file.url})` }} />
                        ) : (
                          <FileText size={32} className="text-slate-400 mb-2" />
                        )}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2">
                          <p className="text-white text-xs truncate w-full">{file.name}</p>
                          <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 mt-2" onClick={() => removeFile(file.id)}>
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="p-4 border border-dashed rounded-lg flex flex-col items-center justify-center py-8 text-center gap-2 relative hover:bg-slate-50 transition-colors">
                  <input 
                    type="file" 
                    accept=".pdf,.png,.jpg,.jpeg" 
                    onChange={handleFileUpload}
                    disabled={isUploadingFile}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" 
                  />
                  {isUploadingFile ? (
                    <Zap className="animate-pulse text-primary" size={24} />
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground mb-2">اسحب وأفلت الملفات هنا، أو انقر للاختيار</p>
                      <Button variant="outline" size="sm" className="pointer-events-none gap-2">
                        <Plus size={16} />
                        إضافة ملف أو صورة
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-4 space-y-6">
            <Card className="shadow-lg border-none bg-gradient-to-br from-secondary to-slate-800 text-white overflow-hidden relative">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-16 translate-x-16 blur-2xl" />
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-primary/20 rounded-full translate-y-12 -translate-x-12 blur-xl" />
              
              <CardContent className="p-8 space-y-6 relative z-10">
                <div className="h-24 w-24 rounded-full bg-white/10 flex items-center justify-center mx-auto border-4 border-white/5 shadow-inner">
                  <User size={48} className="text-white/80" />
                </div>
                <div className="text-center">
                  <h3 className="font-bold text-2xl tracking-tight">{profile.name || "الشركة"}</h3>
                  <p className="text-sm text-white/60 mt-1">شريك مورد عبر منصة مدماك تيك</p>
                </div>
                 <div className="pt-6 space-y-4 border-t border-white/10">
                   <div className="flex items-center justify-between text-sm bg-white/5 p-3 rounded-lg">
                     <span className="text-white/80 flex items-center gap-2">
                       <CheckCircle2 size={16} className={profile.isVerified ? "text-success" : "text-amber-400"} /> 
                       حالة التحقق
                     </span>
                     {profile.isVerified ? (
                       <Badge className="bg-success text-white border-none shadow-sm">موثق</Badge>
                     ) : (
                       <Badge className="bg-amber-500/20 text-amber-200 border-amber-400/30 shadow-sm">غير موثق</Badge>
                     )}
                   </div>
                   <div className="flex items-center justify-between text-sm bg-white/5 p-3 rounded-lg">
                     <span className="text-white/80 flex items-center gap-2"><MapPin size={16} className="text-accent" /> المقر الرئيسي</span>
                     <span className="font-bold text-white/90">{profile.location || "غير محدد"}</span>
                   </div>
{profile.coverageCities.length > 0 && (
                      <div className="text-sm bg-white/5 p-3 rounded-lg space-y-2">
                        <span className="text-white/80 flex items-center gap-2"><MapPin size={16} className="text-accent" /> مدن التغطية</span>
                        <div className="flex flex-wrap gap-2">
                          {profile.coverageCities.map(city => (
                            <Badge key={city} className="bg-accent/20 text-accent border border-accent/30 text-xs">{city}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                   <div className="flex items-center justify-between text-sm bg-white/5 p-3 rounded-lg">
                     <span className="text-white/80 flex items-center gap-2"><Award size={16} className="text-amber-400" /> التقييم العام</span>
                     <span className="font-bold text-amber-400">4.8 / 5.0</span>
                   </div>
                   {profile.isPremium && (
                     <div className="flex items-center justify-between text-sm bg-white/5 p-3 rounded-lg">
                       <span className="text-white/80 flex items-center gap-2"><Zap size={16} className="text-blue-400" /> درجة الالتزام</span>
                       <span className="font-bold text-blue-400">{profile.commitmentScore}%</span>
                     </div>
                   )}
                 </div>
              </CardContent>
            </Card>

            {/* Verification Guide */}
            {!profile.isVerified && (
              <Card className="shadow-md border-primary/20 bg-gradient-to-br from-primary/5 to-blue-50/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-bold text-primary flex items-center gap-2">
                    <ShieldCheck size={22} className="text-primary" />
                    كيف تصبح موثقاً؟ 📋
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    اتبع هذه الخطوات الثلاث لتصبح مورداً موثقاً والحصول على شارة التوثيق ✓
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Step 1 */}
                  <div 
                    className={`p-4 rounded-xl border-2 transition-all cursor-pointer hover:shadow-md ${profile.crNumber ? 'border-success bg-success/5' : 'border-dashed border-slate-200 bg-white'}`}
                    onClick={() => {
                      const el = document.getElementById('crNumber-input')
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-white font-bold ${profile.crNumber ? 'bg-success' : 'bg-slate-300'}`}>
                        {profile.crNumber ? <CheckCircle2 size={16} /> : "1"}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-slate-800">إضافة رقم السجل التجاري</h4>
                        <p className="text-sm text-slate-600">أضف رقم السجل التجاري الخاص بشركتك في الحقل أعلى الصفحة</p>
                        {!profile.crNumber && (
                          <p className="text-xs text-primary mt-2 bg-primary/5 px-2 py-1 rounded inline-block">
                            ⬇️ اضغط هنا وانتقل للحقل المطلوب
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div 
                    className={`p-4 rounded-xl border-2 transition-all cursor-pointer hover:shadow-md ${profile.certificates.length > 0 ? 'border-success bg-success/5' : 'border-dashed border-slate-200 bg-white'}`}
                    onClick={() => {
                      const el = document.getElementById('certificates-section')
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-white font-bold ${profile.certificates.length > 0 ? 'bg-success' : 'bg-slate-300'}`}>
                        {profile.certificates.length > 0 ? <CheckCircle2 size={16} /> : "2"}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-slate-800">إضافة الشهادات المهنية</h4>
                        <p className="text-sm text-slate-600">أضف شهادة مهنية واحدة على الأقل (مثل: ISO، شهادات الجودة، وغيرها)</p>
                        {!profile.certificates.length && (
                          <p className="text-xs text-primary mt-2 bg-primary/5 px-2 py-1 rounded inline-block">
                            ⬇️ اضغط هنا وانتقل لقسم الشهادات
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div 
                    className={`p-4 rounded-xl border-2 transition-all cursor-pointer hover:shadow-md ${profile.verificationRequested ? 'border-amber-300 bg-amber-50' : 'border-dashed border-slate-200 bg-white'}`}
                    onClick={() => {
                      if (profile.crNumber && profile.certificates.length > 0) {
                        const el = document.getElementById('request-verification-btn')
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-white font-bold ${profile.verificationRequested ? 'bg-amber-500' : 'bg-slate-300'}`}>
                        {profile.verificationRequested ? <CheckCircle2 size={16} /> : "3"}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-slate-800">طلب التوثيق</h4>
                        <p className="text-sm text-slate-600">بعد إكمال الخطوتين السابقتين، اضغط زر "طلب التوثيق"</p>
                        {!profile.verificationRequested && (
                          <p className="text-xs text-amber-600 mt-2 bg-amber-50 px-2 py-1 rounded inline-block">
                            ⚠️ أكمل الخطوتين 1 و 2 أولاً
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status Message */}
                  {profile.verificationRequested && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                        <Loader2 size={20} className="text-amber-600 animate-spin" />
                      </div>
                      <div>
                        <p className="font-bold text-amber-800">طلبك قيد المراجعة!</p>
                        <p className="text-sm text-amber-700">سيقوم فريق الإدارة بمراجعة وثائقك خلال 24-48 ساعة</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="shadow-md border-slate-100">
              <CardHeader className="bg-slate-50/50 border-b pb-4">
                <CardTitle className="text-md font-bold text-slate-800">مؤشر اكتمال الملف</CardTitle>
              </CardHeader>
              <CardContent className="p-5 space-y-4">
                {(() => {
                  const verifProgress = (profile.crNumber ? 50 : 0) + (profile.certificates.length > 0 ? 50 : 0)
                  return (
                    <>
                      <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden shadow-inner">
                        <div 
                          className={`h-full transition-all duration-500 ${
                            profile.isVerified 
                              ? "bg-gradient-to-r from-success to-green-400" 
                              : verifProgress === 100 
                                ? "bg-gradient-to-r from-amber-400 to-orange-500"
                                : "bg-gradient-to-r from-primary to-blue-400"
                          }`} 
                          style={{ width: `${profile.isVerified ? 100 : verifProgress}%` }} 
                        />
                      </div>
                      {profile.isVerified ? (
                        <p className="text-sm text-slate-600 leading-relaxed">
                          🎉 <span className="font-bold text-success">مبارك!</span> أنت مورد موثق الآن. تمت مراجعة وتوثيق ملفك بنجاح.
                        </p>
                      ) : verifProgress === 100 ? (
                        <p className="text-sm text-slate-600 leading-relaxed">
                          ملفك جاهز للتوثيق! ✓ اضغط الزر أدناه لإرسال طلب التوثيق.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-sm text-slate-600 leading-relaxed">
                            ملفك مكتمل بنسبة <span className="font-bold text-primary">{verifProgress}%</span> للتوثيق.
                          </p>
                          <div className="flex flex-wrap gap-2 text-xs">
                            {!profile.crNumber && (
                              <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                                📄 أضف السجل التجاري
                              </Badge>
                            )}
                            {profile.certificates.length === 0 && (
                              <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                                🏆 أضف شهادة واحدة
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()}
                {profile.isVerified ? (
                  <Badge className="w-full justify-center bg-success/10 text-success border-success/20 text-sm py-2">موثق ✓</Badge>
                ) : profile.verificationRequested ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-center">
                    <p className="text-sm text-amber-700 font-medium">📩 طلب التوثيق قيد المراجعة</p>
                    <p className="text-xs text-amber-600 mt-1">سيتم إشعارك عند انتهاء المراجعة</p>
                  </div>
                ) : profile.crNumber && profile.certificates.length > 0 ? (
                  <Button id="request-verification-btn" className="w-full gap-2" onClick={requestVerification}>
                    <CheckCircle2 size={16} />
                    طلب التوثيق
                  </Button>
                ) : (
                  <Button variant="outline" className="w-full gap-2 text-amber-700 border-amber-300 hover:bg-amber-50" disabled>
                    <X size={16} />
                    لطلب التوثيق، أكمل الخطوات أعلاه
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PortalLayout>
  )
}
