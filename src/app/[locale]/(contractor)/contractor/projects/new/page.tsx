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
import { ProductRowEditor, makeEmptyProductRow, type ProductRow } from "@/components/shared/ProductRowEditor"
import { StagedTeamStep, type StagedMember } from "@/components/contractor/StagedTeamStep"
import { SectionToggleGrid } from "@/components/contractor/SectionToggleGrid"
import { useFirestore, useStorage, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, addDoc, writeBatch, serverTimestamp } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import { useToast } from "@/hooks/use-toast"
import type { BoqItem, BoqParsedGroup } from "@/lib/boq-parser"
import {
  SECTION_IDS,
  cascadeEnable,
  cascadeDisable,
  defaultEnabledSections,
  sectionLabelKey,
  type SectionId,
} from "@/lib/project-sections"
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
  LayoutGrid,
  Users,
  ClipboardCheck,
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
  return <span className="text-destructive me-1">*</span>
}

interface ValidationError {
  field: string
  message: string
}

type BoqMode = "upload" | "manual" | "skip" | null

export default function NewProjectPage() {
  const t = useTranslations("Portal.Contractor")
  const tShared = useTranslations("Portal.Shared")
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

  const [enabledSections, setEnabledSections] = useState<Set<SectionId>>(() => defaultEnabledSections())

  const [boqMode, setBoqMode] = useState<BoqMode>(null)
  const [boqFile, setBoqFile] = useState<File | null>(null)
  const [boqParsedItems, setBoqParsedItems] = useState<BoqItem[] | null>(null)
  const [boqParsedGroups, setBoqParsedGroups] = useState<BoqParsedGroup[]>([])
  const [boqParsing, setBoqParsing] = useState(false)
  const boqFileInputRef = useRef<HTMLInputElement>(null)
  const [manualRows, setManualRows] = useState<ProductRow[]>([makeEmptyProductRow("1")])

  const [stagedMembers, setStagedMembers] = useState<StagedMember[]>([])

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const myOrgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid

  const hasError = (field: string) => validationErrors.some(e => e.field === field)
  const clearError = (field: string) => setValidationErrors(prev => prev.filter(e => e.field !== field))

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type === "application/pdf") {
      setBlueprintFile(file)
    } else if (file) {
      toast({ title: t("proj_pdf_only_title"), description: t("proj_pdf_only_desc"), variant: "destructive" })
    }
  }

  // Parse a BOQ file — same parser the project's own BOQ tab uses. Only file upload
  // here; per-row reorganization/grouping happens later in the BOQ tab.
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
        setBoqParsedGroups(result.groups)
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
    setBoqParsedGroups([])
    if (boqFileInputRef.current) boqFileInputRef.current.value = ""
  }

  const toggleSection = (id: SectionId) => {
    setEnabledSections((prev) => (prev.has(id) ? cascadeDisable(prev, id) : cascadeEnable(prev, id)))
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

  const STEP_COUNT = 6

  const nextStep = () => {
    const errors = step === 1 ? validateStep1() : []
    if (errors.length > 0) {
      showErrors(errors)
      return
    }
    setValidationErrors([])
    setStep(s => Math.min(STEP_COUNT, s + 1))
  }

  const prevStep = () => {
    setStep(s => Math.max(1, s - 1))
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
        enabledSections: Array.from(enabledSections),
        rfqIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      // From here on, the project itself already exists — BOQ and team-assignment
      // writes are best-effort. A failure here surfaces as a softer "partial" toast
      // and the user still lands on their new project (can retry from its tabs).
      let hadPartialFailure = false

      try {
        // Seed the BOQ tab — from the parsed Excel file, or from manually-entered rows.
        if (boqMode === "upload" && boqParsedItems && boqParsedItems.length > 0) {
          const boqBatch = writeBatch(firestore)
          const boqItemsRef = collection(firestore, "projects", projectRef.id, "boqItems")
          const boqGroupsRef = collection(firestore, "projects", projectRef.id, "boqGroups")
          boqParsedItems.forEach((item) => {
            boqBatch.set(doc(boqItemsRef), {
              itemNo: item.itemNo,
              descriptionAr: item.descriptionAr,
              descriptionEn: item.descriptionEn,
              unit: item.unit,
              quantity: item.quantity,
              unitPrice: item.rate || 0,
              sheet: item.sheet,
              divisionNo: item.divisionNo,
              divisionNameEn: item.divisionNameEn,
              divisionNameAr: item.divisionNameAr,
              subCategoryCode: item.subCategoryCode,
              subCategoryNameEn: item.subCategoryNameEn,
              subCategoryNameAr: item.subCategoryNameAr,
              suggestedCategory: item.suggestedCategory,
              suggestedSubCategory: item.suggestedSubCategory,
              tenderId: null,
              isEditable: true,
              groupId: item.groupId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          })
          boqParsedGroups.forEach((group) => {
            boqBatch.set(doc(boqGroupsRef, group.id), {
              titleAr: group.titleAr,
              categoryAr: group.categoryAr,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          })
          await boqBatch.commit()
        } else if (boqMode === "manual") {
          const validRows = manualRows.filter((r) => r.description.trim() && Number(r.quantity) > 0)
          if (validRows.length > 0) {
            const boqBatch = writeBatch(firestore)
            const boqItemsRef = collection(firestore, "projects", projectRef.id, "boqItems")
            validRows.forEach((row) => {
              boqBatch.set(doc(boqItemsRef), {
                itemNo: null,
                descriptionAr: row.description,
                descriptionEn: null,
                unit: row.unit,
                quantity: row.quantity,
                unitPrice: 0,
                sheet: null,
                divisionNo: null,
                divisionNameEn: null,
                divisionNameAr: null,
                subCategoryCode: null,
                subCategoryNameEn: null,
                subCategoryNameAr: null,
                suggestedCategory: row.category || null,
                suggestedSubCategory: (row.subCategory === "أخرى" ? row.otherSubCategory : row.subCategory) || null,
                tenderId: null,
                isEditable: true,
                groupId: null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              })
            })
            await boqBatch.commit()
          }
        }
      } catch (boqErr) {
        console.error("BOQ seed failed:", boqErr)
        hadPartialFailure = true
      }

      try {
        if (stagedMembers.length > 0) {
          const membersBatch = writeBatch(firestore)
          stagedMembers.forEach((sm) => {
            membersBatch.set(doc(firestore, "projects", projectRef.id, "members", sm.userId), {
              userId: sm.userId,
              groupId: sm.groupId,
              organizationId: typedProfile?.organizationId || user.uid,
              addedBy: user.uid,
              createdAt: serverTimestamp(),
            })
          })
          await membersBatch.commit()
        }
      } catch (membersErr) {
        console.error("Team assignment failed:", membersErr)
        hadPartialFailure = true
      }

      toast(
        hadPartialFailure
          ? { title: t("proj_toast_created"), description: t("proj_toast_partial_error"), variant: "default" }
          : { title: t("proj_toast_created") }
      )
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

  const manualRowCount = manualRows.filter((r) => r.description.trim() && Number(r.quantity) > 0).length

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
            { step: 2, label: t("proj_step_sections"), icon: LayoutGrid },
            { step: 3, label: t("proj_step_boq"), icon: TableProperties },
            { step: 4, label: t("proj_step_location"), icon: MapPin },
            { step: 5, label: t("proj_step_team"), icon: Users },
            { step: 6, label: t("proj_step_review"), icon: ClipboardCheck },
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
              {idx < STEP_COUNT - 1 && (
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
              <div className="p-8 space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">{t("proj_sections_title")}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{t("proj_sections_desc")}</p>
                </div>

                <SectionToggleGrid
                  enabledSections={enabledSections}
                  onToggle={toggleSection}
                  requiredHintLabel={t("proj_sections_required_hint")}
                  tShared={tShared}
                />
              </div>
            )}

            {step === 3 && (
              <div className="p-8 space-y-6">
                <div>
                  <Label className="text-base font-bold text-slate-700">{t("proj_boq_mode_label")}</Label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {([
                    { mode: "upload" as const, icon: Upload, label: t("proj_boq_mode_upload") },
                    { mode: "manual" as const, icon: TableProperties, label: t("proj_boq_mode_manual") },
                    { mode: "skip" as const, icon: ChevronRight, label: t("proj_boq_mode_skip") },
                  ]).map(({ mode, icon: Icon, label }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setBoqMode(mode)}
                      className={cn(
                        "flex flex-col items-center gap-2 p-5 rounded-2xl border text-center transition-all cursor-pointer",
                        boqMode === mode ? "border-primary bg-primary/5 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                    >
                      <Icon size={22} className={boqMode === mode ? "text-primary" : "text-slate-400"} />
                      <span className="text-sm font-bold text-slate-700">{label}</span>
                    </button>
                  ))}
                </div>

                {boqMode === "upload" && (
                  <div className="space-y-4">
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
                    {boqParsedItems && boqParsedItems.length > 0 && (
                      <div className="p-4 bg-success/5 border border-success/20 rounded-xl flex items-center gap-2 text-sm text-success font-semibold">
                        <CheckCircle2 size={16} />
                        {t("proj_boq_review_count", { count: boqParsedItems.length })}
                      </div>
                    )}
                  </div>
                )}

                {boqMode === "manual" && (
                  <div className="space-y-4">
                    <p className="text-sm font-bold text-slate-700">{t("proj_boq_manual_title")}</p>
                    <ProductRowEditor rows={manualRows} onChange={setManualRows} locale={locale} t={t} />
                    {manualRowCount > 0 && (
                      <div className="p-4 bg-success/5 border border-success/20 rounded-xl flex items-center gap-2 text-sm text-success font-semibold">
                        <CheckCircle2 size={16} />
                        {t("proj_boq_review_count", { count: manualRowCount })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
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
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        value={budget}
                        onChange={(e) => setBudget(e.target.value)}
                        className="h-11 rounded-xl border-slate-200 pe-14"
                        dir="ltr"
                        disabled={isSubmitting}
                      />
                      <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium pointer-events-none">
                        {locale === "ar" ? "ر.س" : "SAR"}
                      </span>
                    </div>
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

            {step === 5 && (
              <div className="p-8">
                <StagedTeamStep organizationId={myOrgId} staged={stagedMembers} onChange={setStagedMembers} />
              </div>
            )}

            {step === 6 && (
              <div className="p-8 space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <ClipboardCheck size={18} className="text-primary" />
                    {t("proj_review_title")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">{t("proj_review_desc")}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50">
                    <p className="text-xs font-bold text-muted-foreground uppercase mb-2">{t("proj_review_details")}</p>
                    <p className="text-sm font-bold text-slate-800">{name || "—"}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {projectType ? t(projectType as (typeof PROJECT_TYPES)[number]) : "—"}
                      {clientType ? ` · ${t(clientType as (typeof CLIENT_TYPES)[number])}` : ""}
                    </p>
                    {description && <p className="text-xs text-slate-500 mt-2 leading-relaxed">{description}</p>}
                    {blueprintFile && <p className="text-xs text-blue-600 mt-2">{blueprintFile.name}</p>}
                  </div>

                  <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50">
                    <p className="text-xs font-bold text-muted-foreground uppercase mb-2">{t("proj_review_location_budget")}</p>
                    <p className="text-sm text-slate-700">{region || "—"}{location ? ` · ${location}` : ""}</p>
                    <p className="text-sm font-bold text-slate-800 mt-1" dir="ltr">
                      {budget ? `${Number(budget).toLocaleString(locale === "ar" ? "ar-SA" : "en-US")} ${locale === "ar" ? "ر.س" : "SAR"}` : "—"}
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 sm:col-span-2">
                    <p className="text-xs font-bold text-muted-foreground uppercase mb-2">
                      {t("proj_review_sections")} ({enabledSections.size}/{SECTION_IDS.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {SECTION_IDS.filter((id) => enabledSections.has(id)).map((id) => (
                        <span key={id} className="text-[11px] font-semibold bg-primary/10 text-primary px-2 py-1 rounded-full">
                          {tShared(sectionLabelKey(id))}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50">
                    <p className="text-xs font-bold text-muted-foreground uppercase mb-2">{t("proj_review_boq")}</p>
                    <p className="text-sm text-slate-700">
                      {boqMode === "upload" && boqParsedItems ? t("proj_boq_review_count", { count: boqParsedItems.length }) : null}
                      {boqMode === "manual" ? t("proj_boq_review_count", { count: manualRowCount }) : null}
                      {(!boqMode || boqMode === "skip") ? t("proj_boq_mode_skip") : null}
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50">
                    <p className="text-xs font-bold text-muted-foreground uppercase mb-2">{t("proj_review_team")}</p>
                    <p className="text-sm text-slate-700">
                      {stagedMembers.length > 0 ? t("proj_review_team_count", { count: stagedMembers.length }) : tShared("proj_team_empty")}
                    </p>
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

            {step < STEP_COUNT ? (
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
