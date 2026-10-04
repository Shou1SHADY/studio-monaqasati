"use client"

// Today (PRD TD-01…04, ST-05, DC-04): every role's first page. "Needs your
// decision" in four fixed groups (TD-02) — only what this viewer may act on,
// what another module holds with its source and no button (TD-03); beside it
// the role's own panels, as the prototype's todayHr/todayGov/todayPay/
// todaySup/todayMgmt: the workplaces today (present ÷ assigned — the same
// count as the header's KPI), sites ending soon, and for government relations
// the renewal queue by person. For a company moving in, the ten-step build
// path and "what turned out missing" — computed from the record, never ticked.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Ambulance, CalendarClock, CheckCircle2, Circle, CircleAlert, ClipboardCheck, FileWarning, Hourglass, Inbox, Landmark, Lock, MapPin, OctagonAlert, Route, SearchCheck, UserCheck, UsersRound, Wallet, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useUser } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrRequests } from "@/hooks/useHrRequests"
import { useHrToday } from "@/hooks/useHrToday"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { usePermissions } from "@/hooks/usePermissions"
import { Link } from "@/i18n/routing"
import { hrRolesOf, type HrRole } from "@/lib/hr/access"
import { buildSteps, nextStep, setupGaps, type BuildTarget } from "@/lib/hr/build-path"
import { displayName } from "@/lib/hr/employee"
import { empNo, hrDate, todayDay } from "@/lib/hr/format"
import { requestActions } from "@/lib/hr/requests"
import { UNASSIGNED_SITE } from "@/lib/hr/sites"
import { daysBetween } from "@/lib/hr/statutory"
import { dutyToday, renewalQueue, todayItems, type TodayGroup, type TodayItem } from "@/lib/hr/today"
import { cn } from "@/lib/utils"
import { DOC_TONE } from "./HrPeopleView"
import { HrRequestList } from "./HrRequestList"
import { HrLetterList } from "./HrLetters"
import { useHrLetters } from "@/hooks/useHrLetters"
import { lettersToSign } from "@/lib/hr/letters"
import { HrViolationList, useHrViolations, violationWaits } from "./HrViolationList"
import { hrHref, type HrPortal } from "./HrShell"

const ENDING_DAYS = 45

