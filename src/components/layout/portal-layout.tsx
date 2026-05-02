"use client"

import * as React from "react"
import { RoleSidebar } from "./role-sidebar"
import { 
  SidebarInset, 
  SidebarProvider, 
  SidebarTrigger 
} from "@/components/ui/sidebar"
import { Bell, User, Search, Loader2, CheckCircle2, Clock, TrendingUp } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu"
import { useUser, useDoc, useFirestore, useMemoFirebase, useCollection } from "@/firebase"
import { doc, collection, query, where, orderBy, limit } from "firebase/firestore"
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
  
  const { data: profile } = useDoc(userDocRef)
  
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = React.useState(searchParams.get("search") || "")
  
  React.useEffect(() => {
    if (!isUserLoading && !user && pathname !== "/admin/seed") {
      router.push("/login")
    }
  }, [user, isUserLoading, router, pathname])
  
  const basePath = pathname.split("/")[1] || "admin"
  const isSupplier = basePath === "supplier"
  const isContractor = basePath === "contractor"

  // --- Notifications: fetch recent offers relevant to current role ---
  // Supplier: their own submitted offers (status changes = notifications)
  const supplierOffersQuery = useMemoFirebase(() => {
    if (!isSupplier || isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "offers"),
      where("supplierId", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(5)
    )
  }, [firestore, user, isUserLoading, isSupplier])

  // Contractor: fetch their RFQs first to build rfqIds, then fetch offers on those
  const contractorRfqsQuery = useMemoFirebase(() => {
    if (!isContractor || isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "rfqs"),
      where("contractorId", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(10)
    )
  }, [firestore, user, isUserLoading, isContractor])

  const { data: supplierOffers } = useCollection(supplierOffersQuery)
  const { data: contractorRfqs } = useCollection(contractorRfqsQuery)

  const contractorRfqIds = contractorRfqs?.slice(0, 10).map((r: any) => r.id) || []

  const contractorOffersQuery = useMemoFirebase(() => {
    if (!isContractor || isUserLoading || !user || !firestore || contractorRfqIds.length === 0) return null
    return query(
      collection(firestore, "offers"),
      where("rfqId", "in", contractorRfqIds),
      orderBy("createdAt", "desc"),
      limit(5)
    )
  }, [firestore, user, isUserLoading, isContractor, contractorRfqIds.join(",")])

  const { data: contractorOffers } = useCollection(contractorOffersQuery)

  // Determine which notifications list to show
  const notifications: any[] = isSupplier
    ? (supplierOffers || [])
    : isContractor
    ? (contractorOffers || [])
    : []

  // Unread count: decided offers (accepted/rejected) that supplier hasn't read yet
  const unreadCount = isSupplier
    ? notifications.filter((o: any) =>
        (o.status === "مقبول" || o.status === "مرفوض") && !o.readAt
      ).length
    : notifications.filter((o: any) => o.status === "قيد المراجعة").length

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
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-destructive text-white text-[9px] font-bold flex items-center justify-center">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 p-0" dir="rtl">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <span className="font-bold text-sm">الإشعارات</span>
                  {unreadCount > 0 && (
                    <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded-full font-medium">
                      {unreadCount} جديد
                    </span>
                  )}
                </div>

                {/* Notification Items */}
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground py-8">
                    <Bell size={28} className="opacity-20" />
                    <p className="text-sm">لا توجد إشعارات</p>
                  </div>
                ) : (
                  <div className="divide-y max-h-72 overflow-y-auto">
                    {notifications.map((notif: any) => {
                      const isPending = notif.status === "قيد المراجعة"
                      const isAccepted = notif.status === "مقبول"
                      return (
                        <div
                          key={notif.id}
                          className={`flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors ${
                            isPending ? "bg-amber-50/40" : ""
                          }`}
                        >
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                            isPending ? "bg-amber-100 text-amber-600" :
                            isAccepted ? "bg-success/10 text-success" :
                            "bg-slate-100 text-slate-400"
                          }`}>
                            {isPending && <Clock size={14} />}
                            {isAccepted && <CheckCircle2 size={14} />}
                            {!isPending && !isAccepted && <TrendingUp size={14} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-slate-800 truncate">
                              {isSupplier
                                ? isPending ? "⏳ عرض قيد المراجعة"
                                  : isAccepted ? "✅ تم قبول عرضك!"
                                  : "❌ تم رفض العرض"
                                : "🔔 عرض سعر جديد"}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {isSupplier
                                ? `${notif.price} ر.س - ${notif.rfqTitle || "مناقصة"}`
                                : `${notif.price} ر.س - ${notif.rfqTitle || "مناقصة"}`}
                            </p>
                          </div>
                          {isPending && <div className="h-2 w-2 rounded-full bg-amber-500 shrink-0 mt-1.5" />}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Footer link */}
                <DropdownMenuSeparator />
                <div className="p-2">
                  <Link href={`/${basePath}/notifications`}>
                    <Button variant="ghost" size="sm" className="w-full text-primary hover:text-primary/80 hover:bg-primary/5">
                      عرض كل الإشعارات
                    </Button>
                  </Link>
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