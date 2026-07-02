"use client"

import { useState, useRef, useCallback } from "react"
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
  addDoc,
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
} from "lucide-react"
import * as XLSX from "xlsx"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table"
import { ProcurementSidebar } from "@/components/contractor/ProcurementSidebar"

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
  description: string
  quantity: string
  unit: string
  unitPrice: string
  rfqId?: string
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
  const [boqParsing, setBoqParsing] = useState(false)
  const [boqSaving, setBoqSaving] = useState(false)
  const [boqLoaded, setBoqLoaded] = useState(false)

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

  // Load BOQ items from Firestore subcollection when switching to boq tab
  const loadBoqItems = useCallback(async () => {
    if (!firestore || !projectId || boqLoaded) return
    try {
      const snap = await getDocs(collection(firestore, "projects", projectId, "boqItems"))
      const items: BоqItem[] = snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          itemNo: data.itemNo || "",
          description: data.description || "",
          quantity: String(data.quantity ?? ""),
          unit: data.unit || "",
          unitPrice: String(data.unitPrice ?? ""),
          rfqId: data.rfqId || "",
        }
      })
      setBoqItems(items)
      setBoqLoaded(true)
    } catch (e) {
      console.error(e)
    }
  }, [firestore, projectId, boqLoaded])

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab)
    if (tab === "boq") loadBoqItems()
  }

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
    if (!firestore || !projectDocRef) return
    setIsDeleting(true)
    try {
      await deleteDoc(projectDocRef)
      toast({ title: t("proj_toast_deleted") })
      router.push("/contractor/projects")
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
      setIsDeleting(false)
    }
  }

  // BOQ file parsing
  const handleBoqFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBoqParsing(true)
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: "array" })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" })

        const parsed: BоqItem[] = []
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          if (!row || row.every((c) => !c)) continue
          parsed.push({
            id: `new_${i}`,
            itemNo: String(row[0] ?? i),
            description: String(row[1] ?? ""),
            quantity: String(row[2] ?? ""),
            unit: String(row[3] ?? ""),
            unitPrice: String(row[4] ?? ""),
            rfqId: "",
          })
        }
        setBoqItems(parsed)
        toast({ title: t("proj_boq_import_success", { count: parsed.length }) })
      } catch {
        toast({ title: t("proj_boq_parse_error"), variant: "destructive" })
      } finally {
        setBoqParsing(false)
        if (boqFileRef.current) boqFileRef.current.value = ""
      }
    }
    reader.readAsArrayBuffer(file)
  }

  // Save BOQ to Firestore
  const saveBoq = async () => {
    if (!firestore || !projectId) return
    setBoqSaving(true)
    try {
      const colRef = collection(firestore, "projects", projectId, "boqItems")
      const existing = await getDocs(colRef)
      const batch = writeBatch(firestore)
      existing.docs.forEach((d) => batch.delete(d.ref))
      boqItems.forEach((item) => {
        const newRef = doc(colRef)
        batch.set(newRef, {
          itemNo: item.itemNo,
          description: item.description,
          quantity: Number(item.quantity) || 0,
          unit: item.unit,
          unitPrice: Number(item.unitPrice) || 0,
          rfqId: item.rfqId || null,
          updatedAt: serverTimestamp(),
        })
      })
      await batch.commit()
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
      { id: `new_${Date.now()}`, itemNo: String(prev.length + 1), description: "", quantity: "", unit: "", unitPrice: "" },
    ])
  }

  // Update BOQ cell
  const updateBoqCell = (rowIndex: number, field: keyof BоqItem, value: string) => {
    setBoqItems((prev) => prev.map((item, i) => (i === rowIndex ? { ...item, [field]: value } : item)))
  }

  // Delete BOQ row
  const deleteBoqRow = (rowIndex: number) => {
    setBoqItems((prev) => prev.filter((_, i) => i !== rowIndex))
  }

  // Add material from procurement sidebar
  const handleAddMaterial = (material: { name: string; unit: string; refPrice: number }) => {
    setBoqItems((prev) => [
      ...prev,
      {
        id: `mat_${Date.now()}`,
        itemNo: String(prev.length + 1),
        description: material.name,
        quantity: "",
        unit: material.unit,
        unitPrice: String(material.refPrice),
      },
    ])
  }

  // TanStack table columns
  const boqColumns = [
    columnHelper.accessor("itemNo", {
      header: () => <span>{t("proj_boq_item_no")}</span>,
      cell: ({ row, getValue }) => (
        <Input
          value={getValue()}
          onChange={(e) => updateBoqCell(row.index, "itemNo", e.target.value)}
          className="h-8 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2"
        />
      ),
      size: 80,
    }),
    columnHelper.accessor("description", {
      header: () => <span>{t("proj_boq_description")}</span>,
      cell: ({ row, getValue }) => (
        <Input
          value={getValue()}
          onChange={(e) => updateBoqCell(row.index, "description", e.target.value)}
          className="h-8 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2"
        />
      ),
      size: 260,
    }),
    columnHelper.accessor("quantity", {
      header: () => <span>{t("proj_boq_qty")}</span>,
      cell: ({ row, getValue }) => (
        <Input
          value={getValue()}
          onChange={(e) => updateBoqCell(row.index, "quantity", e.target.value)}
          className="h-8 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2 text-center"
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
          className="h-8 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2 text-center"
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
          className="h-8 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2"
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
      cell: ({ row }) => (
        <button
          onClick={() => deleteBoqRow(row.index)}
          className="text-muted-foreground hover:text-destructive transition-colors px-2"
          aria-label={t("proj_boq_delete_row")}
        >
          <X size={14} />
        </button>
      ),
      size: 40,
    }),
  ]

  const boqTable = useReactTable({
    data: boqItems,
    columns: boqColumns,
    getCoreRowModel: getCoreRowModel(),
  })

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

        {/* Tab nav */}
        <div className="flex gap-1 border-b border-slate-200">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
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
                <div className="flex items-center gap-2">
                  <input
                    ref={boqFileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
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
                  <Button size="sm" onClick={saveBoq} disabled={boqSaving || boqItems.length === 0} className="gap-1.5">
                    {boqSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                    {t("proj_boq_save")}
                  </Button>
                </div>
              </div>

              {boqItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-16 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
                  <TableProperties size={40} className="text-muted-foreground/30" />
                  <div>
                    <p className="font-semibold text-slate-700">{t("proj_boq_empty")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("proj_boq_empty_desc")}</p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                      {boqTable.getRowModel().rows.map((row, i) => (
                        <tr
                          key={row.id}
                          className={cn(
                            "border-b border-slate-50 hover:bg-slate-50/50 transition-colors",
                            i % 2 === 0 ? "bg-white" : "bg-slate-50/30"
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
                      {locale === "ar" ? "ريال" : "SAR"}
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
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText size={20} className="text-primary" />
                {t("proj_rfqs")}
                {linkedRfqs && linkedRfqs.length > 0 && (
                  <Badge variant="secondary" className="ms-2">{linkedRfqs.length}</Badge>
                )}
              </CardTitle>
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
                      <Link key={r.id} href={`/contractor/rfqs/${r.id}/offers`}>
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
