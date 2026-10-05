"use client"

// Training (PRD TR-01…06, WF-20; the prototype's trainView): the gaps by certificate and workplace, worst first
// (red: no valid certificate on someone at work; amber: expiring or in the induction's grace), with the HR
// manager's «جدول جلسة»; a supervisor sees his own workers by name and the session they are booked on; the
// training needs reviews named; the sessions (planned first) with the result to record on the day and an
// external course's cost waiting on Finance; and the course catalogue — costs only to money roles.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { BookOpen, CalendarDays, ClipboardList, GraduationCap, ShieldAlert, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable, Figure, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrGrowth } from "@/hooks/useHrGrowth"
import { useHrPeople } from "@/hooks/useHrPeople"
import { useTableLabels } from "@/hooks/useTableLabels"
import { hrPeopleScope } from "@/lib/hr/access"
import { displayName, type HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { attendees, CERTS, certGaps, COURSES, courseNeeds, courseOf, gapBad, inSession, NEED_COURSES, sortGaps, type CertGap, type CertKey, type TrainingSession } from "@/lib/hr/training"
import { CertChip, relDay } from "./HrCertChip"
import { ScheduleSessionDialog, SessionResultDialog } from "./HrTrainingDialogs"
import type { HrPortal } from "./HrShell"

type GapGroup = { cert: CertKey; siteId: string | null; gaps: CertGap[]; bad: number; booked: number }

export function HrTrainingView({ access, actor, sessionParam }: { access: HrAccess; portal: HrPortal; actor: HrActor; sessionParam?: string | null }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const labels = useTableLabels()
  const today = todayDay()
  const growth = useHrGrowth(access)
  const { employees, sites, siteName } = useHrPeople(access, access.ctx.roles.size > 0)
  const manage = access.allowed("train.manage")
  const money = access.allowed("pay.view")
  const scope = hrPeopleScope(access.ctx)
  const supervisorOnly = scope !== null && access.ctx.roles.has("supervisor")
  const [scheduling, setScheduling] = useState<{ course: string; siteId: string | null } | null>(null)
  const [recording, setRecording] = useState<TrainingSession | null>(null)

  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const siteType = useMemo(() => (id: string | null | undefined) => sites.find((s) => s.id === id)?.type ?? null, [sites])
  const inScope = useMemo(() => (scope ? employees.filter((e) => e.siteId && scope.includes(e.siteId)) : employees), [employees, scope])
  const gaps = useMemo(() => certGaps(inScope, siteType, today, access.settings.policies.renewWindowDays), [inScope, siteType, today, access.settings.policies.renewWindowDays])
  const place = (id: string | null) => (id ? (siteName(id) ?? "—") : t("sites.unassigned"))

  // A session opened from Today («سجّل») opens its result form.
  useEffect(() => {
    if (!sessionParam || !manage) return
    const s = growth.sessions.find((x) => x.id === sessionParam && x.state === "plan" && x.at <= today)
    if (s) setRecording(s)
  }, [sessionParam, manage, growth.sessions, today])

  const groups: GapGroup[] = useMemo(() => {
    const by = new Map<string, GapGroup>()
    for (const g of gaps) {
      const key = `${g.cert}|${g.siteId ?? ""}`
      const row = by.get(key) ?? { cert: g.cert, siteId: g.siteId, gaps: [], bad: 0, booked: 0 }
      row.gaps.push(g)
      if (gapBad(g, byId.get(g.employeeId), today)) row.bad++
      if (inSession(growth.sessions, g.employeeId, g.cert)) row.booked++
      by.set(key, row)
    }
    return [...by.values()].sort((a, b) => b.bad - a.bad || b.gaps.length - a.gaps.length)
  }, [gaps, byId, today, growth.sessions])

  const needs = useMemo(
    () => NEED_COURSES.map((c) => ({ c, ids: courseNeeds(growth.reviews.map((r) => ({ employeeId: r.employeeId, need: r.need })), growth.sessions, c.id) })).filter((x) => x.ids.length),
    [growth.reviews, growth.sessions]
  )
  const costOf = (s: TrainingSession) => growth.costs.find((c) => c.session === s.id) ?? null

  const gapCols: DataColumn<GapGroup>[] = [
    { key: "what", header: t("train.col.gap"), cell: (g) => <span className="font-semibold">{t(`train.cert.${g.cert}`)} — {place(g.siteId)}</span>, sortValue: (g) => `${g.cert}${place(g.siteId)}` },
    { key: "bad", header: t("train.col.not_valid"), numeric: true, cell: (g) => (g.bad ? <StatusPill tone="bad"><Figure>{g.bad}</Figure></StatusPill> : "—"), sortValue: (g) => g.bad },
    { key: "soon", header: t("train.col.soon"), numeric: true, cell: (g) => (g.gaps.length - g.bad ? <StatusPill tone="warn"><Figure>{g.gaps.length - g.bad}</Figure></StatusPill> : "—"), sortValue: (g) => g.gaps.length - g.bad },
    { key: "booked", header: t("train.col.booked"), numeric: true, cell: (g) => <Figure>{g.booked}</Figure>, sortValue: (g) => g.booked },
    ...(manage
      ? [
          {
            key: "act",
            header: <span className="sr-only">{t("train.schedule")}</span>,
            label: t("train.schedule"),
            cell: (g: GapGroup) =>
              g.booked < g.gaps.length ? (
                <Button size="sm" variant="outline" onClick={() => setScheduling({ course: g.cert, siteId: g.siteId })}>
                  {t("train.schedule")}
                </Button>
              ) : null,
          },
        ]
      : []),
  ]

  const nameRows = useMemo(() => sortGaps(gaps, (id) => byId.get(id), today), [gaps, byId, today])
  const nameCols: DataColumn<CertGap>[] = [
    { key: "name", header: t("train.col.name"), cell: (g) => <span className="font-semibold">{byId.get(g.employeeId) ? displayName(byId.get(g.employeeId) as HrEmployee, locale) : "—"}</span> },
    { key: "trade", header: t("train.col.trade"), cell: (g) => t(`trade.${byId.get(g.employeeId)?.trade ?? "labourer"}` as "trade.mason"), hideBelow: "lg" },
    {
      key: "session",
      header: t("train.col.session"),
      cell: (g) => {
        const s = inSession(growth.sessions, g.employeeId, g.cert)
        return s ? t("train.in_session", { date: hrDate(s.at, locale) }) : "—"
      },
    },
    { key: "cert", header: t("train.col.cert"), cell: (g) => <CertChip k={g.cert} state={g.state} expiry={byId.get(g.employeeId)?.certs?.[g.cert]} /> },
  ]

  const sessions = useMemo(() => [...growth.sessions].sort((a, b) => (a.state === "plan" ? 0 : 1) - (b.state === "plan" ? 0 : 1) || a.at.localeCompare(b.at)), [growth.sessions])
  const sessCols: DataColumn<TrainingSession>[] = [
    {
      key: "course",
      header: t("train.col.course"),
      cell: (s) => (
        <span>
          <span className="font-semibold">{t(`train.course.${s.course}` as "train.course.ind")}</span>
          <span className="text-xs text-muted-foreground"> · {s.siteId ? place(s.siteId) : t(`train.provider.${s.course}` as "train.provider.ind")}</span>
        </span>
      ),
    },
    { key: "at", header: t("train.col.date"), cell: (s) => hrDate(s.at, locale), sortValue: (s) => s.at },
    { key: "seats", header: t("train.col.seats"), numeric: true, cell: (s) => <Figure>{`${s.ppl.length}/${s.seats}`}</Figure> },
    {
      key: "result",
      header: t("train.col.result"),
      cell: (s) => {
        if (s.state !== "done") return "—"
        const cost = costOf(s)
        return (
          <span>
            {t("train.passed", { n: attendees(s).length })}
            {money && cost ? <span className="text-xs text-muted-foreground"> · {hrMoney(cost.amount)}</span> : null}
          </span>
        )
      },
    },
    {
      key: "state",
      header: t("train.col.state"),
      cell: (s) => {
        if (s.state === "plan")
          return manage && s.at <= today ? (
            <Button size="sm" onClick={() => setRecording(s)}>
              {t("train.record")}
            </Button>
          ) : (
            <StatusPill tone="info">{relDay(t, today, s.at)}</StatusPill>
          )
        const cost = costOf(s)
        if (money && cost?.state === "sent")
          return (
            <span className="flex flex-wrap items-center gap-1.5">
              <SourceBadge module="payments" label={t("today.src.payments")} />
              <span className="text-xs text-muted-foreground">{t("train.wait_finance")}</span>
            </span>
          )
        return <StatusPill tone="ok">{t("train.done")}</StatusPill>
      },
    },
  ]

  const courseCols: DataColumn<(typeof COURSES)[number]>[] = [
    { key: "name", header: t("train.col.course"), cell: (c) => <span className="font-semibold">{t(`train.course.${c.id}` as "train.course.ind")}</span> },
    { key: "kind", header: t("train.col.kind"), cell: (c) => t(`train.kind.${c.kind}`) },
    { key: "prov", header: t("train.col.provider"), cell: (c) => t(`train.provider.${c.id}` as "train.provider.ind"), hideBelow: "lg" },
    { key: "hours", header: t("train.col.hours"), numeric: true, cell: (c) => <Figure>{c.hours}</Figure> },
    { key: "cert", header: t("train.col.validity"), cell: (c) => (c.cert ? t("train.months", { n: CERTS[c.cert].months }) : "—") },
    { key: "cost", header: t("train.col.cost"), numeric: true, cell: (c) => (c.cost ? (money ? hrMoney(c.cost) : "") : t("train.free")) },
  ]

  if (growth.isLoading && !growth.sessions.length) return null

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        {supervisorOnly && (
          <Panel title={t("train.mine_title")} icon={Users} count={nameRows.length || undefined}>
            <p className="mb-2 text-xs text-muted-foreground">{t("train.mine_note")}</p>
            <DataTable columns={nameCols} rows={nameRows} rowKey={(g) => `${g.employeeId}:${g.cert}`} caption={t("train.mine_title")} labels={labels} empty={<p className="py-6 text-center text-sm text-muted-foreground">{t("train.mine_none")}</p>} rowTone={(g) => (gapBad(g, byId.get(g.employeeId), today) ? "bad" : "warn")} pageSize={8} bordered={false} />
          </Panel>
        )}
        <Panel title={t("train.gaps_title")} icon={ShieldAlert} count={groups.length || undefined}>
          <p className="mb-2 text-xs text-muted-foreground">{t("train.gaps_note")}</p>
          <DataTable columns={gapCols} rows={groups} rowKey={(g) => `${g.cert}|${g.siteId ?? ""}`} caption={t("train.gaps_title")} labels={labels} empty={<EmptyState icon={ShieldAlert} title={t("train.gaps_none")} />} rowTone={(g) => (g.bad ? "bad" : "warn")} bordered={false} />
        </Panel>
        {needs.length > 0 && (
          <Panel title={t("train.needs_title")} icon={ClipboardList}>
            <ul className="divide-y">
              {needs.map(({ c, ids }) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-semibold">{t(`train.course.${c.id}` as "train.course.ind")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {ids
                        .slice(0, 4)
                        .map((id) => (byId.get(id) ? displayName(byId.get(id) as HrEmployee, locale) : (growth.reviews.find((r) => r.employeeId === id)?.employeeName ?? "—")))
                        .join("، ")}
                      {ids.length > 4 ? ` +${ids.length - 4}` : ""}
                    </span>
                  </span>
                  {manage ? (
                    <Button size="sm" variant="outline" onClick={() => setScheduling({ course: c.id, siteId: null })}>
                      {t("train.schedule")}
                    </Button>
                  ) : (
                    <Figure>{ids.length}</Figure>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      <div className="space-y-5">
        <Panel title={t("train.sessions_title")} icon={CalendarDays} count={sessions.filter((s) => s.state === "plan").length || undefined}>
          <DataTable columns={sessCols} rows={sessions} rowKey={(s) => s.id} caption={t("train.sessions_title")} labels={labels} empty={<EmptyState icon={CalendarDays} title={t("train.sessions_none")} />} rowTone={(s) => (s.state === "done" ? "mute" : undefined)} bordered={false} />
          {manage && (
            <div className="mt-3 flex flex-wrap gap-2">
              {COURSES.map((c) => (
                <Button key={c.id} size="sm" variant="ghost" onClick={() => setScheduling({ course: c.id, siteId: null })}>
                  <GraduationCap size={14} className="me-1.5" aria-hidden="true" />
                  {t(`train.course.${c.id}` as "train.course.ind")}
                </Button>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={t("train.courses_title")} icon={BookOpen}>
          <DataTable columns={courseCols} rows={COURSES} rowKey={(c) => c.id} caption={t("train.courses_title")} labels={labels} empty={null} bordered={false} />
        </Panel>
      </div>
      {scheduling && courseOf(scheduling.course) && (
        <ScheduleSessionDialog
          access={access}
          actor={actor}
          course={courseOf(scheduling.course)!}
          siteId={scheduling.siteId}
          employees={employees}
          sites={sites}
          gaps={gaps}
          sessions={growth.sessions}
          needs={growth.reviews.map((r) => ({ employeeId: r.employeeId, need: r.need }))}
          onClose={() => setScheduling(null)}
        />
      )}
      {recording && <SessionResultDialog access={access} actor={actor} session={recording} employees={employees} sites={sites} onClose={() => setRecording(null)} />}
    </div>
  )
}
