// Component switches (7 Oct 2026): the platform admin can turn a company's optional components on
// and off. A company with no switch document has all of them on, so nothing changes until someone turns
// one off.
//
// "Off" is a product switch, not a security boundary: the module's tile, menu entries and pages
// disappear for every member of the company (the pages show a notice if reached by address). The
// data rules still go by permission, and the mobile app is not switched by this.
//
// A contractor has four switches — Project Management, HR, Manufacturing and Finance (18 Oct 2026). A supplier has five
// (11 Oct 2026): most suppliers only want to SELL, so CRM, Inventory and Finance can go too, leaving
// Order Management, Sales and Governance — the "sales-only" preset. The supplier portal has no Project
// Management module (its "project-management" slot is Order Management), and Sales lives in its
// "procurement" slot, so neither is switchable. Pure: no I/O.

import {
  SUPPLIER_COMMUNICATION_SECTION,
  SUPPLIER_COMPONENTS,
  componentOwnsPath,
  hrefPathname,
  matchesPrefix,
  type NavItem,
  type NavSection,
  type PortalComponentDef,
  type PortalComponentId,
} from "./portal-components"
import type { SupplierPlan } from "./supplier-plan"

export const COMPANY_MODULES = "companyModules"

export const OPTIONAL_MODULES = ["project-management", "hr", "manufacturing", "crm", "warehouses", "payments"] as const
export type OptionalModule = (typeof OPTIONAL_MODULES)[number]
export type ModulePortal = "contractor" | "supplier"

const CONTRACTOR_SWITCHES: readonly OptionalModule[] = ["project-management", "payments", "hr", "manufacturing"]
const SUPPLIER_SWITCHES: readonly OptionalModule[] = ["crm", "warehouses", "payments", "hr", "manufacturing"]

/** The portal an address belongs to — with or without its locale prefix (`/en/contractor/…` is the contractor's).
 * Before 20 Oct 2026 the English addresses read as no portal, so every module counted as on in English. */
export const pathWithoutLocale = (pathname: string | null | undefined): string => (pathname || "").replace(/^\/(ar|en)(?=\/|$)/, "") || "/"

export function portalOfPath(pathname: string | null | undefined): ModulePortal | null {
  const path = pathWithoutLocale(pathname)
  return path.startsWith("/contractor") ? "contractor" : path.startsWith("/supplier") ? "supplier" : null
}

/** The switches a company of this portal has. */
export const optionalFor = (portal: ModulePortal): readonly OptionalModule[] => (portal === "supplier" ? SUPPLIER_SWITCHES : CONTRACTOR_SWITCHES)

/** A supplier that only sells: Order Management, Sales and Governance stay; everything else is off. */
export const SALES_ONLY_OFF: readonly OptionalModule[] = SUPPLIER_SWITCHES

/**
 * What a module cannot work without. HR pays through Finance's HR desk and clears a leaver's custody in Inventory;
 * Manufacturing draws its materials and hands its products over through Inventory. So switching the needed one off
 * switches these off with it — the dialog shows it, and a stored list is read the same way.
 */
export const MODULE_NEEDS: Partial<Record<OptionalModule, readonly OptionalModule[]>> = {
  hr: ["payments", "warehouses"],
  manufacturing: ["warehouses"],
}

/** The off list with every module that needs an off one added, within this portal's switches. */
export function withDependents(off: Iterable<OptionalModule>, portal: ModulePortal): Set<OptionalModule> {
  const allowed = optionalFor(portal)
  const out = new Set([...off].filter((id) => allowed.includes(id)))
  for (const id of allowed) {
    if ((MODULE_NEEDS[id] || []).some((need) => allowed.includes(need) && out.has(need))) out.add(id)
  }
  return out
}

/** Which off module forces this one off, if any (to say why its switch is locked). */
export function forcedOffBy(id: OptionalModule, off: ReadonlySet<OptionalModule>, portal: ModulePortal): OptionalModule | null {
  const allowed = optionalFor(portal)
  return (MODULE_NEEDS[id] || []).find((need) => allowed.includes(need) && off.has(need)) ?? null
}

export const isOptionalModule = (id: unknown): id is OptionalModule => typeof id === "string" && (OPTIONAL_MODULES as readonly string[]).includes(id)

/** What is switched off, from the stored document: only this portal's optional ids, whatever else is in the data. */
export function offSet(data: { off?: unknown } | null | undefined, portal: ModulePortal | null): ReadonlySet<OptionalModule> {
  if (!portal || !data || !Array.isArray(data.off)) return new Set()
  const allowed = optionalFor(portal)
  return withDependents(data.off.filter((id): id is OptionalModule => isOptionalModule(id) && allowed.includes(id)), portal)
}

/**
 * Pages that live inside ANOTHER component's menu but only exist to serve one optional module: Inventory's
 * workshop desk, delivery notes, equipment desk and project returns; Finance's projects and HR desks; the
 * leaver custody desk. They go with their module — out of the menu, and a notice at their address.
 */
