"use client"

import { useState, useCallback, useRef } from "react"
import { useTranslations, useLocale } from "next-intl"
import { useRouter } from "@/i18n/routing"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Upload,
  FileSpreadsheet,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  X,
  Package,
  AlertCircle,
  Building2,
  Calendar,
  MapPin,
  FileText,
  Layers,
  Search,
  SquareCheckBig,
  Square,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, addDoc, getDocs, query, where } from "firebase/firestore"
import { CATEGORIES_DATA, SAUDI_CITIES, displayCategory, displayCity } from "@/lib/constants"
import type { BoqItem, BoqProjectInfo } from "@/lib/boq-parser"

const CITIES_DISTRICTS: Record<string, string[]> = {
  "الرياض": ["شمال الرياض", "جنوب الرياض", "شرق الرياض", "غرب الرياض", "وسط الرياض", "جميع الرياض"],
  "جدة": ["شمال جدة", "جنوب جدة", "وسط جدة", "أبحر", "جميع جدة"],
  "مكة المكرمة": ["العزيزية", "الشوقية", "العوالي", "بطحاء قريش", "جميع مكة"],
  "المدينة المنورة": ["العزيزية", "الخالدية", "الحرة الشرقية", "جميع المدينة"],
  "الدمام": ["شرق الدمام", "غرب الدمام", "وسط الدمام", "جميع الدمام"],
  "الخبر": ["شمال الخبر", "الخبر الجنوبية", "العقربية", "جميع الخبر"],
  "الظهران": ["حي الدانة", "حي الدوحة", "حي القصور", "جميع الظهران"],
  "الأحساء": ["الهفوف", "المبرز", "العيون", "جميع الأحساء"],
  "الجبيل": ["الجبيل الصناعية", "الجبيل البلد", "جميع الجبيل"],
  "تبوك": ["المروج", "الروضة", "السليمانية", "جميع تبوك"],
  "حائل": ["صديان", "أجا", "النقرة", "جميع حائل"],
  "أبها": ["حي المنسك", "حي الموظفين", "جميع أبها"],
  "خميس مشيط": ["الرصراص", "شكر", "جميع خميس مشيط"],
  "جازان": ["حي السويس", "حي الروضة", "جميع جازان"],
  "نجران": ["الفيصلية", "الخالدية", "جميع نجران"],
}

type Step = "upload" | "review"

