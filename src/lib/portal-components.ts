// Gmail-style "app switcher" — the contractor and supplier portals are each
// split into standalone components, mirrored 1:1 by business function so
// the same icon/color language means the same thing in both portals
// (Inventory/Finance/HR/CRM/Governance are identical concepts either way;
// only the "core work" and "RFQ-facing" components differ by role — Project
// Management/Procurement for a contractor buying materials, Order
// Management/Sales for a supplier fulfilling orders and responding to RFQs).
// No routes move — every page keeps its existing URL. Which component
// "owns" a page is purely a navigation/IA concept: this registry maps each
// component to the nav items it renders, and `resolveActiveContractorComponent`
// / `resolveActiveSupplierComponent` derive which component is active from
// the current pathname (mirroring the pathname-prefix role-detection
// already used in role-sidebar.tsx).
//
// Every nav item carries the permission that reveals it, so a team member
// only ever sees the modules and pages their group grants. The sidebar, the
// app switcher, the launcher page and the home tile grid all funnel through
// `visibleSections` / `visibleComponents` below. This is UI gating; real
// enforcement stays in firestore.rules.
//
// The admin portal is untouched — this registry only covers contractor/supplier.

import type { ElementType } from "react"
import {
  LayoutDashboard,
  SlidersHorizontal,
  FolderOpen,
  PlusCircle,
  FileText,
  FilePlus,
  ShoppingBasket,
  Users,
  PackageCheck,
  ShieldCheck,
  Briefcase,
  Receipt,
  Warehouse,
  Handshake,
  Wallet,
  Contact,
  UserCog,
  MessageSquare,
  MessagesSquare,
  Bell,
  ClipboardList,
  Search,
  History,
  Link2,
  Boxes,
  Building2,
  ScrollText,
  Target,
  Scissors,
  Factory,
  HandCoins,
  Banknote,
} from "lucide-react"
import type { PermissionId } from "@/lib/permissions"
import { CATALOG_COMING_SOON, RECEIPTS_COMING_SOON } from "@/lib/feature-flags"

export interface NavItem {
  titleKey: string
  href: string
  icon: ElementType
  children?: NavItem[]
  requiredPermission?: PermissionId
  /** Built but not released — the sidebar renders it dimmed and
   * non-interactive, and the route itself serves a "coming soon" placeholder.
   * Driven by a flag in `@/lib/feature-flags`, never hardcoded here, so one
   * switch covers the nav entry, the routes and the inbound links. */
  comingSoon?: boolean
}

export interface NavSection {
  labelKey: string
  items: NavItem[]
}

export type PortalComponentId =
  | "project-management"
  | "procurement"
  | "warehouses"
  | "payments"
  | "hr"
  | "crm"
  | "manufacturing"
  | "sales"
  | "users"

export type AccentToken = "primary" | "secondary" | "accent" | "success" | "cta" | "warning" | "destructive"

// Tailwind can't resolve dynamically-built class strings, so every
// accent-token combination used by a tile must appear as a literal here.
// Shared by the app-switcher dropdown and the home dashboard's tile grid.
export const COMPONENT_ACCENT_CLASSES: Record<AccentToken, { tile: string; ring: string }> = {
  primary: { tile: "bg-primary/10 text-primary", ring: "ring-primary" },
  secondary: { tile: "bg-secondary/10 text-secondary", ring: "ring-secondary" },
  accent: { tile: "bg-accent/10 text-accent", ring: "ring-accent" },
  success: { tile: "bg-success/10 text-success", ring: "ring-success" },
  cta: { tile: "bg-cta/10 text-cta", ring: "ring-cta" },
  warning: { tile: "bg-warning/10 text-warning", ring: "ring-warning" },
  destructive: { tile: "bg-destructive/10 text-destructive", ring: "ring-destructive" },
}

export interface PortalComponentDef {
  id: PortalComponentId
  labelKey: string
  descKey: string
  homeHref: string
  icon: ElementType
  accentToken: AccentToken
  // Presentation order in the switcher / launcher / tile grid. The array
  // order itself is resolution order and cannot be reshuffled — see
  // `resolveActiveComponent`.
  displayOrder: number
  sections: NavSection[]
}

