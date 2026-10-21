"use client"

import { useTranslations } from "next-intl"
import type { CompanyPackage } from "@/hooks/useCompanyPackages"
import { packageLabel } from "@/lib/procurement/package"

/** «إصدار المشتريات»: the package's name and, when they said «yes» to a need that is still closed, the reminder. */
export function PackageVersionCell({ company }: { company: CompanyPackage }) {
  const t = useTranslations("Portal.AdminPackages.list")
  const tp = useTranslations("Portal.ProcPackage")
  return (
    <div className="space-y-1">
      <span className="text-sm font-bold" data-testid="version-label">
        {packageLabel(company.pkg, tp)}
      </span>
      {company.missing.length > 0 && (
        <span className="block w-fit rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-bold text-warning" data-testid="said-yes">
          {t("said_yes", { names: company.missing.map((c) => tp(`conn.${c}.short`)).join(t("join")) })}
        </span>
      )}
    </div>
  )
}
