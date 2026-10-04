"use client"

// Reports (PRD RP-01/02, the prototype's `VIEWS.rep`): one card per report the
// viewer may read, computed from the live record the moment it is opened —
// previewed here and downloaded as CSV (UTF-8). Reports in riyals are not
// offered to roles that do not see pay (RL-03); the Mudad wage file and the
// GOSI statement of the last payroll sent to Finance sit beside them for the
// pay roles. `?report=<id>` opens one (Today's KPIs link here).

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { ArrowRight, Download, FileSpreadsheet, FileText, Landmark, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrPeople, useOrgPay } from "@/hooks/useHrPeople"
import { useHrRequests } from "@/hooks/useHrRequests"
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import { HR_ATTENDANCE, HR_EXITS, HR_PAYROLLS } from "@/lib/hr/collections"
import type { HrExit } from "@/lib/hr/exit-writes"
import { empNo, hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { gosiCsv, mudadCsv, type Payroll } from "@/lib/hr/payroll"
import { REPORTS, reportCsv, reportRows, visibleReports, type Cell, type ReportColumn, type ReportId } from "@/lib/hr/reports"
import { addDays } from "@/lib/hr/statutory"
import { cn } from "@/lib/utils"
import { useHrViolations } from "./HrViolationList"

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function HrReportsView({ access }: { access: HrAccess }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const params = useSearchParams()
  const today = todayDay()
  const orgId = access.orgId
  const money = access.allowed("pay.view")
  const reports = visibleReports(access.ctx)
  const asked = params.get("report") as ReportId | null
  const [open, setOpen] = useState<ReportId | null>(asked && reports.some((r) => r.id === asked) ? asked : null)

  const month = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
  const { employees, sites } = useHrPeople(access)
  const pays = useOrgPay(orgId, money)
  const { requests } = useHrRequests(access)
  const violations = useHrViolations(access)
  const orgQ = (name: string, on: boolean, ...extra: ReturnType<typeof where>[]) => (firestore && orgId && on ? query(collection(firestore, name), where("organizationId", "==", orgId), ...extra) : null)
  const attQ = useMemoFirebase(() => orgQ(HR_ATTENDANCE, reports.some((r) => r.id === "attendance"), where("month", "==", month)), [firestore, orgId, month, reports.length])
  const prQ = useMemoFirebase(() => orgQ(HR_PAYROLLS, money), [firestore, orgId, money])
  const exQ = useMemoFirebase(() => orgQ(HR_EXITS, reports.length > 0), [firestore, orgId, reports.length])
  const { data: att } = useCollection(attQ)
  const { data: pr } = useCollection(prQ)
  const { data: ex } = useCollection(exQ)
  const payrolls = useMemo(() => (pr ?? []) as unknown as Payroll[], [pr])

  const world = useMemo(
    () => ({ today, locale, employees, sites, pays, payrolls, month, attendance: (att ?? []) as unknown as WorkplaceMonth[], requests, violations, exits: (ex ?? []) as unknown as HrExit[] }),
    [today, locale, employees, sites, pays, payrolls, month, att, requests, violations, ex]
  )
  const rowsOf = useMemo(() => {
    const cache = new Map<ReportId, Cell[][]>()
    return (id: ReportId) => {
      if (!cache.has(id)) cache.set(id, reportRows(id, world))
      return cache.get(id)!
    }
  }, [world])

  const cell = (col: ReportColumn, v: Cell, csv = false): string => {
    if (v == null || v === "") return csv ? "" : col.kind === "site" ? t("sites.unassigned") : "—"
    switch (col.kind) {
      case "no":
        return empNo(Number(v))
      case "money":
        return csv ? Number(v).toFixed(2) : hrMoney(Number(v))
      case "date":
        return csv ? String(v) : hrDate(String(v), locale)
      case "pct":
        return `${v}%`
      case "enum":
        return t(`${col.enumOf}.${v}` as "status.active")
      default:
        return String(v)
    }
  }
  const header = (id: ReportId) => REPORTS[id].columns.map((c) => t(`rep.col.${c.key}` as "rep.col.no"))
  const exportCsv = (id: ReportId) => download(`hr-${id}-${today}.csv`, reportCsv(header(id), rowsOf(id).map((r) => r.map((v, i) => cell(REPORTS[id].columns[i], v, true)))))

  // The payroll last sent to Finance — its files as they were sent.
  const sent = payrolls.filter((p) => p.kind === "main" && p.state !== "prepared").sort((a, b) => b.month.localeCompare(a.month))[0] ?? null

  if (!reports.length) return <EmptyState icon={FileText} title={t("rep.none")} description={t("rep.none_desc")} />

  if (open) {
    const def = REPORTS[open]
    const rows = rowsOf(open)
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
            <ArrowRight size={15} className="me-1.5 rtl-flip ltr:rotate-180" aria-hidden="true" />
            {t("rep.back")}
          </Button>
          <Button size="sm" onClick={() => exportCsv(open)} disabled={rows.length === 0}>
            <Download size={15} className="me-1.5" aria-hidden="true" />
            {t("rep.csv")}
          </Button>
        </div>
        <Panel title={t(`rep.r.${open}.title` as "rep.r.register.title")} icon={FileSpreadsheet} count={rows.length} bodyClassName="p-0">
          <p className="border-b px-4 py-2 text-xs text-muted-foreground">
            {t(`rep.r.${open}.desc` as "rep.r.register.desc", { month })}
          </p>
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("rep.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    {def.columns.map((c, i) => (
                      <th key={c.key} scope="col" className={cn("px-3 py-2.5 font-bold", c.kind === "money" || c.kind === "num" || c.kind === "pct" ? "text-end" : "text-start")}>
                        {header(open)[i]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ri) => (
                    <tr key={ri} className="border-t">
                      {r.map((v, i) => {
                        const c = def.columns[i]
                        const numeric = c.kind === "money" || c.kind === "num" || c.kind === "pct" || c.kind === "no"
                        return (
                          <td key={c.key} className={cn("px-3 py-2", numeric && "tabular-nums", c.kind === "no" && "text-muted-foreground", numeric && c.kind !== "no" ? "text-end" : "text-start")} dir={numeric || c.kind === "date" ? "ltr" : "auto"}>
                            {cell(c, v)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setOpen(r.id)}
              className="flex h-full min-h-11 w-full items-start gap-3 rounded-xl border bg-card p-4 text-start transition-colors hover:border-module/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-module/10 text-module">
                <FileSpreadsheet size={17} aria-hidden="true" />
              </span>
              <span className="min-w-0 space-y-1">
                <span className="block text-sm font-bold text-foreground">{t(`rep.r.${r.id}.title` as "rep.r.register.title")}</span>
                <span className="block text-xs text-muted-foreground">{t(`rep.r.${r.id}.desc` as "rep.r.register.desc", { month })}</span>
                <span className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{t("rep.rows", { n: rowsOf(r.id).length })}</span>
                  {r.money && <StatusPill tone="module">{t("rep.sar")}</StatusPill>}
                </span>
              </span>
            </button>
          </li>
        ))}
        {money && sent && (
          <>
            <li>
              <button
                type="button"
                onClick={() => download(`mudad-${sent.month}.csv`, mudadCsv(sent.lines, pays))}
                className="flex h-full min-h-11 w-full items-start gap-3 rounded-xl border bg-card p-4 text-start transition-colors hover:border-module/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-module/10 text-module">
                  <Landmark size={17} aria-hidden="true" />
                </span>
                <span className="min-w-0 space-y-1">
                  <span className="block text-sm font-bold text-foreground">{t("rep.mudad", { month: sent.month })}</span>
                  <span className="block text-xs text-muted-foreground">{t("rep.mudad_desc")}</span>
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => download(`gosi-${sent.month}.csv`, gosiCsv(sent.lines, pays))}
                className="flex h-full min-h-11 w-full items-start gap-3 rounded-xl border bg-card p-4 text-start transition-colors hover:border-module/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-module/10 text-module">
                  <ShieldCheck size={17} aria-hidden="true" />
                </span>
                <span className="min-w-0 space-y-1">
                  <span className="block text-sm font-bold text-foreground">{t("rep.gosi", { month: sent.month })}</span>
                  <span className="block text-xs text-muted-foreground">{t("rep.gosi_desc")}</span>
                </span>
              </button>
            </li>
          </>
        )}
      </ul>
      <Callout tone="info">{t(money ? "rep.note" : "rep.note_no_pay")}</Callout>
    </div>
  )
}
