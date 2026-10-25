"use client"

import { useTranslations } from "next-intl"
import { CONNECTORS } from "@/lib/procurement/package"
import type { CompanyPackage } from "@/hooks/useCompanyPackages"
import { cn } from "@/lib/utils"

export interface ExtraKpi {
  id: string
  label: string
  n: number
  warn?: boolean
}

/**
 * The strip above the contractors table: companies · on the full package · without Finance · said «yes» and not opened,
 * then any `extra` counts (verification). Every number counts COMPANIES — the same rows as the table.
 */
export function PackageKpis({ companies, extra = [] }: { companies: CompanyPackage[]; extra?: ExtraKpi[] }) {
  const t = useTranslations("Portal.AdminPackages.kpi")
  const cards = [
    { id: "subscribers", n: companies.length, warn: false },
    { id: "full", n: companies.filter((c) => CONNECTORS.every((k) => c.pkg[k])).length, warn: false },
    { id: "no_fin", n: companies.filter((c) => !c.pkg.fin).length, warn: false },
    { id: "mismatch", n: companies.filter((c) => c.missing.length > 0).length, warn: true },
  ].map((c) => ({ ...c, label: t(c.id) }))
  const all = [...cards, ...extra.map((e) => ({ ...e, warn: !!e.warn }))]
  return (
    <ul className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", all.length > 4 ? "xl:grid-cols-6" : "lg:grid-cols-4")} data-testid="package-kpis">
      {all.map((c) => (
        <li key={c.id} data-kpi={c.id} className={cn("rounded-xl border bg-card p-4 shadow-sm", c.warn && c.n > 0 && "border-warning/40 bg-warning/5")}>
          <small className="block text-xs text-muted-foreground">{c.label}</small>
          <b className="text-2xl font-black tabular-nums">{c.n}</b>
        </li>
      ))}
    </ul>
  )
}
