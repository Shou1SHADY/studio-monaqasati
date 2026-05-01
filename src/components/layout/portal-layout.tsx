"use client"

import * as React from "react"
import { RoleSidebar } from "./role-sidebar"
import { 
  SidebarInset, 
  SidebarProvider, 
  SidebarTrigger 
} from "@/components/ui/sidebar"
import { Bell, User, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu"

export function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <RoleSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-white px-6 shadow-sm">
            <SidebarTrigger />
            
            <div className="flex-1 max-w-md hidden md:flex">
              <div className="relative w-full">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="بحث سريع..." 
                  className="pr-10 bg-slate-50 border-none focus-visible:ring-1"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 mr-auto">
              <Button variant="ghost" size="icon" className="relative text-slate-500">
                <Bell size={20} />
                <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive" />
              </Button>
              
              <div className="h-8 w-px bg-slate-200 mx-1" />
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 pr-2 pl-4 h-10 rounded-full hover:bg-slate-100">
                    <div className="flex flex-col items-end mr-2 hidden sm:flex">
                      <span className="text-sm font-bold text-slate-700">أحمد محمد</span>
                      <span className="text-xs text-muted-foreground">شركة المقاولات الحديثة</span>
                    </div>
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <User size={18} />
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem>الملف الشخصي</DropdownMenuItem>
                  <DropdownMenuItem>الإعدادات</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive">تسجيل الخروج</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          
          <main className="flex-1 p-6 overflow-y-auto">
            <div className="mx-auto max-w-7xl">
              {children}
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
