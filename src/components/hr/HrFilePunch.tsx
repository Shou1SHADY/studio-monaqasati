"use client"

// The employee file's «البصمة» section and «الوردية» action (optional: punch;
// the prototype's x5EmpSecs / x5EmpActs): where his attendance comes from, his
// shift and its times (and the change dated ahead), today's and yesterday's
// punches — an out-punch missing is said so — and his late arrivals this
// month. The HR manager, or the supervisor of his own workplace, changes his
// shift from a date.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Clock, Fingerprint } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import type { HrAccess } from "@/hooks/useHrAccess"
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import type { HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, todayDay } from "@/lib/hr/format"
import { dayPunches, graceOf, scheduleOf, shiftMinutes, sourceOf, type AppPunch, type PunchMonth, type PunchSite } from "@/lib/hr/punches"
import { mh, shiftOf, siteShifts, type EmployeeShift } from "@/lib/hr/shifts"
import type { HrSite } from "@/lib/hr/sites"
import { addDays } from "@/lib/hr/statutory"
import { ShiftSetDialog } from "./HrPunchDialogs"

type Emp = HrEmployee & { shift?: EmployeeShift | null; pn?: AppPunch | null; py?: AppPunch | null }

/** «الوردية» — on the file's actions when his workplace runs shifts, he is active, and the viewer may set it. */
export function HrShiftAction({ access, actor, emp, sites, employees }: { access: HrAccess; actor: HrActor; emp: HrEmployee; sites: HrSite[]; employees: HrEmployee[] }) {
  const t = useTranslations("Portal.HR")
  const [open, setOpen] = useState(false)
  const site = (sites.find((s) => s.id === emp.siteId) as PunchSite | undefined) ?? null
  if (!access.settings.features.includes("punch") || !site || !siteShifts(site) || emp.status !== "active" || !access.allowed("shift.set", { site: site.id })) return null
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Clock size={14} className="me-1.5" aria-hidden="true" />
        {t("punch.shiftset.act")}
      </Button>
      {open && <ShiftSetDialog access={access} actor={actor} emp={emp as Emp} site={site} people={employees as Emp[]} onClose={() => setOpen(false)} />}
    </>
  )
}

export function HrFilePunch({ access, emp, site, wm, lastWm }: { access: HrAccess; emp: HrEmployee; site: HrSite | null; wm: WorkplaceMonth | null; lastWm: WorkplaceMonth | null }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const e = emp as Emp
  const ps = site as PunchSite | null
  const source = sourceOf(e.siteId ? ps : null, access.settings.features.includes("punch"))
  if (source === "sheet" || e.status !== "active") return null
  const today = todayDay()
  const yesterday = addDays(today, -1)
  const monthOf = (d: string) => (wm?.month === d.slice(0, 7) ? wm : lastWm?.month === d.slice(0, 7) ? lastWm : null) as (WorkplaceMonth & PunchMonth) | null
  const at = (d: string) => dayPunches(monthOf(d), d, [e])[e.id] ?? null
  const sc = scheduleOf(ps, e, today)
  const sh = shiftOf(e, ps, today)
  const pt = at(today)
  const py = at(yesterday)
  const grace = graceOf(ps)
  const lateN = Object.entries((wm as (WorkplaceMonth & PunchMonth) | null)?.pd ?? {}).filter(([d, m]) => {
    const p = m?.[e.id]
    const s = scheduleOf(ps, e, d)
    const min = shiftMinutes(p?.in, s)
    return min != null && min - s.in > grace
  }).length
  const next = e.shift && e.shift.from > today ? e.shift : null
  const times = (p: { in: string | null; out: string | null } | null, missing: boolean) =>
    p?.in ? (
      <bdi dir="ltr" className="tabular-nums">
        {p.in} – {p.out ?? (missing ? t("punch.file.missing") : "…")}
      </bdi>
    ) : (
      t("punch.file.no_punch")
    )
  return (
    <Panel title={t("punch.file.title")} icon={Fingerprint}>
      <KeyValueRow label={t("punch.me.source")} value={t(`punch.src.${source}`)} />
      <KeyValueRow
        label={t("punch.me.shift")}
        value={
          <span>
            {sh ? `${t(`punch.shift.${sh.id}`)} · ` : ""}
            <bdi dir="ltr" className="tabular-nums">
              {mh(sc.in)}–{mh(sc.out)}
              {sc.out >= 1440 ? " +1" : ""}
            </bdi>
          </span>
        }
      />
      {next && <KeyValueRow label={t("punch.file.next_shift")} value={t("punch.file.next_line", { shift: t(`punch.shift.${next.id}`), date: hrDate(next.from, locale) })} />}
      <KeyValueRow label={t("punch.me.today")} value={times(pt, false)} />
      <KeyValueRow label={t("punch.file.yesterday")} value={times(py, true)} />
      <KeyValueRow label={t("punch.file.late_n")} value={lateN} />
    </Panel>
  )
}
