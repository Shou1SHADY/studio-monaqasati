"use client"

// The work order, opened in place from any Manufacturing screen: what stops
// it, where its quantities are, what it consumed and cost, the documents it
// produced, what it sent to Finance, its history — and the actions the signed-in
// role can take on it right now, at the bottom, one click each.

import { useMemo, useState, type ElementType, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Coins,
  Eye,
  FileText,
  Hourglass,
  Landmark,
  Layers,
  Loader2,
  Lock,
  PackageCheck,
  PencilRuler,
  Play,
  Route,
  Ruler,
  Trash2,
  Truck,
  Undo2,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useOrgStock, stockKey } from "@/hooks/useOrgStock"
import { cn } from "@/lib/utils"
import {
  hourVariance,
  materialNeed,
  materialOpen,
  materialReceived,
  materialState,
  pendingAt,
  round2,
  stationBlocks,
  type Block,
} from "@/lib/manufacturing-engine"
import { confirmStageMaterials, releaseStageMaterials, toggleChecklistItem } from "@/lib/manufacturing-writes"
import { documentTrail, financeEvents, orderLog, orderMoney, type OrderView } from "@/lib/manufacturing-view"
import { useMfgUi, type OrderAction } from "./MfgUiContext"
import { MfgDueCell, MfgRouteStrip, MfgRushChip, MfgSourceChip, MfgStatePill, departmentNameOf, sourceNameOf } from "./MfgOrderBits"
import { MfgChip, MfgDrawer, MfgNote, MfgPill, MfgQtyLegend, MfgRow, MfgSection, MfgStat, departmentIcon, fmtMoney, fmtQty, useMfgDate, type MfgTone } from "./ui/MfgUi"

export function MfgOrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const ui = useMfgUi()
  const view = orderId ? ui.viewById.get(orderId) : undefined
  return (
    <MfgDrawer
      open={!!view}
      onClose={onClose}
      icon={view ? departmentIcon(view.current >= 0 ? departmentNameOf(ui.data.departments, view, view.current) : view.product.name) : Layers}
      title={view ? `#${view.number} — ${view.product.name}` : ""}
      meta={view ? <DrawerMeta view={view} /> : null}
      footer={view ? <DrawerActions view={view} /> : null}
    >
      {view && <DrawerBody view={view} />}
    </MfgDrawer>
  )
}

