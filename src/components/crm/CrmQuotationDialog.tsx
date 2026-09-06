"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { collection, doc, addDoc, updateDoc, getDocs, query, where, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { CrmFormDialog, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import { FileText, Boxes, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { DATE_INPUT_CLASS } from "@/components/crm/CrmOpportunityDialog"
import {
  CRM_QUOTATIONS,
  QUOTATION_STATUSES,
  generateQuotationNumber,
  quotationItemsTotal,
  type CrmQuotation,
  type QuotationItem,
  type QuotationStatus,
} from "@/lib/crm"
import { createWorkOrderFromQuotation } from "@/lib/manufacturing"
import { useUser } from "@/firebase"

type ItemRow = { name: string; quantity: string; unit: string; unitPrice: string }
type StockOption = { name: string; unit: string; available: number }

const emptyRow = (): ItemRow => ({ name: "", quantity: "", unit: "", unitPrice: "" })

function parseRows(rows: ItemRow[]): QuotationItem[] {
  return rows
    .filter((r) => r.name.trim() && Number(r.quantity) > 0)
    .map((r) => ({
      name: r.name.trim(),
      quantity: Number(r.quantity),
      unit: r.unit.trim(),
      unitPrice: Number(r.unitPrice) || 0,
    }))
}

export function CrmQuotationDialog({
  open,
  onOpenChange,
  orgId,
  contactId,
  contactName,
  quotation,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  contactId: string
  contactName?: string | null
  quotation?: CrmQuotation
}) {
  const t = useTranslations("Portal.Shared")

  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [amount, setAmount] = useState("")
  const [status, setStatus] = useState<QuotationStatus>("draft")
  const [date, setDate] = useState("")
  const [notes, setNotes] = useState("")
  const [itemRows, setItemRows] = useState<ItemRow[]>([])
  const [stockOptions, setStockOptions] = useState<StockOption[]>([])
  const [stockPick, setStockPick] = useState("")

  useEffect(() => {
    if (!open) return
    setAmount(quotation?.amount != null ? String(quotation.amount) : "")
    setStatus(quotation?.status ?? "draft")
    setDate(quotation?.date ?? new Date().toISOString().split("T")[0])
    setNotes(quotation?.notes ?? "")
    setItemRows(
      (quotation?.items || []).map((i) => ({
        name: i.name,
        quantity: String(i.quantity),
        unit: i.unit,
        unitPrice: i.unitPrice ? String(i.unitPrice) : "",
      }))
    )
    setStockPick("")
  }, [open, quotation])

  // The template's inventory link: everything the org's warehouses hold,
  // aggregated by name so one option shows total availability everywhere.
  useEffect(() => {
    if (!open || !firestore || !orgId) return
    let cancelled = false
    ;(async () => {
      try {
        const whSnap = await getDocs(query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)))
        const byKey = new Map<string, StockOption>()
        for (const wh of whSnap.docs) {
          const inv = await getDocs(collection(firestore, "warehouses", wh.id, "inventoryItems"))
          inv.forEach((d) => {
            const name = ((d.data().name as string) || "").trim()
            if (!name) return
            const key = name.toLowerCase()
            const prev = byKey.get(key)
            byKey.set(key, {
              name,
              unit: prev?.unit || (d.data().unit as string) || "",
              available: (prev?.available || 0) + (Number(d.data().quantity) || 0),
            })
          })
        }
        if (!cancelled) setStockOptions(Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name)))
      } catch (err) {
        console.error("Inventory load for quotation template failed:", err)
      }
    })()
    return () => { cancelled = true }
  }, [open, firestore, orgId])

  const parsedItems = parseRows(itemRows)
  const itemsTotal = quotationItemsTotal(parsedItems)
  const hasItems = parsedItems.length > 0

  const addFromStock = (index: number) => {
    const opt = stockOptions[index]
    if (!opt) return
    setItemRows((p) => [...p, { name: opt.name, quantity: "", unit: opt.unit, unitPrice: "" }])
    setStockPick("")
  }

  const handleSave = async () => {
    if (!firestore || isSaving) return
    const parsed = hasItems ? itemsTotal : parseFloat(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: t("crm_quote_amount_error"), variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const data = {
        contactId,
        contactName: contactName ?? null,
        amount: parsed,
        items: hasItems ? parsedItems : null,
        status,
        date: date || null,
        notes: notes.trim() || null,
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      let quotationId = quotation?.id
      let quotationNumber = quotation?.quotationNumber
      if (quotation) {
        await updateDoc(doc(firestore, CRM_QUOTATIONS, quotation.id), data)
      } else {
        quotationNumber = generateQuotationNumber()
        const ref = await addDoc(collection(firestore, CRM_QUOTATIONS), {
          ...data,
          quotationNumber,
          createdAt: serverTimestamp(),
        })
        quotationId = ref.id
      }

      // Acceptance is the manufacturing trigger: the first flip to "accepted"
      // spawns a work order routed through the org's department chain —
      // unless one already exists for this quotation, or every requested good
      // is already sitting in a warehouse (see the lib).
      const becameAccepted = status === "accepted" && quotation?.status !== "accepted"
      if (becameAccepted && quotationId && user && !(quotation as { workOrderId?: string } | undefined)?.workOrderId) {
        try {
          const workOrderId = await createWorkOrderFromQuotation(firestore, {
            organizationId: orgId,
            quotationId,
            quotationNumber: quotationNumber || "",
            amount: parsed,
            contactId,
            contactName: contactName ?? null,
            opportunityId: quotation?.opportunityId ?? null,
            items: hasItems
              ? parsedItems.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit }))
              : undefined,
            userId: user.uid,
            userName: user.email || "",
          })
          if (workOrderId) toast({ title: t("crm_quote_work_order_created") })
        } catch (err) {
          console.error("Work order auto-create failed:", err)
          toast({ title: t("crm_quote_work_order_failed"), variant: "destructive" })
        }
      }

      toast({ title: t("crm_quote_saved") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const steps: CrmFormStep[] = [
    {
      id: "quotation",
      title: t("crm_quote_add_title"),
      validate: () => {
        return null
      },
      content: (
        <>
            <div className="rounded-xl border bg-muted/20 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label className="flex items-center gap-1.5">
                  <Boxes size={14} className="text-cta" />
                  {t("crm_quote_items_title")}
                </Label>
                <p className="text-[11px] text-muted-foreground">{t("crm_quote_items_hint")}</p>
              </div>
              {itemRows.map((row, i) => {
                const match = stockOptions.find((o) => o.name.toLowerCase() === row.name.trim().toLowerCase())
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder={t("crm_quote_item_name")}
                        value={row.name}
                        onChange={(e) => setItemRows((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                        className="flex-1 h-9 min-w-0"
                        disabled={isSaving}
                      />
                      <Input
                        placeholder={t("mfg_item_qty")} dir="ltr" inputMode="decimal"
                        value={row.quantity}
                        onChange={(e) => setItemRows((p) => p.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                        className="w-20 h-9"
                        disabled={isSaving}
                      />
                      <Input
                        placeholder={t("mfg_item_unit")}
                        value={row.unit}
                        onChange={(e) => setItemRows((p) => p.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                        className="w-20 h-9"
                        disabled={isSaving}
                      />
                      <Input
                        placeholder={t("crm_quote_item_price")} dir="ltr" inputMode="decimal"
                        value={row.unitPrice}
                        onChange={(e) => setItemRows((p) => p.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))}
                        className="w-24 h-9"
                        disabled={isSaving}
                      />
                      <button
                        type="button"
                        onClick={() => setItemRows((p) => p.filter((_, j) => j !== i))}
                        aria-label={t("mfg_remove_item")}
                        className="h-8 w-8 shrink-0 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={isSaving}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {row.name.trim() && (
                      <p className={cn("text-[11px] ps-1", match ? "text-success" : "text-muted-foreground")}>
                        {match
                          ? t("crm_quote_item_in_stock", { qty: match.available, unit: match.unit })
                          : t("crm_quote_item_to_manufacture")}
                      </p>
                    )}
                  </div>
                )
              })}
              <div className="flex items-center gap-2 flex-wrap">
                {stockOptions.length > 0 && (
                  <Select value={stockPick} onValueChange={(v) => addFromStock(Number(v))} disabled={isSaving}>
                    <SelectTrigger className="h-9 w-56 text-xs">
                      <SelectValue placeholder={t("crm_quote_add_from_inventory")} />
                    </SelectTrigger>
                    <SelectContent>
                      {stockOptions.map((o, i) => (
                        <SelectItem key={i} value={String(i)} className="text-xs">
                          {o.name} — {t("mfg_available", { qty: o.available, unit: o.unit })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setItemRows((p) => [...p, emptyRow()])} disabled={isSaving}>
                  <Plus size={13} />
                  {t("crm_quote_add_free_item")}
                </Button>
              </div>
              {hasItems && (
                <p className="text-xs font-bold text-cta flex items-center justify-between border-t border-border/50 pt-2">
                  {t("crm_quote_items_total")}
                  <span dir="ltr" className="tabular-nums">{itemsTotal.toLocaleString()} {t("mfg_sar")}</span>
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="quote-amount">{t("crm_quote_amount")} <RequiredMark /></Label>
                <Input
                  id="quote-amount" type="number" min="0" step="any" inputMode="decimal"
                  value={hasItems ? String(itemsTotal) : amount}
                  onChange={(e) => setAmount(e.target.value)}
                  dir="ltr"
                  disabled={isSaving || hasItems}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quote-status">{t("crm_quote_status")}</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as QuotationStatus)} disabled={isSaving}>
                  <SelectTrigger id="quote-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {QUOTATION_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{t(`crm_quote_status_${s}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote-date">{t("crm_quote_date")}</Label>
              <input id="quote-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" disabled={isSaving} className={DATE_INPUT_CLASS} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote-notes">{t("crm_notes")}</Label>
              <Textarea id="quote-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isSaving} />
            </div>
        </>
      ),
    },
  ]

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={FileText}
      title={quotation ? t("crm_quote_edit_title") : t("crm_quote_add_title")}
      description={t("crm_quote_dialog_desc")}
      steps={steps}
      isSaving={isSaving}
      submitLabel={t("crm_save")}
      onSubmit={() => void handleSave()}
      size="md"
    />
  )
}