// Always reachable regardless of the active component — appended to the
// bottom of every component's sidebar. Never permission-gated: everyone in
// an org can be talked to.
export const CONTRACTOR_COMMUNICATION_SECTION: NavSection = {
  labelKey: "section_communication",
  items: [
    { titleKey: "contractor_chats", href: "/contractor/chats", icon: MessageSquare },
    { titleKey: "contractor_team_chat", href: "/contractor/team-chat", icon: MessagesSquare },
    { titleKey: "contractor_notifications", href: "/contractor/notifications", icon: Bell },
  ],
}

// Order matters: `resolveActiveContractorComponent` checks every entry
// before "project-management", which is the catch-all default (its home is
// the bare `/contractor` root, a prefix every other component also sits
// under). Use `displayOrder` to change what the user sees.
export const CONTRACTOR_COMPONENTS: PortalComponentDef[] = [
  {
    id: "procurement",
    labelKey: "component_procurement",
    descKey: "component_procurement_desc",
    homeHref: "/contractor/rfqs",
    icon: Handshake,
    accentToken: "cta",
    displayOrder: 3,
    sections: [
      {
        labelKey: "component_procurement",
        items: [
          {
            titleKey: "contractor_rfqs",
            href: "/contractor/rfqs",
            icon: FileText,
            requiredPermission: "rfq.manage",
            children: [
              { titleKey: "contractor_new_rfq", href: "/contractor/rfqs/new", icon: FilePlus, requiredPermission: "rfq.create" },
            ],
          },
          { titleKey: "contractor_catalog", href: "/contractor/catalog", icon: ShoppingBasket, requiredPermission: "rfq.manage", comingSoon: CATALOG_COMING_SOON },
          { titleKey: "contractor_browse_suppliers", href: "/contractor/suppliers", icon: Users, requiredPermission: "suppliers.manage" },
          { titleKey: "contractor_goods_received", href: "/contractor/goods-received", icon: PackageCheck, requiredPermission: "deliveries.confirm" },
        ],
      },
    ],
  },
  {
    // Named "Inventory" (المخزون): stock is the subject, warehouses are one
    // view of it.
    //
    // The home used to be `/contractor/inventory` — a cross-warehouse "Stock
    // Overview" that was planned, listed both here and as a sidebar item, and
    // never actually built. Opening Inventory from the app switcher 404'd
    // because of it. Until that page exists the warehouse list is the home,
    // which is what the supplier side has always done.
    id: "warehouses",
    labelKey: "component_inventory",
    descKey: "component_inventory_desc",
    homeHref: "/contractor/warehouses",
    icon: Boxes,
    accentToken: "accent",
    displayOrder: 4,
    sections: [
      {
        labelKey: "component_inventory",
        items: [
          { titleKey: "contractor_warehouses", href: "/contractor/warehouses", icon: Warehouse, requiredPermission: "warehouses.manage" },
          { titleKey: "contractor_warehouse_requests", href: "/contractor/warehouses/requests", icon: ClipboardList, requiredPermission: "warehouses.manage" },
          { titleKey: "inventory_waste", href: "/contractor/warehouses/waste", icon: Scissors, requiredPermission: "warehouses.manage" },
        ],
      },
    ],
  },
  {
    // Renamed to "Finance" (المالية) — invoices and guarantees were only ever
    // part of it, and receipts had no home in the nav at all until now.
    id: "payments",
    labelKey: "component_finance",
    descKey: "component_finance_desc",
    homeHref: "/contractor/invoices",
    icon: Wallet,
    accentToken: "success",
    displayOrder: 5,
    sections: [
      {
        labelKey: "component_finance",
        items: [
          { titleKey: "contractor_invoices", href: "/contractor/invoices", icon: Receipt, requiredPermission: "invoices.manage" },
          { titleKey: "contractor_receipts", href: "/contractor/receipts", icon: ScrollText, requiredPermission: "invoices.manage", comingSoon: RECEIPTS_COMING_SOON },
          { titleKey: "contractor_guarantees", href: "/contractor/guarantees", icon: ShieldCheck, requiredPermission: "invoices.manage" },
        ],
      },
    ],
  },
  {
    id: "hr",
    labelKey: "component_hr",
    descKey: "component_hr_desc",
    homeHref: "/contractor/employees",
    icon: Briefcase,
    accentToken: "warning",
    displayOrder: 6,
    sections: [
      {
        labelKey: "component_hr",
        items: [
          { titleKey: "contractor_employees", href: "/contractor/employees", icon: Briefcase, requiredPermission: "employees.manage" },
        ],
      },
    ],
  },
  {
    id: "crm",
    labelKey: "component_crm",
    descKey: "component_crm_desc",
    homeHref: "/contractor/crm/dashboard",
    icon: Contact,
    accentToken: "destructive",
    displayOrder: 1,
    sections: [
      {
        labelKey: "component_crm",
        items: [
          { titleKey: "crm_nav_dashboard", href: "/contractor/crm/dashboard", icon: LayoutDashboard, requiredPermission: "crm.manage" },
          { titleKey: "crm_nav_leads", href: "/contractor/crm/leads", icon: Contact, requiredPermission: "crm.manage" },
          { titleKey: "crm_nav_opportunities", href: "/contractor/crm/opportunities", icon: Target, requiredPermission: "crm.manage" },
          { titleKey: "crm_nav_activities", href: "/contractor/crm/activities", icon: ClipboardList, requiredPermission: "crm.manage" },
          { titleKey: "crm_nav_settings", href: "/contractor/crm/settings", icon: SlidersHorizontal, requiredPermission: "crm.manage" },
        ],
      },
    ],
  },
  {
    id: "manufacturing",
    labelKey: "component_manufacturing",
    descKey: "component_manufacturing_desc",
    homeHref: "/contractor/manufacturing",
    icon: Factory,
    accentToken: "warning",
    displayOrder: 9,
    sections: [
      {
        labelKey: "component_manufacturing",
        // Ungated: stage assignees are plain members and must reach their tasks.
        items: [{ titleKey: "component_manufacturing", href: "/contractor/manufacturing", icon: Factory }],
      },
    ],
  },
  {
    // Sales (المبيعات) — a component of its own, NOT a Finance page: every
    // quotation the org writes (before manufacturing as an estimate, after it
    // as the price of a finished item) and the customer payments recorded
    // against them. Quotations stay in `crmQuotations`, so a CRM contact's
    // page and this module read the same records.
    id: "sales",
    labelKey: "component_sales",
    descKey: "component_sales_desc",
    homeHref: "/contractor/sales",
    icon: HandCoins,
    accentToken: "cta",
    displayOrder: 8,
    sections: [
      {
        labelKey: "component_sales",
        items: [
          { titleKey: "sales_nav_quotations", href: "/contractor/sales", icon: FileText, requiredPermission: "sales.manage" },
          { titleKey: "sales_nav_awaiting_payment", href: "/contractor/sales?tab=awaiting", icon: Banknote, requiredPermission: "sales.manage" },
        ],
      },
    ],
  },
  {
    // Renamed to "Settings & Governance" (الإعدادات والحوكمة): the company
    // record (CR + tax + legal documents) is governance data, so the profile
    // page moved in here from the Projects catch-all where it was orphaned.
    id: "users",
    labelKey: "component_governance",
    descKey: "component_governance_desc",
    homeHref: "/contractor/profile",
    icon: UserCog,
    accentToken: "secondary",
    displayOrder: 7,
    sections: [
      {
        labelKey: "component_governance",
        items: [
          {
            titleKey: "contractor_company_profile",
            href: "/contractor/profile",
            icon: Building2,
            requiredPermission: "team.manage",
            children: [
              { titleKey: "contractor_company_legal", href: "/contractor/profile?tab=legal", icon: ScrollText, requiredPermission: "team.manage" },
            ],
          },
          { titleKey: "contractor_team", href: "/contractor/team", icon: Users, requiredPermission: "team.manage" },
        ],
      },
    ],
  },
  {
    id: "project-management",
    labelKey: "component_project_management",
    descKey: "component_project_management_desc",
    homeHref: "/contractor/projects",
    icon: LayoutDashboard,
    accentToken: "primary",
    displayOrder: 2,
    sections: [
      {
        labelKey: "component_project_management",
        items: [
          { titleKey: "contractor_dashboard", href: "/contractor", icon: LayoutDashboard },
          {
            titleKey: "contractor_projects",
            href: "/contractor/projects",
            icon: FolderOpen,
            requiredPermission: "projects.view",
            children: [
              { titleKey: "contractor_new_project", href: "/contractor/projects/new", icon: PlusCircle, requiredPermission: "projects.edit" },
            ],
          },
        ],
      },
    ],
  },
]

