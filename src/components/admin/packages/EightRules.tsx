"use client"

import { useLocale, useTranslations } from "next-intl"
import { EIGHT_RULES } from "@/lib/procurement/package-data"

export function EightRules() {
  const locale = useLocale()
  const t = useTranslations("Portal.AdminPipeline")
  const i = locale === "ar" ? 0 : 1
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-black">{t("rules")}</h2>
      <ol className="ms-5 list-decimal space-y-1.5 text-sm leading-relaxed" data-testid="eight-rules">
        {EIGHT_RULES.map((rule) => (
          <li key={rule[0]}>{rule[i]}</li>
        ))}
      </ol>
    </section>
  )
}
