"use client"

import { useState, useCallback, useRef, useId } from "react"
import { useTranslations, useLocale } from "next-intl"
import { useRouter } from "@/i18n/routing"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
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
  AlertCircle,
  Building2,
  Calendar,
  MapPin,
  FileText,
  Layers,
  GripVertical,
  Scissors,
  Trash2,
  Plus,
  Package,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, addDoc, getDocs, query, where } from "firebase/firestore"
import { CATEGORIES_DATA, SAUDI_CITIES, displayCategory, displayCity, displayDistrict } from "@/lib/constants"
import type { BoqItem, BoqProjectInfo } from "@/lib/boq-parser"

// ── Types ────────────────────────────────────────────────────────────────────

interface BoqGroup {
  id: string
  titleAr: string      // editable Arabic RFQ title
  categoryAr: string   // maps to platform category
  items: BoqItem[]
}

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
}

type Step = "upload" | "review"

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function buildGroups(items: BoqItem[]): BoqGroup[] {
  const map = new Map<string, BoqItem[]>()
  for (const item of items) {
    const cat = item.suggestedCategory
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(item)
  }
  return Array.from(map.entries()).map(([cat, catItems]) => ({
    id: uid(),
    categoryAr: cat,
    titleAr: `توريد ${cat}`,
    items: catItems,
  }))
}

