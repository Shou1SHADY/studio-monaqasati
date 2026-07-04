"use client"

import { useState, useRef } from "react"
import { useTranslations, useLocale } from "next-intl"
import { useRouter } from "@/i18n/routing"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { useFirestore, useStorage, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, addDoc, writeBatch, serverTimestamp } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import { useToast } from "@/hooks/use-toast"
import type { BoqItem } from "@/lib/boq-parser"
import {
  Loader2,
  FolderPlus,
  Upload,
  FileText,
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  MapPin,
  AlertCircle,
  TableProperties,
} from "lucide-react"

const PROJECT_TYPES = [
  "proj_type_infrastructure",
  "proj_type_buildings",
  "proj_type_roads",
  "proj_type_industrial",
  "proj_type_energy",
  "proj_type_other",
] as const

const SAUDI_REGIONS = [
  "الرياض",
  "مكة المكرمة",
  "المدينة المنورة",
  "القصيم",
  "المنطقة الشرقية",
  "عسير",
  "تبوك",
  "حائل",
  "الحدود الشمالية",
  "جازان",
  "نجران",
  "الباحة",
  "الجوف",
]

const CLIENT_TYPES = [
  "proj_client_government",
  "proj_client_private",
  "proj_client_semi_government",
] as const

function RequiredStar() {
  return <span className="text-destructive mr-1">*</span>
}

interface ValidationError {
  field: string
  message: string
}

