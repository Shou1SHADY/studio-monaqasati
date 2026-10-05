"use client"

// The employee file (PRD EM-01, §5 "Employee file", the prototype's openEmp):
// a full header (number · name · trade · workplace · nationality · years of
// service · status with its date · probation), four tiles — leave balance ·
// pay and cost · nearest document · this month's attendance — and five
// segments: overview (blocking facts first, personal, job and contract,
// contact and bank) · documents · attendance and leave · pay and payroll (only
// for the roles that see pay) · requests and log. For everyone else the pay
// tile reads "•••" and the pay segment is not there at all (RL-03). Nobody
// acts on his own record where that would be approving for himself (RL-02):
// pay, probation, exit, IBAN — the HR manager's own pay is management's. A
// supervisor opens his own workers' files from his site (RL-01), without pay.

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, orderBy, query } from "firebase/firestore"
import {
  ArrowRightLeft,
  BadgeCheck,
  CalendarClock,
  ClipboardCheck,
  FileClock,
  FileSignature,
  Hash,
  HandCoins,
  Import,
  Link2,
  Loader2,
  LogOut,
  Plane,
  TrendingUp,
  UserCheck,
  UserCog,
  Wallet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { SegmentedNav, type Segment } from "@/components/module-ui/SegmentedNav"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useEmployeePay, useHrPeople } from "@/hooks/useHrPeople"