export default function UploadBoqPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const router = useRouter()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  // ── Step state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("upload")
  const [isDragging, setIsDragging] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  // ── Parsed data ──────────────────────────────────────────────────────────
  const [projectInfo, setProjectInfo] = useState<BoqProjectInfo | null>(null)
  const [items, setItems] = useState<BoqItem[]>([])
  const [fileName, setFileName] = useState("")
  // itemNo → existing RFQ status (Draft / Published / etc.)
  const [existingItemNos, setExistingItemNos] = useState<Map<string, string>>(new Map())

  // ── Step 1 settings ──────────────────────────────────────────────────────
  const [city, setCity] = useState("")
  const [district, setDistrict] = useState("")
  const [deadline, setDeadline] = useState("")

  // ── Step 2 filters ───────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("")
  const [divisionFilter, setDivisionFilter] = useState("all")

  const isRtl = locale === "ar"
  const selectedItems = items.filter(i => i.selected)

  // ── Unique divisions for filter ──────────────────────────────────────────
  const divisions = Array.from(new Set(items.map(i => i.sheet)))

  // ── Filtered items ───────────────────────────────────────────────────────
  const filteredItems = items.filter(item => {
    if (divisionFilter !== "all" && item.sheet !== divisionFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return (
        item.descriptionEn.toLowerCase().includes(q) ||
        item.descriptionAr.includes(q) ||
        item.itemNo.toLowerCase().includes(q)
      )
    }
    return true
  })

  // ── File parsing ─────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast({ title: t("boq_invalid_file"), variant: "destructive" })
      return
    }

    setIsParsing(true)
    setFileName(file.name)

    try {
      const { parseBoqFile } = await import("@/lib/boq-parser")
      const result = await parseBoqFile(file)

      if (result.items.length === 0) {
        toast({ title: t("boq_empty_file"), variant: "destructive" })
        setIsParsing(false)
        return
      }

      // Check for already-created RFQs from this BOQ project
      const existingMap = new Map<string, string>()
      if (firestore && user) {
        const projectKey = result.projectInfo.projectNo || result.projectInfo.projectName
        if (projectKey) {
          const field = result.projectInfo.projectNo ? "boqProjectNo" : "boqProjectName"
          const snap = await getDocs(
            query(
              collection(firestore, "rfqs"),
              where("contractorId", "==", user.uid),
              where(field, "==", projectKey)
            )
          )
          snap.forEach(d => {
            const data = d.data()
            if (data.boqItemNo) existingMap.set(data.boqItemNo, data.status ?? "Draft")
          })
        }
      }

      setExistingItemNos(existingMap)
      setProjectInfo(result.projectInfo)
      // Auto-deselect items that already exist
      setItems(result.items.map(item => ({
        ...item,
        selected: !existingMap.has(item.itemNo),
      })))

      const dupCount = existingMap.size
      toast({
        title: t("boq_parse_success"),
        description: dupCount > 0
          ? t("boq_items_detected", { count: result.items.length }) + ` — ${dupCount} مكررة`
          : t("boq_items_detected", { count: result.items.length }),
      })
    } catch (err) {
      console.error("BOQ parse error:", err)
      toast({ title: t("boq_parse_error"), variant: "destructive" })
    } finally {
      setIsParsing(false)
    }
  }, [t, toast])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  // ── Item selection ────────────────────────────────────────────────────────
  const toggleItem = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, selected: !i.selected } : i))
  }

  const toggleAll = (checked: boolean) => {
    setItems(prev => prev.map(i =>
      filteredItems.some(f => f.id === i.id) ? { ...i, selected: checked } : i
    ))
  }

  const updateItemCategory = (id: string, category: string) => {
    setItems(prev => prev.map(i =>
      i.id === id ? { ...i, suggestedCategory: category, suggestedSubCategory: "" } : i
    ))
  }

  // ── Create draft RFQs ────────────────────────────────────────────────────
  const handleCreateDrafts = async () => {
    if (!firestore || !user || !profile) return

    const toCreate = items.filter(i => i.selected)
    if (toCreate.length === 0) {
      toast({ title: t("boq_select_at_least_one"), variant: "destructive" })
      return
    }

    setIsCreating(true)
    try {
      const rfqsRef = collection(firestore, "rfqs")
      let created = 0

      await Promise.all(
        toCreate.map(async item => {
          const rfqData = {
            contractorId: user.uid,
            organizationId: profile.organizationId || user.uid,
            title: item.descriptionEn.length > 80
              ? item.descriptionEn.substring(0, 80).trimEnd() + "…"
              : item.descriptionEn,
            category: item.suggestedCategory,
            subCategory: item.suggestedSubCategory || "",
            products: [
              {
                name: item.descriptionEn,
                quantity: item.quantity,
                unitOfMeasure: item.unit,
                description: item.descriptionAr,
                category: item.suggestedCategory,
                subCategory: item.suggestedSubCategory || "",
              },
            ],
            quantity: String(item.quantity),
            unitOfMeasure: item.unit,
            notes: item.descriptionAr
              ? `${item.descriptionAr}\n\n${item.descriptionEn}`
              : item.descriptionEn,
            deadline,
            city,
            district: district || city,
            pdfUrl: null,
            pdfStoragePath: null,
            status: "Draft",
            visibility: "public",
            // BOQ metadata
            boqItemNo: item.itemNo,
            boqProjectName: projectInfo?.projectName || "",
            boqProjectNo: projectInfo?.projectNo || "",
            boqSheetName: item.sheet,
            createdByUserId: user.uid,
            createdByUserName: profile.name || user.email || "عضو الفريق",
            createdAt: new Date().toISOString(),
          }
          await addDoc(rfqsRef, rfqData)
          created++
        })
      )

      toast({
        title: t("boq_success_title"),
        description: t("boq_success_desc", { count: created }),
      })
      router.push("/contractor/rfqs")
    } catch (err) {
      console.error("BOQ create error:", err)
      toast({ title: t("boq_create_error"), variant: "destructive" })
    } finally {
      setIsCreating(false)
    }
  }

  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every(i => i.selected)

  // ── Today + 30 days as min deadline ──────────────────────────────────────
  const minDeadline = new Date()
  minDeadline.setDate(minDeadline.getDate() + 1)
  const minDeadlineStr = minDeadline.toISOString().split("T")[0]

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <PortalLayout>
      <div className={cn("space-y-6", isRtl ? "text-right" : "text-left")} dir={isRtl ? "rtl" : "ltr"}>

        {/* ── Page Header ── */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <FileSpreadsheet size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-foreground">{t("boq_upload_title")}</h1>
            <p className="text-sm text-muted-foreground">{t("boq_upload_desc")}</p>
          </div>
        </div>

        {/* ── Step indicator ── */}
        <div className="flex items-center gap-2">
          <StepDot active={step === "upload"} done={step === "review"} number={1} label={t("boq_step1_label")} />
          <div className="flex-1 h-px bg-slate-200" />
          <StepDot active={step === "review"} done={false} number={2} label={t("boq_step2_label")} />
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            STEP 1 — Upload & Settings
        ═══════════════════════════════════════════════════════════════════ */}
        {step === "upload" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Left: Dropzone */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <FileSpreadsheet size={16} className="text-primary" />
                  {t("boq_step1_title")}
                </CardTitle>
                <CardDescription className="text-xs">{t("boq_supported_formats")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Dropzone */}
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  onClick={() => !isParsing && fileInputRef.current?.click()}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 cursor-pointer transition-all",
                    isDragging
                      ? "border-primary bg-primary/5 scale-[1.01]"
                      : projectInfo
                        ? "border-emerald-300 bg-emerald-50/60"
                        : "border-slate-200 bg-slate-50/50 hover:border-primary/50 hover:bg-primary/3"
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={onFileChange}
                  />

                  {isParsing ? (
                    <>
                      <Loader2 size={36} className="animate-spin text-primary" />
                      <p className="text-sm font-medium text-primary">{t("boq_parsing")}</p>
                    </>
                  ) : projectInfo ? (
                    <>
                      <CheckCircle2 size={36} className="text-emerald-500" />
                      <div className="text-center space-y-1">
                        <p className="text-sm font-bold text-emerald-700 truncate max-w-[200px]">{fileName}</p>
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 font-bold text-xs">
                          {t("boq_items_detected", { count: projectInfo.totalItems })}
                        </Badge>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); setProjectInfo(null); setItems([]); setFileName(""); setExistingItemNos(new Map()) }}
                        className="text-xs text-muted-foreground hover:text-destructive underline mt-1"
                      >
                        {t("boq_change_file")}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="h-16 w-16 rounded-2xl bg-primary/8 flex items-center justify-center">
                        <Upload size={28} className="text-primary/60" />
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-sm font-bold text-slate-700">{t("boq_drop_hint")}</p>
                        <p className="text-xs text-muted-foreground">{t("boq_drop_hint_sub")}</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Parsed project info */}
                {projectInfo && (
                  <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs">
                    <div>
                      <p className="text-muted-foreground font-medium mb-0.5">{t("boq_project_no")}</p>
                      <p className="font-bold text-slate-700 dir-ltr">{projectInfo.projectNo || "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium mb-0.5">{t("boq_revision")}</p>
                      <p className="font-bold text-slate-700">{projectInfo.revision || "R00"}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground font-medium mb-0.5">{t("boq_project_name")}</p>
                      <p className="font-bold text-slate-700 capitalize">{projectInfo.projectName || "—"}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Right: Common Settings */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Layers size={16} className="text-primary" />
                  {t("boq_common_settings")}
                </CardTitle>
                <CardDescription className="text-xs">{t("boq_common_settings_desc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* City */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold flex items-center gap-1.5">
                    <MapPin size={13} className="text-primary" />
                    {t("boq_city_label")} *
                  </Label>
                  <Select value={city} onValueChange={v => { setCity(v); setDistrict("") }}>
                    <SelectTrigger className="h-10 text-sm rounded-xl">
                      <SelectValue placeholder={t("boq_city_placeholder")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {SAUDI_CITIES.map(c => (
                        <SelectItem key={c} value={c}>{displayCity(c, locale)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* District */}
                {city && CITIES_DISTRICTS[city] && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold flex items-center gap-1.5">
                      <Building2 size={13} className="text-primary" />
                      {t("boq_district_label")}
                    </Label>
                    <Select value={district} onValueChange={setDistrict}>
                      <SelectTrigger className="h-10 text-sm rounded-xl">
                        <SelectValue placeholder={t("boq_district_placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {CITIES_DISTRICTS[city].map(d => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Deadline */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold flex items-center gap-1.5">
                    <Calendar size={13} className="text-primary" />
                    {t("boq_deadline_label")} *
                  </Label>
                  <Input
                    type="date"
                    min={minDeadlineStr}
                    value={deadline}
                    onChange={e => setDeadline(e.target.value)}
                    className="h-10 text-sm rounded-xl"
                  />
                </div>

                {/* Info note */}
                <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 flex gap-2 text-xs text-blue-800">
                  <AlertCircle size={14} className="shrink-0 mt-0.5 text-blue-500" />
                  <p>{t("boq_settings_note")}</p>
                </div>

                {/* Next button */}
                <Button
                  className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold gap-2 shadow-lg shadow-primary/20 mt-2"
                  disabled={!projectInfo || !city || !deadline}
                  onClick={() => setStep("review")}
                >
                  {t("boq_next_review")}
                  {isRtl
                    ? <ChevronLeft size={16} />
                    : <ChevronRight size={16} />}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STEP 2 — Review & Create
        ═══════════════════════════════════════════════════════════════════ */}
        {step === "review" && (
          <div className="space-y-4">
            {/* Header bar */}
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStep("upload")}
                  className="h-9 w-9 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors"
                >
                  {isRtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>
                <div>
                  <p className="font-bold text-slate-800 text-sm">{projectInfo?.projectName || t("boq_review_title")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("boq_selected_count", { selected: selectedItems.length, total: items.length })}
                  </p>
                </div>
              </div>
              <Button
                className="h-11 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2 shadow-lg shadow-emerald-600/20"
                disabled={selectedItems.length === 0 || isCreating}
                onClick={handleCreateDrafts}
              >
                {isCreating
                  ? <Loader2 size={16} className="animate-spin" />
                  : <CheckCircle2 size={16} />}
                {isCreating
                  ? t("boq_creating")
                  : t("boq_create_drafts", { count: selectedItems.length })}
              </Button>
            </div>

            {/* Filter bar */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder={t("boq_search_items")}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pe-9 h-10 text-sm rounded-xl"
                />
              </div>
              <Select value={divisionFilter} onValueChange={setDivisionFilter}>
                <SelectTrigger className="w-full sm:w-[200px] h-10 text-sm rounded-xl">
                  <SelectValue placeholder={t("boq_all_divisions")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("boq_all_divisions")}</SelectItem>
                  {divisions.map(d => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Items table */}
            <Card className="border-slate-200 overflow-hidden">
              {/* Table header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100 text-xs font-bold text-muted-foreground">
                <button
                  onClick={() => toggleAll(!allFilteredSelected)}
                  className="shrink-0"
                  aria-label="toggle all"
                >
                  {allFilteredSelected
                    ? <SquareCheckBig size={16} className="text-primary" />
                    : <Square size={16} className="text-slate-400" />}
                </button>
                <span className="w-24 shrink-0">{t("boq_item_no")}</span>
                <span className="flex-1">{t("boq_description")}</span>
                <span className="w-14 text-center shrink-0 hidden sm:block">{t("boq_qty")}</span>
                <span className="w-14 text-center shrink-0 hidden sm:block">{t("boq_unit")}</span>
                <span className="w-36 shrink-0 hidden md:block">{t("boq_category")}</span>
              </div>

              {/* Rows — grouped by division */}
              <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
                {filteredItems.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    <Package size={32} className="mx-auto mb-2 opacity-20" />
                    {t("boq_no_results")}
                  </div>
                ) : (
                  (() => {
                    // Group items by sheet for visual separation
                    const grouped: Record<string, BoqItem[]> = {}
                    for (const item of filteredItems) {
                      if (!grouped[item.sheet]) grouped[item.sheet] = []
                      grouped[item.sheet].push(item)
                    }

                    return Object.entries(grouped).map(([sheet, sheetItems]) => (
                      <div key={sheet}>
                        {/* Division subheader */}
                        <div className="flex items-center gap-2 px-4 py-2 bg-primary/4 border-b border-primary/10">
                          <FileText size={12} className="text-primary" />
                          <span className="text-[11px] font-black text-primary uppercase tracking-wide">{sheet}</span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-primary border-primary/20 bg-primary/5 font-bold">
                            {sheetItems.length}
                          </Badge>
                        </div>

                        {sheetItems.map(item => (
                          <div
                            key={item.id}
                            className={cn(
                              "flex items-start gap-3 px-4 py-3 hover:bg-slate-50/80 transition-colors",
                              !item.selected && "opacity-50"
                            )}
                          >
                            {/* Checkbox */}
                            <Checkbox
                              checked={item.selected}
                              onCheckedChange={() => toggleItem(item.id)}
                              className="mt-0.5 shrink-0"
                            />

                            {/* Item No */}
                            <span className="w-24 shrink-0 text-[11px] font-mono text-primary bg-primary/5 px-1.5 py-0.5 rounded-md self-start whitespace-nowrap">
                              {item.itemNo}
                            </span>

                            {/* Description */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start gap-2 flex-wrap">
                                <p className="text-xs font-bold text-slate-800 leading-snug flex-1">
                                  {item.descriptionEn}
                                </p>
                                {existingItemNos.has(item.itemNo) && (
                                  <Badge className={cn(
                                    "shrink-0 text-[10px] px-1.5 h-4 font-bold border",
                                    existingItemNos.get(item.itemNo) === "Published"
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-amber-50 text-amber-700 border-amber-200"
                                  )}>
                                    {existingItemNos.get(item.itemNo) === "Published" ? "منشورة" : "مسودة"}
                                  </Badge>
                                )}
                              </div>
                              {item.descriptionAr && (
                                <p className="text-[11px] text-muted-foreground mt-0.5 text-right" dir="rtl">
                                  {item.descriptionAr}
                                </p>
                              )}
                            </div>

                            {/* Qty */}
                            <span className="w-14 text-center text-xs font-bold text-slate-700 shrink-0 hidden sm:block" dir="ltr">
                              {item.quantity}
                            </span>

                            {/* Unit */}
                            <span className="w-14 text-center text-[11px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md font-bold shrink-0 hidden sm:block">
                              {item.unit}
                            </span>

                            {/* Category */}
                            <div className="w-36 shrink-0 hidden md:block">
                              <Select
                                value={item.suggestedCategory}
                                onValueChange={v => updateItemCategory(item.id, v)}
                              >
                                <SelectTrigger className="h-7 text-[11px] rounded-lg border-slate-200">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="max-h-60">
                                  {Object.keys(CATEGORIES_DATA).map(cat => (
                                    <SelectItem key={cat} value={cat} className="text-xs">
                                      {displayCategory(cat, locale)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))
                  })()
                )}
              </div>

              {/* Sticky bottom summary */}
              <div className="sticky bottom-0 px-4 py-3 bg-white border-t border-slate-200 flex items-center justify-between gap-3 shadow-[0_-4px_12px_rgba(15,23,42,0.05)]">
                <div className="text-xs text-muted-foreground">
                  <span className="font-bold text-slate-700">{selectedItems.length}</span>
                  {" "}{t("boq_items_selected_of")}{" "}
                  <span className="font-bold text-slate-700">{items.length}</span>
                </div>
                <Button
                  className="h-9 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2 text-xs shadow-md shadow-emerald-600/20"
                  disabled={selectedItems.length === 0 || isCreating}
                  onClick={handleCreateDrafts}
                >
                  {isCreating
                    ? <Loader2 size={14} className="animate-spin" />
                    : <CheckCircle2 size={14} />}
                  {isCreating
                    ? t("boq_creating")
                    : t("boq_create_drafts", { count: selectedItems.length })}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </PortalLayout>
  )
}

// ── Helper: step indicator dot ────────────────────────────────────────────────
function StepDot({
  number,
  label,
  active,
  done,
}: {
  number: number
  label: string
  active: boolean
  done: boolean
}) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div
        className={cn(
          "h-7 w-7 rounded-full flex items-center justify-center text-xs font-black transition-colors",
          done
            ? "bg-emerald-500 text-white"
            : active
              ? "bg-primary text-white"
              : "bg-slate-200 text-slate-500"
        )}
      >
        {done ? <CheckCircle2 size={14} /> : number}
      </div>
      <span
        className={cn(
          "text-xs font-bold hidden sm:block",
          active ? "text-primary" : done ? "text-emerald-600" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </div>
  )
}
