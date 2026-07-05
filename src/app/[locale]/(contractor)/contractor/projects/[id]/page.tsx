"use client"

import { useState, useRef, useCallback, useMemo, useEffect } from "react"
import { useParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { useRouter, Link } from "@/i18n/routing"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useDoc, useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import {
  doc,
  collection,
  query,
  where,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
  writeBatch,
} from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import {
  Loader2,
  MapPin,
  DollarSign,
  Calendar,
  FileText,
  Pencil,
  Trash2,
  Save,
  X,
  FolderOpen,
  Upload,
  Plus,
  ExternalLink,
  TableProperties,
  Building2,
  Tag,
  Lock,
  Send,
  Lightbulb,
  Layers,
  Package,
  GripVertical,
  ChevronDown,
  ChevronRight,
  FolderInput,
} from "lucide-react"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type Row,
} from "@tanstack/react-table"
import { ProcurementSidebar } from "@/components/contractor/ProcurementSidebar"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { CATEGORIES_DATA, displayCategory } from "@/lib/constants"

function fmtDate(val: unknown, locale: string) {
  if (!val) return "–"
  const d =
    val && typeof val === "object" && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date(val as string | number)
  if (isNaN(d.getTime())) return "–"
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  if (status === "active")
    return <Badge className="bg-accent/10 text-accent border-accent/20 font-semibold">{t("proj_status_active")}</Badge>
  if (status === "paused")
    return <Badge className="bg-amber-100 text-amber-700 border-amber-200 font-semibold">{t("proj_status_paused")}</Badge>
  if (status === "completed")
    return <Badge className="bg-success/10 text-success border-success/20 font-semibold">{t("proj_status_completed")}</Badge>
  return <Badge variant="secondary">{status}</Badge>
}

type BоqItem = {
  id: string
  itemNo: string
  descriptionAr: string
  descriptionEn: string
  quantity: string
  unit: string
  unitPrice: string
  sheet?: string
  divisionNo?: string
  divisionNameEn?: string
  divisionNameAr?: string
  subCategoryCode?: string
  subCategoryNameEn?: string
  subCategoryNameAr?: string
  suggestedCategory?: string
  suggestedSubCategory?: string
  tenderId: string | null
  isEditable: boolean
  groupId: string | null
}

type BoqGroupMeta = {
  id: string
  titleAr: string
  categoryAr: string
}

const columnHelper = createColumnHelper<BоqItem>()

type ActiveTab = "info" | "boq" | "rfqs"

