"use client"

// One cell of the comparison (CMP-01/02/16/18): the BIG number is the effective price per request unit — what you pay ÷ what you asked
// for — with ★ «الأقل» on the lowest (every tie within 0.5 %), the piece line in the buyer's words under it, and the states that lock it
// (excluded · expired · carried by a live order · not priced). Clicking an open cell picks that supplier's version for that line.

import { useTranslations } from "next-intl"
import { Lock, Star } from "lucide-react"
import { moneyFigure } from "@/components/procurement/PoModel"
import type { CompareCell as CellModel } from "@/lib/procurement/compare-model"
import { cn } from "@/lib/utils"

const sar = (h: number | null | undefined): string => moneyFigure(h == null ? null : h / 100)

export interface CompareCellProps {
  cell: CellModel
  unit: string
  lineName: string
  supplier: string
  showPrices: boolean
  interactive: boolean
  excluded: boolean
  onPick: () => void
  onAskReval?: () => void
}

export function CompareCell({ cell, unit, lineName, supplier, showPrices, interactive, excluded, onPick, onAskReval }: CompareCellProps) {
  const t = useTranslations("Portal.Procurement.cmp2")
  if (cell.state === "lump") {
    return (
      <div className={cn("flex min-w-[8rem] flex-col items-start rounded-lg border border-transparent px-2.5 py-1.5 text-xs text-muted-foreground", excluded && "opacity-50")}>
        <span>{t("in_lump")}</span>
        {cell.star && showPrices && (
          <span className="mt-0.5 inline-flex items-center gap-1 font-bold text-success">
            <Star size={11} aria-hidden="true" />
            {t("lowest")}
          </span>
        )}
      </div>
    )
  }
  if (cell.state === "none") {
    return <div className="min-w-[8rem] px-2.5 py-1.5 text-xs text-muted-foreground">{t("no_price")}</div>
  }
  const pack = cell.pack
  const lock = cell.pickable.ok ? null : cell.pickable.why
  const disabled = !interactive || !cell.pickable.ok || !showPrices
  const packText = pack
    ? `${pack.pcs} ${cell.packName || `× ${pack.packLen} ${unit}`} × ${sar(cell.rateH)} ${t("sar")} · ${t("you_receive", { received: pack.received, unit })}${pack.extra > 0 ? ` (${t("extra", { extra: pack.extra })})` : ""}`
    : null
  return (
    <div className="min-w-[8.5rem]">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={cell.picked}
        aria-label={t("pick_label", { line: lineName, supplier })}
        onClick={onPick}
        className={cn(
          "flex w-full flex-col items-start rounded-lg border px-2.5 py-1.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          cell.picked ? "border-module bg-module/10 ring-1 ring-module" : cell.star && !excluded ? "border-success/40 bg-success/5" : "border-transparent",
          lock ? "bg-muted/40 text-muted-foreground" : "",
          !disabled && "hover:border-module/50 hover:bg-muted/50",
          disabled && "cursor-default",
          excluded && "opacity-50"
        )}
      >
        <span dir="ltr" className={cn("text-base font-black tabular-nums", cell.star && !lock && "text-success", cell.picked && "text-module")}>
          {showPrices ? sar(cell.effH) : "—"}
        </span>
        {showPrices && (
          <>
            <span className="text-[11px] text-muted-foreground">{cell.effective ? t("per_unit_effective", { unit }) : t("per_unit", { unit })}</span>
            {cell.star && !excluded && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-success">
                <Star size={11} aria-hidden="true" />
                {t("lowest")}
              </span>
            )}
            {packText && (
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground" dir="auto">
                {packText}
              </span>
            )}
            {pack?.perReceivedH != null && (
              <span className="text-[11px] font-semibold text-muted-foreground">
                {t("per_received")} <bdi dir="ltr">{sar(pack.perReceivedH)}</bdi>
              </span>
            )}
            <span dir="ltr" className="text-[11px] tabular-nums text-muted-foreground">
              {sar(cell.totalH)}
            </span>
            {cell.warrantyMonths != null && <span className="text-[10px] text-muted-foreground">{cell.warrantyMonths > 0 ? t("warranty_months", { months: cell.warrantyMonths }) : t("warranty_none")}</span>}
          </>
        )}
        {lock && (
          <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-warning">
            <Lock size={11} aria-hidden="true" />
            {lock === "locked" ? t("locked_order", { po: cell.lockedBy || "" }) : t(`lock_${lock}`)}
          </span>
        )}
      </button>
      {lock === "expired" && onAskReval && (
        <button type="button" onClick={onAskReval} className="mt-1 ps-2.5 text-[11px] font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("ask_reval")}
        </button>
      )}
    </div>
  )
}
