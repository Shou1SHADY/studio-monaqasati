"use client"

import { useLocale, useTranslations } from "next-intl"
import { grossOf } from "@/lib/procurement/link-pricing"
import { fmtMoney } from "./link-format"

// The total under the lines: with VAT and the net small beside it, or — for a business that is not VAT-registered — the net
// alone and «بلا ضريبة» (LNK-05). Live as he types.
export function LinkTotals({ net, nonVat }: { net: number; nonVat: boolean }) {
  const t = useTranslations("PublicRfq")
  const locale = useLocale()
  const sar = t("sar")
  const money = (n: number) => `${fmtMoney(n, locale)} ${sar}`
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md bg-muted/60 px-3 py-2.5" id="link-totals" aria-live="polite">
      <span className="text-sm text-muted-foreground">{nonVat ? t("sum_nonvat") : t("sum_incl")}</span>
      <b className="text-lg text-foreground" data-total>
        {money(nonVat ? net : grossOf(net, true))}
      </b>
      <small className="w-full text-end text-[11px] text-muted-foreground">{nonVat ? t("sum_novat") : t("sum_before", { amount: money(net) })}</small>
    </div>
  )
}
