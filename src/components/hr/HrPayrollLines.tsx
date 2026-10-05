"use client"

// The payroll's lines (PY-06 — the prototype's `payView` table): by default
// the EXCEPTIONS — absence, overtime, sick or unpaid days, a penalty, an
// advance, commission, a held transfer, a net of zero or less, or a pre-Mudad
// warning — grouped by cost centre (the workplace: the largest first, the
// unassigned last; held lines last inside each), with "all lines" and "held"
// a click away, and the totals of what is shown under them.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useTableLabels } from "@/hooks/useTableLabels"
import { Link } from "@/i18n/routing"
import { empNo, hrMoney } from "@/lib/hr/format"
import { groupByCostCentre, isException, lineWarnings, type PayrollLine } from "@/lib/hr/payroll"
import { overtimeOverCap } from "@/lib/hr/pay"
import { r2 } from "@/lib/hr/statutory"
import type { HrPortal } from "./HrShell"

type Filter = "exceptions" | "all" | "held"

export function HrPayrollLines({
  lines,
  portal,
  siteName,
  tradeOf,
  returned,
}: {
  lines: PayrollLine[]
  portal: HrPortal
  siteName: (id: string | null) => string
  /** The employee's trade, in the reader's language. */
  tradeOf: (employeeId: string) => string | null
  /** Transfers the bank sent back (Finance's), by employee. */
  returned?: Record<string, unknown> | null
}) {
  const t = useTranslations("Portal.HR")
  const labels = useTableLabels()
  const [filter, setFilter] = useState<Filter>("exceptions")
  const exceptions = useMemo(() => lines.filter(isException), [lines])
  const held = useMemo(() => lines.filter((l) => l.held), [lines])
  const shown = filter === "all" ? lines : filter === "held" ? held : exceptions
  const groups = useMemo(() => groupByCostCentre(shown), [shown])
  const sum = (k: (l: PayrollLine) => number, ls: PayrollLine[]) => r2(ls.reduce((s, l) => s + k(l), 0))
  const heldShown = shown.filter((l) => l.held).length

  const columns: DataColumn<PayrollLine>[] = [
    {
      key: "emp",
      header: t("payroll.col.employee"),
      sortValue: (l) => l.name,
      cell: (l) => (
        <div className="min-w-0 space-y-0.5">
          <Link href={`/${portal}/hr/people/${l.employeeId}`} className="rounded font-semibold hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <bdi dir="ltr" className="me-1.5 text-xs font-normal text-muted-foreground">
              {empNo(l.no)}
            </bdi>
            <span dir="auto">{l.name}</span>
          </Link>
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {tradeOf(l.employeeId) && <span>{tradeOf(l.employeeId)}</span>}
            <span>· {t(`cost_kind.${l.costKind}`)}</span>
            {l.commission > 0 && (
              <StatusPill tone="ok">
                {t("payroll.ex.commission", { amount: hrMoney(l.commission) })}
              </StatusPill>
            )}
            {l.held && <StatusPill tone="bad">{t(`payroll.held_reason.${l.heldReason ?? "iban_returned"}`)}</StatusPill>}
            {!l.held && returned?.[l.employeeId] ? <StatusPill tone="bad">{t("payroll.file.returned")}</StatusPill> : null}
          </div>
        </div>
      ),
    },
    {
      key: "att",
      header: t("payroll.col.dao"),
      cell: (l) => (
        <span className="tabular-nums">
          {l.days} · <span className={l.attendance.absent > 0 ? "font-bold text-destructive" : undefined}>{l.attendance.absent}</span> · {l.attendance.overtimeHours}
          {overtimeOverCap(l.attendance.overtimeHours) && (
            <span className="ms-1 rounded bg-warning/15 px-1 text-[11px] font-bold text-warning" title={t("payroll.ex.ot_flag_title")}>
              +60
            </span>
          )}
        </span>
      ),
    },
    { key: "gross", header: t("payroll.col.gross"), numeric: true, sortValue: (l) => l.gross, cell: (l) => hrMoney(l.gross) },
    { key: "ded", header: t("payroll.col.deductions"), numeric: true, sortValue: (l) => r2(l.gross - l.net), cell: (l) => (l.gross - l.net > 0 ? `−${hrMoney(r2(l.gross - l.net))}` : "—") },
    { key: "net", header: t("payroll.col.net"), numeric: true, sortValue: (l) => l.net, cell: (l) => <strong>{hrMoney(l.net)}</strong> },
    {
      key: "check",
      header: t("payroll.col.notes"),
      cardHidden: false,
      cell: (l) => (
        <div className="flex flex-wrap gap-1">
          {lineWarnings(l)
            .filter((w) => w !== "held")
            .map((w) => (
              <StatusPill key={w} tone={w === "net_negative" ? "bad" : "warn"}>
                {t(`payroll.w.${w}`)}
              </StatusPill>
            ))}
        </div>
      ),
    },
  ]

  const toggle = filter === "exceptions" ? { to: "all" as const, label: t("payroll.ex.show_all", { n: lines.length }) } : { to: "exceptions" as const, label: t("payroll.ex.show_exc", { n: exceptions.length }) }

  return (
    <Panel
      title={t(filter === "exceptions" ? "payroll.ex.title" : filter === "held" ? "payroll.ex.title_held" : "payroll.ex.title_all")}
      icon={Receipt}
      count={shown.length}
      actions={
        <div className="flex gap-1" role="group" aria-label={t("payroll.filter")}>
          {(["exceptions", "all", "held"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} aria-pressed={filter === f} onClick={() => setFilter(f)} className="h-8 rounded-full text-xs">
              {t(`payroll.f.${f}`)}
            </Button>
          ))}
        </div>
      }
      bodyClassName="space-y-4"
    >
      {filter === "exceptions" && <p className="text-xs text-muted-foreground">{t("payroll.ex.note")}</p>}
      {groups.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t(filter === "exceptions" ? "payroll.ex.none" : "payroll.no_lines")}</p>}
      {groups.map((g) => (
        <section key={g.siteId ?? "-"} className="overflow-hidden rounded-xl border" aria-label={siteName(g.siteId)}>
          <header className="flex flex-wrap items-center justify-between gap-2 bg-muted/60 px-4 py-2 text-sm">
            <span className="font-bold" dir="auto">
              {siteName(g.siteId)}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("payroll.ex.group", { n: g.count })} · <bdi dir="ltr" className="font-bold text-foreground">{hrMoney(g.net)}</bdi>
            </span>
          </header>
          <DataTable
            caption={siteName(g.siteId)}
            labels={labels}
            dense
            bordered={false}
            columns={columns}
            rows={g.lines}
            rowKey={(l) => l.employeeId}
            rowTone={(l) => (l.held ? "warn" : l.net <= 0 ? "bad" : undefined)}
            pageSize={30}
            empty={null}
          />
        </section>
      ))}
      {shown.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border bg-muted/40 px-4 py-2.5 text-sm">
          <span className="text-xs text-muted-foreground">
            {t("payroll.ex.footer", { n: shown.length })}
            {heldShown > 0 && ` · ${t("payroll.ex.footer_held", { n: heldShown })}`}
          </span>
          <span className="flex flex-wrap gap-x-4 font-bold">
            <span>
              {t("payroll.col.gross")} <bdi dir="ltr">{hrMoney(sum((l) => l.gross, shown))}</bdi>
            </span>
            <span>
              {t("payroll.col.deductions")} <bdi dir="ltr">−{hrMoney(sum((l) => l.gross - l.net, shown))}</bdi>
            </span>
            <span>
              {t("payroll.col.net")} <bdi dir="ltr">{hrMoney(sum((l) => l.net, shown))}</bdi>
            </span>
          </span>
        </div>
      )}
      {filter !== "held" && (
        <button type="button" onClick={() => setFilter(toggle.to)} className="rounded text-sm font-semibold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {toggle.label}
        </button>
      )}
    </Panel>
  )
}
