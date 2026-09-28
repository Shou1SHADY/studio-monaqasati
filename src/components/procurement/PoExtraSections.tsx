"use client"

// The purchase order drawer's second layer (prototype `dPo`, R-20 … R-31):
// the document trail and who owns each step, the money trail Finance writes
// back (commitment, advance, accepted, paid, payment rows, held invoices with
// «قرّر وأبلغ المالية»), the line's context and in-transit share, the agreed
// schedule / call-offs, the warranty note, Projects' budget and sample gates,
// and the small forms these open. Finance's own buttons (record a payment,
// hold an invoice) show only to Finance — the same drawer opens from its desk.

import { useEffect, useMemo, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { collection } from "firebase/firestore"
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { cn } from "@/lib/utils"
import { todayOf } from "@/lib/procurement/po"
import {
  DATE_REASONS,
  HOLD_DECISIONS,
  HOLD_OWNER,
  HOLD_REASONS,
  advanceAmount,
  advanceNumber,
  advanceState,
  dateMissesNeed,
  docTrail,
  openHolds,
  paidTotal,
  paymentsNewestFirst,
  type BoqGateItem,
  type DateReason,
  type HoldReason,
  type PaymentKind,
  type PoFinanceHold,
  type PurchaseOrderX,
  type TrailStep,
} from "@/lib/procurement/po-extras"
import type { PaymentInput, HoldInput } from "@/lib/procurement/po-extra-writes"
import type { ReceiptFact } from "@/lib/procurement/types"
import { Money, useDateText } from "./PoBits"
import { moneyTrail } from "./PoModel"
import type { Submit } from "./PoActionDialogs"

type Tone = "red" | "amber" | "blue" | "green"

export function XCallout({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = tone === "green" ? CheckCircle2 : tone === "blue" ? Clock : AlertTriangle
  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2 text-sm leading-relaxed",
        tone === "red" && "border-destructive/30 bg-destructive/5 text-destructive",
        tone === "amber" && "border-warning/30 bg-warning/5 text-warning",
        tone === "blue" && "border-cta/30 bg-cta/5 text-cta",
        tone === "green" && "border-success/30 bg-success/5 text-success"
      )}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-foreground/90">{children}</div>
    </div>
  )
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b px-3 py-2">
        <h3 className="text-xs font-black text-muted-foreground">{title}</h3>
      </header>
      <div className="space-y-3 px-3 py-3">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// The document trail (R-20)
// ---------------------------------------------------------------------------

