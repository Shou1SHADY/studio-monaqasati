"use client"

// The RFQ page's small decisions (R-08, R-11, R-12, R-41): close early and
// unseal (the manager, with a reason, logged), the one reduction round to every
// live offer, cancel the RFQ (one of three reasons; its lines return to the
// needs), exclude an offer (one of five reasons, a note; it stays listed as
// excluded). Each runs its write from `rfq-writes.ts` and reports a refusal in
// the dialog.

import { useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Callout } from "@/components/module-ui/Callout"
import { Money } from "@/components/procurement/PoBits"
import { useFirestore } from "@/firebase"
import { EXCLUSION_CODES } from "@/lib/procurement/award"
import type { PricedProduct } from "@/lib/procurement/offer-pricing"
import { addDays, todayOf } from "@/lib/procurement/po"
import { RFQ_CANCEL_CODES, reductionTargets, type RfqCancelCode } from "@/lib/procurement/rfq-detail"
import { cancelRfq, closeRfqNow, excludeOffer, requestReductionRound } from "@/lib/procurement/rfq-writes"
import type { RfqWriteActor } from "@/lib/procurement/rfq-access"
import { ProcWriteError } from "@/lib/procurement/writes"
import { cn } from "@/lib/utils"

function useRefusalText() {
  const tProc = useTranslations("Portal.Procurement")
  const tc = useTranslations("Portal.Contractor")
  return (err: unknown) => {
    const code = err instanceof ProcWriteError ? err.code : null
    return code && tProc.has(`err_${code}`) ? tProc(`err_${code}`) : tc("offers_toast_error")
  }
}

