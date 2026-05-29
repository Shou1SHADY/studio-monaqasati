"use client"

import * as React from "react"
import { RoleSidebar } from "./role-sidebar"
import { 
  SidebarInset, 
  SidebarProvider, 
  SidebarTrigger 
} from "@/components/ui/sidebar"
import { Bell, User, Search, Loader2, CheckCircle2, Clock, TrendingUp, Box, MessageSquare, ShieldCheck, AlertCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu"
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher"
import { useUser, useDoc, useFirestore, useMemoFirebase, useCollection } from "@/firebase"
import { useLocale, useTranslations } from "next-intl"
import { doc, collection, query, where, orderBy, limit, updateDoc } from "firebase/firestore"
import { getAuth, signOut } from "firebase/auth"
import { useSearchParams } from "next/navigation"
import { useRouter, usePathname } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/hooks/use-toast"

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useUser()
  const firestore = useFirestore()
  const { toast } = useToast()
  
  // الإصلاح: انتظار Auth قبل محاولة جلب مستند المستخدم
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  
  const { data: profile, isLoading: isProfileLoading } = useDoc(userDocRef)
  
  const t = useTranslations("Portal.Layout")
  const tErr = useTranslations("Portal.Errors")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = React.useState(searchParams.get("search") || "")
  
  React.useEffect(() => {
    if (!isUserLoading) {
      if (!user && pathname !== "/admin/seed") {
        router.push("/login")
        return
      }

      if (user) {
        // 1. Email Verification Guard (password users only)
        // Exception: Bypass for the hardcoded admin email since the owner cannot access its inbox
        // Exception 2: Bypass in local development when enabled via localStorage
        const isPasswordProvider = user.providerData.some(p => p.providerId === "password")
        const isLocalDev = typeof window !== "undefined" && (
          window.location.hostname === "localhost" || 
          window.location.hostname === "127.0.0.1" || 
          window.location.hostname.startsWith("192.168.")
        )
        const bypassEmailVerification = isLocalDev && (
          process.env.NEXT_PUBLIC_BYPASS_EMAIL_VERIFICATION === "true" || 
          localStorage.getItem("dev_bypass_email_verification") === "true"
        )
        
        if (isPasswordProvider && !user.emailVerified && user.email !== "admin@munaqasati.sa" && !bypassEmailVerification) {
          router.push("/verify-email")
          return
        }

        // 2. Admin-only route guard — block non-admins from /admin
        if (pathname.startsWith("/admin") && pathname !== "/admin/seed") {
          // Only enforce once profile is finished loading
          if (!isProfileLoading && (!profile || profile.role !== "Admin")) {
            if (profile?.role === "Supplier") router.push("/supplier")
            else if (profile?.role === "Contractor") router.push("/contractor")
            else router.push("/login")
            return
          }
        }

        // 3. 2-Step Verification (MFA) Guard
        if (profile?.twoFactorEnabled && profile?.phone) {
          const is2FAVerified = sessionStorage.getItem(`2fa_verified_${user.uid}`) === "true"
          if (!is2FAVerified) {
            const auth = getAuth()
            signOut(auth).then(() => {
              router.push("/login")
            })
            return
          }
        }

        // No hard redirect for incomplete profile anymore. We show a banner instead.
      }
    }
  }, [user, isUserLoading, profile, isProfileLoading, router, pathname])
  
  const basePath = pathname.split("/")[1] || "admin"

  // Role-based redirect guard — chat now lives inside role groups, no exception needed
  React.useEffect(() => {
    if (profile && profile.role && basePath !== "chat") {
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

  // --- Chat unread count: chats where the current user's UID is in unreadFor ---
  const chatsUnreadQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    const orgField = isContractor ? "contractorOrgId" : "supplierOrgId"
    const orgValue = profile?.organizationId || user.uid
    return query(
      collection(firestore, "chats"),
      where(orgField, "==", orgValue)
    )
  }, [firestore, user, isUserLoading, isContractor, isSupplier, profile?.organizationId])

  const { data: allMyChats } = useCollection(chatsUnreadQuery)

  // Chats that have an unread message for this specific user
  const unreadChats = React.useMemo(() => {
    if (!allMyChats || !user) return []
    return allMyChats.filter((chat: any) =>
      Array.isArray(chat.unreadFor) && chat.unreadFor.includes(user.uid)
    )
  }, [allMyChats, user])

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
    const generic = (userNotifications || [])
      .filter((n: any) => n.type !== "new_offer")
      .map((n: any) => ({ ...n, type: n.type || "generic" }))
    
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

  // Unread count (offers + invitations + unread chats)
  const unreadCount = notifications.filter((n: any) => {
    if (n.type === "new_rfq") return !readRfqIds.includes(n.id)
    if (n.type === "new_offer") return n.status === "قيد المراجعة" && !n.contractorReadAt
    if (n.type === "offer_update") return (n.status === "مقبول" || n.status === "مرفوض" || n.status === "مطلوب تخفيض" || n.sampleStatus === "مطلوبة" || n.sampleStatus === "تم الاستلام") && !n.readAt
    return !n.read // for invitations and generic
  }).length + unreadChats.length

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
      } else if ((notif.type === "sample_requested" || notif.type === "inquiry_reply" || notif.type === "invitation") && !notif.read && firestore && user) {
        try {
          await updateDoc(doc(firestore, "users", user.uid, "notifications", notif.id), { read: true, readAt: new Date().toISOString() })
        } catch (e) {
          // ignore
        }
      } else if (!notif.readAt && firestore && notif.type === "offer_update") {
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
    } else if (notif.type === "sample_requested") {
      router.push(`/supplier/offers`)
    } else if (notif.type === "inquiry_reply") {
      router.push(`/supplier/rfqs`)
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

  // Block rendering until auth and profile are resolved
  if (isUserLoading || (user && isProfileLoading)) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50/50">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    )
  }

  // Prevent rendering anything if user is not authenticated and is being redirected
  if (!user && pathname !== "/admin/seed") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50/50">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    )
  }

  // Prevent rendering if user is authenticated but not an Admin trying to access /admin
  if (user && pathname.startsWith("/admin") && pathname !== "/admin/seed" && profile?.role !== "Admin") {
    return (
      <div className="flex flex-col h-screen w-full items-center justify-center bg-slate-50/50 p-6 text-center">
        <ShieldCheck className="h-16 w-16 text-destructive mb-4" />
        <h2 className="text-2xl font-bold text-slate-800 mb-2">{tErr("access_denied_title")}</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          {tErr("access_denied_desc")}
        </p>
        <Button onClick={handleLogout} variant="outline">
          {tErr("access_denied_logout")}
        </Button>
      </div>
    )
  }

  return (
    <SidebarProvider>
      <RoleSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-background px-6 shadow-sm">
          <SidebarTrigger />
          
          <div className="flex-1 max-w-md flex">
            <TooltipProvider>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <form onSubmit={handleSearch} className="relative w-full">
                    <Search className={cn("absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground", locale === 'ar' ? 'right-3' : 'left-3')} />
                    <Input 
                      placeholder={t("search_placeholder")}
                      className={cn("bg-muted border-none focus-visible:ring-1", locale === 'ar' ? 'pr-10' : 'pl-10')}
                      value={searchQuery}
                      onChange={handleSearchChange}
                    />
                  </form>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="bg-primary text-primary-foreground border-none">
                  <p className="text-xs font-medium">{t("search_tooltip")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className={cn("flex items-center gap-3", locale === 'ar' ? 'mr-auto' : 'ml-auto')}>
            <LanguageSwitcher />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative text-muted-foreground">
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <span className={cn("absolute top-1.5 h-4 min-w-4 px-0.5 rounded-full bg-destructive text-white text-[9px] font-bold flex items-center justify-center", locale === 'ar' ? 'right-1.5' : 'left-1.5')}>
                      {unreadCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 p-0" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <span className="font-bold text-sm">{t("notifications")}</span>
                  {unreadCount > 0 && (
                    <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded-full font-medium">
                      {t("new_count", { count: unreadCount })}
                    </span>
                  )}
                </div>

                {/* Notification Items */}
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground py-8">
                    <Bell size={28} className="opacity-20" />
                    <p className="text-sm">{t("no_notifications")}</p>
                  </div>
                ) : (
                  <div className="divide-y max-h-72 overflow-y-auto">
                    {notifications.map((notif: any) => {
                      const isNewRfq = notif.type === "new_rfq"
                      const isPending = notif.status === "قيد المراجعة" && notif.type !== "new_rfq"
                      const isAccepted = notif.status === "مقبول" && notif.type !== "new_rfq"
                      const isPriceReduction = notif.status === "مطلوب تخفيض" && notif.type !== "new_rfq"
                      const isSampleRequest = (notif.sampleStatus === "مطلوبة" || notif.type === "sample_requested") && notif.type !== "new_rfq"
                      const isSampleReceived = notif.sampleStatus === "تم الاستلام" && notif.type !== "new_rfq"
                      const isInvitation = notif.type === "invitation"
                      const isInquiryReply = notif.type === "inquiry_reply"
                      const isUnread = isNewRfq 
                        ? !readRfqIds.includes(notif.id)
                        : isInvitation
                          ? !notif.read
                          : notif.type === "sample_requested" || notif.type === "inquiry_reply"
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
                            isInquiryReply ? "bg-success/10 text-success" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {isNewRfq ? <Bell size={14} /> : isSampleReceived ? <CheckCircle2 size={14} /> : isSampleRequest ? <Box size={14} /> : isPending ? <Clock size={14} /> : isPriceReduction ? <TrendingUp className="rotate-180" size={14} /> : isAccepted ? <CheckCircle2 size={14} /> : isInvitation ? <Bell size={14} /> : isInquiryReply ? <MessageSquare size={14} /> : <TrendingUp size={14} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-foreground truncate">
                              {isSupplier
                                ? isNewRfq ? t("notification_new_rfq")
                                  : isSampleReceived ? t("notification_sample_received")
                                  : isSampleRequest ? t("notification_sample_requested")
                                  : isPending ? t("notification_pending")
                                  : isPriceReduction ? t("notification_price_reduction")
                                  : isAccepted ? t("notification_accepted")
                                  : isInvitation ? (notif.title || t("notification_invitation"))
                                  : isInquiryReply ? t("notification_inquiry_reply")
                                  : t("notification_rejected")
                                : isInvitation ? (notif.title || t("notification_invitation"))
                                : t("notification_new_offer")}
                            </p>
                             <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                               {isNewRfq 
                                 ? t("notification_rfq_in_category", { category: notif.category })
                                 : isInvitation
                                   ? (notif.message || "")
                                   : isSampleRequest && notif.type === "sample_requested"
                                     ? (notif.message || "")
                                     : isInquiryReply
                                       ? (notif.description || notif.message || "")
                                       : notif.price
                                         ? t("notification_offer_detail", { price: notif.price, title: notif.rfqTitle || "" })
                                         : (notif.message || notif.description || "")
                               }
                             </p>
                          </div>
                          {isUnread && <div className="h-2 w-2 rounded-full bg-amber-500 shrink-0 mt-1.5" />}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Unread Chat Messages */}
                {unreadChats.length > 0 && (
                  <div className="border-t">
                    {unreadChats.map((chat: any) => (
                      <div
                        key={chat.id}
                        onClick={() => router.push(`/${basePath}/chat/${chat.id}`)}
                        className="flex items-start gap-3 px-4 py-3 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer select-none"
                      >
                        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                          <MessageSquare size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-foreground truncate">{t("notification_new_message")}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            {chat.lastMessage || t("notification_message_in")} — {chat.rfqTitle || t("contract")}
                          </p>
                        </div>
                        <div className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />
                      </div>
                    ))}
                  </div>
                )}

                {/* Footer link */}
                <DropdownMenuSeparator />
                <div className="p-2">
                  <Link href={`/${basePath}/notifications`}>
                    <Button variant="ghost" size="sm" className="w-full text-primary hover:text-primary/80 hover:bg-primary/5">
                      {t("view_all")}
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
                      <span className="text-sm font-bold text-foreground">{profile?.name || (user ? t("new_user") : "")}</span>
                      <span className="text-xs text-muted-foreground">
                        {profile?.role === "Contractor" ? t("role_contractor") : profile?.role === "Supplier" ? t("role_supplier") : profile?.role || t("waiting_setup")}
                      </span>
                    </div>
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <User size={18} />
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => router.push(`/${basePath}/profile`)}>{t("profile")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push(`/${basePath}/profile`)}>{t("settings")}</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive cursor-pointer" onClick={handleLogout}>{t("logout")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>
        
        <main className="flex-1 p-4 md:p-6 overflow-y-auto overflow-x-hidden w-full max-w-[100vw]">
          <div className="mx-auto max-w-7xl">
            {profile && profile.role !== "Admin" && (profile.profileCompleted !== true || !profile.legalDocuments?.cr?.url || !profile.legalDocuments?.vat?.url) && pathname !== `/${profile.role.toLowerCase()}/profile` && (
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                <div className="flex items-center gap-3 text-amber-800">
                  <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
                  <div>
                    <h4 className="font-bold text-sm">{t("profile_banner_title")}</h4>
                    <p className="text-xs text-amber-700 mt-1">{t("profile_banner_desc")}</p>
                  </div>
                </div>
                <Button 
                  onClick={() => router.push(`/${profile.role.toLowerCase()}/profile?tour=true`)}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-bold whitespace-nowrap"
                  size="sm"
                >
                  {t("profile_banner_cta")}
                </Button>
              </div>
            )}
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}