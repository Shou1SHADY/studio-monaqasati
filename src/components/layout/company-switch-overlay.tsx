"use client"

import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

/**
 * Covers the portal while a company switch is in flight.
 *
 * Switching ends in a full navigation to the target portal (see
 * switchActiveCompany), and until the new document paints, the old one is
 * still on screen reacting to a profile that has already changed underneath
 * it. Without this cover the switch read as two page loads — the old page
 * re-rendering under the new company, a pause, then the real one arriving.
 */
export function CompanySwitchOverlay({ show }: { show: boolean }) {
  const t = useTranslations("Portal.Shared")
  if (!show) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-sm"
    >
      <Loader2 className="animate-spin text-primary" size={30} />
      <p className="text-sm font-semibold text-muted-foreground">{t("company_switcher_switching")}</p>
    </div>
  )
}
