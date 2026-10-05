"use client"

// The employee file's Pay & payroll (the prototype's efPay) — for the roles
// that see pay only (RL-03): the monthly pay with its commissions, the
// overtime hour (art. 107) and GOSI; the cost and liabilities (gratuity if
// terminated or resigned today, the leave balance's value, the cost centre);
// his payslips; the advance with its instalment and months left; penalties
// with the month that deducts them; the pay history from its steps; the
// returned IBAN's fix and approval (RL-02); and a raise asked for, decided as
// the pay change it asks (EM-04).

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Callout } from "@/components/module-ui/Callout"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useTableLabels } from "@/hooks/useTableLabels"
import type { HrAccess } from "@/hooks/useHrAccess"
import { mayDecideRequest } from "@/lib/hr/access"
import { HR_PAYSLIPS } from "@/lib/hr/collections"
import { COST_ACCOUNT } from "@/lib/hr/employee"
import { approveIban, fixIban, type HrActor } from "@/lib/hr/employee-writes"
import { gratuity, monthlyEosAccrual } from "@/lib/hr/eos"
import { hrDate, hrMoney } from "@/lib/hr/format"
import { advanceMonths, gosiRates, overtimeRate } from "@/lib/hr/pay"
import type { PayrollLine } from "@/lib/hr/payroll"
import { requestNoDisplay } from "@/lib/hr/requests"
import { costKindOf, UNASSIGNED_SITE } from "@/lib/hr/sites"
import { r2, STATUTORY } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import type { FileView } from "./hr-file-view"

interface Slip {
  id: string
  month: string
  kind: "main" | "supplementary"
  line: Partial<PayrollLine> & { net: number }
  paidOn?: string | null
}

const VIO_TONE = { recorded: "warn", applied: "bad", dismissed: "mute", objected: "warn", upheld: "bad", cancelled: "mute" } as const

