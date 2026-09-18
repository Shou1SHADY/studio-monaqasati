"use client"

// The work orders of one sales order, as Sales sees them: where each stands in
// the workshop, what was delivered, whether it still waits for the down
// payment — read from Manufacturing, never edited here. The two acts that are
// Sales' own sit beside them (D9, D11, D12): recording the client's result on
// a shop drawing the workshop submitted, and asking for a quantity change or a
// cancellation. The workshop manager applies a change; Manufacturing reads the
// drawing result.
//
// `SalesWorkshopInbox` heads the orders page with every drawing the client has
// not answered, so the act is found without knowing which sales order to open —
// and at all, for a client order that names no sales order (one that carries
// only its quotation, `Q-…`).

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { ArrowRightLeft, Clock, ExternalLink, Factory, FileCheck2, Loader2, Lock, Send } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { formatCrmDate } from "@/lib/crm"
import { MFG_DEPARTMENTS, type MfgDepartment } from "@/lib/manufacturing"
import { DELIVERY_NOTES, type DeliveryNote } from "@/lib/delivery-notes"
import { minQuantity, type DrawingCode, type MfgProduct, type OrderCalc, type Stage } from "@/lib/manufacturing-engine"
import { calcOf, isV2Order, recordDrawingResult, requestOrderChange, toNoteSlice, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { emitMfgEvent, mfgLinks, type EventParams, type MfgEventKind } from "@/lib/mfg-events"
import { belongsToSalesOrder, clientDrawingsDue, clientRefOf, orderRef, salesOrderOfWorkOrder } from "@/lib/manufacturing-view"
import type { SalesOrder } from "@/lib/sales-orders"
import { fmtQty } from "@/components/manufacturing/ui/MfgUi"
import { SignedInAs, mfgActError } from "@/components/shared/MfgHandoffBits"
import type { CrmPortal } from "@/components/crm/CrmShell"

const STAGE_BADGE: Record<Stage, string> = {
  pay: "bg-destructive/10 text-destructive",
  wait: "bg-muted text-muted-foreground",
  prod: "bg-warning/10 text-warning",
  close: "bg-warning/10 text-warning",
  ready: "bg-accent/15 text-secondary",
  transit: "bg-cta/10 text-cta",
  done: "bg-success/10 text-success",
  cancel: "bg-muted text-muted-foreground",
}

interface Row {
  order: WorkOrderV2
  product: MfgProduct
  calc: OrderCalc
  /** Null for a client order that names no sales order. */
  salesOrder: SalesOrder | null
}

/** The given work orders as Sales reads them. Stations and delivery notes are
 * fetched only when there is an order to compute. */
function useWorkshopRows(mine: WorkOrderV2[], products: MfgProduct[], orgId: string, salesOrderOf: (w: WorkOrderV2) => SalesOrder | null): Row[] {
  const firestore = useFirestore()
  const wanted = mine.length > 0

  const departmentsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId || !wanted) return null
    return query(collection(firestore, MFG_DEPARTMENTS), where("organizationId", "==", orgId))
  }, [firestore, orgId, wanted])
  const { data: departmentsData } = useCollection(departmentsQuery)

  const notesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId || !wanted) return null
    return query(collection(firestore, DELIVERY_NOTES), where("organizationId", "==", orgId))
  }, [firestore, orgId, wanted])
  const { data: notesData } = useCollection(notesQuery)

  return useMemo<Row[]>(() => {
    const byId = new Map(products.map((p) => [p.id, p]))
    const departments = (departmentsData || []) as MfgDepartment[]
    const notes = (notesData || []) as DeliveryNote[]
    return mine
      .map((w) => {
        const product = byId.get(w.productId || "")
        if (!product) return null
        const salesOrder = salesOrderOf(w)
        const slices = notes.filter((n) => n.source?.workOrderId === w.id).map(toNoteSlice)
        return { order: w, product, calc: calcOf(w, product, departments, slices, salesOrder), salesOrder }
      })
      .filter((r): r is Row => !!r)
  }, [mine, products, departmentsData, notesData, salesOrderOf])
}

