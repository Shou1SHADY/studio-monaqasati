"use client"

// The Pulse's right column beyond "waiting on others" (the PM 1.0 prototype):
// the four BOQ divisions furthest from their planned progress — each division's
// plan from the programme's activities where its items are scheduled — and the
// project log, the five latest dated facts from the project's own records. Both
// derived (`@/lib/pm/pulse`); nothing here is stored.

import { usePmPlan } from "@/hooks/usePmPlan"
import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, BookOpen, Check, ClipboardCheck, Gavel, Play, Repeat, TrendingUp, Wallet, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/module-ui/Panel"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmDecisionProject } from "@/hooks/usePmDecisions"
import { usePulseCost } from "@/hooks/usePulseCost"
import { progressOf } from "@/lib/pm/acceptance"
import { PM_ADDENDA } from "@/lib/pm/addenda"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import { PM_CLAIMS, delayAndDamages } from "@/lib/pm/claim"
import { bleeding } from "@/lib/pm/cost"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { PM_SHEETS } from "@/lib/pm/measurement"
import { PM_NCRS } from "@/lib/pm/ncr"
import { PM_ACTIVITIES, type PmActivity } from "@/lib/pm/programme"
import { itemPlanFromActivities, projectLog, sectionDeviations, type LogEntry, type LogFacts, type LogKind } from "@/lib/pm/pulse"
import { PM_OBSTACLES } from "@/lib/pm/site"
import { PM_VARIATIONS } from "@/lib/pm/variation"
import { cn } from "@/lib/utils"

type Item = { id?: string; division?: string; quantity: number; rate: number; executed: number }

function useRows<T>(projectId: string, name: string, enabled = true): T[] {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && enabled ? collection(firestore, "projects", projectId, name) : null), [firestore, projectId, name, enabled])
  const { data } = useCollection(q)
  return useMemo(() => (data ?? []) as unknown as T[], [data])
}

