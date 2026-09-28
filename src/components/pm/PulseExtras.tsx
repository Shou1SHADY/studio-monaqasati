"use client"

// The Pulse's right column beyond "waiting on others" (the PM 1.0 prototype):
// the BOQ divisions furthest behind the planned progress, and the project log —
// the latest dated facts from the project's own records. Both derived
// (`@/lib/pm/pulse`); nothing here is stored.

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { History, TrendingDown } from "lucide-react"
import { Panel } from "@/components/module-ui/Panel"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmDecisionProject } from "@/hooks/usePmDecisions"
import { progressOf } from "@/lib/pm/acceptance"
import { PM_ADDENDA } from "@/lib/pm/addenda"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import { PM_CLAIMS, delayAndDamages } from "@/lib/pm/claim"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { PM_SHEETS } from "@/lib/pm/measurement"
import { PM_NCRS } from "@/lib/pm/ncr"
import { projectLog, sectionsBehind, type LogEntry, type LogFacts } from "@/lib/pm/pulse"
import { PM_VARIATIONS } from "@/lib/pm/variation"
import { cn } from "@/lib/utils"

type Item = { division?: string; quantity: number; rate: number; executed: number }

export function SectionsBehindPanel({ project, items }: { project: PmDecisionProject; items: Item[] }) {
  const t = useTranslations("Portal.PM")
  const rows = useMemo(() => {
    const pm = project.pm
    if (!pm) return []
    const lifecycle = lifecycleOf(project as { pm?: { lifecycle?: string }; status?: string })
    const plan = delayAndDamages({
      lifecycle,
      startOn: pm.startedAt ?? null,
      effectiveDays: pm.durationDays ?? 0,
      progress: progressOf(items),
      contractValue: 0,
      damages: { on: false, weeklyRate: 0, cap: 0 },
      today: todayDay(),
    })
    return sectionsBehind(
      items.map((i) => ({ division: i.division || "", quantity: i.quantity, rate: i.rate, executed: i.executed })),
      plan?.planned ?? null
    )
  }, [project, items])
  if (!rows.length) return null
  return (
    <Panel title={t("pulse.behind_title")} icon={TrendingDown} bodyClassName="p-0">
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("pulse.behind_desc")}</p>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.division} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-bold" dir="auto">{r.division}</span>
              <span className={cn("text-xs font-bold tabular-nums", r.deviation < -4 ? "text-destructive" : "text-muted-foreground")} dir="ltr">
                {r.deviation}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="w-10 text-xs font-bold tabular-nums" dir="ltr">{Math.round(r.progress)}%</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", r.deviation < -6 ? "bg-destructive" : r.deviation < -2 ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(100, Math.max(0, r.progress))}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function useRows<T>(projectId: string, name: string, enabled = true): T[] {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && enabled ? collection(firestore, "projects", projectId, name) : null), [firestore, projectId, name, enabled])
  const { data } = useCollection(q)
  return useMemo(() => (data ?? []) as unknown as T[], [data])
}

const TONE: Record<LogEntry["tone"], string> = { ok: "bg-success", warn: "bg-warning", bad: "bg-destructive", info: "bg-cta" }

export function ProjectLogPanel({ projectId, project, money, seesTerms }: { projectId: string; project: PmDecisionProject; money: boolean; seesTerms: boolean }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const sheets = useRows<LogFacts["sheets"][number]>(projectId, PM_SHEETS)
  const variations = useRows<LogFacts["variations"][number]>(projectId, PM_VARIATIONS)
  const claims = useRows<LogFacts["claims"][number]>(projectId, PM_CLAIMS)
  const addenda = useRows<LogFacts["addenda"][number]>(projectId, PM_ADDENDA, seesTerms)
  const certificates = useRows<LogFacts["certificates"][number]>(projectId, PM_CERTIFICATES, money)
  const ncrs = useRows<LogFacts["ncrs"][number]>(projectId, PM_NCRS)
  const log = useMemo(
    () => projectLog({ startedAt: project.pm?.startedAt ?? null, acceptances: project.pm?.acceptances ?? null, sheets, variations, claims, addenda, certificates, ncrs, money }),
    [project.pm, sheets, variations, claims, addenda, certificates, ncrs, money]
  )
  if (!log.length) return null
  return (
    <Panel title={t("pulse.log_title")} icon={History} bodyClassName="p-0">
      <ul className="divide-y">
        {log.map((e, i) => (
          <li key={`${e.kind}-${e.day}-${i}`} className="flex items-start gap-3 px-4 py-3">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE[e.tone])} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground" dir="auto">
                {t(`pulse.log.${e.kind}`, { ...e.params, value: typeof e.params.value === "number" && e.params.value > 0 ? pmMoney(e.params.value) : "" })}
              </p>
              <p className="text-xs text-muted-foreground">{pmDate(e.day, locale)}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
