"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { useRouter } from "@/i18n/routing"
import { useTranslations, useLocale } from 'next-intl'
import { cn } from "@/lib/utils"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { displayCategory, displaySubcategory, displayCity } from "@/lib/constants"

import {
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  TrendingUp,
  User,
  Calendar,
  MessageSquare,
  MapPin,
  File,
  Download,
  ChevronLeft,
  Handshake,
  DollarSign,
  Percent,
  AlertCircle,
  Clock,
  Truck,
  Package2,
} from "lucide-react"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy, doc } from "firebase/firestore"
import { Link } from "@/i18n/routing"
import { CreateMdmakOfferDialog } from "@/components/admin/CreateMdmakOfferDialog"
import { getMdmakProcurementForRfq } from "@/lib/mdmak-procurement"
import type { MdmakProcurement } from "@/lib/mdmak-procurement"

export default function AdminRfqDetailsPage() {
  const t = useTranslations("Portal.Contractor") // Using contractor translations since they have all the offers text
  const adminT = useTranslations("Portal.Admin.Rfqs")
  const locale = useLocale()
  const params = useParams()
  const rfqId = params.id as string
  const router = useRouter()
  const firestore = useFirestore()
  const [sortBy, setSortBy] = useState<"price" | "date" | "duration">("price")

  const offersQuery = useMemoFirebase(() => {
    if (!firestore) return null
    return query(
      collection(firestore, "offers"),
      where("rfqId", "==", rfqId),
      orderBy("createdAt", "desc")
    )
  }, [firestore, rfqId])

  const rfqDocRef = useMemoFirebase(() => {
    if (!firestore || !rfqId) return null
    return doc(firestore, "rfqs", rfqId)
  }, [firestore, rfqId])

  const { data: rfq, isLoading: isRfqLoading } = useDoc(rfqDocRef)
  const { data: offers, isLoading: isOffersLoading } = useCollection(offersQuery)

  const [procurement, setProcurement] = useState<MdmakProcurement | null>(null)
  const [procLoading, setProcLoading] = useState(true)
  const [offerDialogOpen, setOfferDialogOpen] = useState(false)

  useEffect(() => {
    if (!firestore || !rfqId) return
    getMdmakProcurementForRfq(firestore, rfqId)
      .then(p => setProcurement(p))
      .finally(() => setProcLoading(false))
  }, [firestore, rfqId])

  const isLoading = isOffersLoading || isRfqLoading

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "مقبول": return <Badge className="bg-success/10 text-success border-success/20">{t("offers_status_accepted")}</Badge>
      case "تم التسليم": return <Badge className="bg-blue-50 text-blue-600 border-blue-100">{t("offers_status_completed")}</Badge>
      case "مرفوض": return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none">{t("offers_status_rejected")}</Badge>
      case "مطلوب تخفيض": return <Badge className="bg-amber-100 text-amber-700 border-none">{t("offers_status_reduction")}</Badge>
      default: return <Badge className="bg-amber-50 text-amber-600 border-amber-100">{t("offers_status_review")}</Badge>
    }
  }

  const sortedOffers = offers ? [...offers].sort((a: any, b: any) => {
    if (sortBy === "price") {
      return (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
    } else if (sortBy === "date") {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    } else if (sortBy === "duration") {
      const durA = (parseInt(a.executionDuration) || 9999) * (a.executionDurationUnit === "أشهر" ? 30 : a.executionDurationUnit === "أسابيع" ? 7 : 1);
      const durB = (parseInt(b.executionDuration) || 9999) * (b.executionDurationUnit === "أشهر" ? 30 : b.executionDurationUnit === "أسابيع" ? 7 : 1);
      return durA - durB;
    }
    return 0;
  }) : []
  const lowestPrice = sortedOffers.length > 0 ? sortedOffers[0].price : null

  return (
    <PortalLayout>
      <div className={cn("space-y-6", locale === 'ar' ? 'text-right' : 'text-left')}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2 gap-1 text-muted-foreground">
              <ArrowRight size={16} />
              {t("offers_back_to_tenders")}
            </Button>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("offers_page_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("offers_page_desc")}</p>
          </div>
        </div>
        
        {rfq && (
          <Card className="border-none shadow-sm bg-white overflow-hidden">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row justify-between gap-6">
                <div className="space-y-4 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="bg-primary/5 text-primary border-none">
                      {displayCategory(rfq.category, locale)}
                    </Badge>
                    {rfq.subCategory && (
                      <Badge variant="outline" className="text-muted-foreground border-slate-200">
                        {displaySubcategory(rfq.subCategory, locale)}
                      </Badge>
                    )}
                    {rfq.pdfUrl && (
                      <a
                        href={rfq.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="flex items-center gap-1.5 text-xs bg-blue-50 text-blue-600 px-2.5 py-1 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        <File size={12} />
                        {t("offers_download_pdf")}
                      </a>
                    )}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mr-auto bg-slate-50 px-2 py-1 rounded">
                      <Calendar size={12} />
                      {t("offers_created_date", { date: rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString(locale) : '-' })}
                    </div>
                  </div>

                  <h2 className="text-2xl font-bold text-slate-800">{rfq.title}</h2>

                  <div className="flex flex-wrap items-center gap-6 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <MapPin size={16} className="text-primary" />
                      {displayCity(rfq.city, locale)} - {displayCity(rfq.district, locale)}
                      {rfq.locationCoords && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${rfq.locationCoords.lat},${rfq.locationCoords.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary underline mr-2 hover:text-primary/70 transition-colors"
                        >
                          {t("offers_view_location")}
                        </a>
                      )}
                    </div>
                    {rfq.isQualityCertificateRequired && (
                      <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">
                        {t("offers_quality_cert")}
                      </Badge>
                    )}
                  </div>

                  {/* Products List */}
                  {rfq.products && rfq.products.length > 0 && (
                    <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
                      <p className="text-xs font-bold text-slate-600 mb-3">{t("offers_requested_products")}</p>
                      <div className="space-y-2">
                        {rfq.products.map((product: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between bg-white p-3 rounded border border-slate-100">
                            <div className="flex-1">
                              <p className="font-bold text-sm text-slate-800">{product.name}</p>
                              {product.subCategory && (
                                <div className="mt-1">
                                  <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded">{displaySubcategory(product.subCategory, locale)}</span>
                                </div>
                              )}
                              {product.description && (
                                <p className="text-xs text-muted-foreground mt-1">{product.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-bold text-primary">{product.quantity}</span>
                              <span className="text-muted-foreground">{product.unitOfMeasure}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  {rfq.notes && (
                    <div className="mt-4 p-4 bg-blue-50/50 rounded-lg border border-blue-100">
                      <p className="text-xs font-bold text-slate-600 mb-2">{t("offers_notes_label")}</p>
                      <p className="text-sm text-slate-700">{rfq.notes}</p>
                    </div>
                  )}
                </div>

                <div className="md:w-px md:h-24 bg-slate-100 hidden md:block" />

                <div className="space-y-2 min-w-[200px]">
                  <p className="text-xs text-muted-foreground">{t("offers_tender_number")}</p>
                  <p className="font-mono text-sm font-bold text-primary bg-primary/5 px-3 py-2 rounded-lg border border-primary/10">
                    {rfqId}
                  </p>
                  {rfq.deadline && (
                    <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/5 px-3 py-2 rounded-lg border border-destructive/10">
                      <Calendar size={14} />
                      {t("offers_deadline_label", { date: new Date(rfq.deadline).toLocaleDateString(locale) })}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-none shadow-sm">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                <TrendingUp size={18} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("offers_total")}</p>
                <p className="text-xl font-bold">{offers?.length || 0}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-success/10 flex items-center justify-center text-success">
                <CheckCircle2 size={18} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("offers_accepted_count")}</p>
                <p className="text-xl font-bold">{offers?.filter((o: any) => o.status === "مقبول").length || 0}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                <Loader2 size={18} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("offers_under_review_count")}</p>
                <p className="text-xl font-bold">{offers?.filter((o: any) => o.status === "قيد المراجعة").length || 0}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Offers and Compare Tabs */}
        <Tabs defaultValue="list" className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="font-bold text-lg text-slate-800">{t("offers_title")}</h3>
            <TabsList className="bg-slate-100/50 border border-slate-200">
              <TabsTrigger value="list" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">{t("offers_tab_list")}</TabsTrigger>
              <TabsTrigger value="compare" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">{t("offers_tab_compare")}</TabsTrigger>
              <TabsTrigger value="mdmak" className="data-[state=active]:bg-white data-[state=active]:shadow-sm flex items-center gap-1.5">
                <Handshake size={13} />
                {adminT("mdmak_tab")}
                {procurement && (
                  <span className="h-4 w-4 rounded-full bg-accent text-primary text-[9px] font-black flex items-center justify-center">✓</span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="list" className="space-y-4 m-0 mt-6">
            {isLoading ? (
              <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <Loader2 className="animate-spin" size={40} />
                <p>{t("offers_loading")}</p>
              </div>
            ) : !offers || offers.length === 0 ? (
              <Card className="border-dashed border-2 border-slate-200 shadow-none">
                <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                  <TrendingUp size={48} className="opacity-20" />
                  <p className="font-bold text-lg">{t("offers_no_data")}</p>
                  <p className="text-sm">{t("offers_no_data_desc")}</p>
                </CardContent>
              </Card>
            ) : (
              offers.map((offer: any) => {
                const isBestOffer = offer.price === lowestPrice && offer.status !== "مرفوض";

                return (
                  <Card key={offer.id} className={`border shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden relative ${offer.status === "مقبول" ? "border-success/30 bg-success/5" :
                    offer.status === "مرفوض" ? "opacity-50 grayscale-[50%]" :
                      isBestOffer ? "border-amber-300 bg-amber-50/20" : "border-slate-100 bg-white"
                    }`}>
                    {isBestOffer && offer.status === "قيد المراجعة" && (
                      <div className="absolute top-0 left-0 bg-amber-400 text-amber-950 text-[10px] font-black px-3 py-1 rounded-br-lg rounded-tl-lg z-10 shadow-sm flex items-center gap-1">
                        <TrendingUp size={12} /> {t("offers_best_price")}
                      </div>
                    )}
                    <CardContent className="p-0">
                      <div className="flex flex-col md:flex-row">
                        {/* Offer Details */}
                        <div className="p-6 flex-1 space-y-3">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
                                <User size={18} />
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-sm text-slate-800">{offer.companyName || offer.supplierName || t("offers_registered_supplier")}</p>
                                {offer.submittedByUserName && (
                                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                                    {t("offers_submitted_by", { name: offer.submittedByUserName })}
                                  </p>
                                )}
                                <p className="text-xs text-muted-foreground font-mono mt-0.5">{offer.supplierId?.substring(0, 10)}...</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {getStatusBadge(offer.status || "قيد المراجعة")}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-4 text-sm mt-2">
                            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl ${isBestOffer ? "bg-amber-100/50" : "bg-primary/5"}`}>
                              <span className="text-muted-foreground font-medium">{t("offers_proposed_price")}</span>
                              <span className={`font-black text-xl ${isBestOffer ? "text-amber-600" : "text-primary"}`}>
                                {offer.price} <span className="text-sm font-normal">{t("offers_currency_sar")}</span>
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground" suppressHydrationWarning>
                              <Calendar size={14} />
                              <span>{offer.createdAt ? new Date(offer.createdAt).toLocaleDateString(locale) : "-"}</span>
                            </div>
                          </div>

                          {offer.deliveryBatches && offer.deliveryBatches.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                              <p className="text-xs font-bold text-slate-600 mb-2">{t("offers_batches")}</p>
                              <div className="space-y-2">
                                {offer.deliveryBatches.map((batch: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between bg-white p-2 rounded border border-slate-100 text-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-bold">
                                        {t("offers_batch_no", { number: idx + 1 })}
                                      </span>
                                      <span className="text-slate-600">{batch.quantity}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Calendar size={12} className="text-muted-foreground" />
                                      <span className="text-slate-600">{batch.deliveryDate}</span>
                                      <span className="font-bold text-success">{batch.price} {t("offers_currency_sar")}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {offer.offerPdfUrl && (
                            <div className="mt-4 p-3 bg-blue-50/50 rounded-xl border border-blue-100 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <File size={18} className="text-blue-600" />
                                <span className="text-sm font-bold text-slate-700">{t("offers_attached_file")}</span>
                              </div>
                              <Button variant="outline" size="sm" asChild className="h-8 rounded-lg bg-white border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white transition-all">
                                <a href={offer.offerPdfUrl} target="_blank" rel="noopener noreferrer">
                                  <Download size={12} className="ml-1" />
                                  {t("offers_view_file")}
                                </a>
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </TabsContent>

          <TabsContent value="compare" className="m-0 mt-6">
            {!sortedOffers || sortedOffers.length < 2 ? (
              <Card className="border-dashed border-2 border-slate-200 shadow-none">
                <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                  <TrendingUp size={48} className="opacity-20" />
                  <p className="font-bold text-lg">{t("offers_need_two")}</p>
                  <p className="text-sm">{t("offers_need_two_desc")}</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-none shadow-sm overflow-hidden bg-white">
                <div className="p-4 border-b flex items-center gap-2 flex-wrap bg-slate-50/50">
                  <span className="text-xs font-bold text-slate-500 ml-2">{t("offers_sort")}</span>
                  <Button
                    variant={sortBy === "price" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSortBy("price")}
                    className="h-8 text-xs rounded-lg"
                  >
                    {t("offers_sort_price")}
                  </Button>
                  <Button
                    variant={sortBy === "date" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSortBy("date")}
                    className="h-8 text-xs rounded-lg"
                  >
                    {t("offers_sort_date")}
                  </Button>
                  <Button
                    variant={sortBy === "duration" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSortBy("duration")}
                    className="h-8 text-xs rounded-lg"
                  >
                    {t("offers_sort_duration")}
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-gradient-to-r from-slate-50 to-white border-b-2 border-slate-100">
                      <TableRow>
                        <TableHead className="text-right font-bold text-slate-700 whitespace-nowrap w-40">{t("offers_criteria")}</TableHead>
                        {sortedOffers.map((o: any, i: number) => (
                          <TableHead key={o.id} className={`text-center min-w-[160px] ${o.price === lowestPrice ? 'bg-amber-50/50' : ''}`}>
                            <div className="flex flex-col items-center gap-1">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                <User size={16} className="text-primary" />
                              </div>
                              <span className="font-bold text-slate-800">{o.supplierName || `${t("offers_registered_supplier")} ${i + 1}`}</span>
                              {o.price === lowestPrice && (
                                <div className="text-[10px] text-amber-600 font-bold">{t("offers_best_price")} ⭐</div>
                              )}
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">{t("offers_price_col")}</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className={`text-center font-bold ${o.price === lowestPrice ? 'text-success text-lg' : 'text-slate-800'}`}>
                            <div className="flex flex-col">
                              <span>{Number(o.price).toLocaleString('ar-SA')}</span>
                              <span className="text-xs text-muted-foreground">{t("offers_currency_sar")}</span>
                            </div>
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">{t("offers_duration_col")}</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600">
                            {o.executionDuration ? `${o.executionDuration} ${o.executionDurationUnit || 'أيام'}` : "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">{t("offers_notes_col")}</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600 max-w-[150px]">
                            <p className="truncate">{o.notes || "—"}</p>
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">{t("offers_date_col")}</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center text-sm text-slate-600" suppressHydrationWarning>
                            <div className="flex items-center justify-center gap-1">
                              <Calendar size={12} className="text-muted-foreground" />
                              {o.createdAt ? new Date(o.createdAt).toLocaleDateString(locale) : "—"}
                            </div>
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">{t("offers_file_col")}</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center">
                            {o.offerPdfUrl ? (
                              <Button variant="outline" size="sm" asChild className="h-8 rounded-lg bg-white border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white transition-all text-[10px]">
                                <a href={o.offerPdfUrl} target="_blank" rel="noopener noreferrer">
                                  <Download size={10} className="ml-1" />
                                  {t("offers_view_file")}
                                </a>
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">{t("offers_not_available")}</span>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow className="hover:bg-slate-50/50">
                        <TableCell className="font-bold text-slate-700 bg-slate-50/50">{t("offers_decision_col")}</TableCell>
                        {sortedOffers.map((o: any) => (
                          <TableCell key={o.id} className="text-center">
                            <div className="flex justify-center">{getStatusBadge(o.status || "قيد المراجعة")}</div>
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}
          </TabsContent>
          <TabsContent value="mdmak" className="m-0 mt-6">
            {procLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>
            ) : !procurement ? (
              <Card className="border-dashed border-2 border-accent/20 shadow-none bg-accent/[0.02]">
                <CardContent className="p-12 flex flex-col items-center text-center gap-4">
                  <div className="h-16 w-16 rounded-3xl bg-accent/10 flex items-center justify-center">
                    <Handshake size={28} className="text-accent" />
                  </div>
                  <div>
                    <p className="font-bold text-lg text-foreground">{adminT("mdmak_no_offer")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{adminT("mdmak_no_offer_desc")}</p>
                  </div>
                  <button
                    onClick={() => setOfferDialogOpen(true)}
                    className="px-6 py-2.5 rounded-xl bg-accent text-primary font-bold text-sm shadow-lg shadow-accent/20 hover:bg-accent/90 transition-all flex items-center gap-2"
                  >
                    <TrendingUp size={15} />
                    {adminT("mdmak_create_offer")}
                  </button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {/* Status banner */}
                <div className={cn(
                  "rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4",
                  procurement.status === "accepted" ? "bg-success/10 border border-success/20" :
                  procurement.status === "rejected" ? "bg-destructive/5 border border-destructive/10" :
                  "bg-accent/5 border border-accent/20"
                )}>
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase">{adminT("mdmak_offer_status")}</p>
                    <p className={cn(
                      "font-black text-lg mt-0.5",
                      procurement.status === "accepted" ? "text-success" :
                      procurement.status === "rejected" ? "text-destructive" : "text-accent"
                    )}>
                      {adminT(`mdmak_status_${procurement.status}`)}
                    </p>
                  </div>
                  {procurement.status === "pending" && (
                    <button
                      onClick={() => setOfferDialogOpen(true)}
                      className="px-5 py-2 rounded-xl bg-accent text-primary font-bold text-sm shadow-md shadow-accent/20 hover:bg-accent/90 transition-all flex items-center gap-1.5 shrink-0"
                    >
                      <TrendingUp size={13} />
                      {adminT("mdmak_resend_offer")}
                    </button>
                  )}
                </div>

                {/* Financial breakdown */}
                <Card className="border-none shadow-sm">
                  <CardHeader className="border-b pb-4">
                    <CardTitle className="text-base flex items-center gap-2">
                      <DollarSign size={16} className="text-accent" />
                      {adminT("mdmak_breakdown")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 bg-slate-50 rounded-xl text-center">
                      <p className="text-xs text-muted-foreground mb-1.5">{adminT("mdmak_internal_cost")}</p>
                      <p className="text-2xl font-black text-foreground">{procurement.internalCost?.toLocaleString("ar-SA")}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">ر.س</p>
                    </div>
                    <div className="p-4 bg-amber-50 rounded-xl text-center border border-amber-100">
                      <p className="text-xs text-muted-foreground mb-1.5 flex items-center justify-center gap-1">
                        <Percent size={11} />{adminT("mdmak_commission")}
                      </p>
                      <p className="text-2xl font-black text-amber-600">{procurement.commissionAmount?.toLocaleString("ar-SA")}</p>
                      <p className="text-xs text-amber-500 mt-0.5">{procurement.commissionRate}%</p>
                    </div>
                    <div className="p-4 bg-accent/10 rounded-xl text-center border border-accent/20">
                      <p className="text-xs text-muted-foreground mb-1.5">{adminT("mdmak_final_price")}</p>
                      <p className="text-2xl font-black text-accent">{procurement.finalPrice?.toLocaleString("ar-SA")}</p>
                      <p className="text-xs text-accent/70 mt-0.5">ر.س — {adminT("mdmak_contractor_sees")}</p>
                    </div>
                  </CardContent>
                </Card>

                {procurement.adminNotes && (
                  <Card className="border-none shadow-sm">
                    <CardContent className="p-5">
                      <p className="text-xs font-bold text-muted-foreground mb-2">{adminT("mdmak_notes")}</p>
                      <p className="text-sm text-foreground">{procurement.adminNotes}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <CreateMdmakOfferDialog
          open={offerDialogOpen}
          onClose={() => setOfferDialogOpen(false)}
          rfq={rfq ? { id: rfqId, title: rfq.title as string, contractorId: rfq.contractorId as string, organizationId: rfq.organizationId as string } : null}
          onSuccess={() => {
            getMdmakProcurementForRfq(firestore!, rfqId).then(p => setProcurement(p))
          }}
        />
      </div>
    </PortalLayout>
  )
}
