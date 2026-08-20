"use client"

import * as React from "react"
import { useState } from "react"
import { Link } from "@/i18n/routing"
import { usePathname } from "@/i18n/routing"
import { useLocale, useTranslations } from "next-intl"
import Image from "next/image"
import {
  LayoutDashboard,
  Package,
  Users,
  Bell,
  Handshake,
  UserCircle,
  Search,
  ClipboardList,
  History,
  TrendingUp,
  MessageSquare,
  MessagesSquare,
  Settings,
  LogOut,
  ChevronDown,
  Link2,
  Inbox,
  ShieldCheck,
  Briefcase,
  Receipt,
  Warehouse,
  Building,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { usePermissions } from "@/hooks/usePermissions"
import type { PermissionId } from "@/lib/permissions"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar"
import {
  CONTRACTOR_COMMUNICATION_SECTION,
  resolveActiveContractorComponent,
  type NavItem,
  type NavSection,
} from "@/lib/portal-components"

export type { NavItem, NavSection }

const supplierSections: NavSection[] = [
  {
    labelKey: "section_workspace",
    items: [
      { titleKey: "supplier_dashboard", href: "/supplier", icon: LayoutDashboard },
      { titleKey: "supplier_orders", href: "/supplier/orders", icon: ClipboardList },
      { titleKey: "supplier_rfqs", href: "/supplier/rfqs", icon: Search },
      { titleKey: "supplier_offers", href: "/supplier/offers", icon: History },
      { titleKey: "supplier_guarantees", href: "/supplier/guarantees", icon: ShieldCheck },
      { titleKey: "supplier_connections", href: "/supplier/connections", icon: Link2 },
      { titleKey: "supplier_employees", href: "/supplier/employees", icon: Briefcase },
      { titleKey: "supplier_invoices", href: "/supplier/invoices", icon: Receipt },
      { titleKey: "supplier_warehouses", href: "/supplier/warehouses", icon: Warehouse },
    ],
  },
  {
    labelKey: "section_communication",
    items: [
      { titleKey: "supplier_chats", href: "/supplier/chats", icon: MessageSquare },
      { titleKey: "supplier_team_chat", href: "/supplier/team-chat", icon: MessagesSquare },
      { titleKey: "supplier_notifications", href: "/supplier/notifications", icon: Bell },
    ],
  },
  {
    labelKey: "section_settings",
    items: [
      { titleKey: "supplier_team", href: "/supplier/team", icon: Users },
      { titleKey: "supplier_companies", href: "/supplier/companies", icon: Building },
      { titleKey: "supplier_profile", href: "/supplier/profile", icon: UserCircle },
    ],
  },
]

const adminSections: NavSection[] = [
  {
    labelKey: "section_management",
    items: [
      { titleKey: "admin_home", href: "/admin", icon: LayoutDashboard },
      { titleKey: "admin_leads", href: "/admin/leads", icon: Inbox },
      { titleKey: "admin_suppliers", href: "/admin/suppliers", icon: Users },
      { titleKey: "admin_contractors", href: "/admin/contractors", icon: Users },
      { titleKey: "admin_rfqs", href: "/admin/rfqs", icon: Package },
      { titleKey: "admin_procurement", href: "/admin/procurement", icon: Handshake },
    ],
  },
  {
    labelKey: "section_monitoring",
    items: [
      { titleKey: "admin_notifications", href: "/admin/notifications", icon: Bell },
      { titleKey: "admin_stats", href: "/admin/stats", icon: TrendingUp },
    ],
  },
  {
    labelKey: "section_settings",
    items: [
      { titleKey: "admin_settings", href: "/admin/settings", icon: Settings },
      { titleKey: "admin_profile", href: "/admin/profile", icon: UserCircle },
    ],
  },
]

function childIsActive(children: NavItem[], pathname: string): boolean {
  return children.some(c => c.href === pathname || (c.children && childIsActive(c.children, pathname)))
}

function NavItemRenderer({ item, pathname, t, can }: { item: NavItem; pathname: string; t: ReturnType<typeof useTranslations>; can: (p: PermissionId) => boolean }) {
  if (item.requiredPermission && !can(item.requiredPermission)) return null
  const hasChildren = !!item.children?.length
  const isChildActive = hasChildren && childIsActive(item.children!, pathname)
  const isParentActive = pathname === item.href

  const [expanded, setExpanded] = useState(isChildActive || isParentActive)

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setExpanded(!expanded)
  }

  if (hasChildren) {
    return (
      <>
        <SidebarMenuItem>
          <div
            className={cn(
              "flex items-center gap-1 h-10 px-3 rounded-md transition-all",
              isParentActive
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                : "text-sidebar-foreground hover:bg-sidebar-accent"
            )}
          >
            <Link href={item.href} className="flex items-center gap-3 flex-1 min-w-0">
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium truncate">{t(item.titleKey)}</span>
            </Link>
            <button
              onClick={handleToggle}
              className={cn(
                "h-6 w-6 flex items-center justify-center rounded hover:bg-sidebar-accent shrink-0 transition-transform",
                expanded && "rotate-180"
              )}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              <ChevronDown className="h-3.5 w-3.5 text-sidebar-foreground/50" />
            </button>
          </div>
        </SidebarMenuItem>

        {expanded && (
          <div className="ml-4 border-l border-sidebar-border/50 pl-2">
            {item.children!.filter((child) => !child.requiredPermission || can(child.requiredPermission)).map((child) => (
              <SidebarMenuItem key={child.titleKey}>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === child.href}
                  className={cn(
                    "h-9 transition-all",
                    pathname === child.href
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent"
                  )}
                >
                  <Link href={child.href} className="flex items-center gap-3">
                    <child.icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-xs font-medium">{t(child.titleKey)}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isParentActive}
        className={cn(
          "h-10 transition-all",
          isParentActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
            : "text-sidebar-foreground hover:bg-sidebar-accent"
        )}
      >
        <Link href={item.href} className="flex items-center gap-3">
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">{t(item.titleKey)}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function RoleSidebar() {
  const t = useTranslations("Portal.Sidebar")
  const locale = useLocale()
  const { can } = usePermissions()

  const pathname = usePathname()

  let sections: NavSection[] = []
  let portalTitleKey = ""
  let roleColor = ""
  let dashboardHref = "/"

  if (pathname.startsWith("/supplier")) {
    sections = supplierSections
    portalTitleKey = "supplier_portal"
    roleColor = "text-success"
    dashboardHref = "/supplier"
  } else if (pathname.startsWith("/contractor")) {
    const activeComponent = resolveActiveContractorComponent(pathname)
    sections = [...activeComponent.sections, CONTRACTOR_COMMUNICATION_SECTION]
    portalTitleKey = activeComponent.labelKey
    roleColor = "text-accent"
    dashboardHref = activeComponent.homeHref
  } else if (pathname.startsWith("/admin")) {
    sections = adminSections
    portalTitleKey = "admin_portal"
    roleColor = "text-purple-400"
    dashboardHref = "/admin"
  } else {
    return null
  }
  if (!portalTitleKey) return null

  return (
    <Sidebar side={locale === 'ar' ? 'right' : 'left'} className={locale === 'ar' ? 'border-l bg-sidebar' : 'border-r bg-sidebar'}>
      <SidebarHeader className="p-6 border-b border-sidebar-border">
        <div className="flex flex-col gap-3">
          <Link href={dashboardHref} className="block">
            <Image
              src="/logo1.png"
              alt="مدماك تيك" 
              width={130} 
              height={45} 
              className="h-9 w-auto object-contain" 
              priority 
            />
          </Link>
          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full bg-white/10 w-fit", roleColor)}>
            {t(portalTitleKey)}
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent className="py-4">
        {sections.map((section) => (
          <SidebarGroup key={section.labelKey} className="px-0 py-1">
            <SidebarGroupLabel className={cn(
              "px-6 font-bold text-sidebar-foreground/40",
              locale === 'ar' ? 'text-[11px] tracking-normal' : 'text-[10px] uppercase tracking-widest'
            )}>
              {t(section.labelKey)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="px-3 gap-1">
                {section.items.map((item) => (
                  <NavItemRenderer key={item.titleKey} item={item} pathname={pathname} t={t} can={can} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="p-4 border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="text-red-400 hover:bg-red-950/20 hover:text-red-300">
              <Link href="/" className="flex items-center gap-3">
                <LogOut className="h-5 w-5" />
                <span className="text-sm font-medium">{t("logout")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
