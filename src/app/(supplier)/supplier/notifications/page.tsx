"use client"

import * as React from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Bell, CheckCircle2, Clock, Loader2, TrendingUp, XCircle, ArrowDown, Box, MessageCircle, Send, Users } from "lucide-react"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, orderBy, doc, updateDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"

export default function SupplierNotificationsPage() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "offers"),
      where("supplierId", "==", user.uid)
    )
  }, [firestore, user, isUserLoading])

  const { data: offers, isLoading } = useCollection(offersQuery)

  // Query user's notifications from subcollection
  const userNotificationsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "users", user.uid, "notifications")
    )
  }, [firestore, user, isUserLoading])

  const { data: userNotifications, isLoading: userNotifsLoading, error: notifsError } = useCollection(userNotificationsQuery)

  React.useEffect(() => {
    if (notifsError) {
      console.error("❌ Notifications query error:", notifsError)
      toast({ title: "خطأ في التنبيهات", description: "تعذر تحميل التنبيهات الخاصة بك.", variant: "destructive" })
    }
  }, [notifsError, toast])

  // Fetch supplier's profile to get specializations for RFQ filtering
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])

  const { data: profile } = useDoc(userDocRef)

  // Fetch new RFQs matching supplier's specializations
  const matchingRfqsQuery = useMemoFirebase(() => {
    if (!profile?.specializations || !firestore) return null
    return query(
      collection(firestore, "rfqs"),
      where("status", "==", "New"),
      where("visibility", "==", "public")
    )
  }, [firestore, profile])

  const { data: rfqs } = useCollection(matchingRfqsQuery)

  // Track read RFQ IDs from localStorage
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

  // Build merged notifications list
  const notifications = React.useMemo(() => {
    const offersList = (offers || []).map((o: any) => ({ ...o, type: "offer" }))
    const rfqsList = (rfqs || [])
      .filter((rfq: any) => profile?.specializations?.includes(rfq.category))
      .map((rfq: any) => ({ ...rfq, type: "new_rfq" }))
    const inquiryList = (userNotifications || []).map((n: any) => ({ 
      ...n, 
      type: n.type || "inquiry_reply" // preserve original type if exists
    }))
    
    return [...offersList, ...rfqsList, ...inquiryList].sort((a: any, b: any) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }, [offers, rfqs, profile, userNotifications])

  // Mark an offer notification as read
  const markAsRead = async (offerId: string) => {
    if (!firestore || !user) return
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        readAt: new Date().toISOString()
      })
    } catch {
      // silently fail — non-critical
    }
  }

  // Mark an inquiry notification as read
  const markInquiryAsRead = async (notificationId: string) => {
    if (!firestore || !user) return
    try {
      await updateDoc(doc(firestore, "users", user.uid, "notifications", notificationId), {
        read: true,
        readAt: new Date().toISOString()
      })
    } catch {
      // silently fail — non-critical
    }
  }

  // Handle clicking on a notification - marks as read and navigates
  const handleNotificationClick = async (notif: any) => {
    // Mark as read if unread
    if (notif.type === "inquiry_reply" && notif.read !== true) {
      await markInquiryAsRead(notif.id)
    } else if (notif.type === "offer" && isUnread(notif)) {
      await markAsRead(notif.id)
    }
  }

  // An offer is "unread" if it has a decided status AND has no readAt yet
  // Also inquiry replies are unread if they don't have read: true
  const isUnread = (offer: any) => {
    if (offer.type === "inquiry_reply" || offer.type === "invitation") {
      return offer.read !== true
    }
    return (offer.status === "مقبول" || offer.status === "مرفوض" || offer.status === "مطلوب تخفيض" || offer.sampleStatus === "مطلوبة" || offer.sampleStatus === "تم الاستلام") && !offer.readAt
  }

  const getIcon = (offer: any) => {
    // Handle inquiry reply notifications
    if (offer.type === "inquiry_reply") {
      return (
        <div className="h-11 w-11 rounded-2xl bg-success/10 flex items-center justify-center text-success shrink-0">
          <MessageCircle size={22} />
        </div>
      )
    }

    // Handle invitation notifications
    if (offer.type === "invitation") {
      return (
        <div className="h-11 w-11 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
          <Users size={22} />
        </div>
      )
    }
    
    switch (offer.status) {
      case "مقبول":
        return (
          <div className="h-11 w-11 rounded-2xl bg-success/10 flex items-center justify-center text-success shrink-0">
            <CheckCircle2 size={22} />
          </div>
        )
      case "مرفوض":
        return (
          <div className="h-11 w-11 rounded-2xl bg-destructive/10 flex items-center justify-center text-destructive shrink-0">
            <XCircle size={22} />
          </div>
        )
      case "مطلوب تخفيض":
        return (
          <div className="h-11 w-11 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
            <ArrowDown size={22} />
          </div>
        )
      default:
        if (offer.sampleStatus === "مطلوبة") {
          return (
            <div className="h-11 w-11 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Box size={22} />
            </div>
          )
        }
        return (
          <div className="h-11 w-11 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
            <TrendingUp size={22} />
          </div>
        )
    }
  }

  const getMessage = (offer: any) => {
    // Handle inquiry reply notifications
    if (offer.type === "inquiry_reply") {
      return {
        title: offer.title || "رد على استفسارك",
        desc: offer.description || offer.message || "لقد وردك رد على استفسارك من المقاول.",
      }
    }

    // Handle invitation notifications
    if (offer.type === "invitation") {
      return {
        title: offer.title || "دعوة للانضمام للفريق",
        desc: offer.message || "لقد تلقيت دعوة للانضمام إلى فريق عمل جديد.",
      }
    }
    
    switch (offer.status) {
      case "مقبول":
        return {
          title: "🎉 تم قبول عرض السعر!",
          desc: `تهانينا! تم قبول عرضك بمبلغ ${offer.price} ر.س للمناقصة "${offer.rfqTitle || "غير محدد"}". يمكنك الآن التواصل مع المقاول.`,
        }
      case "مرفوض":
        return {
          title: "❌ تم رفض العرض",
          desc: `للأسف، تم رفض عرضك للمناقصة "${offer.rfqTitle || "غير محدد"}". يمكنك تصفح مناقصات أخرى.`,
        }
      case "مطلوب تخفيض":
        return {
          title: "📉 مطلوب تخفيض السعر",
          desc: `طلب المقاول تخفيض السعر الذي قدمته للمناقصة "${offer.rfqTitle || "غير محدد"}". قم بتحديث السعر الآن!`,
        }
      default:
        if (offer.sampleStatus === "مطلوبة") {
          return {
            title: "📦 مطلوب عينة",
            desc: `طلب المقاول عينة للعرض المقدم لمناقصة "${offer.rfqTitle || "غير محدد"}". يرجى تأكيد إرسال العينة.`,
          }
        }
        if (offer.sampleStatus === "تم الاستلام") {
          return {
            title: "✅ تم استلام العينة",
            desc: `أكد المقاول استلام العينة التي أرسلتها للمناقصة "${offer.rfqTitle || "غير محدد"}". جاري مراجعة عرضك.`,
          }
        }
        return {
          title: "⏳ عرض قيد المراجعة",
          desc: `تم إرسال عرضك بمبلغ ${offer.price} ر.س لمناقصة "${offer.rfqTitle || "غير محدد"}". في انتظار رد المقاول.`,
        }
    }
  }

  const unreadCount = notifications?.filter((n: any) => 
    n.type === "new_rfq" ? !readRfqIds.includes(n.id) : isUnread(n)
  ).length || 0

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">الإشعارات</h1>
            <p className="text-muted-foreground mt-1">تابع حالة عروضك المقدمة وردود المقاولين</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Debug Info */}
            <div className="text-[10px] bg-slate-100 p-1 rounded border font-mono">
              Raw: {userNotifications?.length || 0} | Err: {notifsError ? "Yes" : "No"}
            </div>
            {unreadCount > 0 && (
              <span className="text-xs bg-destructive/10 text-destructive px-3 py-1 rounded-full font-bold">
                {unreadCount} غير مقروء
              </span>
            )}
            <Link href="/supplier/offers">
              <Button variant="outline" size="sm">عرض كل العروض</Button>
            </Link>
          </div>
        </div>

        <div className="max-w-4xl space-y-3">
          {isLoading ? (
            <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="animate-spin" size={40} />
              <p>جاري تحميل الإشعارات...</p>
            </div>
          ) : !notifications || notifications.length === 0 ? (
            <Card className="border-dashed border-2 border-slate-200 shadow-none">
              <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                <Bell size={48} className="opacity-20" />
                <p className="font-bold text-lg">لا توجد إشعارات حالياً</p>
                <p className="text-sm">عندما تقدم عرضاً وتتلقى رداً من مقاول، ستظهر هنا فوراً.</p>
                <Link href="/supplier/rfqs">
                  <Button size="sm" className="mt-2">تصفح المناقصات المتاحة</Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            notifications.map((notif: any) => {
              const isNewRfq = notif.type === "new_rfq"
              
              if (isNewRfq) {
                const isRfqUnread = !readRfqIds.includes(notif.id)
                return (
                  <Card
                    key={notif.id}
                    onClick={() => isRfqUnread && markRfqAsRead(notif.id)}
                    className={`border-none shadow-sm transition-all cursor-pointer select-none relative overflow-hidden ${
                      isRfqUnread 
                        ? "bg-blue-50/80 ring-2 ring-blue-400 hover:shadow-md"
                        : "bg-slate-50/70 opacity-60 hover:opacity-80"
                    }`}
                  >
                    <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                      <div className="h-11 w-11 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                        <Bell size={22} />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                          <h3 className={`font-bold ${isRfqUnread ? "text-slate-900" : "text-slate-500"}`}>
                            🆕 مناقصة جديدة متطابقة!
                          </h3>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground" suppressHydrationWarning>
                            <Clock size={11} />
                            {notif.createdAt ? new Date(notif.createdAt).toLocaleDateString("ar-SA") : ""}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          تم طرح مناقصة جديدة في قسم {notif.category}
                        </p>
                        {isRfqUnread && (
                          <Link href="/supplier/rfqs" className="inline-flex pt-2">
                            <Button size="sm" variant="outline" className="h-8 text-xs border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-100">
                              عرض المناقصة
                            </Button>
                          </Link>
                        )}
                      </div>
                      {isRfqUnread && (
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-blue-500 shrink-0 animate-pulse" />
                      )}
                    </CardContent>
                  </Card>
                )
              }

              const msg = getMessage(notif)
              const unread = isUnread(notif)
              const isPending = notif.status === "قيد المراجعة"
              const isInquiryReply = notif.type === "inquiry_reply"

              return (
                <Card
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`border-none shadow-sm transition-all cursor-pointer select-none relative overflow-hidden ${
                    unread
                      ? isInquiryReply
                        ? "bg-success/5 ring-2 ring-success/30 hover:shadow-md"
                        : notif.sampleStatus === "مطلوبة"
                        ? "bg-blue-50/80 ring-2 ring-blue-400 hover:shadow-md"
                        : notif.status === "مطلوب تخفيض"
                          ? "bg-amber-50/80 ring-2 ring-amber-400 hover:shadow-md"
                          : notif.status === "مقبول"
                            ? "bg-success/5 ring-2 ring-success/30 hover:shadow-md"
                            : "bg-destructive/5 ring-2 ring-destructive/20 hover:shadow-md"

                      : isPending
                      ? "bg-white opacity-75 hover:opacity-100"
                      : "bg-slate-50/70 opacity-60 hover:opacity-80"
                  }`}
                >
                  <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    {getIcon(notif)}
                    <div className="flex-1 space-y-1">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <h3 className={`font-bold ${unread ? "text-slate-900" : "text-slate-500"}`}>
                          {msg.title}
                        </h3>
                        <div className="flex items-center gap-3">
                          {(notif.sampleStatus === "مطلوبة" || notif.status === "مطلوب تخفيض") && unread && (
                            <span className="bg-red-100 text-red-600 text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse">
                              إجراء مطلوب!
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-xs text-muted-foreground" suppressHydrationWarning>
                            <Clock size={11} />
                            {notif.createdAt ? new Date(notif.createdAt).toLocaleDateString("ar-SA") : ""}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">{msg.desc}</p>
                      
                      {/* Action Links */}
                      {(notif.sampleStatus === "مطلوبة" || notif.status === "مطلوب تخفيض") && (
                        <div className="pt-2">
                          <Link href="/supplier/offers" className="inline-flex">
                            <Button size="sm" variant="outline" className={`h-8 text-xs ${notif.sampleStatus === "مطلوبة" ? "border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-100" : "border-amber-200 text-amber-700 bg-amber-50/50 hover:bg-amber-100"}`}>
                              الانتقال للعروض للرد
                            </Button>
                          </Link>
                        </div>
                      )}

                      {unread && !(notif.sampleStatus === "مطلوبة" || notif.status === "مطلوب تخفيض" || notif.type === "invitation") && (
                        <p className="text-[11px] text-muted-foreground mt-1 italic">
                          انقر لتحديد كمقروء ✓
                        </p>
                      )}

                      {unread && notif.type === "invitation" && (
                        <div className="pt-2">
                          <Link href={`/${profile?.role?.toLowerCase()}/team`} className="inline-flex">
                            <Button size="sm" className="h-8 text-xs bg-primary text-white hover:bg-primary/90">
                              الانتقال لصفحة الفريق للقبول
                            </Button>
                          </Link>
                        </div>
                      )}
                    </div>
                    {/* Unread indicator dot */}
                    {unread && notif.sampleStatus === "تم الاستلام" && (
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-success shrink-0 animate-pulse" />
                    )}
                    {unread && notif.sampleStatus === "مطلوبة" && (
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-blue-500 shrink-0 animate-pulse" />
                    )}
                    {unread && notif.status === "مطلوب تخفيض" && (
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-amber-500 shrink-0 animate-pulse" />
                    )}
                    {unread && notif.status === "مقبول" && (
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-success shrink-0 animate-pulse" />
                    )}
                    {unread && notif.status === "مرفوض" && (
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-destructive shrink-0 animate-pulse" />
                    )}
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      </div>
    </PortalLayout>
  )
}
