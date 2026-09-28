"use client"

// A price agreement's drawer (prototype dAgr): the warning while it can still be
// renewed, each material's agreed price beside the last price we paid ELSEWHERE,
// the orders placed on it, and its log.

import { useLocale, useTranslations } from "next-intl"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { displayAgreementNumber, displayPoNumber } from "@/lib/procurement/format"
import { poValue } from "@/lib/procurement/po"
import { AGREEMENT_EXPIRY_WINDOW_DAYS, agreementDaysLeft, agreementState, lastPaid, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { ordersOnAgreement } from "@/lib/procurement/supplier-file"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { Money, useDateText } from "./PoBits"
import { sarLtr } from "@/lib/riyal"

/** A unit price, as the prototype's R2: two decimals, the riyal sign on its left. */
const priceText = (n: number) => sarLtr(Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export function AgreementDrawer({
  agreement,
  open,
  onOpenChange,
  history,
  orders,
  today,
  mayEdit,
  onRenew,
  onEnd,
}: {
  agreement: PriceAgreement | null
  open: boolean
  onOpenChange: (open: boolean) => void
  history: PriceHistoryEntry[]
  orders: PurchaseOrder[]
  today: string
  mayEdit: boolean
  onRenew: (a: PriceAgreement) => void
  onEnd: (a: PriceAgreement) => void
}) {
  const t = useTranslations("Portal.ProcPrices")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const fmt = useDateText()
  if (!agreement) return null
  const state = agreementState(agreement, today)
  const left = agreementDaysLeft(agreement, today)
  const placed = ordersOnAgreement(orders, agreement.id)
  const elsewhere = history.filter((h) => h.supplierOrgId !== agreement.supplierOrgId)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isRtl ? "left" : "right"} dir={isRtl ? "rtl" : "ltr"} className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1 border-b px-5 py-4 text-start">
          <SheetTitle dir="ltr" className="text-start text-lg">
            {displayAgreementNumber(agreement.docNumber, locale)}
          </SheetTitle>
          <SheetDescription>
            {agreement.supplierName || "—"} · {state === "expired" ? t("drawer.ended", { date: fmt(agreement.until) }) : t("drawer.ends", { date: fmt(agreement.until) })}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-5 py-4">
          {state === "expiring" && left >= 0 && left <= AGREEMENT_EXPIRY_WINDOW_DAYS && <Callout tone="warn">{t("drawer.expiring", { days: left })}</Callout>}

          <DrawerSection title={t("drawer.items")}>
            {(agreement.lines || []).map((l, i) => {
              const last = lastPaid(elsewhere, l.name, l.unit)
              return (
                <div key={i} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2 text-sm">
                  <span>
                    <b dir="auto">{l.name}</b>
                    {last && <span className="block text-[11px] text-muted-foreground">{t("agreements.lastElsewhere", { price: priceText(last.price), supplier: last.supplierName || "—" })}</span>}
                  </span>
                  <span className="shrink-0">
                    <b className="tabular-nums" dir="ltr">
                      {priceText(l.price)}
                    </b>{" "}
                    / {l.unit}
                  </span>
                </div>
              )
            })}
            {agreement.note && (
              <p className="py-2 text-sm text-muted-foreground" dir="auto">
                {agreement.note}
              </p>
            )}
            {mayEdit && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => onRenew(agreement)}>
                  {t("agreements.renew")}
                </Button>
                {state !== "expired" && (
                  <Button size="sm" variant="ghost" onClick={() => onEnd(agreement)}>
                    {t("agreements.end")}
                  </Button>
                )}
              </div>
            )}
          </DrawerSection>

          <DrawerSection title={t("drawer.orders")} count={placed.length}>
            {placed.length ? (
              placed.map((po) => (
                <Link
                  key={po.id}
                  href={`/contractor/rfqs/orders?po=${po.id}`}
                  className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-sm last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span>
                    <b dir="ltr">{displayPoNumber(po.docNumber, locale)}</b> · {fmt(po.createdAt)}
                  </span>
                  <Money value={poValue(po)} className="text-xs font-bold" />
                </Link>
              ))
            ) : (
              <p className="py-2 text-sm text-muted-foreground">{t("drawer.no_orders")}</p>
            )}
          </DrawerSection>

          <DrawerSection title={t("drawer.log")} count={agreement.log?.length || 0} defaultOpen={false}>
            {agreement.log?.length ? (
              [...agreement.log].reverse().map((l, i) => (
                <p key={i} className="border-b border-border/60 py-2 text-sm last:border-b-0">
                  {t(`drawer.log_${l.action}`, { until: fmt(String(l.params?.until ?? "")), reason: String(l.params?.reason ?? "") })} <span className="text-xs text-muted-foreground">— {l.byName} · {fmt(l.at)}</span>
                </p>
              ))
            ) : (
              <p className="py-2 text-sm text-muted-foreground">{t("drawer.no_log")}</p>
            )}
          </DrawerSection>
        </div>
      </SheetContent>
    </Sheet>
  )
}
