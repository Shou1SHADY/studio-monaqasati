"use client"

// Small pieces the OTHER modules' screens use when they act on something the
// workshop reads — Sales recording a client's drawing result, Procurement
// marking a purchase arrived, Finance editing the manufacturing policies, HR
// keeping the fleet. Context-free on purpose: these screens have no
// Manufacturing session and must not pull one in.

import { UserCheck } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

type T = ReturnType<typeof useTranslations>

/** An error code thrown by the manufacturing writes → a sentence. */
export function mfgActError(t: T, err: unknown): string {
  const code = (err as Error)?.message || ""
  if (code && t.has(`mfy_err_${code}`)) return t(`mfy_err_${code}`)
  if (code && t.has(`mfg4_err_${code}`)) return t(`mfg4_err_${code}`)
  if ((err as { code?: string })?.code === "permission-denied") return t("mfy_err_permission")
  return t("mfg4_err_generic")
}

/** Every decision is recorded as the signed-in user — there is no name field (D8). */
export function SignedInAs({ name, className }: { name: string; className?: string }) {
  const t = useTranslations("Portal.Shared")
  return (
    <p className={cn("flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
      <UserCheck size={12} aria-hidden="true" />
      <span className="font-semibold text-foreground">{t("mfg4_recorded_as", { name: name || "—" })}</span>
      <span>— {t("mfg4_from_signin")}</span>
    </p>
  )
}
