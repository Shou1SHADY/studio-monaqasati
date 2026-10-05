"use client"

// Today (PRD TD-01…04, ST-05, DC-04): every role's first page. "Needs your
// decision" in four fixed groups (TD-02) — only what this viewer may act on,
// each row with the facts it is decided on (the prototype's second line) and
// its action; what another module holds with its source, its age and no
// button (TD-03). Beside it the role's own panels, as the prototype's
// todayHr/todayGov/todayPay/todaySup/todayMgmt: the workplaces today (present
// ÷ assigned — the same count as the header's KPI), sites ending soon, the
// establishment file for government relations, the month's attendance for
// payroll, "my workers by trade" for a supervisor, labour cost by cost centre
// for management. For a company moving in, the ten-step build path and "what
// turned out missing" — computed from the record, never ticked.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Ambulance,
  BarChart3,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  Circle,
  CircleAlert,
  ClipboardCheck,
  FileWarning,
  Hourglass,
  Inbox,
  Landmark,
  Loader2,
  Lock,
  MapPin,
  OctagonAlert,
  Plane,
  Route,
  SearchCheck,
  Truck,
  UserCheck,
  UsersRound,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useFirestore, useUser } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrTodayDecisions } from "@/hooks/useHrTodayDecisions"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import { Link } from "@/i18n/routing"
