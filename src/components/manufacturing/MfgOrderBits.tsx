"use client"

// The pieces that show one work order the same way on every screen: its state
// in words, where it came from, its quantities by unit, its honest date, the
// stage strip, the route, the next step (or who it is waiting on) and why it
// is late. Every screen formats orders through these — Today, the Workshop
// list and board, the order panel and the forms never word an order twice.

import type { ElementType } from "react"
import { useTranslations } from "next-intl"
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Eye,
  FileText,
  FolderKanban,
  Hammer,
  Landmark,
  Lock,
  PackageCheck,
  PencilRuler,
  Play,
  Ruler,
  ShoppingCart,
  Trash2,
  Truck,
  Undo2,
  Warehouse,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { MfgDepartment } from "@/lib/manufacturing"
import {
  STAGES,
  hardBlocked,
  isQcStation,
  remAt,
  type Block,
  type Candidate,
  type ExternalModule,
  type LateReason,
  type Persona,
  type StationMaterialState,
} from "@/lib/manufacturing-engine"
import type { OrderView } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgChip, MfgPill, MfgQtyBar, departmentIcon, fmtMoney, fmtQty, useMfgDate, type MfgTone } from "./ui/MfgUi"

type T = ReturnType<typeof useTranslations>

export function departmentNameOf(departments: Array<Pick<MfgDepartment, "id" | "name">>, v: OrderView, index: number): string {
  const step = v.calc.route[index]
  if (!step) return ""
  return departments.find((d) => d.id === step.departmentId)?.name || step.departmentName
}

export function deptName(departments: Array<Pick<MfgDepartment, "id" | "name">>, id: string | undefined | null, fallback = ""): string {
  return (id && departments.find((d) => d.id === id)?.name) || fallback
}

export const MODULE_ICON: Record<ExternalModule | "manufacturing", ElementType> = {
  finance: Landmark,
  inventory: Warehouse,
  projects: FolderKanban,
  sales: FileText,
  procurement: ShoppingCart,
  manufacturing: Hammer,
}

const MODULE_TONE: Record<ExternalModule | "manufacturing", MfgTone> = {
  finance: "ok",
  inventory: "accent",
  projects: "info",
  sales: "warn",
  procurement: "muted",
  manufacturing: "mfg",
}

