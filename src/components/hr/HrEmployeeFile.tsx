"use client"

// The employee file (PRD §5 "Employee file", EM-06): the header, four tiles
// (service · leave balance · wage · nearest document), five segments
// (job · documents · pay · leave · log) and the actions the viewer's role
// holds. Pay exists on this page only for the roles that may see it — for
// everyone else the tile and the segment are not there at all.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, orderBy, query } from "firebase/firestore"
import { ArrowRightLeft, BadgeCheck, CalendarClock, FileClock, Gavel, HandCoins, History, Inbox, Link2, Loader2, LogOut, Plane, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { SegmentedNav, type Segment } from "@/components/module-ui/SegmentedNav"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useEmployeePay, useHrPeople } from "@/hooks/useHrPeople"
import { useHrRequests } from "@/hooks/useHrRequests"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useToast } from "@/hooks/use-toast"
import { Link } from "@/i18n/routing"
import { HR_EMPLOYEES } from "@/lib/hr/collections"
import { docState, DOC_TYPES, legalOnSite } from "@/lib/hr/documents"
import { displayName, onProbation, serviceDays, type HrEmployee } from "@/lib/hr/employee"
import { approveIban, fixIban, HR_LOG, type HrActor, type LogEntry } from "@/lib/hr/employee-writes"
import { empNo, hrDate, hrMoney, nearestDocument, todayDay } from "@/lib/hr/format"
import { leaveBalance } from "@/lib/hr/leave"
import { gosiRates, wageOf } from "@/lib/hr/pay"
import { serviceYears } from "@/lib/hr/statutory"
import { tradeOf } from "@/lib/hr/trades"
import { HrWriteError } from "@/lib/hr/write-guard"
import type { HrRequestKind } from "@/lib/hr/requests"
import { EmployeeActionDialog, type EmployeeAction } from "./EmployeeActionDialogs"
import { HrExitPanel, StartExitDialog } from "./HrExitPanel"
import { HrRequestList } from "./HrRequestList"
import { HrViolationList, RecordViolationDialog, useHrViolations } from "./HrViolationList"
import { NewRequestDialog } from "./NewRequestDialog"
import type { HrPortal } from "./HrShell"
import { DOC_TONE, STATUS_TONE } from "./HrPeopleView"

type Seg = "job" | "docs" | "pay" | "leave" | "log"

