"use client"

import { useLocale, useTranslations } from "next-intl"
import { ArrowRight, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"

/**
 * Placeholder for a route that is built but not released yet — see
 * `@/lib/feature-flags`. Serving this instead of redirecting means a
 * bookmark or an old link explains itself rather than silently bouncing
 * the user somewhere they did not ask to go.
 *
 * Deliberately wears the same amber/Sparkles "not built yet" language the
 * app already uses for the Invoices page and ComingSoonTab (project
 * sections), so an unreleased page looks the same wherever it appears.
 * The badge reuses `sec_ghost_badge` rather than introducing a second
 * string for the identical idea.
 */
export function ComingSoon({
  /** Where "back" goes. Defaults to the contractor dashboard. */
  backHref = "/contractor",
  title,
  description,
}: {
  backHref?: string
  title?: string
  description?: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"

  return (
    <div
      className="flex flex-col items-center justify-center py-20 px-6 gap-3 text-center border border-dashed rounded-2xl bg-card"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="h-14 w-14 rounded-2xl bg-amber-50 flex items-center justify-center" aria-hidden="true">
        <Sparkles size={24} className="text-amber-500" />
      </div>
      <div>
        <p className="font-bold text-lg text-foreground">{title || t("coming_soon_title")}</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description || t("coming_soon_desc")}</p>
      </div>
      <span className="text-xs font-bold text-amber-600 bg-amber-50 px-3 py-1 rounded-full mt-1">
        {t("sec_ghost_badge")}
      </span>
      <Link href={backHref} className="mt-2">
        <Button variant="outline" size="sm" className="gap-2">
          {t("coming_soon_back")}
          <ArrowRight size={14} className={cn(isRtl ? "rotate-180" : "")} />
        </Button>
      </Link>
    </div>
  )
}
