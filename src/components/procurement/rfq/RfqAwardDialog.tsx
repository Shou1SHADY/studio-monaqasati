"use client"

// «الترسية وإعداد أوامر الشراء» (R-01, R-05, R-06): what the picks become —
// one purchase order per supplier with his picked lines, value and payment,
// and the date we need it by. Total pricing asks for the awarded supplier's
// per-line breakdown, which must equal his total (±1) before the order can
// carry unit prices. Passing over a cheaper rate needs a reason; a missing
// official quote and lines nobody won are said, not stopped; a guest supplier
// stops the award until he registers or the buyer accepts him in so many words (R-10).

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { FileCheck, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Callout } from "@/components/module-ui/Callout"
import { Money } from "@/components/procurement/PoBits"
import { moneyFigure } from "@/components/procurement/PoModel"
import { useFirestore } from "@/firebase"
import { competingOffers, parseAwardReason } from "@/lib/procurement/award"
import { pricedProducts } from "@/lib/procurement/offer-pricing"
import { AWARD_REASON_CODES, addDays, todayOf, type PoBlock } from "@/lib/procurement/po"
import { awardSummary, checkBreakdown, guestAwardRefusal, lowestForLines, offerTotal, type Picks } from "@/lib/procurement/rfq-award"
import { Checkbox } from "@/components/ui/checkbox"
import type { AwardReasonCode, ProcurementPolicies } from "@/lib/procurement/types"
import type { RfqWriteActor } from "@/lib/procurement/rfq-access"
import { awardRfq, ProcWriteError, type AwardGroupInput, type AwardOfferLike, type RfqLike } from "@/lib/procurement/writes"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"
import { leadDaysOf, useTermsText } from "./RfqComparison"
import { supplierNameOf, type RfqOfferView, type RfqView } from "./rfqOfferView"

export interface AwardDone {
  orders: Array<{ id: string; docNumber: string; offerId: string }>
  total: number
  budgetReason: string | null
}

