"use client"

import { useLocale, useTranslations } from "next-intl"
import { PACKAGE_STATES, packageTitle } from "@/lib/procurement/package"
import { stateRow } from "@/lib/procurement/package-matrix"
import { PackageChips } from "./PackageIcons"

/** «الحالات الثماني — مصفوفة الاختبار»: every combination of the three connectors and what each one means for the base. */
export function EightStatesMatrix() {
  const locale = useLocale()
  const t = useTranslations("Portal.AdminPipeline")
  const tp = useTranslations("Portal.ProcPackage")
  const i = locale === "ar" ? 0 : 1
  const labels = { core: tp("base.core.short"), inv: tp("base.inv.short"), pm: tp("conn.pm.short"), fin: tp("conn.fin.short"), mfg: tp("conn.mfg.short") }
  const cell = (lines: ReadonlyArray<readonly [string, string]>) => lines.map((l) => l[i]).join(" ")

  return (
    <section className="rounded-2xl border bg-card shadow-sm">
      <div className="border-b p-4">
        <h2 className="text-sm font-black">{t("matrix.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("matrix.sub")}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-start text-xs" data-testid="states-matrix">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              {(["state", "sources", "check", "locations", "payment"] as const).map((col) => (
                <th key={col} className="px-3 py-2 text-start font-bold">
                  {t(`matrix.col.${col}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {PACKAGE_STATES.map((s) => {
              const row = stateRow(s.pkg)
              return (
                <tr key={s.id} data-state={s.id} className="align-top">
                  <td className="px-3 py-2">
                    <PackageChips pkg={s.pkg} labels={labels} />
                    <div className="mt-1 text-muted-foreground">{packageTitle(s.pkg, tp)}</div>
                  </td>
                  <td className="px-3 py-2">{cell(row.sources)}</td>
                  <td className="px-3 py-2">{cell(row.checks)}</td>
                  <td className="px-3 py-2">{cell(row.locations)}</td>
                  <td className="px-3 py-2">{row.payment[i]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
