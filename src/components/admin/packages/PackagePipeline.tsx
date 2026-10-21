"use client"

import { useLocale, useTranslations } from "next-intl"
import { EVENTS, STAGES, type PipelineUnit } from "@/lib/procurement/package-data"
import { unitIn, type PackageFlags } from "@/lib/procurement/package"
import { cn } from "@/lib/utils"
import { UnitIcon } from "./PackageIcons"

const ORDER: readonly PipelineUnit[] = ["core", "inv", "pm", "fin", "mfg"]

const BOX_TONE: Record<PipelineUnit, string> = {
  core: "border-teal/30 bg-teal/5",
  inv: "border-accent/30 bg-accent/5",
  pm: "border-pm/30 bg-pm/5",
  fin: "border-success/30 bg-success/5",
  mfg: "border-warning/30 bg-warning/5",
}

/** The six stages, each with the base's two units and the connectors that act there: lit when in the package, dotted — with the
 * base's fallback — when not. With `dev` the events carry their keys (the team's page); without, it is the customer's picture. */
export function PackagePipeline({ pkg, dev = false }: { pkg: PackageFlags; dev?: boolean }) {
  const locale = useLocale()
  const tp = useTranslations("Portal.ProcPackage")
  const t = useTranslations("Portal.AdminPipeline")
  const i = locale === "ar" ? 0 : 1
  const unitName = (u: PipelineUnit) => (u === "core" || u === "inv" ? tp(`base.${u}.short`) : tp(`conn.${u}.short`))

  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="package-pipeline">
      {STAGES.map((stage, n) => (
        <div key={stage.id} className="min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">{n + 1}</span>
            {stage.name[i]}
          </div>
          {ORDER.map((unit) => {
            const events = EVENTS.filter((e) => e.unit === unit && e.stage === stage.id)
            if (unit !== "core" && !events.length) return null
            const on = unitIn(unit, pkg)
            return (
              <div
                key={unit}
                data-unit={unit}
                data-state={on ? "on" : "off"}
                className={cn("space-y-1 rounded-xl border p-2.5 text-xs", on ? BOX_TONE[unit] : "border-dashed border-border bg-muted/40 text-muted-foreground")}
              >
                <p className="flex items-center gap-1.5 font-bold">
                  <UnitIcon unit={unit} on={on} className="h-5 w-5" />
                  {unitName(unit)}
                  {!on && <span className="font-medium"> · {t("closed")}</span>}
                </p>
                {unit === "core" && <p className="text-muted-foreground">{stage.core[i]}</p>}
                {unit === "core"
                  ? dev &&
                    events.map((e) => (
                      <code key={e.id} dir="ltr" className="block break-all text-[10.5px] text-muted-foreground">
                        {e.key}
                      </code>
                    ))
                  : on
                  ? events.map((e) => (
                      <p key={e.id} className="leading-relaxed">
                        <span aria-hidden="true">{e.dir === "in" ? "←" : "→"} </span>
                        {e.title[i]}
                        {dev && (
                          <code dir="ltr" className="mt-0.5 block break-all text-[10.5px] text-muted-foreground">
                            {e.key}
                          </code>
                        )}
                      </p>
                    ))
                  : events.length > 0 && (
                      <p className="leading-relaxed">
                        {t("without_it")} {events[0].without[i]}
                      </p>
                    )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
