"use client"

// اليوم — what needs my decision now? (Sales PRD §4, HOME-01…04)
//
// Three KPIs, each opening its list: sales in 30 days BY SIGNED DELIVERY,
// promised-not-delivered (and how much of it nothing covers), live quotes (and
// how many expire this week). The flow strip shows where the money stands.
// Then the single queue: one action per row, only what this role may do,
// nearest risk first. Nothing here invoices, receipts or edits a payment —
// that is Finance's (D2); a rep sees only his own clients and never a cost.

import type { ElementType } from "react"
import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle, Banknote, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Factory, FileText, Hourglass,
  Inbox, Loader2, PackageX, PauseCircle, PenLine, Percent, Plus, Ruler, SearchX, Send, TrendingUp, Truck, Undo2,
} from "lucide-react"
import { Link } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useSalesWorld } from "@/hooks/useSalesWorld"
import { cn } from "@/lib/utils"
import { formatCrmDate, formatSar, formatSarCompact } from "@/lib/crm"
import { orderLineProgress } from "@/lib/sales-orders"
import { displayDocNumber } from "@/lib/sales-numbering"
import { quoteLifecycle, type QuoteLifecycle } from "@/lib/sales-quotes"
import { DECISION_GROUPS, flowStrip, todayDecisions, todayKpis, type Decision, type DecisionGroup, type DecisionKind } from "@/lib/sales-today"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { SalesShell, SalesSection, salesBasePath } from "./SalesShell"

const KIND_ICON: Record<DecisionKind, ElementType> = {
  request_to_price: Inbox,
  request_draft: PenLine,
  quote_not_sent: Send,
  draft_not_issued: FileText,
  quote_expiring: CalendarClock,
  quote_expired: CalendarClock,
  order_awaits_advance: Banknote,
  transfer_not_found: SearchX,
  shipment_held: PauseCircle,
  line_no_supply: PackageX,
  gate_closed: Ruler,
  mfg_request_unanswered: Factory,
  mfg_request_declined: Factory,
  promise_overdue: Hourglass,
  shipment_to_sign: PenLine,
  return_to_decide: Undo2,
  price_to_review: Percent,
}

const TONE_TEXT = { danger: "text-destructive", warn: "text-warning", info: "text-cta" } as const

