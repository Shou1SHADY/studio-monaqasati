"use client"

// Wraps a portal page. If the company switched off the module the address belongs to, the page is
// replaced by a notice (menu and tiles already leave the module out); while the switches load, a page
// of an optional module waits instead of flashing. Everything else — and the admin portal — passes through.
// A company whose trial has run out gets no screens at all, only a locked page; while the trial runs it sees how long is left.

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, LockKeyhole, PowerOff } from "lucide-react"
import { usePathname } from "next/navigation"
import { Link } from "@/i18n/routing"
import { useCompanyModules } from "@/hooks/useCompanyModules"
import { useCompanyTrial } from "@/hooks/useCompanyTrial"
import { Callout } from "@/components/module-ui/Callout"
import { trialDayText as dateOf } from "@/lib/subscription-status"
import { belongsToOptionalModule, offModuleOwning, pathWithoutLocale, portalOfPath, type ModulePortal } from "@/lib/company-modules"
import { usePortalRegistry, useSupplierTrial } from "@/hooks/usePortalRegistry"

export function ModuleGate({ children }: { children: ReactNode }) {
  // `/en/contractor/…` is the contractor's too — without the locale stripped, English pages were never gated.
  const pathname = pathWithoutLocale(usePathname())
  const portal: ModulePortal | null = portalOfPath(pathname)
  const { off, loading } = useCompanyModules(portal)
  // The registry as the company's plan shapes it (a free supplier's locked modules own no page here).
  const all = usePortalRegistry(portal)
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { state: trial, loading: trialLoading } = useCompanyTrial(portal)
  const paidTrial = useSupplierTrial()
  if (!portal) return <>{children}</>
  if (trialLoading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} aria-hidden="true" />
      </div>
    )
  }
  if (trial.phase === "expired") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center" data-trial-locked="true">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <LockKeyhole size={24} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-black">{t("trial_locked_title")}</h1>
        <p className="text-sm text-muted-foreground">{t("trial_locked_desc", { date: dateOf(trial.endsAt, locale) })}</p>
        <Link href="/contact" className="text-sm font-semibold text-cta underline-offset-2 hover:underline">
          {t("trial_locked_contact")}
        </Link>
      </div>
    )
  }
  if (loading) {
    return belongsToOptionalModule(pathname, all, portal) ? (
      <div className="flex h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} aria-hidden="true" />
      </div>
    ) : (
      <>{children}</>
    )
  }
  const banner =
    trial.phase === "trial" && trial.daysLeft !== null ? (
      <Callout tone={trial.daysLeft <= 3 ? "warn" : "info"} className="mb-4">
        {t("trial_banner", { count: trial.daysLeft, date: dateOf(trial.endsAt, locale) })}
      </Callout>
    ) : portal === "supplier" && paidTrial.phase === "running" && paidTrial.daysLeft !== null ? (
      <Callout tone={paidTrial.daysLeft <= 2 ? "warn" : "info"} className="mb-4">
        {t("paid_trial_banner", { count: paidTrial.daysLeft, date: dateOf(paidTrial.endsAt, locale) })}
      </Callout>
    ) : null
  const blocked = offModuleOwning(pathname, all, off, portal)
  if (!blocked) return <>{banner}{children}</>
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <PowerOff size={24} aria-hidden="true" />
      </div>
      <h1 className="text-xl font-black">{t("module_off_title")}</h1>
      <p className="text-sm text-muted-foreground">{t("module_off_desc", { module: t(`module_name_${blocked.replace("-", "_")}`) })}</p>
      <Link href={`/${portal}`} className="text-sm font-semibold text-cta underline-offset-2 hover:underline">
        {t("module_off_home")}
      </Link>
    </div>
  )
}