// Always reachable regardless of the active component — appended to the
// bottom of every supplier component's sidebar.
export const SUPPLIER_COMMUNICATION_SECTION: NavSection = {
  labelKey: "section_communication",
  items: [
    { titleKey: "supplier_chats", href: "/supplier/chats", icon: MessageSquare },
    { titleKey: "supplier_team_chat", href: "/supplier/team-chat", icon: MessagesSquare },
    { titleKey: "supplier_notifications", href: "/supplier/notifications", icon: Bell },
  ],
}

// Same 7-slot shape as CONTRACTOR_COMPONENTS, same icon/accent per slot —
// Inventory/Finance/HR/CRM/Governance are identical concepts to the
// contractor side. "Order Management" mirrors Project Management (the
// supplier's core work: orders instead of projects); "Sales" mirrors
// Procurement (their RFQ-facing pipeline: browsing RFQs and tracking
// submitted offers, instead of sourcing materials). CRM's home is the
// existing Connections page — managing contractor relationships already IS a
// CRM, no stub needed here.
export const SUPPLIER_COMPONENTS: PortalComponentDef[] = [
  {
    id: "procurement",
    labelKey: "supplier_component_sales",
    descKey: "supplier_component_sales_desc",
    homeHref: "/supplier/rfqs",
    icon: Handshake,
    accentToken: "cta",
    displayOrder: 3,
    sections: [
      {
        labelKey: "supplier_component_sales",
        items: [
          { titleKey: "supplier_rfqs", href: "/supplier/rfqs", icon: Search, requiredPermission: "offers.view" },
          { titleKey: "supplier_offers", href: "/supplier/offers", icon: History, requiredPermission: "offers.view" },
        ],
      },
    ],
  },
  {
    id: "warehouses",
    labelKey: "component_inventory",
    descKey: "component_inventory_desc",
    homeHref: "/supplier/warehouses",
    icon: Boxes,
    accentToken: "accent",
    displayOrder: 4,
    sections: [
      {
        labelKey: "component_inventory",
        items: [
          { titleKey: "supplier_warehouses", href: "/supplier/warehouses", icon: Warehouse, requiredPermission: "warehouses.manage" },
          { titleKey: "inventory_waste", href: "/supplier/warehouses/waste", icon: Scissors, requiredPermission: "warehouses.manage" },
        ],
      },
    ],
  },
  {
    id: "payments",
    labelKey: "component_finance",
    descKey: "component_finance_desc",
    homeHref: "/supplier/invoices",
    icon: Wallet,
    accentToken: "success",
    displayOrder: 5,
    sections: [
      {
        labelKey: "component_finance",
        items: [
          { titleKey: "supplier_invoices", href: "/supplier/invoices", icon: Receipt, requiredPermission: "invoices.manage" },
          { titleKey: "supplier_guarantees", href: "/supplier/guarantees", icon: ShieldCheck, requiredPermission: "invoices.manage" },
        ],
      },
    ],
  },
  {
    id: "hr",
    labelKey: "component_hr",
    descKey: "component_hr_desc",
    homeHref: "/supplier/employees",
    icon: Briefcase,
    accentToken: "warning",
    displayOrder: 6,
    sections: [
      {
        labelKey: "component_hr",
        items: [
          { titleKey: "supplier_employees", href: "/supplier/employees", icon: Briefcase, requiredPermission: "employees.manage" },
        ],
      },
    ],
  },
  {
    id: "crm",
    labelKey: "component_crm",
    descKey: "supplier_component_crm_desc",
    homeHref: "/supplier/crm/dashboard",
    icon: Contact,
    accentToken: "destructive",
    displayOrder: 1,
    sections: [
      {
        labelKey: "component_crm",
        items: [
          { titleKey: "crm_nav_dashboard", href: "/supplier/crm/dashboard", icon: LayoutDashboard, requiredPermission: "crm.manage" },
          { titleKey: "crm_nav_leads", href: "/supplier/crm/leads", icon: Contact, requiredPermission: "crm.manage" },
          { titleKey: "crm_nav_opportunities", href: "/supplier/crm/opportunities", icon: Target, requiredPermission: "crm.manage" },
          { titleKey: "crm_nav_activities", href: "/supplier/crm/activities", icon: ClipboardList, requiredPermission: "crm.manage" },
          { titleKey: "crm_nav_settings", href: "/supplier/crm/settings", icon: SlidersHorizontal, requiredPermission: "crm.manage" },
          // Connections (incoming contractor link requests) is a relationship
          // inbox, so it belongs under CRM — it just is not one of the
          // pipeline pages.
          { titleKey: "supplier_connections", href: "/supplier/connections", icon: Link2, requiredPermission: "crm.manage" },
        ],
      },
    ],
  },
  {
    id: "manufacturing",
    labelKey: "component_manufacturing",
    descKey: "supplier_component_manufacturing_desc",
    homeHref: "/supplier/manufacturing",
    icon: Factory,
    accentToken: "warning",
    displayOrder: 8,
    sections: [
      {
        labelKey: "component_manufacturing",
        items: [{ titleKey: "component_manufacturing", href: "/supplier/manufacturing", icon: Factory }],
      },
    ],
  },
  {
    id: "users",
    labelKey: "component_governance",
    descKey: "component_governance_desc",
    homeHref: "/supplier/profile",
    icon: UserCog,
    accentToken: "secondary",
    displayOrder: 7,
    sections: [
      {
        labelKey: "component_governance",
        items: [
          {
            titleKey: "supplier_company_profile",
            href: "/supplier/profile",
            icon: Building2,
            requiredPermission: "team.manage",
            children: [
              { titleKey: "supplier_company_legal", href: "/supplier/profile?tab=legal", icon: ScrollText, requiredPermission: "team.manage" },
            ],
          },
          { titleKey: "supplier_team", href: "/supplier/team", icon: Users, requiredPermission: "team.manage" },
        ],
      },
    ],
  },
  {
    id: "project-management",
    labelKey: "supplier_component_order_management",
    descKey: "supplier_component_order_management_desc",
    homeHref: "/supplier",
    icon: LayoutDashboard,
    accentToken: "primary",
    displayOrder: 2,
    sections: [
      {
        labelKey: "supplier_component_order_management",
        items: [
          { titleKey: "supplier_dashboard", href: "/supplier", icon: LayoutDashboard },
          { titleKey: "supplier_orders", href: "/supplier/orders", icon: ClipboardList },
        ],
      },
    ],
  },
]

