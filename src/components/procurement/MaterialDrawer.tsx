"use client"

// A material's price file (prototype dMat): the last price we paid, how long
// it usually takes to arrive, the live agreement that prices it now if any, and
// the last ten purchases — how much, from whom, when.

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Link } from "@/i18n/routing"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { displayCategory } from "@/lib/constants"
import { displayAgreementNumber, displayPoNumber } from "@/lib/procurement/format"
import { agreementFor, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { materialCategory, materialPurchases, usualLeadDays } from "@/lib/procurement/supplier-file"
import type { PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"
import { useDateText } from "./PoBits"

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-1 text-base font-black text-foreground">{children}</div>
    </div>
  )
}

export function MaterialDrawer({
  material,
  open,
  onOpenChange,
  history,
  orders,
  receipts,
  agreements,
  today,
}: {
  material: { key: string; name: string; unit: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
  history: PriceHistoryEntry[]
  orders: PurchaseOrder[]
  receipts: ReceiptFact[]
  agreements: PriceAgreement[]
  today: string
}) {
  const t = useTranslations("Portal.ProcPrices")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const fmt = useDateText()
  if (!material) return null
  const bought = materialPurchases(history, material.key)
  const last = bought[0]
  const lead = usualLeadDays(orders, receipts, material.key)
  const category = materialCategory(orders, material.key)
  const live = agreementFor(agreements, material.name, material.unit, today)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isRtl ? "left" : "right"} dir={isRtl ? "rtl" : "ltr"} className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="space-y-1 border-b px-5 py-4 text-start">
          <SheetTitle className="text-lg" dir="auto">
            {material.name}
          </SheetTitle>
          <SheetDescription>{[category ? displayCategory(category, locale) : null, material.unit].filter(Boolean).join(" · ")}</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t("material.last_price")}>
              {last ? (
                <>
                  <span dir="ltr" className="tabular-nums">
                    {last.price}
                  </span>{" "}
                  <small className="text-xs font-normal text-muted-foreground">/ {material.unit}</small>
                </>
              ) : (
                "—"
              )}
            </Stat>
            <Stat label={t("material.lead")}>{lead == null ? "—" : t("material.days", { count: lead })}</Stat>
          </div>
          {live && (
            <Callout tone="info">
              {t("material.live_agreement", {
                number: displayAgreementNumber(live.agreement.docNumber, locale),
                supplier: live.agreement.supplierName || "—",
                price: live.price,
                date: fmt(live.agreement.until),
              })}
            </Callout>
          )}
          <DrawerSection title={t("material.purchases")} count={bought.length}>
            {bought.map((h) => (
              <div key={h.id} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2 text-sm last:border-b-0">
                <span>
                  <span dir="auto">{h.supplierName || "—"}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {fmt(h.day)}
                    {h.poNumber && h.poId && (
                      <>
                        {" · "}
                        <Link href={`/contractor/rfqs/orders?po=${h.poId}`} className="rounded text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="ltr">
                          {displayPoNumber(h.poNumber, locale)}
                        </Link>
                      </>
                    )}
                  </span>
                </span>
                <b className="tabular-nums" dir="ltr">
                  {h.price}
                </b>
              </div>
            ))}
          </DrawerSection>
        </div>
      </SheetContent>
    </Sheet>
  )
}
