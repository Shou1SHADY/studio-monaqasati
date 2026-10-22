"use client"

import { useTranslations } from "next-intl"
import { Hourglass } from "lucide-react"

/** «قادمة» (INC-06, P2): the shell only. Nothing is published before a request's technical approval; the source of what is coming is not decided yet, so it says so. */
export function UpcomingShell() {
  const t = useTranslations("Portal.Shared")
  return (
    <div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">
      <Hourglass size={32} className="mx-auto mb-2 opacity-30" aria-hidden="true" />
      <p className="text-sm font-semibold text-foreground">{t("rq_upcoming_title")}</p>
      <p className="mx-auto mt-1 max-w-xl text-xs">{t("rq_upcoming_hint")}</p>
    </div>
  )
}
