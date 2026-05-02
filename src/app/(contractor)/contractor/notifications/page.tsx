"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Bell, MessageSquare, TrendingUp, CheckCircle2, Clock, Loader2, Eye } from "lucide-react"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy } from "firebase/firestore"
import Link from "next/link"

export default function ContractorNotificationsPage() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  // Fetch all offers for RFQs owned by this contractor
  // We do this by reading offers where rfqId matches any of this contractor's RFQs.
  // Since we can't do cross-collection queries, we fetch offers that were recently created
  // and check the rfqId — the contractor will need to cross-reference.
  // A simple approach: we show all offers from the offers collection where supplierId != user.uid
  // Actually the best is: fetch contractor's rfqs first, then fetch offers for those rfqIds.
  // For now we use the approach of reading all offers that have a createdAt field (limited by rules).
  
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "rfqs"),
      where("contractorId", "==", user.uid),
      orderBy("createdAt", "desc")
    )
  }, [firestore, user, isUserLoading])

  const { data: rfqs, isLoading: rfqsLoading } = useCollection(rfqsQuery)

  // Fetch offers for the contractor's first 10 RFQs
  const rfqIds = rfqs?.slice(0, 10).map((r: any) => r.id) || []

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || rfqIds.length === 0) return null
    return query(
      collection(firestore, "offers"),
      where("rfqId", "in", rfqIds),
      orderBy("createdAt", "desc")
    )
  }, [firestore, user, isUserLoading, rfqIds.join(",")])

  const { data: offers, isLoading: offersLoading } = useCollection(offersQuery)
  const isLoading = rfqsLoading || offersLoading

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
        </div>

        <div className="max-w-4xl space-y-3">
          {isLoading ? (
            <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="animate-spin" size={40} />
              <p>جاري تحميل التنبيهات...</p>
            </div>
          ) : !offers || offers.length === 0 ? (
            <Card className="border-dashed border-2 border-slate-200 shadow-none">
              <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                <Bell size={48} className="opacity-20" />
                <p className="font-bold text-lg">لا توجد تنبيهات حالياً</p>
                <p className="text-sm">عندما يقدم الموردون عروضاً لمناقصاتك ستظهر هنا فوراً.</p>
              </CardContent>
            </Card>
          ) : (
            offers.map((offer: any) => {
              const relatedRfq = rfqs?.find((r: any) => r.id === offer.rfqId)
              return (
                <Card
                  key={offer.id}
                  className={`hover:shadow-md transition-shadow border-none ${
                    offer.status === "قيد المراجعة" ? "bg-white shadow-sm ring-1 ring-primary/10" : "opacity-80"
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
                      <Link href={`/contractor/rfqs/${offer.rfqId}/offers`}>
                        <Button size="sm" className="gap-1 rounded-full shrink-0">
                          <Eye size={14} />
                          مراجعة العرض
                        </Button>
                      </Link>
                    )}
                    {offer.status !== "قيد المراجعة" && (
                      <div className="h-2 w-2 rounded-full bg-slate-300 shrink-0" />
                    )}
                    {offer.status === "قيد المراجعة" && (
                      <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
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
