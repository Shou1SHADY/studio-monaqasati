"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
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
  title: string
  href: string
  icon: React.ElementType
}

const supplierItems: NavItem[] = [
  { title: "لوحة التحكم", href: "/supplier", icon: LayoutDashboard },
  { title: "طلباتي", href: "/supplier/orders", icon: ClipboardList },
  { title: "المناقصات المتاحة", href: "/supplier/rfqs", icon: Search },
  { title: "عروضي المقدمة", href: "/supplier/offers", icon: History },
  { title: "محادثاتي", href: "/supplier/chats", icon: MessageSquare },
  { title: "إدارة الفريق", href: "/supplier/team", icon: Users },
  { title: "التنبيهات", href: "/supplier/notifications", icon: Bell },
  { title: "الملف الشخصي", href: "/supplier/profile", icon: UserCircle },
]

const contractorItems: NavItem[] = [
  { title: "لوحة التحكم", href: "/contractor", icon: LayoutDashboard },
  { title: "مناقصاتي", href: "/contractor/rfqs", icon: FileText },
  { title: "طرح مناقصة جديدة", href: "/contractor/rfqs/new", icon: PlusCircle },
  { title: "دليل الموردين", href: "/contractor/suppliers", icon: Users },
  { title: "محادثاتي", href: "/contractor/chats", icon: MessageSquare },
  { title: "إدارة الفريق", href: "/contractor/team", icon: Users },
  { title: "التنبيهات", href: "/contractor/notifications", icon: Bell },
  { title: "الملف الشخصي", href: "/contractor/profile", icon: UserCircle },
]

const adminItems: NavItem[] = [
  { title: "الرئيسية", href: "/admin", icon: LayoutDashboard },
  { title: "الموردين", href: "/admin/suppliers", icon: Users },
  { title: "المقاولين", href: "/admin/contractors", icon: Users },
  { title: "كافة المناقصات", href: "/admin/rfqs", icon: Package },
  { title: "سجل الإشعارات", href: "/admin/notifications", icon: Bell },
  { title: "الإحصائيات", href: "/admin/stats", icon: TrendingUp },
  { title: "الإعدادات", href: "/admin/settings", icon: Settings },
]

export function RoleSidebar() {
  const pathname = usePathname()
  
  let items: NavItem[] = []
  let portalTitle = ""
  let roleColor = ""

  if (pathname.startsWith("/supplier")) {
    items = supplierItems
    portalTitle = "بوابة الموردين"
    roleColor = "text-success"
  } else if (pathname.startsWith("/contractor")) {
    items = contractorItems
    portalTitle = "بوابة المقاولين"
    roleColor = "text-accent"
  } else if (pathname.startsWith("/admin")) {
    items = adminItems
    portalTitle = "بوابة الإدارة"
    roleColor = "text-purple-400"
  }

  return (
    <Sidebar side="right" className="border-l bg-sidebar">
      <SidebarHeader className="p-6 border-b border-sidebar-border">
        <div className="flex flex-col gap-2">
          <Link href="/" className="text-2xl font-bold text-white font-headline">مدماك تيك</Link>
          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full bg-white/10 w-fit", roleColor)}>
            {portalTitle}
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent className="py-4">
        <SidebarMenu className="px-3 gap-2">
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
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
                  <span className="text-sm font-medium">{item.title}</span>
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
                <span className="text-sm font-medium">تسجيل الخروج</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
