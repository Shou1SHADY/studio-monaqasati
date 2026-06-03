"use client"

import * as React from "react"
import { useTranslations, useLocale } from 'next-intl'
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Bell, CheckCircle2, Clock, Loader2, TrendingUp, XCircle, ArrowDown, Box, MessageCircle, Send, Users } from "lucide-react"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, orderBy, doc, updateDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Link, useRouter } from "@/i18n/routing"

export default function SupplierNotificationsPage() {
  const t = useTranslations("Portal.Supplier")
  const tLayout = useTranslations("Portal.Layout")
  const locale = useLocale()
  const router = useRouter()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

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
      toast({ title: t("notifications_error_title"), description: t("notifications_error_desc"), variant: "destructive" })
    }
  }, [notifsError, toast])

  // Fetch supplier's profile to get specializations for RFQ filtering
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])

  const { data: profile } = useDoc(userDocRef)

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    if (profile?.organizationId) {
      return query(
        collection(firestore, "offers"),
        where("organizationId", "==", profile.organizationId)
      )
    } else {
      return query(
        collection(firestore, "offers"),
        where("supplierId", "==", user.uid)
      )
    }
  }, [firestore, user, isUserLoading, profile?.organizationId])

  const { data: offers, isLoading } = useCollection(offersQuery)


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

  // Fetch chats for unread chat notifications
  const chatsUnreadQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    const orgValue = profile?.organizationId || user.uid
    return query(
      collection(firestore, "chats"),
      where("supplierOrgId", "==", orgValue)
    )
  }, [firestore, user, isUserLoading, profile?.organizationId])

  const { data: allMyChats } = useCollection(chatsUnreadQuery)

  // Chats that have an unread message for this specific user
  const unreadChats = React.useMemo(() => {
    if (!allMyChats || !user) return []
    return allMyChats.filter((chat: any) =>
      Array.isArray(chat.unreadFor) && chat.unreadFor.includes(user.uid)
    )
  }, [allMyChats, user])

  // Track read RFQ IDs from localStorage
  const [readRfqIds, setReadRfqIds] = React.useState<string[]>([])
  React.useEffect(() => {
    const loadIds = () => {
      try {
        const stored = localStorage.getItem("readRfqIds")
        if (stored) setReadRfqIds(JSON.parse(stored))
      } catch (e) {}
    }
    loadIds()
    window.addEventListener('readRfqIdsUpdated', loadIds)
    return () => window.removeEventListener('readRfqIdsUpdated', loadIds)
  }, [])

  const markRfqAsRead = (rfqId: string) => {
    const updated = [...new Set([...readRfqIds, rfqId])]
    setReadRfqIds(updated)
    localStorage.setItem("readRfqIds", JSON.stringify(updated))
    window.dispatchEvent(new Event('readRfqIdsUpdated'))
  }

  // Build merged notifications list
  const notifications = React.useMemo(() => {
    const offersList = (offers || [])
      .map((o: any) => ({ ...o, type: "offer" }))
      .filter((offer: any) => {
        // Prevent duplicate notifications if a subcollection notification already exists for this event
        const hasAccepted = (userNotifications || []).some((n: any) => n.offerId === offer.id && n.type === "offer_accepted");
        const hasRejected = (userNotifications || []).some((n: any) => n.offerId === offer.id && n.type === "offer_rejected");
        const hasReduction = (userNotifications || []).some((n: any) => n.offerId === offer.id && n.type === "price_reduction");
        const hasSampleRequested = (userNotifications || []).some((n: any) => n.offerId === offer.id && n.type === "sample_requested");
        
        if (offer.status === "مقبول" && hasAccepted) return false;
        if (offer.status === "مرفوض" && hasRejected) return false;
        if (offer.status === "مطلوب تخفيض" && hasReduction) return false;
        if (offer.sampleStatus === "مطلوبة" && hasSampleRequested) return false;
        
        return true;
      });

    const rfqsList = (rfqs || [])
      .filter((rfq: any) => {
        if (!profile?.specializations?.includes(rfq.category)) return false
        if (rfq.deadline) {
          const deadline = new Date(rfq.deadline)
          const now = new Date()
          now.setHours(0, 0, 0, 0)
          if (deadline < now) return false
        }
        return true
      })
      .map((rfq: any) => ({ ...rfq, type: "new_rfq" }))
      
    const inquiryList = (userNotifications || []).map((n: any) => ({ 
      ...n, 
      type: n.type || "inquiry_reply", // preserve original type if exists
      isSubcollection: true
    }))
    
    const getEventTime = (n: any) => {
      const dates = [
        n.createdAt,
        n.updatedAt,
        n.decidedAt,
        n.sampleUpdatedAt,
        n.completedAt
      ].filter(Boolean).map((d: any) => new Date(d).getTime());
      return dates.length > 0 ? Math.max(...dates) : 0;
    };

    return [...offersList, ...rfqsList, ...inquiryList].sort((a: any, b: any) => 
      getEventTime(b) - getEventTime(a)
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
    if (notif.isSubcollection && notif.read !== true) {
      await markInquiryAsRead(notif.id)
    } else if (notif.type === "offer" && isUnread(notif)) {
      await markAsRead(notif.id)
    }
  }

  const isUnread = (offer: any) => {
    if (offer.isSubcollection) {
      return offer.read !== true
    }
    return (offer.status === "مقبول" || offer.status === "مرفوض" || offer.status === "مطلوب تخفيض" || offer.sampleStatus === "مطلوبة" || offer.sampleStatus === "تم الاستلام") && !offer.readAt
  }

  const getIcon = (offer: any) => {
    const type = offer.type;
    const status = offer.status;
    const sampleStatus = offer.sampleStatus;

    if (type === "inquiry_reply") return <div className="h-11 w-11 rounded-2xl bg-success/10 flex items-center justify-center text-success shrink-0"><MessageCircle size={22} /></div>;
    if (type === "invitation") return <div className="h-11 w-11 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0"><Users size={22} /></div>;
    if (type === "offer_accepted" || status === "مقبول") return <div className="h-11 w-11 rounded-2xl bg-success/10 flex items-center justify-center text-success shrink-0"><CheckCircle2 size={22} /></div>;
    if (type === "offer_rejected" || status === "مرفوض") return <div className="h-11 w-11 rounded-2xl bg-destructive/10 flex items-center justify-center text-destructive shrink-0"><XCircle size={22} /></div>;
    if (type === "price_reduction" || status === "مطلوب تخفيض") return <div className="h-11 w-11 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0"><ArrowDown size={22} /></div>;
    if (type === "sample_requested" || sampleStatus === "مطلوبة") return <div className="h-11 w-11 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-600 shrink-0"><Box size={22} /></div>;
    if (sampleStatus === "تم الاستلام") return <div className="h-11 w-11 rounded-2xl bg-success/10 flex items-center justify-center text-success shrink-0"><CheckCircle2 size={22} /></div>;
    
    return <div className="h-11 w-11 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shrink-0"><TrendingUp size={22} /></div>;
  }

  const getMessage = (offer: any) => {
    const type = offer.type;
    const status = offer.status;
    const sampleStatus = offer.sampleStatus;

    // Sanitize titles that were accidentally stored as translation key paths
    const sanitizeTitle = (raw: string | undefined) => {
      if (!raw) return undefined
      if (raw.startsWith("Portal.") || raw.includes("MISSING_MESSAGE")) return undefined
      return raw
    }

    if (type === "inquiry_reply") return { title: sanitizeTitle(offer.title) || t("inquiry_reply_title"), desc: offer.description || offer.message || t("inquiry_reply_desc") };
    if (type === "invitation") return { title: sanitizeTitle(offer.title) || t("invitation_title"), desc: offer.message || t("invitation_desc") };
    if (type === "sample_sent") return { title: "📦 تم إرسال العينة من المورد", desc: sanitizeTitle(offer.message) || `تم إرسال العينة لمناقصة: ${offer.rfqTitle || ""}. يرجى تأكيد الاستلام.` };
    if (type === "offer_accepted" || status === "مقبول") return { title: t("accepted_offer"), desc: offer.message || t("accepted_offer_desc", { price: offer.price, title: offer.rfqTitle || t("offer_undefined") }) };
    if (type === "offer_rejected" || status === "مرفوض") return { title: t("rejected_offer"), desc: offer.message || t("rejected_offer_desc", { title: offer.rfqTitle || t("offer_undefined") }) };
    if (type === "price_reduction" || status === "مطلوب تخفيض") return { title: t("price_reduction"), desc: offer.message || t("price_reduction_desc", { title: offer.rfqTitle || t("offer_undefined") }) };
    if (type === "sample_requested" || sampleStatus === "مطلوبة") return { title: t("sample_required"), desc: offer.message || t("sample_required_desc", { title: offer.rfqTitle || t("offer_undefined") }) };
    if (sampleStatus === "تم الاستلام") return { title: t("sample_received"), desc: t("sample_received_desc", { title: offer.rfqTitle || t("offer_undefined") }) };
    
    return { title: t("pending_review_notif"), desc: t("pending_review_notif_desc", { price: offer.price, title: offer.rfqTitle || t("offer_undefined") }) };
  }

  const unreadCount = (notifications?.filter((n: any) => 
    n.type === "new_rfq" ? !readRfqIds.includes(n.id) : isUnread(n)
  ).length || 0) + (unreadChats?.length || 0)

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">{t("notifications_page_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("notifications_page_desc")}</p>
          </div>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <span className="text-xs bg-destructive/10 text-destructive px-3 py-1 rounded-full font-bold">
                {t("unread_count", { count: unreadCount })}
              </span>
            )}
            <Link href="/supplier/offers">
              <Button variant="outline" size="sm">{t("view_all_offers")}</Button>
            </Link>
          </div>
        </div>

        <div className="max-w-4xl space-y-4 pb-6">
          {isLoading ? (
            <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="animate-spin" size={40} />
              <p>{t("loading_notifications")}</p>
            </div>
          ) : (!notifications || notifications.length === 0) && (!unreadChats || unreadChats.length === 0) ? (
            <Card className="border-dashed border-2 border-slate-200 shadow-none">
              <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                <Bell size={48} className="opacity-20" />
                <p className="font-bold text-lg">{t("no_notifications")}</p>
                <p className="text-sm">{t("no_notifications_desc")}</p>
                <Link href="/supplier/rfqs">
                  <Button size="sm" className="mt-2">{t("browse_available_tenders")}</Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <>
            {/* Unread Chat Messages */}
            {unreadChats?.map((chat: any) => (
              <Card
                key={chat.id}
                onClick={() => router.push(`/supplier/chat/${chat.id}`)}
                className="border-none shadow-sm transition-all cursor-pointer select-none relative overflow-hidden bg-primary/5 ring-2 ring-primary/20 hover:shadow-md mb-4"
              >
                <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="h-11 w-11 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <MessageCircle size={22} />
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                      <h3 className="font-bold text-slate-900">
                        {tLayout("notification_new_message")}
                      </h3>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {chat.lastMessage || tLayout("notification_message_in")} — {chat.rfqTitle || tLayout("contract")}
                    </p>
                  </div>
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-primary shrink-0 animate-pulse" />
                </CardContent>
              </Card>
            ))}

            {notifications.map((notif: any) => {
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
                            {t("new_rfq_title")}
                          </h3>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground" suppressHydrationWarning>
                            <Clock size={11} />
                            {notif.createdAt ? new Date(notif.createdAt).toLocaleDateString(locale) : ""}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          {t("new_rfq_desc", { category: notif.category })}
                        </p>
                        {isRfqUnread && (
                          <Link href="/supplier/rfqs" className="inline-flex pt-2">
                            <Button size="sm" variant="outline" className="h-8 text-xs border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-100">
                              {t("view_tender")}
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
              const isPending = notif.status === "قيد المراجعة" && notif.type !== "price_reduction" && notif.type !== "offer_accepted" && notif.type !== "offer_rejected"
              const isInquiryReply = notif.type === "inquiry_reply"
              const isActionRequired = notif.type === "price_reduction" || notif.status === "مطلوب تخفيض" || notif.type === "sample_requested" || notif.sampleStatus === "مطلوبة"

              return (
                <Card
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`border-none shadow-sm transition-all cursor-pointer select-none relative overflow-hidden ${
                    unread
                      ? isInquiryReply
                        ? "bg-success/5 ring-2 ring-success/30 hover:shadow-md"
                        : (notif.type === "sample_requested" || notif.sampleStatus === "مطلوبة")
                        ? "bg-blue-50/80 ring-2 ring-blue-400 hover:shadow-md"
                        : (notif.type === "price_reduction" || notif.status === "مطلوب تخفيض")
                          ? "bg-amber-50/80 ring-2 ring-amber-400 hover:shadow-md"
                          : (notif.type === "offer_accepted" || notif.status === "مقبول")
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
                          {isActionRequired && unread && (
                            <span className="bg-red-100 text-red-600 text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse">
                              {t("action_required")}
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-xs text-muted-foreground" suppressHydrationWarning>
                            <Clock size={11} />
                            {notif.createdAt ? new Date(notif.createdAt).toLocaleDateString(locale) : ""}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">{msg.desc}</p>
                      
                      {/* Action Links */}
                      {isActionRequired && (
                        <div className="pt-2">
                          <Link href="/supplier/offers" className="inline-flex">
                            <Button size="sm" variant="outline" className={`h-8 text-xs ${(notif.type === "sample_requested" || notif.sampleStatus === "مطلوبة") ? "border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-100" : "border-amber-200 text-amber-700 bg-amber-50/50 hover:bg-amber-100"}`}>
                              {t("go_to_offers")}
                            </Button>
                          </Link>
                        </div>
                      )}

                      {unread && !isActionRequired && notif.type !== "invitation" && (
                        <p className="text-[11px] text-muted-foreground mt-1 italic">
                          {t("click_to_mark_read")}
                        </p>
                      )}

                      {unread && notif.type === "invitation" && (
                        <div className="pt-2">
                          <Link href={`/${profile?.role?.toLowerCase()}/team`} className="inline-flex">
                            <Button size="sm" className="h-8 text-xs bg-primary text-white hover:bg-primary/90">
                              {t("go_to_team")}
                            </Button>
                          </Link>
                        </div>
                      )}
                    </div>
                    {/* Unread indicator dot */}
                    {unread && notif.sampleStatus === "تم الاستلام" && (
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-success shrink-0 animate-pulse" />
                    )}
                    {unread && (notif.type === "sample_requested" || notif.sampleStatus === "مطلوبة") && (
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-blue-500 shrink-0 animate-pulse" />
                    )}
                    {unread && (notif.type === "price_reduction" || notif.status === "مطلوب تخفيض") && (
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-amber-500 shrink-0 animate-pulse" />
                    )}
                    {unread && (notif.type === "offer_accepted" || notif.status === "مقبول") && (
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-success shrink-0 animate-pulse" />
                    )}
                    {unread && (notif.type === "offer_rejected" || notif.status === "مرفوض") && (
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-destructive shrink-0 animate-pulse" />
                    )}
                  </CardContent>
                </Card>
              )
            })
            }
            </>
          )}
          </div>
        </div>
    </PortalLayout>
  )
}
