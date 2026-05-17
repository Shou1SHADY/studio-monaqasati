
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
  ShieldCheck,
  Building2,
  Upload,
  Link as LinkIcon,
  Mail
} from "lucide-react"
import { PREDEFINED_CATEGORIES, SAUDI_CITIES } from "@/lib/constants"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MapPicker } from "@/components/ui/map-picker"
import { suggestSupplierSpecializations } from "@/ai/flows/suggest-supplier-specializations-flow"
import { useToast } from "@/hooks/use-toast"
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection, useStorage } from "@/firebase"
import { doc, updateDoc, collection, query as firestoreQuery, orderBy } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"
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
    taxNumber: "",
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
    verificationRequested: false,
    legalDocuments: {
      cr: { url: "", expiryDate: "" },
      vat: { url: "", expiryDate: "" },
      zakat: { url: "", expiryDate: "" },
      gosi: { url: "", expiryDate: "" },
      chamber: { url: "", expiryDate: "" },
    },
    locationCoords: null as { lat: number, lng: number } | null
  })
  const [showMapDialog, setShowMapDialog] = useState(false)

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
  
  const cities = SAUDI_CITIES

  // Sync with user data
  useEffect(() => {
    if (userData && !profile.name && !profile.description) { // Only initial sync
      setProfile(prev => ({
        ...prev,
        name: userData.name || userData.companyName || user?.displayName || "",
        email: userData.email || user?.email || "",
        phone: userData.phone || "",
        crNumber: userData.crNumber || "",
        taxNumber: userData.taxNumber || "",
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
        verificationRequested: userData.verificationRequested || false,
        legalDocuments: userData.legalDocuments || {
          cr: { url: "", expiryDate: "" },
          vat: { url: "", expiryDate: "" },
          zakat: { url: "", expiryDate: "" },
          gosi: { url: "", expiryDate: "" },
          chamber: { url: "", expiryDate: "" },
        },
        locationCoords: userData.locationCoords || null
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
        taxNumber: profile.taxNumber || "",
        city: profile.location,
        location: profile.location,
        coverageCities: profile.coverageCities,
        description: profile.description,
        specializations: profile.specializations,
        certificates: profile.certificates,
        projects: profile.projects,
        companyFiles: profile.companyFiles,
        legalDocuments: profile.legalDocuments,
        locationCoords: profile.locationCoords,
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
    const hasCR = profile.legalDocuments?.cr?.url && profile.legalDocuments?.cr?.expiryDate
    const hasVAT = profile.legalDocuments?.vat?.url && profile.legalDocuments?.vat?.expiryDate

    if (!profile.crNumber || !hasCR || !hasVAT) {
      toast({ 
        title: "بيانات ناقصة", 
        description: "يجب رفع السجل التجاري وشهادة ضريبة القيمة المضافة مع تواريخ الانتهاء للتوثيق", 
        variant: "destructive" 
      })
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
      
      // Auto-save to firestore
      if (user && firestore) {
        try {
          await updateDoc(doc(firestore, "users", user.uid), {
            specializations: newSpecs
          })
        } catch (err) {
          console.error("Auto-save failed:", err)
        }
      }
      
      toast({
        title: "اقتراحات ناجحة",
        description: "تم تحديث تخصصاتك بناءً على وصف العمل الخاص بك وحفظها.",
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

  const removeSpec = async (spec: string) => {
    const updatedSpecs = profile.specializations.filter(s => s !== spec)
    setProfile(prev => ({
      ...prev,
      specializations: updatedSpecs
    }))
    
    if (user && firestore) {
      try {
        await updateDoc(doc(firestore, "users", user.uid), {
          specializations: updatedSpecs
        })
      } catch (err) {
        console.error("Auto-save failed:", err)
      }
    }
  }

  const addSpec = async (spec: string) => {
    if (!profile.specializations.includes(spec)) {
      const updatedSpecs = [...profile.specializations, spec]
      setProfile(prev => ({
        ...prev,
        specializations: updatedSpecs
      }))
      
      // Auto-save to firestore
      if (user && firestore) {
        try {
          await updateDoc(doc(firestore, "users", user.uid), {
            specializations: updatedSpecs
          })
        } catch (err) {
          console.error("Auto-save failed:", err)
        }
      }
    }
  }

  const addCertificate = async () => {
    if (!newCert.name || !newCert.issuer) {
      toast({ title: "خطأ", description: "يرجى تعبئة الحقول المطلوبة", variant: "destructive" })
      return
    }
    const updatedCerts = [...profile.certificates, { ...newCert, id: Date.now().toString() }]
    setProfile(prev => ({
      ...prev,
      certificates: updatedCerts
    }))
    
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

    setNewCert({ name: "", issuer: "", issueDate: "", expiryDate: "", documentUrl: "" })
    setShowCertForm(false)
    toast({ title: "تم الحفظ", description: "تمت إضافة الشهادة وحفظها بنجاح" })
  }

  const storage = useStorage()
  
  const uploadToStorage = async (file: File, pathFolder: string) => {
    if (!storage) throw new Error("Storage not initialized")
    const storagePath = `${pathFolder}/${user?.uid}/${Date.now()}-${file.name}`
    const fileRef = ref(storage, storagePath)
    await uploadBytes(fileRef, file)
    return await getDownloadURL(fileRef)
  }

  const handleCertUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploadingCert(true)
    try {
      const url = await uploadToStorage(file, "certificates")
      setNewCert(prev => ({ ...prev, documentUrl: url }))
      toast({ title: "تم الرفع", description: "تم إرفاق مستند الشهادة بنجاح" })
    } catch (err) {
      toast({ title: "خطأ", description: "فشل رفع الملف", variant: "destructive" })
    } finally {
      setIsUploadingCert(false)
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
        if (certToRemove?.documentUrl && storage) {
          try {
            const fileRef = ref(storage, certToRemove.documentUrl)
            await deleteObject(fileRef)
          } catch (storageErr) {
            console.warn("Could not delete from storage:", storageErr)
          }
        }
        
        toast({ title: "تم الحذف", description: "تم حذف الشهادة وحفظ التغييرات" })
      } catch (err) {
        console.error("Auto-save failed:", err)
      }
    }
  }

  const addProject = async () => {
    if (!newProject.name) {
      toast({ title: "خطأ", description: "يرجى كتابة اسم المشروع", variant: "destructive" })
      return
    }
    const updatedProjects = [...profile.projects, { ...newProject, id: Date.now().toString() }]
    setProfile(prev => ({
      ...prev,
      projects: updatedProjects
    }))
    
    // Auto-save to firestore to prevent data loss on refresh
    if (user && firestore) {
      try {
        await updateDoc(doc(firestore, "users", user.uid), {
          projects: updatedProjects
        })
      } catch (err) {
        console.error("Auto-save failed:", err)
      }
    }
    
    setNewProject({ name: "", description: "", images: [] })
    setShowProjectForm(false)
    toast({ title: "تم الحفظ", description: "تمت إضافة المشروع وحفظه بنجاح" })
  }

  const handleProjectImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploadingProjImg(true)
    try {
      const url = await uploadToStorage(file, "projects")
      setNewProject(prev => ({ ...prev, images: [...prev.images, url] }))
    } catch (err) {
      toast({ title: "خطأ", description: "فشل رفع الصورة", variant: "destructive" })
    } finally {
      setIsUploadingProjImg(false)
    }
  }

  const removeProjectImage = (index: number) => {
    setNewProject(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)
    }))
  }

  const removeProject = async (id: string) => {
    const projectToRemove = profile.projects.find(p => p.id === id)
    const updatedProjects = profile.projects.filter(p => p.id !== id)
    setProfile(prev => ({
      ...prev,
      projects: updatedProjects
    }))
    
    if (user && firestore) {
      try {
        await updateDoc(doc(firestore, "users", user.uid), {
          projects: updatedProjects
        })

        // Cleanup storage for all project images
        if (projectToRemove?.images && storage) {
          for (const imageUrl of projectToRemove.images) {
            try {
              const imageRef = ref(storage, imageUrl)
              await deleteObject(imageRef)
            } catch (storageErr) {
              console.warn("Could not delete project image:", storageErr)
            }
          }
        }

        toast({ title: "تم الحذف", description: "تم حذف المشروع وحفظ التغييرات" })
      } catch (err) {
        console.error("Auto-save failed:", err)
      }
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    setIsUploadingFile(true)
    try {
      const isImage = file.type.startsWith('image/')
      const url = await uploadToStorage(file, "companyFiles")
      const newFile: CompanyFile = {
        id: Date.now().toString(),
        name: file.name,
        type: isImage ? 'image' : 'document',
        url: url
      }
      const updatedFiles = [...profile.companyFiles, newFile]
      setProfile(prev => ({ ...prev, companyFiles: updatedFiles }))

      // Auto-save to firestore
      if (user && firestore) {
        try {
          await updateDoc(doc(firestore, "users", user.uid), {
            companyFiles: updatedFiles
          })
        } catch (err) {
          console.error("Auto-save failed:", err)
        }
      }

      toast({ title: "تم الحفظ", description: "تم رفع الملف وحفظه بنجاح." })
    } catch (err) {
      toast({ title: "خطأ", description: "فشل رفع الملف", variant: "destructive" })
    } finally {
      setIsUploadingFile(false)
    }
  }

  const removeFile = async (id: string) => {
    const fileToRemove = profile.companyFiles.find(f => f.id === id)
    const updatedFiles = profile.companyFiles.filter(f => f.id !== id)
    setProfile(prev => ({
      ...prev,
      companyFiles: updatedFiles
    }))
    
    if (user && firestore) {
      try {
        await updateDoc(doc(firestore, "users", user.uid), {
          companyFiles: updatedFiles
        })

        // Cleanup storage
        if (fileToRemove?.url && storage) {
          try {
            const fileRef = ref(storage, fileToRemove.url)
            await deleteObject(fileRef)
          } catch (storageErr) {
            console.warn("Could not delete file from storage:", storageErr)
          }
        }

        toast({ title: "تم الحذف", description: "تم حذف الملف وحفظ التغييرات" })
      } catch (err) {
        console.error("Auto-save failed:", err)
      }
    }
  }

  const handleLegalDocUpload = async (key: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    toast({ title: "جاري الرفع...", description: "يتم رفع المستند الآن" })
    
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

      toast({ title: "تم الرفع", description: "تم تحديث المستند وحفظه بنجاح" })
    } catch (err) {
      toast({ title: "خطأ", description: "فشل رفع المستند القانوني", variant: "destructive" })
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
    profile.specializations.length > 0,
    profile.legalDocuments.cr.url,
    profile.legalDocuments.vat.url,
    profile.projects.length > 0
  ].filter(Boolean).length / 10 * 100)

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
        {/* Header Section - Clean SaaS Redesign */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/40 p-8 relative overflow-hidden group">
          {/* Subtle Decorative Gradient */}
          <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-primary/5 to-transparent opacity-50 pointer-events-none" />
          
          <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-10">
            <div className="flex flex-col md:flex-row items-center gap-10 flex-1">
              {/* Avatar Section - Enhanced Pro Max Icon */}
              <div className="relative group/avatar">
                <div className="h-36 w-36 rounded-[3rem] bg-white shadow-[0_20px_50px_rgba(15,23,42,0.15)] flex items-center justify-center overflow-hidden transition-all duration-700 group-hover/avatar:scale-110 group-hover/avatar:rotate-3 border border-slate-100">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/80 to-secondary opacity-[0.03]" />
                  <div className="h-20 w-20 rounded-[2rem] bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg transform transition-transform duration-500 group-hover/avatar:scale-110">
                    <Briefcase size={40} className="text-white" />
                  </div>
                </div>
                {profile.isVerified && (
                  <div className="absolute -bottom-3 -left-3 bg-success text-white p-3 rounded-[1.5rem] shadow-2xl border-4 border-white z-20 animate-in zoom-in duration-500">
                    <ShieldCheck size={24} />
                  </div>
                )}
              </div>

              {/* Text Info - Enhanced Pro Max Typography */}
              <div className="text-center md:text-right space-y-4">
                <div className="space-y-1">
                  <Badge className={`px-4 py-1 rounded-full text-[10px] font-black border-none shadow-sm mb-2 ${profile.isVerified ? "bg-success/10 text-success" : "bg-amber-100 text-amber-700"}`}>
                    {profile.isVerified ? "موثق معتمد لدى مدماك" : "في انتظار مراجعة التوثيق"}
                  </Badge>
                  <h1 className="text-4xl lg:text-5xl font-black text-slate-900 font-headline tracking-tighter leading-none">{profile.name || "اسم الشركة"}</h1>
                </div>
                <div className="flex flex-wrap justify-center md:justify-start items-center gap-4 text-slate-500">
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 text-sm">
                    <Mail size={14} className="text-primary/60" />
                    <span>{profile.email}</span>
                  </div>
                  {profile.isPremium && (
                    <div className="flex items-center gap-2 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-100 text-sm text-amber-700 font-bold">
                      <Award size={14} className="text-amber-500" />
                      <span>عضوية بريميوم</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Stats Dashboard */}
            <div className="w-full lg:w-80 grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 flex flex-col items-center justify-center text-center space-y-1 group/stat hover:bg-white hover:shadow-lg transition-all duration-300">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">نسبة الإكمال</span>
                <span className="text-3xl font-black text-primary leading-none">{completionPercentage}%</span>
                <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${completionPercentage}%` }} />
                </div>
              </div>
              <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 flex flex-col items-center justify-center text-center space-y-1 group/stat hover:bg-white hover:shadow-lg transition-all duration-300">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">المشاريع</span>
                <span className="text-3xl font-black text-slate-800 leading-none">{profile.projects.length}</span>
                <span className="text-[10px] text-slate-400 font-medium mt-1">مشروع منجز</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar - Sticky */}
        <div className="sticky top-6 z-40 flex justify-end gap-3 bg-white/40 backdrop-blur-2xl p-4 rounded-[2rem] border border-white/20 shadow-xl shadow-slate-200/20 max-w-fit mr-auto">
          <Button variant="ghost" onClick={() => window.location.reload()} className="h-12 px-6 rounded-2xl hover:bg-white/50 text-slate-600 transition-all font-bold">
            <X size={18} className="ml-2" />
            إلغاء
          </Button>
          <Button className="gap-2 h-12 px-10 rounded-2xl shadow-xl shadow-primary/30 bg-primary hover:bg-secondary hover:text-white hover:scale-105 active:scale-95 transition-all duration-300 font-bold text-white ring-offset-2 ring-primary/20 hover:ring-4" onClick={handleSave} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
            حفظ التغييرات
          </Button>
        </div>

        <Tabs defaultValue="basic" className="space-y-8" dir="rtl">
          <TabsList className="w-full justify-start h-14 p-1 bg-slate-100/50 rounded-2xl border mb-8 overflow-x-auto overflow-y-hidden no-scrollbar">
            <TabsTrigger value="basic" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-full px-6 rounded-xl gap-2 text-md transition-all">
              <User size={18} />
              البيانات الأساسية
            </TabsTrigger>
            <TabsTrigger value="specializations" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-full px-6 rounded-xl gap-2 text-md transition-all">
              <Zap size={18} />
              التخصصات
            </TabsTrigger>
            <TabsTrigger value="legal" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-full px-6 rounded-xl gap-2 text-md transition-all">
              <ShieldCheck size={18} />
              التوثيق القانوني
            </TabsTrigger>
            <TabsTrigger value="portfolio" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-full px-6 rounded-xl gap-2 text-md transition-all">
              <Award size={18} />
              سجل الأعمال
            </TabsTrigger>
            <TabsTrigger value="files" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-full px-6 rounded-xl gap-2 text-md transition-all">
              <FolderOpen size={18} />
              المرفقات العامة
            </TabsTrigger>
          </TabsList>

          {/* BASIC INFO TAB */}
          <TabsContent value="basic" className="m-0 focus-visible:outline-none">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <User size={22} className="text-primary" />
                  معلومات التواصل والمقر
                </CardTitle>
                <CardDescription>البيانات التي تظهر للمقاولين عند التواصل معك</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-slate-700 font-bold">اسم الشركة التجاري</Label>
                      <Input 
                        id="name" 
                        value={profile.name}
                        onChange={e => setProfile({...profile, name: e.target.value})}
                        className="h-11 focus:ring-primary/20"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone" className="text-slate-700 font-bold">رقم الجوال المعتمد</Label>
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
                    <div className="space-y-2">
                      <Label htmlFor="crNumber-input" className="text-slate-700 font-bold">رقم السجل التجاري</Label>
                      <Input 
                        id="crNumber-input" 
                        value={profile.crNumber}
                        onChange={e => setProfile({...profile, crNumber: e.target.value})}
                        className="dir-ltr text-left h-11"
                        placeholder="10 أرقام"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="taxNumber-input" className="text-slate-700 font-bold">الرقم الضريبي / رقم البطاقة الضريبية</Label>
                      <Input 
                        id="taxNumber-input" 
                        value={profile.taxNumber || ""}
                        onChange={e => setProfile({...profile, taxNumber: e.target.value})}
                        className="dir-ltr text-left h-11"
                        placeholder="15 رقم تبدأ بـ 3"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-slate-700 font-bold opacity-70">البريد الإلكتروني (حساب النظام)</Label>
                      <Input 
                        id="email" 
                        value={profile.email}
                        disabled
                        className="bg-slate-50 text-slate-500 dir-ltr text-left h-11"
                      />
                    </div>
                  </div>
                </div>

                <Separator className="my-4" />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <Label className="text-slate-700 font-bold">المقر الرئيسي</Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input 
                            id="loc" 
                            className="pr-10 h-11"
                            value={profile.location}
                            onChange={e => setProfile({...profile, location: e.target.value})}
                            placeholder="المدينة، الحي..."
                          />
                        </div>
                        <Button 
                          type="button" 
                          variant="outline" 
                          size="icon" 
                          className={`h-11 w-11 shrink-0 ${profile.locationCoords ? 'bg-success/10 border-success/30 text-success' : ''}`}
                          onClick={() => setShowMapDialog(true)}
                        >
                          <MapPin size={18} />
                        </Button>
                      </div>
                      {profile.locationCoords && (
                        <p className="text-[10px] text-success font-medium mt-1">✓ تم تحديد الموقع على الخريطة</p>
                      )}
                    </div>

                    <div className="space-y-4">
                      <Label className="text-slate-700 font-bold">مدن التغطية والعمل</Label>
                      <div className="flex gap-2">
                        <Input 
                          placeholder="أضف مدينة..."
                          className="h-11 flex-1 bg-white"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              const input = e.target as HTMLInputElement
                              const city = input.value.trim()
                              if (city && !profile.coverageCities.includes(city)) {
                                setProfile(prev => ({ ...prev, coverageCities: [...prev.coverageCities, city] }))
                                input.value = ''
                              }
                            }
                          }}
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="h-11 px-4 gap-2 border-slate-200">
                              <ChevronDown size={16} />
                              القائمة
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-56 text-right max-h-72 overflow-y-auto" dir="rtl">
                            {cities.filter(c => !profile.coverageCities.includes(c)).map(city => (
                              <DropdownMenuItem key={city} onClick={() => setProfile(prev => ({ ...prev, coverageCities: [...prev.coverageCities, city] }))} className="cursor-pointer">
                                {city}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {profile.coverageCities.map(city => (
                          <Badge key={city} className="bg-primary/5 text-primary border-primary/20 px-3 py-1.5 flex items-center gap-2 hover:bg-primary/10 transition-colors">
                            {city}
                            <X size={14} className="cursor-pointer" onClick={() => setProfile(prev => ({ ...prev, coverageCities: prev.coverageCities.filter(c => c !== city) }))} />
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  <Dialog open={showMapDialog} onOpenChange={setShowMapDialog}>
                    <DialogContent className="sm:max-w-[600px] text-right" dir="rtl">
                      <DialogHeader>
                        <DialogTitle>تحديد المقر على الخريطة</DialogTitle>
                        <DialogDescription>اختر موقع المقر الرئيسي لشركتك بدقة</DialogDescription>
                      </DialogHeader>
                      <div className="h-[400px] w-full rounded-xl overflow-hidden border">
                        <MapPicker 
                          initialPosition={profile.locationCoords} 
                          onLocationSelect={(coords) => setProfile(prev => ({ ...prev, locationCoords: coords }))} 
                        />
                      </div>
                      <DialogFooter>
                        <Button onClick={() => setShowMapDialog(false)} className="w-full">تأكيد الموقع</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <div className="space-y-4 pt-4">
                    <Label htmlFor="desc" className="text-slate-700 font-bold">وصف الشركة (البروفايل التعريفي)</Label>
                    <Textarea 
                      id="desc" 
                      rows={5}
                      placeholder="اكتب نبذة عن تاريخ الشركة، خبراتها، وما يميزها عن المنافسين..."
                      value={profile.description}
                      onChange={e => setProfile({...profile, description: e.target.value})}
                      className="bg-white resize-none text-md leading-relaxed"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

          {/* SPECIALIZATIONS TAB */}
          <TabsContent value="specializations" className="m-0 focus-visible:outline-none">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <Zap size={22} className="text-primary" />
                  تخصصات العمل والمطابقة
                </CardTitle>
                <CardDescription>تساعد هذه البيانات في إظهار شركتك في نتائج البحث المناسبة وتقديم مناقصات مطابقة</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-8">
                <div className="p-6 bg-gradient-to-br from-primary/5 to-transparent rounded-2xl border border-primary/10 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        المساعد الذكي (AI Analyzer)
                        <Badge className="bg-primary/20 text-primary border-none text-[10px]">BETA</Badge>
                      </h3>
                      <p className="text-sm text-muted-foreground">سيقوم الذكاء الاصطناعي بتحليل وصف شركتك واقتراح أفضل التخصصات لك</p>
                    </div>
                    <Button 
                      onClick={handleAiSuggest}
                      disabled={isGenerating || !profile.description}
                      className="gap-2 bg-white text-primary border-primary/20 hover:bg-primary hover:text-white transition-all shadow-sm"
                      variant="outline"
                    >
                      {isGenerating ? <Loader2 className="animate-spin" size={18} /> : <Zap size={18} />}
                      تحليل الوصف الآن
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-lg font-bold text-slate-700">التخصصات الحالية</Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="rounded-full h-9 border-dashed px-4">
                          <Plus size={16} className="ml-2" />
                          إضافة تخصص يدوياً
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56 text-right max-h-72 overflow-y-auto" dir="rtl">
                        {PREDEFINED_CATEGORIES.filter(c => !profile.specializations.includes(c)).map(cat => (
                          <DropdownMenuItem key={cat} onClick={() => addSpec(cat)} className="cursor-pointer">
                            {cat}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {profile.specializations.length > 0 ? profile.specializations.map(spec => (
                      <div key={spec} className="p-4 bg-white rounded-xl border border-slate-100 flex items-center justify-between hover:border-primary/30 transition-all shadow-sm group">
                        <span className="font-medium text-slate-700">{spec}</span>
                        <button onClick={() => removeSpec(spec)} className="text-slate-300 hover:text-destructive transition-colors">
                          <X size={18} />
                        </button>
                      </div>
                    )) : (
                      <div className="col-span-full py-12 flex flex-col items-center justify-center text-muted-foreground bg-slate-50 rounded-2xl border border-dashed">
                        <Zap size={32} className="opacity-20 mb-2" />
                        <p>لم تقم بإضافة أي تخصصات بعد</p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* LEGAL TAB */}
          <TabsContent value="legal" className="m-0 focus-visible:outline-none">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <Card className="shadow-sm border-slate-200">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                      <ShieldCheck size={22} className="text-primary" />
                      الوثائق الرسمية والتوثيق
                    </CardTitle>
                    <CardDescription>الوثائق المطلوبة للتحقق من هوية المنشأة</CardDescription>
                  </CardHeader>
                  <CardContent className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {[
                        { id: 'cr', label: 'السجل التجاري', icon: FileText },
                        { id: 'vat', label: 'شهادة ضريبة القيمة المضافة', icon: Award },
                        { id: 'zakat', label: 'شهادة الزكاة', icon: ShieldCheck },
                        { id: 'gosi', label: 'شهادة التأمينات الاجتماعية (GOSI)', icon: CheckCircle2 },
                        { id: 'chamber', label: 'شهادة الغرفة التجارية', icon: Building2 }
                      ].map((doc) => {
                        const data = profile.legalDocuments[doc.id as keyof typeof profile.legalDocuments]
                        return (
                          <div key={doc.id} className="p-5 rounded-2xl border bg-white hover:border-primary/20 transition-all space-y-4 shadow-sm">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-lg bg-slate-50 flex items-center justify-center text-primary border">
                                <doc.icon size={20} />
                              </div>
                              <h4 className="font-bold text-slate-800 text-sm">{doc.label}</h4>
                            </div>

                            <div className="space-y-3 pt-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">تاريخ الانتهاء</span>
                                {data?.expiryDate && (
                                  <Badge variant="outline" className="text-[10px] font-normal">
                                    {new Date(data.expiryDate) < new Date() ? "منتهي" : "ساري"}
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
                                  <span className="text-xs font-bold">{data?.url ? 'تحديث' : 'رفع'}</span>
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
              </div>

              <div className="space-y-6">
                <Card className="shadow-sm border-primary/20 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="text-lg">حالة التوثيق</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-col items-center text-center p-4 bg-white rounded-2xl border shadow-inner">
                      {profile.isVerified ? (
                        <>
                          <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center text-success mb-3">
                            <ShieldCheck size={32} />
                          </div>
                          <h4 className="font-bold text-success text-xl">حساب موثق بالكامل</h4>
                          <p className="text-sm text-muted-foreground mt-2">تتمتع شركتك بكامل المزايا وتظهر كشريك معتمد لدى جميع المقاولين</p>
                        </>
                      ) : profile.verificationRequested ? (
                        <>
                          <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 mb-3 animate-pulse">
                            <Loader2 size={32} />
                          </div>
                          <h4 className="font-bold text-amber-700">الطلب قيد المراجعة</h4>
                          <p className="text-sm text-muted-foreground mt-2">يتم الآن مراجعة وثائقك من قبل فريق الإدارة. سيتم إشعارك فور اكتمال التوثيق.</p>
                        </>
                      ) : (
                        <>
                          <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                            <ShieldCheck size={32} />
                          </div>
                          <h4 className="font-bold text-slate-800">الحساب غير موثق</h4>
                          <p className="text-sm text-muted-foreground mt-2">يرجى رفع السجل التجاري وشهادة القيمة المضافة لطلب التوثيق الرسمي</p>
                          <Button 
                            className="mt-4 w-full h-11" 
                            onClick={requestVerification}
                            disabled={profile.verificationRequested}
                          >
                            إرسال طلب التوثيق
                          </Button>
                        </>
                      )}
                    </div>
                    
                    <div className="p-4 rounded-xl bg-white/50 space-y-2 border">
                      <h5 className="font-bold text-sm">مزايا التوثيق:</h5>
                      <ul className="text-xs text-muted-foreground space-y-2">
                        <li className="flex items-center gap-2">✓ ظهور شعار "موثق" بجانب اسم الشركة</li>
                        <li className="flex items-center gap-2">✓ ترتيب أعلى في نتائج البحث لدى المقاولين</li>
                        <li className="flex items-center gap-2">✓ إمكانية التقديم على المناقصات الحكومية والضخمة</li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* PORTFOLIO TAB */}
          <TabsContent value="portfolio" className="m-0 focus-visible:outline-none">
            <div className="space-y-8">
              {/* Projects Sub-section */}
              <Card className="shadow-sm border-slate-200">
                <CardHeader className="flex flex-row items-center justify-between border-b bg-slate-50/50">
                  <div>
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                      <FolderOpen size={22} className="text-primary" />
                      معرض المشاريع والمنجزات
                    </CardTitle>
                    <CardDescription>أبرز مشاريعك السابقة لتعزيز ثقة المقاولين</CardDescription>
                  </div>
                  <Button 
                    onClick={() => setShowProjectForm(true)}
                    className="gap-2 rounded-full h-10 px-6"
                  >
                    <Plus size={18} />
                    إضافة مشروع
                  </Button>
                </CardHeader>
                <CardContent className="p-6">
                  {showProjectForm ? (
                    <div className="p-6 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 mb-8 space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label className="font-bold">اسم المشروع</Label>
                          <Input 
                            value={newProject.name}
                            onChange={e => setNewProject({...newProject, name: e.target.value})}
                            placeholder="مثال: توريد مواد لمشروع القدية"
                            className="bg-white"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="font-bold">صور المشروع</Label>
                          <div className="flex gap-2">
                            <Button variant="outline" className="relative overflow-hidden h-11 flex-1 bg-white">
                              <input 
                                type="file" 
                                accept="image/*" 
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                onChange={handleProjectImageUpload}
                                disabled={isUploadingProjImg}
                              />
                              {isUploadingProjImg ? <Loader2 className="animate-spin ml-2" size={16} /> : <ImageIcon size={16} className="ml-2" />}
                              رفع صورة
                            </Button>
                          </div>
                        </div>
                        <div className="md:col-span-2 space-y-2">
                          <Label className="font-bold">وصف المنجزات</Label>
                          <Textarea 
                            value={newProject.description}
                            onChange={e => setNewProject({...newProject, description: e.target.value})}
                            placeholder="اشرح طبيعة العمل المنفذ والكميات..."
                            className="bg-white"
                          />
                        </div>
                      </div>
                      
                      {newProject.images.length > 0 && (
                        <div className="flex flex-wrap gap-3">
                          {newProject.images.map((img, idx) => (
                            <div key={idx} className="relative h-20 w-20 rounded-xl overflow-hidden shadow-sm group">
                              <img src={img} className="w-full h-full object-cover" alt="" />
                              <button 
                                onClick={() => removeProjectImage(idx)}
                                className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex justify-end gap-3 pt-4 border-t">
                        <Button variant="ghost" onClick={() => setShowProjectForm(false)}>إلغاء</Button>
                        <Button onClick={addProject}>حفظ وإضافة للملف</Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {profile.projects.length > 0 ? profile.projects.map(project => (
                      <Card key={project.id} className="overflow-hidden group hover:shadow-lg transition-all border-slate-100">
                        <div className="h-44 bg-slate-100 relative overflow-hidden">
                          {project.images?.[0] ? (
                            <img src={project.images[0]} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-300">
                              <ImageIcon size={48} />
                            </div>
                          )}
                          <Button 
                            variant="destructive" 
                            size="icon" 
                            className="absolute top-2 left-2 h-8 w-8 rounded-full opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100 shadow-md"
                            onClick={() => removeProject(project.id)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                        <CardContent className="p-4">
                          <h4 className="font-bold text-slate-800 line-clamp-1">{project.name}</h4>
                          <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">{project.description}</p>
                        </CardContent>
                      </Card>
                    )) : !showProjectForm && (
                      <div className="col-span-full py-16 flex flex-col items-center justify-center text-muted-foreground bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                        <FolderOpen size={48} className="opacity-10 mb-4" />
                        <p>لا توجد مشاريع مضافة حالياً</p>
                        <Button variant="link" onClick={() => setShowProjectForm(true)}>ابدأ بإضافة مشروعك الأول</Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Certificates Sub-section */}
              <Card className="shadow-sm border-slate-200">
                <CardHeader className="flex flex-row items-center justify-between border-b bg-slate-50/50">
                  <div>
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                      <Award size={22} className="text-primary" />
                      الشهادات المهنية والاعتمادات
                    </CardTitle>
                    <CardDescription>شهادات الأيزو، الجودة، والاعتمادات الصناعية</CardDescription>
                  </div>
                  <Button 
                    variant="outline"
                    onClick={() => setShowCertForm(true)}
                    className="gap-2 rounded-full h-10 px-6 bg-white"
                  >
                    <Plus size={18} />
                    إضافة شهادة
                  </Button>
                </CardHeader>
                <CardContent className="p-6">
                  {showCertForm ? (
                    <div className="p-6 bg-blue-50/50 rounded-2xl border border-blue-100 mb-8 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="font-bold">اسم الشهادة</Label>
                          <Input 
                            value={newCert.name}
                            onChange={e => setNewCert({...newCert, name: e.target.value})}
                            placeholder="مثال: ISO 9001"
                            className="bg-white"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="font-bold">جهة الإصدار</Label>
                          <Input 
                            value={newCert.issuer}
                            onChange={e => setNewCert({...newCert, issuer: e.target.value})}
                            placeholder="الهيئة السعودية للمواصفات..."
                            className="bg-white"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="font-bold">تاريخ الانتهاء</Label>
                          <Input 
                            type="date"
                            value={newCert.expiryDate}
                            onChange={e => setNewCert({...newCert, expiryDate: e.target.value})}
                            className="bg-white"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="font-bold">المستند (PDF/Image)</Label>
                          <Button variant="outline" className="relative overflow-hidden w-full h-11 bg-white">
                            <input 
                              type="file" 
                              className="absolute inset-0 opacity-0 cursor-pointer"
                              onChange={handleCertUpload}
                              disabled={isUploadingCert}
                            />
                            {isUploadingCert ? <Loader2 className="animate-spin ml-2" size={16} /> : <FileText size={16} className="ml-2" />}
                            {newCert.documentUrl ? "تم إرفاق الملف ✓" : "اختر ملف..."}
                          </Button>
                        </div>
                      </div>
                      <div className="flex justify-end gap-3 pt-4 border-t border-blue-100">
                        <Button variant="ghost" onClick={() => setShowCertForm(false)}>إلغاء</Button>
                        <Button onClick={addCertificate}>حفظ الشهادة</Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {profile.certificates.map(cert => (
                      <div key={cert.id} className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group hover:border-primary/20 transition-all">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
                            <Award size={24} />
                          </div>
                          <div>
                            <h5 className="font-bold text-slate-800 text-md leading-tight">{cert.name}</h5>
                            <p className="text-xs text-muted-foreground mt-1">{cert.issuer}</p>
                            {cert.expiryDate && <p className="text-[10px] text-amber-600 mt-1">صالحة حتى: {cert.expiryDate}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {cert.documentUrl && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" asChild>
                              <a href={cert.documentUrl} target="_blank" rel="noopener noreferrer"><FileText size={16} /></a>
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-300 hover:text-destructive" onClick={() => removeCertificate(cert.id)}>
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* FILES TAB */}
          <TabsContent value="files" className="m-0 focus-visible:outline-none">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="flex flex-row items-center justify-between border-b bg-slate-50/50">
                <div>
                  <CardTitle className="text-xl font-bold flex items-center gap-2">
                    <FolderOpen size={22} className="text-primary" />
                    المرفقات العامة والمستندات
                  </CardTitle>
                  <CardDescription>أي ملفات إضافية ترغب في مشاركتها مع المقاولين (مثل كتالوجات، بروفايل الشركة PDF، إلخ)</CardDescription>
                </div>
                <Button className="relative overflow-hidden rounded-full h-10 px-6 gap-2 shadow-md">
                  <input 
                    type="file" 
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={handleFileUpload}
                    disabled={isUploadingFile}
                  />
                  {isUploadingFile ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
                  رفع ملف جديد
                </Button>
              </CardHeader>
              <CardContent className="p-8">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
                  {profile.companyFiles.map(file => (
                    <div key={file.id} className="group flex flex-col items-center gap-3 p-4 rounded-2xl border border-transparent hover:border-slate-200 hover:bg-slate-50 transition-all text-center relative">
                      <div className="h-16 w-16 bg-white rounded-2xl shadow-sm border flex items-center justify-center text-slate-400 group-hover:scale-110 group-hover:text-primary transition-all duration-300">
                        {file.type === 'image' ? <ImageIcon size={32} /> : <FileText size={32} />}
                      </div>
                      <div className="w-full">
                        <p className="text-xs font-bold text-slate-700 truncate px-1">{file.name}</p>
                        <p className="text-[10px] text-muted-foreground uppercase mt-1">{file.type}</p>
                      </div>
                      <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                        <Button 
                          variant="destructive" 
                          size="icon" 
                          className="h-7 w-7 rounded-full shadow-lg" 
                          onClick={() => removeFile(file.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                        <Button 
                          variant="secondary" 
                          size="icon" 
                          className="h-7 w-7 rounded-full shadow-lg"
                          asChild
                        >
                          <a href={file.url} target="_blank" rel="noopener noreferrer"><LinkIcon size={14} /></a>
                        </Button>
                      </div>
                    </div>
                  ))}
                  
                  {profile.companyFiles.length === 0 && (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center text-muted-foreground">
                      <div className="h-20 w-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                        <Upload size={32} className="opacity-20" />
                      </div>
                      <p className="font-medium">لا توجد ملفات مرفوعة</p>
                      <p className="text-xs mt-1">ابدأ برفع ملفات التعريف الخاصة بشركتك لتعزيز حضورك</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  )
}
