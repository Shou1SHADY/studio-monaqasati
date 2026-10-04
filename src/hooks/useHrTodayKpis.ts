"use client"

// HR 1.0 — Today's three numbers for the viewer's role (PRD TD-04), as the
// header shows them: each formatted here, each a door to the list whose count
// it is (todayKpis decides the numbers; this only reads and words them).

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CalendarClock, FileWarning, HandCoins, Landmark, Plane, Users, Wallet } from "lucide-react"
import type { ModuleKpi } from "@/components/module-ui/ModuleHeader"
import type { HrPortal } from "@/components/hr/HrShell"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrToday } from "@/hooks/useHrToday"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { todayKpis } from "@/lib/hr/today"

const ICON: Record<string, ModuleKpi["icon"]> = {
  on_duty: Users,
  documents: FileWarning,
  payroll: Landmark,
  iqama_expired: AlertTriangle,
  expiring: CalendarClock,
  arrivals: Plane,
  estimate: Landmark,
  returned: Wallet,
  advances: HandCoins,
  my_workers: Users,
  unrecorded: CalendarClock,
  my_docs: FileWarning,
  bench: AlertTriangle,
  decisions: CalendarClock,
  labour_cost: Landmark,
  iqama_on_site: AlertTriangle,
}

export function useHrTodayKpis(access: HrAccess, portal: HrPortal): ModuleKpi[] | undefined {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const today = todayDay()
  const world = useHrToday(access, today)
  return useMemo(() => {
    const list = todayKpis({ ctx: access.ctx, today, renewWindowDays: access.settings.policies.renewWindowDays, ...world })
    if (!list.length) return undefined
    return list.map((k) => {
      const params: Record<string, string | number> = { ...k.params }
      for (const key of ["net", "perHead"]) if (typeof params[key] === "number") params[key] = hrMoney(params[key] as number)
      if (typeof params.date === "string") params.date = hrDate(params.date, locale)
      if (typeof params.state === "string") params.state = t(`payroll.state.${params.state}` as "payroll.state.prepared")
      return {
        id: k.id,
        label: t(`today.kpi.${k.id}.label` as "today.kpi.on_duty.label", params),
        value: k.money ? hrMoney(k.value) : String(k.value),
        note: t(`today.kpi.${k.id}.${k.note}` as "today.kpi.on_duty.note", params),
        tone: k.tone,
        icon: ICON[k.id],
        href: k.href ? `/${portal}/hr/${k.href}` : undefined,
      }
    })
  }, [access.ctx, access.settings.policies.renewWindowDays, today, world, t, locale, portal])
}