export function HrEmployeeFile({ access, portal, employeeId, actor }: { access: HrAccess; portal: HrPortal; employeeId: string; actor: HrActor }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const today = todayDay()
  const { employees, sites, siteName, isLoading } = useHrPeople(access.orgId)
  const emp = employees.find((e) => e.id === employeeId) ?? null
  const money = access.seesPay(employeeId)
  const { pay } = useEmployeePay(employeeId, money)
  const [seg, setSeg] = useState<Seg>("job")
  const [action, setAction] = useState<EmployeeAction | null>(null)
  const [newReq, setNewReq] = useState<HrRequestKind | null>(null)
  const { requests: allRequests } = useHrRequests(access)
  const requests = useMemo(() => allRequests.filter((r) => r.employeeId === employeeId), [allRequests, employeeId])
  const allViolations = useHrViolations(access)
  const violations = useMemo(() => allViolations.filter((v) => v.employeeId === employeeId), [allViolations, employeeId])
  const [recording, setRecording] = useState(false)
  const [exiting, setExiting] = useState(false)

  const logQ = useMemoFirebase(() => (firestore ? query(collection(firestore, HR_EMPLOYEES, employeeId, HR_LOG), orderBy("at", "desc")) : null), [firestore, employeeId])
  const { data: logData } = useCollection(logQ)
  const log = (logData ?? []) as unknown as (LogEntry & { id: string })[]

  const facts = useMemo(() => {
    if (!emp) return null
    const docs = emp.docs ?? {}
    return {
      service: serviceYears(emp.join, today),
      days: serviceDays(emp.join, today),
      balance: emp.join ? leaveBalance(emp.join, today, emp.leaveTaken ?? 0, emp.openingLeave ?? 0) : null,
      nearest: nearestDocument(docs, today, access.settings.policies.renewWindowDays),
      legal: legalOnSite({ nationality: emp.nationality, docs }, today),
      probation: emp.probation ? onProbation(emp, today) : false,
    }
  }, [emp, today, access.settings.policies.renewWindowDays])

  if (isLoading) {
    return (
      <div className="flex justify-center p-16">
        <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
      </div>
    )
  }
  if (!emp || !facts) {
    return <EmptyState icon={FileClock} title={t("file.missing")} description={t("file.missing_desc")} action={<Button asChild variant="outline"><Link href={`/${portal}/hr/people`}>{t("file.back")}</Link></Button>} />
  }
  if (!emp.names) {
    // A record from before HR 1.0 — the migration brings it onto the card.
    return <Callout tone="warn">{t("file.legacy")}</Callout>
  }

  const segments: Segment[] = [
    { id: "job", label: t("file.seg.job") },
    { id: "docs", label: t("file.seg.docs"), tone: facts.nearest && (facts.nearest.state === "expired" || facts.nearest.state === "d30") ? "bad" : undefined, count: facts.nearest && facts.nearest.state !== "valid" ? DOC_TYPES.filter((d) => emp.docs?.[d] && docState(emp.docs[d], today, access.settings.policies.renewWindowDays) !== "valid").length || undefined : undefined },
    ...(money ? [{ id: "pay", label: t("file.seg.pay") }] : []),
    { id: "leave", label: t("file.seg.leave") },
    { id: "log", label: t("file.seg.log"), count: requests.filter((r) => r.state === "pending" || r.state === "endorsed").length || undefined, tone: "warn" as const },
  ]

  const acts: { id: EmployeeAction; icon: typeof Wallet; show: boolean }[] = [
    { id: "move", icon: ArrowRightLeft, show: access.allowed("employee.assign") && emp.status !== "left" },
    { id: "pay", icon: Wallet, show: money && access.allowed("pay.change") && emp.status !== "left" && (access.ctx.owner || access.ctx.employeeId !== emp.id) },
    { id: "probation", icon: BadgeCheck, show: access.allowed("request.decide") && !emp.probation?.decision && emp.status !== "left" },
    { id: "renew", icon: CalendarClock, show: access.allowed("documents.manage") && emp.status !== "left" },
    { id: "link", icon: Link2, show: access.allowed("employee.edit") },
  ]

  const tile = (label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )

  const trade = tradeOf(emp.trade)
  const gosi = pay ? gosiRates(emp.nationality, emp.join) : null

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
            <StatusPill tone={STATUS_TONE[emp.status ?? "active"]}>{t(`status.${emp.status ?? "active"}`)}</StatusPill>
            {facts.probation && <StatusPill tone="info">{t("file.on_probation", { end: hrDate(emp.probation.end, locale) })}</StatusPill>}
          </div>
          <p className="text-sm text-muted-foreground">
            {t(`trade.${emp.trade}` as "trade.mason")} · {siteName(emp.siteId) ?? t("sites.unassigned")} · {t(`nat.${emp.nationality}` as "nat.sa")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {access.ctx.roles.has("manager") && emp.status !== "left" && (
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
          {access.allowed("exit.manage") && (emp.status === "active" || emp.status === "expected" || emp.status === "leave") && (access.ctx.owner || access.ctx.employeeId !== emp.id) && (
            <Button size="sm" variant="outline" onClick={() => setExiting(true)}>
              <LogOut size={14} className="me-1.5" aria-hidden="true" />
              {t("exit.start")}
            </Button>
          )}
          {acts
            .filter((a) => a.show)
            .map((a) => (
              <Button key={a.id} size="sm" variant="outline" onClick={() => setAction(a.id)}>
                <a.icon size={14} className="me-1.5" aria-hidden="true" />
                {t(`file.act.${a.id}`)}
              </Button>
            ))}
        </div>
      </div>

      {!facts.legal && <Callout tone="block">{t("file.iqama_expired")}</Callout>}

      <HrExitPanel access={access} actor={actor} emp={emp as HrEmployee} pay={pay} sites={sites} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile(t("file.tile.service"), t("file.years", { n: facts.service.toFixed(1) }), t("file.since", { date: hrDate(emp.join, locale) }))}
        {tile(t("file.tile.leave"), facts.balance == null ? "—" : t("file.days", { n: facts.balance }), t("file.leave_taken", { n: emp.leaveTaken ?? 0 }))}
        {money && tile(t("file.tile.wage"), <span dir="ltr">{pay ? hrMoney(wageOf(pay)) : "—"}</span>, pay ? t("file.basic_line", { basic: hrMoney(pay.basic) }) : t("file.no_pay"))}
        {tile(
          t("file.tile.document"),
          facts.nearest ? <StatusPill tone={DOC_TONE[facts.nearest.state]}>{t(`doc_state.${facts.nearest.state}`)}</StatusPill> : "—",
          facts.nearest ? t("file.doc_sub", { doc: t(`doc.${facts.nearest.type}`), date: hrDate(facts.nearest.expiry, locale) }) : t("people.no_docs")
        )}
      </div>

      <SegmentedNav segments={segments} active={seg} onSelect={(s) => setSeg(s as Seg)} ariaLabel={t("file.segments")} />

      {seg === "job" && (
        <Panel title={t("file.seg.job")}>
          <KeyValueRow label={t("new.trade")} value={t(`trade.${emp.trade}` as "trade.mason")} />
          <KeyValueRow label={t("file.category")} value={t(`category.${trade?.category ?? emp.category}`)} />
          <KeyValueRow label={t("new.site")} value={siteName(emp.siteId) ?? t("sites.unassigned")} />
          <KeyValueRow label={t("new.source")} value={t(`source.${emp.source}`)} />
          <KeyValueRow label={t("new.join")} value={hrDate(emp.join, locale)} />
          <KeyValueRow label={t("new.contract")} value={emp.contract?.type === "fixed" ? t("file.fixed_until", { date: hrDate(emp.contract.end, locale) }) : t("contract.open")} />
          <KeyValueRow
            label={t("file.probation")}
            value={
              emp.probation?.decision
                ? t(`file.probation_${emp.probation.decision}`)
                : t("file.probation_until", { date: hrDate(emp.probation?.end, locale) })
            }
          />
          <KeyValueRow label={t("new.id_no")} value={emp.idNo || "—"} ltr />
          <KeyValueRow label={t("new.gender")} value={t(`gender.${emp.gender}`)} />
          <KeyValueRow label={t("file.my_file")} value={emp.userId ? t("file.linked_yes") : t("file.linked_no")} />
        </Panel>
      )}

      {seg === "docs" && (
        <Panel title={t("file.seg.docs")}>
          {DOC_TYPES.filter((d) => d !== "iqama" || emp.nationality !== "sa").map((d) => {
            const exp = emp.docs?.[d]
            const st = docState(exp, today, access.settings.policies.renewWindowDays)
            return (
              <KeyValueRow
                key={d}
                label={t(`doc.${d}`)}
                value={
                  <span className="inline-flex items-center gap-2">
                    {exp && <span className="text-muted-foreground">{hrDate(exp, locale)}</span>}
                    <StatusPill tone={DOC_TONE[st]}>{t(`doc_state.${st}`)}</StatusPill>
                  </span>
                }
              />
            )
          })}
        </Panel>
      )}

      {seg === "pay" && money && (
        <Panel title={t("file.seg.pay")}>
          {pay ? (
            <>
              <KeyValueRow label={t("pay.basic")} value={hrMoney(pay.basic)} ltr />
              <KeyValueRow label={t("pay.housing")} value={hrMoney(pay.housing)} ltr />
              <KeyValueRow label={t("pay.transport")} value={hrMoney(pay.transport)} ltr />
              <KeyValueRow label={t("pay.wage")} value={hrMoney(wageOf(pay))} ltr strong />
              {gosi && <KeyValueRow label={t("file.gosi")} value={t("file.gosi_line", { emp: (gosi.employee * 100).toFixed(2), co: (gosi.employer * 100).toFixed(2) })} />}
              <KeyValueRow label={t("file.iban")} value={pay.iban || "—"} ltr />
              <IbanActions access={access} employeeId={employeeId} actor={actor} state={pay.ibanState ?? null} fixedBy={(pay as { ibanFixedBy?: string }).ibanFixedBy ?? null} />
              {pay.advance && pay.advance.balance > 0 && <KeyValueRow label={t("file.advance")} value={hrMoney(pay.advance.balance)} ltr />}
              {(pay.retro ?? []).map((r, i) => (
                <KeyValueRow key={i} label={t("file.retro", { month: r.month })} value={hrMoney(r.amount)} ltr />
              ))}
            </>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">{t("file.no_pay")}</p>
          )}
        </Panel>
      )}

      {seg === "leave" && (
        <Panel title={t("file.seg.leave")}>
          <KeyValueRow label={t("file.entitlement")} value={t("file.days", { n: facts.service >= 5 ? 30 : 21 })} />
          <KeyValueRow label={t("file.leave_taken_row")} value={t("file.days", { n: emp.leaveTaken ?? 0 })} />
          {(emp.openingLeave ?? 0) !== 0 && <KeyValueRow label={t("file.opening")} value={t("file.days", { n: emp.openingLeave ?? 0 })} />}
          <KeyValueRow label={t("file.balance")} value={facts.balance == null ? "—" : t("file.days", { n: facts.balance })} strong />
          <KeyValueRow label={t("file.sick_used")} value={t("file.days", { n: emp.sick?.days ?? 0 })} />
        </Panel>
      )}

      {seg === "log" && (
        <Panel title={t("req.title")} icon={Inbox} count={requests.length}>
          <HrRequestList access={access} requests={requests} showEmployee={false} empty={t("req.none")} />
        </Panel>
      )}

      {seg === "log" && (
        <Panel
          title={t("vio.title")}
          icon={Gavel}
          count={violations.length}
          actions={
            access.allowed("violation.record", { site: emp.siteId }) && (emp.siteId || access.allowed("violation.record")) && emp.status !== "left" ? (
              <Button size="sm" variant="outline" onClick={() => setRecording(true)}>
                {t("vio.record")}
              </Button>
            ) : null
          }
        >
          <HrViolationList access={access} actor={actor} violations={violations} all={violations} pay={pay} showEmployee={false} empty={t("vio.none")} />
        </Panel>
      )}

      {seg === "log" && (
        <Panel title={t("file.log_title")} icon={History} count={log.length}>
          {log.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t("file.log_empty")}</p>
          ) : (
            <ol className="divide-y">
              {log.map((l) => (
                <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                  <span className="font-semibold text-foreground">{t.has(`log.${l.kind}`) ? t(`log.${l.kind}` as "log.created", logParams(l, t, siteName, locale)) : l.kind}</span>
                  <span className="text-xs text-muted-foreground">
                    {l.byName || "—"} · {hrDate(l.at?.slice(0, 10), locale)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      )}

      {exiting && <StartExitDialog access={access} actor={actor} emp={emp as HrEmployee} onClose={() => setExiting(false)} />}
      {recording && <RecordViolationDialog access={access} actor={actor} employeeId={employeeId} onClose={() => setRecording(false)} />}
      {newReq && <NewRequestDialog kind={newReq} onClose={() => setNewReq(null)} access={access} actor={actor} emp={emp as HrEmployee} pay={pay} sites={sites} existing={requests} />}

      {action && (
        <EmployeeActionDialog action={action} onClose={() => setAction(null)} access={access} actor={actor} emp={emp as HrEmployee} pay={pay} sites={sites} />
      )}
    </div>
  )
}

/** Log params rendered for reading: places and trades by name, days by locale. */
function logParams(l: LogEntry, t: ReturnType<typeof useTranslations>, siteName: (id: string | null | undefined) => string | null, locale: string): Record<string, string> {
  const p = l.params ?? {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(p)) {
    if (v == null) out[k] = "—"
    else if (k === "from" || k === "to") {
      if (l.kind === "moved") out[k] = siteName(String(v)) ?? t("sites.unassigned")
      else out[k] = hrDate(String(v), locale)
    } else if (k === "on" || k === "consent" || k === "lastDay") out[k] = hrDate(String(v), locale)
    else if (k === "reason" && (l.kind === "exit_started")) out[k] = t(`exit.reasons.${v}` as "exit.reasons.resignation")
    else if (k === "doc") out[k] = t(`doc.${v}` as "doc.iqama")
    else if (k === "trade") out[k] = t(`trade.${v}` as "trade.mason")
    else if (k === "code") out[k] = t(`violation.${v}` as "violation.late15")
    else if (k === "site") out[k] = siteName(String(v)) ?? t("sites.unassigned")
    else if (k === "fee") out[k] = hrMoney(Number(v))
    else out[k] = String(v)
  }
  return out
}

/** A returned transfer's IBAN (PY-03, RL-02): payroll fixes it, the HR manager approves it — never the same hand. */
function IbanActions({ access, employeeId, actor, state, fixedBy }: { access: HrAccess; employeeId: string; actor: HrActor; state: string | null; fixedBy: string | null }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [iban, setIban] = useState("")
  const [busy, setBusy] = useState(false)
  if (state !== "returned" && state !== "fixed") return null
  const run = async (fn: () => Promise<void>, ok: string) => {
    if (!firestore) return
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
      setIban("")
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `iban.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  const mayApprove = state === "fixed" && access.allowed("iban.approve") && (fixedBy !== access.ctx.uid || access.ctx.owner)
  return (
    <div className="mt-3 space-y-2">
      <Callout tone="warn">{t(state === "returned" ? "iban.returned" : "iban.fixed")}</Callout>
      {state === "returned" && access.allowed("iban.fix") && (
        <div className="flex flex-wrap gap-2">
          <Input dir="ltr" aria-label={t("iban.new")} placeholder="SA00 0000 0000 0000 0000 0000" value={iban} onChange={(e) => setIban(e.target.value)} className="h-9 flex-1 basis-60" disabled={busy} />
          <Button size="sm" disabled={busy || !iban.trim()} onClick={() => void run(() => fixIban(firestore!, access.ctx, employeeId, actor, iban), "iban.fixed_ok")}>
            {t("iban.fix")}
          </Button>
        </div>
      )}
      {mayApprove && (
        <Button size="sm" disabled={busy} onClick={() => void run(() => approveIban(firestore!, access.ctx, employeeId, actor), "iban.approved_ok")}>
          {t("iban.approve")}
        </Button>
      )}
    </div>
  )
}