export function RfqAwardDialog({
  open,
  onOpenChange,
  rfq,
  projectName,
  offers,
  picks,
  actor,
  policies,
  orgName,
  blocksFor,
  budget,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rfq: RfqView
  projectName: string | null
  offers: RfqOfferView[]
  picks: Picks
  actor: RfqWriteActor
  policies: ProcurementPolicies
  orgName: string | null
  blocksFor: (offer: RfqOfferView) => PoBlock[]
  budget: { budget: number; committed: number } | null
  onDone: (done: AwardDone) => void
}) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const tx = useTranslations("Portal.Procurement.rfqx")
  const tc = useTranslations("Portal.Contractor")
  const tProc = useTranslations("Portal.Procurement")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const termsText = useTermsText()

  const live = useMemo(() => competingOffers(offers), [offers])
  const summary = useMemo(() => awardSummary(rfq, live, picks), [rfq, live, picks])
  const products = pricedProducts(rfq)
  const needsBreakdown = summary.mode === "whole" && products.length > 1
  const byId = new Map(live.map((o) => [o.id, o]))
  const name = (o: RfqOfferView) => supplierNameOf(o, tc("offers_registered_supplier"))
  const today = todayOf(new Date())

  const [dates, setDates] = useState<Record<string, string>>({})
  const [breakdown, setBreakdown] = useState<Record<number, string>>({})
  const [reasonCode, setReasonCode] = useState<AwardReasonCode | "">("")
  const [reasonText, setReasonText] = useState("")
  const [budgetReason, setBudgetReason] = useState("")
  const [acceptGuest, setAcceptGuest] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const next: Record<string, string> = {}
    for (const g of summary.groups) {
      const o = byId.get(g.offerId)
      next[g.offerId] = addDays(today, Math.max(1, (o && leadDaysOf(o)) || 1))
    }
    setDates(next)
    setBreakdown({})
    setReasonCode("")
    setReasonText("")
    setBudgetReason("")
    setAcceptGuest(false)
    setError(null)
    // Reset only when the dialog opens on a new set of picks.
  }, [open])

  const wholeGroup = summary.groups[0]
  const wholeTotal = wholeGroup?.total ?? 0
  const brk = needsBreakdown ? checkBreakdown(products, breakdown, wholeTotal) : null
  const reason = summary.offLowest.length ? parseAwardReason(reasonCode, reasonText) : null
  const projected = budget ? budget.committed + summary.total : 0
  const overBudget = budget != null && projected > budget.budget
  const unregistered = summary.groups.map((g) => byId.get(g.offerId)).filter((o): o is RfqOfferView => Boolean(o?.isGuestOffer))
  const noQuote = summary.groups.map((g) => byId.get(g.offerId)).filter((o): o is RfqOfferView => Boolean(o && !o.offerPdfUrl))

  const refusal: string | null = (() => {
    if (!summary.groups.length) return t("award.err_nothing")
    if (needsBreakdown && brk && brk.missing.length) return t("award.err_breakdown_missing")
    if (needsBreakdown && brk && !brk.ok) return t("award.err_breakdown_total")
    if (summary.offLowest.length && !reasonCode) return t("award.err_reason")
    if (summary.offLowest.length && !reason) return t("award.err_reason_text")
    if (summary.groups.some((g) => !dates[g.offerId] || dates[g.offerId] < today)) return t("award.err_date")
    if (overBudget && budgetReason.trim().length < 8) return tc("offers_budget_reason_required")
    if (guestAwardRefusal(unregistered, acceptGuest)) return tx("award.guest_block")
    return null
  })()

  const submit = async () => {
    if (refusal || !firestore) return
    setSaving(true)
    setError(null)
    const rfqLike: RfqLike = {
      id: rfq.id,
      title: rfq.title || "",
      organizationId: rfq.organizationId || null,
      contractorId: rfq.contractorId || null,
      projectId: rfq.projectId || null,
      projectName,
      category: rfq.category || null,
      city: rfq.city || null,
      directAward: Boolean(rfq.directAward),
      products: (rfq.products || []) as RfqLike["products"],
      purchaseSource: rfq.purchaseSource || null,
    }
    const groups: AwardGroupInput[] = summary.groups.map((g) => {
      const offer = byId.get(g.offerId) as RfqOfferView
      const lines =
        summary.mode === "whole"
          ? needsBreakdown && brk
            ? brk.lines
            : products.map((p) => ({ rfqProductIndex: p.rfqProductIndex, unitPrice: p.quantity > 0 ? wholeTotal / p.quantity : null }))
          : g.lines.map((l) => ({ rfqProductIndex: l.rfqProductIndex, unitPrice: l.unitPrice }))
      const total = needsBreakdown && brk ? brk.sum : g.total
      const lowest = summary.mode === "whole" ? live.reduce<number | null>((m, o) => {
        const v = offerTotal(o)
        return v == null ? m : m == null || v < m ? v : m
      }, null) : lowestForLines(rfq, live, g.lines)
      return {
        offer: offer as unknown as AwardOfferLike,
        lines: products.length ? lines : [],
        total,
        requestedDeliveryDate: dates[g.offerId] || null,
        lowestForLines: lowest,
        offLowest: g.lines.some((l) => summary.offLowest.includes(l.rfqProductIndex)),
      }
    })
    try {
      const orders = await awardRfq(
        firestore,
        actor,
        {
          rfq: rfqLike,
          offers: live as unknown as AwardOfferLike[],
          groups,
          unpicked: summary.unpicked,
          awardReason: reason,
          breakdown: needsBreakdown,
          policies,
          acceptedGuest: acceptGuest,
        },
        { copy: tShared, locale: locale === "en" ? "en" : "ar", orgName }
      )
      onDone({ orders, total: groups.reduce((s, g) => s + g.total, 0), budgetReason: overBudget ? budgetReason.trim() : null })
    } catch (err) {
      const code = err instanceof ProcWriteError ? err.code : null
      setError(code && tProc.has(`err_${code}`) ? tProc(`err_${code}`) : tc("offers_award_order_failed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle className="flex items-center gap-2">
            <FileCheck size={18} className="text-module" aria-hidden="true" />
            {t("award.title")}
          </DialogTitle>
          <DialogDescription>{t("award.sub")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {needsBreakdown && wholeGroup && byId.get(wholeGroup.offerId) ? (
            <>
              <div className="rounded-xl border bg-muted/30 p-3">
                <b dir="auto">{name(byId.get(wholeGroup.offerId) as RfqOfferView)}</b>
                <p className="text-xs text-muted-foreground">
                  {t("award.whole_total")} <Money value={wholeTotal} className="font-bold text-foreground" />
                </p>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-xs font-bold">{t("award.breakdown_label")}</legend>
                <div className="divide-y rounded-xl border">
                  {products.map((p) => (
                    <div key={p.rfqProductIndex} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0">
                        <b className="block truncate font-semibold" dir="auto">
                          {p.name}
                        </b>
                        <span className="text-[11px] text-muted-foreground">
                          <bdi dir="ltr">{p.quantity.toLocaleString("en-US")}</bdi> {p.unit}
                        </span>
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        dir="ltr"
                        className="h-9 w-32"
                        aria-label={t("award.unit_price_for", { line: p.name })}
                        placeholder={t("award.unit_price")}
                        value={breakdown[p.rfqProductIndex] ?? ""}
                        onChange={(e) => setBreakdown((b) => ({ ...b, [p.rfqProductIndex]: e.target.value }))}
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 bg-muted/30 px-3 py-2">
                    <b>{t("award.breakdown_sum")}</b>
                    <span dir="ltr" className={cn("font-bold tabular-nums", brk?.ok ? "text-success" : "text-destructive")}>
                      {sarLtr(moneyFigure(brk?.sum ?? 0))} / {moneyFigure(wholeTotal)}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">{t("award.breakdown_hint")}</p>
              </fieldset>
              <div className="space-y-1.5">
                <Label htmlFor={`award-date-${wholeGroup.offerId}`} className="text-xs font-bold">
                  {t("award.deliver_by")}
                </Label>
                <Input id={`award-date-${wholeGroup.offerId}`} type="date" min={today} dir="ltr" className="h-9 w-48" value={dates[wholeGroup.offerId] || ""} onChange={(e) => setDates((d) => ({ ...d, [wholeGroup.offerId]: e.target.value }))} />
              </div>
            </>
          ) : (
            summary.groups.map((g) => {
              const o = byId.get(g.offerId) as RfqOfferView
              const terms = termsText(o)
              return (
                <section key={g.offerId} className="space-y-2 rounded-xl border p-3" aria-label={name(o)}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <b dir="auto">{name(o)}</b>
                    {o.isGuestOffer && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-bold text-destructive">{t("award.guest_pill")}</span>}
                  </div>
                  <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-xs">
                    <dt className="text-muted-foreground">{t("award.lines")}</dt>
                    <dd className="space-y-0.5">
                      {g.lines.length ? (
                        g.lines.map((l) => (
                          <span key={l.rfqProductIndex} className="block" dir="auto">
                            {l.name} <bdi dir="ltr">{l.quantity.toLocaleString("en-US")}</bdi> × <Money value={l.unitPrice} />
                          </span>
                        ))
                      ) : (
                        <span dir="auto">{rfq.title}</span>
                      )}
                    </dd>
                    <dt className="text-muted-foreground">{t("award.value_payment")}</dt>
                    <dd>
                      <Money value={g.total} className="font-bold" /> · {terms || t("award.terms_as_offer")}
                    </dd>
                    <dt className="self-center text-muted-foreground">
                      <Label htmlFor={`award-date-${g.offerId}`}>{t("award.deliver_by")}</Label>
                    </dt>
                    <dd>
                      <Input id={`award-date-${g.offerId}`} type="date" min={today} dir="ltr" className="h-8 w-44" value={dates[g.offerId] || ""} onChange={(e) => setDates((d) => ({ ...d, [g.offerId]: e.target.value }))} />
                    </dd>
                  </dl>
                  {blocksFor(o).length > 0 && (
                    <Callout tone="warn" title={tc("offers_award_order_will_wait")}>
                      <ul className="list-disc space-y-0.5 ps-4 text-xs">
                        {blocksFor(o).map((b) => (
                          <li key={b.code}>{tProc(`blocks.${b.code}`, b.params)}</li>
                        ))}
                      </ul>
                    </Callout>
                  )}
                </section>
              )
            })
          )}

          {summary.offLowest.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-xs font-bold">
                {t("award.why_not_lowest", { count: summary.offLowest.length })} <span className="text-destructive">*</span>
              </legend>
              <div className="flex flex-wrap gap-2" role="radiogroup">
                {AWARD_REASON_CODES.map((code) => (
                  <button
                    key={code}
                    type="button"
                    role="radio"
                    aria-checked={reasonCode === code}
                    onClick={() => setReasonCode(code)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      reasonCode === code ? "border-module bg-module/10 text-module" : "hover:bg-muted"
                    )}
                  >
                    {tProc(`awardReason.${code}`)}
                  </button>
                ))}
              </div>
              {reasonCode && (
                <Textarea
                  rows={2}
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder={reasonCode === "other" ? tc("offers_award_reason_text_placeholder") : tc("offers_award_reason_note_placeholder")}
                  aria-label={t("award.reason_text")}
                  className="resize-none text-sm"
                />
              )}
              <p className="text-[11px] text-muted-foreground">{tc("offers_award_reason_hint")}</p>
            </fieldset>
          )}

          {noQuote.length > 0 && <Callout tone="warn">{t("award.no_quote", { suppliers: noQuote.map(name).join(locale === "ar" ? "، " : ", ") })}</Callout>}
          {summary.unpicked.length > 0 && <Callout tone="info">{t("award.unpicked", { count: summary.unpicked.length })}</Callout>}
          {unregistered.length > 0 && (
            <div className="space-y-2">
              <Callout tone="block" title={tx("award.guest_title")}>
                {tx("award.guest_body", { suppliers: unregistered.map(name).join(locale === "ar" ? "، " : ", ") })}
              </Callout>
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-xs">
                <Checkbox checked={acceptGuest} onCheckedChange={(v) => setAcceptGuest(v === true)} className="mt-0.5" />
                <span>{tx("award.guest_accept")}</span>
              </label>
            </div>
          )}

          {overBudget && budget && (
            <div className="space-y-2">
              <Callout tone="warn" title={tc("offers_budget_warning_title")}>
                <span className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <span>
                    {tc("offers_budget_label")} <Money value={budget.budget} />
                  </span>
                  <span>
                    {tc("offers_committed_label")} <Money value={budget.committed} />
                  </span>
                  <span>
                    {tc("offers_this_offer_label")} <Money value={summary.total} />
                  </span>
                  <span className="text-destructive">
                    {tc("offers_overage_label")} <Money value={projected - budget.budget} />
                  </span>
                </span>
              </Callout>
              <Label htmlFor="award-budget-reason" className="text-xs font-bold">
                {tc("offers_budget_reason_label")}
              </Label>
              <Textarea id="award-budget-reason" rows={2} value={budgetReason} onChange={(e) => setBudgetReason(e.target.value)} placeholder={tc("offers_budget_reason_placeholder")} className="resize-none text-sm" />
            </div>
          )}

          <ul className="space-y-1 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
            <li>{t("award.effect_prepared", { count: summary.groups.length })}</li>
            <li>{t("award.effect_after")}</li>
          </ul>

          {error && <Callout tone="block">{error}</Callout>}
          {refusal && !error && <p className="text-[11px] text-destructive">{refusal}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {tc("cancel")}
          </Button>
          <Button onClick={submit} disabled={saving || Boolean(refusal)} className="gap-2 bg-module text-white hover:bg-module/90">
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <FileCheck size={14} aria-hidden="true" />}
            {t("award.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
