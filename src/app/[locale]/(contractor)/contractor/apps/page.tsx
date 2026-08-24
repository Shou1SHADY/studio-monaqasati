"use client"

import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Link } from "@/i18n/routing"
import { LayoutGrid, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { CONTRACTOR_COMPONENTS, visibleComponents, type AccentToken } from "@/lib/portal-components"
import { usePermissions } from "@/hooks/usePermissions"

const ACCENT_CLASSES: Record<AccentToken, { tile: string }> = {
  primary: { tile: "bg-primary/10 text-primary" },
  secondary: { tile: "bg-secondary/10 text-secondary" },
  accent: { tile: "bg-accent/10 text-accent" },
  success: { tile: "bg-success/10 text-success" },
  cta: { tile: "bg-cta/10 text-cta" },
  warning: { tile: "bg-warning/10 text-warning" },
  destructive: { tile: "bg-destructive/10 text-destructive" },
}

// Full-page "app launcher" — the ERP-style browsable alternative to the
// quick-switch dropdown in the top bar. Same component registry, larger
// cards with a short description each.
export default function ContractorAppsPage() {
  const t = useTranslations("Portal.Contractor")
  const tSidebar = useTranslations("Portal.Sidebar")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const { can } = usePermissions()
  // The launcher lists what this member can actually open, nothing more.
  const components = visibleComponents(CONTRACTOR_COMPONENTS, can)

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
          {/* No "active" marker here: this launcher page isn't inside any
              component, so the resolver could only ever mark the fallback —
              a permanently-wrong "you are here" signal. */}
          {components.map((component) => {
            const accent = ACCENT_CLASSES[component.accentToken]
            return (
              <Link
                key={component.id}
                href={component.homeHref}
                className="group flex flex-col gap-3 p-5 rounded-2xl border border-slate-200 bg-white hover:shadow-md hover:border-primary/30 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