export function HrFilePay({ v, companyCost, employerGosi }: { v: FileView; companyCost: number; employerGosi: number }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const labels = useTableLabels()
  const { emp, pay, today, locale, access } = v
  const own = Boolean(access.ctx.employeeId) && access.ctx.employeeId === emp.id && !access.ctx.owner
  const [openSlip, setOpenSlip] = useState<string | null>(null)
  const slipQ = useMemoFirebase(
    () => (firestore && access.orgId && access.allowed("pay.view") ? query(collection(firestore, HR_PAYSLIPS), where("organizationId", "==", access.orgId), where("employeeId", "==", emp.id)) : null),
    [firestore, access, emp.id]
  )
  const { data: slipData } = useCollection(slipQ)
  const slips = useMemo(() => ((slipData ?? []) as unknown as Slip[]).slice().sort((a, b) => b.month.localeCompare(a.month) || a.kind.localeCompare(b.kind)), [slipData])
  const raises = v.requests.filter((r) => r.kind === "raise" && r.raise)
  const kind = costKindOf(v.site?.type ?? UNASSIGNED_SITE)
  const P = access.settings.policies

  if (!pay) {
    return (
      <Panel title={t("file.seg.pay")}>
        <p className="py-4 text-sm text-muted-foreground">{t("file.no_pay")}</p>
      </Panel>
    )
  }
  const wage = v.wage
  const steps = (pay.steps ?? []).filter((s) => s.from)
  const history = steps
    .map((s, i) => ({ s, prev: i === 0 ? ((pay.steps ?? []).find((x) => !x.from) ?? null) : steps[i - 1] }))
    .reverse()
  const commissions = (pay.commissions ?? []).slice().sort((a, b) => b.month.localeCompare(a.month))
  type Violation = FileView["violations"][number]
  const penaltyColumns: DataColumn<Violation>[] = [
    { key: "violation", header: t("file.pen_col.violation"), sortValue: (x) => t(`violation.${x.code}` as "violation.late15"), cell: (x) => t(`violation.${x.code}` as "violation.late15") },
    {
      key: "date",
      header: t("file.pen_col.date"),
      sortValue: (x) => x.on,
      cell: (x) => (
        <>
          {hrDate(x.on, locale)}
          {x.hearing?.on && <span className="block text-xs text-muted-foreground">{t("file.heard", { date: hrDate(x.hearing.on, locale) })}</span>}
        </>
      ),
    },
    {
      key: "state",
      header: t("file.pen_col.state"),
      sortValue: (x) => t(`vio.state.${x.state}` as "vio.state.recorded"),
      cell: (x) => <StatusPill tone={VIO_TONE[x.state as keyof typeof VIO_TONE] ?? "mute"}>{t(`vio.state.${x.state}` as "vio.state.recorded")}</StatusPill>,
    },
    { key: "month", header: t("file.pen_col.month"), sortValue: (x) => x.deductMonth ?? null, cell: (x) => <bdi dir="ltr" className="tabular-nums">{x.deductMonth ?? "—"}</bdi> },
    { key: "amount", header: t("file.pen_col.amount"), numeric: true, sortValue: (x) => x.amount || null, cell: (x) => (x.amount ? hrMoney(x.amount) : "—") },
  ]
  type Step = (typeof history)[number]
  const historyColumns: DataColumn<Step>[] = [
    { key: "kind", header: t("file.hist_col.kind"), sortValue: (h) => (h.s.kind ? t(`paychange.kinds.${h.s.kind}`) : t("file.hist_change")), cell: (h) => <span className="font-semibold">{h.s.kind ? t(`paychange.kinds.${h.s.kind}`) : t("file.hist_change")}</span> },
    { key: "from", header: t("file.hist_col.from"), sortValue: (h) => h.s.from ?? null, cell: (h) => hrDate(h.s.from, locale) },
    {
      key: "basic",
      header: t("file.hist_col.basic"),
      numeric: true,
      sortValue: (h) => h.s.basic,
      cell: (h) => (
        <>
          {h.prev ? `${hrMoney(h.prev.basic)} ← ` : ""}
          {hrMoney(h.s.basic)}
        </>
      ),
    },
    {
      key: "reason",
      header: t("file.hist_col.reason"),
      cell: (h) => (
        <span className="text-xs text-muted-foreground" dir="auto">
          {[h.s.reason, h.s.byName].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={t("file.monthly_pay")}>
        <KeyValueRow label={t("pay.basic")} value={hrMoney(pay.basic)} ltr />
        <KeyValueRow label={t("file.housing_share", { pct: Math.round(P.housingShare * 100) })} value={hrMoney(pay.housing)} ltr />
        <KeyValueRow label={t("file.transport_share", { pct: Math.round(P.transportShare * 100) })} value={hrMoney(pay.transport)} ltr />
        <KeyValueRow label={t("pay.wage")} value={hrMoney(wage)} ltr strong />
        {commissions.map((c) => (
          <KeyValueRow
            key={c.id}
            label={
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {t("file.commission_line", { month: c.month })}
                <SourceBadge module="sales" label={t("file.src.sales")} />
              </span>
            }
            value={hrMoney(c.amount)}
            ltr
          />
        ))}
        <div className="mt-2 border-t pt-2">
          <KeyValueRow label={<span>{t("file.ot_rate")}<span className="ms-1.5 text-xs text-muted-foreground">{t("file.art107")}</span></span>} value={hrMoney(r2(overtimeRate(pay)))} ltr />
          <KeyValueRow label={t("file.gosi")} value={t("file.gosi_line", { emp: (gosiRates(emp.nationality, emp.join).employee * 100).toFixed(2), co: (gosiRates(emp.nationality, emp.join).employer * 100).toFixed(2) })} />
          <KeyValueRow label={t("file.iban")} value={pay.iban || t("file.not_recorded")} ltr={Boolean(pay.iban)} />
        </div>
        <IbanActions access={access} employeeId={emp.id} actor={v.actor} state={pay.ibanState ?? null} fixedBy={(pay as { ibanFixedBy?: string }).ibanFixedBy ?? null} own={own} />
        {(pay.retro ?? []).map((r, i) => (
          <KeyValueRow key={i} label={t("file.retro", { month: r.month })} value={hrMoney(r.amount)} ltr />
        ))}
      </Panel>

      <Panel title={t("file.cost_title")}>
        <KeyValueRow label={t("pay.wage")} value={hrMoney(wage)} ltr />
        <KeyValueRow label={t("file.cost_gosi")} value={hrMoney(employerGosi)} ltr />
        <KeyValueRow label={t("file.cost_eos")} value={hrMoney(monthlyEosAccrual(wage, v.service))} ltr />
        <KeyValueRow label={t("file.cost_total")} value={hrMoney(companyCost)} ltr strong />
        <KeyValueRow label={<span>{t("file.eos_termination")}<span className="ms-1.5 text-xs text-muted-foreground">{t("file.art84")}</span></span>} value={hrMoney(gratuity(wage, emp.join, today, "termination_notice"))} ltr />
        <KeyValueRow label={<span>{t("file.eos_resignation")}<span className="ms-1.5 text-xs text-muted-foreground">{t("file.art85")}</span></span>} value={hrMoney(gratuity(wage, emp.join, today, "resignation"))} ltr />
        <KeyValueRow label={t("file.leave_value")} value={hrMoney(r2((wage / STATUTORY.monthDays) * Math.max(0, v.balance ?? 0)))} ltr />
        <KeyValueRow
          label={t("file.cost_centre")}
          value={
            <span>
              <span dir="ltr" className="tabular-nums">
                {COST_ACCOUNT[kind]}
              </span>
              <span className="ms-1.5 text-xs text-muted-foreground">{v.siteName(emp.siteId) ?? t("sites.unassigned")}</span>
            </span>
          }
        />
      </Panel>

      {raises.length > 0 && (
        <Panel title={t("file.raise_requests")} count={raises.filter((r) => r.state === "pending" || r.state === "endorsed").length}>
          <ul className="divide-y">
            {raises.map((r) => {
              const open = r.state === "pending" || r.state === "endorsed"
              const mayDecide = open && mayDecideRequest(access.ctx, { employeeId: r.employeeId, isHrManager: r.deciderLevel === "management" }) === null
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-bold tabular-nums" dir="ltr">
                        {requestNoDisplay(r.no, locale)}
                      </span>
                      <StatusPill tone={open ? "warn" : r.state === "approved" ? "ok" : "mute"}>{t(`req.state.${r.state}`)}</StatusPill>
                      {r.deciderLevel === "management" && <StatusPill tone="violet">{t("req.to_management")}</StatusPill>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t(`paychange.kinds.${r.raise!.kind}`)} · <span dir="ltr">{hrMoney(pay.basic)} ← {hrMoney(r.raise!.basic)}</span> · {t("file.from_date", { date: hrDate(r.raise!.effectiveOn, locale) })}
                    </p>
                    <p className="text-xs text-muted-foreground" dir="auto">
                      “{r.raise!.reason}” · {r.filedBy?.byName || "—"}
                    </p>
                  </div>
                  {mayDecide && (
                    <Button size="sm" onClick={() => v.open("pay", { requestId: r.id })}>
                      {t("file.decide_raise")}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </Panel>
      )}

      <Panel title={t("file.payslips")} count={slips.length}>
        {slips.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t("file.no_payslips")}</p>
        ) : (
          <ul className="divide-y">
            {slips.map((s) => {
              const isOpen = openSlip === s.id
              const l = s.line
              return (
                <li key={s.id} className="py-1">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenSlip(isOpen ? null : s.id)}
                    className="flex w-full items-center gap-2 rounded px-1 py-2 text-start text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="font-semibold">
                      {s.month}
                      {s.kind === "supplementary" && <span className="ms-1.5 text-xs text-muted-foreground">{t("file.slip_supplementary")}</span>}
                    </span>
                    <span className="ms-auto text-xs text-muted-foreground">{s.paidOn ? t("file.slip_paid", { date: hrDate(s.paidOn, locale) }) : t("file.slip_with_finance")}</span>
                    <span className="font-bold tabular-nums" dir="ltr">
                      {hrMoney(l.net)}
                    </span>
                    <ChevronDown size={14} className={cn("shrink-0 transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                  </button>
                  {isOpen && (
                    <div className="rounded-lg bg-muted/30 px-3 py-2">
                      {l.gross != null && <KeyValueRow label={t("me.slip.gross")} value={hrMoney(l.gross)} ltr />}
                      {(l.gosiEmployee ?? 0) > 0 && <KeyValueRow label={t("me.slip.gosi")} value={`− ${hrMoney(l.gosiEmployee)}`} ltr />}
                      {(l.absenceDeduction ?? 0) > 0 && <KeyValueRow label={t("me.slip.absence", { days: l.attendance?.absent ?? 0 })} value={`− ${hrMoney(l.absenceDeduction)}`} ltr />}
                      {(l.penalties ?? 0) > 0 && <KeyValueRow label={t("me.slip.penalties")} value={`− ${hrMoney(l.penalties)}`} ltr />}
                      {(l.advance ?? 0) > 0 && <KeyValueRow label={t("me.slip.advance")} value={`− ${hrMoney(l.advance)}`} ltr />}
                      <KeyValueRow label={t("me.slip.net")} value={hrMoney(l.net)} ltr strong />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <Panel title={t("file.advance_penalties")}>
        {pay.advance && pay.advance.balance > 0 ? (
          <>
            <KeyValueRow label={t("file.advance_amount")} value={hrMoney(pay.advance.amount)} ltr />
            <KeyValueRow label={t("file.advance")} value={hrMoney(pay.advance.balance)} ltr />
            <KeyValueRow
              label={t("file.advance_instalment")}
              value={
                <span>
                  <span dir="ltr">{hrMoney(pay.advance.instalment)}</span>
                  <span className="ms-1.5 text-xs text-muted-foreground">{t("file.months_left", { n: pay.advance.instalment > 0 ? Math.ceil(pay.advance.balance / pay.advance.instalment) : advanceMonths(pay.advance.balance, wage) })}</span>
                </span>
              }
            />
          </>
        ) : (
          <p className="py-1 text-sm text-muted-foreground">{t("file.no_advance")}</p>
        )}
        {v.violations.length > 0 && (
          <DataTable
            caption={t("file.pen_caption")}
            labels={labels}
            dense
            bordered={false}
            className="mt-3"
            columns={penaltyColumns}
            rows={v.violations}
            rowKey={(x) => x.id}
            empty={null}
          />
        )}
      </Panel>

      {history.length > 0 && (
        <Panel title={t("file.pay_history")} className="lg:col-span-2" bodyClassName="p-0">
          <DataTable
            caption={t("file.pay_history")}
            labels={labels}
            dense
            bordered={false}
            columns={historyColumns}
            rows={history}
            rowKey={(h) => h.s.from as string}
            empty={null}
          />
        </Panel>
      )}
    </div>
  )
}

/** A returned transfer's IBAN (PY-03, RL-02): payroll fixes it, the HR manager approves it — never the same hand. */
function IbanActions({ access, employeeId, actor, state, fixedBy, own }: { access: HrAccess; employeeId: string; actor: HrActor; state: string | null; fixedBy: string | null; own: boolean }) {
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
  // Never one's own bank details, never the hand that fixed it (RL-02).
  const mayApprove = state === "fixed" && access.allowed("iban.approve") && !own && (fixedBy !== access.ctx.uid || access.ctx.owner)
  const valid = /^SA\d{22}$/.test(iban.replace(/\s+/g, "").toUpperCase())
  return (
    <div className="mt-3 space-y-2">
      <Callout tone="warn">{t(state === "returned" ? "iban.returned" : "iban.fixed")}</Callout>
      {state === "returned" && access.allowed("iban.fix") && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2">
            <Input dir="ltr" aria-label={t("iban.new")} placeholder="SA00 0000 0000 0000 0000 0000" value={iban} onChange={(e) => setIban(e.target.value)} className="h-9 flex-1 basis-60" disabled={busy} />
            <Button size="sm" disabled={busy || !valid} onClick={() => void run(() => fixIban(firestore!, access.ctx, employeeId, actor, iban), "iban.fixed_ok")}>
              {t("iban.fix")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("file.iban_source_hint")}</p>
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
