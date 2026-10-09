"use client"

// Wraps a portal page. If the company switched off the module the address belongs to, the page is
// replaced by a notice (menu and tiles already leave the module out); while the switches load, a page
// of an optional module waits instead of flashing. Everything else — and the admin portal — passes through.

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Loader2, PowerOff } from "lucide-react"
import { usePathname } from "next/navigation"
import { Link } from "@/i18n/routing"
import { useCompanyModules } from "@/hooks/useCompanyModules"
import { belongsToOptionalModule, offModuleOwning, type ModulePortal } from "@/lib/company-modules"
import { CONTRACTOR_COMPONENTS, SUPPLIER_COMPONENTS } from "@/lib/portal-components"

export function ModuleGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() || ""
  const portal: ModulePortal | null = pathname.startsWith("/contractor") ? "contractor" : pathname.startsWith("/supplier") ? "supplier" : null
  const { off, loading } = useCompanyModules(portal)
  const t = useTranslations("Portal.Shared")
  if (!portal) return <>{children}</>
  const all = portal === "supplier" ? SUPPLIER_COMPONENTS : CONTRACTOR_COMPONENTS
  if (loading) {
    return belongsToOptionalModule(pathname, all, portal) ? (
      <div className="flex h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} aria-hidden="true" />
      </div>
    ) : (
      <>{children}</>
    )
  }
  const blocked = offModuleOwning(pathname, all, off, portal)
  if (!blocked) return <>{children}</>
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
