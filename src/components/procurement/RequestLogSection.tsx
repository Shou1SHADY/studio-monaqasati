"use client"

// «السجل» in the request's panel (Procurement 2.0, NFR-05 — the prototype's «السجل» in the panel footer): what happened to the
// request, newest first — the day, who, the act and the material it was about. Read from the stored request; folded by default.

import { useLocale, useTranslations } from "next-intl"
import { History } from "lucide-react"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { fmtDay } from "@/components/procurement/need-bits"
import { requestLogRows } from "@/lib/procurement/request-log"
import type { IncomingDoc } from "@/lib/procurement/incoming-state"

export function RequestLogSection({ doc, defaultOpen = false }: { doc: Pick<IncomingDoc, "log" | "lines"> | null | undefined; defaultOpen?: boolean }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const rows = requestLogRows(doc)
  return (
    <DrawerSection
      title={
        <span className="inline-flex items-center gap-1.5">
          <History size={14} className="text-module" aria-hidden="true" />
          {t("rq_log")}
        </span>
      }
      count={rows.length}
      defaultOpen={defaultOpen}
    >
      {rows.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">{t("rq_log_empty")}</p>
      ) : (
        <ol className="divide-y divide-border/60" data-testid="request-log">
          {rows.map((r, i) => (
            <li key={`${r.at}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2 text-xs">
              <span className="shrink-0 tabular-nums text-muted-foreground">{r.at ? fmtDay(r.at.slice(0, 10), locale) : "—"}</span>
              <b className="text-foreground" dir="auto">
                {r.by || "—"}
              </b>
              <span className="text-foreground" dir="auto">
                {r.act === "other" ? t("rq_log_act_other", { act: r.raw }) : t(`rq_log_act_${r.act}`, { note: r.note })}
              </span>
              {r.line && (
                <span className="text-muted-foreground" dir="auto">
                  · {r.line}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </DrawerSection>
  )
}
