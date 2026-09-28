"use client"

// Placing the order a need's path points to, without an RFQ (the prototype's
// poAgr / poDir): on the live price agreement (its supplier and prices,
// delivered once or called off by the site), or direct from one supplier —
// the price typed as the supplier just confirmed it, NEVER prefilled (an old
// price must not become an order), the last price we paid only as a hint.
// Above the direct-order cap it is a single-source exception and says why.
// One or several need lines; the order is born awaiting approval, each need
// is told its number, and the order opens. The supplier list is the lines'
// material suppliers (no service company, no subcontractor), a lapsed CR or an
// unvouched supplier said beside his name. A line whose sample is still with
// the consultant may be PREPARED — the approval is what waits for it.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, FileSignature, Info, Loader2, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "@/i18n/routing"
import { SINGLE_SOURCE_REASONS, directLinePrices, directOrderRefusal, directTotal, isSingleSource, type DirectMode, type SingleSourceReason } from "@/lib/procurement/direct"
import { createOrderWithoutRfq } from "@/lib/procurement/direct-writes"
import { displayDocNumber } from "@/lib/procurement/format"
import { lastPaid, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"
import type { NeedRow } from "@/lib/procurement/need-desk"
import { linkNeed } from "@/lib/procurement/needs-writes"
import { addDays, supplierKey, todayOf } from "@/lib/procurement/po"
import { buyerSelfIssueLimit } from "@/lib/procurement/po-extras"
import { directSupplierOptions } from "@/lib/procurement/supplier-file"
import type { ProcActor, ProcurementPolicies, PurchaseOrder } from "@/lib/procurement/types"
import { ProcWriteError } from "@/lib/procurement/writes"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

const OTHER = "__other__"
const money = (n: number) => sarLtr(n.toLocaleString("en-US", { maximumFractionDigits: 2 }))

export function DirectOrderDialog({
  rows,
  mode,
  agreement,
  history,
  orders,
  supplierRecords,
  policies,
  actor,
  orgId,
  onClose,
}: {
  rows: NeedRow[]
  mode: DirectMode
  agreement: PriceAgreement | null
  history: PriceHistoryEntry[]
  orders: PurchaseOrder[]
  supplierRecords: Array<{ supplierOrgId: string; supplierName: string; kind?: string | null; crExpiry?: string | null; verified?: boolean | null }>
  policies: ProcurementPolicies & { buyerSelfIssueLimit?: number }
  actor: ProcActor
  orgId: string
  onClose: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const tProc = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const firestore = useFirestore()
  const router = useRouter()
  const { toast } = useToast()
  const today = todayOf(new Date())

  const suppliers = useMemo(
    () => directSupplierOptions({ records: supplierRecords, orders, keyOf: (o) => (o.isGuestSupplier ? supplierKey(o) : o.supplierOrgId), categories: rows.map((r) => r.category).filter((c): c is string => Boolean(c)), today }),
    [orders, supplierRecords, rows, today]
  )
  const lastOf = (r: NeedRow) => lastPaid(history, r.name, r.unit)
  const [supplierPick, setSupplierPick] = useState(() => {
    const first = rows.map(lastOf).find(Boolean)
    return (first && suppliers.find((s) => s.orgId === first.supplierOrgId)?.key) || ""
  })
  const [otherName, setOtherName] = useState("")
  const [prices, setPrices] = useState<string[]>(() => rows.map(() => ""))
  const [reason, setReason] = useState<SingleSourceReason | "">("")
  const needDays = rows.map((r) => r.needBy).filter((d): d is string => Boolean(d)).sort()
  const [deliverBy, setDeliverBy] = useState(() => {
    const d = needDays[0] ? addDays(needDays[0], -1) : addDays(today, 3)
    return d < addDays(today, 1) ? addDays(today, 1) : d
  })
  // Straight to a site, an agreement order is called off by the site (the prototype's default); to a store, one delivery.
  const [callOffs, setCallOffs] = useState(() => mode === "agreement" && rows.some((r) => Boolean(r.need.projectId)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const picked = supplierPick === OTHER ? null : suppliers.find((s) => s.key === supplierPick) ?? null
  const supplierName = mode === "agreement" ? agreement?.supplierName || "" : picked ? picked.name : supplierPick === OTHER ? otherName : ""
  const lines = rows.map((r, i) => ({ name: r.name, unit: r.unit, quantity: r.open, unitPrice: prices[i] ? Number(prices[i]) : null }))
  const reasonText = reason ? t(`dor_why_${reason}`) : ""
  const check = { mode, lines, supplierName, reason: reasonText, agreement, policies, today, deliverBy, requireDeliverBy: true }
  const priced = directLinePrices(check)
  const total = directTotal(priced)
  const single = isSingleSource(check)
  const samplePending = rows.find((r) => r.samplePending)
  const refusal = directOrderRefusal(check)
  const ownerApproves = total > policies.managerApprovalLimit || actor.canApprove || actor.isOwner
  const selfLimit = buyerSelfIssueLimit(policies)
  const selfIssue = mode === "direct" && !actor.isOwner && !actor.canApprove && actor.canPrepare && total > 0 && total <= selfLimit

  const place = async () => {
    if (!firestore || refusal || busy) return
    setBusy(true)
    setError(null)
    try {
      const needs = Array.from(new Map(rows.map((r) => [r.needKey, r.need])).values())
      const first = needs[0]
      const po = await createOrderWithoutRfq(firestore, actor, {
        mode,
        organizationId: orgId,
        title: rows.length === 1 ? rows[0].name : first?.context || rows[0]?.name || "",
        lines,
        agreementId: agreement?.id ?? null,
        supplier: mode === "direct" ? { orgId: picked?.orgId ?? null, userId: picked?.userId ?? null, name: supplierName } : null,
        reason: reasonText,
        reasonCode: reason || null,
        deliverBy,
        callOffs,
        projectId: needs.every((n) => n.projectId === first?.projectId) ? first?.projectId ?? null : null,
        projectName: needs.every((n) => n.projectId === first?.projectId) ? first?.projectName ?? null : null,
        purchaseSource: first?.source ?? null,
        policies,
      })
      for (const n of needs) {
        try {
          await linkNeed(firestore, n.source, { poId: po.id, poNumber: po.docNumber }, actor.name)
        } catch (linkErr) {
          // The order exists; only the back-reference failed — both still show.
          console.error("need ↔ order link failed:", linkErr)
        }
      }
      toast({ title: t("dor_placed", { number: displayDocNumber(po.docNumber, locale) }) })
      onClose()
      router.push(`/contractor/rfqs/orders?po=${po.id}`)
    } catch (err) {
      console.error(err)
      setError(err instanceof ProcWriteError ? tProc(`err_${err.code}`, err.params) : t("dor_failed"))
    } finally {
      setBusy(false)
    }
  }

  const refusalText = !refusal ? "" : refusal.code === "reason_required" ? t("dor_why_pick") : tProc(`err_${refusal.code}`, refusal.params)

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "agreement" ? <FileSignature size={18} className="text-success" aria-hidden="true" /> : <ShoppingCart size={18} className="text-cta" aria-hidden="true" />}
            {mode === "agreement" ? t("dor_title_agreement", { number: displayDocNumber(agreement?.docNumber || "", locale) }) : t("dor_title_direct")}
          </DialogTitle>
          <DialogDescription>{mode === "agreement" ? t("dor_sub_agreement") : t("dor_sub_direct")}</DialogDescription>
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
                    <SelectValue placeholder={t("dor_choose")} />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.name}
                        {s.crExpired ? ` — ${t("dor_cr_expired")}` : s.unverified ? ` — ${t("dor_unverified")}` : ""}
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
            <p className="border-b bg-muted/40 px-3 py-2 text-xs font-bold text-muted-foreground">{t("dor_lines")}</p>
            <ul className="divide-y">
              {priced.map((l, i) => {
                const r = rows[i]
                return (
                  <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="font-semibold" dir="auto">{l.name}</p>
                      <p className="text-[11px] text-muted-foreground" dir="auto">
                        {r.need.refLabel} · {r.need.projectName || r.need.context || t("nd_for_stock")}
                        {r.needBy ? ` · ${t("nd_need_short", { date: r.needBy })}` : ""}
                      </p>
                    </div>
                    {mode === "agreement" ? (
                      <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">× {l.unitPrice == null ? "—" : money(l.unitPrice)}</span>
                    ) : (
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={prices[i] ?? ""}
                        onChange={(e) => setPrices((p) => p.map((v, j) => (j === i ? e.target.value : v)))}
                        placeholder={t("dor_price_ph")}
                        aria-label={t("dor_unit_price")}
                        className="h-9 w-28 text-end tabular-nums"
                        dir="ltr"
                      />
                    )}
                    <span className="font-black tabular-nums" dir="ltr">
                      {l.quantity} <span className="text-xs font-normal text-muted-foreground">{l.unit}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
          {mode === "direct" && (
            <p className="-mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t("dor_price_hint")}
              {rows.map((r) => {
                const e = lastOf(r)
                return e ? ` ${t("dor_last_price", { name: r.name, price: money(e.price), supplier: e.supplierName, date: e.day })}` : ""
              })}
            </p>
          )}

          {mode === "direct" && single && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-semibold">{t("dor_why_title", { total: money(total), cap: money(policies.directPurchaseCap) })}</legend>
              <div className="flex flex-wrap gap-2">
                {SINGLE_SOURCE_REASONS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={reason === k}
                    onClick={() => setReason(k)}
                    className={cn(
                      "min-h-9 rounded-lg border px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      reason === k ? "border-module bg-module text-white" : "border-border bg-card text-muted-foreground hover:border-module/40"
                    )}
                  >
                    {t(`dor_why_${k}`)}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{t("dor_why_hint")}</p>
            </fieldset>
          )}

          {mode === "agreement" && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-semibold">{t("dor_delivery")}</legend>
              <div className="flex flex-wrap gap-2">
                {[false, true].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    aria-pressed={callOffs === v}
                    onClick={() => setCallOffs(v)}
                    className={cn(
                      "min-h-9 rounded-lg border px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      callOffs === v ? "border-module bg-module text-white" : "border-border bg-card text-muted-foreground hover:border-module/40"
                    )}
                  >
                    {t(v ? "dor_calloffs" : "dor_once")}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="dor-by">{mode === "agreement" && callOffs ? t("dor_first_by") : t("dor_deliver_by")}</Label>
            <Input id="dor-by" type="date" min={today} value={deliverBy} onChange={(e) => setDeliverBy(e.target.value)} className="w-48" dir="ltr" />
            {mode === "agreement" && <p className="text-[11px] text-muted-foreground">{t("dor_deliver_by_hint")}</p>}
          </div>

          <div className="rounded-xl border border-module/20 bg-module/5 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-black text-module">
              <Info size={13} aria-hidden="true" /> {t("dor_effects")}
            </p>
            <ul className="space-y-1 text-xs leading-relaxed text-foreground">
              {total > 0 && (
                <li className="flex gap-1.5">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                  <span>{t("dor_effect_value", { value: money(total) })}</span>
                </li>
              )}
              <li className="flex gap-1.5">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                <span>{selfIssue ? t("dor_effect_self", { limit: money(selfLimit) }) : t(ownerApproves ? "dor_effect_owner" : "dor_effect_manager")}</span>
              </li>
              <li className="flex gap-1.5">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                <span>{t("dor_effect_after")}</span>
              </li>
            </ul>
          </div>

          {samplePending && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{t("nd_sample_pending_block")}</p>}
          {(refusal || error) && <p className="text-xs text-destructive">{error || refusalText}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("acc_cancel")}
          </Button>
          <Button onClick={place} disabled={busy || !!refusal} className="gap-1.5 bg-module text-module-foreground hover:bg-module/90">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {t("dor_prepare")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
