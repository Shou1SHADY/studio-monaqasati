"use client"

// The day sheet on a workplace that runs shifts (optional: punch; the
// prototype's shiftHdr / dblBtn, SH-04, SH-06): one chip per shift — its times
// and present / on it — and how many work a second shift today; on each row a
// «وردية ثانية» toggle that adds the shift's length as overtime (art. 107),
// warning above the 60-hour monthly cap (the worker's written consent). And on
// a workplace whose attendance comes from punches, where its days are recorded.

import { useTranslations } from "next-intl"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { Link } from "@/i18n/routing"
import type { AttendanceException } from "@/lib/hr/attendance"
import { sourceOf, type PunchSite } from "@/lib/hr/punches"
import { OT_MONTH_CAP, secondShiftHours, shiftHeader, type EmployeeShift } from "@/lib/hr/shifts"
import { cn } from "@/lib/utils"

type Emp = { id: string; shift?: EmployeeShift | null }

/** The chips over the sheet — null when the workplace keeps one schedule (or the feature is off). */
export function SheetShiftHeader({ on, site, people, day, ex }: { on: boolean; site: PunchSite | null; people: Emp[]; day: string; ex: (id: string) => AttendanceException }) {
  const t = useTranslations("Portal.HR")
  if (!on) return null
  const h = shiftHeader(people, site, day, (id) => !ex(id).status, (id) => Boolean(ex(id).second))
  if (!h) return null
  return (
    <div className="flex flex-wrap gap-1.5" aria-label={t("punch.sheet.shifts")}>
      {h.rows.map((r) => (
        <span key={r.shift.id} className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-semibold">
          {t(`punch.shift.${r.shift.id}`)}{" "}
          <bdi dir="ltr" className="tabular-nums">
            {r.shift.in}–{r.shift.out} · {r.present}/{r.total}
          </bdi>
        </span>
      ))}
      {h.second > 0 && <span className="rounded-full border border-warning bg-warning/10 px-2.5 py-1 text-xs font-semibold">{t("punch.sheet.second_n", { n: h.second })}</span>}
    </div>
  )
}

/** SH-04 — a second shift today: present, its length added as overtime; off again takes it back. Above the
 * monthly cap it says so (the worker's written consent is needed). */
export function SecondShiftButton({
  on,
  site,
  emp,
  day,
  value,
  monthOt,
  disabled,
  onChange,
  onWarn,
}: {
  on: boolean
  site: PunchSite | null
  emp: Emp
  day: string
  value: AttendanceException
  /** His overtime hours this month before today's. */
  monthOt: number
  disabled: boolean
  onChange: (patch: Partial<AttendanceException>) => void
  onWarn: (text: string) => void
}) {
  const t = useTranslations("Portal.HR")
  const len = on ? secondShiftHours(site, emp, day) : null
  if (len == null) return null
  const active = Boolean(value.second)
  const toggle = () => {
    const ot = value.ot ?? 0
    if (active) return onChange({ second: null, ot: Math.max(0, ot - len) || null })
    const next = ot + len
    onChange({ second: true, status: null, ot: next })
    if (monthOt + next > OT_MONTH_CAP) onWarn(t("punch.sheet.over_cap", { cap: OT_MONTH_CAP }))
  }
  return (
    <Button type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} disabled={disabled} onClick={toggle} title={t("punch.sheet.second_title", { h: len })} className={cn("h-8 rounded-full px-3 text-xs")}>
      {active ? "×2" : t("punch.sheet.second")}
    </Button>
  )
}

/** On a punch workplace the sheet stays the record, filled from the punches on the Attendance tab. */
export function SheetSourceNote({ on, site, canOpen }: { on: boolean; site: PunchSite | null; canOpen: boolean }) {
  const t = useTranslations("Portal.HR")
  const source = sourceOf(site, on)
  const portal = (usePathname() ?? "").includes("/supplier/") ? "supplier" : "contractor"
  if (source === "sheet") return null
  return (
    <Callout tone="info" title={t("punch.sheet.from_title", { source: t(`punch.src.${source}`) })}>
      {t("punch.sheet.from_note")}{" "}
      {canOpen && (
        <Link href={`/${portal}/hr/attendance`} className="font-bold text-module underline-offset-2 hover:underline">
          {t("punch.sheet.open_tab")}
        </Link>
      )}
    </Callout>
  )
}
