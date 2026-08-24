// Gmail-style "app switcher" — the contractor and supplier portals are each
// split into standalone components, mirrored 1:1 by business function so
// the same icon/color language means the same thing in both portals
// (Warehouses/Payments/HR/CRM/Users are identical concepts either way; only
// the "core work" and "RFQ-facing" components differ by role — Project
// Management/Procurement for a contractor buying materials, Order
// Management/Sales for a supplier fulfilling orders and responding to RFQs).
// No routes move — every page keeps its existing URL. Which component
// "owns" a page is purely a navigation/IA concept: this registry maps each
// component to the nav items it renders, and `resolveActiveContractorComponent`
// / `resolveActiveSupplierComponent` derive which component is active from
// the current pathname (mirroring the pathname-prefix role-detection
// already used in role-sidebar.tsx).
//
// The admin portal is untouched — this registry only covers contractor/supplier.

import type { ElementType } from "react"
import {
  LayoutDashboard,
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
} from "lucide-react"
import type { PermissionId } from "@/lib/permissions"

export interface NavItem {
  titleKey: string
  href: string
  icon: ElementType
  children?: NavItem[]
  requiredPermission?: PermissionId
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
  sections: NavSection[]
}

// Always reachable regardless of the active component — appended to the
// bottom of every component's sidebar.
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
// under).
export const CONTRACTOR_COMPONENTS: PortalComponentDef[] = [
  {
    id: "procurement",
    labelKey: "component_procurement",
    descKey: "component_procurement_desc",
    homeHref: "/contractor/rfqs",
    icon: Handshake,
    accentToken: "cta",
    sections: [
      {
        labelKey: "component_procurement",
        items: [
          {
            titleKey: "contractor_rfqs",
            href: "/contractor/rfqs",
            icon: FileText,
            children: [
              { titleKey: "contractor_new_rfq", href: "/contractor/rfqs/new", icon: FilePlus, requiredPermission: "rfq.create" },
            ],
          },
          { titleKey: "contractor_catalog", href: "/contractor/catalog", icon: ShoppingBasket },
          { titleKey: "contractor_browse_suppliers", href: "/contractor/suppliers", icon: Users },
          { titleKey: "contractor_goods_received", href: "/contractor/goods-received", icon: PackageCheck },
        ],
      },
    ],
  },
  {
    id: "warehouses",
    labelKey: "component_warehouses",
    descKey: "component_warehouses_desc",
    homeHref: "/contractor/warehouses",
    icon: Warehouse,
    accentToken: "accent",
    sections: [
      {
        labelKey: "component_warehouses",
        items: [
          { titleKey: "contractor_warehouses", href: "/contractor/warehouses", icon: Warehouse },
          { titleKey: "contractor_warehouse_requests", href: "/contractor/warehouses/requests", icon: ClipboardList },
        ],
      },
    ],
  },
  {
    id: "payments",
    labelKey: "component_payments",
    descKey: "component_payments_desc",
    homeHref: "/contractor/invoices",
    icon: Wallet,
    accentToken: "success",
    sections: [
      {
        labelKey: "component_payments",
        items: [
          { titleKey: "contractor_invoices", href: "/contractor/invoices", icon: Receipt },
          { titleKey: "contractor_guarantees", href: "/contractor/guarantees", icon: ShieldCheck },
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
    sections: [
      {
        labelKey: "component_hr",
        items: [
          { titleKey: "contractor_employees", href: "/contractor/employees", icon: Briefcase },
        ],
      },
    ],
  },
  {
    id: "crm",
    labelKey: "component_crm",
    descKey: "component_crm_desc",
    homeHref: "/contractor/crm",
    icon: Contact,
    accentToken: "destructive",
    sections: [
      {
        labelKey: "component_crm",
        items: [
          { titleKey: "component_crm", href: "/contractor/crm", icon: Contact },
        ],
      },
    ],
  },
  {
    id: "users",
    labelKey: "component_users",
    descKey: "component_users_desc",
    homeHref: "/contractor/team",
    icon: UserCog,
    accentToken: "secondary",
    sections: [
      {
        labelKey: "component_users",
        items: [
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
    sections: [
      {
        labelKey: "component_project_management",
        items: [
          { titleKey: "contractor_dashboard", href: "/contractor", icon: LayoutDashboard },
          {
            titleKey: "contractor_projects",
            href: "/contractor/projects",
            icon: FolderOpen,
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
// Warehouses/Payments/HR/CRM/Users are identical concepts to the contractor
// side. "Order Management" mirrors Project Management (the supplier's core
// work: orders instead of projects); "Sales" mirrors Procurement (their
// RFQ-facing pipeline: browsing RFQs and tracking submitted offers, instead
// of sourcing materials). CRM's home is the existing Connections page —
// managing contractor relationships already IS a CRM, no stub needed here.
export const SUPPLIER_COMPONENTS: PortalComponentDef[] = [
  {
    id: "procurement",
    labelKey: "supplier_component_sales",
    descKey: "supplier_component_sales_desc",
    homeHref: "/supplier/rfqs",
    icon: Handshake,
    accentToken: "cta",
    sections: [
      {
        labelKey: "supplier_component_sales",
        items: [
          { titleKey: "supplier_rfqs", href: "/supplier/rfqs", icon: Search },
          { titleKey: "supplier_offers", href: "/supplier/offers", icon: History },
        ],
      },
    ],
  },
  {
    id: "warehouses",
    labelKey: "component_warehouses",
    descKey: "component_warehouses_desc",
    homeHref: "/supplier/warehouses",
    icon: Warehouse,
    accentToken: "accent",
    sections: [
      {
        labelKey: "component_warehouses",
        items: [
          { titleKey: "supplier_warehouses", href: "/supplier/warehouses", icon: Warehouse },
        ],
      },
    ],
  },
  {
    id: "payments",
    labelKey: "component_payments",
    descKey: "component_payments_desc",
    homeHref: "/supplier/invoices",
    icon: Wallet,
    accentToken: "success",
    sections: [
      {
        labelKey: "component_payments",
        items: [
          { titleKey: "supplier_invoices", href: "/supplier/invoices", icon: Receipt },
          { titleKey: "supplier_guarantees", href: "/supplier/guarantees", icon: ShieldCheck },
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
    sections: [
      {
        labelKey: "component_hr",
        items: [
          { titleKey: "supplier_employees", href: "/supplier/employees", icon: Briefcase },
        ],
      },
    ],
  },
  {
    id: "crm",
    labelKey: "component_crm",
    descKey: "supplier_component_crm_desc",
    homeHref: "/supplier/connections",
    icon: Contact,
    accentToken: "destructive",
    sections: [
      {
        labelKey: "component_crm",
        items: [
          { titleKey: "supplier_connections", href: "/supplier/connections", icon: Link2 },
        ],
      },
    ],
  },
  {
    id: "users",
    labelKey: "component_users",
    descKey: "component_users_desc",
    homeHref: "/supplier/team",
    icon: UserCog,
    accentToken: "secondary",
    sections: [
      {
        labelKey: "component_users",
        items: [
          { titleKey: "supplier_team", href: "/supplier/team", icon: Users },
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

/** Exact match or a "/"-bounded prefix — never a bare `startsWith`, so
 * `/contractor/team` doesn't false-match `/contractor/team-chat`. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/")
}

function componentOwnsPath(component: PortalComponentDef, pathname: string): boolean {
  return component.sections.some((section) =>
    section.items.some((item) => matchesPrefix(pathname, item.href) || item.children?.some((c) => matchesPrefix(pathname, c.href)))
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
