"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Bell, CheckCircle2, Clock, Loader2, TrendingUp, XCircle } from "lucide-react"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy, doc, updateDoc } from "firebase/firestore"
import Link from "next/link"

export default function SupplierNotificationsPage() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "offers"),
      where("supplierId", "==", user.uid),
      orderBy("createdAt", "desc")
    )
  }, [firestore, user, isUserLoading])

  const { data: offers, isLoading } = useCollection(offersQuery)

  // Mark a notification as read by stamping readAt on the offer doc
  const markAsRead = async (offerId: string) => {
    if (!firestore) return
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        readAt: new Date().toISOString()
      })
    } catch {
      // silently fail — non-critical
    }
  }

  // An offer is "unread" if it has a decided status AND has no readAt yet
  const isUnread = (offer: any) =>
    (offer.status === "مقبول" || offer.status === "مرفوض") && !offer.readAt

  const getIcon = (status: string) => {
    switch (status) {
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
      default:
        return (
          <div className="h-11 w-11 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
            <TrendingUp size={22} />
          </div>
        )
    }
  }

  const getMessage = (offer: any) => {
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
      default:
        return {
          title: "⏳ عرض قيد المراجعة",
          desc: `تم إرسال عرضك بمبلغ ${offer.price} ر.س لمناقصة "${offer.rfqTitle || "غير محدد"}". في انتظار رد المقاول.`,
        }
    }
  }

  const unreadCount = offers?.filter(isUnread).length || 0

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">الإشعارات</h1>
            <p className="text-muted-foreground mt-1">تابع حالة عروضك المقدمة وردود المقاولين</p>
          </div>
          <div className="flex items-center gap-3">
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
          ) : !offers || offers.length === 0 ? (
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
            offers.map((offer: any) => {
              const msg = getMessage(offer)
              const unread = isUnread(offer)
              const isPending = offer.status === "قيد المراجعة"

              return (
                <Card
                  key={offer.id}
                  onClick={() => unread && markAsRead(offer.id)}
                  className={`border-none shadow-sm transition-all cursor-pointer select-none ${
                    unread
                      ? offer.status === "مقبول"
                        ? "bg-success/5 ring-2 ring-success/30 hover:shadow-md"
                        : "bg-destructive/5 ring-2 ring-destructive/20 hover:shadow-md"
                      : isPending
                      ? "bg-white opacity-75 hover:opacity-100"
                      : "bg-slate-50/70 opacity-60 hover:opacity-80"
                  }`}
                >
                  <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    {getIcon(offer.status)}
                    <div className="flex-1 space-y-1">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <h3 className={`font-bold ${unread ? "text-slate-900" : "text-slate-500"}`}>
                          {msg.title}
                        </h3>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground" suppressHydrationWarning>
                          <Clock size={11} />
                          {offer.createdAt ? new Date(offer.createdAt).toLocaleDateString("ar-SA") : ""}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">{msg.desc}</p>
                      {unread && (
                        <p className="text-[11px] text-muted-foreground mt-1 italic">
                          انقر لتحديد كمقروء ✓
                        </p>
                      )}
                    </div>
                    {/* Unread indicator dot */}
                    {unread && offer.status === "مقبول" && (
                      <div className="h-3 w-3 rounded-full bg-success shrink-0 animate-pulse" />
                    )}
                    {unread && offer.status === "مرفوض" && (
                      <div className="h-3 w-3 rounded-full bg-destructive shrink-0 animate-pulse" />
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
