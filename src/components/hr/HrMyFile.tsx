"use client"

// My file (PRD ES-00…05, WF-23): every user on the record — the HR manager and
// management included — sees himself here and only himself: his card (number
// first), his requests with who holds each now, his leave and attendance, his
// pay and a payslip for every paid month with each deduction's reason, his
// documents and details. He never edits his record: a change is a request.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, query, where } from "firebase/firestore"
import { FileText, HandCoins, Loader2, PencilLine, Plane } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useEmployeePay, useHrPeople } from "@/hooks/useHrPeople"
import { useHrRequests } from "@/hooks/useHrRequests"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import type { HrAccess } from "@/hooks/useHrAccess"
import { HR_EMPLOYEES, HR_PAYSLIPS } from "@/lib/hr/collections"
import { docState, DOC_TYPES } from "@/lib/hr/documents"
import { displayName, probationState, statusOn, type HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { gratuity } from "@/lib/hr/eos"
import { empNo, hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { leaveBalance } from "@/lib/hr/leave"
import { wageOf } from "@/lib/hr/pay"
import type { PayrollLine, SupplementaryLine } from "@/lib/hr/payroll"
import { requestNoDisplay, type HrRequest, type HrRequestKind } from "@/lib/hr/requests"
import { serviceYears } from "@/lib/hr/statutory"
import { cn } from "@/lib/utils"
import { HrViolationList, useHrViolations } from "./HrViolationList"
import { DOC_TONE, STATUS_TONE } from "./HrPeopleView"
import { CancelOwnRequest, REQUEST_TONE } from "./HrRequestList"
import { NewRequestDialog } from "./NewRequestDialog"

type Seg = "home" | "requests" | "leave" | "pay" | "docs"
interface Payslip {
  id: string
  key: string
  month: string
  kind: "main" | "supplementary"
  line: PayrollLine | SupplementaryLine
  paidOn: string
}

export function HrMyFile({ access, actor }: { access: HrAccess; actor: HrActor }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const today = todayDay()
  const id = access.ctx.employeeId
  const empRef = useMemoFirebase(() => (firestore && id ? doc(firestore, HR_EMPLOYEES, id) : null), [firestore, id])
  const { data: empData, isLoading } = useDoc(empRef)
  const emp = (empData as unknown as HrEmployee | null) ?? null
  const { pay } = useEmployeePay(id, Boolean(id))
  const { sites, siteName } = useHrPeople(access.orgId, access.ctx.roles.size > 0)
  const { requests: all } = useHrRequests(access)
  const requests = useMemo(() => all.filter((r) => r.employeeId === id), [all, id])
  const violations = useHrViolations(access).filter((v) => v.employeeId === id)
  const { orgMembers } = useOrgMembers(access.orgId)
  const psQ = useMemoFirebase(
    () => (firestore && access.orgId && access.ctx.uid ? query(collection(firestore, HR_PAYSLIPS), where("organizationId", "==", access.orgId), where("employeeUserId", "==", access.ctx.uid)) : null),
    [firestore, access.orgId, access.ctx.uid]
  )
  const { data: psData } = useCollection(psQ)
  const payslips = ((psData ?? []) as unknown as Payslip[]).sort((a, b) => b.key.localeCompare(a.key))
  const [seg, setSeg] = useState<Seg>("home")
  const [newReq, setNewReq] = useState<HrRequestKind | null>(null)
  const [openSlip, setOpenSlip] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex justify-center p-16">
        <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
      </div>
    )
  }
  if (!emp || !emp.names) return <Callout tone="info">{t("me.no_record")}</Callout>

  const balance = leaveBalance(emp.join, today, emp.leaveTaken ?? 0, emp.openingLeave ?? 0)
  const wage = pay ? wageOf(pay) : 0
  const years = serviceYears(emp.join, today)
  const memberName = (uid?: string | null) => {
    const m = orgMembers.find((x) => x.id === uid)
    return (m?.name as string) || (m?.email as string) || null
  }
  /** ES-02 — who holds the request now, by name where there is one. */
  const holder = (r: HrRequest) => {
    if (r.state === "pending" && r.kind === "leave" && r.lineManagerUserId) return memberName(r.lineManagerUserId) ?? t("me.holder.line_manager")
    if (r.state === "pending" || r.state === "endorsed") return t(r.deciderLevel === "management" ? "me.holder.management" : "me.holder.hr")
    if (r.state === "finance") return t("me.holder.finance")
    return null
  }
  const site = sites.find((s) => s.id === emp.siteId)

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-module/10 px-2 py-0.5 text-sm font-black tabular-nums text-module" dir="ltr">
            {empNo(emp.no)}
          </span>
          <h2 className="text-lg font-black" dir="auto">
            {displayName(emp, locale)}
          </h2>
          <StatusPill tone={STATUS_TONE[statusOn(emp, today)]}>{t(`status.${statusOn(emp, today)}`)}</StatusPill>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(`trade.${emp.trade}` as "trade.mason")} · {siteName(emp.siteId) ?? t("sites.unassigned")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setNewReq("leave")}>
            <Plane size={14} className="me-1.5" aria-hidden="true" />
            {t("req.new_leave")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setNewReq("advance")}>
            <HandCoins size={14} className="me-1.5" aria-hidden="true" />
            {t("req.new_advance")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setNewReq("data")}>
            <PencilLine size={14} className="me-1.5" aria-hidden="true" />
            {t("req.new_data")}
          </Button>
        </div>
      </div>

      <SegmentedNav
        segments={(["home", "requests", "leave", "pay", "docs"] as const).map((s) => ({
          id: s,
          label: t(`me.seg.${s}`),
          count: s === "requests" ? requests.filter((r) => ["pending", "endorsed", "finance"].includes(r.state)).length || undefined : undefined,
          tone: s === "requests" ? ("warn" as const) : undefined,
        }))}
        active={seg}
        onSelect={(s) => setSeg(s as Seg)}
        ariaLabel={t("me.segments")}
      />

      {seg === "home" && (
        <Panel title={t("me.card")}>
          <KeyValueRow label={t("people.col.no")} value={empNo(emp.no)} ltr strong />
          <KeyValueRow label={t("new.join")} value={hrDate(emp.join, locale)} />
          <KeyValueRow label={t("file.tile.service")} value={t("file.years", { n: years.toFixed(1) })} />
          <KeyValueRow label={t("new.contract")} value={emp.contract?.type === "fixed" ? t("file.fixed_until", { date: hrDate(emp.contract.end, locale) }) : t("contract.open")} />
          <KeyValueRow
            label={t("file.probation")}
            value={
              emp.probation?.decision
                ? t(`file.probation_${emp.probation.decision}`)
                : probationState(emp, today) === "lapsed"
                  ? t("file.probation_lapsed", { date: hrDate(emp.probation?.end, locale) })
                  : t("file.probation_until", { date: hrDate(emp.probation?.end, locale) })
            }
          />
          <KeyValueRow label={t("me.line_manager")} value={memberName(site?.supervisorUserId) ?? t("me.holder.hr")} />
          <KeyValueRow label={t("file.tile.leave")} value={t("file.days", { n: balance })} strong />
          {wage > 0 && (
            <>
              <KeyValueRow label={t("me.eos_info")} value={hrMoney(gratuity(wage, emp.join, today, "contract_end"))} ltr />
              <p className="pt-2 text-[11px] text-muted-foreground">{t("me.eos_note", { resignation: hrMoney(gratuity(wage, emp.join, today, "resignation")) })}</p>
            </>
          )}
        </Panel>
      )}

      {seg === "requests" && (
        <Panel title={t("req.title")} count={requests.length}>
          {requests.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("req.none")}</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {requests.map((r) => (
                <li key={r.id} className="space-y-0.5 px-3 py-2.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-bold tabular-nums" dir="ltr">
                      {requestNoDisplay(r.no, locale)}
                    </span>
                    <span>{t(`req.kind.${r.kind}`)}</span>
                    <StatusPill tone={REQUEST_TONE[r.state]}>{t(`req.state.${r.state}`)}</StatusPill>
                    <span className="ms-auto">
                      <CancelOwnRequest access={access} r={r} actor={actor} />
                    </span>
                  </p>
                  {holder(r) && <p className="text-xs text-muted-foreground">{t("me.held_by", { name: holder(r)! })}</p>}
                  {(r.decision?.note || r.finance?.note || r.cancel?.note) && (
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {t("me.reason", { text: r.finance?.note || r.cancel?.note || r.decision?.note || "" })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {seg === "leave" && (
        <div className="space-y-4">
          <Panel title={t("file.seg.leave")}>
            <KeyValueRow label={t("file.balance")} value={t("file.days", { n: balance })} strong />
            <KeyValueRow label={t("file.leave_taken_row")} value={t("file.days", { n: emp.leaveTaken ?? 0 })} />
            <KeyValueRow label={t("file.sick_used")} value={t("file.days", { n: emp.sick?.days ?? 0 })} />
          </Panel>
          <Panel title={t("me.month_by_month")}>
            {payslips.filter((p) => p.kind === "main").length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">{t("me.no_payslips")}</p>
            ) : (
              payslips
                .filter((p) => p.kind === "main")
                .map((p) => {
                  const l = p.line as PayrollLine
                  return <KeyValueRow key={p.id} label={p.month} value={t("me.att_line", { absent: l.attendance.absent, sick: l.attendance.sick, ot: l.attendance.overtimeHours })} />
                })
            )}
          </Panel>
        </div>
      )}

      {seg === "pay" && (
        <div className="space-y-4">
          <Panel title={t("file.seg.pay")}>
            {pay ? (
              <>
                <KeyValueRow label={t("pay.basic")} value={hrMoney(pay.basic)} ltr />
                <KeyValueRow label={t("pay.housing")} value={hrMoney(pay.housing)} ltr />
                <KeyValueRow label={t("pay.transport")} value={hrMoney(pay.transport)} ltr />
                <KeyValueRow label={t("pay.wage")} value={hrMoney(wage)} ltr strong />
                <KeyValueRow label={t("file.iban")} value={pay.iban || "—"} ltr />
                {pay.advance && pay.advance.balance > 0 && <KeyValueRow label={t("file.advance")} value={hrMoney(pay.advance.balance)} ltr />}
              </>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">{t("file.no_pay")}</p>
            )}
          </Panel>
          <Panel title={t("me.payslips")} icon={FileText} count={payslips.length}>
            {payslips.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">{t("me.no_payslips")}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {payslips.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={openSlip === p.id}
                      onClick={() => setOpenSlip(openSlip === p.id ? null : p.id)}
                    >
                      <span className="font-bold" dir="ltr">
                        {p.key}
                      </span>
                      <span className="text-xs text-muted-foreground">{t("me.paid_on", { date: hrDate(p.paidOn, locale) })}</span>
                      <span className="font-black tabular-nums" dir="ltr">
                        {hrMoney(p.line.net)}
                      </span>
                    </button>
                    {openSlip === p.id && <PayslipBody slip={p} />}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {seg === "docs" && (
        <div className="space-y-4">
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
          <Panel title={t("me.details")}>
            <KeyValueRow label={t("new.id_no")} value={emp.idNo || "—"} ltr />
            {(["mobile", "address", "emergency"] as const).map((f) => (
              <KeyValueRow key={f} label={t(`data_field.${f}`)} value={emp.contact?.[f] || "—"} />
            ))}
            <p className="pt-2 text-[11px] text-muted-foreground">{t("me.details_note")}</p>
          </Panel>
          <Panel title={t("vio.title")} count={violations.length}>
            <HrViolationList access={access} actor={actor} violations={violations} all={violations} showEmployee={false} empty={t("vio.none")} />
          </Panel>
        </div>
      )}

      {newReq && <NewRequestDialog kind={newReq} onClose={() => setNewReq(null)} access={access} actor={actor} emp={emp} pay={pay} sites={sites} existing={requests} />}
    </div>
  )
}

/** ES-04 — every deduction with its reason. */
function PayslipBody({ slip }: { slip: Payslip }) {
  const t = useTranslations("Portal.HR")
  const l = slip.line
  if (slip.kind === "supplementary") {
    return (
      <div className="border-t bg-muted/20 px-3 py-2">
        <KeyValueRow label={t("me.slip.retro")} value={hrMoney((l as SupplementaryLine).retro)} ltr strong />
      </div>
    )
  }
  const p = l as PayrollLine
  const row = (label: string, v: number, minus = false, strong = false) => (v ? <KeyValueRow label={label} value={`${minus ? "− " : ""}${hrMoney(v)}`} ltr strong={strong} /> : null)
  return (
    <div className={cn("space-y-0 border-t bg-muted/20 px-3 py-2")}>
      {row(t("me.slip.month_wage", { days: p.days }), p.monthWage)}
      {row(t("me.slip.absence", { days: p.attendance.absent }), p.absenceDeduction, true)}
      {row(t("me.slip.overtime", { hours: p.attendance.overtimeHours }), p.overtime)}
      {row(t("me.slip.commission"), p.commission)}
      {row(t("me.slip.gross"), p.gross, false, true)}
      {row(t("me.slip.gosi"), p.gosiEmployee, true)}
      {row(t("me.slip.sick", { q: p.reasons?.sickThreeQuarters ?? 0, zero: p.reasons?.sickUnpaid ?? 0 }), p.sickDeduction, true)}
      {row(t("me.slip.unpaid", { days: p.reasons?.unpaidDays ?? 0 }), p.unpaidDeduction, true)}
      {(p.reasons?.penalties ?? []).map((x, i) => (
        <KeyValueRow key={i} label={t("me.slip.penalty", { code: t(`violation.${x.code}` as "violation.late15"), on: x.on })} value={`− ${hrMoney(x.deducted)}`} ltr />
      ))}
      {!p.reasons?.penalties?.length && row(t("me.slip.penalties"), p.penalties, true)}
      {row(t("me.slip.advance"), p.advance, true)}
      {row(t("me.slip.net"), p.net, false, true)}
    </div>
  )
}
