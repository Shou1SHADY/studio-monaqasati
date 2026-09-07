"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { collection, doc, addDoc, updateDoc, getDocs, query, where, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { CrmFormDialog, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import { FileText, Boxes, Plus, Trash2, Factory, Banknote, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { DATE_INPUT_CLASS } from "@/components/crm/CrmOpportunityDialog"
import {
  CRM_QUOTATIONS,
  QUOTATION_STATUSES,
  QUOTATION_PHASES,
  defaultInstallments,
  formatSar,
  generateQuotationNumber,
  quotationItemsTotal,
  quotationPhase,
  validateInstallments,
  type CrmQuotation,
  type QuotationInstallment,
  type QuotationItem,
  type QuotationPhase,
  type QuotationStatus,
} from "@/lib/crm"
import type { WorkOrder } from "@/lib/manufacturing"
import {
  SALES_PRICE_ITEMS,
  findPriceItem,
  quotationPrefillFromWorkOrder,
  runQuotationAcceptance,
  statusStamp,
  type SalesPriceItem,
} from "@/lib/sales"
import { usePermissions } from "@/hooks/usePermissions"
import { useUser } from "@/firebase"

type ItemRow = { name: string; quantity: string; unit: string; unitPrice: string }
type StockOption = { name: string; unit: string; available: number }
type InstallmentRow = { id: string; label: string; percent: string }

const emptyRow = (): ItemRow => ({ name: "", quantity: "", unit: "", unitPrice: "" })

function parseInstallments(rows: InstallmentRow[]): QuotationInstallment[] {
  return rows.map((r) => ({ id: r.id, label: r.label.trim(), percent: Number(r.percent) }))
}

function newInstallmentId(): string {
  return `inst_${Math.random().toString(36).slice(2, 8)}`
}

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

/** Seeds for a NEW quotation (ignored when editing): its phase, a prefilled
 * line list, and the finished work order being sold — how Sales quotes a
 * manufactured item. */
export interface QuotationDefaults {
  phase?: QuotationPhase
  items?: QuotationItem[]
  workOrderId?: string | null
  workOrderNumber?: number | null
}

