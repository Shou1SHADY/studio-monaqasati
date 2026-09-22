"use client"

// التقارير — seven questions over the live record (PRD 3.0 §9): where spend
// goes, who carries it, who delivers on time, which way prices move, how long
// a cycle takes and how much competition it had, what left the usual path,
// and what Finance will be asked for soon. Every table is one pure function
// in `src/lib/procurement/reports.ts`; this screen picks, formats and
// exports. Values are commitments EXCLUDING VAT, never costs. A member who
// may not see money is shown the three reports that carry none — the others
// are removed, not masked. CSV carries plain numbers and no currency sign.

import type { ElementType, ReactNode } from "react"
import { useCallback, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, BarChart3, Banknote, Clock, Download, FolderOpen, Loader2, Lock, TrendingUp, Truck, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Link, useRouter } from "@/i18n/routing"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { displayDocNumber } from "@/lib/procurement/format"
import { todayOf } from "@/lib/procurement/po"
import { COMMITMENT_BUCKETS, cycleAndCompetition, deliveryPerformance, exceptions, lastDays, openCommitments, priceDrift, spendByProject, spendBySupplier, type Period } from "@/lib/procurement/reports"
import { csvText, PERIOD_PRESETS, PROC_REPORTS_HREF, REPORT_NEEDS_PRICE, resolveReport, toProcWorld, visibleReports, type PeriodPreset, type ReportId } from "@/lib/procurement/shell"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

const REPORT_ICON: Record<ReportId, ElementType> = {
  project: FolderOpen,
  supplier: Users,
  delivery: Truck,
  drift: TrendingUp,
  cycle: Clock,
  exceptions: AlertTriangle,
  commitments: Banknote,
}

