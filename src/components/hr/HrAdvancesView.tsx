"use client"

// The Payroll page's «السلف» segment (AD-01…03, PRD §5 Payroll — the
// prototype's `advView`): the advances running — balance, instalment, months
// left — and the requests: waiting for a decision (decided from here, in the
// request list's own dialog), with Finance above the HR limit, approved and
// waiting to be paid out, or declined lately. Instalments come off the payroll;
// never a second advance before the first is repaid.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { HandCoins, ListChecks } from "lucide-react"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { Panel } from "@/components/module-ui/Panel"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useTableLabels } from "@/hooks/useTableLabels"
import { Link } from "@/i18n/routing"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { empNo, hrMoney } from "@/lib/hr/format"
import { advanceRequestsInView, outstandingAdvances, type OutstandingAdvance } from "@/lib/hr/payroll"
import type { HrRequest } from "@/lib/hr/requests"
import { HrRequestList } from "./HrRequestList"
import type { HrPortal } from "./HrShell"

export function HrAdvancesView({
  access,
  portal,
  employees,
  pays,
  requests,
  today,
}: {
  access: HrAccess
  portal: HrPortal
  employees: HrEmployee[]
  pays: Map<string, EmployeePay>
  requests: HrRequest[]
  today: string
}) {
  const t = useTranslations("Portal.HR")
  const labels = useTableLabels()
  const running = useMemo(() => outstandingAdvances(employees, pays), [employees, pays])
  const asked = useMemo(() => advanceRequestsInView(requests, today), [requests, today])
  const total = running.reduce((s, a) => s + a.balance, 0)

  const columns: DataColumn<OutstandingAdvance>[] = [
    {
      key: "emp",
      header: t("payroll.adv.col.employee"),
      sortValue: (a) => a.name,
      cell: (a) => (
        <Link href={`/${portal}/hr/people/${a.employeeId}`} className="rounded font-semibold hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <bdi dir="ltr" className="me-1.5 text-xs text-muted-foreground">
            {empNo(a.no)}
          </bdi>
          <span dir="auto">{a.name}</span>
        </Link>
      ),
      footer: t("payroll.total_row", { n: running.length }),
    },
    { key: "amount", header: t("payroll.adv.col.amount"), numeric: true, sortValue: (a) => a.amount, cell: (a) => hrMoney(a.amount), hideBelow: "lg" },
    { key: "balance", header: t("payroll.adv.col.balance"), numeric: true, sortValue: (a) => a.balance, cell: (a) => hrMoney(a.balance), footer: hrMoney(total) },
    { key: "inst", header: t("payroll.adv.col.instalment"), numeric: true, sortValue: (a) => a.instalment, cell: (a) => hrMoney(a.instalment) },
    { key: "ends", header: t("payroll.adv.col.ends"), sortValue: (a) => a.monthsLeft, cell: (a) => t("payroll.adv.ends_in", { n: a.monthsLeft }) },
  ]

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title={t("payroll.adv.outstanding")} icon={HandCoins} count={running.length} bodyClassName="space-y-3">
        <p className="text-xs text-muted-foreground">{t("payroll.adv.outstanding_sub")}</p>
        <DataTable
          caption={t("payroll.adv.outstanding")}
          labels={labels}
          dense
          columns={columns}
          rows={running}
          rowKey={(a) => a.employeeId}
          initialSort={{ key: "balance", dir: "desc" }}
          empty={<p className="py-6 text-center text-sm text-muted-foreground">{t("payroll.adv.none")}</p>}
        />
      </Panel>
      <Panel title={t("payroll.adv.requests")} icon={ListChecks} count={asked.length} bodyClassName="space-y-3">
        <p className="text-xs text-muted-foreground">{t("payroll.adv.requests_sub", { n: access.settings.policies.advanceMaxMonths })}</p>
        <HrRequestList access={access} requests={asked} portal={portal} empty={t("payroll.adv.requests_none")} />
      </Panel>
    </div>
  )
}