/** A nav href may carry a query string (`/contractor/profile?tab=legal`) to
 * deep-link a tab. Route matching only ever cares about the path. */
export function hrefPathname(href: string): string {
  const q = href.indexOf("?")
  return q === -1 ? href : href.slice(0, q)
}

/** Exact match or a "/"-bounded prefix — never a bare `startsWith`, so
 * `/contractor/team` doesn't false-match `/contractor/team-chat`. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/")
}

function componentOwnsPath(component: PortalComponentDef, pathname: string): boolean {
  return component.sections.some((section) =>
    section.items.some(
      (item) =>
        matchesPrefix(pathname, hrefPathname(item.href)) ||
        item.children?.some((c) => matchesPrefix(pathname, hrefPathname(c.href)))
    )
  )
}

/** Resolves which component's sidebar should render for the current
 * pathname within one portal's component set. Every non-"project-management"
 * component owns a disjoint route prefix, so they're checked first;
 * "project-management" (whose home is the bare portal root) is the
 * catch-all default every other prefix also sits under. */
function resolveActiveComponent(components: PortalComponentDef[], pathname: string): PortalComponentDef {
  const fallback = components.find((c) => c.id === "project-management")!
  for (const component of components) {
    if (component.id === "project-management") continue
    if (componentOwnsPath(component, pathname)) return component
  }
  return fallback
}

