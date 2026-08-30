"use client"

import { ChevronLeft, ChevronRight, Home } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link, usePathname } from "@/i18n/routing"

import { cn } from "@/lib/utils"
import { usePermissions } from "@/hooks/usePermissions"
import {
  CONTRACTOR_COMPONENTS,
  SUPPLIER_COMPONENTS,
  hrefPathname,
  isComponentVisible,
  resolveNavTrail,
  visibleItems,
  type NavCrumb,
  type PortalComponentDef,
} from "@/lib/portal-components"

/**
 * Breadcrumb bar for the contractor and supplier portals.
 *
 * Until this existed the sidebar's dashboard link was the only way out of a
 * section: opening a tender from a project, or a lead from CRM, left no
 * upward path short of the browser's own back button. Every crumb here is a
 * real link, and the first one is an explicit "back" to the parent — so the
 * way out is visible on the page rather than only in the chrome.
 *
 * The trail comes from the nav registry (see `resolveNavTrail`), which means
 * it can never drift from the sidebar, and it stops at the deepest *named*
 * route: on `/contractor/projects/{id}` the last crumb is Projects, and the
 * project's own name is left to the page heading below.
 *
 * Renders nothing on a portal root (nowhere to go back to) or in the admin
 * portal, whose nav lives outside this registry.
 */
export function PortalBreadcrumbs() {
  const pathname = usePathname()
  const t = useTranslations("Portal.Sidebar")
  const tShared = useTranslations("Portal.Shared")
  const { can } = usePermissions()

  const portal: { components: PortalComponentDef[]; root: string; rootKey: string } | null =
    pathname.startsWith("/contractor")
      ? { components: CONTRACTOR_COMPONENTS, root: "/contractor", rootKey: "contractor_dashboard" }
      : pathname.startsWith("/supplier")
        ? { components: SUPPLIER_COMPONENTS, root: "/supplier", rootKey: "supplier_dashboard" }
        : null

  if (!portal || pathname === portal.root) return null

  const { component, crumbs } = resolveNavTrail(portal.components, pathname)

  // A crumb the member cannot open would be a dead end, so gate on the same
  // permission check the sidebar uses and drop anything they may not see.
  const openable = (crumb: NavCrumb) => {
    for (const section of component.sections) {
      for (const item of section.items) {
        const pool = [item, ...(item.children || [])]
        const found = pool.find((i) => i.titleKey === crumb.titleKey)
        if (found) return !found.comingSoon && visibleItems([found], can).length > 0
      }
    }
    return false
  }
  const visibleCrumbs = crumbs.filter(openable)

  // The module crumb is a link like any other: if this member cannot open
  // anything inside the module, linking to its home is a dead end.
  const showModuleCrumb =
    hrefPathname(component.homeHref) !== portal.root && isComponentVisible(component, can)

  const trail: NavCrumb[] = [
    { titleKey: portal.rootKey, href: portal.root },
    ...(showModuleCrumb ? [{ titleKey: component.labelKey, href: component.homeHref }] : []),
    ...visibleCrumbs,
  ]

  // Where "back" goes: the crumb above the current page. On a named route
  // that is the parent crumb; on a detail route (`…/projects/{id}`) the last
  // crumb IS the parent, so it is the target rather than a duplicate.
  const isOnLastCrumb = trail.length > 1 && hrefPathname(trail[trail.length - 1].href) === pathname
  const backTo = isOnLastCrumb ? trail[trail.length - 2] : trail[trail.length - 1]

  return (
    <nav aria-label={tShared("breadcrumb_label")} className="mb-4 flex items-center gap-3 flex-wrap">
      <Link
        href={backTo.href}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <ChevronLeft size={14} className="rtl-flip" />
        {tShared("breadcrumb_back_to", { name: t(backTo.titleKey) })}
      </Link>

      <ol className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground min-w-0">
        {trail.map((crumb, i) => {
          const isLast = i === trail.length - 1
          const isCurrent = isLast && isOnLastCrumb
          return (
            <li key={`${crumb.titleKey}-${i}`} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <ChevronRight size={12} className="rtl-flip shrink-0 opacity-40" aria-hidden="true" />}
              {isCurrent ? (
                <span aria-current="page" className="font-semibold text-foreground truncate">
                  {t(crumb.titleKey)}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className={cn(
                    "truncate hover:text-foreground transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isLast && "font-semibold text-foreground"
                  )}
                >
                  {i === 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <Home size={12} aria-hidden="true" />
                      {t(crumb.titleKey)}
                    </span>
                  ) : (
                    t(crumb.titleKey)
                  )}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
