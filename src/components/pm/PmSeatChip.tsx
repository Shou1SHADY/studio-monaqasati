"use client"

// «صلاحيتك: …» at the head of every portfolio tab (the prototype's role chip),
// the seat's job as its tooltip.

import { useTranslations } from "next-intl"
import { ShieldCheck } from "lucide-react"
import { usePmSeat } from "@/hooks/usePmSeat"

export function PmSeatChip() {
  const t = useTranslations("Portal.PM")
  const seat = usePmSeat()
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground" title={t(`seat.${seat}.job`)}>
      <ShieldCheck size={12} aria-hidden="true" /> {t("seat.chip", { role: t(`seat.${seat}.name`) })}
    </span>
  )
}
