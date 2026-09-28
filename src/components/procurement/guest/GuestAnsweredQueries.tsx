"use client"

import { useLocale, useTranslations } from "next-intl"
import { MessageCircleQuestion } from "lucide-react"
import type { AnsweredQuery } from "@/lib/procurement/guest-supplier"

// The answered queries every invitee receives (§5.1) — the guest reads them on
// his page as a registered supplier does in the portal. No asker is named.
export function GuestAnsweredQueries({ queries }: { queries: AnsweredQuery[] }) {
  const t = useTranslations("PublicRfq.extras")
  const locale = useLocale()
  if (!queries.length) return null
  return (
    <section className="space-y-2.5" aria-labelledby="guest-queries-title">
      <h2 id="guest-queries-title" className="flex items-center gap-2 text-sm font-bold text-foreground">
        <MessageCircleQuestion size={15} className="text-primary" aria-hidden="true" />
        {t("queries_title")}
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{queries.length}</span>
      </h2>
      <ul className="divide-y rounded-xl border bg-card">
        {queries.map((q, i) => (
          <li key={`${q.answeredAt}-${i}`} className="space-y-1 px-3.5 py-3 text-sm">
            <p className="font-semibold text-foreground" dir="auto">
              {q.question}
            </p>
            <p className="text-muted-foreground" dir="auto">
              ↳ {q.answer}
            </p>
            {q.answeredAt && (
              <p className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                {t("queries_answered_on", { date: new Date(q.answeredAt).toLocaleDateString(locale) })}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">{t("queries_note")}</p>
    </section>
  )
}
