"use client"

// «آخر شراء» under a material (CMP-05): the last price we paid for the SAME SPECIFICATION and the order that paid it — or nothing at all.

import { useLocale, useTranslations } from "next-intl"
import { moneyFigure } from "@/components/procurement/PoModel"
import { displayPoNumber } from "@/lib/procurement/format"
import type { PriceHistoryEntry } from "@/lib/procurement/prices"

export function LastBuy({ entry }: { entry: PriceHistoryEntry | null }) {
  const t = useTranslations("Portal.Procurement.cmp2")
  const locale = useLocale()
  if (!entry) return null
  return (
    <span className="block text-[11px] font-normal text-muted-foreground" dir="auto">
      {t("last_buy", { price: moneyFigure(entry.price) })}
      {entry.poNumber ? (
        <>
          {" "}
          (<bdi dir="ltr">{displayPoNumber(entry.poNumber, locale)}</bdi>)
        </>
      ) : null}
    </span>
  )
}
