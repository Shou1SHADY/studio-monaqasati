"use client"

// Regularising a receipt that had no order (PRD 3.0 §6.1-11, prototype
// `regul`) — one choice, three answers: tie it to an order already open for
// the same material (offered first: raising another would commit the quantity
// twice), a retroactive order (the owner alone approves it; a registered
// supplier or the name as written, a price per line checked against the live
// agreement or our last price), or — only for a receipt Procurement typed by
// hand — a cash expense for Finance.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, NotebookPen } from "lucide-react"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { withSarSign } from "@/lib/riyal"
import type { Translator } from "@/lib/mfg-events"
import { displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import { round2, todayOf } from "@/lib/procurement/po"
import { receiptLinesOf, type DeskDelivery } from "@/lib/procurement/receipt-desk"
import { choiceKey, defaultChoice, openOrdersForReceipt, parseChoice, priceAboveReference, priceReference, registeredSuppliers, regulariseProblem, type RegulariseChoice } from "@/lib/procurement/receipt-regularise"
import { linkReceiptToOrder, markReceiptAsExpense } from "@/lib/procurement/receipt-writes"
import type { ProcActor, PurchaseOrder } from "@/lib/procurement/types"
import { ProcWriteError, retroactivePurchaseOrder } from "@/lib/procurement/writes"

const OTHER = "__other__"
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)

export interface RegulariseReceiptDialogProps {
  delivery: DeskDelivery
  actor: ProcActor
  orgId: string
  orders: PurchaseOrder[]
  placeName: string | null
  onOpenChange: (open: boolean) => void
  /** `poId` when the receipt now belongs to an order (linked or raised); null for an expense. */
  onDone: (next: { poId: string | null }) => void
}

