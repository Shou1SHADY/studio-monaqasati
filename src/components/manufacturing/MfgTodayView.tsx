"use client"

// Today (اليوم) — what needs a decision now, sorted by impact, one action per
// line; plus the departments' load and the current bottleneck. Everything here
// is the engine's output over live data — this page stores nothing.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Factory, AlertTriangle, Truck, ArrowLeft, ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { usePermissions } from "@/hooks/usePermissions"
import type { MfgData } from "@/hooks/useMfgData"
import type { CrmPortal } from "@/components/crm/CrmShell"
import {
  buildDecisions,
  bottleneck,
  isDoneV2,
  readyQty,
  stationLoadHours,
  stationQueueDays,
  wipQty,
  type Decision,
} from "@/lib/manufacturing-engine"
import { toNoteSlice, toOrderSlice } from "@/lib/manufacturing-writes"
import { MfgOrderV2Dialog } from "./MfgOrderV2Dialog"

const fmtQty = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })

export function MfgTodayView({ data, portal }: { data: MfgData; portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const { can } = usePermissions()
  const [openOrderId, setOpenOrderId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const todayIso = new Date().toISOString().slice(0, 10)
  const orderInputs = useMemo(
    () =>
      data.v2Orders.map((o) => ({
        order: toOrderSlice(o),
        product: data.productById.get(o.productId || "")!,
        notes: (data.notesByOrder.get(o.id) || []).map((n) => ({ ...toNoteSlice(n), id: n.id })),
      })),
    [data.v2Orders, data.productById, data.notesByOrder]
  )

  const decisions = useMemo(
    () =>
      buildDecisions({
        orders: orderInputs,
        requests: data.requests.map((r) => ({
          id: r.id,
          state: r.status === "new" ? "new" : "answered",
          ageHours: r.requestedAt ? Math.max(0, (Date.now() - new Date(r.requestedAt).getTime()) / 3600000) : 0,
        })),
        estimates: data.estimates.map((e) => ({ id: e.id, state: e.state, sentAt: e.sentAt, quotedAt: e.quotedAt })),
        schedule: data.schedule,
        departments: data.departments,
        settings: data.settings,
        today: todayIso,
      }),
    [orderInputs, data.requests, data.estimates, data.schedule, data.departments, data.settings, todayIso]
  )

  // KPIs
  const live = orderInputs.filter(({ order, product, notes }) => order.releasedAt != null && !isDoneV2(order, product.route, notes))
  const wipUnits = live.reduce((a, x) => a + wipQty(x.order, x.product.route), 0)
  const missing = live.filter(({ order }) => {
    const sched = data.schedule.get(order.id)
    const overdue = order.neededBy != null && order.neededBy < todayIso
    return overdue || (sched != null && order.neededBy != null && new Date(order.neededBy).getTime() < Date.now() + sched.finishDays * 86400000 - 86400000)
  })
  const readyUnits = orderInputs.reduce((a, x) => a + readyQty(x.order, x.product.route, x.notes), 0)
  const bn = data.settings.features.time ? bottleneck(orderInputs, data.departments) : null
  const bnName = bn ? data.departments.find((d) => d.id === bn.departmentId)?.name || "" : ""

  const orderOf = (d: Decision) => (d.orderId ? data.v2Orders.find((o) => o.id === d.orderId) : null)
  const deptName = (id?: string) => (id ? data.departments.find((d) => d.id === id)?.name || id : "")

  const label = (d: Decision): string => {
    const o = orderOf(d)
    const num = o ? `#${o.orderNumber}` : ""
    const product = o ? data.productById.get(o.productId || "")?.name || "" : ""
    switch (d.kind) {
      case "answer_request": {
        const r = data.requests.find((x) => x.id === d.requestId)
        return t("mfg2_dec_answer_request", { number: r?.requestNumber || "" })
      }
      case "send_estimate": {
        const e = data.estimates.find((x) => x.id === d.estimateId)
        return t("mfg2_dec_send_estimate", { number: e?.estimateNumber || "" })
      }
      case "log_quote": {
        const e = data.estimates.find((x) => x.id === d.estimateId)
        return t("mfg2_dec_log_quote", { number: e?.estimateNumber || "" })
      }
      case "chase_quote": {
        const e = data.estimates.find((x) => x.id === d.estimateId)
        return t("mfg2_dec_chase_quote", { number: e?.quoteNumber || e?.estimateNumber || "" })
      }
      case "release_ready":
        return t("mfg2_dec_release_ready", { order: num, product })
      case "release_blocked":
        return t("mfg2_dec_release_blocked", { order: num, product })
      case "record_slab":
        return t("mfg2_dec_record_slab", { order: num })
      case "chase_drawing":
        return t("mfg2_dec_chase_drawing", { order: num })
      case "materials_missing":
        return t("mfg2_dec_materials_missing", { order: num, dept: deptName(d.departmentId) })
      case "confirm_materials":
        return t("mfg2_dec_confirm_materials", { order: num, dept: deptName(d.departmentId) })
      case "qc_decision":
        return t("mfg2_dec_qc", { order: num, count: fmtQty(d.quantity || 0), dept: deptName(d.departmentId) })
      case "approve_scrap":
        return t("mfg2_dec_approve_scrap", { order: num, value: fmtQty(d.value || 0) })
      case "issue_note":
        return t("mfg2_dec_issue_note", { order: num, count: fmtQty(d.quantity || 0) })
      case "confirm_note":
        return t("mfg2_dec_confirm_note", { order: num })
      case "breakage_decision":
        return t("mfg2_dec_breakage", { order: num, count: fmtQty(d.quantity || 0) })
      case "hour_variance":
        return t("mfg2_dec_hour_variance", { order: num, dept: deptName(d.departmentId) })
      case "will_miss_date":
        return t("mfg2_dec_will_miss", { order: num, product })
    }
  }

  const base = `/${portal}/manufacturing`
  const targetHref = (d: Decision): string | null => {
    if (d.requestId) return `${base}/requests`
    if (d.estimateId) return `${base}/estimates`
    return null
  }

  const shown = showAll ? decisions : decisions.slice(0, 10)
  const openOrder = openOrderId ? data.v2Orders.find((o) => o.id === openOrderId) || null : null
  const Arrow = isRtl ? ArrowLeft : ArrowRight

  return (
    <div className="space-y-4" dir={isRtl ? "rtl" : "ltr"}>
      {/* KPIs */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs text-muted-foreground font-semibold flex items-center gap-1.5">
            <Factory size={13} /> {t("mfg2_kpi_in_production")}
          </p>
          <p className="text-2xl font-black tabular-nums mt-1">{live.length}</p>
          <p className="text-[11px] text-muted-foreground">{t("mfg2_kpi_wip_units", { count: fmtQty(wipUnits) })}</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs text-muted-foreground font-semibold flex items-center gap-1.5">
            <AlertTriangle size={13} /> {t("mfg2_kpi_missing_dates")}
          </p>
          <p className={cn("text-2xl font-black tabular-nums mt-1", missing.length && "text-destructive")}>{missing.length}</p>
          <p className="text-[11px] text-muted-foreground">
            {bn && bn.days > 0 ? t("mfg2_kpi_bottleneck", { dept: bnName, days: bn.days }) : t("mfg2_kpi_on_time")}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs text-muted-foreground font-semibold flex items-center gap-1.5">
            <Truck size={13} /> {t("mfg2_kpi_ready")}
          </p>
          <p className="text-2xl font-black tabular-nums mt-1">{fmtQty(readyUnits)}</p>
          <p className="text-[11px] text-muted-foreground">{t("mfg2_kpi_ready_hint")}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-4 items-start">
        {/* Decisions */}
        <section className="rounded-xl border bg-white overflow-hidden lg:col-span-3">
          <header className="px-4 py-3 border-b bg-muted/20 flex items-center justify-between">
            <h2 className="text-sm font-black">{t("mfg2_decisions_title")}</h2>
            <span className="text-xs text-muted-foreground">{t("mfg2_decisions_hint")}</span>
          </header>
          {shown.length === 0 && (
            <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("mfg2_decisions_empty")}</p>
          )}
          {shown.map((d, i) => {
            const href = targetHref(d)
            return (
              <div key={`${d.kind}_${d.orderId || d.requestId || d.estimateId}_${i}`} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0">
                <span
                  className={cn(
                    "h-8 w-1 rounded-full shrink-0",
                    d.weight >= 30 ? "bg-destructive" : d.weight >= 24 ? "bg-amber-400" : "bg-cta"
                  )}
                />
                <p className="text-xs font-semibold flex-1">{label(d)}</p>
                {d.orderId ? (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] gap-1" onClick={() => setOpenOrderId(d.orderId!)}>
                    {t("mfg2_open_order")} <Arrow size={11} />
                  </Button>
                ) : href ? (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] gap-1" asChild>
                    <Link href={href}>
                      {t("mfg2_open")} <Arrow size={11} />
                    </Link>
                  </Button>
                ) : null}
              </div>
            )
          })}
          {decisions.length > 10 && !showAll && (
            <button
              type="button"
              className="w-full py-2.5 text-xs font-bold text-cta hover:bg-cta/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setShowAll(true)}
            >
              {t("mfg2_show_more", { count: decisions.length - 10 })}
            </button>
          )}
        </section>

        {/* Department load */}
        {data.settings.features.time && (
          <section className="rounded-xl border bg-white overflow-hidden lg:col-span-2">
            <header className="px-4 py-3 border-b bg-muted/20">
              <h2 className="text-sm font-black">{t("mfg2_load_title")}</h2>
              <p className="text-[11px] text-muted-foreground">{t("mfg2_load_hint")}</p>
            </header>
            {data.departments.map((d) => {
              const days = stationQueueDays(orderInputs, d)
              const max = Math.max(1, ...(data.departments.map((x) => stationQueueDays(orderInputs, x))))
              const isBn = bn?.departmentId === d.id && days > 0
              return (
                <div key={d.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-xs">
                  <span className="font-semibold min-w-[110px] truncate">{d.name}</span>
                  <span className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <span
                      className={cn("block h-full rounded-full", isBn ? "bg-destructive" : days > 2 ? "bg-amber-400" : "bg-success")}
                      style={{ width: `${Math.min(100, (days / max) * 100)}%` }}
                    />
                  </span>
                  <span className="tabular-nums text-muted-foreground min-w-[90px] text-end">
                    {days} {t("mfg2_days_short")} · {stationLoadHours(orderInputs, d.id)} {t("mfg2_hours_short")}
                  </span>
                  {isBn && <Badge className="bg-destructive/10 text-destructive border-none text-[9px]">{t("mfg2_bottleneck_badge")}</Badge>}
                </div>
              )
            })}
            {bn && bn.days > 0 && (
              <p className="px-4 py-2.5 text-[11px] text-muted-foreground bg-cta/5">
                {t("mfg2_bottleneck_note", { dept: bnName, days: bn.days })}
              </p>
            )}
          </section>
        )}
      </div>

      {openOrder && (
        <MfgOrderV2Dialog
          order={openOrder}
          product={data.productById.get(openOrder.productId || "") || null}
          departments={data.departments}
          settings={data.settings}
          notes={data.notesByOrder.get(openOrder.id) || []}
          schedule={data.schedule.get(openOrder.id) || null}
          warehouses={data.warehouses}
          actor={data.actor}
          orgId={data.orgId}
          canManage={data.canManage}
          canWork={data.canWork}
          canQc={data.canQc}
          canCost={data.canCost}
          seesMoney={data.seesMoney}
          canReceive={can("warehouses.receive") || can("warehouses.manage")}
          onClose={() => setOpenOrderId(null)}
        />
      )}
    </div>
  )
}
