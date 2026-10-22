"use client"

// «دعوات الموردين» under the waits (WF-23): one row per invitation to the platform with its state — أُرسلت · فُتحت · انضم · انتهت —
// and a link to the Suppliers tab, where they are resent, cancelled and opened.

import { useLocale, useTranslations } from "next-intl"
import { Send } from "lucide-react"
import { Link } from "@/i18n/routing"
import { fmtDay } from "@/lib/procurement/today-present"
import { SUPPLIERS_HREF, type InvitationRow } from "@/lib/procurement/today"

const CLIP = 5

export function TodayInvitations({ rows }: { rows: InvitationRow[] }) {
  const t = useTranslations("Portal.ProcToday")
  const locale = useLocale()
  const sentence = (row: InvitationRow): string => {
    const date = fmtDay(row.sentDay, locale)
    const channel = row.channel ? t(`invitations.channel.${row.channel}`) : ""
    if (row.state === "joined") return t(row.verified ? "invitations.state.joined_verified" : "invitations.state.joined")
    if (row.state === "opened") return t("invitations.state.opened", { date, channel, hasChannel: channel ? 1 : 0 })
    if (row.state === "expired") return t("invitations.state.expired", { date })
    if (row.state === "declined") return t("invitations.state.declined", { date })
    return t("invitations.state.sent", { date, channel, hasChannel: channel ? 1 : 0 })
  }
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border bg-card" data-testid="today-invitations">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3.5">
        <h2 className="flex items-center gap-2 text-base font-black text-foreground">
          <Send size={15} className="shrink-0 text-module" aria-hidden="true" />
          {t("invitations.title")}
        </h2>
        <Link href={SUPPLIERS_HREF} className="text-xs font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("invitations.link")}
        </Link>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t("invitations.empty")}</p>
      ) : (
        <ul className="divide-y">
          {rows.slice(0, CLIP).map((row) => (
            <li key={row.id} className="px-4 py-3">
              <p className="text-sm font-bold leading-snug text-foreground" dir="auto">
                {row.name}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                {sentence(row)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
