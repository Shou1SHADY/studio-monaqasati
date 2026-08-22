// Contractor portal "app switcher" — Gmail-style: the portal is split into
// standalone components (Project Management, Procurement, Warehouses,
// Payments/Billing, HR, CRM, Users), each with its own side navigation.
// No routes move — every page keeps its existing URL. Which component
// "owns" a page is purely a navigation/IA concept: this registry maps each
// component to the nav items it renders, and `resolveActiveContractorComponent`
// derives which component is active from the current pathname (mirroring the
// pathname-prefix role-detection already used in role-sidebar.tsx).
//
// Supplier and admin portals are untouched — this registry is contractor-only.

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
    homeHref: "/contractor",
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

const PROJECT_MANAGEMENT = CONTRACTOR_COMPONENTS.find((c) => c.id === "project-management")!

/** Resolves which component's sidebar should render for the current
 * contractor-portal pathname. Every non-PM component owns a disjoint
 * `/contractor/xxx` prefix, so they're checked first; Project Management
 * (whose home is the bare `/contractor` root) is the catch-all default. */
export function resolveActiveContractorComponent(pathname: string): PortalComponentDef {
  for (const component of CONTRACTOR_COMPONENTS) {
    if (component.id === "project-management") continue
    if (componentOwnsPath(component, pathname)) return component
  }
  return PROJECT_MANAGEMENT
}
