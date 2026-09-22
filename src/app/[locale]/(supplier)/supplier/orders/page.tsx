"use client"

// The supplier's orders. Two kinds live here side by side:
// - purchase orders (`purchaseOrders` addressed to this supplier's org — PRD
//   3.0): a segment bar, a card per order with its lines, the acceptance with
//   a committed date, and the delivery notice per shipment;
// - legacy awards (accepted offers with no order laid over them yet): the
//   table this page always had, untouched, so nothing old stops working.
// `?po=<id>` opens and scrolls to that order (the bell links here).

import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ClipboardList, Truck, PackageCheck, MapPin, Eye, Clock, Calendar, Tag, DollarSign, User, MapPinned, Star, CheckCircle2, ChevronDown, ChevronUp, Loader2, FileText, Building2, AlertTriangle } from "lucide-react"
import { forwardRef, useEffect, useMemo, useRef, useState } from "react"
import { collection, query, where, doc, addDoc, serverTimestamp, type Firestore } from "firebase/firestore"
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage"
import { useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useDoc, useCollection, useFirestore, useStorage, useUser, useMemoFirebase } from "@/firebase"
import { ReviewDialog } from "@/components/ReviewDialog"
import { useToast } from "@/hooks/use-toast"
import { useActiveCompanyName } from "@/hooks/useActiveCompanyName"
import { cn } from "@/lib/utils"
import { sarLtr } from "@/lib/riyal"
import { displayPoNumber } from "@/lib/procurement/format"
import { isLumpSum, poStatus, poValue } from "@/lib/procurement/po"
import { PURCHASE_ORDERS, type PoStatus, type PurchaseOrder } from "@/lib/procurement/types"
import { ProcWriteError, supplierAcceptPurchaseOrder } from "@/lib/procurement/writes"
import {
  DELIVERY_WINDOWS,
  SUPPLIER_SEGMENTS,
  buildDeliveryNotice,
  buildDeliveryNoticeNotification,
  defaultNoticeLines,
  inSupplierSegment,
  minPromiseDay,
  noticeErrors,
  noticeLatenessDays,
  noticeRecipients,
  promiseDateValid,
  supplierCanAccept,
  supplierCanNotify,
  supplierLateDays,
  supplierLineView,
  supplierSegmentCounts,
  visibleSupplierOrders,
  type DeliveryWindow,
  type NoticeError,
  type SupplierSegment,
} from "@/lib/procurement/supplier"

// ---------------------------------------------------------------------------
// Small local helpers — money and dates the way the supplier reads them
// ---------------------------------------------------------------------------

const figure = (n: number | null | undefined) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(n) || 0)

function useDayText() {
  const locale = useLocale()
  return (day: string | null | undefined): string => {
    if (!day) return "—"
    const d = new Date(day.length === 10 ? `${day}T00:00:00` : day)
    if (Number.isNaN(d.getTime())) return day
    return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { year: "numeric", month: "short", day: "numeric" })
  }
}

const PILL: Record<PoStatus, string> = {
  awaiting_approval: "bg-muted text-muted-foreground",
  approved: "bg-muted text-muted-foreground",
  sent: "bg-cta/10 text-cta",
  accepted: "bg-module/10 text-module",
  in_delivery: "bg-module/10 text-module",
  part_received: "bg-module/10 text-module",
  received: "bg-success/10 text-success",
  closed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
}

/** The delivery as this page needs it (today's shape, plus the order's fields). */
interface SupplierDelivery {
  id: string
  offerId?: string | null
  poId?: string | null
  status?: string
  deliveryDate?: string | null
  deliveryPersonName?: string | null
  lines?: Array<{ noticeQuantity?: number }>
  docNumber?: string | null
}

interface LegacyOffer {
  id: string
  status?: string
  rfqId?: string
  rfqTitle?: string
  price?: string | number
  createdAt?: string
  updatedAt?: string
  contractorName?: string
  contractorId?: string
  contractorOrgId?: string
  submittedByUserId?: string
  deliveryLocation?: string
  rfqCity?: string
  supplierRated?: boolean
  poId?: string | null
  poNumber?: string | null
}

