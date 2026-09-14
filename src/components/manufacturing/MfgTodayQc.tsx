"use client"

// The quality officer's Today (TD-04, FL-09, FL-11): the rejects awaiting a
// decision and how old the oldest is, what waits for inspection and release at
// QC & packing (nothing closes before it), the open block notices — then the
// decisions, the QC & packing queue, and every notice with the live orders on
// its block. QC does not see "awaiting other modules" (TD-08).

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { ClipboardCheck, Layers, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { byUnit, stationQueue } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgModuleChip } from "./MfgOrderBits"
import { MfgChip, MfgEmpty, MfgKpiCard, MfgPanel, useMfgDate } from "./ui/MfgUi"
import { DecisionList, QueueList, SeverityBar, TodayGrid, TodayKpis, UnitsText } from "./MfgTodayBits"

export function MfgTodayQc() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const { world, data, views, stations } = ui

  const decisions = useMemo(() => ui.decisions.filter((x) => !(x.kind === "order" && (x.candidate.key === "output" || x.candidate.key === "qc_release"))), [ui.decisions])
  const rows = useMemo(
    () => stationQueue(world, stations, data.engineActor, data.departments, data.settings, "qc"),
    [world, stations, data.engineActor, data.departments, data.settings]
  )

  const rejects = useMemo(() => {
    const withRejects = views.filter((v) => v.live && v.calc.rejected > 0)
    const open = withRejects.flatMap((v) => v.calc.slice.rejects.filter((r) => (v.calc.slice.progress[r.index]?.rejected || 0) > 0).map((r) => r.at))
    const oldest = open.sort()[0]
    return {
      units: byUnit(withRejects.map((v) => [v.unit, v.calc.rejected])),
      orders: withRejects.length,
      oldestDays: oldest ? Math.max(0, Math.floor((ui.nowMs - new Date(oldest).getTime()) / 86400000)) : null,
    }
  }, [views, ui.nowMs])

  const notices = useMemo(() => data.notices.filter((n) => !n.closedAt), [data.notices])
  const canReport = ui.perms.canQc || ui.perms.canManage

  return (
    <div className="min-w-0 space-y-4">
      <TodayKpis>
        <MfgKpiCard
          icon={TriangleAlert}
          label={t("mfw_kpi_rejects")}
          value={<UnitsText list={rejects.units} />}
          subTone={rejects.orders ? "warn" : "muted"}
          sub={
            rejects.orders
              ? [t("mfw_in_orders", { count: rejects.orders }), rejects.oldestDays != null ? t("mfw_kpi_oldest", { days: rejects.oldestDays }) : null].filter(Boolean).join(" · ")
              : t("mfw_kpi_no_rejects")
          }
        />
        <MfgKpiCard
          icon={ClipboardCheck}
          label={t("mfw_kpi_release")}
          value={<UnitsText list={byUnit(rows.map((r) => [r.view.unit, r.inHand]))} />}
          sub={t("mfw_kpi_release_sub", { count: new Set(rows.map((r) => r.view.id)).size })}
        />
        <MfgKpiCard
          icon={Layers}
          label={t("mfw_kpi_notices")}
          value={<span className="tabular-nums">{notices.length}</span>}
          subTone={notices.length ? "bad" : "muted"}
          sub={notices.length ? notices.map((n) => n.lot).join(" · ") : t("mfw_kpi_no_notices")}
        />
      </TodayKpis>

      <TodayGrid
        main={
          <>
            <MfgPanel title={t("mfw_decisions_title")} subtitle={t("mfw_decisions_sub_qc")} count={decisions.length}>
              <DecisionList items={decisions} empty={t("mfw_decisions_empty")} />
            </MfgPanel>
            <MfgPanel title={t("mfw_qc_queue_title")} subtitle={t("mfw_qc_queue_sub")} count={rows.length}>
              <QueueList rows={rows} empty={t("mfw_qc_queue_empty")} />
            </MfgPanel>
          </>
        }
        side={
          <MfgPanel title={t("mfw_notices_title")} subtitle={t("mfw_notices_sub")} count={notices.length}>
            {notices.length === 0 ? (
              <MfgEmpty icon={Layers} title={t("mfw_notices_empty")} />
            ) : (
              <ul>
                {notices.map((n) => {
                  const on = views.filter((v) => v.live && v.notices.some((x) => x.id === n.id))
                  return (
                    <li key={n.id} className="flex gap-3 border-b border-border/60 px-4 py-3 last:border-b-0">
                      <SeverityBar severity="r" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-xs font-bold text-foreground">
                          <bdi dir="ltr">{n.lot}</bdi> — {t(`mfg4_defect_${n.defect}`)}
                          {n.itemName && <span className="font-normal text-muted-foreground"> · {n.itemName}</span>}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{[n.note, n.by, d.relative(n.at)].filter(Boolean).join(" · ")}</p>
                        {on.length > 0 && (
                          <p className="flex flex-wrap items-center gap-1 text-[11px] text-slate-700">
                            {t("mfw_notices_on")}
                            {on.map((v) => (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() => ui.openOrder(v.id)}
                                className="rounded px-1 font-semibold text-cta underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <bdi dir="ltr">{v.ref}</bdi>
                              </button>
                            ))}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <MfgModuleChip module="inventory" />
                          <MfgChip tone={n.quarantinedAt ? "ok" : "muted"}>{n.quarantinedAt ? t("mfw_notice_quarantined") : t("mfw_notice_quarantine_wait")}</MfgChip>
                          <MfgModuleChip module="procurement" />
                          <MfgChip tone={n.claimRaisedAt ? "ok" : "muted"}>{n.claimRaisedAt ? t("mfw_notice_claimed") : t("mfw_notice_claim_wait")}</MfgChip>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {canReport && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3">
                <Button variant="outline" className="h-10 gap-1.5 text-xs" onClick={() => ui.openGlobal({ kind: "blockNotice" })}>
                  <TriangleAlert size={14} aria-hidden="true" /> {t("mfw_report_block")}
                </Button>
                <span className="text-[11px] text-muted-foreground">{t("mfw_report_block_hint")}</span>
              </div>
            )}
          </MfgPanel>
        }
      />
    </div>
  )
}
