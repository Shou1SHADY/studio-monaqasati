"use client"

import React, { useEffect } from "react"
import { useTranslations, useLocale } from 'next-intl'
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Bell, MessageSquare, TrendingUp, CheckCircle2, Clock, Loader2, Eye } from "lucide-react"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, orderBy, doc, updateDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Link, useRouter } from "@/i18n/routing"

export default function ContractorNotificationsPage() {
  const router = useRouter()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const t = useTranslations("Portal.Contractor")
  const tSupplier = useTranslations("Portal.Supplier")
  const tLayout = useTranslations("Portal.Layout")
  const locale = useLocale()

  // Fetch all offers for RFQs owned by this contractor
  // We do this by reading offers where rfqId matches any of this contractor's RFQs.
  // Since we can't do cross-collection queries, we fetch offers that were recently created
  // and check the rfqId — the contractor will need to cross-reference.
  // A simple approach: we show all offers from the offers collection where supplierId != user.uid
  // Actually the best is: fetch contractor's rfqs first, then fetch offers for those rfqIds.
  // For now we use the approach of reading all offers that have a createdAt field (limited by rules).
  
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "rfqs"),
      where("organizationId", "==", profile?.organizationId || user.uid)
    )
  }, [firestore, user, isUserLoading, profile?.organizationId])

  const { data: rawRfqs, isLoading: rfqsLoading } = useCollection(rfqsQuery)

  const rfqs = rawRfqs
    ? [...rawRfqs].sort((a: any, b: any) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return bTime - aTime
      })
    : []

  // Fetch all offers directed to this contractor
  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    if (profile?.organizationId) {
      return query(
        collection(firestore, "offers"),
        where("contractorOrgId", "==", profile.organizationId)
      )
    } else {
      return query(
        collection(firestore, "offers"),
        where("contractorId", "==", user.uid)
      )
    }
  }, [firestore, user, isUserLoading, profile?.organizationId])

  const { data: offers, isLoading: offersLoading } = useCollection(offersQuery)

  // Query user's notifications from subcollection (for invitations, etc)
  const userNotificationsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "users", user.uid, "notifications")
    )
  }, [firestore, user, isUserLoading])

  const { data: userNotifications, isLoading: userNotifsLoading, error: notifsError } = useCollection(userNotificationsQuery)

  // Lookup map: rfqId → notification {id, read} for new_offer type
  // Enables bidirectional read-state sync with the mobile app, which tracks read
  // via the `read` field on users/{uid}/notifications docs (not contractorReadAt on offers)
  const newOfferNotifByRfqId = React.useMemo(() => {
    const map: Record<string, { id: string; read: boolean }> = {}
    if (userNotifications) {
      ;(userNotifications as any[])
        .filter((n) => n.type === "new_offer" && n.rfqId)
        .forEach((n) => { map[n.rfqId] = { id: n.id, read: !!n.read } })
    }
    return map
  }, [userNotifications])

  const isLoading = rfqsLoading || offersLoading || userNotifsLoading

  useEffect(() => {
    if (notifsError) {
      console.error("❌ Contractor notifications error:", notifsError)
      toast({ title: t("notif_toast_error_title"), description: t("notif_toast_error_desc"), variant: "destructive" })
    }
  }, [notifsError, toast])

  // Fetch chats for unread chat notifications
  const chatsUnreadQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    const orgValue = profile?.organizationId || user.uid
    return query(
      collection(firestore, "chats"),
      where("contractorOrgId", "==", orgValue)
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

  // Build merged notifications list
  const notifications = useMemoFirebase(() => {
    const offersList = (offers || []).map((o: any) => ({ ...o, type: "offer" }))
    const genericList = (userNotifications || [])
      .filter((n: any) => n.type !== "new_offer")
      .map((n: any) => ({ 
        ...n, 
        type: n.type || "generic" 
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

    return [...offersList, ...genericList].sort((a: any, b: any) => 
      getEventTime(b) - getEventTime(a)
    )
  }, [offers, userNotifications])

  const markAsRead = async (offerId: string, rfqId?: string) => {
    if (!firestore || !user) return
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        contractorReadAt: new Date().toISOString()
      })
      // Also mark the corresponding notification as read so the mobile app
      // sees the updated state immediately via its onSnapshot listener
      const notif = rfqId ? newOfferNotifByRfqId[rfqId] : undefined
      if (notif?.id) {
        await updateDoc(doc(firestore, "users", user.uid, "notifications", notif.id), {
          read: true
        })
      }
    } catch {
      // non-critical, silently fail
    }
  }

  const markNotifAsRead = async (notifId: string) => {
    if (!firestore || !user) return
    try {
      await updateDoc(doc(firestore, "users", user.uid, "notifications", notifId), {
        read: true
      })
    } catch {
      // non-critical, silently fail
    }
  }

  const getIcon = (status: string) => {
    switch (status) {
      case "مقبول": return <CheckCircle2 size={22} />
      case "مرفوض": return <TrendingUp size={22} />
      default: return <MessageSquare size={22} />
    }
  }

  const getColor = (status: string) => {
    switch (status) {
      case "مقبول": return "bg-success/10 text-success"
      case "مرفوض": return "bg-destructive/10 text-destructive"
      default: return "bg-blue-50 text-blue-600"
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("notif_page_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("notif_page_desc")}</p>
          </div>
        </div>

        <div className="max-w-4xl space-y-4 pb-6">
          {isLoading ? (
            <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="animate-spin" size={40} />
              <p>{t("notif_loading")}</p>
            </div>
          ) : (!notifications || notifications.length === 0) && (!unreadChats || unreadChats.length === 0) ? (
            <Card className="border-dashed border-2 border-slate-200 shadow-none">
              <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                <Bell size={48} className="opacity-20" />
                <p className="font-bold text-lg">{t("notif_no_data")}</p>
                <p className="text-sm">{t("notif_no_data_desc")}</p>
              </CardContent>
            </Card>
          ) : (
            <>
            {/* Unread Chat Messages */}
            {unreadChats?.map((chat: any) => (
              <Card
                key={chat.id}
                onClick={() => router.push(`/contractor/chat/${chat.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    router.push(`/contractor/chat/${chat.id}`)
                  }
                }}
                className="border-none shadow-sm transition-all cursor-pointer select-none relative overflow-hidden bg-primary/5 ring-2 ring-primary/20 hover:shadow-md mb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="h-11 w-11 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <MessageSquare size={22} />
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
              if (notif.type === "offer") {
                const offer = notif
                const relatedRfq = rfqs?.find((r: any) => r.id === offer.rfqId)
                // Use notification's `read` field when available — syncs with mobile app.
                // Falls back to contractorReadAt for offers without a corresponding notification.
                const notifForOffer = newOfferNotifByRfqId[offer.rfqId]
                const isUnread = offer.status === "قيد المراجعة" &&
                  (notifForOffer ? !notifForOffer.read : !offer.contractorReadAt)
                return (
                  <Card
                    key={offer.id}
                    onClick={() => isUnread && markAsRead(offer.id, offer.rfqId)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && isUnread) {
                        e.preventDefault()
                        markAsRead(offer.id, offer.rfqId)
                      }
                    }}
                    className={`transition-shadow border-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      isUnread
                        ? "bg-white shadow-sm ring-1 ring-primary/10 hover:shadow-md"
                        : "opacity-70 bg-slate-50 hover:opacity-90"
                    }`}
                  >
                    <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                      <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 ${getColor(offer.status || "قيد المراجعة")}`}>
                        {getIcon(offer.status || "قيد المراجعة")}
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                          <p className="font-bold text-slate-900">
                            {offer.status === "قيد المراجعة" ? t("notif_new_offer") :
                             offer.status === "مقبول" ? t("notif_accepted_offer") : t("notif_rejected_offer")}
                          </p>
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1" suppressHydrationWarning>
                            <Clock size={11} />
                            {offer.createdAt ? new Date(offer.createdAt).toLocaleDateString(locale) : ""}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                          {t("notif_amount", { price: offer.price })}
                          {relatedRfq ? ` ${t("notif_for_tender", { title: relatedRfq.title })}` : ""}
                        </p>
                      </div>
                      {offer.status === "قيد المراجعة" && (
                        <Link
                          href={`/contractor/rfqs/${offer.rfqId}/offers`}
                          onClick={(e) => { e.stopPropagation(); markAsRead(offer.id, offer.rfqId) }}
                        >
                          <Button size="sm" className="gap-1 rounded-full shrink-0">
                            <Eye size={14} />
                            {t("notif_review")}
                          </Button>
                        </Link>
                      )}
                      {offer.status !== "قيد المراجعة" && (
                        <div className="h-2 w-2 rounded-full bg-slate-300 shrink-0" />
                      )}
                      {isUnread && (
                        <div className="h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" />
                      )}
                    </CardContent>
                  </Card>
                )
              }

              // Handle Invitation or other notification types
              const isInvitation = notif.type === "invitation"
              const isSampleSent = notif.type === "sample_sent"
              const isNewChatMessage = notif.type === "new_chat_message"
              const isUnread = !notif.read
              
              const CardContentWrapper = (
                <Card
                  key={notif.id}
                  onClick={() => isUnread && markNotifAsRead(notif.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && isUnread) {
                      e.preventDefault()
                      markNotifAsRead(notif.id)
                    }
                  }}
                  className={`transition-shadow border-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    isUnread
                      ? "bg-white shadow-sm ring-1 ring-primary/10 hover:shadow-md"
                      : "opacity-70 bg-slate-50 hover:opacity-90"
                  }`}
                >
                  <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 ${isInvitation ? "bg-primary/10 text-primary" : isNewChatMessage ? "bg-primary/10 text-primary" : "bg-blue-50 text-blue-600"}`}>
                      {isInvitation ? <Bell size={22} /> : isSampleSent ? <CheckCircle2 size={22} /> : isNewChatMessage ? <MessageSquare size={22} /> : <MessageSquare size={22} />}
                    </div>
                    <div className="flex-1">
                       <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                         <p className="font-bold text-slate-900">
                           {isSampleSent
                             ? tSupplier("sample_sent_notif_title")
                             : isNewChatMessage
                               ? tLayout("notification_new_message")
                               : notif.title || t("notif_new")}
                         </p>
                         <span className="text-[11px] text-muted-foreground flex items-center gap-1" suppressHydrationWarning>
                           <Clock size={11} />
                           {notif.createdAt ? new Date(notif.createdAt).toLocaleDateString(locale) : ""}
                         </span>
                       </div>
                       <p className="text-sm text-slate-500 mt-1">
                         {isSampleSent && notif.rfqId
                           ? tSupplier("sample_sent_notif_msg", { title: notif.rfqTitle || "RFQ" })
                           : isNewChatMessage
                             ? (notif.message || tLayout("notification_message_in"))
                             : notif.message || notif.description}
                       </p>
                      {isInvitation && isUnread && (
                        <div className="pt-2">
                          <Link href="/contractor/team">
                            <Button size="sm" className="h-8 text-xs bg-primary text-white hover:bg-primary/90" onClick={(e) => { e.stopPropagation(); markNotifAsRead(notif.id) }}>
                              {t("notif_go_to_team")}
                            </Button>
                          </Link>
                        </div>
                      )}
                      {isNewChatMessage && notif.chatId && (
                        <div className="pt-2">
                          <Link href={`/contractor/chat/${notif.chatId}`}>
                            <Button size="sm" className="h-8 text-xs bg-primary text-white hover:bg-primary/90" onClick={(e) => { e.stopPropagation(); markNotifAsRead(notif.id) }}>
                              {t("notif_review")}
                            </Button>
                          </Link>
                        </div>
                      )}
                      {!isInvitation && notif.rfqId && (
                        <div className="pt-2">
                           <Link href={`/contractor/rfqs/${notif.rfqId}/offers`} onClick={(e) => { e.stopPropagation(); markNotifAsRead(notif.id) }}>
                            <Button size="sm" variant="outline" className="h-8 text-xs">
                              {t("notif_review")}
                            </Button>
                           </Link>
                        </div>
                      )}
                    </div>
                    {isUnread && (
                      <div className="h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" />
                    )}
                  </CardContent>
                </Card>
              )
              
              return CardContentWrapper;
            })}
            </>
          )}
        </div>
      </div>
    </PortalLayout>
  )
}
