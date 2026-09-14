"use client"

// The order's owner asks for a change (T20, D12): a new quantity or a
// cancellation, with the reason. The order stays in its stage until the
// workshop manager applies it and decides the work in hand; what already
// entered production stays (ORD-11).

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, FilePen, Info, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn, sanitizeDecimalInput } from "@/lib/utils"
import { minQuantity } from "@/lib/manufacturing-engine"
import { requestOrderChange, type Actor } from "@/lib/manufacturing-writes"
import { emitMfgEvent } from "@/lib/mfg-events"
import type { OrderView } from "@/lib/manufacturing-view"
import { RecordedAsLine, errText } from "@/components/inventory/MfgOutsideBits"

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })

export function ProjectOrderChangeDialog({
  view,
  orgId,
  actor,
  link,
  onClose,
}: {
  view: OrderView | null
  orgId: string
  actor: Actor
  link: string | null
  onClose: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const [kind, setKind] = useState<"quantity" | "cancel">("quantity")
  const [qty, setQty] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setKind("quantity")
    setQty(view ? String(view.quantity) : "")
    setReason("")
    setError(null)
  }, [view?.id]) // the open order only; its live updates keep the draft

  if (!view) return null
  const min = minQuantity(view.calc)
  const newQty = Number(qty) || 0
  const belowMin = kind === "quantity" && newQty > 0 && newQty < min

  const submit = async () => {
    if (!firestore || busy) return
    if (kind === "quantity" && !(newQty > 0)) {
      setError(t("mfg4_err_quantity_required"))
      return
    }
    if (!reason.trim()) {
      setError(t("mfg4_err_reason_required"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestOrderChange(firestore, { orderId: view.id, kind, newQuantity: kind === "quantity" ? newQty : null, reason: reason.trim(), module: "projects", actor })
      await emitMfgEvent(firestore, {
        kind: "change_requested",
        copy: t,
        organizationId: orgId,
        actor,
        to: [{ permission: "manufacturing.manage" }],
        params: { ref: view.ref, module: "@mfg4_module_projects", kind, qty: kind === "quantity" ? fmt(newQty) : "", unit: view.unit, reason: reason.trim() },
        workOrderId: view.id,
        link,
      })
      toast({ title: t("mfx_prj_change_done", { order: view.ref }) })
      onClose()
    } catch (err) {
      console.error(err)
      setError(errText(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!view} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePen size={18} className="text-cta" aria-hidden="true" />
            {t("mfx_prj_change_title")}
          </DialogTitle>
          <DialogDescription>{t("mfx_prj_change_desc", { order: view.ref, product: view.product.name, qty: fmt(view.quantity), unit: view.unit })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <RadioGroup value={kind} onValueChange={(v) => { setKind(v as "quantity" | "cancel"); setError(null) }} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(["quantity", "cancel"] as const).map((k) => (
              <label
                key={k}
                htmlFor={`mfx-change-${k}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border-2 bg-white px-3 py-2.5 transition-colors",
                  kind === k ? (k === "cancel" ? "border-destructive bg-destructive/5" : "border-cta bg-cta/5") : "border-border hover:border-slate-300"
                )}
              >
                <RadioGroupItem id={`mfx-change-${k}`} value={k} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-foreground">{t(`mfx_prj_change_${k}`)}</span>
                  <span className="block text-[11px] leading-relaxed text-muted-foreground">
                    {k === "quantity" ? t("mfx_prj_change_quantity_hint", { min: fmt(min), unit: view.unit }) : t("mfx_prj_change_cancel_hint")}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>

          {kind === "quantity" && (
            <div className="space-y-1.5">
              <Label htmlFor="mfx-change-qty">{t("mfx_prj_change_new_qty", { unit: view.unit })}</Label>
              <Input id="mfx-change-qty" inputMode="decimal" dir="ltr" className="h-11" value={qty} onChange={(e) => { setQty(sanitizeDecimalInput(e.target.value)); setError(null) }} disabled={busy} />
              {belowMin && (
                <p className="flex items-start gap-1.5 text-[11px] font-semibold text-warning">
                  <Info size={12} className="mt-px shrink-0" aria-hidden="true" />
                  {t("mfx_prj_change_below_min", { min: fmt(min), unit: view.unit })}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="mfx-change-reason">
              {t("mfx_prj_change_reason")}
              <span className="ms-0.5 text-destructive">*</span>
            </Label>
            <Textarea id="mfx-change-reason" rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setError(null) }} disabled={busy} />
          </div>

          <ul className="space-y-1 rounded-xl border bg-white px-3.5 py-2.5 text-xs text-slate-700">
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {t("mfx_prj_change_effect_apply")}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {t("mfx_prj_change_effect_stage")}
            </li>
          </ul>

          <RecordedAsLine name={actor.name} />
        </div>

        <DialogFooter className="flex-wrap items-center gap-2">
          {error && (
            <span className="me-auto flex items-center gap-1.5 text-[11px] font-semibold text-destructive">
              <AlertTriangle size={13} aria-hidden="true" /> {error}
            </span>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("crm_cancel")}
          </Button>
          <Button onClick={submit} disabled={busy} variant={kind === "cancel" ? "destructive" : "default"} className="gap-2">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FilePen size={15} />}
            {t("mfx_prj_change_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
