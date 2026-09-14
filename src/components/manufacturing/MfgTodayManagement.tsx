"use client"

// Management's Today (TD-04) — read-only: the workshop in SAR. Work in
// progress, what is late or at risk, the scrap of the last 30 days beside what
// making saved against Procurement's reference buy price; then every project
// and client with their open orders, delivered of target by unit, late orders,
// scrap and WIP; beside it late and why, the requests still unanswered, and
// what our team holds. No action buttons here.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, Coins, Inbox, Trash2 } from "lucide-react"
import { useRouter } from "@/i18n/routing"
import { addDaysISO, round2, standardCost } from "@/lib/manufacturing-engine"
import { byProjectAndClient, wipTotal } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgChip, MfgEmpty, MfgKpiCard, MfgPanel, fmtMoney, useMfgDate } from "./ui/MfgUi"
import { LatePanel, Money, SeverityBar, TeamPanel, TodayGrid, TodayKpis, UnitsText, useWorkshopJump } from "./MfgTodayBits"

export function MfgTodayManagement() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const jump = useWorkshopJump()
  const { views, data } = ui

  const figures = useMemo(() => {
    const cutoff = addDaysISO(ui.today, -30)
    const scrap30 = views.flatMap((v) => v.calc.slice.scrap).filter((s) => (s.raisedAt || "").slice(0, 10) >= cutoff)
    const savings = views
      .filter((v) => v.source !== "stock" && !v.cancelled)
      .reduce((a, v) => {
        const ref = v.product.referenceBuyPrice
        if (ref == null) return a
        const unit = standardCost(v.product, data.departments, data.settings, 1).total
        return a + Math.max(0, ref - unit) * v.quantity
      }, 0)
    const late = views.filter((v) => v.late)
    return {
      wip: wipTotal(views),
      live: views.filter((v) => v.live).length,
      late,
      scrap: round2(scrap30.reduce((a, s) => a + s.value, 0)),
      savings: round2(savings),
    }
  }, [views, ui.today, data.departments, data.settings])

  const owners = useMemo(() => byProjectAndClient(views), [views])

  return (
    <div className="min-w-0 space-y-4">
      <TodayKpis>
        <MfgKpiCard icon={Coins} label={t("mfw_kpi_wip_title")} value={<Money value={figures.wip} />} sub={t("mfw_kpi_open_orders", { count: figures.live })} onClick={() => jump({})} />
        <MfgKpiCard
          icon={AlertTriangle}
          label={t("mfw_kpi_late")}
          value={<span className="tabular-nums">{figures.late.length}</span>}
          unit={t("mfw_orders_word", { count: figures.late.length })}
          subTone={figures.late.length ? "bad" : "ok"}
          sub={figures.late.length ? figures.late.map((v) => v.ref).join(t("mfw_list_sep")) : t("mfw_kpi_on_time")}
          onClick={() => jump({ late: true })}
        />
        <MfgKpiCard
          icon={Trash2}
          label={t("mfw_kpi_scrap_30")}
          value={<Money value={figures.scrap} />}
          subTone={figures.scrap ? "warn" : "muted"}
          sub={t("mfw_kpi_savings", { value: fmtMoney(figures.savings) })}
        />
      </TodayKpis>

      <TodayGrid
        main={
          <MfgPanel title={t("mfw_mg_title")} subtitle={t("mfw_mg_sub")} count={owners.length}>
            {owners.length === 0 ? (
              <MfgEmpty title={t("mfw_mg_empty")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="bg-muted/40 text-[11px] font-bold text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-start">{t("mfw_mg_col_owner")}</th>
                      <th className="px-3 py-2 text-end">{t("mfw_mg_col_open")}</th>
                      <th className="px-3 py-2 text-start">{t("mfw_mg_col_delivered")}</th>
                      <th className="px-3 py-2 text-start">{t("mfw_mg_col_late")}</th>
                      <th className="px-3 py-2 text-end">{t("mfw_mg_col_scrap")}</th>
                      <th className="px-3 py-2 text-end">{t("mfw_mg_col_wip")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {owners.map((r) => (
                      <tr key={r.key} className="border-t border-border/60 align-top">
                        <td className="px-3 py-2.5">
                          <b className="block text-foreground">{r.source === "stock" ? t("mfw_mg_stock") : r.name || "—"}</b>
                          <span className="mt-1 flex flex-wrap gap-1">
                            {r.short && <MfgChip tone="bad">{t("mfg4_bit_short")}</MfgChip>}
                            {r.awaitingPayment && <MfgChip tone="warn">{t("mfw_mg_awaiting_payment")}</MfgChip>}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">
                          {r.open}
                        </td>
                        <td className="px-3 py-2.5">
                          <UnitsText list={r.delivered} /> <span className="text-muted-foreground">/</span> <UnitsText list={r.target} />
                        </td>
                        <td className="px-3 py-2.5">
                          {r.late.length ? (
                            <span className="flex flex-wrap gap-1">
                              {r.late.map((v) => (
                                <button
                                  key={v.id}
                                  type="button"
                                  onClick={() => ui.openOrder(v.id)}
                                  className="rounded font-bold text-destructive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <bdi dir="ltr">{v.ref}</bdi>
                                </button>
                              ))}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">
                          {r.scrap ? fmtMoney(r.scrap) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">
                          {r.wip ? fmtMoney(r.wip) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </MfgPanel>
        }
        side={
          <>
            <LatePanel />
            <UnansweredPanel />
            <TeamPanel />
          </>
        }
      />
    </div>
  )
}

function UnansweredPanel() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const router = useRouter()
  const d = useMfgDate()
  const answerWindow = ui.data.settings.answerWindowHours
  const open = useMemo(
    () =>
      ui.data.requests
        .filter((r) => r.status === "new")
        .map((r) => ({ r, hours: r.requestedAt ? Math.max(0, (ui.nowMs - new Date(r.requestedAt).getTime()) / 3600000) : 0 }))
        .sort((a, b) => b.hours - a.hours),
    [ui.data.requests, ui.nowMs]
  )
  return (
    <MfgPanel icon={Inbox} title={t("mfw_unanswered_title")} subtitle={t("mfw_unanswered_sub", { hours: answerWindow })} count={open.length}>
      {open.length === 0 ? (
        <MfgEmpty icon={Inbox} title={t("mfw_unanswered_empty")} />
      ) : (
        <ul>
          {open.map(({ r, hours }) => {
            const overdue = hours >= answerWindow
            const fromSales = r.sourceKind === "sales" || (!r.sourceKind && !!r.orderId)
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => router.push(`${ui.base}/requests`)}
                  className="flex w-full gap-3 border-b border-border/60 px-4 py-2.5 text-start last:border-b-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <SeverityBar severity={overdue ? "r" : "a"} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-foreground">
                      <bdi dir="ltr">{r.requestNumber}</bdi> — {t(fromSales ? "mfw_from_sales" : "mfw_from_procurement")}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {[r.contactName || r.projectName || r.createdByUserName, t("mfw_arrived", { rel: d.relative(r.requestedAt) })].filter(Boolean).join(" · ")}
                      {overdue && <b className="text-destructive"> · {t("mfw_overdue")}</b>}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </MfgPanel>
  )
}
