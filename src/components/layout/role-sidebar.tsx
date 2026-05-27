"use client"

import * as React from "react"
import { Link } from "@/i18n/routing"
import { usePathname } from "@/i18n/routing"
import { useLocale, useTranslations } from "next-intl"
import {
  LayoutDashboard,
  FileText,
  Package,
  Users,
  Settings,
  Bell,
  PlusCircle,
  UserCircle,
  Search,
  ClipboardList,
  History,
  TrendingUp,
  MessageSquare,
  LogOut
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

interface NavItem {
  titleKey: string
  href: string
  icon: React.ElementType
}

const supplierItemKeys: NavItem[] = [
  { titleKey: "supplier_dashboard", href: "/supplier", icon: LayoutDashboard },
  { titleKey: "supplier_orders", href: "/supplier/orders", icon: ClipboardList },
  { titleKey: "supplier_rfqs", href: "/supplier/rfqs", icon: Search },
  { titleKey: "supplier_offers", href: "/supplier/offers", icon: History },
  { titleKey: "supplier_chats", href: "/supplier/chats", icon: MessageSquare },
  { titleKey: "supplier_team", href: "/supplier/team", icon: Users },
  { titleKey: "supplier_notifications", href: "/supplier/notifications", icon: Bell },
  { titleKey: "supplier_profile", href: "/supplier/profile", icon: UserCircle },
]

const contractorItemKeys: NavItem[] = [
  { titleKey: "contractor_dashboard", href: "/contractor", icon: LayoutDashboard },
  { titleKey: "contractor_rfqs", href: "/contractor/rfqs", icon: FileText },
  { titleKey: "contractor_new_rfq", href: "/contractor/rfqs/new", icon: PlusCircle },
  { titleKey: "contractor_suppliers", href: "/contractor/suppliers", icon: Users },
  { titleKey: "contractor_chats", href: "/contractor/chats", icon: MessageSquare },
  { titleKey: "contractor_team", href: "/contractor/team", icon: Users },
  { titleKey: "contractor_notifications", href: "/contractor/notifications", icon: Bell },
  { titleKey: "contractor_profile", href: "/contractor/profile", icon: UserCircle },
]

const adminItemKeys: NavItem[] = [
  { titleKey: "admin_home", href: "/admin", icon: LayoutDashboard },
  { titleKey: "admin_suppliers", href: "/admin/suppliers", icon: Users },
  { titleKey: "admin_contractors", href: "/admin/contractors", icon: Users },
  { titleKey: "admin_rfqs", href: "/admin/rfqs", icon: Package },
  { titleKey: "admin_notifications", href: "/admin/notifications", icon: Bell },
  { titleKey: "admin_stats", href: "/admin/stats", icon: TrendingUp },
  { titleKey: "admin_settings", href: "/admin/settings", icon: Settings },
  { titleKey: "admin_profile", href: "/admin/profile", icon: UserCircle },
]

export function RoleSidebar() {
  const t = useTranslations("Portal.Sidebar")
  const locale = useLocale()

  const pathname = usePathname()

  let items: NavItem[] = []
  let portalTitleKey = ""
  let roleColor = ""

  if (pathname.startsWith("/supplier")) {
    items = supplierItemKeys
    portalTitleKey = "supplier_portal"
    roleColor = "text-success"
  } else if (pathname.startsWith("/contractor")) {
    items = contractorItemKeys
    portalTitleKey = "contractor_portal"
    roleColor = "text-accent"
  } else if (pathname.startsWith("/admin")) {
    items = adminItemKeys
    portalTitleKey = "admin_portal"
    roleColor = "text-purple-400"
  } else {
    return null
  }
  if (!portalTitleKey) return null

  return (
    <Sidebar side={locale === 'ar' ? 'right' : 'left'} className={locale === 'ar' ? 'border-l bg-sidebar' : 'border-r bg-sidebar'}>
      <SidebarHeader className="p-6 border-b border-sidebar-border">
        <div className="flex flex-col gap-2">
          <Link href="/" className="text-2xl font-bold text-white font-headline">مدماك تيك</Link>
          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full bg-white/10 w-fit", roleColor)}>
            {t(portalTitleKey)}
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent className="py-4">
        <SidebarMenu className="px-3 gap-2">
          {items.map((item) => (
            <SidebarMenuItem key={item.titleKey}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.href}
                className={cn(
                  "h-11 transition-all",
                  pathname === item.href
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <Link href={item.href} className="flex items-center gap-3">
                  <item.icon className="h-5 w-5" />
                  <span className="text-sm font-medium">{t(item.titleKey)}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
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
