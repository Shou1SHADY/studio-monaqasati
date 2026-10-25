"use client"

import { useCallback, useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { fmtN, makeFmt, relKey, type Locale } from "@/lib/supplier-free/format"
import { SAR_SIGN } from "@/lib/riyal"
import { useFreeWorld } from "./FreeWorldProvider"

/** Everything a free-supplier screen needs: the deals and their logic, the words, and the formats. */
export function useFree() {
  const fw = useFreeWorld()
  const t = useTranslations("SupplierFree")
  const tCat = useTranslations("Portal.Sidebar")
  const locale = useLocale() as Locale
  const dataYear = Number(fw.today.slice(0, 4))
  const labels = useMemo(() => ({ cur: t("cur"), thousand: t("unitK"), million: t("unitM") }), [t])
  // On screen the riyal is the official sign (riyal.ts); `fmt.moneyText` keeps the words for text sent away.
  const fmt = useMemo(() => makeFmt(locale, labels, dataYear, { sign: SAR_SIGN }), [locale, labels, dataYear])
  /** A counted noun in its own plural form: `pl("pl_day", 3)`. */
  const pl = useCallback((key: string, n: number) => t(key, { n, c: fmtN(n) }), [t])
  /** "today" · "tomorrow" · "in 3 days" · "2 days ago". */
  const rel = useCallback(
    (iso: string) => {
      const r = relKey(fw.L.daysTo(iso))
      return r.key === "inX" || r.key === "agoX" ? t(r.key, { x: pl("pl_day", r.days) }) : t(r.key)
    },
    [fw.L, pl, t]
  )
  return { ...fw, t, tCat, locale, isAr: locale === "ar", fmt, pl, rel }
}

export type Free = ReturnType<typeof useFree>
