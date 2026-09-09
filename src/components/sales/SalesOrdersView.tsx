"use client"

// أوامر البيع — the backbone list. Everything shown here is derived from
// documents: delivered from notes, coverage from stock and work orders,
// framework usage from call-offs. The screen owns no numbers of its own.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, getDocs, query, where, type Firestore } from "firebase/firestore"
import {
  Banknote,
  CheckCircle2,
  ClipboardList,
  Factory,
  Layers,
  Loader2,
  Lock,
  Package,
  Plus,
  Truck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { effectiveOutput, type WorkOrder } from "@/lib/manufacturing"
import {
  SALES_DELIVERY_NOTES,
  SALES_ORDERS,
  allocateCoverage,
  committedValue,
  depositSatisfied,
  depositTotal,
  frameworkUsage,
  callOffFits,
  orderLineProgress,
  orderMargin,
  orderNet,
  type SalesDeliveryNote,
  type SalesOrder,
} from "@/lib/sales-orders"
import {
  approveOrderDrawings,
  createCallOff,
  createManufacturingRequest,
  markDepositPaid,
  recordOrderMeasurement,
  scheduleDelivery,
  schedulableLines,
} from "@/lib/sales-order-writes"
import { orderGate, creditVerdict, type CreditSnapshot } from "@/lib/sales-orders"
import { SALES_PRICE_ITEMS, type SalesPriceItem } from "@/lib/sales"
import { JOURNAL_ENTRIES, type JournalEntry } from "@/lib/accounting/journal"
import { ACC } from "@/lib/accounting/accounts"
import { Ruler, FileCheck2 } from "lucide-react"

type Segment = "running" | "awaiting_deposit" | "framework" | "closed" | "all"

export function SalesOrdersView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManage = can("sales.manage")
  const canApprove = can("sales.approve") || can("crm.close")

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
  const { data: ordersData, isLoading } = useCollection(ordersQuery)
  const orders = useMemo(
    () => (((ordersData || []) as SalesOrder[]).sort((a, b) => (b.orderNumber || 0) - (a.orderNumber || 0))),
    [ordersData]
  )

  const notesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_DELIVERY_NOTES), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: notesData } = useCollection(notesQuery)
  const notes = useMemo(() => (notesData || []) as SalesDeliveryNote[], [notesData])

  const warehousesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "warehouses"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: warehousesData } = useCollection(warehousesQuery)
  const warehouses = (warehousesData || []) as Array<{ id: string; name: string; isOutbound?: boolean }>

  const workOrdersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "workOrders"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: workOrdersData } = useCollection(workOrdersQuery)
  const openWorkOrders = useMemo(
    () =>
      ((workOrdersData || []) as WorkOrder[])
        .filter((w) => w.status === "open")
        .map((w) => {
          const out = effectiveOutput(w)
          return { id: w.id, outputName: out.name, remainingQty: out.quantity }
        }),
    [workOrdersData]
  )

  const priceItemsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_PRICE_ITEMS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: priceItemsData } = useCollection(priceItemsQuery)
  const gateFlags = useMemo(
    () =>
      ((priceItemsData || []) as SalesPriceItem[]).map((p) => ({
        name: p.name,
        requiresMeasurement: p.requiresMeasurement ?? null,
        requiresApproval: p.requiresApproval ?? null,
      })),
    [priceItemsData]
  )

  // Coverage is allocated across ALL open orders in promise order, so every
  // row's "from stock / from manufacturing / gap" already accounts for the
  // orders ahead of it in the queue.
  const [stockByName, setStockByName] = useState<Array<{ name: string; available: number }>>([])

  const coverage = useMemo(() => {
    const prioritised = orders
      .filter((o) => o.status === "running" || o.status === "awaiting_deposit")
      .sort((a, b) => {
        const status = (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1)
        if (status !== 0) return status
        return (a.promiseDate || "9999") < (b.promiseDate || "9999") ? -1 : 1
      })
      .map((order) => ({ order, lines: orderLineProgress(order, notes) }))
    return allocateCoverage(prioritised, stockByName, openWorkOrders)
  }, [orders, notes, stockByName, openWorkOrders])

  const [segment, setSegment] = useState<Segment>("running")
  const segments: Array<{ key: Segment; labelKey: string; count: number }> = [
    { key: "running", labelKey: "so_seg_running", count: orders.filter((o) => o.status === "running" && o.type !== "framework").length },
    { key: "awaiting_deposit", labelKey: "so_seg_deposit", count: orders.filter((o) => o.status === "awaiting_deposit").length },
    { key: "framework", labelKey: "so_seg_frameworks", count: orders.filter((o) => o.type === "framework").length },
    { key: "closed", labelKey: "so_seg_closed", count: orders.filter((o) => o.status === "closed").length },
    { key: "all", labelKey: "so_seg_all", count: orders.length },
  ]
  const visible = orders.filter((o) => {
    if (segment === "all") return true
    if (segment === "framework") return o.type === "framework"
    if (segment === "running") return o.status === "running" && o.type !== "framework"
    return o.status === segment
  })

  const committed = committedValue(orders, notes)

  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = orders.find((o) => o.id === detailId) || null

  // ── Schedule delivery dialog ──
  const [deliverFor, setDeliverFor] = useState<SalesOrder | null>(null)
  const [deliverWarehouseId, setDeliverWarehouseId] = useState("")
  const [deliverQty, setDeliverQty] = useState<Record<string, string>>({})
  const [deliverReceiver, setDeliverReceiver] = useState("")
  const [isScheduling, setIsScheduling] = useState(false)

  const openDeliver = (order: SalesOrder) => {
    setDeliverFor(order)
    setDeliverWarehouseId("")
    setDeliverReceiver("")
    const rows = schedulableLines(order, notes)
    setDeliverQty(Object.fromEntries(rows.map((l) => [l.name, String(l.open)])))
  }

  const submitDelivery = async () => {
    if (!firestore || !user || !deliverFor || isScheduling) return
    const rows = schedulableLines(deliverFor, notes)
    const lines = rows
      .map((l) => ({ name: l.name, quantity: Number(deliverQty[l.name]) || 0, max: l.open }))
      .filter((l) => l.quantity > 0)
    if (!deliverWarehouseId || lines.length === 0) {
      toast({ title: t("so_delivery_needs_lines"), variant: "destructive" })
      return
    }
    if (lines.some((l) => l.quantity > l.max + 0.005)) {
      toast({ title: t("so_delivery_over_open"), variant: "destructive" })
      return
    }
    setIsScheduling(true)
    try {
      await scheduleDelivery(firestore, {
        order: deliverFor,
        lines,
        warehouseId: deliverWarehouseId,
        warehouseName: warehouses.find((w) => w.id === deliverWarehouseId)?.name || "",
        receiverName: deliverReceiver.trim() || null,
        actor: { id: user.uid, name: actorName },
      })
      toast({ title: t("so_delivery_scheduled") })
      setDeliverFor(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("so_save_error"), variant: "destructive" })
    } finally {
      setIsScheduling(false)
    }
  }

  // ── Call-off dialog ──
  const [callOffFor, setCallOffFor] = useState<SalesOrder | null>(null)
  const [callOffQty, setCallOffQty] = useState("")
  const [isCallingOff, setIsCallingOff] = useState(false)

  const submitCallOff = async () => {
    if (!firestore || !user || !callOffFor || isCallingOff) return
    const qty = Number(callOffQty)
    const line = callOffFor.lines[0]
    if (!(qty > 0) || !line) return
    if (!callOffFits(callOffFor, orders, qty * line.unitPrice)) {
      toast({ title: t("so_calloff_over_cap"), variant: "destructive" })
      return
    }
    setIsCallingOff(true)
    try {
      await createCallOff(firestore, { framework: callOffFor, quantity: qty, actor: { id: user.uid, name: actorName }, allOrders: orders })
      toast({ title: t("so_calloff_created") })
      setCallOffFor(null)
      setCallOffQty("")
    } catch (err) {
      console.error(err)
      toast({ title: t("so_save_error"), variant: "destructive" })
    } finally {
      setIsCallingOff(false)
    }
  }

  const confirmDeposit = async (order: SalesOrder) => {
    if (!firestore) return
    try {
      await markDepositPaid(firestore, order)
      toast({ title: t("so_deposit_marked") })
    } catch (err) {
      console.error(err)
      toast({ title: t("so_save_error"), variant: "destructive" })
    }
  }

  const statusBadge = (order: SalesOrder) => {
    if (order.type === "framework")
      return <Badge className="bg-accent/10 text-accent border-none">{t("so_type_framework")}</Badge>
    if (order.status === "awaiting_deposit")
      return <Badge className="bg-warning/10 text-warning border-none">{t("so_seg_deposit")}</Badge>
    if (order.status === "closed")
      return <Badge className="bg-success/10 text-success border-none">{t("so_seg_closed")}</Badge>
    if (order.status === "cancelled")
      return <Badge className="bg-muted text-muted-foreground border-none">{t("so_status_cancelled")}</Badge>
    return <Badge className="bg-cta/10 text-cta border-none">{t("so_seg_running")}</Badge>
  }

  return (
    <SalesShell
      portal={portal}
      title={t("so_page_title")}
      description={t("so_page_desc")}
      icon={ClipboardList}
      action={
        <span className="text-xs font-bold text-muted-foreground">
          {t("so_committed")}: <span dir="ltr" className="tabular-nums text-foreground">{formatSar(committed, locale)}</span>
        </span>
      }
    >
      <div className="flex items-center gap-2 flex-wrap">
        {segments.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSegment(s.key)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              segment === s.key ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
            )}
          >
            {t(s.labelKey)}
            <span className="ms-1.5 opacity-70">{s.count}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : visible.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
          <Package size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{t("so_empty")}</p>
          <p className="text-xs mt-1">{t("so_empty_hint")}</p>
        </div>
      ) : segment === "framework" ? (
        <div className="space-y-3">
          {visible.map((frame) => {
            const usage = frameworkUsage(frame, orders)
            const pct = usage.percentUsed
            return (
              <SalesSection key={frame.id} title={`${t("so_order_no", { number: frame.orderNumber })} — ${frame.contactName || ""}`} icon={Layers}
                action={canManage ? (
                  <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setCallOffFor(frame)}>
                    <Plus size={13} />
                    {t("so_calloff_btn")}
                  </Button>
                ) : undefined}
              >
                <div className="p-4 flex flex-wrap items-center gap-5">
                  <div className="flex-1 min-w-56">
                    <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
                      <span>{t("so_frame_used")}: <span dir="ltr" className="tabular-nums">{formatSar(usage.used, locale)}</span></span>
                      <span className="text-muted-foreground">{t("so_frame_cap")}: <span dir="ltr" className="tabular-nums">{formatSar(frame.frameworkCap || 0, locale)}</span></span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full rounded-full", pct > 85 ? "bg-destructive" : pct > 60 ? "bg-warning" : "bg-success")} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="text-xs">
                    <p className="text-muted-foreground">{t("so_frame_remaining")}</p>
                    <p className="font-black tabular-nums" dir="ltr">{formatSar(usage.remaining, locale)}</p>
                  </div>
                  <div className="text-xs">
                    <p className="text-muted-foreground">{t("so_frame_calloffs")}</p>
                    <p className="font-black tabular-nums">{usage.callOffs.length}</p>
                  </div>
                  {frame.frameworkValidUntil && (
                    <div className="text-xs">
                      <p className="text-muted-foreground">{t("so_frame_valid_until")}</p>
                      <p className="font-black tabular-nums" dir="ltr">{frame.frameworkValidUntil}</p>
                    </div>
                  )}
                </div>
              </SalesSection>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((order) => {
            const lines = orderLineProgress(order, notes)
            const deliveredValue = lines.reduce((s, l) => s + l.deliveredValue, 0)
            const net = orderNet(order)
            const pct = net ? Math.min(100, (deliveredValue / net) * 100) : 0
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => setDetailId(order.id)}
                className="w-full text-start flex items-center justify-between gap-4 p-4 rounded-xl border border-slate-200/70 bg-white hover:border-primary/40 hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-black text-muted-foreground">{t("so_order_no", { number: order.orderNumber })}</span>
                    <span className="font-bold text-sm truncate">
                      {order.type === "internal" ? order.projectName || t("so_type_internal") : order.contactName}
                    </span>
                    {statusBadge(order)}
                    {order.type === "internal" && <Badge variant="outline" className="text-[10px]">{t("so_type_internal")}</Badge>}
                    {order.frameworkId && <Badge variant="outline" className="text-[10px]">{t("so_type_calloff")}</Badge>}
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden max-w-md">
                    <div className={cn("h-full rounded-full", pct >= 100 ? "bg-success" : "bg-cta")} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {t("so_delivered_of", { delivered: formatSar(deliveredValue, locale), total: formatSar(net, locale) })}
                    {order.promiseDate && <span className="mx-2">· {t("so_promise")} <span dir="ltr">{order.promiseDate}</span></span>}
                  </p>
                </div>
                <div className="text-end shrink-0">
                  <p className="font-black tabular-nums text-sm" dir="ltr">{formatSar(net, locale)}</p>
                  {orderMargin(order) != null && (
                    <p className="text-[11px] text-muted-foreground tabular-nums" dir="ltr">{orderMargin(order)}%</p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Order detail ── */}
      <Dialog open={!!detail} onOpenChange={(open) => { if (!open) setDetailId(null) }}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  {t("so_order_no", { number: detail.orderNumber })}
                  <span className="text-muted-foreground font-normal">
                    {detail.type === "internal" ? detail.projectName : detail.contactName}
                  </span>
                  {statusBadge(detail)}
                </DialogTitle>
                <DialogDescription>
                  {detail.quotationNumber
                    ? t("so_from_quotation", { number: detail.quotationNumber })
                    : detail.frameworkId
                      ? t("so_from_framework")
                      : t("so_manual")}
                </DialogDescription>
              </DialogHeader>

              {(() => {
                const gate = orderGate(detail, orderLineProgress(detail, notes), gateFlags, stockByName)
                if (!gate) return null
                return (
                  <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-accent/30 bg-accent/5">
                    <div className="flex items-center gap-2 text-sm font-bold text-accent">
                      {gate === "measurement" ? <Ruler size={15} /> : <FileCheck2 size={15} />}
                      {gate === "measurement" ? t("so_gate_measurement") : t("so_gate_approval")}
                    </div>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-8"
                        onClick={async () => {
                          if (!firestore) return
                          try {
                            if (gate === "measurement") await recordOrderMeasurement(firestore, detail.id)
                            else await approveOrderDrawings(firestore, detail.id)
                            toast({ title: gate === "measurement" ? t("so_gate_measured") : t("so_gate_approved") })
                          } catch (err) {
                            console.error(err)
                            toast({ title: t("so_save_error"), variant: "destructive" })
                          }
                        }}
                      >
                        {gate === "measurement" ? t("so_gate_record_btn") : t("so_gate_approve_btn")}
                      </Button>
                    )}
                  </div>
                )
              })()}

              {detail.contactId && (
                <CreditChip firestore={firestore} orgId={orgId} contactId={detail.contactId} orderGross={0} />
              )}

              {detail.payment.kind === "deposit" && !depositSatisfied(detail) && (
                <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-warning/30 bg-warning/5">
                  <div className="flex items-center gap-2 text-sm font-bold text-warning">
                    <Lock size={15} />
                    {t("so_deposit_gate", { amount: formatSar(depositTotal(detail), locale) })}
                  </div>
                  {canApprove && (
                    <Button size="sm" className="gap-1.5 h-8" onClick={() => confirmDeposit(detail)}>
                      <Banknote size={13} />
                      {t("so_deposit_confirm")}
                    </Button>
                  )}
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-start">{t("sales_col_item")}</th>
                      <th className="px-4 py-2.5 text-end">{t("so_col_ordered")}</th>
                      <th className="px-4 py-2.5 text-end">{t("so_col_delivered")}</th>
                      <th className="px-4 py-2.5 text-end">{t("so_col_open")}</th>
                      <th className="px-4 py-2.5 text-start">{t("so_col_coverage")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderLineProgress(detail, notes).map((line) => {
                      const cov = coverage.get(`${detail.id}|${line.name.trim().toLowerCase()}`)
                      return (
                        <tr key={line.name} className="border-t">
                          <td className="px-4 py-2.5 font-semibold">{line.name}
                            <span className="text-muted-foreground text-xs ms-1">{line.unit}</span>
                          </td>
                          <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">{line.quantity}</td>
                          <td className="px-4 py-2.5 text-end tabular-nums text-success" dir="ltr">{line.delivered}</td>
                          <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">{line.open}</td>
                          <td className="px-4 py-2.5 text-xs">
                            {line.remaining <= 0 ? (
                              <span className="text-success flex items-center gap-1"><CheckCircle2 size={12} />{t("so_cov_done")}</span>
                            ) : cov ? (
                              <span className="flex items-center gap-2 flex-wrap">
                                {cov.fromStock > 0 && <span className="text-cta">{t("so_cov_stock", { qty: cov.fromStock })}</span>}
                                {cov.fromManufacturing > 0 && (
                                  <span className="text-accent flex items-center gap-1"><Factory size={11} />{t("so_cov_mfg", { qty: cov.fromManufacturing })}</span>
                                )}
                                {cov.gap > 0 && <span className="text-destructive font-bold">{t("so_cov_gap", { qty: cov.gap })}</span>}
                                {cov.gap > 0 && canManage && (
                                  <button
                                    type="button"
                                    className="text-[11px] font-bold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                                    onClick={async () => {
                                      if (!firestore || !user) return
                                      try {
                                        await createManufacturingRequest(firestore, {
                                          order: detail,
                                          itemName: line.name,
                                          unit: line.unit,
                                          quantity: cov.gap,
                                          actor: { id: user.uid, name: actorName },
                                        })
                                        toast({ title: t("so_mfg_requested") })
                                      } catch (err) {
                                        console.error(err)
                                        toast({ title: t("so_save_error"), variant: "destructive" })
                                      }
                                    }}
                                  >
                                    {t("so_request_mfg_btn")}
                                  </button>
                                )}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <DialogFooter>
                {canManage && detail.status === "running" && schedulableLines(detail, notes).length > 0 && (
                  <Button className="gap-1.5" onClick={() => { setDetailId(null); openDeliver(detail) }}>
                    <Truck size={15} />
                    {t("so_schedule_delivery")}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Schedule delivery ── */}
      <Dialog open={!!deliverFor} onOpenChange={(open) => { if (!isScheduling && !open) setDeliverFor(null) }}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-lg">
          {deliverFor && (
            <>
              <DialogHeader>
                <DialogTitle>{t("so_delivery_title", { number: deliverFor.orderNumber })}</DialogTitle>
                <DialogDescription>{t("so_delivery_desc")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-1">
                <div className="space-y-1.5">
                  <Label>{t("so_delivery_warehouse")} *</Label>
                  <Select value={deliverWarehouseId} onValueChange={setDeliverWarehouseId}>
                    <SelectTrigger><SelectValue placeholder={t("so_delivery_warehouse")} /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {schedulableLines(deliverFor, notes).map((line) => (
                  <div key={line.name} className="flex items-center gap-2">
                    <span className="flex-1 text-sm font-semibold truncate">{line.name}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{t("so_delivery_open", { qty: line.open })}</span>
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      className="w-24 h-9"
                      value={deliverQty[line.name] ?? ""}
                      onChange={(e) => setDeliverQty((p) => ({ ...p, [line.name]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <Label>{t("so_delivery_receiver")}</Label>
                  <Input value={deliverReceiver} onChange={(e) => setDeliverReceiver(e.target.value)} className="h-9" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeliverFor(null)} disabled={isScheduling}>{t("crm_cancel")}</Button>
                <Button onClick={submitDelivery} disabled={isScheduling} className="gap-1.5">
                  {isScheduling ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                  {t("so_delivery_submit")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Call-off ── */}
      <Dialog open={!!callOffFor} onOpenChange={(open) => { if (!isCallingOff && !open) setCallOffFor(null) }}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-sm">
          {callOffFor && (
            <>
              <DialogHeader>
                <DialogTitle>{t("so_calloff_title", { number: callOffFor.orderNumber })}</DialogTitle>
                <DialogDescription>
                  {t("so_calloff_desc", {
                    item: callOffFor.lines[0]?.name || "",
                    price: formatSar(callOffFor.lines[0]?.unitPrice || 0, locale),
                  })}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5 py-1">
                <Label htmlFor="calloff-qty">{t("mfg_item_qty")} *</Label>
                <Input id="calloff-qty" dir="ltr" inputMode="decimal" value={callOffQty} onChange={(e) => setCallOffQty(e.target.value)} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCallOffFor(null)} disabled={isCallingOff}>{t("crm_cancel")}</Button>
                <Button onClick={submitCallOff} disabled={isCallingOff} className="gap-1.5">
                  {isCallingOff ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {t("so_calloff_btn")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <StockLoader firestore={firestore} warehouses={warehouses} onLoaded={setStockByName} />
    </SalesShell>
  )
}

/**
 * Credit as Finance sees it: the limit from the CRM contact, the outstanding
 * balance from the LEDGER's receivable lines for this party. Sales reads,
 * never writes — the whole point of the chip is that nobody can argue with it.
 */
function CreditChip({
  firestore,
  orgId,
  contactId,
  orderGross,
}: {
  firestore: Firestore | null
  orgId: string
  contactId: string
  orderGross: number
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const [credit, setCredit] = useState<CreditSnapshot | null>(null)

  useEffect(() => {
    if (!firestore || !orgId || !contactId) return
    let cancelled = false
    ;(async () => {
      try {
        const [contactSnap, entriesSnap] = await Promise.all([
          getDocs(query(collection(firestore, "crmContacts"), where("organizationId", "==", orgId))),
          getDocs(query(collection(firestore, JOURNAL_ENTRIES), where("organizationId", "==", orgId))),
        ])
        const contact = contactSnap.docs.find((d) => d.id === contactId)?.data() as { creditLimit?: number | null } | undefined
        let outstanding = 0
        for (const d of entriesSnap.docs) {
          const entry = d.data() as JournalEntry
          if (entry.status !== "posted") continue
          for (const line of entry.lines) {
            if (line.party === contactId && line.account === ACC.clientsReceivable) {
              outstanding += line.debit - line.credit
            }
          }
        }
        if (!cancelled) {
          setCredit({ limit: Number(contact?.creditLimit) || 0, outstanding: Math.round(outstanding * 100) / 100, overdueDays: 0 })
        }
      } catch {
        // No ledger access or accounting off — the chip simply stays absent.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [firestore, orgId, contactId])

  if (!credit) return null
  const verdict = creditVerdict(credit, orderGross)
  const tone =
    verdict === "ok" ? "text-success bg-success/5 border-success/30"
    : verdict === "near_limit" ? "text-warning bg-warning/5 border-warning/30"
    : "text-destructive bg-destructive/5 border-destructive/30"
  return (
    <div className={cn("flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-xs font-bold", tone)}>
      <span>{t(`so_credit_${verdict}`)}</span>
      <span dir="ltr" className="tabular-nums">
        {formatSar(credit.outstanding, locale)} / {credit.limit ? formatSar(credit.limit, locale) : "—"}
      </span>
    </div>
  )
}

/**
 * Aggregates every warehouse's stock by item name for the coverage engine.
 * A one-shot read rather than live subscriptions: coverage is advisory, and a
 * dozen inventory listeners re-rendering the whole list on every stock tick
 * would cost more than the freshness is worth.
 */
function StockLoader({
  firestore,
  warehouses,
  onLoaded,
}: {
  firestore: Firestore | null
  warehouses: Array<{ id: string; isOutbound?: boolean }>
  onLoaded: (rows: Array<{ name: string; available: number }>) => void
}) {
  const ids = warehouses.map((w) => w.id).join(",")
  useEffect(() => {
    if (!firestore || !ids) return
    let cancelled = false
    ;(async () => {
      const byName = new Map<string, number>()
      for (const id of ids.split(",")) {
        const snap = await getDocs(collection(firestore, "warehouses", id, "inventoryItems"))
        snap.forEach((d) => {
          const name = ((d.data().name as string) || "").trim()
          if (!name) return
          byName.set(name, (byName.get(name) || 0) + (Number(d.data().quantity) || 0))
        })
      }
      if (!cancelled) onLoaded(Array.from(byName, ([name, available]) => ({ name, available })))
    })()
    return () => {
      cancelled = true
    }
  }, [firestore, ids, onLoaded])
  return null
}
