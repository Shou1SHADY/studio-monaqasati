"use client"

// The three numbers at the head of a PM 1.0 project (the prototype's project
// head): progress against plan, work executed and not yet billed, and the
// project's cash position — collected against what has been paid out. Each is
// derived on every read; money only for holders of money.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Banknote, TrendingUp, Wallet } from "lucide-react"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useProjectMoneyFlow } from "@/hooks/useProjectMoneyFlow"
import { progressOf } from "@/lib/pm/acceptance"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import type { PmCertificate } from "@/lib/pm/certificate-writes"
import { delayAndDamages } from "@/lib/pm/claim"
import { pmMoney, todayDay } from "@/lib/pm/format"
import { cn } from "@/lib/utils"

type Tone = "bad" | "warn" | "good" | "neutral"
const TONE: Record<Tone, string> = { bad: "bg-destructive/10 text-destructive", warn: "bg-warning/10 text-warning", good: "bg-success/10 text-success", neutral: "bg-muted text-muted-foreground" }

const r2 = (n: number) => Math.round(n * 100) / 100

export function ProjectKpis({
  projectId,
  lifecycle,
  startOn,
  durationDays,
  items,
  access,
}: {
  projectId: string
  lifecycle: string
  startOn: string | null
  durationDays: number
  items: Array<{ quantity: number; rate: number; executed: number; billed: number }>
  access: PmAccess
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const money = access.has("money")
  const flow = useProjectMoneyFlow(money ? projectId : null)
  const certQ = useMemoFirebase(() => (firestore && money ? collection(firestore, "projects", projectId, PM_CERTIFICATES) : null), [firestore, projectId, money])
  const { data: certs } = useCollection(certQ)

  const progress = progressOf(items)
  const plan = delayAndDamages({ lifecycle, startOn, effectiveDays: durationDays, progress, contractValue: 0, damages: { on: false, weeklyRate: 0, cap: 0 }, today: todayDay() })
  const behind = progress !== null && plan ? Math.max(0, Math.round(plan.planned - progress)) : 0
  const unbilled = r2(items.reduce((a, i) => a + (i.rate > 0 ? Math.max(0, i.executed - i.billed) * i.rate : 0), 0))
  const collected = useMemo(() => {
    const pm = ((certs ?? []) as unknown as PmCertificate[]).reduce((a, c) => {
      const share = c.status === "paid" ? 1 : c.status === "part" ? Math.min(1, Math.max(0, (c as { collected?: number }).collected ?? 0)) : 0
      return a + c.net * share
    }, 0)
    return r2(pm + (flow.collected || 0))
  }, [certs, flow.collected])
  const paid = flow.paid || 0
  const cash = r2(collected - paid)

  const tiles: Array<{ id: string; icon: typeof TrendingUp; label: string; value: string; note: string; tone: Tone }> = [
    {
      id: "progress",
      icon: TrendingUp,
      label: t("pulse.kpi_progress"),
      value: progress === null ? "—" : `${Math.round(progress)}%`,
      note: plan ? t("pulse.kpi_planned", { planned: Math.round(plan.planned), behind }) : t("pulse.kpi_not_started"),
      tone: behind > 5 ? "bad" : behind > 0 ? "warn" : "good",
    },
  ]
  if (money) {
    tiles.push(
      { id: "unbilled", icon: Banknote, label: t("pulse.kpi_unbilled"), value: pmMoney(unbilled), note: t("pulse.kpi_unbilled_note"), tone: unbilled > 0 ? "warn" : "good" },
      { id: "cash", icon: Wallet, label: t("pulse.kpi_cash"), value: pmMoney(cash), note: t("pulse.kpi_cash_note", { in: pmMoney(collected), out: pmMoney(paid) }), tone: cash < 0 ? "bad" : "good" }
    )
  }

  return (
    <ul className={cn("grid gap-3", tiles.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-1")} aria-label={t("pulse.kpis")}>
      {tiles.map((k) => (
        <li key={k.id} className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <k.icon size={14} className="text-module" aria-hidden="true" />
            {k.label}
          </p>
          <p className="mt-2 truncate text-2xl font-black tabular-nums text-foreground" dir="ltr">
            {k.value}
          </p>
          <p className={cn("mt-2 inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[k.tone])}>{k.note}</p>
        </li>
      ))}
    </ul>
  )
}
