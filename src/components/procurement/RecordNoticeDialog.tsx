"use client"

// «سجّل إشعار تسليم» (PUR-06/07): a supplier outside the platform cannot notify, so whoever
// follows the order up records what his phone call said — the day and a word, never a quantity (G-08) — and it is
// forwarded to the receiver like any other. Written by the server (/api/procurement/record-notice).

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { todayOf } from "@/lib/procurement/po"
import type { PurchaseOrder } from "@/lib/procurement/types"

export function RecordNoticeDialog({ po, open, onOpenChange, onDone }: { po: PurchaseOrder; open: boolean; onOpenChange: (o: boolean) => void; onDone?: (deliveryId: string) => void }) {
  const t = useTranslations("Portal.ProcOrders")
  const locale = useLocale()
  const { toast } = useToast()
  const [day, setDay] = useState(() => todayOf(new Date()))
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const user = getAuth().currentUser
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/procurement/record-notice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ poId: po.id, deliveryDate: day, note: notes || null }),
      })
      const body = (await res.json().catch(() => null)) as { data?: { deliveryId?: string }; message?: string } | null
      if (!res.ok || !body?.data?.deliveryId) {
        setError(t("notice.failed"))
        return
      }
      toast({ title: t("notice.saved") })
      onOpenChange(false)
      onDone?.(body.data.deliveryId)
    } catch {
      setError(t("notice.failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("notice.title")}</DialogTitle>
          <DialogDescription>{t("notice.desc", { supplier: po.supplierName })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="rn-day" className="text-xs">{t("notice.day")}</Label>
            <Input id="rn-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} dir="ltr" className="h-10" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rn-notes" className="text-xs">{t("notice.notes")}</Label>
            <Textarea id="rn-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" />
          </div>
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("notice.cancel")}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || !day} className="gap-1.5">
            {busy && <Loader2 size={14} className="animate-spin" />}
            {t("notice.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