export function SectionsBehindPanel({ projectId, project, items, onProgramme }: { projectId: string; project: PmDecisionProject; items: Item[]; onProgramme?: () => void }) {
  const t = useTranslations("Portal.PM")
  const activities = useRows<PmActivity>(projectId, PM_ACTIVITIES)
  const planItems = useMemo(() => items.map((i, n) => ({ id: i.id ?? String(n), quantity: i.quantity, rate: i.rate })), [items])
  const base = usePmPlan(projectId, project as { pm?: { startedAt?: string | null; durationDays?: number } | null }, planItems)
  const rows = useMemo(() => {
    const pm = project.pm
    if (!pm) return []
    const today = todayDay()
    const plan = delayAndDamages({
      lifecycle: lifecycleOf(project as { pm?: { lifecycle?: string }; status?: string }),
      startOn: pm.startedAt ?? null,
      effectiveDays: base.effectiveDays,
      progress: progressOf(items),
      contractValue: 0,
      damages: { on: false, weeklyRate: 0, cap: 0 },
      today,
      curveK: base.curveK,
    })
    if (!plan?.planned) return []
    return sectionDeviations(
      items.map((i) => ({ id: i.id, division: i.division || "", quantity: i.quantity, rate: i.rate, executed: i.executed })),
      plan.planned,
      activities.length ? itemPlanFromActivities(activities, today) : undefined
    )
  }, [project, items, activities, base])
  if (!rows.length) return null
  return (
    <Panel
      title={t("pulse.behind_title")}
      icon={TrendingUp}
      bodyClassName="p-0"
      actions={
        onProgramme && (
          <Button variant="outline" size="sm" onClick={onProgramme} className="h-8 rounded-lg border border-border bg-card text-foreground shadow-none hover:bg-muted">
            {t("prg.tab")}
          </Button>
        )
      }
    >
      <ul className="divide-y">
        {rows.map((r) => {
          const dv = Math.round(r.deviation)
          return (
            <li key={r.division} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <b className="block truncate text-sm font-bold" dir="auto">
                  {r.division}
                </b>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", r.deviation < -6 ? "bg-destructive" : r.deviation < -2 ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(100, Math.max(0, r.progress))}%` }} />
                  </div>
                  <span className="text-[11px] font-bold tabular-nums" dir="ltr">
                    {Math.round(r.progress)}%
                  </span>
                </div>
              </div>
              <span className={cn("min-w-[74px] text-end text-xs font-bold", r.deviation < -4 ? "text-destructive" : "text-muted-foreground")}>
                {t(dv >= 0 ? "pulse.points_ahead" : "pulse.points_behind", { count: Math.abs(dv) })}
              </span>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

const TONE: Record<LogEntry["tone"], string> = { ok: "bg-success/10 text-success", warn: "bg-warning/10 text-warning", bad: "bg-destructive/10 text-destructive", info: "bg-cta/10 text-cta" }
const ICON: Record<LogKind, LucideIcon> = {
  started: Play,
  sheet: ClipboardCheck,
  vo: Repeat,
  claim_notice: Gavel,
  claim_submitted: Gavel,
  claim_answered: Gavel,
  addendum_signed: BookOpen,
  cert: Wallet,
  obstacle: AlertTriangle,
  ncr: AlertTriangle,
  prov: Check,
  final: Check,
  over_budget: TrendingUp,
}

export function ProjectLogPanel({
  projectId,
  project,
  money,
  seesTerms,
}: {
  projectId: string
  project: PmDecisionProject & { location?: string; organizationId?: string; warehouseId?: string | null }
  money: boolean
  seesTerms: boolean
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const sheets = useRows<LogFacts["sheets"][number]>(projectId, PM_SHEETS)
  const variations = useRows<LogFacts["variations"][number]>(projectId, PM_VARIATIONS)
  const claims = useRows<LogFacts["claims"][number]>(projectId, PM_CLAIMS)
  const addenda = useRows<LogFacts["addenda"][number]>(projectId, PM_ADDENDA, seesTerms)
  const certificates = useRows<LogFacts["certificates"][number]>(projectId, PM_CERTIFICATES, money)
  const ncrs = useRows<LogFacts["ncrs"][number]>(projectId, PM_NCRS)
  const obstacles = useRows<NonNullable<LogFacts["obstacles"]>[number]>(projectId, PM_OBSTACLES)
  const cost = usePulseCost(projectId, project.organizationId, project.warehouseId, project.budget ?? 0, money)
  const log = useMemo(() => {
    const over = cost
      ? bleeding(cost.items, cost.costs, 20).flatMap(({ item, cost: c }) =>
          c.deviation !== null && c.unitActual !== null ? [{ code: item.code, over: c.deviation, unitActual: c.unitActual, unitBudget: item.estCost }] : []
        )
      : []
    return projectLog({
      startedAt: project.pm?.startedAt ?? null,
      location: project.location ?? null,
      durationDays: project.pm?.durationDays ?? 0,
      defectsDays: project.pm?.terms?.defectsDays ?? 0,
      acceptances: project.pm?.acceptances ?? null,
      sheets,
      variations,
      claims,
      addenda,
      certificates,
      ncrs,
      obstacles,
      overBudget: over,
      money,
      today: todayDay(),
    })
  }, [project, sheets, variations, claims, addenda, certificates, ncrs, obstacles, cost, money])
  if (!log.length) return null

  const title = (e: LogEntry) => {
    const p = e.params
    const value = typeof p.value === "number" && p.value > 0 ? pmMoney(p.value) : ""
    if (e.kind === "obstacle") return t("pulse.log.obstacle", { no: t(`site.obs.no.${p.type}`, { no: String(p.no) }), title: String(p.title) })
    if (e.kind === "vo") return t(value ? "pulse.log.vo_value" : "pulse.log.vo", { no: String(p.no), title: String(p.title), value })
    if (e.kind === "started") return t(p.where ? "pulse.log.started_at" : "pulse.log.start", { where: String(p.where) })
    return t(`pulse.log.${e.kind}`, { ...p, value })
  }
  const sub = (e: LogEntry) => {
    if (!e.sub) return null
    const p = e.sub.params
    switch (e.sub.kind) {
      case "vo_status":
        return t(`vo.status.${p.status}`)
      case "cert_net":
        return t("pulse.log_sub.cert_net", { net: pmMoney(Number(p.net)), status: t(`ipc.status.${p.status}`) })
      case "obs_open":
        return t("pulse.log_sub.obs_open", { count: Number(p.days), impact: String(p.impact) })
      case "obs_closed":
        return t("pulse.log_sub.obs_closed", { count: Number(p.days) })
      case "unit_cost":
        return t("pulse.log_sub.unit_cost", { actual: pmMoney(Number(p.actual)), budget: pmMoney(Number(p.budget)), pct: Number(p.pct) })
      default:
        return t(`pulse.log_sub.${e.sub.kind}`, { count: Number(p.days) })
    }
  }

  return (
    <Panel title={t("pulse.log_title")} icon={BookOpen} bodyClassName="p-0">
      <ul className="divide-y">
        {log.map((e, i) => {
          const Icon = ICON[e.kind]
          const s = sub(e)
          return (
            <li key={`${e.kind}-${e.day}-${i}`} className="flex items-start gap-3 px-4 py-3">
              <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", TONE[e.tone])} aria-hidden="true">
                <Icon size={12} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground" dir="auto">
                  {title(e)}
                </p>
                <p className="text-xs text-muted-foreground" dir="auto">
                  {s ? `${s} · ` : ""}
                  {pmDate(e.day, locale)}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
