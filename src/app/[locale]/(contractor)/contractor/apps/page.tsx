"use client"

import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Link, usePathname } from "@/i18n/routing"
import { LayoutGrid, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { CONTRACTOR_COMPONENTS, resolveActiveContractorComponent, type AccentToken } from "@/lib/portal-components"

const ACCENT_CLASSES: Record<AccentToken, { tile: string; ring: string }> = {
  primary: { tile: "bg-primary/10 text-primary", ring: "border-primary" },
  secondary: { tile: "bg-secondary/10 text-secondary", ring: "border-secondary" },
  accent: { tile: "bg-accent/10 text-accent", ring: "border-accent" },
  success: { tile: "bg-success/10 text-success", ring: "border-success" },
  cta: { tile: "bg-cta/10 text-cta", ring: "border-cta" },
  warning: { tile: "bg-warning/10 text-warning", ring: "border-warning" },
  destructive: { tile: "bg-destructive/10 text-destructive", ring: "border-destructive" },
}

// Full-page "app launcher" — the ERP-style browsable alternative to the
// quick-switch dropdown in the top bar. Same component registry, larger
// cards with a short description each.
export default function ContractorAppsPage() {
  const t = useTranslations("Portal.Contractor")
  const tSidebar = useTranslations("Portal.Sidebar")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const pathname = usePathname()
  const activeId = resolveActiveContractorComponent(pathname).id

  return (
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        <div>
          <h1 className="text-2xl font-black text-primary flex items-center gap-2">
            <LayoutGrid size={22} />
            {t("apps_page_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("apps_page_desc")}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {CONTRACTOR_COMPONENTS.map((component) => {
            const isActive = component.id === activeId
            const accent = ACCENT_CLASSES[component.accentToken]
            return (
              <Link
                key={component.id}
                href={component.homeHref}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex flex-col gap-3 p-5 rounded-2xl border bg-white hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive ? cn("border-2", accent.ring) : "border-slate-200 hover:border-primary/30"
                )}
              >
                <span className={cn("h-12 w-12 rounded-xl flex items-center justify-center", accent.tile)}>
                  <component.icon size={22} />
                </span>
                <div className="min-w-0">
                  <h3 className="font-bold text-foreground">{tSidebar(component.labelKey)}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tSidebar(component.descKey)}</p>
                </div>
                <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-primary sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  {t("apps_page_open")}
                  <ArrowRight size={12} className={cn(isRtl && "rtl-flip")} />
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </PortalLayout>
  )
}
