"use client"

// Inventory receives the usable remnants a workshop order returned (T26,
// MAT-07): a new stock row lands as its own remnant block, and the order is
// credited at Finance's remnant policy. Manufacturing only reads the result.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, Loader2, PackagePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { RemnantRecord } from "@/lib/manufacturing-engine"
import { receiveRemnant, type Actor, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { emitMfgEvent, mfgLinks } from "@/lib/mfg-events"
import type { MfgFactsWarehouse } from "@/hooks/useMfgFacts"
import { RecordedAsLine, errText } from "./MfgOutsideBits"

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })

export interface RemnantTarget {
  key: string
  order: WorkOrderV2
  orderRef: string
  remnant: RemnantRecord
}

export function MfgRemnantReceiveDialog({
  target,
  warehouses,
  orgId,
  actor,
  seesValue,
  onClose,
}: {
  target: RemnantTarget | null
  warehouses: MfgFactsWarehouse[]
  orgId: string
  actor: Actor
  seesValue: boolean
  onClose: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const stores = useMemo(() => warehouses.filter((w) => !w.isOutbound && !w.virtual), [warehouses])
  const [warehouseId, setWarehouseId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setWarehouseId("")
    setError(null)
  }, [target?.key])
  useEffect(() => {
    if (!warehouseId && stores.length) setWarehouseId(stores.find((w) => w.isCentral)?.id || stores[0].id)
  }, [stores, warehouseId])

  if (!target) return null
  const r = target.remnant
  const warehouseName = stores.find((w) => w.id === warehouseId)?.name || ""

  const submit = async () => {
    if (!firestore || busy) return
    if (!warehouseId) {
      setError(t("mfx_issue_pick_warehouse"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await receiveRemnant(firestore, { orderId: target.order.id, remnantId: r.id, warehouseId, organizationId: orgId, actor })
      // inventory.remnants.received — the order is credited (INV-06).
      await emitMfgEvent(firestore, {
        kind: "remnants_received",
        copy: t,
        organizationId: orgId,
        actor,
        to: [{ permission: "manufacturing.manage" }, { users: [r.byId] }],
        params: { ref: target.orderRef, qty: fmt(r.area), unit: r.unit },
        workOrderId: target.order.id,
        link: mfgLinks.order(target.order.id),
      })
      toast({ title: t("mfx_rem_done", { qty: fmt(r.area), unit: r.unit, warehouse: warehouseName }) })
      onClose()
    } catch (err) {
      console.error(err)
      setError(errText(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus size={18} className="text-success" aria-hidden="true" />
            {t("mfx_rem_title")}
          </DialogTitle>
          <DialogDescription>{t("mfx_rem_desc", { order: target.orderRef })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <dl className="overflow-hidden rounded-xl border bg-white text-xs">
            {[
              [t("mfx_dn_item"), <span key="i" dir="auto">{r.itemName}</span>],
              [t("mfx_rem_area"), <span key="a" dir="ltr" className="tabular-nums">{fmt(r.area)} {r.unit}</span>],
              r.lot ? [t("mfx_rem_block"), <span key="l" dir="ltr" className="font-mono">{r.lot}</span>] : null,
              seesValue ? [t("mfx_rem_value"), <span key="v" dir="ltr" className="tabular-nums">{fmt(r.value)} {t("mfg4_sar")}</span>] : null,
              [t("mfx_rem_returned_by"), <span key="b" dir="auto">{r.by}</span>],
            ]
              .filter(Boolean)
              .map((row, i) => (
                <div key={i} className="flex gap-3 border-b border-border/60 px-3.5 py-2 last:border-b-0">
                  <dt className="w-28 shrink-0 text-muted-foreground">{row![0]}</dt>
                  <dd className="min-w-0 font-semibold text-foreground">{row![1]}</dd>
                </div>
              ))}
          </dl>

          <div className="space-y-1.5">
            <Label htmlFor="mfx-rem-wh">{t("mfx_rem_into")}</Label>
            <Select value={warehouseId || undefined} onValueChange={(v) => { setWarehouseId(v); setError(null) }}>
              <SelectTrigger id="mfx-rem-wh" className="h-11">
                <SelectValue placeholder={t("mfx_issue_pick_warehouse")} />
              </SelectTrigger>
              <SelectContent>
                {stores.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                    {w.projectId ? ` — ${t("mfx_wh_project_tag")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ul className="space-y-1 rounded-xl border bg-white px-3.5 py-2.5 text-xs text-slate-700">
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {t("mfx_rem_effect_stock", { qty: fmt(r.area), unit: r.unit, item: r.itemName, warehouse: warehouseName || "—" })}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {seesValue ? t("mfx_rem_effect_credit_value", { value: fmt(r.value) }) : t("mfx_rem_effect_credit")}
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
          <Button onClick={submit} disabled={busy || !warehouseId} className="gap-2 bg-success text-white hover:bg-success/90">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <PackagePlus size={15} />}
            {t("mfx_rem_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
