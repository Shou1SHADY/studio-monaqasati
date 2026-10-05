"use client"

// The employee file's Attendance & leave (the prototype's efAtt): last month
// (closed or not) and this month to date — present · absent · sick · leave ·
// overtime — and today; the leave formula (accrued − taken = balance), the
// yearly entitlement and the day it becomes 30, this year's sick days against
// art. 117's 120 and the band they are in, the balance's value in cash (pay
// roles only); his leaves; and where he has worked (the assignment history).

import { useTranslations } from "next-intl"
import { ArrowRightLeft, MapPin } from "lucide-react"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { employeeMonth, type WorkplaceMonth } from "@/lib/hr/attendance"
import { leaveDaysIn, sickBand, thirtyDaysFrom } from "@/lib/hr/employee"
import { hrDate, hrMoney } from "@/lib/hr/format"
import { accruedDays } from "@/lib/hr/leave"
import { requestNoDisplay } from "@/lib/hr/requests"
import { addDays, r2, STATUTORY } from "@/lib/hr/statutory"
import { cn } from "@/lib/utils"
import { REQUEST_TONE } from "./HrRequestList"
import type { FileView } from "./hr-file-view"

const TODAY_TONE = { present: "ok", absent: "bad", sick: "violet", permission: "info", leave: "violet", unrecorded: "mute" } as const

