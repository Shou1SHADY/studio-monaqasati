"use client"

// The station lead's Today (TD-04, TD-05, UI-07): what is in his hands by
// unit, what is ready to work now and what is blocked, then his queue in order
// — rush, then late, then the nearest date — each row with its one button or
// why there is none. Beside it his station today (capacity, queue, the hours
// lost and a one-tap stop report) and what other modules hold at his station.
// Built for a phone on the shop floor: one column, big buttons.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { CheckCircle2, Factory, Lock } from "lucide-react"
import { byUnit, departmentLoads, stationQueue } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgKpiCard, MfgNote, MfgPanel, fmtQty } from "./ui/MfgUi"
import { OthersPanel, QueueList, StationPanel, TodayGrid, TodayKpis, UnitsText, isBlockedRow, isReadyRow } from "./MfgTodayBits"

export function MfgTodayLead() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { world, data, stations } = ui

  const rows = useMemo(
    () => stationQueue(world, stations, data.engineActor, data.departments, data.settings, "lead"),
    [world, stations, data.engineActor, data.departments, data.settings]
  )
  const queueDays = useMemo(() => {
    if (!data.settings.features.time) return null
    return departmentLoads(world, data.departments)
      .filter((l) => stations.includes(l.department.id))
      .reduce((a, l) => a + l.days, 0)
  }, [world, data.departments, data.settings.features.time, stations])

  const ready = rows.filter(isReadyRow)
  const blocked = rows.filter(isBlockedRow)
  const orders = new Set(rows.map((r) => r.view.id)).size
  const firstBlocked = blocked[0]
  const blockedWhy = firstBlocked
    ? (() => {
        const hard = firstBlocked.blocks.find((b) => b.severity === "hard")
        return `${firstBlocked.view.ref}: ${hard ? t(`mfg4_what_${hard.key}`) : t("mfg4_mat_requested")}`
      })()
    : null

  if (!stations.length) {
    return (
      <MfgNote tone="info" title={t("mfw_lead_no_stations_title")}>
        {t("mfw_lead_no_stations_hint")}
      </MfgNote>
    )
  }

  return (
    <div className="min-w-0 space-y-4">
      <TodayKpis>
        <MfgKpiCard
          icon={Factory}
          label={t("mfw_kpi_in_your_hands")}
          value={<UnitsText list={byUnit(rows.map((r) => [r.view.unit, r.inHand]))} />}
          sub={[t("mfw_in_orders", { count: orders }), queueDays != null ? t("mfw_queue_days", { days: fmtQty(Math.round(queueDays * 10) / 10) }) : null].filter(Boolean).join(" · ")}
        />
        <MfgKpiCard
          icon={CheckCircle2}
          label={t("mfw_kpi_ready_now")}
          value={<span className="tabular-nums">{ready.length}</span>}
          unit={t("mfw_orders_word", { count: ready.length })}
          subTone={ready.length ? "ok" : "muted"}
          sub={ready.length ? t("mfw_kpi_start_with", { order: ready[0].view.ref }) : t("mfw_kpi_nothing_ready")}
        />
        <MfgKpiCard
          icon={Lock}
          label={t("mfw_kpi_blocked")}
          value={<span className="tabular-nums">{blocked.length}</span>}
          unit={t("mfw_orders_word", { count: blocked.length })}
          subTone={blocked.length ? "warn" : "muted"}
          sub={blockedWhy || t("mfw_kpi_nothing_blocked")}
        />
      </TodayKpis>

      <TodayGrid
        main={
          <MfgPanel title={t("mfw_queue_title")} subtitle={t("mfw_queue_sub")} count={rows.length}>
            <QueueList rows={rows} empty={t("mfw_queue_empty")} />
          </MfgPanel>
        }
        side={
          <>
            <StationPanel stations={stations} canReport={ui.perms.canWork || ui.perms.canManage} />
            <OthersPanel persona="lead" stations={stations} />
          </>
        }
      />
    </div>
  )
}
