"use client"

// «راجع الترسية» (Procurement 2.0 CMP-07…12, 16…19): what the picks become — ONE order per supplier × delivery site with its total, basis
// and lines (a piece line in the buyer's words: «30 × قطعة 6 م بـ74 ر.س · تستلم 180 م، المطلوب 175»), ★ الأقل / ليس الأقل on every line,
// when it arrives against when it is needed, our experience of the supplier, and how it is approved — «يُرسل فوراً» within the limit, or
// «اعتمده الآن بصفتك المالك» above it. A reason is asked only for what is not the lowest and ONLY among those the numbers back; thin
// competition above the threshold asks a reason too and tags the order, never blocks. The page plans live with `planAward`; the server
// plans again from the stored versions and is the authority — nothing here sends a price.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { FileCheck, Loader2, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Callout } from "@/components/module-ui/Callout"
import { Money } from "@/components/procurement/PoBits"
import { BnplSoonDialog } from "@/components/procurement/BnplSoonDialog"
import { moneyFigure } from "@/components/procurement/PoModel"
import { AWARD_WHY_CODES, LOW_COMPETITION_REASONS, fromHalalas, type AwardWhyCode } from "@/lib/procurement/offer-calc"
import { AwardRefused, awardRfq } from "@/lib/procurement/award-client"
import { dropStale, planAward, planSupplier, type AwardPicks, type Dropped, type PlanActor, type PlanOffer, type PlanPolicies, type PlanRfq, type PlannedGroup } from "@/lib/procurement/award-plan"
import type { AwardResult } from "@/lib/procurement/rfq-server/award-server"
import type { DecisionMap } from "@/lib/procurement/offer-decisions"
import { locksOf } from "@/lib/procurement/rfq-server/award-locks"
import { supplierKey, supplierScore } from "@/lib/procurement/po"
import type { PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"
import { cn } from "@/lib/utils"

const sar = (h: number | null | undefined): string => moneyFigure(h == null ? null : h / 100)

export interface AwardDone {
  orders: AwardResult["orders"]
  /** Ex-VAT, riyals. */
  total: number
  budgetReason: string | null
  closedEarly: boolean
}

export interface AwardReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rfq: PlanRfq
  offers: PlanOffer[]
  decisions: DecisionMap
  orders: PurchaseOrder[]
  receipts: ReceiptFact[]
  policies: PlanPolicies
  picks: AwardPicks
  onPicksChange: (next: AwardPicks) => void
  actor: PlanActor
  today: string
  now?: Date
  /** The project's budget and what is committed: an overrun asks its reason (kept for the finance audit). */
  budget: { budget: number; committed: number } | null
  onDone: (done: AwardDone) => void
}

const REFUSAL_FALLBACK = "INTERNAL"