export default function ProjectDetailPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const boqFileRef = useRef<HTMLInputElement>(null)

  const [activeTab, setActiveTab] = useState<ActiveTab>("info")
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editLocation, setEditLocation] = useState("")
  const [editBudget, setEditBudget] = useState("")
  const [editStatus, setEditStatus] = useState<"active" | "paused" | "completed">("active")
  const [isSaving, setIsSaving] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // BOQ state
  const [boqItems, setBoqItems] = useState<BоqItem[]>([])
  const [boqGroups, setBoqGroups] = useState<BoqGroupMeta[]>([])
  const [boqParsing, setBoqParsing] = useState(false)
  const [boqSaving, setBoqSaving] = useState(false)
  const [boqLoaded, setBoqLoaded] = useState(false)
  const [dragItemId, setDragItemId] = useState<string | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | "unassigned" | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const toggleGroupCollapsed = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  const projectDocRef = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return doc(firestore, "projects", projectId)
  }, [firestore, projectId])

  const { data: project, isLoading: projectLoading } = useDoc(projectDocRef)

  const linkedRfqsQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return query(collection(firestore, "rfqs"), where("projectId", "==", projectId))
  }, [firestore, projectId])

  const { data: linkedRfqs, isLoading: rfqsLoading } = useCollection(linkedRfqsQuery)

  const typedProject = project as {
    name?: string
    description?: string
    location?: string
    region?: string
    budget?: number
    status?: string
    projectType?: string
    clientType?: string
    blueprintUrl?: string
    rfqIds?: string[]
    createdAt?: unknown
  } | null

  // Fetch BOQ items + sections from Firestore — always reflects server state.
  const fetchBoqItems = useCallback(async () => {
    if (!firestore || !projectId) return
    const [itemsSnap, groupsSnap] = await Promise.all([
      getDocs(collection(firestore, "projects", projectId, "boqItems")),
      getDocs(collection(firestore, "projects", projectId, "boqGroups")),
    ])
    const items: BоqItem[] = itemsSnap.docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        itemNo: data.itemNo || "",
        descriptionAr: data.descriptionAr || "",
        descriptionEn: data.descriptionEn || data.description || "",
        quantity: String(data.quantity ?? ""),
        unit: data.unit || "",
        unitPrice: String(data.unitPrice ?? ""),
        sheet: data.sheet || "",
        divisionNo: data.divisionNo || "",
        divisionNameEn: data.divisionNameEn || "",
        divisionNameAr: data.divisionNameAr || "",
        subCategoryCode: data.subCategoryCode || "",
        subCategoryNameEn: data.subCategoryNameEn || "",
        subCategoryNameAr: data.subCategoryNameAr || "",
        suggestedCategory: data.suggestedCategory || "",
        suggestedSubCategory: data.suggestedSubCategory || "",
        tenderId: data.tenderId ?? null,
        isEditable: data.isEditable !== false,
        groupId: data.groupId || null,
      }
    })
    const groups: BoqGroupMeta[] = groupsSnap.docs.map((d) => {
      const data = d.data()
      return { id: d.id, titleAr: data.titleAr || "", categoryAr: data.categoryAr || "" }
    })
    setBoqItems(items)
    setBoqGroups(groups)
  }, [firestore, projectId])

  // Load BOQ items when switching to the boq tab (only once per visit).
  const loadBoqItems = useCallback(async () => {
    if (boqLoaded) return
    try {
      await fetchBoqItems()
      setBoqLoaded(true)
    } catch (e) {
      console.error(e)
    }
  }, [boqLoaded, fetchBoqItems])

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab)
    if (tab === "boq") loadBoqItems()
  }

  // Load BOQ items eagerly (not just on tab switch) so the "next step" guidance banner
  // below can tell a fresh project apart from one that already has BOQ items, on any tab.
  useEffect(() => {
    loadBoqItems()
  }, [loadBoqItems])

  const startEdit = () => {
    if (!typedProject) return
    setEditName(typedProject.name || "")
    setEditDescription(typedProject.description || "")
    setEditLocation(typedProject.location || "")
    setEditBudget(typedProject.budget != null ? String(typedProject.budget) : "")
    setEditStatus((typedProject.status as "active" | "paused" | "completed") || "active")
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!firestore || !projectDocRef) return
    setIsSaving(true)
    try {
      await updateDoc(projectDocRef, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        location: editLocation.trim() || null,
        budget: editBudget ? Number(editBudget) : null,
        status: editStatus,
        updatedAt: serverTimestamp(),
      })
      toast({ title: t("proj_toast_updated") })
      setIsEditing(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!firestore || !projectDocRef || !projectId) return
    setIsDeleting(true)
    try {
      // Firestore doesn't cascade-delete subcollections — clean up boqItems/boqGroups first,
      // otherwise they're orphaned (unreachable, but still billed and counted) forever.
      const [itemsSnap, groupsSnap] = await Promise.all([
        getDocs(collection(firestore, "projects", projectId, "boqItems")),
        getDocs(collection(firestore, "projects", projectId, "boqGroups")),
      ])
      const subDocs = [...itemsSnap.docs, ...groupsSnap.docs]
      for (let i = 0; i < subDocs.length; i += 450) {
        const batch = writeBatch(firestore)
        subDocs.slice(i, i + 450).forEach((d) => batch.delete(d.ref))
        await batch.commit()
      }

      await deleteDoc(projectDocRef)
      toast({ title: t("proj_toast_deleted") })
      router.push("/contractor/projects")
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
      setIsDeleting(false)
    }
  }

  // BOQ file parsing — uses the shared, richer parser (Arabic/English split + category detection)
  const handleBoqFile = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        const parsed: BоqItem[] = result.items.map((item) => ({
          id: item.id,
          itemNo: item.itemNo,
          descriptionAr: item.descriptionAr,
          descriptionEn: item.descriptionEn,
          quantity: String(item.quantity ?? ""),
          unit: item.unit,
          unitPrice: item.rate ? String(item.rate) : "",
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
        }))
        setBoqItems(parsed)
        setBoqGroups(result.groups.map((g) => ({ id: g.id, titleAr: g.titleAr, categoryAr: g.categoryAr })))
        toast({ title: t("proj_boq_import_success", { count: parsed.length }) })
      } catch (err) {
        console.error(err)
        toast({ title: t("proj_boq_parse_error"), variant: "destructive" })
      } finally {
        setBoqParsing(false)
        if (boqFileRef.current) boqFileRef.current.value = ""
      }
    })()
  }

  // Save BOQ to Firestore. Locked (isEditable:false) rows are never touched by a bulk save —
  // they can only change via the dedicated unlock action, matching the Firestore hard-lock rule.
  const saveBoq = async () => {
    if (!firestore || !projectId) return
    setBoqSaving(true)
    try {
      const colRef = collection(firestore, "projects", projectId, "boqItems")
      const groupsColRef = collection(firestore, "projects", projectId, "boqGroups")
      const [existing, existingGroups] = await Promise.all([getDocs(colRef), getDocs(groupsColRef)])
      const existingIds = new Set(existing.docs.map((d) => d.id))
      const currentIds = new Set(boqItems.filter((i) => existingIds.has(i.id)).map((i) => i.id))
      const existingGroupIds = new Set(existingGroups.docs.map((d) => d.id))
      const currentGroupIds = new Set(boqGroups.map((g) => g.id))

      const batch = writeBatch(firestore)

      existing.docs.forEach((d) => {
        if (!currentIds.has(d.id) && d.data().isEditable !== false) {
          batch.delete(d.ref)
        }
      })

      existingGroups.docs.forEach((d) => {
        if (!currentGroupIds.has(d.id)) batch.delete(d.ref)
      })

      boqItems.forEach((item) => {
        if (item.isEditable === false) return
        const isNew = !existingIds.has(item.id)
        const ref = isNew ? doc(colRef) : doc(colRef, item.id)
        batch.set(ref, {
          itemNo: item.itemNo,
          descriptionAr: item.descriptionAr || "",
          descriptionEn: item.descriptionEn || "",
          quantity: Number(item.quantity) || 0,
          unit: item.unit,
          unitPrice: Number(item.unitPrice) || 0,
          sheet: item.sheet || "",
          divisionNo: item.divisionNo || "",
          divisionNameEn: item.divisionNameEn || "",
          divisionNameAr: item.divisionNameAr || "",
          subCategoryCode: item.subCategoryCode || "",
          subCategoryNameEn: item.subCategoryNameEn || "",
          subCategoryNameAr: item.subCategoryNameAr || "",
          suggestedCategory: item.suggestedCategory || "",
          suggestedSubCategory: item.suggestedSubCategory || "",
          tenderId: null,
          isEditable: true,
          groupId: item.groupId || null,
          updatedAt: serverTimestamp(),
        })
      })

      boqGroups.forEach((group) => {
        batch.set(doc(groupsColRef, group.id), {
          titleAr: group.titleAr,
          categoryAr: group.categoryAr,
          ...(existingGroupIds.has(group.id) ? {} : { createdAt: serverTimestamp() }),
          updatedAt: serverTimestamp(),
        }, { merge: true })
      })

      await batch.commit()
      await fetchBoqItems()
      toast({ title: t("proj_boq_saved") })
    } catch (err) {
      console.error(err)
      toast({ title: t("proj_boq_save_error"), variant: "destructive" })
    } finally {
      setBoqSaving(false)
    }
  }

  // Add empty BOQ row
  const addBoqRow = () => {
    setBoqItems((prev) => [
      ...prev,
      {
        id: `new_${Date.now()}`,
        itemNo: String(prev.length + 1),
        descriptionAr: "",
        descriptionEn: "",
        quantity: "",
        unit: "",
        unitPrice: "",
        sheet: "",
        tenderId: null,
        isEditable: true,
        groupId: null,
      },
    ])
  }

  // Update BOQ cell — locked rows never accept edits (also enforced server-side)
  // useCallback with empty deps keeps this reference stable across renders (only functional setState is used),
  // which lets boqColumns stay memoized — without it, table cells remount on every keystroke and lose focus.
  const updateBoqCell = useCallback((rowIndex: number, field: keyof BоqItem, value: string) => {
    setBoqItems((prev) =>
      prev.map((item, i) => (i === rowIndex && item.isEditable !== false ? { ...item, [field]: value } : item))
    )
  }, [])

  // Delete BOQ row — locked rows cannot be deleted (also enforced server-side)
  const deleteBoqRow = useCallback((rowIndex: number) => {
    setBoqItems((prev) => {
      const item = prev[rowIndex]
      if (item?.isEditable === false) return prev
      return prev.filter((_, i) => i !== rowIndex)
    })
  }, [])

  // Remove the tender lock from a single BOQ item (the one write transition the rules allow on a locked row)
  const unlockBoqItem = useCallback(async (itemId: string) => {
    if (!firestore || !projectId) return
    try {
      await updateDoc(doc(firestore, "projects", projectId, "boqItems", itemId), {
        isEditable: true,
        tenderId: null,
        updatedAt: serverTimestamp(),
      })
      await fetchBoqItems()
      toast({ title: t("proj_boq_unlocked") })
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
    }
  }, [firestore, projectId, fetchBoqItems, toast, t])

  // Add a new BOQ section — the id is a real Firestore auto-ID generated up front (no
  // server round-trip needed), so items can reference it immediately with no remap at save time.
  const addBoqGroup = () => {
    if (!firestore || !projectId) return
    const newId = doc(collection(firestore, "projects", projectId, "boqGroups")).id
    const firstCategory = Object.keys(CATEGORIES_DATA)[0] || ""
    // titleAr always holds Arabic text regardless of the UI's current locale — it's the canonical
    // section title shown to suppliers, same convention as categoryAr/CATEGORIES_DATA.
    setBoqGroups((prev) => [...prev, { id: newId, titleAr: "قسم جديد", categoryAr: firstCategory }])
  }

  const updateBoqGroup = (groupId: string, field: "titleAr" | "categoryAr", value: string) => {
    setBoqGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, [field]: value } : g)))
  }

  // Deleting a section un-assigns its items rather than deleting them.
  const deleteBoqGroup = (groupId: string) => {
    setBoqGroups((prev) => prev.filter((g) => g.id !== groupId))
    setBoqItems((prev) => prev.map((i) => (i.groupId === groupId ? { ...i, groupId: null } : i)))
  }

  // Move one item between sections (or to/from Unassigned). Locked items never move.
  const moveItemToGroup = useCallback((itemId: string, toGroupId: string | null) => {
    setBoqItems((prev) =>
      prev.map((i) => (i.id === itemId && i.isEditable !== false ? { ...i, groupId: toGroupId } : i))
    )
  }, [])

  const handleRowDragStart = useCallback((e: React.DragEvent, itemId: string) => {
    e.dataTransfer.effectAllowed = "move"
    setDragItemId(itemId)
  }, [])

  // Always clear the dragged-row state when a drag ends, even if dropped outside any section
  // (otherwise the row would stay dimmed at 40% opacity until the next drag).
  const handleRowDragEnd = useCallback(() => {
    setDragItemId(null)
    setDragOverGroupId(null)
  }, [])

  const handleSectionDragOver = (e: React.DragEvent, groupId: string | "unassigned") => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDragOverGroupId(groupId)
  }

  const handleSectionDrop = (e: React.DragEvent, groupId: string | "unassigned") => {
    e.preventDefault()
    setDragOverGroupId(null)
    if (dragItemId) moveItemToGroup(dragItemId, groupId === "unassigned" ? null : groupId)
    setDragItemId(null)
  }

  // Add material from procurement sidebar
  const handleAddMaterial = (material: { name: string; unit: string; refPrice: number }) => {
    setBoqItems((prev) => [
      ...prev,
      {
        id: `mat_${Date.now()}`,
        itemNo: String(prev.length + 1),
        descriptionAr: material.name,
        descriptionEn: "",
        quantity: "",
        unit: material.unit,
        unitPrice: String(material.refPrice),
        sheet: "",
        tenderId: null,
        isEditable: true,
        groupId: null,
      },
    ])
  }

  // TanStack table columns — memoized so cell renderers keep a stable identity across renders.
  // flexRender creates a fresh React element per render; if the cell function itself were a new
  // reference every render (as it was before this array was memoized), React treats it as a different
  // component type at that tree position and remounts it, which drops input focus after every keystroke.
  const boqColumns = useMemo(() => [
    columnHelper.display({
      id: "drag",
      header: () => null,
      cell: ({ row }) => {
        if (row.original.isEditable === false) {
          return <div className="w-5 h-8" />
        }
        return (
          // Pointer-only affordance — not focusable/keyboard-operable since native HTML5 drag has no
          // keyboard equivalent. Keyboard/screen-reader users reorganize via the "move to section" menu instead.
          <div
            draggable
            onDragStart={(e) => handleRowDragStart(e, row.original.id)}
            onDragEnd={handleRowDragEnd}
            aria-hidden="true"
            className="flex items-center justify-center h-8 w-5 text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing rounded"
          >
            <GripVertical size={14} />
          </div>
        )
      },
      size: 28,
    }),
    columnHelper.accessor("itemNo", {
      header: () => <span>{t("proj_boq_item_no")}</span>,
      cell: ({ row, getValue }) => (
        <Input
          value={getValue()}
          onChange={(e) => updateBoqCell(row.index, "itemNo", e.target.value)}
          disabled={row.original.isEditable === false}
          dir="ltr"
          className="h-8 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2 disabled:opacity-60"
        />
      ),
      size: 96,
    }),
    columnHelper.display({
      id: "description",
      header: () => <span>{t("proj_boq_description")}</span>,
      cell: ({ row }) => {
        const item = row.original
        const locked = item.isEditable === false
        return (
          <div className="flex flex-col gap-0.5 py-1">
            <Input
              value={item.descriptionAr}
              onChange={(e) => updateBoqCell(row.index, "descriptionAr", e.target.value)}
              disabled={locked}
              dir="rtl"
              placeholder={t("proj_boq_description_ar_placeholder")}
              className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2 disabled:opacity-60"
            />
            <Input
              value={item.descriptionEn}
              onChange={(e) => updateBoqCell(row.index, "descriptionEn", e.target.value)}
              disabled={locked}
              dir="ltr"
              placeholder={t("proj_boq_description_en_placeholder")}
              className="h-7 text-[11px] text-muted-foreground border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2 disabled:opacity-60"
            />
          </div>
        )
      },
      size: 280,
    }),
    columnHelper.accessor("quantity", {
      header: () => <span>{t("proj_boq_qty")}</span>,
      cell: ({ row, getValue }) => (
        <Input
          value={getValue()}
          onChange={(e) => updateBoqCell(row.index, "quantity", e.target.value)}
          disabled={row.original.isEditable === false}
          className="h-8 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2 text-center disabled:opacity-60"
          type="number"
          min={0}
        />
      ),
      size: 80,
    }),
    columnHelper.accessor("unit", {
      header: () => <span>{t("proj_boq_unit")}</span>,
      cell: ({ row, getValue }) => (
        <Input
          value={getValue()}
          onChange={(e) => updateBoqCell(row.index, "unit", e.target.value)}
          disabled={row.original.isEditable === false}
          className="h-8 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2 text-center disabled:opacity-60"
        />
      ),
      size: 80,
    }),
    columnHelper.accessor("unitPrice", {
      header: () => <span>{t("proj_boq_unit_price")}</span>,
      cell: ({ row, getValue }) => (
        <Input
          value={getValue()}
          onChange={(e) => updateBoqCell(row.index, "unitPrice", e.target.value)}
          disabled={row.original.isEditable === false}
          className="h-8 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2 disabled:opacity-60"
          type="number"
          min={0}
        />
      ),
      size: 120,
    }),
    columnHelper.display({
      id: "total",
      header: () => <span>{t("proj_boq_total")}</span>,
      cell: ({ row }) => {
        const qty = Number(row.original.quantity) || 0
        const price = Number(row.original.unitPrice) || 0
        const total = qty * price
        return (
          <span className="text-xs font-semibold text-slate-700 px-2">
            {total > 0 ? total.toLocaleString(locale === "ar" ? "ar-SA" : "en-US") : "–"}
          </span>
        )
      },
      size: 100,
    }),
    columnHelper.display({
      id: "actions",
      header: () => null,
      cell: ({ row }) => {
        const item = row.original
        if (item.isEditable === false) {
          return (
            <div className="flex items-center gap-1.5 px-2">
              <Badge variant="outline" className="text-[10px] gap-1 border-accent/30 text-accent whitespace-nowrap">
                <Lock size={10} />
                {t("proj_boq_locked")}
              </Badge>
              <button
                type="button"
                onClick={() => unlockBoqItem(item.id)}
                className="text-[10px] text-muted-foreground hover:text-primary underline whitespace-nowrap rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                {t("proj_boq_unlock")}
              </button>
            </div>
          )
        }
        return (
          <div className="flex items-center gap-0.5 px-1">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("proj_boq_move_to")}
                      className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    >
                      <FolderInput size={14} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t("proj_boq_move_to")}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                {boqGroups.map((group) => (
                  <DropdownMenuItem
                    key={group.id}
                    disabled={item.groupId === group.id}
                    onClick={() => moveItemToGroup(item.id, group.id)}
                  >
                    {group.titleAr || t("proj_boq_add_section")}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  disabled={!item.groupId}
                  onClick={() => moveItemToGroup(item.id, null)}
                >
                  {t("boq_unassigned")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={() => deleteBoqRow(row.index)}
              className="text-muted-foreground hover:text-destructive transition-colors h-7 w-7 rounded-lg flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              aria-label={t("proj_boq_delete_row")}
            >
              <X size={14} />
            </button>
          </div>
        )
      },
      size: 150,
    }),
  ], [t, locale, updateBoqCell, deleteBoqRow, unlockBoqItem, boqGroups, moveItemToGroup, handleRowDragStart, handleRowDragEnd])

  const boqTable = useReactTable({
    data: boqItems,
    columns: boqColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const allBoqRows = boqTable.getRowModel().rows
  const unassignedBoqRows = allBoqRows.filter((r) => !r.original.groupId)

  // Shared row/table renderer for both grouped sections and the Unassigned bucket —
  // reuses the single memoized boqTable's header/cell definitions, just scoped to a row subset.
  const renderBoqRows = (rows: Row<BоqItem>[]) => (
    <table className="w-full text-sm" style={{ minWidth: 640 }}>
      <thead>
        {boqTable.getHeaderGroups().map((hg) => (
          <tr key={hg.id} className="border-b border-slate-100 bg-slate-50">
            {hg.headers.map((header) => (
              <th
                key={header.id}
                className={cn(
                  "px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wide",
                  isRtl ? "text-right" : "text-left"
                )}
                style={{ width: header.column.columnDef.size }}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={row.id}
            className={cn(
              "border-b border-slate-50 hover:bg-slate-50/50 transition-colors",
              i % 2 === 0 ? "bg-white" : "bg-slate-50/30",
              row.original.isEditable === false && "cursor-not-allowed",
              dragItemId === row.original.id && "opacity-40"
            )}
          >
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id} className="px-1 py-1" style={{ width: cell.column.columnDef.size }}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )

  function getRfqStatusBadge(status: string) {
    if (status === "New")
      return <Badge className="bg-blue-50 text-blue-600 border-none text-xs">{t("rfq_status_active")}</Badge>
    if (status === "Draft")
      return <Badge className="bg-slate-100 text-slate-600 text-xs">{t("rfq_status_draft")}</Badge>
    if (status === "Awarded")
      return <Badge className="bg-success/10 text-success border-success/20 text-xs">{t("proj_rfq_status_awarded")}</Badge>
    return <Badge variant="secondary" className="text-xs">{status}</Badge>
  }

  if (projectLoading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center p-20">
          <Loader2 className="animate-spin text-muted-foreground" size={40} />
        </div>
      </PortalLayout>
    )
  }

  if (!typedProject) {
    return (
      <PortalLayout>
        <div className="text-center p-20 text-muted-foreground">
          <FolderOpen size={48} className="mx-auto mb-4 opacity-20" />
          <p>{t("proj_not_found")}</p>
        </div>
      </PortalLayout>
    )
  }

  const tabs: { key: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { key: "info", label: t("proj_tab_info"), icon: <FolderOpen size={15} /> },
    { key: "boq", label: t("proj_tab_boq"), icon: <TableProperties size={15} /> },
    { key: "rfqs", label: t("proj_tab_rfqs"), icon: <FileText size={15} /> },
  ]

  return (
    <PortalLayout>
      <div className="space-y-5 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-foreground font-headline leading-snug truncate">
              {typedProject.name}
            </h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {typedProject.status && <StatusBadge status={typedProject.status} t={t} />}
              {typedProject.projectType && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Tag size={11} />
                  {t(typedProject.projectType as Parameters<typeof t>[0])}
                </Badge>
              )}
              {typedProject.clientType && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Building2 size={11} />
                  {t(typedProject.clientType as Parameters<typeof t>[0])}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={startEdit} className="gap-1">
              <Pencil size={14} />
              {t("proj_edit")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              className="gap-1 text-destructive border-destructive/30 hover:bg-destructive hover:text-white hover:border-destructive"
            >
              <Trash2 size={14} />
              {t("proj_delete")}
            </Button>
          </div>
        </div>

        {/* Guided next step: shown until the project has BOQ items or a linked tender */}
        {boqLoaded && boqItems.length === 0 && (!linkedRfqs || linkedRfqs.length === 0) && (
          <div className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 bg-accent/5 border border-accent/20 rounded-xl">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                <Lightbulb size={18} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">{t("proj_next_step_title")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("proj_next_step_desc")}</p>
              </div>
            </div>
            <Button size="sm" className="gap-1.5 shrink-0 w-full sm:w-auto" onClick={() => handleTabChange("boq")}>
              <TableProperties size={14} />
              {t("proj_next_step_cta")}
            </Button>
          </div>
        )}

        {/* Tab nav */}
        <div className="flex gap-1 border-b border-slate-200">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabChange(tab.key)}
              aria-current={activeTab === tab.key ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors rounded-t-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                activeTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── TAB: INFO ── */}
        {activeTab === "info" && (
          <Card className="border-slate-200/60">
            <CardContent className="p-6" dir={isRtl ? "rtl" : "ltr"}>
              {isEditing ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="font-semibold">{t("proj_name")}</Label>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-10 rounded-xl" disabled={isSaving} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-semibold">{t("proj_description")}</Label>
                    <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} className="rounded-xl resize-none" disabled={isSaving} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="font-semibold">{t("proj_location")}</Label>
                      <Input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} className="h-10 rounded-xl" disabled={isSaving} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="font-semibold">{t("proj_budget")}</Label>
                      <Input type="number" min={0} value={editBudget} onChange={(e) => setEditBudget(e.target.value)} className="h-10 rounded-xl" disabled={isSaving} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-semibold">{t("proj_status")}</Label>
                    <Select value={editStatus} onValueChange={(v) => setEditStatus(v as typeof editStatus)} disabled={isSaving}>
                      <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">{t("proj_status_active")}</SelectItem>
                        <SelectItem value="paused">{t("proj_status_paused")}</SelectItem>
                        <SelectItem value="completed">{t("proj_status_completed")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} disabled={isSaving} className="gap-1">
                      <X size={14} />{t("cancel")}
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1">
                      {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                      {t("proj_update")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {typedProject.description && (
                    <div className="sm:col-span-2 text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
                      {typedProject.description}
                    </div>
                  )}
                  {typedProject.region && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <MapPin size={16} className="text-accent shrink-0" />
                      <span>
                        <span className="font-semibold text-slate-500 text-xs block">{t("proj_region")}</span>
                        {typedProject.region}
                      </span>
                    </div>
                  )}
                  {typedProject.location && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <MapPin size={16} className="text-accent shrink-0" />
                      <span>
                        <span className="font-semibold text-slate-500 text-xs block">{t("proj_location_label")}</span>
                        {typedProject.location}
                      </span>
                    </div>
                  )}
                  {typedProject.budget != null && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <DollarSign size={16} className="text-success shrink-0" />
                      <span>
                        <span className="font-semibold text-slate-500 text-xs block">{t("proj_budget_label")}</span>
                        {typedProject.budget.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Calendar size={16} className="text-primary shrink-0" />
                    <span>
                      <span className="font-semibold text-slate-500 text-xs block">{t("proj_created_at")}</span>
                      {fmtDate(typedProject.createdAt, locale)}
                    </span>
                  </div>
                  {typedProject.blueprintUrl && (
                    <div className="sm:col-span-2">
                      <a
                        href={typedProject.blueprintUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-primary font-medium hover:underline"
                      >
                        <FileText size={15} />
                        {t("proj_blueprint_view")}
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── TAB: BOQ ── */}
        {activeTab === "boq" && (
          <div className="flex gap-4">
            {/* Main BOQ area */}
            <div className="flex-1 min-w-0 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    {t("proj_boq_items_count", { count: boqItems.length })}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    ref={boqFileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleBoqFile}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => boqFileRef.current?.click()}
                    disabled={boqParsing}
                    className="gap-1.5"
                  >
                    {boqParsing ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
                    {boqParsing ? t("proj_boq_parsing") : t("proj_boq_upload")}
                    {!boqParsing && <span className="text-muted-foreground text-xs">({t("proj_boq_upload_hint")})</span>}
                  </Button>
                  <Button variant="outline" size="sm" onClick={addBoqRow} className="gap-1.5">
                    <Plus size={14} />
                    {t("proj_boq_add_row")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={addBoqGroup} className="gap-1.5">
                    <Layers size={14} />
                    {t("proj_boq_add_section")}
                  </Button>
                  <Button size="sm" onClick={saveBoq} disabled={boqSaving || (boqItems.length === 0 && boqGroups.length === 0)} className="gap-1.5">
                    {boqSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                    {t("proj_boq_save")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/contractor/projects/${projectId}/tenders/from-boq`)}
                    disabled={boqItems.filter((i) => i.isEditable !== false).length === 0}
                    className="gap-1.5 border-accent/30 text-accent hover:bg-accent/5"
                  >
                    <Send size={14} />
                    {t("proj_boq_push_to_tender")}
                  </Button>
                </div>
              </div>

              {boqItems.length === 0 && boqGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-16 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
                  <TableProperties size={40} className="text-muted-foreground/30" />
                  <div>
                    <p className="font-semibold text-slate-700">{t("proj_boq_empty")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("proj_boq_empty_desc")}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {boqGroups.map((group) => {
                    const groupRows = allBoqRows.filter((r) => r.original.groupId === group.id)
                    const isCollapsed = collapsedGroups.has(group.id)
                    const isDragOver = dragOverGroupId === group.id
                    return (
                      <div
                        key={group.id}
                        className={cn(
                          "rounded-xl border bg-white overflow-hidden transition-all",
                          isDragOver ? "border-primary ring-2 ring-primary/20" : "border-slate-200"
                        )}
                        onDragOver={(e) => handleSectionDragOver(e, group.id)}
                        onDrop={(e) => handleSectionDrop(e, group.id)}
                        onDragLeave={() => setDragOverGroupId(null)}
                      >
                        <div className="flex items-center gap-1.5 p-2.5 bg-slate-50 border-b border-slate-200 flex-wrap">
                          <button
                            type="button"
                            onClick={() => toggleGroupCollapsed(group.id)}
                            aria-label={isCollapsed ? t("proj_boq_expand_section") : t("proj_boq_collapse_section")}
                            aria-expanded={!isCollapsed}
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-primary hover:bg-primary/10 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                          >
                            {isCollapsed ? <ChevronRight size={15} className="rtl-flip" /> : <ChevronDown size={15} />}
                          </button>
                          <Layers size={14} className="text-primary shrink-0" />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Input
                                value={group.titleAr}
                                onChange={(e) => updateBoqGroup(group.id, "titleAr", e.target.value)}
                                className="h-8 text-sm font-bold flex-1 min-w-[140px] rounded-lg bg-white truncate"
                                dir="rtl"
                              />
                            </TooltipTrigger>
                            {group.titleAr && group.titleAr.length > 40 && (
                              <TooltipContent className="max-w-xs" side="bottom">{group.titleAr}</TooltipContent>
                            )}
                          </Tooltip>
                          <div className="w-44 shrink-0">
                            <SearchableSelect
                              size="sm"
                              value={group.categoryAr}
                              onChange={(v) => updateBoqGroup(group.id, "categoryAr", v)}
                              options={Object.keys(CATEGORIES_DATA).map((cat) => ({ value: cat, label: displayCategory(cat, locale) }))}
                              placeholder={t("newrfq_select_category")}
                              searchPlaceholder={t("newrfq_search_category")}
                              noResultsText={t("newrfq_no_results")}
                            />
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {t("proj_boq_items_count", { count: groupRows.length })}
                          </Badge>
                          <button
                            type="button"
                            onClick={() => deleteBoqGroup(group.id)}
                            aria-label={t("proj_boq_delete_section")}
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        {!isCollapsed && (
                          groupRows.length === 0 ? (
                            <div className="p-6 text-center text-xs text-muted-foreground">{t("proj_boq_section_empty_hint")}</div>
                          ) : (
                            <div className="overflow-x-auto">{renderBoqRows(groupRows)}</div>
                          )
                        )}
                      </div>
                    )
                  })}

                  {/* Unassigned — always shown as a drop target */}
                  <div
                    className={cn(
                      "rounded-xl border bg-white overflow-hidden transition-all",
                      dragOverGroupId === "unassigned" ? "border-primary ring-2 ring-primary/20" : "border-dashed border-slate-300"
                    )}
                    onDragOver={(e) => handleSectionDragOver(e, "unassigned")}
                    onDrop={(e) => handleSectionDrop(e, "unassigned")}
                    onDragLeave={() => setDragOverGroupId(null)}
                  >
                    <div className="flex items-center gap-2 p-2.5 bg-slate-50/60 border-b border-slate-200">
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapsed("unassigned")}
                        aria-label={collapsedGroups.has("unassigned") ? t("proj_boq_expand_section") : t("proj_boq_collapse_section")}
                        aria-expanded={!collapsedGroups.has("unassigned")}
                        className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-primary hover:bg-primary/10 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      >
                        {collapsedGroups.has("unassigned") ? <ChevronRight size={15} className="rtl-flip" /> : <ChevronDown size={15} />}
                      </button>
                      <Package size={14} className="text-muted-foreground shrink-0" />
                      <span className="text-sm font-bold text-muted-foreground">{t("boq_unassigned")}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {t("proj_boq_items_count", { count: unassignedBoqRows.length })}
                      </Badge>
                    </div>
                    {!collapsedGroups.has("unassigned") && (
                      unassignedBoqRows.length === 0 ? (
                        <div className="p-6 text-center text-xs text-muted-foreground">{t("proj_boq_section_empty_hint")}</div>
                      ) : (
                        <div className="overflow-x-auto">{renderBoqRows(unassignedBoqRows)}</div>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* BOQ total summary */}
              {boqItems.length > 0 && (
                <div className={cn("flex justify-end pt-2", isRtl ? "justify-start" : "")}>
                  <div className="bg-primary/5 border border-primary/10 rounded-xl px-5 py-3 text-sm">
                    <span className="text-muted-foreground">{t("proj_boq_total")}: </span>
                    <span className="font-black text-primary text-base">
                      {boqItems
                        .reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0)
                        .toLocaleString(locale === "ar" ? "ar-SA" : "en-US")}{" "}
                      {t("offers_currency_sar")}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Procurement sidebar */}
            <ProcurementSidebar onAddMaterial={handleAddMaterial} />
          </div>
        )}

        {/* ── TAB: RFQS ── */}
        {activeTab === "rfqs" && (
          <Card className="border-slate-200/60">
            <CardHeader className="border-b pb-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText size={20} className="text-primary" />
                  {t("proj_rfqs")}
                  {linkedRfqs && linkedRfqs.length > 0 && (
                    <Badge variant="secondary" className="ms-2">{linkedRfqs.length}</Badge>
                  )}
                </CardTitle>
                <Button size="sm" className="gap-1.5" onClick={() => router.push(`/contractor/projects/${projectId}/tenders/new`)}>
                  <Plus size={14} />
                  {t("proj_new_tender")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {rfqsLoading ? (
                <div className="flex items-center justify-center p-10">
                  <Loader2 className="animate-spin text-muted-foreground" size={24} />
                </div>
              ) : !linkedRfqs || linkedRfqs.length === 0 ? (
                <div className="text-center p-10 bg-slate-50 rounded-lg border border-dashed text-muted-foreground">
                  <FileText size={36} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm">{t("proj_rfqs_empty")}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {(linkedRfqs as unknown[]).map((rfq) => {
                    const r = rfq as { id: string; title?: string; category?: string; status?: string; offersCount?: number; deadline?: string }
                    return (
                      <Link key={r.id} href={`/contractor/projects/${projectId}/tenders/${r.id}/offers`}>
                        <div className="flex items-center justify-between gap-3 p-4 bg-white border border-slate-100 rounded-xl hover:border-primary/30 hover:bg-primary/5 transition-all group">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-800 truncate group-hover:text-primary">{r.title || r.id}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{r.category}</p>
                          </div>
                          <div className={cn("flex items-center gap-2 shrink-0", isRtl ? "flex-row-reverse" : "")}>
                            {r.status && getRfqStatusBadge(r.status)}
                            <span className="text-xs text-slate-500">{r.offersCount || 0} {t("proj_offers_count_label")}</span>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Delete dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={(open) => !open && setShowDeleteDialog(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("proj_delete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("proj_delete_confirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
              {isDeleting ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
              {t("proj_delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  )
}
