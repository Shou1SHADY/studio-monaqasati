"use client"

import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc } from "firebase/firestore"
import { Loader2, PackageCheck, Calendar, Truck, Building2, FileText, ArrowRight } from "lucide-react"

function fmtDate(val: unknown, locale: string) {
  if (!val) return "–"
  const d =
    val && typeof val === "object" && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date(val as string | number)
  if (isNaN(d.getTime())) return "–"
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

type Delivery = {
  id: string
  rfqTitle?: string
  supplierName?: string
  deliveryPersonName?: string
  handoverRecipientName?: string
  receivedByName?: string
  deliveryDate?: string
  confirmedAt?: unknown
  status?: string
  contractorOrgId?: string
}

export default function GoodsReceivedPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const typedProfile = profile as { organizationId?: string } | null
  const myOrgId = typedProfile?.organizationId || user?.uid

  const deliveriesQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !myOrgId) return null
    return query(
      collection(firestore, "deliveries"),
      where("contractorOrgId", "==", myOrgId),
      where("status", "==", "confirmed")
    )
  }, [firestore, user, isUserLoading, myOrgId])

  const { data: deliveries, isLoading } = useCollection(deliveriesQuery)
  const confirmedDeliveries = ((deliveries || []) as Delivery[]).sort((a, b) => {
    const aTime = a.confirmedAt
      ? (typeof a.confirmedAt === "object" && "toDate" in a.confirmedAt
          ? (a.confirmedAt as { toDate: () => Date }).toDate().getTime()
          : new Date(a.confirmedAt as string).getTime())
      : 0
    const bTime = b.confirmedAt
      ? (typeof b.confirmedAt === "object" && "toDate" in b.confirmedAt
          ? (b.confirmedAt as { toDate: () => Date }).toDate().getTime()
          : new Date(b.confirmedAt as string).getTime())
      : 0
    return bTime - aTime
  })

  const pageLoading = isUserLoading || (isLoading && !deliveries)

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-black text-foreground font-headline">{t("goods_title")}</h1>
          <p className="text-muted-foreground mt-1">{t("goods_desc")}</p>
        </div>

        {pageLoading ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="animate-spin text-muted-foreground" size={40} />
          </div>
        ) : confirmedDeliveries.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
            <PackageCheck size={48} className="text-muted-foreground/30" />
            <div>
              <p className="text-muted-foreground font-medium">{t("goods_empty")}</p>
              <p className="text-sm text-muted-foreground mt-1">{t("goods_empty_desc")}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {confirmedDeliveries.map((delivery) => (
              <Card key={delivery.id} className="border-success/20 bg-success/5 hover:shadow-md transition-shadow">
                <CardContent className="p-5" dir={isRtl ? "rtl" : "ltr"}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    {/* Icon */}
                    <div className="h-12 w-12 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
                      <PackageCheck size={22} className="text-success" />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <p className="text-[11px] font-bold text-slate-400 uppercase mb-0.5 flex items-center gap-1">
                          <FileText size={11} />
                          {t("goods_rfq")}
                        </p>
                        <p className="font-bold text-slate-800 text-sm truncate">{delivery.rfqTitle || "—"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-bold text-slate-400 uppercase mb-0.5 flex items-center gap-1">
                          <Building2 size={11} />
                          {t("goods_supplier")}
                        </p>
                        <p className="font-semibold text-slate-700 text-sm truncate">{delivery.supplierName || "—"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-bold text-slate-400 uppercase mb-0.5 flex items-center gap-1">
                          <Truck size={11} />
                          {t("goods_handover_by")}
                        </p>
                        <p className="text-slate-700 text-sm truncate">{delivery.deliveryPersonName || "—"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-bold text-slate-400 uppercase mb-0.5 flex items-center gap-1">
                          <Calendar size={11} />
                          {t("goods_confirmed_at")}
                        </p>
                        <p className="text-slate-700 text-sm" suppressHydrationWarning>
                          {fmtDate(delivery.confirmedAt, locale)}
                        </p>
                      </div>
                    </div>

                    {/* Right side */}
                    <div className="flex flex-col sm:items-end gap-2 shrink-0">
                      <Badge className="bg-success/10 text-success border-success/20 text-xs font-bold w-fit">
                        ✓ {locale === "ar" ? "مؤكد" : "Confirmed"}
                      </Badge>
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="gap-1.5 border-success/30 text-success hover:bg-success hover:text-white hover:border-success"
                      >
                        <Link href={`/contractor/receipts/${delivery.id}`} className="flex items-center gap-1.5">
                          <FileText size={14} />
                          {t("goods_view_receipt")}
                          <ArrowRight size={13} className={cn(isRtl ? "rotate-180" : "")} />
                        </Link>
                      </Button>
                    </div>
                  </div>

                  {/* Handover recipient if set */}
                  {(delivery.handoverRecipientName || delivery.receivedByName) && (
                    <div className={cn("mt-3 pt-3 border-t border-success/10 text-xs text-slate-500", isRtl ? "text-right" : "")}>
                      <span className="font-bold">{t("goods_received_by")}:</span>{" "}
                      {delivery.handoverRecipientName || delivery.receivedByName}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  )
}