export function CrmQuotationDialog({
  open,
  onOpenChange,
  orgId,
  contactId,
  contactName,
  quotation,
  defaults,
  contacts,
  finishedOrders,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  /** The contact the quotation is for. Leave empty and pass `contacts` to let
   * the user choose one (Sales mode) — the dialog then opens with a customer step. */
  contactId?: string
  contactName?: string | null
  quotation?: CrmQuotation
  defaults?: QuotationDefaults
  /** Sales mode: the org's contacts to pick a customer from. */
  contacts?: Array<{ id: string; name: string }>
  /** Sales mode: finished work orders a post-manufacturing quotation can price. */
  finishedOrders?: WorkOrder[]
  /** Called with the saved quotation's id — Sales opens its detail page. */
  onSaved?: (quotationId: string) => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()

  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  // Marking a quotation accepted is the customer's approval — it posts the
  // deposit to Finance and opens the work order — so it is its own permission
  // (crm.close carries the same authority when a deal is awarded from CRM).
  const canApprove = can("sales.approve") || can("crm.close")
  // Read through a ref so a parent re-rendering with a fresh `defaults`
  // object never resets a form the user is typing into.
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults
  const nameListId = useId()
  const [isSaving, setIsSaving] = useState(false)
  const [amount, setAmount] = useState("")
  const [status, setStatus] = useState<QuotationStatus>("draft")
  const [phase, setPhase] = useState<QuotationPhase>("pre_manufacturing")
  const [date, setDate] = useState("")
  const [notes, setNotes] = useState("")
  const [itemRows, setItemRows] = useState<ItemRow[]>([])
  const [installments, setInstallments] = useState<InstallmentRow[]>([])
  const [stockOptions, setStockOptions] = useState<StockOption[]>([])
  const [priceItems, setPriceItems] = useState<SalesPriceItem[]>([])
  const [stockPick, setStockPick] = useState("")
  const [pricePick, setPricePick] = useState("")
  // Sales mode: the customer is chosen inside the dialog, and a finished work
  // order may seed the lines. CRM mode: the contact page already knows both.
  const salesMode = !!contacts && !contactId && !quotation
  const [selectedContactId, setSelectedContactId] = useState("")
  const [linkedOrderId, setLinkedOrderId] = useState("")
  const linkedOrder = finishedOrders?.find((o) => o.id === linkedOrderId) ?? null
  const effectiveContactId = salesMode ? selectedContactId : contactId || quotation?.contactId || ""
  const effectiveContactName = salesMode
    ? contacts?.find((c) => c.id === selectedContactId)?.name ?? null
    : contactName ?? quotation?.contactName ?? null

  useEffect(() => {
    if (!open) return
    setSelectedContactId(contactId || "")
    setLinkedOrderId("")
    const seeds = quotation ? null : defaultsRef.current
    setAmount(quotation?.amount != null ? String(quotation.amount) : "")
    setStatus(quotation?.status ?? "draft")
    setPhase(quotation ? quotationPhase(quotation) : seeds?.phase ?? "pre_manufacturing")
    setDate(quotation?.date ?? new Date().toISOString().split("T")[0])
    setNotes(quotation?.notes ?? "")
    setItemRows(
      (quotation?.items || seeds?.items || []).map((i) => ({
        name: i.name,
        quantity: String(i.quantity),
        unit: i.unit,
        unitPrice: i.unitPrice ? String(i.unitPrice) : "",
      }))
    )
    // A new quotation starts with the agreed deposit + balance; an existing
    // one keeps whatever schedule it has (none = one full payment).
    const schedule = quotation
      ? quotation.installments || []
      : defaultInstallments({ deposit: t("crm_quote_installment_deposit"), balance: t("crm_quote_installment_balance") })
    setInstallments(schedule.map((i) => ({ id: i.id, label: i.label, percent: String(i.percent) })))
    setStockPick("")
    setPricePick("")
  }, [open, quotation, contactId, t])

  /** A finished order's output becomes the single (unpriced) line, and its
   * customer is preselected when the order came from a quotation. */
  const pickFinishedOrder = (id: string) => {
    setLinkedOrderId(id)
    const order = finishedOrders?.find((o) => o.id === id)
    if (!order) return
    const prefill = quotationPrefillFromWorkOrder(order)
    setItemRows(prefill.items.map((i) => ({ name: i.name, quantity: String(i.quantity), unit: i.unit, unitPrice: "" })))
    if (prefill.contactId && contacts?.some((c) => c.id === prefill.contactId)) setSelectedContactId(prefill.contactId)
  }

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
      // The Sales price list — known items with fixed prices.
      try {
        const priceSnap = await getDocs(query(collection(firestore, SALES_PRICE_ITEMS), where("organizationId", "==", orgId)))
        if (!cancelled) {
          setPriceItems(
            priceSnap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<SalesPriceItem, "id">) }))
              .sort((a, b) => a.name.localeCompare(b.name))
          )
        }
      } catch (err) {
        console.error("Price list load for quotation failed:", err)
      }
    })()
    return () => { cancelled = true }
  }, [open, firestore, orgId])

  const parsedItems = parseRows(itemRows)
  const itemsTotal = quotationItemsTotal(parsedItems)
  const hasItems = parsedItems.length > 0
  const effectiveAmount = hasItems ? itemsTotal : parseFloat(amount) || 0
  const parsedInstallments = parseInstallments(installments)
  const installmentsPercent = parsedInstallments.reduce((sum, i) => sum + (Number.isFinite(i.percent) ? i.percent : 0), 0)
  const acceptLocked = !canApprove && quotation?.status !== "accepted"

  const addFromStock = (index: number) => {
    const opt = stockOptions[index]
    if (!opt) return
    setItemRows((p) => [...p, { name: opt.name, quantity: "", unit: opt.unit, unitPrice: "" }])
    setStockPick("")
  }
  const addFromPriceList = (id: string) => {
    const item = priceItems.find((p) => p.id === id)
    if (!item) return
    setItemRows((p) => [...p, { name: item.name, quantity: "", unit: item.unit, unitPrice: String(item.unitPrice) }])
    setPricePick("")
  }
  /** Typing a name that is on the price list fills its unit and price. */
  const setRowName = (index: number, name: string) => {
    const match = findPriceItem(priceItems, name)
    setItemRows((p) =>
      p.map((x, j) =>
        j === index
          ? {
              ...x,
              name,
              unit: x.unit || (match ? match.unit : x.unit),
              unitPrice: x.unitPrice || (match ? String(match.unitPrice) : x.unitPrice),
            }
          : x
      )
    )
  }

  const handleSave = async () => {
    if (!firestore || isSaving) return
    const parsed = hasItems ? itemsTotal : parseFloat(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: t("crm_quote_amount_error"), variant: "destructive" })
      return
    }
    const scheduleError = validateInstallments(parsedInstallments)
    if (scheduleError) {
      toast({
        title: t(
          scheduleError === "empty_label"
            ? "crm_quote_installments_error_label"
            : scheduleError === "bad_percent"
              ? "crm_quote_installments_error_percent"
              : "crm_quote_installments_error_total"
        ),
        variant: "destructive",
      })
      return
    }
    if (status === "accepted" && acceptLocked) {
      toast({ title: t("crm_quote_accept_locked"), variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const nowIso = new Date().toISOString()
      const data = {
        contactId: effectiveContactId,
        contactName: effectiveContactName,
        ...statusStamp(quotation?.status, status, nowIso),
        amount: parsed,
        items: hasItems ? parsedItems : null,
        installments: parsedInstallments.length > 0 ? parsedInstallments : null,
        status,
        phase,
        date: date || null,
        notes: notes.trim() || null,
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      let quotationId = quotation?.id
      let quotationNumber = quotation?.quotationNumber
      const seeds = defaultsRef.current
      if (quotation) {
        await updateDoc(doc(firestore, CRM_QUOTATIONS, quotation.id), data)
      } else {
        quotationNumber = generateQuotationNumber()
        const ref = await addDoc(collection(firestore, CRM_QUOTATIONS), {
          ...data,
          quotationNumber,
          workOrderId: linkedOrder?.id ?? seeds?.workOrderId ?? null,
          workOrderNumber: linkedOrder?.orderNumber ?? seeds?.workOrderNumber ?? null,
          createdAt: serverTimestamp(),
        })
        quotationId = ref.id
      }

      // Acceptance is the manufacturing trigger: the first flip to "accepted"
      // spawns a work order routed through the org's department chain —
      // unless one already exists for this quotation, or every requested good
      // is already sitting in a warehouse (see the lib). A post-manufacturing
      // quotation prices goods that already exist, so it never manufactures.
      // Everything the customer's approval sets in motion (Finance told of
      // the deposit, the work order for goods not in stock) lives in the lib,
      // shared with the Sales detail page.
      const becameAccepted = status === "accepted" && quotation?.status !== "accepted"
      if (becameAccepted && quotationId && user) {
        try {
          const result = await runQuotationAcceptance(firestore, {
            orgId,
            user: { id: user.uid, name: user.email || "" },
            quotation: {
              id: quotationId,
              quotationNumber: quotationNumber || "",
              contactId: effectiveContactId,
              contactName: effectiveContactName,
              opportunityId: quotation?.opportunityId ?? null,
              amount: parsed,
              items: hasItems ? parsedItems : null,
              installments: parsedInstallments.length > 0 ? parsedInstallments : null,
              phase,
              workOrderId: quotation?.workOrderId ?? linkedOrder?.id ?? seeds?.workOrderId ?? null,
            },
            notification: {
              title: t("sales_notif_approved_title"),
              message: (deposit) =>
                t("sales_notif_approved_msg", {
                  contact: effectiveContactName || "—",
                  number: quotationNumber || "",
                  amount: formatSar(parsed, locale),
                  deposit: deposit
                    ? t("sales_notif_approved_deposit", {
                        label: deposit.label || t("crm_quote_installment_full"),
                        percent: deposit.percent,
                        amount: formatSar(deposit.amount, locale),
                      })
                    : "",
                }),
            },
          })
          if (result.notified > 0) toast({ title: t("crm_quote_finance_notified") })
          if (result.workOrderId) toast({ title: t("crm_quote_work_order_created") })
        } catch (err) {
          console.error("Work order auto-create failed:", err)
          toast({ title: t("crm_quote_work_order_failed"), variant: "destructive" })
        }
      }

      toast({ title: t("crm_quote_saved") })
      onOpenChange(false)
      if (quotationId) onSaved?.(quotationId)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const phaseControl = (
        <div className="space-y-1.5">
          <Label>{t("crm_quote_phase")}</Label>
          <div role="group" aria-label={t("crm_quote_phase")} className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1">
            {QUOTATION_PHASES.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={phase === p}
                disabled={isSaving}
                onClick={() => setPhase(p)}
                className={cn(
                  "h-9 rounded-md text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                  phase === p ? "bg-primary text-white shadow-sm" : "text-slate-600 hover:bg-white"
                )}
              >
                {t(`crm_quote_phase_${p}`)}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t(phase === "post_manufacturing" ? "crm_quote_phase_hint_post" : "crm_quote_phase_hint_pre")}
          </p>
          {(quotation?.workOrderNumber ?? defaultsRef.current?.workOrderNumber) != null && (
            <p className="text-[11px] font-semibold text-cta flex items-center gap-1">
              <Factory size={11} aria-hidden="true" />
              {t("crm_quote_work_order_ref", { number: quotation?.workOrderNumber ?? defaultsRef.current?.workOrderNumber ?? "" })}
            </p>
          )}
        </div>
  )

  const customerStep: CrmFormStep = {
    id: "customer",
    title: t("crm_quote_step_customer"),
    validate: () => (selectedContactId ? null : t("sales_pick_contact_required")),
    content: (
      <>
        <div className="space-y-1.5">
          <Label htmlFor="quote-customer">{t("sales_pick_contact")} <RequiredMark /></Label>
          {contacts && contacts.length > 0 ? (
            <Select value={selectedContactId || undefined} onValueChange={setSelectedContactId} disabled={isSaving}>
              <SelectTrigger id="quote-customer"><SelectValue placeholder={t("sales_pick_contact_placeholder")} /></SelectTrigger>
              <SelectContent>
                {[...contacts].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground border border-dashed rounded-lg p-3">{t("sales_no_contacts")}</p>
          )}
        </div>
        {phaseControl}
        {phase === "post_manufacturing" && finishedOrders && (
          <div className="space-y-1.5">
            <Label htmlFor="quote-order">{t("sales_pick_work_order")}</Label>
            <Select value={linkedOrderId || "__none__"} onValueChange={(v) => pickFinishedOrder(v === "__none__" ? "" : v)} disabled={isSaving}>
              <SelectTrigger id="quote-order"><SelectValue placeholder={t("sales_pick_work_order_placeholder")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("sales_pick_work_order_none")}</SelectItem>
                {finishedOrders.map((o) => (
                  <SelectItem key={o.id} value={o.id}>#{o.orderNumber} {o.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </>
    ),
  }

  const detailsStep: CrmFormStep = {
    id: "quotation",
    title: salesMode ? t("crm_quote_step_details") : t("crm_quote_add_title"),
    validate: () => null,
    content: (
        <>
            {!salesMode && phaseControl}
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
                        list={nameListId}
                        onChange={(e) => setRowName(i, e.target.value)}
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
              {/* Name suggestions: everything in stock plus the price list, so a
                  free-typed item can still be picked instead of retyped. */}
              <datalist id={nameListId}>
                {[...new Set([...stockOptions.map((o) => o.name), ...priceItems.map((p) => p.name)])].map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
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
                {priceItems.length > 0 && (
                  <Select value={pricePick} onValueChange={addFromPriceList} disabled={isSaving}>
                    <SelectTrigger className="h-9 w-56 text-xs">
                      <SelectValue placeholder={t("crm_quote_add_from_price_list")} />
                    </SelectTrigger>
                    <SelectContent>
                      {priceItems.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">
                          {p.name} — <span dir="ltr">{formatSar(p.unitPrice, locale)}</span> / {p.unit}
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

            {/* Payment schedule — defined here so Finance reads it straight
                off the quotation (deposit → work order, no manual hand-off). */}
            <div className="rounded-xl border bg-muted/20 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label className="flex items-center gap-1.5">
                  <Banknote size={14} className="text-success" />
                  {t("crm_quote_installments_title")}
                </Label>
                <p className="text-[11px] text-muted-foreground">{t("crm_quote_installments_hint")}</p>
              </div>
              {installments.length === 0 && (
                <p className="text-[11px] text-muted-foreground">{t("crm_quote_installments_none_hint")}</p>
              )}
              {installments.map((row, i) => (
                <div key={row.id} className="flex items-center gap-2">
                  <Input
                    placeholder={t("crm_quote_installment_label")}
                    value={row.label}
                    onChange={(e) => setInstallments((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    className="flex-1 h-9 min-w-0"
                    disabled={isSaving}
                  />
                  <Input
                    placeholder="%" dir="ltr" inputMode="decimal" aria-label="%"
                    value={row.percent}
                    onChange={(e) => setInstallments((p) => p.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
                    className="w-20 h-9"
                    disabled={isSaving}
                  />
                  <span className="w-28 text-end text-xs text-muted-foreground tabular-nums shrink-0" dir="ltr">
                    {formatSar(Math.round(((effectiveAmount * (Number(row.percent) || 0)) / 100) * 100) / 100, locale)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setInstallments((p) => p.filter((_, j) => j !== i))}
                    aria-label={t("mfg_remove_item")}
                    className="h-8 w-8 shrink-0 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={isSaving}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Button
                  size="sm" variant="ghost" className="gap-1.5"
                  onClick={() => setInstallments((p) => [...p, { id: newInstallmentId(), label: "", percent: "" }])}
                  disabled={isSaving}
                >
                  <Plus size={13} />
                  {t("crm_quote_add_installment")}
                </Button>
                {installments.length > 0 && (
                  <span className={cn("text-xs font-bold tabular-nums", Math.abs(installmentsPercent - 100) < 0.01 ? "text-success" : "text-destructive")} dir="ltr">
                    {t("crm_quote_installments_total", { percent: Math.round(installmentsPercent * 100) / 100 })}
                  </span>
                )}
              </div>
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
                      <SelectItem key={s} value={s} disabled={s === "accepted" && acceptLocked}>
                        {t(`crm_quote_status_${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {acceptLocked && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Lock size={11} aria-hidden="true" />
                    {t("crm_quote_accept_locked")}
                  </p>
                )}
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
  }

  const steps: CrmFormStep[] = salesMode ? [customerStep, detailsStep] : [detailsStep]

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
