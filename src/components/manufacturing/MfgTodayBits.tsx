"use client"

// The pieces every role's Today is built from: the KPI row, quantities by unit,
// one decision card per order, a decision line, the late-and-why list, what our
// team holds, what other modules hold (read-only), the department load, the
// station queue row and "my station today". Each role's Today composes these —
// the same order reads the same on every Today.

import { useMemo, useState, type ElementType, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, CalendarDays, CheckCircle2, Clock, Coins, FileText, Hourglass, Inbox, Lock, PencilRuler, TriangleAlert, Users } from "lucide-react"
import { useRouter } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { canDo, isQcStation, materialState, type Candidate, type Persona, type Severity } from "@/lib/manufacturing-engine"
import {
  departmentLoads,
  waitingOthers,
  waitingTeam,
  type DecisionGroup,
  type DecisionItem,
  type OrderView,
  type QueueRow,
  type UnitQty,
  type WorkshopFilter,
} from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { CANDIDATE_ICON, MfgModuleChip, MfgRushChip, candidateButton, deptName, lateReasonText, sourceNameOf, useCandidateWords } from "./MfgOrderBits"
import { MfgChip, MfgEmpty, MfgLoadBar, MfgPanel, MfgPill, departmentIcon, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"

type T = ReturnType<typeof useTranslations>

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** "12.5 m² · 30 m" — never one total across units (UI-06); numbers never flip (UI-02). */
export function UnitsText({ list, className }: { list: UnitQty[]; className?: string }) {
  if (!list.length) return <span className={cn("tabular-nums", className)} dir="ltr">0</span>
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2", className)}>
      {list.map((u, i) => (
        <span key={u.unit} className="whitespace-nowrap">
          {i > 0 && <span className="me-2 text-muted-foreground" aria-hidden="true">·</span>}
          <bdi className="tabular-nums" dir="ltr">
            {fmtQty(u.qty)}
          </bdi>{" "}
          <span className="text-[0.7em] font-semibold text-muted-foreground">{u.unit}</span>
        </span>
      ))}
    </span>
  )
}

export function Money({ value, className }: { value: number; className?: string }) {
  const t = useTranslations("Portal.Shared")
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <bdi className="tabular-nums" dir="ltr">
        {fmtMoney(value)}
      </bdi>{" "}
      <span className="text-[0.75em] font-semibold text-muted-foreground">{t("mfg4_sar")}</span>
    </span>
  )
}

export function TodayKpis({ children }: { children: ReactNode }) {
  return <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">{children}</section>
}

export function TodayGrid({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">{main}</div>
      <div className="min-w-0 space-y-4">{side}</div>
    </div>
  )
}

/** A KPI click lands on the Workshop filtered the same way it counted. */
export function useWorkshopJump() {
  const router = useRouter()
  const { base } = useMfgUi()
  return (to: { f?: WorkshopFilter; late?: boolean; q?: string }) => {
    const qs = new URLSearchParams()
    if (to.f && to.f !== "all") qs.set("f", to.f)
    if (to.late) qs.set("late", "1")
    if (to.q) qs.set("q", to.q)
    qs.set("view", "list")
    router.push(`${base}/workshop?${qs.toString()}`)
  }
}

const SEV_BAR: Record<Severity, string> = { r: "bg-destructive", a: "bg-warning", b: "bg-cta" }

export function SeverityBar({ severity, className }: { severity: Severity; className?: string }) {
  return <span className={cn("w-1 shrink-0 self-stretch rounded-full", SEV_BAR[severity], className)} aria-hidden="true" />
}

export function TodaySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted/60" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-muted/60" />
    </div>
  )
}

function ShowMore({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  const t = useTranslations("Portal.Shared")
  if (hidden <= 0) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[44px] w-full border-t bg-muted/30 py-2.5 text-xs font-semibold text-cta hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {t("mfw_show_more", { count: hidden })}
    </button>
  )
}