export function SalesOrderWorkshopSection({
  order,
  workOrders,
  products,
  orgId,
  actor,
  canManage,
}: {
  order: SalesOrder
  workOrders: WorkOrderV2[]
  products: MfgProduct[]
  orgId: string
  actor: { id: string; name: string }
  canManage: boolean
  portal: CrmPortal
}) {
  const t = useTranslations("Portal.Shared")

  const mine = useMemo(
    () => workOrders.filter((w) => belongsToSalesOrder(w, order) && isV2Order(w)).sort((a, b) => (a.orderNumber || 0) - (b.orderNumber || 0)),
    [workOrders, order]
  )
  const salesOrderOf = useMemo(() => () => order, [order])
  const rows = useWorkshopRows(mine, products, orgId, salesOrderOf)

  if (!rows.length) return null

  return (
    <section className="overflow-hidden rounded-xl border bg-white">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b bg-muted/30 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-black text-foreground">
          <Factory size={15} className="text-primary" aria-hidden="true" />
          {t("mfy_so_ws_title")}
        </h3>
        <span className="text-[11px] text-muted-foreground">{t("mfy_so_ws_read")}</span>
      </header>
      <ul className="divide-y">
        {rows.map((row) => (
          <WorkOrderLine key={row.order.id} row={row} orgId={orgId} actor={actor} canManage={canManage} />
        ))}
      </ul>
      {!canManage && (
        <p className="flex items-center gap-1.5 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <Lock size={11} aria-hidden="true" />
          {t("mfy_so_ws_read_only")}
        </p>
      )}
    </section>
  )
}

/** Heads the Sales orders page: every shop drawing the client has not answered,
 * with the act beside it. Renders nothing when the workshop waits on nothing. */
export function SalesWorkshopInbox({
  salesOrders,
  workOrders,
  products,
  orgId,
  actor,
  canManage,
  onOpenOrder,
}: {
  salesOrders: SalesOrder[]
  workOrders: WorkOrderV2[]
  products: MfgProduct[]
  orgId: string
  actor: { id: string; name: string }
  canManage: boolean
  onOpenOrder: (salesOrderId: string) => void
}) {
  const t = useTranslations("Portal.Shared")

  const due = useMemo(() => clientDrawingsDue(workOrders, new Map(products.map((p) => [p.id, p]))), [workOrders, products])
  const salesOrderOf = useMemo(() => (w: WorkOrderV2) => salesOrderOfWorkOrder(w, salesOrders), [salesOrders])
  const rows = useWorkshopRows(due, products, orgId, salesOrderOf)

  if (!rows.length) return null

  return (
    <section className="overflow-hidden rounded-xl border border-accent/30 bg-white" aria-labelledby="sales-ws-inbox-title">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-accent/20 bg-accent/5 px-4 py-3">
        <div className="min-w-0">
          <h2 id="sales-ws-inbox-title" className="flex items-center gap-2 text-sm font-black text-foreground">
            <FileCheck2 size={15} className="text-secondary" aria-hidden="true" />
            {t("mfy_inbox_title")}
            <Badge className="border-none bg-accent/15 text-[10px] tabular-nums text-secondary">{rows.length}</Badge>
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t("mfy_inbox_desc")}</p>
        </div>
      </header>
      <ul className="divide-y">
        {rows.map((row) => (
          <WorkOrderLine
            key={row.order.id}
            row={row}
            orgId={orgId}
            actor={actor}
            canManage={canManage}
            client={{
              name: row.salesOrder?.contactName || row.order.source?.contactName || "",
              ref: clientRefOf(row.order, row.salesOrder),
              onOpen: row.salesOrder ? () => onOpenOrder(row.salesOrder!.id) : null,
            }}
          />
        ))}
      </ul>
      {!canManage && (
        <p className="flex items-center gap-1.5 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <Lock size={11} aria-hidden="true" />
          {t("mfy_so_ws_read_only")}
        </p>
      )}
    </section>
  )
}