function Chips<T extends string>({ value, options, onChange, label }: { value: T | ""; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            value === o.value ? "border-module bg-module/10 text-module" : "hover:bg-muted"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Shell({ open, onOpenChange, title, sub, children, error, busy, submitLabel, disabled, onSubmit, destructive }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  sub?: string
  children: ReactNode
  error: string | null
  busy: boolean
  submitLabel: string
  disabled: boolean
  onSubmit: () => void
  destructive?: boolean
}) {
  const locale = useLocale()
  const tc = useTranslations("Portal.Contractor")
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle>{title}</DialogTitle>
          {sub && <DialogDescription>{sub}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {children}
          {error && <Callout tone="block">{error}</Callout>}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {tc("cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={busy || disabled} variant={destructive ? "destructive" : "default"} className="gap-2">
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CloseNowDialog({ open, onOpenChange, rfqId, actor, offered, invited, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; rfqId: string; actor: RfqWriteActor; offered: number; invited: number; onDone: () => void }) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const firestore = useFirestore()
  const refusalText = useRefusalText()
  const [why, setWhy] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!firestore || !why.trim()) return
    setBusy(true)
    setError(null)
    try {
      await closeRfqNow(firestore, actor, rfqId, why)
      setWhy("")
      onDone()
    } catch (err) {
      setError(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell open={open} onOpenChange={onOpenChange} title={t("close.title")} error={error} busy={busy} submitLabel={t("close.submit")} disabled={!why.trim()} onSubmit={submit}>
      <div className="space-y-1.5">
        <Label htmlFor="rfq-close-why" className="text-xs font-bold">
          {t("close.why")} <span className="text-destructive">*</span>
        </Label>
        <Textarea id="rfq-close-why" rows={3} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t("close.placeholder")} className="resize-none text-sm" />
      </div>
      <Callout tone="warn">{t("close.warn", { offered, invited })}</Callout>
    </Shell>
  )
}

export function CancelRfqDialog({ open, onOpenChange, rfqId, actor, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; rfqId: string; actor: RfqWriteActor; onDone: () => void }) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const firestore = useFirestore()
  const refusalText = useRefusalText()
  const [code, setCode] = useState<RfqCancelCode | "">("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!firestore || !code) return
    setBusy(true)
    setError(null)
    try {
      await cancelRfq(firestore, actor, rfqId, code)
      setCode("")
      onDone()
    } catch (err) {
      setError(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell open={open} onOpenChange={onOpenChange} title={t("cancel.title")} error={error} busy={busy} submitLabel={t("cancel.submit")} disabled={!code} onSubmit={submit} destructive>
      <div className="space-y-1.5">
        <p className="text-xs font-bold">{t("cancel.reason")}</p>
        <Chips value={code} onChange={setCode} label={t("cancel.reason")} options={RFQ_CANCEL_CODES.map((c) => ({ value: c, label: t(`cancel.code.${c}`) }))} />
      </div>
      <ul className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
        <li>{t("cancel.effect")}</li>
      </ul>
    </Shell>
  )
}

export function ExcludeOfferDialog({
  open,
  onOpenChange,
  rfqId,
  offer,
  actor,
  showPrice,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  rfqId: string
  offer: { id: string; name: string; total: number | null } | null
  actor: RfqWriteActor
  showPrice: boolean
  onDone: (offerId: string) => void
}) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const tc = useTranslations("Portal.Contractor")
  const firestore = useFirestore()
  const refusalText = useRefusalText()
  const [code, setCode] = useState<string>("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!firestore || !offer || !code) return
    setBusy(true)
    setError(null)
    try {
      await excludeOffer(firestore, actor, { rfqId, offerId: offer.id, supplierName: offer.name, code, note })
      setCode("")
      setNote("")
      onDone(offer.id)
    } catch (err) {
      setError(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell open={open} onOpenChange={onOpenChange} title={t("exclude.title")} sub={t("exclude.sub")} error={error} busy={busy} submitLabel={t("exclude.submit")} disabled={!code} onSubmit={submit} destructive>
      {offer && (
        <div className="rounded-xl border bg-muted/30 p-3">
          <b dir="auto">{offer.name}</b>
          {showPrice && offer.total != null && (
            <p className="text-xs text-muted-foreground">
              <Money value={offer.total} /> {t("excl_vat")}
            </p>
          )}
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-xs font-bold">
          {tc("offers_exclusion_label")} <span className="text-destructive">*</span>
        </p>
        <Chips value={code} onChange={setCode} label={tc("offers_exclusion_label")} options={EXCLUSION_CODES.map((c) => ({ value: c, label: tc(`offers_exclusion_${c}`) }))} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rfq-exclude-note" className="text-xs font-bold">
          {t("exclude.detail")}
        </Label>
        <Textarea id="rfq-exclude-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tc("offers_exclusion_note_placeholder")} className="resize-none text-sm" />
      </div>
      <ul className="space-y-1 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
        <li>{t("exclude.effect_out")}</li>
        <li>{t("exclude.effect_kept")}</li>
      </ul>
    </Shell>
  )
}

export function ReductionRoundDialog({
  open,
  onOpenChange,
  rfqId,
  rfqTitle,
  products,
  lastPriceOf,
  offerIds,
  actor,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  rfqId: string
  rfqTitle: string
  products: PricedProduct[]
  lastPriceOf: (p: PricedProduct) => number | null
  offerIds: string[]
  actor: RfqWriteActor
  onDone: (reached: string[], message: string) => void
}) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const locale = useLocale()
  const firestore = useFirestore()
  const refusalText = useRefusalText()
  const [typed, setTyped] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const by = new Date(`${addDays(todayOf(new Date()), 2)}T00:00:00`).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { year: "numeric", month: "short", day: "numeric" })
  const message = t("round.message", { rfq: rfqTitle, date: by })
  const submit = async () => {
    if (!firestore) return
    setBusy(true)
    setError(null)
    try {
      const reached = await requestReductionRound(firestore, actor, { rfqId, offerIds, targets: reductionTargets(typed), message })
      setTyped({})
      onDone(reached, message)
    } catch (err) {
      setError(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell open={open} onOpenChange={onOpenChange} title={t("round.title")} sub={t("round.sub")} error={error} busy={busy} submitLabel={t("round.submit")} disabled={!offerIds.length} onSubmit={submit}>
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-bold">{t("round.targets")}</legend>
        <div className="divide-y rounded-xl border">
          {products.map((p) => {
            const last = lastPriceOf(p)
            return (
              <div key={p.rfqProductIndex} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <b className="block truncate font-semibold" dir="auto">
                    {p.name}
                  </b>
                  <span className="text-[11px] text-muted-foreground">
                    {last != null ? (
                      <>
                        {t("round.reference")} <Money value={last} />
                      </>
                    ) : (
                      t("round.no_history")
                    )}
                  </span>
                </span>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  dir="ltr"
                  className="h-9 w-28"
                  aria-label={t("round.target_for", { line: p.name })}
                  value={typed[p.rfqProductIndex] ?? ""}
                  onChange={(e) => setTyped((x) => ({ ...x, [p.rfqProductIndex]: e.target.value }))}
                />
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">{t("round.hint")}</p>
      </fieldset>
      <div className="space-y-1.5">
        <p className="text-xs font-bold">{t("round.copy_label")}</p>
        <Callout tone="info">
          <span className="select-all" dir="auto">
            {message}
          </span>
        </Callout>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(message).then(() => setCopied(true))
          }}
        >
          {copied ? t("round.copied") : t("round.copy")}
        </Button>
      </div>
      <ul className="space-y-1 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
        <li>{t("round.effect_all", { count: offerIds.length })}</li>
        <li>{t("round.effect_once")}</li>
        <li>{t("round.effect_where")}</li>
      </ul>
    </Shell>
  )
}
