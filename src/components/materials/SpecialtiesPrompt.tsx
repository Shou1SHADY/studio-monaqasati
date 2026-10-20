"use client"

// Asked once, on the supplier's home (PUR-04): until he chooses his specialties from the
// material tree, requests written on it do not reach him publicly.

import { useTranslations } from "next-intl"
import { FolderTree } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"

export const SPECIALTIES_HREF = "/supplier/profile?tab=specs"

export function SpecialtiesPrompt({ href = SPECIALTIES_HREF }: { href?: string }) {
  const t = useTranslations("Portal.Materials")
  return (
    <section aria-label={t("prompt_title")} className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
      <FolderTree size={20} className="shrink-0 text-amber-700" aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-60">
        <b className="block text-sm font-bold text-amber-900">{t("prompt_title")}</b>
        <p className="mt-1 text-xs leading-relaxed text-amber-800">{t("prompt_body")}</p>
      </div>
      <Button asChild size="sm">
        <Link href={href}>{t("prompt_cta")}</Link>
      </Button>
    </section>
  )
}