function DrawerMeta({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const extra = view.order as OrderView["order"] & { requestedByName?: string | null }
  return (
    <>
      <MfgSourceChip view={view} />
      <span className="font-semibold text-slate-600">{sourceNameOf(view, t)}</span>
      {extra.requestedByName && <span>· {t("mfg3_dr_requested_by", { name: extra.requestedByName })}</span>}
      {view.slice.slabApproval?.lot && <MfgChip tone="info" icon={Layers}>{view.slice.slabApproval.lot}</MfgChip>}
      <MfgStatePill view={view} departments={data.departments} />
      {view.rush && <MfgRushChip />}
    </>
  )
}

function blockTexts(t: (k: string, v?: Record<string, string | number>) => string, b: Block, deptName?: string) {
  return {
    title: deptName ? `${deptName}: ${t(`mfg3_block_${b.key}`)}` : t(`mfg3_block_${b.key}`),
    fix: t(`mfg3_block_${b.key}_fix`),
  }
}

function DrawerBody({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms } = ui
  const d = useMfgDate()
  const money = useMemo(() => orderMoney(view, data.departments, data.settings), [view, data.departments, data.settings])
  const variance = perms.seesMoney ? hourVariance(view.slice, view.product.route, data.settings) : null
  const waitDept = view.schedule?.waitDepartmentId ? data.departments.find((x) => x.id === view.schedule!.waitDepartmentId)?.name : null
  const currentName = view.current >= 0 ? departmentNameOf(data.departments, view, view.current) : undefined

  return (
    <>
      {view.rush && (
        <MfgNote tone="warn" icon={Zap} title={t("mfg3_dr_rush", { by: view.slice.rush!.by, reason: view.slice.rush!.reason })}>
          {t("mfg3_dr_rush_note")}
        </MfgNote>
      )}
      {view.order.riskReason && (
        <MfgNote tone="bad" icon={AlertTriangle} title={t("mfg3_dr_risk_released", { by: view.order.releasedByName || "" })}>
          {view.order.riskReason}
        </MfgNote>
      )}
      {view.releaseBlocks.map((b) => {
        const x = blockTexts(t, b)
        return <MfgNote key={b.key} tone="bad" title={x.title}>{x.fix}</MfgNote>
      })}
      {view.currentBlocks.map((b) => {
        const x = blockTexts(t, b, currentName)
        return <MfgNote key={b.key} tone={b.severity === "hard" ? "bad" : "warn"} title={x.title}>{x.fix}</MfgNote>
      })}
      {view.live && view.late && (
        <MfgNote tone="bad" icon={Clock} title={view.overdue ? t("mfg3_dr_overdue", { days: view.lateDays }) : t("mfg3_dr_will_miss", { date: d.short(view.possibleDate), days: view.lateDays })}>
          {waitDept ? t("mfg3_dr_late_reason_queue", { dept: waitDept, days: view.schedule?.waitDays ?? 0 }) : t("mfg3_dr_late_reason_volume")}
        </MfgNote>
      )}
      {variance && view.live && (
        <MfgNote tone="warn" icon={Hourglass} title={t("mfg3_dr_variance", { dept: data.departments.find((x) => x.id === variance.departmentId)?.name || "", percent: variance.percent })}>
          {t("mfg3_dr_variance_note")}
        </MfgNote>
      )}
      {view.broken > 0 && <MfgNote tone="bad" title={t("mfg3_dr_breakage", { qty: fmtQty(view.broken), unit: view.unit })}>{t("mfg3_dr_breakage_note")}</MfgNote>}

      <div className="grid grid-cols-2 gap-2.5">
        <MfgStat label={t("mfg3_dr_stat_delivered")} value={<span dir="ltr">{fmtQty(view.delivered)}</span>} sub={t("mfg3_qty_of", { total: fmtQty(view.quantity), unit: view.unit })} />
        <MfgStat
          label={t("mfg3_dr_stat_wip")}
          value={<span dir="ltr">{fmtQty(view.wip)}</span>}
          sub={view.ready ? t("mfg3_qty_bit_ready", { qty: fmtQty(view.ready) }) : view.shipped ? t("mfg3_qty_bit_transit", { qty: fmtQty(view.shipped) }) : undefined}
        />
        <MfgStat label={t("mfg3_dr_stat_needed")} value={<MfgDueCell view={view} departments={data.departments} compact />} sub={<DueSub view={view} />} />
        {perms.seesMoney ? (
          <MfgStat
            label={t("mfg3_dr_stat_cost")}
            value={<span dir="ltr">{fmtMoney(money.total)} ﷼</span>}
            sub={money.value != null ? t(money.valueKind === "sale" ? "mfg3_dr_value_sale" : "mfg3_dr_value_estimate", { value: fmtMoney(money.value) }) : undefined}
          />
        ) : (
          <MfgStat label={t("mfg3_dr_stat_hours")} value={<span dir="ltr">{fmtQty(view.hours)}</span>} sub={t("mfg3_dr_stat_hours_sub")} />
        )}
      </div>

      {view.released ? (
        <MfgSection icon={Route} title={t("mfg3_dr_route")}>
          <div className="px-3.5 py-3">
            <MfgRouteStrip view={view} departments={data.departments} />
          </div>
          <div className="border-t border-border/60 px-3.5 py-2.5">
            <MfgQtyLegend />
            <p className="mt-1 text-[10px] text-muted-foreground">{t("mfg3_dr_route_note")}</p>
          </div>
        </MfgSection>
      ) : (
        <MfgNote tone="info">{t("mfg3_dr_not_released")}</MfgNote>
      )}

      <MaterialsSection view={view} />

      {perms.seesMoney && (
        <MfgSection icon={Coins} title={t("mfg3_dr_cost")}>
          <div className="space-y-1.5 px-3.5 py-3 text-xs">
            <CostLine label={t("mfg3_dr_cost_materials")} value={money.materials} />
            {data.settings.features.time ? (
              <>
                <CostLine label={t("mfg3_dr_cost_labour", { hours: fmtQty(view.hours) })} value={money.labour} />
                <CostLine label={t("mfg3_dr_cost_overhead", { rate: fmtMoney(data.settings.overheadRatePerHour) })} value={money.overhead} />
              </>
            ) : (
              <p className="text-muted-foreground">{t("mfg3_dr_cost_time_off")}</p>
            )}
            <CostLine label={t("mfg3_dr_cost_so_far")} value={money.total} strong />
            <CostLine label={t("mfg3_dr_cost_standard")} value={money.standard} />
            {money.value != null && (
              <>
                <CostLine label={t(money.valueKind === "sale" ? "mfg3_dr_cost_sale" : "mfg3_dr_cost_estimate")} value={money.value} />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t(money.valueKind === "sale" ? "mfg3_dr_cost_margin" : "mfg3_dr_cost_vs_estimate")}</span>
                  <span className={cn("font-bold tabular-nums", (money.difference ?? 0) >= 0 ? "text-success" : "text-destructive")} dir="ltr">
                    {fmtMoney(money.difference)} ﷼{money.marginPercent != null ? ` (${money.marginPercent}%)` : ""}
                  </span>
                </div>
              </>
            )}
          </div>
          {!money.materialsAllPriced && <MfgNote tone="warn" className="mx-3.5 mb-3">{t("mfg3_dr_cost_unpriced")}</MfgNote>}
          <p className="border-t border-border/60 px-3.5 py-2 text-[10px] text-muted-foreground">{t("mfg3_dr_cost_note")}</p>
        </MfgSection>
      )}

      {view.slice.scrap.length > 0 && (
        <MfgSection icon={Trash2} title={t("mfg3_dr_scrap")}>
          {view.slice.scrap.map((s) => (
            <MfgRow
              key={s.id}
              right={
                <>
                  {perms.seesMoney && <b className="tabular-nums" dir="ltr">{fmtMoney(s.value)} ﷼</b>}
                  {s.status === "approved" ? (
                    <MfgPill tone="bad">{t("mfg3_dr_scrap_approved", { by: s.approvedByName || "" })}</MfgPill>
                  ) : perms.canCost || (perms.canManage && s.value <= data.settings.scrapApprovalLimit) ? (
                    <Button size="sm" variant="destructive" className="h-7 text-[11px]" onClick={() => ui.openAction(view.id, { kind: "approveScrap", scrapId: s.id })}>
                      {t("mfg3_dr_scrap_approve")}
                    </Button>
                  ) : (
                    <MfgPill tone="warn">{t("mfg3_dr_scrap_pending")}</MfgPill>
                  )}
                </>
              }
            >
              <span className="block font-semibold">{t("mfg3_dr_scrap_line", { qty: fmtQty(s.quantity), unit: view.unit, reason: s.reason })}</span>
              <span className="block text-[10px] text-muted-foreground">{s.raisedByName} · {d.short(s.raisedAt)}</span>
            </MfgRow>
          ))}
        </MfgSection>
      )}

      <ChecklistsSection view={view} />
      <NotesSection view={view} />
      <TrailSection view={view} />
      {perms.seesMoney && <FinanceSection view={view} />}
      <LogSection view={view} />
    </>
  )
}

