"use client"

// HR 1.0 — Today's three numbers for the viewer's role (PRD TD-04), as the
// header shows them: each formatted here, each a door to the list whose count
// it is (todayKpis decides the numbers; this only reads and words them). A
// company still moving in — build path open, no payroll yet — sees the
// build-time three (ST-05, the prototype's todayNew).

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CalendarClock, FileWarning, HandCoins, Landmark, MapPin, Plane, Users, Wallet } from "lucide-react"
import type { ModuleKpi } from "@/components/module-ui/ModuleHeader"
import type { HrPortal } from "@/components/hr/HrShell"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrToday } from "@/hooks/useHrToday"
import { useHrTodayRoles } from "@/hooks/useHrTodayRoles"
import { buildSteps } from "@/lib/hr/build-path"
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
  new_people: Users,
  new_sites: MapPin,
}

const MONEY_PARAMS = ["net", "perHead", "cost", "endCost"]

export function useHrTodayKpis(access: HrAccess, portal: HrPortal): ModuleKpi[] | undefined {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const today = todayDay()
  const world = useHrToday(access, today)
  const builder = access.allowed("settings.manage")
  const roles = useHrTodayRoles(access, builder)
  return useMemo(() => {
    const moving =
      builder &&
      world.payrolls.length === 0 &&
      buildSteps({ today, settings: access.settings, settingsSaved: access.settingsDocExists, teamMembers: roles.members, ...world }).some((s) => !s.done)
    const list = todayKpis({ ctx: access.ctx, today, renewWindowDays: access.settings.policies.renewWindowDays, payDay: access.settings.policies.payDay, moving, ...world })
    if (!list.length) return undefined
    return list.map((k) => {
      const params: Record<string, string | number> = { ...k.params }
      for (const key of MONEY_PARAMS) if (typeof params[key] === "number") params[key] = hrMoney(params[key] as number)
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
  }, [access.ctx, access.settings, access.settingsDocExists, builder, roles.members, today, world, t, locale, portal])
}
