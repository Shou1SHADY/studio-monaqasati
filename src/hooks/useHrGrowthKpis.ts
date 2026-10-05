"use client"

// HR 1.0 — the growth tab's three numbers (TD-04), by the segment open: training (on duty without a valid
// certificate · expiring · sessions) or performance (the office's or the rater's). Money only to money roles.

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { CalendarDays, ClipboardCheck, GraduationCap, ShieldAlert, Star, TrendingUp } from "lucide-react"
import type { ModuleKpi } from "@/components/module-ui/ModuleHeader"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrGrowth } from "@/hooks/useHrGrowth"
import { useHrPeople, useOrgPay } from "@/hooks/useHrPeople"
import { hrPeopleScope } from "@/lib/hr/access"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { perfKpis, trainingKpis, type GrowthKpi } from "@/lib/hr/growth-today"
import { policyPct } from "@/lib/hr/performance"

const ICON: Record<string, ModuleKpi["icon"]> = {
  train_bad: ShieldAlert,
  train_soon: CalendarDays,
  train_planned: GraduationCap,
  perf_done: ClipboardCheck,
  perf_pending: Star,
  perf_pending_hr: Star,
  perf_raises: TrendingUp,
  perf_team_sent: ClipboardCheck,
  perf_drafts: Star,
  perf_team_wait: Star,
}

/** Which segment is open: training when asked for (or performance is off), else performance. */
export function growthSegment(features: readonly string[], asked: string | null): "perf" | "train" {
  if (!features.includes("perf")) return "train"
  if (!features.includes("train")) return "perf"
  return asked === "train" ? "train" : "perf"
}

export function useHrGrowthKpis(access: HrAccess): ModuleKpi[] | undefined {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const params = useSearchParams()
  const today = todayDay()
  const growth = useHrGrowth(access)
  const { employees, sites } = useHrPeople(access, access.ctx.roles.size > 0)
  const money = access.allowed("pay.view")
  const pays = useOrgPay(access.orgId, money)
  const seg = growthSegment(access.settings.features, params?.get("seg") ?? null)
  return useMemo(() => {
    let list: GrowthKpi[] = []
    if (seg === "train") list = trainingKpis({ today, renewWindowDays: access.settings.policies.renewWindowDays, employees, sites, sessions: growth.sessions, scope: hrPeopleScope(access.ctx) })
    else if (growth.cycle)
      list = perfKpis({ ctx: access.ctx, today, cycle: growth.cycle, reviews: growth.reviews, employees, recordWeight: access.settings.policies.recordWeight, pct: policyPct(access.settings.policies), pays: money ? pays : null })
    if (!list.length) return undefined
    return list.map((k) => {
      const p: Record<string, string | number> = { ...k.params }
      if (typeof p.date === "string") p.date = p.date ? hrDate(p.date, locale) : "—"
      return {
        id: k.id,
        label: t(`grow.kpi.${k.id}.label` as "grow.kpi.train_bad.label"),
        value: k.hidden ? "•••" : k.money ? hrMoney(k.value) : String(k.value),
        note: t(`grow.kpi.${k.id}.${k.note}` as "grow.kpi.train_bad.note", p),
        tone: k.tone,
        icon: ICON[k.id],
      }
    })
  }, [seg, today, access.settings.policies, access.ctx, employees, sites, growth.sessions, growth.cycle, growth.reviews, money, pays, t, locale])
}
