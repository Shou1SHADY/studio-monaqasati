"use client"

// «اطلب عيّنة» — kept as it is while the sample request is an open decision (PRD §21 #15): what, where, and by when. It asks
// the supplier on the offer itself; a visitor has no inbox, so the buyer reaches him on WhatsApp from the off-platform box.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { addDoc, collection, doc, updateDoc } from "firebase/firestore"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { addDays } from "@/lib/procurement/po"
import type { OfferRowModel } from "@/lib/procurement/rfq-offers-view"
import type { RfqView } from "./rfqOfferView"

export function OfferSampleDialog({ row, rfq, today, onClose }: { row: OfferRowModel | null; rfq: RfqView | null; today: string; onClose: () => void }) {
  const t = useTranslations("Portal.Contractor")
  const tp = useTranslations("Portal.Procurement.rfqpage.drawer")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [ask, setAsk] = useState({ what: "", place: "", by: "" })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!row || !rfq) return
    const r = rfq as { deliveryLocation?: string; district?: string; city?: string }
    setAsk({ what: "", place: r.deliveryLocation || [r.city, r.district].filter(Boolean).join(" — "), by: addDays(today, 5) })
  }, [row, rfq, today])

  const ok = Boolean(ask.what.trim() && ask.place.trim() && ask.by && ask.by >= today)

  const send = async () => {
    if (!firestore || !row || !ok) return
    setBusy(true)
    try {
      const now = new Date().toISOString()
      await updateDoc(doc(firestore, "offers", row.id), {
        sampleStatus: "مطلوبة",
        sampleUpdatedAt: now,
        sampleWhat: ask.what.trim().slice(0, 300),
        samplePlace: ask.place.trim().slice(0, 300),
        sampleBy: ask.by,
        sampleRequestedAt: now,
        sampleSentAt: null,
        sampleReceivedBy: null,
        sampleNote: null,
      })
      const o = row.offer as { supplierId?: string; organizationId?: string; isGuestOffer?: boolean; rfqTitle?: string }
      if (o.supplierId && !o.isGuestOffer) {
        await addDoc(collection(firestore, "users", o.supplierId, "notifications"), {
          userId: o.supplierId,
          organizationId: o.organizationId || o.supplierId,
          type: "sample_requested",
          i18n: { title: "pn_sample_requested_title", message: "pn_sample_requested", params: { rfq: o.rfqTitle || rfq?.title || "" } },
          title: "طلب عينة جديد",
          message: `قام المقاول بطلب عينة لطلب عروض الأسعار: ${o.rfqTitle || rfq?.title || ""}`,
          offerId: row.id,
          rfqId: rfq?.id,
          createdAt: now,
          read: false,
        })
      }
      toast({ title: t("offers_toast_sample_req"), description: t("offers_toast_sample_req_desc") })
      onClose()
    } catch (err) {
      console.error("sample request failed:", (err as { code?: string })?.code || err)
      toast({ title: t("offers_toast_error"), description: t("offers_toast_sample_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={row != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("offers_sample_dialog_title")}</DialogTitle>
          <DialogDescription>{t("offers_sample_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sample-what" className="text-xs font-bold">{t("offers_sample_what")}</Label>
            <Input id="sample-what" value={ask.what} maxLength={300} placeholder={t("offers_sample_what_ph")} onChange={(e) => setAsk((x) => ({ ...x, what: e.target.value }))} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="sample-place" className="text-xs font-bold">{t("offers_sample_place")}</Label>
              <Input id="sample-place" value={ask.place} maxLength={300} onChange={(e) => setAsk((x) => ({ ...x, place: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sample-by" className="text-xs font-bold">{t("offers_sample_by")}</Label>
              <Input id="sample-by" type="date" dir="ltr" min={today} value={ask.by} onChange={(e) => setAsk((x) => ({ ...x, by: e.target.value }))} />
            </div>
          </div>
          {!ok && <p className="text-[11px] text-destructive">{t("offers_sample_err")}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{tp("back")}</Button>
          <Button type="button" onClick={send} disabled={!ok || busy} className="gap-2">
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {t("offers_send_notification")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
