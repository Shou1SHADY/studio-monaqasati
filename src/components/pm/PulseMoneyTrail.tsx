"use client"

// The Pulse's money trail (the PM 1.0 prototype): what the contract is worth →
// executed → billed → collected, and under it the cost budget → committed →
// actual → paid. Beneath, the projected delay penalty at today's slippage and
// the work done under variations not yet approved. Shown to money holders on a
// priced contract that bills or tracks cost; Finance's figures carry its tag.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, ArrowDownToLine, ChevronRight, Clipboard, Clock, FileText, Hand, Landmark, Ruler, TrendingUp, Wallet, type LucideIcon } from "lucide-react"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePulseCost } from "@/hooks/usePulseCost"
import { progressOf } from "@/lib/pm/acceptance"
import { inForce, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import { delayAndDamages } from "@/lib/pm/claim"
import { usePmPlan } from "@/hooks/usePmPlan"
import { pmMoney, todayDay } from "@/lib/pm/format"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { moneyTrail, penaltyNote, showMoneyTrail, TRAIL_GAP } from "@/lib/pm/pulse"
import { defaultTerms, type ContractTerms } from "@/lib/pm/terms"
import { PM_VARIATIONS } from "@/lib/pm/variation"
import { cn } from "@/lib/utils"

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

export interface TrailProject {
  budget?: number
  status?: string | null
  organizationId?: string
  warehouseId?: string | null
  pm?: { lifecycle?: string; terms?: ContractTerms; original?: ContractTerms | null; startedAt?: string | null; durationDays?: number; cutPool?: number } | null
}

function useRows<T>(projectId: string, name: string, enabled: boolean): T[] | null {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && enabled ? collection(firestore, "projects", projectId, name) : null), [firestore, projectId, name, enabled])
  const { data } = useCollection(q)
  return data ? (data as unknown as T[]) : null
}

interface Step {
  icon: LucideIcon
  label: string
  value: string
  sub: string
  gap?: boolean
  finance?: boolean
}

