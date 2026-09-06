"use client"

import { useState, useRef, useCallback, useMemo, useEffect, memo } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { useRouter, Link } from "@/i18n/routing"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { PROJECT_STATUSES, PROJECT_STATUS_BADGE_CLASSES, projectStatusLabelKey, resolveProjectStatus, type ProjectStatus } from "@/lib/project-status"
import { ProjectHandoverBanner } from "@/components/contractor/ProjectHandoverBanner"
import type { ProjectHandover } from "@/lib/crm"
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"
import { ColumnCustomizer } from "@/components/shared/ColumnCustomizer"
import { useTableColumns, type TableColumnDef } from "@/hooks/useTableColumns"
import { useDoc, useCollection, useCollectionPaginated, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import {
  doc,
  collection,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
  writeBatch,
  arrayRemove,
  arrayUnion,
  increment,
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
  Globe,
  Send,
  Lightbulb,
  Layers,
  Package,
  GripVertical,
  ChevronDown,
  CheckSquare,
  Square,
  ChevronRight,
  FolderInput,
  Eye,
  Scissors,
  LayoutGrid,
  List,
  Users,
  ShieldCheck,
  Warehouse,
  Search,
  RotateCw,
  File,
  MessageCircle,
} from "lucide-react"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type Row,
} from "@tanstack/react-table"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { CATEGORIES_DATA, PREDEFINED_CATEGORIES, displayCategory, SAUDI_CITIES, CITIES_DISTRICTS, displayCity, displayDistrict } from "@/lib/constants"
import { getIncompletePublishFields } from "@/utils/publish-gate"
import { ProjectTeamSection } from "@/components/project-team"
import { usePermissions } from "@/hooks/usePermissions"
import { SectionToggleGrid } from "@/components/contractor/SectionToggleGrid"
import { ComingSoonTab } from "@/components/contractor/ComingSoonTab"
import { IpcClaimsTab } from "@/components/contractor/IpcClaimsTab"
import { PurchaseRequestsTab } from "@/components/contractor/PurchaseRequestsTab"
import { FinanceAuditLog } from "@/components/contractor/FinanceAuditLog"
import { MoneyFlowViz } from "@/components/contractor/MoneyFlowViz"
import { WarehouseInventoryPanel } from "@/components/contractor/WarehouseInventoryPanel"
import { recordWasteConsumption } from "@/lib/waste-writes"
import { notifyFavoriteSuppliersOfPublish } from "@/lib/notify-favorites"
import { applyDraw, boqRemaining, releaseAllDraws, releaseBoqDrawsForRfq, type BoqDraw } from "@/lib/boq-draws"
import { WasteRecordDialog } from "@/components/inventory/WasteRecordDialog"
import { WasteLedger } from "@/components/contractor/WasteLedger"
import { SupplierRecipientsPicker, useSupplierRecipientOptions } from "@/components/contractor/SupplierRecipientsPicker"
import { useCentralWarehouse, resolveCentralForRegion } from "@/hooks/useCentralWarehouse"
import { suggestBoqMaterials } from "@/ai/flows/suggest-boq-materials-flow"
import {
  SECTION_IDS,
  SECTION_REGISTRY,
  LEGACY_DEFAULT_SECTIONS,
  cascadeEnable,
  cascadeDisable,
  sectionLabelKey,
  type SectionId,
} from "@/lib/project-sections"
import { Settings2, Sparkles, Receipt, ClipboardList, User, Banknote, Ruler, Factory } from "lucide-react"
import { ManufacturingView } from "@/components/manufacturing/ManufacturingView"

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
  const resolved = resolveProjectStatus(status)
  return (
    <Badge className={cn(PROJECT_STATUS_BADGE_CLASSES[resolved], "font-semibold")}>
      {t(projectStatusLabelKey(resolved))}
    </Badge>
  )
}

type BoqItem = {
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
  requiresWarranty?: boolean
  unitBarcodes?: string[] | null
  /** Sum of every active draw — what has already gone out to RFQs. */
  drawnQuantity?: number
  /** One entry per RFQ that drew from this line (see lib/boq-draws). */
  draws?: BoqDraw[]
  /** Running total of site measurements (see lib/ipc.ts). */
  executedQuantity?: number
}

type BoqGroupMeta = {
  id: string
  titleAr: string
  categoryAr: string
}

const columnHelper = createColumnHelper<BoqItem>()