export function AwardReviewDialog(props: AwardReviewDialogProps) {
  const { open, onOpenChange, rfq, offers, decisions, orders, receipts, policies, picks, actor, today, budget, onDone } = props
  const t = useTranslations("Portal.Procurement.award2")
  const tw = useTranslations("Portal.Procurement.cmp2")
  const locale = useLocale()
  const now = props.now ?? new Date()

  const [why, setWhy] = useState<AwardWhyCode | "">("")
  const [whyText, setWhyText] = useState("")
  const [lc, setLc] = useState<string>("")
  const [lcText, setLcText] = useState("")
  const [approveNow, setApproveNow] = useState<string[]>([])
  const [acceptGuest, setAcceptGuest] = useState(false)
  const [lossReason, setLossReason] = useState<"price" | "time" | "spec" | null>(null)
  const [budgetReason, setBudgetReason] = useState("")
  const [soon, setSoon] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dropped, setDropped] = useState<Dropped[]>([])

  const mine = useMemo(() => orders.filter((o) => o.rfqId === rfq.id), [orders, rfq.id])
  const locks = useMemo(() => locksOf(mine), [mine])
  const scores = useMemo(() => {
    const map = new Map<string, { orders: number; onTime: number | null }>()
    for (const key of new Set(orders.map((o) => supplierKey(o)))) {
      const s = supplierScore(
        orders.filter((o) => supplierKey(o) === key),
        receipts,
        now
      )
      map.set(key, { orders: s.orders, onTime: s.onTimePercent })
    }
    return map
  }, [orders, receipts])
  const scoreOf = (o: PlanOffer) => {
    const s = planSupplier(o)
    return scores.get(supplierKey({ supplierOrgId: s.supplierOrgId, supplierName: s.supplierName, isGuestSupplier: s.isGuestSupplier }))
  }
  const ctx = useMemo(
    () => ({ today, policies, decisions, locked: locks.locked, liveOfferIds: locks.liveOfferIds, actor, onTimeOf: (o: PlanOffer) => scoreOf(o)?.onTime ?? null, hasRecord: (o: PlanOffer) => (scoreOf(o)?.orders ?? 0) > 0 }),
    [today, policies, decisions, locks, actor, scores]
  )

  // The picks as they stand: an offer changed, excluded or expired since the pick is dropped before anything is shown (R-14).
  const cleaned = useMemo(() => {
    const probe = planAward({ rfq, offers, picks: [] }, ctx)
    return dropStale(picks, offers, probe.evaluation, ctx)
  }, [rfq, offers, picks, ctx])
  useEffect(() => {
    if (!open) return
    if (cleaned.dropped.length) {
      setDropped(cleaned.dropped)
      props.onPicksChange(cleaned.picks)
    }
  }, [open, cleaned.dropped.length])
  useEffect(() => {
    if (!open) return
    setWhy("")
    setWhyText("")
    setLc("")
    setLcText("")
    setApproveNow([])
    setAcceptGuest(false)
    setLossReason(null)
    setBudgetReason("")
    setError(null)
  }, [open])

  const pinned = useMemo(
    () =>
      Object.entries(cleaned.picks)
        .map(([li, p]) => ({ li: Number(li), offerId: p.offerId, rev: p.rev }))
        .sort((a, b) => a.li - b.li),
    [cleaned.picks]
  )
  const plan = useMemo(
    () => planAward({ rfq, offers, picks: pinned, why: why ? { code: why, text: whyText } : null, lowComp: lc ? { code: lc, text: lcText } : null, approveNow, acceptGuest }, ctx),
    [rfq, offers, pinned, why, whyText, lc, lcText, approveNow, acceptGuest, ctx]
  )
  // A reason chosen earlier that the new picks no longer back is cleared.
  useEffect(() => {
    if (why && !plan.whyEligible[why] && why !== "other") setWhy("")
  }, [why, plan.whyEligible])

  const byId = new Map(offers.map((o) => [o.id, o]))
  const name = (offerId: string) => {
    const o = byId.get(offerId)
    return (o && (o.companyName || o.supplierName || o.guestContact?.name || "")) || "—"
  }
  const overBudget = budget != null && budget.committed + fromHalalas(plan.netH) > budget.budget
  const guestNames = plan.groups.filter((g) => g.guest).map((g) => name(g.offerId))
  const refusalCode = plan.refusal
  const needsBudget = overBudget && budgetReason.trim().length < 8
  const blocked = Boolean(refusalCode) || needsBudget || !plan.groups.length
  const errKey = (code: string) => (t.has(`err_${code}`) ? t(`err_${code}`) : t("err_INTERNAL"))
  const toggleNow = (key: string) => setApproveNow((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  const submit = async () => {
    if (blocked) return
    setSaving(true)
    setError(null)
    try {
      const out = await awardRfq({
        rfqId: rfq.id,
        picks: pinned,
        why: plan.nonLowest.length && why ? { code: why, text: whyText || null } : null,
        lowComp: plan.lowComp.required && lc ? { code: lc, text: lcText || null } : null,
        approveNow,
        lossReason,
        acceptGuest,
        budgetReason: overBudget ? budgetReason.trim() : null,
        locale: locale === "en" ? "en" : "ar",
      })
      onDone({ orders: out.orders, total: out.total, budgetReason: out.budgetReason, closedEarly: out.closedEarly })
    } catch (err) {
      setError(err instanceof AwardRefused ? errKey(err.code) : errKey(REFUSAL_FALLBACK))
    } finally {
      setSaving(false)
    }
  }

  const losers = offers.filter((o) => plan.evaluation.byId[o.id]?.live && !plan.groups.some((g) => g.offerId === o.id)).length
  const fmtDay = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { day: "numeric", month: "short" }) : "")

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" dir={locale === "ar" ? "rtl" : "ltr"}>
          <DialogHeader className="text-start sm:text-start">
            <DialogTitle className="flex items-center gap-2">
              <FileCheck size={18} className="text-module" aria-hidden="true" />
              {t("title")}
            </DialogTitle>
            <DialogDescription>{t("sub")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            {dropped.length > 0 && <Callout tone="warn">{tw("dropped", { names: [...new Set(dropped.map((d) => name(d.offerId)))].join("، ") })}</Callout>}

            {plan.groups.map((g) => (
              <GroupCard key={g.key} g={g} limit={policies.managerApprovalLimit} name={name(g.offerId)} offer={byId.get(g.offerId)} actorIsOwner={actor.isOwner} approveOn={approveNow.includes(g.key)} onToggle={() => toggleNow(g.key)} fmtDay={fmtDay} experience={scoreOf(byId.get(g.offerId) as PlanOffer)} />
            ))}

            {plan.nonLowest.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-xs font-bold">
                  {t("why_title")} <span className="text-destructive">*</span>
                </legend>
                <div className="flex flex-wrap gap-2" role="radiogroup">
                  {AWARD_WHY_CODES.map((code) => {
                    const ok = plan.whyEligible[code]
                    return (
                      <button
                        key={code}
                        type="button"
                        role="radio"
                        aria-checked={why === code}
                        disabled={!ok}
                        title={ok ? undefined : t(`why_no_${code}`)}
                        onClick={() => setWhy(code)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40",
                          why === code ? "border-module bg-module/10 text-module" : "hover:bg-muted"
                        )}
                      >
                        {t(`why_${code}`)}
                      </button>
                    )
                  })}
                </div>
                {why === "other" && <Textarea rows={2} value={whyText} onChange={(e) => setWhyText(e.target.value)} placeholder={t("reason_placeholder")} aria-label={t("reason_text")} className="resize-none text-sm" />}
                <p className="text-[11px] text-muted-foreground">{t("why_hint")}</p>
              </fieldset>
            )}

            {plan.lowComp.required && (
              <fieldset className="space-y-2">
                <legend className="text-xs font-bold">
                  {t("lowcomp_title", {
                    lines: plan.lowComp.lines.map((l) => `«${plan.groups.flatMap((g) => g.lines).find((x) => x.li === l.rfqProductIndex)?.name || ""}» ${l.liveCount}/${policies.minOffers}`).join("، "),
                    threshold: moneyFigure(policies.competitionThreshold),
                  })}{" "}
                  <span className="text-destructive">*</span>
                </legend>
                <div className="flex flex-wrap gap-2" role="radiogroup">
                  {LOW_COMPETITION_REASONS.map((code) => (
                    <button
                      key={code}
                      type="button"
                      role="radio"
                      aria-checked={lc === code}
                      onClick={() => setLc(code)}
                      className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", lc === code ? "border-module bg-module/10 text-module" : "hover:bg-muted")}
                    >
                      {t(`lowcomp_${code}`)}
                    </button>
                  ))}
                </div>
                {lc === "other" && <Textarea rows={2} value={lcText} onChange={(e) => setLcText(e.target.value)} placeholder={t("reason_placeholder")} aria-label={t("reason_text")} className="resize-none text-sm" />}
                <p className="text-[11px] text-muted-foreground">{t("lowcomp_hint")}</p>
              </fieldset>
            )}

            {losers > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-xs font-bold">{t("loss_legend", { count: losers })}</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup">
                  {([null, "price", "time", "spec"] as const).map((code) => (
                    <button
                      key={code || "none"}
                      type="button"
                      role="radio"
                      aria-checked={lossReason === code}
                      onClick={() => setLossReason(code)}
                      className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", lossReason === code ? "border-module bg-module/10 text-module" : "hover:bg-muted")}
                    >
                      {t(`loss_${code || "none"}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {plan.warnings.noQuote.length > 0 && <Callout tone="warn">{t("no_quote", { suppliers: plan.warnings.noQuote.map(name).join("، ") })}</Callout>}
            {plan.warnings.firstTime.length > 0 && <Callout tone="info">{t("first_time", { suppliers: plan.warnings.firstTime.map(name).join("، ") })}</Callout>}
            {plan.warnings.unawarded > 0 && <Callout tone="info">{t("unawarded", { count: plan.warnings.unawarded })}</Callout>}
            {plan.warnings.closesEarly && <Callout tone="warn">{t("closes_early", { date: fmtDay((rfq.deadline || "").slice(0, 10) || null) })}</Callout>}
            {guestNames.length > 0 && (
              <div className="space-y-2">
                <Callout tone="block" title={t("guest_title")}>
                  {t("guest_body", { suppliers: guestNames.join("، ") })}
                </Callout>
                <label className="flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-xs">
                  <Checkbox checked={acceptGuest} onCheckedChange={(v) => setAcceptGuest(v === true)} className="mt-0.5" />
                  <span>{t("guest_accept")}</span>
                </label>
              </div>
            )}

            {overBudget && budget && (
              <div className="space-y-2">
                <Callout tone="warn" title={t("budget_title")}>
                  <span className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <span>
                      {t("budget_label")} <Money value={budget.budget} />
                    </span>
                    <span>
                      {t("budget_committed")} <Money value={budget.committed} />
                    </span>
                    <span>
                      {t("budget_this")} <Money value={fromHalalas(plan.netH)} />
                    </span>
                    <span className="text-destructive">
                      {t("budget_over")} <Money value={budget.committed + fromHalalas(plan.netH) - budget.budget} />
                    </span>
                  </span>
                </Callout>
                <Label htmlFor="award2-budget-reason" className="text-xs font-bold">
                  {t("budget_reason")}
                </Label>
                <Textarea id="award2-budget-reason" rows={2} value={budgetReason} onChange={(e) => setBudgetReason(e.target.value)} className="resize-none text-sm" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("payment_title")}</Label>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-module bg-module/10 px-3 py-1.5 text-xs font-semibold text-module">{t("payment_per_offer")}</span>
                <button type="button" onClick={() => setSoon(true)} className="rounded-full border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t("payment_bnpl")} <span className="ms-1 rounded bg-muted px-1.5 text-[10px]">{t("soon")}</span>
                </button>
              </div>
            </div>

            {error && <Callout tone="block">{error}</Callout>}
            {refusalCode && !error && <p className="text-[11px] text-destructive">{errKey(refusalCode)}</p>}
            {needsBudget && !error && <p className="text-[11px] text-destructive">{t("err_budget")}</p>}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t("back")}
            </Button>
            <Button onClick={submit} disabled={saving || blocked} className="gap-2 bg-module text-white hover:bg-module/90">
              {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <FileCheck size={14} aria-hidden="true" />}
              {t("submit", { count: plan.groups.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BnplSoonDialog open={soon} onOpenChange={setSoon} />
    </>
  )
}

function GroupCard({
  g,
  limit,
  name,
  offer,
  actorIsOwner,
  approveOn,
  onToggle,
  fmtDay,
  experience,
}: {
  g: PlannedGroup
  limit: number
  name: string
  offer: PlanOffer | undefined
  actorIsOwner: boolean
  approveOn: boolean
  onToggle: () => void
  fmtDay: (iso: string | null) => string
  experience: { orders: number; onTime: number | null } | undefined
}) {
  const t = useTranslations("Portal.Procurement.award2")
  const site = [g.site.city, g.site.district].filter(Boolean).join(" — ")
  return (
    <section className="space-y-2 rounded-xl border p-3" aria-label={name}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b dir="auto">{name}</b>
        {g.guest && <span className="text-xs text-warning">{t("via_link")}</span>}
        {site && <span className="text-xs text-muted-foreground">{site}</span>}
        <span className="ms-auto text-end">
          <b dir="ltr" className="tabular-nums">
            {sar(g.grossH)}
          </b>{" "}
          <small className="text-[11px] text-muted-foreground">{g.vatRate > 0 ? t("incl_vat") : t("no_vat")}</small>
        </span>
      </div>
      {g.lines.map((l) => (
        <div key={l.li} className="flex flex-wrap items-start justify-between gap-2 text-xs">
          <span className="min-w-0 flex-1" dir="auto">
            <b className="block font-semibold">{l.name}</b>
            <span className="text-muted-foreground">
              {g.lump
                ? t("in_lump", { qty: l.qty, unit: l.unit })
                : l.pcs != null && l.packLen != null
                  ? t("piece_line", { pcs: l.pcs, pack: l.packName || `${l.packLen} ${l.unit}`, rate: sar((l.rate ?? 0) * 100), received: l.received ?? 0, unit: l.unit, need: l.qty })
                  : `${l.qty.toLocaleString("en-US")} ${l.unit} × ${sar((l.rate ?? 0) * 100)}`}
            </span>
          </span>
          {!g.lump && l.netH != null && (
            <span dir="ltr" className="tabular-nums">
              {sar(l.netH)} <small className="text-[10px] text-muted-foreground">{t("before_vat")}</small>
            </span>
          )}
          {l.lowest ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success">
              <Star size={10} aria-hidden="true" />
              {t("lowest")}
            </span>
          ) : (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-bold text-warning">{t("not_lowest")}</span>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={cn(g.late ? "font-semibold text-warning" : "text-muted-foreground")}>
          {g.arrival ? t("arrives", { date: fmtDay(g.arrival) }) : t("arrival_unknown")}
          {g.needBy ? ` · ${t("needed_by", { date: fmtDay(g.needBy) })}` : ""}
          {g.late ? ` — ${t("after_need")}` : ""}
        </span>
        {experience && experience.orders > 0 && (
          <span className="text-muted-foreground">
            {t("experience", { orders: experience.orders })}
            {experience.onTime != null ? ` · ${t("on_time", { percent: experience.onTime })}` : ""}
          </span>
        )}
      </div>
      {g.noOfficialQuote && offer && <p className="text-[11px] text-warning">{t("no_quote_one")}</p>}
      <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
        {g.approval === "sent" ? (
          <span>{t("approval_sent")}</span>
        ) : g.approval === "prepared_by_approver" ? (
          <span>{t("approval_prepared_by_approver")}</span>
        ) : g.approveNowAllowed ? (
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox checked={approveOn} onCheckedChange={onToggle} className="mt-0.5" />
            <span>{g.approval === "direct_over" ? t("approval_direct_over_now") : t("approval_above_limit_now", { limit: moneyFigure(limit) })}</span>
          </label>
        ) : (
          <span>{g.approval === "direct_over" ? t("approval_direct_over") : t("approval_above_limit")}</span>
        )}
        {actorIsOwner && g.approval !== "sent" && !approveOn && <span className="ms-2 text-muted-foreground">{t("approval_waits")}</span>}
      </div>
    </section>
  )
}
