"use client"

// My file — attendance and leave (the prototype's efAtt for himself): last
// month and this month (present · absent · sick · leave · overtime), today and
// who records him; the leave balance as accrued − taken = balance, the yearly
// entitlement, sick days used of 120 with the bands, the balance in riyals,
// the opening balance; his leaves; and where he has been assigned.

import { useLocale, useTranslations } from "next-intl"
import { collection, orderBy, query } from "firebase/firestore"
import { CalendarCheck2, MapPin, Plane, Sun } from "lucide-react"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { HR_EMPLOYEES } from "@/lib/hr/collections"
import { HR_LOG } from "@/lib/hr/employee-writes"
import { hrDate, hrMoney } from "@/lib/hr/format"
import { leaveDaysIn, monthBefore, monthName, myToday, whoRecordsMe, type MyMonth } from "@/lib/hr/me"
import { wageOf } from "@/lib/hr/pay"
import { requestNoDisplay } from "@/lib/hr/requests"
import { UNASSIGNED_SITE } from "@/lib/hr/sites"
import { STATUTORY } from "@/lib/hr/statutory"
import { cn } from "@/lib/utils"
import { REQUEST_TONE } from "./HrRequestList"
import { TODAY_TONE } from "./HrMyHome"
import type { MyFileCtx } from "./HrMyFile"

interface LogEntry {
  id: string
  at: string
  byName: string | null
  kind: string
  params: Record<string, string | number | null>
}