export default function NewProjectPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const router = useRouter()
  const firestore = useFirestore()
  const storage = useStorage()
  const { toast } = useToast()
  const { user, isUserLoading } = useUser()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState(1)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [location, setLocation] = useState("")
  const [budget, setBudget] = useState("")
  const [status, setStatus] = useState<"active" | "paused" | "completed">("active")
  const [projectType, setProjectType] = useState("")
  const [region, setRegion] = useState("")
  const [clientType, setClientType] = useState("")
  const [blueprintFile, setBlueprintFile] = useState<File | null>(null)
  const [blueprintUploading, setBlueprintUploading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [boqFile, setBoqFile] = useState<File | null>(null)
  const [boqParsedItems, setBoqParsedItems] = useState<BoqItem[] | null>(null)
  const [boqParsing, setBoqParsing] = useState(false)
  const boqFileInputRef = useRef<HTMLInputElement>(null)

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  const hasError = (field: string) => validationErrors.some(e => e.field === field)
  const clearError = (field: string) => setValidationErrors(prev => prev.filter(e => e.field !== field))

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type === "application/pdf") {
      setBlueprintFile(file)
    } else if (file) {
      toast({ title: "PDF فقط", description: "يرجى اختيار ملف PDF", variant: "destructive" })
    }
  }

  // Parse a BOQ file at creation time — same parser the project's own BOQ tab uses.
  // Only file upload here, no manual product list or grouping; that happens later in the BOQ tab.
  const handleBoqFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBoqParsing(true)
    ;(async () => {
      try {
        const { parseBoqFile } = await import("@/lib/boq-parser")
        const result = await parseBoqFile(file)
        if (result.items.length === 0) {
          toast({ title: t("proj_boq_parse_error"), variant: "destructive" })
          return
        }
        setBoqFile(file)
        setBoqParsedItems(result.items)
      } catch (err) {
        console.error(err)
        toast({ title: t("proj_boq_parse_error"), variant: "destructive" })
      } finally {
        setBoqParsing(false)
        if (boqFileInputRef.current) boqFileInputRef.current.value = ""
      }
    })()
  }

  const removeBoqFile = () => {
    setBoqFile(null)
    setBoqParsedItems(null)
    if (boqFileInputRef.current) boqFileInputRef.current.value = ""
  }

  const validateStep1 = (): ValidationError[] => {
    const errors: ValidationError[] = []
    if (!name.trim()) errors.push({ field: "name", message: t("proj_name_required") })
    return errors
  }

  const showErrors = (errors: ValidationError[]) => {
    setValidationErrors(errors)
    if (errors.length > 0) {
      const fieldElement = document.getElementById(errors[0].field)
      if (fieldElement) fieldElement.scrollIntoView({ behavior: "smooth", block: "center" })
      toast({ title: t("generic_error_title"), description: errors[0].message, variant: "destructive" })
    }
  }

  const nextStep = () => {
    const errors = step === 1 ? validateStep1() : []
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

  const handleSubmit = async () => {
    const errors = validateStep1()
    if (errors.length > 0) {
      showErrors(errors)
      setStep(1)
      return
    }
    if (!user || !firestore) return

    setIsSubmitting(true)

    try {
      const typedProfile = profile as { organizationId?: string } | null
      let blueprintUrl: string | null = null

      if (blueprintFile && storage) {
        setBlueprintUploading(true)
        const storageRef = ref(storage, `projects/${user.uid}/${Date.now()}_${blueprintFile.name}`)
        await uploadBytes(storageRef, blueprintFile)
        blueprintUrl = await getDownloadURL(storageRef)
        setBlueprintUploading(false)
      }

      const projectRef = await addDoc(collection(firestore, "projects"), {
        organizationId: typedProfile?.organizationId || user.uid,
        contractorId: user.uid,
        name: name.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        region: region || null,
        budget: budget ? Number(budget) : null,
        status,
        projectType: projectType || null,
        clientType: clientType || null,
        blueprintUrl,
        rfqIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      // Seed the BOQ tab with the parsed file, if one was uploaded — ungrouped, ready to be
      // organized into sections in the project's own BOQ tab.
      if (boqParsedItems && boqParsedItems.length > 0) {
        const boqBatch = writeBatch(firestore)
        const boqItemsRef = collection(firestore, "projects", projectRef.id, "boqItems")
        boqParsedItems.forEach((item) => {
          boqBatch.set(doc(boqItemsRef), {
            itemNo: item.itemNo,
            descriptionAr: item.descriptionAr,
            descriptionEn: item.descriptionEn,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: 0,
            sheet: item.sheet,
            divisionNo: item.divisionNo,
            divisionNameEn: item.divisionNameEn,
            divisionNameAr: item.divisionNameAr,
            suggestedCategory: item.suggestedCategory,
            suggestedSubCategory: item.suggestedSubCategory,
            tenderId: null,
            isEditable: true,
            groupId: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        })
        await boqBatch.commit()
      }

      toast({ title: t("proj_toast_created") })
      router.push(`/contractor/projects/${projectRef.id}`)
    } catch (err) {
      console.error(err)
      toast({
        title: t("generic_error_title"),
        description: t("proj_toast_save_error"),
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
      setBlueprintUploading(false)
    }
  }

  return (
    <PortalLayout>
      <div className={cn("max-w-4xl mx-auto py-8", isRtl ? "text-right" : "text-left")}>
        <div className="mb-8">
          <h1 className="text-3xl font-black text-foreground font-headline">{t("proj_new")}</h1>
          <p className="text-muted-foreground mt-2">{t("proj_new_subtitle")}</p>
        </div>

        {/* Step indicator */}
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 mb-8">
          {[
            { step: 1, label: t("proj_step_details"), icon: FolderPlus },
            { step: 2, label: t("proj_step_location"), icon: MapPin },
          ].map(({ step: s, label, icon: Icon }, idx) => (
            <div key={s} className="flex items-center">
              <button
                type="button"
                onClick={() => step >= s && setStep(s)}
                disabled={step < s}
                aria-current={step === s ? "step" : undefined}
                className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  step === s
                    ? "bg-primary text-white shadow-lg shadow-primary/25 cursor-pointer"
                    : step > s
                      ? "bg-success/10 text-success border border-success/20 cursor-pointer hover:bg-success/20"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                }`}
              >
                {step > s ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                <span className="font-bold text-xs sm:text-sm">{label}</span>
              </button>
              {idx < 1 && (
                isRtl ? <ChevronLeft size={20} className="mx-1 sm:mx-2 text-slate-300" /> : <ChevronRight size={20} className="mx-1 sm:mx-2 text-slate-300" />
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
                {/* Name */}
                <div className="space-y-3">
                  <Label className="text-base font-bold text-slate-700">
                    {t("proj_name")}<RequiredStar />
                  </Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => { setName(e.target.value); clearError("name") }}
                    placeholder={t("proj_name_placeholder")}
                    className={cn("h-12 text-lg border-slate-200 focus:border-primary focus:ring-primary/20 rounded-xl", hasError("name") ? "border-destructive ring-1 ring-destructive" : "")}
                    disabled={isSubmitting}
                  />
                </div>

                {/* Project Type + Client Type */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">{t("proj_type")}</Label>
                    <SearchableSelect
                      value={projectType}
                      onChange={setProjectType}
                      options={PROJECT_TYPES.map((key) => ({ value: key, label: t(key) }))}
                      placeholder={t("proj_type_placeholder")}
                      searchPlaceholder={t("proj_search_type")}
                      noResultsText={t("newrfq_no_results")}
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">{t("proj_client_type")}</Label>
                    <SearchableSelect
                      value={clientType}
                      onChange={setClientType}
                      options={CLIENT_TYPES.map((key) => ({ value: key, label: t(key) }))}
                      placeholder={t("proj_client_type_placeholder")}
                      searchPlaceholder={t("proj_search_client_type")}
                      noResultsText={t("newrfq_no_results")}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-4 p-6 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <Label className="text-base font-bold text-slate-700">{t("proj_description")}</Label>
                  <Textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="rounded-xl border-slate-200 bg-white resize-none"
                    disabled={isSubmitting}
                  />
                </div>

                {/* BOQ file upload — file only; manual editing/grouping happens later in the BOQ tab */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <TableProperties size={18} className="text-primary" />
                    </div>
                    <Label className="text-base font-bold text-slate-700">{t("proj_boq_upload")}</Label>
                  </div>
                  <input
                    ref={boqFileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleBoqFileChange}
                  />
                  {boqFile ? (
                    <div className="flex items-center gap-4 p-5 bg-primary/5 border border-primary/20 rounded-2xl">
                      <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <TableProperties size={24} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-foreground truncate block">{boqFile.name}</span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t("proj_boq_import_success", { count: boqParsedItems?.length || 0 })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={removeBoqFile}
                        className="text-red-500 hover:bg-red-50 hover:text-red-600 h-9 w-9 rounded-lg flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label={t("proj_boq_remove_file")}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => boqFileInputRef.current?.click()}
                      disabled={isSubmitting || boqParsing}
                      className="w-full flex items-center justify-center gap-3 h-28 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 text-slate-500 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <div className="h-12 w-12 rounded-xl bg-slate-100 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                        {boqParsing ? <Loader2 size={20} className="animate-spin text-primary" /> : <Upload size={20} className="text-slate-400 group-hover:text-primary transition-colors" />}
                      </div>
                      <div className={isRtl ? "text-right" : "text-left"}>
                        <span className="text-sm font-semibold text-slate-700 block">
                          {boqParsing ? t("proj_boq_parsing") : t("proj_boq_upload")}
                        </span>
                        <span className="text-xs text-muted-foreground">({t("proj_boq_upload_hint")})</span>
                      </div>
                    </button>
                  )}
                </div>

                {/* Blueprint PDF Upload */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-blue-50 flex items-center justify-center">
                      <FileText size={18} className="text-blue-600" />
                    </div>
                    <Label className="text-base font-bold text-slate-700">{t("proj_blueprint_pdf")}</Label>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {blueprintFile ? (
                    <div className="flex items-center gap-4 p-5 bg-blue-50/50 border border-blue-200/50 rounded-2xl">
                      <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center">
                        <FileText size={24} className="text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-blue-800 truncate block">{blueprintFile.name}</span>
                        <p className="text-xs text-blue-600/70 mt-0.5">{t("proj_blueprint_uploaded")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setBlueprintFile(null); if (fileInputRef.current) fileInputRef.current.value = "" }}
                        className="text-red-500 hover:bg-red-50 hover:text-red-600 h-9 w-9 rounded-lg flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label={t("proj_blueprint_remove")}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSubmitting}
                      className="w-full flex items-center justify-center gap-3 h-28 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 text-slate-500 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <div className="h-12 w-12 rounded-xl bg-slate-100 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                        <Upload size={20} className="text-slate-400 group-hover:text-primary transition-colors" />
                      </div>
                      <div className={isRtl ? "text-right" : "text-left"}>
                        <span className="text-sm font-semibold text-slate-700 block">{t("proj_blueprint_upload")}</span>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="p-8 space-y-8">
                {/* Region + Location */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">{t("proj_region")}</Label>
                    <SearchableSelect
                      value={region}
                      onChange={setRegion}
                      options={SAUDI_REGIONS.map((r) => ({ value: r, label: r }))}
                      placeholder={t("proj_region_placeholder")}
                      searchPlaceholder={t("proj_search_region")}
                      noResultsText={t("newrfq_no_results")}
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">{t("proj_location")}</Label>
                    <Input
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="h-11 rounded-xl border-slate-200"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                {/* Budget + Status */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">{t("proj_budget")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      className="h-11 rounded-xl border-slate-200"
                      dir="ltr"
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">{t("proj_status")}</Label>
                    <SearchableSelect
                      value={status}
                      onChange={(v) => setStatus(v as typeof status)}
                      options={[
                        { value: "active", label: t("proj_status_active") },
                        { value: "paused", label: t("proj_status_paused") },
                        { value: "completed", label: t("proj_status_completed") },
                      ]}
                      placeholder={t("proj_status_placeholder")}
                      searchPlaceholder={t("proj_search_status")}
                      noResultsText={t("newrfq_no_results")}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
              </div>
            )}
          </CardContent>

          <div className="flex items-center justify-between border-t bg-slate-50/50 p-6">
            <Button
              type="button"
              variant="outline"
              onClick={prevStep}
              disabled={step === 1 || isSubmitting}
              className={`gap-2 px-6 rounded-xl bg-white hover:bg-slate-100 hover:text-slate-700 border border-slate-300 text-slate-700 ${step === 1 || isSubmitting ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              {isRtl ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              {t("newrfq_prev")}
            </Button>

            {step === 1 ? (
              <Button type="button" onClick={nextStep} className="gap-2 px-8 rounded-xl cursor-pointer shadow-lg shadow-primary/25">
                {t("newrfq_next")}
                {isRtl ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || isUserLoading || blueprintUploading}
                className="gap-2 px-10 rounded-xl cursor-pointer shadow-lg shadow-primary/25"
              >
                {(isSubmitting || blueprintUploading) ? <Loader2 className="animate-spin" size={18} /> : <FolderPlus size={18} />}
                {blueprintUploading ? t("proj_blueprint_uploading") : t("proj_save")}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </PortalLayout>
  )
}
