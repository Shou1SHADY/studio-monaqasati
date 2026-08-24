"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  Mail,
  MessageCircle,
  Send,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useUser } from "@/firebase"
import { buildWhatsAppLink, type GuestOfferChannel, type GuestOfferEvent } from "@/utils/guest-offer-workflow"

export interface GuestNotifyTarget {
  offerId: string
  supplierName: string
  rfqTitle: string
  event: GuestOfferEvent
  note?: string | null
  targetPrice?: string | null
}

interface GuestNotifyDialogProps {
  target: GuestNotifyTarget | null
  onClose: () => void
}

type LinkInfo = {
  url: string
  sharedChannel: GuestOfferChannel
  channel: GuestOfferChannel
  email: string | null
  phone: string | null
}

// A guest supplier has no account and no in-app notifications, so every step of
// the RFQ workflow has to leave the platform. This dialog carries the step out
// on the channel the RFQ was originally shared on — WhatsApp opens prefilled in
// the contractor's browser, email is sent by the platform — with the other
// channel always available as a fallback.
export function GuestNotifyDialog({ target, onClose }: GuestNotifyDialogProps) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const { toast } = useToast()
  const { user } = useUser()

  const [link, setLink] = useState<LinkInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadLink = useCallback(async () => {
    if (!user || !target) return
    setIsLoading(true)
    setLoadFailed(false)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/rfq-share/guest-link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ offerId: target.offerId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.error) throw new Error(json?.code || "FAILED")
      setLink(json.data as LinkInfo)
    } catch (err) {
      console.error("Failed to prepare guest supplier link:", err)
      setLoadFailed(true)
    } finally {
      setIsLoading(false)
    }
  }, [user, target])

  useEffect(() => {
    if (!target) return
    setLink(null)
    setEmailSent(false)
    setCopied(false)
    loadLink()
  }, [target, loadLink])

  const eventMessage = (() => {
    if (!target || !link) return ""
    const title = target.rfqTitle.length > 80 ? `${target.rfqTitle.slice(0, 80).trimEnd()}…` : target.rfqTitle
    let message = t(`guest_msg_${target.event}`, { title })
    if (target.targetPrice) {
      message += `\n${t("guest_msg_target_price", { price: target.targetPrice, currency: t("offers_currency_sar") })}`
    }
    if (target.note) message += `\n${t("guest_msg_note", { note: target.note })}`
    return `${message}\n${link.url}`
  })()

  const whatsappUrl = link ? buildWhatsAppLink(link.phone, eventMessage) : null

  // Records the outbound event; for WhatsApp the message itself leaves from the
  // contractor's own browser, so this is bookkeeping only.
  const recordEvent = async (channel: GuestOfferChannel) => {
    if (!user || !target) return { ok: false }
    const idToken = await user.getIdToken()
    const res = await fetch("/api/rfq-share/notify-guest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        offerId: target.offerId,
        event: target.event,
        channel,
        note: target.note || undefined,
        targetPrice: target.targetPrice || undefined,
      }),
    })
    const json = await res.json().catch(() => null)
    return { ok: res.ok && !json?.error, code: json?.code as string | undefined }
  }

  const handleWhatsApp = () => {
    if (!whatsappUrl) return
    window.open(whatsappUrl, "_blank", "noopener,noreferrer")
    recordEvent("whatsapp").catch(() => {})
    toast({ title: t("guest_notify_whatsapp_opened") })
  }

  const handleEmail = async () => {
    setIsSendingEmail(true)
    try {
      const result = await recordEvent("email")
      if (!result.ok) throw new Error(result.code || "FAILED")
      setEmailSent(true)
      toast({
        title: t("guest_notify_email_sent"),
        description: t("guest_notify_email_sent_desc", { email: link?.email || "" }),
      })
    } catch (err) {
      console.error("Failed to email guest supplier:", err)
      toast({ title: t("guest_notify_email_failed"), variant: "destructive" })
    } finally {
      setIsSendingEmail(false)
    }
  }

  const handleCopy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(`${eventMessage}`)
      setCopied(true)
      toast({ title: t("guest_notify_copied") })
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast({ title: t("rfq_share_copy_failed"), variant: "destructive" })
    }
  }

  // The channel the RFQ was shared on leads; the other stays one tap away.
  const whatsappFirst = link?.channel === "whatsapp"

  const whatsappButton = (
    <Button
      key="whatsapp"
      onClick={handleWhatsApp}
      disabled={!whatsappUrl}
      variant={whatsappFirst ? "default" : "outline"}
      className={cn(
        "w-full gap-2 h-11 rounded-xl font-bold transition-all",
        whatsappFirst
          ? "bg-[#25D366] hover:bg-[#20ba5a] text-white"
          : "border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600"
      )}
    >
      <MessageCircle size={15} />
      {t("guest_notify_whatsapp")}
      {whatsappFirst && (
        <span className="text-[10px] font-black bg-white/20 px-1.5 py-0.5 rounded-md">
          {t("guest_notify_original")}
        </span>
      )}
    </Button>
  )

  const emailButton = (
    <Button
      key="email"
      onClick={handleEmail}
      disabled={!link?.email || isSendingEmail || emailSent}
      variant={whatsappFirst ? "outline" : "default"}
      className={cn(
        "w-full gap-2 h-11 rounded-xl font-bold transition-all",
        whatsappFirst
          ? "border-slate-200 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
          : "bg-cta hover:bg-cta/90 text-white"
      )}
    >
      {isSendingEmail ? (
        <Loader2 size={15} className="animate-spin" />
      ) : emailSent ? (
        <Check size={15} />
      ) : (
        <Mail size={15} />
      )}
      {emailSent ? t("guest_notify_email_done") : t("guest_notify_email")}
      {!whatsappFirst && !emailSent && (
        <span className="text-[10px] font-black bg-white/20 px-1.5 py-0.5 rounded-md">
          {t("guest_notify_original")}
        </span>
      )}
    </Button>
  )

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-md rounded-2xl p-0 overflow-hidden gap-0"
        dir={locale === "ar" ? "rtl" : "ltr"}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{t("guest_notify_title")}</DialogTitle>

        <div className="px-5 pt-5 pb-4 border-b bg-gradient-to-bl from-accent/8 via-accent/3 to-white">
          <div className="flex items-start gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
              <Send size={16} className="text-accent" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-800">{t("guest_notify_title")}</h2>
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
                {target?.supplierName}
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed">{t("guest_notify_desc")}</p>

          {isLoading ? (
            <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground">
              <Loader2 size={20} className="animate-spin text-primary" />
              <span className="text-sm font-medium">{t("guest_notify_preparing")}</span>
            </div>
          ) : loadFailed ? (
            <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-xl text-center space-y-3">
              <AlertCircle size={22} className="text-destructive mx-auto" />
              <p className="text-sm text-slate-600">{t("guest_notify_failed")}</p>
              <Button variant="outline" size="sm" onClick={loadLink} className="rounded-lg">
                {t("rfq_share_retry")}
              </Button>
            </div>
          ) : link ? (
            <>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                  {t("guest_notify_preview")}
                </p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line break-words" dir="auto">
                  {eventMessage}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {whatsappFirst ? [whatsappButton, emailButton] : [emailButton, whatsappButton]}
              </div>

              {!link.phone && (
                <p className="text-[11px] text-muted-foreground leading-relaxed flex items-center gap-1.5">
                  <AlertCircle size={12} className="shrink-0" />
                  {t("guest_notify_no_phone")}
                </p>
              )}
              {!link.email && (
                <p className="text-[11px] text-muted-foreground leading-relaxed flex items-center gap-1.5">
                  <AlertCircle size={12} className="shrink-0" />
                  {t("guest_notify_no_email")}
                </p>
              )}

              <Button
                variant="ghost"
                onClick={handleCopy}
                className="w-full h-10 rounded-xl gap-2 text-slate-600"
              >
                {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                {t("guest_notify_copy")}
              </Button>
            </>
          ) : null}
        </div>

        <div className="px-5 py-4 border-t bg-slate-50/50">
          <Button variant="outline" className="w-full h-10 rounded-xl" onClick={onClose}>
            {t("rfq_share_close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