export function HrTodayView({ access, portal }: { access: HrAccess; portal: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const today = todayDay()
  const roles = access.ctx.roles

  // TD-02 — what waits for this viewer's hand (cancelling is not a decision).
  const { requests } = useHrRequests(access)
  const waiting = useMemo(() => requests.filter((r) => requestActions(access.ctx, r, { today, financeAllowed: false }).some((a) => a !== "cancel")), [requests, access.ctx, today])

  const { user } = useUser()
  const { profile, groups } = usePermissions()
  const actor = { uid: user?.uid ?? "", name: (profile?.name as string) || null }
  const violations = useHrViolations(access)
  const vWaiting = useMemo(() => violations.filter((v) => violationWaits(access, v)), [violations, access])
  // EM-08 — letters waiting for this viewer's signature are people's requests too.
  const { letters } = useHrLetters(access)
  const lWaiting = useMemo(() => (access.allowed("letter.sign") ? lettersToSign(access.ctx, letters) : []), [access, letters])

  const world = useHrToday(access, today)
  const items = useMemo(
    () => todayItems({ ctx: access.ctx, today, renewWindowDays: access.settings.policies.renewWindowDays, ...world }),
    [access.ctx, today, access.settings.policies.renewWindowDays, world]
  )
  const [more, setMore] = useState<Record<string, boolean>>({})
  const group = (g: Exclude<TodayGroup, "requests">) => items.filter((x) => x.group === g)
  const shown = <T,>(key: string, list: T[], n = 3) => (more[key] ? list : list.slice(0, n))
  const moreButton = (key: string, len: number, n = 3) =>
    len > n && !more[key] ? (
      <Button variant="ghost" size="sm" className="w-full" onClick={() => setMore((m) => ({ ...m, [key]: true }))}>
        {t("today.show_more", { n: len - n })}
      </Button>
    ) : null
  const row = (x: TodayItem) => (
    <DecisionRow
      key={x.key}
      severity={x.severity}
      icon={KIND_ICON[x.kind] ?? CircleAlert}
      title={t(`today.k.${x.kind}`, itemParams(x, t, locale))}
      detail={
        x.source ? (
          <SourceBadge module={x.source} label={t(`today.src.${x.source}`)} />
        ) : x.kind === "doc_due" && typeof x.params.order === "string" ? (
          t("today.order", { order: String(x.params.order).split(",").map((d) => t(`doc.${d}` as "doc.iqama")).join(" ← ") })
        ) : undefined
      }
      action={
        x.action && x.href ? (
          <Button asChild size="sm" variant={x.severity === "red" ? "default" : "outline"}>
            <Link href={`/${portal}/hr/${x.href}`}>{t(`today.a.${x.action}`)}</Link>
          </Button>
        ) : undefined
      }
    />
  )
  const panel = (g: Exclude<TodayGroup, "requests">, icon: typeof Inbox) => {
    const list = group(g)
    return (
      <Panel key={g} title={t(`today.g.${g}`)} icon={icon} count={list.length || undefined} bodyClassName="p-0">
        {list.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t(`today.none.${g}`)}</p>
        ) : (
          <>
            <ul className="divide-y">{shown(g, list).map(row)}</ul>
            {moreButton(g, list.length)}
          </>
        )}
      </Panel>
    )
  }

  const decisions = (
    <div className="space-y-6">
      {panel("blocking", OctagonAlert)}
      {panel("other", Hourglass)}
      <Panel title={t("today.g.requests")} icon={Inbox} count={waiting.length + vWaiting.length + lWaiting.length || undefined}>
        <div className="space-y-3">
          <HrRequestList access={access} requests={shown("req", waiting)} portal={portal} empty={t("today.nothing_waiting")} />
          {moreButton("req", waiting.length)}
          {vWaiting.length > 0 && <HrViolationList access={access} actor={actor} violations={shown("vio", vWaiting)} all={violations} empty="" />}
          {moreButton("vio", vWaiting.length)}
          {lWaiting.length > 0 && <HrLetterList access={access} actor={actor} letters={shown("let", lWaiting)} portal={portal} empty="" />}
          {moreButton("let", lWaiting.length)}
        </div>
      </Panel>
      {panel("due", CalendarClock)}
    </div>
  )

  // --- The role's own panels ------------------------------------------------------
  const siteName = (id: string) => (id === UNASSIGNED_SITE ? t("sites.unassigned") : (world.sites.find((s) => s.id === id)?.name ?? "—"))
  const duty = useMemo(() => dutyToday({ today, employees: world.employees, sites: world.sites, thisMonth: world.thisMonth, requests: world.requests }), [today, world])
  const onlySites = roles.has("supervisor") && !roles.has("manager") && !roles.has("management") && !roles.has("payroll")
  const dutyShown = duty.filter((d) => (onlySites ? access.ctx.sites.includes(d.siteId) : true) && d.assigned + d.onLeave > 0).sort((a, b) => b.assigned - a.assigned)
  const seesDuty = roles.has("manager") || roles.has("management") || roles.has("payroll") || roles.has("supervisor")
  const sitesToday = seesDuty ? (
    <Panel title={t("today.sites_today")} icon={MapPin} bodyClassName="p-0">
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("today.sites_today_note")}</p>
      {dutyShown.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">{t("today.sites_today_none")}</p>
      ) : (
        <ul className="divide-y">
          {dutyShown.map((d) => {
            const none = d.assigned > 0 && d.unrecorded === d.assigned
            const pct = d.assigned ? Math.round((d.present / d.assigned) * 100) : 0
            const mayOpen = access.allowed("attendance.record", { site: d.siteId }) || roles.has("management")
            const label = (
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate font-semibold" dir="auto">
                  {siteName(d.siteId)}
                </span>
                {d.absent + d.sick > 0 && <StatusPill tone="bad">{t("today.duty.out", { n: d.absent + d.sick })}</StatusPill>}
                {d.unrecorded > 0 && !none && <StatusPill tone="warn">{t("today.duty.unrecorded", { n: d.unrecorded })}</StatusPill>}
                {d.onLeave > 0 && <StatusPill tone="violet">{t("today.duty.leave", { n: d.onLeave })}</StatusPill>}
              </span>
            )
            return (
              <li key={d.siteId} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1 basis-40">
                  {mayOpen ? (
                    <Link href={`/${portal}/hr/sites/${d.siteId}`} className="rounded hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                </div>
                <div className="h-2 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className={cn("h-full rounded-full", none ? "w-full bg-destructive/70" : d.unrecorded ? "bg-warning" : "bg-success")} style={none ? undefined : { width: `${pct}%` }} />
                </div>
                <span className="w-20 text-end text-xs font-bold tabular-nums" dir="ltr">
                  {none ? t("today.duty.none") : `${d.present}/${d.assigned}`}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  ) : null

  const ending = useMemo(
    () =>
      world.sites
        .filter((s) => s.active !== false && s.endDate && s.endDate >= today && daysBetween(today, s.endDate) <= ENDING_DAYS)
        .sort((a, b) => (a.endDate as string).localeCompare(b.endDate as string))
        .map((s) => ({ site: s, people: world.employees.filter((e) => e.siteId === s.id && e.status !== "left").length })),
    [world.sites, world.employees, today]
  )
  const endingPanel =
    (roles.has("manager") || roles.has("management")) && world.sites.some((s) => s.endDate) ? (
      <Panel title={t("today.ending")} icon={CalendarClock} count={ending.length || undefined} bodyClassName="p-0">
        {ending.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t("today.ending_none", { n: ENDING_DAYS })}</p>
        ) : (
          <ul className="divide-y">
            {ending.map(({ site, people }) => (
              <li key={site.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold" dir="auto">
                    {site.name} — {hrDate(site.endDate, locale)}
                  </span>
                  <span className="block text-xs text-muted-foreground">{t("today.ending_line", { n: people })}</span>
                </span>
                {access.allowed("employee.assign") && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={hrHref(portal, "sites")}>{t("today.a.plan")}</Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    ) : null

  // DC-04 — the officer's renewal queue: one line per person, 120 days ahead.
  const queue = useMemo(() => (access.allowed("documents.manage") && roles.has("gov") ? renewalQueue(world.employees, today, 120) : []), [access, roles, world.employees, today])
  const queuePanel =
    roles.has("gov") && access.allowed("documents.manage") ? (
      <Panel title={t("today.queue")} icon={SearchCheck} count={queue.length || undefined} bodyClassName="p-0">
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("today.queue_note")}</p>
        {queue.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t("today.queue_none")}</p>
        ) : (
          <>
            <ul className="divide-y">
              {shown("queue", queue, 8).map(({ employee: e, docs }) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                  <Link href={`/${portal}/hr/people/${e.id}`} className="min-w-0 flex-1 basis-40 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="block font-semibold hover:text-module" dir="auto">
                      {e.names ? displayName(e, locale) : "—"}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      <span dir="ltr">{empNo(e.no)}</span> · {t(`trade.${e.trade}` as "trade.mason")} · {e.siteId ? siteName(e.siteId) : t("sites.unassigned")}
                    </span>
                  </Link>
                  <span className="flex flex-wrap gap-1.5">
                    {docs.map((d) => (
                      <StatusPill key={d.type} tone={d.state === "valid" ? "info" : DOC_TONE[d.state]}>
                        {t("today.queue_doc", { doc: t(`doc.${d.type}`), date: hrDate(d.expiry, locale) })}
                      </StatusPill>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {moreButton("queue", queue.length, 8)}
          </>
        )}
      </Panel>
    ) : null

  // --- ST-05 — moving in ---------------------------------------------------------
  const { orgMembers } = useOrgMembers(access.orgId)
  const heldRoles = useMemo(() => {
    const held = new Set<HrRole>()
    let members = 0
    for (const m of orgMembers) {
      if (m.id === access.orgId || m.organizationRole === "owner") continue
      const g = groups.find((x) => x.id === (m.defaultGroupId as string | undefined))
      const r = hrRolesOf({ owner: false, permissions: (g?.permissions as string[] | undefined) ?? [] })
      if (r.size) members++
      r.forEach((x) => held.add(x))
    }
    return { held, members }
  }, [orgMembers, groups, access.orgId])
  const builder = access.allowed("settings.manage")
  const steps = useMemo(
    () =>
      buildSteps({
        today,
        settings: access.settings,
        settingsSaved: access.settingsDocExists,
        employees: world.employees,
        sites: world.sites,
        teamMembers: heldRoles.members,
        lastMonth: world.lastMonth,
        thisMonth: world.thisMonth,
        payrolls: world.payrolls,
      }),
    [today, access.settings, access.settingsDocExists, world, heldRoles.members]
  )
  const gaps = useMemo(
    () => setupGaps({ ctx: access.ctx, employees: world.employees, sites: world.sites, pays: access.allowed("pay.view") ? world.pays : null, heldRoles: heldRoles.held }),
    [access, world, heldRoles.held]
  )
  const done = steps.filter((s) => s.done).length
  const next = nextStep(steps)
  const target = (x: BuildTarget) => (x === "team" ? `/${portal}/team` : hrHref(portal, x))
  const moving = builder && done < steps.length
  const buildPanel = moving ? (
    <Panel title={t("today.build_title")} icon={Route} count={steps.length - done || undefined}>
      <p className="mb-3 text-xs text-muted-foreground">{t("today.build_note", { done, total: steps.length })}</p>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.key} className={cn("flex min-h-11 flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm", s.done ? "border-success/20 bg-success/5" : s === next ? "border-module/40 bg-card" : "bg-card")}>
            {s.done ? <CheckCircle2 size={17} className="shrink-0 text-success" aria-hidden="true" /> : <Circle size={17} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span className="text-xs font-bold tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 basis-48">
              <span className={cn("block font-semibold", s.done && "text-muted-foreground")}>
                {t(`today.step.${s.key}`)}
                {s.count != null && s.count > 0 && <span className="ms-1.5 text-xs tabular-nums text-muted-foreground">{s.count}</span>}
              </span>
              {!s.done && <span className="block text-xs text-muted-foreground">{t(`today.step_why.${s.key}`)}</span>}
            </span>
            {s.done ? (
              <StatusPill tone="ok">{t("today.step_done")}</StatusPill>
            ) : s.locked ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock size={12} aria-hidden="true" />
                {t("today.step_locked")}
              </span>
            ) : (
              <Button asChild size="sm" variant={s === next ? "default" : "outline"}>
                <Link href={target(s.target)}>{t(`today.step_go.${s.key}`)}</Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  ) : null
  const gapsPanel = moving ? (
    <Panel title={t("today.gaps")} icon={CircleAlert} count={gaps.length || undefined}>
      <p className="mb-2 text-xs text-muted-foreground">{t("today.gaps_note")}</p>
      {gaps.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("today.gaps_none")}</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {shown("gaps", gaps, 6).map((g, i) => (
            <li key={`${g.kind}-${i}`} className="flex items-start gap-2">
              <CircleAlert size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              <span dir="auto">{t(`today.gap.${g.kind}`, g.params)}</span>
            </li>
          ))}
        </ul>
      )}
      {moreButton("gaps", gaps.length, 6)}
    </Panel>
  ) : null

  const side = [buildPanel, gapsPanel, queuePanel, sitesToday, endingPanel].filter(Boolean)
  if (!side.length) return decisions
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {decisions}
      <div className="space-y-6">{side}</div>
    </div>
  )
}

const KIND_ICON: Record<string, LucideIcon> = {
  iqama_on_site: FileWarning,
  close_month: Lock,
  injury_overdue: Ambulance,
  injury_due: Ambulance,
  iban_fix: Wallet,
  iban_approve: Wallet,
  payroll_prepare: Landmark,
  payroll_approve: Landmark,
  sheet_today: ClipboardCheck,
  wait_custody: Hourglass,
  wait_settlement: Hourglass,
  wait_post: Hourglass,
  wait_pay: Hourglass,
  wait_advance: Hourglass,
  manpower: UsersRound,
  doc_due: FileWarning,
  iqama_clock: FileWarning,
  probation_end: UserCheck,
  contract_end: CalendarClock,
}

/** Dates in the reader's language; a document type by its name. */
function itemParams(x: TodayItem, t: ReturnType<typeof useTranslations>, locale: string): Record<string, string | number> {
  const out: Record<string, string | number> = { ...x.params }
  for (const k of ["date", "due"]) if (typeof out[k] === "string") out[k] = hrDate(out[k] as string, locale)
  if (typeof out.doc === "string") out.doc = t(`doc.${out.doc}` as "doc.iqama")
  return out
}