export default function SupplierOrdersPage() {
  const t = useTranslations("Portal.Supplier")
  const tp = useTranslations("Portal.Procurement")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const storage = useStorage()
  const { user, isUserLoading } = useUser()
  const searchParams = useSearchParams()
  const focusPoId = searchParams.get("po")
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile, isLoading: profileLoading } = useDoc(userDocRef)
  const activeCompanyName = useActiveCompanyName(profile, user?.uid)
  const [reviewOrder, setReviewOrder] = useState<LegacyOffer | null>(null)
  const { toast } = useToast()
  const dayText = useDayText()
  const now = useMemo(() => new Date(), [])

  const orgId = profile?.organizationId || user?.uid || ""
  const ready = !isUserLoading && !!user && !!firestore && !profileLoading

  // --- Legacy awards: the offers query this page always had ---------------
  const ordersQuery = useMemoFirebase(() => {
    if (!ready) return null
    if (profile?.organizationId) {
      return query(collection(firestore as Firestore, "offers"), where("organizationId", "==", profile.organizationId))
    }
    return query(collection(firestore as Firestore, "offers"), where("supplierId", "==", (user as { uid: string }).uid))
  }, [firestore, user, ready, profile?.organizationId])
  const { data: allOffers, isLoading: isCollectionLoading } = useCollection<LegacyOffer>(ordersQuery)

  // --- Purchase orders addressed to this supplier (PRD 3.0) ---------------
  const poQuery = useMemoFirebase(() => {
    if (!ready || !orgId) return null
    return query(collection(firestore as Firestore, PURCHASE_ORDERS), where("supplierOrgId", "==", orgId))
  }, [firestore, ready, orgId])
  const { data: rawOrders, isLoading: ordersLoading } = useCollection<Omit<PurchaseOrder, "id">>(poQuery)

  // --- The supplier's delivery notices, grouped by order ------------------
  const deliveriesQuery = useMemoFirebase(() => {
    if (!ready || !orgId) return null
    return query(collection(firestore as Firestore, "deliveries"), where("supplierOrgId", "==", orgId))
  }, [firestore, ready, orgId])
  const { data: deliveries } = useCollection<SupplierDelivery>(deliveriesQuery)

  const isLoading = isUserLoading || isCollectionLoading || ordersLoading

  const purchaseOrders = useMemo(() => visibleSupplierOrders((rawOrders || []) as PurchaseOrder[]), [rawOrders])
  const counts = useMemo(() => supplierSegmentCounts(purchaseOrders), [purchaseOrders])
  const visiblePoIds = useMemo(() => new Set(purchaseOrders.map((p) => p.id)), [purchaseOrders])
  const offerById = useMemo(() => {
    const m = new Map<string, LegacyOffer>()
    for (const o of allOffers || []) m.set(o.id, o)
    return m
  }, [allOffers])
  const deliveriesByPo = useMemo(() => {
    const m = new Map<string, SupplierDelivery[]>()
    for (const d of deliveries || []) {
      if (!d.poId) continue
      const list = m.get(d.poId) || []
      list.push(d)
      m.set(d.poId, list)
    }
    for (const list of m.values()) list.sort((a, b) => (b.deliveryDate || "").localeCompare(a.deliveryDate || ""))
    return m
  }, [deliveries])

  const [segment, setSegment] = useState<SupplierSegment>("all")
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [acceptPo, setAcceptPo] = useState<PurchaseOrder | null>(null)
  const [noticePo, setNoticePo] = useState<PurchaseOrder | null>(null)
  const focusedRef = useRef<HTMLDivElement | null>(null)
  const focusedOnce = useRef(false)

  // The deep link: show the order whatever segment is active, open it, scroll to it.
  useEffect(() => {
    if (!focusPoId || focusedOnce.current || !visiblePoIds.has(focusPoId)) return
    focusedOnce.current = true
    setSegment("all")
    setExpanded((s) => new Set(s).add(focusPoId))
    const id = window.setTimeout(() => focusedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 150)
    return () => window.clearTimeout(id)
  }, [focusPoId, visiblePoIds])

  // Legacy awards: every accepted offer that is NOT already shown as an order card.
  const orders = (allOffers || [])
    .filter((o) => ["مقبول", "Accepted", "accepted", "جاري التوصيل", "تم التسليم", "قيد التجهيز"].includes(o.status || ""))
    .filter((o) => !(o.poId && visiblePoIds.has(o.poId)))
    .sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return dateB - dateA
    })

  const shownOrders = purchaseOrders.filter((po) => inSupplierSegment(po, segment))

  const exportToCSV = () => {
    if (orders.length === 0 && purchaseOrders.length === 0) {
      toast({ title: t("export_warning_title"), description: t("export_warning_desc"), variant: "destructive" })
      return
    }
    const escapeCsv = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`
    const headers = [t("order_id_header"), t("contract_date"), t("client_header"), t("city"), t("contract_value"), t("status_header")]
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
    const poRows = purchaseOrders.map((po) => {
      const st = poStatus(po)
      return [
        escapeCsv(po.docNumber),
        escapeCsv(po.sentAt ? new Date(po.sentAt).toLocaleDateString(locale) : fallback),
        escapeCsv(offerById.get(po.offerId || "")?.contractorName || fallback),
        escapeCsv(po.deliveryLocation || fallback),
        escapeCsv(figure(poValue(po))),
        escapeCsv(tp(`status.${st === "closed" && po.closedShort ? "closed_short" : st}`)),
      ].join(",")
    })
    const rows = orders.map((o) => {
      const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString(locale) : fallback
      return [
        escapeCsv(o.id),
        escapeCsv(date),
        escapeCsv(o.contractorName || fallback),
        escapeCsv(o.deliveryLocation || o.rfqCity || fallback),
        escapeCsv(o.price ?? fallback),
        escapeCsv(translateStatus(o.status || "")),
      ].join(",")
    })
    const bom = "﻿"
    const csvString = bom + headers.map(escapeCsv).join(",") + "\n" + [...poRows, ...rows].join("\n")
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.setAttribute("href", url)
    link.setAttribute("download", `orders_report_${new Date().toISOString().split("T")[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast({ title: t("export_success"), description: t("export_success_desc") })
  }

  const [selectedOrder, setSelectedOrder] = useState<LegacyOffer | null>(null)

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

  // Stats: the orders and the legacy awards together.
  const preparingCount = counts.to_accept + orders.filter((o) => o.status === "قيد التجهيز" || o.status === "مقبول" || o.status === "Accepted").length
  const shippingCount = counts.in_delivery + orders.filter((o) => o.status === "جاري التوصيل").length
  const completedCount = counts.done + orders.filter((o) => o.status === "تم التسليم").length

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const writeError = (err: unknown) => {
    const code = err instanceof ProcWriteError ? err.code : ""
    const description = code === "wrong_state" ? t("po_err_wrong_state") : code === "date_invalid" ? t("po_err_date_invalid") : t("po_err_generic")
    toast({ title: t("error_title"), description, variant: "destructive" })
  }

  const supplierActor = { uid: user?.uid || "", name: (profile?.name as string | undefined) || activeCompanyName || (user?.displayName as string | undefined) || t("generic_supplier") }

  return (
    <PortalLayout>
      <div className="space-y-6">
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

        {/* Purchase orders — PRD 3.0 */}
        <Card className="border-none shadow-sm">
          <CardHeader className="border-b bg-white space-y-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText size={18} className="text-module" />
                {t("po_section_title")}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{t("po_section_desc")}</p>
            </div>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("po_section_title")}>
              {SUPPLIER_SEGMENTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={segment === s}
                  onClick={() => setSegment(s)}
                  className={cn(
                    "inline-flex min-h-[40px] items-center gap-2 rounded-md border px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    segment === s ? "border-transparent bg-module/10 text-module" : "border-border bg-background text-muted-foreground hover:bg-muted"
                  )}
                >
                  {t(`po_seg_${s}`)}
                  <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", segment === s ? "bg-module/15" : "bg-muted")}>{counts[s]}</span>
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {!ready || ordersLoading ? (
              <div className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="animate-spin" size={20} />
                {t("loading")}
              </div>
            ) : shownOrders.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{counts.all === 0 ? t("po_empty_all") : t("po_empty_segment")}</p>
            ) : (
              shownOrders.map((po) => (
                <PoOrderCard
                  key={po.id}
                  ref={po.id === focusPoId ? focusedRef : undefined}
                  po={po}
                  offer={po.offerId ? offerById.get(po.offerId) : undefined}
                  notices={deliveriesByPo.get(po.id) || []}
                  now={now}
                  open={expanded.has(po.id)}
                  highlighted={po.id === focusPoId}
                  onToggle={() => toggle(po.id)}
                  onAccept={() => setAcceptPo(po)}
                  onNotify={() => setNoticePo(po)}
                  onRate={(offer) => setReviewOrder(offer)}
                  dayText={dayText}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* Legacy awards — the table this page always had */}
        <Card className="border-none shadow-sm">
          <CardHeader className="border-b bg-white">
            <CardTitle className="text-lg">{t("active_orders_title")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-start">{t("order_id_header")}</TableHead>
                  <TableHead className="text-start">{t("client_header")}</TableHead>
                  <TableHead className="text-start">{t("product_quantity_header")}</TableHead>
                  <TableHead className="text-start">{t("location_header")}</TableHead>
                  <TableHead className="text-start">{t("status_header")}</TableHead>
                  <TableHead className="text-start">{t("actions_header")}</TableHead>
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
                ) : orders.map((order) => (
                  <TableRow key={order.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-mono text-xs font-bold text-start">{order.id.substring(0, 8)}</TableCell>
                    <TableCell className="text-start">{order.contractorName || t("client_value")}</TableCell>
                    <TableCell className="text-start">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">{order.rfqTitle}</span>
                        <span className="text-xs text-muted-foreground">{order.price} {t("sar")}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-start">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground justify-start">
                        <MapPin size={12} />
                        {order.deliveryLocation || t("not_specified_label")}
                      </div>
                    </TableCell>
                    <TableCell className="text-start">{getStatusBadge(order.status || "")}</TableCell>
                    <TableCell className="text-start">
                      <div className="flex items-center gap-2 justify-start">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-secondary hover:bg-slate-100"
                          title={t("view_order_tooltip")}
                          aria-label={t("view_order_tooltip")}
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

      {/* Legacy award details */}
      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="sm:max-w-2xl w-[95vw] p-6 max-h-[90vh] overflow-y-auto rounded-[2rem] border-slate-100 shadow-2xl text-start" dir={locale === "ar" ? "rtl" : "ltr"}>
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
                <div className="ms-auto">
                  {getStatusBadge(selectedOrder.status || "")}
                </div>
              )}
            </div>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-3 py-4">
              <div className="bg-gradient-to-l from-primary/5 to-blue-50 rounded-2xl p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium mb-1 flex items-center gap-1">
                    <DollarSign size={12} /> {t("contract_value")}
                  </p>
                  <p className="text-3xl font-black text-primary leading-none">
                    {selectedOrder.price}
                    <span className="text-base font-bold text-muted-foreground ms-1">{t("sar")}</span>
                  </p>
                </div>
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                  <DollarSign size={26} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-slate-50 rounded-xl space-y-1.5 border border-slate-100">
                  <p className="text-[10px] text-muted-foreground font-bold uppercase flex items-center gap-1">
                    <Calendar size={10} /> {t("contract_date")}
                  </p>
                  <p className="font-bold text-sm" suppressHydrationWarning>
                    {selectedOrder.createdAt ? new Date(selectedOrder.createdAt).toLocaleDateString(locale) : "—"}
                  </p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl space-y-1.5 border border-slate-100">
                  <p className="text-[10px] text-muted-foreground font-bold uppercase flex items-center gap-1">
                    <Clock size={10} /> {t("last_updated")}
                  </p>
                  <p className="font-bold text-sm" suppressHydrationWarning>
                    {selectedOrder.updatedAt ? new Date(selectedOrder.updatedAt).toLocaleDateString(locale) : "—"}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-100 flex items-center justify-center text-primary shrink-0 mt-0.5">
                    <Tag size={14} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase mb-1">{t("tender_info")}</p>
                    <p className="font-bold text-sm leading-snug">{selectedOrder.rfqTitle || "—"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-100 flex items-center justify-center text-primary shrink-0 mt-0.5">
                    <User size={14} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase mb-1">{t("client_info")}</p>
                    <p className="font-bold text-sm">{selectedOrder.contractorName || t("client_value")}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-100 flex items-center justify-center text-primary shrink-0 mt-0.5">
                    <MapPinned size={14} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase mb-1">{t("delivery_location")}</p>
                    <p className="text-sm font-medium">{selectedOrder.deliveryLocation || t("not_specified_label")}</p>
                  </div>
                </div>
              </div>

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

      {/* Accept the order */}
      {acceptPo && (
        <AcceptOrderDialog
          po={acceptPo}
          now={now}
          onClose={() => setAcceptPo(null)}
          onSubmit={async (date) => {
            if (!firestore || !user) return
            try {
              await supplierAcceptPurchaseOrder(firestore, supplierActor, acceptPo.id, date, { copy: tShared })
              toast({ title: t("po_accepted_toast"), description: t("po_accepted_toast_desc", { date: dayText(date) }) })
              setAcceptPo(null)
            } catch (err) {
              writeError(err)
            }
          }}
        />
      )}

      {/* The delivery notice for one shipment */}
      {noticePo && (
        <DeliveryNoticeDialog
          po={noticePo}
          now={now}
          onClose={() => setNoticePo(null)}
          onSubmit={async (values, file) => {
            if (!firestore || !user) return
            let fileUrl: string | null = null
            if (file && storage) {
              const path = `deliveries/notices/${noticePo.id}/${Date.now()}-${file.name}`
              const fileRef = storageRef(storage, path)
              await uploadBytes(fileRef, file)
              fileUrl = await getDownloadURL(fileRef)
            }
            const offer = noticePo.offerId ? offerById.get(noticePo.offerId) : undefined
            const docData = buildDeliveryNotice({
              po: noticePo,
              lines: values.lines,
              deliveryDate: values.deliveryDate,
              deliveryWindow: values.deliveryWindow,
              driverName: values.driverName,
              vehiclePlate: values.vehiclePlate,
              paperNoteNumber: values.paperNoteNumber,
              notes: values.notes,
              fileUrl,
              supplier: { uid: user.uid, orgId: orgId, name: activeCompanyName || t("generic_supplier") },
              contractorId: offer?.contractorId || null,
              createdAt: serverTimestamp(),
            })
            const created = await addDoc(collection(firestore, "deliveries"), docData)
            const at = new Date().toISOString()
            await Promise.all(
              noticeRecipients(noticePo, offer?.contractorId).map((uid) =>
                addDoc(collection(firestore, "users", uid, "notifications"), buildDeliveryNoticeNotification(noticePo, uid, created.id, at)).catch(() => undefined)
              )
            )
            toast({ title: t("po_notice_sent_toast"), description: t("po_notice_sent_desc") })
            setNoticePo(null)
          }}
          onError={writeError}
        />
      )}

      {reviewOrder && (
        <ReviewDialog
          open={!!reviewOrder}
          onOpenChange={(open) => !open && setReviewOrder(null)}
          offerId={reviewOrder.id}
          rfqId={reviewOrder.rfqId || ""}
          reviewerId={user?.uid || ""}
          reviewerName={activeCompanyName || ""}
          reviewerRole="Supplier"
          revieweeId={reviewOrder.contractorOrgId || reviewOrder.contractorId || reviewOrder.submittedByUserId || ""}
          revieweeName={reviewOrder.contractorName || t("conn_contractor_label")}
          revieweeRole="Contractor"
          onSubmitSuccess={() => setReviewOrder(null)}
        />
      )}
    </PortalLayout>
  )
}

// ---------------------------------------------------------------------------
// One purchase order, as the supplier reads it
// ---------------------------------------------------------------------------


interface PoOrderCardProps {
  po: PurchaseOrder
  offer?: LegacyOffer
  notices: SupplierDelivery[]
  now: Date
  open: boolean
  highlighted: boolean
  onToggle: () => void
  onAccept: () => void
  onNotify: () => void
  onRate: (offer: LegacyOffer) => void
  dayText: (day: string | null | undefined) => string
}

const PoOrderCard = forwardRef<HTMLDivElement, PoOrderCardProps>(function PoOrderCard({ po, offer, notices, now, open, highlighted, onToggle, onAccept, onNotify, onRate, dayText }, ref) {
  const t = useTranslations("Portal.Supplier")
  const tp = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const status = poStatus(po)
  const statusKey = status === "closed" && po.closedShort ? "closed_short" : status
  const late = supplierLateDays(po, now)
  const lines = po.lines.map(supplierLineView)
  const lump = isLumpSum(po)
  const canAccept = supplierCanAccept(po)
  const canNotify = supplierCanNotify(po)
  const canRate = offer?.status === "تم التسليم" && !offer.supplierRated

  return (
    <div ref={ref} className={cn("rounded-lg border bg-background transition-shadow", highlighted ? "border-module shadow-md ring-2 ring-module/30" : "border-border")}>
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className="font-mono text-sm font-bold tracking-latin">{displayPoNumber(po.docNumber, locale)}</span>
            <Badge className={cn("border-none text-[11px] font-bold", PILL[status])}>{tp(`status.${statusKey}`)}</Badge>
            {late > 0 && (
              <Badge className="border-none bg-destructive/10 text-[11px] font-bold text-destructive gap-1">
                <AlertTriangle size={11} />
                {tp("deliveryState.late", { days: late })}
              </Badge>
            )}
          </div>
          <p className="font-bold text-sm leading-snug">{po.rfqTitle || "—"}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Building2 size={12} />
              <BuyerName orgId={po.organizationId} fallback={offer?.contractorName} />
            </span>
            {po.projectName && (
              <span className="inline-flex items-center gap-1">
                <Tag size={12} />
                {po.projectName}
              </span>
            )}
            {po.deliveryLocation && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} />
                {po.deliveryLocation}
              </span>
            )}
            {po.sentAt && (
              <span className="inline-flex items-center gap-1">
                <Calendar size={12} />
                {t("po_sent_on", { date: dayText(po.sentAt) })}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 md:items-end">
          <p className="text-[11px] text-muted-foreground">{t("po_value")}</p>
          <p dir="ltr" className="text-lg font-black tabular-nums text-primary">{sarLtr(figure(poValue(po)))}</p>
          <p className="text-xs text-muted-foreground">
            {t("po_promised")}: <span className="font-bold text-foreground">{po.promisedDate ? dayText(po.promisedDate) : t("po_no_promise")}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
        {canAccept && (
          <Button size="sm" className="gap-1.5 bg-cta text-white hover:bg-cta/90" onClick={onAccept}>
            <CheckCircle2 size={14} />
            {t("po_accept_btn")}
          </Button>
        )}
        {canNotify && (
          <Button size="sm" className="gap-1.5" onClick={onNotify}>
            <Truck size={14} />
            {t("po_notify_btn")}
          </Button>
        )}
        {canRate && offer && (
          <Button size="sm" className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600" onClick={() => onRate(offer)}>
            <Star size={14} className="fill-white" />
            {t("rate_client")}
          </Button>
        )}
        <Button variant="ghost" size="sm" className="ms-auto gap-1 text-muted-foreground" onClick={onToggle} aria-expanded={open}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {open ? t("po_hide_lines") : t("po_show_lines", { count: po.lines.length })}
        </Button>
      </div>

      {open && (
        <div className="space-y-4 border-t px-4 py-4">
          {po.status === "cancelled" && po.cancelledReason && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{t("po_cancelled_reason", { reason: po.cancelledReason })}</p>
          )}
          {po.closedShort && po.closeReason && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{t("po_closed_short_reason", { reason: po.closeReason })}</p>
          )}
          <div>
            <p className="mb-2 text-xs font-bold text-muted-foreground">{t("po_lines_title")}</p>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-start">{t("po_col_item")}</TableHead>
                    <TableHead className="text-start">{t("po_col_unit")}</TableHead>
                    <TableHead className="text-end">{t("po_col_ordered")}</TableHead>
                    <TableHead className="text-end">{t("po_col_accepted")}</TableHead>
                    <TableHead className="text-end">{t("po_col_rejected")}</TableHead>
                    <TableHead className="text-end">{t("po_col_cancelled")}</TableHead>
                    <TableHead className="text-end">{t("po_col_outstanding")}</TableHead>
                    {!lump && <TableHead className="text-end">{t("po_col_unit_price")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-start font-medium">{l.name}</TableCell>
                      <TableCell className="text-start text-muted-foreground">{l.unit || "—"}</TableCell>
                      <TableCell className="text-end tabular-nums">{figure(l.ordered)}</TableCell>
                      <TableCell className="text-end tabular-nums text-success">{figure(l.accepted)}</TableCell>
                      <TableCell className={cn("text-end tabular-nums", l.rejected > 0 && "text-destructive")}>{figure(l.rejected)}</TableCell>
                      <TableCell className="text-end tabular-nums text-muted-foreground">{figure(l.cancelled)}</TableCell>
                      <TableCell className="text-end tabular-nums font-bold">{figure(l.outstanding)}</TableCell>
                      {!lump && (
                        <TableCell dir="ltr" className="text-end tabular-nums">
                          {sarLtr(figure(po.lines[i].unitPrice))}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {lump && <p className="mt-1 text-xs text-muted-foreground">{t("po_lump_sum")}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {po.paymentTerms && (
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-[11px] font-bold text-muted-foreground">{t("po_payment_terms")}</p>
                <p className="text-sm">{po.paymentTerms}</p>
              </div>
            )}
            <div className="rounded-md bg-muted/50 p-3">
              <p className="text-[11px] font-bold text-muted-foreground">{t("po_notices_title")}</p>
              {notices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("po_notice_none")}</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {notices.map((n) => (
                    <li key={n.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <Truck size={12} className="text-muted-foreground" />
                      <span>{dayText(n.deliveryDate)}</span>
                      {n.deliveryPersonName && <span className="text-muted-foreground">· {n.deliveryPersonName}</span>}
                      <Badge variant="outline" className={cn("text-[10px]", n.status === "confirmed" ? "border-success/30 bg-success/10 text-success" : "border-cta/30 bg-cta/10 text-cta")}>
                        {n.status === "confirmed" ? t("delivery_status_confirmed") : t("delivery_status_pending")}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

/** The buying company's name — the order carries only its org id. */
function BuyerName({ orgId, fallback }: { orgId: string; fallback?: string | null }) {
  const t = useTranslations("Portal.Supplier")
  const firestore = useFirestore()
  const ref = useMemoFirebase(() => (firestore && orgId ? doc(firestore, "users", orgId) : null), [firestore, orgId])
  const { data } = useDoc<{ companyName?: string; name?: string }>(ref)
  return <span>{data?.companyName || data?.name || fallback || t("client_value")}</span>
}

// ---------------------------------------------------------------------------
// Accept the order — the committed date
// ---------------------------------------------------------------------------

function AcceptOrderDialog({ po, now, onClose, onSubmit }: { po: PurchaseOrder; now: Date; onClose: () => void; onSubmit: (date: string) => Promise<void> }) {
  const t = useTranslations("Portal.Supplier")
  const locale = useLocale()
  const min = minPromiseDay(now)
  const schema = useMemo(
    () =>
      z.object({
        promisedDate: z.string().refine((d) => promiseDateValid(d, now), { message: "date" }),
      }),
    [now]
  )
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { promisedDate: po.promisedDate || "" } })
  const { register, handleSubmit, formState } = form

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md text-start" dir={locale === "ar" ? "rtl" : "ltr"}>
        <form onSubmit={handleSubmit((v) => onSubmit(v.promisedDate))} className="space-y-4">
          <DialogHeader className="text-start sm:text-start">
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-cta" />
              {t("po_accept_title", { number: displayPoNumber(po.docNumber, locale) })}
            </DialogTitle>
            <DialogDescription>{t("po_accept_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="po-promised-date">
              {t("po_accept_date_label")} <span className="text-destructive">*</span>
            </Label>
            <Input id="po-promised-date" type="date" min={min} dir="ltr" {...register("promisedDate")} disabled={formState.isSubmitting} />
            <p className={cn("text-xs", formState.errors.promisedDate ? "text-destructive" : "text-muted-foreground")}>
              {formState.errors.promisedDate ? t("po_notice_err_date_past") : t("po_accept_date_hint")}
            </p>
          </div>
          <DialogFooter className="flex flex-row justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={formState.isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" className="gap-2 bg-cta text-white hover:bg-cta/90" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
              {t("po_accept_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// The delivery notice — one shipment
// ---------------------------------------------------------------------------

interface NoticeValues {
  lines: Array<{ poLineId: string; quantity: number }>
  deliveryDate: string
  deliveryWindow: DeliveryWindow | null
  driverName: string
  vehiclePlate: string
  paperNoteNumber: string
  notes: string
}

function DeliveryNoticeDialog({
  po,
  now,
  onClose,
  onSubmit,
  onError,
}: {
  po: PurchaseOrder
  now: Date
  onClose: () => void
  onSubmit: (values: NoticeValues, file: File | null) => Promise<void>
  onError: (err: unknown) => void
}) {
  const t = useTranslations("Portal.Supplier")
  const tp = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const { toast } = useToast()
  const lines = po.lines.map(supplierLineView).filter((l) => l.toArrive > 0)
  const min = minPromiseDay(now)
  const [file, setFile] = useState<File | null>(null)
  const [domainErrors, setDomainErrors] = useState<NoticeError[]>([])

  const schema = useMemo(
    () =>
      z.object({
        lines: z.array(z.object({ poLineId: z.string(), quantity: z.number().min(0) })),
        deliveryDate: z.string().min(1),
        deliveryWindow: z.enum(DELIVERY_WINDOWS).nullable(),
        driverName: z.string().trim().max(200),
        vehiclePlate: z.string().trim().max(40),
        paperNoteNumber: z.string().trim().max(80),
        notes: z.string().trim().max(2000),
      }),
    []
  )
  const form = useForm<NoticeValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      lines: defaultNoticeLines(po),
      deliveryDate: po.promisedDate && po.promisedDate >= min ? po.promisedDate : min,
      deliveryWindow: null,
      driverName: "",
      vehiclePlate: "",
      paperNoteNumber: "",
      notes: "",
    },
  })
  const { register, handleSubmit, watch, setValue, formState } = form
  const deliveryDate = watch("deliveryDate")
  const window_ = watch("deliveryWindow")
  const lateBy = noticeLatenessDays(po, deliveryDate)

  const errorText = (e: NoticeError) => {
    switch (e.code) {
      case "date_missing": return t("po_notice_err_date_missing")
      case "date_past": return t("po_notice_err_date_past")
      case "nothing_to_ship": return t("po_notice_err_nothing_to_ship")
      case "over_outstanding": return t("po_notice_err_over_outstanding", { line: String(e.params.line), max: figure(Number(e.params.max)), unit: String(e.params.unit) })
      case "not_accepted": return t("po_notice_err_not_accepted")
      default: return t("po_err_generic")
    }
  }

  const submit = async (values: NoticeValues) => {
    const errs = noticeErrors(po, values.lines, values.deliveryDate, now)
    setDomainErrors(errs)
    if (errs.length) return
    try {
      await onSubmit(values, file)
    } catch (err) {
      onError(err)
    }
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null
    if (f && f.type !== "application/pdf" && !f.type.startsWith("image/")) {
      toast({ title: t("error_title"), description: t("po_notice_file_type_error"), variant: "destructive" })
      e.target.value = ""
      setFile(null)
      return
    }
    setFile(f)
  }

  const lineErrors = new Map(domainErrors.filter((e) => e.poLineId).map((e) => [e.poLineId as string, e]))
  const generalErrors = domainErrors.filter((e) => !e.poLineId)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto text-start" dir={locale === "ar" ? "rtl" : "ltr"}>
        <form onSubmit={handleSubmit(submit)} className="space-y-5">
          <DialogHeader className="text-start sm:text-start">
            <DialogTitle className="flex items-center gap-2">
              <Truck size={18} className="text-module" />
              {t("po_notice_title", { number: displayPoNumber(po.docNumber, locale) })}
            </DialogTitle>
            <DialogDescription>{t("po_notice_desc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-sm font-bold">{t("po_notice_lines_title")}</p>
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("po_notice_nothing_left")}</p>
            ) : (
              <div className="space-y-2">
                {lines.map((l, i) => {
                  const err = lineErrors.get(l.id)
                  return (
                    <div key={l.id} className={cn("flex flex-wrap items-center gap-3 rounded-md border p-3", (err || formState.errors.lines?.[i]?.quantity) && "border-destructive")}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{l.name}</p>
                        <p className="text-xs text-muted-foreground">{t("po_notice_up_to", { max: figure(l.toArrive), unit: l.unit })}</p>
                        {err && <p className="mt-1 text-xs text-destructive">{errorText(err)}</p>}
                        {formState.errors.lines?.[i]?.quantity && <p className="mt-1 text-xs text-destructive">{t("po_notice_err_quantity")}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`notice-q-${l.id}`} className="sr-only">
                          {l.name}
                        </Label>
                        <Input id={`notice-q-${l.id}`} type="number" inputMode="decimal" step="any" min={0} max={l.toArrive} dir="ltr" className="w-28 text-end tabular-nums" {...register(`lines.${i}.quantity` as const, { valueAsNumber: true })} disabled={formState.isSubmitting} />
                        <span className="text-xs text-muted-foreground">{l.unit}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="notice-date">
                {t("po_notice_date_label")} <span className="text-destructive">*</span>
              </Label>
              <Input id="notice-date" type="date" min={min} dir="ltr" {...register("deliveryDate")} disabled={formState.isSubmitting} />
              {lateBy > 0 && <p className="text-xs text-destructive">{t("po_notice_late_hint", { days: lateBy })}</p>}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("po_notice_window_label")}</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("po_notice_window_label")}>
                {DELIVERY_WINDOWS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    role="radio"
                    aria-checked={window_ === w}
                    onClick={() => setValue("deliveryWindow", window_ === w ? null : w)}
                    className={cn(
                      "min-h-[40px] rounded-md border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      window_ === w ? "border-transparent bg-module/10 font-bold text-module" : "border-border hover:bg-muted"
                    )}
                  >
                    {tp(`deliveryWindow.${w}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="notice-driver">{t("po_notice_driver_label")}</Label>
              <Input id="notice-driver" placeholder={t("po_notice_driver_placeholder")} {...register("driverName")} disabled={formState.isSubmitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notice-plate">{t("po_notice_plate_label")}</Label>
              <Input id="notice-plate" dir="ltr" {...register("vehiclePlate")} disabled={formState.isSubmitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notice-paper">{t("po_notice_paper_label")}</Label>
              <Input id="notice-paper" dir="ltr" placeholder="DN-" {...register("paperNoteNumber")} disabled={formState.isSubmitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notice-file">{t("po_notice_file_label")}</Label>
              <Input id="notice-file" type="file" accept=".pdf,image/*" onChange={onFile} disabled={formState.isSubmitting} />
              <p className="text-xs text-muted-foreground">{t("po_notice_file_hint")}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notice-notes">{t("po_notice_notes_label")}</Label>
            <Textarea id="notice-notes" rows={3} className="resize-none" placeholder={t("po_notice_notes_placeholder")} {...register("notes")} disabled={formState.isSubmitting} />
          </div>

          {generalErrors.length > 0 && (
            <ul className="space-y-1 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {generalErrors.map((e, i) => (
                <li key={i}>{errorText(e)}</li>
              ))}
            </ul>
          )}

          <DialogFooter className="flex flex-row justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={formState.isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" className="gap-2" disabled={formState.isSubmitting || lines.length === 0}>
              {formState.isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <Truck size={16} />}
              {t("po_notice_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