export function SalesDashboardView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const base = salesBasePath(portal)
  const { world, viewer, isLoading } = useSalesWorld()

  const kpis = useMemo(() => todayKpis(world, viewer), [world, viewer])
  const flow = useMemo(() => flowStrip(world), [world])
  const decisions = useMemo(() => todayDecisions(world, viewer), [world, viewer])
  const [group, setGroup] = useState<DecisionGroup | "all">("all")
  const shown = group === "all" ? decisions : decisions.filter((d) => d.group === group)
  const Chevron = isRtl ? ChevronLeft : ChevronRight

  // Live promises: the soonest orders still owing goods, with their supply.
  const promises = useMemo(
    () =>
      world.orders
        .filter((o) => o.status === "running" && o.type !== "framework" && o.type !== "internal")
        .map((o) => {
          const lines = orderLineProgress(o, world.notes)
          const owed = lines.reduce((s, l) => s + l.remainingValue, 0)
          const parts = lines.reduce(
            (acc, l) => {
              const c = world.coverage.get(`${o.id}|${l.name.trim().toLowerCase()}`)
              acc.stock += (c?.fromStock || 0) * l.unitPrice
              acc.mfg += (c?.fromManufacturing || 0) * l.unitPrice
              acc.gap += (c?.gap || 0) * l.unitPrice
              return acc
            },
            { stock: 0, mfg: 0, gap: 0 }
          )
          return { order: o, owed, ...parts }
        })
        .filter((r) => r.owed > 0)
        .sort((a, b) => (a.order.promiseDate || "9999").localeCompare(b.order.promiseDate || "9999"))
        .slice(0, 6),
    [world]
  )

  const fromPlant = useMemo(
    () =>
      world.mfgRequests
        .filter((r) => r.kind !== "cost" && r.sourceKind !== "project" && !!r.orderId && (r.status === "new" || r.status === "rejected" || r.status === "accepted" || r.status === "partial"))
        .sort((a, b) => (b.requestedAt || "").localeCompare(a.requestedAt || ""))
        .slice(0, 6),
    [world.mfgRequests]
  )

  const pipeline = useMemo(() => {
    const counts: Record<QuoteLifecycle, number> = { draft: 0, issued: 0, sent: 0, expired: 0, won: 0, lost: 0, superseded: 0 }
    for (const q of world.quotations) counts[quoteLifecycle(q, world.today)] += 1
    const decided = counts.won + counts.lost
    return {
      counts,
      winRate: decided ? Math.round((counts.won / decided) * 100) : null,
      lost: world.quotations.filter((q) => q.status === "rejected" && !q.supersededById).sort((a, b) => (b.rejectedAt || "").localeCompare(a.rejectedAt || "")).slice(0, 5),
    }
  }, [world.quotations, world.today])

  const decisionText = (d: Decision): string => {
    const f = d.facts
    const number = displayDocNumber(String(f.number ?? ""), locale)
    const money = typeof f.amount === "number" ? formatSar(f.amount, locale) : ""
    return t(`sales_td_${d.kind}`, {
      ...f,
      number,
      amount: money,
      value: typeof f.value === "number" ? formatSar(f.value, locale) : "",
      client: String(f.client || "—"),
      gate: f.gate ? t(`sales_td_gate_${f.gate}`) : "",
      promise: f.promise ? formatCrmDate(String(f.promise), locale) : "",
      until: f.until ? formatCrmDate(String(f.until), locale) : "",
    })
  }

  return (
    <SalesShell
      portal={portal}
      title={t("sales_today_title")}
      description={t("sales_today_desc")}
      action={
        viewer.canSell ? (
          <Button asChild className="gap-2">
            <Link href={`${base}/quotations/new`}>
              <Plus size={16} aria-hidden="true" />
              {t("sales_new_quote_btn")}
            </Link>
          </Button>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : (
        <>
          {/* ── Three KPIs, each opening its list (HOME-01) ── */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi
              href={`${base}/fulfillment`}
              icon={TrendingUp}
              tone="text-success"
              label={t("sales_kpi_delivered")}
              value={formatSarCompact(kpis.delivered30, locale)}
              hint={kpis.margin30Percent != null ? t("sales_kpi_delivered_margin", { percent: kpis.margin30Percent }) : t("sales_kpi_delivered_hint")}
            />
            <Kpi
              href={`${base}/orders`}
              icon={ClipboardList}
              tone="text-cta"
              label={t("sales_kpi_promised")}
              value={formatSarCompact(kpis.promised, locale)}
              hint={kpis.promisedNoSupply > 0 ? t("sales_kpi_promised_gap", { amount: formatSar(kpis.promisedNoSupply, locale) }) : t("sales_kpi_promised_ok")}
              hintTone={kpis.promisedNoSupply > 0 ? "text-destructive" : undefined}
            />
            <Kpi
              href={`${base}/quotations?state=sent`}
              icon={FileText}
              tone="text-primary"
              label={t("sales_kpi_live", { count: kpis.liveQuotes })}
              value={formatSarCompact(kpis.liveQuotesValue, locale)}
              hint={kpis.expiringIn7 > 0 ? t("sales_kpi_live_expiring", { count: kpis.expiringIn7 }) : t("sales_kpi_live_ok")}
              hintTone={kpis.expiringIn7 > 0 ? "text-warning" : undefined}
            />
          </div>

          {/* ── The flow strip: where the money stands (HOME-02) ── */}
          <ol className="flex flex-wrap items-stretch gap-2" aria-label={t("sales_flow_title")}>
            {(
              [
                ["sales_flow_quotes", flow.liveQuotes, false],
                ["sales_flow_promised", flow.promised, false],
                ["sales_flow_delivered", flow.delivered30, false],
                ["sales_flow_transfers", flow.transfersAwaiting, false],
                ["sales_flow_confirmed", flow.confirmed30, true],
              ] as Array<[string, number, boolean]>
            ).map(([key, value, fromFinance], i) => (
              <li key={key} className="flex min-w-36 flex-1 items-center gap-2">
                {i > 0 && <Chevron size={14} className="hidden shrink-0 text-muted-foreground sm:block" aria-hidden="true" />}
                <div className="flex-1 rounded-xl border bg-white px-3 py-2.5">
                  <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {t(key)}
                    {fromFinance && <Badge className="border-none bg-primary/10 text-[9px] text-primary">{t("sales_flow_from_finance")}</Badge>}
                  </p>
                  <p className="mt-0.5 text-sm font-black tabular-nums text-foreground" dir="ltr">{formatSarCompact(value, locale)}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* ── Needs your decision: one action per row (HOME-03) ── */}
          <SalesSection
            title={t("sales_dec_title")}
            icon={AlertTriangle}
            action={<span className="text-[11px] tabular-nums text-muted-foreground">{decisions.length}</span>}
          >
            {decisions.length > 6 && (
              <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5">
                {(["all", ...DECISION_GROUPS] as Array<DecisionGroup | "all">).map((g) => {
                  const count = g === "all" ? decisions.length : decisions.filter((d) => d.group === g).length
                  return (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={group === g}
                      onClick={() => setGroup(g)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        group === g ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      )}
                    >
                      {t(`sales_dec_group_${g}`)}
                      <span className={cn("text-[10px] tabular-nums", group === g ? "text-white/70" : "text-muted-foreground")}>{count}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {shown.length === 0 ? (
              <p className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                <CheckCircle2 size={16} className="text-success" aria-hidden="true" />
                {t("sales_dec_empty")}
              </p>
            ) : (
              <ul className="divide-y">
                {shown.map((d) => {
                  const Icon = KIND_ICON[d.kind]
                  return (
                    <li key={d.key}>
                      <Link
                        href={`${base}/${d.href}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <Icon size={16} className={cn("shrink-0", TONE_TEXT[d.tone])} aria-hidden="true" />
                        <span className="min-w-0 flex-1 basis-56 text-sm font-semibold" dir="auto">{decisionText(d)}</span>
                        <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-cta">
                          {t(`sales_td_${d.kind}_act`)}
                          <Chevron size={13} aria-hidden="true" />
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </SalesSection>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ── Live promises, with where each will come from (HOME-04) ── */}
            <SalesSection
              title={t("sales_promises_title")}
              icon={Truck}
              action={<Link href={`${base}/orders`} className="rounded-sm text-xs font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("sales_view_all")}</Link>}
            >
              {promises.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">{t("sales_promises_empty")}</p>
              ) : (
                <ul className="divide-y">
                  {promises.map(({ order, owed, stock, mfg, gap }) => {
                    const late = !!order.promiseDate && order.promiseDate < world.today
                    const pct = (v: number) => `${owed > 0 ? Math.min(100, (v / owed) * 100) : 0}%`
                    return (
                      <li key={order.id}>
                        <Link href={`${base}/orders?open=${order.id}`} className="block space-y-1.5 px-5 py-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-foreground" dir="auto">{order.contactName || "—"}</span>
                            <span className="text-[11px] text-muted-foreground">{t("so_order_no", { number: order.orderNumber })}</span>
                            <span className={cn("ms-auto text-[11px] font-semibold", late ? "text-destructive" : "text-muted-foreground")}>
                              {order.promiseDate ? t("sales_promises_date", { date: formatCrmDate(order.promiseDate, locale) }) : t("sales_promises_none")}
                            </span>
                          </div>
                          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={t("sales_promises_bar", { stock: formatSar(stock, locale), mfg: formatSar(mfg, locale), gap: formatSar(gap, locale) })}>
                            <div className="h-full bg-success" style={{ width: pct(stock) }} />
                            <div className="h-full bg-cta" style={{ width: pct(mfg) }} />
                            <div className="h-full bg-destructive" style={{ width: pct(gap) }} />
                          </div>
                          <p className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                            <span dir="ltr">{formatSar(owed, locale)}</span>
                            {gap > 0 && <span className="font-semibold text-destructive">{t("sales_promises_gap", { amount: formatSar(gap, locale) })}</span>}
                          </p>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
              <p className="flex flex-wrap gap-x-3 border-t px-5 py-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />{t("sales_legend_stock")}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cta" aria-hidden="true" />{t("sales_legend_mfg")}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" aria-hidden="true" />{t("sales_legend_gap")}</span>
              </p>
            </SalesSection>

            <div className="space-y-4">
              {/* ── From manufacturing: what we asked and what they answered ── */}
              <SalesSection title={t("sales_plant_title")} icon={Factory} action={<Badge className="border-none bg-warning/10 text-[10px] text-warning">{t("sset_mod_mfg")}</Badge>}>
                {fromPlant.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">{t("sales_plant_empty")}</p>
                ) : (
                  <ul className="divide-y">
                    {fromPlant.map((r) => {
                      const order = world.orders.find((o) => o.id === r.orderId)
                      const waitsAdvance = r.status === "new" && order?.status === "awaiting_deposit"
                      const state = waitsAdvance ? "awaiting_finance" : r.status === "new" ? "awaiting_plant" : r.status === "rejected" ? "declined" : "accepted"
                      return (
                        <li key={r.id}>
                          <Link href={`${base}/orders?open=${r.orderId}`} className="flex flex-wrap items-center gap-2 px-5 py-2.5 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                            <span className="font-mono text-xs text-muted-foreground" dir="ltr">{displayDocNumber(r.requestNumber, locale)}</span>
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold" dir="auto">{r.itemName} × {r.quantity}</span>
                            <Badge className={cn("border-none text-[10px]", state === "declined" ? "bg-destructive/10 text-destructive" : state === "accepted" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
                              {t(`sales_plant_${state}`)}
                            </Badge>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </SalesSection>

              {/* ── The pipeline, and why we lost ── */}
              <SalesSection title={t("sales_pipeline_title")} icon={FileText}>
                <ul className="divide-y">
                  {(["sent", "issued", "expired", "draft", "won", "lost"] as QuoteLifecycle[]).map((s) => (
                    <li key={s}>
                      <Link href={`${base}/quotations?state=${s}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <span className="font-semibold">{t(`sales_q_state_${s}`)}</span>
                        <span className="font-black tabular-nums">{pipeline.counts[s]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">
                  {pipeline.winRate != null ? t("sales_pipeline_win_rate", { percent: pipeline.winRate, won: pipeline.counts.won, lost: pipeline.counts.lost }) : t("sales_pipeline_no_outcomes")}
                </p>
                {pipeline.lost.length > 0 && (
                  <ul className="divide-y border-t">
                    {pipeline.lost.map((q) => (
                      <li key={q.id} className="px-5 py-2.5">
                        <p className="text-xs font-semibold text-foreground" dir="auto">{q.lostReason || t("sales_pipeline_no_reason")}</p>
                        <p className="text-[11px] text-muted-foreground" dir="auto">
                          <span dir="ltr">{displayDocNumber(q.quotationNumber, locale)}</span> · {q.contactName || "—"} · <span dir="ltr">{formatSar(q.amount, locale)}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </SalesSection>
            </div>
          </div>
        </>
      )}
    </SalesShell>
  )
}

function Kpi({ href, icon: Icon, tone, label, value, hint, hintTone }: { href: string; icon: ElementType; tone: string; label: string; value: string; hint: string; hintTone?: string }) {
  return (
    <Link href={href} className="block rounded-xl border bg-white p-4 transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Icon size={15} className={tone} aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-black tabular-nums text-foreground" dir="ltr">{value}</p>
      <p className={cn("mt-1 text-[11px]", hintTone || "text-muted-foreground")}>{hint}</p>
    </Link>
  )
}
