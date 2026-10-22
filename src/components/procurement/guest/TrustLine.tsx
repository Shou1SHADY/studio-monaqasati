"use client"

import { useTranslations } from "next-intl"
import { Lock } from "lucide-react"

// The one sentence a visitor needs before he prices (LNK-03): no account, no commission, only the buyer sees it, and the
// request may be awarded before its deadline. The buyer's own notes ride after it.
export function TrustLine({ company, notes }: { company: string; notes?: string | null }) {
  const t = useTranslations("PublicRfq")
  return (
    <p className="flex items-start gap-2 rounded-md border bg-card px-3 py-2.5 text-xs leading-relaxed text-foreground" role="note">
      <Lock size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
      <span>
        {t("trust", { company: company || t("trust_generic") })}
        {notes ? <span className="text-muted-foreground" dir="auto"> {notes}</span> : null}
      </span>
    </p>
  )
}
