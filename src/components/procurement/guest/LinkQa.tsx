"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Mail, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AnsweredQuery } from "./link-types"

// «أسئلة وأجوبة» (LNK-08): what the buyer answered to everyone and the clarifications he posted — never who asked — and one box
// to ask before pricing. An unverified asker is nameless; the buyer sees that and edits the wording before it goes to all.
export function LinkQa({ queries, onAsk, disabled = false }: { queries: AnsweredQuery[]; onAsk: (question: string) => Promise<boolean>; disabled?: boolean }) {
  const t = useTranslations("PublicRfq")
  const locale = useLocale()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const ask = async () => {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)
    const ok = await onAsk(q)
    setBusy(false)
    if (ok) {
      setText("")
      setSent(true)
    }
  }

  return (
    <section className="space-y-3 rounded-md border bg-card p-3.5" aria-labelledby="link-qa-title">
      <h2 id="link-qa-title" className="flex flex-wrap items-center gap-x-2 text-sm font-bold text-foreground">
        <Mail size={15} className="text-primary" aria-hidden="true" />
        {t("qa_title")}
        <span className="text-xs font-normal text-muted-foreground">{queries.length ? t("qa_sub_count", { count: queries.length.toLocaleString(locale) }) : t("qa_sub_ask")}</span>
      </h2>
      {queries.length > 0 && (
        <ul className="space-y-2">
          {queries.map((q, i) => (
            <li key={`${q.answeredAt}-${i}`} className="space-y-0.5 rounded-md bg-muted/50 px-3 py-2 text-sm">
              <b className="block text-foreground" dir="auto">
                {q.clarification ? t("qa_note") : q.question}
              </b>
              <span className="text-muted-foreground" dir="auto">
                {q.answer}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value)
            setSent(false)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask()
          }}
          placeholder={t("qa_ph")}
          aria-label={t("qa_ph")}
          maxLength={1000}
          className="h-11 min-w-0 flex-1"
          dir="auto"
        />
        <Button type="button" variant="outline" disabled={disabled || busy || !text.trim()} onClick={() => void ask()} className="min-h-11 gap-1.5">
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" className="rtl-flip" />}
          {t("qa_btn")}
        </Button>
      </div>
      {sent && (
        <p className="text-xs font-semibold text-success" role="status">
          {t("qa_sent")}
        </p>
      )}
    </section>
  )
}
