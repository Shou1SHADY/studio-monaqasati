"use client"

// The offer's commercial terms as the supplier types them (R-16): delivered
// to site or ex-works, valid until, the advance he asks and the credit on the
// rest. Used by the supplier's offer dialog and the guest link; the value is
// parsed by `parseOfferTerms` so both write the same fields.

import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PRICE_BASES, type OfferTermsInput } from "@/lib/procurement/offer-terms"
import { cn } from "@/lib/utils"

export type OfferTermsValue = Required<{ [K in keyof OfferTermsInput]: string }>
export const EMPTY_OFFER_TERMS: OfferTermsValue = { priceBasis: "", validUntil: "", advancePercent: "", creditDays: "" }

export function OfferTermsFields({ value, onChange, idPrefix = "offer-terms", className }: { value: OfferTermsValue; onChange: (next: OfferTermsValue) => void; idPrefix?: string; className?: string }) {
  const t = useTranslations("Portal.Procurement")
  const today = new Date().toISOString().slice(0, 10)
  const set = (k: keyof OfferTermsValue, v: string) => onChange({ ...value, [k]: v })
  return (
    <div className={cn("space-y-3 rounded-2xl border p-4", className)}>
      <p className="text-sm font-bold">{t("rfqpo.terms.title")}</p>
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground" id={`${idPrefix}-basis`}>
          {t("rfqpo.terms.basis")}
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`${idPrefix}-basis`}>
          {PRICE_BASES.map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={value.priceBasis === b}
              onClick={() => set("priceBasis", value.priceBasis === b ? "" : b)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                value.priceBasis === b ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {t(`rfqpo.terms.basis_${b}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-valid`} className="text-xs">
            {t("rfqpo.terms.valid_until")}
          </Label>
          <Input id={`${idPrefix}-valid`} type="date" min={today} dir="ltr" value={value.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-adv`} className="text-xs">
            {t("rfqpo.terms.advance")}
          </Label>
          <Input id={`${idPrefix}-adv`} type="number" min={0} max={100} step="any" dir="ltr" placeholder="0" value={value.advancePercent} onChange={(e) => set("advancePercent", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-credit`} className="text-xs">
            {t("rfqpo.terms.credit")}
          </Label>
          <Input id={`${idPrefix}-credit`} type="number" min={0} max={365} step={1} dir="ltr" placeholder="0" value={value.creditDays} onChange={(e) => set("creditDays", e.target.value)} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("rfqpo.terms.hint")}</p>
    </div>
  )
}