/** When the fact behind a step happened — the age of what someone holds. */
export function candidateSince(c: Candidate, v: OrderView): string | null {
  const s = v.calc.slice
  const pick = (xs: Array<string | null | undefined>, which: "first" | "last") => {
    const sorted = xs.filter((x): x is string => !!x).sort()
    return (which === "first" ? sorted[0] : sorted[sorted.length - 1]) || null
  }
  switch (c.key) {
    case "qc_decision":
      return pick(s.rejects.filter((r) => r.index === c.index).map((r) => r.at), "first")
    case "scrap_review":
    case "scrap_clarify":
      return s.scrap.find((x) => x.id === c.scrapId)?.raisedAt || null
    case "remake_scrap":
      return pick(s.scrap.filter((x) => x.decision === null).map((x) => x.raisedAt), "first")
    case "apply_change":
      return s.changeRequest?.at || null
    case "survey":
    case "release":
      return v.order.createdAtIso || null
    case "shortage":
    case "slab":
      return s.releasedAt
    case "submit_drawing":
      return s.drawing?.recordedAt || s.releasedAt
    case "confirm_receipt":
      return pick(s.materials.filter((m) => m.requestNumber === c.requestNumber).map((m) => m.releasedAt), "last")
    case "close":
      return pick(s.qcReleases.map((q) => q.at), "last")
    case "deliver":
      return pick((s.closures || []).map((x) => x.at), "last")
    default:
      return null
  }
}

/** "WO-2026/057 · Kitchen top" */
export function orderTitle(v: OrderView): string {
  return `${v.ref} · ${v.product.name}`
}

// ---------------------------------------------------------------------------
// Needs your decision — one card per order (TD-01)
// ---------------------------------------------------------------------------

