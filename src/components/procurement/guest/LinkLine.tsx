"use client"

import { useLocale, useTranslations } from "next-intl"
import { ShieldCheck } from "lucide-react"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { cn } from "@/lib/utils"
import { lineTotal } from "@/lib/procurement/link-pricing"
import type { LinkLineView } from "@/lib/procurement/rfq-share-view"
import { WARRANTY_CHOICES, fmtMoney, fmtQty, monthsText } from "./link-format"
import type { LineState } from "./link-types"

// One material (LNK-05, LNK-06): its name, specs and quantity; the warranty the buyer asks, where he asks one; then a price
// WITHOUT VAT per request unit or per piece (the sale units the line offers), the live total of the line — «20 قطعة 6 م = 120 متر ·
// 1,200 ر.س» — and «لا أورّدها». The maths is the comparison's own (`link-pricing.ts`).
export function LinkLine({ line, state, lump, onChange, disabled = false }: { line: LinkLineView; state: LineState; lump: boolean; onChange: (patch: Partial<LineState>) => void; disabled?: boolean }) {
  const t = useTranslations("PublicRfq")
  const locale = useLocale()
  const packName = (len: number | null) => {
    const unit = line.saleUnits.find((u) => u.lengthM === len)
    return unit ? (locale === "ar" ? unit.ar : unit.en) : ""
  }
  const total = lineTotal(line.qty, state.price, state.per)
  const sar = t("sar")
  const money = (n: number) => `${fmtMoney(n, locale)} ${sar}`
  const asked = line.warrantyMonths
  const warrantyValue = state.war ?? asked ?? 0

  return (
    <div className={cn("space-y-2.5 rounded-md border bg-card p-3", state.skipped && "opacity-70")} data-line={line.index}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-foreground" dir="auto">
            {line.name}
          </p>
          {line.specs && (
            <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
              {line.specs}
            </p>
          )}
        </div>
        <p className="shrink-0 text-sm font-semibold text-foreground">
          <bdi dir="ltr">{fmtQty(line.qty, locale)}</bdi> {line.unit}
        </p>
      </div>

      {asked != null && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs">
          <ShieldCheck size={14} className="shrink-0 text-primary" aria-hidden="true" />
          <span className="flex-1 text-muted-foreground">
            {t("war_required", { duration: "" }).trim()} <b className="text-foreground">{monthsText(asked, t)}</b>
          </span>
          <NativeSelect
            aria-label={t("war_required", { duration: monthsText(asked, t) })}
            value={warrantyValue}
            disabled={disabled}
            onChange={(e) => onChange({ war: Number(e.target.value) })}
            className="h-9 max-w-full text-xs font-semibold"
          >
            {WARRANTY_CHOICES(asked).map((m) => (
              <option key={m} value={m}>
                {m === asked ? t("war_keep", { duration: monthsText(m, t) }) : m > 0 ? t("war_only", { duration: monthsText(m, t) }) : t("war_none")}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      {lump ? null : state.skipped ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("line_skipped")} ·
          <button type="button" disabled={disabled} onClick={() => onChange({ skipped: false })} className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("line_undo")}
          </button>
        </p>
      ) : (
        <div className="space-y-2">
          {line.saleUnits.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("unit_per", { unit: line.unit })}>
              {[null, ...line.saleUnits.map((u) => u.lengthM)].map((len) => (
                <button
                  key={len ?? "unit"}
                  type="button"
                  disabled={disabled}
                  aria-pressed={state.per === len}
                  onClick={() => onChange({ per: len })}
                  className={cn(
                    "min-h-[36px] rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    state.per === len ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t("unit_per", { unit: len == null ? line.unit : packName(len) })}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input
              inputMode="decimal"
              dir="ltr"
              disabled={disabled}
              value={state.price}
              onChange={(e) => onChange({ price: e.target.value.replace(/[^\d.,٠-٩]/g, "") })}
              placeholder={state.per ? t("price_ph_pack", { pack: packName(state.per) }) : t("price_ph_unit", { unit: line.unit })}
              aria-label={state.per ? t("price_ph_pack", { pack: packName(state.per) }) : t("price_ph_unit", { unit: line.unit })}
              className="h-11 min-w-0 flex-1 text-start"
            />
            <span className="shrink-0 text-xs font-semibold text-muted-foreground">{sar}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-foreground" data-line-total={line.index}>
              {total ? (total.per ? t("line_total_pack", { pcs: total.pcs ?? 0, pack: packName(total.per), received: fmtQty(total.received ?? 0, locale), unit: line.unit, amount: money(total.total) }) : money(total.total)) : "—"}
            </span>
            <button type="button" disabled={disabled} onClick={() => onChange({ skipped: true, price: "" })} className="font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("line_skip")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
