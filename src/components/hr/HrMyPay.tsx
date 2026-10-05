"use client"

// My file — my pay (the prototype's mePay): the monthly pay with the overtime
// hour (art. 107), his GOSI share, pay day and the IBAN MASKED (ES-01); every
// payslip — paid, with Finance, or held and why, a returned transfer marked —
// each with its components and every deduction's reason (ES-04); his advance
// and its instalments (AD-01); what he is entitled to, for information; and
// how his pay changed (EM-04). His own money only — the rules give it to him
// through the link on his record (RL-03).

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { FileText, HandCoins, Landmark, TrendingUp, Wallet } from "lucide-react"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import type { HrEmployee } from "@/lib/hr/employee"
import { gratuity } from "@/lib/hr/eos"
import { hrDate, hrMoney } from "@/lib/hr/format"
import { maskIban, monthName, myPayFacts, payHistory, type MySlip } from "@/lib/hr/me"
import { gosiRates } from "@/lib/hr/pay"
import type { PayrollLine, SupplementaryLine } from "@/lib/hr/payroll"
import { r2, serviceYears, STATUTORY } from "@/lib/hr/statutory"
import type { MyFileCtx } from "./HrMyFile"

const pct = (x: number) => `${(Math.round(x * 10000) / 100).toFixed(2)}%`

