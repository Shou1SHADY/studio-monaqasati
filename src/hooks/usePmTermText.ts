"use client"

// A contract term's value in the reader's language — stored as fields, worded
// at display (S-14): options by their label, rates as %, periods in days.

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { pmPct } from "@/lib/pm/format"
import type { DelayDamages, TermKey } from "@/lib/pm/terms"

const OPTION_KEYS: readonly TermKey[] = ["payer", "basis", "advanceRecovery", "retentionRelease"]
const RATE_KEYS: readonly TermKey[] = ["advance", "retention", "retentionCap"]

export function usePmTermText() {
  const t = useTranslations("Portal.PM")
  return useCallback(
    (key: TermKey, value: unknown): string => {
      if (value === null || value === undefined) return "—"
      if (OPTION_KEYS.includes(key)) return t(`terms.opt.${key}.${String(value)}` as "terms.save")
      if (RATE_KEYS.includes(key)) return pmPct(Number(value))
      if (key === "damages") {
        const d = value as DelayDamages
        return d.on ? t("terms.damages_value", { rate: pmPct(d.weeklyRate), cap: pmPct(d.cap) }) : t("terms.damages_off")
      }
      return t("days", { count: Number(value) })
    },
    [t]
  )
}
