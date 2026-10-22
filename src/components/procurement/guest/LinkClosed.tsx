"use client"

import { useLocale, useTranslations } from "next-intl"
import { Lock } from "lucide-react"
import { fmtDay } from "./link-format"
import type { LinkRfqView } from "./link-types"

// A request that no longer takes quotes (LNK-11, G-07): after the deadline, the award or the cancellation. No form, no matter
// what the page held open — the server refuses too. A visitor who quoted is pointed to his result.
export function LinkClosed({ rfq, children }: { rfq: LinkRfqView; children?: React.ReactNode }) {
  const t = useTranslations("PublicRfq")
  const locale = useLocale()
  const date = fmtDay((rfq.closedAt || rfq.closeAt || "").slice(0, 10), locale)
  return (
    <section className="space-y-2 rounded-md border bg-card p-5 text-center" aria-labelledby="link-closed-title">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
        <Lock size={20} />
      </span>
      <h1 id="link-closed-title" className="text-lg font-black text-foreground">
        {t("closed_title")}
      </h1>
      <p className="text-sm text-muted-foreground">{rfq.closedEarly ? t("closed_body_early", { date }) : t("closed_body", { date })}</p>
      {children}
    </section>
  )
}
