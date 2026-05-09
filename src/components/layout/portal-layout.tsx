"use client"

import * as React from "react"
import { RoleSidebar } from "./role-sidebar"
import { 
  SidebarInset, 
  SidebarProvider, 
  SidebarTrigger 
} from "@/components/ui/sidebar"
import { Bell, User, Search, Loader2, CheckCircle2, Clock, TrendingUp, Box } from "lucide-react"
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
import { doc, collection, query, where, orderBy, limit, updateDoc } from "firebase/firestore"
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

  React.useEffect(() => {
    if (profile && profile.role) {
      if (profile.role === "Supplier" && basePath !== "supplier") {
        router.push("/supplier")
      } else if (profile.role === "Contractor" && basePath !== "contractor") {
        router.push("/contractor")
      } else if (profile.role === "Admin" && basePath !== "admin") {
        router.push("/admin")
      }
    }
  }, [profile, basePath, router])
  const isSupplier = basePath === "supplier"
  const isContractor = basePath === "contractor"

  // --- Notifications: fetch recent offers and RFQs relevant to current role ---
  // Supplier: their own submitted offers + NEW RFQs matching their specializations
  const supplierOffersQuery = useMemoFirebase(() => {
    if (!isSupplier || isUserLoading || !user || !firestore || !profile?.organizationId) return null
    return query(
      collection(firestore, "offers"),
      where("organizationId", "==", profile.organizationId),
      limit(20)
    )
  }, [firestore, user, isUserLoading, isSupplier, profile?.organizationId])

  const supplierMatchingRfqsQuery = useMemoFirebase(() => {
    if (!isSupplier || isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "rfqs"),
      where("status", "==", "New"),
      where("visibility", "==", "public"),
      limit(20)
    )
  }, [firestore, user, isUserLoading, isSupplier])

  // Contractor: fetch their RFQs first to build rfqIds, then fetch offers on those
  const contractorRfqsQuery = useMemoFirebase(() => {
    if (!isContractor || isUserLoading || !user || !firestore || !profile?.organizationId) return null
    return query(
      collection(firestore, "rfqs"),
      where("organizationId", "==", profile.organizationId),
      limit(20)
    )
  }, [firestore, user, isUserLoading, isContractor, profile?.organizationId])

  const { data: supplierOffers } = useCollection(supplierOffersQuery)
  const { data: supplierRfqs } = useCollection(supplierMatchingRfqsQuery)
  const { data: contractorRfqs } = useCollection(contractorRfqsQuery)

  const contractorRfqIds = contractorRfqs?.slice(0, 10).map((r: any) => r.id) || []

  const contractorOffersQuery = useMemoFirebase(() => {
    if (!isContractor || isUserLoading || !user || !firestore || contractorRfqIds.length === 0) return null
    return query(
      collection(firestore, "offers"),
      where("rfqId", "in", contractorRfqIds),
      limit(20)
    )
  }, [firestore, user, isUserLoading, isContractor, contractorRfqIds.join(",")])

  const { data: contractorOffers } = useCollection(contractorOffersQuery)

  // Query user's notifications from subcollection (for invitations, etc)
  const userNotificationsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "users", user.uid, "notifications")
    )
  }, [firestore, user, isUserLoading])

  const { data: userNotifications } = useCollection(userNotificationsQuery)

  // Merge and sort notifications
  const mergedSupplierNotifs = React.useMemo(() => {
    const offers = (supplierOffers || []).map((o: any) => ({ ...o, type: "offer_update" }))
    
    // Filter RFQs by supplier's specializations and map to notification format
    const newRfqs = (supplierRfqs || [])
      .filter((rfq: any) => profile?.specializations?.includes(rfq.category))
      .map((rfq: any) => ({ ...rfq, type: "new_rfq" }))
    
    const generic = (userNotifications || []).map((n: any) => ({ ...n, type: n.type || "generic" }))
    
    return [...offers, ...newRfqs, ...generic].sort((a: any, b: any) => 
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    ).slice(0, 10)
  }, [supplierOffers, supplierRfqs, profile, userNotifications])

  const mergedContractorNotifs = React.useMemo(() => {
    const offers = (contractorOffers || []).map((o: any) => ({ ...o, type: "new_offer" }))
    const generic = (userNotifications || []).map((n: any) => ({ ...n, type: n.type || "generic" }))
    
    return [...offers, ...generic].sort((a: any, b: any) => 
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    ).slice(0, 10)
  }, [contractorOffers, userNotifications])

  // Determine which notifications list to show
  const notifications: any[] = isSupplier
    ? mergedSupplierNotifs
    : isContractor
    ? mergedContractorNotifs
    : []

  // Use localStorage to track read RFQs since they are shared documents
  const [readRfqIds, setReadRfqIds] = React.useState<string[]>([])
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem("readRfqIds")
      if (stored) setReadRfqIds(JSON.parse(stored))
    } catch (e) {}
  }, [])

  const markRfqAsRead = (rfqId: string) => {
    const updated = [...new Set([...readRfqIds, rfqId])]
    setReadRfqIds(updated)
    localStorage.setItem("readRfqIds", JSON.stringify(updated))
  }

  // Unread count
  const unreadCount = notifications.filter((n: any) => {
    if (n.type === "new_rfq") return !readRfqIds.includes(n.id)
    if (n.type === "new_offer") return n.status === "قيد المراجعة" && !n.contractorReadAt
    if (n.type === "offer_update") return (n.status === "مقبول" || n.status === "مرفوض" || n.status === "مطلوب تخفيض" || n.sampleStatus === "مطلوبة" || n.sampleStatus === "تم الاستلام") && !n.readAt
    return !n.read // for invitations and generic
  }).length

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

  const handleNotificationClick = async (notif: any) => {
    // 1. Mark as read
    if (isSupplier) {
      if (notif.type === "new_rfq") {
        markRfqAsRead(notif.id)
      } else if (!notif.readAt && firestore) {
        try {
          await updateDoc(doc(firestore, "offers", notif.id), { readAt: new Date().toISOString() })
        } catch (e) {
          // ignore errors
        }
      }
    }
    // 2. Navigate
    if (notif.type === "invitation") {
      router.push(`/${basePath}/team`)
    } else if (isSupplier) {
      if (notif.type === "new_rfq") {
        router.push(`/supplier/rfqs`)
      } else {
        router.push(`/supplier/offers`)
      }
    } else if (isContractor) {
      if (notif.type === "new_offer") {
        router.push(`/contractor/rfqs/${notif.rfqId}/offers`)
      } else {
        router.push(`/contractor/notifications`)
      }
    }
  }

  return (
    <SidebarProvider>
      <RoleSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-6 shadow-sm">
          <SidebarTrigger />
          
          <div className="flex-1 max-w-md flex">
            <TooltipProvider>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <form onSubmit={handleSearch} className="relative w-full">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="بحث سريع..." 
                      className="pr-10 bg-muted border-none focus-visible:ring-1"
                      value={searchQuery}
                      onChange={handleSearchChange}
                    />
                  </form>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="bg-primary text-primary-foreground border-none">
                  <p className="text-xs font-medium">اكتب كلمة البحث (اسم، فئة، أو مكان) واضغط Enter للبحث ↵</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="flex items-center gap-3 mr-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative text-muted-foreground">
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
                      const isNewRfq = notif.type === "new_rfq"
                      const isPending = notif.status === "قيد المراجعة" && notif.type !== "new_rfq"
                      const isAccepted = notif.status === "مقبول" && notif.type !== "new_rfq"
                      const isPriceReduction = notif.status === "مطلوب تخفيض" && notif.type !== "new_rfq"
                      const isSampleRequest = notif.sampleStatus === "مطلوبة" && notif.type !== "new_rfq"
                      const isSampleReceived = notif.sampleStatus === "تم الاستلام" && notif.type !== "new_rfq"
                      const isInvitation = notif.type === "invitation"
                      const isUnread = isNewRfq 
                        ? !readRfqIds.includes(notif.id)
                        : isInvitation
                          ? !notif.read
                          : isSupplier 
                            ? !notif.readAt && (isAccepted || notif.status === "مرفوض" || isPriceReduction || isSampleRequest || isSampleReceived)
                            : isPending || (notif.type === "new_offer" && !notif.contractorReadAt);
                      
                      return (
                        <div
                          key={notif.id}
                          onClick={() => handleNotificationClick(notif)}
                          className={`flex items-start gap-3 px-4 py-3 hover:bg-muted transition-colors cursor-pointer select-none ${
                            isUnread ? "bg-amber-50/40" : ""
                          }`}
                        >
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                            isSampleReceived ? "bg-success/10 text-success" :
                            isSampleRequest ? "bg-blue-100 text-blue-600" :
                            isPending ? "bg-amber-100 text-amber-600" :
                            isPriceReduction ? "bg-amber-100 text-amber-700" :
                            isNewRfq ? "bg-blue-100 text-blue-600" :
                            isAccepted ? "bg-success/10 text-success" :
                            isInvitation ? "bg-primary/10 text-primary" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {isNewRfq ? <Bell size={14} /> : isSampleReceived ? <CheckCircle2 size={14} /> : isSampleRequest ? <Box size={14} /> : isPending ? <Clock size={14} /> : isPriceReduction ? <TrendingUp className="rotate-180" size={14} /> : isAccepted ? <CheckCircle2 size={14} /> : isInvitation ? <Bell size={14} /> : <TrendingUp size={14} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-foreground truncate">
                              {isSupplier
                                ? isNewRfq ? "🆕 مناقصة جديدة متطابقة!"
                                  : isSampleReceived ? "✅ تم استلام العينة!"
                                  : isSampleRequest ? "📦 مطلوب عينة للعرض"
                                  : isPending ? "⏳ عرض قيد المراجعة"
                                  : isPriceReduction ? "📉 مطلوب تخفيض السعر"
                                  : isAccepted ? "✅ تم قبول عرضك!"
                                  : isInvitation ? (notif.title || "🔔 دعوة للفريق")
                                  : "❌ تم رفض العرض"
                                : isInvitation ? (notif.title || "🔔 دعوة للفريق")
                                : "🔔 عرض سعر جديد"}
                            </p>
                             <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {isNewRfq 
                                ? `تم طرح مناقصة في قسم ${notif.category}`
                                : isInvitation
                                  ? (notif.message || "لقد تلقيت دعوة للانضمام إلى فريق عمل جديد.")
                                  : isSupplier
                                    ? `${notif.price} ر.س - ${notif.rfqTitle || "مناقصة"}`
                                    : `${notif.price} ر.س - ${notif.rfqTitle || "مناقصة"}`
                              }
                            </p>
                          </div>
                          {isUnread && <div className="h-2 w-2 rounded-full bg-amber-500 shrink-0 mt-1.5" />}
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
            
            <div className="h-8 w-px bg-border mx-1" />
            
            {isUserLoading ? (
              <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 pr-2 pl-4 h-10 rounded-full hover:bg-muted">
                    <div className="flex flex-col items-end mr-2 hidden sm:flex">
                      <span className="text-sm font-bold text-foreground">{profile?.name || (user ? "مستخدم جديد" : "ضيف")}</span>
                      <span className="text-xs text-muted-foreground">
                        {profile?.role === "Contractor" ? "مقاول" : profile?.role === "Supplier" ? "مورد" : profile?.role || "بانتظار التهيئة..."}
                      </span>
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