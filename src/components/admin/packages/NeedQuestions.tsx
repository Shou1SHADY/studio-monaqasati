"use client"

import { useTranslations } from "next-intl"
import { CONNECTORS, type Connector } from "@/lib/procurement/package"
import { cn } from "@/lib/utils"

export type NeedAnswers = Partial<Record<Connector, 0 | 1 | null>>

/** One question per connector. The answer suggests a package; the decision stays with the admin. */
export function NeedQuestions({ answers, onAnswer, disabled }: { answers: NeedAnswers; onAnswer: (conn: Connector, value: 0 | 1) => void; disabled?: boolean }) {
  const t = useTranslations("Portal.AdminPackages.detail.needs")
  const tp = useTranslations("Portal.ProcPackage")
  return (
    <div className="space-y-3">
      {CONNECTORS.map((conn) => (
        <div key={conn} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <div className="min-w-0 flex-1 basis-56">
            <b className="block text-sm">{tp(`conn.${conn}.question`)}</b>
            <span className="text-xs text-muted-foreground">{t("suggests", { name: tp(`conn.${conn}.name`) })}</span>
          </div>
          <div role="group" aria-label={tp(`conn.${conn}.name`)} className="inline-flex overflow-hidden rounded-lg border">
            {([1, 0] as const).map((value) => (
              <button
                key={value}
                type="button"
                disabled={disabled}
                aria-pressed={answers[conn] === value}
                onClick={() => onAnswer(conn, value)}
                className={cn(
                  "min-h-9 px-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  answers[conn] === value ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                {t(value === 1 ? "yes" : "no")}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