function WorkOrderLine({
  row,
  orgId,
  actor,
  canManage,
  client,
}: {
  row: Row
  orgId: string
  actor: { id: string; name: string }
  canManage: boolean
  /** Shown in the inbox, where the row stands outside its sales order. */
  client?: { name: string; ref: string; onOpen: (() => void) | null }
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { order: w, product, calc, salesOrder } = row
  const unit = w.unit || product.unit
  const ref = orderRef(w)
  const pct = calc.target > 0 ? Math.min(100, (calc.delivered / calc.target) * 100) : 0
  const drawing = w.drawing ?? null
  const atClient = !!drawing?.submittedAt && !drawing.code && drawing.approverOrg === "client"
  const change = w.changeRequest ?? null
  const canChange = calc.live && w.status === "open" && !change && calc.delivered < calc.target

  const [mode, setMode] = useState<null | "drawing" | "change">(null)
  const [code, setCode] = useState<DrawingCode>("A")
  const [notes, setNotes] = useState("")
  const [kind, setKind] = useState<"quantity" | "cancel">("quantity")
  const [qty, setQty] = useState("")
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const min = minQuantity(calc)

  const open = (m: "drawing" | "change") => {
    setMode(m)
    setError(null)
    setCode("A")
    setNotes("")
    setKind("quantity")
    setQty(String(w.quantity ?? ""))
    setReason("")
  }

  const tell = (kind: MfgEventKind, extra: Array<string | null | undefined>, params: EventParams) =>
    firestore ? emitMfgEvent(firestore, { copy: t, kind, organizationId: orgId, actor, to: [{ permission: "manufacturing.manage" }, { users: extra }], params, workOrderId: w.id, link: mfgLinks.order(w.id) }) : Promise.resolve(0)

  const submitDrawing = async () => {
    if (!firestore || busy) return
    if ((code === "B" || code === "C") && !notes.trim()) {
      setError(t("mfg4_err_notes_required"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const text = notes.trim() || null
      await recordDrawingResult(firestore, { orderId: w.id, code, notes: text, approverName: salesOrder?.contactName ?? w.source?.contactName ?? null, actor })
      // projects/sales.drawing.approved|rejected — back to the manager and the drafter.
      await tell("drawing_result", [drawing?.submittedById], { ref, code, notes: text ? ` — ${text}` : "" })
      toast({ title: t("mfy_draw_saved") })
      setMode(null)
    } catch (err) {
      console.error(err)
      setError(mfgActError(t, err))
    } finally {
      setBusy(false)
    }
  }

  const submitChange = async () => {
    if (!firestore || busy) return
    const n = Number(qty)
    if (kind === "quantity" && !(n > 0)) {
      setError(t("mfg4_err_quantity_required"))
      return
    }
    if (kind === "quantity" && n === (w.quantity || 0)) {
      setError(t("mfy_chg_same_qty"))
      return
    }
    if (!reason.trim()) {
      setError(t("mfg4_err_reason_required"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestOrderChange(firestore, { orderId: w.id, kind, newQuantity: kind === "quantity" ? n : null, reason: reason.trim(), module: "sales", actor })
      await tell("change_requested", [], { ref, module: "@mfg4_module_sales", kind, qty: kind === "quantity" ? fmtQty(n) : "", unit, reason: reason.trim() })
      toast({ title: t("mfy_chg_saved") })
      setMode(null)
    } catch (err) {
      console.error(err)
      setError(mfgActError(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="space-y-2.5 px-4 py-3">
      {client && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-black text-foreground" dir="auto">{client.name || t("mfy_inbox_no_client")}</span>
          {client.ref && <span className="font-mono text-xs text-muted-foreground" dir="ltr">{client.ref}</span>}
          {client.onOpen ? (
            <Button size="sm" variant="ghost" className="ms-auto h-8 gap-1.5 text-cta hover:text-cta" onClick={client.onOpen}>
              <ExternalLink size={13} className="rtl-flip" aria-hidden="true" />
              {t("mfy_inbox_open_order")}
            </Button>
          ) : (
            <Badge variant="outline" className="ms-auto border-warning/40 text-[10px] text-warning">{t("mfy_inbox_no_order")}</Badge>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground" dir="ltr">{ref}</span>
        <span className="text-sm font-bold text-foreground" dir="auto">{w.productName || product.name}</span>
        <span className="text-xs text-muted-foreground" dir="ltr">
          <span className="tabular-nums">{fmtQty(w.quantity)}</span> {unit}
        </span>
        <Badge className={cn("border-none text-[10px]", STAGE_BADGE[calc.stage])}>{t(`mfg4_stage_${calc.stage}`)}</Badge>
        {w.rush && <Badge variant="outline" className="border-warning/40 text-[10px] text-warning">{t("mfg4_rush")}</Badge>}
      </div>

      {!calc.cancelled && (
        <div className="flex items-center gap-3">
          <div className="h-1.5 max-w-xs flex-1 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", pct >= 100 ? "bg-success" : "bg-cta")} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] text-muted-foreground">
            {t("mfy_so_ws_delivered", { delivered: fmtQty(calc.delivered), target: fmtQty(calc.target), unit })}
          </span>
        </div>
      )}

      {calc.stage === "pay" && (
        <p className="flex items-start gap-1.5 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">
          <Lock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t("mfy_so_ws_pay")}
        </p>
      )}

      {calc.cancelled && w.cancellation?.reason && (
        <p className="text-xs text-muted-foreground">{t("mfy_so_ws_cancelled", { reason: w.cancellation.reason })}</p>
      )}

      {atClient && drawing && (
        <div className="space-y-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <FileCheck2 size={14} className="text-secondary" aria-hidden="true" />
            <span className="text-xs font-bold text-foreground">{t("mfy_draw_title", { rev: drawing.revision })}</span>
            <span className="text-[11px] text-muted-foreground">
              {t("mfy_draw_submitted", { name: drawing.submittedBy || "—", date: formatCrmDate(drawing.submittedAt, locale) })}
            </span>
            {drawing.fileUrl && (
              <a
                href={drawing.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded text-[11px] font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ExternalLink size={11} aria-hidden="true" />
                {drawing.fileName || t("mfy_draw_file")}
              </a>
            )}
            {canManage && mode !== "drawing" && (
              <Button size="sm" variant="outline" className="ms-auto h-8 gap-1.5" onClick={() => open("drawing")}>
                <FileCheck2 size={13} aria-hidden="true" />
                {t("mfy_draw_record_btn")}
              </Button>
            )}
          </div>
          {drawing.note && <p className="text-[11px] text-muted-foreground" dir="auto">{drawing.note}</p>}
          {drawing.previousC && <p className="text-[11px] text-muted-foreground" dir="auto">{t("mfy_draw_prev_c", { notes: drawing.previousC })}</p>}

          {mode === "drawing" && (
            <div className="space-y-3 border-t border-accent/20 pt-3">
              <div role="radiogroup" aria-label={t("mfy_draw_record_btn")} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(["A", "B", "C"] as DrawingCode[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={code === c}
                    onClick={() => setCode(c)}
                    className={cn(
                      "flex min-h-11 flex-col gap-0.5 rounded-lg border-2 bg-white px-3 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      code === c ? (c === "C" ? "border-destructive bg-destructive/5" : "border-success bg-success/5") : "border-border hover:border-slate-300"
                    )}
                  >
                    <span className="text-xs font-bold text-foreground">{t(`mfy_draw_code_${c.toLowerCase()}`)}</span>
                    <span className="text-[11px] text-muted-foreground">{t(`mfy_draw_code_${c.toLowerCase()}_hint`)}</span>
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`draw-notes-${w.id}`} className="text-xs font-bold">
                  {t("mfy_draw_notes")}
                  {code !== "A" && <span className="ms-0.5 text-destructive">*</span>}
                </Label>
                <Textarea id={`draw-notes-${w.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" />
                <p className="text-[11px] text-muted-foreground">{t("mfy_draw_notes_hint")}</p>
              </div>
              <FormFooter
                error={error}
                busy={busy}
                actorName={actor.name}
                confirm={t("mfy_draw_confirm", { code })}
                onCancel={() => setMode(null)}
                onConfirm={submitDrawing}
              />
            </div>
          )}
        </div>
      )}

      {change && (
        <div className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs">
          <p className="flex items-center gap-1.5 font-bold text-warning">
            <Clock size={13} aria-hidden="true" />
            {change.kind === "cancel"
              ? t("mfy_chg_pending_cancel")
              : t("mfy_chg_pending_qty", { qty: fmtQty(change.newQuantity), unit })}
          </p>
          <p className="mt-0.5 text-muted-foreground" dir="auto">
            {t("mfy_chg_pending_meta", { reason: change.reason, name: change.by, date: formatCrmDate(change.at, locale) })}
          </p>
        </div>
      )}

      {canManage && canChange && mode !== "change" && (
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => open("change")}>
          <ArrowRightLeft size={13} aria-hidden="true" />
          {t("mfy_chg_btn")}
        </Button>
      )}

      {mode === "change" && (
        <div className="space-y-3 rounded-lg border bg-muted/20 px-3 py-3">
          <div role="radiogroup" aria-label={t("mfy_chg_btn")} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(["quantity", "cancel"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "min-h-11 rounded-lg border-2 bg-white px-3 py-2 text-start text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  kind === k ? (k === "cancel" ? "border-destructive bg-destructive/5" : "border-primary bg-primary/5") : "border-border hover:border-slate-300"
                )}
              >
                {t(k === "quantity" ? "mfy_chg_kind_qty" : "mfy_chg_kind_cancel")}
              </button>
            ))}
          </div>
          {kind === "quantity" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`chg-qty-${w.id}`} className="text-xs font-bold">
                {t("mfy_chg_new_qty", { unit })}
                <span className="ms-0.5 text-destructive">*</span>
              </Label>
              <Input id={`chg-qty-${w.id}`} dir="ltr" inputMode="decimal" className="h-10 w-40" value={qty} onChange={(e) => setQty(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">
                {t("mfy_chg_min_hint", { qty: fmtQty(w.quantity), min: fmtQty(min), unit })}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t("mfy_chg_cancel_hint")}</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`chg-reason-${w.id}`} className="text-xs font-bold">
              {t("mfy_chg_reason")}
              <span className="ms-0.5 text-destructive">*</span>
            </Label>
            <Textarea id={`chg-reason-${w.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
          </div>
          <FormFooter error={error} busy={busy} actorName={actor.name} confirm={t("mfy_chg_confirm")} onCancel={() => setMode(null)} onConfirm={submitChange} />
        </div>
      )}
    </li>
  )
}

function FormFooter({
  error,
  busy,
  actorName,
  confirm,
  onCancel,
  onConfirm,
}: {
  error: string | null
  busy: boolean
  actorName: string
  confirm: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const t = useTranslations("Portal.Shared")
  return (
    <div className="space-y-2">
      <SignedInAs name={actorName} />
      {error && <p className="text-[11px] font-semibold text-destructive" role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          {t("crm_cancel")}
        </Button>
        <Button size="sm" onClick={onConfirm} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}
          {confirm}
        </Button>
      </div>
    </div>
  )
}
