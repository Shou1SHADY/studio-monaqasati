"use client"

import { useTranslations } from "next-intl"
import { CONNECTORS } from "@/lib/procurement/package"
import type { CompanyPackage } from "@/hooks/useCompanyPackages"
import { cn } from "@/lib/utils"

/** The package strip above the contractors table: subscribers · on the full package · without Finance · said «yes» and not opened. */
export function PackageKpis({ companies }: { companies: CompanyPackage[] }) {
  const t = useTranslations("Portal.AdminPackages.kpi")
  const cards = [
    { id: "subscribers", n: companies.length, warn: false },
    { id: "full", n: companies.filter((c) => CONNECTORS.every((k) => c.pkg[k])).length, warn: false },
    { id: "no_fin", n: companies.filter((c) => !c.pkg.fin).length, warn: false },
    { id: "mismatch", n: companies.filter((c) => c.missing.length > 0).length, warn: true },
  ]
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="package-kpis">
      {cards.map((c) => (
        <li key={c.id} data-kpi={c.id} className={cn("rounded-xl border bg-card p-4 shadow-sm", c.warn && c.n > 0 && "border-warning/40 bg-warning/5")}>
          <small className="block text-xs text-muted-foreground">{t(c.id)}</small>
          <b className="text-2xl font-black tabular-nums">{c.n}</b>
        </li>
      ))}
    </ul>
  )
}
