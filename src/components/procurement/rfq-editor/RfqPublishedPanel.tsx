"use client"

// After «انشر» (PUR-03 p.2): the RFQ's number, who it reached and when it closes, and
// the guest link in one place — copy, WhatsApp, e-mail — for a supplier outside the
// platform. Inviting a supplier to the platform itself is a different act (PUR-05).

import { useState } from "react"
import { useTranslations } from "next-intl"
import { CheckCircle2, Copy, Mail, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"

export function RfqPublishedPanel({
  number,
  reached,
  closesOn,
  guestUrl,
  title,
  openHref,
  onNew,
  direct,
}: {
  number: string
  reached: number | null
  closesOn: string | null
  guestUrl: string | null
  title: string
  openHref: string
  onNew: () => void
  direct?: boolean
}) {
  const t = useTranslations("Portal.ProcEditor")
  const [copied, setCopied] = useState(false)
  const message = guestUrl ? t("share_message", { title, url: guestUrl }) : ""
  return (
    <section className="mx-auto max-w-xl space-y-5 rounded-2xl border bg-card p-6 text-center" aria-live="polite">
      <CheckCircle2 size={40} className="mx-auto text-success" aria-hidden="true" />
      <div>
        <h2 className="text-xl font-black">{direct ? t("done_direct", { number }) : t("done_title", { number })}</h2>
        {!direct && <p className="mt-1 text-sm text-muted-foreground">{closesOn ? t("done_sub", { count: reached ?? 0, date: closesOn }) : t("done_sub_nodate", { count: reached ?? 0 })}</p>}
      </div>
      {guestUrl && (
        <div className="space-y-2 rounded-xl border bg-muted/40 p-4 text-start">
          <p className="text-sm font-bold">{t("guest_link")}</p>
          <p className="truncate rounded-md bg-background px-3 py-2 font-mono text-xs" dir="ltr">
            {guestUrl}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                void navigator.clipboard?.writeText(guestUrl)
                setCopied(true)
              }}
            >
              <Copy size={14} /> {copied ? t("copied") : t("copy")}
            </Button>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                <MessageCircle size={14} /> {t("whatsapp")}
              </a>
            </Button>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <a href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(message)}`}>
                <Mail size={14} /> {t("email")}
              </a>
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("guest_hint")}</p>
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href={openHref}>{t("open_rfq")}</Link>
        </Button>
        <Button type="button" variant="outline" onClick={onNew}>
          {t("new_rfq")}
        </Button>
      </div>
    </section>
  )
}
