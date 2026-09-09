"use client"

// التسليم والفوترة — where promises become facts. Delivery notes confirm here
// (stock leaves at that moment), invoices are built on delivered notes, and
// the banner that matters most is the one nobody enjoys: delivered but not
// yet invoiced.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, getDocs, query, where } from "firebase/firestore"
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  FileText,
  Loader2,
  PauseCircle,
  Receipt,
  RotateCcw,
  Truck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { cn } from "@/lib/utils"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { SalesShell, SalesSection } from "./SalesShell"
import { formatSar } from "@/lib/crm"
import {
  SALES_DELIVERY_NOTES,
  SALES_INVOICES,
  SALES_ORDERS,
  SALES_RETURNS,
  computeInvoice,
  deliveryNoteValue,
  returnValue,
  unbilledDeliveries,
  type SalesDeliveryNote,
  type SalesInvoice,
  type SalesOrder,
  type SalesReturn,
} from "@/lib/sales-orders"
import {
  confirmDelivery,
  decideReturn,
  holdDelivery,
  issueCreditNote,
  issueInvoiceFromDeliveries,
  markInvoicePaid,
  requestReturn,
} from "@/lib/sales-order-writes"

export function SalesFulfillmentView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManage = can("sales.manage")
  const canConfirm = canManage || can("warehouses.manage") || can("warehouses.receive")
  const canBill = canManage || can("invoices.manage")
  const canMarkPaid = can("invoices.manage") || can("sales.approve")

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const orgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""
  const actorName = (profile as { name?: string } | null)?.name || user?.email || ""

  const ordersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_ORDERS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: ordersData } = useCollection(ordersQuery)
  const orders = useMemo(() => (ordersData || []) as SalesOrder[], [ordersData])

  const notesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_DELIVERY_NOTES), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: notesData, isLoading } = useCollection(notesQuery)
  const notes = useMemo(
    () => (((notesData || []) as SalesDeliveryNote[]).sort((a, b) => ((a.requestedAt || "") < (b.requestedAt || "") ? 1 : -1))),
    [notesData]
  )

  const invoicesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_INVOICES), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: invoicesData } = useCollection(invoicesQuery)
  const invoices = useMemo(
    () => (((invoicesData || []) as SalesInvoice[]).sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1))),
    [invoicesData]
  )

  const returnsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_RETURNS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: returnsData } = useCollection(returnsQuery)
  const returns = useMemo(() => (returnsData || []) as SalesReturn[], [returnsData])

  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const unbilled = useMemo(() => unbilledDeliveries(notes, invoices, orders), [notes, invoices, orders])

  const [busyId, setBusyId] = useState<string | null>(null)
  const [holdFor, setHoldFor] = useState<SalesDeliveryNote | null>(null)
  const [holdReason, setHoldReason] = useState("")

  const actor = { id: user?.uid || "", name: actorName }

  const doConfirm = async (note: SalesDeliveryNote) => {
    if (!firestore || busyId) return
    const order = orderById.get(note.orderId)
    if (!order) return
    setBusyId(note.id)
    try {
      let stockRows: Array<{ id: string; name: string }> = []
      if (note.warehouseId) {
        const snap = await getDocs(collection(firestore, "warehouses", note.warehouseId, "inventoryItems"))
        stockRows = snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || "" }))
      }
      await confirmDelivery(firestore, { note, order, allNotes: notes, stockRows, actor })
      toast({ title: t("sf_delivered_toast", { number: note.noteNumber }) })
    } catch (err) {
      console.error(err)
      toast({ title: t("so_save_error"), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  const doHold = async () => {
    if (!firestore || !holdFor || !holdReason.trim()) return
    try {
      await holdDelivery(firestore, holdFor.id, holdReason.trim())
      toast({ title: t("sf_held_toast") })
      setHoldFor(null)
      setHoldReason("")
    } catch (err) {
      console.error(err)
      toast({ title: t("so_save_error"), variant: "destructive" })
    }
  }

  const billOrder = async (orderId: string, orderNotes: SalesDeliveryNote[]) => {
    if (!firestore || busyId) return
    const order = orderById.get(orderId)
    if (!order) return
    setBusyId(orderId)
    try {
      await issueInvoiceFromDeliveries(firestore, { order, notes: orderNotes, allNotes: notes, actor })
      toast({ title: t("sf_invoice_issued") })
    } catch (err) {
      console.error(err)
      toast({ title: t("so_save_error"), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  const payInvoice = async (invoice: SalesInvoice) => {
    if (!firestore || busyId) return
    setBusyId(invoice.id)
    try {
      await markInvoicePaid(firestore, { invoice, notes, orders, actor })
      toast({ title: t("sf_invoice_paid_toast") })
    } catch (err) {
      console.error(err)
      toast({ title: t("so_save_error"), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  // ── Returns ──
  const [returnFor, setReturnFor] = useState<SalesDeliveryNote | null>(null)
  const [returnQty, setReturnQty] = useState<Record<string, string>>({})
  const [returnReason, setReturnReason] = useState("")

  const openReturn = (note: SalesDeliveryNote) => {
    setReturnFor(note)
    setReturnReason("")
    setReturnQty(Object.fromEntries(note.lines.map((l) => [l.name, ""])))
  }

  const submitReturn = async () => {
    if (!firestore || !returnFor) return
    const order = orderById.get(returnFor.orderId)
    if (!order) return
    const lines = returnFor.lines
      .map((l) => ({ name: l.name, quantity: Number(returnQty[l.name]) || 0, max: l.quantity }))
      .filter((l) => l.quantity > 0)
    if (lines.length === 0 || !returnReason.trim()) {
      toast({ title: t("sr_needs_lines"), variant: "destructive" })
      return
    }
    if (lines.some((l) => l.quantity > l.max + 0.005)) {
      toast({ title: t("sr_over_delivered"), variant: "destructive" })
      return
    }
    try {
      await requestReturn(firestore, { order, deliveryNote: returnFor, lines, reason: returnReason.trim(), actor })
      toast({ title: t("sr_requested") })
      setReturnFor(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("so_save_error"), variant: "destructive" })
    }
  }

  const decide = async (salesReturn: SalesReturn, approve: boolean) => {
    if (!firestore || busyId) return
    setBusyId(salesReturn.id)
    try {
      await decideReturn(firestore, { salesReturn, approve, actor })
      toast({ title: approve ? t("sr_approved") : t("sr_rejected") })
    } catch (err) {
      console.error(err)
      toast({ title: t("so_save_error"), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  const creditNote = async (salesReturn: SalesReturn) => {
    if (!firestore || busyId) return
    const order = orderById.get(salesReturn.orderId)
    if (!order) return
    setBusyId(salesReturn.id)
    try {
      const note = notes.find((n) => n.id === salesReturn.deliveryNoteId)
      let stockRows: Array<{ id: string; name: string }> = []
      if (note?.warehouseId) {
        const snap = await getDocs(collection(firestore, "warehouses", note.warehouseId, "inventoryItems"))
        stockRows = snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || "" }))
      }
      await issueCreditNote(firestore, { salesReturn, order, stockRows, warehouseId: note?.warehouseId ?? null, actor })
      toast({ title: t("sr_credit_issued") })
    } catch (err) {
      console.error(err)
      toast({ title: t("so_save_error"), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  // Unbilled notes grouped per order — an invoice bills one order's notes.
  const unbilledByOrder = useMemo(() => {
    const map = new Map<string, SalesDeliveryNote[]>()
    for (const note of unbilled.notes) {
      const list = map.get(note.orderId) || []
      list.push(note)
      map.set(note.orderId, list)
    }
    return map
  }, [unbilled.notes])

  const noteBadge = (note: SalesDeliveryNote) =>
    note.status === "delivered" ? (
      <Badge className="bg-success/10 text-success border-none">{t("sf_status_delivered")}</Badge>
    ) : note.status === "held" ? (
      <Badge className="bg-destructive/10 text-destructive border-none">{t("sf_status_held")}</Badge>
    ) : (
      <Badge className="bg-cta/10 text-cta border-none">{t("sf_status_requested")}</Badge>
    )

  return (
    <SalesShell portal={portal} title={t("sf_page_title")} description={t("sf_page_desc")} icon={Truck}>
      {unbilled.value > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-warning/40 bg-warning/5">
          <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">
              {t("sf_unbilled_title", { amount: formatSar(unbilled.value, locale) })}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("sf_unbilled_desc", { count: unbilled.notes.length })}</p>
          </div>
        </div>
      )}

      <SalesSection title={t("sf_deliveries_title")} icon={Truck}>
        {isLoading ? (
          <div className="flex items-center justify-center p-10">
            <Loader2 className="animate-spin text-muted-foreground" size={24} />
          </div>
        ) : notes.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t("sf_no_deliveries")}</div>
        ) : (
          <div className="divide-y">
            {notes.map((note) => {
              const order = orderById.get(note.orderId)
              return (
                <div key={note.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{note.noteNumber}</span>
                      {noteBadge(note)}
                      <span className="text-xs text-muted-foreground">
                        {t("so_order_no", { number: note.orderNumber })} · {note.contactName || order?.projectName || ""}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {note.lines.map((l) => `${l.name} × ${l.quantity}`).join(" · ")}
                      {note.warehouseName && <span className="mx-1.5">— {note.warehouseName}</span>}
                    </p>
                    {note.status === "held" && note.holdReason && (
                      <p className="text-[11px] text-destructive mt-0.5">{note.holdReason}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold tabular-nums" dir="ltr">
                      {formatSar(deliveryNoteValue(note, order), locale)}
                    </span>
                    {(note.status === "requested" || note.status === "held") && canConfirm && (
                      <Button size="sm" className="gap-1.5 h-8" disabled={busyId === note.id} onClick={() => doConfirm(note)}>
                        {busyId === note.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                        {t("sf_confirm_btn")}
                      </Button>
                    )}
                    {note.status === "requested" && canManage && (
                      <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setHoldFor(note)}>
                        <PauseCircle size={13} />
                        {t("sf_hold_btn")}
                      </Button>
                    )}
                    {note.status === "delivered" && canManage && (
                      <Button size="sm" variant="ghost" className="gap-1.5 h-8 text-muted-foreground" onClick={() => openReturn(note)}>
                        <RotateCcw size={13} />
                        {t("sr_request_btn")}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SalesSection>

      {unbilledByOrder.size > 0 && canBill && (
        <SalesSection title={t("sf_bill_title")} icon={Receipt}>
          <div className="divide-y">
            {Array.from(unbilledByOrder.entries()).map(([orderId, orderNotes]) => {
              const order = orderById.get(orderId)
              const value = orderNotes.reduce((s, n) => s + deliveryNoteValue(n, order), 0)
              return (
                <div key={orderId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      {t("so_order_no", { number: order?.orderNumber ?? 0 })} — {order?.contactName}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {t("sf_bill_notes", { count: orderNotes.length, amount: formatSar(value, locale) })}
                    </p>
                  </div>
                  <Button size="sm" className="gap-1.5 h-8 shrink-0" disabled={busyId === orderId} onClick={() => billOrder(orderId, orderNotes)}>
                    {busyId === orderId ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                    {t("sf_bill_btn")}
                  </Button>
                </div>
              )
            })}
          </div>
        </SalesSection>
      )}

      {returns.length > 0 && (
        <SalesSection title={t("sr_title")} icon={RotateCcw}>
          <div className="divide-y">
            {returns.map((salesReturn) => {
              const order = orderById.get(salesReturn.orderId)
              const value = returnValue(salesReturn, order)
              return (
                <div key={salesReturn.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{salesReturn.returnNumber}</span>
                      {salesReturn.status === "awaiting_decision" && (
                        <Badge className="bg-warning/10 text-warning border-none">{t("sr_status_awaiting")}</Badge>
                      )}
                      {salesReturn.status === "approved" && (
                        <Badge className="bg-cta/10 text-cta border-none">{t("sr_status_approved")}</Badge>
                      )}
                      {salesReturn.status === "credit_note_issued" && (
                        <Badge className="bg-success/10 text-success border-none">{t("sr_status_credited")}</Badge>
                      )}
                      {salesReturn.status === "rejected" && (
                        <Badge className="bg-muted text-muted-foreground border-none">{t("sr_status_rejected")}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{salesReturn.contactName}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {salesReturn.lines.map((l) => `${l.name} × ${l.quantity}`).join(" · ")} — {salesReturn.reason}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold tabular-nums" dir="ltr">{formatSar(value, locale)}</span>
                    {salesReturn.status === "awaiting_decision" && canManage && (
                      <>
                        <Button size="sm" className="h-8 gap-1.5" disabled={busyId === salesReturn.id} onClick={() => decide(salesReturn, true)}>
                          <CheckCircle2 size={13} />
                          {t("sr_approve_btn")}
                        </Button>
                        <Button size="sm" variant="outline" className="h-8" disabled={busyId === salesReturn.id} onClick={() => decide(salesReturn, false)}>
                          {t("sr_reject_btn")}
                        </Button>
                      </>
                    )}
                    {salesReturn.status === "approved" && canMarkPaid && (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busyId === salesReturn.id} onClick={() => creditNote(salesReturn)}>
                        {busyId === salesReturn.id ? <Loader2 size={13} className="animate-spin" /> : <Receipt size={13} />}
                        {t("sr_credit_btn")}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </SalesSection>
      )}

      <SalesSection title={t("sf_invoices_title")} icon={Banknote}>
        {invoices.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t("sf_no_invoices")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-start">{t("sf_col_invoice")}</th>
                  <th className="px-4 py-2.5 text-start">{t("sales_col_customer")}</th>
                  <th className="px-4 py-2.5 text-end">{t("sf_col_net")}</th>
                  <th className="px-4 py-2.5 text-end">{t("sf_col_recovery")}</th>
                  <th className="px-4 py-2.5 text-end">{t("sales_col_total")}</th>
                  <th className="px-4 py-2.5 text-start">{t("sales_col_status")}</th>
                  <th className="px-4 py-2.5 text-end" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const calc = computeInvoice(invoice, notes, orders)
                  const overdue = !invoice.paid && invoice.dueDate < new Date().toISOString().slice(0, 10)
                  return (
                    <tr key={invoice.id} className="border-t">
                      <td className="px-4 py-2.5 font-bold">{invoice.invoiceNumber}
                        {invoice.advance && <Badge variant="outline" className="ms-2 text-[10px]">{t("sf_advance")}</Badge>}
                        <Badge
                          variant="outline"
                          className={cn("ms-2 text-[10px]", invoice.zatca === "reported" ? "text-success border-success/30" : "text-muted-foreground")}
                        >
                          {invoice.zatca === "reported" ? t("sf_zatca_ok") : t("sf_zatca_pending")}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">{invoice.contactName}</td>
                      <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">{formatSar(calc.net, locale)}</td>
                      <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">
                        {calc.depositRecovery ? `−${formatSar(calc.depositRecovery, locale)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-end font-black tabular-nums" dir="ltr">{formatSar(calc.total, locale)}</td>
                      <td className="px-4 py-2.5">
                        {invoice.paid ? (
                          <Badge className="bg-success/10 text-success border-none">{t("sf_paid")}</Badge>
                        ) : (
                          <Badge className={cn("border-none", overdue ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
                            {overdue ? t("sf_overdue") : t("sf_due", { date: invoice.dueDate })}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-end">
                        {!invoice.paid && canMarkPaid && (
                          <Button size="sm" variant="outline" className="gap-1.5 h-8" disabled={busyId === invoice.id} onClick={() => payInvoice(invoice)}>
                            {busyId === invoice.id ? <Loader2 size={13} className="animate-spin" /> : <Banknote size={13} />}
                            {t("sf_mark_paid")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SalesSection>

      {/* ── Request return ── */}
      <Dialog open={!!returnFor} onOpenChange={(open) => { if (!open) setReturnFor(null) }}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-md">
          {returnFor && (
            <>
              <DialogHeader>
                <DialogTitle>{t("sr_dialog_title", { number: returnFor.noteNumber })}</DialogTitle>
                <DialogDescription>{t("sr_dialog_desc")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-1">
                {returnFor.lines.map((line) => (
                  <div key={line.name} className="flex items-center gap-2">
                    <span className="flex-1 text-sm font-semibold truncate">{line.name}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{t("sr_delivered_qty", { qty: line.quantity })}</span>
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      className="w-24 h-9"
                      value={returnQty[line.name] ?? ""}
                      onChange={(e) => setReturnQty((p) => ({ ...p, [line.name]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <Label htmlFor="return-reason">{t("sr_reason")} *</Label>
                  <Input id="return-reason" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setReturnFor(null)}>{t("crm_cancel")}</Button>
                <Button onClick={submitReturn} className="gap-1.5">
                  <RotateCcw size={14} />
                  {t("sr_request_btn")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Hold reason ── */}
      <Dialog open={!!holdFor} onOpenChange={(open) => { if (!open) setHoldFor(null) }}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("sf_hold_title")}</DialogTitle>
            <DialogDescription>{t("sf_hold_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="hold-reason">{t("sf_hold_reason")} *</Label>
            <Input id="hold-reason" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoldFor(null)}>{t("crm_cancel")}</Button>
            <Button onClick={doHold} disabled={!holdReason.trim()} className="gap-1.5">
              <PauseCircle size={14} />
              {t("sf_hold_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SalesShell>
  )
}
