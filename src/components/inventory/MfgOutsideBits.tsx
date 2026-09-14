"use client"

// Small pieces shared by the screens where other modules act on the workshop's
// requests (Inventory's manufacturing desk and delivery notes, a project's
// workshop panel, Procurement's routing). They carry no Manufacturing context:
// the signed-in name comes from the caller, errors map the writes' codes.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Box, Package, Truck, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"
import type { MfgDeliveryNote } from "@/lib/mfg-outside"

type T = ReturnType<typeof useTranslations>

/** A write's error code → a message: this area's wording first, then the
 * shared manufacturing vocabulary, then the generic one. */
export function errText(t: T, err: unknown): string {
  const code = (err as Error)?.message || ""
  if (code && t.has(`mfx_err_${code}`)) return t(`mfx_err_${code}`)
  if (code && t.has(`mfg4_err_${code}`)) return t(`mfg4_err_${code}`)
  return t("mfg4_err_generic")
}

/** "Decision recorded as {name} — from your sign-in" (D8: no name fields). */
export function RecordedAsLine({ name, className }: { name: string; className?: string }) {
  const t = useTranslations("Portal.Shared")
  const initials = (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("")
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-xl border border-dashed bg-white px-3 py-2 text-[11px] text-muted-foreground", className)}>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-white" aria-hidden="true">
        {initials}
      </span>
      <span className="font-semibold text-foreground">{t("mfg4_recorded_as", { name })}</span>
      <span className="ms-auto">{t("mfg4_from_signin")}</span>
    </div>
  )
}

/** Pieces, crates and the fleet vehicle a note left with (DN-04). */
export function NoteShipmentFacts({ note, className }: { note: MfgDeliveryNote; className?: string }) {
  const t = useTranslations("Portal.Shared")
  const vehicle = [note.driverName, note.vehicleLabel || note.vehiclePlate].filter(Boolean).join(" · ")
  if (note.pieces == null && note.crates == null && !vehicle) return null
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {note.pieces != null && (
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-px text-[10px] font-bold text-slate-600">
          <Package size={10} aria-hidden="true" />
          {t("mfx_dn_pieces", { count: note.pieces })}
        </span>
      )}
      {note.crates != null && (
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-px text-[10px] font-bold text-slate-600">
          <Box size={10} aria-hidden="true" />
          {t("mfx_dn_crates", { count: note.crates })}
        </span>
      )}
      {vehicle && (
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-px text-[10px] font-bold text-slate-600" dir="auto">
          {note.driverName ? <UserRound size={10} aria-hidden="true" /> : <Truck size={10} aria-hidden="true" />}
          {vehicle}
        </span>
      )}
    </span>
  )
}

/** The clock the escalation and age texts read — ticks each minute. */
export function useNowMs(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/** "3 h" under a day, "2 d" beyond. */
export function ageText(t: T, hours: number): string {
  return hours < 24 ? t("mfx_age_hours", { hours: Math.max(0, Math.floor(hours)) }) : t("mfx_age_days", { days: Math.floor(hours / 24) })
}
