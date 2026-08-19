"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
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
import { useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCentralWarehouse } from "@/hooks/useCentralWarehouse"
import { useWarehouseDashboardStats } from "@/hooks/useWarehouseDashboardStats"
import { Warehouse, Plus, Pencil, Trash2, Loader2, MapPin, Package, ArrowRight, Building2, Star, ArrowLeft, AlertTriangle, ArrowLeftRight } from "lucide-react"
import { cn } from "@/lib/utils"

type WarehouseDoc = {
  id: string
  name: string
  location: string
  description?: string | null
  organizationId: string
  projectId?: string | null
  projectName?: string | null
  isCentral?: boolean
}

function WarehouseDialog({
  open,
  onOpenChange,
  warehouse,
  orgId,
  t,
  locale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  warehouse?: WarehouseDoc
  orgId: string
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [name, setName] = useState(warehouse?.name ?? "")
  const [location, setLocation] = useState(warehouse?.location ?? "")
  const [description, setDescription] = useState(warehouse?.description ?? "")

  const reset = () => {
    setName(warehouse?.name ?? "")
    setLocation(warehouse?.location ?? "")
    setDescription(warehouse?.description ?? "")
  }

  const handleSave = async () => {
    if (!firestore) return
    if (!name.trim() || !location.trim()) {
      toast({ title: t("wh_validation_error"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const data = {
        name: name.trim(),
        location: location.trim(),
        description: description.trim() || null,
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      if (warehouse) {
        await updateDoc(doc(firestore, "warehouses", warehouse.id), data)
        toast({ title: t("wh_updated") })
      } else {
        await addDoc(collection(firestore, "warehouses"), { ...data, createdAt: serverTimestamp() })
        toast({ title: t("wh_created") })
      }
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("wh_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) { onOpenChange(next); if (!next) reset() } }}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{warehouse ? t("wh_edit_title") : t("wh_add_title")}</DialogTitle>
          <DialogDescription>{t("wh_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="wh-name">{t("wh_name")} *</Label>
            <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("wh_name_placeholder")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-location">{t("wh_location")} *</Label>
            <Input id="wh-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("wh_location_placeholder")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-desc">{t("wh_description")}</Label>
            <Input id="wh-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("wh_description_placeholder")} />
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

export default function ContractorWarehousesPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManageWarehouses = can("warehouses.manage")

  const [showAdd, setShowAdd] = useState(false)
  const [editWarehouse, setEditWarehouse] = useState<WarehouseDoc | null>(null)
  const [deleteWarehouse, setDeleteWarehouse] = useState<WarehouseDoc | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const myOrgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""

  const { central, projectWarehouses, isLoading } = useCentralWarehouse(myOrgId)
  const list = projectWarehouses as WarehouseDoc[]
  const { totalWarehouses, lowStockCount, recentTransferCount } = useWarehouseDashboardStats(myOrgId)

  const handleDelete = async () => {
    if (!firestore || !deleteWarehouse || deleteWarehouse.isCentral) return
    setIsDeleting(true)
    try {
      await deleteDoc(doc(firestore, "warehouses", deleteWarehouse.id))
      toast({ title: t("wh_deleted") })
      setDeleteWarehouse(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("wh_delete_error"), variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-primary flex items-center gap-2">
              <Warehouse size={22} />
              {t("wh_page_title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t("wh_page_desc")}</p>
          </div>
          {canManageWarehouses && (
            <Button onClick={() => setShowAdd(true)} className="gap-2 shrink-0">
              <Plus size={16} />
              {t("wh_add_btn")}
            </Button>
          )}
        </div>

        {/* Dashboard stat tiles — the Warehouses component's own summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                <Warehouse size={18} className="text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-black text-foreground">{totalWarehouses}</p>
                <p className="text-xs text-muted-foreground truncate">{t("wh_dash_total_warehouses")}</p>
              </div>
            </CardContent>
          </Card>
          <Card className={cn(lowStockCount > 0 && "border-warning/40 bg-warning/5")}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center shrink-0", lowStockCount > 0 ? "bg-warning/10" : "bg-slate-100")}>
                <AlertTriangle size={18} className={lowStockCount > 0 ? "text-warning" : "text-muted-foreground"} />
              </div>
              <div className="min-w-0">
                <p className={cn("text-xl font-black", lowStockCount > 0 ? "text-warning" : "text-foreground")}>{lowStockCount}</p>
                <p className="text-xs text-muted-foreground truncate">{t("wh_dash_low_stock")}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <ArrowLeftRight size={18} className="text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-black text-foreground">{recentTransferCount}</p>
                <p className="text-xs text-muted-foreground truncate">{t("wh_dash_recent_transfers")}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Central warehouse — the company's master stock, pinned on top */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {central && (
              <Card className="border-2 border-accent/30 bg-gradient-to-bl from-accent/5 via-transparent to-transparent overflow-hidden">
                <CardContent className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="h-14 w-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                    <Warehouse size={26} className="text-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-black text-primary">{central.name}</h2>
                      <span className="inline-flex items-center gap-1 text-[10px] font-black text-accent bg-accent/10 border border-accent/30 rounded-full px-2 py-0.5">
                        <Star size={10} />
                        {t("wh_central_badge")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{t("wh_central_desc")}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canManageWarehouses && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={() => setEditWarehouse(central as WarehouseDoc)} aria-label={t("wh_edit_title")}>
                        <Pencil size={14} />
                      </Button>
                    )}
                    <Button asChild className="gap-2 bg-accent hover:bg-accent/90 text-white">
                      <Link href={`/contractor/warehouses/${central.id}`}>
                        <Package size={15} />
                        {t("wh_view_inventory")}
                        {isRtl ? <ArrowLeft size={14} /> : <ArrowRight size={14} />}
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Project & secondary warehouses — each draws its stock from the central one */}
            <div className="flex items-center gap-2 pt-2">
              <Building2 size={16} className="text-primary" />
              <h2 className="font-bold text-primary">{t("wh_project_section_title")}</h2>
              <span className="text-xs text-muted-foreground">{t("wh_project_section_desc")}</span>
            </div>
            {list.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center border border-dashed rounded-2xl">
                <Warehouse size={40} className="text-muted-foreground/20" />
                <p className="font-bold text-muted-foreground">{t("wh_empty_title")}</p>
                <p className="text-sm text-muted-foreground/70">{t("wh_empty_desc")}</p>
                {canManageWarehouses && (
                  <Button onClick={() => setShowAdd(true)} variant="outline" className="gap-2 mt-2">
                    <Plus size={14} />
                    {t("wh_add_btn")}
                  </Button>
                )}
              </div>
            ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((wh) => (
              <Card key={wh.id} className="hover:shadow-md transition-shadow group">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/5 flex items-center justify-center shrink-0">
                      <Warehouse size={18} className="text-primary" />
                    </div>
                    {canManageWarehouses && (
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                          onClick={() => setEditWarehouse(wh)} aria-label={t("wh_edit_title")}>
                          <Pencil size={13} />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteWarehouse(wh)} aria-label={t("wh_delete_btn")}>
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    )}
                  </div>
                  <h3 className="font-bold text-primary mb-1">{wh.name}</h3>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                    <MapPin size={11} />
                    {wh.location}
                  </p>
                  {wh.description && (
                    <p className="text-xs text-muted-foreground/70 truncate">{wh.description}</p>
                  )}
                  {wh.projectId && (
                    <Link
                      href={`/contractor/projects/${wh.projectId}`}
                      className={cn(
                        "mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-accent bg-accent/5 border border-accent/20 rounded-full px-2 py-0.5 hover:bg-accent/10 transition-colors",
                        isRtl ? "flex-row-reverse" : ""
                      )}
                    >
                      <Building2 size={10} />
                      {t("wh_linked_project", { name: wh.projectName || wh.projectId })}
                    </Link>
                  )}
                  <Link
                    href={`/contractor/warehouses/${wh.id}`}
                    className={cn(
                      "mt-4 flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline",
                      isRtl ? "flex-row-reverse justify-end" : ""
                    )}
                  >
                    <Package size={12} />
                    {t("wh_view_inventory")}
                    <ArrowRight size={12} className={cn(isRtl ? "rotate-180" : "")} />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
            )}
          </>
        )}
      </div>

      <WarehouseDialog open={showAdd} onOpenChange={setShowAdd} orgId={myOrgId} t={t} locale={locale} />
      {editWarehouse && (
        <WarehouseDialog
          open={!!editWarehouse}
          onOpenChange={(open) => { if (!open) setEditWarehouse(null) }}
          warehouse={editWarehouse}
          orgId={myOrgId}
          t={t}
          locale={locale}
        />
      )}

      <AlertDialog open={!!deleteWarehouse} onOpenChange={(open) => { if (!open) setDeleteWarehouse(null) }}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("wh_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("wh_delete_confirm_desc", { name: deleteWarehouse?.name ?? "" })}
            </AlertDialogDescription>
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