/** "في المخزون" / "from Sales" — a module named on a chip. */
export function MfgModuleChip({ module, prefix }: { module: ExternalModule | "manufacturing"; prefix?: "in" | "from" | "none" }) {
  const t = useTranslations("Portal.Shared")
  const Icon = MODULE_ICON[module]
  const name = t(`mfg4_module_${module}`)
  const text = prefix === "in" ? t("mfg4_in_module", { module: name }) : prefix === "from" ? t("mfg4_from_module", { module: name }) : name
  return (
    <MfgChip tone={MODULE_TONE[module]} icon={Icon}>
      {text}
    </MfgChip>
  )
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STAGE_TONE: Record<OrderView["stage"], MfgTone> = {
  pay: "bad",
  wait: "muted",
  prod: "mfg",
  close: "warn",
  ready: "accent",
  transit: "info",
  done: "ok",
  cancel: "muted",
}

/** The one-phrase answer to "where is this order?" — the primary state is the
 * earliest stage holding quantity (ORD-05). */
export function stateOf(v: OrderView, departments: MfgDepartment[], t: T): { label: string; tone: MfgTone } {
  const c = v.calc
  switch (v.stage) {
    case "wait":
      return v.releaseBlocks.some((b) => b.key === "survey") ? { label: t("mfg4_sub_blocked_survey"), tone: "bad" } : { label: t("mfg4_stage_wait"), tone: "muted" }
    case "prod": {
      const i = c.current
      if (i >= 0) {
        const g = c.gates[i]
        if (g === "drawing") return c.drawingState === "wait" ? { label: t("mfg4_sub_drawing_at_approval"), tone: "warn" } : { label: t("mfg4_sub_in_design"), tone: "mfg" }
        if (g === "slab") return { label: t("mfg4_sub_awaiting_slab"), tone: "warn" }
        const dept = departmentNameOf(departments, v, i)
        if (g === "manual") return { label: t("mfg4_sub_at_step", { dept }), tone: "mfg" }
        return { label: t("mfg4_sub_at_station", { dept, qty: fmtQty(c.pend[i]), unit: v.unit }), tone: hardBlocked(c, i) ? "bad" : "mfg" }
      }
      if (c.rejected > 0) return { label: t("mfg4_sub_awaiting_qc"), tone: "warn" }
      if (c.scrapPending > 0 || c.scrapReturned > 0) return { label: t("mfg4_sub_scrap_pending"), tone: "bad" }
      return { label: t("mfg4_sub_scrap_decision"), tone: "bad" }
    }
    case "transit": {
      const n = v.notes.find((x) => x.status === "in_transit")
      return n ? { label: t("mfg4_sub_on_note", { note: n.noteNumber }), tone: "info" } : { label: t("mfg4_sub_breakage"), tone: "bad" }
    }
    default:
      return { label: t(`mfg4_stage_${v.stage}`), tone: STAGE_TONE[v.stage] }
  }
}

export function MfgStatePill({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const s = stateOf(view, data.departments, t)
  return (
    <MfgPill tone={s.tone} dot>
      {s.label}
    </MfgPill>
  )
}

/** Secondary facts beside the state: blocked · short · re-make · elsewhere… */
export function stateBits(v: OrderView, t: T): string[] {
  if (!v.released) return []
  const c = v.calc
  const bits: string[] = []
  if (v.stage === "prod" && c.current >= 0) {
    const hard = v.currentBlocks.find((b) => b.severity === "hard")
    if (hard && (hard.key === "drawing" || hard.key === "slab")) bits.push(t("mfg4_bit_blocked", { what: t(`mfg4_what_${hard.key}`) }))
  }
  if (v.shortages.length) bits.push(t("mfg4_bit_short"))
  const rw = c.slice.progress[c.firstQ]?.rework || 0
  if (rw > 0 && c.pend[c.firstQ] > 0) bits.push(t("mfg4_bit_remake", { qty: fmtQty(Math.min(rw, c.pend[c.firstQ])) }))
  if (c.wip > 0 && v.stage !== "prod") bits.push(t("mfg4_bit_in_production", { qty: fmtQty(c.wip) }))
  if (c.active.length > 1) bits.push(t("mfg4_bit_departments", { count: c.active.length }))
  if (c.toClose > 0 && v.stage !== "close") bits.push(t("mfg4_bit_to_close", { qty: fmtQty(c.toClose) }))
  if (c.ready > 0 && v.stage !== "ready") bits.push(t("mfg4_bit_ready", { qty: fmtQty(c.ready) }))
  if (c.shipped > 0 && v.stage !== "transit") bits.push(t("mfg4_bit_transit", { qty: fmtQty(c.shipped) }))
  if (c.scrapAll > 0) bits.push(t("mfg4_bit_scrap", { qty: fmtQty(c.scrapAll) }))
  if (v.notices.length) bits.push(t("mfg4_bit_notice"))
  return bits
}

export function MfgSourceChip({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  if (view.source === "project") return <MfgChip tone="info" icon={FolderKanban}>{view.order.pmRequestRef || view.order.purchaseRequestRef || t("mfg4_source_project")}</MfgChip>
  if (view.source === "client") return <MfgChip tone="warn" icon={FileText}>{view.salesOrderNumber != null ? `SO-${view.salesOrderNumber}` : t("mfg4_source_client")}</MfgChip>
  return <MfgChip tone="muted" icon={Warehouse}>{t("mfg4_source_stock")}</MfgChip>
}

export function sourceNameOf(view: OrderView, t: (k: string) => string): string {
  return view.sourceName || (view.source === "stock" ? t("mfg4_source_stock_name") : "—")
}

export function MfgRushChip({ reason }: { reason?: string | null }) {
  const t = useTranslations("Portal.Shared")
  return (
    <MfgChip tone="warn" icon={Zap}>
      {reason ? t("mfg4_rush_reason", { reason }) : t("mfg4_rush")}
    </MfgChip>
  )
}

// ---------------------------------------------------------------------------
// Quantities and dates
// ---------------------------------------------------------------------------

/** "Delivered 6 of 10 m²", the bar, and where the rest is. */
export function MfgQtyCell({ view, compact }: { view: OrderView; compact?: boolean }) {
  const t = useTranslations("Portal.Shared")
  const c = view.calc
  return (
    <div className="flex min-w-[140px] flex-col gap-1">
      <span className="text-xs font-bold text-foreground">
        <span dir="ltr" className="tabular-nums">{fmtQty(c.delivered)}</span>{" "}
        <span className="text-[11px] font-semibold text-muted-foreground">{t("mfg4_of_target", { target: fmtQty(c.target), unit: view.unit })}</span>
      </span>
      <MfgQtyBar
        total={view.quantity}
        label={t("mfg3_qty_bar_label")}
        segments={[
          { key: "delivered", value: c.delivered },
          { key: "transit", value: c.shipped },
          { key: "ready", value: c.ready + c.toClose },
          { key: "wip", value: c.wip },
          { key: "held", value: c.rejected },
          { key: "scrap", value: c.scrapAll },
        ]}
      />
      {!compact && c.slice.shortfall > 0 && <span className="text-[10px] font-semibold text-destructive">{t("mfg4_short_declared", { qty: fmtQty(c.slice.shortfall) })}</span>}
    </div>
  )
}

/** Required date, what capacity honestly allows, and the condition it assumes. */
export function dueText(v: OrderView, d: ReturnType<typeof useMfgDate>, t: T): string {
  if (v.done) {
    const last = v.notes.filter((n) => n.receivedAt).map((n) => n.receivedAt!).sort().pop()
    return t("mfg4_date_delivered", { date: d.short(last || v.neededBy) })
  }
  if (v.cancelled) return "—"
  if (v.overdue) return t("mfg4_date_past_due", { days: v.lateDays })
  const s = v.schedule
  if (s?.condition === "materials") return t("mfg4_date_after_materials")
  if (!v.possibleDate) return d.relative(v.neededBy)
  const date = d.short(v.possibleDate)
  if (s?.condition === "pay") return t("mfg4_date_cond_pay", { date })
  if (s?.condition === "release") return t(v.product.requiresMeasurement && !v.calc.slice.survey ? "mfg4_date_cond_release_survey" : "mfg4_date_cond_release", { date })
  if (s?.condition === "drawing") return t("mfg4_date_cond_drawing", { date })
  if (s?.condition === "slab") return t("mfg4_date_cond_slab", { date })
  if (v.atRisk) return t("mfg4_date_at_risk", { date, days: v.lateDays })
  return t("mfg4_date_possible", { date })
}

export function MfgDueCell({ view, compact }: { view: OrderView; compact?: boolean }) {
  const t = useTranslations("Portal.Shared")
  const d = useMfgDate()
  const tone = view.late ? "text-destructive" : view.neededBy && d.dayDiff(view.neededBy) <= 2 && view.live ? "text-warning" : "text-success"
  return (
    <div className="flex min-w-[120px] flex-col gap-0.5">
      <span className={cn("flex items-center gap-1 text-xs font-bold", view.done || view.cancelled ? "text-muted-foreground" : tone)}>
        {view.late ? <AlertTriangle size={12} aria-hidden="true" /> : <CalendarDays size={12} aria-hidden="true" />}
        {d.short(view.neededBy)}
      </span>
      {!compact && <span className="text-[10px] text-muted-foreground">{dueText(view, d, t)}</span>}
    </div>
  )
}

/** Payment · Release · Production · Close · Delivery · Receipt · Closed. */
export function MfgStageStrip({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const seq = STAGES.filter((s) => s !== "pay" || view.source === "client")
  const k = view.stage === "cancel" ? -1 : seq.indexOf(view.stage)
  return (
    <ol className="flex overflow-x-auto rounded-xl border bg-white p-1 text-[11px] font-semibold" aria-label={t("mfg4_stage_prod")}>
      {seq.map((s, i) => {
        const done = view.stage === "done" || i < k
        const now = i === k && view.stage !== "done"
        return (
          <li
            key={s}
            aria-current={now ? "step" : undefined}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5",
              done ? "text-success" : now ? "bg-warning/10 text-warning" : "text-muted-foreground"
            )}
          >
            {done && <Check size={11} aria-hidden="true" />}
            {t(`mfg4_strip_${s}`)}
          </li>
        )
      })}
    </ol>
  )
}

/** Each station with what it finished and what it holds (PRD: route open). */
export function MfgRouteStrip({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const c = view.calc
  return (
    <div className="flex overflow-x-auto" role="list">
      {c.route.map((step, i) => {
        const dept = data.departments.find((d) => d.id === step.departmentId)
        const Icon = departmentIcon(dept?.name || step.departmentName)
        const inHand = c.pend[i]
        const done = c.done[i]
        const rejected = c.slice.progress[i]?.rejected || 0
        const blocked = inHand > 0 && hardBlocked(c, i)
        const complete = c.released && inHand === 0 && done > 0 && remAt(c, i) === 0
        const gate = !!c.gates[i]
        const cls = complete
          ? "border-success/30 bg-success/5 text-success"
          : blocked
            ? "border-destructive/30 bg-destructive/5 text-destructive"
            : inHand > 0
              ? "border-warning/30 bg-warning/5 text-warning"
              : "border-border bg-white text-muted-foreground"
        return (
          <div key={`${step.departmentId}_${i}`} role="listitem" className={cn("relative min-w-[118px] flex-1 border px-3 py-2 text-start first:rounded-s-xl last:rounded-e-xl [&+&]:border-s-0", cls)}>
            <span className="flex items-center gap-1 text-[10px] font-bold">
              <Icon size={12} aria-hidden="true" /> {i + 1}
            </span>
            <span className="mt-0.5 block text-[11px] font-bold leading-snug">{dept?.name || step.departmentName}</span>
            <span className="mt-0.5 block text-[10px] font-semibold text-muted-foreground">
              {gate
                ? t(done > 0 ? "mfg4_step_closed" : inHand > 0 ? "mfg4_step_open" : "mfg4_step_not_started")
                : [done > 0 ? t("mfg3_step_done", { qty: fmtQty(done) }) : t("mfg3_step_idle"), inHand > 0 ? t("mfg3_step_in_hand", { qty: fmtQty(inHand) }) : null, rejected > 0 ? t("mfg3_step_rejected", { qty: fmtQty(rejected) }) : null]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
            {blocked && (
              <span className="absolute end-0 top-0 inline-flex items-center gap-0.5 rounded-es-lg bg-destructive/10 px-1.5 py-px text-[9px] font-bold text-destructive">
                <Lock size={9} aria-hidden="true" /> {t("mfg3_blocked")}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The next step — words, icon and the button (ORD-04)
// ---------------------------------------------------------------------------

export const CANDIDATE_ICON: Record<Candidate["key"], ElementType> = {
  qc_decision: AlertTriangle,
  scrap_review: Trash2,
  scrap_clarify: FileText,
  remake_scrap: Undo2,
  remake_breakage: Undo2,
  apply_change: ArrowRightLeft,
  down_payment: Landmark,
  survey: Ruler,
  release: Play,
  shortage: ShoppingCart,
  purchase_wait: ShoppingCart,
  arrived_wait: PackageCheck,
  submit_drawing: PencilRuler,
  drawing_wait: PencilRuler,
  slab: Eye,
  gate: CheckCircle2,
  issue_wait: Warehouse,
  confirm_receipt: PackageCheck,
  request_materials: Boxes,
  output: CheckCircle2,
  qc_release: ClipboardCheck,
  close: CheckCircle2,
  deliver: Truck,
  receipt_wait: Truck,
  remnant_wait: Warehouse,
}

/** The sentence a candidate stands for — the same in Today, the list and the panel. */
export function candidateText(c: Candidate, v: OrderView, departments: MfgDepartment[], t: T, seesMoney: boolean, scrapLimit: number): string {
  const dept = deptName(departments, c.departmentId, c.index != null ? departmentNameOf(departments, v, c.index) : "")
  const qty = fmtQty(c.quantity ?? 0)
  const unit = c.unit || v.unit
  switch (c.key) {
    case "qc_decision":
      return t("mfg4_c_qc_decision", { qty, unit, dept })
    case "scrap_review": {
      const base = seesMoney ? t("mfg4_c_scrap_review", { qty, unit, value: fmtMoney(c.value) }) : t("mfg4_c_scrap_review_plain", { qty, unit })
      return (c.value ?? 0) > scrapLimit ? `${base} — ${t("mfg4_c_scrap_above_limit")}` : base
    }
    case "scrap_clarify":
      return t("mfg4_c_scrap_clarify", { qty, unit })
    case "remake_scrap":
      return c.approvalRunning ? `${t("mfg4_c_remake_scrap", { qty, unit })} (${t("mfg4_c_remake_running")})` : t("mfg4_c_remake_scrap", { qty, unit })
    case "remake_breakage":
      return t("mfg4_c_remake_breakage", { qty, unit })
    case "apply_change":
      return c.changeKind === "cancel" ? t("mfg4_c_apply_change_cancel") : t("mfg4_c_apply_change_quantity", { qty: fmtQty(c.newQuantity ?? 0) })
    case "down_payment":
      return c.pctPercent ? t("mfg4_c_down_payment_pct", { pct: c.pctPercent }) : t("mfg4_c_down_payment")
    case "survey":
      return t("mfg4_c_survey")
    case "release":
      return t("mfg4_c_release")
    case "shortage":
      return c.declinedReason ? t("mfg4_c_shortage_declined", { qty, unit, item: c.itemName || "", reason: c.declinedReason }) : t("mfg4_c_shortage", { qty, unit, item: c.itemName || "" })
    case "purchase_wait":
      return t("mfg4_c_purchase_wait", { qty, unit, item: c.itemName || "" })
    case "arrived_wait":
      return t("mfg4_c_arrived_wait", { qty, unit, item: c.itemName || "" })
    case "submit_drawing":
      return c.previousC ? t("mfg4_c_submit_drawing_c", { notes: c.previousC }) : t("mfg4_c_submit_drawing")
    case "drawing_wait":
      return t("mfg4_c_drawing_wait", { approver: t(`mfg4_approver_${c.approverOrg || "technical_office"}`), days: c.ageDays ?? 0 })
    case "slab":
      return t("mfg4_c_slab")
    case "gate":
      return t("mfg4_c_gate", { dept })
    case "issue_wait":
      return t("mfg4_c_issue_wait", { ref: c.requestNumber || "—", dept })
    case "confirm_receipt":
      return t("mfg4_c_confirm_receipt", { dept })
    case "request_materials":
      return t("mfg4_c_request_materials", { dept, qty, unit: v.unit })
    case "output":
      return t("mfg4_c_output", { dept, qty, unit: v.unit })
    case "qc_release":
      return t("mfg4_c_qc_release", { dept, qty, unit: v.unit })
    case "close":
      return t("mfg4_c_close", { qty, unit: v.unit })
    case "deliver":
      return t("mfg4_c_deliver", { qty, unit: v.unit })
    case "receipt_wait": {
      const base = t(c.destination === "project" ? "mfg4_c_receipt_wait_project" : "mfg4_c_receipt_wait_warehouse", { note: c.noteNumber || "", qty, unit: v.unit })
      return c.escalated ? `${base} · ${t("mfg4_c_receipt_escalated", { hours: 48 })}` : base
    }
    case "remnant_wait":
      return t("mfg4_c_remnant_wait", { qty, unit: c.unit || "m²", item: c.itemName || "" })
  }
}

export function candidateButton(c: Candidate, v: OrderView, t: T): string {
  switch (c.key) {
    case "qc_decision":
      return t("mfg4_b_qc_decision")
    case "scrap_review":
      return t("mfg4_b_scrap_review")
    case "scrap_clarify":
      return t("mfg4_b_scrap_clarify")
    case "remake_scrap":
    case "remake_breakage":
      return t("mfg4_b_remake")
    case "apply_change":
      return t("mfg4_b_apply_change")
    case "survey":
      return t("mfg4_b_survey")
    case "release":
      return t("mfg4_b_release")
    case "shortage":
      return t("mfg4_b_shortage")
    case "submit_drawing":
      return t("mfg4_b_submit_drawing")
    case "slab":
      return t("mfg4_b_slab")
    case "gate":
      return t("mfg4_b_gate")
    case "confirm_receipt":
      return t("mfg4_b_confirm_receipt")
    case "request_materials":
      return v.product.bom.some((b) => b.departmentId === c.departmentId && b.withWaste && !b.custody) ? t("mfg4_b_request_slab") : t("mfg4_b_request_materials")
    case "output":
      return t("mfg4_b_output")
    case "qc_release":
      return t("mfg4_b_qc_release")
    case "close":
      return t("mfg4_b_close")
    case "deliver":
      return t("mfg4_b_deliver")
    default:
      return ""
  }
}

/** The module an external candidate waits on. */
export function candidateModule(c: Candidate): ExternalModule | null {
  return c.owner.kind === "external" ? c.owner.module : null
}

/** Hook: word candidates for this viewer. */
export function useCandidateWords() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  return {
    text: (c: Candidate, v: OrderView) => candidateText(c, v, ui.data.departments, t, ui.seesMoney, ui.data.settings.scrapApprovalLimit),
    button: (c: Candidate, v: OrderView) => candidateButton(c, v, t),
  }
}

/** The list's last cell: my next step as a button, or who it waits on (WS-04, BD-01). */
export function MfgNextCell({ view, size = "sm" }: { view: OrderView; size?: "sm" | "xs" }) {
  const ui = useMfgUi()
  const words = useCandidateWords()
  const mine = ui.nextStepOf(view)
  if (mine) {
    const Icon = CANDIDATE_ICON[mine.key]
    return (
      <Button
        size="sm"
        variant={mine.severity === "r" ? "default" : "outline"}
        className={cn("gap-1.5 whitespace-nowrap", size === "xs" ? "h-7 text-[11px]" : "h-8 text-xs")}
        title={words.text(mine, view)}
        onClick={(e) => {
          e.stopPropagation()
          ui.openCandidate(view.id, mine)
        }}
      >
        <Icon size={13} aria-hidden="true" /> {words.button(mine, view)}
      </Button>
    )
  }
  return <MfgAwaiting view={view} />
}

export function MfgAwaiting({ view, withText }: { view: OrderView; withText?: boolean }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const words = useCandidateWords()
  if (view.done) return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success"><CheckCircle2 size={12} aria-hidden="true" /> {t("mfg4_closed")}</span>
  if (view.cancelled) return <span className="text-[11px] font-semibold text-muted-foreground">{t("mfg4_cancelled")}</span>
  const w = ui.waitingOf(view)
  if (!w) return null
  const mod = candidateModule(w)
  const who = mod ? t(`mfg4_module_${mod}`) : holderLabel(w, ui, t)
  return (
    <span className="inline-flex max-w-[220px] flex-col items-start gap-0.5 text-[11px] text-muted-foreground" title={words.text(w, view)}>
      <span className="inline-flex items-center gap-1 font-semibold">
        <Clock size={12} aria-hidden="true" /> {mod ? t("mfg4_awaiting_module", { module: who }) : t("mfg4_awaiting_person", { name: who })}
      </span>
      {withText && <span className="text-[10px]">{words.text(w, view)}</span>}
    </span>
  )
}

/** Who holds an internal step: the station lead by name, or the role. */
export function holderLabel(c: Candidate, ui: Pick<ReturnType<typeof useMfgUi>, "data">, t: T): string {
  const o = c.owner
  const role = (p: Persona) => t(`mfg4_persona_${p}`)
  switch (o.kind) {
    case "station": {
      const d = ui.data.departments.find((x) => x.id === o.departmentId)
      if (d && isQcStation(d)) return role("qc")
      if (d?.leadUserName) return d.leadUserName
      return role("manager")
    }
    case "qc":
      return role("qc")
    case "scrap":
      return o.value > ui.data.settings.scrapApprovalLimit ? role("cost") : role("manager")
    default:
      return role("manager")
  }
}

// ---------------------------------------------------------------------------
// Late — and why; blocks with their fix
// ---------------------------------------------------------------------------

export function lateReasonText(r: LateReason, v: OrderView, departments: MfgDepartment[], t: T): string {
  switch (r.key) {
    case "shortage":
      return t(r.arrived ? "mfg4_late_shortage_arrived" : r.requested ? "mfg4_late_shortage_requested" : "mfg4_late_shortage_not_requested", { qty: fmtQty(r.quantity), unit: r.unit, item: r.itemName })
    case "drawing":
      return v.calc.drawingState === "draft" ? t("mfg4_late_drawing_draft") : t("mfg4_late_drawing", { days: r.days })
    case "materials":
      return t("mfg4_late_materials", { dept: deptName(departments, r.departmentId), state: t(`mfg4_mat_${r.state}`) })
    case "queue":
      return t("mfg4_late_queue", { dept: deptName(departments, r.departmentId), days: r.days })
    case "at_station":
      return t("mfg4_late_at_station", { dept: deptName(departments, r.departmentId) })
    default:
      return t(`mfg4_late_${r.key}`)
  }
}

export function blockTexts(b: Block, v: OrderView, index: number, departments: MfgDepartment[], t: T): { title: string; fix: string } {
  if (b.key === "materials") {
    const inHand = v.calc.pend[index] || 0
    const state = t(`mfg4_mat_${materialStateSafe(v, index)}`)
    const dept = departmentNameOf(departments, v, index)
    return {
      title: `${dept}: ${(b.covers ?? 0) > 0 ? t("mfg4_block_materials", { qty: fmtQty(b.covers), inHand: fmtQty(inHand), unit: v.unit }) : t("mfg4_block_materials_none", { state })}`,
      fix: t("mfg4_block_materials_fix"),
    }
  }
  return { title: t(`mfg4_block_${b.key}`), fix: t(`mfg4_block_${b.key}_fix`) }
}

function materialStateSafe(v: OrderView, index: number): StationMaterialState {
  const rows = v.calc.slice.materials.filter((m) => m.departmentId === v.calc.route[index]?.departmentId)
  if (rows.some((m) => m.state === "released")) return "released"
  if (rows.some((m) => m.state === "requested")) return "requested"
  return rows.some((m) => m.state === "received") ? "partial" : "missing"
}

// ---------------------------------------------------------------------------
// The signed-in name on every decision (D8)
// ---------------------------------------------------------------------------

export function MfgRecordedAs() {
  const t = useTranslations("Portal.Shared")
  const { data, persona } = useMfgUi()
  const initials = (data.actor.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("")
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed bg-white px-3 py-2 text-[11px] text-muted-foreground">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-white">{initials}</span>
      <span className="font-semibold text-foreground">{t("mfg4_recorded_as", { name: data.actor.name })}</span>
      {persona && <span>— {t(`mfg4_persona_${persona}`)}</span>}
      <span className="ms-auto">{t("mfg4_from_signin")}</span>
    </div>
  )
}

/** Error codes thrown by the writes → a message. */
export function errorText(t: T, err: unknown): string {
  const code = (err as Error)?.message || ""
  const key = `mfg4_err_${code}`
  return t.has(key) ? t(key) : t("mfg4_err_generic")
}