export function HrFileAttLeave({ v }: { v: FileView }) {
  const t = useTranslations("Portal.HR")
  const { emp, today, locale } = v
  const month = today.slice(0, 7)
  const lastMonth = addDays(`${month}-01`, -1).slice(0, 7)
  const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-US", { month: "long", year: "numeric" })
  const sick = emp.sick?.days ?? 0
  const S = STATUTORY.sick
  const accrued = emp.join ? Math.floor(accruedDays(emp.join, today)) : 0
  const leaves = v.requests.filter((r) => r.kind === "leave" && r.leave).sort((a, b) => (b.leave?.from ?? "").localeCompare(a.leave?.from ?? ""))
  const moves = v.log.filter((l) => l.kind === "moved")

  const card = (title: string, wm: WorkplaceMonth | null, m: string, note: string | null) => {
    const a = employeeMonth(wm, emp.id)
    const lv = leaveDaysIn(v.requests, m, m === month ? addDays(today, -1) : null)
    const cell = (n: number, label: string, bad = false) => (
      <div className="min-w-0 text-center">
        <p className={cn("text-lg font-black tabular-nums", bad && n > 0 ? "text-destructive" : "text-foreground")}>{n}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </div>
    )
    return (
      <div className="rounded-xl border p-3">
        <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-bold">
          {title}
          {note && <span className="text-xs font-normal text-muted-foreground">{note}</span>}
        </p>
        {v.assumed ? (
          <p className="text-sm">{t("file.att_assumed", { absent: a.absent, sick: a.sick })}</p>
        ) : (
          <div className="grid grid-cols-5 gap-2">
            {cell(a.present + a.declared, t("file.cell.present"))}
            {cell(a.absent, t("file.cell.absent"), true)}
            {cell(a.sick, t("file.cell.sick"))}
            {cell(lv, t("file.cell.leave"))}
            {cell(a.overtimeHours, t("file.cell.ot"))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={t("file.att_title")}>
        <div className="space-y-3">
          {card(monthName(lastMonth), v.lastWm, lastMonth, v.lastWm?.closed ? t("file.month_closed") : null)}
          {card(monthName(month), v.thisWm, month, t("file.to_date"))}
        </div>
        <div className="mt-3">
          <KeyValueRow label={t("file.today")} value={<StatusPill tone={TODAY_TONE[v.todayState]}>{t(`file.today_state.${v.todayState}`)}</StatusPill>} />
          <KeyValueRow label={t("file.att_source")} value={t(v.assumed ? "file.att_source_office" : "file.att_source_sheet")} />
        </div>
        {v.assumed && <p className="pt-2 text-[11px] text-muted-foreground">{t("file.att_assumed_note")}</p>}
      </Panel>

      <Panel title={t("file.leave_title")}>
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl bg-muted/40 p-3 text-center" aria-label={t("file.balance_formula")}>
          <div>
            <p className="text-xl font-black tabular-nums">{accrued + (emp.openingLeave ?? 0)}</p>
            <p className="text-[11px] text-muted-foreground">{t("file.accrued_to_date")}</p>
          </div>
          <span className="text-lg text-muted-foreground" aria-hidden="true">
            −
          </span>
          <div>
            <p className="text-xl font-black tabular-nums">{emp.leaveTaken ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">{t("file.leave_taken_row")}</p>
          </div>
          <span className="text-lg text-muted-foreground" aria-hidden="true">
            =
          </span>
          <div>
            <p className={cn("text-xl font-black tabular-nums", (v.balance ?? 0) < 0 ? "text-destructive" : "text-module")}>{v.balance ?? "—"}</p>
            <p className="text-[11px] text-muted-foreground">{t("file.balance")}</p>
          </div>
        </div>
        <div className="mt-3">
          <KeyValueRow
            label={t("file.entitlement")}
            value={
              <span>
                {t("file.days", { n: v.entitlement })}
                {v.service < STATUTORY.leave.fiveYears && emp.join && <span className="ms-1.5 text-xs text-muted-foreground">{t("file.thirty_from", { date: hrDate(thirtyDaysFrom(emp.join), locale) })}</span>}
              </span>
            }
          />
          {(emp.openingLeave ?? 0) !== 0 && <KeyValueRow label={t("file.opening")} value={t("file.days", { n: emp.openingLeave ?? 0 })} />}
          {emp.opening && <KeyValueRow label={t("file.opening_card")} value={t("file.opening_card_v", { n: emp.opening.leave, name: emp.opening.byName || "—", date: hrDate(emp.opening.at?.slice(0, 10), locale) })} />}
          <KeyValueRow
            label={t("file.sick_used")}
            value={
              <span>
                <span className="tabular-nums" dir="ltr">
                  {sick}/{S.full + S.threeQuarters + S.unpaid}
                </span>
                <span className="ms-1.5 text-xs text-muted-foreground">{t(`file.sick_band.${sickBand(sick)}`)}</span>
              </span>
            }
          />
          <KeyValueRow label={t("file.leave_value")} value={v.money && v.pay ? hrMoney(r2((v.wage / STATUTORY.monthDays) * Math.max(0, v.balance ?? 0))) : <span aria-label={t("file.pay_hidden")}>•••</span>} ltr={v.money} />
          <p className="pt-2 text-[11px] text-muted-foreground">{t("file.sick_bands_note")}</p>
        </div>
      </Panel>

      <Panel title={t("file.leaves")} count={leaves.length} bodyClassName="p-0">
        {leaves.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t("file.no_leaves")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-bold">{t("file.leave_col.type")}</th>
                  <th scope="col" className="px-3 py-2 text-start font-bold">{t("file.leave_col.from")}</th>
                  <th scope="col" className="px-3 py-2 text-start font-bold">{t("file.leave_col.to")}</th>
                  <th scope="col" className="px-3 py-2 text-end font-bold">{t("file.leave_col.days")}</th>
                  <th scope="col" className="px-3 py-2 text-start font-bold">{t("file.leave_col.state")}</th>
                </tr>
              </thead>
              <tbody>
                {leaves.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">
                      <span className="font-semibold">{t(`leave_type.${r.leave!.type}`)}</span>
                      <span className="ms-1.5 text-xs tabular-nums text-muted-foreground" dir="ltr">
                        {requestNoDisplay(r.no, locale)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{hrDate(r.leave!.from, locale)}</td>
                    <td className="px-3 py-2">{hrDate(r.leave!.to, locale)}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.leave!.days}</td>
                    <td className="px-3 py-2">
                      <StatusPill tone={REQUEST_TONE[r.state]}>{t(`req.state.${r.state}`)}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t("file.assignment_history")}>
        <ol className="divide-y">
          {moves.map((l) => (
            <li key={l.id} className="flex items-start gap-2.5 py-2 text-sm">
              <ArrowRightLeft size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block font-semibold">
                  {t("file.moved_line", { from: v.siteName(String(l.params?.from ?? "")) ?? t("sites.unassigned"), to: v.siteName(String(l.params?.to ?? "")) ?? t("sites.unassigned") })}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {hrDate(String(l.params?.on ?? l.at.slice(0, 10)), locale)} · {l.byName || "—"}
                </span>
              </span>
            </li>
          ))}
          <li className="flex items-start gap-2.5 py-2 text-sm">
            <MapPin size={14} className="mt-0.5 shrink-0 text-module" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block font-semibold">{v.siteName(emp.siteId) ?? t("sites.unassigned")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("file.current_place")}
                {emp.siteSince && ` · ${t("file.since", { date: hrDate(emp.siteSince, locale) })}`}
              </span>
            </span>
          </li>
        </ol>
      </Panel>
    </div>
  )
}
