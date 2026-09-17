"use client"

// التقارير — how much did we sell at what margin, where does the funnel stall,
// and who did what? (Sales PRD §4, REP-01…04)
//
// Three families over 30 / 90 / 365 days, printable. Sales are recognised on
// SIGNED DELIVERY, never on the order. Cost and margin show only to the roles
// that may see them; a rep sees only his own clients and, under Staff, only
// himself. No pay, commission or appraisal lives here — that is HR's.

import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, BarChart3, ClipboardList, FileText, Filter, Loader2, Lock, Percent, Printer, ShieldAlert, Tags, TrendingUp, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSalesWorld } from "@/hooks/useSalesWorld"
import { cn } from "@/lib/utils"
import { formatSar } from "@/lib/crm"
import {
  CONCENTRATION_ALERT_PERCENT,
  PROMISE_HORIZONS,
  REPORT_PERIODS,
  clientShares,
  executionBlocks,
  monthlySales,
  orderBook,
  salesFunnel,
  staffReport,
  topProducts,
  winLoss,
  type ReportPeriod,
} from "@/lib/sales-reports"
import type { QuoteLifecycle } from "@/lib/sales-quotes"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { SalesSection, SalesShell } from "./SalesShell"

type Family = "company" | "sales" | "staff"
const FAMILIES: Family[] = ["company", "sales", "staff"]

const marginTone = (m: number | null) => (m == null ? "text-muted-foreground" : m >= 25 ? "text-success" : m >= 15 ? "text-warning" : "text-destructive")

