"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CONNECTORS } from "@/lib/procurement/package"
import { EVENTS, type PipelineUnit } from "@/lib/procurement/package-data"
import { cn } from "@/lib/utils"
import { UnitIcon } from "./PackageIcons"

type Filter = "all" | PipelineUnit

const FILTERS: readonly Filter[] = ["all", "core", "inv", ...CONNECTORS]

/** «عقد الربط»: the 36 events with their keys, what each carries, what happens when it is late, and the base's answer when the connector is not subscribed. */
export function ContractTable() {
  const locale = useLocale()
  const t = useTranslations("Portal.AdminPipeline")
  const tp = useTranslations("Portal.ProcPackage")
  const [filter, setFilter] = useState<Filter>("all")
  const i = locale === "ar" ? 0 : 1
  const rows = EVENTS.filter((e) => filter === "all" || e.unit === filter)
  const unitName = (u: PipelineUnit) => (u === "core" || u === "inv" ? tp(`base.${u}.short`) : tp(`conn.${u}.short`))

  return (
    <section className="rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <h2 className="text-sm font-black">{t("contract")}</h2>
        <span className="text-xs text-muted-foreground" data-testid="contract-count">
          {t("events", { count: rows.length })}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 border-b p-3" role="group" aria-label={t("contract")}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === f ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {f === "all" ? t("filter_all") : unitName(f)}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-start text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              {(["module", "dir", "event", "key", "carries", "late", "without"] as const).map((col) => (
                <th key={col} className="px-3 py-2 text-start font-bold">
                  {t(`col.${col}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((e) => (
              <tr key={e.id} data-event={e.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <UnitIcon unit={e.unit} className="h-5 w-5" />
                    {unitName(e.unit)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{t(e.dir === "in" ? "dir_in" : "dir_out")}</td>
                <td className="px-3 py-2">
                  {e.title[i]}
                  {e.isNew && <span className="ms-1 rounded-full bg-violet/10 px-1.5 py-0.5 text-[10px] font-bold text-violet">{t("new")}</span>}
                </td>
                <td className="px-3 py-2">
                  <code dir="ltr" className="break-all">
                    {e.key}
                  </code>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{e.carries[i]}</td>
                <td className="px-3 py-2 text-muted-foreground">{e.late[i]}</td>
                <td className="px-3 py-2 text-muted-foreground">{e.without[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
