"use client"

// Offers at a glance (customer review, 27 Sep 2026): clicking an RFQ in the
// list opens every offer received with its prices side by side — one row per
// material, one column per supplier, each offer's total at the bottom, the
// lowest live figure marked — without opening each quote. A sealed round shows
// who quoted and how many, never an amount; someone who does not see prices
// (an expediter) sees the suppliers and their status only. The full offers page
// is one click away for decisions.

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, query, where } from "firebase/firestore"
import { ExternalLink, FileText, Loader2, Lock, TrendingDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Money } from "@/components/procurement/PoBits"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useProcActor } from "@/hooks/useProcActor"
import { Link } from "@/i18n/routing"
import { offersSealed } from "@/lib/procurement/award"
import { offerMatrix, type MatrixOffer } from "@/lib/procurement/offer-matrix"
import { offerPrice } from "@/lib/procurement/po"
import { resolvePolicies } from "@/lib/procurement/policies"
import { PROCUREMENT_SETTINGS, type ProcurementPolicies } from "@/lib/procurement/types"
import { cn } from "@/lib/utils"

const REJECTED = "مرفوض"
const ACCEPTED = "مقبول"

export interface SheetRfq {
  id: string
  title?: string
  projectId?: string | null
  deadline?: string | null
  status?: string | null
  pricingMode?: string | null
  shipmentMode?: string | null
  products?: Array<{ name?: string | null; quantity?: number | string | null; unitOfMeasure?: string | null; unit?: string | null }> | null
}

type SheetOffer = MatrixOffer & {
  companyName?: string | null
  supplierName?: string | null
  isFromMdmak?: boolean
  executionDuration?: string | number | null
  executionDurationUnit?: string | null
  createdAt?: string | null
}

