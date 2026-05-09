"use client"

import React, { useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Bell, MessageSquare, TrendingUp, CheckCircle2, Clock, Loader2, Eye } from "lucide-react"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, orderBy, doc, updateDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"

export default function ContractorNotificationsPage() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

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

  // Fetch offers for the contractor's first 10 RFQs
  const rfqIds = rfqs?.slice(0, 10).map((r: any) => r.id) || []

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || rfqIds.length === 0) return null
    return query(
      collection(firestore, "offers"),
      where("rfqId", "in", rfqIds)
    )
  }, [firestore, user, isUserLoading, rfqIds.join(",")])

  const { data: offers, isLoading: offersLoading } = useCollection(offersQuery)

  // Query user's notifications from subcollection (for invitations, etc)
  const userNotificationsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "users", user.uid, "notifications")
    )
  }, [firestore, user, isUserLoading])

  const { data: userNotifications, isLoading: userNotifsLoading, error: notifsError } = useCollection(userNotificationsQuery)

  const isLoading = rfqsLoading || offersLoading || userNotifsLoading

  useEffect(() => {
    if (notifsError) {
      console.error("❌ Contractor notifications error:", notifsError)
      toast({ title: "خطأ في التنبيهات", description: "تعذر تحميل التنبيهات الخاصة بك.", variant: "destructive" })
    }
  }, [notifsError, toast])

  // Build merged notifications list
  const notifications = useMemoFirebase(() => {
    const offersList = (offers || []).map((o: any) => ({ ...o, type: "offer" }))
    const genericList = (userNotifications || []).map((n: any) => ({ 
      ...n, 
      type: n.type || "generic" 
    }))
    
    return [...offersList, ...genericList].sort((a: any, b: any) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bTime - aTime
    })
  }, [offers, userNotifications])

  const markAsRead = async (offerId: string) => {
    if (!firestore) return
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        contractorReadAt: new Date().toISOString()
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
      <div className="space-y-6 text-right">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">مركز التنبيهات</h1>
            <p className="text-muted-foreground mt-1">ابقَ على اطلاع بحالة مناقصاتك وعروض الموردين</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-[10px] bg-slate-100 p-1 rounded border font-mono">
              Raw: {userNotifications?.length || 0} | Err: {notifsError ? "Yes" : "No"}
            </div>
          </div>
        </div>

        <div className="max-w-4xl space-y-3">
          {isLoading ? (
            <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="animate-spin" size={40} />
              <p>جاري تحميل التنبيهات...</p>
            </div>
          ) : !notifications || notifications.length === 0 ? (
            <Card className="border-dashed border-2 border-slate-200 shadow-none">
              <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                <Bell size={48} className="opacity-20" />
                <p className="font-bold text-lg">لا توجد تنبيهات حالياً</p>
                <p className="text-sm">عندما يقدم الموردون عروضاً لمناقصاتك ستظهر هنا فوراً.</p>
              </CardContent>
            </Card>
          ) : (
            notifications.map((notif: any) => {
              if (notif.type === "offer") {
                const offer = notif
                const relatedRfq = rfqs?.find((r: any) => r.id === offer.rfqId)
                const isUnread = offer.status === "قيد المراجعة" && !offer.contractorReadAt
                return (
                  <Card
                    key={offer.id}
                    onClick={() => isUnread && markAsRead(offer.id)}
                    className={`transition-shadow border-none cursor-pointer ${
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
                            {offer.status === "قيد المراجعة" ? "عرض سعر جديد 🔔" :
                             offer.status === "مقبول" ? "عرض سعر مقبول ✅" : "عرض سعر مرفوض ❌"}
                          </p>
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1" suppressHydrationWarning>
                            <Clock size={11} />
                            {offer.createdAt ? new Date(offer.createdAt).toLocaleDateString('ar-SA') : ""}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                          تم تقديم عرض بمبلغ <span className="font-bold text-primary">{offer.price} ر.س</span>
                          {relatedRfq ? ` لمناقصة "${relatedRfq.title}"` : ""}
                        </p>
                      </div>
                      {offer.status === "قيد المراجعة" && (
                        <Link
                          href={`/contractor/rfqs/${offer.rfqId}/offers`}
                          onClick={(e) => { e.stopPropagation(); markAsRead(offer.id) }}
                        >
                          <Button size="sm" className="gap-1 rounded-full shrink-0">
                            <Eye size={14} />
                            مراجعة العرض
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
              const isUnread = !notif.read
              return (
                <Card
                  key={notif.id}
                  className={`transition-shadow border-none cursor-pointer ${
                    isUnread
                      ? "bg-white shadow-sm ring-1 ring-primary/10 hover:shadow-md"
                      : "opacity-70 bg-slate-50 hover:opacity-90"
                  }`}
                >
                  <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 ${isInvitation ? "bg-primary/10 text-primary" : "bg-blue-50 text-blue-600"}`}>
                      {isInvitation ? <Bell size={22} /> : <MessageSquare size={22} />}
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                        <p className="font-bold text-slate-900">{notif.title || "تنبيه جديد"}</p>
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1" suppressHydrationWarning>
                          <Clock size={11} />
                          {notif.createdAt ? new Date(notif.createdAt).toLocaleDateString('ar-SA') : ""}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 mt-1">{notif.message || notif.description}</p>
                      {isInvitation && isUnread && (
                        <div className="pt-2">
                          <Link href="/contractor/team">
                            <Button size="sm" className="h-8 text-xs bg-primary text-white hover:bg-primary/90">
                              الانتقال لصفحة الفريق للقبول
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
            })
          )}
        </div>
      </div>
    </PortalLayout>
  )
}
