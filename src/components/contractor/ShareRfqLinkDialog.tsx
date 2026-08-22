"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Link2,
  Copy,
  Check,
  Loader2,
  Mail,
  Send,
  Clock,
  MessageCircle,
  AlertCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useUser } from "@/firebase"

interface ShareRfqLinkDialogProps {
  rfq: { id: string; title?: string } | null
  isOpen: boolean
  onClose: () => void
}

// Generates a portable 3-day guest link for an RFQ so a supplier can view it
// and submit an offer without registering, then offers one-tap sharing via
// copy / Gmail / WhatsApp or a direct branded email from the platform.
export function ShareRfqLinkDialog({ rfq, isOpen, onClose }: ShareRfqLinkDialogProps) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const { toast } = useToast()
  const { user } = useUser()

  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState(false)
  const [copied, setCopied] = useState(false)
  const [emailTo, setEmailTo] = useState("")
  const [isSendingEmail, setIsSendingEmail] = useState(false)

  const generateLink = useCallback(async () => {
    if (!user || !rfq) return
    setIsGenerating(true)
    setGenerateError(false)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/rfq-share/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ rfqId: rfq.id }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.error) throw new Error(json?.code || "FAILED")
      setShareUrl(json.data.url as string)
      setExpiresAt(json.data.expiresAt as string)
    } catch (err) {
      console.error("Failed to generate share link:", err)
      setGenerateError(true)
    } finally {
      setIsGenerating(false)
    }
  }, [user, rfq])

  useEffect(() => {
    if (isOpen && rfq) {
      setShareUrl(null)
      setExpiresAt(null)
      setCopied(false)
      setEmailTo("")
      generateLink()
    }
  }, [isOpen, rfq, generateLink])

  const handleCopy = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      toast({ title: t("rfq_share_copied") })
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast({ title: t("rfq_share_copy_failed"), variant: "destructive" })
    }
  }

  const shareMessage = shareUrl && rfq
    ? t("rfq_share_message", {
        title: rfq.title || "",
        url: shareUrl,
        date: expiresAt ? new Date(expiresAt).toLocaleDateString(locale) : "",
      })
    : ""

  const gmailUrl = shareUrl
    ? `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(t("rfq_share_email_subject", { title: rfq?.title || "" }))}&body=${encodeURIComponent(shareMessage)}`
    : "#"
  const whatsappUrl = shareUrl ? `https://wa.me/?text=${encodeURIComponent(shareMessage)}` : "#"

  const handleSendEmail = async () => {
    if (!user || !rfq || !emailTo.trim()) return
    setIsSendingEmail(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/rfq-share/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ rfqId: rfq.id, email: emailTo.trim() }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.error || !json?.data?.emailSent) throw new Error(json?.code || "FAILED")
      toast({ title: t("rfq_share_email_sent"), description: t("rfq_share_email_sent_desc", { email: emailTo.trim() }) })
      setEmailTo("")
    } catch (err) {
      console.error("Failed to send share email:", err)
      toast({ title: t("rfq_share_email_failed"), variant: "destructive" })
    } finally {
      setIsSendingEmail(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-md rounded-2xl p-0 overflow-hidden gap-0"
        dir={locale === "ar" ? "rtl" : "ltr"}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{t("rfq_share_title")}</DialogTitle>

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b bg-gradient-to-bl from-accent/8 via-accent/3 to-white">
          <div className="flex items-start gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
              <Link2 size={16} className="text-accent" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-800">{t("rfq_share_title")}</h2>
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{rfq?.title}</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed">{t("rfq_share_desc")}</p>

          {isGenerating ? (
            <div className="flex items-center justify-center gap-3 py-10 text-muted-foreground">
              <Loader2 size={20} className="animate-spin text-primary" />
              <span className="text-sm font-medium">{t("rfq_share_generating")}</span>
            </div>
          ) : generateError ? (
            <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-xl text-center space-y-3">
              <AlertCircle size={22} className="text-destructive mx-auto" />
              <p className="text-sm text-slate-600">{t("rfq_share_generate_failed")}</p>
              <Button variant="outline" size="sm" onClick={generateLink} className="rounded-lg">
                {t("rfq_share_retry")}
              </Button>
            </div>
          ) : shareUrl ? (
            <>
              {/* The link + copy */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={shareUrl}
                    dir="ltr"
                    onFocus={(e) => e.target.select()}
                    className="h-11 rounded-xl bg-slate-50 border-slate-200 text-xs font-mono text-slate-600 text-left"
                    aria-label={t("rfq_share_title")}
                  />
                  <Button
                    onClick={handleCopy}
                    className={cn(
                      "h-11 w-11 rounded-xl shrink-0 p-0 transition-all",
                      copied ? "bg-success hover:bg-success/90" : ""
                    )}
                    aria-label={t("rfq_share_copy")}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </Button>
                </div>
                {expiresAt && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 font-semibold" suppressHydrationWarning>
                    <Clock size={12} />
                    {t("rfq_share_expires", { date: new Date(expiresAt).toLocaleDateString(locale) })}
                  </div>
                )}
              </div>

              {/* One-tap share targets */}
              <div className="grid grid-cols-2 gap-2">
                <a href={gmailUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" className="w-full gap-2 h-11 rounded-xl border-slate-200 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-all font-bold">
                    <Mail size={15} />
                    Gmail
                  </Button>
                </a>
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" className="w-full gap-2 h-11 rounded-xl border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600 transition-all font-bold">
                    <MessageCircle size={15} />
                    WhatsApp
                  </Button>
                </a>
              </div>

              {/* Direct branded email from the platform */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <Label htmlFor="share-email" className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  {t("rfq_share_email_label")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="share-email"
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && emailTo.trim() && !isSendingEmail) handleSendEmail() }}
                    placeholder="supplier@company.com"
                    dir="ltr"
                    className="h-11 rounded-xl border-slate-200 text-left"
                  />
                  <Button
                    onClick={handleSendEmail}
                    disabled={!emailTo.trim() || isSendingEmail}
                    className="h-11 w-11 rounded-xl shrink-0 p-0"
                    aria-label={t("rfq_share_email_send")}
                  >
                    {isSendingEmail ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{t("rfq_share_email_help")}</p>
              </div>
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
