"use client"

// The payroll's own panels (PY-06, PY-09, §7.2 — the prototype's `ccSplit`,
// `x7JE` and `x6PayPanels`): the cost by cost centre, what reaches Finance
// (the two keyed events, shown as the entry Finance will post — we show it, we
// do not write it), and the reconciliation with Finance — what was sent, paid
// and still owed, the GOSI statement against its payment, and the end-of-service
// provision against the ledger. Pay roles only: the screen is theirs.

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, query, where } from "firebase/firestore"
import { BookOpen, Landmark, PieChart } from "lucide-react"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useTableLabels } from "@/hooks/useTableLabels"
import { ACC, accountName } from "@/lib/accounting/accounts"
import { JOURNAL_ENTRIES } from "@/lib/accounting/journal"
import { postHrEos, postHrPay, type PostingResult } from "@/lib/accounting/posting-rules"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { hrDate, hrMoney } from "@/lib/hr/format"
import { costByCentre, creditBalance, eosEvent, eosReconciliation, financeReconciliation, payEvent, type Payroll, type PayrollLine } from "@/lib/hr/payroll"
import { monthRange, r2 } from "@/lib/hr/statutory"
import { cn } from "@/lib/utils"

const BAR = ["bg-module", "bg-module/70", "bg-module/50", "bg-module/35", "bg-module/20", "bg-muted-foreground/40"]

