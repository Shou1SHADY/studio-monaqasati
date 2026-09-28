"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { KeyRound, Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { normalizeGuestMobile } from "@/lib/procurement/guest-supplier"
import { cn } from "@/lib/utils"

export interface GuestOtpValue {
  challengeId: string
  code: string
}

const RESEND_SECONDS = 60

// «يُوثَّق برمز تحقق»: the guest asks for a code on the mobile he typed and
// enters it; the offer route checks it when the offer is submitted. A new
// number needs a new code (the code is bound to the number).
export function GuestOtpField({ token, phone, onChange, invalid }: { token: string; phone: string; onChange: (v: GuestOtpValue | null) => void; invalid?: boolean }) {
  const t = useTranslations("PublicRfq.extras")
  const locale = useLocale()
  const [challenge, setChallenge] = useState<{ id: string; phone: string; masked: string; testCode: string | null } | null>(null)
  const [code, setCode] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState(0)

  const normalized = normalizeGuestMobile(phone)
  const stale = Boolean(challenge && normalized !== challenge.phone)

  useEffect(() => {
    if (wait <= 0) return
    const id = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])

  useEffect(() => {
    onChange(challenge && !stale && /^\d{6}$/.test(code) ? { challengeId: challenge.id, code } : null)
  }, [challenge, code, stale, onChange])

  const send = async () => {
    if (!normalized) {
      setError(t("otp_err_phone"))
      return
    }
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/rfq-share/${token}/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, locale: locale === "en" ? "en" : "ar" }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.error) {
        const c = json?.code as string | undefined
        setError(c === "TOO_SOON" ? t("otp_err_too_soon") : c === "LINK_OTP_LIMIT" ? t("otp_err_limit") : c === "INVALID_PHONE" ? t("otp_err_phone") : c === "RFQ_CLOSED" ? t("otp_err_closed") : t("otp_err_send"))
        if (c === "TOO_SOON") setWait(RESEND_SECONDS)
        return
      }
      if (json?.data?.required === false) {
        setChallenge(null)
        return
      }
      setChallenge({ id: json.data.challengeId as string, phone: normalized, masked: json.data.phoneMasked as string, testCode: (json.data.testCode as string | undefined) ?? null })
      setCode("")
      setWait(RESEND_SECONDS)
    } catch {
      setError(t("otp_err_send"))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={cn("space-y-2 rounded-xl border p-3", invalid && !challenge ? "border-destructive" : "border-primary/15 bg-primary/5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <ShieldCheck size={13} className="text-primary" aria-hidden="true" />
          {t("otp_hint")}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={send} disabled={sending || wait > 0 || !phone.trim()} className="h-8 gap-1.5 rounded-lg text-xs">
          {sending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <KeyRound size={13} aria-hidden="true" />}
          {wait > 0 ? t("otp_resend_in", { seconds: wait }) : challenge ? t("otp_resend") : t("otp_send")}
        </Button>
      </div>
      {challenge && !stale && (
        <div className="space-y-1.5">
          <Label htmlFor="guest-otp-code" className="text-xs">
            {t("otp_sent_to", { phone: challenge.masked })}
          </Label>
          <Input
            id="guest-otp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
            className="h-11 w-40 rounded-xl text-center font-mono text-lg"
          />
          {challenge.testCode && <p className="text-[11px] font-semibold text-warning">{t("otp_test_code", { code: challenge.testCode })}</p>}
        </div>
      )}
      {stale && <p className="text-[11px] text-warning">{t("otp_number_changed")}</p>}
      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
