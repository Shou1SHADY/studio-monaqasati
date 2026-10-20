"use client"

// «سجّل إشعار تسليم» (PUR-06/07): a supplier outside the platform cannot notify, so whoever
// follows the order up records his notice — the day and the quantities coming — and it is
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
import { lineOutstanding, todayOf } from "@/lib/procurement/po"
import type { PurchaseOrder } from "@/lib/procurement/types"

export function RecordNoticeDialog({ po, open, onOpenChange, onDone }: { po: PurchaseOrder; open: boolean; onOpenChange: (o: boolean) => void; onDone?: (deliveryId: string) => void }) {
  const t = useTranslations("Portal.ProcOrders")
  const locale = useLocale()
  const { toast } = useToast()
  const open_ = po.lines.filter((l) => lineOutstanding(l) > 0)
  const [day, setDay] = useState(() => todayOf(new Date()))
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open_.map((l) => [l.id, String(lineOutstanding(l))])))
  const [driver, setDriver] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lines = open_.map((l) => ({ poLineId: l.id, quantity: Number(qty[l.id] || 0) })).filter((l) => l.quantity > 0)

  const submit = async () => {
    const user = getAuth().currentUser
    if (!user || !lines.length) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/procurement/record-notice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ poId: po.id, deliveryDate: day, lines, driverName: driver || undefined, notes: notes || undefined }),
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
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{t("notice.lines")}</p>
            {open_.map((l) => (
              <label key={l.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate" dir="auto">
                  {l.name} <span className="text-xs text-muted-foreground">· {t("notice.open", { qty: lineOutstanding(l).toLocaleString("en-US"), unit: l.unit })}</span>
                </span>
                <Input inputMode="decimal" value={qty[l.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} aria-label={t("notice.qty_of", { name: l.name })} className="h-9 w-24 text-end tabular-nums" dir="ltr" />
              </label>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="rn-driver" className="text-xs">{t("notice.driver")}</Label>
            <Input id="rn-driver" value={driver} onChange={(e) => setDriver(e.target.value)} dir="auto" className="h-10" />
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
          <Button type="button" onClick={() => void submit()} disabled={busy || !lines.length || !day} className="gap-1.5">
            {busy && <Loader2 size={14} className="animate-spin" />}
            {t("notice.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