import { useHrRequests } from "@/hooks/useHrRequests"
import type { HrAccess } from "@/hooks/useHrAccess"
import { usePermissions } from "@/hooks/usePermissions"
import { Link } from "@/i18n/routing"
import { userIsHrManager } from "@/lib/hr/access"
import { assumesPresence, attendanceId, employeeMonth, onLeaveOn, type WorkplaceMonth } from "@/lib/hr/attendance"
import { HR_ATTENDANCE, HR_EMPLOYEES } from "@/lib/hr/collections"
import { docRows, docState } from "@/lib/hr/documents"
import {
  displayName,
  lineManagerChain,
  payChangeRefusal,
  probationState,
  serviceDays,
  statusFact,
  statusOn,
  todayStateOf,
  type HrEmployee,
} from "@/lib/hr/employee"
import { applyDueMoves, HR_LOG, type HrActor, type LogEntry } from "@/lib/hr/employee-writes"
import { empNo, hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { leaveBalance } from "@/lib/hr/leave"
import { gosiRates, wageOf } from "@/lib/hr/pay"
import { monthlyEosAccrual } from "@/lib/hr/eos"
import { leaveReturn, type HrRequestKind } from "@/lib/hr/requests"
import { UNASSIGNED_SITE } from "@/lib/hr/sites"
import { addDays, daysBetween, r2, serviceYears, STATUTORY } from "@/lib/hr/statutory"
import { EmployeeActionDialog, type EmployeeAction } from "./EmployeeActionDialogs"
import { StartExitDialog } from "./HrExitPanel"
import { HrFileAttLeave } from "./HrFileAttLeave"
import { HrFileDocs } from "./HrFileDocs"
import { HrFileGrowth } from "./HrFileGrowth"
import { HrFileLog } from "./HrFileLog"
import { HrFileOverview } from "./HrFileOverview"
import { HrFilePay } from "./HrFilePay"
import { ReturnFromLeave } from "./HrRequestList"
import { RecordViolationDialog, useHrViolations } from "./HrViolationList"
import { NewRequestDialog } from "./NewRequestDialog"
import type { FileView } from "./hr-file-view"
import type { HrPortal } from "./HrShell"
import { DOC_TONE, STATUS_TONE } from "./HrPeopleView"

type Seg = "ov" | "docs" | "att" | "pay" | "log"

/** One workplace month of the employee's place — read by `get`, as the rules let each role. */
function useSiteMonth(orgId: string | null, siteId: string, month: string) {
  const firestore = useFirestore()
  const ref = useMemoFirebase(() => (firestore && orgId ? doc(firestore, HR_ATTENDANCE, attendanceId(orgId, siteId, month)) : null), [firestore, orgId, siteId, month])
  const { data } = useDoc(ref)
  return (data as unknown as WorkplaceMonth | null) ?? null
}

/** RL-02 — is the platform user behind this record an HR manager (his DEFAULT group, as the rules read it)? */
function useUserIsHrManager(orgId: string | null, userId: string | null | undefined) {
  const firestore = useFirestore()
  const { groups } = usePermissions()
  const ref = useMemoFirebase(() => (firestore && userId ? doc(firestore, "users", userId) : null), [firestore, userId])
  const { data } = useDoc(ref)
  return useMemo(() => {
    if (!data || !orgId) return false
    const u = data as unknown as { id: string; organizationId?: string | null; organizationRole?: string | null; defaultGroupId?: string | null }
    const g = groups.find((x) => x.id === u.defaultGroupId) as { organizationId?: string | null; permissions?: string[] } | undefined
    return userIsHrManager({ ...u, id: userId as string }, g ?? null, orgId)
  }, [data, groups, orgId, userId])
}

export function HrEmployeeFile({ access, portal, employeeId, actor }: { access: HrAccess; portal: HrPortal; employeeId: string; actor: HrActor }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const today = todayDay()
  const { employees, sites, siteName, isLoading } = useHrPeople(access)
  const emp = employees.find((e) => e.id === employeeId) ?? null
  const money = access.seesPay(employeeId)
  const { pay } = useEmployeePay(employeeId, money)
  const [seg, setSeg] = useState<Seg>("ov")
  const [action, setAction] = useState<{ id: EmployeeAction; docType?: string | null; requestId?: string | null } | null>(null)
  const [newReq, setNewReq] = useState<HrRequestKind | null>(null)
  const { requests: allRequests } = useHrRequests(access)
  const requests = useMemo(() => allRequests.filter((r) => r.employeeId === employeeId), [allRequests, employeeId])
  const overdueLeave = useMemo(() => {
    for (const r of requests) {
      const ret = leaveReturn(r, today)
      if (ret) return { r, ret }
    }
    return null
  }, [requests, today])
  const allViolations = useHrViolations(access)
  const violations = useMemo(() => allViolations.filter((v) => v.employeeId === employeeId), [allViolations, employeeId])
  const [recording, setRecording] = useState(false)
  const [exiting, setExiting] = useState(false)
  const own = Boolean(access.ctx.employeeId) && access.ctx.employeeId === employeeId && !access.ctx.owner
  const isHrManager = useUserIsHrManager(access.orgId, emp?.userId)

  const month = today.slice(0, 7)
  const lastMonth = addDays(`${month}-01`, -1).slice(0, 7)
  const placeId = emp?.siteId || UNASSIGNED_SITE
  const thisWm = useSiteMonth(access.orgId, placeId, month)
  const lastWm = useSiteMonth(access.orgId, placeId, lastMonth)

  const logQ = useMemoFirebase(() => (firestore ? query(collection(firestore, HR_EMPLOYEES, employeeId, HR_LOG), orderBy("at", "desc")) : null), [firestore, employeeId])
  const { data: logData } = useCollection(logQ)
  const log = useMemo(() => (logData ?? []) as unknown as (LogEntry & { id: string })[], [logData])

  // AS-03 — a move dated ahead takes effect on its day: the HR manager's screen applies it once due.
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current || !firestore || !emp?.move || emp.move.on > today || !access.allowed("employee.assign")) return
    applied.current = true
    void applyDueMoves(firestore, access.ctx, actor, [emp])
  }, [firestore, emp, today, access, actor])

  if (isLoading) {
    return (
      <div className="flex justify-center p-16">
        <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
      </div>
    )
  }
  if (!emp) {
    const back = access.tabs.includes("people") ? `/${portal}/hr/people` : `/${portal}/hr/sites`
    return <EmptyState icon={FileClock} title={t("file.missing")} description={t("file.missing_desc")} action={<Button asChild variant="outline"><Link href={back}>{t("file.back")}</Link></Button>} />
  }
  if (!emp.names) {
    // A record from before HR 1.0 — the migration brings it onto the card.
    return <Callout tone="warn">{t("file.legacy")}</Callout>
  }

  const site = sites.find((s) => s.id === emp.siteId) ?? null
  const assumed = assumesPresence(placeId, site?.type ?? null)
  const window = access.settings.policies.renewWindowDays
  const rows = docRows(emp, today, window)
  const nearest = rows.filter((r) => r.expiry).sort((a, b) => (a.expiry as string).localeCompare(b.expiry as string))[0] ?? null
  const service = emp.join ? serviceYears(emp.join, today) : 0
  const entitlement = service >= STATUTORY.leave.fiveYears ? STATUTORY.leave.afterFive : STATUTORY.leave.base
  const balance = emp.join ? leaveBalance(emp.join, today, emp.leaveTaken ?? 0, emp.openingLeave ?? 0) : null
  const status = statusOn(emp, today)
  const pState = emp.probation ? probationState(emp, today) : null
  const thisMonthAtt = employeeMonth(thisWm, emp.id)
  const onLeave = onLeaveOn(requests, today).has(emp.id)
  const leaveTo = onLeave ? (requests.find((r) => r.kind === "leave" && r.state === "approved" && r.leave && r.leave.from <= today && r.leave.to >= today)?.leave?.to ?? null) : null
  const todayState = todayStateOf(emp.id, thisWm?.days?.[today], onLeave)
  const fact = statusFact(emp, { leaveTo, today: todayState })
  const wage = pay ? wageOf(pay) : 0
  const gosi = pay ? gosiRates(emp.nationality, emp.join) : null
  const employerGosi = pay && gosi ? r2((pay.basic + pay.housing) * gosi.employer) : 0
  const companyCost = pay ? r2(wage + employerGosi + monthlyEosAccrual(wage, service)) : 0
  const chain = lineManagerChain(emp, { employees, supervisorOf: (sid) => sites.find((s) => s.id === sid)?.supervisorEmployeeId ?? null, isHrManager })
  const managerEmp = chain.id ? (employees.find((e) => e.id === chain.id) ?? null) : null
  const docsDue = rows.filter((r) => !r.open && (r.state === "expired" || r.state === "d30" || r.state === "d60")).length
  const pending = requests.filter((r) => r.state === "pending" || r.state === "endorsed").length
  const days = emp.join ? serviceDays(emp.join, today) : 0
  // The line manager writes his probation view (EM-05): the manager on the card, or the workplace's supervisor.
  const isLineManager = Boolean(
    (managerEmp?.userId && managerEmp.userId === access.ctx.uid && !chain.derived) || (emp.siteId && access.ctx.sites.includes(emp.siteId) && access.ctx.roles.has("supervisor"))
  )
  const payRefusal = payChangeRefusal(access.ctx, { own: access.ctx.employeeId === emp.id, isHrManager })
  const mayPay = money && payRefusal === null && emp.status !== "left"
  const active = emp.status !== "left"

  const view: FileView = {
    access,
    actor,
    portal,
    emp,
    pay,
    money,
    employees,
    sites,
    site,
    siteName,
    today,
    locale,
    requests,
    violations,
    log,
    rows,
    manager: { ...chain, name: managerEmp ? displayName(managerEmp, locale) : null },
    todayState,
    thisWm,
    lastWm,
    assumed,
    service,
    entitlement,
    balance,
    wage,
    open: (id, opts) => setAction({ id, docType: opts?.docType ?? null, requestId: opts?.requestId ?? null }),
  }

  const segments: Segment[] = [
    { id: "ov", label: t("file.seg.ov") },
    { id: "docs", label: t("file.seg.docs"), tone: rows.some((r) => r.state === "expired" || r.state === "d30") ? "bad" : undefined, count: docsDue || undefined },
    { id: "att", label: t("file.seg.att") },
    ...(money ? [{ id: "pay", label: t("file.seg.pay") }] : []),
    { id: "log", label: t("file.seg.log"), count: pending || undefined, tone: "warn" as const },
  ]

  const acts: { id: EmployeeAction; icon: typeof Wallet; show: boolean; label?: string }[] = [
    { id: "move", icon: ArrowRightLeft, show: access.allowed("employee.assign") && active, label: emp.siteId ? undefined : t("file.act.assign") },
    { id: "pay", icon: Wallet, show: mayPay },
    { id: "raise", icon: TrendingUp, show: money && access.ctx.roles.has("manager") && active && (status === "active" || status === "leave") },
    { id: "commission", icon: HandCoins, show: money && access.allowed("pay.change") && active && !own },
    // Only while it runs (art. 53): past its end with no decision it is over, never "open forever".
    { id: "probation", icon: BadgeCheck, show: access.allowed("request.decide") && pState === "on" && active && emp.status !== "leaving" && !own },
    { id: "probation_view", icon: ClipboardCheck, show: pState === "on" && active && emp.status !== "leaving" && emp.userId !== access.ctx.uid && access.ctx.employeeId !== emp.id && (isLineManager || access.allowed("request.decide")) },
    { id: "contract", icon: FileSignature, show: access.allowed("exit.manage") && emp.contract?.type === "fixed" && (emp.status === "active" || emp.status === "leave" || emp.status === "expected") && !own },
    { id: "manager", icon: UserCog, show: access.allowed("employee.edit") && active },
    { id: "start", icon: UserCheck, show: access.allowed("employee.assign") && emp.status === "expected" },
    // IM-04 — once, for someone who joined before the system and has taken no leave here.
    { id: "opening", icon: Import, show: access.allowed("employee.edit") && active && !emp.opening && (emp.leaveTaken ?? 0) === 0 && days > 30 },
    { id: "renew", icon: CalendarClock, show: access.allowed("documents.manage") && active },
    { id: "numbers", icon: Hash, show: access.allowed("documents.manage") && active },
    { id: "link", icon: Link2, show: access.allowed("employee.edit") && !own },
  ]

  const tile = (label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <div className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="mt-1 truncate text-lg font-black tabular-nums text-foreground sm:text-xl">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
  const nearestLeft = nearest?.expiry ? daysBetween(today, nearest.expiry) : null
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-US", { month: "long" })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-module/10 px-2 py-0.5 text-xs font-bold tabular-nums text-module" dir="ltr">
              {empNo(emp.no)}
            </span>
            <h2 className="truncate text-lg font-black text-foreground" dir="auto">
              {displayName(emp, locale)}
            </h2>
            {locale === "ar" && emp.names.en && (
              <span className="text-sm text-muted-foreground" dir="ltr">
                {emp.names.en}
              </span>
            )}
            <StatusPill tone={STATUS_TONE[status]}>{t(`status.${status}`)}</StatusPill>
            {fact && <StatusPill tone={fact.kind === "absent" ? "bad" : fact.kind === "unassigned" || fact.kind === "leaving" ? "warn" : "violet"}>{t(`file.fact.${fact.kind}`, { date: "date" in fact && fact.date ? hrDate(fact.date, locale) : "—" })}</StatusPill>}
            {pState === "on" && <StatusPill tone="info">{t("file.on_probation", { end: hrDate(emp.probation.end, locale) })}</StatusPill>}
          </div>
          <p className="text-sm text-muted-foreground">
            {t(`trade.${emp.trade}` as "trade.mason")} · {siteName(emp.siteId) ?? t("sites.unassigned")} · {t(`nat.${emp.nationality}` as "nat.sa")} · {t("file.service_years", { n: Math.floor(service) })}
          </p>
          {emp.move && (
            <p className="text-xs font-semibold text-module">
              {t("file.move_scheduled", { to: siteName(emp.move.to) ?? t("sites.unassigned"), date: hrDate(emp.move.on, locale) })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {access.ctx.roles.has("manager") && active && (
            <>
              <Button size="sm" variant="outline" onClick={() => setNewReq("leave")}>
                <Plane size={14} className="me-1.5" aria-hidden="true" />
                {t("req.new_leave")}
              </Button>
              {money && (
                <Button size="sm" variant="outline" onClick={() => setNewReq("advance")}>
                  <HandCoins size={14} className="me-1.5" aria-hidden="true" />
                  {t("req.new_advance")}
                </Button>
              )}
            </>
          )}
          {access.allowed("exit.manage") && (emp.status === "active" || emp.status === "expected" || emp.status === "leave") && !own && (
            <Button size="sm" variant="outline" onClick={() => setExiting(true)}>
              <LogOut size={14} className="me-1.5" aria-hidden="true" />
              {t("exit.start")}
            </Button>
          )}
          {acts
            .filter((a) => a.show)
            .map((a) => (
              <Button key={a.id} size="sm" variant="outline" onClick={() => setAction({ id: a.id })}>
                <a.icon size={14} className="me-1.5" aria-hidden="true" />
                {a.label ?? t(`file.act.${a.id}`)}
              </Button>
            ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tile(
          t("file.tile.leave"),
          balance == null ? "—" : <span className={balance < 0 ? "text-destructive" : undefined}>{t("file.days", { n: balance })}</span>,
          t("file.per_year", { n: entitlement })
        )}
        {tile(
          t("file.tile.wage"),
          money ? <span dir="ltr">{pay ? hrMoney(wage) : "—"}</span> : <span aria-label={t("file.pay_hidden")}>•••</span>,
          money ? (pay ? t("file.company_cost", { cost: hrMoney(companyCost) }) : t("file.no_pay")) : t("file.pay_hidden")
        )}
        {tile(
          t("file.tile.document"),
          nearest?.expiry ? t("file.doc_sub", { doc: t(`doc.${nearest.type}`), date: hrDate(nearest.expiry, locale) }) : "—",
          nearest?.expiry ? (
            <StatusPill tone={DOC_TONE[docState(nearest.expiry, today, window)]}>{nearestLeft != null && nearestLeft >= 0 ? t("file.days_left", { n: nearestLeft }) : t("file.expired_ago", { n: Math.abs(nearestLeft ?? 0) })}</StatusPill>
          ) : (
            t("people.no_docs")
          )
        )}
        {tile(
          t("file.tile.attendance", { month: monthName }),
          assumed ? t("file.att_assumed_short") : t("file.days", { n: thisMonthAtt.present + thisMonthAtt.declared }),
          t("file.att_sub", { absent: thisMonthAtt.absent, ot: thisMonthAtt.overtimeHours })
        )}
      </div>

      {overdueLeave && (
        // AT-05 — not back after his leave: absence without leave, and art. 80 counting.
        <Callout tone={overdueLeave.ret.stage === "due" ? "warn" : "block"} title={t("ret.not_back", { n: overdueLeave.ret.daysLate })}>
          <span className="block">{t(`ret.stage.${overdueLeave.ret.stage}`)}</span>
          <span className="mt-2 block">
            <ReturnFromLeave access={access} r={overdueLeave.r} actor={actor} on={today} />
          </span>
        </Callout>
      )}

      <SegmentedNav segments={segments} active={seg} onSelect={(s) => setSeg(s as Seg)} ariaLabel={t("file.segments")} />

      {seg === "ov" && <HrFileOverview v={view} />}
      {seg === "ov" && <HrFileGrowth v={view} part="perf" />}
      {seg === "docs" && <HrFileDocs v={view} />}
      {seg === "docs" && <HrFileGrowth v={view} part="certs" />}
      {seg === "att" && <HrFileAttLeave v={view} />}
      {seg === "pay" && money && <HrFilePay v={view} companyCost={companyCost} employerGosi={employerGosi} />}
      {seg === "log" && <HrFileLog v={view} onRecordViolation={() => setRecording(true)} />}

      {exiting && <StartExitDialog access={access} actor={actor} emp={emp as HrEmployee} onClose={() => setExiting(false)} />}
      {recording && <RecordViolationDialog access={access} actor={actor} employeeId={employeeId} onClose={() => setRecording(false)} />}
      {newReq && <NewRequestDialog kind={newReq} onClose={() => setNewReq(null)} access={access} actor={actor} emp={emp as HrEmployee} pay={pay} sites={sites} existing={requests} />}

      {action && (
        <EmployeeActionDialog
          action={action.id}
          docType={action.docType ?? null}
          requestId={action.requestId ?? null}
          onClose={() => setAction(null)}
          access={access}
          actor={actor}
          emp={emp as HrEmployee}
          pay={pay}
          sites={sites}
          employees={employees}
          requests={requests}
          managerName={view.manager.name}
          isHrManager={isHrManager}
        />
      )}
    </div>
  )
}
