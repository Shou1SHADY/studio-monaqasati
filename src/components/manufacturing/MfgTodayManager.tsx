"use client"

// The workshop manager's Today (TD-04): three figures with the Workshop's own
// definitions, the shortage banner, one decision card per order with its late
// reason, and beside it who holds the rest — late and why, our team by name,
// other modules (read-only) and each station's load after today's stops.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, Factory, ShoppingCart, Truck } from "lucide-react"
import { byUnit, departmentLoads, filterCounts, groupDecisions, inFilter, wipTotal } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgKpiCard, MfgNote, MfgPanel, fmtQty } from "./ui/MfgUi"
import { DecisionList, LatePanel, LoadPanel, Money, OthersPanel, TeamPanel, TodayGrid, TodayKpis, UnitsText, useWorkshopJump } from "./MfgTodayBits"

export function MfgTodayManager() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const jump = useWorkshopJump()
  const { views, world, data } = ui

  const figures = useMemo(() => {
    const live = views.filter((v) => v.live)
    const late = views.filter((v) => v.late)
    // The same set the Workshop's Ready filter opens (TD-02).
    const ready = views.filter((v) => inFilter(v, "ready"))
    const bn = data.settings.features.time ? departmentLoads(world, data.departments).find((l) => l.bottleneck) : undefined
    return {
      inProduction: filterCounts(views).prod,
      inHand: byUnit(live.map((v) => [v.unit, v.calc.wip])),
      wip: wipTotal(views),
      late: late.length,
      pastDue: late.filter((v) => v.overdue).length,
      atRisk: late.filter((v) => !v.overdue).length,
      bottleneck: bn && bn.days > 0 ? bn.department.name || "" : "",
      ready: byUnit(ready.map((v) => [v.unit, v.calc.ready])),
      readyOrders: ready.length,
      short: live.filter((v) => v.shortages.length > 0),
    }
  }, [views, world, data.settings.features.time, data.departments])

  const groups = useMemo(() => groupDecisions(ui.decisions), [ui.decisions])

  return (
    <div className="min-w-0 space-y-4">
      <TodayKpis>
        <MfgKpiCard
          icon={Factory}
          label={t("mfw_kpi_in_production")}
          value={<span className="tabular-nums">{figures.inProduction}</span>}
          unit={t("mfw_orders_word", { count: figures.inProduction })}
          sub={
            <span>
              {t("mfw_kpi_in_hand")} <UnitsText list={figures.inHand} />
              {ui.seesMoney && (
                <>
                  {" · "}
                  {t("mfw_kpi_wip")} <Money value={figures.wip} />
                </>
              )}
            </span>
          }
          onClick={() => jump({ f: "prod" })}
        />
        <MfgKpiCard
          icon={AlertTriangle}
          label={t("mfw_kpi_late")}
          value={<span className="tabular-nums">{figures.late}</span>}
          unit={t("mfw_orders_word", { count: figures.late })}
          subTone={figures.late ? "bad" : "ok"}
          sub={
            figures.late
              ? [
                  t("mfw_kpi_past_due", { count: figures.pastDue }),
                  t("mfw_kpi_at_risk", { count: figures.atRisk }),
                  figures.bottleneck ? t("mfw_kpi_bottleneck", { dept: figures.bottleneck }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("mfw_kpi_on_time")
          }
          onClick={() => jump({ late: true })}
        />
        <MfgKpiCard
          icon={Truck}
          label={t("mfw_kpi_ready")}
          value={<UnitsText list={figures.ready} />}
          subTone={figures.readyOrders ? "warn" : "muted"}
          sub={figures.readyOrders ? t("mfw_kpi_ready_sub", { count: figures.readyOrders }) : t("mfw_kpi_ready_none")}
          onClick={() => jump({ f: "ready" })}
        />
      </TodayKpis>

      {figures.short.length > 0 && (
        <MfgNote tone="bad" icon={ShoppingCart} title={t("mfw_short_banner", { count: figures.short.length })}>
          <ul className="mt-1 space-y-0.5">
            {figures.short.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => ui.openOrder(v.id)}
                  className="rounded text-start font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <bdi dir="ltr">{v.ref}</bdi>
                </button>
                {": "}
                {v.shortages
                  .map((s) =>
                    t(s.requested ? "mfw_short_line_requested" : "mfw_short_line", { item: s.itemName, qty: fmtQty(s.short), unit: s.unit })
                  )
                  .join(t("mfw_list_sep"))}
              </li>
            ))}
          </ul>
        </MfgNote>
      )}

      <TodayGrid
        main={
          <MfgPanel title={t("mfw_decisions_title")} subtitle={t("mfw_decisions_sub_manager")} count={ui.decisions.length}>
            <DecisionList groups={groups} empty={t("mfw_decisions_empty")} />
          </MfgPanel>
        }
        side={
          <>
            <LatePanel />
            <TeamPanel />
            <OthersPanel persona="manager" stations={ui.stations} />
            <LoadPanel canReport={ui.perms.canManage || ui.perms.canWork} />
          </>
        }
      />
    </div>
  )
}