export function SalesReportsView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { world, viewer, userId, teamMembers, priceItems, isLoading } = useSalesWorld()
  const [family, setFamily] = useState<Family>("company")
  const [period, setPeriod] = useState<ReportPeriod>(30)

  const seesCost = viewer.seesCost
  const months = useMemo(() => monthlySales(world, seesCost), [world, seesCost])
  const products = useMemo(() => topProducts(world, period, seesCost), [world, period, seesCost])
  const clients = useMemo(() => clientShares(world, period), [world, period])
  const book = useMemo(() => orderBook(world), [world])
  const funnel = useMemo(() => salesFunnel(world), [world])
  const outcome = useMemo(() => winLoss(world, period), [world, period])
  const blocks = useMemo(() => executionBlocks(world), [world])
  const staff = useMemo(
    () => staffReport(world, period, teamMembers.map((m) => ({ id: m.id, name: m.name || "" })), seesCost ? priceItems : null, seesCost ? null : userId),
    [world, period, teamMembers, priceItems, seesCost, userId]
  )

  const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
  const maxMonth = Math.max(1, ...months.map((m) => m.sales))
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.value))
  const pctText = (v: number | null) => (v == null ? "—" : `${v}%`)
  const days = (v: number | null) => (v == null ? "—" : t("sr2_days", { count: Math.round(v * 10) / 10 }))

  return (
    <SalesShell
      portal={portal}
      title={t("sr2_title")}
      description={t("sr2_desc")}
      icon={BarChart3}
      action={
        <Button variant="outline" className="gap-2 print:hidden" onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" />
          {t("sr2_print")}
        </Button>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={t("sr2_title")}>
          {FAMILIES.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={family === f}
              onClick={() => setFamily(f)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                family === f ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              )}
            >
              {t(`sr2_family_${f}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label={t("sr2_period")}>
          {REPORT_PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={period === d}
              onClick={() => setPeriod(d)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                period === d ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              )}
            >
              {d === 365 ? t("sr2_period_year") : t("sr2_period_days", { days: d })}
            </button>
          ))}
        </div>
      </div>

      {!seesCost && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock size={11} aria-hidden="true" />
          {t("sr2_scope_rep")}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : family === "company" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <SalesSection title={t("sr2_months_title")} icon={TrendingUp} action={<Sub>{t("sr2_recognised")}</Sub>}>
              <Table head={[t("sr2_col_month"), "", t("sr2_col_value"), seesCost ? t("sr2_col_margin") : null]}>
                {months.map((m) => (
                  <tr key={m.month} className="border-t">
                    <Td>{monthLabel(m.month)}</Td>
                    <Td><Bar value={m.sales} max={maxMonth} /></Td>
                    <Td end num>{formatSar(m.sales, locale)}</Td>
                    {seesCost && <Td end><b className={marginTone(m.marginPercent)}>{pctText(m.marginPercent)}</b></Td>}
                  </tr>
                ))}
              </Table>
            </SalesSection>

            <SalesSection title={t("sr2_products_title")} icon={Tags} action={<Sub>{t("sr2_last_days", { days: period })}</Sub>}>
              {products.rows.length === 0 ? (
                <Empty>{t("sr2_no_sales")}</Empty>
              ) : (
                <Table head={[t("sr2_col_product"), t("sr2_col_qty"), t("sr2_col_value"), seesCost ? t("sr2_col_real_margin") : null]}>
                  {products.rows.map((r) => (
                    <tr key={r.name} className="border-t">
                      <Td>
                        <span className="font-semibold text-foreground" dir="auto">{r.name}</span>
                        {seesCost && r.uncostedValue > 0 && <span className="block text-[10px] text-muted-foreground">{t("sr2_partly_uncosted")}</span>}
                      </Td>
                      <Td end num>{r.quantity}</Td>
                      <Td end num>{formatSar(r.value, locale)}</Td>
                      {seesCost && <Td end><b className={marginTone(r.marginPercent)}>{pctText(r.marginPercent)}</b></Td>}
                    </tr>
                  ))}
                  <tr className="border-t bg-muted/20 font-black">
                    <Td>{t("sr2_total")}</Td>
                    <Td />
                    <Td end num>{formatSar(products.total, locale)}</Td>
                    {seesCost && <Td end>{pctText(products.marginPercent)}</Td>}
                  </tr>
                </Table>
              )}
            </SalesSection>
          </div>

          <div className="space-y-4">
            <SalesSection title={t("sr2_clients_title")} icon={Users} action={<Sub>{t("sr2_last_days", { days: period })}</Sub>}>
              {clients.length === 0 ? (
                <Empty>{t("sr2_no_sales")}</Empty>
              ) : (
                <ul className="divide-y">
                  {clients.map((c) => (
                    <li key={c.contactId} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                      <div className="min-w-32 flex-1">
                        <p className="text-xs font-bold text-foreground" dir="auto">{c.name || "—"}</p>
                        <p className="text-[11px] text-muted-foreground">{t("sr2_share_of_period", { percent: c.sharePercent })}</p>
                      </div>
                      <div className="flex min-w-40 flex-1 items-center gap-2">
                        <Bar value={c.sharePercent} max={100} tone={c.sharePercent > CONCENTRATION_ALERT_PERCENT ? "bg-destructive" : c.sharePercent > 25 ? "bg-warning" : undefined} />
                        <b className="shrink-0 text-xs tabular-nums" dir="ltr">{formatSar(c.value, locale)}</b>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {clients[0] && clients[0].sharePercent > CONCENTRATION_ALERT_PERCENT && (
                <p className="m-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-slate-700" role="status">
                  <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                  {t("sr2_concentration", { name: clients[0].name || "—", percent: clients[0].sharePercent })}
                </p>
              )}
            </SalesSection>

            <SalesSection title={t("sr2_book_title")} icon={ClipboardList} action={<Sub>{t("sr2_book_sub")}</Sub>}>
              <dl className="divide-y text-xs">
                {PROMISE_HORIZONS.map((h) => (
                  <div key={h} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <dt className="font-semibold text-foreground">{t(`sr2_book_${h}`)}</dt>
                    <dd className={cn("font-bold tabular-nums", h === "past_due" && book.rows[h] > 0 ? "text-destructive" : "text-foreground")} dir="ltr">{formatSar(book.rows[h], locale)}</dd>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 bg-muted/20 px-5 py-2.5">
                  <dt className="font-black text-foreground">{t("sr2_total")}</dt>
                  <dd className="font-black tabular-nums" dir="ltr">{formatSar(book.total, locale)}</dd>
                </div>
              </dl>
            </SalesSection>
          </div>
        </div>
      ) : family === "sales" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <SalesSection title={t("sr2_funnel_title")} icon={Filter}>
              <ul className="divide-y">
                {funnel.map((f) => (
                  <li key={f.key} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                    <div className="min-w-40 flex-1">
                      <p className="text-xs font-bold text-foreground">{t(`sr2_funnel_${f.key}`)}</p>
                      <p className="text-[11px] text-muted-foreground">{t("sr2_documents", { count: f.count })}</p>
                    </div>
                    <div className="flex min-w-40 flex-1 items-center gap-2">
                      <Bar value={f.value} max={maxFunnel} />
                      <b className="shrink-0 text-xs tabular-nums" dir="ltr">{f.key === "requests" ? "—" : formatSar(f.value, locale)}</b>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="m-4 flex items-start gap-2 rounded-lg border border-cta/20 bg-cta/5 px-3 py-2 text-xs text-slate-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-cta" aria-hidden="true" />
                {t("sr2_funnel_note")}
              </p>
            </SalesSection>

            <SalesSection title={t("sr2_winloss_title")} icon={Percent} action={<Sub>{t("sr2_last_days", { days: period })}</Sub>}>
              <div className="grid grid-cols-3 divide-x divide-border rtl:divide-x-reverse">
                <Stat label={t("sr2_win_rate")} value={pctText(outcome.winRatePercent)} hint={t("sr2_won_lost", { won: outcome.won, lost: outcome.lost })} />
                <Stat label={t("sr2_expired_undecided")} value={String(outcome.expiredUndecided)} hint={t("sr2_silent_losses")} />
                <Stat label={t("sr2_response_time")} value={days(outcome.responseDays)} hint={t("sr2_request_to_quote")} />
              </div>
              {outcome.reasons.length > 0 && (
                <ul className="divide-y border-t">
                  {outcome.reasons.map((r) => (
                    <li key={r.reason || "none"} className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs">
                      <span className="font-semibold text-foreground" dir="auto">{r.reason || t("sales_pipeline_no_reason")}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {t("sr2_documents", { count: r.count })} · <span dir="ltr">{formatSar(r.value, locale)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SalesSection>
          </div>

          <div className="space-y-4">
            <SalesSection title={t("sr2_states_title")} icon={FileText}>
              <dl className="divide-y text-xs">
                {(["sent", "issued", "expired", "won", "lost", "draft"] as QuoteLifecycle[]).map((s) => (
                  <div key={s} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <dt className="font-semibold text-foreground">{t(`sales_q_state_${s}`)}</dt>
                    <dd className="font-bold tabular-nums">{outcome.byState[s]}</dd>
                  </div>
                ))}
              </dl>
            </SalesSection>

            <SalesSection title={t("sr2_blocks_title")} icon={AlertTriangle}>
              <dl className="divide-y text-xs">
                {(
                  [
                    ["uncovered", blocks.uncoveredOrders],
                    ["gated", blocks.gatedOrders],
                    ["unanswered", blocks.unansweredRequests],
                    ["advance", blocks.awaitingAdvance],
                    ["held", blocks.heldShipments],
                  ] as Array<[string, number]>
                ).map(([key, n]) => (
                  <div key={key} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <dt className="font-semibold text-foreground">{t(`sr2_block_${key}`)}</dt>
                    <dd className={cn("font-bold tabular-nums", n > 0 ? "text-destructive" : "text-muted-foreground")}>{n}</dd>
                  </div>
                ))}
              </dl>
            </SalesSection>
          </div>
        </div>
      ) : (
        <SalesSection title={t("sr2_staff_title")} icon={Users} action={<Sub>{t("sr2_staff_sub")}</Sub>}>
          {staff.length === 0 ? (
            <Empty>{t("sr2_staff_empty")}</Empty>
          ) : (
            <Table head={[t("sr2_col_person"), t("sr2_col_quotes"), t("sr2_col_sent"), t("sr2_col_won"), t("sr2_win_rate"), t("sr2_col_order_value"), seesCost ? t("sr2_col_avg_discount") : null, t("sr2_response_time")]}>
              {staff.map((r) => (
                <tr key={r.userId} className="border-t">
                  <Td><span className="font-semibold text-foreground" dir="auto">{r.name || "—"}</span></Td>
                  <Td end num>{r.quotes}</Td>
                  <Td end num>{r.sent}</Td>
                  <Td end num>{r.won}</Td>
                  <Td end><b className={r.winRatePercent == null ? "text-muted-foreground" : r.winRatePercent >= 60 ? "text-success" : r.winRatePercent >= 40 ? "text-warning" : "text-destructive"}>{pctText(r.winRatePercent)}</b></Td>
                  <Td end num>{formatSar(r.orderValue, locale)}</Td>
                  {seesCost && <Td end num>{pctText(r.avgDiscountPercent)}</Td>}
                  <Td end>{days(r.responseDays)}</Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="m-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-slate-700">
            <Lock size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            {t("sr2_staff_boundary")}
          </p>
        </SalesSection>
      )}
    </SalesShell>
  )
}

const Sub = ({ children }: { children: ReactNode }) => <span className="text-[11px] text-muted-foreground">{children}</span>
const Empty = ({ children }: { children: ReactNode }) => <p className="p-8 text-center text-sm text-muted-foreground">{children}</p>

function Table({ head, children }: { head: Array<string | null>; children: ReactNode }) {
  const cols = head.filter((h): h is string => h !== null)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs">
        <thead>
          <tr className="bg-muted/20 text-[11px] text-muted-foreground">
            {cols.map((h, i) => (
              <th key={i} scope="col" className={cn("px-4 py-2 font-semibold", i === 0 ? "text-start" : "text-end")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, end, num }: { children?: ReactNode; end?: boolean; num?: boolean }) {
  return (
    <td className={cn("px-4 py-2", end && "text-end", num && "tabular-nums")} dir={num ? "ltr" : undefined}>
      {children}
    </td>
  )
}

function Bar({ value, max, tone }: { value: number; max: number; tone?: string }) {
  return (
    <div className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className={cn("h-full rounded-full", tone || "bg-cta")} style={{ width: `${Math.min(100, max > 0 ? (value / max) * 100 : 0)}%` }} />
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-black tabular-nums text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </div>
  )
}

