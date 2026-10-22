"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertCircle, Check, Clock, Copy, Eye, FileDown, Link2, Loader2, Mail, MessageCircle } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Chip } from "@/components/module-ui/Chip"
import { Callout } from "@/components/module-ui/Callout"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { shareErrorKey } from "@/lib/rfq-share-errors"
import { guestInvitesNewestFirst, type GuestInvite } from "@/lib/procurement/guest-supplier"
import { buildLinkMessage, mailHref, whatsappHref } from "@/lib/procurement/link-messages"
import { bareNumber } from "@/lib/supplier-free/derive"
import { placeText } from "@/components/procurement/guest/link-format"
import type { LinkRfqView } from "@/lib/procurement/rfq-share-view"
import type { LinkStats } from "@/lib/procurement/link-views"

type Channel = "wa" | "mail"

interface PreviewInfo {
  rfq: LinkRfqView
  contractorName: string
  stats: LinkStats
}

const DAY_MS = 86_400_000

// The one place a buyer hands a request to a supplier outside the platform (LNK-12): the link — copy it — and the message that
// goes with it, SHOWN before it goes: the WhatsApp bubble or the e-mail. «افتح واتساب» / «افتح البريد» open the buyer's own app
// on his own device with the text ready; the platform integrates with nothing and sends nothing (B-08). The count of opens is
// here too, and it never includes his own preview.
export function LinkComposer({ rfq, isOpen, onClose, onPrint }: { rfq: { id: string; title?: string } | null; isOpen: boolean; onClose: () => void; onPrint?: (() => void) | null }) {
  const t = useTranslations("Portal.Contractor")
  const tr = useTranslations("Portal.Procurement.rfqextras.share")
  const tl = useTranslations("Portal.Procurement.linkx")
  const locale = useLocale()
  const lang = locale === "en" ? "en" : "ar"
  const { toast } = useToast()
  const { user } = useUser()

  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)
  const [byDeadline, setByDeadline] = useState(false)
  const [invites, setInvites] = useState<GuestInvite[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [channel, setChannel] = useState<Channel>("wa")
  const [info, setInfo] = useState<PreviewInfo | null>(null)

  const take = useCallback((d: { expiresAt?: string | null; invites?: GuestInvite[]; closed?: boolean; validity?: string }) => {
    if (d.expiresAt) setExpiresAt(d.expiresAt)
    if (Array.isArray(d.invites)) setInvites(guestInvitesNewestFirst(d.invites))
    if (typeof d.closed === "boolean") setClosed(d.closed)
    if (d.validity) setByDeadline(d.validity === "deadline")
  }, [])

  const authed = useCallback(
    async (path: string, body?: unknown) => {
      const idToken = await user!.getIdToken()
      return fetch(path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${idToken}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined })
    },
    [user]
  )

  const generate = useCallback(async () => {
    if (!user || !rfq) return
    setBusy(true)
    setError(null)
    try {
      const res = await authed("/api/rfq-share/create", { rfqId: rfq.id })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.error) throw new Error(json?.code || "FAILED")
      setShareUrl(json.data.url as string)
      take(json.data)
      const pv = await authed(`/api/rfq-share/preview?rfqId=${encodeURIComponent(rfq.id)}`)
      const pj = await pv.json().catch(() => null)
      if (pv.ok && pj?.success) setInfo({ rfq: pj.data.rfq, contractorName: pj.data.contractorName, stats: pj.data.stats })
    } catch (err) {
      setError(err instanceof Error ? err.message : "FAILED")
    } finally {
      setBusy(false)
    }
  }, [user, rfq, authed, take])

  useEffect(() => {
    if (isOpen && rfq) {
      setShareUrl(null)
      setExpiresAt(null)
      setCopied(false)
      setInvites([])
      setClosed(false)
      setInfo(null)
      void generate()
    }
  }, [isOpen, rfq, generate])

  // The channel picked is remembered on the link: what follows in the request (a better price, the award) can reach the supplier on it.
  const recordChannel = async (c: "whatsapp" | "email" | "link") => {
    if (!user || !rfq) return
    try {
      const res = await authed("/api/rfq-share/create", { rfqId: rfq.id, channel: c })
      const json = await res.json().catch(() => null)
      if (json?.data) take(json.data)
    } catch (err) {
      console.error("Failed to record share channel:", err)
    }
  }

  const message = useMemo(() => {
    if (!shareUrl) return null
    const view = info?.rfq
    return buildLinkMessage({
      company: info?.contractorName || "",
      title: view?.title || rfq?.title || "",
      materials: view?.lines.length ?? 0,
      places: (view?.places ?? []).map((p) => placeText(p, lang)),
      closeDay: view?.closeDay ?? null,
      url: shareUrl,
      locale: lang,
    })
  }, [shareUrl, info, rfq, lang])

  const copy = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      toast({ title: t("rfq_share_copied") })
      setTimeout(() => setCopied(false), 2500)
      void recordChannel("link")
    } catch {
      toast({ title: t("rfq_share_copy_failed"), variant: "destructive" })
    }
  }

  const open = (href: string, c: "whatsapp" | "email") => {
    window.open(href, "_blank", "noopener,noreferrer")
    void recordChannel(c)
  }

  const stats = info?.stats
  const number = info?.rfq.number ? bareNumber(info.rfq.number) : ""
  const closeText = info?.rfq.closeDay ? new Date(`${info.rfq.closeDay}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: "UTC" }) : ""

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-md" dir={locale === "ar" ? "rtl" : "ltr"} aria-describedby={undefined}>
        <DialogTitle className="sr-only">{t("rfq_share_title")}</DialogTitle>
        <div className="border-b bg-gradient-to-bl from-accent/10 via-accent/5 to-background px-5 pb-4 pt-5">
          <div className="flex items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent" aria-hidden="true">
              <Link2 size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-black text-foreground">{t("rfq_share_title")}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{tr("sub")}</p>
            </div>
          </div>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-5">
          {busy ? (
            <div className="flex items-center justify-center gap-3 py-10 text-muted-foreground" role="status">
              <Loader2 size={20} className="animate-spin text-primary" aria-hidden="true" />
              <span className="text-sm font-medium">{t("rfq_share_generating")}</span>
            </div>
          ) : error ? (
            <div className="space-y-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-center">
              <AlertCircle size={22} className="mx-auto text-destructive" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{t(shareErrorKey(error))}</p>
              <Button variant="outline" size="sm" onClick={() => void generate()}>
                {t("rfq_share_retry")}
              </Button>
            </div>
          ) : shareUrl && message ? (
            <>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input readOnly value={shareUrl} dir="ltr" onFocus={(e) => e.target.select()} className="h-11 bg-muted/40 text-start font-mono text-xs" aria-label={t("rfq_share_title")} />
                  <Button onClick={() => void copy()} className={cn("h-11 w-11 shrink-0 p-0", copied && "bg-success hover:bg-success/90")} aria-label={t("rfq_share_copy")}>
                    {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  </Button>
                </div>
                {closed ? (
                  <Callout tone="block">{tr("closed")}</Callout>
                ) : byDeadline && expiresAt ? (
                  <p className="flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-foreground" suppressHydrationWarning>
                    <Clock size={12} aria-hidden="true" />
                    {tr("valid_until_deadline", { date: new Date(expiresAt).toLocaleDateString(locale), days: Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / DAY_MS)) })}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2.5 rounded-xl border bg-muted/20 p-3.5">
                <div>
                  <p className="text-sm font-bold text-foreground">{tl("msg_title")}</p>
                  <p className="text-xs text-muted-foreground">{tl("msg_sub", { no: number })}</p>
                </div>
                <div className="flex gap-2" role="group" aria-label={tl("msg_title")}>
                  <Chip selected={channel === "wa"} icon={MessageCircle} onClick={() => setChannel("wa")}>
                    {tl("ch_wa")}
                  </Chip>
                  <Chip selected={channel === "mail"} icon={Mail} onClick={() => setChannel("mail")}>
                    {tl("ch_mail")}
                  </Chip>
                </div>
                {channel === "wa" ? (
                  <div className="rounded-xl bg-success/10 p-2.5" data-preview="wa">
                    <div className="space-y-1.5 rounded-lg bg-background p-2.5 shadow-sm">
                      <div className="flex items-start gap-2 border-s-4 border-primary bg-muted/50 p-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-black text-primary-foreground" aria-hidden="true">
                          {lang === "ar" ? "م" : "M"}
                        </span>
                        <div className="min-w-0 text-xs">
                          <b className="block truncate" dir="auto">
                            {tl("wa_preview_title", { company: info?.contractorName || "" })}
                          </b>
                          <span className="block truncate text-muted-foreground" dir="auto">
                            {tl("wa_preview_meta", { title: info?.rfq.title || "", date: closeText })}
                          </span>
                          <small className="text-muted-foreground" dir="ltr">
                            mdmaktech.sa
                          </small>
                        </div>
                      </div>
                      <p className="whitespace-pre-line break-words text-xs leading-relaxed text-foreground" dir="auto">
                        {message.text}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg border bg-background p-2.5 text-xs" data-preview="mail">
                    <p className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{tl("mail_to")}</span>
                      <b>{tl("mail_to_value")}</b>
                    </p>
                    <p className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{tl("mail_subject")}</span>
                      <b className="truncate" dir="auto">
                        {message.subject}
                      </b>
                    </p>
                    <p className="whitespace-pre-line break-words border-t pt-2 leading-relaxed" dir="auto">
                      {message.text}
                    </p>
                  </div>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">{channel === "wa" ? tl("hint_wa") : tl("hint_mail")}</p>
                <div className="flex flex-wrap gap-2">
                  {channel === "wa" ? (
                    <Button type="button" className="min-h-11 gap-1.5" onClick={() => open(whatsappHref(message.text), "whatsapp")}>
                      <MessageCircle size={15} aria-hidden="true" />
                      {tl("open_wa")}
                    </Button>
                  ) : (
                    <Button type="button" className="min-h-11 gap-1.5" onClick={() => open(mailHref(message.subject, message.text), "email")}>
                      <Mail size={15} aria-hidden="true" />
                      {tl("open_mail")}
                    </Button>
                  )}
                  <Button asChild type="button" variant="outline" className="min-h-11 gap-1.5">
                    <Link href={`/contractor/rfqs/${rfq?.id}/preview/link`}>
                      <Eye size={15} aria-hidden="true" />
                      {tl("open_as")}
                    </Link>
                  </Button>
                </div>
              </div>

              {stats && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-views>
                  <Eye size={13} aria-hidden="true" />
                  <b className="text-foreground">{stats.views === 0 ? tl("views_none") : stats.views === 1 ? tl("views_one") : tl("views", { count: stats.views })}</b>
                  <span>{tl("views_note")}</span>
                </p>
              )}

              {invites.length > 0 && (
                <div className="space-y-1.5 border-t pt-3">
                  <p className="text-xs font-bold text-muted-foreground">{tr("invites_title")}</p>
                  <ul className="divide-y rounded-xl border text-xs">
                    {invites.map((x, i) => (
                      <li key={`${x.at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 truncate font-semibold" dir={x.to ? "ltr" : "auto"}>
                          {x.to || tr(`via_${x.channel}`)}
                        </span>
                        <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                          {tr(`channel_${x.channel}`)} · {new Date(x.at).toLocaleDateString(locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {onPrint && (
                <Button type="button" variant="outline" size="sm" onClick={onPrint} className="gap-1.5">
                  <FileDown size={14} aria-hidden="true" />
                  {tr("pdf")}
                </Button>
              )}
            </>
          ) : null}
        </div>

        <div className="border-t bg-muted/30 px-5 py-4">
          <Button variant="outline" className="h-10 w-full rounded-xl" onClick={onClose}>
            {t("rfq_share_close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