function DueSub({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const d = useMfgDate()
  if (view.done) return <>{t("mfg3_dr_done")}</>
  if (view.possibleDate) {
    return (
      <>
        {t("mfg3_due_possible", { date: d.short(view.possibleDate) })}
        {view.schedule?.condition ? ` (${t(`mfg3_cond_${view.schedule.condition}`)})` : ""}
      </>
    )
  }
  if (!view.released && view.releaseBlocks.some((b) => b.key === "quote")) return <>{t("mfg3_due_no_date_quote")}</>
  return <>{d.relative(view.neededBy)}</>
}

function CostLine({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between", strong && "border-t border-border/60 pt-1.5 font-black")}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums font-semibold" dir="ltr">{fmtMoney(value)} ﷼</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

const MAT_TONE: Record<string, MfgTone> = { none: "muted", missing: "warn", requested: "info", released: "accent", partial: "warn", complete: "ok" }

function MaterialsSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { toast } = useToast()
  const ui = useMfgUi()
  const { data, perms } = ui
  const route = view.product.route
  const consuming = Array.from(new Set((view.product.bom || []).map((b) => b.departmentId)))
  const stock = useOrgStock(data.warehouses, consuming.length > 0)
  const [busy, setBusy] = useState<string | null>(null)
  if (!consuming.length) return null

  const act = async (key: string, fn: () => Promise<unknown>, success: string) => {
    if (!firestore || busy) return
    setBusy(key)
    try {
      await fn()
      toast({ title: success })
    } catch (err) {
      console.error(err)
      const msg = (err as Error).message
      toast({ title: t(msg === "insufficient_stock" ? "mfg2_err_insufficient_stock" : "mfg_save_error"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <MfgSection icon={Boxes} title={t("mfg3_dr_materials")} right={<MfgChip tone="accent">{t("mfg3_dr_materials_from_inventory")}</MfgChip>}>
      {consuming.map((deptId) => {
        const index = route.findIndex((r) => r.departmentId === deptId)
        const state = index >= 0 ? materialState(view.slice, view.product, route, index) : "none"
        const need = materialNeed(view.slice, view.product, deptId)
        const rows = view.slice.materials.filter((m) => m.departmentId === deptId)
        const requested = Array.from(new Set(rows.filter((m) => m.state === "requested").map((m) => m.requestNumber)))
        const released = Array.from(new Set(rows.filter((m) => m.state === "released").map((m) => m.requestNumber)))
        const shortLines: string[] = []
        return (
          <div key={deptId} className="border-b border-border/60 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2 bg-muted/30 px-3.5 py-2 text-xs">
              <b>{index >= 0 ? departmentNameOf(data.departments, view, index) : deptId}</b>
              <MfgPill tone={MAT_TONE[state]}>{t(`mfg3_mat_state_${state}`)}</MfgPill>
              <span className="ms-auto flex flex-wrap gap-1.5">
                {(state === "missing" || state === "partial") && perms.canWork && view.released && view.live && (
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => ui.openAction(view.id, { kind: "materials", departmentId: deptId })}>
                    <Boxes size={12} /> {t("mfg3_dr_request_materials")}
                  </Button>
                )}
                {requested.map((rn) => {
                  const warehouseId = rows.find((m) => m.requestNumber === rn)?.warehouseId || null
                  const can = (perms.canManage || perms.canReceive) && !!warehouseId
                  return can ? (
                    <Button
                      key={rn}
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-[11px]"
                      disabled={!!busy || stock.loading}
                      onClick={() =>
                        void act(
                          `rel_${rn}`,
                          () =>
                            releaseStageMaterials(firestore!, {
                              order: view.order,
                              requestNumber: rn,
                              warehouseId: warehouseId!,
                              stockRows: stock.byWarehouse.get(warehouseId!) || [],
                              actor: data.actor,
                            }),
                          t("mfg3_dr_mat_released_toast", { request: rn })
                        )
                      }
                    >
                      {busy === `rel_${rn}` ? <Loader2 size={12} className="animate-spin" /> : <PackageCheck size={12} />}
                      {t("mfg3_dr_mat_release", { request: rn })}
                    </Button>
                  ) : (
                    <MfgChip key={rn} tone="info">{t("mfg3_dr_mat_at_store", { request: rn })}</MfgChip>
                  )
                })}
                {released.map((rn) =>
                  perms.canWork ? (
                    <Button
                      key={rn}
                      size="sm"
                      className="h-7 gap-1 text-[11px]"
                      disabled={!!busy}
                      onClick={() =>
                        void act(
                          `conf_${rn}`,
                          () => confirmStageMaterials(firestore!, { order: view.order, requestNumber: rn, actor: data.actor, organizationId: data.orgId }),
                          t("mfg3_dr_mat_confirmed_toast", { request: rn })
                        )
                      }
                    >
                      {busy === `conf_${rn}` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      {t("mfg3_dr_mat_confirm", { request: rn })}
                    </Button>
                  ) : (
                    <MfgChip key={rn} tone="accent">{t("mfg3_dr_mat_released_chip", { request: rn })}</MfgChip>
                  )
                )}
              </span>
            </div>
            {need.map((n) => {
              const got = materialReceived(view.slice, deptId, n.itemName)
              const open = materialOpen(view.slice, deptId, n.itemName)
              const avail = stock.byName.get(stockKey(n.itemName)) ?? 0
              const missing = round2(n.qty - got)
              const short = !stock.loading && missing > 0 && open <= 0 && avail < missing
              if (short) shortLines.push(t("mfg3_mat_short_line", { item: n.itemName, qty: fmtQty(round2(missing - avail)), unit: n.unit }))
              return (
                <div key={n.itemName} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-dashed border-border/60 px-3.5 py-2 text-xs">
                  <span className="min-w-0">
                    <b className="block truncate font-semibold">{n.itemName}</b>
                    <span className="block text-[10px] text-muted-foreground">
                      {n.withWaste ? t("mfg3_mat_waste", { net: fmtQty(n.net), waste: view.product.wastePercent }) : t("mfg3_dr_mat_per_bom")}
                      {n.lotted && view.slice.slabApproval?.lot ? ` · ${t("mfg3_mat_lot", { lot: view.slice.slabApproval.lot })}` : ""}
                    </span>
                  </span>
                  <span className="text-end font-bold tabular-nums" dir="ltr">
                    {fmtQty(got)} / {fmtQty(n.qty)} <span className="text-[10px] font-semibold text-muted-foreground">{n.unit}</span>
                    {open > 0 && <span className="block text-[10px] font-semibold text-cta">{t("mfg3_dr_mat_incoming", { qty: fmtQty(open) })}</span>}
                  </span>
                  <span className="min-w-[80px] text-end">
                    {got >= n.qty ? (
                      <MfgChip tone="ok">{t("mfg3_dr_mat_complete")}</MfgChip>
                    ) : stock.loading ? (
                      <Loader2 size={12} className="ms-auto animate-spin text-muted-foreground" />
                    ) : avail >= missing ? (
                      <MfgChip tone="info">{t("mfg3_dr_mat_available", { qty: fmtQty(avail) })}</MfgChip>
                    ) : (
                      <MfgChip tone="bad">{t("mfg3_dr_mat_short", { qty: fmtQty(round2(missing - avail)) })}</MfgChip>
                    )}
                  </span>
                </div>
              )
            })}
            {shortLines.length > 0 && (
              <MfgNote tone="bad" className="mx-3.5 my-2" title={t("mfg3_mat_short_title")}>
                {shortLines.join(" · ")} — {t("mfg3_mat_short_action")}
              </MfgNote>
            )}
          </div>
        )
      })}
      {perms.seesMoney && (
        <div className="flex items-center justify-between border-t border-border/60 px-3.5 py-2 text-xs">
          <span className="text-muted-foreground">{t("mfg3_dr_mat_value")}</span>
          <b className="tabular-nums" dir="ltr">{fmtMoney(orderMoney(view, data.departments, data.settings).materials)} ﷼</b>
        </div>
      )}
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// Checklists
// ---------------------------------------------------------------------------

function ChecklistsSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const d = useMfgDate()
  const ui = useMfgUi()
  const { data, perms } = ui
  const [busy, setBusy] = useState<string | null>(null)
  if (!data.settings.features.checklists) return null
  const route = view.product.route
  const steps = route
    .map((r, i) => ({ r, i, dept: data.departments.find((x) => x.id === r.departmentId) }))
    .filter(({ i }) => (view.slice.progress[i]?.done || 0) > 0 || pendingAt(view.slice, route, i, view.noteSlices) > 0)
    .filter(({ dept }) => (dept?.checklist || []).length > 0)
  if (!steps.length) return null
  const total = steps.reduce((a, s) => a + (s.dept?.checklist || []).length, 0)
  const marked = steps.reduce((a, s) => a + (s.dept?.checklist || []).filter((c) => view.slice.checklists?.[s.r.departmentId]?.[c.key]).length, 0)

  const toggle = async (departmentId: string, key: string) => {
    if (!firestore || busy) return
    setBusy(`${departmentId}_${key}`)
    try {
      await toggleChecklistItem(firestore, { order: view.order, departmentId, itemKey: key, actor: data.actor })
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <MfgSection collapsible defaultOpen={view.live} icon={ClipboardCheck} title={t("mfg3_dr_checklists")} right={<span className={marked === total ? "text-success" : "text-warning"}>{t("mfg3_count_of", { done: marked, total })}</span>}>
      {steps.map(({ r, i, dept }) => {
        const list = dept?.checklist || []
        const marks = view.slice.checklists?.[r.departmentId] || {}
        const count = list.filter((c) => marks[c.key]).length
        return (
          <div key={`${r.departmentId}_${i}`}>
            <div className="flex items-center justify-between bg-muted/30 px-3.5 py-1.5 text-[11px] font-bold">
              {departmentNameOf(data.departments, view, i)}
              <MfgChip tone={count === list.length ? "ok" : "warn"}>{t("mfg3_count_of", { done: count, total: list.length })}</MfgChip>
            </div>
            {list.map((c) => {
              const m = marks[c.key]
              return (
                <MfgRow
                  key={c.key}
                  onClick={perms.canWork ? () => void toggle(r.departmentId, c.key) : undefined}
                  right={<span className="text-[10px] text-muted-foreground">{m ? `${m.by} · ${d.relative(m.at)}` : t("mfg3_not_logged")}</span>}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", m ? "border-success bg-success text-white" : "border-slate-300")}>
                      {busy === `${r.departmentId}_${c.key}` ? <Loader2 size={10} className="animate-spin text-muted-foreground" /> : m ? <Check size={11} /> : null}
                    </span>
                    <span className="font-semibold">{c.label}</span>
                  </span>
                </MfgRow>
              )
            })}
          </div>
        )
      })}
      <p className="border-t border-border/60 px-3.5 py-2 text-[10px] text-muted-foreground">{t("mfg3_dr_checklists_note")}</p>
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// Delivery notes
// ---------------------------------------------------------------------------

function NotesSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const d = useMfgDate()
  const ui = useMfgUi()
  const { perms } = ui
  if (!view.notes.length && !view.ready) return null
  const sorted = [...view.notes].sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1))
  return (
    <MfgSection icon={Truck} title={t("mfg3_dr_notes")} right={<span className="text-[10px] text-muted-foreground">{t("mfg3_dr_notes_sub")}</span>}>
      {sorted.map((n) => {
        const broken = n.brokenQuantity || 0
        const tone: MfgTone = n.status === "received" ? (broken ? "bad" : "ok") : n.status === "rejected" ? "muted" : "info"
        return (
          <MfgRow
            key={n.id}
            right={
              <>
                <MfgPill tone={tone}>{t(n.status === "received" ? (broken ? "mfg3_note_state_issue" : "mfg3_note_state_received") : n.status === "rejected" ? "mfg3_note_state_rejected" : "mfg3_note_state_transit")}</MfgPill>
                {n.status === "in_transit" && (perms.canReceive || perms.canManage) && (
                  <Button size="sm" className="h-7 text-[11px]" onClick={() => ui.openAction(view.id, { kind: "confirmNote", noteId: n.id })}>
                    {t("mfg3_dr_confirm_receipt")}
                  </Button>
                )}
              </>
            }
          >
            <span className="block font-semibold">{t("mfg3_dr_note_line", { note: n.noteNumber, qty: fmtQty(n.item.quantity), unit: n.item.unit, dest: n.toWarehouseName })}</span>
            <span className="block text-[10px] text-muted-foreground">
              {[
                n.pieces ? t("mfg3_recv_pieces", { count: n.pieces }) : null,
                n.crates ? t("mfg3_recv_crates", { count: n.crates }) : null,
                n.driverName,
                n.vehiclePlate,
                t("mfg3_dr_note_out", { date: d.short(n.sentAt) }),
                n.receivedByUserName ? t("mfg3_dr_note_received_by", { name: n.receivedByUserName, date: d.short(n.receivedAt) }) : null,
                broken ? t("mfg3_dr_note_broken", { qty: fmtQty(broken) }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </MfgRow>
        )
      })}
      {view.ready > 0 && (
        <MfgRow
          className="bg-muted/30"
          right={
            perms.canManage ? (
              <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={() => ui.openAction(view.id, { kind: "note" })}>
                <Truck size={12} /> {t("mfg3_dr_issue_note")}
              </Button>
            ) : null
          }
        >
          <span className="block font-semibold">{t("mfg3_dr_ready_no_note", { qty: fmtQty(view.ready), unit: view.unit })}</span>
          <span className="block text-[10px] text-muted-foreground">{t("mfg3_dr_ready_no_note_sub")}</span>
        </MfgRow>
      )}
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// Document trail, Finance, history
// ---------------------------------------------------------------------------

const MODULE_TONE: Record<string, MfgTone> = { projects: "info", sales: "warn", manufacturing: "mfg", inventory: "accent", finance: "ok" }

function TrailSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const items = documentTrail(view)
  return (
    <MfgSection icon={FileText} title={t("mfg3_dr_trail")} collapsible defaultOpen={false}>
      {items.map((it, i) => (
        <MfgRow
          key={`${it.kind}_${i}`}
          right={
            <>
              <MfgChip tone={MODULE_TONE[it.module]}>{t(`mfg3_module_${it.module}`)}</MfgChip>
              <MfgPill tone={it.tone === "ok" ? "ok" : it.tone === "warn" ? "warn" : "muted"}>{t(`mfg3_trail_tone_${it.tone}`)}</MfgPill>
            </>
          }
        >
          <span className="block font-semibold">{it.ref ? `${t(`mfg3_trail_${it.kind}`)} · ${it.ref}` : t(`mfg3_trail_${it.kind}`)}</span>
          {(it.who || it.quantity != null) && (
            <span className="block text-[10px] text-muted-foreground">
              {[it.who, it.quantity != null ? `${fmtQty(it.quantity)} ${view.unit}` : null].filter(Boolean).join(" · ")}
            </span>
          )}
        </MfgRow>
      ))}
    </MfgSection>
  )
}

function FinanceSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const events = financeEvents(view, data.departments, data.settings)
  if (!events.length) return null
  return (
    <MfgSection icon={Landmark} title={t("mfg3_dr_finance")} collapsible defaultOpen={false} right={<span className="text-[10px] text-muted-foreground">{t("mfg3_dr_finance_sub")}</span>}>
      {events.map((e, i) => (
        <MfgRow
          key={`${e.kind}_${i}`}
          right={
            <>
              {e.value > 0 && <b className="tabular-nums" dir="ltr">{fmtMoney(e.value)} ﷼</b>}
              <MfgChip tone={e.posted ? "ok" : "warn"}>{t(e.posted ? "mfg3_fin_posted" : "mfg3_fin_not_posted")}</MfgChip>
            </>
          }
        >
          <span className="block font-semibold">
            {t(`mfg3_fin_${e.kind}`, { qty: fmtQty(e.quantity ?? 0), unit: view.unit, ref: e.ref || "", reason: e.reason || "" })}
          </span>
          <span className="block text-[10px] text-muted-foreground">{t(`mfg3_fin_${e.kind}_entry`)}</span>
        </MfgRow>
      ))}
      <p className="border-t border-border/60 px-3.5 py-2 text-[10px] text-muted-foreground">{t("mfg3_dr_finance_note")}</p>
    </MfgSection>
  )
}

const LOG_ICON: Record<string, ElementType> = {
  created: FileText,
  measured: Ruler,
  drawing_approved: PencilRuler,
  slab_approved: Eye,
  released: Play,
  rushed: Zap,
  materials_requested: Boxes,
  materials_released: PackageCheck,
  materials_received: CheckCircle2,
  scrap_raised: Trash2,
  scrap_approved: Trash2,
  note_shipped: Truck,
  note_received: CheckCircle2,
  note_rejected: AlertTriangle,
}

function LogSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const d = useMfgDate()
  const items = orderLog(view)
  if (!items.length) return null
  return (
    <MfgSection icon={BookOpen} title={t("mfg3_dr_log")} collapsible defaultOpen={false}>
      <ol className="space-y-3 px-3.5 py-3">
        {items.map((it, i) => {
          const Icon = LOG_ICON[it.kind] || Clock
          return (
            <li key={`${it.kind}_${i}`} className="relative flex gap-2.5">
              {i < items.length - 1 && <span className="absolute start-[11px] top-6 h-full w-px bg-border" aria-hidden="true" />}
              <span
                className={cn(
                  "z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full",
                  it.tone === "ok" ? "bg-success/10 text-success" : it.tone === "bad" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                )}
              >
                <Icon size={12} aria-hidden="true" />
              </span>
              <div className="min-w-0 text-xs">
                <p className="font-semibold">
                  {t(`mfg3_log_${it.kind}`, { qty: fmtQty(it.quantity ?? 0), unit: view.unit, ref: it.ref || "", detail: it.detail || "" })}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {[it.by, d.short(it.at), d.relative(it.at)].filter(Boolean).join(" · ")}
                </p>
                {it.detail && ["measured", "released", "rushed", "scrap_raised", "note_rejected"].includes(it.kind) && (
                  <p className="text-[10px] text-slate-600">{it.detail}</p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function DrawerActions({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms } = ui
  const route = view.product.route
  const open = (a: OrderAction) => ui.openAction(view.id, a)
  const buttons: ReactNode[] = []
  const push = (key: string, label: string, icon: ElementType, a: OrderAction, tone: "primary" | "outline" | "destructive" = "outline") => {
    const Icon = icon
    buttons.push(
      <Button key={key} size="sm" variant={tone === "primary" ? "default" : tone} className="h-8 gap-1.5 text-xs" onClick={() => open(a)}>
        <Icon size={13} aria-hidden="true" /> {label}
      </Button>
    )
  }

  if (view.live) {
    if (!view.released) {
      if (view.product.requiresMeasurement && !view.slice.measurement && (perms.canManage || perms.canQc || perms.canCost))
        push("meas", t("mfg3_act_measure"), Ruler, { kind: "measurement" })
      if (!view.releaseBlocks.length && (perms.canManage || perms.canCost)) push("rel", t("mfg3_act_release"), Play, { kind: "release" }, "primary")
      else if (view.releaseBlocks.length && perms.canCost) push("risk", t("mfg3_act_risk_release"), AlertTriangle, { kind: "release" }, "destructive")
    }
    if (view.product.requiresDrawingApproval && view.slice.drawingApprovalStatus !== "approved" && perms.canManage)
      push("draw", t("mfg3_act_drawing"), PencilRuler, { kind: "drawing" })
    if (view.product.requiresSlabApproval && !view.slice.slabApproval && (perms.canQc || perms.canManage))
      push("slab", t("mfg3_act_slab"), Eye, { kind: "slab" }, view.released ? "primary" : "outline")
    if (perms.canWork) {
      for (const i of view.active) {
        const blocked = stationBlocks(view.slice, view.product, route, i).some((b) => b.severity === "hard")
        if (blocked) continue
        const name = departmentNameOf(data.departments, view, i)
        push(`out_${i}`, view.active.length > 1 ? t("mfg3_act_output_at", { dept: name }) : t("mfg3_act_output"), CheckCircle2, { kind: "output", index: i }, "primary")
        const ms = materialState(view.slice, view.product, route, i)
        if (ms === "missing" || ms === "partial") push(`mat_${i}`, t("mfg3_act_materials", { dept: name }), Boxes, { kind: "materials", departmentId: route[i].departmentId })
      }
    }
    if (perms.canQc) {
      view.slice.progress.forEach((p, i) => {
        if (p.rejected > 0) push(`qc_${i}`, t("mfg3_act_qc", { dept: departmentNameOf(data.departments, view, i) }), AlertTriangle, { kind: "qc", index: i })
      })
    }
    if (view.ready > 0 && perms.canManage) push("note", t("mfg3_act_note"), Truck, { kind: "note" }, "primary")
    const inTransit = view.notes.find((n) => n.status === "in_transit")
    if (inTransit && (perms.canReceive || perms.canManage)) push("recv", t("mfg3_act_confirm_note"), PackageCheck, { kind: "confirmNote", noteId: inTransit.id }, "primary")
    if (view.broken > 0 && (perms.canManage || perms.canCost)) push("brk", t("mfg3_act_breakage"), Undo2, { kind: "breakage" }, "destructive")
    if (view.released && !view.rush && (perms.canManage || perms.canCost)) push("rush", t("mfg3_act_rush"), Zap, { kind: "rush" })
  }

  if (!buttons.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock size={13} aria-hidden="true" />
        {view.live ? t("mfg3_act_none") : t("mfg3_act_none_closed")}
      </p>
    )
  }
  return <div className="flex flex-wrap gap-2">{buttons}</div>
}
