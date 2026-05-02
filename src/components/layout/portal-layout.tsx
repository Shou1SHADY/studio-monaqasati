"use client"

import * as React from "react"
import { RoleSidebar } from "./role-sidebar"
import { 
  SidebarInset, 
  SidebarProvider, 
  SidebarTrigger 
} from "@/components/ui/sidebar"
import { Bell, User, Search, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu"
import { useUser, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { doc } from "firebase/firestore"
import { getAuth, signOut } from "firebase/auth"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useUser()
  const firestore = useFirestore()
  
  // الإصلاح: انتظار Auth قبل محاولة جلب مستند المستخدم
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  
  const { data: profile, isLoading: isDocLoading } = useDoc(userDocRef)
  
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = React.useState(searchParams.get("search") || "")
  
  const basePath = pathname.split("/")[1] || "admin"

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      router.push(`/${basePath}/rfqs?search=${encodeURIComponent(searchQuery)}`)
    } else {
      router.push(`/${basePath}/rfqs`)
    }
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setSearchQuery(val)
    
    // Live filter if we are already on the rfqs list page
    if (pathname.endsWith('/rfqs')) {
      if (val.trim()) {
        router.replace(`/${basePath}/rfqs?search=${encodeURIComponent(val)}`)
      } else {
        router.replace(`/${basePath}/rfqs`)
      }
    }
  }

  const handleLogout = async () => {
    const auth = getAuth()
    await signOut(auth)
    router.push("/")
  }

  return (
    <SidebarProvider>
      <RoleSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-white px-6 shadow-sm">
          <SidebarTrigger />
          
          <div className="flex-1 max-w-md flex">
            <TooltipProvider>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <form onSubmit={handleSearch} className="relative w-full">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="بحث سريع..." 
                      className="pr-10 bg-slate-50 border-none focus-visible:ring-1"
                      value={searchQuery}
                      onChange={handleSearchChange}
                    />
                  </form>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="bg-slate-800 text-white border-none">
                  <p className="text-xs font-medium">اكتب كلمة البحث (اسم، فئة، أو مكان) واضغط Enter للبحث ↵</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="flex items-center gap-3 mr-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative text-slate-500">
                  <Bell size={20} />
                  <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 p-2 text-center">
                <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground py-6">
                  <Bell size={24} className="opacity-20" />
                  <p className="text-sm">لا توجد إشعارات جديدة</p>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            
            <div className="h-8 w-px bg-slate-200 mx-1" />
            
            {isUserLoading ? (
              <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 pr-2 pl-4 h-10 rounded-full hover:bg-slate-100">
                    <div className="flex flex-col items-end mr-2 hidden sm:flex">
                      <span className="text-sm font-bold text-slate-700">{profile?.name || (user ? "مستخدم جديد" : "ضيف")}</span>
                      <span className="text-xs text-muted-foreground">{profile?.role || "بانتظار التهيئة..."}</span>
                    </div>
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <User size={18} />
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => router.push(`/${basePath}/profile`)}>الملف الشخصي</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push(`/${basePath}/settings`)}>الإعدادات</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive cursor-pointer" onClick={handleLogout}>تسجيل الخروج</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>
        
        <main className="flex-1 p-4 md:p-6 overflow-y-auto overflow-x-hidden w-full max-w-[100vw]">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}