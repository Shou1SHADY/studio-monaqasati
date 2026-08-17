
"use client"

import { useTranslations, useLocale } from 'next-intl'
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ClipboardList, Truck, PackageCheck, MapPin, MoreHorizontal, Eye, Clock, Calendar, Tag, DollarSign, User, MapPinned, Star } from "lucide-react"
import { useState } from "react"
import { collection, query, where, orderBy, doc } from "firebase/firestore"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useDoc, useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { ReviewDialog } from "@/components/ReviewDialog"
import { useToast } from "@/hooks/use-toast"
import { useActiveCompanyName } from "@/hooks/useActiveCompanyName"
import { cn } from "@/lib/utils"

export default function SupplierOrdersPage() {
  const t = useTranslations("Portal.Supplier")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const activeCompanyName = useActiveCompanyName(profile, user?.uid)
  const [reviewOrder, setReviewOrder] = useState<any | null>(null)
  const { toast } = useToast()

  const exportToCSV = () => {
    if (!orders || orders.length === 0) {
      toast({ title: t("export_warning_title"), description: t("export_warning_desc"), variant: "destructive" });
      return;
    }
    
    const escapeCsv = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`

    const headers = [
      t("order_id_header"),
      t("contract_date"),
      t("client_header"),
      t("city"),
      t("contract_value"),
      t("status_header"),
    ]
    
    const translateStatus = (status: string) => {
      switch (status) {
        case "مقبول": case "Accepted": case "accepted": return t("accepted_status")
        case "جاري التوصيل": return t("in_delivery_status")
        case "تم التسليم": return t("delivered_status")
        case "قيد التجهيز": return t("processing_status")
        default: return status
      }
    }

    const fallback = "—"
    const rows = orders.map((o: any) => {
      const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString(locale) : fallback;
      return [
        escapeCsv(o.id),
        escapeCsv(date),
        escapeCsv(o.contractorName || fallback),
        escapeCsv(o.deliveryLocation || o.rfqCity || fallback),
        escapeCsv(o.price ?? fallback),
        escapeCsv(translateStatus(o.status)),
      ].join(",");
    });

    const bom = '\uFEFF'
    const csvString = bom + headers.map(escapeCsv).join(",") + "\n" + rows.join("\n")
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `orders_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({ title: t("export_success"), description: t("export_success_desc") });
  }

  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const ordersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    if (profile?.organizationId) {
      return query(
        collection(firestore, "offers"),
        where("organizationId", "==", profile.organizationId)
      )
    }
    return query(
      collection(firestore, "offers"),
      where("supplierId", "==", user.uid)
    )
  }, [firestore, user, isUserLoading, profile?.organizationId])

  const { data: allOffers, isLoading: isCollectionLoading } = useCollection(ordersQuery)
  const isLoading = isUserLoading || isCollectionLoading

  // Filter and Sort in memory to avoid index requirements
  const orders = (allOffers || [])
    .filter((o: any) => 
      ["مقبول", "Accepted", "accepted", "جاري التوصيل", "تم التسليم", "قيد التجهيز"].includes(o.status)
    )
    .sort((a: any, b: any) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return dateB - dateA
    })

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "جاري التوصيل": return <Badge className="bg-blue-50 text-blue-600 border-blue-100">{t("in_delivery_status")}</Badge>
      case "تم التسليم": return <Badge className="bg-success/10 text-success border-success/20">{t("delivered_status")}</Badge>
      case "قيد التجهيز": return <Badge className="bg-amber-50 text-amber-600 border-amber-100">{t("processing_status")}</Badge>
      case "مقبول":
      case "Accepted": return <Badge className="bg-green-50 text-green-600 border-green-100">{t("accepted_status")}</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  // Stats from real data
  const preparingCount = orders.filter((o: any) => o.status === "قيد التجهيز" || o.status === "مقبول" || o.status === "Accepted").length
  const shippingCount = orders.filter((o: any) => o.status === "جاري التوصيل").length
  const completedCount = orders.filter((o: any) => o.status === "تم التسليم").length

  return (
    <PortalLayout>
      <div className={cn("space-y-6", locale === 'ar' ? 'text-right' : 'text-left')}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("orders_page_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("orders_page_desc")}</p>
          </div>
          <Button className="gap-2" onClick={exportToCSV}>
            <ClipboardList size={18} />
            {t("export_report")}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-white border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-50 flex items-center justify-center text-amber-500">
                <PackageCheck size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("in_preparation")}</p>
                <p className="text-2xl font-bold">{preparingCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500">
                <Truck size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("in_delivery")}</p>
                <p className="text-2xl font-bold">{shippingCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-success/10 flex items-center justify-center text-success">
                <ClipboardList size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("completed")}</p>
                <p className="text-2xl font-bold">{completedCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-none shadow-sm">
          <CardHeader className="border-b bg-white">
            <CardTitle className="text-lg">{t("active_orders_title")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("order_id_header")}</TableHead>
                  <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("client_header")}</TableHead>
                  <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("product_quantity_header")}</TableHead>
                  <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("location_header")}</TableHead>
                  <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("status_header")}</TableHead>
                  <TableHead className={locale === 'ar' ? 'text-right' : 'text-left'}>{t("actions_header")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      {t("loading")}
                    </TableCell>
                  </TableRow>
                ) : orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      {t("no_active_orders")}
                    </TableCell>
                  </TableRow>
                ) : orders.map((order: any) => (
                  <TableRow key={order.id} className="hover:bg-slate-50/50">
                    <TableCell className={cn("font-mono text-xs font-bold", locale === 'ar' ? 'text-right' : 'text-left')}>{order.id.substring(0, 8)}</TableCell>
                    <TableCell className={locale === 'ar' ? 'text-right' : 'text-left'}>{order.contractorName || t("client_value")}</TableCell>
                    <TableCell className={locale === 'ar' ? 'text-right' : 'text-left'}>
                      <div className="flex flex-col items-start">
                        <span className="font-medium">{order.rfqTitle}</span>
                        <span className="text-xs text-muted-foreground">{order.price} {t("sar")}</span>
                      </div>
                    </TableCell>
                    <TableCell className={locale === 'ar' ? 'text-right' : 'text-left'}>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground justify-start">
                        <MapPin size={12} />
                        {order.deliveryLocation || t("not_specified_label")}
                      </div>
                    </TableCell>
                    <TableCell className={locale === 'ar' ? 'text-right' : 'text-left'}>{getStatusBadge(order.status)}</TableCell>
                    <TableCell className={locale === 'ar' ? 'text-right' : 'text-left'}>
                      <div className="flex items-center gap-2 justify-start">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-secondary hover:bg-slate-100" 
                          title={t("view_order_tooltip")}
                          onClick={() => setSelectedOrder(order)}
                        >
                          <Eye size={16} />
                        </Button>
                        {order.status === "تم التسليم" && (
                          order.supplierRated ? (
                            <Badge className="bg-slate-100 text-slate-400 border-none text-[10px] py-1.5 font-bold">
                              {t("rated_badge")}
                            </Badge>
                          ) : (
                            <Button
                              onClick={() => setReviewOrder(order)}
                              className="bg-amber-500 hover:bg-amber-600 text-white rounded-lg h-7 px-2.5 text-xs font-bold gap-1 transition-all shadow-sm shadow-amber-500/10"
                              size="sm"
                            >
                              <Star size={12} className="fill-white" />
                              {t("rate_client")}
                            </Button>
                          )
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className={cn("sm:max-w-2xl w-[95vw] p-6 max-h-[90vh] overflow-y-auto rounded-[2rem] border-slate-100 shadow-2xl", locale === 'ar' ? 'text-right' : 'text-left')} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader className="pb-6 border-b border-slate-100 relative pt-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-primary shrink-0 border border-primary/10 shadow-sm">
                  <ClipboardList size={24} />
                </div>
                <div>
                  <DialogTitle className="text-xl sm:text-2xl font-black text-slate-800">{t("order_details_title")}</DialogTitle>
                  <DialogDescription className="text-sm font-medium mt-1">
                    #{selectedOrder?.id?.substring(0, 12)}
                  </DialogDescription>
                </div>
              </div>
              {selectedOrder && (
                <div className="mr-auto">
                  {getStatusBadge(selectedOrder.status)}
                </div>
              )}
            </div>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-3 py-4">
              {/* Price Hero */}
              <div className="bg-gradient-to-l from-primary/5 to-blue-50 rounded-2xl p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium mb-1 flex items-center gap-1">
                    <DollarSign size={12} /> {t("contract_value")}
                  </p>
                  <p className="text-3xl font-black text-primary leading-none">
                    {selectedOrder.price}
                    <span className="text-base font-bold text-muted-foreground mr-1">{t("sar")}</span>
                  </p>
                </div>
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                  <DollarSign size={26} />
                </div>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-slate-50 rounded-xl space-y-1.5 border border-slate-100">
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider flex items-center gap-1">
                    <Calendar size={10} /> {t("contract_date")}
                  </p>
                  <p className="font-bold text-sm" suppressHydrationWarning>
                    {selectedOrder.createdAt
                      ? new Date(selectedOrder.createdAt).toLocaleDateString(locale)
                      : "—"}
                  </p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl space-y-1.5 border border-slate-100">
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider flex items-center gap-1">
                    <Clock size={10} /> {t("last_updated")}
                  </p>
                  <p className="font-bold text-sm" suppressHydrationWarning>
                    {selectedOrder.updatedAt
                      ? new Date(selectedOrder.updatedAt).toLocaleDateString(locale)
                      : "—"}
                  </p>
                </div>
              </div>

              {/* Details List */}
              <div className="space-y-2">
                <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-100 flex items-center justify-center text-primary shrink-0 mt-0.5">
                    <Tag size={14} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-1">{t("tender_info")}</p>
                    <p className="font-bold text-sm leading-snug">{selectedOrder.rfqTitle || "—"}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-100 flex items-center justify-center text-primary shrink-0 mt-0.5">
                    <User size={14} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-1">{t("client_info")}</p>
                    <p className="font-bold text-sm">{selectedOrder.contractorName || t("client_value")}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-100 flex items-center justify-center text-primary shrink-0 mt-0.5">
                    <MapPinned size={14} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-1">{t("delivery_location")}</p>
                    <p className="text-sm font-medium">{selectedOrder.deliveryLocation || t("not_specified_label")}</p>
                  </div>
                </div>
              </div>

              {/* ID */}
              <div className="p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <p className="text-[10px] text-muted-foreground mb-1">{t("order_id_label")}</p>
                <p className="font-mono text-xs text-slate-400 break-all">{selectedOrder.id}</p>
              </div>
            </div>
          )}

          <DialogFooter className="flex flex-col gap-2 pt-4 border-t border-slate-100">
            {selectedOrder && selectedOrder.status === "تم التسليم" && (
              selectedOrder.supplierRated ? (
                <div className="text-center text-xs text-muted-foreground bg-slate-50 py-2.5 rounded-xl border border-dashed w-full font-bold">
                  {t("already_rated")}
                </div>
              ) : (
                <Button
                  onClick={() => {
                    setReviewOrder(selectedOrder)
                    setSelectedOrder(null)
                  }}
                  className="w-full bg-amber-500 hover:bg-amber-600 gap-2 h-11 rounded-xl transition-all font-bold text-white shadow-lg shadow-amber-500/20"
                >
                  <Star size={16} className="fill-white" />
                  {t("rate_contractor")}
                </Button>
              )
            )}
            <Button variant="outline" className="w-full h-11 rounded-xl font-bold" onClick={() => setSelectedOrder(null)}>
              {t("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      {reviewOrder && (
        <ReviewDialog
          open={!!reviewOrder}
          onOpenChange={(open) => !open && setReviewOrder(null)}
          offerId={reviewOrder.id}
          rfqId={reviewOrder.rfqId}
          reviewerId={user?.uid || ""}
          reviewerName={activeCompanyName || ""}
          reviewerRole="Supplier"
          revieweeId={reviewOrder.contractorOrgId || reviewOrder.contractorId || reviewOrder.submittedByUserId || ""}
          revieweeName={reviewOrder.contractorName || "المقاول"}
          revieweeRole="Contractor"
          onSubmitSuccess={() => {
            setReviewOrder(null)
          }}
        />
      )}
    </PortalLayout>
  )
}