export function DocTrailSection({ po, deliveries, receiptNumber }: { po: PurchaseOrderX; deliveries: ReceiptFact[]; receiptNumber: (n: string) => string }) {
  const t = useTranslations("Portal.Procurement")
  const tProc = t
  const fmt = useDateText()
  const steps = useMemo(() => docTrail(po, deliveries), [po, deliveries])
  const who = (s: TrailStep): string[] => {
    const out = s.key === "receipt" ? s.who.map(receiptNumber) : [...s.who]
    for (const f of s.flags) {
      if (f === "self_issued") out.push(t("rfqpo.po.trail.self_issued"))
      else if (f === "outside") out.push(t("rfqpo.po.trail.outside"))
      else if (f.startsWith("channel:")) out.push(tProc(`channel.${f.slice(8)}`))
      else if (f === "by:supplier") out.push(t("rfqpo.po.trail.by_supplier"))
      else if (f === "by:buyer") out.push(t("rfqpo.po.trail.by_us"))
      else if (f === "held") out.push(t("rfqpo.po.trail.held"))
    }
    if (s.key === "accepted" && po.promisedDate && s.at) out.unshift(t("rfqpo.po.trail.date", { date: fmt(po.promisedDate) }))
    return out
  }
  return (
    <Box title={t("rfqpo.po.trail.title")}>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.key} className="flex gap-2 text-sm">
            <span
              className={cn(
                "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full",
                s.state === "ok" && "bg-success/15 text-success",
                s.state === "now" && "bg-cta/15 text-cta",
                s.state === "bad" && "bg-destructive/15 text-destructive",
                s.state === "todo" && "bg-muted text-muted-foreground"
              )}
              aria-hidden="true"
            >
              {s.state === "ok" ? <CheckCircle2 size={12} /> : s.state === "bad" ? <AlertTriangle size={12} /> : <Clock size={12} />}
            </span>
            <div className="min-w-0">
              <p className={cn("font-semibold", s.state === "todo" && "text-muted-foreground")}>{t(`rfqpo.po.trail.${s.key}`, { pct: Number(po.advancePercent) || 0 })}</p>
              <p className="text-[11px] text-muted-foreground">
                {s.at ? fmt(s.at) : t("rfqpo.po.trail.not_yet")}
                {who(s).length ? ` · ${who(s).join(" · ")}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// The banner — what came back from Finance (R-21)
// ---------------------------------------------------------------------------

export function FinanceBannerCallout({ po, seesPrices }: { po: PurchaseOrderX; seesPrices: boolean }) {
  const t = useTranslations("Portal.Procurement")
  const fmt = useDateText()
  const holds = openHolds(po)
  const pays = paymentsNewestFirst(po)
  if (holds.length) {
    return (
      <XCallout tone="red">
        <b>{t("rfqpo.po.banner.back")}</b> {t("rfqpo.po.banner.held", { invoice: holds[0].invoiceNo, reason: t(`rfqpo.po.hold.reason.${holds[0].reason}`) })}
      </XCallout>
    )
  }
  if (pays.length) {
    const p = pays[0]
    return (
      <XCallout tone="green">
        <b>{t("rfqpo.po.banner.back")}</b> {t(`rfqpo.po.pay.kind.${p.kind}`)} {seesPrices ? <Money value={p.amount} /> : null} {t("rfqpo.po.banner.paid", { ref: p.reference, date: fmt(p.valueDate) })}
      </XCallout>
    )
  }
  if (!po.approvedAt || po.status === "cancelled") return null
  return (
    <XCallout tone="green">
      <b>{t("rfqpo.po.banner.sent_title")}</b> {seesPrices ? t("rfqpo.po.banner.sent_value") : ""} {seesPrices && <Money value={moneyTrail(po).commitment} />} {t("rfqpo.po.banner.sent_body")}
    </XCallout>
  )
}

// ---------------------------------------------------------------------------
// The money trail (R-21, R-24)
// ---------------------------------------------------------------------------

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <div className="min-w-0">
        <p>{label}</p>
        {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0 font-bold">{children}</div>
    </div>
  )
}

export function FinanceTrailSection({
  po,
  canDecide,
  isFinance,
  onDecide,
  onRecordPayment,
  onHold,
  onRelease,
}: {
  po: PurchaseOrderX
  canDecide: boolean
  isFinance: boolean
  onDecide: (hold: PoFinanceHold) => void
  onRecordPayment: () => void
  onHold: () => void
  onRelease: (hold: PoFinanceHold) => void
}) {
  const t = useTranslations("Portal.Procurement")
  const fmt = useDateText()
  const money = moneyTrail(po)
  const adv = advanceState(po)
  const paid = paidTotal(po)
  const commitment = money.commitment
  const pctOf = (v: number) => (commitment > 0 ? `${Math.round((v / commitment) * 100)}%` : "0%")
  const advPaid = (po.financePayments || []).find((p) => p.kind === "adv")
  return (
    <Box title={t("rfqpo.po.money.title")}>
      <Row label={t("rfqpo.po.money.commitment")} hint={po.approvedAt ? t("rfqpo.po.money.commitment_hint", { date: fmt(po.approvedAt) }) : t("rfqpo.po.money.commitment_pending")}>
        <Money value={commitment} />
      </Row>
      {adv !== "none" && (
        <Row
          label={t("rfqpo.po.money.advance", { pct: Number(po.advancePercent) || 0 })}
          hint={advPaid ? t("rfqpo.po.money.advance_paid", { date: fmt(advPaid.valueDate), no: advPaid.no }) : adv === "requested" ? t("rfqpo.po.money.advance_requested", { no: advanceNumber(po) }) : t("rfqpo.po.money.advance_pending")}
        >
          <Money value={advanceAmount(po)} />
        </Row>
      )}
      <Row label={t("rfqpo.po.money.accepted")} hint={t("rfqpo.po.money.accepted_hint")}>
        {money.accepted == null ? <span className="text-muted-foreground">—</span> : <Money value={Math.round(money.accepted * (1 + (Number(po.vatRate) || 0)) * 100) / 100} />}
      </Row>
      <Row label={t("rfqpo.po.money.paid")} hint={t("rfqpo.po.money.paid_hint", { pct: pctOf(paid), left: Math.max(0, Math.round((commitment - paid) * 100) / 100).toLocaleString("en-US") })}>
        <Money value={paid} />
      </Row>
      {(po.financePayments || []).length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("rfqpo.po.money.no_payments")}</p>
      ) : (
        <ul className="space-y-2">
          {paymentsNewestFirst(po).map((p) => (
            <li key={p.no} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs">
              <div className="min-w-0 space-y-0.5">
                <p className="font-bold">
                  <span dir="ltr">{p.no}</span> · {t(`rfqpo.po.pay.kind.${p.kind}`)}
                  {p.invoiceNo ? ` · ${t("rfqpo.po.pay.for_invoice", { invoice: p.invoiceNo })}` : ""}
                </p>
                <p className="text-muted-foreground">
                  {t("rfqpo.po.pay.value_date", { date: fmt(p.valueDate) })}
                  {p.bank ? ` · ${p.bank}` : ""} · {t("rfqpo.po.pay.ref")} <span dir="ltr">{p.reference}</span>
                  {p.account ? (
                    <>
                      {" "}
                      · {t("rfqpo.po.pay.account")} <span dir="ltr">{p.account}</span>
                    </>
                  ) : null}
                </p>
                {(p.net != null || p.recovered) && (
                  <p className="text-muted-foreground">
                    {p.net != null && t("rfqpo.po.pay.net_vat", { net: p.net.toLocaleString("en-US"), vat: (p.vat ?? 0).toLocaleString("en-US") })}
                    {p.recovered ? ` − ${t("rfqpo.po.pay.recovered", { amount: p.recovered.toLocaleString("en-US") })}` : ""}
                  </p>
                )}
                <p className="text-muted-foreground">
                  {t("rfqpo.po.pay.of_po", { pct: pctOf(p.amount) })} · {t("rfqpo.po.pay.by", { name: p.byName })}
                </p>
              </div>
              <div className="shrink-0 text-end">
                <Money value={p.amount} className="text-sm font-black" />
                <p className="text-[11px] text-muted-foreground">{t("rfqpo.po.pay.paid_on", { date: fmt(p.at) })}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(po.financeHolds || []).map((h) => {
        const owner = HOLD_OWNER[h.reason]
        const open = h.state === "open"
        return (
          <div key={h.id} className="space-y-2">
            <XCallout tone={!open ? "blue" : owner === "fin" ? "amber" : "red"}>
              <p>
                <b>{t(`rfqpo.po.hold.reason.${h.reason}`)}</b> — <span dir="ltr">{h.invoiceNo}</span> · <Money value={h.amount} />
              </p>
              <p dir="auto">{h.text}</p>
              {h.need && (
                <p className="text-muted-foreground" dir="auto">
                  {t("rfqpo.po.hold.needed")}: {h.need}
                </p>
              )}
              <p className="text-[11px]">
                {open
                  ? t("rfqpo.po.hold.next_with", { owner: t(`rfqpo.po.hold.owner.${owner}`) })
                  : h.state === "decided"
                    ? t("rfqpo.po.hold.decided", { decision: t(`rfqpo.po.hold.decision.${h.decision}`), by: h.decidedByName || "—" }) + (h.decisionNote ? ` — ${h.decisionNote}` : "")
                    : t("rfqpo.po.hold.released")}
              </p>
            </XCallout>
            <div className="flex flex-wrap gap-2">
              {open && canDecide && (owner === "proc" || owner === "sup") && (
                <Button size="sm" onClick={() => onDecide(h)}>
                  {t("rfqpo.po.hold.decide")}
                </Button>
              )}
              {isFinance && h.state !== "released" && (
                <Button size="sm" variant="outline" onClick={() => onRelease(h)}>
                  {t("rfqpo.po.hold.release")}
                </Button>
              )}
            </div>
          </div>
        )
      })}
      {isFinance && po.approvedAt && po.status !== "cancelled" && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button size="sm" variant="outline" onClick={onRecordPayment}>
            {t("rfqpo.po.fin.record_payment")}
          </Button>
          <Button size="sm" variant="outline" onClick={onHold}>
            {t("rfqpo.po.fin.hold_invoice")}
          </Button>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("rfqpo.po.money.footer")}</p>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Schedule and warranty (R-30)
// ---------------------------------------------------------------------------

export function ScheduleSection({ po, schedule, notices }: { po: PurchaseOrderX; schedule: Array<{ quantity: number; date: string }>; notices: number }) {
  const t = useTranslations("Portal.Procurement")
  const fmt = useDateText()
  const today = todayOf(new Date())
  if (!schedule.length && !po.callOff) return null
  return (
    <Box title={t("rfqpo.po.schedule.title")}>
      {po.callOff && !schedule.length ? (
        <p className="text-sm text-muted-foreground">{t("rfqpo.po.schedule.calloff")}</p>
      ) : (
        <ul className="space-y-1.5">
          {schedule.map((s, i) => (
            <li key={`${s.date}-${i}`} className="flex items-center justify-between gap-2 text-sm">
              <span>{t("rfqpo.po.schedule.shipment", { n: i + 1 })}</span>
              <span className="flex items-center gap-2">
                <b className="tabular-nums" dir="ltr">
                  {s.quantity.toLocaleString("en-US")}
                </b>
                · {fmt(s.date)}
                {i < notices ? (
                  <span className="rounded-full bg-cta/10 px-2 py-0.5 text-[11px] font-semibold text-cta">{t("rfqpo.po.schedule.notified")}</span>
                ) : s.date < today ? (
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">{t("rfqpo.po.schedule.no_notice")}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Box>
  )
}

export function WarrantyCallout() {
  const t = useTranslations("Portal.Procurement")
  return <XCallout tone="blue">{t("rfqpo.po.warranty")}</XCallout>
}

// ---------------------------------------------------------------------------
// Projects' gates (R-25): read the project's BOQ lines the order names
// ---------------------------------------------------------------------------

export function useBoqGateItems(po: PurchaseOrderX | null): BoqGateItem[] {
  const firestore = useFirestore()
  const needs = Boolean(po && po.projectId && po.status === "awaiting_approval" && po.lines.some((l) => l.boqItemId))
  const q = useMemoFirebase(() => (firestore && needs && po?.projectId ? collection(firestore, "projects", po.projectId, "boqItems") : null), [firestore, needs, po?.projectId])
  const { data } = useCollection<BoqGateItem>(q)
  return useMemo(() => ((data || []) as BoqGateItem[]).filter(Boolean), [data])
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function FormShell({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function Chips<T extends string>({ value, options, label, onChange }: { value: T | ""; options: readonly T[]; label: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o ? "border-module bg-module/10 text-module" : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          {label(o)}
        </button>
      ))}
    </div>
  )
}

function Foot({ onCancel, submitting, label, destructive }: { onCancel: () => void; submitting: boolean; label: string; destructive?: boolean }) {
  const t = useTranslations("Portal.Procurement")
  return (
    <DialogFooter className="gap-2 sm:gap-2">
      <Button type="button" variant="outline" onClick={onCancel}>
        {t("rfqpo.cancel")}
      </Button>
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={submitting} className="gap-2">
        {submitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
        {label}
      </Button>
    </DialogFooter>
  )
}

/** «حدّث موعد المورد» with the reason he gave and the need-date warning (R-31). */
export function SupplierDateDialog({ open, onOpenChange, po, now, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; po: PurchaseOrderX; now: Date; onSubmit: Submit<{ date: string; note: string | null }> }) {
  const t = useTranslations("Portal.Procurement")
  const fmt = useDateText()
  const today = todayOf(now)
  const schema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t("rfqpo.po.date.required")).refine((d) => d >= today, t("rfqpo.po.date.not_past")),
    reason: z.union([z.literal(""), z.enum(DATE_REASONS)]),
    note: z.string().trim().optional(),
  })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { date: "", reason: "", note: "" } })
  useEffect(() => {
    if (open) form.reset({ date: "", reason: "", note: "" })
  }, [open, form])
  const [date, reason] = useWatch({ control: form.control, name: ["date", "reason"] })
  return (
    <FormShell open={open} onOpenChange={onOpenChange} title={t("rfqpo.po.date.title")} description={t("rfqpo.po.date.desc")}>
      <Form {...form}>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            const parts = [v.reason ? t(`rfqpo.po.date.reason.${v.reason}`) : "", v.note?.trim() || ""].filter(Boolean)
            if (await onSubmit({ date: v.date, note: parts.length ? parts.join(" — ") : null })) onOpenChange(false)
          })}
        >
          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("rfqpo.po.date.new")}</FormLabel>
                <FormControl>
                  <Input type="date" min={today} dir="ltr" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("rfqpo.po.date.reason_label")}</p>
            <Chips value={reason} options={DATE_REASONS} label={(r: DateReason) => t(`rfqpo.po.date.reason.${r}`)} onChange={(r) => form.setValue("reason", r)} />
          </div>
          {reason === "other" && (
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input dir="auto" placeholder={t("rfqpo.po.date.note_ph")} {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          )}
          {date && dateMissesNeed(po, date) && <XCallout tone="red">{t("rfqpo.po.date.after_need", { need: fmt(po.requestedDeliveryDate) })}</XCallout>}
          <Foot onCancel={() => onOpenChange(false)} submitting={form.formState.isSubmitting} label={t("rfqpo.po.date.submit")} />
        </form>
      </Form>
    </FormShell>
  )
}

/** Cancel the remainder with the supplier — the fee he charged, if any (R-29). */
export function CancelWithFeeDialog({
  open,
  onOpenChange,
  context,
  fromProjects,
  seesPrices,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  context: string | null
  fromProjects: string | null
  seesPrices: boolean
  onSubmit: Submit<{ reason: string; fee: number | null }>
}) {
  const t = useTranslations("Portal.Procurement")
  const schema = z.object({ reason: z.string().trim().min(1, t("rfqpo.reason_required")), fee: z.string().optional() })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { reason: "", fee: "" } })
  useEffect(() => {
    if (open) form.reset({ reason: fromProjects || "", fee: "" })
  }, [open, fromProjects, form])
  return (
    <FormShell open={open} onOpenChange={onOpenChange} title={t("rfqpo.po.cxl.title")}>
      <Form {...form}>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            if (await onSubmit({ reason: v.reason, fee: Number(v.fee) > 0 ? Number(v.fee) : null })) onOpenChange(false)
          })}
        >
          {context && <p className="rounded-lg border px-3 py-2 text-sm font-bold">{context}</p>}
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("rfqpo.po.cxl.reason")}</FormLabel>
                <FormControl>
                  <Textarea rows={2} dir="auto" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {seesPrices && (
            <FormField
              control={form.control}
              name="fee"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("rfqpo.po.cxl.fee")}</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} step="any" dir="ltr" className="tabular-nums" {...field} />
                  </FormControl>
                  <p className="text-[11px] text-muted-foreground">{t("rfqpo.po.cxl.fee_hint")}</p>
                </FormItem>
              )}
            />
          )}
          <ul className="space-y-1 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <li>• {fromProjects ? t("rfqpo.po.cxl.effect_pm") : t("rfqpo.po.cxl.effect_needs")}</li>
            <li>• {t("rfqpo.po.cxl.effect_revision")}</li>
          </ul>
          <Foot onCancel={() => onOpenChange(false)} submitting={form.formState.isSubmitting} label={t("rfqpo.po.cxl.submit")} destructive />
        </form>
      </Form>
    </FormShell>
  )
}

/** «قرّر وأبلغ المالية» — Procurement's answer to a held payment. */
export function DecideHoldDialog({ hold, onOpenChange, onSubmit }: { hold: PoFinanceHold | null; onOpenChange: (o: boolean) => void; onSubmit: Submit<{ decision: string; note: string | null }> }) {
  const t = useTranslations("Portal.Procurement")
  const schema = z.object({ decision: z.string().min(1, t("rfqpo.po.hold.pick")), note: z.string().trim().optional() })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { decision: "", note: "" } })
  useEffect(() => {
    if (hold) form.reset({ decision: "", note: "" })
  }, [hold, form])
  const decision = useWatch({ control: form.control, name: "decision" })
  const options = hold ? HOLD_DECISIONS[hold.reason] : []
  return (
    <FormShell open={Boolean(hold)} onOpenChange={onOpenChange} title={t("rfqpo.po.hold.form_title")} description={t("rfqpo.po.hold.form_desc")}>
      {hold && (
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (v) => {
              if (await onSubmit({ decision: v.decision, note: v.note?.trim() || null })) onOpenChange(false)
            })}
          >
            <dl className="space-y-1 rounded-lg border px-3 py-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("rfqpo.po.hold.reason_label")}</dt>
                <dd className="font-semibold">{t(`rfqpo.po.hold.reason.${hold.reason}`)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("rfqpo.po.hold.recorded")}</dt>
                <dd dir="auto">{hold.text}</dd>
              </div>
              {hold.need && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t("rfqpo.po.hold.needed")}</dt>
                  <dd dir="auto">{hold.need}</dd>
                </div>
              )}
            </dl>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("rfqpo.po.hold.our_decision")}</p>
              <Chips value={decision} options={options} label={(d) => t(`rfqpo.po.hold.decision.${d}`)} onChange={(d) => form.setValue("decision", d, { shouldValidate: true })} />
              {form.formState.errors.decision && <p className="text-xs text-destructive">{form.formState.errors.decision.message}</p>}
            </div>
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("rfqpo.po.hold.note")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} dir="auto" placeholder={t("rfqpo.po.hold.note_ph")} {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <ul className="space-y-1 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
              <li>• {t("rfqpo.po.hold.effect_1")}</li>
              <li>• {t("rfqpo.po.hold.effect_2")}</li>
            </ul>
            <Foot onCancel={() => onOpenChange(false)} submitting={form.formState.isSubmitting} label={t("rfqpo.po.hold.submit")} />
          </form>
        </Form>
      )}
    </FormShell>
  )
}

const KINDS: PaymentKind[] = ["adv", "part", "inv"]

/** Finance records a payment against the order — the advance included. */
export function RecordPaymentDialog({ open, onOpenChange, po, now, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; po: PurchaseOrderX; now: Date; onSubmit: Submit<PaymentInput> }) {
  const t = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const advDone = (po.financePayments || []).some((p) => p.kind === "adv")
  const kinds = KINDS.filter((k) => k !== "adv" || (!advDone && Number(po.advancePercent) > 0))
  const schema = z.object({
    kind: z.enum(["adv", "part", "inv"]),
    amount: z.string().refine((v) => Number(v) > 0, t("rfqpo.po.fin.amount_required")),
    invoiceNo: z.string().trim().optional(),
    valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t("rfqpo.po.date.required")),
    bank: z.string().trim().optional(),
    reference: z.string().trim().min(1, t("rfqpo.po.fin.ref_required")),
    account: z.string().trim().optional(),
  })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { kind: kinds[0] ?? "inv", amount: "", invoiceNo: "", valueDate: todayOf(now), bank: "", reference: "", account: "" } })
  useEffect(() => {
    if (open) form.reset({ kind: kinds[0] ?? "inv", amount: kinds[0] === "adv" ? String(advanceAmount(po)) : "", invoiceNo: "", valueDate: todayOf(now), bank: "", reference: "", account: "" })
    // Reset on opening only: a live update of the order must not wipe what Finance is typing.
  }, [open])
  const kind = useWatch({ control: form.control, name: "kind" })
  const field = (name: "amount" | "invoiceNo" | "valueDate" | "bank" | "reference" | "account", label: string, type = "text", ltr = false) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field: f }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={type} dir={ltr ? "ltr" : "auto"} {...f} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
  return (
    <FormShell open={open} onOpenChange={onOpenChange} title={t("rfqpo.po.fin.payment_title")} description={t("rfqpo.po.fin.payment_desc", { number: po.docNumber })}>
      <Form {...form}>
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit(async (v) => {
            if (await onSubmit({ kind: v.kind, amount: Number(v.amount), invoiceNo: v.invoiceNo || null, valueDate: v.valueDate, bank: v.bank || null, reference: v.reference, account: v.account || null })) onOpenChange(false)
          })}
        >
          <Chips value={kind} options={kinds} label={(k) => t(`rfqpo.po.pay.kind.${k}`)} onChange={(k) => form.setValue("kind", k)} />
          {field("amount", t("rfqpo.po.fin.amount"), "number", true)}
          {kind !== "adv" && field("invoiceNo", t("rfqpo.po.fin.invoice_no"), "text", true)}
          {field("valueDate", t("rfqpo.po.fin.value_date"), "date", true)}
          {field("bank", t("rfqpo.po.fin.bank"))}
          {field("reference", t("rfqpo.po.fin.reference"), "text", true)}
          {field("account", t("rfqpo.po.fin.account"), "text", true)}
          <p className="text-[11px] text-muted-foreground" lang={locale}>
            {t("rfqpo.po.fin.payment_note")}
          </p>
          <Foot onCancel={() => onOpenChange(false)} submitting={form.formState.isSubmitting} label={t("rfqpo.po.fin.record")} />
        </form>
      </Form>
    </FormShell>
  )
}

/** Finance holds an invoice on the order, with the reason and what would release it. */
export function HoldInvoiceDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: Submit<HoldInput> }) {
  const t = useTranslations("Portal.Procurement")
  const schema = z.object({
    reason: z.enum(HOLD_REASONS),
    invoiceNo: z.string().trim().min(1, t("rfqpo.po.fin.invoice_required")),
    amount: z.string().refine((v) => Number(v) > 0, t("rfqpo.po.fin.amount_required")),
    text: z.string().trim().min(1, t("rfqpo.reason_required")),
    need: z.string().trim().optional(),
  })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { reason: "qty", invoiceNo: "", amount: "", text: "", need: "" } })
  useEffect(() => {
    if (open) form.reset({ reason: "qty", invoiceNo: "", amount: "", text: "", need: "" })
  }, [open, form])
  const reason = useWatch({ control: form.control, name: "reason" })
  return (
    <FormShell open={open} onOpenChange={onOpenChange} title={t("rfqpo.po.fin.hold_title")}>
      <Form {...form}>
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit(async (v) => {
            if (await onSubmit({ reason: v.reason, invoiceNo: v.invoiceNo, amount: Number(v.amount), text: v.text, need: v.need || "" })) onOpenChange(false)
          })}
        >
          <Chips value={reason} options={HOLD_REASONS} label={(r: HoldReason) => t(`rfqpo.po.hold.reason.${r}`)} onChange={(r) => form.setValue("reason", r)} />
          <p className="text-[11px] text-muted-foreground">{t("rfqpo.po.hold.next_with", { owner: t(`rfqpo.po.hold.owner.${HOLD_OWNER[reason]}`) })}</p>
          {(["invoiceNo", "amount"] as const).map((name) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t(name === "invoiceNo" ? "rfqpo.po.fin.invoice_no" : "rfqpo.po.fin.invoice_amount")}</FormLabel>
                  <FormControl>
                    <Input type={name === "amount" ? "number" : "text"} dir="ltr" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          {(["text", "need"] as const).map((name) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t(name === "text" ? "rfqpo.po.hold.recorded" : "rfqpo.po.hold.needed")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} dir="auto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          <Foot onCancel={() => onOpenChange(false)} submitting={form.formState.isSubmitting} label={t("rfqpo.po.fin.hold_submit")} destructive />
        </form>
      </Form>
    </FormShell>
  )
}