export function OrderDecisionCard({ group }: { group: Extract<DecisionGroup, { kind: "order" }> }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const words = useCandidateWords()
  const v = group.view
  const [top, ...rest] = group.items
  const TopIcon = CANDIDATE_ICON[top.candidate.key]
  return (
    <article className={cn("flex gap-3 border-b border-border/60 px-4 py-3 last:border-b-0", v.late && "bg-destructive/5")}>
      <SeverityBar severity={top.severity} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <button
          type="button"
          onClick={() => ui.openOrder(v.id)}
          className="block max-w-full rounded text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="block text-sm font-bold text-foreground hover:underline">
            <bdi dir="ltr">{v.ref}</bdi> · {v.product.name}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
            <span>{sourceNameOf(v, t)}</span>
            <span aria-hidden="true">·</span>
            <span>{t("mfw_due", { date: d.short(v.neededBy) })}</span>
            {v.late && (
              <b className="text-destructive">{v.overdue ? t("mfg4_date_past_due", { days: v.lateDays }) : t("mfw_will_miss")}</b>
            )}
            {v.rush && <MfgRushChip />}
          </span>
        </button>
        <p className="text-xs font-semibold leading-relaxed text-slate-700">{words.text(top.candidate, v)}</p>
        {v.late && v.lateReason && (
          <p className="flex items-start gap-1 text-[11px] text-destructive">
            <Clock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              <b>{t("mfg4_late_because")}</b> {lateReasonText(v.lateReason, v, ui.data.departments, t)}
            </span>
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-0.5">
          <Button
            size="sm"
            variant={top.severity === "r" ? "default" : "outline"}
            className="h-9 gap-1.5 text-xs"
            onClick={() => ui.openCandidate(v.id, top.candidate)}
          >
            <TopIcon size={13} aria-hidden="true" /> {words.button(top.candidate, v) || t("mfw_open_order")}
          </Button>
          {rest.map((item, i) => {
            const Icon = CANDIDATE_ICON[item.candidate.key]
            return (
              <Button
                key={`${item.candidate.key}_${i}`}
                size="sm"
                variant="ghost"
                className="h-9 gap-1.5 border border-dashed text-xs text-slate-700"
                title={words.text(item.candidate, v)}
                onClick={() => ui.openCandidate(v.id, item.candidate)}
              >
                <Icon size={13} aria-hidden="true" /> {words.button(item.candidate, v) || t("mfw_open_order")}
              </Button>
            )
          })}
        </div>
      </div>
    </article>
  )
}

/** One decision as a line — requests, cost statements, variances, and order
 * steps where a role's Today lists them singly (QC, cost). */
export function DecisionLine({ item }: { item: DecisionItem }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const words = useCandidateWords()
  const { data } = ui

  let icon: ElementType = FileText
  let title = ""
  let sub = ""
  let cta = ""
  let chip: ReactNode = null
  let onClick = () => {}

  switch (item.kind) {
    case "order": {
      const v = item.view
      icon = CANDIDATE_ICON[item.candidate.key]
      title = words.text(item.candidate, v)
      sub = [orderTitle(v), `${fmtQty(v.quantity)} ${v.unit}`, sourceNameOf(v, t)].join(" · ")
      cta = candidateButton(item.candidate, v, t) || t("mfw_open_order")
      onClick = () => ui.openCandidate(v.id, item.candidate)
      break
    }
    case "request": {
      const r = item.request
      const fromSales = r.sourceKind === "sales" || (!r.sourceKind && !!r.orderId)
      icon = Inbox
      title = t(r.kind === "cost" ? "mfw_dec_request_cost" : "mfw_dec_request_make", { number: r.requestNumber })
      const lines = r.lines?.length ? r.lines.map((l) => l.itemName).join(t("mfw_list_sep")) : r.itemName
      sub = [r.contactName || r.projectName || r.createdByUserName, lines, item.overdue ? t("mfw_dec_overdue", { rel: d.relative(r.requestedAt) }) : t("mfw_arrived", { rel: d.relative(r.requestedAt) })]
        .filter(Boolean)
        .join(" · ")
      chip = <MfgModuleChip module={fromSales ? "sales" : "procurement"} prefix="from" />
      cta = t("mfw_dec_read_answer")
      onClick = () => ui.openGlobal({ kind: "answerRequest", requestId: r.id })
      break
    }
    case "estimate_send": {
      const e = item.estimate
      icon = Coins
      title = t("mfw_dec_estimate_send", { number: e.estimateNumber })
      sub = [e.contactName, e.requestedBy ? t("mfw_requested_by", { name: e.requestedBy }) : null].filter(Boolean).join(" · ")
      cta = t("mfw_dec_review_send")
      onClick = () => ui.openGlobal({ kind: "sendEstimate", estimateId: e.id })
      break
    }
    case "estimate_recalc": {
      const e = item.estimate
      icon = Hourglass
      title = t("mfw_dec_estimate_expired", { number: e.estimateNumber })
      sub = [e.contactName, e.sentAt ? t("mfw_sent", { rel: d.relative(e.sentAt) }) : null].filter(Boolean).join(" · ")
      cta = t("mfw_dec_recalculate")
      onClick = () => ui.openGlobal({ kind: "recalcEstimate", estimateId: e.id })
      break
    }
    case "variance": {
      const v = item.view
      const x = item.variance
      const rate = data.departments.find((dep) => dep.id === x.departmentId)?.hourlyRate || 0
      icon = Hourglass
      const dept = deptName(data.departments, x.departmentId, v.calc.route[x.index]?.departmentName || "")
      title = ui.seesMoney
        ? t("mfw_dec_variance_value", { dept, order: v.ref, percent: x.percent, value: fmtMoney(x.gap * (rate + data.settings.overheadRatePerHour)) })
        : t("mfw_dec_variance", { dept, order: v.ref, percent: x.percent })
      sub = [t("mfw_dec_variance_hours", { actual: fmtQty(x.actual), standard: fmtQty(x.standard) }), sourceNameOf(v, t)].join(" · ")
      cta = t("mfw_dec_review_variance")
      onClick = () => ui.openAction(v.id, { kind: "variance", departmentId: x.departmentId })
      break
    }
  }
  const Icon = icon
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 sm:flex-nowrap">
      <SeverityBar severity={item.severity} className="min-h-[36px]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-foreground">{title}</p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {chip}
        <Button size="sm" variant={item.severity === "r" ? "default" : "outline"} className="h-9 gap-1.5 text-xs" onClick={onClick}>
          <Icon size={13} aria-hidden="true" /> {cta}
        </Button>
      </div>
    </div>
  )
}

/** The decision panel body: cards per order (manager) or single lines. */
export function DecisionList({ items, groups, empty }: { items?: DecisionItem[]; groups?: DecisionGroup[]; empty: string }) {
  const [shown, setShown] = useState(8)
  const total = groups ? groups.length : items?.length || 0
  if (!total) return <MfgEmpty icon={CheckCircle2} title={empty} />
  return (
    <>
      {groups
        ? groups.slice(0, shown).map((g, i) => (g.kind === "order" ? <OrderDecisionCard key={g.view.id} group={g} /> : <DecisionLine key={`solo_${i}`} item={g.item} />))
        : (items || []).slice(0, shown).map((it, i) => <DecisionLine key={i} item={it} />)}
      <ShowMore hidden={total - shown} onClick={() => setShown((s) => s + 8)} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Late — and why (TD-06)
// ---------------------------------------------------------------------------

export function LatePanel() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const late = useMemo(() => ui.views.filter((v) => v.late).sort((a, b) => (a.neededBy || "9999").localeCompare(b.neededBy || "9999")), [ui.views])
  if (!late.length) return null
  return (
    <MfgPanel icon={AlertTriangle} title={t("mfw_late_title")} subtitle={t("mfw_late_sub")} count={late.length}>
      <ul>
        {late.slice(0, 6).map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => ui.openOrder(v.id)}
              className="flex w-full gap-3 border-b border-border/60 px-4 py-2.5 text-start hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <SeverityBar severity="r" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-foreground">
                  <bdi dir="ltr">{v.ref}</bdi> · {v.product.name} —{" "}
                  {v.overdue ? t("mfg4_date_past_due", { days: v.lateDays }) : t("mfw_late_at_risk", { possible: d.short(v.possibleDate), required: d.short(v.neededBy) })}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {[v.lateReason ? lateReasonText(v.lateReason, v, ui.data.departments, t) : null, sourceNameOf(v, t)].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {late.length > 6 && <p className="px-4 py-2 text-[11px] text-muted-foreground">{t("mfw_and_more", { count: late.length - 6 })}</p>}
    </MfgPanel>
  )
}

// ---------------------------------------------------------------------------
// Awaiting our team (TD-07)
// ---------------------------------------------------------------------------

export function TeamPanel() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const words = useCandidateWords()
  const { world, data } = ui
  const groups = useMemo(() => waitingTeam(world, data.team, data.engineActor, data.departments, data.settings), [world, data.team, data.engineActor, data.departments, data.settings])
  if (!groups.length) return null
  return (
    <MfgPanel title={t("mfw_team_title")} subtitle={t("mfw_team_sub")}>
      {groups.map((g) => {
        const name = g.holder.name || t(`mfg4_persona_${g.holder.role}`)
        const initials = g.holder.name ? g.holder.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("") : null
        return (
          <div key={g.holder.key} className="border-b border-border/60 last:border-b-0">
            <div className="flex items-center gap-2 bg-muted/30 px-4 py-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-white" aria-hidden="true">
                {initials || <Users size={13} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-bold text-foreground">
                {name}
                {g.holder.name && <span className="ms-1.5 font-normal text-muted-foreground">{t(`mfg4_persona_${g.holder.role}`)}</span>}
              </span>
              <MfgChip>{g.items.length}</MfgChip>
            </div>
            <ul>
              {g.items.slice(0, 2).map(({ view: v, candidate: c }, i) => {
                const since = candidateSince(c, v)
                return (
                  <li key={`${v.id}_${c.key}_${i}`}>
                    <button
                      type="button"
                      onClick={() => ui.openOrder(v.id)}
                      className="flex w-full gap-3 px-4 py-2 text-start hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <SeverityBar severity={c.severity} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-foreground">{words.text(c, v)}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          <bdi dir="ltr">{v.ref}</bdi> · {sourceNameOf(v, t)}
                          {since && <> · {d.relative(since)}</>}
                          {v.late && <b className="text-destructive"> · {t("mfw_late_flag")}</b>}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {g.items.length > 2 && <p className="px-4 pb-2 text-[11px] text-muted-foreground">{t("mfw_and_more", { count: g.items.length - 2 })}</p>}
          </div>
        )
      })}
    </MfgPanel>
  )
}

// ---------------------------------------------------------------------------
// Awaiting other modules — read-only, scoped by role (TD-08, BD-01)
// ---------------------------------------------------------------------------

export function OthersPanel({ persona, stations }: { persona: Persona; stations: string[] }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const router = useRouter()
  const words = useCandidateWords()
  const { world, data } = ui
  const groups = useMemo(
    () => waitingOthers(world, persona, stations, data.estimates, data.settings, ui.today),
    [world, persona, stations, data.estimates, data.settings, ui.today]
  )
  if (!groups.length) return null
  return (
    <MfgPanel title={t("mfw_others_title")} subtitle={t("mfw_others_sub")}>
      {groups.map((g) => (
        <div key={g.module} className="border-b border-border/60 last:border-b-0">
          <div className="flex items-center gap-2 bg-muted/30 px-4 py-2">
            <MfgModuleChip module={g.module} />
            <span className="ms-auto">
              <MfgChip>{g.items.length}</MfgChip>
            </span>
          </div>
          <ul>
            {g.items.slice(0, 4).map((it, i) => {
              if (it.view && it.candidate) {
                const v = it.view
                const c = it.candidate
                return (
                  <li key={`${v.id}_${c.key}_${i}`}>
                    <button
                      type="button"
                      onClick={() => ui.openOrder(v.id)}
                      className="flex w-full gap-3 px-4 py-2 text-start hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <SeverityBar severity={c.severity === "r" ? "r" : "b"} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-foreground">{words.text(c, v)}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          <bdi dir="ltr">{v.ref}</bdi> · {sourceNameOf(v, t)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              }
              if (it.estimate) {
                const e = it.estimate
                return (
                  <li key={`${e.id}_${i}`}>
                    <button
                      type="button"
                      onClick={() => router.push(`${ui.base}/estimates`)}
                      className="flex w-full gap-3 px-4 py-2 text-start hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <SeverityBar severity="b" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-foreground">
                          {e.quoteNumber ? t("mfw_others_estimate_quoted", { number: e.estimateNumber, quote: e.quoteNumber }) : t("mfw_others_estimate", { number: e.estimateNumber })}
                        </span>
                        {e.contactName && <span className="mt-0.5 block text-[11px] text-muted-foreground">{e.contactName}</span>}
                      </span>
                    </button>
                  </li>
                )
              }
              return null
            })}
          </ul>
          {g.items.length > 4 && <p className="px-4 pb-2 text-[11px] text-muted-foreground">{t("mfw_and_more", { count: g.items.length - 4 })}</p>}
        </div>
      ))}
    </MfgPanel>
  )
}

// ---------------------------------------------------------------------------
// Department load with today's stops (WS-06, FL-14)
// ---------------------------------------------------------------------------

export function LoadPanel({ canReport }: { canReport: boolean }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { world, data } = ui
  const loads = useMemo(() => departmentLoads(world, data.departments), [world, data.departments])
  if (!data.settings.features.time || !loads.length) return null
  const max = Math.max(1, ...loads.map((l) => l.days))
  return (
    <MfgPanel title={t("mfw_load_title")} subtitle={t("mfw_load_sub")}>
      <ul>
        {loads.map((l) => {
          const Icon = departmentIcon(l.department.name)
          return (
            <li key={l.department.id} className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 text-xs last:border-b-0">
              <span className="flex w-36 min-w-0 shrink-0 items-center gap-1.5 font-semibold sm:w-44">
                <Icon size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{l.department.name}</span>
                {l.lostToday > 0 && (
                  <MfgChip tone="bad">
                    <bdi dir="ltr">−{fmtQty(l.lostToday)}</bdi> {t("mfw_h")}
                  </MfgChip>
                )}
              </span>
              <MfgLoadBar ratio={l.days / max} tone={l.bottleneck ? "bad" : l.days > 2 ? "warn" : "ok"} />
              <span className="w-14 shrink-0 text-end tabular-nums text-muted-foreground">{t("mfg4_days_short", { days: fmtQty(l.days) })}</span>
              {l.bottleneck && <MfgChip tone="bad">{t("mfw_bottleneck")}</MfgChip>}
            </li>
          )
        })}
      </ul>
      {canReport && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3">
          <Button size="sm" variant="outline" className="h-9 gap-1.5 text-xs" onClick={() => ui.openGlobal({ kind: "stop" })}>
            <TriangleAlert size={13} aria-hidden="true" /> {t("mfw_report_stop")}
          </Button>
          <span className="text-[11px] text-muted-foreground">{t("mfw_report_stop_hint")}</span>
        </div>
      )}
    </MfgPanel>
  )
}

// ---------------------------------------------------------------------------
// The station queue row (TD-05) — lead and QC
// ---------------------------------------------------------------------------

function queueState(row: QueueRow, t: T, qc: boolean): { label: string; tone: "bad" | "info" | "warn" | "ok" } {
  const v = row.view
  const hard = row.blocks.find((b) => b.severity === "hard")
  if (hard) return { label: t("mfw_q_blocked", { what: t(`mfg4_what_${hard.key}`) }), tone: "bad" }
  const ms = materialState(v.calc, row.index)
  if (ms === "released") return { label: t("mfg4_mat_released"), tone: "info" }
  if (ms === "requested") return { label: t("mfg4_mat_requested"), tone: "info" }
  if ((ms === "missing" || ms === "partial") && canDo(v.calc, row.index) < row.inHand) return { label: t(`mfg4_mat_${ms}`), tone: "warn" }
  return { label: qc ? t("mfw_q_ready_inspect") : t("mfw_q_ready_work"), tone: "ok" }
}

export function isReadyRow(row: QueueRow): boolean {
  return !!row.action && ["output", "qc_release", "gate"].includes(row.action.key)
}

export function isBlockedRow(row: QueueRow): boolean {
  return row.blocks.some((b) => b.severity === "hard") || (!row.action && materialState(row.view.calc, row.index) === "requested")
}

export function QueueRowView({ row, n }: { row: QueueRow; n: number }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const words = useCandidateWords()
  const v = row.view
  const c = v.calc
  const dept = ui.data.departments.find((x) => x.id === row.departmentId)
  const qc = isQcStation(dept)
  const state = queueState(row, t, qc)
  const hard = row.blocks.some((b) => b.severity === "hard")
  const ms = materialState(c, row.index)
  const first = row.index === c.firstQ
  const rework = first ? c.slice.progress[c.firstQ]?.rework || 0 : 0
  const notice = v.notices[0]
  const cutCount = c.slice.drawing?.cutList?.length || 0
  const docBits = first
    ? [
        v.product.requiresDrawingApproval ? (c.drawingOk ? t("mfw_q_drawing_ok", { code: c.slice.drawing?.code || "A" }) : t("mfw_q_drawing_missing")) : null,
        cutCount ? t("mfw_q_pieces", { count: cutCount }) : null,
        c.slice.slabApproval ? t("mfw_q_slab_ok", { lot: c.slice.slabApproval.lot }) : null,
      ].filter(Boolean)
    : []
  const main = row.action && ["output", "qc_release", "gate"].includes(row.action.key)
  const ActionIcon = row.action ? CANDIDATE_ICON[row.action.key] : null

  return (
    <li className={cn("grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 border-b border-border/60 px-4 py-3.5 last:border-b-0 md:grid-cols-[2rem_minmax(0,1fr)_6rem_10rem_11rem] md:items-center", v.late && "bg-destructive/5")}>
      <span
        className={cn("grid h-8 w-8 place-items-center rounded-full text-xs font-black tabular-nums", n === 1 ? "bg-warning text-white" : "bg-muted text-slate-600")}
        aria-hidden="true"
      >
        {n}
      </span>
      <div className="min-w-0 space-y-1">
        <button type="button" onClick={() => ui.openOrder(v.id)} className="block max-w-full rounded text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="block text-sm font-bold leading-snug text-foreground hover:underline">{v.product.name}</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            <bdi dir="ltr">{v.ref}</bdi> · {sourceNameOf(v, t)} · {t("mfw_due", { date: d.short(v.neededBy) })}
          </span>
        </button>
        {(v.rush || v.late || rework > 0 || notice || docBits.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {v.rush && <MfgRushChip reason={c.slice.rush?.reason} />}
            {v.late && (
              <MfgChip tone="bad" icon={CalendarDays}>
                {v.overdue ? t("mfw_q_late_days", { days: v.lateDays }) : t("mfw_q_at_risk")}
              </MfgChip>
            )}
            {rework > 0 && <MfgChip tone="warn">{t("mfg4_bit_remake", { qty: fmtQty(Math.min(rework, row.inHand)) })}</MfgChip>}
            {notice && (
              <MfgChip tone="bad" icon={AlertTriangle}>
                {t("mfw_q_notice", { defect: t(`mfg4_defect_${notice.defect}`) })}
              </MfgChip>
            )}
            {docBits.length > 0 && (
              <button
                type="button"
                onClick={() => ui.openOrder(v.id)}
                className="inline-flex min-h-[28px] items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-cta underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PencilRuler size={12} aria-hidden="true" />
                {docBits.join(" · ")}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="col-start-2 flex items-baseline gap-1 md:col-start-auto">
        <span className="text-lg font-black tabular-nums text-foreground" dir="ltr">
          {fmtQty(row.inHand)}
        </span>
        <span className="text-xs font-semibold text-muted-foreground">{v.unit}</span>
      </div>
      <div className="col-start-2 md:col-start-auto">
        <MfgPill tone={state.tone} icon={hard ? Lock : undefined} className="whitespace-normal">
          {state.label}
        </MfgPill>
      </div>
      <div className="col-span-2 md:col-span-1 md:justify-self-end">
        {row.action && ActionIcon ? (
          <Button
            variant={main ? "default" : "outline"}
            className="h-11 w-full gap-1.5 text-sm md:h-10 md:w-auto md:text-xs"
            title={words.text(row.action, v)}
            onClick={() => ui.openCandidate(v.id, row.action!)}
          >
            <ActionIcon size={15} aria-hidden="true" /> {words.button(row.action, v)}
          </Button>
        ) : (
          <span className="text-[11px] font-semibold text-muted-foreground">
            {hard ? t("mfw_q_awaiting_approval") : ms === "requested" ? t("mfw_q_awaiting_issue") : t("mfw_q_not_yours")}
          </span>
        )}
      </div>
    </li>
  )
}

export function QueueList({ rows, empty }: { rows: QueueRow[]; empty: string }) {
  const [shown, setShown] = useState(20)
  if (!rows.length) return <MfgEmpty icon={CheckCircle2} title={empty} />
  return (
    <>
      <ol>
        {rows.slice(0, shown).map((r, i) => (
          <QueueRowView key={`${r.view.id}_${r.index}`} row={r} n={i + 1} />
        ))}
      </ol>
      <ShowMore hidden={rows.length - shown} onClick={() => setShown((s) => s + 20)} />
    </>
  )
}

// ---------------------------------------------------------------------------
// My station today (lead)
// ---------------------------------------------------------------------------

export function StationPanel({ stations, canReport }: { stations: string[]; canReport: boolean }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { world, data } = ui
  const loads = useMemo(() => new Map(departmentLoads(world, data.departments).map((l) => [l.department.id, l])), [world, data.departments])
  const timeOn = data.settings.features.time
  return (
    <MfgPanel title={t("mfw_station_title")}>
      <ul>
        {stations.map((sid) => {
          const dept = data.departments.find((x) => x.id === sid)
          const load = loads.get(sid)
          const stops = data.stops.filter((s) => s.departmentId === sid && s.date === ui.today)
          const lost = world.lost.get(sid) || 0
          const Icon = departmentIcon(dept?.name)
          return (
            <li key={sid} className="border-b border-border/60 px-4 py-3 last:border-b-0">
              <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                <Icon size={14} className="text-muted-foreground" aria-hidden="true" /> {dept?.name || sid}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {timeOn && load
                  ? t("mfw_station_capacity", { hours: fmtQty(load.capacity), days: fmtQty(load.days) })
                  : t("mfw_workers", { count: Math.max(1, Number(dept?.workers) || 1) })}
                {lost > 0 && <b className="text-destructive"> · {t("mfw_lost_today", { hours: fmtQty(lost) })}</b>}
              </p>
              {stops.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {stops.map((s) => (
                    <li key={s.id} className="flex items-start gap-1.5 text-[11px] text-slate-700">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                      <span>
                        {t(`mfw_stop_${s.kind}`)} — {t("mfw_hours", { hours: fmtQty(s.hours) })}
                        {s.note ? ` · ${s.note}` : ""} · {s.by}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {canReport && (
        <div className="border-t border-border/60 px-4 py-3">
          <Button variant="outline" className="h-11 w-full gap-1.5 text-sm sm:w-auto sm:text-xs" onClick={() => ui.openGlobal({ kind: "stop", departmentId: stations[0] })}>
            <TriangleAlert size={14} aria-hidden="true" /> {t("mfw_station_report")}
          </Button>
        </div>
      )}
    </MfgPanel>
  )
}
