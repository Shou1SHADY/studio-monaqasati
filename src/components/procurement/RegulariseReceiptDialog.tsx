"use client"

// Regularising a receipt that had no order (PRD 3.0 §6.1-11): a retroactive
// purchase order is raised over what was received — reason required, the
// supplier as written (editable), unit prices optional — routed to the owner
// alone. The receipt gains `poId`/`poNumber` when the actor may write
// deliveries; otherwise the order is raised and the receipt linked later.

import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { displayPoNumber } from "@/lib/procurement/format"
import { round2 } from "@/lib/procurement/po"
import { receiptLinesOf, type DeskDelivery } from "@/lib/procurement/receipt-desk"
import type { ProcActor } from "@/lib/procurement/types"
import { ProcWriteError, retroactivePurchaseOrder } from "@/lib/procurement/writes"

const schema = z.object({
  reason: z.string().trim().min(3),
  supplierName: z.string().trim().min(1),
  prices: z.array(z.string()),
})
type FormValues = z.infer<typeof schema>

export interface RegulariseReceiptDialogProps {
  delivery: DeskDelivery
  actor: ProcActor
  orgId: string
  onOpenChange: (open: boolean) => void
  onDone: (poId: string) => void
}

export function RegulariseReceiptDialog({ delivery: d, actor, orgId, onOpenChange, onDone }: RegulariseReceiptDialogProps) {
  const t = useTranslations("Portal.ProcReceipts")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const lines = useMemo(() => receiptLinesOf(d), [d])
  const items = (d.items || []) as Array<{ unitPrice?: number | null }>

  const { register, handleSubmit, watch, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { reason: d.receiptNote || "", supplierName: d.supplierName || "", prices: lines.map((_, i) => (items[i]?.unitPrice != null ? String(items[i].unitPrice) : "")) },
  })
  const prices = watch("prices")
  const total = round2(lines.reduce((s, l, i) => s + (Number(l.accepted ?? l.counted) || 0) * (Number(prices?.[i]) || 0), 0))

  const submit = handleSubmit(async (v) => {
    if (!firestore) return
    setSaving(true)
    try {
      const r = await retroactivePurchaseOrder(
        firestore,
        actor,
        {
          organizationId: orgId,
          rfqTitle: d.notes || lines.map((l) => l.name).join("، ") || d.supplierName || "",
          supplierName: v.supplierName,
          projectId: d.projectId ?? null,
          lines: lines.map((l, i) => ({ name: l.name, unit: l.unit, quantity: Number(l.accepted ?? l.counted) || 0, unitPrice: v.prices[i]?.trim() ? Number(v.prices[i]) : null, accepted: Number(l.accepted ?? l.counted) || 0 })),
          totalExVat: total,
          deliveryId: d.id,
          reason: v.reason,
        },
        { copy: tShared as unknown as import("@/lib/mfg-events").Translator, locale: locale as "ar" | "en" }
      )
      toast({ title: t("regularise.done", { number: displayPoNumber(r.docNumber, locale) }), description: r.deliveryLinked ? undefined : t("regularise.notLinked") })
      onDone(r.id)
    } catch (err) {
      if (err instanceof ProcWriteError) toast({ title: t("toast.refused"), description: t(`err.${err.code}` as "err.wrong_state"), variant: "destructive" })
      else {
        console.error("retroactive order not raised:", err)
        toast({ title: t("toast.failed"), variant: "destructive" })
      }
    } finally {
      setSaving(false)
    }
  })

  return (
    <Dialog open onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle>{t("regularise.title")}</DialogTitle>
          <DialogDescription>{t("regularise.subtitle")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reg-supplier">{t("regularise.supplier")} *</Label>
            <Input id="reg-supplier" dir="auto" {...register("supplierName")} />
          </div>
          <div className="space-y-2">
            <Label>{t("regularise.lines")}</Label>
            {lines.map((l, i) => (
              <div key={l.poLineId} className="flex items-center gap-2 rounded-md border p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" dir="auto">{l.name}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {l.accepted ?? l.counted} {l.unit}
                  </p>
                </div>
                <div className="w-32">
                  <Label htmlFor={`reg-price-${i}`} className="text-[11px]">{t("regularise.unitPrice")}</Label>
                  <Input id={`reg-price-${i}`} inputMode="decimal" dir="ltr" placeholder="—" className="h-9 tabular-nums" {...register(`prices.${i}`)} />
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">{t("regularise.total", { total: new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(total) })}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-reason">{t("regularise.reason")} *</Label>
            <Textarea id="reg-reason" rows={3} dir="auto" placeholder={t("regularise.reasonPlaceholder")} {...register("reason")} />
          </div>
          <p className="rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">{t("regularise.effect")}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t("regularise.cancel")}
            </Button>
            <Button type="submit" disabled={saving || !formState.isValid} className="gap-2">
              {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {t("regularise.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