/** On screen: the sign, isolated LTR. */
const money = (n: number | null | undefined) => (n == null ? "—" : sarLtr(Math.round(n).toLocaleString("en-US")))
const money2 = (n: number | null | undefined) => (n == null ? "—" : sarLtr(n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })))
const signed = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : money(0))
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`)
const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"))

function fmtDay(day: string | null | undefined, locale: string): string {
  if (!day) return "—"
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" })
}

function downloadCsv(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ProcurementReports() {
  const t = useTranslations("Portal.ProcReports")
  const tProc = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const router = useRouter()
  const params = useSearchParams()
  const loaded = useProcurementWorld()
  const { actor, loading } = loaded
  const [now] = useState(() => new Date())
  const today = todayOf(now)

  const { orders, deliveries, rfqs, offers, policies, supplierFacts } = loaded
  const world = useMemo(() => toProcWorld({ orders, deliveries, rfqs, offers, policies, supplierFacts }), [orders, deliveries, rfqs, offers, policies, supplierFacts])

  const sees = actor.seesPrices
  const reports = visibleReports(sees)
  const report = resolveReport(params.get("report"), sees)
  const setReport = useCallback((id: ReportId) => router.replace(`${PROC_REPORTS_HREF}?report=${id}`), [router])

  const [preset, setPreset] = useState<PeriodPreset>("90")
  const [customFrom, setCustomFrom] = useState(() => lastDays(90, now).from || "")
  const [customTo, setCustomTo] = useState(today)
  const period = useMemo<Period>(() => {
    if (preset === "30") return lastDays(30, now)
    if (preset === "90") return lastDays(90, now)
    if (preset === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today }
    return { from: customFrom || null, to: customTo || null }
  }, [preset, now, today, customFrom, customTo])
  const periodFiltered = report !== "commitments"

  // Every report is computed lazily — only the one on screen.
  const project = useMemo(() => (report === "project" ? spendByProject(world, period) : null), [report, world, period])
  const supplier = useMemo(() => (report === "supplier" ? spendBySupplier(world, period, now) : null), [report, world, period, now])
  const delivery = useMemo(() => (report === "delivery" ? deliveryPerformance(world, period, now) : null), [report, world, period, now])
  const drift = useMemo(() => (report === "drift" ? priceDrift(world, period) : null), [report, world, period])
  const cycle = useMemo(() => (report === "cycle" ? cycleAndCompetition(world, period) : null), [report, world, period])
  const exc = useMemo(() => (report === "exceptions" ? exceptions(world, period) : null), [report, world, period])
  const commit = useMemo(() => (report === "commitments" ? openCommitments(world, now) : null), [report, world, now])

  const docNo = (n: string) => displayDocNumber(n, locale)

  const exportCsv = () => {
    let head: string[] = []
    let rows: Array<Array<string | number | null | undefined>> = []
    if (project) {
      head = [t("cols.requester"), t("cols.orders"), t("cols.lines"), t("cols.ordered"), t("cols.received"), t("cols.open")]
      rows = project.rows.map((r) => [r.projectName || t("cols.noProject"), r.orders, r.lines, r.ordered, r.receivedUnknown ? null : r.received, r.open])
      rows.push([t("total"), project.totals.orders, project.totals.lines, project.totals.ordered, project.totals.received, project.totals.open])
    } else if (supplier) {
      head = [t("cols.supplier"), t("cols.orders"), t("cols.value"), t("cols.share"), t("cols.onTime")]
      rows = supplier.rows.map((r) => [r.supplierName, r.orders, r.value, r.sharePercent, r.onTimePercent])
      rows.push([t("total"), supplier.totals.orders, supplier.totals.value, 100, null])
    } else if (delivery) {
      head = [t("cols.po"), t("cols.supplier"), t("cols.promised"), t("cols.lastReceipt"), t("cols.gap")]
      rows = delivery.orders.map((r) => [r.docNumber, r.supplierName, r.promisedDate, r.lastReceiptDay, r.gap])
    } else if (drift) {
      head = [t("cols.material"), t("cols.po"), t("cols.supplier"), t("cols.day"), t("cols.previous"), t("cols.current"), t("cols.qty"), t("cols.impact")]
      rows = drift.rows.map((r) => [`${r.name} (${r.unit})`, r.docNumber, r.supplierName, r.day, r.previous, r.current, r.quantity, r.impact])
      rows.push([t("total"), null, null, null, null, null, null, drift.totals.impact])
    } else if (cycle) {
      head = [t("cols.rfq"), t("cols.invited"), t("cols.offers"), t("cols.awarded"), t("cols.days"), t("cols.lowest"), t("cols.awardedValue"), t("cols.competition")]
      rows = cycle.rows.map((r) => [r.title, r.invitedCount, r.offersCount, r.awarded ? 1 : 0, r.publishToAwardDays, sees ? r.lowestTotal : null, sees ? r.awardedTotal : null, r.shortCompetition ? 1 : 0])
    } else if (exc) {
      head = [t("cols.day"), t("cols.document"), t("cols.supplier"), t("cols.exception"), t("cols.by"), t("cols.approvedBy")]
      rows = exc.map((r) => [r.day, r.docNumber, r.supplierName, tProc(`exception.${r.kind}`, r.params), r.byName, r.approvedByName])
    } else if (commit) {
      head = [t("cols.po"), t("cols.supplier"), t("cols.promised"), t("cols.dueIn"), t("cols.value"), t("cols.bucket")]
      rows = commit.rows.map((r) => [r.docNumber, r.supplierName, r.promisedDate, r.daysToDue, r.value, tProc(`commitmentBucket.${r.bucket}`)])
      rows.push([t("total"), null, null, null, commit.total, null])
    }
    downloadCsv(`procurement-${report}.csv`, csvText(head, rows))
  }

  const periodLabel = preset === "custom" ? `${fmtDay(period.from, locale)} – ${fmtDay(period.to, locale)}` : t(`period.${preset}`)

  return (
    <div className="space-y-6">
      <ProcurementHeader
        icon={BarChart3}
        title={t("page.title")}
        description={t("page.subtitle")}
        action={
          !loading && (
            <Button variant="outline" className="gap-2" onClick={exportCsv}>
              <Download size={16} aria-hidden="true" />
              {t("csv")}
            </Button>
          )
        }
      />

      {!sees && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock size={11} aria-hidden="true" />
          {t("noPrices")}
        </p>
      )}

      {/* ── Which report, and over which days ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label={t("page.title")}>
          {reports.map((id) => {
            const Icon = REPORT_ICON[id]
            const on = report === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setReport(id)}
                className={cn(
                  "flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "border-module bg-module text-white" : "border-border bg-white text-muted-foreground hover:border-module/40 hover:text-foreground"
                )}
              >
                <Icon size={14} aria-hidden="true" />
                {t(`report.${id}`)}
              </button>
            )
          })}
        </div>
        {periodFiltered && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("period.label")}>
            {PERIOD_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={preset === p}
                onClick={() => setPreset(p)}
                className={cn(
                  "min-h-9 rounded-lg border px-3 py-1.5 text-xs font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  preset === p ? "border-primary bg-primary text-white" : "border-border bg-white text-muted-foreground hover:border-slate-300"
                )}
              >
                {t(`period.${p}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {periodFiltered && preset === "custom" && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3">
          <div className="grid gap-1">
            <Label htmlFor="proc-rep-from" className="text-[11px]">{t("period.from")}</Label>
            <Input id="proc-rep-from" type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="proc-rep-to" className="text-[11px]">{t("period.to")}</Label>
            <Input id="proc-rep-to" type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} className="h-9 w-40" />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : (
        <Panel title={t(`report.${report}`)} sub={periodFiltered ? periodLabel : t("period.notApplied")} icon={REPORT_ICON[report]}>
          {/* 1 · Spend by project */}
          {project && (
            <>
              {project.rows.length === 0 ? (
                <Empty>{t("empty")}</Empty>
              ) : (
                <Table head={[t("cols.requester"), t("cols.orders"), t("cols.lines"), t("cols.ordered"), t("cols.received"), t("cols.open")]}>
                  {project.rows.map((r) => (
                    <tr key={r.projectId || "none"} className="border-t">
                      <Td>{r.projectId ? <Link href={`/contractor/projects/${r.projectId}`} className="font-semibold hover:underline">{r.projectName || r.projectId}</Link> : <span className="text-muted-foreground">{t("cols.noProject")}</span>}</Td>
                      <Td end num>{num(r.orders)}</Td>
                      <Td end num>{num(r.lines)}</Td>
                      <Td end num>{money(r.ordered)}</Td>
                      <Td end num>{r.receivedUnknown ? <span title={t("cols.receivedUnknownNote")}>{money(r.received)}*</span> : money(r.received)}</Td>
                      <Td end num>{money(r.open)}</Td>
                    </tr>
                  ))}
                  <TotalsRow cells={[t("total"), num(project.totals.orders), num(project.totals.lines), money(project.totals.ordered), money(project.totals.received), money(project.totals.open)]} />
                </Table>
              )}
              {project.rows.some((r) => r.receivedUnknown) && <Note>* {t("cols.receivedUnknownNote")}</Note>}
              <Note>{t("notes.project")}</Note>
            </>
          )}

          {/* 2 · Spend by supplier */}
          {supplier && (
            <>
              {supplier.rows.length === 0 ? (
                <Empty>{t("empty")}</Empty>
              ) : (
                <Table head={[t("cols.supplier"), t("cols.orders"), t("cols.value"), t("cols.share"), t("cols.onTime")]}>
                  {supplier.rows.map((r) => (
                    <tr key={r.supplierKey} className="border-t">
                      <Td>
                        <span className="flex items-center gap-2">
                          <span className="font-semibold" dir="auto">{r.supplierName}</span>
                          {r.concentrated && <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold text-warning">{t("concentrated")}</span>}
                        </span>
                      </Td>
                      <Td end num>{num(r.orders)}</Td>
                      <Td end num>{money(r.value)}</Td>
                      <Td end>
                        <span className="flex items-center justify-end gap-2">
                          <Bar value={r.sharePercent} max={100} tone={r.concentrated ? "bg-warning" : "bg-module"} />
                          <span className="tabular-nums" dir="ltr">{pct(r.sharePercent)}</span>
                        </span>
                      </Td>
                      <Td end num>{pct(r.onTimePercent)}</Td>
                    </tr>
                  ))}
                  <TotalsRow cells={[t("total"), num(supplier.totals.orders), money(supplier.totals.value), "100%", ""]} />
                </Table>
              )}
              {supplier.concentration && (
                <Note tone="warn">{t("concentration", { supplier: supplier.concentration.supplierName, percent: supplier.concentration.sharePercent })}</Note>
              )}
              <Note>{t("notes.supplier")}</Note>
            </>
          )}

          {/* 3 · Delivery performance */}
          {delivery && (
            <>
              {delivery.suppliers.length > 0 && (
                <Table head={[t("cols.supplier"), t("cols.orders"), t("cols.onTime"), t("cols.avgLate"), t("cols.rejectPct")]}>
                  {delivery.suppliers.map((r) => (
                    <tr key={r.supplierKey} className="border-t">
                      <Td><span className="font-semibold" dir="auto">{r.supplierName}</span></Td>
                      <Td end num>{num(r.orders)}</Td>
                      <Td end num><span className={cn(r.onTimePercent != null && r.onTimePercent < 85 && "font-bold text-destructive")}>{pct(r.onTimePercent)}</span></Td>
                      <Td end num>{r.avgDaysLate == null ? "—" : t("days", { count: r.avgDaysLate })}</Td>
                      <Td end num>{pct(r.rejectPercent)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
              {delivery.orders.length === 0 ? (
                <Empty>{t("empty")}</Empty>
              ) : (
                <Table head={[t("cols.po"), t("cols.supplier"), t("cols.promised"), t("cols.lastReceipt"), t("cols.gap")]} className="border-t">
                  {delivery.orders.map((r) => (
                    <tr key={r.orderId} className="border-t">
                      <Td><Link href={`/contractor/rfqs/orders?po=${r.orderId}`} className="font-mono text-xs font-semibold hover:underline" dir="ltr">{docNo(r.docNumber)}</Link></Td>
                      <Td><span dir="auto">{r.supplierName}</span></Td>
                      <Td end num>{fmtDay(r.promisedDate, locale)}</Td>
                      <Td end num>{fmtDay(r.lastReceiptDay, locale)}</Td>
                      <Td end>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", r.state === "late" ? "bg-destructive/10 text-destructive" : r.state === "on_time" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
                          {tProc(`deliveryState.${r.state}`, { days: r.gap ?? 0 })}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
              <Note>{t("notes.delivery")}</Note>
            </>
          )}

          {/* 4 · Price drift vs last buy */}
          {drift && (
            <>
              {drift.rows.length === 0 ? (
                <Empty>{t("empty")}</Empty>
              ) : (
                <Table head={[t("cols.material"), t("cols.po"), t("cols.previous"), t("cols.current"), t("cols.qty"), t("cols.impact")]}>
                  {drift.rows.map((r, i) => (
                    <tr key={`${r.orderId}-${r.name}-${i}`} className="border-t">
                      <Td>
                        <span className="font-semibold" dir="auto">{r.name}</span>
                        <span className="ms-1 text-muted-foreground">({r.unit})</span>
                      </Td>
                      <Td>
                        <Link href={`/contractor/rfqs/orders?po=${r.orderId}`} className="font-mono text-xs font-semibold hover:underline" dir="ltr">{docNo(r.docNumber)}</Link>
                        <span className="block text-[11px] text-muted-foreground" dir="auto">{r.supplierName} · {fmtDay(r.day, locale)}</span>
                      </Td>
                      <Td end num>{money2(r.previous)}</Td>
                      <Td end num>{money2(r.current)}</Td>
                      <Td end num>{num(r.quantity)}</Td>
                      <Td end num><b className={r.impact > 0 ? "text-warning" : r.impact < 0 ? "text-success" : ""}>{signed(r.impact)}</b></Td>
                    </tr>
                  ))}
                  <TotalsRow cells={[t("total"), "", "", "", "", signed(drift.totals.impact)]} />
                </Table>
              )}
              <Note>{drift.totals.percent != null ? t("drift.totals", { impact: signed(drift.totals.impact), base: money(drift.totals.base), percent: drift.totals.percent }) : t("drift.noBase")}</Note>
              <Note>{t("notes.drift")}</Note>
            </>
          )}

          {/* 5 · Cycle time & competition */}
          {cycle && (
            <>
              {cycle.rows.length === 0 ? (
                <Empty>{t("empty")}</Empty>
              ) : (
                <Table head={[t("cols.rfq"), t("cols.invited"), t("cols.offers"), t("cols.days"), t("cols.lowest"), t("cols.awardedValue")]}>
                  {cycle.rows.map((r) => (
                    <tr key={r.rfqId} className="border-t">
                      <Td>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/contractor/rfqs/${r.rfqId}/offers`} className="font-semibold hover:underline" dir="auto">{r.title || r.rfqId}</Link>
                          {r.shortCompetition && <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold text-warning">{t("shortCompetition")}</span>}
                          {!r.awarded && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">{t("notAwarded")}</span>}
                        </span>
                      </Td>
                      <Td end num>{num(r.invitedCount)}</Td>
                      <Td end num>{num(r.offersCount)}</Td>
                      <Td end num>{r.publishToAwardDays == null ? "—" : t("days", { count: r.publishToAwardDays })}</Td>
                      <Td end num>{sees ? money(r.lowestTotal) : "—"}</Td>
                      <Td end num>{sees ? money(r.awardedTotal) : "—"}</Td>
                    </tr>
                  ))}
                  <TotalsRow cells={[t("cycle.totals", { rfqs: cycle.totals.rfqs, awarded: cycle.totals.awarded, short: cycle.totals.shortCompetition }), "", num(cycle.totals.avgOffers), cycle.totals.avgDays == null ? "—" : t("days", { count: cycle.totals.avgDays }), "", ""]} />
                </Table>
              )}
              <Note>{t("notes.cycle", { threshold: policies.competitionThreshold.toLocaleString("en-US"), min: policies.minOffers })}</Note>
            </>
          )}

          {/* 6 · Exceptions */}
          {exc && (
            <>
              {exc.length === 0 ? (
                <Empty>{t("empty")}</Empty>
              ) : (
                <Table head={[t("cols.document"), t("cols.exception"), t("cols.by"), t("cols.approvedBy"), t("cols.day")]}>
                  {exc.map((r, i) => (
                    <tr key={`${r.kind}-${r.orderId || r.receiptId}-${i}`} className="border-t">
                      <Td>
                        <Link href={r.href} className="font-mono text-xs font-semibold hover:underline" dir="ltr">{docNo(r.docNumber) || "—"}</Link>
                        <span className="block text-[11px] text-muted-foreground" dir="auto">{r.supplierName}</span>
                      </Td>
                      <Td>
                        <span className="me-1.5 inline-block rounded-md bg-module/10 px-1.5 py-0.5 text-[10px] font-bold text-module">{t(`kind.${r.kind}`)}</span>
                        <span dir="auto">{tProc(`exception.${r.kind}`, r.params)}</span>
                      </Td>
                      <Td><span dir="auto">{r.byName || "—"}</span></Td>
                      <Td><span dir="auto">{r.approvedByName || "—"}</span></Td>
                      <Td end num>{fmtDay(r.day, locale)}</Td>
                    </tr>
                  ))}
                  <TotalsRow cells={[t("exceptionsTotal", { count: exc.length }), "", "", "", ""]} />
                </Table>
              )}
              <Note>{t("notes.exceptions")}</Note>
            </>
          )}

          {/* 7 · Open commitments by due date */}
          {commit && (
            <>
              <div className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-5">
                {COMMITMENT_BUCKETS.map((b) => (
                  <div key={b} className={cn("bg-white px-4 py-3", b === "within7" && commit.buckets[b].count > 0 && "bg-warning/5")}>
                    <p className="text-[11px] text-muted-foreground">{tProc(`commitmentBucket.${b}`)}</p>
                    <p className="mt-0.5 text-lg font-black tabular-nums text-foreground" dir="ltr">{money(commit.buckets[b].value)}</p>
                    <p className="text-[10px] text-muted-foreground">{t("ordersCount", { count: commit.buckets[b].count })}</p>
                  </div>
                ))}
              </div>
              {commit.rows.length === 0 ? (
                <Empty>{t("emptyCommitments")}</Empty>
              ) : (
                <Table head={[t("cols.po"), t("cols.supplier"), t("cols.promised"), t("cols.dueIn"), t("cols.value")]}>
                  {commit.rows.map((r) => (
                    <tr key={r.orderId} className="border-t">
                      <Td><Link href={`/contractor/rfqs/orders?po=${r.orderId}`} className="font-mono text-xs font-semibold hover:underline" dir="ltr">{docNo(r.docNumber)}</Link></Td>
                      <Td><span dir="auto">{r.supplierName}</span></Td>
                      <Td end num>{fmtDay(r.promisedDate, locale)}</Td>
                      <Td end>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", r.daysToDue != null && r.daysToDue < 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                          {r.daysToDue == null ? tProc("commitmentBucket.noDate") : r.daysToDue < 0 ? t("overdueBy", { days: -r.daysToDue }) : t("dueIn", { days: r.daysToDue })}
                        </span>
                      </Td>
                      <Td end num>{money(r.value)}</Td>
                    </tr>
                  ))}
                  <TotalsRow cells={[t("total"), "", "", "", money(commit.total)]} />
                </Table>
              )}
              <Note>{t("notes.commitments")}</Note>
            </>
          )}
        </Panel>
      )}

      {REPORT_NEEDS_PRICE[report] && !sees && <Empty>{t("noPrices")}</Empty>}
    </div>
  )
}

function Panel({ title, sub, icon: Icon, children }: { title: string; sub: string; icon: ElementType; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-black text-foreground">
          <Icon size={15} className="text-module" aria-hidden="true" />
          {title}
        </h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">{sub}</span>
      </header>
      {children}
    </section>
  )
}

function Table({ head, children, className }: { head: string[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[520px] text-xs">
        <thead>
          <tr className="bg-muted/20 text-[11px] text-muted-foreground">
            {head.map((h, i) => (
              <th key={i} scope="col" className={cn("whitespace-nowrap px-4 py-2 font-semibold", i === 0 ? "text-start" : "text-end")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, end, num: isNum }: { children?: ReactNode; end?: boolean; num?: boolean }) {
  return (
    <td className={cn("px-4 py-2 align-top", end && "text-end", isNum && "whitespace-nowrap tabular-nums")} dir={isNum ? "ltr" : undefined}>
      {children}
    </td>
  )
}

function TotalsRow({ cells }: { cells: string[] }) {
  return (
    <tr className="border-t bg-muted/30 font-bold">
      {cells.map((c, i) => (
        <td key={i} className={cn("px-4 py-2 tabular-nums", i === 0 ? "text-start" : "whitespace-nowrap text-end")} dir={i === 0 ? undefined : "ltr"}>
          {c}
        </td>
      ))}
    </tr>
  )
}

function Bar({ value, max, tone }: { value: number; max: number; tone?: string }) {
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted align-middle" aria-hidden="true">
      <span className={cn("block h-full rounded-full", tone || "bg-module")} style={{ width: `${Math.min(100, max > 0 ? (value / max) * 100 : 0)}%` }} />
    </span>
  )
}

function Note({ children, tone }: { children: ReactNode; tone?: "warn" }) {
  return (
    <p className={cn("border-t px-4 py-2.5 text-[11px] leading-relaxed", tone === "warn" ? "bg-warning/5 text-warning" : "text-muted-foreground")} dir="auto">
      {children}
    </p>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
}
