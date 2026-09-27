"use client"

// An addendum's changes as the reader sees them: term — from → to (AMD-01).

import { useTranslations } from "next-intl"
import { ArrowRight } from "lucide-react"
import { usePmTermText } from "@/hooks/usePmTermText"
import type { TermChange } from "@/lib/pm/terms"
import { cn } from "@/lib/utils"

export function TermChangeList({ changes, className }: { changes: TermChange[]; className?: string }) {
  const t = useTranslations("Portal.PM")
  const text = usePmTermText()
  if (!changes.length) return null
  return (
    <ul className={cn("space-y-1 text-sm", className)}>
      {changes.map((c) => (
        <li key={c.key} className="flex flex-wrap items-center gap-x-2">
          <span className="font-semibold">{t(`terms.${c.key}` as "terms.save")}:</span>
          <span className="text-muted-foreground line-through">{text(c.key, c.from)}</span>
          <ArrowRight size={13} className="rtl-flip shrink-0 text-muted-foreground" aria-label={t("amend.becomes")} />
          <span className="font-bold">{text(c.key, c.to)}</span>
        </li>
      ))}
    </ul>
  )
}
