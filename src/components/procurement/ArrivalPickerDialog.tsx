"use client"

// «وصلت بلا إشعار» (WF-18): the truck is at the gate and the supplier never notified. The member who RECEIVES (deliveries.confirm) picks the
// order it belongs to and lands on the receiver's page for it — the same blind count and the same confirmation that is the signature. This is
// the receiver's own door; a buyer without the receiving permission is not shown it.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Search, Truck } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useRouter } from "@/i18n/routing"
import { displayPoNumber } from "@/lib/procurement/format"
import { lineToArrive, poStatus } from "@/lib/procurement/po"
import { matchesSearch } from "@/lib/search-text"
import type { PurchaseOrder } from "@/lib/procurement/types"

/** Orders a truck can be counted against: sent or accepted, with something still to arrive. */
export const receivableOrders = (orders: PurchaseOrder[]): PurchaseOrder[] =>
  orders.filter((o) => (o.status === "sent" || o.status === "accepted") && poStatus(o) !== "received" && o.lines.some((l) => lineToArrive(l) > 0))

export function ArrivalPickerDialog({ open, onOpenChange, orders }: { open: boolean; onOpenChange: (o: boolean) => void; orders: PurchaseOrder[] }) {
  const t = useTranslations("Portal.ProcReceipts.arrival")
  const locale = useLocale()
  const router = useRouter()
  const [term, setTerm] = useState("")
  const live = useMemo(() => receivableOrders(orders).filter((o) => matchesSearch(term, [o.docNumber, o.supplierName, o.rfqTitle, ...o.lines.map((l) => l.name)])), [orders, term])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2">
            <Truck size={16} className="text-module" aria-hidden="true" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" aria-hidden="true" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-10 ps-9" dir="auto" />
        </div>
        {live.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="space-y-2">
            {live.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/contractor/receive/po/${o.id}`)}
                  className="w-full rounded-lg border p-3 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block text-sm font-bold" dir="auto">
                    {o.supplierName} <span className="font-normal text-muted-foreground">· {displayPoNumber(o.docNumber, locale)}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground" dir="auto">
                    {o.lines.filter((l) => lineToArrive(l) > 0).map((l) => l.name).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