export function HrMyAttendance({ ctx }: { ctx: MyFileCtx }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { emp, today, leave } = ctx
  const logQ = useMemoFirebase(() => (firestore ? query(collection(firestore, HR_EMPLOYEES, emp.id, HR_LOG), orderBy("at", "desc")) : null), [firestore, emp.id])
  const { data: logData } = useCollection(logQ)
  const moves = ((logData ?? []) as unknown as LogEntry[]).filter((e) => e.kind === "moved")
  const month = today.slice(0, 7)
  const prev = monthBefore(month)
  const state = myToday({ att: ctx.att, today, onLeave: ctx.onLeave, assumed: ctx.assumed })
  const rec = whoRecordsMe(emp.siteId, ctx.site)
  const leaves = ctx.requests.filter((r) => r.kind === "leave" && r.leave).sort((a, b) => b.leave!.from.localeCompare(a.leave!.from))
  const wage = ctx.pay ? wageOf(ctx.pay) : 0
  const S = STATUTORY.sick
  // "from → to" in the reading direction.
  const arrow = locale === "ar" ? "←" : "→"
  const place = (id: string | number | null | undefined) => (!id || id === UNASSIGNED_SITE ? t("sites.unassigned") : (ctx.siteName(String(id)) ?? "—"))

  const card = (title: React.ReactNode, m: MyMonth | null, leaveDays: number) => (
    <div className="min-w-0 rounded-xl border p-3">
      <p className="text-sm font-bold">{title}</p>
      {ctx.assumed && !m ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("file.att_assumed_note")}</p>
      ) : (
        <dl className="mt-2 grid grid-cols-5 gap-1 text-center">
          {(
            [
              ["present", (m?.present ?? 0) + (m?.declared ?? 0)],
              ["absent", m?.absent ?? 0],
              ["sick", m?.sick ?? 0],
              ["leave", leaveDays],
              ["ot", m?.ot ?? 0],
            ] as const
          ).map(([k, n]) => (
            <div key={k} className="min-w-0">
              <dd className={cn("text-lg font-black tabular-nums", k === "absent" && n > 0 && "text-destructive")}>{n}</dd>
              <dt className="truncate text-[11px] text-muted-foreground">{t(`me.month.${k}`)}</dt>
            </div>
          ))}
        </dl>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <Panel title={t("file.att_title")} icon={CalendarCheck2}>
        <div className="grid gap-3 sm:grid-cols-2">
          {card(
            <>
              {monthName(prev, locale)} {ctx.att?.m?.[prev]?.closed && <StatusPill tone="mute">{t("me.month.closed")}</StatusPill>}
            </>,
            ctx.att?.m?.[prev] ?? null,
            leaveDaysIn(ctx.requests, prev)
          )}
          {card(
            <>
              {monthName(month, locale)} <span className="text-xs font-normal text-muted-foreground">{t("me.month.to_date")}</span>
            </>,
            ctx.att?.m?.[month] ?? null,
            leaveDaysIn(ctx.requests, month, today)
          )}
        </div>
        <div className="mt-3">
          <KeyValueRow label={t("me.day.today")} value={<StatusPill tone={TODAY_TONE[state]}>{t(`me.today.${state}`)}</StatusPill>} />
          <KeyValueRow
            label={t("me.day.source")}
            value={rec.kind === "assumed" ? t("me.day.recorder_assumed") : rec.kind === "supervisor" ? t("me.day.source_sheet", { name: ctx.memberName(rec.userId) ?? t("me.holder.supervisor") }) : t("me.day.recorder_none")}
          />
        </div>
      </Panel>

      <Panel title={t("file.leave_title")} icon={Sun}>
        {/* accrued − taken = balance (LV-01, ES-06) */}
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl bg-muted/30 p-3 text-center">
          <div className="min-w-20">
            <p className="text-xl font-black tabular-nums">{leave.accrued}</p>
            <p className="text-[11px] text-muted-foreground">{t("me.formula.accrued")}</p>
          </div>
          <span className="text-lg text-muted-foreground" aria-hidden="true">
            −
          </span>
          <div className="min-w-20">
            <p className="text-xl font-black tabular-nums">{leave.taken}</p>
            <p className="text-[11px] text-muted-foreground">{t("me.formula.taken")}</p>
          </div>
          <span className="text-lg text-muted-foreground" aria-hidden="true">
            =
          </span>
          <div className="min-w-20 rounded-lg bg-module/10 px-2 py-1">
            <p className={cn("text-xl font-black tabular-nums", leave.balance < 0 ? "text-destructive" : "text-module")}>{leave.balance}</p>
            <p className="text-[11px] text-muted-foreground">{t("me.formula.balance")}</p>
          </div>
        </div>
        <div className="mt-3">
          <KeyValueRow label={t("file.entitlement")} value={leave.thirtyFrom ? t("me.entitlement_line", { n: leave.entitlement, date: hrDate(leave.thirtyFrom, locale) }) : t("file.per_year", { n: leave.entitlement })} />
          <KeyValueRow label={t("file.sick_used")} value={t("req.fact.of_120", { n: leave.sickUsed })} />
          <p className="pb-1 text-[11px] text-muted-foreground">{t("me.sick_bands", { full: S.full, q: S.threeQuarters, zero: S.unpaid })}</p>
          {wage > 0 && <KeyValueRow label={t("me.balance_cash")} value={hrMoney(Math.round((wage / STATUTORY.monthDays) * Math.max(0, leave.balance)))} ltr />}
          {emp.opening && <KeyValueRow label={t("file.opening")} value={t("me.opening_line", { n: emp.opening.leave, name: emp.opening.byName ?? "—", date: hrDate(emp.opening.at, locale) })} />}
        </div>
      </Panel>

      <Panel title={t("me.leaves")} icon={Plane} count={leaves.length}>
        {leaves.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t("me.no_leaves")}</p>
        ) : (
          <ul className="divide-y">
            {leaves.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-semibold">{t(`leave_type.${r.leave!.type}`)}</span>
                <span className="tabular-nums text-muted-foreground" dir="ltr">
                  {requestNoDisplay(r.no, locale)}
                </span>
                <span className="text-muted-foreground">
                  {hrDate(r.leave!.from, locale)} {arrow} {hrDate(r.leave!.to, locale)} · {t("file.days", { n: r.leave!.days })}
                </span>
                <StatusPill tone={REQUEST_TONE[r.state]} className="ms-auto">
                  {t(`req.state.${r.state}`)}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t("me.assignments")} icon={MapPin}>
        <ul className="divide-y">
          {moves.map((m) => (
            <li key={m.id} className="py-2 text-sm">
              <p className="font-semibold">
                {place(m.params.from)} {arrow} {place(m.params.to)}
              </p>
              <p className="text-xs text-muted-foreground">
                {hrDate((m.params.on as string) || m.at, locale)}
                {m.byName ? ` · ${m.byName}` : ""}
              </p>
            </li>
          ))}
          <li className="py-2 text-sm">
            <p className="font-semibold">{ctx.siteName(emp.siteId) ?? t("sites.unassigned")}</p>
            <p className="text-xs text-muted-foreground">{t("me.current_assignment")}</p>
          </li>
        </ul>
      </Panel>
    </div>
  )
}
