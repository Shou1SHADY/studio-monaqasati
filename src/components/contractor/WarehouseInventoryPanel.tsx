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
import { useCollection, useFirestore, useDoc, useMemoFirebase } from "@/firebase"
import { collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp, increment } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { Warehouse, Plus, Pencil, Trash2, Loader2, MapPin, Package, AlertTriangle, Barcode, Ban, X } from "lucide-react"
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
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2 min-w-0">
              <Barcode size={16} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-700">{t("inv_item_unit_tracking")}</p>
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
                  <span className="font-mono font-semibold text-slate-700 truncate">{u.barcode}</span>
                  {statusBadge(u.status)}
                  {u.status === "consumed" && u.consumedProjectName && (
                    <span className="text-xs text-muted-foreground truncate">— {u.consumedProjectName}</span>
                  )}
                </div>
                {u.status !== "consumed" && (
                  <div className="flex items-center gap-1 shrink-0">
                    {u.status === "in_stock" && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-amber-600"
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
  const canManageWarehouses = can("warehouses.manage")

  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState<InventoryItem | null>(null)
  const [deleteItem, setDeleteItem] = useState<InventoryItem | null>(null)
  const [unitsItem, setUnitsItem] = useState<InventoryItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const warehouseRef = useMemoFirebase(() => {
    if (!firestore || !warehouseId) return null
    return doc(firestore, "warehouses", warehouseId)
  }, [firestore, warehouseId])
  const { data: warehouse } = useDoc(warehouseRef)
  const wh = warehouse as WarehouseDoc | null

  const itemsRef = useMemoFirebase(() => {
    if (!firestore || !warehouseId) return null
    return collection(firestore, "warehouses", warehouseId, "inventoryItems")
  }, [firestore, warehouseId])
  const { data: items, isLoading } = useCollection(itemsRef)
  const list = (items || []) as InventoryItem[]

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
            </div>
            {wh?.location && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin size={11} />
                {wh.location}
              </p>
            )}
          </div>
        )}
        {variant === "embedded" && <div className="flex-1" />}
        {canManageWarehouses && (
          <Button onClick={() => setShowAdd(true)} className="gap-2 shrink-0">
            <Plus size={16} />
            {t("inv_item_add_btn")}
          </Button>
        )}
      </div>

      {/* Low stock alert */}
      {lowStockItems.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
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
                    <tr key={item.id} className={cn(idx % 2 === 0 ? "bg-white" : "bg-muted/10", isLow ? "border-l-2 border-amber-400" : "")}>
                      <td className="py-3 px-4 font-semibold text-primary">
                        {item.name}
                        {isUnitTracked && (
                          <Badge variant="outline" className="ms-2 text-primary border-primary/20 text-[10px] py-0 gap-1">
                            <Barcode size={9} />
                            {t("inv_item_unit_tracking_badge")}
                          </Badge>
                        )}
                        {isLow && (
                          <Badge variant="outline" className="ms-2 text-amber-600 border-amber-200 text-[10px] py-0">
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
