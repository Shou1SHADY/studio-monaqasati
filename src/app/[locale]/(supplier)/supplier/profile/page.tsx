
"use client"

import { useState, useEffect, useMemo } from "react"
import { useTranslations, useLocale } from 'next-intl'
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { ProfileTour } from "@/components/profile-tour"
import { useSearchParams } from "next/navigation"
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
  Mail,
  Lock,
  Star,
  StarHalf
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { sendEmailVerification } from "firebase/auth"
import { PREDEFINED_CATEGORIES, SAUDI_CITIES, displayCategory, displayCity } from "@/lib/constants"
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { suggestSupplierSpecializations } from "@/ai/flows/suggest-supplier-specializations-flow"
import { useToast } from "@/hooks/use-toast"
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection, useStorage } from "@/firebase"
import { doc, updateDoc, collection, query as firestoreQuery, orderBy, where } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"

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

function RatingStars({ value, size = 16, className = "" }: { value: number; size?: number; className?: string }) {
  const safeValue = Math.max(0, Math.min(5, Number(value) || 0))
  const fullStars = Math.floor(safeValue)
  const hasHalf = safeValue - fullStars >= 0.25 && safeValue - fullStars < 0.75
  const emptyOffset = safeValue - fullStars >= 0.75 ? 1 : 0
  return (
    <div className={cn("inline-flex items-center gap-0.5 direction-ltr", className)}>
      {[1, 2, 3, 4, 5].map((star) => {
        if (star <= fullStars) {
          return <Star key={star} size={size} className="fill-amber-400 text-amber-400" />
        }
        if (star === fullStars + 1 && hasHalf) {
          return <StarHalf key={star} size={size} className="fill-amber-400 text-amber-400" />
        }
        if (star <= fullStars + emptyOffset) {
          return <Star key={star} size={size} className="fill-amber-400 text-amber-400" />
        }
        return <Star key={star} size={size} className="text-slate-200 fill-slate-200" />
      })}
    </div>
  )
}

