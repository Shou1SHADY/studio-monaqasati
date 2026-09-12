"use client"

// The v2 work-order board: where the quantities are, what blocks them, and the
// one action each fact allows. Every number here is derived by the engine —
// nothing on this screen is typed twice.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import {
  AlertTriangle,
  Bolt,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Loader2,
  Lock,
  PackageCheck,
  Play,
  Ruler,
  Truck,
  Undo2,
  PencilRuler,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { DeliveryNote } from "@/lib/delivery-notes"
import type { MfgDepartment } from "@/lib/manufacturing"
import {
  activeIndexes,
  atSiteQty,
  brokenUndecided,
  deliveredQty,
  hourVariance,
  labourCostOf,
  marginPercent,
  materialCostOf,
  materialNeed,
  materialReceived,
  materialState,
  orderCost,
  overheadCostOf,
  pendingAt,
  readyQty,
  releaseBlocks,
  remainAt,
  round2,
  shippedQty,
  standardCost,
  stationBlocks,
  unitSunkCost,
  wipQty,
  type MfgProduct,
  type MfgSettings,
  type ScheduleResult,
} from "@/lib/manufacturing-engine"
import {
  approveScrapV2,
  confirmStageMaterials,
  confirmWorkOrderNoteV2,
  decideBreakage,
  issueWorkOrderNoteV2,
  qcDecision,
  recordDrawingApprovalV2,
  recordMeasurementV2,
  recordSlabApprovalV2,
  releaseStageMaterials,
  releaseWorkOrderV2,
  reportStageOutput,
  requestStageMaterials,
  rushWorkOrderV2,
  toggleChecklistItem,
  toNoteSlice,
  toOrderSlice,
  type Actor,
  type WorkOrderV2,
} from "@/lib/manufacturing-writes"

type FormKind =
  | { kind: "output"; index: number }
  | { kind: "qc"; index: number }
  | { kind: "materials"; departmentId: string }
  | { kind: "note" }
  | { kind: "confirmNote"; note: DeliveryNote }
  | { kind: "breakage" }
  | { kind: "measurement" }
  | { kind: "slab" }
  | { kind: "release" }
  | { kind: "rush" }

export interface MfgOrderV2DialogProps {
  order: WorkOrderV2 | null
  product: MfgProduct | null
  departments: MfgDepartment[]
  settings: MfgSettings
  notes: DeliveryNote[]
  schedule: ScheduleResult | null
  warehouses: Array<{ id: string; name: string; projectId?: string | null; isCentral?: boolean; isOutbound?: boolean }>
  actor: Actor
  orgId: string
  canManage: boolean
  canWork: boolean
  canQc: boolean
  canCost: boolean
  seesMoney: boolean
  canReceive: boolean
  onClose: () => void
}

const fmtQty = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })
const fmtMoney = (n: number) => Number(Math.round(n) || 0).toLocaleString("en-US")
const fmtDate = (iso: string | null | undefined, locale: string) =>
  iso ? new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en-GB", { day: "numeric", month: "short" }).format(new Date(iso)) : "—"