export const SATELLITE_PAGES: Record<OptionalModule, (portal: ModulePortal) => readonly string[]> = {
  "project-management": (portal) => (portal === "contractor" ? ["/contractor/warehouses/equipment", "/contractor/warehouses/project-returns", "/contractor/accounting/projects-desk"] : []),
  hr: (portal) => [`/${portal}/accounting/hr-desk`, `/${portal}/warehouses/custody`],
  // Delivery notes stay with Inventory: the same page authorises SALES' customer deliveries (it only hides the
  // workshop's notes when Manufacturing is off).
  manufacturing: (portal) => [`/${portal}/warehouses/manufacturing`],
  // CRM, Inventory and Finance own their pages outright — nothing of theirs lives in another module's menu.
  crm: () => [],
  warehouses: () => [],
  payments: () => [],
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

/**
 * Pages that sit under one module's menu but belong to everyone who opens them, so no switch ever blocks them: the
 * printable delivery receipt, reached from Procurement's Goods Received and the RFQ offers view though its address is
 * Finance's `/contractor/receipts` (only the register at that address is Finance's).
 */
const SHARED_PAGES: readonly RegExp[] = [/^\/contractor\/receipts\/[^/]+/]

/** Which switched-off module a page belongs to, if any. `components` is the FULL registry of the portal. */
export function offModuleOwning(pathname: string, components: PortalComponentDef[], off: ReadonlySet<string>, portal: ModulePortal): OptionalModule | null {
  if (off.size === 0) return null
  if (SHARED_PAGES.some((re) => re.test(pathname))) return null
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

// ---------------------------------------------------------------------------
// The supplier's plan (Supplier 1.0 inside the unified portal — the owner's decision of 15 Oct 2026)
// ---------------------------------------------------------------------------
//
// A free supplier works in the same frame and lands on the same home as a contractor or a subscribed supplier: the
// registry is what the plan changes. Sales keeps the two quote screens, Order Management the home, the orders, the
// invoices and transfers (a free supplier has no Finance — an order's money is part of the order) and the contractors,
// Governance the company account (one user, no team). The modules of the subscription stay on the home and in the app
// switcher as locked tiles that say what it adds (SUB-02); their pages are not his (`freePathAllowed`). Every place —
// the sidebar, the active module and its colour, the breadcrumbs, the app switcher, the home — reads this one registry.

/** The free journey's pages by the module that hosts them, under the PRD's names (B-06). */
export const FREE_SUPPLIER_NAV: Partial<Record<PortalComponentId, ReadonlyArray<readonly [href: string, titleKey: string]>>> = {
  procurement: [
    ["/supplier/rfqs", "free_nav_rfqs"],
    ["/supplier/offers", "free_nav_offers"],
  ],
  "project-management": [
    ["/supplier", "supplier_dashboard"],
    ["/supplier/orders", "free_nav_orders"],
    ["/supplier/invoices", "free_nav_invoices"],
    ["/supplier/connections", "free_nav_connections"],
  ],
  users: [["/supplier/profile", "free_nav_account"]],
}

/** The icon the full registry already gives an address, so a page looks the same on both plans. */
function iconOf(components: PortalComponentDef[], href: string, fallback: NavItem["icon"]): NavItem["icon"] {
  for (const c of components)
    for (const s of c.sections)
      for (const i of s.items) {
        if (i.href === href) return i.icon
        const child = i.children?.find((ch) => ch.href === href)
        if (child) return child.icon
      }
  return fallback
}

/** The supplier registry for a plan. "full" is the registry untouched (the same array); "free" keeps the free journey's
 * pages, ungated (the free account is its company's only user, the owner), and locks every other module. Pure. */
export function applySupplierPlan(components: PortalComponentDef[], plan: SupplierPlan): PortalComponentDef[] {
  if (plan === "full") return components
  return components.map((c): PortalComponentDef => {
    const nav = FREE_SUPPLIER_NAV[c.id]
    if (!nav) return { ...c, sections: [], planLocked: true }
    return { ...c, sections: [{ labelKey: c.labelKey, items: nav.map(([href, titleKey]) => ({ titleKey, href, icon: iconOf(components, href, c.icon) })) }] }
  })
}

let freeRegistry: PortalComponentDef[] | null = null

/** The whole supplier registry as a company on this plan sees it, before any module switch. */
export function supplierRegistry(plan: SupplierPlan): PortalComponentDef[] {
  if (plan === "full") return SUPPLIER_COMPONENTS
  if (!freeRegistry) freeRegistry = applySupplierPlan(SUPPLIER_COMPONENTS, "free")
  return freeRegistry
}

const FREE_COMMUNICATION_SECTION: NavSection = {
  labelKey: SUPPLIER_COMMUNICATION_SECTION.labelKey,
  // No team chat: a free account is one person.
  items: SUPPLIER_COMMUNICATION_SECTION.items
    .filter((i) => i.href !== "/supplier/team-chat")
    .map((i) => (i.href === "/supplier/chats" ? { ...i, titleKey: "free_nav_messages" } : i)),
}

/** The communication section under every supplier sidebar, for the plan. */
export const supplierCommunicationSection = (plan: SupplierPlan): NavSection => (plan === "free" ? FREE_COMMUNICATION_SECTION : SUPPLIER_COMMUNICATION_SECTION)