/** PY-06 — the month's cost by cost centre (each workplace), as Finance books it. */
export function CostCentreBar({ lines, siteName }: { lines: PayrollLine[]; siteName: (id: string | null) => string }) {
  const t = useTranslations("Portal.HR")
  const split = useMemo(() => costByCentre(lines), [lines])
  if (!split.length) return null
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4" aria-label={t("payroll.cc_title")}>
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <PieChart size={16} className="text-module" aria-hidden="true" />
        {t("payroll.cc_title")}
      </h3>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {split.map((s, i) => (
          <i key={s.siteId ?? "-"} className={cn("h-full", BAR[i % BAR.length])} style={{ width: `${s.share * 100}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {split.map((s, i) => (
          <li key={s.siteId ?? "-"} className="flex items-center gap-1.5">
            <i className={cn("inline-block size-2.5 rounded-full", BAR[i % BAR.length])} aria-hidden="true" />
            <span dir="auto">{siteName(s.siteId)}</span>
            <bdi dir="ltr" className="font-bold tabular-nums">
              {hrMoney(s.amount)}
            </bdi>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The lines of an entry as Finance will post it: account, note, debit or credit. The first `labels` lines get a
 * cost-centre label (the workplace each debit row belongs to). */
export function EntryPreview({ result, labels = [], heldNote }: { result: PostingResult; labels?: string[]; heldNote?: string | null }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const labelsOf = useTableLabels()
  type Row = PostingResult["lines"][number] & { i: number }
  const rows: Row[] = result.lines.map((l, i) => ({ ...l, i }))
  const columns: DataColumn<Row>[] = [
    {
      key: "account",
      header: t("payroll.je.account"),
      sortValue: (l) => l.account,
      cell: (l) => (
        <>
          <bdi dir="ltr" className="tabular-nums text-muted-foreground">
            {l.account}
          </bdi>{" "}
          <span className="font-semibold">{accountName(l.account, locale)}</span>
          {labels[l.i] && <span className="text-xs text-muted-foreground"> · {t("payroll.je.centre", { name: labels[l.i] })}</span>}
          {heldNote && l.account === ACC.employeeAccruals && <span className="text-xs text-muted-foreground"> · {heldNote}</span>}
        </>
      ),
      footer: t("rep.total"),
    },
    { key: "dr", header: t("payroll.je.dr"), numeric: true, sortValue: (l) => l.debit || null, cell: (l) => (l.debit ? hrMoney(l.debit) : ""), footer: hrMoney(r2(rows.reduce((s, l) => s + (l.debit || 0), 0))) },
    { key: "cr", header: t("payroll.je.cr"), numeric: true, sortValue: (l) => l.credit || null, cell: (l) => (l.credit ? hrMoney(l.credit) : ""), footer: hrMoney(r2(rows.reduce((s, l) => s + (l.credit || 0), 0))) },
  ]
  return <DataTable caption={t("payroll.je.caption")} labels={labelsOf} dense bordered={false} columns={columns} rows={rows} rowKey={(l) => `${l.account}-${l.i}`} empty={null} />
}

/** §7.2, AC-03 — what reaches Finance: hr:PAY (and hr:EOS for the main payroll), exactly as Finance's desk will post them. */
export function PayrollEventsPanel({ payroll, siteName }: { payroll: Pick<Payroll, "key" | "month" | "kind" | "lines" | "supplementary">; siteName: (id: string | null) => string }) {
  const t = useTranslations("Portal.HR")
  const pay = payEvent(payroll)
  const eos = payroll.kind === "main" ? eosEvent(payroll) : null
  const date = monthRange(payroll.month).end
  const centres = (rows: Array<{ siteId: string | null; amount: number }>) => rows.filter((r) => r2(r.amount) !== 0).map((r) => siteName(r.siteId))
  return (
    <DrawerSection
      defaultOpen={false}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <BookOpen size={15} className="text-module" aria-hidden="true" />
          {t("payroll.je.title")}
          <span className="text-xs font-normal text-muted-foreground">{t("payroll.je.sub")}</span>
        </span>
      }
    >
      <div className="space-y-4 py-2">
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
            {t("payroll.je.pay")}
            <bdi dir="ltr" className="text-xs font-normal text-muted-foreground">
              {pay.key}
            </bdi>
          </p>
          <EntryPreview result={postHrPay({ key: pay.key, month: payroll.month, date, debit: pay.debit, credit: pay.credit })} labels={centres(pay.debit)} heldNote={pay.held ? t("payroll.je.held_in", { amount: hrMoney(pay.held) }) : null} />
        </div>
        {eos && (
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
              {t("payroll.je.eos")}
              <bdi dir="ltr" className="text-xs font-normal text-muted-foreground">
                {eos.key}
              </bdi>
            </p>
            <EntryPreview result={postHrEos({ key: eos.key, month: payroll.month, date, debit: eos.debit, credit: eos.credit })} labels={centres(eos.debit)} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("payroll.je.footer")}</p>
      </div>
    </DrawerSection>
  )
}

/** PY-09 — the reconciliation with Finance on a main payroll Finance has: we read and reconcile, Finance pays. */
export function ReconciliationPanel({
  payroll,
  today,
  orgId,
  employees,
  pays,
}: {
  payroll: Payroll
  today: string
  orgId: string
  employees: HrEmployee[]
  pays: Map<string, EmployeePay>
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const rec = financeReconciliation(payroll, today)
  const gosiState = rec.gosiPaid ? (
    <StatusPill tone="ok">{t("payroll.rec.gosi_paid", { date: hrDate(rec.gosiPaid.date, locale) })}</StatusPill>
  ) : rec.gosiOverdue ? (
    <StatusPill tone="bad">{t("payroll.rec.gosi_overdue", { date: hrDate(rec.gosiDue, locale) })}</StatusPill>
  ) : (
    <StatusPill tone="mute">{t("payroll.rec.gosi_due", { date: hrDate(rec.gosiDue, locale) })}</StatusPill>
  )
  return (
    <DrawerSection
      defaultOpen={false}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Landmark size={15} className="text-module" aria-hidden="true" />
          {t("payroll.rec.title")}
          <SourceBadge module="payments" label={t("payroll.rec.finance")} />
        </span>
      }
    >
      <div className="py-1">
        <KeyValueRow label={t("payroll.rec.payable")} value={<bdi dir="ltr">{hrMoney(rec.payable)}</bdi>} />
        <KeyValueRow label={t("payroll.rec.paid")} value={<bdi dir="ltr">{rec.paid === null ? "—" : hrMoney(rec.paid)}</bdi>} />
        <KeyValueRow
          label={t("payroll.rec.owed")}
          value={
            <span className={cn(rec.owedCount > 0 && "text-destructive")}>
              <bdi dir="ltr">{hrMoney(rec.owed)}</bdi> <span className="text-xs text-muted-foreground">{t("payroll.rec.owed_n", { n: rec.owedCount })}</span>
            </span>
          }
        />
        <KeyValueRow
          label={t("payroll.rec.gosi")}
          value={
            <span className="inline-flex flex-wrap items-center justify-end gap-2">
              <bdi dir="ltr">{hrMoney(rec.gosi)}</bdi>
              {gosiState}
            </span>
          }
        />
        <KeyValueRow label={t("payroll.rec.eos")} value={<bdi dir="ltr">{hrMoney(rec.eos)}</bdi>} />
        <KeyValueRow label={t("payroll.rec.leave")} value={<bdi dir="ltr">{hrMoney(rec.leave)}</bdi>} />
        <p className="pt-2 text-xs text-muted-foreground">{t("payroll.rec.note")}</p>
        <EosAgainstLedger orgId={orgId} today={today} employees={employees} pays={pays} />
      </div>
    </DrawerSection>
  )
}

/** hr:RECON — today's gratuity of everyone in service against the provision's balance in the ledger. The journal is
 * read only when the reconciliation is opened (the section mounts its body on opening). */
function EosAgainstLedger({ orgId, today, employees, pays }: { orgId: string; today: string; employees: HrEmployee[]; pays: Map<string, EmployeePay> }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const setRef = useMemoFirebase(() => (firestore ? doc(firestore, "accounting_settings", orgId) : null), [firestore, orgId])
  const { data: acc } = useDoc(setRef)
  const on = (acc as { enabled?: boolean } | null)?.enabled === true
  const jq = useMemoFirebase(() => (firestore && on ? query(collection(firestore, JOURNAL_ENTRIES), where("organizationId", "==", orgId)) : null), [firestore, orgId, on])
  const { data: entries } = useCollection(jq)
  const ledger = on ? creditBalance((entries ?? []) as Array<{ lines?: Array<{ account: string; debit?: number; credit?: number }> }>, ACC.endOfServiceProvision) : null
  const x = eosReconciliation(employees, pays, today, ledger)
  return (
    <div className="mt-3 rounded-lg border border-dashed p-3">
      <p className="text-sm font-bold">{t("payroll.rec.eos_title")}</p>
      <KeyValueRow label={t("payroll.rec.eos_accrued", { n: x.people })} value={<bdi dir="ltr">{hrMoney(x.accrued)}</bdi>} />
      {x.ledger === null ? (
        <p className="pt-1 text-xs text-muted-foreground">{t("payroll.rec.eos_off")}</p>
      ) : (
        <>
          <KeyValueRow label={t("payroll.rec.eos_ledger")} value={<bdi dir="ltr">{hrMoney(x.ledger)}</bdi>} />
          <KeyValueRow label={t("payroll.rec.eos_diff")} value={<bdi dir="ltr">{hrMoney(x.difference)}</bdi>} strong />
        </>
      )}
    </div>
  )
}