export default function UploadBoqPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const router = useRouter()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isRtl = locale === "ar"

  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  // ── Step state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("upload")
  const [isDragging, setIsDragging] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  // ── Parsed data ───────────────────────────────────────────────────────────
  const [projectInfo, setProjectInfo] = useState<BoqProjectInfo | null>(null)
  const [projectNameEdit, setProjectNameEdit] = useState("")
  const [fileName, setFileName] = useState("")
  const [groups, setGroups] = useState<BoqGroup[]>([])
  const [unassigned, setUnassigned] = useState<BoqItem[]>([])
  const [existingItemNos, setExistingItemNos] = useState<Map<string, string>>(new Map())

  // ── Step 1 settings ───────────────────────────────────────────────────────
  const [city, setCity] = useState("")
  const [district, setDistrict] = useState("")
  const [deadline, setDeadline] = useState("")

  // ── Drag state ────────────────────────────────────────────────────────────
  const [dragPayload, setDragPayload] = useState<{ item: BoqItem; fromGroupId: string | "unassigned" } | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | "unassigned" | null>(null)

  // ── File parsing ──────────────────────────────────────────────────────────
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

      // Check duplicates
      const existingMap = new Map<string, string>()
      if (firestore && user) {
        const projectKey = result.projectInfo.projectNo || result.projectInfo.projectName
        if (projectKey) {
          const field = result.projectInfo.projectNo ? "boqProjectNo" : "boqProjectName"
          const snap = await getDocs(
            query(collection(firestore, "rfqs"), where("contractorId", "==", user.uid), where(field, "==", projectKey))
          )
          snap.forEach(d => {
            const data = d.data()
            if (data.boqItemNo) existingMap.set(data.boqItemNo, data.status ?? "Draft")
          })
        }
      }

      setExistingItemNos(existingMap)
      setProjectInfo(result.projectInfo)
      setProjectNameEdit(result.projectInfo.projectName)

      // Build groups — auto-deselect existing items by putting them in unassigned
      const newItems = result.items.filter(i => !existingMap.has(i.itemNo))
      const existingItems = result.items.filter(i => existingMap.has(i.itemNo))
      setGroups(buildGroups(newItems))
      setUnassigned(existingItems) // existing items go to unassigned so user sees them but they won't be re-created

      const dupCount = existingMap.size
      toast({
        title: t("boq_parse_success"),
        description: dupCount > 0
          ? `${t("boq_items_detected", { count: result.items.length })} — ${dupCount} ${locale === "ar" ? "مكررة (في قسم غير المصنف)" : "duplicates (in unassigned)"}`
          : t("boq_items_detected", { count: result.items.length }),
      })
    } catch (err) {
      console.error("BOQ parse error:", err)
      toast({ title: t("boq_parse_error"), variant: "destructive" })
    } finally {
      setIsParsing(false)
    }
  }, [t, toast, firestore, user, locale])

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const resetFile = () => {
    setProjectInfo(null)
    setProjectNameEdit("")
    setFileName("")
    setGroups([])
    setUnassigned([])
    setExistingItemNos(new Map())
  }

  // ── Group mutations ───────────────────────────────────────────────────────
  const updateGroupTitle = (groupId: string, titleAr: string) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, titleAr } : g))
  }

  const updateGroupCategory = (groupId: string, categoryAr: string) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, categoryAr, titleAr: `توريد ${categoryAr}` } : g))
  }

  const deleteGroup = (groupId: string) => {
    const group = groups.find(g => g.id === groupId)
    if (group) setUnassigned(prev => [...prev, ...group.items])
    setGroups(prev => prev.filter(g => g.id !== groupId))
  }

  const addGroup = () => {
    setGroups(prev => [...prev, {
      id: uid(),
      categoryAr: Object.keys(CATEGORIES_DATA)[0],
      titleAr: isRtl ? "مجموعة جديدة" : "New Group",
      items: [],
    }])
  }

  // ── Item drag-and-drop ────────────────────────────────────────────────────
  const splitItemToNewGroup = (item: BoqItem, fromGroupId: string) => {
    setGroups(prev => {
      const updated = prev.map(g =>
        g.id === fromGroupId ? { ...g, items: g.items.filter(i => i.id !== item.id) } : g
      )
      return [...updated, {
        id: uid(),
        categoryAr: item.suggestedCategory,
        titleAr: item.descriptionAr ? item.descriptionAr.substring(0, 60) : `توريد ${item.suggestedCategory}`,
        items: [item],
      }]
    })
  }

  const removeItemFromGroup = (item: BoqItem, fromGroupId: string) => {
    setGroups(prev => prev.map(g =>
      g.id === fromGroupId ? { ...g, items: g.items.filter(i => i.id !== item.id) } : g
    ))
    setUnassigned(prev => [...prev, item])
  }

  const moveItemToGroup = (item: BoqItem, fromGroupId: string | "unassigned", toGroupId: string | "unassigned") => {
    if (fromGroupId === toGroupId) return

    // Remove from source
    if (fromGroupId === "unassigned") {
      setUnassigned(prev => prev.filter(i => i.id !== item.id))
    } else {
      setGroups(prev => prev.map(g =>
        g.id === fromGroupId ? { ...g, items: g.items.filter(i => i.id !== item.id) } : g
      ))
    }

    // Add to target
    if (toGroupId === "unassigned") {
      setUnassigned(prev => [...prev, item])
    } else {
      setGroups(prev => prev.map(g =>
        g.id === toGroupId ? { ...g, items: [...g.items, item] } : g
      ))
    }
  }

  const onItemDragStart = (e: React.DragEvent, item: BoqItem, fromGroupId: string | "unassigned") => {
    e.dataTransfer.effectAllowed = "move"
    setDragPayload({ item, fromGroupId })
  }

  const onGroupDragOver = (e: React.DragEvent, groupId: string | "unassigned") => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDragOverGroupId(groupId)
  }

  const onGroupDrop = (e: React.DragEvent, toGroupId: string | "unassigned") => {
    e.preventDefault()
    setDragOverGroupId(null)
    if (!dragPayload) return
    moveItemToGroup(dragPayload.item, dragPayload.fromGroupId, toGroupId)
    setDragPayload(null)
  }

  // ── Create draft RFQs ─────────────────────────────────────────────────────
  const handleCreateDrafts = async () => {
    if (!firestore || !user || !profile) return
    const groupsToCreate = groups.filter(g => g.items.length > 0)
    if (groupsToCreate.length === 0) {
      toast({ title: t("boq_select_at_least_one"), variant: "destructive" })
      return
    }

    setIsCreating(true)
    try {
      const rfqsRef = collection(firestore, "rfqs")
      let created = 0

      await Promise.all(
        groupsToCreate.map(async group => {
          const rfqData = {
            contractorId: user.uid,
            organizationId: profile.organizationId || user.uid,
            title: group.titleAr,
            category: group.categoryAr,
            subCategory: "",
            products: group.items.map(item => ({
              name: item.descriptionAr || item.descriptionEn,
              nameEn: item.descriptionEn,
              quantity: item.quantity,
              unitOfMeasure: item.unit,
              description: item.descriptionAr
                ? `${item.descriptionAr}\n${item.descriptionEn}`
                : item.descriptionEn,
              category: group.categoryAr,
              subCategory: item.suggestedSubCategory || "",
              boqItemNo: item.itemNo,
            })),
            quantity: String(group.items.reduce((s, i) => s + i.quantity, 0)),
            notes: group.items.map(i => i.descriptionAr || i.descriptionEn).join("\n"),
            deadline,
            city,
            district: district || city,
            pdfUrl: null,
            pdfStoragePath: null,
            status: "Draft",
            visibility: "public",
            boqProjectName: projectNameEdit || projectInfo?.projectName || "",
            boqProjectNo: projectInfo?.projectNo || "",
            boqGroupItemNos: group.items.map(i => i.itemNo),
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

  const totalActiveItems = groups.reduce((s, g) => s + g.items.length, 0)
  const groupsToCreate = groups.filter(g => g.items.length > 0)
  const minDeadline = new Date(); minDeadline.setDate(minDeadline.getDate() + 1)
  const minDeadlineStr = minDeadline.toISOString().split("T")[0]

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <PortalLayout>
      <div className={cn("space-y-6", isRtl ? "text-right" : "text-left")} dir={isRtl ? "rtl" : "ltr"}>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <FileSpreadsheet size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-foreground">{t("boq_upload_title")}</h1>
            <p className="text-sm text-muted-foreground">{t("boq_upload_desc")}</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          <StepDot active={step === "upload"} done={step === "review"} number={1} label={t("boq_step1_label")} />
          <div className="flex-1 h-px bg-slate-200" />
          <StepDot active={step === "review"} done={false} number={2} label={t("boq_step2_label")} />
        </div>

        {/* ═══════════════════════════════════════════════════════════
            STEP 1 — Upload & Settings
        ═══════════════════════════════════════════════════════════ */}
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
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  onClick={() => !isParsing && fileInputRef.current?.click()}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 cursor-pointer transition-all",
                    isDragging ? "border-primary bg-primary/5 scale-[1.01]"
                      : projectInfo ? "border-emerald-300 bg-emerald-50/60"
                      : "border-slate-200 bg-slate-50/50 hover:border-primary/50 hover:bg-primary/3"
                  )}
                >
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFileChange} />
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
                          {t("boq_items_detected", { count: groups.reduce((s, g) => s + g.items.length, 0) + unassigned.length })}
                        </Badge>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); resetFile() }}
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

                {/* Editable project info */}
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
                    <div className="col-span-2 space-y-1">
                      <p className="text-muted-foreground font-medium">{t("boq_project_name_edit")}</p>
                      <Input
                        value={projectNameEdit}
                        onChange={e => setProjectNameEdit(e.target.value)}
                        className="h-8 text-xs rounded-lg border-slate-200 bg-white"
                        dir="auto"
                      />
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
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold flex items-center gap-1.5">
                    <MapPin size={13} className="text-primary" />{t("boq_city_label")} *
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

                {city && CITIES_DISTRICTS[city] && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold flex items-center gap-1.5">
                      <Building2 size={13} className="text-primary" />{t("boq_district_label")}
                    </Label>
                    <Select value={district} onValueChange={setDistrict}>
                      <SelectTrigger className="h-10 text-sm rounded-xl">
                        <SelectValue placeholder={t("boq_district_placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {CITIES_DISTRICTS[city].map(d => (
                          <SelectItem key={d} value={d}>{displayDistrict(d, locale)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold flex items-center gap-1.5">
                    <Calendar size={13} className="text-primary" />{t("boq_deadline_label")} *
                  </Label>
                  <Input type="date" min={minDeadlineStr} value={deadline} onChange={e => setDeadline(e.target.value)} className="h-10 text-sm rounded-xl" />
                </div>

                <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 flex gap-2 text-xs text-blue-800">
                  <AlertCircle size={14} className="shrink-0 mt-0.5 text-blue-500" />
                  <p>{t("boq_settings_note")}</p>
                </div>

                <Button
                  className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold gap-2 shadow-lg shadow-primary/20 mt-2"
                  disabled={!projectInfo || !city || !deadline}
                  onClick={() => setStep("review")}
                >
                  {t("boq_next_review")}
                  {isRtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            STEP 2 — Review Groups
        ═══════════════════════════════════════════════════════════ */}
        {step === "review" && (
          <div className="space-y-4">

            {/* Review header */}
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStep("upload")}
                  className="h-9 w-9 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors"
                >
                  {isRtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>
                <div>
                  <p className="font-bold text-slate-800 text-sm">{projectNameEdit || t("boq_review_title")}</p>
                  <p className="text-xs text-muted-foreground">
                    {isRtl
                      ? `${groupsToCreate.length} مناقصات ستُنشأ من ${totalActiveItems} بند`
                      : `${groupsToCreate.length} RFQs from ${totalActiveItems} items`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs rounded-xl border-primary/30 text-primary hover:bg-primary/5"
                  onClick={addGroup}
                >
                  <Plus size={14} />
                  {t("boq_add_group")}
                </Button>
                <Button
                  className="h-11 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2 shadow-lg shadow-emerald-600/20"
                  disabled={groupsToCreate.length === 0 || isCreating}
                  onClick={handleCreateDrafts}
                >
                  {isCreating ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {isCreating
                    ? t("boq_creating")
                    : isRtl
                      ? `إنشاء ${groupsToCreate.length} مناقصة`
                      : `Create ${groupsToCreate.length} RFQs`}
                </Button>
              </div>
            </div>

            {/* Drag hint */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-amber-50/60 border border-amber-100 rounded-xl px-3 py-2">
              <GripVertical size={13} className="text-amber-500 shrink-0" />
              <span>{t("boq_drag_hint")}</span>
            </div>

            {/* Groups */}
            <div className="space-y-4">
              {groups.map((group, groupIdx) => (
                <BoqGroupCard
                  key={group.id}
                  group={group}
                  groupIdx={groupIdx}
                  isRtl={isRtl}
                  locale={locale}
                  isDragOver={dragOverGroupId === group.id}
                  existingItemNos={existingItemNos}
                  onUpdateTitle={title => updateGroupTitle(group.id, title)}
                  onUpdateCategory={cat => updateGroupCategory(group.id, cat)}
                  onDeleteGroup={() => deleteGroup(group.id)}
                  onSplitItem={item => splitItemToNewGroup(item, group.id)}
                  onRemoveItem={item => removeItemFromGroup(item, group.id)}
                  onItemDragStart={(e, item) => onItemDragStart(e, item, group.id)}
                  onDragOver={e => onGroupDragOver(e, group.id)}
                  onDrop={e => onGroupDrop(e, group.id)}
                  onDragLeave={() => setDragOverGroupId(null)}
                  t={t}
                />
              ))}

              {/* Empty groups warning */}
              {groups.some(g => g.items.length === 0) && (
                <div className="flex items-center gap-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2">
                  <AlertCircle size={13} className="shrink-0" />
                  <span>{t("boq_group_empty_warn")}</span>
                </div>
              )}

              {/* Unassigned items */}
              {unassigned.length > 0 && (
                <Card className={cn(
                  "border-dashed border-2 transition-colors",
                  dragOverGroupId === "unassigned" ? "border-primary bg-primary/3" : "border-slate-200"
                )}
                  onDragOver={e => onGroupDragOver(e, "unassigned")}
                  onDrop={e => onGroupDrop(e, "unassigned")}
                  onDragLeave={() => setDragOverGroupId(null)}
                >
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-bold text-muted-foreground flex items-center gap-2">
                      <Package size={14} />
                      {t("boq_unassigned")}
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 ml-1">{unassigned.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    {unassigned.map(item => {
                      const dupStatus = existingItemNos.get(item.itemNo)
                      return (
                        <ItemRow
                          key={item.id}
                          item={item}
                          dupStatus={dupStatus}
                          isRtl={isRtl}
                          onDragStart={e => onItemDragStart(e, item, "unassigned")}
                          actions={null}
                        />
                      )
                    })}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  )
}

// ── BoqGroupCard ──────────────────────────────────────────────────────────────
function BoqGroupCard({
  group, groupIdx, isRtl, locale, isDragOver, existingItemNos,
  onUpdateTitle, onUpdateCategory, onDeleteGroup, onSplitItem, onRemoveItem,
  onItemDragStart, onDragOver, onDrop, onDragLeave, t,
}: {
  group: BoqGroup
  groupIdx: number
  isRtl: boolean
  locale: string
  isDragOver: boolean
  existingItemNos: Map<string, string>
  onUpdateTitle: (v: string) => void
  onUpdateCategory: (v: string) => void
  onDeleteGroup: () => void
  onSplitItem: (item: BoqItem) => void
  onRemoveItem: (item: BoqItem) => void
  onItemDragStart: (e: React.DragEvent, item: BoqItem) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragLeave: () => void
  t: (key: string, opts?: any) => string
}) {
  return (
    <Card
      className={cn(
        "border transition-all",
        isDragOver ? "border-primary/60 bg-primary/3 shadow-md" : "border-slate-200",
        group.items.length === 0 && "opacity-60"
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
    >
      <CardHeader className="pb-3">
        {/* Group header */}
        <div className="flex items-start gap-3 flex-wrap">
          <div className={cn("flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary text-xs font-black shrink-0 mt-1")}>
            {groupIdx + 1}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            {/* Title input */}
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("boq_group_rfq_title")}</Label>
              <Input
                value={group.titleAr}
                onChange={e => onUpdateTitle(e.target.value)}
                className="h-9 text-sm font-bold rounded-lg border-slate-200 mt-0.5"
                dir="rtl"
              />
            </div>
            {/* Category select */}
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("boq_group_category")}</Label>
              <Select value={group.categoryAr} onValueChange={onUpdateCategory}>
                <SelectTrigger className="h-8 text-xs rounded-lg border-slate-200 mt-0.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {Object.keys(CATEGORIES_DATA).map(cat => (
                    <SelectItem key={cat} value={cat} className="text-xs">{displayCategory(cat, locale)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-bold border-primary/20 text-primary bg-primary/5">
              {group.items.length} {isRtl ? "بند" : "items"}
            </Badge>
            <button
              onClick={onDeleteGroup}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title={isRtl ? "حذف المجموعة" : "Delete group"}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-2">
        {group.items.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground border-2 border-dashed border-slate-200 rounded-xl">
            {isRtl ? "اسحب البنود هنا" : "Drag items here"}
          </div>
        ) : (
          group.items.map(item => {
            const dupStatus = existingItemNos.get(item.itemNo)
            return (
              <ItemRow
                key={item.id}
                item={item}
                dupStatus={dupStatus}
                isRtl={isRtl}
                onDragStart={e => onItemDragStart(e, item)}
                actions={
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onSplitItem(item)}
                      className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      title={t("boq_split_item")}
                    >
                      <Scissors size={11} />
                    </button>
                    <button
                      onClick={() => onRemoveItem(item)}
                      className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title={t("boq_remove_item")}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                }
              />
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

// ── ItemRow ───────────────────────────────────────────────────────────────────
function ItemRow({
  item, dupStatus, isRtl, onDragStart, actions,
}: {
  item: BoqItem
  dupStatus?: string
  isRtl: boolean
  onDragStart: (e: React.DragEvent) => void
  actions: React.ReactNode
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex items-start gap-2 p-2.5 rounded-xl bg-slate-50/70 hover:bg-slate-100/80 border border-slate-100 cursor-grab active:cursor-grabbing transition-colors group"
    >
      <GripVertical size={14} className="text-slate-300 group-hover:text-slate-500 shrink-0 mt-0.5 transition-colors" />

      {/* Item No badge */}
      <span className="text-[10px] font-mono font-bold bg-primary/8 text-primary px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap">
        {item.itemNo}
      </span>

      {/* Descriptions */}
      <div className="flex-1 min-w-0">
        {/* Arabic first */}
        {item.descriptionAr && (
          <p className="text-xs font-bold text-slate-800 leading-snug text-right" dir="rtl">
            {item.descriptionAr}
          </p>
        )}
        <p className={cn("text-[11px] text-muted-foreground leading-snug", item.descriptionAr ? "mt-0.5" : "font-bold text-slate-800 text-xs")}>
          {item.descriptionEn}
        </p>
      </div>

      {/* Qty + Unit */}
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded" dir="ltr">
          {item.quantity}
        </span>
        <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
          {item.unit}
        </span>
      </div>

      {/* Duplicate badge */}
      {dupStatus && (
        <Badge className={cn(
          "text-[9px] px-1.5 h-4 shrink-0 font-bold border",
          dupStatus === "Published"
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-amber-50 text-amber-700 border-amber-200"
        )}>
          {dupStatus === "Published" ? "منشورة" : "مسودة"}
        </Badge>
      )}

      {actions}
    </div>
  )
}

// ── StepDot ───────────────────────────────────────────────────────────────────
function StepDot({ number, label, active, done }: { number: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className={cn(
        "h-7 w-7 rounded-full flex items-center justify-center text-xs font-black transition-colors",
        done ? "bg-emerald-500 text-white" : active ? "bg-primary text-white" : "bg-slate-200 text-slate-500"
      )}>
        {done ? <CheckCircle2 size={14} /> : number}
      </div>
      <span className={cn("text-xs font-bold hidden sm:block", active ? "text-primary" : done ? "text-emerald-600" : "text-muted-foreground")}>
        {label}
      </span>
    </div>
  )
}
