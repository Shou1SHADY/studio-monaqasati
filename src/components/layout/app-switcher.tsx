"use client"

import { useLocale, useTranslations } from "next-intl"
import { Link, usePathname } from "@/i18n/routing"
import { LayoutGrid, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  CONTRACTOR_COMPONENTS,
  SUPPLIER_COMPONENTS,
  resolveActiveContractorComponent,
  resolveActiveSupplierComponent,
  COMPONENT_ACCENT_CLASSES,
} from "@/lib/portal-components"

/** Gmail-style waffle-menu trigger — quick-switch between a portal's
 * standalone components. Contractor and supplier only: renders nothing on
 * the admin portal. */
export function AppSwitcher() {
  const t = useTranslations("Portal.Layout")
  const tSidebar = useTranslations("Portal.Sidebar")
  const locale = useLocale()
  const pathname = usePathname()

  const isContractor = pathname.startsWith("/contractor")
  const isSupplier = pathname.startsWith("/supplier")
  if (!isContractor && !isSupplier) return null

  const components = isContractor ? CONTRACTOR_COMPONENTS : SUPPLIER_COMPONENTS
  const activeId = (isContractor ? resolveActiveContractorComponent(pathname) : resolveActiveSupplierComponent(pathname)).id
  const appsHref = isContractor ? "/contractor/apps" : "/supplier/apps"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={t("app_switcher_label")}
          title={t("app_switcher_label")}
        >
          <LayoutGrid size={20} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={locale === "ar" ? "start" : "end"} className="w-72 p-3" dir={locale === "ar" ? "rtl" : "ltr"}>
        <div className="grid grid-cols-3 gap-2">
          {components.map((component) => {
            const isActive = component.id === activeId
            const accent = COMPONENT_ACCENT_CLASSES[component.accentToken]
            return (
              <Link
                key={component.id}
                href={component.homeHref}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-2.5 rounded-xl text-center transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive && cn("ring-2 bg-muted/60", accent.ring)
                )}
              >
                <span className={cn("h-10 w-10 rounded-xl flex items-center justify-center", accent.tile)}>
                  <component.icon size={18} />
                </span>
                <span className="text-[11px] font-semibold text-foreground leading-tight line-clamp-2">
                  {tSidebar(component.labelKey)}
                </span>
              </Link>
            )
          })}
        </div>
        <Link
          href={appsHref}
          className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-primary hover:underline py-2 border-t border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-b-md"
        >
          {t("app_switcher_see_all")}
          <ArrowRight size={12} className={cn(locale === "ar" && "rtl-flip")} />
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