export function resolveActiveContractorComponent(pathname: string): PortalComponentDef {
  return resolveActiveComponent(CONTRACTOR_COMPONENTS, pathname)
}

export function resolveActiveSupplierComponent(pathname: string): PortalComponentDef {
  return resolveActiveComponent(SUPPLIER_COMPONENTS, pathname)
}

// ---------------------------------------------------------------------------
// Permission-aware views of the registry
// ---------------------------------------------------------------------------

export type PermissionCheck = (permission: PermissionId) => boolean

function itemIsVisible(item: NavItem, can: PermissionCheck): boolean {
  return !item.requiredPermission || can(item.requiredPermission)
}

/** One section's items, filtered to what the caller may see — children
 * included, so a parent never renders a child the member cannot open. */
export function visibleItems(items: NavItem[], can: PermissionCheck): NavItem[] {
  return items
    .filter((item) => itemIsVisible(item, can))
    .map((item) =>
      item.children ? { ...item, children: item.children.filter((c) => itemIsVisible(c, can)) } : item
    )
}

/** Sections with every hidden item stripped, and sections left empty by that
 * filtering dropped entirely — an empty group label is worse than no group. */
export function visibleSections(sections: NavSection[], can: PermissionCheck): NavSection[] {
  return sections
    .map((section) => ({ ...section, items: visibleItems(section.items, can) }))
    .filter((section) => section.items.length > 0)
}

