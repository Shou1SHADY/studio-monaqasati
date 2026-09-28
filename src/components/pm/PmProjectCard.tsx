"use client"

// One project in the portfolio (the PM 1.0 prototype's Projects grid): its
// name, number, client and city, its stage, progress against plan, and — for
// holders of money — the contract value and the work executed but not billed.
// A project made before PM 1.0 shows what it has: its stage and its value.

import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Building2, Zap } from "lucide-react"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePmAccess } from "@/hooks/usePmAccess"
import { usePmDecisions, type PmDecisionProject } from "@/hooks/usePmDecisions"
import { Link } from "@/i18n/routing"
import { progressOf } from "@/lib/pm/acceptance"
import { delayAndDamages } from "@/lib/pm/claim"
import { pmMoney, todayDay } from "@/lib/pm/format"
import { lifecycleOf, type PmLifecycle } from "@/lib/pm/lifecycle"
import { displayDocNumber } from "@/lib/sales-numbering"
import { cn } from "@/lib/utils"

export const LIFECYCLE_TONE: Record<PmLifecycle, PillTone> = { plan: "info", live: "ok", hold: "warn", done: "module", closed: "mute" }

export type PmListProject = PmDecisionProject & { id: string; name?: string; clientName?: string; location?: string; pm?: (PmDecisionProject["pm"] & { no?: string }) | null }

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

function Figures({ items, budget, access }: { items: Array<{ quantity: number; rate: number; executed: number; billed: number }>; budget: number; access: PmAccess }) {
  const t = useTranslations("Portal.PM")
  if (!access.has("money")) return null
  const unbilled = items.reduce((a, i) => a + (i.rate > 0 ? Math.max(0, i.executed - i.billed) * i.rate : 0), 0)
  return (
    <dl className="grid grid-cols-2 gap-2 border-t pt-3 text-xs">
      <div>
        <dt className="text-muted-foreground">{t("list.contract_value")}</dt>
        <dd className="font-black tabular-nums text-foreground" dir="ltr">
          {pmMoney(budget)}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t("list.unbilled")}</dt>
        <dd className={cn("font-black tabular-nums", unbilled > 0 ? "text-destructive" : "text-foreground")} dir="ltr">
          {pmMoney(unbilled)}
        </dd>
      </div>
    </dl>
  )
}

export function PmProjectCard({ project }: { project: PmListProject }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const access = usePmAccess(project.id, project as { pm?: { lifecycle?: string } | null; status?: string; projectManagerId?: string | null })
  const itemsQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", project.id, "boqItems") : null), [firestore, project.id])
  const { data } = useCollection(itemsQ)
  const items = ((data || []) as Array<Record<string, unknown>>).map((d) => ({ quantity: num(d.quantity), rate: num(d.unitPrice), executed: num(d.executedQuantity), billed: num(d.billedQuantity) }))
  const { decisions } = usePmDecisions(project.id, project.pm ? project : null, access)
  const lifecycle = lifecycleOf(project as { pm?: { lifecycle?: string }; status?: string })
  const progress = progressOf(items)
  const plan = project.pm ? delayAndDamages({ lifecycle, startOn: project.pm.startedAt ?? null, effectiveDays: project.pm.durationDays ?? 0, progress, contractValue: 0, damages: { on: false, weeklyRate: 0, cap: 0 }, today: todayDay() }) : null
  const behind = progress !== null && plan ? Math.max(0, Math.round(plan.planned - progress)) : 0
  const red = decisions.filter((d) => d.severity === "red").length

  return (
    <Link
      href={`/contractor/projects/${project.id}${project.pm ? "?tab=pmToday" : ""}`}
      className="flex h-full flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
          <Building2 size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-black leading-snug text-foreground" dir="auto">
            {project.name || "—"}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">
            {[project.pm?.no ? displayDocNumber(project.pm.no, locale) : null, project.clientName, project.location].filter(Boolean).join(" · ")}
          </p>
        </div>
        <StatusPill tone={LIFECYCLE_TONE[lifecycle]}>{t(`lifecycle.${lifecycle}`)}</StatusPill>
      </div>

      <div>
        <div className="flex items-center gap-3">
          <span className="w-10 text-sm font-black tabular-nums" dir="ltr">
            {progress === null ? "—" : `${Math.round(progress)}%`}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", behind > 5 ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(100, Math.max(0, progress ?? 0))}%` }} />
          </div>
        </div>
        {plan && <p className="mt-1 text-[11px] text-muted-foreground">{t("pulse.kpi_planned", { planned: Math.round(plan.planned), behind })}</p>}
      </div>

      <Figures items={items} budget={project.budget ?? 0} access={access} />

      {red > 0 && (
        <p className="mt-auto flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-destructive/25 bg-destructive/5 px-2 py-0.5 text-[11px] font-semibold text-destructive">
            <Zap size={11} aria-hidden="true" />
            {t("list.urgent", { count: red })}
          </span>
        </p>
      )}
    </Link>
  )
}
