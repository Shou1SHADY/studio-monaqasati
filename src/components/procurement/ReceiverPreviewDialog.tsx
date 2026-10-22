"use client"

// «كما يراه المستلم» (prototype `lk-view`): what the receiver sees when this shipment reaches him — the same page, with its blind count: the
// order's number and the supplier, the delivery day, the note, the material names and units, and the two boxes (arrived · accepted). Nothing
// here can be typed into or sent; it is how the buyer checks what the receiver is looking at before he follows him up.

import { useLocale, useTranslations } from "next-intl"
import { Eye, PackageCheck } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { displayPoNumber } from "@/lib/procurement/format"
import { lineToArrive } from "@/lib/procurement/po"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"
import type { PurchaseOrder } from "@/lib/procurement/types"

export function ReceiverPreviewDialog({ open, onOpenChange, delivery, po, placeName }: { open: boolean; onOpenChange: (o: boolean) => void; delivery: DeskDelivery; po: PurchaseOrder | null; placeName: string }) {
  const t = useTranslations("ReceiveLink")
  const tp = useTranslations("Portal.ProcReceipts.preview")
  const locale = useLocale()
  const lines = (po ? po.lines.filter((l) => lineToArrive(l) > 0) : []).map((l) => ({ id: l.id, name: l.name, unit: l.unit }))
  const fw = delivery.forwardedTo
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2">
            <Eye size={16} className="text-module" aria-hidden="true" />
            {tp("title")}
          </DialogTitle>
          <DialogDescription>{tp("desc", { name: fw?.name || "—" })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-2xl border bg-background p-4" aria-label={tp("frame")}>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-module">
            <PackageCheck size={14} aria-hidden="true" />
            {t("eyebrow")}
          </p>
          <div className="space-y-0.5">
            <p className="text-lg font-black leading-relaxed">{delivery.supplierName || po?.supplierName || t("supplier_unknown")}</p>
            <p className="text-sm text-muted-foreground">
              {po && <span dir="ltr">{displayPoNumber(po.docNumber, locale)}</span>}
              {po?.rfqTitle ? ` · ${po.rfqTitle}` : ""}
            </p>
            <p className="text-xs text-muted-foreground" dir="auto">
              {placeName} · {tp("deliveryDay")} <span dir="ltr">{(delivery.deliveryDate || "").slice(0, 10)}</span>
              {delivery.notes ? ` · ${delivery.notes}` : ""}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">{t("blind_note")}</p>
          <ul className="space-y-2">
            {lines.map((l) => (
              <li key={l.id} className="space-y-2 rounded-xl border bg-card p-3">
                <p className="text-sm font-semibold">
                  {l.name} <span className="text-xs font-normal text-muted-foreground">({l.unit})</span>
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span className="rounded-md border border-dashed px-2 py-2">{t("counted")}</span>
                  <span className="rounded-md border border-dashed px-2 py-2">{t("accepted")}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("confirm_is_signature")} · {fw?.userId ? tp("viaAccount") : tp("viaLink")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
