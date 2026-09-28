"use client"

// Placing the order a need's computed route points to, without an RFQ: on the
// live price agreement (its supplier and prices, nothing to type), or as a
// direct purchase under the cap (a supplier, a price per line, a reason). The
// order is born awaiting approval, like any other; the need is told its number.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, FileSignature, Loader2, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { directLinePrices, directOrderRefusal, directTotal, type DirectMode } from "@/lib/procurement/direct"
import { createOrderWithoutRfq } from "@/lib/procurement/direct-writes"
import { displayDocNumber } from "@/lib/procurement/format"
import { lastPaid, type PriceHistoryEntry } from "@/lib/procurement/prices"
import type { Need } from "@/lib/procurement/needs"
import { linkNeed } from "@/lib/procurement/needs-writes"
import { supplierKey } from "@/lib/procurement/po"
import type { RouteResult } from "@/lib/procurement/route"
import type { ProcActor, ProcurementPolicies, PurchaseOrder } from "@/lib/procurement/types"
import { ProcWriteError } from "@/lib/procurement/writes"
import { sarLtr } from "@/lib/riyal"

const OTHER = "__other__"
const money = (n: number) => sarLtr(n.toLocaleString("en-US", { maximumFractionDigits: 2 }))

export function DirectOrderDialog({
  need,
  route,
  history,
  orders,
  policies,
  actor,
  orgId,
  onClose,
}: {
  need: Need
  route: RouteResult
  history: PriceHistoryEntry[]
  orders: PurchaseOrder[]
  policies: ProcurementPolicies
  actor: ProcActor
  orgId: string
  onClose: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const tProc = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const mode: DirectMode = route.route === "agreement" ? "agreement" : "direct"
  const today = new Date().toISOString().slice(0, 10)

  const suppliers = useMemo(() => {
    const seen = new Map<string, { key: string; orgId: string | null; userId: string | null; name: string }>()
    for (const o of orders) {
      const key = supplierKey(o)
      if (!seen.has(key)) seen.set(key, { key, orgId: o.isGuestSupplier ? null : o.supplierOrgId, userId: o.supplierUserId, name: o.supplierName })
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [orders])
  const [supplierPick, setSupplierPick] = useState(() => (route.lastSupplier && suppliers.find((s) => s.orgId === route.lastSupplier?.orgId)?.key) || suppliers[0]?.key || OTHER)
  const [otherName, setOtherName] = useState("")
  const [prices, setPrices] = useState<string[]>(() => need.lines.map((l) => String(lastPaid(history, l.name, l.unit)?.price ?? "")))
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const picked = supplierPick === OTHER ? null : suppliers.find((s) => s.key === supplierPick) ?? null
  const supplierName = mode === "agreement" ? route.agreement?.supplierName || "" : picked ? picked.name : otherName
  const lines = need.lines.map((l, i) => ({ ...l, unitPrice: prices[i] ? Number(prices[i]) : null }))
  const check = { mode, lines, supplierName, reason, agreement: route.agreement, policies, today }
  const priced = directLinePrices(check)
  const total = directTotal(priced)
  const refusal = directOrderRefusal(check)

  const place = async () => {
    if (!firestore || refusal || busy) return
    setBusy(true)
    setError(null)
    try {
      const po = await createOrderWithoutRfq(firestore, actor, {
        mode,
        organizationId: orgId,
        title: need.lines.length === 1 ? need.lines[0].name : need.context || need.lines[0]?.name || "",
        lines,
        agreementId: route.agreement?.id ?? null,
        supplier: mode === "direct" ? { orgId: picked?.orgId ?? null, userId: picked?.userId ?? null, name: supplierName } : null,
        reason,
        projectId: need.projectId,
        projectName: need.projectName,
        purchaseSource: need.source,
        policies,
      })
      try {
        await linkNeed(firestore, need.source, { poId: po.id, poNumber: po.docNumber }, actor.name)
      } catch (linkErr) {
        // The order exists; only the back-reference failed — both still show.
        console.error("need ↔ order link failed:", linkErr)
      }
      toast({ title: t("dor_placed", { number: displayDocNumber(po.docNumber, locale) }) })
      onClose()
    } catch (err) {
      console.error(err)
      setError(err instanceof ProcWriteError ? tProc(`err_${err.code}`, err.params) : t("dor_failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-xl" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "agreement" ? <FileSignature size={18} className="text-success" aria-hidden="true" /> : <ShoppingCart size={18} className="text-cta" aria-hidden="true" />}
            {mode === "agreement" ? t("dor_title_agreement", { number: displayDocNumber(route.agreement?.docNumber || "", locale) }) : t("dor_title_direct")}
          </DialogTitle>
          <DialogDescription>{mode === "agreement" ? t("dor_desc_agreement") : t("dor_desc_direct", { cap: money(policies.directPurchaseCap) })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode === "agreement" ? (
            <p className="text-sm">
              <span className="text-muted-foreground">{t("dor_supplier")}: </span>
              <span className="font-bold" dir="auto">{supplierName}</span>
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dor-supplier">{t("dor_supplier")}</Label>
                <Select value={supplierPick} onValueChange={setSupplierPick}>
                  <SelectTrigger id="dor-supplier">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER}>{t("dor_other_supplier")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {supplierPick === OTHER && (
                <div className="space-y-1.5">
                  <Label htmlFor="dor-other">{t("dor_other_name")}</Label>
                  <Input id="dor-other" value={otherName} onChange={(e) => setOtherName(e.target.value)} dir="auto" />
                </div>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold">{t("pri_col_material")}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t("pri_col_qty")}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t("dor_unit_price")}</th>
                  <th className="px-3 py-2 text-end font-semibold">{t("dor_line_total")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {priced.map((l, i) => (
                  <tr key={`${l.name}-${i}`}>
                    <td className="px-3 py-2 font-semibold" dir="auto">{l.name}</td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">
                      {l.quantity} {l.unit}
                    </td>
                    <td className="px-3 py-2">
                      {mode === "agreement" ? (
                        <span className="tabular-nums" dir="ltr">{l.unitPrice == null ? "—" : money(l.unitPrice)}</span>
                      ) : (
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={prices[i] ?? ""}
                          onChange={(e) => setPrices((p) => p.map((v, j) => (j === i ? e.target.value : v)))}
                          aria-label={t("dor_unit_price")}
                          className="h-9 w-28 text-end tabular-nums"
                          dir="ltr"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                      {l.unitPrice == null ? "—" : money(l.unitPrice * l.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="flex items-center justify-between border-t px-3 py-2 text-sm font-bold">
              <span>{t("dor_total")}</span>
              <span className="tabular-nums" dir="ltr">{money(total)}</span>
            </p>
          </div>

          {mode === "direct" && (
            <div className="space-y-1.5">
              <Label htmlFor="dor-reason">{t("dor_reason")}</Label>
              <Textarea id="dor-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("dor_reason_ph")} rows={2} dir="auto" />
            </div>
          )}

          {(refusal || error) && <p className="text-xs text-destructive">{error || (refusal ? tProc(`err_${refusal.code}`, refusal.params) : "")}</p>}
          <p className="text-[11px] text-muted-foreground">{t("dor_next")}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("acc_cancel")}
          </Button>
          <Button onClick={place} disabled={busy || !!refusal} className="gap-1.5 bg-module text-module-foreground hover:bg-module/90">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {t("dor_place")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
