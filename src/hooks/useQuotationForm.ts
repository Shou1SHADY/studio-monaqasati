"use client"

import { useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, addDoc, updateDoc, getDocs, query, where, serverTimestamp } from "firebase/firestore"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import {
  CRM_QUOTATIONS,
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
import { discountCapPercent, quotationPriceIssues } from "@/lib/sales-transfers"

export type QuotationItemRow = { name: string; quantity: string; unit: string; unitPrice: string }
export type QuotationStockOption = { name: string; unit: string; available: number }
export type QuotationInstallmentRow = { id: string; label: string; percent: string }

/** Seeds for a NEW quotation (ignored when editing): its phase, a prefilled
 * line list, and the finished work order being sold — how Sales quotes a
 * manufactured item. */
export interface QuotationDefaults {
  phase?: QuotationPhase
  items?: QuotationItem[]
  workOrderId?: string | null
  workOrderNumber?: number | null
  /** Sales mode: preselect this customer (a CRM quote request's client). */
  contactId?: string | null
}

const emptyRow = (): QuotationItemRow => ({ name: "", quantity: "", unit: "", unitPrice: "" })

function parseInstallments(rows: QuotationInstallmentRow[]): QuotationInstallment[] {
  return rows.map((r) => ({ id: r.id, label: r.label.trim(), percent: Number(r.percent) }))
}

function newInstallmentId(): string {
  return `inst_${Math.random().toString(36).slice(2, 8)}`
}

function parseRows(rows: QuotationItemRow[]): QuotationItem[] {
  return rows
    .filter((r) => r.name.trim() && Number(r.quantity) > 0)
    .map((r) => ({
      name: r.name.trim(),
      quantity: Number(r.quantity),
      unit: r.unit.trim(),
      unitPrice: Number(r.unitPrice) || 0,
    }))
}

export interface UseQuotationFormOptions {
  /** The form (re)initialises every time this turns true. A page passes true. */
  open: boolean
  orgId: string
  /** The contact the quotation is for. Leave empty and pass `contacts` for
   * Sales mode, where the customer is chosen in the form. */
  contactId?: string
  contactName?: string | null
  quotation?: CrmQuotation
  defaults?: QuotationDefaults
  contacts?: Array<{ id: string; name: string }>
  finishedOrders?: WorkOrder[]
}

export interface QuotationSaveOptions {
  /** Use this number for a NEW quotation (the builder shows it before saving). */
  quotationNumber?: string
  /** Extra fields written with the quotation — the builder's document fields. */
  extra?: Record<string, unknown>
  /** VAT carried to the sales order when this save accepts the quotation. */
  vatPercent?: number | null
}

/**
 * The quotation form's state and its one save path — shared by the quick
 * `CrmQuotationDialog` (CRM + Sales) and the full-page Sales quotation builder,
 * so both write the same document and run the same acceptance (Finance
 * notified of the deposit, the work order for goods not in stock, the sales
 * order) instead of drifting apart.
 */
export function useQuotationForm({
  open,
  orgId,
  contactId,
  contactName,
  quotation,
  defaults,
  contacts,
  finishedOrders,
}: UseQuotationFormOptions) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const { can, isOrgOwner } = usePermissions()
  // Marking a quotation accepted is the customer's approval — it posts the
  // deposit to Finance and opens the work order — so it is its own permission
  // (crm.close carries the same authority when a deal is awarded from CRM).
  const canApprove = can("sales.approve") || can("crm.close")
  // Read through a ref so a parent re-rendering with a fresh `defaults`
  // object never resets a form the user is typing into.
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults
  const [isSaving, setIsSaving] = useState(false)
  const [amount, setAmount] = useState("")
  const [status, setStatus] = useState<QuotationStatus>("draft")
  const [phase, setPhase] = useState<QuotationPhase>("pre_manufacturing")
  const [date, setDate] = useState("")
  const [notes, setNotes] = useState("")
  const [itemRows, setItemRows] = useState<QuotationItemRow[]>([])
  const [installments, setInstallments] = useState<QuotationInstallmentRow[]>([])
  const [stockOptions, setStockOptions] = useState<QuotationStockOption[]>([])
  const [priceItems, setPriceItems] = useState<SalesPriceItem[]>([])
  const [stockPick, setStockPick] = useState("")
  const [pricePick, setPricePick] = useState("")
  // Sales mode: the customer is chosen inside the form, and a finished work
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
    const seeds = quotation ? null : defaultsRef.current
    setSelectedContactId(contactId || seeds?.contactId || "")
    setLinkedOrderId("")
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

  // The template's inventory link: everything the org's warehouses hold,
  // aggregated by name so one option shows total availability everywhere.
  useEffect(() => {
    if (!open || !firestore || !orgId) return
    let cancelled = false
    ;(async () => {
      try {
        const whSnap = await getDocs(query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)))
        const byKey = new Map<string, QuotationStockOption>()
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
  /** The work order this quotation is tied to, for the phase hint. */
  const workOrderNumber = quotation?.workOrderNumber ?? defaultsRef.current?.workOrderNumber ?? null

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
  const updateRow = (index: number, patch: Partial<Omit<QuotationItemRow, "name">>) =>
    setItemRows((p) => p.map((x, j) => (j === index ? { ...x, ...patch } : x)))
  const removeRow = (index: number) => setItemRows((p) => p.filter((_, j) => j !== index))
  const addEmptyRow = () => setItemRows((p) => [...p, emptyRow()])

  const updateInstallment = (index: number, patch: Partial<Omit<QuotationInstallmentRow, "id">>) =>
    setInstallments((p) => p.map((x, j) => (j === index ? { ...x, ...patch } : x)))
  const removeInstallment = (index: number) => setInstallments((p) => p.filter((_, j) => j !== index))
  const addInstallment = () => setInstallments((p) => [...p, { id: newInstallmentId(), label: "", percent: "" }])

  /** Validates and writes the quotation, then runs acceptance when this save
   * is the flip to "accepted". Resolves to the quotation id, or null when
   * nothing was saved (the reason has already been toasted). */
  const save = async (options: QuotationSaveOptions = {}): Promise<string | null> => {
    if (!firestore || isSaving) return null
    const parsed = hasItems ? itemsTotal : parseFloat(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: t("crm_quote_amount_error"), variant: "destructive" })
      return null
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
      return null
    }
    if (status === "accepted" && acceptLocked) {
      toast({ title: t("crm_quote_accept_locked"), variant: "destructive" })
      return null
    }
    // Price policy (drafts pass — the block guards what leaves the house):
    // below standard cost is blocked for everyone, and a discount off the list
    // price beyond the role's cap (approver 8%, others 3%, owner uncapped)
    // needs someone with a higher cap. The below-cost message deliberately
    // never states the cost — not every seller may see it.
    if (status !== "draft" && hasItems) {
      const cap = discountCapPercent({ isOwner: isOrgOwner, canApprove })
      const issues = quotationPriceIssues(parsedItems, priceItems, cap)
      const belowCost = issues.find((i) => i.kind === "below_cost")
      if (belowCost) {
        toast({ title: t("sales_below_cost_blocked", { name: belowCost.name }), variant: "destructive" })
        return null
      }
      const overCap = issues.find((i) => i.kind === "over_cap")
      if (overCap) {
        toast({
          title: t("sales_discount_cap_blocked", { name: overCap.name, discount: overCap.discountPercent ?? 0, cap: cap ?? 0 }),
          variant: "destructive",
        })
        return null
      }
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
        ...(options.extra || {}),
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      let quotationId = quotation?.id
      let quotationNumber = quotation?.quotationNumber
      const seeds = defaultsRef.current
      if (quotation) {
        await updateDoc(doc(firestore, CRM_QUOTATIONS, quotation.id), data)
      } else {
        quotationNumber = options.quotationNumber || generateQuotationNumber()
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
              vatPercent: options.vatPercent ?? quotation?.vatPercent ?? null,
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
      return quotationId ?? null
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
      return null
    } finally {
      setIsSaving(false)
    }
  }

  return {
    canApprove,
    salesMode,
    isSaving,
    amount,
    setAmount,
    status,
    setStatus,
    phase,
    setPhase,
    date,
    setDate,
    notes,
    setNotes,
    itemRows,
    installments,
    stockOptions,
    priceItems,
    stockPick,
    pricePick,
    selectedContactId,
    setSelectedContactId,
    linkedOrderId,
    linkedOrder,
    effectiveContactId,
    effectiveContactName,
    parsedItems,
    itemsTotal,
    hasItems,
    effectiveAmount,
    parsedInstallments,
    installmentsPercent,
    acceptLocked,
    workOrderNumber,
    pickFinishedOrder,
    addFromStock,
    addFromPriceList,
    setRowName,
    updateRow,
    removeRow,
    addEmptyRow,
    updateInstallment,
    removeInstallment,
    addInstallment,
    save,
  }
}

export type QuotationForm = ReturnType<typeof useQuotationForm>
