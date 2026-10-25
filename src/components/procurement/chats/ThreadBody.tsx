"use client"

// The order's conversation as it is drawn — in the drawer, in «محادثاتي», in the supplier's portal and on the order link (prototype
// `msgHTML`): what people wrote as bubbles ("you" on one side), what happened to the order as small system lines. One component for
// all four, so a line reads the same wherever it is seen. All text is read from `Portal.ProcChats`.

import { useLocale, useTranslations } from "next-intl"
import { Check, FileText } from "lucide-react"
import { fmtDayLong } from "@/lib/procurement/format"
import type { PoFact, ThreadItem } from "@/lib/procurement/po-messages"
import { cn } from "@/lib/utils"

export type ThreadSide = "buyer" | "supplier"

type T = ReturnType<typeof useTranslations>

/** One fact of the order in words; `no` is the number as this reader reads it. */
export function factText(t: T, f: PoFact, no: string, locale: string): string {
  const date = fmtDayLong(String(f.params.date || ""), locale, false)
  switch (f.kind) {
    case "sent_portal":
    case "sent_whatsapp":
    case "sent_email":
    case "sent_outside":
      return t(`sys.${f.kind}`, { no })
    case "accepted":
      return t("sys.accepted")
    case "accepted_for":
      return t("sys.accepted_for", { name: String(f.params.name || "") })
    case "declined":
      return t("sys.declined", { reason: String(f.params.reason || "") })
    case "reported":
      if (f.params.by) return t(f.params.note ? "sys.reported_for_note" : "sys.reported_for", { date, note: String(f.params.note || ""), name: String(f.params.by) })
      return t(f.params.note ? "sys.reported_note" : "sys.reported", { date, note: String(f.params.note || "") })
    case "receipt":
      return t("sys.receipt", { no: String(f.params.no || "") })
    case "date":
      return t("sys.date", { date })
    case "closed":
      return t(f.params.reason ? "sys.closed_reason" : "sys.closed", { reason: String(f.params.reason || "") })
    case "cancelled":
      return t(f.params.reason ? "sys.cancelled_reason" : "sys.cancelled", { reason: String(f.params.reason || "") })
  }
}

const rel = (iso: string, locale: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

export function ThreadBody({ items, side, no, supplierName, company, offPlatform = false, className }: { items: ThreadItem[]; side: ThreadSide; no: string; supplierName: string; company: string; offPlatform?: boolean; className?: string }) {
  const t = useTranslations("Portal.ProcChats")
  const locale = useLocale()
  return (
    <ol className={cn("space-y-2", className)} aria-label={t("thread_label")}>
      {items.map((item, i) => {
        if (item.sys) {
          return (
            <li key={`f${item.kind}${item.at}${i}`} className="flex justify-center">
              <span className="inline-flex max-w-full items-start gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground" dir="auto">
                <Check size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {factText(t, item, no, locale)} · {rel(item.at, locale)}
                </span>
              </span>
            </li>
          )
        }
        const m = item.message
        const mine = side === "buyer" ? m.by === "us" : m.by === "sup"
        const who = mine ? t("you") : side === "buyer" ? supplierName : company || t("buyer")
        return (
          <li key={m.id} className={cn("flex flex-col gap-0.5", mine ? "items-end" : "items-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", mine ? "bg-module/10 text-foreground" : "bg-muted text-foreground", m.kind === "change" && "ring-1 ring-warning/50")}>
              {m.text && (
                <p className="whitespace-pre-wrap break-words" dir="auto">
                  {m.text}
                </p>
              )}
              {m.file && (
                <a href={m.file.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-module underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <FileText size={12} aria-hidden="true" />
                  <span dir="auto">{m.file.name || t("file")}</span>
                </a>
              )}
            </div>
            <small className="px-1 text-[10px] text-muted-foreground">
              {who} · {rel(m.at, locale)}
              {side === "buyer" && offPlatform ? ` · ${t(m.by === "us" ? "via_whatsapp" : "via_link")}` : ""}
            </small>
          </li>
        )
      })}
    </ol>
  )
}