import { buildSteps, nextStep, setupGaps, type BuildTarget } from "@/lib/hr/build-path"
import { displayName } from "@/lib/hr/employee"
import { empNo, hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { emitHrNotices, iqamaOnSiteNotices } from "@/lib/hr/notify"
import { wageOf } from "@/lib/hr/pay"
import { costCentres, latestMain } from "@/lib/hr/reports"
import { UNASSIGNED_SITE } from "@/lib/hr/sites"
import { daysBetween } from "@/lib/hr/statutory"
import { dutyToday, ENDING_DAYS, endingSites, monthProgress, renewalQueue, requestFacts, tradesToday, type FactPart, type TodayGroup, type TodayItem } from "@/lib/hr/today"
import { recordExitVisa, remindSheet } from "@/lib/hr/today-writes"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import { DOC_TONE } from "./HrPeopleView"
import { HrRequestList } from "./HrRequestList"
import { HrLetterList } from "./HrLetters"
import { NitaqatPanel } from "./HrSettingsView"
import { HrViolationList } from "./HrViolationList"
import { hrHref, tabLabelKey, type HrPortal } from "./HrShell"

const MONEY_KEYS = new Set(["eos", "wage", "instalment", "cost", "basic", "ceiling"])
const DAY_KEYS = new Set(["date", "due", "since", "from", "to"])

export function HrTodayView({ access, portal }: { access: HrAccess; portal: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const today = todayDay()
  const roles = access.ctx.roles
  const money = access.allowed("pay.view")
  const { toast } = useToast()

  const { user } = useUser()
  const { profile } = usePermissions()
  const actor = { uid: user?.uid ?? "", name: (profile?.name as string) || null }
  const { world, items, waiting, violations, vWaiting, lWaiting, heldRoles } = useHrTodayDecisions(access, today)

  // PRD "Notifications" — an expired iqama on a site reaches government relations. Nothing runs on a clock here,
  // so the HR manager's Today sends it, once a day per browser; each lapse is one notification (a fixed id).
  const firestore = useFirestore()
  const sweeps = access.allowed("employee.assign")
  const orgId = access.orgId
  useEffect(() => {
    if (!firestore || !orgId || !sweeps || !actor.uid || world.employees.length === 0) return
    const notices = iqamaOnSiteNotices(orgId, world.employees, world.sites, today)
    if (!notices.length) return
    const key = `hr-iqama-sweep:${orgId}:${today}`
    try {
      if (window.localStorage.getItem(key)) return
      window.localStorage.setItem(key, "1")
    } catch {
      // Storage blocked: the fixed ids still keep each lapse to one notification.
    }
    void emitHrNotices(firestore, { uid: actor.uid, name: actor.name }, notices)
  }, [firestore, orgId, sweeps, actor.uid, actor.name, world.employees, world.sites, today])

  const [more, setMore] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const group = (g: TodayGroup) => items.filter((x) => x.group === g)
  const shown = <T,>(key: string, list: T[], n = 3) => (more[key] ? list : list.slice(0, n))
  // TD-02 — three per group, «عرض N أخرى» and back («أقلّ»).
  const moreButton = (key: string, len: number, n = 3) =>
    len > n ? (
      <Button variant="ghost" size="sm" className="w-full" onClick={() => setMore((m) => ({ ...m, [key]: !m[key] }))} aria-expanded={Boolean(more[key])}>
        {more[key] ? t("today.show_less") : t("today.show_more", { n: len - n })}
      </Button>
    ) : null

  const siteName = (id: string) => (id === UNASSIGNED_SITE ? t("sites.unassigned") : (world.sites.find((s) => s.id === id)?.name ?? "—"))
  /** The facts line: each part in the reader's language, joined with " · ". */
  const factLine = (parts: FactPart[] | undefined) => {
    if (!parts?.length) return null
    return parts
      .map((f) => {
        const p: Record<string, string | number> = {}
        for (const [k, v] of Object.entries(f.p ?? {})) {
          if (DAY_KEYS.has(k) && typeof v === "string") p[k] = hrDate(v, locale)
          else if (MONEY_KEYS.has(k) && typeof v === "number") p[k] = hrMoney(v)
          else if (k === "trade" && typeof v === "string") p[k] = t(`trade.${v}` as "trade.mason")
          else if (k === "order" && typeof v === "string") p[k] = v.split(",").map((d) => t(`doc.${d}` as "doc.iqama")).join(" ← ")
          else if (k === "site" && v === "") p[k] = t("sites.unassigned")
          else p[k] = v
        }
        return t(`today.f.${f.k}` as "today.f.art80", p)
      })
      .join(" · ")
  }

  const run = async (x: TodayItem) => {
    if (!firestore || !x.run) return
    setBusy(x.key)
    try {
      if (x.run.kind === "remind") {
        const siteId = x.run.siteId
        const site = world.sites.find((s) => s.id === siteId)
        if (!site) return
        await remindSheet(firestore, access.ctx, actor, site, String(x.params.date ?? today), today)
        toast({ title: t("today.reminded", { site: site.name }) })
      } else {
        await recordExitVisa(firestore, access.ctx, actor, x.run.requestId)
        toast({ title: t("today.exit_visa_done") })
      }
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? `err.${err.code}` : "err.save"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const row = (x: TodayItem) => {
    const ageDays = x.since ? Math.max(0, daysBetween(x.since.slice(0, 10), today)) : null
    const facts = factLine(x.facts)
    return (
      <DecisionRow
        key={x.key}
        severity={x.severity}
        icon={KIND_ICON[x.kind] ?? CircleAlert}
        title={t(`today.k.${x.kind}`, itemParams(x, t, locale))}
        detail={
          x.source || facts ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {x.source && <SourceBadge module={x.source} label={t(`today.src.${x.source}`)} />}
              {facts && <span>{facts}</span>}
            </span>
          ) : undefined
        }
        age={ageDays != null ? t("today.age", { n: ageDays }) : undefined}
        ageDays={ageDays ?? undefined}
        action={
          x.action && (x.href || x.run) ? (
            <span className="flex flex-wrap gap-1.5">
              {x.run ? (
                <Button size="sm" variant={x.severity === "red" ? "default" : "outline"} onClick={() => void run(x)} disabled={busy !== null}>
                  {busy === x.key && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
                  {t(`today.a.${x.action}`)}
                </Button>
              ) : (
                <Button asChild size="sm" variant={x.severity === "red" ? "default" : "outline"}>
                  <Link href={`/${portal}/hr/${x.href}`}>{t(`today.a.${x.action}`)}</Link>
                </Button>
              )}
              {x.second && (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/${portal}/hr/${x.second.href}`}>{t(`today.a.${x.second.action}`)}</Link>
                </Button>
              )}
            </span>
          ) : undefined
        }
      />
    )
  }
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

  const reqRows = group("requests")
  const reqFacts = (r: Parameters<typeof requestFacts>[0]) => {
    const line = factLine(requestFacts(r, { employees: world.employees, sites: world.sites, pays: world.pays, seesPay: access.seesPay(r.employeeId) }))
    return line ? (
      <p className="text-xs text-muted-foreground" dir="auto">
        {line}
      </p>
    ) : null
  }
  const decisions = (
    <div className="space-y-6">
      {panel("blocking", OctagonAlert)}
      {panel("other", Hourglass)}
      <Panel title={t("today.g.requests")} icon={Inbox} count={reqRows.length + waiting.length + vWaiting.length + lWaiting.length || undefined}>
        <div className="space-y-3">
          {reqRows.length > 0 && (
            <>
              <ul className="divide-y rounded-xl border">{shown("reqrows", reqRows).map(row)}</ul>
              {moreButton("reqrows", reqRows.length)}
            </>
          )}
          {(waiting.length > 0 || reqRows.length === 0) && <HrRequestList access={access} requests={shown("req", waiting)} portal={portal} empty={t("today.nothing_waiting")} rowFacts={reqFacts} />}
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
  const sitesWord = t(`tab.${tabLabelKey("sites", access.settings)}` as "tab.sites")
  const duty = useMemo(() => dutyToday({ today, employees: world.employees, sites: world.sites, thisMonth: world.thisMonth, requests: world.requests }), [today, world])
  const progress = useMemo(() => monthProgress({ today, sites: world.sites, employees: world.employees, lastMonth: world.lastMonth, thisMonth: world.thisMonth }), [today, world])
  const onlySites = roles.has("supervisor") && !roles.has("manager") && !roles.has("management") && !roles.has("payroll")
  const dutyShown = duty.filter((d) => (onlySites ? access.ctx.sites.includes(d.siteId) : true) && d.assigned + d.onLeave > 0).sort((a, b) => b.assigned - a.assigned)
  const seesDuty = roles.has("manager") || roles.has("management") || roles.has("payroll") || roles.has("supervisor")
  const benchCost = useMemo(
    () => (money ? world.employees.filter((e) => !e.siteId && (e.status === "active" || e.status === "leaving")).reduce((a, e) => a + (world.pays.get(e.id) ? wageOf(world.pays.get(e.id)!) : 0), 0) : 0),
    [money, world.employees, world.pays]
  )
  const sitesToday = seesDuty ? (
    <Panel title={t("today.sites_today_word", { sites: sitesWord })} icon={MapPin} bodyClassName="p-0">
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("today.sites_today_note")}</p>
      {dutyShown.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">{t("today.sites_today_none")}</p>
      ) : (
        <ul className="divide-y">
          {dutyShown.map((d) => {
            const none = d.assigned > 0 && d.unrecorded === d.assigned
            const since = none ? progress.current.find((p) => p.siteId === d.siteId)?.since : null
            const pct = d.assigned ? Math.round((d.present / d.assigned) * 100) : 0
            const mayOpen = access.allowed("attendance.record", { site: d.siteId }) || roles.has("management")
            const bench = d.siteId === UNASSIGNED_SITE
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
                  {mayOpen && !bench ? (
                    <Link href={`/${portal}/hr/sites/${d.siteId}`} className="rounded hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                </div>
                <div className="h-2 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className={cn("h-full rounded-full", none ? "w-full bg-destructive/70" : bench ? "w-full bg-warning" : d.unrecorded ? "bg-warning" : "bg-success")} style={none || bench ? undefined : { width: `${pct}%` }} />
                </div>
                <span className="min-w-20 text-end text-xs font-bold tabular-nums" dir="auto">
                  {bench ? (money ? t("today.duty.bench_cost", { n: d.assigned, cost: hrMoney(benchCost) }) : String(d.assigned)) : none ? (since ? t("today.duty.none_since", { date: hrDate(since, locale) }) : t("today.duty.none")) : <span dir="ltr">{`${d.present}/${d.assigned}`}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  ) : null

  const ending = useMemo(() => endingSites(world.sites, world.employees, today), [world.sites, world.employees, today])
  const endingPanel =
    (roles.has("manager") || roles.has("management")) && world.sites.some((s) => s.endDate) ? (
      <Panel title={t("today.ending")} icon={CalendarClock} count={ending.length || undefined} actions={<SourceBadge module="project-management" label={t("today.src.project-management")} />} bodyClassName="p-0">
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
                  <span className="block text-xs text-muted-foreground">
                    {t("today.ending_line", { n: people.length })}
                    {money && people.length > 0 ? ` · ${t("today.ending_cost", { cost: hrMoney(people.reduce((a, e) => a + (world.pays.get(e.id) ? wageOf(world.pays.get(e.id)!) : 0), 0)) })}` : ""}
                  </span>
                </span>
                {access.allowed("employee.assign") && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/${portal}/hr/sites/${site.id}`}>{t("today.a.plan")}</Link>
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

  // ST-04 — government relations' establishment file: the band from Qiwa, the Saudi ratio from the record.
  const nitaqatPanel = roles.has("gov") ? <NitaqatPanel access={access} employees={world.employees} compact /> : null

  // AT-03/04 — payroll's month: workplaces to close for last month, and this month's progress by workplace.
  const progressPanel =
    roles.has("payroll") && (progress.toClose.length > 0 || progress.current.length > 0) ? (
      <Panel title={t("today.progress")} icon={CalendarRange} bodyClassName="p-0">
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("today.progress_note")}</p>
        <ul className="divide-y">
          {progress.toClose.map((x) => (
            <li key={`c-${x.siteId}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="min-w-0 font-semibold" dir="auto">
                {siteName(x.siteId)}
              </span>
              <StatusPill tone="bad">{x.thru ? t("today.progress_close", { date: hrDate(x.thru, locale) }) : t("today.progress_close_none")}</StatusPill>
            </li>
          ))}
          {progress.current.map((x) => (
            <li key={x.siteId} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 basis-40 font-semibold" dir="auto">
                {siteName(x.siteId)} <span className="text-xs font-normal tabular-nums text-muted-foreground">{x.people}</span>
              </span>
              <StatusPill tone={x.state === "closed" ? "ok" : x.state === "current" ? "info" : "bad"}>
                {x.state === "closed" ? t("today.progress_closed") : x.state === "current" ? t("today.progress_current") : t("today.progress_stopped", { date: hrDate(x.since, locale) })}
              </StatusPill>
            </li>
          ))}
        </ul>
      </Panel>
    ) : null

  // The supervisor's "my workers by trade" (todaySup): present of working, expired iqamas flagged.
  const trades = useMemo(() => (roles.has("supervisor") ? tradesToday({ today, employees: world.employees, sites: world.sites, thisMonth: world.thisMonth, requests: world.requests, siteIds: access.ctx.sites }) : []), [roles, today, world, access.ctx.sites])
  const tradesPanel =
    roles.has("supervisor") && trades.length > 0 ? (
      <Panel title={t("today.trades")} icon={UsersRound} bodyClassName="p-0">
        <ul className="divide-y">
          {trades.map((x) => (
            <li key={x.trade} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="flex min-w-0 flex-1 basis-40 flex-wrap items-center gap-1.5 font-semibold">
                {t(`trade.${x.trade}` as "trade.mason")}
                {x.expired > 0 && <StatusPill tone="bad">{t("today.trades_expired", { n: x.expired })}</StatusPill>}
              </span>
              <div className="h-2 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-success" style={{ width: `${x.total ? Math.round((x.present / x.total) * 100) : 0}%` }} />
              </div>
              <span className="w-16 text-end text-xs font-bold tabular-nums" dir="ltr">{`${x.present}/${x.total}`}</span>
            </li>
          ))}
        </ul>
      </Panel>
    ) : null

  // AS-04 — management's labour cost by cost centre (the cost report's computation), on Today.
  const lastPay = useMemo(() => (roles.has("management") && money ? latestMain(world.payrolls) : null), [roles, money, world.payrolls])
  const centres = useMemo(() => (lastPay ? costCentres(lastPay) : null), [lastPay])
  const costPanel =
    lastPay && centres && centres.rows.length > 0 ? (
      <Panel title={t("today.cost_title", { month: lastPay.month })} icon={BarChart3} bodyClassName="p-0">
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("today.cost_note")}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-bold">
                  {t("today.cost_col.centre")}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-bold">
                  {t("today.cost_col.account")}
                </th>
                <th scope="col" className="px-3 py-2 text-end font-bold">
                  {t("today.cost_col.people")}
                </th>
                <th scope="col" className="px-3 py-2 text-end font-bold">
                  {t("today.cost_col.cost")}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-bold">
                  {t("today.cost_col.share")}
                </th>
              </tr>
            </thead>
            <tbody>
              {centres.rows.map((r) => (
                <tr key={r.siteId} className="border-t">
                  <td className="px-3 py-2" dir="auto">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {siteName(r.siteId)}
                      {r.siteId === UNASSIGNED_SITE && <StatusPill tone="bad">{t("today.cost_no_output")}</StatusPill>}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground" dir="ltr">
                    {r.account}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                    {r.n}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                    {hrMoney(r.cost)} <span className="text-xs text-muted-foreground">· {hrMoney(r.perHead)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <span className={cn("block h-full rounded-full", r.siteId === UNASSIGNED_SITE ? "bg-destructive/70" : r.kind === "admin" ? "bg-warning" : "bg-module")} style={{ width: `${r.share}%` }} />
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">{`${r.share}%`}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 text-xs font-bold">
              <tr>
                <td className="px-3 py-2" colSpan={3}>
                  {t("today.cost_total")}
                </td>
                <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                  {hrMoney(centres.total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t("today.cost_foot", { accounts: [...new Set(centres.rows.map((r) => `${r.account} ${t(`cost_kind.${r.kind}` as "cost_kind.direct")}`))].join(" · ") })}</p>
      </Panel>
    ) : null

  // --- ST-05 — moving in ---------------------------------------------------------
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
  const ADDS = new Set(["sites", "team", "employees"])
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
              <span className="flex items-center gap-1.5">
                <StatusPill tone="ok">{t("today.step_done")}</StatusPill>
                {ADDS.has(s.key) && (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={target(s.target)}>{t("today.step_add")}</Link>
                  </Button>
                )}
              </span>
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

  const side = [buildPanel, gapsPanel, nitaqatPanel, queuePanel, tradesPanel, progressPanel, costPanel, sitesToday, endingPanel].filter(Boolean)
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
  licence_expired: Truck,
  close_month: Lock,
  injury_overdue: Ambulance,
  injury_due: Ambulance,
  iban_fix: Wallet,
  iban_approve: Wallet,
  payroll_prepare: Landmark,
  payroll_approve: Landmark,
  sheet_today: ClipboardCheck,
  sheet_stopped: ClipboardCheck,
  wait_custody: Hourglass,
  wait_settlement: Hourglass,
  wait_post: Hourglass,
  wait_pay: Hourglass,
  wait_advance: Hourglass,
  wait_reissue: Hourglass,
  wait_plan: Hourglass,
  manpower: UsersRound,
  doc_due: FileWarning,
  iqama_clock: FileWarning,
  probation_end: UserCheck,
  contract_end: CalendarClock,
  leave_return_due: CalendarClock,
  leave_return_warning: CalendarClock,
  leave_return_termination: CalendarClock,
  assign_fix: Wrench,
  settlement_ready: UserCheck,
  exit_reentry: Plane,
  final_exit: Plane,
}

/** Dates in the reader's language; a document type by its name. */
function itemParams(x: TodayItem, t: ReturnType<typeof useTranslations>, locale: string): Record<string, string | number> {
  const out: Record<string, string | number> = { ...x.params }
  for (const k of ["date", "due"]) if (typeof out[k] === "string") out[k] = hrDate(out[k] as string, locale)
  if (typeof out.doc === "string") out.doc = t(`doc.${out.doc}` as "doc.iqama")
  if (typeof out.trade === "string") out.trade = t(`trade.${out.trade}` as "trade.mason")
  return out
}
