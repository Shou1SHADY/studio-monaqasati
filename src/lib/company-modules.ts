// Component switches (7 Oct 2026): the platform admin can turn a company's optional components on
// and off. Only three are optional — Project Management, HR and Manufacturing; everything else is
// core and always on. A company with no switch document has all of them on, so nothing changes
// until someone turns one off.
//
// "Off" is a product switch, not a security boundary: the module's tile, menu entries and pages
// disappear for every member of the company (the pages show a notice if reached by address). The
// data rules still go by permission, and the mobile app is not switched by this.
//
// The supplier portal has no Project Management module — its "project-management" slot is the
// supplier's own dashboard — so a supplier has two switches, a contractor three. Pure: no I/O.

import { componentOwnsPath, hrefPathname, matchesPrefix, type PortalComponentDef } from "./portal-components"

export const COMPANY_MODULES = "companyModules"

export const OPTIONAL_MODULES = ["project-management", "hr", "manufacturing"] as const
export type OptionalModule = (typeof OPTIONAL_MODULES)[number]
export type ModulePortal = "contractor" | "supplier"

/** The switches a company of this portal has. */
export const optionalFor = (portal: ModulePortal): readonly OptionalModule[] => (portal === "supplier" ? ["hr", "manufacturing"] : OPTIONAL_MODULES)

export const isOptionalModule = (id: unknown): id is OptionalModule => typeof id === "string" && (OPTIONAL_MODULES as readonly string[]).includes(id)

/** What is switched off, from the stored document: only this portal's optional ids, whatever else is in the data. */
export function offSet(data: { off?: unknown } | null | undefined, portal: ModulePortal | null): ReadonlySet<OptionalModule> {
  if (!portal || !data || !Array.isArray(data.off)) return new Set()
  const allowed = optionalFor(portal)
  return new Set(data.off.filter((id): id is OptionalModule => isOptionalModule(id) && allowed.includes(id)))
}

/**
 * Pages that live inside ANOTHER component's menu but only exist to serve one optional module: Inventory's
 * workshop desk, delivery notes, equipment desk and project returns; Finance's projects and HR desks; the
 * leaver custody desk. They go with their module — out of the menu, and a notice at their address.
 */
export const SATELLITE_PAGES: Record<OptionalModule, (portal: ModulePortal) => readonly string[]> = {
  "project-management": (portal) => (portal === "contractor" ? ["/contractor/warehouses/equipment", "/contractor/warehouses/project-returns", "/contractor/accounting/projects-desk"] : []),
  hr: (portal) => [`/${portal}/accounting/hr-desk`, `/${portal}/warehouses/custody`],
  manufacturing: (portal) => [`/${portal}/warehouses/manufacturing`, `/${portal}/warehouses/delivery-notes`],
}

const satellitesOf = (ids: Iterable<string>, portal: ModulePortal): string[] => [...ids].filter(isOptionalModule).flatMap((id) => [...SATELLITE_PAGES[id](portal)])

const portalRoot = (portal: ModulePortal) => `/${portal}`

/** The registry as this company sees it. HR and Manufacturing leave it; Project Management keeps only the portal's
 * dashboard (it hosts the home) and stops being a tile. */
export function applyModuleSwitches(components: PortalComponentDef[], off: ReadonlySet<string>, portal: ModulePortal): PortalComponentDef[] {
  if (off.size === 0) return components
  const allowed = optionalFor(portal)
  const root = portalRoot(portal)
  const gone = satellitesOf(off, portal)
  const without = (c: PortalComponentDef): PortalComponentDef =>
    gone.length === 0
      ? c
      : {
          ...c,
          sections: c.sections
            .map((sec) => ({
              ...sec,
              items: sec.items
                .filter((i) => !gone.includes(hrefPathname(i.href)))
                .map((i) => (i.children ? { ...i, children: i.children.filter((ch) => !gone.includes(hrefPathname(ch.href))) } : i)),
            }))
            .filter((sec) => sec.items.length > 0),
        }
  const out: PortalComponentDef[] = []
  for (const c of components) {
    if (!off.has(c.id) || !(allowed as readonly string[]).includes(c.id)) {
      out.push(without(c))
    } else if (c.id === "project-management") {
      out.push({
        ...c,
        launcher: false,
        homeHref: root,
        sections: c.sections.map((s) => ({ ...s, items: s.items.filter((i) => hrefPathname(i.href) === root) })).filter((s) => s.items.length > 0),
      })
    }
  }
  return out
}

/** Which switched-off module a page belongs to, if any. `components` is the FULL registry of the portal. */
export function offModuleOwning(pathname: string, components: PortalComponentDef[], off: ReadonlySet<string>, portal: ModulePortal): OptionalModule | null {
  if (off.size === 0) return null
  const root = portalRoot(portal)
  for (const id of optionalFor(portal)) {
    if (!off.has(id)) continue
    if (SATELLITE_PAGES[id](portal).some((h) => matchesPrefix(pathname, h))) return id
    const c = components.find((x) => x.id === id)
    if (!c) continue
    if (id === "project-management") {
      // The dashboard (the portal root) is not the module's; its projects, handovers and decisions are.
      const own = c.sections.some((s) =>
        s.items.some((i) => (hrefPathname(i.href) !== root && matchesPrefix(pathname, hrefPathname(i.href))) || i.children?.some((ch) => matchesPrefix(pathname, hrefPathname(ch.href))))
      )
      if (own) return id
    } else if (componentOwnsPath(c, pathname)) {
      return id
    }
  }
  return null
}

/** Whether an address belongs to ANY optional module — while the switches load, such a page waits instead of flashing. */
export function belongsToOptionalModule(pathname: string, components: PortalComponentDef[], portal: ModulePortal): boolean {
  return offModuleOwning(pathname, components, new Set(optionalFor(portal)), portal) !== null
}

/** Which switched-off module an address (or a link with a query string) belongs to — the one check every link, bell entry and queue item asks. */
export function moduleOffFor(href: string | null | undefined, components: PortalComponentDef[], off: ReadonlySet<string>, portal: ModulePortal | null): OptionalModule | null {
  if (!href || !portal || off.size === 0) return null
  const path = hrefPathname(href)
  return path.startsWith("/") ? offModuleOwning(path, components, off, portal) : null
}