// One BOQ table row, memoized so a single state commit (a drop, a keystroke in one cell, a row
// add/delete) re-renders ONLY the rows whose data actually changed instead of every input in
// every section — that full re-render was the visible pause between releasing a dragged row and
// seeing it land. moveItemToGroup/updateBoqCell keep untouched items' object identity stable, so
// comparing row.original by reference is sufficient; `columns` identity covers everything the
// cell renderers close over (translations, selection set, groups list…).
const BoqTableRow = memo(
  function BoqTableRow({
    row,
    zebra,
    isLastAdded,
    rowRefs,
  }: {
    row: Row<BoqItem>
    columns: readonly unknown[]
    zebra: boolean
    isLastAdded: boolean
    rowRefs: React.MutableRefObject<Record<string, HTMLTableRowElement | null>>
  }) {
    return (
      <tr
        ref={(el) => {
          rowRefs.current[row.original.id] = el
        }}
        className={cn(
          "border-b border-slate-50 hover:bg-slate-50/50 transition-colors",
          zebra ? "bg-white" : "bg-slate-50/30",
          row.original.isEditable === false && "cursor-not-allowed",
          isLastAdded && "ring-2 ring-primary/40"
        )}
      >
        {row.getVisibleCells().map((cell) => (
          <td key={cell.id} className="px-1 py-1" style={{ width: cell.column.columnDef.size }}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>
    )
  },
  (prev, next) =>
    prev.row.original === next.row.original &&
    prev.row.index === next.row.index &&
    prev.zebra === next.zebra &&
    prev.isLastAdded === next.isLastAdded &&
    prev.columns === next.columns
)

type ActiveTab = string

export default function ProjectDetailPage() {
  const t = useTranslations("Portal.Contractor")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const projectId = params.id as string
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  // Deletion unsubscribes project-scoped listeners immediately (rather than waiting
  // for the post-delete navigation to unmount them) so they don't race the just-deleted
  // parent doc and surface a spurious permission-denied on the way out.
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCreatingWarehouse, setIsCreatingWarehouse] = useState(false)
  const { can } = usePermissions(isDeleting ? undefined : projectId)
  const boqFileRef = useRef<HTMLInputElement>(null)

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => searchParams.get("tab") || "info")
  const [showManageSections, setShowManageSections] = useState(false)
  const [pendingSections, setPendingSections] = useState<Set<SectionId>>(new Set())
  const [isSavingSections, setIsSavingSections] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const [editClientName, setEditClientName] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editLocation, setEditLocation] = useState("")
  const [editBudget, setEditBudget] = useState("")
  const [editWasteTarget, setEditWasteTarget] = useState("")
  const [editStatus, setEditStatus] = useState<ProjectStatus>("todo")
  const [editWarehouseId, setEditWarehouseId] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [isConsumeDialogOpen, setIsConsumeDialogOpen] = useState(false)
  const [isSuggestMaterialsOpen, setIsSuggestMaterialsOpen] = useState(false)
  const [suggestedTakenQtys, setSuggestedTakenQtys] = useState<Record<string, string>>({})
  const [suggestedBoqLinks, setSuggestedBoqLinks] = useState<Record<string, string>>({})
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  // BOQ state
  const [boqItems, setBoqItems] = useState<BoqItem[]>([])
  const [boqGroups, setBoqGroups] = useState<BoqGroupMeta[]>([])
  const [boqParsing, setBoqParsing] = useState(false)
  const [boqSaving, setBoqSaving] = useState(false)
  const [boqLoaded, setBoqLoaded] = useState(false)
  // Row drag-and-drop is a CUSTOM POINTER-EVENTS implementation — NOT native HTML5 DnD. Native
  // drag sessions proved unreliable here (Chromium/Edge would fail to deliver drop/dragend,
  // leaving a stuck "grabbing" cursor and an unresponsive page). With pointer events we own the
  // whole gesture: ghost, hover highlight, drop and cleanup all run on plain mouse/touch events,
  // via refs + classList toggles only (.boq-drag-source / .boq-dropzone-* in globals.css), so a
  // drag never re-renders this large page. React state changes exactly once, on a real drop.
  // This ref holds the active gesture's cleanup so an unmount mid-drag can tear everything down.
  const boqDragCleanupRef = useRef<(() => void) | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [lastAddedItemId, setLastAddedItemId] = useState<string | null>(null)
  const boqRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  // Publish selection — opt-out model: an item is included unless its id is in this set, so
  // newly added/imported rows are automatically selected without any extra bookkeeping.
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set())
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false)
  const [publishShipmentMode, setPublishShipmentMode] = useState<"single" | "multiple">("single")
  const [publishCity, setPublishCity] = useState("")
  const [publishDistrict, setPublishDistrict] = useState("")
  const [publishDeadline, setPublishDeadline] = useState("")
  // Quantity to draw per item for THIS request, keyed by item id. Absent means
  // "everything that is left" — the common case, so nobody types anything.
  const [publishQtys, setPublishQtys] = useState<Record<string, string>>({})
  const [isPublishing, setIsPublishing] = useState(false)

  useEffect(() => {
    if (!lastAddedItemId) return
    const el = boqRowRefs.current[lastAddedItemId]
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
    // Keep the highlight ring visible briefly instead of clearing it on the same tick,
    // otherwise it renders and disappears within a single frame.
    const timeout = setTimeout(() => setLastAddedItemId(null), 1500)
    return () => clearTimeout(timeout)
  }, [lastAddedItemId])

  // If the page unmounts mid-drag, remove the ghost, body cursor override and window listeners.
  useEffect(() => () => boqDragCleanupRef.current?.(), [])

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

  // Status/category/city narrow the query itself (each is a single extra equality
  // filter on top of projectId, same combinations the old standalone tenders page
  // already queried — no new composite indexes needed). Search text and deadline
  // range stay client-side filters over whatever page is currently loaded.
  const [tenderStatusFilter, setTenderStatusFilter] = useState<"all" | "Draft" | "New" | "Awarded">("all")
  const [tenderCategoryFilter, setTenderCategoryFilter] = useState<string>("all")
  const [tenderCityFilter, setTenderCityFilter] = useState<string>("all")
  const [tenderSearchQuery, setTenderSearchQuery] = useState("")
  const [tenderDeadlineFilter, setTenderDeadlineFilter] = useState<"all" | "week" | "month" | "custom">("all")
  const [tenderCustomDeadline, setTenderCustomDeadline] = useState("")

  const linkedRfqsQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    let q = query(collection(firestore, "rfqs"), where("projectId", "==", projectId))
    if (tenderStatusFilter !== "all") q = query(q, where("status", "==", tenderStatusFilter))
    if (tenderCategoryFilter !== "all") q = query(q, where("category", "==", tenderCategoryFilter))
    if (tenderCityFilter !== "all") q = query(q, where("city", "==", tenderCityFilter))
    return q
  }, [firestore, projectId, tenderStatusFilter, tenderCategoryFilter, tenderCityFilter])

  const { data: linkedRfqs, isLoading: isLinkedRfqsLoading, hasMore: hasMoreTenders, loadMore: loadMoreTenders } = useCollectionPaginated(linkedRfqsQuery)
  const rfqsLoading = isLinkedRfqsLoading && !linkedRfqs

  const hasActiveTenderFilters = !!(tenderSearchQuery || tenderStatusFilter !== "all" || tenderCategoryFilter !== "all" || tenderCityFilter !== "all" || tenderDeadlineFilter !== "all")
  const clearTenderFilters = () => {
    setTenderSearchQuery("")
    setTenderStatusFilter("all")
    setTenderCategoryFilter("all")
    setTenderCityFilter("all")
    setTenderDeadlineFilter("all")
    setTenderCustomDeadline("")
    setSelectedTenderIds([])
  }

  const filteredLinkedRfqs = ((linkedRfqs as any[]) || []).filter((rfq) => {
    if (tenderSearchQuery) {
      const q = tenderSearchQuery.toLowerCase()
      const matches = rfq.title?.toLowerCase().includes(q) || rfq.category?.toLowerCase().includes(q)
        || rfq.subCategory?.toLowerCase().includes(q) || rfq.id?.toLowerCase().includes(q)
      if (!matches) return false
    }
    if (tenderDeadlineFilter !== "all" && rfq.deadline) {
      const deadline = new Date(rfq.deadline)
      const now = new Date()
      if (tenderDeadlineFilter === "week") {
        if (deadline > new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)) return false
      } else if (tenderDeadlineFilter === "month") {
        if (deadline > new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)) return false
      } else if (tenderDeadlineFilter === "custom" && tenderCustomDeadline) {
        if (deadline > new Date(tenderCustomDeadline)) return false
      }
    }
    return true
  })

  const isTenderExpired = (rfq: any) => {
    if (rfq.status !== "New" || !rfq.deadline) return false
    const deadline = new Date(rfq.deadline)
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return deadline < now
  }

  const userDocRef = useMemoFirebase(() => {
    if (!user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user])
  const { data: profile } = useDoc(userDocRef)

  // Tenders with an accepted offer can't be edited/deleted even before they're formally Awarded
  const acceptedOffersQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null
    return query(
      collection(firestore, "offers"),
      where("contractorId", "==", user.uid),
      where("status", "==", "مقبول")
    )
  }, [firestore, user])
  const { data: acceptedTenderOffers } = useCollection(acceptedOffersQuery)
  const acceptedTenderRfqIds = new Set((acceptedTenderOffers || []).map((o: any) => o.rfqId))

  // Connected suppliers get visibility into published tenders regardless of specialization
  // match — being invited/connected is itself the signal of relevance. Used to restrict
  // a publish action's audience the same way the old standalone tenders page did.
  const connectedTenderLinksQuery = useMemoFirebase(() => {
    if (!user || !firestore || !profile) return null
    return query(
      collection(firestore, "contractorSupplierLinks"),
      where("contractorOrgId", "==", (profile as { organizationId?: string }).organizationId || user.uid),
      where("status", "==", "active")
    )
  }, [firestore, user, profile])
  const { data: connectedTenderLinks } = useCollection(connectedTenderLinksQuery)
  const connectedSupplierOrgIds: string[] = (connectedTenderLinks || []).map((l: any) => l.supplierOrgId)
  // Same list, same order as the RFQ form's picker — connected suppliers plus
  // favourites that never got a link record, favourites first.
  const supplierOptions = useSupplierRecipientOptions(
    connectedTenderLinks as any[],
    ((profile as any)?.favoriteSuppliers as string[]) || [],
    t("suppliers_registered_supplier")
  )
  const allRecipientIds = supplierOptions.map((o) => o.orgId)

  // Unlink-from-RFQ confirmation — holds the locked BOQ item pending the user's confirmation.
  const [unlinkTarget, setUnlinkTarget] = useState<BoqItem | null>(null)
  const [measureTarget, setMeasureTarget] = useState<BoqItem | null>(null)
  const [measureQty, setMeasureQty] = useState("")
  const [measureNote, setMeasureNote] = useState("")
  const [measureDate, setMeasureDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [isMeasuring, setIsMeasuring] = useState(false)
  const [isUnlinking, setIsUnlinking] = useState(false)

  const [tenderDeleteTarget, setTenderDeleteTarget] = useState<{ id: string; title?: string } | null>(null)
  const [isDeletingTender, setIsDeletingTender] = useState(false)
  const [publishingTenderId, setPublishingTenderId] = useState<string | null>(null)
  const [selectedTenderIds, setSelectedTenderIds] = useState<string[]>([])
  const [isBulkPublishingTenders, setIsBulkPublishingTenders] = useState(false)
  const [isBulkDeletingTenders, setIsBulkDeletingTenders] = useState(false)
  const [showBulkTenderDeleteDialog, setShowBulkTenderDeleteDialog] = useState(false)
  const [tenderViewMode, setTenderViewMode] = useState<"grid" | "list">("grid")
  const [republishTarget, setRepublishTarget] = useState<{ id: string; title?: string } | null>(null)
  const [republishVisibility, setRepublishVisibility] = useState<"public" | "private">("public")
  const [republishRecipients, setRepublishRecipients] = useState<string[]>([])
  const [republishDeadline, setRepublishDeadline] = useState("")
  const [isRepublishingTender, setIsRepublishingTender] = useState(false)

  const rfqColumns: TableColumnDef[] = [
    { id: "title", label: t("proj_rfqs"), locked: true },
    { id: "category", label: t("proj_category") },
    { id: "status", label: t("proj_status"), locked: true },
    { id: "offers_count", label: t("proj_offers_count_label") },
  ]
  const { isVisible: isRfqColVisible, toggle: toggleRfqCol } = useTableColumns("project_rfqs", rfqColumns)

  const canEditOrDeleteTender = (rfq: any) => {
    if (rfq.status === "Awarded") return false
    if (acceptedTenderRfqIds.has(rfq.id)) return false
    return true
  }

  const getTenderStatusBadge = (rfq: any) => {
    if (rfq.status === "Draft")
      return <Badge className="bg-slate-100 text-slate-600 border-slate-300 font-bold">{t("rfq_badge_draft")}</Badge>
    if (rfq.status === "Awarded")
      return <Badge className="bg-success/10 text-success border-success/20 font-bold">{t("rfq_badge_awarded")}</Badge>
    if (rfq.deadline) {
      const deadlineDate = new Date(rfq.deadline)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (deadlineDate < today)
        return <Badge className="bg-destructive/10 text-destructive border-none font-bold">{t("rfq_badge_expired")}</Badge>
    }
    return <Badge className="bg-blue-50 text-blue-600 border-none font-bold">{t("rfq_badge_open")}</Badge>
  }

  /**
   * What publishing writes. Deliberately re-uses the tender's OWN visibility
   * and recipient list: those were chosen on the form that created it, and a
   * publish button is not the place to silently re-decide them. A public
   * tender still records the connected suppliers, who see published tenders
   * regardless of specialisation; a private one that carries no list of its
   * own predates the picker, so it keeps meaning "everyone connected".
   */
  const publishFields = (rfq: any) => {
    const isPrivate = rfq?.visibility === "private"
    const saved: string[] = Array.isArray(rfq?.allowedSupplierOrgIds) ? rfq.allowedSupplierOrgIds : []
    return {
      status: "New",
      visibility: isPrivate ? "private" : "public",
      allowedSupplierOrgIds: isPrivate ? (saved.length > 0 ? saved : allRecipientIds) : connectedSupplierOrgIds,
      publishedAt: new Date().toISOString(),
    }
  }

  /** Opens the republish dialog on the audience the tender already has, so
   *  reopening an unanswered private tender keeps its suppliers unless the
   *  contractor changes them. */
  const seedRepublishAudience = (rfqId: string) => {
    const tender = ((linkedRfqs as any[]) || []).find((r) => r.id === rfqId)
    const saved: string[] = Array.isArray(tender?.allowedSupplierOrgIds) ? tender.allowedSupplierOrgIds : []
    setRepublishVisibility(tender?.visibility === "private" ? "private" : "public")
    setRepublishRecipients(saved.length > 0 ? saved : allRecipientIds)
  }

  const handlePublishTender = async (rfqId: string) => {
    if (!firestore) return
    const missingFields = getIncompletePublishFields(profile, locale)
    if (missingFields.length > 0) {
      toast({
        title: locale === "ar" ? "الملف الشخصي غير مكتمل" : "Incomplete Profile",
        description: (locale === "ar" ? "يرجى إكمال الحقول التالية أولاً: " : "Please complete the following fields first: ") + missingFields.join("، "),
        variant: "destructive",
      })
      return
    }
    setPublishingTenderId(rfqId)
    try {
      // Publish it as it was written. Forcing "public" here threw away a
      // draft's private audience — a tender addressed to two chosen suppliers
      // went out to the whole market on a button that only said "publish".
      const draft = ((linkedRfqs as any[]) || []).find((r) => r.id === rfqId)
      await updateDoc(doc(firestore, "rfqs", rfqId), publishFields(draft))
      void notifyFavoriteSuppliersOfPublish(user, [rfqId])
      toast({ title: t("rfq_batch_publish_title") })
    } catch (err) {
      console.error(err)
      toast({ title: t("rfq_batch_publish_error"), variant: "destructive" })
    } finally {
      setPublishingTenderId(null)
    }
  }

  const handleRepublishTender = async () => {
    if (!firestore || !republishTarget || !republishDeadline) return
    setIsRepublishingTender(true)
    try {
      await updateDoc(doc(firestore, "rfqs", republishTarget.id), {
        deadline: republishDeadline,
        status: "New",
        visibility: republishVisibility,
        allowedSupplierOrgIds: republishVisibility === "private" ? republishRecipients : [],
        publishedAt: new Date().toISOString(),
      })
      void notifyFavoriteSuppliersOfPublish(user, [republishTarget.id])
      toast({ title: t("rfq_republish_success") })
      setRepublishTarget(null)
      setRepublishDeadline("")
    } catch (err) {
      console.error(err)
      toast({ title: t("rfq_republish_failed"), variant: "destructive" })
    } finally {
      setIsRepublishingTender(false)
    }
  }

  const handleDeleteTender = async () => {
    if (!firestore || !tenderDeleteTarget || !projectId) return
    setIsDeletingTender(true)
    try {
      // Hand the RFQ's draws back to the BOQ lines before it goes.
      await releaseBoqDrawsForRfq(firestore, projectId, tenderDeleteTarget.id)
      await updateDoc(doc(firestore, "projects", projectId), { rfqIds: arrayRemove(tenderDeleteTarget.id) })
      await deleteDoc(doc(firestore, "rfqs", tenderDeleteTarget.id))
      toast({ title: t("rfq_delete_success") })
      setTenderDeleteTarget(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("rfq_delete_failed"), variant: "destructive" })
    } finally {
      setIsDeletingTender(false)
    }
  }

  const toggleSelectTender = (id: string) => {
    setSelectedTenderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const toggleSelectAllTenders = () => {
    const allIds = filteredLinkedRfqs.map((r) => r.id)
    setSelectedTenderIds((prev) => (prev.length === allIds.length ? [] : allIds))
  }

  const handleBulkPublishTenders = async () => {
    if (isBulkPublishingTenders || !firestore) return
    const missingFields = getIncompletePublishFields(profile, locale)
    if (missingFields.length > 0) {
      toast({
        title: locale === "ar" ? "الملف الشخصي غير مكتمل" : "Incomplete Profile",
        description: (locale === "ar" ? "يرجى إكمال الحقول التالية أولاً: " : "Please complete the following fields first: ") + missingFields.join("، "),
        variant: "destructive",
      })
      return
    }
    const candidates = ((linkedRfqs as any[]) || []).filter((r) => selectedTenderIds.includes(r.id))
    const eligible = candidates.filter((r) => canEditOrDeleteTender(r) && r.status === "Draft")
    const skipped = candidates.length - eligible.length
    if (eligible.length === 0) {
      toast({ title: t("rfq_bulk_publish_none_eligible"), variant: "destructive" })
      return
    }
    setIsBulkPublishingTenders(true)
    let published = 0
    const failedIds: string[] = []
    for (const r of eligible) {
      try {
        await updateDoc(doc(firestore, "rfqs", r.id), publishFields(r))
        published++
      } catch (err) {
        console.error(err)
        failedIds.push(r.id)
      }
    }
    toast({
      title: t("rfq_batch_publish_title"),
      description: t("rfq_bulk_publish_result", { published, skipped })
        + (failedIds.length > 0 ? t("rfq_bulk_publish_failed_suffix", { failed: failedIds.length }) : ""),
      variant: failedIds.length > 0 ? "destructive" : undefined,
    })
    void notifyFavoriteSuppliersOfPublish(user, eligible.map((r) => r.id).filter((id) => !failedIds.includes(id)))
    setSelectedTenderIds(failedIds)
    setIsBulkPublishingTenders(false)
  }

  const handleBulkDeleteTenders = async () => {
    if (isBulkDeletingTenders || !firestore || !projectId) return
    const candidates = ((linkedRfqs as any[]) || []).filter((r) => selectedTenderIds.includes(r.id))
    const eligible = candidates.filter((r) => canEditOrDeleteTender(r))
    const skipped = candidates.length - eligible.length
    if (eligible.length === 0) {
      toast({ title: t("rfq_bulk_delete_none_eligible"), variant: "destructive" })
      setShowBulkTenderDeleteDialog(false)
      return
    }
    setIsBulkDeletingTenders(true)
    let deleted = 0
    const failedIds: string[] = []
    for (const r of eligible) {
      try {
        await releaseBoqDrawsForRfq(firestore, projectId, r.id)
        await updateDoc(doc(firestore, "projects", projectId), { rfqIds: arrayRemove(r.id) })
        await deleteDoc(doc(firestore, "rfqs", r.id))
        deleted++
      } catch (err) {
        console.error(err)
        failedIds.push(r.id)
      }
    }
    toast({
      title: t("rfq_delete_success"),
      description: t("rfq_bulk_delete_result", { deleted, skipped })
        + (failedIds.length > 0 ? t("rfq_bulk_delete_failed_suffix", { failed: failedIds.length }) : ""),
      variant: failedIds.length > 0 ? "destructive" : undefined,
    })
    setSelectedTenderIds(failedIds)
    setIsBulkDeletingTenders(false)
    setShowBulkTenderDeleteDialog(false)
  }

  const typedProject = project as {
    warehouseId?: string
    name?: string
    clientName?: string
    description?: string
    location?: string
    region?: string
    budget?: number
    wasteTargetPercent?: number
    status?: string
    projectType?: string
    clientType?: string
    blueprintUrl?: string
    rfqIds?: string[]
    organizationId?: string
    createdAt?: unknown
    enabledSections?: string[]
    /** Present when the project came from a won CRM deal. */
    handover?: ProjectHandover | null
  } | null

  const enabledSectionIds = ((typedProject?.enabledSections?.length
    ? typedProject.enabledSections
    : LEGACY_DEFAULT_SECTIONS) as SectionId[])

  const dynamicTabs = SECTION_IDS
    .filter((id) => enabledSectionIds.includes(id))
    .filter((id) => SECTION_REGISTRY[id].tabRoute && id !== "collect")

  const myOrgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""

  const warehousesQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(collection(firestore, "warehouses"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId])
  const { data: warehousesData } = useCollection(warehousesQuery)
  const projectWarehouses = (warehousesData || []) as { id: string; name: string }[]
  const { centrals } = useCentralWarehouse(myOrgId)

  const linkedWarehouseInventoryQuery = useMemoFirebase(() => {
    const wid = typedProject?.warehouseId
    if (!firestore || !wid) return null
    return collection(firestore, "warehouses", wid, "inventoryItems")
  }, [firestore, typedProject?.warehouseId])
  const { data: linkedInventoryData } = useCollection(linkedWarehouseInventoryQuery)
  const linkedInventoryItems = (linkedInventoryData || []) as { id: string; name: string; unit: string; unitCode?: string | null; unitCost?: number | null; quantity: number; trackingMode?: "unit" | null }[]

  // Fetch BOQ items + sections from Firestore — always reflects server state. Returns the
  // freshly-fetched data (not just setState) so callers that need to act on it immediately
  // (e.g. publish) don't read stale values from the current render's closure.
  const fetchBoqItems = useCallback(async (): Promise<{ items: BoqItem[]; groups: BoqGroupMeta[] }> => {
    if (!firestore || !projectId) return { items: [], groups: [] }
    const [itemsSnap, groupsSnap] = await Promise.all([
      getDocs(collection(firestore, "projects", projectId, "boqItems")),
      getDocs(collection(firestore, "projects", projectId, "boqGroups")),
    ])
    const items: BoqItem[] = itemsSnap.docs.map((d) => {
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
        requiresWarranty: !!data.requiresWarranty,
        unitBarcodes: data.unitBarcodes || null,
        drawnQuantity: Number(data.drawnQuantity) || 0,
        draws: Array.isArray(data.draws) ? (data.draws as BoqDraw[]) : [],
        executedQuantity: Number(data.executedQuantity) || 0,
      }
    })
    const groups: BoqGroupMeta[] = groupsSnap.docs.map((d) => {
      const data = d.data()
      return { id: d.id, titleAr: data.titleAr || "", categoryAr: data.categoryAr || "" }
    })
    setBoqItems(items)
    setBoqGroups(groups)
    return { items, groups }
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
    setEditClientName(typedProject.clientName || "")
    setEditDescription(typedProject.description || "")
    setEditLocation(typedProject.location || "")
    setEditBudget(typedProject.budget != null ? String(typedProject.budget) : "")
    setEditWasteTarget(typedProject.wasteTargetPercent != null ? String(typedProject.wasteTargetPercent) : "12")
    setEditStatus(resolveProjectStatus(typedProject.status as string | undefined))
    setEditWarehouseId(typedProject.warehouseId || "")
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!firestore || !projectDocRef) return
    setIsSaving(true)
    try {
      await updateDoc(projectDocRef, {
        name: editName.trim(),
        clientName: editClientName.trim() || null,
        description: editDescription.trim() || null,
        location: editLocation.trim() || null,
        budget: editBudget ? Number(editBudget) : null,
        wasteTargetPercent: editWasteTarget ? Number(editWasteTarget) : null,
        status: editStatus,
        warehouseId: editWarehouseId || null,
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

  const handleCreateProjectWarehouse = async () => {
    if (!firestore || !projectDocRef || !typedProject) return
    setIsCreatingWarehouse(true)
    try {
      // Which central this project draws from — matched by region when the
      // company has more than one; a single central serves everyone.
      const linkedCentral = resolveCentralForRegion(centrals, (typedProject as { region?: string | null }).region)
      const warehouseRef = await addDoc(collection(firestore, "warehouses"), {
        name: t("proj_auto_warehouse_name", { name: typedProject.name || "" }),
        location: typedProject.location || null,
        description: null,
        organizationId: typedProject.organizationId || myOrgId,
        centralWarehouseId: linkedCentral?.id ?? null,
        projectId,
        projectName: typedProject.name || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      await updateDoc(projectDocRef, { warehouseId: warehouseRef.id, updatedAt: serverTimestamp() })
      toast({ title: linkedCentral ? t("proj_warehouse_created") : t("proj_warehouse_created_no_central") })
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
    } finally {
      setIsCreatingWarehouse(false)
    }
  }

  const handleRecordMeasurement = async () => {
    if (!firestore || !user || !projectId || !measureTarget) return
    const qty = Number(measureQty)
    if (!qty || isNaN(qty)) {
      toast({ title: t("measure_qty_required"), variant: "destructive" })
      return
    }
    setIsMeasuring(true)
    try {
      const batch = writeBatch(firestore)
      const mRef = doc(collection(firestore, "projects", projectId, "measurements"))
      batch.set(mRef, {
        boqItemId: measureTarget.id,
        itemNo: measureTarget.itemNo || "",
        description: measureTarget.descriptionAr || measureTarget.descriptionEn || "",
        unit: measureTarget.unit || "",
        quantity: qty,
        measuredAt: measureDate,
        note: measureNote.trim() || null,
        claimId: null,
        recordedByUserId: user.uid,
        recordedByName: (profile as { name?: string } | null)?.name || user.email || "",
        createdAt: serverTimestamp(),
      })
      batch.update(doc(firestore, "projects", projectId, "boqItems", measureTarget.id), {
        executedQuantity: increment(qty),
        updatedAt: serverTimestamp(),
      })
      await batch.commit()
      setBoqItems((prev) =>
        prev.map((i) => (i.id === measureTarget.id ? { ...i, executedQuantity: (i.executedQuantity || 0) + qty } : i))
      )
      toast({ title: t("measure_saved") })
      setMeasureTarget(null)
      setMeasureQty("")
      setMeasureNote("")
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
    } finally {
      setIsMeasuring(false)
    }
  }

  const handleDelete = async () => {
    if (!firestore || !projectDocRef || !projectId) return
    setIsDeleting(true)
    try {
      // Firestore doesn't cascade-delete subcollections or linked documents. Linked
      // tenders (rfqs) must go first: their boqItems are locked (isEditable:false)
      // while pushed to a tender, and the boqItems delete rule rejects deleting a
      // locked item — leaving them locked made the whole project delete throw
      // "missing permissions". Deleting the rfqs also avoids orphaning tenders that
      // would otherwise still be live/browsable after their project is gone.
      const rfqsSnap = await getDocs(query(collection(firestore, "rfqs"), where("projectId", "==", projectId)))
      for (const rfqDoc of rfqsSnap.docs) {
        await releaseBoqDrawsForRfq(firestore, projectId, rfqDoc.id)
        await deleteDoc(rfqDoc.ref)
      }

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
        const parsed: BoqItem[] = result.items.map((item) => ({
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
          requiresWarranty: false,
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
  // Returns the freshly-synced items/groups plus a map of temp id -> real Firestore id for any
  // newly-created rows, so a caller like Publish can act on the post-save state without racing
  // React's setState. `silent` skips the "saved" toast (used when auto-invoked from Publish).
  // `items` persists an explicit list instead of the `boqItems` state — needed by callers that
  // build rows and must save them in the same tick, before React has flushed setState.
  const saveBoq = async (opts?: { silent?: boolean; items?: BoqItem[] }): Promise<{ items: BoqItem[]; groups: BoqGroupMeta[]; idMap: Map<string, string> } | null> => {
    if (!firestore || !projectId) return null
    const itemsToSave = opts?.items ?? boqItems
    setBoqSaving(true)
    try {
      const colRef = collection(firestore, "projects", projectId, "boqItems")
      const groupsColRef = collection(firestore, "projects", projectId, "boqGroups")
      const [existing, existingGroups] = await Promise.all([getDocs(colRef), getDocs(groupsColRef)])
      const existingIds = new Set(existing.docs.map((d) => d.id))
      const currentIds = new Set(itemsToSave.filter((i) => existingIds.has(i.id)).map((i) => i.id))
      const existingGroupIds = new Set(existingGroups.docs.map((d) => d.id))
      const currentGroupIds = new Set(boqGroups.map((g) => g.id))

      const batch = writeBatch(firestore)
      const idMap = new Map<string, string>()

      existing.docs.forEach((d) => {
        if (!currentIds.has(d.id) && d.data().isEditable !== false) {
          batch.delete(d.ref)
        }
      })

      existingGroups.docs.forEach((d) => {
        if (!currentGroupIds.has(d.id)) batch.delete(d.ref)
      })

      // A line's total can never drop below what RFQs have already drawn from it —
      // that would make the remaining quantity negative and the draws a lie.
      const belowDrawn = itemsToSave.find(
        (item) => item.isEditable !== false && (item.drawnQuantity || 0) > 0 && (Number(item.quantity) || 0) < (item.drawnQuantity || 0)
      )
      if (belowDrawn) {
        toast({
          title: t("proj_boq_qty_below_drawn", {
            item: belowDrawn.descriptionAr || belowDrawn.descriptionEn || belowDrawn.itemNo,
            drawn: belowDrawn.drawnQuantity || 0,
          }),
          variant: "destructive",
        })
        return null
      }

      itemsToSave.forEach((item) => {
        if (item.isEditable === false) return
        const isNew = !existingIds.has(item.id)
        const ref = isNew ? doc(colRef) : doc(colRef, item.id)
        if (isNew) idMap.set(item.id, ref.id)
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
          // A partially drawn line stays editable but keeps its draws — a bulk save
          // must never quietly forget what RFQs already took.
          tenderId: item.tenderId ?? null,
          isEditable: true,
          drawnQuantity: item.drawnQuantity || 0,
          draws: item.draws ?? [],
          groupId: item.groupId || null,
          requiresWarranty: !!item.requiresWarranty,
          unitBarcodes: item.unitBarcodes || null,
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
      const fresh = await fetchBoqItems()
      if (!opts?.silent) toast({ title: t("proj_boq_saved") })
      return { ...fresh, idMap }
    } catch (err) {
      console.error(err)
      toast({ title: t("proj_boq_save_error"), variant: "destructive" })
      return null
    } finally {
      setBoqSaving(false)
    }
  }

  // Add empty BOQ row — lands in the given section (or Unassigned when omitted), expanding it
  // if collapsed and scrolling the new row into view once rendered (see lastAddedItemId effect).
  const addBoqRow = (groupId: string | null = null) => {
    const newId = `new_${Date.now()}`
    setBoqItems((prev) => [
      ...prev,
      {
        id: newId,
        itemNo: String(prev.length + 1),
        descriptionAr: "",
        descriptionEn: "",
        quantity: "",
        unit: "",
        unitPrice: "",
        sheet: "",
        tenderId: null,
        isEditable: true,
        groupId,
      },
    ])
    const collapseKey = groupId ?? "unassigned"
    setCollapsedGroups((prev) => {
      if (!prev.has(collapseKey)) return prev
      const next = new Set(prev)
      next.delete(collapseKey)
      return next
    })
    setLastAddedItemId(newId)
  }

  // Update BOQ cell — locked rows never accept edits (also enforced server-side)
  // useCallback with empty deps keeps this reference stable across renders (only functional setState is used),
  // which lets boqColumns stay memoized — without it, table cells remount on every keystroke and lose focus.
  const updateBoqCell = useCallback((rowIndex: number, field: keyof BoqItem, value: string | boolean) => {
    setBoqItems((prev) =>
      prev.map((item, i) => (i === rowIndex && item.isEditable !== false ? { ...item, [field]: value } : item))
    )
  }, [])

  // Delete BOQ row — locked rows cannot be deleted (also enforced server-side)
  const deleteBoqRow = useCallback((rowIndex: number) => {
    // A line with quantity already out on RFQs cannot simply vanish — the RFQs
    // would point at nothing. Release its draws (delete the RFQs) first.
    const target = boqItems[rowIndex]
    if (target && (target.drawnQuantity || 0) > 0) {
      toast({ title: t("proj_boq_delete_drawn_blocked"), variant: "destructive" })
      return
    }
    setBoqItems((prev) => {
      const item = prev[rowIndex]
      if (item?.isEditable === false) return prev
      return prev.filter((_, i) => i !== rowIndex)
    })
  }, [boqItems, toast, t])

  // Remove the tender lock from a single BOQ item (the one write transition the rules allow on a locked row)
  const unlockBoqItem = useCallback(async (itemId: string) => {
    if (!firestore || !projectId) return
    try {
      // Hands back every draw at once; the RFQs themselves are untouched.
      await updateDoc(doc(firestore, "projects", projectId, "boqItems", itemId), releaseAllDraws())
      await fetchBoqItems()
      toast({ title: t("proj_boq_unlocked") })
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
    }
  }, [firestore, projectId, fetchBoqItems, toast, t])

  // Runs after the user confirms the unlink dialog — see the AlertDialog at the bottom of the page.
  const confirmUnlink = async () => {
    if (!unlinkTarget) return
    setIsUnlinking(true)
    try {
      await unlockBoqItem(unlinkTarget.id)
    } finally {
      setIsUnlinking(false)
      setUnlinkTarget(null)
    }
  }

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

  // Split an item out of its current section into a brand-new one — mirrors the same
  // title-defaulting convention as src/utils/boq-groups.ts's splitItemToNewGroup.
  const splitItemToNewGroup = useCallback((item: BoqItem) => {
    if (!firestore || !projectId) return
    const newId = doc(collection(firestore, "projects", projectId, "boqGroups")).id
    const titleAr = item.descriptionAr ? item.descriptionAr.substring(0, 60) : `توريد ${item.suggestedCategory || ""}`
    const categoryAr = item.suggestedCategory || Object.keys(CATEGORIES_DATA)[0] || ""
    setBoqGroups((prev) => [...prev, { id: newId, titleAr, categoryAr }])
    setBoqItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, groupId: newId } : i)))
  }, [firestore, projectId])

  // Publish selection toggles (opt-out `deselectedIds` set — see its declaration above).
  const toggleItemSelected = useCallback((itemId: string) => {
    setDeselectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }, [])

  const setGroupSelected = useCallback((groupId: string, selected: boolean) => {
    setDeselectedIds((prev) => {
      const next = new Set(prev)
      boqItems.forEach((item) => {
        if (item.groupId !== groupId || item.isEditable === false) return
        if (selected) next.delete(item.id)
        else next.add(item.id)
      })
      return next
    })
  }, [boqItems])

  // Publish: save first (so newly-added/moved rows get real Firestore ids), then create one RFQ
  // per section that has at least one selected item, locking only the items actually included.
  const handlePublish = async () => {
    if (!firestore || !user || !projectId || !publishDeadline) return
    if (!publishCity) return
    setIsPublishing(true)
    try {
      const saved = await saveBoq({ silent: true })
      if (!saved) return // saveBoq already surfaced an error toast

      const { items: freshItems, groups: freshGroups, idMap } = saved
      const remappedDeselected = new Set([...deselectedIds].map((id) => idMap.get(id) ?? id))
      // New rows get real ids on save; the quantities typed against their
      // temporary ids follow them.
      const remappedQtys = new Map<string, string>()
      for (const [id, q] of Object.entries(publishQtys)) remappedQtys.set(idMap.get(id) ?? id, q)

      // Per item: how much THIS request draws. Defaults to everything left;
      // anything typed must be a positive amount no larger than that.
      const drawFor = (item: BoqItem): number => {
        const remaining = boqRemaining(item)
        const typed = remappedQtys.get(item.id)
        if (typed === undefined || typed === "") return remaining
        const n = Number(typed)
        return Number.isFinite(n) ? Math.min(remaining, Math.max(0, n)) : remaining
      }

      const itemsByGroup = new Map<string, BoqItem[]>()
      freshItems.forEach((item) => {
        if (!item.groupId || item.isEditable === false || remappedDeselected.has(item.id)) return
        if (drawFor(item) <= 0) return
        if (!itemsByGroup.has(item.groupId)) itemsByGroup.set(item.groupId, [])
        itemsByGroup.get(item.groupId)!.push(item)
      })

      const groupsToPublish = freshGroups.filter((g) => (itemsByGroup.get(g.id) || []).length > 0)
      if (groupsToPublish.length === 0) {
        toast({ title: t("boq_select_at_least_one"), variant: "destructive" })
        return
      }

      const rfqsRef = collection(firestore, "rfqs")
      const projectName = typedProject?.name || ""
      let created = 0
      try {
        for (const group of groupsToPublish) {
          const selectedItems = itemsByGroup.get(group.id) || []
          const rfqData = {
            contractorId: user.uid,
            organizationId: (profile as { organizationId?: string } | null)?.organizationId || user.uid,
            projectId,
            title: group.titleAr,
            category: group.categoryAr,
            subCategory: "",
            products: selectedItems.map((item) => ({
              name: item.descriptionAr || item.descriptionEn,
              nameEn: item.descriptionEn,
              // The drawn quantity, not the line's total — the BOQ stays the
              // reference and this request is one phase of it.
              quantity: drawFor(item),
              unitOfMeasure: item.unit,
              description: item.descriptionAr ? `${item.descriptionAr}\n${item.descriptionEn}` : item.descriptionEn,
              category: item.suggestedCategory || group.categoryAr,
              subCategory: item.suggestedSubCategory || "",
              boqItemNo: item.itemNo,
              boqItemId: item.id,
              boqTotalQuantity: Number(item.quantity) || 0,
              requiresWarranty: !!item.requiresWarranty,
            })),
            quantity: String(selectedItems.reduce((s, i) => s + drawFor(i), 0)),
            notes: selectedItems.map((i) => i.descriptionAr || i.descriptionEn).join("\n"),
            deadline: publishDeadline,
            city: publishCity,
            district: publishDistrict || publishCity,
            country: "SA",
            isInternational: false,
            shipmentMode: publishShipmentMode,
            pdfUrl: null,
            pdfStoragePath: null,
            status: "Draft",
            visibility: "public",
            requiresWarranty: selectedItems.some((item) => item.requiresWarranty),
            boqProjectName: projectName,
            createdByUserId: user.uid,
            createdByUserName: (profile as { name?: string } | null)?.name || user.email || "عضو الفريق",
            createdAt: new Date().toISOString(),
          }
          const newRfqRef = await addDoc(rfqsRef, rfqData)
          created++
          await updateDoc(doc(firestore, "projects", projectId), { rfqIds: arrayUnion(newRfqRef.id) })

          // Record the draw on each line. The line locks only if nothing is
          // left — a phased request leaves it open for the next phase.
          const drawAt = new Date().toISOString()
          const lockBatch = writeBatch(firestore)
          selectedItems.forEach((item) => {
            lockBatch.update(
              doc(firestore, "projects", projectId, "boqItems", item.id),
              applyDraw(item, { rfqId: newRfqRef.id, quantity: drawFor(item), at: drawAt, rfqTitle: group.titleAr })
            )
          })
          await lockBatch.commit()
        }

        toast({ title: t("boq_success_title"), description: t("boq_success_desc", { count: created }) })
        setIsPublishDialogOpen(false)
        setDeselectedIds(new Set())
        setPublishQtys({})
        setPublishShipmentMode("single")
        setPublishCity("")
        setPublishDistrict("")
        setPublishDeadline("")
        await fetchBoqItems()
        handleTabChange("rfqs")
      } catch (err) {
        console.error("Publish error:", err)
        if (created > 0) {
          toast({
            title: t("boq_create_partial_error"),
            description: t("boq_create_partial_error_desc", { count: created, total: groupsToPublish.length }),
            variant: "destructive",
          })
          setIsPublishDialogOpen(false)
          await fetchBoqItems()
          handleTabChange("rfqs")
        } else {
          toast({ title: t("boq_create_error"), variant: "destructive" })
        }
      }
    } finally {
      setIsPublishing(false)
    }
  }

  // Starts the custom pointer-based row drag (see the comment on boqDragCleanupRef for why this
  // is not native HTML5 DnD). The whole gesture lives in closures + window listeners: a cloned
  // row follows the pointer, sections highlight via elementFromPoint hit-testing, and pointerup
  // commits the move. Pointer capture guarantees we ALWAYS get the terminal event, so the cursor
  // and highlights can never be left stuck.
  const handleRowDragStart = useCallback((e: React.PointerEvent, itemId: string) => {
    if (boqDragCleanupRef.current) return // a drag is already in progress
    if (e.pointerType === "mouse" && e.button !== 0) return
    const grip = e.currentTarget as HTMLElement
    const rowEl = grip.closest("tr")
    if (!rowEl) return
    e.preventDefault()

    // Ghost: a static clone of the row wrapped in its own <table> (a bare <tr> can't render
    // outside one), following the pointer via transform. It's detached from React entirely.
    const rect = rowEl.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top
    const ghost = document.createElement("div")
    const ghostTable = document.createElement("table")
    const ghostBody = document.createElement("tbody")
    ghostBody.appendChild(rowEl.cloneNode(true))
    ghostTable.appendChild(ghostBody)
    ghostTable.style.width = `${rect.width}px`
    ghostTable.style.borderCollapse = "collapse"
    ghost.appendChild(ghostTable)
    Object.assign(ghost.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: `${rect.width}px`,
      transform: `translate(${rect.left}px, ${rect.top}px)`,
      zIndex: "9999",
      pointerEvents: "none",
      opacity: "0.95",
      background: "white",
      borderRadius: "10px",
      boxShadow: "0 12px 32px rgba(15, 23, 42, 0.25)",
      overflow: "hidden",
    } satisfies Partial<CSSStyleDeclaration>)
    document.body.appendChild(ghost)

    rowEl.classList.add("boq-drag-source")
    document.querySelectorAll("[data-boq-dropzone]").forEach((el) => el.classList.add("boq-dropzone-active"))
    document.body.style.cursor = "grabbing"
    document.body.style.userSelect = "none"

    let hoverZone: HTMLElement | null = null

    const onMove = (ev: PointerEvent) => {
      ghost.style.transform = `translate(${ev.clientX - offsetX}px, ${ev.clientY - offsetY}px)`
      // Nudge the page when dragging near the viewport edges so far-away sections are reachable.
      if (ev.clientY < 90) window.scrollBy(0, -16)
      else if (ev.clientY > window.innerHeight - 90) window.scrollBy(0, 16)
      // The ghost has pointer-events:none, so hit-testing sees the real page under the cursor.
      const zone = (document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-boq-dropzone]") ?? null) as HTMLElement | null
      if (zone !== hoverZone) {
        hoverZone?.classList.remove("boq-dropzone-over")
        zone?.classList.add("boq-dropzone-over")
        hoverZone = zone
      }
    }
    const cleanup = () => {
      boqDragCleanupRef.current = null
      ghost.remove()
      rowEl.classList.remove("boq-drag-source")
      document.querySelectorAll("[data-boq-dropzone]").forEach((el) => {
        el.classList.remove("boq-dropzone-active", "boq-dropzone-over")
      })
      document.body.style.removeProperty("cursor")
      document.body.style.removeProperty("user-select")
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onPointerCancel)
      window.removeEventListener("keydown", onKeyDown)
    }
    const onUp = () => {
      const target = hoverZone?.getAttribute("data-boq-dropzone") ?? null
      cleanup()
      if (target) moveItemToGroup(itemId, target === "unassigned" ? null : target)
    }
    const onPointerCancel = () => cleanup()
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") cleanup()
    }

    boqDragCleanupRef.current = cleanup
    try {
      grip.setPointerCapture(e.pointerId)
    } catch {
      // capture is best-effort; window listeners below still end the gesture on pointerup
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onPointerCancel)
    window.addEventListener("keydown", onKeyDown)
  }, [moveItemToGroup])

  // TanStack table columns — memoized so cell renderers keep a stable identity across renders.
  // flexRender creates a fresh React element per render; if the cell function itself were a new
  // reference every render (as it was before this array was memoized), React treats it as a different
  // component type at that tree position and remounts it, which drops input focus after every keystroke.
  const boqColumns = useMemo(() => [
    columnHelper.display({
      id: "select",
      header: () => null,
      cell: ({ row }) => {
        if (row.original.isEditable === false) return <div className="w-5 h-8" />
        return (
          <div className="flex items-center justify-center h-8 w-5">
            <Checkbox
              checked={!deselectedIds.has(row.original.id)}
              onCheckedChange={() => toggleItemSelected(row.original.id)}
              aria-label={t("boq_select_item")}
            />
          </div>
        )
      },
      size: 24,
    }),
    columnHelper.display({
      id: "drag",
      header: () => null,
      cell: ({ row }) => {
        if (row.original.isEditable === false) {
          return <div className="w-5 h-8" />
        }
        return (
          // Pointer-only affordance (custom pointer-events drag) — not focusable/keyboard-operable.
          // Keyboard/screen-reader users reorganize via the "move to section" menu instead.
          <div
            onPointerDown={(e) => handleRowDragStart(e, row.original.id)}
            aria-hidden="true"
            className="flex items-center justify-center h-8 w-5 text-muted-foreground/50 hover:text-muted-foreground cursor-grab touch-none select-none rounded"
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
          draggable={false}
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
              draggable={false}
              placeholder={t("proj_boq_description_ar_placeholder")}
              className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2 disabled:opacity-60"
            />
            <Input
              value={item.descriptionEn}
              onChange={(e) => updateBoqCell(row.index, "descriptionEn", e.target.value)}
              disabled={locked}
              dir="ltr"
              draggable={false}
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
      cell: ({ row, getValue }) => {
        const item = row.original
        const drawn = item.drawnQuantity || 0
        const total = Number(item.quantity) || 0
        const remaining = boqRemaining(item)
        const pct = total > 0 ? Math.min(100, Math.round((drawn / total) * 100)) : 0
        return (
          <div className="flex flex-col gap-0.5 py-0.5">
            <Input
              value={getValue()}
              onChange={(e) => updateBoqCell(row.index, "quantity", e.target.value)}
              disabled={item.isEditable === false}
              draggable={false}
              className={cn(
                "h-8 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/30 rounded-md px-2 text-center disabled:opacity-60",
                drawn > 0 && total < drawn && "text-destructive"
              )}
              type="number"
              min={drawn}
              title={drawn > 0 ? t("proj_boq_drawn_hint", { drawn, remaining }) : undefined}
            />
            {/* What RFQs have already taken, and what is left to draw. Only
                shown once a phase has gone out — most lines never need it. */}
            {drawn > 0 && (
              <div className="px-2 space-y-0.5">
                <div className="h-1 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                  <div className={cn("h-full rounded-full", remaining > 0 ? "bg-cta" : "bg-success")} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[10px] text-muted-foreground whitespace-nowrap" dir="ltr">
                  {t("proj_boq_drawn_hint", { drawn, remaining })}
                </p>
              </div>
            )}
          </div>
        )
      },
      size: 110,
    }),
    columnHelper.accessor("unit", {
      header: () => <span>{t("proj_boq_unit")}</span>,
      cell: ({ row, getValue }) => (
        <Input
          value={getValue()}
          onChange={(e) => updateBoqCell(row.index, "unit", e.target.value)}
          disabled={row.original.isEditable === false}
          draggable={false}
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
          draggable={false}
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
      id: "executed",
      header: () => (
        <span className="flex items-center gap-1" title={t("proj_boq_executed_col")}>
          <Ruler size={12} />
          {t("proj_boq_executed_col")}
        </span>
      ),
      cell: ({ row }) => {
        const item = row.original
        const qty = Number(item.quantity) || 0
        const executed = item.executedQuantity || 0
        const pct = qty > 0 ? Math.min(100, (executed / qty) * 100) : 0
        const overrun = qty > 0 && executed > qty
        return (
          <div className="flex items-center gap-1.5 px-1">
            <div className="flex-1 min-w-[52px]">
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={cn("h-full rounded-full", overrun ? "bg-destructive" : pct >= 100 ? "bg-success" : "bg-cta")}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className={cn("text-[10px] whitespace-nowrap mt-0.5", overrun ? "text-destructive font-bold" : "text-muted-foreground")} dir="ltr">
                {executed.toLocaleString()} / {qty ? qty.toLocaleString() : "–"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMeasureTarget(item)}
              aria-label={t("measure_record_btn")}
              title={t("measure_record_btn")}
              className="h-6 w-6 shrink-0 rounded-md grid place-items-center text-cta hover:bg-cta/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Ruler size={13} />
            </button>
          </div>
        )
      },
      size: 130,
    }),
    columnHelper.display({
      id: "warranty",
      header: () => (
        <span className="flex items-center gap-1" title={t("proj_boq_warranty_required")}>
          <ShieldCheck size={12} />
          {t("proj_boq_warranty_col")}
        </span>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-center h-8">
          <Checkbox
            checked={!!row.original.requiresWarranty}
            onCheckedChange={(checked) => updateBoqCell(row.index, "requiresWarranty", checked === true)}
            disabled={row.original.isEditable === false}
            aria-label={t("proj_boq_warranty_required")}
          />
        </div>
      ),
      size: 70,
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
                onClick={() => setUnlinkTarget(item)}
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
              <DropdownMenuContent align="end" className="w-64 max-h-72 overflow-y-auto">
                {boqGroups.map((group) => (
                  <DropdownMenuItem
                    key={group.id}
                    disabled={item.groupId === group.id}
                    onClick={() => moveItemToGroup(item.id, group.id)}
                    title={group.titleAr}
                  >
                    <span className="min-w-0 truncate">{group.titleAr || t("proj_boq_add_section")}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  disabled={!item.groupId}
                  onClick={() => moveItemToGroup(item.id, null)}
                >
                  <span className="min-w-0 truncate">{t("boq_unassigned")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => splitItemToNewGroup(item)}
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  aria-label={t("boq_split_item")}
                >
                  <Scissors size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("boq_split_item")}</TooltipContent>
            </Tooltip>
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
      size: 175,
    }),
  ], [t, locale, updateBoqCell, deleteBoqRow, boqGroups, moveItemToGroup, splitItemToNewGroup, handleRowDragStart, deselectedIds, toggleItemSelected])

  const boqTable = useReactTable({
    data: boqItems,
    columns: boqColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const allBoqRows = boqTable.getRowModel().rows

  // These all used to be recomputed on every render, including the many re-renders that fire
  // during drag-and-drop — memoized so a drag gesture only redoes this work when the underlying
  // items/groups/selection actually change, not on every intermediate render.
  const unassignedBoqRows = useMemo(() => allBoqRows.filter((r) => !r.original.groupId), [allBoqRows])
  const boqGrandTotal = useMemo(
    () => boqItems.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0),
    [boqItems]
  )

  // Groups eligible to publish: at least one selected, unlocked item assigned to a named section.
  // Unassigned items are never publishable, matching the BOQ-to-RFQ convention (a section = one RFQ).
  const publishableGroupIds = useMemo(() => new Set(
    boqGroups
      .filter((g) => allBoqRows.some((r) => r.original.groupId === g.id && r.original.isEditable !== false && !deselectedIds.has(r.original.id)))
      .map((g) => g.id)
  ), [boqGroups, allBoqRows, deselectedIds])
  const totalSelectedForPublish = useMemo(() => allBoqRows.filter(
    (r) => r.original.groupId && publishableGroupIds.has(r.original.groupId) && r.original.isEditable !== false && !deselectedIds.has(r.original.id)
  ).length, [allBoqRows, publishableGroupIds, deselectedIds])
  // A typed draw that is zero, negative, or more than the line has left blocks
  // the publish — the same rule handlePublish clamps by, surfaced before the click.
  const hasInvalidDraw = useMemo(() => boqItems.some((i) => {
    if (!i.groupId || !publishableGroupIds.has(i.groupId) || i.isEditable === false || deselectedIds.has(i.id)) return false
    const typed = publishQtys[i.id]
    if (typed === undefined || typed === "") return false
    const n = Number(typed)
    return !Number.isFinite(n) || n <= 0 || n > boqRemaining(i)
  }), [boqItems, publishableGroupIds, deselectedIds, publishQtys])
  const canPublish = publishableGroupIds.size > 0

  // Shared row/table renderer for both grouped sections and the Unassigned bucket —
  // reuses the single memoized boqTable's header/cell definitions, just scoped to a row subset.
  const renderBoqRows = (rows: Row<BoqItem>[]) => (
    <table className="w-full text-sm" style={{ minWidth: 640 }}>
      <thead>
        {boqTable.getHeaderGroups().map((hg) => (
          <tr key={hg.id}>
            {hg.headers.map((header) => (
              <th
                key={header.id}
                className={cn(
                  "px-3 py-2 text-xs font-bold text-muted-foreground whitespace-nowrap bg-muted/40 border-b",
                  // `uppercase` and letter-spacing are Latin typographic devices. Applied
                  // to Arabic, tracking breaks the cursive joins between letters — the
                  // project rules forbid it outright — and uppercase does nothing.
                  isRtl ? "text-right" : "text-left uppercase tracking-wide"
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
          <BoqTableRow
            key={row.original.id}
            row={row}
            columns={boqColumns}
            zebra={i % 2 === 0}
            isLastAdded={lastAddedItemId === row.original.id}
            rowRefs={boqRowRefs}
          />
        ))}
      </tbody>
    </table>
  )

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
    { key: "purchaseRequests", label: t("proj_tab_purchase_requests"), icon: <ClipboardList size={15} /> },
    { key: "team", label: t("proj_tab_team"), icon: <Users size={15} /> },
    ...dynamicTabs.map((id) => ({
      key: id as ActiveTab,
      label: tShared(sectionLabelKey(id)),
      icon: id === "ipc" ? <Receipt size={15} /> : id === "store" ? <Warehouse size={15} /> : id === "mfg" ? <Factory size={15} /> : <Sparkles size={15} />,
    })),
  ]

  const openManageSections = () => {
    setPendingSections(new Set(enabledSectionIds))
    setShowManageSections(true)
  }

  const handleSaveSections = async () => {
    if (!firestore) return
    setIsSavingSections(true)
    try {
      await updateDoc(doc(firestore, "projects", projectId), {
        enabledSections: Array.from(pendingSections),
        updatedAt: serverTimestamp(),
      })
      toast({ title: t("proj_manage_sections_saved") })
      setShowManageSections(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
    } finally {
      setIsSavingSections(false)
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-5 max-w-5xl mx-auto">
        {/* A project handed over from the CRM waits here for its PM to
            accept it — above the header, because until they do the project
            has no owner. */}
        {typedProject.handover && (
          <ProjectHandoverBanner
            projectId={projectId}
            projectName={typedProject.name || ""}
            handover={typedProject.handover}
          />
        )}

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
                  {translateOrRaw(t, typedProject.projectType)}
                </Badge>
              )}
              {typedProject.clientType && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Building2 size={11} />
                  {translateOrRaw(t, typedProject.clientType)}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {can("projects.edit") && (
              <Button variant="outline" size="sm" onClick={openManageSections} className="gap-1">
                <Settings2 size={14} />
                {t("proj_manage_sections_btn")}
              </Button>
            )}
            {can("projects.edit") && (
              <Button variant="outline" size="sm" onClick={startEdit} className="gap-1">
                <Pencil size={14} />
                {t("proj_edit")}
              </Button>
            )}
            {can("projects.delete") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
                className="gap-1 text-destructive border-destructive/30 hover:bg-destructive hover:text-white hover:border-destructive"
              >
                <Trash2 size={14} />
                {t("proj_delete")}
              </Button>
            )}
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

        {/* Tab nav — a wrapping segmented control rather than an underlined strip.
            The tab count is dynamic (five fixed plus however many sections are
            enabled), so any single-row layout eventually overflows: it either broke
            each Arabic label across two lines, or scrolled sideways with no obvious
            sign there was more. Wrapping keeps every tab visible at every width and
            needs no interaction to discover. */}
        <div
          role="tablist"
          aria-label={t("proj_tabs_label")}
          className="flex flex-wrap items-center gap-0.5 p-1 rounded-xl border bg-muted/40"
        >
          {tabs.map((tab) => (
            <div key={tab.key} className="flex items-center">
              <button
                type="button"
                role="tab"
                onClick={() => handleTabChange(tab.key)}
                aria-selected={activeTab === tab.key}
                aria-current={activeTab === tab.key ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  activeTab === tab.key
                    ? "bg-background text-primary shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                )}
              >
                <span className="shrink-0">{tab.icon}</span>
                {tab.label}
              </button>
              {tab.key === "boq" && (
                <button
                  type="button"
                  onClick={() => {
                    handleTabChange("boq")
                    addBoqRow()
                  }}
                  aria-label={t("proj_boq_add_row")}
                  title={t("proj_boq_add_row")}
                  className="h-6 w-6 ms-0.5 me-1 rounded-md flex items-center justify-center text-primary bg-primary/10 hover:bg-primary/20 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  <Plus size={13} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* ── TAB: INFO ── */}
        {activeTab === "info" && (
          <div className="space-y-4">
          <Card className="border-primary/15">
            <CardContent className="p-6" dir={isRtl ? "rtl" : "ltr"}>
              {isEditing ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="font-semibold">{t("proj_name")}</Label>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-10 rounded-xl" disabled={isSaving} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-semibold">{t("proj_client_name")}</Label>
                    <Input value={editClientName} onChange={(e) => setEditClientName(e.target.value)} placeholder={t("proj_client_name_placeholder")} className="h-10 rounded-xl" disabled={isSaving} />
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
                      <div className="relative">
                        <Input type="number" min={0} value={editBudget} onChange={(e) => setEditBudget(e.target.value)} className="h-10 rounded-xl pe-14" disabled={isSaving} dir="ltr" />
                        <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium pointer-events-none">
                          {locale === "ar" ? "ر.س" : "SAR"}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="font-semibold">{t("proj_waste_target")}</Label>
                      <div className="relative">
                        <Input type="number" min={0} max={100} value={editWasteTarget} onChange={(e) => setEditWasteTarget(e.target.value)} className="h-10 rounded-xl pe-9" disabled={isSaving} dir="ltr" />
                        <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium pointer-events-none">%</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-semibold">{t("proj_status")}</Label>
                    <Select value={editStatus} onValueChange={(v) => setEditStatus(v as ProjectStatus)} disabled={isSaving}>
                      <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PROJECT_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{t(projectStatusLabelKey(s))}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-semibold flex items-center gap-1.5">
                      <Warehouse size={14} className="text-muted-foreground" />
                      {t("proj_warehouse_link")}
                    </Label>
                    <Select
                      value={editWarehouseId || "__none__"}
                      onValueChange={(v) => setEditWarehouseId(v === "__none__" ? "" : v)}
                      disabled={isSaving}
                    >
                      <SelectTrigger className="h-10 rounded-xl">
                        <SelectValue placeholder={t("proj_warehouse_placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("proj_warehouse_none")}</SelectItem>
                        {projectWarehouses.map((w) => (
                          <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                        ))}
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
                  {typedProject.clientName && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <User size={16} className="text-primary shrink-0" />
                      <span>
                        <span className="font-semibold text-slate-500 text-xs block">{t("proj_client_name")}</span>
                        {typedProject.clientName}
                      </span>
                    </div>
                  )}
                  {typedProject.budget != null && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <DollarSign size={16} className="text-success shrink-0" />
                      <span>
                        <span className="font-semibold text-slate-500 text-xs block">{t("proj_budget_label")}</span>
                        {typedProject.budget.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")} {locale === "ar" ? "ر.س" : "SAR"}
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
                  {typedProject.warehouseId && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Warehouse size={16} className="text-accent shrink-0" />
                      <span>
                        <span className="font-semibold text-slate-500 text-xs block">{t("proj_warehouse_link")}</span>
                        {projectWarehouses.find((w) => w.id === typedProject.warehouseId)?.name || typedProject.warehouseId}
                      </span>
                    </div>
                  )}
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

          {can("offers.accept") && (
            <Card className="border-primary/15">
              <CardContent className="p-6">
                <h3 className="font-bold text-base flex items-center gap-2 text-slate-800 mb-4">
                  <Banknote size={17} className="text-primary" />
                  {t("moneyflow_title")}
                </h3>
                <MoneyFlowViz projectId={projectId} />
              </CardContent>
            </Card>
          )}

          {can("offers.accept") && (
            <Card className="border-primary/15">
              <CardContent className="p-6">
                <FinanceAuditLog projectId={isDeleting ? undefined : projectId} />
              </CardContent>
            </Card>
          )}
          </div>
        )}

        {/* ── TAB: BOQ ── */}
        {activeTab === "boq" && (
          <div className="space-y-4">
              {/* Stats bar */}
              {/* Three numbers do not need three tall cards. As a single strip this band
                  drops from 72px to roughly 40px, which is 30px of the sheet you can
                  actually see — the grand total still carries the visual weight. */}
              {(boqItems.length > 0 || boqGroups.length > 0) && (
                <div className="flex items-center gap-x-5 gap-y-1 flex-wrap rounded-xl border bg-card px-4 py-2 text-sm">
                  <span className="flex items-baseline gap-1.5">
                    <b className="font-black text-foreground tabular-nums" dir="ltr">{boqItems.length}</b>
                    <span className="text-xs text-muted-foreground">{t("proj_boq_stat_items")}</span>
                  </span>
                  <span className="h-3.5 w-px bg-border" aria-hidden />
                  <span className="flex items-baseline gap-1.5">
                    <b className="font-black text-foreground tabular-nums" dir="ltr">{boqGroups.length}</b>
                    <span className="text-xs text-muted-foreground">{t("proj_boq_stat_sections")}</span>
                  </span>
                  <span className="flex items-baseline gap-1.5 ms-auto">
                    <span className="text-xs text-muted-foreground">{t("proj_boq_total")}</span>
                    <b className="font-black text-primary">
                      {boqGrandTotal.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")} {t("offers_currency_sar")}
                    </b>
                  </span>
                </div>
              )}

              {/* Toolbar. Grouped by weight rather than hidden: importing a BOQ and
                  selecting which rows go out to tender are both core to the workflow,
                  so they stay on the surface. Crowding is handled by button *weight* —
                  outline for the sheet-building actions, ghost for selection — and by
                  keeping the two warehouse actions behind one trigger. */}
              <div className="flex items-center justify-between gap-3 flex-wrap bg-card border rounded-xl p-2.5">
                <input
                  ref={boqFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleBoqFile}
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => boqFileRef.current?.click()}
                    disabled={boqParsing}
                    className="gap-1.5"
                    title={t("proj_boq_upload_hint")}
                  >
                    {boqParsing ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
                    {boqParsing ? t("proj_boq_parsing") : t("proj_boq_upload")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => addBoqRow()} className="gap-1.5">
                    <Plus size={14} />
                    {t("proj_boq_add_row")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={addBoqGroup} className="gap-1.5">
                    <Layers size={14} />
                    {t("proj_boq_add_section")}
                  </Button>
                  {boqItems.length > 0 && (() => {
                    const editableRows = allBoqRows.filter((r) => r.original.isEditable !== false)
                    const allDeselected = editableRows.every((r) => deselectedIds.has(r.original.id))
                    return (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDeselectedIds(allDeselected ? new Set() : new Set(editableRows.map((r) => r.original.id)))
                        }
                        className="gap-1.5 text-muted-foreground h-8 text-xs"
                      >
                        {/* An icon, not a <Checkbox> — Radix renders that as a <button>,
                            and a button inside a button is invalid HTML that trips
                            React's hydration check. */}
                        {allDeselected ? <Square size={13} /> : <CheckSquare size={13} />}
                        {allDeselected ? t("rfq_select_all") : t("rfq_deselect_all")}
                      </Button>
                    )
                  })()}
                </div>

                <div className="flex items-center gap-2 flex-wrap ms-auto">
                  {/* Both warehouse actions behind one trigger — they belong together and
                      only exist when the project actually has stock linked to it. */}
                  {typedProject?.warehouseId && linkedInventoryItems.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1.5 border-primary/30 text-primary hover:bg-primary/5 hover:text-primary">
                          <Warehouse size={14} />
                          {t("proj_boq_warehouse_menu")}
                          <ChevronDown size={13} className="opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align={isRtl ? "start" : "end"} className="w-64">
                        <DropdownMenuItem
                          className="gap-2"
                          disabled={!boqLoaded}
                          onSelect={() => { setSuggestedTakenQtys({}); setIsConsumeDialogOpen(true) }}
                        >
                          <Warehouse size={14} />
                          {t("proj_boq_consume_btn")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2"
                          disabled={boqItems.length === 0}
                          onSelect={() => setIsSuggestMaterialsOpen(true)}
                        >
                          <Sparkles size={14} />
                          {t("proj_suggest_materials_btn")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <Button size="sm" onClick={() => saveBoq()} disabled={boqSaving || (boqItems.length === 0 && boqGroups.length === 0)} className="gap-1.5">
                    {boqSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                    {t("proj_boq_save")}
                  </Button>
                  {can("projects.publish") && <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsPublishDialogOpen(true)}
                    disabled={!canPublish}
                    className="gap-1.5 border-accent/30 text-accent hover:bg-accent/10 hover:text-accent hover:border-accent/50"
                  >
                    <Send size={14} />
                    {t("proj_boq_push_to_tender")}
                  </Button>}
                </div>
              </div>

              {boqItems.length === 0 && boqGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-16 bg-muted/30 rounded-xl border border-dashed text-center gap-3">
                  <TableProperties size={40} className="text-muted-foreground/30" />
                  <div>
                    <p className="font-semibold text-foreground">{t("proj_boq_empty")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("proj_boq_empty_desc")}</p>
                  </div>
                  {/* An empty sheet is the one moment importing matters most, and the
                      toolbar offered no way in — the upload sat unlabelled behind «⋯». */}
                  <div className="flex items-center gap-2 flex-wrap justify-center mt-1">
                    <Button size="sm" onClick={() => boqFileRef.current?.click()} disabled={boqParsing} className="gap-1.5">
                      {boqParsing ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
                      {boqParsing ? t("proj_boq_parsing") : t("proj_boq_upload")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => addBoqRow()} className="gap-1.5">
                      <Plus size={14} />
                      {t("proj_boq_add_row")}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("proj_boq_upload_hint")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {boqGroups.map((group) => {
                    const groupRows = allBoqRows.filter((r) => r.original.groupId === group.id)
                    const unlockedGroupRows = groupRows.filter((r) => r.original.isEditable !== false)
                    const selectedGroupCount = unlockedGroupRows.filter((r) => !deselectedIds.has(r.original.id)).length
                    const allGroupSelected = unlockedGroupRows.length > 0 && selectedGroupCount === unlockedGroupRows.length
                    const someGroupSelected = selectedGroupCount > 0 && !allGroupSelected
                    const isCollapsed = collapsedGroups.has(group.id)
                    const groupTotal = groupRows.reduce(
                      (sum, r) => sum + (Number(r.original.quantity) || 0) * (Number(r.original.unitPrice) || 0),
                      0
                    )
                    return (
                      <div
                        key={group.id}
                        data-boq-dropzone={group.id}
                        className="rounded-xl border border-border bg-card overflow-hidden transition-all shadow-sm"
                      >
                        {/* Two tiers, not one wrapping cram. The identity of the
                            section (name, size, money) is the first line and is all
                            most people ever read; the things you set once — its
                            category — and the destructive action sit on a quieter
                            second line that only exists while the section is open. */}
                        <div className="bg-primary/[0.04] border-b border-primary/15">
                          <div className="flex items-center gap-2 px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => toggleGroupCollapsed(group.id)}
                              aria-label={isCollapsed ? t("proj_boq_expand_section") : t("proj_boq_collapse_section")}
                              aria-expanded={!isCollapsed}
                              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                            >
                              {isCollapsed ? <ChevronRight size={15} className="rtl-flip" /> : <ChevronDown size={15} />}
                            </button>
                            <Layers size={14} className="text-primary shrink-0" />
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Input
                                  value={group.titleAr}
                                  onChange={(e) => updateBoqGroup(group.id, "titleAr", e.target.value)}
                                  className="h-8 text-sm font-bold flex-1 min-w-[140px] rounded-lg bg-background truncate"
                                  dir="rtl"
                                />
                              </TooltipTrigger>
                              {group.titleAr && group.titleAr.length > 40 && (
                                <TooltipContent className="max-w-xs" side="bottom">{group.titleAr}</TooltipContent>
                              )}
                            </Tooltip>

                            {/* Counts and money read as text, not as a row of pills —
                                two outline badges next to a badge-shaped select made
                                the band look like a toolbar rather than a heading. */}
                            <span className="hidden sm:flex items-baseline gap-1.5 shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                              <b className="font-bold text-foreground tabular-nums" dir="ltr">{groupRows.length}</b>
                              {t("proj_boq_stat_items")}
                            </span>
                            {groupTotal > 0 && (
                              <>
                                <span className="hidden sm:block h-3.5 w-px bg-border shrink-0" aria-hidden="true" />
                                <span className="shrink-0 text-xs font-bold text-primary tabular-nums whitespace-nowrap" dir="ltr">
                                  {groupTotal.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")} {t("offers_currency_sar")}
                                </span>
                              </>
                            )}
                            {unlockedGroupRows.length > 0 && (
                              <div
                                className="flex items-center gap-1.5 h-7 px-1.5 rounded-lg hover:bg-background transition-colors cursor-pointer shrink-0"
                                onClick={() => setGroupSelected(group.id, !allGroupSelected)}
                                title={t("boq_select_item")}
                              >
                                <Checkbox
                                  checked={allGroupSelected ? true : someGroupSelected ? "indeterminate" : false}
                                  onCheckedChange={(checked) => setGroupSelected(group.id, !!checked)}
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={t("boq_select_item")}
                                />
                                <span className="text-[10px] font-bold text-muted-foreground whitespace-nowrap tabular-nums">
                                  {selectedGroupCount}/{unlockedGroupRows.length}
                                </span>
                              </div>
                            )}
                          </div>

                          {!isCollapsed && (
                            <div className="flex items-center gap-2 px-3 pb-2.5 ps-12">
                              <div className="w-52 max-w-full">
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
                              <button
                                type="button"
                                onClick={() => deleteBoqGroup(group.id)}
                                aria-label={t("proj_boq_delete_section")}
                                className="ms-auto h-7 px-2 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                              >
                                <Trash2 size={13} />
                                <span className="hidden sm:inline">{t("proj_boq_delete_section")}</span>
                              </button>
                            </div>
                          )}
                        </div>
                        {!isCollapsed && (
                          <>
                            {groupRows.length === 0 ? (
                              <div className="p-6 text-center text-xs text-muted-foreground">{t("proj_boq_section_empty_hint")}</div>
                            ) : (
                              <div className="overflow-x-auto">{renderBoqRows(groupRows)}</div>
                            )}
                            <button
                              type="button"
                              onClick={() => addBoqRow(group.id)}
                              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-primary/5 border-t border-dashed border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                            >
                              <Plus size={13} />
                              {t("proj_boq_add_row")}
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })}

                  {/* Unassigned — always shown as a drop target */}
                  <div
                    data-boq-dropzone="unassigned"
                    className="rounded-xl border border-dashed border-border bg-card overflow-hidden transition-all shadow-sm"
                  >
                    {/* Same band metrics as a real section — px-3 py-2.5, same
                        chevron, same count treatment — so the two read as one
                        sheet. Only the dashed border and muted ground say
                        "these rows are not filed yet". */}
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/40 border-b border-border">
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapsed("unassigned")}
                        aria-label={collapsedGroups.has("unassigned") ? t("proj_boq_expand_section") : t("proj_boq_collapse_section")}
                        aria-expanded={!collapsedGroups.has("unassigned")}
                        className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      >
                        {collapsedGroups.has("unassigned") ? <ChevronRight size={15} className="rtl-flip" /> : <ChevronDown size={15} />}
                      </button>
                      <Package size={14} className="text-muted-foreground shrink-0" />
                      <span className="text-sm font-bold text-muted-foreground flex-1 min-w-0 truncate">{t("boq_unassigned")}</span>
                      <span className="flex items-baseline gap-1.5 shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                        <b className="font-bold text-foreground tabular-nums" dir="ltr">{unassignedBoqRows.length}</b>
                        {t("proj_boq_stat_items")}
                      </span>
                    </div>
                    {!collapsedGroups.has("unassigned") && (
                      <>
                        {unassignedBoqRows.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">{t("proj_boq_section_empty_hint")}</div>
                        ) : (
                          <div className="overflow-x-auto">{renderBoqRows(unassignedBoqRows)}</div>
                        )}
                        <button
                          type="button"
                          onClick={() => addBoqRow(null)}
                          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-primary/5 border-t border-dashed border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                        >
                          <Plus size={13} />
                          {t("proj_boq_add_row")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {/* Sits below the sheet, not above it. This reports on the BOQ rather than
                  introducing it, and as a band above the toolbar it pushed the actual
                  work off the first screen. */}
              {projectId && !isDeleting && (
                <WasteLedger
                  scope={{ projectId }}
                  projectName={typedProject?.name || ""}
                  wasteTargetPercent={typedProject?.wasteTargetPercent ?? 12}
                  canManage={can("projects.edit")}
                  t={t}
                  locale={locale}
                />
              )}
          </div>
        )}

        {/* ── TAB: RFQS ── */}
        {activeTab === "rfqs" && (
          <Card className="border-primary/15">
            <CardHeader className="border-b pb-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText size={20} className="text-primary" />
                  {t("proj_rfqs")}
                  {filteredLinkedRfqs.length > 0 && (
                    <Badge variant="secondary" className="ms-2">{filteredLinkedRfqs.length}</Badge>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center rounded-lg border p-0.5">
                    <button
                      type="button"
                      onClick={() => setTenderViewMode("grid")}
                      title={t("rfq_view_grid")}
                      aria-label={t("rfq_view_grid")}
                      aria-pressed={tenderViewMode === "grid"}
                      className={cn(
                        "h-7 w-7 rounded-md flex items-center justify-center transition-colors",
                        tenderViewMode === "grid" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <LayoutGrid size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTenderViewMode("list")}
                      title={t("rfq_view_list")}
                      aria-label={t("rfq_view_list")}
                      aria-pressed={tenderViewMode === "list"}
                      className={cn(
                        "h-7 w-7 rounded-md flex items-center justify-center transition-colors",
                        tenderViewMode === "list" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <List size={14} />
                    </button>
                  </div>
                  {tenderViewMode === "list" && (
                    <ColumnCustomizer columns={rfqColumns} isVisible={isRfqColVisible} toggle={toggleRfqCol} />
                  )}
                  <Button size="sm" className="gap-1.5" onClick={() => router.push(`/contractor/projects/${projectId}/tenders/new`)}>
                    <Plus size={14} />
                    {t("proj_new_tender")}
                  </Button>
                </div>
              </div>

              {/* Status filter tabs */}
              <div className="flex items-center gap-2 flex-wrap pt-3">
                {[
                  { value: "all" as const, label: t("rfq_all") },
                  { value: "Draft" as const, label: t("rfq_status_draft") },
                  { value: "New" as const, label: t("rfq_status_active") },
                  { value: "Awarded" as const, label: t("rfq_status_completed") },
                ].map((opt) => (
                  <Button
                    key={opt.value}
                    variant={tenderStatusFilter === opt.value ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs rounded-lg"
                    onClick={() => { setTenderStatusFilter(opt.value); setSelectedTenderIds([]) }}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>

              {/* Search + filters */}
              <div className="flex flex-wrap items-center gap-2 pt-3">
                <div className="relative">
                  <Search className={cn("absolute top-1/2 -translate-y-1/2 text-slate-400", isRtl ? "right-3" : "left-3")} size={15} />
                  <Input
                    placeholder={t("rfq_search_placeholder")}
                    value={tenderSearchQuery}
                    onChange={(e) => setTenderSearchQuery(e.target.value)}
                    className={cn("h-9 w-full sm:w-56 text-sm rounded-lg", isRtl ? "pr-9" : "pl-9")}
                  />
                </div>
                <Select value={tenderCategoryFilter} onValueChange={(v) => { setTenderCategoryFilter(v); setSelectedTenderIds([]) }}>
                  <SelectTrigger className="w-[170px] h-9 text-xs rounded-lg"><SelectValue placeholder={t("rfq_category_filter")} /></SelectTrigger>
                  <SelectContent className="max-h-72 overflow-y-auto">
                    <SelectItem value="all">{t("rfq_all_categories")}</SelectItem>
                    {PREDEFINED_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>{displayCategory(cat, locale)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={tenderCityFilter} onValueChange={(v) => { setTenderCityFilter(v); setSelectedTenderIds([]) }}>
                  <SelectTrigger className="w-[170px] h-9 text-xs rounded-lg"><SelectValue placeholder={t("rfq_city_filter")} /></SelectTrigger>
                  <SelectContent className="max-h-72 overflow-y-auto">
                    <SelectItem value="all">{t("rfq_all_cities")}</SelectItem>
                    {SAUDI_CITIES.map((city) => (
                      <SelectItem key={city} value={city}>{displayCity(city, locale)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={tenderDeadlineFilter} onValueChange={(v) => setTenderDeadlineFilter(v as typeof tenderDeadlineFilter)}>
                  <SelectTrigger className="w-[170px] h-9 text-xs rounded-lg"><SelectValue placeholder={t("rfq_deadline_filter")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("rfq_all_deadlines")}</SelectItem>
                    <SelectItem value="week">{t("rfq_within_week")}</SelectItem>
                    <SelectItem value="month">{t("rfq_within_month")}</SelectItem>
                    <SelectItem value="custom">{t("rfq_custom_date")}</SelectItem>
                  </SelectContent>
                </Select>
                {tenderDeadlineFilter === "custom" && (
                  <input
                    type="date"
                    value={tenderCustomDeadline}
                    onChange={(e) => setTenderCustomDeadline(e.target.value)}
                    className="h-9 px-3 rounded-lg border border-input bg-white text-xs w-[135px]"
                  />
                )}
                {hasActiveTenderFilters && (
                  <Button variant="ghost" size="sm" onClick={clearTenderFilters} className="h-9 text-xs text-muted-foreground hover:text-destructive gap-1">
                    <X size={12} />
                    {t("rfq_clear_filters")}
                  </Button>
                )}
              </div>

              {filteredLinkedRfqs.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap pt-3">
                  <div className="flex items-center gap-1.5 cursor-pointer" onClick={toggleSelectAllTenders}>
                    <Checkbox
                      checked={selectedTenderIds.length > 0 && selectedTenderIds.length === filteredLinkedRfqs.length ? true : selectedTenderIds.length > 0 ? "indeterminate" : false}
                      onCheckedChange={toggleSelectAllTenders}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="text-xs font-semibold text-muted-foreground">{t("rfq_select_all")}</span>
                  </div>
                  {selectedTenderIds.length > 0 && (
                    <>
                      <Button
                        size="sm"
                        onClick={handleBulkPublishTenders}
                        disabled={isBulkPublishingTenders}
                        className="gap-1.5 bg-success hover:bg-success/90 h-8 text-xs"
                      >
                        {isBulkPublishingTenders ? <Loader2 className="animate-spin" size={13} /> : <Send size={13} />}
                        {t("rfq_batch_publish", { count: selectedTenderIds.length })}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowBulkTenderDeleteDialog(true)}
                        disabled={isBulkDeletingTenders}
                        className="gap-1.5 h-8 text-xs border-red-200 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={13} />
                        {t("rfq_delete_selected", { count: selectedTenderIds.length })}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedTenderIds([])}
                        className="gap-1.5 h-8 text-xs text-muted-foreground"
                      >
                        <X size={12} />
                        {t("rfq_deselect_all")}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="p-4">
              {rfqsLoading ? (
                <div className="flex items-center justify-center p-10">
                  <Loader2 className="animate-spin text-muted-foreground" size={24} />
                </div>
              ) : filteredLinkedRfqs.length === 0 ? (
                <div className="text-center p-10 bg-slate-50 rounded-lg border border-dashed text-muted-foreground">
                  <FileText size={36} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm">{hasActiveTenderFilters ? t("rfq_no_matching") : t("proj_rfqs_empty")}</p>
                </div>
              ) : tenderViewMode === "list" ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead className="text-right">{t("proj_rfqs")}</TableHead>
                        {isRfqColVisible("category") && <TableHead className="text-right">{t("proj_category")}</TableHead>}
                        {isRfqColVisible("status") && <TableHead className="text-right">{t("proj_status")}</TableHead>}
                        {isRfqColVisible("offers_count") && <TableHead className="text-right">{t("proj_offers_count_label")}</TableHead>}
                        <TableHead className="text-left"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLinkedRfqs.map((rfq) => {
                        const r = rfq as { id: string; title?: string; category?: string; status?: string; offersCount?: number; deadline?: string; pdfUrl?: string }
                        const editable = canEditOrDeleteTender(r)
                        return (
                          <TableRow key={r.id}>
                            <TableCell>
                              <Checkbox checked={selectedTenderIds.includes(r.id)} onCheckedChange={() => toggleSelectTender(r.id)} />
                            </TableCell>
                            <TableCell className="font-bold text-slate-800 max-w-[220px] truncate">{r.title || r.id}</TableCell>
                            {isRfqColVisible("category") && <TableCell className="text-sm text-muted-foreground">{r.category}</TableCell>}
                            {isRfqColVisible("status") && <TableCell>{getTenderStatusBadge(r)}</TableCell>}
                            {isRfqColVisible("offers_count") && <TableCell className="text-sm">{r.offersCount || 0}</TableCell>}
                            <TableCell className="text-left">
                              <div className="flex items-center justify-end gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link href={`/contractor/projects/${projectId}/tenders/${r.id}/offers`}>
                                      <button type="button" className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                                        <Eye size={14} />
                                      </button>
                                    </Link>
                                  </TooltipTrigger>
                                  <TooltipContent>{t("rfq_view_offers")}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link href={`/contractor/projects/${projectId}/tenders/${r.id}/offers?tab=inquiries`}>
                                      <button type="button" className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                                        <MessageCircle size={14} />
                                      </button>
                                    </Link>
                                  </TooltipTrigger>
                                  <TooltipContent>{t("rfq_inquiries")}</TooltipContent>
                                </Tooltip>
                                {r.pdfUrl && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <a href={r.pdfUrl} target="_blank" rel="noopener noreferrer" download
                                        className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                                        <File size={14} />
                                      </a>
                                    </TooltipTrigger>
                                    <TooltipContent>{t("rfq_download_pdf")}</TooltipContent>
                                  </Tooltip>
                                )}
                                {can("rfq.manage") && editable && isTenderExpired(r) && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setRepublishTarget({ id: r.id, title: r.title })
                                          setRepublishDeadline("")
                                          seedRepublishAudience(r.id)
                                        }}
                                        className="h-7 w-7 rounded-lg flex items-center justify-center text-amber-600 hover:bg-amber-50 transition-colors"
                                      >
                                        <RotateCw size={14} />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>{t("rfq_republish")}</TooltipContent>
                                  </Tooltip>
                                )}
                                {editable && r.status === "Draft" && can("projects.publish") && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => handlePublishTender(r.id)}
                                        disabled={publishingTenderId === r.id}
                                        className="h-7 w-7 rounded-lg flex items-center justify-center text-success hover:bg-success/10 transition-colors"
                                      >
                                        {publishingTenderId === r.id ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>{t("newrfq_publish_now")}</TooltipContent>
                                  </Tooltip>
                                )}
                                {editable && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Link href={`/contractor/projects/${projectId}/tenders/new?edit=${r.id}`}>
                                        <button type="button" className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                                          <Pencil size={14} />
                                        </button>
                                      </Link>
                                    </TooltipTrigger>
                                    <TooltipContent>{t("rfq_edit_tender")}</TooltipContent>
                                  </Tooltip>
                                )}
                                {editable && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => setTenderDeleteTarget({ id: r.id, title: r.title })}
                                        className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>{t("rfq_delete_tender")}</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredLinkedRfqs.map((rfq) => {
                    const r = rfq as { id: string; title?: string; category?: string; status?: string; offersCount?: number; deadline?: string; pdfUrl?: string }
                    const editable = canEditOrDeleteTender(r)
                    return (
                      <Card key={r.id} className="border-primary/15 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 group">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                            <div className="flex items-start gap-2 min-w-0">
                              <Checkbox
                                checked={selectedTenderIds.includes(r.id)}
                                onCheckedChange={() => toggleSelectTender(r.id)}
                                className="mt-1 shrink-0"
                              />
                              <div className="min-w-0">
                                <p className="font-bold text-slate-800 truncate group-hover:text-primary transition-colors">{r.title || r.id}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{r.category}</p>
                              </div>
                            </div>
                            {getTenderStatusBadge(r)}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
                            <div className="flex items-center gap-2 bg-slate-50 px-2 py-1 rounded-md">
                              <FileText size={13} className="text-emerald-500" />
                              <span className="font-semibold">{r.offersCount || 0} {t("proj_offers_count_label")}</span>
                            </div>
                            {r.pdfUrl && (
                              <a
                                href={r.pdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                download
                                className="flex items-center gap-1.5 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-md hover:bg-blue-100 transition-colors"
                              >
                                <File size={12} />
                                {t("rfq_download_pdf")}
                              </a>
                            )}
                          </div>
                          <div className="space-y-2 pt-3 mt-1 border-t border-slate-100">
                            <div className="flex gap-2">
                              <Link href={`/contractor/projects/${projectId}/tenders/${r.id}/offers`} className="flex-1">
                                <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs h-8">
                                  <Eye size={13} />
                                  {t("rfq_view_offers")}
                                </Button>
                              </Link>
                              <Link href={`/contractor/projects/${projectId}/tenders/${r.id}/offers?tab=inquiries`} className="flex-1">
                                <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs h-8">
                                  <MessageCircle size={13} />
                                  {t("rfq_inquiries")}
                                </Button>
                              </Link>
                            </div>
                            {editable && r.status === "Draft" && (
                              <Button
                                size="sm"
                                className="w-full gap-1.5 text-xs h-8 bg-success hover:bg-success/90"
                                disabled={publishingTenderId === r.id}
                                onClick={() => handlePublishTender(r.id)}
                              >
                                {publishingTenderId === r.id ? <Loader2 className="animate-spin" size={13} /> : <Send size={13} />}
                                {t("newrfq_publish_now")}
                              </Button>
                            )}
                            {can("rfq.manage") && editable && isTenderExpired(r) && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full gap-1.5 text-xs h-8 text-amber-600 border-amber-300 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-400"
                                onClick={() => {
                                          setRepublishTarget({ id: r.id, title: r.title })
                                          setRepublishDeadline("")
                                          seedRepublishAudience(r.id)
                                        }}
                              >
                                <RotateCw size={13} />
                                {t("rfq_republish")}
                              </Button>
                            )}
                            {editable && (
                              <div className="flex gap-2">
                                {/* Compact labels: the full "edit/delete RFQ" wording overflows
                                    the card and gets clipped — icons + card context carry the meaning */}
                                <Link href={`/contractor/projects/${projectId}/tenders/new?edit=${r.id}`} className="flex-1 min-w-0">
                                  <Button variant="ghost" size="sm" title={t("rfq_edit_tender")} className="w-full gap-1.5 text-xs h-8 text-slate-500 hover:text-slate-700 hover:bg-slate-100">
                                    <Pencil size={13} className="shrink-0" />
                                    <span className="truncate">{t("rfq_edit_short")}</span>
                                  </Button>
                                </Link>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title={t("rfq_delete_tender")}
                                  className="flex-1 min-w-0 gap-1.5 text-xs h-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => setTenderDeleteTarget({ id: r.id, title: r.title })}
                                >
                                  <Trash2 size={13} className="shrink-0" />
                                  <span className="truncate">{t("rfq_delete_short")}</span>
                                </Button>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
              {hasMoreTenders && filteredLinkedRfqs.length > 0 && (
                <div className="p-4 text-center">
                  <Button onClick={loadMoreTenders} variant="outline" className="font-bold">
                    {t("rfq_load_more")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── TAB: TEAM ── */}
        {activeTab === "team" && (
          <ProjectTeamSection projectId={projectId} organizationId={typedProject.organizationId || ""} />
        )}

        {activeTab === "purchaseRequests" && (
          <PurchaseRequestsTab projectId={projectId} canDecide={can("warehouses.manage")} />
        )}

        {/* ── Dynamic section tabs ── */}
        {activeTab === "ipc" && dynamicTabs.includes("ipc" as SectionId) && (
          <IpcClaimsTab projectId={projectId} canManage={can("invoices.manage")} canEditTerms={can("projects.edit")} />
        )}
        {activeTab === "store" && dynamicTabs.includes("store" as SectionId) && (
          typedProject.warehouseId ? (
            <WarehouseInventoryPanel warehouseId={typedProject.warehouseId} orgId={myOrgId} variant="embedded" />
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-10 flex flex-col items-center justify-center text-center gap-3">
                <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Warehouse size={26} className="text-primary" />
                </div>
                <div>
                  <p className="font-bold text-foreground">{t("proj_warehouse_missing_title")}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t("proj_warehouse_missing_desc")}</p>
                </div>
                {can("warehouses.manage") && (
                  <Button onClick={handleCreateProjectWarehouse} disabled={isCreatingWarehouse} className="gap-2 mt-2">
                    {isCreatingWarehouse ? <Loader2 size={15} className="animate-spin" /> : <Warehouse size={15} />}
                    {t("proj_warehouse_create_btn")}
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        )}
        {activeTab === "mfg" && dynamicTabs.includes("mfg" as SectionId) && (
          <ManufacturingView projectId={projectId} projectName={typedProject.name || ""} />
        )}
        {dynamicTabs.includes(activeTab as SectionId) && activeTab !== "ipc" && activeTab !== "store" && activeTab !== "mfg" && (
          <ComingSoonTab sectionId={activeTab as SectionId} tShared={tShared} />
        )}
      </div>

      {/* Manage sections dialog */}
      <Dialog open={showManageSections} onOpenChange={(open) => { if (!isSavingSections) setShowManageSections(open) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("proj_manage_sections_title")}</DialogTitle>
            <DialogDescription>{t("proj_manage_sections_desc")}</DialogDescription>
          </DialogHeader>
          <SectionToggleGrid
            enabledSections={pendingSections}
            onToggle={(id) => setPendingSections((prev) => (prev.has(id) ? cascadeDisable(prev, id) : cascadeEnable(prev, id)))}
            requiredHintLabel={t("proj_manage_sections_required_hint")}
            tShared={tShared}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManageSections(false)} disabled={isSavingSections}>
              {t("cancel")}
            </Button>
            <Button onClick={handleSaveSections} disabled={isSavingSections} className="gap-2">
              {isSavingSections ? <Loader2 size={15} className="animate-spin" /> : null}
              {t("proj_manage_sections_save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record site measurement */}
      <Dialog open={!!measureTarget} onOpenChange={(open) => { if (!isMeasuring && !open) setMeasureTarget(null) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ruler size={18} className="text-cta" />
              {t("measure_dialog_title")}
            </DialogTitle>
            <DialogDescription>
              {measureTarget?.itemNo ? `${measureTarget.itemNo} — ` : ""}
              {(isRtl ? measureTarget?.descriptionAr || measureTarget?.descriptionEn : measureTarget?.descriptionEn || measureTarget?.descriptionAr) || ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="measure-qty">{t("measure_qty_label")} ({measureTarget?.unit || "–"}) *</Label>
                <Input id="measure-qty" type="number" value={measureQty} onChange={(e) => setMeasureQty(e.target.value)} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="measure-date">{t("measure_date_label")}</Label>
                <Input id="measure-date" type="date" value={measureDate} onChange={(e) => setMeasureDate(e.target.value)} dir="ltr" />
              </div>
            </div>
            {measureTarget && Number(measureQty) > 0 &&
              (measureTarget.executedQuantity || 0) + Number(measureQty) > (Number(measureTarget.quantity) || 0) &&
              Number(measureTarget.quantity) > 0 && (
                <p className="text-xs text-warning font-semibold">{t("measure_overrun_warning")}</p>
              )}
            <p className="text-xs text-muted-foreground">{t("measure_reversal_hint")}</p>
            <div className="space-y-1.5">
              <Label htmlFor="measure-note">{t("measure_note_label")}</Label>
              <Textarea id="measure-note" rows={2} value={measureNote} onChange={(e) => setMeasureNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMeasureTarget(null)} disabled={isMeasuring}>{t("cancel")}</Button>
            <Button onClick={handleRecordMeasurement} disabled={isMeasuring} className="gap-2">
              {isMeasuring ? <Loader2 size={15} className="animate-spin" /> : <Ruler size={15} />}
              {t("measure_record_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Publish BOQ groups as RFQs */}
      <Dialog open={isPublishDialogOpen} onOpenChange={(open) => { if (!isPublishing) setIsPublishDialogOpen(open) }}>
        <DialogContent
          dir={isRtl ? "rtl" : "ltr"}
          // The SearchableSelect popup portals to <body> (to escape the dialog's overflow), so
          // Radix sees clicks inside it as "outside the dialog" — don't let those close the dialog.
          onInteractOutside={(e) => {
            if ((e.target as HTMLElement | null)?.closest?.("[data-searchable-select-popup]")) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("boq_push_title")}</DialogTitle>
            <DialogDescription>{t("boq_push_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Shipment mode toggle */}
            <div className="space-y-1.5">
              <Label>{t("boq_shipment_mode_label")}</Label>
              <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                {([
                  { mode: "single" as const, icon: Package, label: t("boq_shipment_single") },
                  { mode: "multiple" as const, icon: Layers, label: t("boq_shipment_multiple") },
                ]).map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPublishShipmentMode(mode)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all",
                      publishShipmentMode === mode
                        ? "bg-white text-primary shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {publishShipmentMode === "single" ? t("boq_shipment_single_desc") : t("boq_shipment_multiple_desc")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>{t("boq_city_label")} *</Label>
              <SearchableSelect
                size="md"
                value={publishCity}
                onChange={(v) => { setPublishCity(v); setPublishDistrict("") }}
                options={SAUDI_CITIES.map((c) => ({ value: c, label: displayCity(c, locale) }))}
                placeholder={t("boq_city_placeholder")}
                searchPlaceholder={t("newrfq_search_city")}
                noResultsText={t("newrfq_no_results")}
              />
            </div>

            {publishCity && CITIES_DISTRICTS[publishCity] && (
              <div className="space-y-1.5">
                <Label>{t("boq_district_label")}</Label>
                <SearchableSelect
                  size="md"
                  value={publishDistrict}
                  onChange={setPublishDistrict}
                  options={CITIES_DISTRICTS[publishCity].map((d) => ({ value: d, label: displayDistrict(d, locale) }))}
                  placeholder={t("boq_district_placeholder")}
                  searchPlaceholder={t("newrfq_search_district")}
                  noResultsText={t("newrfq_no_results")}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{t("boq_deadline_label")} *</Label>
              <input
                type="date"
                value={publishDeadline}
                onChange={(e) => setPublishDeadline(e.target.value)}
                min={new Date(Date.now() + 86400000).toISOString().split("T")[0]}
                dir="ltr"
                className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
              />
            </div>
            {/* How much of each line THIS request draws. The BOQ total is the
                reference; a phase takes part of it and the rest stays for later. */}
            <div className="space-y-1.5">
              <Label>{t("boq_draw_qty_label")}</Label>
              <p className="text-xs text-muted-foreground">{t("boq_draw_qty_desc")}</p>
              <div className="border rounded-lg divide-y max-h-56 overflow-y-auto">
                {boqItems
                  .filter((i) => i.groupId && publishableGroupIds.has(i.groupId) && i.isEditable !== false && !deselectedIds.has(i.id))
                  .map((item) => {
                    const remaining = boqRemaining(item)
                    const typed = publishQtys[item.id]
                    const value = typed === undefined ? String(remaining) : typed
                    const n = Number(value)
                    const invalid = value !== "" && (!Number.isFinite(n) || n <= 0 || n > remaining)
                    const drawn = item.drawnQuantity || 0
                    return (
                      <div key={item.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{item.descriptionAr || item.descriptionEn || item.itemNo}</p>
                          <p className="text-[11px] text-muted-foreground" dir="ltr">
                            {drawn > 0
                              ? t("boq_draw_of_remaining_drawn", { remaining, total: Number(item.quantity) || 0, drawn, unit: item.unit })
                              : t("boq_draw_of_remaining", { remaining, unit: item.unit })}
                          </p>
                        </div>
                        <Input
                          type="number"
                          min={0}
                          max={remaining}
                          step="any"
                          value={value}
                          onChange={(e) => setPublishQtys((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          dir="ltr"
                          aria-invalid={invalid}
                          aria-label={t("boq_draw_qty_label")}
                          className={cn("h-8 w-28 text-sm tabular-nums", invalid && "border-destructive focus-visible:ring-destructive")}
                        />
                      </div>
                    )
                  })}
              </div>
            </div>
            <p className="text-xs text-muted-foreground bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
              {isRtl
                ? `${publishableGroupIds.size} طلب عروض أسعار سيُنشأ من ${totalSelectedForPublish} بند محدد`
                : `${publishableGroupIds.size} RFQs will be created from ${totalSelectedForPublish} selected items`}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPublishDialogOpen(false)} disabled={isPublishing}>
              {t("cancel")}
            </Button>
            <Button
              onClick={handlePublish}
              disabled={isPublishing || !publishDeadline || !publishCity || hasInvalidDraw}
              title={hasInvalidDraw ? t("boq_draw_invalid") : undefined}
              className="gap-2"
            >
              {isPublishing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {t("newrfq_publish_now")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlink BOQ item from RFQ dialog */}
      <AlertDialog open={!!unlinkTarget} onOpenChange={(open) => !open && !isUnlinking && setUnlinkTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("proj_boq_unlink_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("proj_boq_unlink_desc", { item: unlinkTarget?.descriptionAr || unlinkTarget?.descriptionEn || unlinkTarget?.itemNo || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnlinking}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnlink} disabled={isUnlinking}>
              {isUnlinking ? <Loader2 className="animate-spin" size={14} /> : null}
              {t("proj_boq_unlock")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Republish tender dialog */}
      <Dialog open={!!republishTarget} onOpenChange={(open) => { if (!open) { setRepublishTarget(null); setRepublishDeadline("") } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rfq_republish_title")}</DialogTitle>
            <DialogDescription>
              {t("rfq_republish_desc", { title: republishTarget?.title || "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label>{t("rfq_republish_deadline_label")}</Label>
              <input
                type="date"
                value={republishDeadline}
                onChange={(e) => setRepublishDeadline(e.target.value)}
                className="h-10 w-full px-3 rounded-xl border border-input bg-white text-sm"
                min={new Date().toISOString().split("T")[0]}
              />
            </div>

            {/* Reopening a tender is the moment to reconsider who sees it —
                the first round going unanswered is usually why it is here. */}
            <div className="space-y-2">
              <Label>{t("newrfq_visibility_label")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { mode: "public" as const, icon: Globe, label: t("newrfq_visibility_public") },
                  { mode: "private" as const, icon: Lock, label: t("newrfq_visibility_private") },
                ]).map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRepublishVisibility(mode)}
                    disabled={isRepublishingTender}
                    className={cn(
                      "flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-bold transition-all",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      republishVisibility === mode
                        ? "bg-primary text-white border-primary shadow-sm"
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                    )}
                  >
                    <Icon size={16} className="shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {republishVisibility === "private" && (
              <SupplierRecipientsPicker
                id="republish-recipients"
                options={supplierOptions}
                selected={republishRecipients}
                onChange={setRepublishRecipients}
                disabled={isRepublishingTender}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRepublishTarget(null); setRepublishDeadline("") }} disabled={isRepublishingTender}>{t("cancel")}</Button>
            <Button
              onClick={handleRepublishTender}
              disabled={
                !republishDeadline ||
                isRepublishingTender ||
                (republishVisibility === "private" && supplierOptions.length > 0 && republishRecipients.length === 0)
              }
            >
              {isRepublishingTender ? <Loader2 className="animate-spin" size={14} /> : <RotateCw size={14} />}
              {t("rfq_republish_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tender delete dialog */}
      <AlertDialog open={!!tenderDeleteTarget} onOpenChange={(open) => !open && setTenderDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rfq_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rfq_delete_confirm_desc", { title: tenderDeleteTarget?.title || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingTender}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTender}
              disabled={isDeletingTender}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeletingTender ? <Loader2 className="animate-spin" size={14} /> : null}
              {t("rfq_delete_tender")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk tender delete dialog */}
      <AlertDialog open={showBulkTenderDeleteDialog} onOpenChange={(open) => !open && setShowBulkTenderDeleteDialog(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rfq_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rfq_bulk_delete_confirm_desc", { count: selectedTenderIds.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeletingTenders}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDeleteTenders}
              disabled={isBulkDeletingTenders}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isBulkDeletingTenders ? <Loader2 className="animate-spin" size={14} /> : null}
              {t("rfq_delete_selected", { count: selectedTenderIds.length })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AI-suggest materials dialog — feeds its picks into the consume dialog below */}
      {typedProject?.warehouseId && (
        <SuggestMaterialsDialog
          open={isSuggestMaterialsOpen}
          onOpenChange={setIsSuggestMaterialsOpen}
          boqItems={boqItems}
          inventoryItems={linkedInventoryItems}
          t={t}
          locale={locale}
          onApply={(qtys, links) => {
            setSuggestedTakenQtys(qtys)
            setSuggestedBoqLinks(links)
            setIsConsumeDialogOpen(true)
          }}
        />
      )}

      {/* Consume from warehouse dialog — shared with the standalone waste page */}
      {typedProject?.warehouseId && (
        <WasteRecordDialog
          open={isConsumeDialogOpen}
          onOpenChange={setIsConsumeDialogOpen}
          warehouseId={typedProject.warehouseId}
          inventoryItems={linkedInventoryItems}
          boqItems={boqItems}
          wasteTargetPercent={typedProject.wasteTargetPercent ?? 12}
          initialTakenQtys={suggestedTakenQtys}
          initialBoqLinks={suggestedBoqLinks}
          locale={locale}
          t={t}
          onConsume={async (rows, exceptionReason) => {
            if (!firestore || !typedProject?.warehouseId || !user) return
            if (!boqLoaded) throw new Error("boq_not_loaded") // never save against a half-loaded list
            const newRows = rows.map((r, i) => ({
              id: `new_wh_${Date.now()}_${i}`,
              itemNo: String(boqItems.length + i + 1),
              descriptionAr: r.unitBarcodes?.length ? `${r.itemName} (${r.unitBarcodes.join("، ")})` : r.itemName,
              descriptionEn: r.unitBarcodes?.length ? `${r.itemName} (${r.unitBarcodes.join(", ")})` : r.itemName,
              quantity: String(r.quantityTaken),
              unit: r.unit,
              unitPrice: "",
              tenderId: null,
              isEditable: true,
              groupId: null,
              unitBarcodes: r.unitBarcodes || null,
            }))
            // Persist the BOQ rows FIRST. Stock deduction and waste records are already
            // committed writes — if the BOQ save fails after them, the user is left with
            // stock gone and no line to show for it. Saving first means a failure here
            // aborts before anything irreversible happens, and the dialog stays open.
            const saved = await saveBoq({ silent: true, items: [...boqItems, ...newRows] })
            if (!saved) throw new Error("boq_save_failed") // saveBoq already surfaced the error
            const actorName = profile?.name || user.email || t("proj_team_member_fallback")

            // Everything irreversible — stock deduction, barcode-unit flips, the waste
            // records — goes in ONE batch inside recordWasteConsumption. The BOQ save
            // above is still its own commit — saveBoq is shared with six other callers
            // and owns its batch. That boundary is deliberate and safe in this order:
            // if the batch fails, the BOQ has rows the user can see and delete, whereas
            // the reverse order loses stock silently.
            await recordWasteConsumption(firestore, {
              rows,
              warehouseId: typedProject.warehouseId,
              scope: { projectId },
              projectName: typedProject.name || "",
              exceptionReason: exceptionReason ?? null,
              wasteTargetPercent: typedProject.wasteTargetPercent ?? 12,
              userId: user.uid,
              userName: actorName,
            })
            toast({ title: t("proj_boq_consume_success") })
          }}
        />
      )}
    </PortalLayout>
  )
}

/** Translates a stored, free-form value only when a message actually exists for it —
 * otherwise next-intl renders the literal key path into the UI. */
function translateOrRaw(t: ReturnType<typeof useTranslations<"Portal.Contractor">>, value: string): string {
  const key = value as Parameters<typeof t>[0]
  return t.has(key) ? t(key) : value
}

type BoqMaterialSuggestion = {
  warehouseItemName: string | null
  notFoundSuggestedName: string | null
  estimatedQuantity: number
  unit: string
  reasoning: string
}
type BoqSuggestionResult = { matchType: "direct" | "composite" | "not_found"; suggestions: BoqMaterialSuggestion[] }

function SuggestMaterialsDialog({
  open,
  onOpenChange,
  boqItems,
  inventoryItems,
  t,
  locale,
  onApply,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  boqItems: { id: string; descriptionAr: string; descriptionEn: string; quantity: string; unit: string }[]
  inventoryItems: { id: string; name: string; unit: string; unitCode?: string | null; unitCost?: number | null; quantity: number; trackingMode?: "unit" | null }[]
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
  /** boqLinks maps each affected warehouse item to the BOQ line that suggested it —
   * best-effort (last suggestion wins if two BOQ lines point at the same item). */
  onApply: (takenQtys: Record<string, string>, boqLinks: Record<string, string>) => void
}) {
  const isRtl = locale === "ar"
  const { toast } = useToast()
  const candidateBoqItems = useMemo(() => boqItems.filter((b) => (b.descriptionAr || b.descriptionEn)?.trim() && Number(b.quantity) > 0), [boqItems])
  // Barcode-tracked items aren't included — a numeric suggestion can't stand in for
  // picking specific physical units, that stays a manual step in the consume dialog.
  const aggregateItems = useMemo(() => inventoryItems.filter((i) => i.trackingMode !== "unit"), [inventoryItems])
  const nameToId = useMemo(() => new Map(aggregateItems.map((i) => [i.name.trim(), i.id])), [aggregateItems])

  const [selectedBoqIds, setSelectedBoqIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<Record<string, BoqSuggestionResult>>({})
  const [includedLines, setIncludedLines] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (open) {
      setSelectedBoqIds(new Set(candidateBoqItems.map((b) => b.id)))
      setResults({})
      setIncludedLines({})
    }
    // Re-run only when the dialog opens.
  }, [open])

  const toggleBoqSelected = (id: string) => {
    setSelectedBoqIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleGetSuggestions = async () => {
    const targets = candidateBoqItems.filter((b) => selectedBoqIds.has(b.id))
    if (targets.length === 0) return
    setIsLoading(true)
    try {
      const entries = await Promise.all(targets.map(async (b) => {
        const result = await suggestBoqMaterials({
          boqItemDescription: b.descriptionAr || b.descriptionEn,
          boqQuantity: Number(b.quantity) || 0,
          boqUnit: b.unit,
          warehouseItems: aggregateItems.map((i) => ({ name: i.name, unit: i.unit, availableQuantity: i.quantity })),
        })
        return [b.id, result] as const
      }))
      const nextResults: Record<string, BoqSuggestionResult> = {}
      const nextIncluded: Record<string, boolean> = {}
      entries.forEach(([boqId, result]) => {
        nextResults[boqId] = result
        result.suggestions.forEach((s, i) => {
          if (s.warehouseItemName && nameToId.has(s.warehouseItemName.trim())) {
            nextIncluded[`${boqId}_${i}`] = true
          }
        })
      })
      setResults(nextResults)
      setIncludedLines(nextIncluded)
    } catch (err) {
      console.error(err)
      toast({ title: t("proj_suggest_materials_error"), variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  const handleApply = () => {
    const takenQtys: Record<string, string> = {}
    const boqLinks: Record<string, string> = {}
    Object.entries(results).forEach(([boqId, result]) => {
      result.suggestions.forEach((s, i) => {
        if (!includedLines[`${boqId}_${i}`]) return
        const itemId = s.warehouseItemName ? nameToId.get(s.warehouseItemName.trim()) : undefined
        if (!itemId) return
        const prevVal = Number(takenQtys[itemId]) || 0
        takenQtys[itemId] = String(prevVal + (s.estimatedQuantity || 0))
        boqLinks[itemId] = boqId
      })
    })
    if (Object.keys(takenQtys).length === 0) {
      toast({ title: t("proj_suggest_materials_none_selected"), variant: "destructive" })
      return
    }
    onApply(takenQtys, boqLinks)
    onOpenChange(false)
  }

  const hasResults = Object.keys(results).length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-amber-500" />
            {t("proj_suggest_materials_title")}
          </DialogTitle>
          <DialogDescription>{t("proj_suggest_materials_desc")}</DialogDescription>
        </DialogHeader>

        {!hasResults ? (
          <>
            <div className="border rounded-lg divide-y overflow-hidden max-h-72 overflow-y-auto">
              {candidateBoqItems.map((b) => (
                <label key={b.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                  <Checkbox checked={selectedBoqIds.has(b.id)} onCheckedChange={() => toggleBoqSelected(b.id)} />
                  <span className="flex-1 min-w-0 truncate">{b.descriptionAr || b.descriptionEn}</span>
                  <span className="text-xs text-muted-foreground shrink-0" dir="ltr">{b.quantity} {b.unit}</span>
                </label>
              ))}
              {candidateBoqItems.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">{t("proj_boq_empty")}</p>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">{t("proj_suggest_materials_unit_note")}</p>
          </>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {candidateBoqItems.filter((b) => results[b.id]).map((b) => {
              const result = results[b.id]
              return (
                <div key={b.id} className="border rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{b.descriptionAr || b.descriptionEn}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] shrink-0",
                        result.matchType === "direct" ? "text-success border-success/30 bg-success/5" :
                        result.matchType === "composite" ? "text-primary border-primary/30 bg-primary/5" :
                        "text-muted-foreground border-slate-200"
                      )}
                    >
                      {t(`proj_suggest_materials_type_${result.matchType}`)}
                    </Badge>
                  </div>
                  <div className="divide-y">
                    {result.suggestions.map((s, i) => {
                      const key = `${b.id}_${i}`
                      const resolved = s.warehouseItemName ? nameToId.get(s.warehouseItemName.trim()) : undefined
                      return (
                        <div key={key} className="px-3 py-2 text-sm">
                          {resolved ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <Checkbox checked={!!includedLines[key]} onCheckedChange={(v) => setIncludedLines((prev) => ({ ...prev, [key]: !!v }))} />
                              <span className="flex-1 min-w-0 truncate font-medium">{s.warehouseItemName}</span>
                              <span className="text-xs text-muted-foreground shrink-0" dir="ltr">{s.estimatedQuantity} {s.unit}</span>
                            </label>
                          ) : (
                            <div className="flex items-center gap-2 opacity-70">
                              <Package size={13} className="text-amber-500 shrink-0" />
                              <span className="flex-1 min-w-0 truncate">{s.notFoundSuggestedName || "—"}</span>
                              <span className="text-xs text-amber-600 shrink-0">{t("proj_suggest_materials_not_in_stock")}</span>
                            </div>
                          )}
                          <p className="text-[11px] text-muted-foreground mt-0.5 ps-6">{s.reasoning}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          {!hasResults ? (
            <Button onClick={handleGetSuggestions} disabled={isLoading || selectedBoqIds.size === 0} className="gap-2">
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {t("proj_suggest_materials_get_btn")}
            </Button>
          ) : (
            <Button onClick={handleApply} className="gap-2">
              {t("proj_suggest_materials_apply_btn")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

