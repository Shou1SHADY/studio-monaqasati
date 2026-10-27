"use client"

// Create a free supplier account, or come back to it, with a mobile and a code (PRD LNK-02, WF-18). Nobody types
// a password. A number with no account asks for a name and a company in the same step and the earlier guest offers
// made with that number are added to the new account.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { signInWithCustomToken } from "firebase/auth"
import { Loader2, Smartphone } from "lucide-react"
import { useAuth } from "@/firebase"
import { useRouter } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface Challenge {
  id: string
  masked: string
  testCode?: string
}

/** Server refusal codes → the words the supplier reads (shared with the Security tab's code-confirmed changes). */
export const ERRORS: Record<string, string> = {
  INVALID_PHONE: "phErrPhone",
  INVALID_INPUT: "phErrInput",
  TOO_SOON: "phErrSoon",
  PHONE_OTP_LIMIT: "phErrLimit",
  SMS_UNAVAILABLE: "phErrSms",
  OTP_WRONG: "phErrWrong",
  OTP_EXPIRED: "phErrExpired",
  OTP_EXHAUSTED: "phErrExhausted",
  OTP_USED: "phErrUsed",
  OTP_MISSING: "phErrMissing",
  OTP_MISMATCH: "phErrMissing",
  OTP_UNAVAILABLE: "phErrSms",
  WRONG_ROLE: "phErrRole",
  SAME_PHONE: "phErrSame",
  PHONE_TAKEN: "phErrTaken",
  INVALID_CR: "phErrCr",
}

async function post<T>(url: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; code: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; code?: string } | null
    if (res.ok && json?.success && json.data) return { ok: true, data: json.data }
    return { ok: false, code: json?.code || "INTERNAL" }
  } catch {
    return { ok: false, code: "INTERNAL" }
  }
}

export function PhoneSignInDialog({ open, onOpenChange, mode, initialPhone, source }: { open: boolean; onOpenChange: (open: boolean) => void; mode: "signup" | "signin"; initialPhone?: string; source?: "self" }) {
  const t = useTranslations("SupplierFree")
  const locale = useLocale()
  const auth = useAuth()
  const router = useRouter()
  const [phone, setPhone] = useState(initialPhone ?? "")
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [code, setCode] = useState("")
  const [needsProfile, setNeedsProfile] = useState(false)
  const [name, setName] = useState("")
  const [company, setCompany] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fail = (c: string) => setError(t((ERRORS[c] || "phErrGeneric") as "phErrGeneric"))

  const sendCode = async () => {
    setBusy(true)
    setError(null)
    const r = await post<{ challengeId: string; phoneMasked: string; testCode?: string }>("/api/supplier-free/phone/code", { phone, locale })
    setBusy(false)
    if (!r.ok) return fail(r.code)
    setChallenge({ id: r.data.challengeId, masked: r.data.phoneMasked, testCode: r.data.testCode })
    setCode("")
    setNeedsProfile(false)
  }

  const verify = async () => {
    if (!challenge || !auth) return
    setBusy(true)
    setError(null)
    const r = await post<{ needsProfile?: boolean; token?: string }>("/api/supplier-free/phone/verify", { challengeId: challenge.id, phone, code, name, company, source })
    if (!r.ok) {
      setBusy(false)
      return fail(r.code)
    }
    if (r.data.needsProfile || !r.data.token) {
      setBusy(false)
      setNeedsProfile(true)
      return
    }
    try {
      await signInWithCustomToken(auth, r.data.token)
      router.push("/supplier")
    } catch {
      setBusy(false)
      fail("INTERNAL")
    }
  }

  const reset = () => {
    setChallenge(null)
    setCode("")
    setNeedsProfile(false)
    setError(null)
  }

  const canVerify = code.trim().length >= 4 && (!needsProfile || (name.trim().length >= 2 && company.trim().length >= 2))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone size={18} className="text-cta" aria-hidden="true" />
            {t(mode === "signup" ? "phTitleUp" : "phTitleIn")}
          </DialogTitle>
          <DialogDescription>{t(mode === "signup" ? "phIntroUp" : "phIntroIn")}</DialogDescription>
        </DialogHeader>

        {!challenge ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void sendCode()
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="ph-mobile">{t("phMobile")}</Label>
              <Input id="ph-mobile" dir="ltr" inputMode="tel" autoComplete="tel" placeholder="05xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} className="text-start" />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full gap-2" disabled={busy || phone.trim().length < 7}>
              {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {t("phSend")}
            </Button>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void verify()
            }}
          >
            <p className="text-sm text-muted-foreground">
              {t("phSentTo")} <span dir="ltr" className="font-bold text-foreground">{challenge.masked}</span>
            </p>
            {challenge.testCode && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm" dir="ltr">
                {t("phTestCode")}: <b>{challenge.testCode}</b>
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ph-code">{t("phCode")}</Label>
              <Input id="ph-code" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="text-start tracking-latin text-lg" />
            </div>
            {needsProfile && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-bold">{t("phNew")}</p>
                <div className="space-y-1.5">
                  <Label htmlFor="ph-name">{t("phName")}</Label>
                  <Input id="ph-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} dir="auto" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ph-company">{t("phCompany")}</Label>
                  <Input id="ph-company" autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} dir="auto" />
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full gap-2" disabled={busy || !canVerify}>
              {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {t(needsProfile ? "phCreate" : "phContinue")}
            </Button>
            <button type="button" className="w-full text-center text-sm text-cta hover:underline" onClick={reset}>
              {t("phChange")}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
