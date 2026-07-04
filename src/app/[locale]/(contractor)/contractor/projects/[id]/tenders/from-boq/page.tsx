"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
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
  Loader2,
  CheckCircle2,
  AlertCircle,
  Building2,
  Calendar,
  MapPin,
  Layers,
  GripVertical,
  Plus,
  Package,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, addDoc, updateDoc, getDocs, query, where, writeBatch, serverTimestamp, arrayUnion } from "firebase/firestore"
import { SAUDI_CITIES, displayCity, displayDistrict } from "@/lib/constants"
import { CATEGORIES_DATA } from "@/lib/constants"
import type { BoqItem } from "@/lib/boq-parser"
import {
  moveItemBetweenGroups,
  removeItemToUnassigned,
  splitItemToNewGroup as splitItemUtil,
  getGroupsToCreate,
  totalGroupItems,
} from "@/utils/boq-groups"
import type { BoqGroup } from "@/utils/boq-groups"
import { BoqGroupCard, ItemRow } from "@/components/contractor/BoqGroupCard"

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

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export default function PushBoqToTenderPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const router = useRouter()
  const { toast } = useToast()
  const isRtl = locale === "ar"

  const params = useParams()
  const projectId = params.id as string

  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  const projectDocRef = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return doc(firestore, "projects", projectId)
  }, [firestore, projectId])
  const { data: project } = useDoc(projectDocRef)

  const [isLoadingItems, setIsLoadingItems] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [groups, setGroups] = useState<BoqGroup[]>([])
  const [unassigned, setUnassigned] = useState<BoqItem[]>([])

  const [city, setCity] = useState("")
  const [district, setDistrict] = useState("")
  const [deadline, setDeadline] = useState("")

  const [dragPayload, setDragPayload] = useState<{ item: BoqItem; fromGroupId: string | "unassigned" } | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | "unassigned" | null>(null)

  // Load unlocked BOQ items + the sections the contractor already built on the project's BOQ tab.
  // Groups are seeded from what's actually persisted there, not re-derived from Excel sheet names.
  useEffect(() => {
    if (!firestore || !projectId) return
    ;(async () => {
      setIsLoadingItems(true)
      try {
        const [itemsSnap, groupsSnap] = await Promise.all([
          getDocs(query(collection(firestore, "projects", projectId, "boqItems"), where("tenderId", "==", null))),
          getDocs(collection(firestore, "projects", projectId, "boqGroups")),
        ])

        const itemGroupIds = new Map<string, string | null>()
        const items: BoqItem[] = itemsSnap.docs.map((d) => {
          const data = d.data()
          itemGroupIds.set(d.id, data.groupId || null)
          return {
            id: d.id,
            itemNo: data.itemNo || "",
            descriptionEn: data.descriptionEn || "",
            descriptionAr: data.descriptionAr || "",
            unit: data.unit || "",
            quantity: Number(data.quantity) || 0,
            sheet: data.sheet || (data.suggestedCategory || ""),
            divisionNo: data.divisionNo || "",
            divisionNameEn: data.divisionNameEn || "",
            divisionNameAr: data.divisionNameAr || "",
            suggestedCategory: data.suggestedCategory || "",
            suggestedSubCategory: data.suggestedSubCategory || "",
            selected: true,
          }
        })

        const seededGroups: BoqGroup[] = groupsSnap.docs.map((d) => {
          const data = d.data()
          return { id: d.id, titleAr: data.titleAr || "", categoryAr: data.categoryAr || "", items: [] }
        })
        const groupById = new Map(seededGroups.map((g) => [g.id, g]))
        const seededUnassigned: BoqItem[] = []

        for (const item of items) {
          const groupId = itemGroupIds.get(item.id)
          const group = groupId ? groupById.get(groupId) : undefined
          if (group) group.items.push(item)
          else seededUnassigned.push(item)
        }

        setGroups(seededGroups)
        setUnassigned(seededUnassigned)
      } catch (err) {
        console.error(err)
        toast({ title: t("proj_boq_parse_error"), variant: "destructive" })
      } finally {
        setIsLoadingItems(false)
      }
    })()
  }, [firestore, projectId, t, toast])

  // ── Group mutations ───────────────────────────────────────────────────────
  const updateGroupTitle = (groupId: string, titleAr: string) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, titleAr } : g))
  }

  const updateGroupCategory = (groupId: string, categoryAr: string) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, categoryAr } : g))
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

  const splitItemToNewGroup = (item: BoqItem, fromGroupId: string) => {
    setGroups(prev => splitItemUtil(prev, item, fromGroupId))
  }

  const removeItemFromGroup = (item: BoqItem, fromGroupId: string) => {
    setGroups(prev => {
      const { groups: updated, removed } = removeItemToUnassigned(prev, item, fromGroupId)
      setUnassigned(u => [...u, removed])
      return updated
    })
  }

  const moveItemToGroup = (item: BoqItem, fromGroupId: string | "unassigned", toGroupId: string | "unassigned") => {
    const { groups: newGroups, unassigned: newUnassigned } = moveItemBetweenGroups(groups, unassigned, item, fromGroupId, toGroupId)
    setGroups(newGroups)
    setUnassigned(newUnassigned)
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

  // ── Push groups to tenders ────────────────────────────────────────────────
  const handleCreateTenders = async () => {
    if (!firestore || !user || !profile || !projectId) return
    const groupsToCreate = getGroupsToCreate(groups)
    if (groupsToCreate.length === 0) {
      toast({ title: t("boq_select_at_least_one"), variant: "destructive" })
      return
    }
    if (!city || !deadline) {
      toast({ title: t("boq_settings_note"), variant: "destructive" })
      return
    }

    setIsCreating(true)
    try {
      const rfqsRef = collection(firestore, "rfqs")
      const projectName = (project as { name?: string } | null)?.name || ""
      let created = 0

      for (const group of groupsToCreate) {
        const rfqData = {
          contractorId: user.uid,
          organizationId: profile.organizationId || user.uid,
          projectId,
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
            category: item.suggestedCategory || group.categoryAr,
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
          boqProjectName: projectName,
          createdByUserId: user.uid,
          createdByUserName: profile.name || user.email || "عضو الفريق",
          createdAt: new Date().toISOString(),
        }
        const newRfqRef = await addDoc(rfqsRef, rfqData)
        created++

        // Keep the project's rfqIds list in sync so the projects list card's tender count stays accurate
        await updateDoc(doc(firestore, "projects", projectId), { rfqIds: arrayUnion(newRfqRef.id) })

        // Lock the source BOQ items and link them to the tender that was just created
        const batch = writeBatch(firestore)
        group.items.forEach((item) => {
          batch.update(doc(firestore, "projects", projectId, "boqItems", item.id), {
            tenderId: newRfqRef.id,
            isEditable: false,
            updatedAt: serverTimestamp(),
          })
        })
        await batch.commit()
      }

      toast({
        title: t("boq_success_title"),
        description: t("boq_success_desc", { count: created }),
      })
      router.push(`/contractor/projects/${projectId}/tenders`)
    } catch (err) {
      console.error("Push to tender error:", err)
      toast({ title: t("boq_create_error"), variant: "destructive" })
    } finally {
      setIsCreating(false)
    }
  }

  const totalActiveItems = totalGroupItems(groups)
  const groupsToCreate = getGroupsToCreate(groups)
  const minDeadline = new Date(); minDeadline.setDate(minDeadline.getDate() + 1)
  const minDeadlineStr = minDeadline.toISOString().split("T")[0]

  if (isLoadingItems) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center p-20">
          <Loader2 className="animate-spin text-muted-foreground" size={40} />
        </div>
      </PortalLayout>
    )
  }

  if (totalActiveItems === 0 && unassigned.length === 0) {
    return (
      <PortalLayout>
        <div className="text-center p-20 text-muted-foreground">
          <Package size={48} className="mx-auto mb-4 opacity-20" />
          <p>{t("boq_no_unlocked_items")}</p>
        </div>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout>
      <div className={cn("space-y-6", isRtl ? "text-right" : "text-left")} dir={isRtl ? "rtl" : "ltr"}>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Layers size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-foreground">{t("boq_push_title")}</h1>
            <p className="text-sm text-muted-foreground">{t("boq_push_desc")}</p>
          </div>
        </div>

        {/* Common settings */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Layers size={16} className="text-primary" />
              {t("boq_common_settings")}
            </CardTitle>
            <CardDescription className="text-xs">{t("boq_common_settings_desc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          </CardContent>
        </Card>

        {/* Review header */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div>
            <p className="font-bold text-foreground text-sm">{t("boq_review_title")}</p>
            <p className="text-xs text-muted-foreground">
              {isRtl
                ? `${groupsToCreate.length} مناقصات ستُنشأ من ${totalActiveItems} بند`
                : `${groupsToCreate.length} tenders from ${totalActiveItems} items`}
            </p>
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
              disabled={groupsToCreate.length === 0 || isCreating || !city || !deadline}
              onClick={handleCreateTenders}
            >
              {isCreating ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {isCreating
                ? t("boq_creating")
                : isRtl
                  ? `دفع ${groupsToCreate.length} إلى مناقصات`
                  : `Push ${groupsToCreate.length} to Tenders`}
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
              existingItemNos={new Map()}
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

          {groups.some(g => g.items.length === 0) && (
            <div className="flex items-center gap-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2">
              <AlertCircle size={13} className="shrink-0" />
              <span>{t("boq_group_empty_warn")}</span>
            </div>
          )}

          {unassigned.length > 0 && (
            <Card className={cn(
              "border-dashed border-2 transition-colors",
              dragOverGroupId === "unassigned" ? "border-primary bg-primary/5" : "border-border"
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
                {unassigned.map(item => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onDragStart={e => onItemDragStart(e, item, "unassigned")}
                    actions={null}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </PortalLayout>
  )
}
