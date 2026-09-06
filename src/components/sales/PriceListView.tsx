"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from "firebase/firestore"
import { Tags, Plus, Pencil, Trash2, Search, Loader2, ArrowRight, Lock } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import { formatSar } from "@/lib/crm"
import { SALES_PRICE_ITEMS, type SalesPriceItem } from "@/lib/sales"
import type { CrmPortal } from "@/components/crm/CrmShell"

/** The org's known items with fixed prices — what Sales quotes without
 * looking anything up. Picked straight into a quotation's lines. */
export function PriceListView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManage = can("sales.manage")
  const { orgId, isLoading: isOrgLoading } = useCrmData()

  const itemsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_PRICE_ITEMS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: itemsData, isLoading } = useCollection(itemsQuery)
  const items = useMemo(
    () => ((itemsData || []) as SalesPriceItem[]).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [itemsData]
  )

  const [search, setSearch] = useState("")
  const visible = items.filter((i) => !search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase()))

  // ── Editor ──
  const [editor, setEditor] = useState<"closed" | "new" | SalesPriceItem>("closed")
  const [name, setName] = useState("")
  const [unit, setUnit] = useState("")
  const [price, setPrice] = useState("")
  const [notes, setNotes] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SalesPriceItem | null>(null)

  const openEditor = (target: "new" | SalesPriceItem) => {
    const item = target === "new" ? null : target
    setName(item?.name || "")
    setUnit(item?.unit || "")
    setPrice(item ? String(item.unitPrice) : "")
    setNotes(item?.notes || "")
    setEditor(target)
  }

  const save = async () => {
    if (!firestore || !orgId || isSaving) return
    const parsedPrice = parseFloat(price)
    if (!name.trim() || !unit.trim() || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      toast({ title: t("pl_name_required"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const data = { name: name.trim(), unit: unit.trim(), unitPrice: parsedPrice, notes: notes.trim() || null, organizationId: orgId, updatedAt: serverTimestamp() }
      if (editor === "new") await addDoc(collection(firestore, SALES_PRICE_ITEMS), { ...data, createdAt: serverTimestamp() })
      else if (editor !== "closed") await updateDoc(doc(firestore, SALES_PRICE_ITEMS, editor.id), data)
      toast({ title: t("pl_saved") })
      setEditor("closed")
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async () => {
    if (!firestore || !deleteTarget) return
    try {
      await deleteDoc(doc(firestore, SALES_PRICE_ITEMS, deleteTarget.id))
      toast({ title: t("pl_deleted") })
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/${portal}/sales`}
            className="text-xs font-semibold text-muted-foreground hover:text-primary flex items-center gap-1 mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm w-fit"
          >
            <ArrowRight size={12} className={cn(!isRtl && "rotate-180")} aria-hidden="true" />
            {t("pl_back_to_sales")}
          </Link>
          <h1 className="text-2xl font-black text-primary flex items-center gap-2">
            <Tags size={22} className="shrink-0" aria-hidden="true" />
            {t("pl_page_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("pl_page_desc")}</p>
          {!isOrgLoading && !canManage && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <Lock size={12} aria-hidden="true" />
              {t("pl_no_permission")}
            </p>
          )}
        </div>
        <Button className="gap-2 shrink-0" onClick={() => openEditor("new")} disabled={!canManage || isOrgLoading}>
          <Plus size={16} />
          {t("pl_add_btn")}
        </Button>
      </header>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground font-semibold">{t("pl_count", { count: items.length })}</p>
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("pl_search_placeholder")} aria-label={t("pl_search_placeholder")} className="h-9 ps-9" />
        </div>
      </div>

      {isLoading || isOrgLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : visible.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
          <Tags size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{t("pl_empty")}</p>
        </div>
      ) : (
        <ul className="rounded-2xl border bg-white divide-y overflow-hidden">
          {visible.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground truncate" dir="auto">{item.name}</p>
                <p className="text-xs text-muted-foreground" dir="auto">
                  {item.unit}
                  {item.notes && <span className="ms-1.5">· {item.notes}</span>}
                </p>
              </div>
              <span className="text-sm font-black tabular-nums shrink-0" dir="ltr">{formatSar(item.unitPrice, locale)}</span>
              {canManage && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-primary" aria-label={`${t("pl_edit_title")} — ${item.name}`} onClick={() => openEditor(item)}>
                    <Pencil size={13} />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label={`${t("pl_delete_confirm_title")} — ${item.name}`} onClick={() => setDeleteTarget(item)}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editor !== "closed"} onOpenChange={(open) => { if (!open && !isSaving) setEditor("closed") }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editor === "new" ? t("pl_add_title") : t("pl_edit_title")}</DialogTitle>
            <DialogDescription>{t("pl_page_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pl-name">{t("pl_name")} *</Label>
              <Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} disabled={isSaving} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pl-unit">{t("pl_unit")} *</Label>
                <Input id="pl-unit" value={unit} onChange={(e) => setUnit(e.target.value)} disabled={isSaving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-price">{t("pl_price")} *</Label>
                <Input id="pl-price" type="number" min="0" step="any" inputMode="decimal" dir="ltr" value={price} onChange={(e) => setPrice(e.target.value)} disabled={isSaving} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-notes">{t("pl_notes")}</Label>
              <Textarea id="pl-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isSaving} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor("closed")} disabled={isSaving}>{t("crm_cancel")}</Button>
            <Button onClick={save} disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {t("crm_save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pl_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("pl_delete_confirm_desc", { name: deleteTarget?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("crm_cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive hover:bg-destructive/90">{t("pl_delete_btn")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