export function HrMyPay({ ctx }: { ctx: MyFileCtx }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const { emp, pay, today } = ctx
  const [open, setOpen] = useState<string | null>(ctx.slips[0]?.id ?? null)
  if (!pay) {
    return (
      <Panel title={t("me.pay.monthly")} icon={Wallet}>
        <p className="py-3 text-sm text-muted-foreground">{t("file.no_pay")}</p>
      </Panel>
    )
  }
  const f = myPayFacts(pay, emp)
  const history = payHistory(pay.steps)
  const years = serviceYears(emp.join, today)
  const iban = maskIban(pay.iban)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("me.pay.monthly")} icon={Wallet}>
          <KeyValueRow label={t("pay.basic")} value={hrMoney(pay.basic)} ltr />
          <KeyValueRow label={t("pay.housing")} value={hrMoney(pay.housing)} ltr />
          <KeyValueRow label={t("pay.transport")} value={hrMoney(pay.transport)} ltr />
          <KeyValueRow label={t("me.pay.total")} value={hrMoney(f.wage)} ltr strong />
          <div className="mt-2 border-t pt-2">
            <KeyValueRow label={t("me.pay.ot_hour")} value={hrMoney(f.otHour)} ltr />
            <p className="pb-1 text-[11px] text-muted-foreground">{t("me.pay.ot_formula")}</p>
            <KeyValueRow label={t("me.pay.gosi")} value={f.gosiRate > 0 ? t("me.pay.gosi_line", { rate: pct(f.gosiRate) }) : t("me.pay.gosi_none")} />
            <KeyValueRow label={t("me.pay.pay_day")} value={t("me.pay.pay_day_line", { n: ctx.access.settings.policies.payDay })} />
          </div>
        </Panel>

        <Panel title={t("me.pay.bank")} icon={Landmark}>
          <KeyValueRow label={t("file.iban")} value={iban ?? t("me.pay.no_iban")} ltr={Boolean(iban)} strong />
          {pay.ibanState === "returned" && <StatusPill tone="bad">{t("me.returned")}</StatusPill>}
          {pay.ibanState === "fixed" && <StatusPill tone="warn">{t("me.pay.iban_fixed")}</StatusPill>}
          <p className="pt-2 text-[11px] text-muted-foreground">{t("me.pay.iban_note")}</p>
        </Panel>
      </div>

      <Panel title={t("me.payslips")} icon={FileText} count={ctx.slips.length}>
        {ctx.slips.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">{t("me.no_payslips")}</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {ctx.slips.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-start text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={open === s.id}
                  onClick={() => setOpen(open === s.id ? null : s.id)}
                >
                  <span className="font-bold">
                    {monthName(s.month, locale)}
                    {s.kind === "supplementary" && <span className="ms-1 text-xs font-normal text-muted-foreground">{t("me.pay.supplementary")}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{s.state === "paid" ? t("me.paid_on", { date: hrDate(s.paidOn, locale) }) : t(`me.slip_state.${s.state}`)}</span>
                  {s.state === "held" && s.heldReason && <StatusPill tone="bad">{t(`me.held_reason.${s.heldReason}`)}</StatusPill>}
                  {s.returned && <StatusPill tone="bad">{t("me.returned")}</StatusPill>}
                  <span className="ms-auto font-black tabular-nums" dir="ltr">
                    {hrMoney(s.line.net)}
                  </span>
                </button>
                {open === s.id && <PayslipBody slip={s} emp={emp} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("me.pay.advance")} icon={HandCoins}>
          {f.advance ? (
            <>
              <KeyValueRow label={t("me.pay.advance_amount")} value={hrMoney(f.advance.amount)} ltr />
              <KeyValueRow label={t("me.pay.advance_left")} value={hrMoney(f.advance.balance)} ltr strong />
              <KeyValueRow label={t("me.pay.advance_monthly")} value={t("me.pay.advance_monthly_line", { amount: hrMoney(f.advance.instalment), n: f.advance.monthsLeft })} />
            </>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">{t("me.pay.no_advance", { amount: hrMoney(f.instalmentIf) })}</p>
          )}
        </Panel>

        <Panel title={t("me.pay.entitlements")} icon={Landmark}>
          <KeyValueRow label={t("me.pay.eos")} value={hrMoney(gratuity(f.wage, emp.join, today, "contract_end"))} ltr />
          <KeyValueRow label={t("me.pay.if_resigned")} value={hrMoney(gratuity(f.wage, emp.join, today, "resignation"))} ltr />
          {years < 2 && <p className="pb-1 text-[11px] text-muted-foreground">{t("me.pay.nothing_before_two")}</p>}
          <KeyValueRow label={t("me.balance_cash")} value={hrMoney(Math.round((f.wage / STATUTORY.monthDays) * Math.max(0, ctx.leave.balance)))} ltr />
          <KeyValueRow label={t("me.ticket")} value={emp.nationality !== "sa" ? t("me.ticket_due") : t("me.ticket_na")} />
          <p className="pt-2 text-[11px] text-muted-foreground">{t("me.pay.info_note")}</p>
        </Panel>
      </div>

      {history.length > 0 && (
        <Panel title={t("me.pay.changes")} icon={TrendingUp} count={history.length}>
          <ul className="divide-y">
            {history.map((h) => (
              <li key={h.from} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-semibold">{t("me.pay.change_from", { date: hrDate(h.from, locale) })}</span>
                <span className="text-muted-foreground">
                  {t("pay.basic")} <span dir="ltr">{hrMoney(h.basic)}</span> · {t("me.pay.total")} <span dir="ltr">{hrMoney(h.wage)}</span>
                </span>
                {h.delta != null && h.delta !== 0 && (
                  <StatusPill tone={h.delta > 0 ? "ok" : "warn"} className="ms-auto">
                    <span dir="ltr">
                      {h.delta > 0 ? "+" : "−"}
                      {hrMoney(Math.abs(h.delta))}
                    </span>
                  </StatusPill>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}

/** ES-04 — the payslip: the components, then every addition and deduction with its reason. */
function PayslipBody({ slip, emp }: { slip: MySlip; emp: Pick<HrEmployee, "nationality" | "join"> }) {
  const t = useTranslations("Portal.HR")
  if (slip.kind === "supplementary") {
    const s = slip.line as SupplementaryLine
    return (
      <div className="border-t bg-muted/20 px-3 py-2">
        {(s.retro ?? 0) !== 0 && <KeyValueRow label={t("me.slip.retro")} value={hrMoney(s.retro)} ltr />}
        {(s.commission ?? 0) !== 0 && <KeyValueRow label={t("me.slip.commission")} value={hrMoney(s.commission)} ltr />}
        {(s.refunds ?? 0) !== 0 && <KeyValueRow label={t("me.slip.refund")} value={hrMoney(s.refunds)} ltr />}
        <KeyValueRow label={t("me.slip.net")} value={hrMoney(s.net)} ltr strong />
      </div>
    )
  }
  const p = slip.line as PayrollLine
  const row = (key: string, label: string, v: number, minus = false, strong = false) => (v ? <KeyValueRow key={key} label={label} value={`${minus ? "− " : ""}${hrMoney(v)}`} ltr strong={strong} /> : null)
  const hours = p.attendance?.overtimeHours ?? 0
  const rate = gosiRates(emp.nationality, emp.join).employee
  const transport = p.basic != null && p.housing != null ? r2(p.wage - p.basic - p.housing) : null
  return (
    <div className="space-y-0 border-t bg-muted/20 px-3 py-2">
      {p.basic != null && p.housing != null && (
        <div className="mb-1 border-b pb-1">
          {row("b", t("pay.basic"), p.basic)}
          {row("h", t("pay.housing"), p.housing)}
          {transport != null && row("tr", t("pay.transport"), transport)}
        </div>
      )}
      {row("mw", t("me.slip.month_wage", { days: p.days }), p.monthWage)}
      {row("ab", t("me.slip.absence", { days: p.attendance?.absent ?? 0 }), p.absenceDeduction, true)}
      {p.overtime > 0 && hours > 0 && <KeyValueRow label={t("me.slip.overtime_rate", { hours, rate: hrMoney(r2(p.overtime / hours)) })} value={hrMoney(p.overtime)} ltr />}
      {hours > STATUTORY.overtimeMonthlyCapHours && <p className="text-[11px] text-warning">{t("me.slip.ot_consent", { n: STATUTORY.overtimeMonthlyCapHours })}</p>}
      {row("cm", t("me.slip.commission"), p.commission)}
      {row("gr", t("me.slip.gross"), p.gross, false, true)}
      {p.gosiEmployee > 0 && rate > 0 && <KeyValueRow label={t("me.slip.gosi_rate", { rate: pct(rate), base: hrMoney(r2(p.gosiEmployee / rate)) })} value={`− ${hrMoney(p.gosiEmployee)}`} ltr />}
      {row("sk", t("me.slip.sick", { q: p.reasons?.sickThreeQuarters ?? 0, zero: p.reasons?.sickUnpaid ?? 0 }), p.sickDeduction, true)}
      {row("up", t("me.slip.unpaid", { days: p.reasons?.unpaidDays ?? 0 }), p.unpaidDeduction, true)}
      {(p.reasons?.penalties ?? []).map((x, i) => (
        <KeyValueRow key={`pn${i}`} label={t("me.slip.penalty", { code: t(`violation.${x.code}` as "violation.late15"), on: x.on })} value={`− ${hrMoney(x.deducted)}`} ltr />
      ))}
      {!p.reasons?.penalties?.length && row("pn", t("me.slip.penalties"), p.penalties, true)}
      {row("av", t("me.slip.advance"), p.advance, true)}
      {row("nt", t("me.slip.net"), p.net, false, true)}
    </div>
  )
}
