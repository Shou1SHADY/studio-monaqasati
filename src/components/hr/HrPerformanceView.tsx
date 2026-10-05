"use client"

// Performance (PRD PF-01…07; the prototype's perfView). No cycle: the empty state and the HR manager's «افتح
// دورة تقييم». A rater: his workers on one sheet — one grade each (dependable · steady · weak), the record read
// beside them, no "all excellent", the drafts sent at once — and his staff, each reviewed on four criteria. The
// office (HR manager, management): the raters calibrated before approval (sent of all, average, % outstanding,
// flags), approved or returned per rater by the HR manager; the distribution by band (+% to money roles); the raise
// proposal, management's one decision, and applying it; the probation views due (the line manager attaches his).

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { BarChart3, ClipboardCheck, Loader2, Plus, Star, TrendingUp, UserCheck, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { DataTable, Figure, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrGrowth } from "@/hooks/useHrGrowth"
import { useHrPeople, useOrgPay } from "@/hooks/useHrPeople"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { usePermissions } from "@/hooks/usePermissions"
import { useScopedCollection } from "@/hooks/useScopedCollection"
import { useTableLabels } from "@/hooks/useTableLabels"
import { hrPeopleScope, hrRolesOf } from "@/lib/hr/access"
import { HR_INJURIES } from "@/lib/hr/collections"
import { lineManagerChain, probationState, type HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import {
  BANDS,
  cycleOpen,
  distribution,
  isApproved,
  isSent,
  mayApplyRaise,
  mayApprove,
  mayRate,
  policyPct,
  raiseFor,
  raisePlan,
  raters,
  recordFacts,
  reviewEligible,
  scoreOf,
  WORKER_GRADES,
  type Band,
  type HrReview,
  type RaterRow,
  type WorkerGrade,
} from "@/lib/hr/performance"
import { addToCycle, applyRaises, approveReviews, decideRaises, gradeWorker, returnReviews, sendDrafts } from "@/lib/hr/performance-writes"
import { HR_REVIEWS, selfId, type SelfReview } from "@/lib/hr/performance"
import { daysBetween } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import { doc, getDoc } from "firebase/firestore"
import { EmployeeActionDialog } from "./EmployeeActionDialogs"
import { useHrViolations } from "./HrViolationList"
import { CycleDialog, RaisePlanDialog, StaffReviewDialog } from "./HrPerfDialogs"
import type { HrPortal } from "./HrShell"

export const BAND_TONE: Record<Band, PillTone> = { A: "ok", B: "info", C: "mute", D: "bad" }
const GRADE_TONE: Record<WorkerGrade, string> = { 3: "border-success bg-success text-success-foreground", 2: "border-cta bg-cta text-cta-foreground", 1: "border-warning bg-warning text-warning-foreground" }

/** «ممتاز · 4.5» — the band and the score. */
export function BandPill({ band, score }: { band: Band; score: number }) {
  const t = useTranslations("Portal.HR")
  return (
    <StatusPill tone={BAND_TONE[band]}>
      {t(`perf.band.${band}`)} · <bdi dir="ltr" className="tabular-nums">{score.toFixed(1)}</bdi>
    </StatusPill>
  )
}

const PROBATION_VIEW_DAYS = 30

export function HrPerformanceView({ access, actor }: { access: HrAccess; portal: HrPortal; actor: HrActor }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const labels = useTableLabels()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const growth = useHrGrowth(access)
  const { employees, sites, siteName } = useHrPeople(access, access.ctx.roles.size > 0)
  const money = access.allowed("pay.view")
  const pays = useOrgPay(access.orgId, money)
  const violations = useHrViolations(access)
  const { data: injData } = useScopedCollection<{ employeeId: string }>(HR_INJURIES, access.orgId, hrPeopleScope(access.ctx), access.ctx.roles.size > 0)
  const manager = access.ctx.owner || access.ctx.roles.has("manager")
  const office = manager || access.ctx.roles.has("management")
  const { orgMembers } = useOrgMembers(manager ? access.orgId : null)
  const { groups } = usePermissions()
  const policies = access.settings.policies
  const weight = policies.recordWeight
  const cycle = growth.cycle
  const open = cycleOpen(cycle, today)
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | { kind: "cycle" } | { kind: "plan" } | { kind: "review"; review: HrReview; self: SelfReview | null } | { kind: "pview"; emp: HrEmployee }>(null)

  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const recOf = useMemo(() => {
    const injuries = (injData ?? []) as Array<{ employeeId: string }>
    return (e: Pick<HrEmployee, "id"> & { att?: unknown }) => recordFacts(e as Parameters<typeof recordFacts>[0], { violations, injuries, today })
  }, [violations, injData, today])
  // The HR managers on the record (from each member's default group): management rates them and applies their raise.
  const hrManagerEmployeeIds = useMemo(() => {
    const uids = new Set<string>()
    for (const m of orgMembers) {
      const g = groups.find((x) => x.id === (m.defaultGroupId as string | undefined))
      const owner = m.id === access.orgId || !m.organizationRole || m.organizationRole === "owner"
      if (hrRolesOf({ owner, permissions: (g?.permissions as string[] | undefined) ?? [] }).has("manager")) uids.add(m.id)
    }
    const ids = employees.filter((e) => e.userId && uids.has(e.userId)).map((e) => e.id)
    if (access.ctx.employeeId && manager && !ids.includes(access.ctx.employeeId)) ids.push(access.ctx.employeeId)
    return ids
  }, [orgMembers, groups, employees, access.orgId, access.ctx.employeeId, manager])

  const run = async (key: string, fn: () => Promise<unknown>, ok: string, params?: Record<string, string | number>) => {
    setBusy(key)
    try {
      const r = await fn()
      toast({ title: t(ok, { n: typeof r === "number" ? r : 0, ...(params ?? {}) }) })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `perf.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  // My team: the reviews naming me — and, for management, those naming no rater (the HR manager's).
  const team = useMemo(() => growth.reviews.filter((r) => (r.raterUserId ? r.raterUserId === access.ctx.uid : access.ctx.roles.has("management") || access.ctx.owner) && mayRate(access.ctx, r)), [growth.reviews, access.ctx])
  const workers = team.filter((r) => r.category === "labour")
  const staff = team.filter((r) => r.category === "staff")
  const drafts = workers.filter((r) => r.st === "draft" && r.sc?.o)
  const rows = useMemo(() => (office ? raters(growth.reviews, weight) : []), [office, growth.reviews, weight])
  const dist = useMemo(() => distribution(growth.reviews, weight), [growth.reviews, weight])
  const sentCount = growth.reviews.filter(isSent).length
  const approved = growth.reviews.filter(isApproved)
  const people = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const plan = useMemo(() => (money ? raisePlan(approved, { pct: cycle?.raise?.pct ?? policyPct(policies), weight, pays, people, today }) : null), [money, approved, cycle?.raise?.pct, policies, weight, pays, people, today])
  const toApply = cycle?.raise?.state === "ok" ? growth.reviews.filter((r) => raiseFor(r, cycle.raise!, weight) && mayApplyRaise(access.ctx, r)) : []
  const missing = useMemo(() => (manager && cycle && open ? employees.filter((e) => reviewEligible(e, today) && !growth.reviews.some((r) => r.employeeId === e.id)) : []), [manager, cycle, open, employees, today, growth.reviews])

  const probations = useMemo(
    () =>
      employees.filter((e) => {
        if (e.status !== "active" || probationState(e, today) !== "on" || daysBetween(today, e.probation.end) > PROBATION_VIEW_DAYS || e.id === access.ctx.employeeId) return false
        if (access.allowed("request.decide")) return true
        const chain = lineManagerChain(e, { employees, supervisorOf: (sid) => sites.find((s) => s.id === sid)?.supervisorEmployeeId ?? null })
        return (chain.id && chain.id === access.ctx.employeeId) || Boolean(e.siteId && access.ctx.sites.includes(e.siteId) && access.ctx.roles.has("supervisor"))
      }),
    [employees, today, access, sites]
  )

  const probationPanel = () => (
      <Panel title={t("perf.prob_title")} icon={UserCheck} count={probations.length}>
        <p className="mb-2 text-xs text-muted-foreground">{t("perf.prob_note")}</p>
        <ul className="divide-y">
          {probations.map((e) => {
            const v = e.probationView
            const chain = lineManagerChain(e, { employees, supervisorOf: (sid) => sites.find((s) => s.id === sid)?.supervisorEmployeeId ?? null })
            const mgr = chain.id ? byId.get(chain.id) : null
            return (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="min-w-0">
                  <span className="block font-semibold">{e.names?.ar && locale === "ar" ? e.names.ar : e.names?.en || e.names?.ar}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`trade.${e.trade}` as "trade.mason")} · {t("perf.prob_ends", { date: hrDate(e.probation.end, locale) })} · {t("perf.prob_manager", { name: mgr ? (locale === "ar" ? mgr.names.ar : mgr.names.en || mgr.names.ar) : "—" })}
                  </span>
                </span>
                {v ? (
                  <StatusPill tone={v.recommend === "confirm" ? "ok" : v.recommend === "end" ? "bad" : "warn"}>{t(`pview.recs.${v.recommend}` as "pview.recs.confirm")}</StatusPill>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "pview", emp: e })}>
                    {t("perf.prob_assess")}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </Panel>
    )

  if (!cycle)
    return (
      <div className="space-y-5">
        <EmptyState
          icon={Star}
          title={t("perf.no_cycle")}
          description={t("perf.no_cycle_desc")}
          action={
            access.allowed("perf.cycle") ? (
              <Button onClick={() => setDialog({ kind: "cycle" })}>
                <Plus size={16} className="me-1.5" aria-hidden="true" />
                {t("perf.open_cycle")}
              </Button>
            ) : undefined
          }
        />
        {probations.length > 0 && probationPanel()}
        {dialog?.kind === "cycle" && <CycleDialog access={access} actor={actor} employees={employees} sites={sites} current={null} recOf={recOf} hrManagerEmployeeIds={hrManagerEmployeeIds} onClose={() => setDialog(null)} />}
        {dialog?.kind === "pview" && <EmployeeActionDialog action="probation_view" onClose={() => setDialog(null)} access={access} actor={actor} emp={dialog.emp} pay={null} sites={sites} employees={employees} />}
      </div>
    )

  const openReview = async (r: HrReview) => {
    let self: SelfReview | null = null
    if (firestore && r.category === "staff")
      try {
        const s = await getDoc(doc(firestore, HR_REVIEWS, selfId(r.id)))
        self = s.exists() ? (s.data() as SelfReview) : null
      } catch {
        // None sent (a missing self-assessment reads as refused) — the form opens without it.
      }
    setDialog({ kind: "review", review: r, self })
  }

  const stateTone: Record<HrReview["st"], PillTone> = { draft: "mute", done: "warn", ok: "info", ack: "ok" }
  const workerCols: DataColumn<HrReview>[] = [
    {
      key: "name",
      header: t("perf.col.worker"),
      cell: (r) => (
        <span>
          <span className="block font-semibold">{r.employeeName}</span>
          <span className="block text-xs text-muted-foreground">
            {t(`trade.${r.trade}` as "trade.mason")} · {t("perf.abs_n", { n: r.rec?.abs ?? 0 })}
            {r.rec?.pen ? ` · ${t("perf.pen_n", { n: r.rec.pen })}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "grade",
      header: t("perf.col.grade"),
      cell: (r) =>
        r.st === "draft" ? (
          <span role="radiogroup" aria-label={t("perf.grade_of", { name: r.employeeName })} className="flex flex-wrap gap-1">
            {WORKER_GRADES.map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={r.sc?.o === g}
                disabled={!open || busy !== null}
                onClick={() => firestore && void run(`g:${r.id}`, () => gradeWorker(firestore, access.ctx, actor, r, r.sc?.o === g ? null : g, { cycle }), "perf.graded")}
                className={cn(
                  "min-h-9 rounded-lg border px-2.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50",
                  r.sc?.o === g ? GRADE_TONE[g] : "bg-background hover:border-module/40"
                )}
              >
                {t(`perf.grade.${g}`)}
              </button>
            ))}
          </span>
        ) : (
          <StatusPill tone={stateTone[r.st]}>{t(`perf.st.${r.st}`)}</StatusPill>
        ),
    },
  ]

  const staffCols: DataColumn<HrReview>[] = [
    { key: "name", header: t("perf.col.name"), cell: (r) => <span className="font-semibold">{r.employeeName}</span>, sortValue: (r) => r.employeeName },
    { key: "trade", header: t("perf.col.trade"), cell: (r) => t(`trade.${r.trade}` as "trade.mason"), hideBelow: "lg" },
    { key: "state", header: t("perf.col.state"), cell: (r) => <StatusPill tone={stateTone[r.st]}>{t(`perf.st.${r.st}`)}</StatusPill> },
    {
      key: "act",
      header: <span className="sr-only">{t("perf.review")}</span>,
      label: t("perf.review"),
      cell: (r) => {
        const s = isSent(r) ? scoreOf(r, weight) : null
        return (
          <span className="flex flex-wrap items-center justify-end gap-1.5">
            {s && <BandPill band={s.band} score={s.score} />}
            {r.st === "draft" && open && (
              <Button size="sm" onClick={() => void openReview(r)}>
                {t("perf.review")}
              </Button>
            )}
          </span>
        )
      },
    },
  ]

  const raterCols: DataColumn<RaterRow>[] = [
    {
      key: "name",
      header: t("perf.col.rater"),
      cell: (x) => {
        const e = x.key !== "__management__" ? byId.get(x.key) : null
        return (
          <span>
            <span className="block font-semibold">{x.key === "__management__" ? t("perf.management") : (x.name ?? "—")}</span>
            {e && (
              <span className="block text-xs text-muted-foreground">
                {t(`trade.${e.trade}` as "trade.mason")} · {siteName(e.siteId) ?? t("sites.unassigned")}
              </span>
            )}
          </span>
        )
      },
    },
    { key: "sent", header: t("perf.col.sent"), numeric: true, cell: (x) => <Figure>{`${x.done.length}/${x.all.length}`}</Figure>, sortValue: (x) => x.done.length },
    { key: "avg", header: t("perf.col.avg"), numeric: true, cell: (x) => <Figure>{x.done.length ? x.avg.toFixed(1) : "—"}</Figure>, sortValue: (x) => x.avg },
    { key: "pa", header: t("perf.col.outstanding"), numeric: true, cell: (x) => <Figure>{`${x.pA}%`}</Figure>, sortValue: (x) => x.pA, hideBelow: "lg" },
    {
      key: "flags",
      header: t("perf.col.flags"),
      cell: (x) => (
        <span className="flex flex-wrap gap-1">
          {x.flag && <StatusPill tone="bad">{t("perf.flag_mostly")}</StatusPill>}
          {x.flat && <StatusPill tone="warn">{t("perf.flag_flat")}</StatusPill>}
          {x.done.length < x.all.length && <StatusPill tone="warn">{t("perf.not_rated", { n: x.all.length - x.done.length })}</StatusPill>}
          {x.ok.length > 0 && <StatusPill tone="info">{t("perf.approved_n", { n: x.ok.length })}</StatusPill>}
        </span>
      ),
    },
    {
      key: "act",
      header: <span className="sr-only">{t("perf.col.decision")}</span>,
      label: t("perf.col.decision"),
      cell: (x) => {
        const pend = x.done.filter((r) => r.st === "done" && mayApprove(access.ctx, r))
        if (access.allowed("perf.approve") && pend.length)
          return (
            <span className="flex flex-wrap justify-end gap-1.5">
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => firestore && void run(`b:${x.key}`, () => returnReviews(firestore, access.ctx, actor, pend, { close: cycle.close }), "perf.returned")}>
                {t("perf.return")}
              </Button>
              <Button size="sm" variant={x.flag ? "outline" : "default"} disabled={busy !== null} onClick={() => firestore && void run(`a:${x.key}`, () => approveReviews(firestore, access.ctx, actor, pend, { year: cycle.year, recOf: (r) => (byId.get(r.employeeId) ? recOf(byId.get(r.employeeId) as HrEmployee) : (r.rec ?? { abs: 0, pen: 0, ot: 0, injury: false })), policies, today }), "perf.approved")}>
                {busy === `a:${x.key}` && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
                {t("perf.approve_n", { n: pend.length })}
              </Button>
            </span>
          )
        if (pend.length && access.ctx.roles.has("management") && x.key === "__management__")
          return (
            <Button size="sm" disabled={busy !== null} onClick={() => firestore && void run(`a:${x.key}`, () => approveReviews(firestore, access.ctx, actor, pend, { year: cycle.year, recOf: (r) => r.rec ?? { abs: 0, pen: 0, ot: 0, injury: false }, policies, today }), "perf.approved")}>
              {t("perf.approve_n", { n: pend.length })}
            </Button>
          )
        // Waiting on another hand (his own review is management's; another rater's set is the HR manager's).
        if (x.pend) return <StatusPill tone="warn">{t("perf.pending_n", { n: x.pend })}</StatusPill>
        return x.done.length ? <StatusPill tone="ok">{t("perf.st.ok")}</StatusPill> : <StatusPill tone="bad">{t("perf.not_started")}</StatusPill>
      },
    },
  ]

  const raise = cycle.raise
  return (
    <div className="space-y-5">
      {!open && <Callout tone="info">{t(today < cycle.open ? "perf.cycle_not_yet" : "perf.cycle_closed", { open: hrDate(cycle.open, locale), close: hrDate(cycle.close, locale) })}</Callout>}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          {workers.length > 0 && (
            <Panel
              title={t("perf.sheet_title")}
              icon={ClipboardCheck}
              count={workers.filter((r) => !isSent(r)).length || undefined}
              actions={
                drafts.length > 0 ? (
                  <Button size="sm" disabled={busy !== null || !open} onClick={() => firestore && void run("send", () => sendDrafts(firestore, access.ctx, actor, drafts, { cycle }), "perf.sent")}>
                    {t("perf.send_n", { n: drafts.length })}
                  </Button>
                ) : undefined
              }
            >
              <p className="mb-2 text-xs text-muted-foreground">{t("perf.sheet_note", { sent: workers.filter(isSent).length, of: workers.length, date: hrDate(cycle.close, locale) })}</p>
              <DataTable columns={workerCols} rows={workers} rowKey={(r) => r.id} caption={t("perf.sheet_title")} labels={labels} empty={null} pageSize={10} bordered={false} rowTone={(r) => (isSent(r) ? "mute" : undefined)} />
            </Panel>
          )}
          {staff.length > 0 && (
            <Panel title={t("perf.staff_title")} icon={Users} count={staff.filter((r) => !isSent(r)).length || undefined}>
              <DataTable columns={staffCols} rows={staff} rowKey={(r) => r.id} caption={t("perf.staff_title")} labels={labels} empty={null} bordered={false} />
            </Panel>
          )}
          {!workers.length && !staff.length && !office && <EmptyState icon={Users} title={t("perf.team_none")} />}
          {office && (
            <Panel
              title={t("perf.raters_title")}
              icon={Star}
              count={rows.reduce((a, x) => a + x.pend, 0) || undefined}
              actions={
                missing.length > 0 ? (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => firestore && void run("add", () => addToCycle(firestore, access.ctx, actor, cycle, { employees, sites, existing: new Set(growth.reviews.map((r) => r.employeeId)), recOf, hrManagerEmployeeIds, today }), "perf.added")}>
                    {t("perf.add_missing", { n: missing.length })}
                  </Button>
                ) : undefined
              }
            >
              <p className="mb-2 text-xs text-muted-foreground">{t("perf.raters_note")}</p>
              <DataTable columns={raterCols} rows={rows} rowKey={(x) => x.key} caption={t("perf.raters_title")} labels={labels} empty={<p className="py-6 text-center text-sm text-muted-foreground">{t("perf.raters_none")}</p>} rowTone={(x) => (x.flag ? "bad" : x.pend ? "warn" : undefined)} bordered={false} />
            </Panel>
          )}
        </div>
        <div className="space-y-5">
          {office && (
            <Panel title={t("perf.dist_title")} icon={BarChart3}>
              <ul className="space-y-2.5" aria-label={t("perf.dist_title")}>
                {BANDS.map((b) => (
                  <li key={b} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="truncate">
                      {t(`perf.band.${b}`)}
                      {money && (cycle.raise?.pct ?? policyPct(policies))[b] ? <span className="ms-1 text-xs text-muted-foreground">+{(cycle.raise?.pct ?? policyPct(policies))[b]}%</span> : null}
                    </span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span className={cn("block h-full rounded-full", b === "A" ? "bg-success" : b === "D" ? "bg-destructive" : "bg-module")} style={{ width: `${sentCount ? (dist[b] / sentCount) * 100 : 0}%` }} />
                    </span>
                    <Figure className="font-bold">{dist[b]}</Figure>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {manager && money && approved.length > 0 && !raise && plan && (
            <Panel title={t("perf.raises_title")} icon={TrendingUp}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 flex-1 text-sm">{t("perf.raise_ready", { n: approved.length, total: hrMoney(plan.total) })}</p>
                <Button size="sm" onClick={() => setDialog({ kind: "plan" })}>
                  <TrendingUp size={14} className="me-1.5" aria-hidden="true" />
                  {t("perf.raise_prepare")}
                </Button>
              </div>
            </Panel>
          )}
          {raise && (office || money) && (
            <Panel title={t("perf.raises_title")} icon={TrendingUp}>
              <Callout tone={raise.state === "mg" ? "warn" : "info"} title={raise.state === "mg" ? t("perf.raise_with_mgmt", { n: raise.n }) : t("perf.raise_approved", { date: hrDate(raise.eff, locale) })}>
                {money && plan ? `${t("perf.raise_month", { total: hrMoney(plan.total) })} · ` : ""}
                {t("perf.raise_from", { date: hrDate(raise.eff, locale) })} · {BANDS.map((b) => `${b} +${raise.pct[b]}%`).join(" · ")} · {t("perf.raise_by", { name: raise.byName ?? "—" })}
              </Callout>
              {raise.state === "mg" && access.allowed("perf.raise.decide") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy !== null} onClick={() => firestore && void run("ok", async () => {
                    await decideRaises(firestore, access.ctx, actor, cycle, true)
                    // The HR managers' raises are management's to apply (RL-02) — with the same decision.
                    const ok = { ...cycle, raise: { ...raise, state: "ok" as const } }
                    return applyRaises(firestore, access.ctx, actor, ok, growth.reviews, { policies, today })
                  }, "perf.raise_decided_ok")}>
                    {t("perf.raise_approve")}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => firestore && void run("no", () => decideRaises(firestore, access.ctx, actor, cycle, false), "perf.raise_decided_no")}>
                    {t("perf.raise_return")}
                  </Button>
                </div>
              )}
              {raise.state === "ok" && toApply.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">{t("perf.apply_note", { n: toApply.length, date: hrDate(raise.eff, locale) })}</span>
                  <Button size="sm" disabled={busy !== null} onClick={() => firestore && void run("apply", () => applyRaises(firestore, access.ctx, actor, cycle, growth.reviews, { policies, today }), "perf.applied")}>
                    {busy === "apply" && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
                    {t("perf.apply_n", { n: toApply.length })}
                  </Button>
                </div>
              )}
            </Panel>
          )}
          {probations.length > 0 && probationPanel()}
        </div>
      </div>
      {dialog?.kind === "plan" && plan && <RaisePlanDialog access={access} actor={actor} cycle={cycle} reviews={approved} employees={employees} pays={pays} pct={policyPct(policies)} weight={weight} onClose={() => setDialog(null)} />}
      {dialog?.kind === "review" && <StaffReviewDialog access={access} actor={actor} review={dialog.review} cycle={cycle} self={dialog.self} siteName={siteName(dialog.review.siteId) ?? t("sites.unassigned")} weight={weight} onClose={() => setDialog(null)} />}
      {dialog?.kind === "pview" && <EmployeeActionDialog action="probation_view" onClose={() => setDialog(null)} access={access} actor={actor} emp={dialog.emp} pay={null} sites={sites} employees={employees} />}
    </div>
  )
}
