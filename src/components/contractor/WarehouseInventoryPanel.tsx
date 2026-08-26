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
import { Warehouse, Plus, Pencil, Trash2, Loader2, MapPin, Package, AlertTriangle, Barcode, Ban, X, ArrowLeftRight, Star, ArrowDownToLine, Send } from "lucide-react"
import { cn } from "@/lib/utils"

type InventoryItem = {
  id: string
  name: string
  sku?: string
  quantity: number
  unit: string
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
  const [unit, setUnit] = useState(item?.unit ?? "")
  const [minStockLevel, setMinStockLevel] = useState(item?.minStockLevel?.toString() ?? "")
  const [isUnitTracked, setIsUnitTracked] = useState(item?.trackingMode === "unit")

  const reset = () => {
    setName(item?.name ?? "")
    setSku(item?.sku ?? "")
    setQuantity(item?.quantity?.toString() ?? "0")
    setUnit(item?.unit ?? "")
    setMinStockLevel(item?.minStockLevel?.toString() ?? "")
    setIsUnitTracked(item?.trackingMode === "unit")
  }

  const handleSave = async () => {
    if (!firestore) return
    if (!name.trim() || !unit.trim()) {
      toast({ title: t("inv_item_validation_error"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const data = {
        name: name.trim(),
        sku: sku.trim() || null,
        quantity: isUnitTracked ? (item?.quantity ?? 0) : Math.max(0, parseFloat(quantity) || 0),
        unit: unit.trim(),
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
              <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("inv_item_name_placeholder")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-sku">{t("inv_item_sku")}</Label>
              <Input id="item-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder={t("inv_item_sku_placeholder")} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-unit">{t("inv_item_unit")} *</Label>
              <Input id="item-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t("inv_item_unit_placeholder")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-qty">{t("inv_item_qty")} *</Label>
              <Input id="item-qty" type="number" min="0" value={isUnitTracked ? (item?.quantity ?? 0) : quantity}
                onChange={(e) => setQuantity(e.target.value)} disabled={isUnitTracked} dir="ltr" />
              {isUnitTracked && <p className="text-[11px] text-muted-foreground">{t("inv_item_qty_unit_managed")}</p>}
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

  const unitsRef = useMemoFirebase(() => {
    if (!firestore || !warehouseId || !item?.id) return null
    return collection(firestore, "warehouses", warehouseId, "inventoryItems", item.id, "units")
  }, [firestore, warehouseId, item?.id])
  const { data: unitsData, isLoading } = useCollection(unitsRef)
  const units = ((unitsData || []) as Unit[]).slice().sort((a, b) => {
    const order = { in_stock: 0, damaged: 1, consumed: 2 }
    return order[a.status] - order[b.status]
  })

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

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : units.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("inv_unit_empty")}</div>
        ) : (
          <div className="border rounded-lg divide-y overflow-hidden">
            {units.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="font-mono font-semibold text-foreground truncate">{u.barcode}</span>
                  {statusBadge(u.status)}
                  {u.status === "consumed" && u.consumedProjectName && (
                    <span className="text-xs text-muted-foreground truncate">— {u.consumedProjectName}</span>
                  )}
                </div>
                {u.status !== "consumed" && (
                  <div className="flex items-center gap-1 shrink-0">
                    {u.status === "in_stock" && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-warning"
                        onClick={() => handleMarkDamaged(u.id)} disabled={busyUnitId === u.id} aria-label={t("inv_unit_mark_damaged")}>
                        {busyUnitId === u.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(u)} disabled={busyUnitId === u.id} aria-label={t("wh_delete_btn")}>
                      <X size={12} />
                    </Button>
                  </div>
                )}
              </div>
            ))}
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

      {/* Low stock alert */}
      {lowStockItems.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg text-sm text-warning">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="font-semibold">{t("inv_low_stock_alert", { count: lowStockItems.length })}</span>
        </div>
      )}

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
        <div className="rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b">
                <tr>
                  <th className={`py-3 px-4 font-bold text-muted-foreground ${isRtl ? "text-right" : "text-left"}`}>{t("inv_item_name")}</th>
                  <th className={`py-3 px-4 font-bold text-muted-foreground ${isRtl ? "text-right" : "text-left"}`}>{t("inv_item_sku")}</th>
                  <th className="py-3 px-4 font-bold text-muted-foreground text-center">{t("inv_item_qty")}</th>
                  <th className={`py-3 px-4 font-bold text-muted-foreground ${isRtl ? "text-right" : "text-left"}`}>{t("inv_item_unit")}</th>
                  <th className="py-3 px-4 font-bold text-muted-foreground text-center">{t("inv_item_min_stock")}</th>
                  <th className="py-3 px-4 w-28" />
                </tr>
              </thead>
              <tbody>
                {list.map((item, idx) => {
                  const isLow = item.minStockLevel != null && item.quantity <= item.minStockLevel
                  const isUnitTracked = item.trackingMode === "unit"
                  return (
                    <tr key={item.id} className={cn(idx % 2 === 0 ? "bg-white" : "bg-muted/10", isLow ? "border-s-2 border-warning" : "")}>
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
                      <td className="py-3 px-4 text-muted-foreground">{item.unit}</td>
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
