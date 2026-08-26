"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useFirestore, useDoc, useMemoFirebase, useUser } from "@/firebase"
import { collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp, increment } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCentralWarehouse, type OrgWarehouse } from "@/hooks/useCentralWarehouse"
import { WarehouseRequestsSection } from "./WarehouseRequestsSection"
import {
  createWarehouseRequest,
  validateRequest,
  type TransferValidationError,
} from "@/lib/warehouse-requests"
import { Warehouse, Plus, Pencil, Trash2, Loader2, MapPin, Package, AlertTriangle, Barcode, Ban, X, ArrowLeftRight, Star, ArrowDownToLine, Send, Search, ArrowUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { INVENTORY_UNIT_CODES, formatUnit, isKnownUnitCode, unitMessageKey } from "@/lib/inventory-units"

type InventoryItem = {
  id: string
  name: string
  sku?: string
  quantity: number
  unit: string
  /** Canonical unit key — absent on rows created before the unit vocabulary existed. */
  unitCode?: string | null
  /** Cost of one unit in SAR. Optional: needed to value stock and waste, not to track it. */
  unitCost?: number | null
  minStockLevel?: number
  trackingMode?: "unit" | null
}

type WarehouseDoc = {
  id: string
  name: string
  location: string
  description?: string
  isCentral?: boolean
}

type Unit = {
  id: string
  barcode: string
  status: "in_stock" | "consumed" | "damaged"
  consumedProjectName?: string | null
  notes?: string | null
  createdAt?: unknown
}

function ItemDialog({
  open,
  onOpenChange,
  item,
  warehouseId,
  orgId,
  t,
  locale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: InventoryItem
  warehouseId: string
  orgId: string
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [name, setName] = useState(item?.name ?? "")
  const [sku, setSku] = useState(item?.sku ?? "")
  const [quantity, setQuantity] = useState(item?.quantity?.toString() ?? "0")
  // An existing row keeps its canonical code if it has one; a legacy row with only
  // free text opens on "__custom__" so editing it never silently rewrites its unit.
  const initialUnitCode = isKnownUnitCode(item?.unitCode) ? item.unitCode : (item ? "__custom__" : "")
  const [unitCode, setUnitCode] = useState<string>(initialUnitCode)
  const [unit, setUnit] = useState(item?.unit ?? "")
  const [unitCost, setUnitCost] = useState(item?.unitCost != null ? String(item.unitCost) : "")
  const [minStockLevel, setMinStockLevel] = useState(item?.minStockLevel?.toString() ?? "")
  const [isUnitTracked, setIsUnitTracked] = useState(item?.trackingMode === "unit")
  // Errors surface next to the field that caused them. A toast alone never says
  // *which* input is wrong.
  const [showErrors, setShowErrors] = useState(false)

  const reset = () => {
    setName(item?.name ?? "")
    setSku(item?.sku ?? "")
    setQuantity(item?.quantity?.toString() ?? "0")
    setUnitCode(initialUnitCode)
    setUnit(item?.unit ?? "")
    setUnitCost(item?.unitCost != null ? String(item.unitCost) : "")
    setMinStockLevel(item?.minStockLevel?.toString() ?? "")
    setIsUnitTracked(item?.trackingMode === "unit")
    setShowErrors(false) // otherwise a failed attempt greets the next open with stale errors
  }

  // The canonical label is the source of truth when a code is picked; `unit` still
  // gets written so every existing reader (BOQ rows, waste records, the supplier
  // portal) keeps working without a data migration.
  // "" means nothing picked yet (a brand-new item) — that's an unset state, not a
  // custom unit, so the free-text box stays hidden until "other" is actually chosen.
  const isCustomUnit = unitCode === "__custom__"
  const resolvedUnit = unitCode === ""
    ? ""
    : isCustomUnit
      ? unit.trim()
      : t(unitMessageKey(unitCode) as Parameters<typeof t>[0])

  const nameError = !name.trim()
  const unitError = !resolvedUnit

  const handleSave = async () => {
    if (!firestore) return
    if (nameError || unitError) {
      setShowErrors(true)
      toast({ title: t("inv_item_validation_error"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const data = {
        name: name.trim(),
        sku: sku.trim() || null,
        quantity: isUnitTracked ? (item?.quantity ?? 0) : Math.max(0, parseFloat(quantity) || 0),
        unit: resolvedUnit,
        unitCode: isCustomUnit ? null : unitCode,
        unitCost: unitCost.trim() ? Math.max(0, parseFloat(unitCost) || 0) : null,
        minStockLevel: minStockLevel ? Math.max(0, parseFloat(minStockLevel) || 0) : null,
        trackingMode: isUnitTracked ? "unit" : null,
        organizationId: orgId,
        warehouseId,
        updatedAt: serverTimestamp(),
      }
      const colRef = collection(firestore, "warehouses", warehouseId, "inventoryItems")
      if (item) {
        await updateDoc(doc(firestore, "warehouses", warehouseId, "inventoryItems", item.id), data)
        toast({ title: t("inv_item_updated") })
      } else {
        await addDoc(colRef, { ...data, createdAt: serverTimestamp() })
        toast({ title: t("inv_item_added") })
      }
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("inv_item_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) { onOpenChange(next); if (!next) reset() } }}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{item ? t("inv_item_edit_title") : t("inv_item_add_title")}</DialogTitle>
          <DialogDescription>{t("inv_item_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="item-name">{t("inv_item_name")} *</Label>
              <Input
                id="item-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("inv_item_name_placeholder")}
                aria-invalid={showErrors && nameError}
                aria-describedby={showErrors && nameError ? "item-name-error" : undefined}
                className={cn(showErrors && nameError && "border-destructive focus-visible:ring-destructive")}
              />
              {showErrors && nameError && (
                <p id="item-name-error" className="text-[11px] text-destructive">{t("inv_item_name_required")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-sku">{t("inv_item_sku")}</Label>
              <Input id="item-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder={t("inv_item_sku_placeholder")} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-unit">{t("inv_item_unit")} *</Label>
              <Select value={unitCode} onValueChange={setUnitCode}>
                <SelectTrigger
                  id="item-unit"
                  aria-invalid={showErrors && unitError}
                  className={cn(showErrors && unitError && "border-destructive focus:ring-destructive")}
                >
                  <SelectValue placeholder={t("inv_item_unit_placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {INVENTORY_UNIT_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {t(unitMessageKey(code) as Parameters<typeof t>[0])}
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">{t("inv_item_unit_custom")}</SelectItem>
                </SelectContent>
              </Select>
              {isCustomUnit && (
                <Input
                  aria-label={t("inv_item_unit_custom")}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder={t("inv_item_unit_placeholder")}
                  aria-invalid={showErrors && unitError}
                  className={cn("mt-1.5", showErrors && unitError && "border-destructive focus-visible:ring-destructive")}
                />
              )}
              {showErrors && unitError && (
                <p className="text-[11px] text-destructive">{t("inv_item_unit_required")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-qty">{t("inv_item_qty")} *</Label>
              <Input id="item-qty" type="number" min="0" value={isUnitTracked ? (item?.quantity ?? 0) : quantity}
                onChange={(e) => setQuantity(e.target.value)} disabled={isUnitTracked} dir="ltr" />
              {isUnitTracked && <p className="text-[11px] text-muted-foreground">{t("inv_item_qty_unit_managed")}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-cost">{t("inv_item_unit_cost")}</Label>
              <div className="relative">
                <Input id="item-cost" type="number" min="0" step="0.01" value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)} placeholder={t("inv_item_unit_cost_placeholder")}
                  dir="ltr" className="pe-12" />
                <span className="absolute top-1/2 -translate-y-1/2 end-3 text-xs text-muted-foreground pointer-events-none">
                  {t("offers_currency_sar")}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("inv_item_unit_cost_hint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-min">{t("inv_item_min_stock")}</Label>
              <Input id="item-min" type="number" min="0" value={minStockLevel}
                onChange={(e) => setMinStockLevel(e.target.value)} placeholder={t("inv_item_min_placeholder")} dir="ltr" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-muted">
            <div className="flex items-center gap-2 min-w-0">
              <Barcode size={16} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-muted-foreground">{t("inv_item_unit_tracking")}</p>
                <p className="text-[11px] text-muted-foreground">{t("inv_item_unit_tracking_desc")}</p>
              </div>
            </div>
            <Switch checked={isUnitTracked} onCheckedChange={setIsUnitTracked} disabled={!!item} />
          </div>
          {!!item && (
            <p className="text-[11px] text-muted-foreground -mt-2">{t("inv_item_unit_tracking_locked")}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>{t("wh_cancel")}</Button>
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : null}
            {t("wh_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function UnitsDialog({
  open,
  onOpenChange,
  item,
  warehouseId,
  orgId,
  t,
  locale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: InventoryItem
  warehouseId: string
  orgId: string
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const isRtl = locale === "ar"
  const [barcode, setBarcode] = useState("")
  const [isAdding, setIsAdding] = useState(false)
  const [busyUnitId, setBusyUnitId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | Unit["status"]>("all")
  // Deleting a unit and marking one damaged both move stock and cannot be undone.
  // The confirmation is inline rather than a nested modal — stacking a second
  // overlay on top of this one is heavier than the decision warrants.
  const [pending, setPending] = useState<{ unitId: string; action: "delete" | "damage" } | null>(null)

  const unitsRef = useMemoFirebase(() => {
    if (!firestore || !warehouseId || !item?.id) return null
    return collection(firestore, "warehouses", warehouseId, "inventoryItems", item.id, "units")
  }, [firestore, warehouseId, item?.id])
  const { data: unitsData, isLoading } = useCollection(unitsRef)
  const allUnits = ((unitsData || []) as Unit[]).slice().sort((a, b) => {
    const order = { in_stock: 0, damaged: 1, consumed: 2 }
    return order[a.status] - order[b.status]
  })
  const counts = {
    all: allUnits.length,
    in_stock: allUnits.filter((u) => u.status === "in_stock").length,
    damaged: allUnits.filter((u) => u.status === "damaged").length,
    consumed: allUnits.filter((u) => u.status === "consumed").length,
  }
  const q = search.trim().toLowerCase()
  const units = allUnits
    .filter((u) => statusFilter === "all" || u.status === statusFilter)
    .filter((u) => !q || u.barcode.toLowerCase().includes(q))

  const itemRef = () => doc(firestore!, "warehouses", warehouseId, "inventoryItems", item.id)

  const generateBarcode = () => {
    setBarcode(`${(item.sku || item.name).replace(/\s+/g, "").slice(0, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`)
  }

  const handleAdd = async () => {
    if (!firestore || !barcode.trim()) return
    setIsAdding(true)
    try {
      await addDoc(collection(firestore, "warehouses", warehouseId, "inventoryItems", item.id, "units"), {
        barcode: barcode.trim(),
        status: "in_stock",
        organizationId: orgId,
        warehouseId,
        itemId: item.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      await updateDoc(itemRef(), { quantity: increment(1), updatedAt: serverTimestamp() })
      setBarcode("")
      toast({ title: t("inv_unit_added") })
    } catch (err) {
      console.error(err)
      toast({ title: t("inv_unit_save_error"), variant: "destructive" })
    } finally {
      setIsAdding(false)
    }
  }

  const handleMarkDamaged = async (unitId: string) => {
    if (!firestore) return
    setPending(null)
    setBusyUnitId(unitId)
    try {
      await updateDoc(doc(firestore, "warehouses", warehouseId, "inventoryItems", item.id, "units", unitId), {
        status: "damaged",
        updatedAt: serverTimestamp(),
      })
      await updateDoc(itemRef(), { quantity: increment(-1), updatedAt: serverTimestamp() })
      toast({ title: t("inv_unit_marked_damaged") })
    } catch (err) {
      console.error(err)
      toast({ title: t("inv_unit_save_error"), variant: "destructive" })
    } finally {
      setBusyUnitId(null)
    }
  }

  const handleDelete = async (u: Unit) => {
    if (!firestore) return
    setPending(null)
    setBusyUnitId(u.id)
    try {
      await deleteDoc(doc(firestore, "warehouses", warehouseId, "inventoryItems", item.id, "units", u.id))
      if (u.status === "in_stock") {
        await updateDoc(itemRef(), { quantity: increment(-1), updatedAt: serverTimestamp() })
      }
      toast({ title: t("inv_unit_deleted") })
    } catch (err) {
      console.error(err)
      toast({ title: t("inv_unit_save_error"), variant: "destructive" })
    } finally {
      setBusyUnitId(null)
    }
  }

  const statusBadge = (status: Unit["status"]) => {
    if (status === "in_stock") return <Badge className="bg-success/10 text-success border-success/20">{t("inv_unit_status_in_stock")}</Badge>
    if (status === "damaged") return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none">{t("inv_unit_status_damaged")}</Badge>
    return <Badge variant="outline" className="text-muted-foreground">{t("inv_unit_status_consumed")}</Badge>
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Barcode size={18} />
            {t("inv_unit_dialog_title", { name: item.name })}
          </DialogTitle>
          <DialogDescription>{t("inv_unit_dialog_desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder={t("inv_unit_barcode_placeholder")}
            dir="ltr"
            className="h-9 text-sm font-mono"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd() }}
          />
          <Button variant="outline" size="sm" onClick={generateBarcode} className="shrink-0 h-9">{t("inv_unit_generate_btn")}</Button>
          <Button size="sm" onClick={handleAdd} disabled={isAdding || !barcode.trim()} className="shrink-0 h-9 gap-1.5">
            {isAdding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {t("inv_unit_add_btn")}
          </Button>
        </div>

        {/* Status filter doubles as the at-a-glance breakdown — a barcode-tracked item
            with 200 units is otherwise a wall of identical-looking rows. */}
        {allUnits.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {(["all", "in_stock", "damaged", "consumed"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                aria-pressed={statusFilter === s}
                disabled={s !== "all" && counts[s] === 0}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                  statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {s === "all" ? t("inv_unit_filter_all") : t(`inv_unit_status_${s}` as Parameters<typeof t>[0])}
                <span className="ms-1.5 tabular-nums" dir="ltr">{counts[s]}</span>
              </button>
            ))}
            {allUnits.length > 8 && (
              <div className="relative flex-1 min-w-[140px]">
                <Search size={13} className="absolute top-1/2 -translate-y-1/2 start-2.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("inv_unit_search_placeholder")}
                  aria-label={t("inv_unit_search_placeholder")}
                  dir="ltr"
                  className="h-8 ps-8 text-xs font-mono"
                />
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : allUnits.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("inv_unit_empty")}</div>
        ) : units.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-sm text-muted-foreground">{t("inv_no_results")}</p>
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatusFilter("all") }}>
              {t("inv_clear_filters")}
            </Button>
          </div>
        ) : (
          <div className="border rounded-lg divide-y overflow-hidden max-h-[45vh] overflow-y-auto">
            {units.map((u) => {
              const isPending = pending?.unitId === u.id
              return (
              <div key={u.id} className={cn("flex items-center justify-between gap-2 px-3 py-2 text-sm", isPending && "bg-destructive/5")}>
                <div className="min-w-0 flex items-center gap-2">
                  <span className="font-mono font-semibold text-foreground truncate">{u.barcode}</span>
                  {statusBadge(u.status)}
                  {u.status === "consumed" && u.consumedProjectName && (
                    <span className="text-xs text-muted-foreground truncate">— {u.consumedProjectName}</span>
                  )}
                </div>
                {/* Both actions move stock and can't be undone, so the row asks first
                    instead of acting on a single stray click. */}
                {isPending ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs font-semibold text-destructive">
                      {pending.action === "delete" ? t("inv_unit_delete_confirm") : t("inv_unit_damage_confirm")}
                    </span>
                    <Button size="sm" variant="destructive" className="h-7 px-2 text-xs"
                      onClick={() => (pending.action === "delete" ? handleDelete(u) : handleMarkDamaged(u.id))}>
                      {t("inv_unit_confirm_yes")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPending(null)}>
                      {t("wh_cancel")}
                    </Button>
                  </div>
                ) : u.status !== "consumed" ? (
                  <div className="flex items-center gap-1 shrink-0">
                    {u.status === "in_stock" && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-warning"
                        onClick={() => setPending({ unitId: u.id, action: "damage" })} disabled={busyUnitId === u.id} aria-label={t("inv_unit_mark_damaged")}>
                        {busyUnitId === u.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setPending({ unitId: u.id, action: "delete" })} disabled={busyUnitId === u.id} aria-label={t("wh_delete_btn")}>
                      {busyUnitId === u.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                    </Button>
                  </div>
                ) : null}
              </div>
            )})}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("wh_cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function transferErrorKey(err: TransferValidationError): "transfer_err_invalid_quantity" | "transfer_err_insufficient_stock" | "transfer_err_unit_tracked" | "transfer_err_same_warehouse" {
  return `transfer_err_${err}` as const
}

/** Raises a withdrawal request between this warehouse and another — nothing
 * moves yet. The central→project direction picks a destination among that
 * central's own project warehouses; the project→central direction is fixed. */
function RequestDialog({
  open,
  onOpenChange,
  sourceItem,
  fromWarehouseId,
  destinations,
  centralWarehouseId,
  orgId,
  byUserId,
  byUserName,
  t,
  locale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceItem: InventoryItem
  fromWarehouseId: string
  destinations: OrgWarehouse[]
  centralWarehouseId: string
  orgId: string
  byUserId: string
  byUserName: string
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const [destId, setDestId] = useState(destinations.length === 1 ? destinations[0].id : "")
  const [qty, setQty] = useState("")
  const [receiver, setReceiver] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isRtl = locale === "ar"

  const quantity = parseFloat(qty) || 0
  const remaining = sourceItem.quantity - quantity
  const dest = destinations.find((d) => d.id === destId)

  const handleSubmit = async () => {
    if (!firestore || !dest) return
    const error = validateRequest({ sourceItem, quantity, fromWarehouseId, toWarehouseId: dest.id })
    if (error) {
      toast({ title: t(transferErrorKey(error)), variant: "destructive" })
      return
    }
    if (!receiver.trim()) {
      toast({ title: t("request_receiver_required"), variant: "destructive" })
      return
    }
    setIsSubmitting(true)
    try {
      await createWarehouseRequest({
        firestore,
        centralWarehouseId,
        fromWarehouseId,
        toWarehouseId: dest.id,
        itemId: sourceItem.id,
        sourceItem,
        quantity,
        organizationId: orgId,
        byUserId,
        byUserName,
        expectedReceiverName: receiver.trim(),
        toProjectId: dest.projectId ?? null,
        toProjectName: dest.projectName ?? dest.name,
      })
      toast({ title: t("request_created") })
      onOpenChange(false)
      setQty("")
      setReceiver("")
    } catch (err) {
      const code = err instanceof Error ? err.message : ""
      const known = ["invalid_quantity", "insufficient_stock", "unit_tracked", "same_warehouse"].includes(code)
      toast({ title: known ? t(transferErrorKey(code as TransferValidationError)) : t("transfer_error"), variant: "destructive" })
      console.error(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSubmitting) onOpenChange(next) }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send size={17} className="text-primary" />
            {t("request_dialog_title", { item: sourceItem.name })}
          </DialogTitle>
          <DialogDescription>{t("request_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted border border-border text-sm">
            <span className="font-bold text-muted-foreground">{sourceItem.name}</span>
            <span className="text-muted-foreground" dir="ltr">{t("transfer_available", { qty: sourceItem.quantity, unit: sourceItem.unit })}</span>
          </div>
          {destinations.length > 1 ? (
            <div className="space-y-1.5">
              <Label>{t("transfer_dest_label")} *</Label>
              <Select value={destId} onValueChange={setDestId}>
                <SelectTrigger><SelectValue placeholder={t("transfer_dest_label")} /></SelectTrigger>
                <SelectContent>
                  {destinations.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : destinations.length === 1 ? (
            <div className="space-y-1.5">
              <Label>{t("transfer_dest_label")}</Label>
              <div className="h-10 px-3 rounded-md border bg-muted/30 flex items-center text-sm font-semibold">{destinations[0].name}</div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-3 text-center">{t("transfer_no_destinations")}</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="request-qty">{t("transfer_qty_label")} *</Label>
            <Input
              id="request-qty"
              type="number"
              min="0"
              max={sourceItem.quantity}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              dir="ltr"
              disabled={isSubmitting}
            />
            {quantity > 0 && quantity <= sourceItem.quantity && (
              <p className="text-xs text-muted-foreground" dir="ltr">{t("transfer_remaining_after", { qty: remaining })}</p>
            )}
            {quantity > sourceItem.quantity && (
              <p className="text-xs text-destructive font-semibold">{t("transfer_err_insufficient_stock")}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="request-receiver">{t("request_receiver_label")} *</Label>
            <Input
              id="request-receiver"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              placeholder={t("request_receiver_placeholder")}
              disabled={isSubmitting}
            />
            <p className="text-[11px] text-muted-foreground">{t("request_receiver_hint")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>{t("wh_cancel")}</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !dest || quantity <= 0 || quantity > sourceItem.quantity || !receiver.trim()} className="gap-2">
            {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {t("request_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Request stock from the company's central warehouse INTO this project warehouse. */
function PullRequestDialog({
  open,
  onOpenChange,
  central,
  thisWarehouse,
  orgId,
  byUserId,
  byUserName,
  t,
  locale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  central: OrgWarehouse
  thisWarehouse: { id: string; projectId?: string | null; projectName?: string | null; name?: string }
  orgId: string
  byUserId: string
  byUserName: string
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const isRtl = locale === "ar"
  const [itemId, setItemId] = useState("")
  const [qty, setQty] = useState("")
  const [receiver, setReceiver] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const centralItemsRef = useMemoFirebase(() => {
    if (!firestore || !open || !central.id) return null
    return collection(firestore, "warehouses", central.id, "inventoryItems")
  }, [firestore, open, central.id])
  const { data: centralItemsData, isLoading } = useCollection(centralItemsRef)
  const centralItems = ((centralItemsData || []) as InventoryItem[])
    .filter((i) => i.trackingMode !== "unit" && i.quantity > 0)

  const sourceItem = centralItems.find((i) => i.id === itemId) || null
  const quantity = parseFloat(qty) || 0

  const handleSubmit = async () => {
    if (!firestore || !sourceItem) return
    const error = validateRequest({ sourceItem, quantity, fromWarehouseId: central.id, toWarehouseId: thisWarehouse.id })
    if (error) {
      toast({ title: t(transferErrorKey(error)), variant: "destructive" })
      return
    }
    if (!receiver.trim()) {
      toast({ title: t("request_receiver_required"), variant: "destructive" })
      return
    }
    setIsSubmitting(true)
    try {
      await createWarehouseRequest({
        firestore,
        centralWarehouseId: central.id,
        fromWarehouseId: central.id,
        toWarehouseId: thisWarehouse.id,
        itemId: sourceItem.id,
        sourceItem,
        quantity,
        organizationId: orgId,
        byUserId,
        byUserName,
        expectedReceiverName: receiver.trim(),
        toProjectId: thisWarehouse.projectId ?? null,
        toProjectName: thisWarehouse.projectName ?? thisWarehouse.name ?? null,
      })
      toast({ title: t("request_created") })
      onOpenChange(false)
      setItemId("")
      setQty("")
      setReceiver("")
    } catch (err) {
      const code = err instanceof Error ? err.message : ""
      const known = ["invalid_quantity", "insufficient_stock", "unit_tracked", "same_warehouse"].includes(code)
      toast({ title: known ? t(transferErrorKey(code as TransferValidationError)) : t("transfer_error"), variant: "destructive" })
      console.error(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSubmitting) onOpenChange(next) }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowDownToLine size={17} className="text-primary" />
            {t("pull_dialog_title")}
          </DialogTitle>
          <DialogDescription>{t("pull_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={22} className="animate-spin text-muted-foreground" />
            </div>
          ) : centralItems.length === 0 ? (
            <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">{t("pull_empty_central")}</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>{t("pull_item_label")} *</Label>
                <Select value={itemId} onValueChange={setItemId}>
                  <SelectTrigger><SelectValue placeholder={t("pull_item_label")} /></SelectTrigger>
                  <SelectContent>
                    {centralItems.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name} — {i.quantity} {i.unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pull-qty">{t("transfer_qty_label")} *</Label>
                <Input
                  id="pull-qty"
                  type="number"
                  min="0"
                  max={sourceItem?.quantity ?? undefined}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  dir="ltr"
                  disabled={isSubmitting || !sourceItem}
                />
                {sourceItem && quantity > 0 && quantity <= sourceItem.quantity && (
                  <p className="text-xs text-muted-foreground" dir="ltr">{t("transfer_remaining_after", { qty: sourceItem.quantity - quantity })}</p>
                )}
                {sourceItem && quantity > sourceItem.quantity && (
                  <p className="text-xs text-destructive font-semibold">{t("transfer_err_insufficient_stock")}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pull-receiver">{t("request_receiver_label")} *</Label>
                <Input
                  id="pull-receiver"
                  value={receiver}
                  onChange={(e) => setReceiver(e.target.value)}
                  placeholder={t("request_receiver_placeholder")}
                  disabled={isSubmitting}
                />
                <p className="text-[11px] text-muted-foreground">{t("request_receiver_hint")}</p>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>{t("wh_cancel")}</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !sourceItem || quantity <= 0 || quantity > (sourceItem?.quantity ?? 0) || !receiver.trim()} className="gap-2">
            {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {t("request_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


/**
 * Shared inventory-item CRUD UI for a single warehouse (including barcode-level unit
 * tracking). Used both by the standalone warehouse detail page ("full" — includes its
 * own header) and embedded as a project's "Warehouse" tab ("embedded" — the surrounding
 * page already provides page-level chrome).
 */
export function WarehouseInventoryPanel({
  warehouseId,
  orgId,
  variant = "full",
}: {
  warehouseId: string
  orgId: string
  variant?: "full" | "embedded"
}) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can } = usePermissions()
  const { user } = useUser()
  const canManageWarehouses = can("warehouses.manage")

  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState<InventoryItem | null>(null)
  const [deleteItem, setDeleteItem] = useState<InventoryItem | null>(null)
  const [unitsItem, setUnitsItem] = useState<InventoryItem | null>(null)
  const [transferItem, setTransferItem] = useState<InventoryItem | null>(null)
  const [showPull, setShowPull] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<"name" | "quantity" | "value">("name")
  const [lowOnly, setLowOnly] = useState(false)

  const warehouseRef = useMemoFirebase(() => {
    if (!firestore || !warehouseId) return null
    return doc(firestore, "warehouses", warehouseId)
  }, [firestore, warehouseId])
  const { data: warehouse } = useDoc(warehouseRef)
  const wh = warehouse as (WarehouseDoc & { projectId?: string | null; projectName?: string | null; centralWarehouseId?: string | null }) | null

  const { centrals, projectWarehouses } = useCentralWarehouse(orgId)
  const isCentralHere = !!wh?.isCentral || centrals.some((c) => c.id === warehouseId)
  // This warehouse's own central — itself if it IS one, otherwise whichever
  // central it's linked to. Data with no explicit link (created before
  // multi-central support, or never assigned) falls back to the FIRST
  // central rather than losing access to requests once a second exists.
  const myCentral = isCentralHere
    ? centrals.find((c) => c.id === warehouseId) || null
    : centrals.find((c) => c.id === wh?.centralWarehouseId) || centrals[0] || null
  // Only THIS central's own project warehouses are valid request destinations —
  // a request never crosses between two different cities' centrals.
  const myProjectWarehouses = isCentralHere
    ? projectWarehouses.filter((pw) => (pw.centralWarehouseId || centrals[0]?.id) === warehouseId)
    : []
  const byUserName = user?.displayName || user?.email || ""

  const itemsRef = useMemoFirebase(() => {
    if (!firestore || !warehouseId) return null
    return collection(firestore, "warehouses", warehouseId, "inventoryItems")
  }, [firestore, warehouseId])
  const { data: items, isLoading } = useCollection(itemsRef)
  const list = (items || []) as InventoryItem[]

  const warehouseNameById = new Map<string, string>()
  ;[...centrals, ...projectWarehouses].forEach((w) => { if (w) warehouseNameById.set(w.id, w.name) })

  const handleDelete = async () => {
    if (!firestore || !deleteItem) return
    setIsDeleting(true)
    try {
      await deleteDoc(doc(firestore, "warehouses", warehouseId, "inventoryItems", deleteItem.id))
      toast({ title: t("inv_item_deleted") })
      setDeleteItem(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("inv_item_save_error"), variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const lowStockItems = list.filter((it) => it.minStockLevel != null && it.quantity <= it.minStockLevel)
  const itemValue = (it: InventoryItem) => (it.unitCost != null ? it.unitCost * it.quantity : 0)
  const totalStockValue = list.reduce((sum, it) => sum + itemValue(it), 0)
  const pricedCount = list.filter((it) => it.unitCost != null).length

  const q = search.trim().toLowerCase()
  const visibleItems = list
    .filter((it) => !lowOnly || (it.minStockLevel != null && it.quantity <= it.minStockLevel))
    .filter((it) => !q || it.name.toLowerCase().includes(q) || (it.sku || "").toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      if (sortKey === "quantity") return b.quantity - a.quantity
      if (sortKey === "value") return itemValue(b) - itemValue(a)
      // Arabic and Latin names sort together only under a locale-aware collator.
      return a.name.localeCompare(b.name, locale === "ar" ? "ar" : "en")
    })
  const nf = (n: number) => n.toLocaleString(locale === "ar" ? "ar-SA" : "en-US", { maximumFractionDigits: 2 })

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex items-center gap-3">
        {variant === "full" && (
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Warehouse size={20} className="text-primary" />
              <h1 className="text-xl font-black text-primary">{wh?.name ?? t("wh_page_title")}</h1>
              {isCentralHere && (
                <Badge className="bg-accent/10 text-accent border-accent/30 gap-1 font-bold">
                  <Star size={11} />
                  {t("wh_central_badge")}
                </Badge>
              )}
            </div>
            {wh?.location && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin size={11} />
                {wh.location}
              </p>
            )}
          </div>
        )}
        {variant === "embedded" && (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Warehouse size={16} className="text-primary shrink-0" />
              <h2 className="text-sm font-bold text-foreground truncate">{wh?.name ?? t("wh_page_title")}</h2>
              {isCentralHere && (
                <Badge className="bg-accent/10 text-accent border-accent/30 gap-1 font-bold shrink-0">
                  <Star size={10} />
                  {t("wh_central_badge")}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap mt-0.5 text-[11px] text-muted-foreground">
              {wh?.location && (
                <span className="flex items-center gap-1">
                  <MapPin size={10} />
                  {wh.location}
                </span>
              )}
              {!isCentralHere && myCentral && (
                <span className="flex items-center gap-1">
                  <ArrowDownToLine size={10} />
                  {t("inv_supplied_by", { name: myCentral.name })}
                </span>
              )}
            </div>
          </div>
        )}
        {!isCentralHere && myCentral && canManageWarehouses && (
          <Button variant="outline" onClick={() => setShowPull(true)} className="gap-2 shrink-0 border-accent/40 text-accent hover:bg-accent/5 hover:text-accent">
            <ArrowDownToLine size={15} />
            {t("pull_btn")}
          </Button>
        )}
        {canManageWarehouses && (
          <Button onClick={() => setShowAdd(true)} className="gap-2 shrink-0">
            <Plus size={16} />
            {t("inv_item_add_btn")}
          </Button>
        )}
      </div>

      {/* The low-stock count lives in the stat row below, where it's also the control
          that filters the table — a separate banner said the same thing twice. */}

      {/* Items table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={32} className="animate-spin text-muted-foreground" />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Package size={48} className="text-muted-foreground/20" />
          <p className="font-bold text-muted-foreground">{t("inv_item_empty_title")}</p>
          <p className="text-sm text-muted-foreground/70">{t("inv_item_empty_desc")}</p>
          {canManageWarehouses && (
            <Button onClick={() => setShowAdd(true)} variant="outline" className="gap-2 mt-2">
              <Plus size={14} />
              {t("inv_item_add_btn")}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Search / sort / filter — the list is unusable past a couple of dozen rows without it. */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("inv_search_placeholder")}
                aria-label={t("inv_search_placeholder")}
                className="ps-9 h-9"
              />
            </div>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
              <SelectTrigger className="h-9 w-auto gap-2" aria-label={t("inv_sort_label")}>
                <ArrowUpDown size={13} className="text-muted-foreground shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">{t("inv_sort_name")}</SelectItem>
                <SelectItem value="quantity">{t("inv_sort_qty")}</SelectItem>
                <SelectItem value="value">{t("inv_sort_value")}</SelectItem>
              </SelectContent>
            </Select>
            {lowOnly && (
              <Button type="button" variant="outline" size="sm" onClick={() => setLowOnly(false)} className="h-9 gap-1.5">
                <AlertTriangle size={13} className="text-warning" />
                {t("inv_filter_low_only")}
                <X size={12} className="text-muted-foreground" />
              </Button>
            )}
          </div>

          {/* At-a-glance state of the warehouse. Low stock is a button because it's the
              one number you act on, and clicking it filters the table to those rows. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="rounded-xl border bg-muted/40 px-3.5 py-2.5">
              <p className="text-[11px] font-semibold text-muted-foreground">{t("inv_stat_items")}</p>
              <p className="text-lg font-black text-foreground tabular-nums" dir="ltr">{nf(list.length)}</p>
            </div>
            <button
              type="button"
              onClick={() => setLowOnly((v) => !v)}
              disabled={lowStockItems.length === 0}
              aria-pressed={lowOnly}
              className={cn(
                "rounded-xl border px-3.5 py-2.5 text-start transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:cursor-default",
                lowStockItems.length === 0 ? "bg-muted/40" : lowOnly ? "border-warning bg-warning/15" : "border-warning/30 bg-warning/5 hover:bg-warning/10"
              )}
            >
              <p className={cn("text-[11px] font-semibold", lowStockItems.length > 0 ? "text-warning" : "text-muted-foreground")}>
                {t("inv_stat_low_stock")}
              </p>
              <p className={cn("text-lg font-black tabular-nums", lowStockItems.length > 0 ? "text-warning" : "text-foreground")} dir="ltr">
                {nf(lowStockItems.length)}
              </p>
            </button>
            <div className="rounded-xl border bg-muted/40 px-3.5 py-2.5 col-span-2 sm:col-span-1">
              <p className="text-[11px] font-semibold text-muted-foreground">{t("inv_stock_value_label")}</p>
              {totalStockValue > 0 ? (
                <p className="text-lg font-black text-foreground tabular-nums">
                  <span dir="ltr">{nf(totalStockValue)}</span>
                  <span className="text-xs font-semibold text-muted-foreground ms-1">{t("offers_currency_sar")}</span>
                  {pricedCount < list.length && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {t("inv_stock_value_partial", { priced: pricedCount, total: list.length })}
                    </span>
                  )}
                </p>
              ) : (
                // Zero would read as "this stock is worthless" rather than "no prices yet".
                <p className="text-xs text-muted-foreground mt-1.5">{t("inv_stock_value_unknown")}</p>
              )}
            </div>
          </div>

          {visibleItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center rounded-xl border border-dashed">
              <Search size={28} className="text-muted-foreground/30" />
              <p className="text-sm font-semibold text-muted-foreground">{t("inv_no_results")}</p>
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setLowOnly(false) }}>
                {t("inv_clear_filters")}
              </Button>
            </div>
          ) : (
          <div className="rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b">
                <tr>
                  <th className={`py-3 px-4 font-bold text-muted-foreground ${isRtl ? "text-right" : "text-left"}`}>{t("inv_item_name")}</th>
                  <th className={`py-3 px-4 font-bold text-muted-foreground ${isRtl ? "text-right" : "text-left"}`}>{t("inv_item_sku")}</th>
                  <th className="py-3 px-4 font-bold text-muted-foreground text-center">{t("inv_item_qty")}</th>
                  <th className={`py-3 px-4 font-bold text-muted-foreground ${isRtl ? "text-right" : "text-left"}`}>{t("inv_item_unit")}</th>
                  <th className="py-3 px-4 font-bold text-muted-foreground text-center">{t("inv_item_unit_cost")}</th>
                  <th className="py-3 px-4 font-bold text-muted-foreground text-center">{t("inv_item_min_stock")}</th>
                  <th className="py-3 px-4 w-28" />
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item, idx) => {
                  const isLow = item.minStockLevel != null && item.quantity <= item.minStockLevel
                  const isUnitTracked = item.trackingMode === "unit"
                  return (
                    <tr key={item.id} className={cn(idx % 2 === 0 ? "bg-background" : "bg-muted/10", isLow ? "border-s-2 border-warning" : "")}>
                      <td className="py-3 px-4 font-semibold text-primary">
                        {item.name}
                        {isUnitTracked && (
                          <Badge variant="outline" className="ms-2 text-primary border-primary/20 text-[10px] py-0 gap-1">
                            <Barcode size={9} />
                            {t("inv_item_unit_tracking_badge")}
                          </Badge>
                        )}
                        {isLow && (
                          <Badge variant="outline" className="ms-2 text-warning border-warning/30 text-[10px] py-0">
                            <AlertTriangle size={9} className="me-1" />
                            {t("inv_low_stock_badge")}
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{item.sku || "—"}</td>
                      <td className="py-3 px-4 text-center font-bold" dir="ltr">{item.quantity}</td>
                      <td className="py-3 px-4 text-muted-foreground">{formatUnit(t as (k: string) => string, item)}</td>
                      <td className="py-3 px-4 text-center text-muted-foreground tabular-nums">
                        {item.unitCost != null ? (
                          <span dir="ltr">{nf(item.unitCost)}</span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center text-muted-foreground" dir="ltr">
                        {item.minStockLevel ?? "—"}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 justify-end">
                          {isUnitTracked && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                              onClick={() => setUnitsItem(item)} aria-label={t("inv_unit_manage_btn")}>
                              <Barcode size={13} />
                            </Button>
                          )}
                          {canManageWarehouses && !isUnitTracked && item.quantity > 0 && (isCentralHere ? myProjectWarehouses.length > 0 : !!myCentral) && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-accent"
                              onClick={() => setTransferItem(item)}
                              aria-label={isCentralHere ? t("transfer_btn") : t("return_btn")}>
                              <ArrowLeftRight size={13} />
                            </Button>
                          )}
                          {canManageWarehouses && (
                            <>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                                onClick={() => setEditItem(item)} aria-label={t("inv_item_edit_title")}>
                                <Pencil size={13} />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteItem(item)} aria-label={t("wh_delete_btn")}>
                                <Trash2 size={13} />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </div>
          )}
        </div>
      )}

      {/* Withdrawal requests touching this warehouse — release/confirm live here */}
      {myCentral && (
        <WarehouseRequestsSection
          centrals={centrals}
          warehouseId={warehouseId}
          warehouseNameById={warehouseNameById}
          canManage={canManageWarehouses}
          t={t}
          locale={locale}
        />
      )}

      {transferItem && (
        <RequestDialog
          open={!!transferItem}
          onOpenChange={(open) => { if (!open) setTransferItem(null) }}
          sourceItem={transferItem}
          fromWarehouseId={warehouseId}
          destinations={isCentralHere ? myProjectWarehouses : (myCentral ? [myCentral] : [])}
          centralWarehouseId={myCentral?.id || warehouseId}
          orgId={orgId}
          byUserId={user?.uid || ""}
          byUserName={byUserName}
          t={t}
          locale={locale}
        />
      )}
      {showPull && myCentral && (
        <PullRequestDialog
          open={showPull}
          onOpenChange={setShowPull}
          central={myCentral}
          thisWarehouse={{ id: warehouseId, projectId: wh?.projectId ?? null, projectName: wh?.projectName ?? null, name: wh?.name }}
          orgId={orgId}
          byUserId={user?.uid || ""}
          byUserName={byUserName}
          t={t}
          locale={locale}
        />
      )}

      <ItemDialog open={showAdd} onOpenChange={setShowAdd} warehouseId={warehouseId} orgId={orgId} t={t} locale={locale} />
      {editItem && (
        <ItemDialog
          open={!!editItem}
          onOpenChange={(open) => { if (!open) setEditItem(null) }}
          item={editItem}
          warehouseId={warehouseId}
          orgId={orgId}
          t={t}
          locale={locale}
        />
      )}
      {unitsItem && (
        <UnitsDialog
          open={!!unitsItem}
          onOpenChange={(open) => { if (!open) setUnitsItem(null) }}
          item={unitsItem}
          warehouseId={warehouseId}
          orgId={orgId}
          t={t}
          locale={locale}
        />
      )}

      <AlertDialog open={!!deleteItem} onOpenChange={(open) => { if (!open) setDeleteItem(null) }}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("inv_item_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("inv_item_delete_confirm_desc", { name: deleteItem?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("wh_cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90 gap-2">
              {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {t("wh_delete_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
