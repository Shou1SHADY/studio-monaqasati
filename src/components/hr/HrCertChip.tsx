"use client"

// A safety certificate as a chip (the prototype's certChip): its name and its expiry, or «لا شهادة» — coloured
// by its state like any document (DC-01). And a day said relative to today («بعد 3 أيام» · «اليوم» · «قبل 3 أيام»).

import { useLocale, useTranslations } from "next-intl"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { hrDate } from "@/lib/hr/format"
import { daysBetween } from "@/lib/hr/statutory"
import type { CertKey, CertState } from "@/lib/hr/training"

export const CERT_TONE: Record<CertState, PillTone> = { missing: "bad", expired: "bad", d30: "bad", d60: "warn", valid: "ok" }

export function CertChip({ k, state, expiry }: { k: CertKey; state: CertState; expiry?: string | null }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  return (
    <StatusPill tone={CERT_TONE[state]}>
      {t(`train.cert.${k}`)} · {state === "missing" ? t("train.none") : hrDate(expiry ?? null, locale)}
    </StatusPill>
  )
}

export function relDay(t: ReturnType<typeof useTranslations>, today: string, day: string): string {
  const n = daysBetween(today, day)
  return n === 0 ? t("train.rel_today") : n > 0 ? t("train.rel_in", { n }) : t("train.rel_ago", { n: -n })
}