export function RfqOffersSheet({ rfq, offersHref, open, onOpenChange }: { rfq: SheetRfq | null; offersHref: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { actor, orgId } = useProcActor(rfq?.projectId || undefined)

  const offersQuery = useMemoFirebase(() => (firestore && rfq?.id && open ? query(collection(firestore, "offers"), where("rfqId", "==", rfq.id)) : null), [firestore, rfq?.id, open])
  const { data, isLoading } = useCollection(offersQuery)
  const policiesRef = useMemoFirebase(() => (firestore && orgId && open ? doc(firestore, PROCUREMENT_SETTINGS, orgId) : null), [firestore, orgId, open])
  const { data: policiesDoc } = useDoc(policiesRef)
  const policies = useMemo<ProcurementPolicies>(() => resolvePolicies(policiesDoc as Partial<ProcurementPolicies> | null), [policiesDoc])

  const offers = useMemo(
    () =>
      ((data ?? []) as unknown as SheetOffer[])
        .slice()
        // Live offers first, cheapest first; rejected ones last.
        .sort((a, b) => Number(a.status === REJECTED) - Number(b.status === REJECTED) || (offerPrice(a) ?? Infinity) - (offerPrice(b) ?? Infinity)),
    [data]
  )
  const sealed = offersSealed(rfq, policies, new Date())
  const seesPrices = Boolean(actor?.seesPrices)
  const matrix = useMemo(() => offerMatrix(rfq, offers), [rfq, offers])
  const nameOf = (o: SheetOffer) => o.companyName || o.supplierName || t("offers_registered_supplier")
  const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 })

  const statusBadge = (o: SheetOffer) =>
    o.status === ACCEPTED ? (
      <Badge className="border-none bg-success/10 text-[10px] text-success">{t("rfq_glance_status_accepted")}</Badge>
    ) : o.status === REJECTED ? (
      <Badge className="border-none bg-muted text-[10px] text-muted-foreground">{t("rfq_glance_status_rejected")}</Badge>
    ) : (
      <Badge className="border-none bg-cta/10 text-[10px] text-cta">{t("rfq_glance_status_review")}</Badge>
    )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isRtl ? "left" : "right"} dir={isRtl ? "rtl" : "ltr"} className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-4xl">
        <SheetHeader className="space-y-1 border-b px-4 py-4 text-start sm:px-6">
          <SheetTitle className="flex items-center gap-2 text-lg font-black leading-relaxed text-primary">
            <FileText size={20} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate" dir="auto">
              {rfq?.title}
            </span>
          </SheetTitle>
          <SheetDescription>{t("rfq_glance_desc", { count: offers.length })}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 px-4 py-4 sm:px-6">
          {isLoading ? (
            <div className="flex justify-center p-10">
              <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
            </div>
          ) : offers.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("offers_no_data")}</p>
          ) : sealed || !seesPrices ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
                <Lock size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p>{sealed ? t("rfq_glance_sealed", { date: rfq?.deadline ? new Date(rfq.deadline).toLocaleDateString(locale) : "—" }) : t("rfq_glance_no_prices")}</p>
              </div>
              <ul className="divide-y rounded-xl border">
                {offers.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-semibold" dir="auto">
                      {nameOf(o)}
                    </span>
                    {statusBadge(o)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted/50 text-xs">
                  <tr>
                    <th scope="col" className="sticky start-0 z-10 bg-muted/90 px-3 py-2.5 text-start font-black">
                      {t("rfq_glance_material")}
                    </th>
                    {offers.map((o) => (
                      <th key={o.id} scope="col" className={cn("px-3 py-2.5 text-start align-top", o.status === REJECTED && "opacity-60")}>
                        <span className="block max-w-[11rem] truncate font-black" dir="auto" title={nameOf(o)}>
                          {nameOf(o)}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          {statusBadge(o)}
                          {o.isFromMdmak && <Badge className="border-none bg-accent/15 text-[10px] text-primary">{t("rfq_glance_mdmak")}</Badge>}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.hasRates &&
                    matrix.rows.map((r) => (
                      <tr key={r.rfqProductIndex} className="border-t">
                        <th scope="row" className="sticky start-0 z-10 bg-card px-3 py-2 text-start font-semibold">
                          <span className="block max-w-[14rem] truncate" dir="auto" title={r.name}>
                            {r.name}
                          </span>
                          <span className="block text-[11px] font-normal text-muted-foreground" dir="ltr">
                            {qty(r.quantity)} {r.unit}
                          </span>
                        </th>
                        {r.cells.map((c) => (
                          <td key={c.offerId} className={cn("px-3 py-2 align-top", c.lowest && "bg-success/10")}>
                            {c.unitPrice === null ? (
                              <span className="text-xs text-muted-foreground">{t("rfq_glance_total_only")}</span>
                            ) : (
                              <>
                                <Money value={c.unitPrice} className={cn("block font-bold", c.lowest && "text-success")} />
                                {c.lineTotal !== null && (
                                  <span className="block text-[11px] text-muted-foreground">
                                    <Money value={c.lineTotal} />
                                  </span>
                                )}
                              </>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  <tr className="border-t-2 bg-muted/30">
                    <th scope="row" className="sticky start-0 z-10 bg-muted/90 px-3 py-2.5 text-start font-black">
                      {t("rfq_glance_total")}
                    </th>
                    {matrix.columns.map((c) => (
                      <td key={c.offerId} className={cn("px-3 py-2.5", c.lowestTotal && "bg-success/15")}>
                        {c.total === null ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Money value={c.total} className={cn("font-black", c.rejected && "line-through text-muted-foreground", c.lowestTotal && "text-success")} />
                            {c.lowestTotal && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-success/15 px-1.5 text-[10px] font-bold text-success">
                                <TrendingDown size={10} aria-hidden="true" />
                                {t("rfq_glance_lowest")}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t text-xs text-muted-foreground">
                    <th scope="row" className="sticky start-0 z-10 bg-card px-3 py-2 text-start font-semibold">
                      {t("rfq_glance_duration")}
                    </th>
                    {offers.map((o) => (
                      <td key={o.id} className="px-3 py-2">
                        {o.executionDuration ? `${o.executionDuration} ${o.executionDurationUnit ?? ""}` : "—"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {!sealed && seesPrices && offers.length > 0 && <p className="text-[11px] text-muted-foreground">{t("rfq_glance_note")}</p>}
        </div>

        <div className="border-t px-4 py-3 sm:px-6">
          <Button asChild className="gap-2">
            <Link href={offersHref}>
              <ExternalLink size={15} aria-hidden="true" />
              {t("rfq_glance_open_full")}
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