/** A module is worth showing only if the member can open something inside it. */
export function isComponentVisible(component: PortalComponentDef, can: PermissionCheck): boolean {
  return component.sections.some((section) => visibleItems(section.items, can).length > 0)
}

/** The modules a member may see, in presentation order. Project Management
 * always survives (its dashboard item is ungated), so this can never return
 * an empty launcher. */
export function visibleComponents(
  components: PortalComponentDef[],
  can: PermissionCheck
): PortalComponentDef[] {
  return components
    .filter((component) => isComponentVisible(component, can))
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
}

// ---------------------------------------------------------------------------
// Breadcrumb trail
// ---------------------------------------------------------------------------

export interface NavCrumb {
  titleKey: string
  href: string
}

/**
 * The registry's path to `pathname`: the module that owns the route, then the
 * deepest nav item (with its parent, when the match is a child) whose href
 * prefixes it.
 *
 * Deliberately stops at the registry. A detail route like
 * `/contractor/projects/{id}` resolves to the Projects crumb and no further —
 * the registry has no name for a record, and a crumb reading "abc123" is worse
 * than no crumb at all. The page itself already shows the record's title.
 */
export function resolveNavTrail(
  components: PortalComponentDef[],
  pathname: string
): { component: PortalComponentDef; crumbs: NavCrumb[] } {
  const component = resolveActiveComponent(components, pathname)
  const crumbs: NavCrumb[] = []

  // Longest match wins: `/contractor/warehouses/requests` must resolve to the
  // Requests item, not to the Warehouses item it also sits under.
  let best: { item: NavItem; parent?: NavItem; length: number } | null = null
  const consider = (item: NavItem, parent?: NavItem) => {
    const path = hrefPathname(item.href)
    if (!matchesPrefix(pathname, path)) return
    if (!best || path.length > best.length) best = { item, parent, length: path.length }
  }
  for (const section of component.sections) {
    for (const item of section.items) {
      consider(item)
      item.children?.forEach((child) => consider(child, item))
    }
  }

  if (best) {
    const match = best as { item: NavItem; parent?: NavItem }
    if (match.parent) crumbs.push({ titleKey: match.parent.titleKey, href: match.parent.href })
    crumbs.push({ titleKey: match.item.titleKey, href: match.item.href })
  }

  return {
    component,
    crumbs: crumbs.filter((c) => {
      const path = hrefPathname(c.href)
      // The module's own home is rendered as the module crumb — don't say it twice.
      if (path === hrefPathname(component.homeHref)) return false
      // The portal root (`/contractor`, `/supplier`) prefixes every route in its
      // portal, so the dashboard item matches everything. The bar already opens
      // with that root, so as a crumb it is only ever a duplicate.
      return path.split("/").filter(Boolean).length > 1
    }),
  }
}