export function MfgOrderV2Dialog(props: MfgOrderV2DialogProps) {
  const { order, product, departments, settings, notes, schedule, actor, orgId, onClose } = props
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [form, setForm] = useState<FormKind | null>(null)
  const [busy, setBusy] = useState(false)

  const slice = useMemo(() => (order ? toOrderSlice(order) : null), [order])
  const noteSlices = useMemo(() => notes.map(toNoteSlice), [notes])

  if (!order || !product || !slice) return null
  const route = product.route
  const relBlocks = releaseBlocks(slice, product)
  const active = activeIndexes(slice, route, noteSlices)
  const ready = readyQty(slice, route, noteSlices)
  const delivered = deliveredQty(noteSlices)
  const shipped = shippedQty(noteSlices)
  const wip = wipQty(slice, route)
  const broken = brokenUndecided(slice, noteSlices)
  const atSite = atSiteQty(slice, route, noteSlices)
  const cost = orderCost(slice, route, departments, settings)
  const variance = hourVariance(slice, route, settings)

  const run = async (fn: () => Promise<unknown>, doneMsg: string) => {
    if (!firestore || busy) return
    setBusy(true)
    try {
      await fn()
      toast({ title: doneMsg })
      setForm(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(errKey((err as Error).message)), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const gateBanner = (icon: React.ReactNode, text: string, tone: "hard" | "soft", key?: string) => (
    <div
      key={key}
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold",
        tone === "hard" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-amber-300/60 bg-amber-50 text-amber-700"
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{text}</span>
    </div>
  )

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
              <span>#{order.orderNumber}</span>
              <span className="truncate">{product.name}</span>
              <Badge variant="outline" className="font-bold tabular-nums">
                {fmtQty(order.quantity || 0)} {product.unit}
              </Badge>
              {order.rush && (
                <Badge className="bg-amber-100 text-amber-700 border-none gap-1">
                  <Bolt size={11} /> {t("mfg2_rush")}
                </Badge>
              )}
              {order.status === "done" ? (
                <Badge className="bg-success/10 text-success border-none">{t("mfg2_state_done")}</Badge>
              ) : order.releasedAt == null ? (
                <Badge className="bg-muted text-muted-foreground border-none">
                  {relBlocks.length ? t("mfg2_state_blocked") : t("mfg2_state_awaiting_release")}
                </Badge>
              ) : (
                <Badge className="bg-cta/10 text-cta border-none">{t("mfg2_state_running")}</Badge>
              )}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {order.projectName || order.source?.contactName || t("mfg2_source_stock")}
              {order.riskReason ? ` · ${t("mfg2_risk_released")}: ${order.riskReason}` : ""}
            </p>
          </DialogHeader>

          <div className="space-y-4">
            {/* Gate banners */}
            {order.releasedAt == null &&
              relBlocks.map((b) =>
                gateBanner(
                  b.key === "measurement" ? <Ruler size={14} /> : <Lock size={14} />,
                  b.key === "measurement" ? t("mfg2_block_measurement") : t("mfg2_block_quote"),
                  "hard",
                  b.key
                )
              )}
            {order.releasedAt != null &&
              active.length > 0 &&
              stationBlocks(slice, product, route, active[0]).map((b) =>
                gateBanner(
                  b.key === "drawing" ? <PencilRuler size={14} /> : b.key === "slab" ? <Eye size={14} /> : <Boxes size={14} />,
                  b.key === "drawing" ? t("mfg2_block_drawing") : b.key === "slab" ? t("mfg2_block_slab") : t("mfg2_block_materials"),
                  b.severity,
                  b.key
                )
              )}
            {broken > 0 &&
              gateBanner(<AlertTriangle size={14} />, t("mfg2_breakage_open", { count: fmtQty(broken) }), "hard")}
            {variance &&
              props.seesMoney &&
              gateBanner(
                <AlertTriangle size={14} />,
                t("mfg2_hour_variance", {
                  dept: departments.find((d) => d.id === variance.departmentId)?.name || variance.departmentId,
                  percent: variance.percent,
                }),
                "soft"
              )}

            {/* Quantities */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: t("mfg2_qty_delivered"), value: delivered },
                { label: t("mfg2_qty_wip"), value: wip },
                { label: t("mfg2_qty_ready"), value: ready },
                { label: t("mfg2_qty_transit"), value: shipped },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border bg-muted/20 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground font-semibold">{s.label}</p>
                  <p className="text-lg font-black tabular-nums">{fmtQty(s.value)}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground font-semibold">
              <span>
                {t("mfg2_needed_by")}: <b className="text-foreground">{fmtDate(order.neededBy, locale)}</b>
              </span>
              {settings.features.time && schedule && (
                <span>
                  {t("mfg2_possible_date")}: <b className="text-foreground">{fmtDate(addDays(schedule.finishDays), locale)}</b>
                  {schedule.condition && <span className="text-amber-600"> ({t(`mfg2_cond_${schedule.condition}`)})</span>}
                </span>
              )}
              {atSite > 0 && (
                <span>
                  {t("mfg2_qty_at_site")}: <b className="text-foreground tabular-nums">{fmtQty(atSite)}</b>
                </span>
              )}
              {(slice.shortfall || 0) > 0 && (
                <span className="text-destructive">
                  {t("mfg2_shortfall")}: <b className="tabular-nums">{fmtQty(slice.shortfall || 0)}</b>
                </span>
              )}
            </div>

            {/* Route strip */}
            <section className="rounded-xl border overflow-hidden">
              <header className="px-4 py-2.5 border-b bg-muted/30 text-xs font-black">{t("mfg2_route_title")}</header>
              <div className="flex overflow-x-auto">
                {route.map((r, i) => {
                  const pend = pendingAt(slice, route, i, noteSlices)
                  const done = slice.progress[i]?.done || 0
                  const rejected = slice.progress[i]?.rejected || 0
                  const blocked = stationBlocks(slice, product, route, i).some((b) => b.severity === "hard")
                  const complete = remainAt(slice, i) <= 0 && done > 0
                  return (
                    <div
                      key={`${r.departmentId}_${i}`}
                      className={cn(
                        "min-w-[130px] flex-1 border-e px-3 py-2.5 text-xs",
                        complete ? "bg-success/5" : pend > 0 ? (blocked ? "bg-destructive/5" : "bg-cta/5") : "bg-white"
                      )}
                    >
                      <p className="font-bold flex items-center gap-1">
                        <span className="text-muted-foreground">{i + 1}.</span> {r.departmentName}
                        {r.onSite && <Badge variant="outline" className="text-[9px] px-1 py-0">{t("mfg2_on_site")}</Badge>}
                      </p>
                      <p className="text-muted-foreground mt-1 tabular-nums">
                        {done > 0 ? t("mfg2_step_done", { count: fmtQty(done) }) : t("mfg2_step_idle")}
                        {pend > 0 && <> · <b className="text-foreground">{t("mfg2_step_in_hand", { count: fmtQty(pend) })}</b></>}
                        {rejected > 0 && <> · <span className="text-amber-600">{t("mfg2_step_rejected", { count: fmtQty(rejected) })}</span></>}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {pend > 0 && props.canWork && !blocked && order.status !== "cancelled" && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1" onClick={() => setForm({ kind: "output", index: i })}>
                            <CheckCircle2 size={10} /> {t("mfg2_report_output")}
                          </Button>
                        )}
                        {rejected > 0 && props.canQc && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1 text-amber-700" onClick={() => setForm({ kind: "qc", index: i })}>
                            <AlertTriangle size={10} /> {t("mfg2_qc_decide")}
                          </Button>
                        )}
                        {blocked && <Lock size={11} className="text-destructive mt-1" />}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Materials per consuming department */}
            <MaterialsSection {...props} slice={slice} setForm={setForm} busy={busy} run={run} />

            {/* Scrap */}
            {slice.scrap.length > 0 && (
              <section className="rounded-xl border overflow-hidden">
                <header className="px-4 py-2.5 border-b bg-muted/30 text-xs font-black">{t("mfg2_scrap_title")}</header>
                {slice.scrap.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 px-4 py-2.5 border-b last:border-b-0 text-xs">
                    <span className="font-bold tabular-nums">{fmtQty(s.quantity)} {product.unit}</span>
                    <span className="text-muted-foreground truncate">{s.reason} · {s.raisedByName}</span>
                    <span className="ms-auto flex items-center gap-2">
                      {props.seesMoney && <b className="tabular-nums">{fmtMoney(s.value)} ﷼</b>}
                      {s.status === "approved" ? (
                        <Badge className="bg-success/10 text-success border-none">{t("mfg2_scrap_approved")}</Badge>
                      ) : (
                        <>
                          <Badge className="bg-amber-100 text-amber-700 border-none">{t("mfg2_scrap_pending")}</Badge>
                          {props.canCost && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () => approveScrapV2(firestore!, { order, scrapId: s.id, actor, organizationId: orgId }),
                                  t("mfg2_scrap_approved_toast")
                                )
                              }
                            >
                              {t("mfg2_approve_scrap")}
                            </Button>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </section>
            )}

            {/* Delivery notes */}
            <section className="rounded-xl border overflow-hidden">
              <header className="px-4 py-2.5 border-b bg-muted/30 text-xs font-black flex items-center justify-between">
                {t("mfg2_notes_title")}
                {ready > 0 && props.canManage && (
                  <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={() => setForm({ kind: "note" })}>
                    <Truck size={12} /> {t("mfg2_issue_note", { count: fmtQty(ready) })}
                  </Button>
                )}
              </header>
              {notes.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">{t("mfg2_no_notes")}</p>}
              {notes.map((n) => (
                <div key={n.id} className="flex items-center gap-2 px-4 py-2.5 border-b last:border-b-0 text-xs">
                  <Truck size={13} className="text-muted-foreground shrink-0" />
                  <span className="font-bold">{n.noteNumber}</span>
                  <span className="tabular-nums">{fmtQty(n.item.quantity)} {n.item.unit}</span>
                  <span className="text-muted-foreground truncate">→ {n.toWarehouseName}{n.driverName ? ` · ${n.driverName}` : ""}</span>
                  <span className="ms-auto flex items-center gap-2">
                    {(n.brokenQuantity || 0) > 0 && (
                      <Badge className="bg-destructive/10 text-destructive border-none tabular-nums">
                        {t("mfg2_note_broken", { count: fmtQty(n.brokenQuantity || 0) })}
                      </Badge>
                    )}
                    {n.status === "received" ? (
                      <Badge className="bg-success/10 text-success border-none">{t("mfg2_note_received")}</Badge>
                    ) : n.status === "rejected" ? (
                      <Badge className="bg-muted text-muted-foreground border-none">{t("mfg2_note_rejected")}</Badge>
                    ) : (
                      <>
                        <Badge className="bg-violet-100 text-violet-700 border-none">{t("mfg2_note_in_transit")}</Badge>
                        {(props.canReceive || props.canManage) && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setForm({ kind: "confirmNote", note: n })}>
                            {t("mfg2_confirm_receipt")}
                          </Button>
                        )}
                      </>
                    )}
                  </span>
                </div>
              ))}
              {broken > 0 && (props.canManage || props.canCost) && (
                <div className="px-4 py-2.5 bg-destructive/5 flex items-center justify-between text-xs">
                  <span className="font-semibold text-destructive">{t("mfg2_breakage_open", { count: fmtQty(broken) })}</span>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1" onClick={() => setForm({ kind: "breakage" })}>
                    <Undo2 size={10} /> {t("mfg2_breakage_decide")}
                  </Button>
                </div>
              )}
            </section>

            {/* Checklists */}
            {settings.features.checklists && (
              <ChecklistSection {...props} slice={slice} run={run} busy={busy} />
            )}

            {/* Cost */}
            {props.seesMoney && (
              <section className="rounded-xl border overflow-hidden">
                <header className="px-4 py-2.5 border-b bg-muted/30 text-xs font-black">{t("mfg2_cost_title")}</header>
                <div className="px-4 py-3 space-y-1.5 text-xs">
                  <CostRow label={t("mfg2_cost_materials")} value={materialCostOf(slice).cost} />
                  {settings.features.time ? (
                    <>
                      <CostRow label={t("mfg2_cost_labour")} value={labourCostOf(slice, route, departments, settings)} />
                      <CostRow label={t("mfg2_cost_overhead")} value={overheadCostOf(slice, settings)} />
                    </>
                  ) : (
                    <p className="text-muted-foreground">{t("mfg2_time_off_note")}</p>
                  )}
                  <div className="flex items-center justify-between border-t pt-1.5 font-black">
                    <span>{t("mfg2_cost_so_far")}</span>
                    <span className="tabular-nums">{fmtMoney(cost)} ﷼</span>
                  </div>
                  <CostRow label={t("mfg2_cost_standard")} value={standardCost(product, departments, settings, order.quantity || 0).total} />
                  {product.salePrice != null && order.source?.kind === "quotation" && (
                    <>
                      <CostRow label={t("mfg2_sale_value")} value={product.salePrice * (order.quantity || 0)} />
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">{t("mfg2_margin")}</span>
                        <span className={cn("tabular-nums font-bold", product.salePrice * (order.quantity || 0) - cost >= 0 ? "text-success" : "text-destructive")}>
                          {marginPercent(product.salePrice * (order.quantity || 0), cost) ?? "—"}%
                        </span>
                      </div>
                    </>
                  )}
                  {!materialCostOf(slice).allPriced && <p className="text-amber-600">{t("mfg2_cost_unknown_note")}</p>}
                </div>
              </section>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              {product.requiresMeasurement && !order.measurement && (props.canManage || props.canQc || props.canCost) && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setForm({ kind: "measurement" })}>
                  <Ruler size={13} /> {t("mfg2_record_measurement")}
                </Button>
              )}
              {product.requiresDrawingApproval && order.drawingApprovalStatus !== "approved" && props.canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => recordDrawingApprovalV2(firestore!, { orderId: order.id, approved: true, by: actor.name }),
                      t("mfg2_drawing_approved_toast")
                    )
                  }
                >
                  <PencilRuler size={13} /> {t("mfg2_approve_drawing")}
                </Button>
              )}
              {product.requiresSlabApproval && !order.slabApproval && (props.canQc || props.canManage) && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setForm({ kind: "slab" })}>
                  <Eye size={13} /> {t("mfg2_record_slab")}
                </Button>
              )}
              {order.releasedAt == null &&
                (relBlocks.length === 0 && props.canManage ? (
                  <Button size="sm" className="gap-1.5" onClick={() => setForm({ kind: "release" })}>
                    <Play size={13} /> {t("mfg2_release")}
                  </Button>
                ) : relBlocks.length > 0 && props.canCost ? (
                  <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => setForm({ kind: "release" })}>
                    <AlertTriangle size={13} /> {t("mfg2_risk_release")}
                  </Button>
                ) : null)}
              {order.releasedAt != null && !order.rush && order.status === "open" && (props.canManage || props.canCost) && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setForm({ kind: "rush" })}>
                  <Bolt size={13} /> {t("mfg2_rush_order")}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {form && (
        <ActionFormDialog
          {...props}
          form={form}
          slice={slice}
          noteSlices={noteSlices}
          busy={busy}
          run={run}
          onDismiss={() => setForm(null)}
        />
      )}
    </>
  )
}

function addDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function errKey(msg: string): string {
  switch (msg) {
    case "more_than_in_hand":
      return "mfg2_err_more_than_in_hand"
    case "more_than_rejected":
      return "mfg2_err_more_than_rejected"
    case "more_than_ready":
      return "mfg2_err_more_than_ready"
    case "more_than_shipped":
      return "mfg2_err_more_than_shipped"
    case "insufficient_stock":
      return "mfg2_err_insufficient_stock"
    case "reason_required":
      return "mfg2_err_reason_required"
    case "driver_required":
      return "mfg2_err_driver_required"
    case "quantity_required":
      return "mfg2_err_quantity_required"
    case "by_required":
    case "lot_required":
      return "mfg2_err_name_required"
    case "blocked":
      return "mfg2_err_blocked"
    default:
      return "mfg_save_error"
  }
}

function CostRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-semibold">{fmtMoney(value)} ﷼</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function MaterialsSection(
  props: MfgOrderV2DialogProps & {
    slice: NonNullable<ReturnType<typeof toOrderSlice>>
    setForm: (f: FormKind) => void
    busy: boolean
    run: (fn: () => Promise<unknown>, msg: string) => Promise<void>
  }
) {
  const { order, product, slice, setForm, run, busy } = props
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const [releasing, setReleasing] = useState<string | null>(null)
  const route = product!.route
  const consumingDepts = [...new Set((product!.bom || []).map((b) => b.departmentId))]
  if (!consumingDepts.length) return null

  return (
    <section className="rounded-xl border overflow-hidden">
      <header className="px-4 py-2.5 border-b bg-muted/30 text-xs font-black">{t("mfg2_materials_title")}</header>
      {consumingDepts.map((deptId) => {
        const i = route.findIndex((r) => r.departmentId === deptId)
        const need = materialNeed(slice, product!, deptId)
        const state = materialState(slice, product!, route, i)
        const rows = slice.materials.filter((m) => m.departmentId === deptId)
        const openRequests = [...new Set(rows.filter((m) => m.state === "requested").map((m) => m.requestNumber))]
        const releasedRequests = [...new Set(rows.filter((m) => m.state === "released").map((m) => m.requestNumber))]
        const stateBadge: Record<string, { label: string; cls: string }> = {
          none: { label: "", cls: "" },
          missing: { label: t("mfg2_mat_missing"), cls: "bg-amber-100 text-amber-700" },
          requested: { label: t("mfg2_mat_requested"), cls: "bg-cta/10 text-cta" },
          released: { label: t("mfg2_mat_released"), cls: "bg-violet-100 text-violet-700" },
          partial: { label: t("mfg2_mat_partial"), cls: "bg-amber-100 text-amber-700" },
          complete: { label: t("mfg2_mat_complete"), cls: "bg-success/10 text-success" },
        }
        return (
          <div key={deptId} className="border-b last:border-b-0">
            <div className="flex items-center gap-2 px-4 py-2 bg-muted/10 text-xs">
              <b>{route[i]?.departmentName || deptId}</b>
              {state !== "none" && <Badge className={cn("border-none", stateBadge[state].cls)}>{stateBadge[state].label}</Badge>}
              <span className="ms-auto flex gap-1.5">
                {(state === "missing" || state === "partial") && props.canWork && order!.releasedAt != null && (
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1" onClick={() => setForm({ kind: "materials", departmentId: deptId })}>
                    <Boxes size={10} /> {t("mfg2_request_materials")}
                  </Button>
                )}
                {openRequests.map((rn) => (
                  <ReleaseButton key={rn} {...props} requestNumber={rn} releasing={releasing} setReleasing={setReleasing} />
                ))}
                {releasedRequests.map((rn) => (
                  <Button
                    key={rn}
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px] gap-1"
                    disabled={busy || !props.canWork}
                    onClick={() =>
                      run(
                        () => confirmStageMaterials(firestore!, { order: order!, requestNumber: rn, actor: props.actor, organizationId: props.orgId }),
                        t("mfg2_mat_confirmed_toast")
                      )
                    }
                  >
                    <PackageCheck size={10} /> {t("mfg2_confirm_materials", { request: rn })}
                  </Button>
                ))}
              </span>
            </div>
            {need.map((n) => {
              const got = materialReceived(slice, deptId, n.itemName)
              return (
                <div key={n.itemName} className="flex items-center gap-2 px-4 py-2 text-xs border-t border-dashed">
                  <span className="font-semibold">{n.itemName}</span>
                  {n.withWaste && (
                    <span className="text-[10px] text-muted-foreground">
                      {t("mfg2_mat_waste_note", { net: fmtQty(n.net), waste: product!.wastePercent })}
                    </span>
                  )}
                  <span className="ms-auto tabular-nums text-muted-foreground">
                    <b className={cn(got >= n.qty ? "text-success" : "text-foreground")}>{fmtQty(got)}</b> / {fmtQty(n.qty)} {n.unit}
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
    </section>
  )
}

/** The storekeeper's release needs the shelf: load the request's warehouse
 * inventory on demand, validate, then move the stock in one batch. */
function ReleaseButton(
  props: MfgOrderV2DialogProps & {
    requestNumber: string
    releasing: string | null
    setReleasing: (v: string | null) => void
  }
) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { toast } = useToast()
  const canRelease = props.canManage || props.canReceive
  const warehouseId = props.order!.materials?.find((m) => m.requestNumber === props.requestNumber)?.warehouseId || null
  const itemsQuery = useMemoFirebase(() => {
    if (!firestore || !warehouseId || props.releasing !== props.requestNumber) return null
    return collection(firestore, "warehouses", warehouseId, "inventoryItems")
  }, [firestore, warehouseId, props.releasing, props.requestNumber])
  const { data: itemsData, isLoading } = useCollection(itemsQuery)

  if (!canRelease || !warehouseId) {
    return <Badge className="bg-cta/10 text-cta border-none text-[10px]">{props.requestNumber}</Badge>
  }
  const doRelease = async () => {
    if (!firestore) return
    if (props.releasing !== props.requestNumber) {
      props.setReleasing(props.requestNumber)
      return
    }
    try {
      const stockRows = (itemsData || []) as Array<{ id: string; name: string; quantity: number; unitCost?: number | null }>
      await releaseStageMaterials(firestore, {
        order: props.order!,
        requestNumber: props.requestNumber,
        warehouseId,
        stockRows,
        actor: props.actor,
      })
      toast({ title: t("mfg2_mat_released_toast") })
      props.setReleasing(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(errKey((err as Error).message)), variant: "destructive" })
    }
  }
  const armed = props.releasing === props.requestNumber
  return (
    <Button size="sm" variant={armed ? "default" : "outline"} className="h-6 px-2 text-[10px] gap-1" disabled={armed && isLoading} onClick={doRelease}>
      {armed && isLoading ? <Loader2 size={10} className="animate-spin" /> : <Boxes size={10} />}
      {armed ? t("mfg2_mat_release_confirm", { request: props.requestNumber }) : t("mfg2_mat_release", { request: props.requestNumber })}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Checklists
// ---------------------------------------------------------------------------

function ChecklistSection(
  props: MfgOrderV2DialogProps & {
    slice: NonNullable<ReturnType<typeof toOrderSlice>>
    run: (fn: () => Promise<unknown>, msg: string) => Promise<void>
    busy: boolean
  }
) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { order, product, departments, slice } = props
  const active = product!.route.filter((r, i) => (slice.progress[i]?.done || 0) > 0 || pendingAt(slice, product!.route, i, []) > 0)
  const withLists = active
    .map((r) => ({ step: r, list: departments.find((d) => d.id === r.departmentId)?.checklist || [] }))
    .filter((x) => x.list.length > 0)
  if (!withLists.length) return null
  return (
    <section className="rounded-xl border overflow-hidden">
      <header className="px-4 py-2.5 border-b bg-muted/30 text-xs font-black flex items-center gap-2">
        <ClipboardCheck size={13} /> {t("mfg2_checklists_title")}
      </header>
      {withLists.map(({ step, list }) => (
        <div key={step.departmentId} className="border-b last:border-b-0">
          <p className="px-4 py-1.5 bg-muted/10 text-[11px] font-bold">{step.departmentName}</p>
          {list.map((item) => {
            const mark = (slice.checklists || {})[step.departmentId]?.[item.key]
            return (
              <button
                key={item.key}
                type="button"
                disabled={!props.canWork || props.busy}
                onClick={() =>
                  props.run(
                    () => toggleChecklistItem(firestore!, { order: order!, departmentId: step.departmentId, itemKey: item.key, actor: props.actor }),
                    t("mfg2_checklist_toast")
                  )
                }
                className="w-full flex items-center gap-2 px-4 py-2 text-xs text-start hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "h-4 w-4 rounded grid place-items-center border shrink-0",
                    mark ? "bg-success border-success text-white" : "border-border"
                  )}
                >
                  {mark && <CheckCircle2 size={11} />}
                </span>
                <span className="font-semibold">{item.label}</span>
                <span className="ms-auto text-[10px] text-muted-foreground">
                  {mark ? `${mark.by}` : t("mfg2_checklist_unmarked")}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Action forms
// ---------------------------------------------------------------------------

function ActionFormDialog(
  props: MfgOrderV2DialogProps & {
    form: FormKind
    slice: NonNullable<ReturnType<typeof toOrderSlice>>
    noteSlices: ReturnType<typeof toNoteSlice>[]
    busy: boolean
    run: (fn: () => Promise<unknown>, msg: string) => Promise<void>
    onDismiss: () => void
  }
) {
  const { form, order, product, departments, settings, slice, noteSlices, run, busy, onDismiss, actor } = props
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const route = product!.route

  const [qty, setQty] = useState("")
  const [rejected, setRejected] = useState("")
  const [hours, setHours] = useState("")
  const [reason, setReason] = useState("")
  const [name, setName] = useState(actor.name)
  const [lot, setLot] = useState(order!.slabApproval?.lot || "")
  const [qcKind, setQcKind] = useState<"rework" | "scrap">("rework")
  const [toIndex, setToIndex] = useState<string>("0")
  const [breakKind, setBreakKind] = useState<"remake" | "shortfall">("remake")
  const [destId, setDestId] = useState("")
  const [driver, setDriver] = useState("")
  const [plate, setPlate] = useState("")
  const [pieces, setPieces] = useState("")
  const [crates, setCrates] = useState("")
  const [broken, setBroken] = useState("0")
  const [matWarehouseId, setMatWarehouseId] = useState(props.warehouses.find((w) => w.isCentral)?.id || props.warehouses[0]?.id || "")
  const [matLines, setMatLines] = useState<Record<string, string>>({})

  const title: Record<FormKind["kind"], string> = {
    output: t("mfg2_form_output_title"),
    qc: t("mfg2_form_qc_title"),
    materials: t("mfg2_form_materials_title"),
    note: t("mfg2_form_note_title"),
    confirmNote: t("mfg2_form_confirm_note_title"),
    breakage: t("mfg2_form_breakage_title"),
    measurement: t("mfg2_record_measurement"),
    slab: t("mfg2_record_slab"),
    release: t("mfg2_release"),
    rush: t("mfg2_rush_order"),
  }

  const submit = async () => {
    if (!firestore) return
    if (form.kind === "output") {
      await run(
        () =>
          reportStageOutput(firestore, {
            order: order!,
            product: product!,
            notes: noteSlices,
            index: form.index,
            done: Number(qty) || 0,
            rejected: Number(rejected) || 0,
            hours: Number(hours) || 0,
            actor,
          }),
        t("mfg2_output_toast")
      )
      onDismiss()
      return
    }
    if (form.kind === "qc") {
      const result = await qcSubmit()
      if (result) onDismiss()
      return
    }
    if (form.kind === "materials") {
      const need = materialNeed(slice, product!, form.departmentId)
      const lines = need
        .map((n) => ({
          itemName: n.itemName,
          unit: n.unit,
          quantity: Number(matLines[n.itemName] ?? String(Math.max(0, round2(n.qty - materialReceived(slice, form.departmentId, n.itemName))))) || 0,
          lot: n.lotted ? order!.slabApproval?.lot || null : null,
        }))
        .filter((l) => l.quantity > 0)
      await run(
        () =>
          requestStageMaterials(firestore, {
            order: order!,
            departmentId: form.departmentId,
            warehouseId: matWarehouseId || null,
            lines,
            actor,
          }),
        t("mfg2_mat_requested_toast")
      )
      onDismiss()
      return
    }
    if (form.kind === "note") {
      const dest = props.warehouses.find((w) => w.id === destId)
      if (!dest) return
      await run(
        () =>
          issueWorkOrderNoteV2(firestore, {
            order: order!,
            product: product!,
            departments,
            settings,
            allNotes: noteSlices,
            quantity: Number(qty) || 0,
            destination: {
              warehouseId: dest.id,
              warehouseName: dest.name,
              kind: dest.isOutbound ? "outbound" : dest.projectId ? "project" : "central",
              projectId: dest.projectId ?? null,
            },
            pieces: Number(pieces) || null,
            crates: Number(crates) || null,
            driverName: driver,
            vehiclePlate: plate || null,
            actor,
          }),
        t("mfg2_note_issued_toast")
      )
      onDismiss()
      return
    }
    if (form.kind === "confirmNote") {
      await run(
        () =>
          confirmWorkOrderNoteV2(firestore, {
            note: form.note,
            order: order!,
            product: product!,
            allNotes: props.notes.map((n) => ({ ...toNoteSlice(n), id: n.id })),
            brokenQuantity: Number(broken) || 0,
            receivedNote: reason || null,
            actor,
          }),
        t("mfg2_note_received_toast")
      )
      onDismiss()
      return
    }
    if (form.kind === "breakage") {
      await run(
        () =>
          decideBreakage(firestore, {
            order: order!,
            product: product!,
            allNotes: noteSlices,
            kind: breakKind,
            quantity: Number(qty) || 0,
            reason,
            actor,
          }),
        t("mfg2_breakage_toast")
      )
      onDismiss()
      return
    }
    if (form.kind === "measurement") {
      await run(() => recordMeasurementV2(firestore, { orderId: order!.id, by: name, note: reason || null }), t("mfg2_measurement_toast"))
      onDismiss()
      return
    }
    if (form.kind === "slab") {
      await run(() => recordSlabApprovalV2(firestore, { orderId: order!.id, by: name, lot, note: reason || null }), t("mfg2_slab_toast"))
      onDismiss()
      return
    }
    if (form.kind === "release") {
      await run(
        () => releaseWorkOrderV2(firestore, { order: order!, product: product!, riskReason: reason || null, actor }),
        t("mfg2_released_toast")
      )
      onDismiss()
      return
    }
    if (form.kind === "rush") {
      await run(() => rushWorkOrderV2(firestore, { orderId: order!.id, reason, actor }), t("mfg2_rushed_toast"))
      onDismiss()
    }
  }

  const qcSubmit = async (): Promise<boolean> => {
    if (!firestore) return false
    if (form.kind !== "qc") return false
    await run(
      () =>
        qcDecision(firestore, {
          order: order!,
          product: product!,
          departments,
          settings,
          index: form.index,
          kind: qcKind,
          quantity: Number(qty) || 0,
          toIndex: Number(toIndex),
          reason,
          canApproveAny: props.canCost,
          actor,
          organizationId: props.orgId,
        }),
      t("mfg2_qc_toast")
    )
    return true
  }

  const relBlocks = releaseBlocks(slice, product!)
  const scrapUnitValue = form.kind === "qc" ? unitSunkCost(product!, departments, settings, form.index) : 0

  return (
    <Dialog open onOpenChange={(v) => !v && onDismiss()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="text-base">{title[form.kind]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {form.kind === "output" && (
            <>
              <p className="text-xs text-muted-foreground">
                {route[form.index]?.departmentName} · {t("mfg2_step_in_hand", { count: fmtQty(pendingAt(slice, route, form.index, noteSlices)) })}
                {settings.features.time && (
                  <> · {t("mfg2_std_hours_hint", { hours: fmtQty((route[form.index]?.hoursPerUnit || 0) * pendingAt(slice, route, form.index, noteSlices)) })}</>
                )}
              </p>
              <Field label={t("mfg2_field_good_output")}>
                <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
              </Field>
              <Field label={t("mfg2_field_rejected")} hint={t("mfg2_field_rejected_hint")}>
                <Input type="number" min="0" step="any" value={rejected} onChange={(e) => setRejected(e.target.value)} />
              </Field>
              {settings.features.time && (
                <Field label={t("mfg2_field_hours")} hint={t("mfg2_field_hours_hint")}>
                  <Input type="number" min="0" step="any" value={hours} onChange={(e) => setHours(e.target.value)} />
                </Field>
              )}
            </>
          )}

          {form.kind === "qc" && (
            <>
              <p className="text-xs text-muted-foreground">
                {t("mfg2_qc_held", { count: fmtQty(slice.progress[form.index]?.rejected || 0), dept: route[form.index]?.departmentName || "" })}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["rework", "scrap"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setQcKind(k)}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-xs font-bold text-start",
                      qcKind === k ? "border-primary bg-primary/5" : "border-border"
                    )}
                  >
                    {k === "rework" ? t("mfg2_qc_rework") : t("mfg2_qc_scrap")}
                    <span className="block font-normal text-muted-foreground mt-0.5">
                      {k === "rework" ? t("mfg2_qc_rework_hint") : t("mfg2_qc_scrap_hint")}
                    </span>
                  </button>
                ))}
              </div>
              <Field label={t("mfg2_field_quantity")}>
                <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
              </Field>
              {qcKind === "rework" ? (
                <Field label={t("mfg2_qc_back_to")}>
                  <Select value={toIndex} onValueChange={setToIndex}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {route.slice(0, form.index + 1).map((r, i) => (
                        <SelectItem key={`${r.departmentId}_${i}`} value={String(i)}>{r.departmentName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                props.seesMoney && (
                  <p className="text-xs font-semibold">
                    {t("mfg2_scrap_value_computed", { value: fmtMoney(scrapUnitValue * (Number(qty) || 0)) })}
                    {scrapUnitValue * (Number(qty) || 0) > settings.scrapApprovalLimit && !props.canCost && (
                      <span className="block text-amber-600 mt-1">{t("mfg2_scrap_above_limit", { limit: fmtMoney(settings.scrapApprovalLimit) })}</span>
                    )}
                  </p>
                )
              )}
              <Field label={t("mfg2_field_reason")} hint={t("mfg2_qc_reason_hint")}>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </>
          )}

          {form.kind === "materials" && (
            <>
              <Field label={t("mfg2_field_warehouse")}>
                <Select value={matWarehouseId} onValueChange={setMatWarehouseId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {props.warehouses.filter((w) => !w.isOutbound).map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {materialNeed(slice, product!, form.departmentId).map((n) => {
                const got = materialReceived(slice, form.departmentId, n.itemName)
                const def = Math.max(0, round2(n.qty - got))
                return (
                  <Field
                    key={n.itemName}
                    label={`${n.itemName} (${n.unit})`}
                    hint={n.withWaste ? t("mfg2_mat_waste_note", { net: fmtQty(n.net), waste: product!.wastePercent }) : undefined}
                  >
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={matLines[n.itemName] ?? String(def)}
                      onChange={(e) => setMatLines((m) => ({ ...m, [n.itemName]: e.target.value }))}
                    />
                  </Field>
                )
              })}
              {order!.slabApproval?.lot && <p className="text-[11px] text-muted-foreground">{t("mfg2_mat_lot_note", { lot: order!.slabApproval.lot })}</p>}
            </>
          )}

          {form.kind === "note" && (
            <>
              <Field label={t("mfg2_field_quantity")} hint={t("mfg2_note_ready_hint", { count: fmtQty(readyQty(slice, route, noteSlices)) })}>
                <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={fmtQty(readyQty(slice, route, noteSlices))} />
              </Field>
              <Field label={t("mfg2_field_destination")}>
                <Select value={destId} onValueChange={setDestId}>
                  <SelectTrigger><SelectValue placeholder={t("mfg2_field_destination")} /></SelectTrigger>
                  <SelectContent>
                    {props.warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("mfg2_field_pieces")}>
                  <Input type="number" min="0" value={pieces} onChange={(e) => setPieces(e.target.value)} />
                </Field>
                <Field label={t("mfg2_field_crates")}>
                  <Input type="number" min="0" value={crates} onChange={(e) => setCrates(e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("mfg2_field_driver")}>
                  <Input value={driver} onChange={(e) => setDriver(e.target.value)} />
                </Field>
                <Field label={t("mfg2_field_plate")}>
                  <Input value={plate} onChange={(e) => setPlate(e.target.value)} />
                </Field>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("mfg2_note_no_cost_note")}</p>
            </>
          )}

          {form.kind === "confirmNote" && (
            <>
              <p className="text-xs text-muted-foreground">
                {form.note.noteNumber} · {fmtQty(form.note.item.quantity)} {form.note.item.unit} → {form.note.toWarehouseName}
              </p>
              <Field label={t("mfg2_field_broken")} hint={t("mfg2_field_broken_hint")}>
                <Input type="number" min="0" step="any" value={broken} onChange={(e) => setBroken(e.target.value)} />
              </Field>
              <Field label={t("mfg2_field_receipt_note")}>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </>
          )}

          {form.kind === "breakage" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(["remake", "shortfall"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setBreakKind(k)}
                    className={cn("rounded-xl border px-3 py-2.5 text-xs font-bold text-start", breakKind === k ? "border-primary bg-primary/5" : "border-border")}
                  >
                    {k === "remake" ? t("mfg2_breakage_remake") : t("mfg2_breakage_shortfall")}
                    <span className="block font-normal text-muted-foreground mt-0.5">
                      {k === "remake" ? t("mfg2_breakage_remake_hint") : t("mfg2_breakage_shortfall_hint")}
                    </span>
                  </button>
                ))}
              </div>
              <Field label={t("mfg2_field_quantity")}>
                <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={fmtQty(brokenUndecided(slice, noteSlices))} />
              </Field>
              <Field label={t("mfg2_field_reason")} hint={t("mfg2_breakage_reason_hint")}>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </>
          )}

          {form.kind === "measurement" && (
            <>
              <Field label={t("mfg2_field_measured_by")} hint={t("mfg2_field_named_fact_hint")}>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t("mfg2_field_note_optional")}>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </>
          )}

          {form.kind === "slab" && (
            <>
              <Field label={t("mfg2_field_lot")} hint={t("mfg2_slab_lot_hint")}>
                <Input value={lot} onChange={(e) => setLot(e.target.value)} />
              </Field>
              <Field label={t("mfg2_field_signed_by")} hint={t("mfg2_field_named_fact_hint")}>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t("mfg2_field_note_optional")}>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </>
          )}

          {form.kind === "release" && (
            <>
              {relBlocks.length > 0 ? (
                <>
                  {relBlocks.map((b) => (
                    <p key={b.key} className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                      <Lock size={12} /> {b.key === "measurement" ? t("mfg2_block_measurement") : t("mfg2_block_quote")}
                    </p>
                  ))}
                  <Field label={t("mfg2_field_risk_reason")} hint={t("mfg2_risk_reason_hint")}>
                    <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t("mfg2_release_hint")}</p>
              )}
            </>
          )}

          {form.kind === "rush" && (
            <Field label={t("mfg2_field_reason")} hint={t("mfg2_rush_hint")}>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onDismiss}>{t("crm_cancel")}</Button>
            <Button size="sm" disabled={busy} onClick={submit} className="gap-1.5">
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t("mfg2_confirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-bold">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