export function RegulariseReceiptDialog({ delivery: d, actor, orgId, orders, placeName, onOpenChange, onDone }: RegulariseReceiptDialogProps) {
  const t = useTranslations("Portal.ProcReceipts")
  const tp = useTranslations("Portal.Procurement")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const { agreements, history } = useProcurementPrices(orgId)
  const today = todayOf(new Date())

  const lines = useMemo(() => receiptLinesOf(d), [d])
  const items = (d.items || []) as Array<{ unitPrice?: number | null }>
  const open = useMemo(() => openOrdersForReceipt(orders, lines, d.projectId), [orders, lines, d.projectId])
  const suppliers = useMemo(() => registeredSuppliers(orders), [orders])
  const guess = (d as { supplierGuessOrgId?: string | null }).supplierGuessOrgId || null

  const [choice, setChoice] = useState<RegulariseChoice>(() => defaultChoice(open))
  const [supplierPick, setSupplierPick] = useState<string>(() => (guess && suppliers.some((s) => s.orgId === guess) ? guess : OTHER))
  const [supplierText, setSupplierText] = useState(d.supplierName || "")
  const [prices, setPrices] = useState<string[]>(() => lines.map((_, i) => (items[i]?.unitPrice != null ? String(items[i].unitPrice) : "")))
  const [reason, setReason] = useState(d.receiptNote || d.notes || "")
  const [saving, setSaving] = useState(false)
  const [tried, setTried] = useState(false)

  const picked = supplierPick === OTHER ? null : suppliers.find((s) => s.orgId === supplierPick) || null
  const supplierName = picked ? picked.name : supplierText
  const priceNums = prices.map((p) => (p.trim() ? Number(p) : null))
  const problem = regulariseProblem(choice, { supplierName, prices: priceNums }) || (choice.kind === "new" && reason.trim().length < 3 ? "reason" : null)
  const total = round2(lines.reduce((s, l, i) => s + (Number(l.accepted ?? l.counted) || 0) * (priceNums[i] || 0), 0))
  const qtyOf = (i: number) => Number(lines[i].accepted ?? lines[i].counted) || 0
  const number = d.docNumber ? displayReceiptNumber(d.docNumber, locale) : "—"
  const opts = { copy: tShared as unknown as Translator, locale: locale as "ar" | "en" }

  const refused = (err: unknown) => {
    if (err instanceof ProcWriteError) toast({ title: tp(`err_${err.code}` as "err_wrong_state"), variant: "destructive" })
    else {
      console.error("regularisation failed:", err)
      toast({ title: t("toast.failed"), variant: "destructive" })
    }
  }

  const submit = async () => {
    setTried(true)
    if (!firestore || problem) return
    setSaving(true)
    try {
      if (choice.kind === "expense") {
        await markReceiptAsExpense(firestore, actor, d.id)
        toast({ title: t("regularise.expenseDone") })
        onDone({ poId: null })
      } else if (choice.kind === "link") {
        const r = await linkReceiptToOrder(firestore, actor, { deliveryId: d.id, poId: choice.poId }, opts)
        toast({ title: t("regularise.linked", { number: displayPoNumber(r.poNumber, locale) }) })
        onDone({ poId: choice.poId })
      } else {
        const r = await retroactivePurchaseOrder(
          firestore,
          actor,
          {
            organizationId: orgId,
            rfqTitle: d.notes || lines.map((l) => l.name).join("، ") || supplierName,
            supplierName,
            supplierOrgId: picked?.orgId ?? null,
            supplierUserId: picked?.userId ?? null,
            projectId: d.projectId ?? null,
            lines: lines.map((l, i) => ({ name: l.name, unit: l.unit, quantity: qtyOf(i), unitPrice: priceNums[i], accepted: qtyOf(i) })),
            totalExVat: total,
            deliveryId: d.id,
            reason,
          },
          opts
        )
        toast({ title: t("regularise.done", { number: displayPoNumber(r.docNumber, locale) }) })
        onDone({ poId: r.id })
      }
    } catch (err) {
      refused(err)
    } finally {
      setSaving(false)
    }
  }

  // A cash expense is for what Procurement typed by hand; what a receiver recorded gets an order.
  const options: Array<{ key: string; label: string }> = [
    ...open.map((po) => ({ key: choiceKey({ kind: "link", poId: po.id }), label: t("regularise.optLink", { number: displayPoNumber(po.docNumber, locale), supplier: po.supplierName }) })),
    { key: "new", label: t("regularise.optNew") },
    ...(d.source === "manual" ? [{ key: "expense", label: t("regularise.optExpense") }] : []),
  ]
  const effects =
    choice.kind === "expense" ? [t("regularise.effectExpense"), t("regularise.effectExpenseProof")] : choice.kind === "new" ? [t("regularise.effectNew"), t("regularise.effectFinance")] : [t("regularise.effectLink"), t("regularise.effectFinance")]
  const submitLabel = choice.kind === "expense" ? t("regularise.submitExpense") : choice.kind === "new" ? t("regularise.submit") : t("regularise.submitLink")

  return (
    <Dialog open onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle>{t("regularise.titleOne")}</DialogTitle>
          <DialogDescription>{t("regularise.subtitleOne")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* What arrived, and why it had no order */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-lg border bg-muted/20 p-3 text-xs">
            <dt className="text-muted-foreground">{t("regularise.lines")}</dt>
            <dd dir="auto">
              {lines.map((l, i) => (
                <span key={l.poLineId} className="block">
                  <b className="tabular-nums">{fmt(qtyOf(i))}</b> {l.unit} {l.name}
                </span>
              ))}
              <span className="text-muted-foreground">
                {number}
                {placeName ? ` · ${placeName}` : ""}
              </span>
            </dd>
            <dt className="text-muted-foreground">{t("regularise.recordedReason")}</dt>
            <dd dir="auto">{d.receiptNote || d.notes || "—"}</dd>
          </dl>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t("regularise.tieTo")}</legend>
            <div className="space-y-1.5" role="radiogroup" aria-label={t("regularise.tieTo")}>
              {options.map((o) => {
                const on = choiceKey(choice) === o.key
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setChoice(parseChoice(o.key))}
                    className={cn("w-full rounded-lg border p-2.5 text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-module bg-module/5 font-semibold" : "hover:bg-muted")}
                  >
                    <span dir="auto">{o.label}</span>
                  </button>
                )
              })}
            </div>
            {open.length > 0 && <p className="text-[11px] text-muted-foreground">{t("regularise.preferOpen")}</p>}
          </fieldset>

          {choice.kind === "new" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="reg-supplier">{t("regularise.supplierPerNote")} *</Label>
                <Select value={supplierPick} onValueChange={setSupplierPick}>
                  <SelectTrigger id="reg-supplier">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.orgId} value={s.orgId}>{s.name}</SelectItem>
                    ))}
                    <SelectItem value={OTHER}>{t("regularise.supplierOther")}</SelectItem>
                  </SelectContent>
                </Select>
                {supplierPick === OTHER && <Input aria-label={t("regularise.supplier")} dir="auto" value={supplierText} onChange={(e) => setSupplierText(e.target.value)} />}
                {tried && problem === "supplier" && <p className="text-xs text-destructive" role="alert">{t("regularise.errSupplier")}</p>}
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => {
                  const ref = priceReference(agreements, history, l.name, l.unit, today)
                  const above = priceAboveReference(priceNums[i], ref)
                  return (
                    <div key={l.poLineId} className="space-y-1.5 rounded-md border p-2">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold" dir="auto">{l.name}</p>
                          <p className="text-[11px] tabular-nums text-muted-foreground">
                            {fmt(qtyOf(i))} {l.unit}
                          </p>
                        </div>
                        <div className="w-32">
                          <Label htmlFor={`reg-price-${i}`} className="text-[11px]">{t("regularise.pricePer", { unit: l.unit })}</Label>
                          <Input id={`reg-price-${i}`} inputMode="decimal" dir="ltr" placeholder="—" className="h-9 tabular-nums" value={prices[i]} onChange={(e) => setPrices((p) => p.map((x, j) => (j === i ? e.target.value : x)))} />
                        </div>
                      </div>
                      {ref && (
                        <p className={cn("flex items-start gap-1.5 rounded-md p-2 text-[11px]", above ? "bg-destructive/5 text-destructive" : "bg-cta/5 text-foreground")}>
                          <NotebookPen size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                          <span>
                            {ref.kind === "agreement"
                              ? t("regularise.refAgreement", { number: ref.docNumber, price: withSarSign(fmt(ref.price), locale), supplier: ref.supplierName })
                              : t("regularise.refLast", { price: withSarSign(fmt(ref.price), locale), supplier: ref.supplierName })}
                            {above && ` ${t("regularise.refAbove")}`}
                          </span>
                        </p>
                      )}
                    </div>
                  )
                })}
                {tried && problem === "price" && <p className="text-xs text-destructive" role="alert">{t("regularise.errPrice")}</p>}
                <p className="text-xs text-muted-foreground">{t("regularise.total", { total: fmt(total) })}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-reason">{t("regularise.reason")} *</Label>
                <Textarea id="reg-reason" rows={2} dir="auto" placeholder={t("regularise.reasonPlaceholder")} value={reason} onChange={(e) => setReason(e.target.value)} />
                {tried && problem === "reason" && <p className="text-xs text-destructive" role="alert">{t("regularise.errReason")}</p>}
              </div>
            </div>
          )}

          <ul className="space-y-1 rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            {effects.map((x) => (
              <li key={x} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("regularise.cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={saving} className="gap-2">
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
