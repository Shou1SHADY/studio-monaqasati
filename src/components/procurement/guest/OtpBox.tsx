"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// The code on his mobile (R-05): sent BEFORE the first send, entered once, and the session it buys covers every later act on
// this link — so the same box serves «أرسل عرضك» and «أرني نتيجة عرضي». The platform never sends it by itself; he asked.
export function OtpBox({ phoneMasked, testCode, busy, error, onVerify, onResend, verifyLabel }: { phoneMasked: string; testCode?: string | null; busy: boolean; error: string | null; onVerify: (code: string) => void; onResend: () => void; verifyLabel?: string }) {
  const t = useTranslations("PublicRfq")
  const [code, setCode] = useState("")
  return (
    <section className="space-y-2.5 rounded-md border border-primary/30 bg-primary/5 p-3.5" aria-live="polite">
      <p className="text-sm font-bold text-foreground">{t("otp_title", { phone: phoneMasked })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          dir="ltr"
          aria-label={t("otp_title", { phone: phoneMasked })}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="••••••"
          className="h-11 w-36 text-center font-mono text-lg"
        />
        <Button type="button" disabled={busy || code.length !== 6} onClick={() => onVerify(code)} className="min-h-11 gap-1.5">
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
          {verifyLabel ?? t("otp_btn")}
        </Button>
        <button type="button" onClick={onResend} disabled={busy} className="text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("otp_resend")}
        </button>
      </div>
      {testCode && <p className="text-[11px] font-semibold text-warning">{t("otp_test", { code: testCode })}</p>}
      <p className="text-[11px] text-muted-foreground">{t("otp_hint")}</p>
      {error && (
        <p className="text-xs font-semibold text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
