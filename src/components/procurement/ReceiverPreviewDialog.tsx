"use client"

// «كما يراه المستلم» (prototype `lk-view`, RC-07): what the receiver sees when this shipment reaches him — the SAME page, read-only. A frame
// strip says how it reaches him (a link `mdmak.sa/receive/…`, or «مدماك · مهامي» inside his account); the page's own head (the Mdmak
// strip with the company, the order and notice numbers, «شحنة من …», where · when · the note); for a link receiver the code step first;
// then the blind count (arrived · accepted, no ordered quantity), the three proof buttons (photo · weighbridge ticket · mill
// certificate), the note and «أكّد الاستلام · التأكيد هو التوقيع · {where}». Nothing here can be typed into or sent; it is how the buyer
// checks what the receiver is looking at before he follows him up. Phone or full width, as the buyer likes to look at it.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Camera, Eye, FileText, Lock, Monitor, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Chip } from "@/components/module-ui/Chip"
import { useModules } from "@/hooks/useCompanyModules"
import { cn } from "@/lib/utils"
import { lineToArrive } from "@/lib/procurement/po"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"
import { receivePlace } from "@/lib/procurement/receive-view"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { ReceivePageHead } from "./receive/ReceivePageHead"

export function ReceiverPreviewDialog({
  open,
  onOpenChange,
  delivery,
  po,
  placeName,
  companyName,
  noticeNumber,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  delivery: DeskDelivery
  po: PurchaseOrder | null
  placeName: string
  /** The buying company, as the page's strip names it. */
  companyName?: string | null
  /** Our number for this notice (`ASN-…`), as the page's head shows it. */
  noticeNumber?: string | null
}) {
  const t = useTranslations("ReceiveLink")
  const tp = useTranslations("Portal.ProcReceipts.preview")
  const locale = useLocale()
  const pmOn = useModules().on("project-management")
  const [view, setView] = useState<"phone" | "full">("phone")
  const lines = (po ? po.lines.filter((l) => lineToArrive(l) > 0) : []).map((l) => ({ id: l.id, name: l.name, unit: l.unit }))
  const fw = delivery.forwardedTo
  const byLink = Boolean(fw && !fw.userId)
  const projectId = delivery.projectId || po?.projectId || null
  const where = projectId ? (pmOn ? t("where_project") : t("where_site")) : t("where_warehouse")
  const place = receivePlace({ site: po?.site || null, warehouse: { name: placeName } })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className={cn("max-h-[92vh] overflow-y-auto", view === "phone" ? "max-w-md" : "max-w-3xl")}>
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2">
            <Eye size={16} className="text-module" aria-hidden="true" />
            {tp("title")}
          </DialogTitle>
          <DialogDescription>{tp("desc", { name: fw?.name || "—" })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={tp("view")}>
          <Chip selected={view === "phone"} icon={Smartphone} onClick={() => setView("phone")}>
            {tp("view_phone")}
          </Chip>
          <Chip selected={view === "full"} icon={Monitor} onClick={() => setView("full")}>
            {tp("view_full")}
          </Chip>
        </div>
        <div className="overflow-hidden rounded-2xl border bg-background" aria-label={tp("frame")}>
          <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground">
            <Lock size={11} aria-hidden="true" />
            {byLink ? (
              <span dir="ltr">mdmak.sa/receive/…</span>
            ) : (
              <span>{tp("tasks_frame")}</span>
            )}
          </div>
          <div className="space-y-4 p-4" inert>
            <ReceivePageHead
              companyName={companyName}
              supplierName={delivery.supplierName || po?.supplierName}
              poNumber={po?.docNumber || delivery.poNumber}
              noticeNumber={noticeNumber}
              rfqTitle={po?.rfqTitle}
              placeName={place.placeName}
              address={place.address}
              mapUrl={place.mapUrl}
              deliveryDate={delivery.deliveryDate}
              note={delivery.notes}
              localeSwitch={
                <span className="inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-xs font-semibold text-muted-foreground" aria-hidden="true">
                  {t("switch_lang")}
                </span>
              }
            />
            {byLink && (
              <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
                <p className="text-sm font-bold">{tp("code_step", { phone: fw?.phoneMasked || "" })}</p>
                <div className="flex gap-2">
                  <Input disabled placeholder="••••••" dir="ltr" className="h-10 text-center tracking-latin" aria-label={t("code_label")} />
                  <Button type="button" disabled>
                    {tp("code_enter")}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">{t("code_scope")}</p>
              </div>
            )}
            <section className="space-y-2">
              <h2 className="text-sm font-bold">{t("lines_title")}</h2>
              <p className="text-xs text-muted-foreground">{t("blind_note")}</p>
              <ul className={cn("grid gap-2", view === "full" && "sm:grid-cols-2")}>
                {lines.map((l) => (
                  <li key={l.id} className="space-y-2 rounded-xl border bg-card p-3">
                    <p className="text-sm font-semibold">
                      {l.name} <span className="text-xs font-normal text-muted-foreground">({l.unit})</span>
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px]">{t("counted")}</Label>
                        <Input disabled dir="ltr" className="h-9" aria-label={t("counted")} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">{t("accepted")}</Label>
                        <Input disabled dir="ltr" className="h-9" aria-label={t("accepted")} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <div className="grid grid-cols-3 gap-2">
              {(["photo", "ticket", "cert"] as const).map((k) => (
                <span key={k} className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-2 text-center text-[11px] font-semibold text-muted-foreground">
                  {k === "photo" ? <Camera size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
                  {t(`file_${k}`)}
                </span>
              ))}
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">{t("note")}</Label>
              <Input disabled aria-label={t("note")} />
            </div>
            <div className="space-y-1.5">
              <Button type="button" className="w-full" disabled>
                {t("confirm")}
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("confirm_is_signature")} · {where} · {fw?.userId ? tp("viaAccount") : tp("viaLink")}
              </p>
            </div>
            <p className="border-t pt-2 text-center text-[10.5px] text-muted-foreground">{t("footer")}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
