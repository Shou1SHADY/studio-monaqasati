"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import {
  Warehouse,
  ArrowRight,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  MapPin,
  Package,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"

type InventoryItem = {
  id: string
  name: string
  sku?: string
  quantity: number
  unit: string
  minStockLevel?: number
}

type WarehouseDoc = {
  id: string
  name: string
  location: string
  description?: string
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
  t: ReturnType<typeof useTranslations<"Portal.Supplier">>
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

  const reset = () => {
    setName(item?.name ?? "")
    setSku(item?.sku ?? "")
    setQuantity(item?.quantity?.toString() ?? "0")
    setUnit(item?.unit ?? "")
    setMinStockLevel(item?.minStockLevel?.toString() ?? "")
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
        quantity: Math.max(0, parseFloat(quantity) || 0),
        unit: unit.trim(),
        minStockLevel: minStockLevel ? Math.max(0, parseFloat(minStockLevel) || 0) : null,
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
              <Input id="item-qty" type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-min">{t("inv_item_min_stock")}</Label>
              <Input id="item-min" type="number" min="0" value={minStockLevel}
                onChange={(e) => setMinStockLevel(e.target.value)} placeholder={t("inv_item_min_placeholder")} dir="ltr" />
            </div>
          </div>
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

export default function SupplierWarehouseDetailPage() {
  const t = useTranslations("Portal.Supplier")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const params = useParams()
  const warehouseId = params.id as string
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState<InventoryItem | null>(null)
  const [deleteItem, setDeleteItem] = useState<InventoryItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const myOrgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""

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
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        <div className="flex items-center gap-3">
          <Link href="/supplier/warehouses" className="text-muted-foreground hover:text-primary transition-colors">
            <ArrowRight size={18} className={cn(isRtl ? "" : "rotate-180")} />
          </Link>
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
          <Button onClick={() => setShowAdd(true)} className="gap-2 shrink-0">
            <Plus size={16} />
            {t("inv_item_add_btn")}
          </Button>
        </div>

        {lowStockItems.length > 0 && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="font-semibold">{t("inv_low_stock_alert", { count: lowStockItems.length })}</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Package size={48} className="text-muted-foreground/20" />
            <p className="font-bold text-muted-foreground">{t("inv_item_empty_title")}</p>
            <p className="text-sm text-muted-foreground/70">{t("inv_item_empty_desc")}</p>
            <Button onClick={() => setShowAdd(true)} variant="outline" className="gap-2 mt-2">
              <Plus size={14} />
              {t("inv_item_add_btn")}
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
                    <th className="py-3 px-4 font-bold text-muted-foreground text-center">{t("inv_item_min_stock")}</th>
                    <th className="py-3 px-4 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((item, idx) => {
                    const isLow = item.minStockLevel != null && item.quantity <= item.minStockLevel
                    return (
                      <tr key={item.id} className={cn(idx % 2 === 0 ? "bg-white" : "bg-muted/10", isLow ? "border-l-2 border-amber-400" : "")}>
                        <td className="py-3 px-4 font-semibold text-primary">
                          {item.name}
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
                        <td className="py-3 px-4 text-center text-muted-foreground" dir="ltr">{item.minStockLevel ?? "—"}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1 justify-end">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                              onClick={() => setEditItem(item)} aria-label={t("inv_item_edit_title")}>
                              <Pencil size={13} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteItem(item)} aria-label={t("wh_delete_btn")}>
                              <Trash2 size={13} />
                            </Button>
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

      <ItemDialog open={showAdd} onOpenChange={setShowAdd} warehouseId={warehouseId} orgId={myOrgId} t={t} locale={locale} />
      {editItem && (
        <ItemDialog open={!!editItem} onOpenChange={(open) => { if (!open) setEditItem(null) }}
          item={editItem} warehouseId={warehouseId} orgId={myOrgId} t={t} locale={locale} />
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
    </PortalLayout>
  )
}
