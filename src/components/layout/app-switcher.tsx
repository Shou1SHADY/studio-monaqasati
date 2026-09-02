"use client"

import { useLocale, useTranslations } from "next-intl"
import { Link, usePathname } from "@/i18n/routing"
import { LayoutGrid, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  CONTRACTOR_COMPONENTS,
  SUPPLIER_COMPONENTS,
  resolveActiveContractorComponent,
  resolveActiveSupplierComponent,
  COMPONENT_ACCENT_CLASSES,
  visibleComponents,
} from "@/lib/portal-components"
import { usePermissions } from "@/hooks/usePermissions"

/** Gmail-style waffle-menu trigger — quick-switch between a portal's
 * standalone components. Contractor and supplier only: renders nothing on
 * the admin portal. */
export function AppSwitcher() {
  const t = useTranslations("Portal.Layout")
  const tSidebar = useTranslations("Portal.Sidebar")
  const locale = useLocale()
  const pathname = usePathname()
  const { can } = usePermissions()
  
  const isContractor = pathname.startsWith("/contractor")
  const isSupplier = pathname.startsWith("/supplier")
  if (!isContractor && !isSupplier) return null

  // Only the modules this member is allowed into — a tile they cannot open
  // is a dead end, not a discovery hint.
  const components = visibleComponents(isContractor ? CONTRACTOR_COMPONENTS : SUPPLIER_COMPONENTS, can)
  const activeId = (isContractor ? resolveActiveContractorComponent(pathname) : resolveActiveSupplierComponent(pathname)).id
  // "See all components" lands wherever every component is actually laid out.
  // For a contractor that is the portal home itself — its welcome screen IS the
  // full tile grid (see the contractor dashboard, and the sidebar it suppresses
  // for exactly that reason), so sending them to the separate launcher page was
  // a detour to a second, near-identical grid. The supplier home is an RFQ
  // dashboard, not a launcher, so that side still needs /supplier/apps.
  const appsHref = isContractor ? "/contractor" : "/supplier/apps"

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
        {/* Tiles are real menu items (asChild links): Radix then closes the
            menu on click — a plain <Link> left the dropdown hanging open over
            the new page, which read as the navigation not working at all. */}
        <div className="grid grid-cols-3 gap-2">
          {components.map((component) => {
            const isActive = component.id === activeId
            const accent = COMPONENT_ACCENT_CLASSES[component.accentToken]
            return (
              <DropdownMenuItem key={component.id} asChild className="p-0 gap-1.5 rounded-xl focus:bg-muted [&_svg]:size-[18px]">
                <Link
                  href={component.homeHref}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-2.5 rounded-xl text-center transition-colors hover:bg-muted cursor-pointer",
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
              </DropdownMenuItem>
            )
          })}
        </div>
        <DropdownMenuItem asChild className="p-0 gap-1.5 mt-2 rounded-b-md focus:bg-muted [&_svg]:size-3">
          <Link
            href={appsHref}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-primary hover:underline py-2 border-t border-border cursor-pointer"
          >
            {t("app_switcher_see_all")}
            <ArrowRight size={12} className={cn(locale === "ar" && "rtl-flip")} />
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
