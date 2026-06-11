
"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SAUDI_CITIES, displayCity } from "@/lib/constants"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { useUser, useFirestore, useDoc, useMemoFirebase, useStorage } from "@/firebase"
import { doc, updateDoc } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { 
  Loader2, 
  Building2, 
  MapPin, 
  Phone, 
  Mail, 
  Globe, 
  FileCheck, 
  CheckCircle2, 
  ShieldCheck, 
  Upload, 
  Trash2, 
  Link as LinkIcon,
  X,
  Plus,
  Briefcase,
  Award,
  FolderOpen,
  User,
  Lock
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { sendEmailVerification } from "firebase/auth"
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog"

import { useTranslations, useLocale } from 'next-intl'
import { cn } from "@/lib/utils"
import { ProfileTour } from "@/components/profile-tour"
import { useSearchParams } from "next/navigation"

export default function ContractorProfilePage() {
  const { user, isUserLoading } = useUser()
  const firestore = useFirestore()
  const { toast } = useToast()
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const searchParams = useSearchParams()
  const showTour = searchParams.get('tour') === 'true'

  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)

  const [tourActive, setTourActive] = useState(() => {
    if (showTour) return true
    if (typeof window === 'undefined') return false
    const seen = localStorage.getItem('profile_tour_seen')
    return seen !== 'true'
  })

  const [activeTab, setActiveTab] = useState("basic")

  const [profile, setProfile] = useState({
    name: "",
    crNumber: "",
    taxNumber: "",
    description: "",
    city: "",
    location: "",
    phone: "",
    email: "",
    website: "",
    certificates: [] as {id: string, name: string, date: string, url?: string}[],
    legalDocuments: {
      cr: { url: "", expiryDate: "" },
      vat: { url: "", expiryDate: "" },
      zakat: { url: "", expiryDate: "" },
      gosi: { url: "", expiryDate: "" },
      chamber: { url: "", expiryDate: "" },
    },
    twoFactorEnabled: false,
    isVerified: false
  })

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  
  const { data: userData, isLoading: isUserDataLoading } = useDoc(userDocRef)

  // Sync with user data
  useEffect(() => {
    if (userData && !profile.name && !profile.description) { // Only initial sync
      setProfile(prev => ({
        ...prev,
        name: userData.name || userData.companyName || user?.displayName || "",
        crNumber: userData.crNumber || "",
        taxNumber: userData.taxNumber || "",
        city: userData.city || "",
        location: userData.location || "",
        phone: userData.phone || userData.phoneNumber || "",
        email: userData.email || user?.email || "",
        description: userData.description || "",
        website: userData.website || "",
        isVerified: userData.isVerified || false,
        certificates: userData.certificates || [],
        legalDocuments: userData.legalDocuments || {
          cr: { url: "", expiryDate: "" },
          vat: { url: "", expiryDate: "" },
          zakat: { url: "", expiryDate: "" },
          gosi: { url: "", expiryDate: "" },
          chamber: { url: "", expiryDate: "" },
        },
        twoFactorEnabled: userData.twoFactorEnabled || false
      }))
    }
  }, [userData, user])

  const handleSave = async () => {
    if (!user || !firestore) return
    setIsLoading(true)
    
    const isProfileComplete = Boolean(
      profile.name?.trim() &&
      profile.phone?.trim() &&
      profile.crNumber?.trim() &&
      profile.taxNumber?.trim() &&
      profile.city?.trim() &&
      profile.location?.trim()
    )

    try {
      await updateDoc(doc(firestore, "users", user.uid), {
        name: profile.name,
        companyName: profile.name,
        crNumber: profile.crNumber,
        taxNumber: profile.taxNumber || "",
        city: profile.city,
        location: profile.location,
        phone: profile.phone,
        phoneNumber: profile.phone,
        description: profile.description,
        website: profile.website,
        certificates: profile.certificates,
        legalDocuments: profile.legalDocuments,
        twoFactorEnabled: profile.twoFactorEnabled || false,
        profileCompleted: isProfileComplete
      })
      
      if (!isProfileComplete) {
        toast({ title: t("profile_toast_saved"), description: t("profile_toast_saved_incomplete") })
      } else {
        toast({ title: t("profile_toast_saved"), description: t("profile_toast_saved_full") })
      }
    } catch (e: any) {
      toast({ title: t("profile_toast_error"), description: e.message, variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  const storage = useStorage()
  
  const uploadToStorage = async (file: File, pathFolder: string) => {
    if (!storage) throw new Error("Storage not initialized")
    const storagePath = `${pathFolder}/${user?.uid}/${Date.now()}-${file.name}`
    const fileRef = ref(storage, storagePath)
    await uploadBytes(fileRef, file)
    return await getDownloadURL(fileRef)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    setIsUploading(true)
    try {
      const url = await uploadToStorage(file, "certificates")
      const newCert = {
        id: Date.now().toString(),
        name: file.name,
        date: new Date().toLocaleDateString(locale),
        url: url
      }
      const updatedCerts = [...profile.certificates, newCert]
      setProfile(prev => ({ ...prev, certificates: updatedCerts }))
      
      // Auto-save to firestore
      if (user && firestore) {
        try {
          await updateDoc(doc(firestore, "users", user.uid), {
            certificates: updatedCerts
          })
        } catch (err) {
          console.error("Auto-save failed:", err)
        }
      }

      toast({ title: t("profile_toast_upload_title"), description: t("profile_toast_upload_desc") })
    } catch (err) {
      toast({ title: t("profile_toast_error"), description: t("profile_toast_upload_failed"), variant: "destructive" })
    } finally {
      setIsUploading(false)
    }
  }

  const removeCertificate = async (id: string) => {
    const certToRemove = profile.certificates.find(c => c.id === id)
    const updatedCerts = profile.certificates.filter(c => c.id !== id)
    setProfile(prev => ({
      ...prev,
      certificates: updatedCerts
    }))

    if (user && firestore) {
      try {
        await updateDoc(doc(firestore, "users", user.uid), {
          certificates: updatedCerts
        })

        // Cleanup storage
        if (certToRemove?.url && storage) {
          try {
            const fileRef = ref(storage, certToRemove.url)
            await deleteObject(fileRef)
          } catch (storageErr) {
            console.warn("Could not delete from storage:", storageErr)
          }
        }

        toast({ title: t("profile_toast_delete_title"), description: t("profile_toast_delete_desc") })
      } catch (err) {
        console.error("Auto-save failed:", err)
      }
    }
  }

  const handleLegalDocUpload = async (key: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    setIsUploading(true)
    toast({ title: t("profile_toast_uploading"), description: t("profile_toast_uploading_desc") })
    
    try {
      const url = await uploadToStorage(file, "legalDocuments")
      const updatedDocs = {
        ...profile.legalDocuments,
        [key]: {
          ...profile.legalDocuments[key as keyof typeof profile.legalDocuments],
          url: url
        }
      }
      setProfile(prev => ({
        ...prev,
        legalDocuments: updatedDocs
      }))

      // Auto-save to firestore
      if (user && firestore) {
        try {
          await updateDoc(doc(firestore, "users", user.uid), {
            legalDocuments: updatedDocs
          })
        } catch (err) {
          console.error("Auto-save failed:", err)
        }
      }

      toast({ title: t("profile_toast_upload_title"), description: t("profile_toast_legal_updated") })
    } catch (err) {
      toast({ title: t("profile_toast_error"), description: t("profile_toast_legal_failed"), variant: "destructive" })
    } finally {
      setIsUploading(false)
    }
  }

  const updateLegalDocExpiry = async (key: string, date: string) => {
    const updatedDocs = {
      ...profile.legalDocuments,
      [key]: {
        ...profile.legalDocuments[key as keyof typeof profile.legalDocuments],
        expiryDate: date
      }
    }
    setProfile(prev => ({
      ...prev,
      legalDocuments: updatedDocs
    }))

    // Auto-save to firestore
    if (user && firestore) {
      try {
        await updateDoc(doc(firestore, "users", user.uid), {
          legalDocuments: updatedDocs
        })
      } catch (err) {
        console.error("Auto-save failed:", err)
      }
    }
  }

  const completionPercentage = Math.round([
    profile.name,
    profile.phone,
    profile.location,
    profile.description,
    profile.crNumber,
    profile.taxNumber,
    profile.legalDocuments.cr.url,
    profile.legalDocuments.vat.url
  ].filter(Boolean).length / 8 * 100)

  const tourSteps = [
    {
      targetId: "tour-step-company-name",
      title: locale === 'ar' ? "اسم الشركة" : "Company Name",
      description: locale === 'ar' 
        ? "أدخل الاسم الرسمي لشركتك كما هو مسجل في السجل التجاري. هذا هو الاسم الذي سيظهر للموردين."
        : "Enter your company's official name as registered in the Commercial Registration. This is the name suppliers will see.",
    },
    {
      targetId: "tour-step-phone",
      title: locale === 'ar' ? "رقم الهاتف" : "Phone Number",
      description: locale === 'ar'
        ? "أضف رقم هاتفك للتواصل. نوصي بإضافة رقم جوال سعودي بصيغة +966."
        : "Add your contact phone number. We recommend adding a Saudi mobile number in +966 format.",
    },
    {
      targetId: "tour-step-cr",
      title: locale === 'ar' ? "السجل التجاري" : "Commercial Registration",
      description: locale === 'ar'
        ? "أدخل رقم السجل التجاري المكون من 10 أرقام. هذا مطلوب للتوثيق والموافقة على عروضك."
        : "Enter your 10-digit Commercial Registration number. This is required for verification and approving your offers.",
    },
    {
      targetId: "tour-step-tax",
      title: locale === 'ar' ? "الرقم الضريبي" : "Tax Number",
      description: locale === 'ar'
        ? "أدخل الرقم الضريبي المكون من 15 رقم (يبدأ بـ 3). مطلوب لإصدار الفواتير الضريبية."
        : "Enter your 15-digit Tax Number (starts with 3). Required for issuing tax invoices.",
    },
    {
      targetId: "tour-step-city",
      title: locale === 'ar' ? "المدينة والموقع" : "City & Location",
      description: locale === 'ar'
        ? "حدد مدينتك وأدخل عنوانك التفصيلي. يساعد هذا الموردين في معرفة موقعك الجغرافي."
        : "Select your city and enter your detailed address. This helps suppliers know your geographic location.",
    },
    {
      targetId: "tour-step-legal-tab",
      title: locale === 'ar' ? "المستندات القانونية" : "Legal Documents",
      description: locale === 'ar'
        ? "الآن انتقل إلى تبويب المستندات القانونية لرفع المستندات المطلوبة للتوثيق. اضغط على التالي للانتقال."
        : "Now switch to the Legal tab to upload the required documents for verification. Click Next to proceed.",
    },
    {
      targetId: "tour-step-legal-cr",
      title: locale === 'ar' ? "السجل التجاري" : "CR Document",
      description: locale === 'ar'
        ? "ارفع صورة من السجل التجاري ساري المفعول. هذا المستند أساسي للتحقق من هوية شركتك."
        : "Upload a valid copy of your Commercial Registration. This document is essential to verify your company identity.",
    },
    {
      targetId: "tour-step-legal-vat",
      title: locale === 'ar' ? "شهادة ضريبة القيمة المضافة" : "VAT Certificate",
      description: locale === 'ar'
        ? "ارفع شهادة التسجيل في ضريبة القيمة المضافة. مطلوبة لإصدار الفواتير الضريبية."
        : "Upload your VAT registration certificate. Required for issuing tax invoices.",
    },
  ]

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
      <div className="max-w-6xl mx-auto py-8 space-y-8">
        {/* Header Section - Clean SaaS Redesign */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/40 p-8 relative overflow-hidden group">
          {/* Subtle Decorative Gradient */}
          <div className={cn("absolute top-0 w-1/2 h-full opacity-50 pointer-events-none", locale === 'ar' ? 'bg-gradient-to-l from-primary/5 to-transparent right-0' : 'bg-gradient-to-r from-primary/5 to-transparent left-0')} />
          
          <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-10">
            <div className="flex flex-col md:flex-row items-center gap-10 flex-1">
              {/* Avatar Section - Enhanced Pro Max Icon */}
              <div className="relative group/avatar">
                <div className="h-36 w-36 rounded-[3rem] bg-white shadow-[0_20px_50px_rgba(15,23,42,0.15)] flex items-center justify-center overflow-hidden transition-all duration-700 group-hover/avatar:scale-110 group-hover/avatar:rotate-3 border border-slate-100">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/80 to-secondary opacity-[0.03]" />
                  <div className="h-20 w-20 rounded-[2rem] bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg transform transition-transform duration-500 group-hover/avatar:scale-110">
                    <Building2 size={40} className="text-white" />
                  </div>
                </div>
                {profile.isVerified && (
                  <div className={cn("absolute -bottom-3 bg-success text-white p-3 rounded-[1.5rem] shadow-2xl border-4 border-white z-20 animate-in zoom-in duration-500", locale === 'ar' ? '-left-3' : '-right-3')}>
                    <ShieldCheck size={24} />
                  </div>
                )}
              </div>

              {/* Text Info - Enhanced Pro Max Typography */}
              <div className="text-center md:text-right space-y-4">
                <div className="space-y-1">
                  {profile.isVerified && (
                    <Badge className="px-4 py-1 rounded-full text-[10px] font-black border-none shadow-sm mb-2 bg-success/10 text-success">
                      {t("profile_certified_badge")}
                    </Badge>
                  )}
                  <h1 className={cn("text-4xl lg:text-5xl font-black text-slate-900 font-headline", locale !== 'ar' && "tracking-tighter", locale === 'ar' ? "leading-[1.6]" : "leading-none")}>{profile.name || t("profile_company_fallback")}</h1>
                </div>
                <div className="flex flex-wrap justify-center md:justify-start items-center gap-4 text-slate-500">
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 text-sm">
                    <Mail size={14} className="text-primary/60" />
                    <span>{profile.email}</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Stats Dashboard */}
            <div className="w-full lg:w-80 grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 flex flex-col items-center justify-center text-center space-y-1 group/stat hover:bg-white hover:shadow-lg transition-all duration-300">
                <span className={cn("text-[10px] font-bold text-slate-400 uppercase", locale !== 'ar' && "tracking-tighter")}>{t("profile_completion")}</span>
                <span className="text-3xl font-black text-primary leading-none">{completionPercentage}%</span>
                <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${completionPercentage}%` }} />
                </div>
              </div>
              <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 flex flex-col items-center justify-center text-center space-y-1 group/stat hover:bg-white hover:shadow-lg transition-all duration-300">
                <span className={cn("text-[10px] font-bold text-slate-400 uppercase", locale !== 'ar' && "tracking-tighter")}>{t("profile_certificates_label")}</span>
                <span className="text-3xl font-black text-slate-800 leading-none">{profile.certificates.length}</span>
                <span className="text-[10px] text-slate-400 font-medium mt-1">{t("profile_certificates_unit")}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar - Sticky */}
        <div className={cn("sticky top-6 z-40 flex justify-end gap-3 bg-white/40 backdrop-blur-2xl p-4 rounded-[2rem] border border-white/20 shadow-xl shadow-slate-200/20 max-w-fit", locale === 'ar' ? 'mr-auto' : 'ml-auto')}>
          <Button variant="ghost" onClick={() => window.location.reload()} className="h-12 px-6 rounded-2xl hover:bg-white/50 text-slate-600 transition-all font-bold">
            <X size={18} className="ml-2" />
            {t("profile_cancel")}
          </Button>
          <Button className="gap-2 h-12 px-10 rounded-2xl shadow-xl shadow-primary/30 bg-primary hover:bg-secondary hover:text-white hover:scale-105 active:scale-95 transition-all duration-300 font-bold text-white ring-offset-2 ring-primary/20 hover:ring-4" onClick={handleSave} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
            {t("profile_save_changes")}
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <TabsList className="w-full justify-start h-14 p-1 bg-slate-100/50 rounded-2xl border mb-8 overflow-x-auto overflow-y-hidden no-scrollbar">
            <TabsTrigger value="basic" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-full px-6 rounded-xl gap-2 text-md transition-all">
              <User size={18} />
              {t("profile_tab_basic")}
            </TabsTrigger>
            <TabsTrigger value="legal" id="tour-step-legal-tab" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-full px-6 rounded-xl gap-2 text-md transition-all">
              <ShieldCheck size={18} />
              {t("profile_tab_legal")}
            </TabsTrigger>
            <TabsTrigger value="certificates" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-full px-6 rounded-xl gap-2 text-md transition-all">
              <Award size={18} />
              {t("profile_tab_certificates")}
            </TabsTrigger>
            <TabsTrigger value="security" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-full px-6 rounded-xl gap-2 text-md transition-all">
              <Lock size={18} />
              {t("profile_tab_security")}
            </TabsTrigger>
          </TabsList>

          {/* BASIC INFO TAB */}
          <TabsContent value="basic" className="m-0 focus-visible:outline-none">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <Building2 size={22} className="text-primary" />
                  {t("profile_basic_title")}
                </CardTitle>
                <CardDescription>{t("profile_basic_desc")}</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div id="tour-step-company-name" className="space-y-2">
                      <Label htmlFor="name" className="text-slate-700 font-bold">{t("profile_company_name")} <span className="text-destructive mx-1">*</span></Label>
                      <Input 
                        id="name" 
                        value={profile.name}
                        onChange={e => setProfile({...profile, name: e.target.value})}
                        className="h-11 focus:ring-primary/20"
                      />
                    </div>
                    <div id="tour-step-phone" className="space-y-2">
                      <Label htmlFor="phone" className="text-slate-700 font-bold">{t("profile_phone")} <span className="text-destructive mx-1">*</span></Label>
                      <Input 
                        id="phone" 
                        value={profile.phone}
                        onChange={e => setProfile({...profile, phone: e.target.value})}
                        className="dir-ltr text-left h-11"
                        placeholder="+966 5x xxx xxxx"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div id="tour-step-cr" className="space-y-2">
                      <Label htmlFor="cr" className="text-slate-700 font-bold">{t("profile_cr")} <span className="text-destructive mx-1">*</span></Label>
                      <Input 
                        id="cr" 
                        value={profile.crNumber}
                        onChange={e => setProfile({...profile, crNumber: e.target.value})}
                        className="dir-ltr text-left h-11"
                        placeholder={t("profile_cr_placeholder")}
                      />
                    </div>
                    <div id="tour-step-tax" className="space-y-2">
                      <Label htmlFor="taxNumber" className="text-slate-700 font-bold">{t("profile_tax")} <span className="text-destructive mx-1">*</span></Label>
                      <Input 
                        id="taxNumber" 
                        value={profile.taxNumber || ""}
                        onChange={e => setProfile({...profile, taxNumber: e.target.value})}
                        className="dir-ltr text-left h-11"
                        placeholder={t("profile_tax_placeholder")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="website" className="text-slate-700 font-bold">{t("profile_website")} <span className="text-slate-400 text-xs font-normal mx-1">({t("profile_optional")})</span></Label>
                      <Input 
                        id="website" 
                        value={profile.website}
                        onChange={e => setProfile({...profile, website: e.target.value})}
                        className="dir-ltr text-left h-11"
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div id="tour-step-city" className="space-y-4">
                    <Label className="text-slate-700 font-bold">{t("profile_city")} <span className="text-destructive mx-1">*</span></Label>
                    <Select 
                      value={profile.city}
                      onValueChange={(v) => setProfile({ ...profile, city: v })}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder={t("profile_select_city")} />
                      </SelectTrigger>
                      <SelectContent className="max-h-72 overflow-y-auto">
                        {SAUDI_CITIES.map((city) => (
                          <SelectItem key={city} value={city}>{displayCity(city, locale)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-4">
                    <Label htmlFor="loc" className="text-slate-700 font-bold">{t("profile_address")} <span className="text-destructive mx-1">*</span></Label>
                    <div className="relative">
                      <MapPin className={cn("absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground", locale === 'ar' ? 'right-3' : 'left-3')} />
                      <Input 
                        id="loc" 
                        className={cn("h-11", locale === 'ar' ? 'pr-10' : 'pl-10')}
                        value={profile.location}
                        onChange={e => setProfile({...profile, location: e.target.value})}
                        placeholder={t("profile_address_placeholder")}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4 pt-4">
                  <Label htmlFor="desc" className="text-slate-700 font-bold">{t("profile_description")} <span className="text-slate-400 text-xs font-normal mx-1">({t("profile_optional")})</span></Label>
                  <Textarea 
                    id="desc" 
                    rows={5}
                    placeholder={t("profile_desc_placeholder")}
                    value={profile.description}
                    onChange={e => setProfile({...profile, description: e.target.value})}
                    className="bg-white resize-none text-md leading-relaxed"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* LEGAL TAB */}
          <TabsContent value="legal" className="m-0 focus-visible:outline-none">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <ShieldCheck size={22} className="text-primary" />
                  {t("profile_legal_title")}
                </CardTitle>
                <CardDescription>{t("profile_legal_desc")}</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[
                    { id: 'cr', label: t("profile_doc_cr"), icon: Building2 },
                    { id: 'vat', label: t("profile_doc_vat"), icon: FileCheck },
                    { id: 'zakat', label: t("profile_doc_zakat"), icon: ShieldCheck },
                    { id: 'gosi', label: t("profile_doc_gosi"), icon: CheckCircle2 },
                    { id: 'chamber', label: t("profile_doc_chamber"), icon: Building2 }
                  ].map((doc) => {
                    const data = profile.legalDocuments[doc.id as keyof typeof profile.legalDocuments]
                    return (
                      <div key={doc.id} id={'tour-step-legal-' + doc.id} className="p-5 rounded-2xl border bg-white hover:border-primary/20 transition-all space-y-4 shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-slate-50 flex items-center justify-center text-primary border">
                            <doc.icon size={20} />
                          </div>
                          <h4 className="font-bold text-slate-800 text-sm">{doc.label}</h4>
                        </div>

                        <div className="space-y-3 pt-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{t("profile_expiry")}</span>
                            {data?.expiryDate && (
                              <Badge variant="outline" className="text-[10px] font-normal">
                                {new Date(data.expiryDate) < new Date() ? t("profile_expired") : t("profile_valid")}
                              </Badge>
                            )}
                          </div>
                          <Input 
                            type="date" 
                            className="h-9 text-xs"
                            value={data?.expiryDate || ""}
                            onChange={(e) => updateLegalDocExpiry(doc.id, e.target.value)}
                          />
                          
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" className="flex-1 h-9 relative overflow-hidden bg-slate-50 hover:bg-primary hover:text-white transition-all group/upload">
                              <input 
                                type="file" 
                                className="absolute inset-0 opacity-0 cursor-pointer z-20"
                                accept=".pdf,.jpg,.jpeg,.png"
                                onChange={(e) => handleLegalDocUpload(doc.id, e)}
                              />
                              <Upload size={14} className="ml-2 transition-transform group-hover/upload:-translate-y-1" />
                              <span className="text-xs font-bold">{data?.url ? t("profile_upload_update") : t("profile_upload_upload")}</span>
                            </Button>
                            {data?.url && (
                              <Button variant="ghost" size="sm" className="h-9 w-9 p-0" asChild>
                                <a href={data.url} target="_blank" rel="noopener noreferrer"><LinkIcon size={14} /></a>
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* CERTIFICATES TAB */}
          <TabsContent value="certificates" className="m-0 focus-visible:outline-none">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="flex flex-row items-center justify-between border-b bg-slate-50/50">
                <div>
                  <CardTitle className="text-xl font-bold flex items-center gap-2">
                    <Award size={22} className="text-primary" />
                    {t("profile_certs_title")}
                  </CardTitle>
                  <CardDescription>{t("profile_certs_desc")}</CardDescription>
                </div>
                <Button className="relative overflow-hidden rounded-full h-10 px-6 gap-2 shadow-md">
                  <input 
                    type="file" 
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                  />
                  {isUploading ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
                  {t("profile_upload_new_cert")}
                </Button>
              </CardHeader>
              <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {profile.certificates.map(cert => (
                    <div key={cert.id} className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group hover:border-primary/20 transition-all">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
                          <Award size={24} />
                        </div>
                        <div>
                          <h5 className="font-bold text-slate-800 text-md leading-tight">{cert.name}</h5>
                          <p className="text-xs text-muted-foreground mt-1">{t("profile_uploaded_date", { date: cert.date })}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {cert.url && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" asChild>
                            <a href={cert.url} target="_blank" rel="noopener noreferrer"><LinkIcon size={14} /></a>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-300 hover:text-destructive" onClick={() => removeCertificate(cert.id)}>
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </div>
                  ))}
                  
                  {profile.certificates.length === 0 && (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center text-muted-foreground bg-slate-50/50 rounded-2xl border border-dashed">
                      <div className="h-20 w-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                        <Award size={32} className="opacity-20" />
                      </div>
                      <p className="font-medium">{t("profile_no_certs")}</p>
                      <p className="text-xs mt-1">{t("profile_no_certs_desc")}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SECURITY TAB */}
          <TabsContent value="security" className="m-0 focus-visible:outline-none">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <Lock size={22} className="text-primary" />
                  {t("profile_security_title")}
                </CardTitle>
                <CardDescription>{t("profile_security_desc")}</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                
                {/* 1. Account Provider Details */}
                <div className="p-5 rounded-2xl border bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1 text-right">
                    <h4 className="font-bold text-slate-800 text-sm">{t("profile_login_method")}</h4>
                    <p className="text-xs text-muted-foreground">{t("profile_login_method_desc")}</p>
                  </div>
                  <Badge variant="outline" className="px-4 py-1.5 rounded-xl font-bold text-xs bg-white shadow-sm flex items-center gap-1.5">
                    {user?.providerData.some(p => p.providerId === "google.com") ? (
                      <>
                        <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                        {t("profile_google_connected")}
                      </>
                    ) : (
                      <>
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        {t("profile_email_password")}
                      </>
                    )}
                  </Badge>
                </div>

                <Separator />

                {/* 2. Email Verification Control */}
                <div className="p-5 rounded-2xl border bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1 text-right">
                    <h4 className="font-bold text-slate-800 text-sm">{t("profile_email_status")}</h4>
                    <p className="text-xs text-muted-foreground font-semibold">{profile.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {user?.emailVerified ? (
                      <Badge className="px-4 py-1.5 rounded-xl font-bold text-xs bg-success/10 text-success border-none shadow-sm flex items-center gap-1.5">
                        <CheckCircle2 size={14} />
                        {t("profile_email_verified")}
                      </Badge>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                        <Badge className="px-4 py-1.5 rounded-xl font-bold text-xs bg-amber-100 text-amber-700 border-none shadow-sm flex items-center justify-center gap-1.5">
                          {t("profile_email_not_verified")}
                        </Badge>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-9 px-4 rounded-xl text-xs font-bold bg-white"
                          onClick={async () => {
                            try {
                              if (user) {
                                await sendEmailVerification(user);
                                toast({
                                  title: t("profile_toast_email_sent_title"),
                                  description: t("profile_toast_email_sent_desc")
                                });
                              }
                            } catch (e: any) {
                              toast({
                                title: t("profile_toast_email_error"),
                                description: e.message || t("profile_toast_email_error_desc"),
                                variant: "destructive"
                              });
                            }
                          }}
                        >
                          {t("profile_resend_verification")}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                {/* 3. 2-Step Verification Toggle */}
                <div className="p-5 rounded-2xl border bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                  <div className="space-y-1 flex-1 text-right">
                    <div className="flex items-center gap-2 justify-start">
                      <h4 className="font-bold text-slate-800 text-sm">{t("profile_two_factor")}</h4>
                      <Badge className="bg-primary/10 text-primary border-none text-[9px] font-black">{t("profile_two_factor_sms")}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-xl leading-relaxed mt-1">
                      {t("profile_two_factor_desc", { phone: profile.phone || t("profile_phone_required") })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={profile.twoFactorEnabled || false}
                      onCheckedChange={(checked) => {
                        if (checked && !profile.phone) {
                          toast({
                            title: t("profile_phone_required"),
                            description: t("profile_phone_required_desc"),
                            variant: "destructive"
                          });
                          return;
                        }
                        setProfile(prev => ({ ...prev, twoFactorEnabled: checked }));
                      }}
                    />
                  </div>
                </div>

                <Separator />

                {/* 4. Change Password */}
                <div className="p-5 rounded-2xl border bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                  <div className="space-y-1 flex-1 text-right">
                    <h4 className="font-bold text-slate-800 text-sm">{t("profile_change_password")}</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("profile_change_password_desc")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button 
                      variant="outline" 
                      className="bg-white"
                      onClick={() => setIsPasswordDialogOpen(true)}
                    >
                      {t("profile_change_password_btn")}
                    </Button>
                  </div>
                </div>

              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      <ChangePasswordDialog 
        open={isPasswordDialogOpen} 
        onOpenChange={setIsPasswordDialogOpen} 
      />
      {tourActive && (
        <ProfileTour
          steps={tourSteps}
          onStepChange={(stepIndex) => {
            if (stepIndex >= 5 && stepIndex <= 7) {
              setActiveTab("legal")
            } else {
              setActiveTab("basic")
            }
          }}
          onComplete={() => {
            setTourActive(false)
            localStorage.setItem('profile_tour_seen', 'true')
            toast({ title: t("profile_toast_saved"), description: t("profile_tour_completed") })
          }}
          onDismiss={() => {
            setTourActive(false)
            localStorage.setItem('profile_tour_seen', 'true')
          }}
        />
      )}
    </PortalLayout>
  )
}
