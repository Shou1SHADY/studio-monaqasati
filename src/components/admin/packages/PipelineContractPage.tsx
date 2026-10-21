"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Switch } from "@/components/ui/switch"
import { CONNECTORS, FULL_PACKAGE, type Connector, type PackageFlags } from "@/lib/procurement/package"
import { ContractTable } from "./ContractTable"
import { EightRules } from "./EightRules"
import { EightStatesMatrix } from "./EightStatesMatrix"
import { UnitIcon } from "./PackageIcons"
import { PackagePipeline } from "./PackagePipeline"

/** «المسار والعقود» (ADM-04), for the platform's technical team: the six stages by connector, the eight rules, the 36 events and the eight states. Nothing here is stored. */
export function PipelineContractPage() {
  const t = useTranslations("Portal.AdminPipeline")
  const tp = useTranslations("Portal.ProcPackage")
  const [pkg, setPkg] = useState<PackageFlags>(FULL_PACKAGE)
  const toggle = (c: Connector, on: boolean) => setPkg((p) => ({ ...p, [c]: on }))

  return (
    <div className="space-y-5 text-start">
      <header>
        <h1 className="text-2xl font-black text-foreground">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("sub")}</p>
      </header>

      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-4">
          <h2 className="text-sm font-black">{t("try")}</h2>
          {CONNECTORS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm font-bold">
              <UnitIcon unit={c} on={pkg[c]} className="h-6 w-6" />
              {tp(`conn.${c}.short`)}
              <Switch checked={pkg[c]} onCheckedChange={(on) => toggle(c, on)} aria-label={tp(`conn.${c}.short`)} />
            </label>
          ))}
        </div>
        <PackagePipeline pkg={pkg} dev />
      </section>

      <EightRules />
      <ContractTable />
      <EightStatesMatrix />
    </div>
  )
}