export default function SupplierProfilePage() {
  const t = useTranslations("Portal.Supplier")
  const locale = useLocale()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const showTour = searchParams.get('tour') === 'true'
  const [activeTab, setActiveTab] = useState("basic")
  const [tourActive, setTourActive] = useState(() => {
    if (showTour) return true
    if (typeof window === 'undefined') return false
    return localStorage.getItem('supplier_profile_tour_seen') !== 'true'
  })
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
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    phone: "",
    crNumber: "",
    taxNumber: "",
    description: "",
    city: "",
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
    },
    twoFactorEnabled: false
  })

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  
  const { data: userData, isLoading: isUserDataLoading } = useDoc(userDocRef)

  // Fetch reviews for this supplier to show live rating & reviews
  const reviewsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null
    return firestoreQuery(
      collection(firestore, "reviews"),
      where("revieweeId", "==", user.uid)
    )
  }, [firestore, user])
  const { data: reviews } = useCollection(reviewsQuery)

  const computedRating = useMemo(() => {
    if (!reviews || reviews.length === 0) {
      return {
        avg: Number(userData?.rating) || 0,
        count: Number(userData?.reviewsCount) || 0,
        distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } as Record<number, number>
      }
    }
    const sum = reviews.reduce((acc: number, r: any) => acc + (r.rating || 0), 0)
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } as Record<number, number>
    reviews.forEach((r: any) => {
      const star = Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0)))
      distribution[star] = (distribution[star] || 0) + 1
    })
    return {
      avg: parseFloat((sum / reviews.length).toFixed(1)),
      count: reviews.length,
      distribution
    }
  }, [reviews, userData?.rating, userData?.reviewsCount])

  // Fetch cities from Firestore (temporary fallback to hardcoded if Firebase not ready)
  const citiesQuery = useMemoFirebase(() => {
    if (!firestore) return null
    return firestoreQuery(collection(firestore, "cities"), orderBy("name", "asc"))
  }, [firestore])
  
  const { data: citiesFromDB, isLoading: isCitiesLoading } = useCollection(citiesQuery)
  
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
        city: userData.city || "",
        location: userData.location || "",
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
        },
        twoFactorEnabled: userData.twoFactorEnabled || false
      }))
    }
  }, [userData, user])

  const tourSteps = [
    {
      targetId: "tour-step-company-name",
      title: locale === 'ar' ? "اسم الشركة" : "Company Name",
      description: locale === 'ar'
        ? "أدخل الاسم الرسمي لشركتك كما هو مسجل في السجل التجاري."
        : "Enter your company's official name as registered in the Commercial Registration.",
    },
    {
      targetId: "tour-step-phone",
      title: locale === 'ar' ? "رقم الهاتف" : "Phone Number",
      description: locale === 'ar'
        ? "أضف رقم هاتفك للتواصل. نوصي بإضافة رقم جوال سعودي بصيغة +966."
        : "Add your contact phone number. We recommend using a Saudi mobile number (+966).",
    },
    {
      targetId: "tour-step-cr",
      title: locale === 'ar' ? "السجل التجاري" : "Commercial Registration",
      description: locale === 'ar'
        ? "أدخل رقم السجل التجاري المكون من 10 أرقام. مطلوب للتحقق من هوية شركتك."
        : "Enter your 10-digit Commercial Registration number. Required to verify your company.",
    },
    {
      targetId: "tour-step-tax",
      title: locale === 'ar' ? "الرقم الضريبي" : "Tax Number",
      description: locale === 'ar'
        ? "أدخل الرقم الضريبي المكون من 15 رقمًا (يبدأ بـ 3). مطلوب لإصدار الفواتير الضريبية."
        : "Enter your 15-digit Tax Number (starts with 3). Required for issuing tax invoices.",
    },
    {
      targetId: "tour-step-city",
      title: locale === 'ar' ? "المدينة والموقع" : "City & Location",
      description: locale === 'ar'
        ? "حدد مدينتك وأدخل عنوانك التفصيلي. يساعد المقاولين في معرفة موقعك الجغرافي."
        : "Select your city and enter your address. This helps contractors find you by location.",
    },
    {
      targetId: "tour-step-legal-tab",
      title: locale === 'ar' ? "المستندات القانونية" : "Legal Documents",
      description: locale === 'ar'
        ? "انتقل الآن إلى تبويب المستندات القانونية لرفع السجل التجاري وشهادة الضريبة."
        : "Switch to the Legal Documents tab to upload your CR and VAT certificate.",
    },
    {
      targetId: "tour-step-legal-cr",
      title: locale === 'ar' ? "رفع السجل التجاري" : "CR Document",
      description: locale === 'ar'
        ? "ارفع صورة من السجل التجاري ساري المفعول. هذا المستند أساسي للتحقق من هوية شركتك."
        : "Upload a valid copy of your Commercial Registration. Essential for company verification.",
    },
    {
      targetId: "tour-step-legal-vat",
      title: locale === 'ar' ? "شهادة ضريبة القيمة المضافة" : "VAT Certificate",
      description: locale === 'ar'
        ? "ارفع شهادة ضريبة القيمة المضافة الخاصة بشركتك. مطلوبة لاستكمال التحقق."
        : "Upload your VAT certificate. Required to complete the verification process.",
    },
  ]

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
        phone: profile.phone,
        crNumber: profile.crNumber,
        taxNumber: profile.taxNumber || "",
        city: profile.city,
        location: profile.location,
        coverageCities: profile.coverageCities,
        description: profile.description,
        specializations: profile.specializations,
        certificates: profile.certificates,
        projects: profile.projects,
        companyFiles: profile.companyFiles,
        legalDocuments: profile.legalDocuments,
        twoFactorEnabled: profile.twoFactorEnabled || false,
        profileCompleted: isProfileComplete
      })
      
      if (!isProfileComplete) {
        toast({ title: t("save_success"), description: t("save_success_incomplete") })
      } else {
        toast({ title: t("save_success"), description: t("save_success_complete") })
      }
    } catch (e: any) {
      toast({ title: t("save_error"), description: e.message, variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
   }

  const requestVerification = async () => {
    if (!user || !firestore) return
    if (profile.isVerified || profile.verificationRequested) {
      toast({ title: t("verification_notice"), description: t("verification_notice_desc") })
      return
    }
    const hasCR = profile.legalDocuments?.cr?.url && profile.legalDocuments?.cr?.expiryDate
    const hasVAT = profile.legalDocuments?.vat?.url && profile.legalDocuments?.vat?.expiryDate

    if (!profile.crNumber || !hasCR || !hasVAT) {
      toast({ 
        title: t("incomplete_data"), 
        description: t("incomplete_data_desc"), 
        variant: "destructive" 
      })
      return
    }
    try {
      await updateDoc(doc(firestore, "users", user.uid), {
        verificationRequested: true
      })
      setProfile(prev => ({ ...prev, verificationRequested: true }))
      toast({ title: t("verification_requested"), description: t("verification_requested_desc") })
    } catch (e: any) {
      toast({ title: t("save_error"), description: e.message, variant: "destructive" })
    }
  }

  const handleAiSuggest = async () => {
    if (!profile.description) {
      toast({
        title: t("missing_description"),
        description: t("missing_description_desc"),
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
        title: t("ai_success"),
        description: t("ai_success_desc"),
      })
    } catch (error) {
      toast({
        title: t("save_error"),
        description: t("ai_failed_desc"),
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
      toast({ title: t("save_error"), description: t("required_fields"), variant: "destructive" })
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
    toast({ title: t("save_success"), description: t("cert_added_desc") })
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
      toast({ title: t("cert_uploaded"), description: t("cert_uploaded_desc") })
    } catch (err) {
      toast({ title: t("save_error"), description: t("cert_upload_failed"), variant: "destructive" })
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
        
        toast({ title: t("cert_deleted"), description: t("cert_deleted_desc") })
      } catch (err) {
        console.error("Auto-save failed:", err)
      }
    }
  }

  const addProject = async () => {
    if (!newProject.name) {
      toast({ title: t("save_error"), description: t("project_required"), variant: "destructive" })
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
    toast({ title: t("save_success"), description: t("project_added_desc") })
  }

  const handleProjectImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploadingProjImg(true)
    try {
      const url = await uploadToStorage(file, "projects")
      setNewProject(prev => ({ ...prev, images: [...prev.images, url] }))
    } catch (err) {
      toast({ title: t("save_error"), description: t("image_upload_failed"), variant: "destructive" })
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

        toast({ title: t("cert_deleted"), description: t("project_deleted_desc") })
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

      toast({ title: t("save_success"), description: t("file_saved_desc") })
    } catch (err) {
      toast({ title: t("save_error"), description: t("cert_upload_failed"), variant: "destructive" })
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

        toast({ title: t("cert_deleted"), description: t("file_deleted_desc") })
      } catch (err) {
        console.error("Auto-save failed:", err)
      }
    }
  }

  const handleLegalDocUpload = async (key: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    toast({ title: t("legal_uploading"), description: t("legal_uploading_desc") })
    
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

      toast({ title: t("cert_uploaded"), description: t("legal_updated_desc") })
    } catch (err) {
      toast({ title: t("save_error"), description: t("legal_upload_failed"), variant: "destructive" })
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
    profile.city,
    profile.location,
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
      <div className={cn("max-w-6xl mx-auto py-8 space-y-8", locale === 'ar' ? 'text-right' : 'text-left')}>
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
                    {profile.isVerified ? t("profile_verified_badge") : t("profile_pending_badge")}
                  </Badge>
                  <h1 className="text-4xl lg:text-5xl font-black text-slate-900 font-headline tracking-tighter leading-none">{profile.name || t("company_name_placeholder")}</h1>
                </div>
                <div className="flex flex-wrap justify-center md:justify-start items-center gap-4 text-slate-500">
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 text-sm">
                    <Mail size={14} className="text-primary/60" />
                    <span>{profile.email}</span>
                  </div>
                  {profile.isPremium && (
                    <div className="flex items-center gap-2 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-100 text-sm text-amber-700 font-bold">
                      <Award size={14} className="text-amber-500" />
                      <span>{t("premium_membership")}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Stats Dashboard */}
            <div className="w-full lg:w-80 grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 flex flex-col items-center justify-center text-center space-y-1 group/stat hover:bg-white hover:shadow-lg transition-all duration-300">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{t("completion_percentage")}</span>
                <span className="text-3xl font-black text-primary leading-none">{completionPercentage}%</span>
                <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${completionPercentage}%` }} />
                </div>
              </div>
              <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 flex flex-col items-center justify-center text-center space-y-1 group/stat hover:bg-white hover:shadow-lg transition-all duration-300">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{t("projects_label")}</span>
                <span className="text-3xl font-black text-slate-800 leading-none">{profile.projects.length}</span>
                <span className="text-[10px] text-slate-400 font-medium mt-1">{t("completed_project")}</span>
              </div>
              <div className="col-span-2 bg-gradient-to-br from-amber-50 to-amber-100/40 p-5 rounded-3xl border border-amber-100 flex items-center justify-between gap-3 group/stat hover:shadow-lg transition-all duration-300">
                <div className="min-w-0">
                  <span className="text-[10px] font-bold text-amber-700 uppercase tracking-tighter">{t("supplier_my_rating_label")}</span>
                  <div className="mt-1.5">
                    <RatingStars value={computedRating.avg} size={14} />
                  </div>
                  <p className="text-[10px] text-amber-700/80 mt-1 font-medium">{t("suppliers_rating_count", { count: computedRating.count })}</p>
                </div>
                <div className="font-black text-3xl text-amber-700 leading-none" dir="ltr">
                  {computedRating.count > 0 ? computedRating.avg.toFixed(1) : "0.0"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar - Sticky */}
        <div className="sticky top-6 z-40 flex justify-end gap-3 bg-white/40 backdrop-blur-2xl p-4 rounded-[2rem] border border-white/20 shadow-xl shadow-slate-200/20 max-w-fit mr-auto">
          <Button variant="ghost" onClick={() => window.location.reload()} className="h-12 px-6 rounded-2xl hover:bg-white/50 text-slate-600 transition-all font-bold">
            <X size={18} className="ml-2" />
            {t("cancel")}
          </Button>
          <Button className="gap-2 h-12 px-10 rounded-2xl shadow-xl shadow-primary/30 bg-primary hover:bg-secondary hover:text-white hover:scale-105 active:scale-95 transition-all duration-300 font-bold text-white ring-offset-2 ring-primary/20 hover:ring-4" onClick={handleSave} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
            {t("save_changes")}
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <TabsList className="w-full justify-start h-auto flex-wrap p-1.5 gap-1 bg-slate-100/50 rounded-2xl border mb-8">
            <TabsTrigger value="basic" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-11 px-5 rounded-xl gap-2 text-sm transition-all">
              <User size={16} />
              {t("basic_info_tab")}
            </TabsTrigger>
            <TabsTrigger value="specializations" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-11 px-5 rounded-xl gap-2 text-sm transition-all">
              <Zap size={16} />
              {t("specializations_tab")}
            </TabsTrigger>
            <TabsTrigger id="tour-step-legal-tab" value="legal" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-11 px-5 rounded-xl gap-2 text-sm transition-all">
              <ShieldCheck size={16} />
              {t("legal_tab")}
            </TabsTrigger>
            <TabsTrigger value="portfolio" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-11 px-5 rounded-xl gap-2 text-sm transition-all">
              <Award size={16} />
              {t("portfolio_tab")}
            </TabsTrigger>
            <TabsTrigger value="reviews" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-11 px-5 rounded-xl gap-2 text-sm transition-all">
              <Star size={16} />
              {t("supplier_profile_tab_reviews", { count: computedRating.count })}
            </TabsTrigger>
            <TabsTrigger value="files" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-11 px-5 rounded-xl gap-2 text-sm transition-all">
              <FolderOpen size={16} />
              {t("files_tab")}
            </TabsTrigger>
            <TabsTrigger value="security" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-11 px-5 rounded-xl gap-2 text-sm transition-all">
              <Lock size={16} />
              {t("security_tab")}
            </TabsTrigger>
          </TabsList>

          {/* REVIEWS TAB - Anonymous */}
          <TabsContent value="reviews" className="m-0 focus-visible:outline-none">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <Star size={22} className="text-amber-400 fill-amber-400" />
                  {t("suppliers_reviews_title", { count: computedRating.count })}
                </CardTitle>
                <CardDescription>{t("supplier_profile_reviews_anonymous_notice")}</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {/* Rating Hero */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-6 bg-gradient-to-br from-amber-50 to-amber-100/40 rounded-2xl border border-amber-100 flex flex-col items-center justify-center gap-2">
                    <p className="text-5xl font-black text-amber-700 leading-none" dir="ltr">
                      {computedRating.count > 0 ? computedRating.avg.toFixed(1) : "0.0"}
                    </p>
                    <RatingStars value={computedRating.avg} size={22} />
                    <p className="text-xs text-amber-700/80 font-medium">{t("suppliers_rating_count", { count: computedRating.count })}</p>
                  </div>
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                    {[5, 4, 3, 2, 1].map((star) => {
                      const total = computedRating.count || 0
                      const count = computedRating.distribution?.[star] || 0
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0
                      return (
                        <div key={star} className="flex items-center gap-2 text-xs">
                          <div className="flex items-center gap-0.5 w-12 shrink-0">
                            <span className="font-bold text-slate-700 w-3 text-left" dir="ltr">{star}</span>
                            <Star size={11} className="fill-amber-400 text-amber-400" />
                          </div>
                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-400 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="font-bold text-slate-600 w-10 text-left" dir="ltr">{count}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Reviews List - Anonymous */}
                {reviews && reviews.length > 0 ? (
                  <div className="grid gap-3">
                    {reviews.map((review: any) => (
                      <div key={review.id} className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center">
                              <Star size={14} className="text-slate-500" />
                            </div>
                            <p className="font-bold text-sm text-slate-700">{t("suppliers_anonymous_reviewer")}</p>
                          </div>
                          <div className="flex items-center gap-1.5 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-100">
                            <RatingStars value={Number(review.rating) || 0} size={11} />
                            <span className="text-xs font-bold text-amber-700" dir="ltr">{(Number(review.rating) || 0).toFixed(1)}</span>
                          </div>
                        </div>
                        {review.comment && (
                          <p className="text-sm text-slate-700 leading-relaxed bg-white p-3 rounded-lg border border-slate-100">
                            "{review.comment}"
                          </p>
                        )}
                        <p className={cn("text-[10px] text-slate-400", locale === 'ar' ? 'text-left' : 'text-right')}>
                          {review.createdAt ? new Date(review.createdAt).toLocaleDateString(locale) : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 p-8 border border-dashed rounded-xl text-center bg-slate-50">
                    {t("suppliers_no_reviews_registered")}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* BASIC INFO TAB */}
          <TabsContent value="basic" className="m-0 focus-visible:outline-none">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <User size={22} className="text-primary" />
                  {t("contact_info_title")}
                </CardTitle>
                <CardDescription>{t("contact_info_desc")}</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div id="tour-step-company-name" className="space-y-2">
                      <Label htmlFor="name" className="text-slate-700 font-bold">{t("company_name_label")} <span className="text-destructive mx-1">*</span></Label>
                      <Input
                        id="name"
                        value={profile.name}
                        onChange={e => setProfile({...profile, name: e.target.value})}
                        className="h-11 focus:ring-primary/20"
                      />
                    </div>
                    <div id="tour-step-phone" className="space-y-2">
                      <Label htmlFor="phone" className="text-slate-700 font-bold">{t("phone_label")} <span className="text-destructive mx-1">*</span></Label>
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
                      <Label htmlFor="crNumber-input" className="text-slate-700 font-bold">{t("cr_number_label")} <span className="text-destructive mx-1">*</span></Label>
                      <Input
                        id="crNumber-input"
                        value={profile.crNumber}
                        onChange={e => setProfile({...profile, crNumber: e.target.value})}
                        className="dir-ltr text-left h-11"
                        placeholder="10 أرقام"
                      />
                    </div>
                    <div id="tour-step-tax" className="space-y-2">
                      <Label htmlFor="taxNumber-input" className="text-slate-700 font-bold">{t("tax_number_label")} <span className="text-destructive mx-1">*</span></Label>
                      <Input
                        id="taxNumber-input"
                        value={profile.taxNumber || ""}
                        onChange={e => setProfile({...profile, taxNumber: e.target.value})}
                        className="dir-ltr text-left h-11"
                        placeholder="15 رقم تبدأ بـ 3"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-slate-700 font-bold opacity-70">{t("email_label")}</Label>
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

                  <div id="tour-step-city" className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <Label className="text-slate-700 font-bold">{t("city_label")} <span className="text-destructive mx-1">*</span></Label>
                      <Select
                        value={profile.city}
                        onValueChange={(v) => setProfile({ ...profile, city: v })}
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder={t("city_placeholder")} />
                        </SelectTrigger>
                        <SelectContent className="max-h-72 overflow-y-auto">
                          {SAUDI_CITIES.map((city) => (
                            <SelectItem key={city} value={city}>{displayCity(city, locale)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-4">
                      <Label htmlFor="loc" className="text-slate-700 font-bold">{t("location_label")} <span className="text-destructive mx-1">*</span></Label>
                      <div className="relative">
                        <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input 
                          id="loc" 
                          className="pr-10 h-11"
                          value={profile.location}
                          onChange={e => setProfile({...profile, location: e.target.value})}
                          placeholder={t("location_placeholder")}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-8 mt-8">
                    <div className="space-y-4">
                      <Label className="text-slate-700 font-bold">{t("coverage_cities_label")} <span className="text-slate-400 text-xs font-normal mx-1">({t("optional")})</span></Label>
                      <div className="flex gap-2">
                        <Input 
                          placeholder={t("add_city_placeholder")}
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
                              {t("city_list")}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                            {cities.filter(c => !profile.coverageCities.includes(c)).map(city => (
                              <DropdownMenuItem key={city} onClick={() => setProfile(prev => ({ ...prev, coverageCities: [...prev.coverageCities, city] }))} className="cursor-pointer">
                                {displayCity(city, locale)}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {profile.coverageCities.map(city => (
                          <Badge key={city} className="bg-primary/5 text-primary border-primary/20 px-3 py-1.5 flex items-center gap-2 hover:bg-primary/10 transition-colors">
                            {displayCity(city, locale)}
                            <X size={14} className="cursor-pointer" onClick={() => setProfile(prev => ({ ...prev, coverageCities: prev.coverageCities.filter(c => c !== city) }))} />
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 pt-4">
                    <Label htmlFor="desc" className="text-slate-700 font-bold">{t("company_desc_label")} <span className="text-slate-400 text-xs font-normal mx-1">({t("optional")})</span></Label>
                    <Textarea 
                      id="desc" 
                      rows={5}
                      placeholder={t("company_desc_placeholder")}
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
                  {t("spec_title")}
                </CardTitle>
                <CardDescription>{t("spec_desc")}</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-8">
                <div className="p-6 bg-gradient-to-br from-primary/5 to-transparent rounded-2xl border border-primary/10 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        {t("ai_assistant")}
                        <Badge className="bg-primary/20 text-primary border-none text-[10px]">BETA</Badge>
                      </h3>
                      <p className="text-sm text-muted-foreground">{t("ai_desc")}</p>
                    </div>
                    <Button 
                      onClick={handleAiSuggest}
                      disabled={isGenerating || !profile.description}
                      className="gap-2 bg-white text-primary border-primary/20 hover:bg-primary hover:text-white transition-all shadow-sm"
                      variant="outline"
                    >
                      {isGenerating ? <Loader2 className="animate-spin" size={18} /> : <Zap size={18} />}
                      {t("analyze_now")}
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-lg font-bold text-slate-700">{t("current_specializations")}</Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="rounded-full h-9 border-dashed px-4">
                          <Plus size={16} className="ml-2" />
                          {t("add_manually")}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                        {PREDEFINED_CATEGORIES.filter(c => !profile.specializations.includes(c)).map(cat => (
                          <DropdownMenuItem key={cat} onClick={() => addSpec(cat)} className="cursor-pointer">
                            {displayCategory(cat, locale)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {profile.specializations.length > 0 ? profile.specializations.map(spec => (
                      <div key={spec} className="p-4 bg-white rounded-xl border border-slate-100 flex items-center justify-between hover:border-primary/30 transition-all shadow-sm group">
                        <span className="font-medium text-slate-700">{displayCategory(spec, locale)}</span>
                        <button onClick={() => removeSpec(spec)} className="text-slate-300 hover:text-destructive transition-colors">
                          <X size={18} />
                        </button>
                      </div>
                    )) : (
                      <div className="col-span-full py-12 flex flex-col items-center justify-center text-muted-foreground bg-slate-50 rounded-2xl border border-dashed">
                        <Zap size={32} className="opacity-20 mb-2" />
                        <p>{t("no_specializations")}</p>
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
                      {t("legal_docs_title")}
                    </CardTitle>
                    <CardDescription>{t("legal_docs_desc")}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {[
                        { id: 'cr', label: t("cr_doc"), icon: FileText, tourId: 'tour-step-legal-cr' },
                        { id: 'vat', label: t("vat_doc"), icon: Award, tourId: 'tour-step-legal-vat' }
                      ].map((doc) => {
                        const data = profile.legalDocuments[doc.id as keyof typeof profile.legalDocuments]
                        return (
                          <div key={doc.id} id={doc.tourId} className="p-5 rounded-2xl border bg-white hover:border-primary/20 transition-all space-y-4 shadow-sm">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-lg bg-slate-50 flex items-center justify-center text-primary border">
                                <doc.icon size={20} />
                              </div>
                              <h4 className="font-bold text-slate-800 text-sm">{doc.label}</h4>
                            </div>

                            <div className="space-y-3 pt-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">{t("expiry_date")}</span>
                                {data?.expiryDate && (
                                  <Badge variant="outline" className="text-[10px] font-normal">
                                    {new Date(data.expiryDate) < new Date() ? t("expired_status") : t("valid_status")}
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
                                  <span className="text-xs font-bold">{data?.url ? t("update") : t("upload")}</span>
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
                    <CardTitle className="text-lg">{t("verification_status")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-col items-center text-center p-4 bg-white rounded-2xl border shadow-inner">
                      {profile.isVerified ? (
                        <>
                          <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center text-success mb-3">
                            <ShieldCheck size={32} />
                          </div>
                          <h4 className="font-bold text-success text-xl">{t("fully_verified")}</h4>
                          <p className="text-sm text-muted-foreground mt-2">{t("verified_desc")}</p>
                        </>
                      ) : profile.verificationRequested ? (
                        <>
                          <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 mb-3 animate-pulse">
                            <Loader2 size={32} />
                          </div>
                          <h4 className="font-bold text-amber-700">{t("pending_review")}</h4>
                          <p className="text-sm text-muted-foreground mt-2">{t("pending_review_desc")}</p>
                        </>
                      ) : (
                        <>
                          <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                            <ShieldCheck size={32} />
                          </div>
                          <h4 className="font-bold text-slate-800">{t("not_verified")}</h4>
                          <p className="text-sm text-muted-foreground mt-2">{t("not_verified_desc")}</p>
                          <Button 
                            className="mt-4 w-full h-11" 
                            onClick={requestVerification}
                            disabled={profile.verificationRequested}
                          >
                            {t("request_verification")}
                          </Button>
                        </>
                      )}
                    </div>
                    
                    <div className="p-4 rounded-xl bg-white/50 space-y-2 border">
                      <h5 className="font-bold text-sm">{t("verification_benefits")}</h5>
                      <ul className="text-xs text-muted-foreground space-y-2">
                        <li className="flex items-center gap-2">{t("benefit_1")}</li>
                        <li className="flex items-center gap-2">{t("benefit_2")}</li>
                        <li className="flex items-center gap-2">{t("benefit_3")}</li>
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
                      {t("portfolio_title")}
                    </CardTitle>
                    <CardDescription>{t("portfolio_desc")}</CardDescription>
                  </div>
                  <Button 
                    onClick={() => setShowProjectForm(true)}
                    className="gap-2 rounded-full h-10 px-6"
                  >
                    <Plus size={18} />
                    {t("add_project")}
                  </Button>
                </CardHeader>
                <CardContent className="p-6">
                  {showProjectForm ? (
                    <div className="p-6 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 mb-8 space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label className="font-bold">{t("project_name")}</Label>
                          <Input 
                            value={newProject.name}
                            onChange={e => setNewProject({...newProject, name: e.target.value})}
                            placeholder={t("project_name_placeholder")}
                            className="bg-white"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="font-bold">{t("project_images")}</Label>
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
                              {t("upload_image")}
                            </Button>
                          </div>
                        </div>
                        <div className="md:col-span-2 space-y-2">
                          <Label className="font-bold">{t("project_desc")}</Label>
                          <Textarea 
                            value={newProject.description}
                            onChange={e => setNewProject({...newProject, description: e.target.value})}
                            placeholder={t("project_desc_placeholder")}
                            className="bg-white"
                          />
                        </div>
                      </div>
                      
                      {newProject.images.length > 0 && (
                        <div className="flex flex-wrap gap-3">
                          {newProject.images.map((img, idx) => (
                            <div key={idx} className="relative h-20 w-20 rounded-xl overflow-hidden shadow-sm group">
                              <img src={img} className="w-full h-full object-cover" alt={`Project image ${idx + 1}`} />
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
                        <Button variant="ghost" onClick={() => setShowProjectForm(false)}>{t("cancel")}</Button>
                        <Button onClick={addProject}>{t("save_add")}</Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {profile.projects.length > 0 ? profile.projects.map(project => (
                      <Card key={project.id} className="overflow-hidden group hover:shadow-lg transition-all border-slate-100">
                        <div className="h-44 bg-slate-100 relative overflow-hidden">
                          {project.images?.[0] ? (
                            <img src={project.images[0]} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt={project.name || 'Project'} />
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
                        <p>{t("no_projects")}</p>
                        <Button variant="link" onClick={() => setShowProjectForm(true)}>{t("start_first_project")}</Button>
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
                      {t("certificates_title")}
                    </CardTitle>
                    <CardDescription>{t("certificates_desc")}</CardDescription>
                  </div>
                  <Button 
                    variant="outline"
                    onClick={() => setShowCertForm(true)}
                    className="gap-2 rounded-full h-10 px-6 bg-white"
                  >
                    <Plus size={18} />
                    {t("add_certificate")}
                  </Button>
                </CardHeader>
                <CardContent className="p-6">
                  {showCertForm ? (
                    <div className="p-6 bg-blue-50/50 rounded-2xl border border-blue-100 mb-8 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="font-bold">{t("cert_name")}</Label>
                          <Input 
                            value={newCert.name}
                            onChange={e => setNewCert({...newCert, name: e.target.value})}
                            placeholder={t("cert_name_placeholder")}
                            className="bg-white"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="font-bold">{t("cert_issuer")}</Label>
                          <Input 
                            value={newCert.issuer}
                            onChange={e => setNewCert({...newCert, issuer: e.target.value})}
                            placeholder={t("cert_issuer_placeholder")}
                            className="bg-white"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="font-bold">{t("cert_expiry")}</Label>
                          <Input 
                            type="date"
                            value={newCert.expiryDate}
                            onChange={e => setNewCert({...newCert, expiryDate: e.target.value})}
                            className="bg-white"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="font-bold">{t("cert_document")}</Label>
                          <Button variant="outline" className="relative overflow-hidden w-full h-11 bg-white">
                            <input 
                              type="file" 
                              className="absolute inset-0 opacity-0 cursor-pointer"
                              onChange={handleCertUpload}
                              disabled={isUploadingCert}
                            />
                            {isUploadingCert ? <Loader2 className="animate-spin ml-2" size={16} /> : <FileText size={16} className="ml-2" />}
                            {newCert.documentUrl ? t("file_attached") : t("choose_file")}
                          </Button>
                        </div>
                      </div>
                      <div className="flex justify-end gap-3 pt-4 border-t border-blue-100">
                        <Button variant="ghost" onClick={() => setShowCertForm(false)}>{t("cancel")}</Button>
                        <Button onClick={addCertificate}>{t("save_certificate")}</Button>
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
                            {cert.expiryDate && <p className="text-[10px] text-amber-600 mt-1">{t("valid_until", { date: cert.expiryDate })}</p>}
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
                    {t("files_title")}
                  </CardTitle>
                  <CardDescription>{t("files_desc")}</CardDescription>
                </div>
                <Button className="relative overflow-hidden rounded-full h-10 px-6 gap-2 shadow-md">
                  <input 
                    type="file" 
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={handleFileUpload}
                    disabled={isUploadingFile}
                  />
                  {isUploadingFile ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
                  {t("upload_new_file")}
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
                      <p className="font-medium">{t("no_files")}</p>
                      <p className="text-xs mt-1">{t("no_files_desc")}</p>
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
                  {t("security_title")}
                </CardTitle>
                <CardDescription>{t("security_desc")}</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                
                {/* 1. Account Provider Details */}
                <div className="p-5 rounded-2xl border bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1 text-right">
                    <h4 className="font-bold text-slate-800 text-sm">{t("login_method")}</h4>
                    <p className="text-xs text-muted-foreground">{t("login_method_desc")}</p>
                  </div>
                  <Badge variant="outline" className="px-4 py-1.5 rounded-xl font-bold text-xs bg-white shadow-sm flex items-center gap-1.5">
                    {user?.providerData.some(p => p.providerId === "google.com") ? (
                      <>
                        <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                        {t("google_connected")}
                      </>
                    ) : (
                      <>
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        {t("email_password")}
                      </>
                    )}
                  </Badge>
                </div>

                <Separator />

                {/* 2. Email Verification Control */}
                <div className="p-5 rounded-2xl border bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1 text-right">
                    <h4 className="font-bold text-slate-800 text-sm">{t("email_verification")}</h4>
                    <p className="text-xs text-muted-foreground font-semibold">{profile.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {user?.emailVerified ? (
                      <Badge className="px-4 py-1.5 rounded-xl font-bold text-xs bg-success/10 text-success border-none shadow-sm flex items-center gap-1.5">
                        <CheckCircle2 size={14} />
                        {t("verified_active")}
                      </Badge>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                        <Badge className="px-4 py-1.5 rounded-xl font-bold text-xs bg-amber-100 text-amber-700 border-none shadow-sm flex items-center justify-center gap-1.5">
                          {t("not_verified_label")}
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
                                  title: t("verification_link_sent"),
                                  description: t("verification_link_sent_desc")
                                });
                              }
                            } catch (e: any) {
                              toast({
                                title: t("save_error"),
                                description: e.message || t("verification_link_failed"),
                                variant: "destructive"
                              });
                            }
                          }}
                        >
                          {t("send_verification")}
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
                      <h4 className="font-bold text-slate-800 text-sm">{t("two_step")}</h4>
                      <Badge className="bg-primary/10 text-primary border-none text-[9px] font-black">{t("sms_badge")}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-xl leading-relaxed mt-1">
                      {t("two_step_desc", { phone: profile.phone || t("phone_required") })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={profile.twoFactorEnabled || false}
                      onCheckedChange={(checked) => {
                        if (checked && !profile.phone) {
                          toast({
                            title: t("phone_required_title"),
                            description: t("phone_required_desc"),
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
                    <h4 className="font-bold text-slate-800 text-sm">{t("change_password")}</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("change_password_desc")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button 
                      variant="outline" 
                      className="bg-white"
                      onClick={() => setIsPasswordDialogOpen(true)}
                    >
                      {t("change_password_btn")}
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
            if (stepIndex >= 5) {
              setActiveTab("legal")
            } else {
              setActiveTab("basic")
            }
          }}
          onComplete={() => {
            setTourActive(false)
            localStorage.setItem('supplier_profile_tour_seen', 'true')
            toast({ title: t("save_success"), description: locale === 'ar' ? "تم اكتمال جولة الملف التعريفي!" : "Profile tour completed!" })
          }}
          onDismiss={() => {
            setTourActive(false)
            localStorage.setItem('supplier_profile_tour_seen', 'true')
          }}
        />
      )}
    </PortalLayout>
  )
}
