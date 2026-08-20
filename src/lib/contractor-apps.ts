import type { LucideIcon } from "lucide-react"
import {
  LayoutDashboard,
  FolderOpen,
  FileText,
  ShoppingBasket,
  Users,
  Warehouse,
  PackageCheck,
  Receipt,
  ShieldCheck,
  Briefcase,
  UsersRound,
  Building,
  MessageSquare,
  MessagesSquare,
  Bell,
} from "lucide-react"
import type { PermissionId } from "@/lib/permissions"

export interface AppNavItem {
  titleKey: string
  href: string
  icon: LucideIcon
}

export interface ContractorApp {
  id: string
  titleKey: string
  icon: LucideIcon
  /** Permission required to see this app's tile and enter it — omit for apps open to every member. */
  requiredPermission?: PermissionId
  /** Sidebar nav items shown once inside this app. */
  items: AppNavItem[]
  /** Pathname prefixes (beyond `items[].href`) that should still resolve to this app's sidebar —
   * nested/detail routes that aren't tiles themselves (e.g. a project detail page). */
  extraPathPrefixes?: string[]
}

export interface ContractorAppGroup {
  labelKey: string
  apps: ContractorApp[]
}

// The contractor apps launcher, grouped by domain. Each app owns a dedicated
// sidebar (its `items`) instead of contributing to one global sidebar — see
// role-sidebar.tsx's contractor branch and the launcher page.
export const CONTRACTOR_APP_GROUPS: ContractorAppGroup[] = [
  {
    labelKey: "apps_group_projects",
    apps: [
      {
        id: "projects",
        titleKey: "contractor_projects",
        icon: FolderOpen,
        items: [
          { titleKey: "contractor_projects", href: "/contractor/projects", icon: FolderOpen },
        ],
        extraPathPrefixes: ["/contractor/projects/"],
      },
      {
        id: "rfqs",
        titleKey: "contractor_rfqs",
        icon: FileText,
        items: [
          { titleKey: "contractor_rfqs", href: "/contractor/rfqs", icon: FileText },
        ],
        extraPathPrefixes: ["/contractor/rfqs/"],
      },
      {
        id: "catalog",
        titleKey: "contractor_catalog",
        icon: ShoppingBasket,
        items: [
          { titleKey: "contractor_catalog", href: "/contractor/catalog", icon: ShoppingBasket },
        ],
      },
      {
        id: "suppliers",
        titleKey: "contractor_browse_suppliers",
        icon: Users,
        items: [
          { titleKey: "contractor_browse_suppliers", href: "/contractor/suppliers", icon: Users },
        ],
        extraPathPrefixes: ["/contractor/supplier/"],
      },
    ],
  },
  {
    labelKey: "apps_group_warehouses",
    apps: [
      {
        id: "warehouses",
        titleKey: "contractor_warehouses",
        icon: Warehouse,
        requiredPermission: "warehouses.manage",
        items: [
          { titleKey: "contractor_warehouses", href: "/contractor/warehouses", icon: Warehouse },
        ],
        extraPathPrefixes: ["/contractor/warehouses/"],
      },
      {
        id: "goods-received",
        titleKey: "contractor_goods_received",
        icon: PackageCheck,
        requiredPermission: "deliveries.confirm",
        items: [
          { titleKey: "contractor_goods_received", href: "/contractor/goods-received", icon: PackageCheck },
        ],
        extraPathPrefixes: ["/contractor/receipts/"],
      },
    ],
  },
  {
    labelKey: "apps_group_finance",
    apps: [
      {
        id: "invoices",
        titleKey: "contractor_invoices",
        icon: Receipt,
        requiredPermission: "invoices.manage",
        items: [
          { titleKey: "contractor_invoices", href: "/contractor/invoices", icon: Receipt },
        ],
      },
      {
        id: "guarantees",
        titleKey: "contractor_guarantees",
        icon: ShieldCheck,
        items: [
          { titleKey: "contractor_guarantees", href: "/contractor/guarantees", icon: ShieldCheck },
        ],
      },
    ],
  },
  {
    labelKey: "apps_group_team",
    apps: [
      {
        id: "employees",
        titleKey: "contractor_employees",
        icon: Briefcase,
        requiredPermission: "employees.manage",
        items: [
          { titleKey: "contractor_employees", href: "/contractor/employees", icon: Briefcase },
        ],
      },
      {
        id: "team",
        titleKey: "contractor_team",
        icon: UsersRound,
        requiredPermission: "team.manage",
        items: [
          { titleKey: "contractor_team", href: "/contractor/team", icon: UsersRound },
        ],
      },
      {
        id: "companies",
        titleKey: "contractor_companies",
        icon: Building,
        items: [
          { titleKey: "contractor_companies", href: "/contractor/companies", icon: Building },
        ],
      },
    ],
  },
  {
    labelKey: "apps_group_comms",
    apps: [
      {
        id: "chats",
        titleKey: "contractor_chats",
        icon: MessageSquare,
        items: [
          { titleKey: "contractor_chats", href: "/contractor/chats", icon: MessageSquare },
        ],
        extraPathPrefixes: ["/contractor/chat/"],
      },
      {
        id: "team-chat",
        titleKey: "contractor_team_chat",
        icon: MessagesSquare,
        items: [
          { titleKey: "contractor_team_chat", href: "/contractor/team-chat", icon: MessagesSquare },
        ],
      },
      {
        id: "notifications",
        titleKey: "contractor_notifications",
        icon: Bell,
        items: [
          { titleKey: "contractor_notifications", href: "/contractor/notifications", icon: Bell },
        ],
      },
    ],
  },
]

// Pinned outside any group — always visible, never permission-gated.
export const CONTRACTOR_DASHBOARD_APP: ContractorApp = {
  id: "dashboard",
  titleKey: "contractor_dashboard",
  icon: LayoutDashboard,
  items: [
    { titleKey: "contractor_dashboard", href: "/contractor/dashboard", icon: LayoutDashboard },
  ],
}

export const ALL_CONTRACTOR_APPS: ContractorApp[] = [
  CONTRACTOR_DASHBOARD_APP,
  ...CONTRACTOR_APP_GROUPS.flatMap((g) => g.apps),
]

/** Finds which app a given contractor pathname belongs to, for the scoped sidebar. */
export function findContractorAppForPath(pathname: string): ContractorApp | null {
  for (const app of ALL_CONTRACTOR_APPS) {
    for (const item of app.items) {
      if (pathname === item.href) return app
    }
    for (const prefix of app.extraPathPrefixes || []) {
      if (pathname.startsWith(prefix)) return app
    }
  }
  return null
}