export function PulseMoneyTrail({ projectId, project, access, ipcOn, costOn }: { projectId: string; project: TrailProject; access: PmAccess; ipcOn: boolean; costOn: boolean }) {
  const t = useTranslations("Portal.PM")
  const money = access.has("money")
  const items = useRows<Record<string, unknown>>(projectId, "boqItems", money)
  const certs = useRows<{ status: string; net: number; collected?: number | null }>(projectId, PM_CERTIFICATES, money)
  const vos = useRows<{ status: string; value: number; cost: number; executedPct: number }>(projectId, PM_VARIATIONS, money)
  const addenda = useRows<PmAddendum>(projectId, PM_ADDENDA, money)
  const cost = usePulseCost(projectId, project.organizationId, project.warehouseId, project.budget ?? 0, money)
  const planItems = useMemo(() => (items ?? []).map((d, n) => ({ id: String(d.id ?? n), quantity: num(d.quantity), rate: num(d.unitPrice) })), [items])
  const plan = usePmPlan(projectId, project, planItems)

  const view = useMemo(() => {
    if (!items || !cost) return null
    const lines = items.map((d) => ({ quantity: num(d.quantity), rate: num(d.unitPrice), executed: num(d.executedQuantity), billed: num(d.billedQuantity) }))
    const variations = (vos ?? []).map((v) => ({ status: v.status, value: num(v.value), cost: num(v.cost), executedPct: num(v.executedPct), billedPct: num((v as { billedPct?: unknown }).billedPct) }))
    const trail = moneyTrail({
      contractBase: project.budget ?? 0,
      items: lines,
      variations,
      cutPool: project.pm?.cutPool ?? 0,
      certificates: certs ?? [],
      cost: { budget: cost.estimated ? cost.total.budget : null, committed: cost.total.committed, actual: cost.total.actual, paid: cost.total.paid },
    })
    const terms = inForce(project.pm?.original ?? project.pm?.terms ?? defaultTerms(), addenda ?? [])
    const progress = progressOf(lines)
    const delay = delayAndDamages({
      lifecycle: lifecycleOf(project),
      startOn: project.pm?.startedAt ?? null,
      effectiveDays: plan.effectiveDays,
      progress,
      contractValue: trail.contract,
      damages: terms.damages,
      today: todayDay(),
      curveK: plan.curveK,
    })
    return {
      trail,
      payer: terms.payer,
      penalty: penaltyNote({ damages: terms.damages, contract: trail.contract, delay, progress, margin: trail.margin }),
      show: showMoneyTrail({ money, contract: trail.contract, itemCount: lines.length, unpricedCount: lines.filter((l) => !(l.rate > 0)).length, ipcOn, costOn }),
    }
  }, [items, cost, vos, certs, plan, addenda, project, money, ipcOn, costOn])

  if (!view || !view.show) return null
  const { trail, penalty } = view
  const payer = t(`trail.payer.${view.payer}`)
  const rows: Step[][] = [
    [
      { icon: FileText, label: t("trail.contract"), value: pmMoney(trail.contract), sub: trail.voApproved ? t("trail.contract_vo", { value: pmMoney(trail.voApproved) }) : t("trail.contract_boq") },
      { icon: Ruler, label: t("trail.executed"), value: pmMoney(trail.executed), sub: t("trail.executed_pct", { pct: Math.round(trail.executedPct) }) },
      { icon: Landmark, label: t("trail.billed"), value: pmMoney(trail.billed), sub: trail.gap > TRAIL_GAP ? t("trail.billed_gap", { value: pmMoney(trail.gap) }) : t("trail.billed_none"), gap: trail.gap > TRAIL_GAP },
      {
        icon: Wallet,
        label: t("trail.collected", { payer }),
        value: pmMoney(trail.collected),
        sub: trail.outstanding > TRAIL_GAP ? t("trail.collected_owed", { value: pmMoney(trail.outstanding), payer }) : t("trail.collected_all"),
        gap: trail.outstanding > TRAIL_GAP,
        finance: true,
      },
    ],
    [
      { icon: Clipboard, label: t("trail.budget"), value: trail.budget === null ? "—" : pmMoney(trail.budget), sub: trail.budget === null ? t("trail.budget_none") : t("trail.budget_sub") },
      { icon: Hand, label: t("trail.committed"), value: pmMoney(trail.committed), sub: t("trail.committed_sub") },
      { icon: TrendingUp, label: t("trail.actual"), value: pmMoney(trail.actual), sub: t("trail.actual_sub"), finance: true },
      { icon: ArrowDownToLine, label: t("trail.paid"), value: pmMoney(trail.paid), sub: t("trail.paid_sub", { value: pmMoney(trail.due) }), finance: true },
    ],
  ]

  return (
    <Panel title={t("trail.title")} icon={Wallet} bodyClassName="space-y-3 p-4">
      <p className="-mt-1 text-xs text-muted-foreground">{t("trail.desc")}</p>
      {rows.map((row, r) => (
        <ol key={r} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-start">
          {row.map((s, i) => (
            <li key={s.label} className="contents">
              {i > 0 && <ChevronRight size={14} className="rtl-flip hidden self-center text-muted-foreground sm:block" aria-hidden="true" />}
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                  <s.icon size={12} aria-hidden="true" />
                  <span className="truncate">{s.label}</span>
                </p>
                <p className="truncate text-sm font-black tabular-nums text-foreground" dir="ltr">
                  {s.value}
                </p>
                <p className={cn("mt-0.5 text-[11px]", s.gap ? "font-bold text-destructive" : "text-muted-foreground")}>
                  <span dir="auto">{s.sub}</span>
                  {s.finance && <SourceBadge module="payments" label={t("trail.from_finance")} className="ms-1 align-middle" />}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ))}
      {penalty && (
        <div role="note" className={cn("flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-relaxed", penalty.atCap ? "border-destructive/25 bg-destructive/5" : "border-warning/25 bg-warning/5")}>
          <Clock size={17} className={cn("mt-0.5 shrink-0", penalty.atCap ? "text-destructive" : "text-warning")} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-bold">{t("trail.penalty_title", { value: pmMoney(penalty.amount) })}</p>
            <p className="text-muted-foreground">
              {t("trail.penalty_why", { behind: penalty.behind, days: penalty.delayDays, weeks: penalty.weeks, rate: penalty.ratePct, cap: penalty.capPct })}
            </p>
            <p className="text-muted-foreground">
              {t("trail.penalty_not_yet")}
              {penalty.overMargin && <b className="text-destructive"> {t("trail.penalty_over_margin")}</b>}
            </p>
          </div>
        </div>
      )}
      {trail.voRisk > 0 && (
        <div role="note" className="flex gap-2.5 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm leading-relaxed">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-bold">{t("trail.vo_risk_title", { value: pmMoney(trail.voRisk) })}</p>
            <p className="text-muted-foreground">{t("trail.vo_risk_body")}</p>
          </div>
        </div>
      )}
    </Panel>
  )
}
