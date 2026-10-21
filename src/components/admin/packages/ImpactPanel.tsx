"use client"

import { useTranslations } from "next-intl"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Callout } from "@/components/module-ui/Callout"
import { Button } from "@/components/ui/button"
import type { OptionalModule } from "@/lib/company-modules"
import { connectorTexts, type Connector } from "@/lib/procurement/package"
import type { ImpactCounts } from "@/lib/procurement/package-migration"
import { impactQuiet, type ImpactReport, type ImpactReportChange } from "@/lib/procurement/package-impact-report"
import { UnitIcon } from "./PackageIcons"

type Tr = ReturnType<typeof useTranslations>

const MODULE_NAME: Record<OptionalModule, string> = {
  "project-management": "component_project_management",
  hr: "component_hr",
  manufacturing: "component_manufacturing",
  crm: "component_crm",
  warehouses: "component_inventory",
  payments: "component_finance",
}

/** The record-count sentence of one connector's change — the prototype's `impactTx`, from the company's own counts. */
function sentence(c: ImpactReportChange, t: Tr): string {
  const n = (k: keyof ImpactCounts) => c.impact[k] ?? 0
  const noun = (key: string, count: number) => t(`n.${key}`, { count })
  if (c.conn === "pm" && c.to === "on") {
    const sites = n("sitesToLink") > 0 ? t("sentence.pm_on_sites", { sites: noun("site", n("sitesToLink")) }) : ""
    return [t("sentence.pm_on", { requests: noun("request", n("teamRequestsOpen")) }), sites].filter(Boolean).join(" ")
  }
  if (c.conn === "pm") return t("sentence.pm_off", { requests: noun("request", n("projectRequestsOpen")), inflight: n("projectRequestsInFlight") })
  if (c.conn === "fin" && c.to === "on") return t("sentence.fin_on", { orders: noun("order", n("buyerPaymentMarks")) })
  if (c.conn === "fin") return t("sentence.fin_off", { orders: noun("order", n("ordersAwaitingPayment")), advances: noun("order", n("advancesRequested")) })
  if (c.to === "on") return t("sentence.mfg_on")
  return t("sentence.mfg_off", { asks: noun("ask", n("workshopAsksUnanswered")), replies: noun("reply", n("workshopAnswersWithWorkOrder")) })
}

/**
 * «ما يتغيّر عند الحفظ»: for each connector that changes, the transition rule and what it does to the company's records.
 * When any record is touched the admin must acknowledge before saving; nothing is deleted and nothing is opened as the company.
 */
export function ImpactPanel({
  report,
  loading,
  failed,
  acknowledged,
  onAcknowledge,
  onRetry,
  changed,
}: {
  report: ImpactReport | null
  loading: boolean
  failed: boolean
  acknowledged: boolean
  onAcknowledge: (v: boolean) => void
  onRetry: () => void
  changed: Array<{ conn: Connector; to: "on" | "off" }>
}) {
  const t = useTranslations("Portal.AdminPackages.impact")
  const tc = useTranslations("Portal.AdminPackages.detail.change")
  const tp = useTranslations("Portal.ProcPackage")
  const tSide = useTranslations("Portal.Sidebar")
  const tMod = useTranslations("Portal.AdminModules")
  if (changed.length === 0) return null

  const rows = report?.changes.length ? report.changes : changed.map((c) => ({ ...c, impact: {} }))
  const quiet = report ? impactQuiet(report) : false

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm" aria-live="polite" data-testid="impact-panel">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-foreground">
        <AlertTriangle size={15} className="text-warning" aria-hidden="true" />
        {tc("title")}
      </h3>
      <ul className="space-y-3">
        {rows.map((c) => {
          const texts = connectorTexts(c.conn, tp)
          return (
            <li key={c.conn} className="flex gap-3" data-conn={c.conn} data-to={c.to}>
              <UnitIcon unit={c.conn} />
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <b className="block">{tc(c.to === "on" ? "opens" : "closes", { name: texts.name })}</b>
                <p className="text-xs text-muted-foreground">{c.to === "on" ? texts.onRule : texts.offRule}</p>
                {report && <p className="text-xs text-foreground" data-testid={`impact-${c.conn}`}>{sentence(c, t)}</p>}
              </div>
            </li>
          )
        })}
      </ul>

      {loading && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          {tc("checking")}
        </p>
      )}
      {failed && (
        <Callout tone="warn" className="mt-3">
          <p>{tc("failed")}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetry}>
            {tc("retry")}
          </Button>
        </Callout>
      )}

      {report?.hrDependent && (
        <Callout tone="warn" className="mt-3">
          {t("hr_dependent", { hr: tSide("component_hr"), finance: tSide("component_finance") })}
        </Callout>
      )}
      {report?.projectsCapped && (
        <Callout tone="info" className="mt-3">
          {t("capped", { cap: report.scanCap })}
        </Callout>
      )}
      {report && report.warnings.length > 0 && (
        <Callout tone="warn" className="mt-3">
          <p className="font-bold">{tMod("pending_title")}</p>
          <p className="mb-1 text-xs">{tMod("pending_intro")}</p>
          <ul className="space-y-1 text-xs">
            {report.warnings.map((w) => (
              <li key={w.module}>
                <span className="font-bold">{tSide(MODULE_NAME[w.module])}</span>
                <ul className="ms-4 list-disc">
                  {w.items.map((i) => (
                    <li key={i.key}>{tMod(`pending_${i.key}`, { count: i.count })}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {report && quiet && !loading && <p className="mt-3 text-xs text-muted-foreground">{t("quiet")}</p>}

      {report && !quiet && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm font-bold">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} />
          <span>{tc("ack")}</span>
        </label>
      )}
    </section>
  )
}
