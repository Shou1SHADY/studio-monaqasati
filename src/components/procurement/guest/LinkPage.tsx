"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Download, Loader2, Send, Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { guestValidityDefault, saudiMobileE164 } from "@/lib/supplier-free/phone-auth"
import { validateLinkQuote } from "@/lib/procurement/link-validate"
import type { GuestPaperFiles } from "./GuestPapersField"
import { LinkClosed } from "./LinkClosed"
import { LinkDone } from "./LinkDone"
import { LinkHead } from "./LinkHead"
import { LinkLine } from "./LinkLine"
import { LinkQa } from "./LinkQa"
import { LinkResult } from "./LinkResult"
import { LinkShell } from "./LinkShell"
import { LinkTasks } from "./LinkTasks"
import { LinkTotals } from "./LinkTotals"
import { OfferFields } from "./OfferFields"
import { OtpBox } from "./OtpBox"
import { PromoCard } from "./PromoCard"
import { TrustLine } from "./TrustLine"
import { saveSession, type LinkApi } from "./link-api"
import { fmtDay, placeText, termsText } from "./link-format"
import { PAY_FIELDS, PAY_PRESETS, emptyForm, lineOf, type FormState, type LineState, type LinkData, type LinkMe } from "./link-types"

interface Challenge {
  id: string
  masked: string
  testCode: string | null
}

const SERVER_TEXT: Record<string, string> = {
  RFQ_CLOSED: "err_closed",
  DEADLINE_PASSED: "err_closed",
  RATE_LIMITED: "err_rate",
  RATE_UNAVAILABLE: "err_rate",
  CODE_UNAVAILABLE: "err_no_code",
  NO_SESSION: "err_session",
  SESSION_EXPIRED: "err_session",
  SESSION_SCOPE: "err_session",
  WRONG_STATE: "err_wrong_state",
  PRICE_HIGHER: "err_price_higher",
  REPLY_CLOSED: "err_reply_closed",
  PACK_NOT_OFFERED: "err_pack",
  INVALID_DURATION: "err_days",
  VALID_MISSING: "err_valid_missing",
  VALID_BEFORE_CLOSE: "err_valid_before_close",
  PRICE_INVALID: "err_price_zero",
  PRICE_TOO_BIG: "err_price_big",
  LINE_PRICES_INCOMPLETE: "err_no_price",
  LINE_CONTRADICTORY: "err_no_price",
  NO_LINE_PRICED: "err_no_price",
}

const EXTRAS_TEXT: Record<string, string> = { WRONG_CODE: "otp_err_wrong", CODE_EXPIRED: "otp_err_expired", CODE_UNCHECKED: "otp_err_unchecked", CODE_REQUIRED: "otp_required", INVALID_PHONE: "otp_err_phone", PAPER_TOO_LARGE: "papers_too_large", INVALID_PAPER: "papers_bad_type", TOO_SOON: "otp_err_too_soon", LINK_OTP_LIMIT: "otp_err_limit" }

const localMobile = (e164: string) => (e164.startsWith("+966") ? `0${e164.slice(4)}` : e164)

function formFromOffer(me: NonNullable<LinkMe["offer"]>, phone: string): FormState {
  const lines: Record<number, LineState> = {}
  for (const l of me.lines) lines[l.rfqProductIndex] = { price: String(l.unitPrice), per: l.packLen ?? null, skipped: false, war: l.warrantyMonths ?? null }
  for (const i of me.skipped) lines[i] = { price: "", per: null, skipped: true, war: null }
  const pay = PAY_PRESETS.find((p) => PAY_FIELDS[p].advancePercent === (me.advancePercent ?? 0) && PAY_FIELDS[p].creditDays === (me.creditDays ?? 0) && (me.advancePercent != null || me.creditDays != null)) ?? ""
  return { lines, total: String(me.total), days: me.leadDays != null ? String(me.leadDays) : "", valid: me.validUntil, company: me.companyName, mobile: localMobile(phone), pay, nonVat: !me.vatRegistered, whole: me.whole, note: me.note, contact: me.contactName, email: me.email, vat: me.vatNumber }
}

// The visitor's page, one column (LNK-01…13). The same component serves the visitor and — with `api` null — the buyer's
// preview, where every act is inert and `me` is what the chosen visitor would see.
export function LinkPage({ data, api, preview, langHref }: { data: LinkData; api: LinkApi | null; preview?: { me: LinkMe | null }; langHref?: string }) {
  const t = useTranslations("PublicRfq")
  const te = useTranslations("PublicRfq.extras")
  const locale = useLocale()
  const { toast } = useToast()
  const rfq = data.rfq
  const inert = api == null

  const [form, setForm] = useState<FormState>(() => emptyForm(guestValidityDefault(rfq.closeDay)))
  const [extras, setExtras] = useState(false)
  const [pdf, setPdf] = useState<File | null>(null)
  const [papers, setPapers] = useState<GuestPaperFiles>({})
  const [me, setMe] = useState<LinkMe | null>(preview?.me ?? null)
  const [editing, setEditing] = useState(false)
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [otpBusy, setOtpBusy] = useState(false)
  const [otpError, setOtpError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [lockedClosed, setLockedClosed] = useState(false)
  const [seeing, setSeeing] = useState(false)
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null)
  const [intent, setIntent] = useState<"send" | "see">("send")

  const open = rfq.state === "open" && data.canSubmit && !lockedClosed
  const lineMode = rfq.pricing === "line"

  const failText = useCallback((code: string): string => (SERVER_TEXT[code] ? t(SERVER_TEXT[code]) : EXTRAS_TEXT[code] ? te(EXTRAS_TEXT[code]) : t("error_generic")), [t, te])

  const loadMe = useCallback(
    async (secret?: string | null): Promise<LinkMe | null> => {
      if (!api) return null
      const res = await api.call<LinkMe>("/me", { method: "POST", json: {}, session: secret })
      if (!res.ok) {
        if (res.code === "NO_SESSION" || res.code === "SESSION_EXPIRED") saveSession(api.token, null)
        return null
      }
      setMe(res.data)
      return res.data
    },
    [api]
  )

  useEffect(() => {
    const stored = api?.session()
    if (!api || !stored) return
    setVerifiedPhone(stored.phone)
    void loadMe(stored.secret).then((got) => {
      if (got?.offer) setForm(formFromOffer(got.offer, stored.phone))
    })
  }, [api, loadMe])

  const setLine = (index: number, patch: Partial<LineState>) => setForm((f) => ({ ...f, lines: { ...f.lines, [index]: { ...lineOf(f, index), ...patch } } }))
  const patchForm = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  const checked = useMemo(
    () =>
      validateLinkQuote({
        pricing: rfq.pricing,
        lines: rfq.lines.map((l) => {
          const s = lineOf(form, l.index)
          return { index: l.index, qty: l.qty, price: s.price, per: s.per, skipped: s.skipped }
        }),
        total: form.total,
        days: form.days,
        valid: form.valid,
        close: rfq.closeDay,
        company: form.company,
        mobile: form.mobile,
      }),
    [form, rfq]
  )
  const issues = checked.issues
  const issueText = (code: string) => t(`err_${code}`)
  const warn = issues.length === 0 ? t("warn_ready") : `${issueText(issues[0].code)}${issues.length > 1 ? ` · ${t("warn_more", { count: issues.length - 1 })}` : ""}`

  const phoneE164 = saudiMobileE164(form.mobile)
  const sessionHolds = Boolean(api && verifiedPhone && phoneE164 === verifiedPhone)

  const buildForm = (): FormData => {
    const f = new FormData()
    f.set("companyName", form.company.trim())
    f.set("phone", phoneE164 || form.mobile)
    f.set("validUntil", form.valid)
    f.set("executionDuration", form.days)
    f.set("executionDurationUnit", "أيام")
    f.set("vatRegistered", form.nonVat ? "false" : "true")
    if (form.whole) f.set("whole", "true")
    if (lineMode) {
      const lines = rfq.lines.flatMap((l) => {
        const s = lineOf(form, l.index)
        if (s.skipped || !s.price.trim()) return []
        const warranty = l.warrantyMonths != null ? { warrantyMonths: s.war ?? l.warrantyMonths } : {}
        return [{ rfqProductIndex: l.index, unitPrice: Number(s.price.replace(/,/g, "")), ...(s.per ? { packLen: s.per } : {}), ...warranty }]
      })
      f.set("lines", JSON.stringify(lines))
      f.set("skipped", JSON.stringify(rfq.lines.filter((l) => lineOf(form, l.index).skipped).map((l) => l.index)))
    } else {
      f.set("price", form.total.replace(/,/g, ""))
    }
    if (form.pay) {
      f.set("advancePercent", String(PAY_FIELDS[form.pay].advancePercent))
      f.set("creditDays", String(PAY_FIELDS[form.pay].creditDays))
    }
    if (form.note.trim()) f.set("message", form.note.trim())
    if (form.contact.trim()) f.set("contactName", form.contact.trim())
    if (form.email.trim()) f.set("email", form.email.trim())
    if (form.vat.trim()) f.set("vatNumber", form.vat.trim())
    if (pdf) f.set("pdf", pdf)
    if (papers.cr) f.set("paper_cr", papers.cr)
    if (papers.vat) f.set("paper_vat", papers.vat)
    return f
  }

  const post = async (secret: string | null) => {
    if (!api) return
    setSending(true)
    const res = await api.call<{ session?: { secret: string; expiresAt: string } }>("/offer", { method: me?.offer ? "PUT" : "POST", form: buildForm(), session: secret })
    if (!res.ok) {
      setSending(false)
      if (res.code === "RFQ_CLOSED" || res.code === "DEADLINE_PASSED") setLockedClosed(true)
      if (res.code === "NO_SESSION" || res.code === "SESSION_EXPIRED") {
        saveSession(api.token, null)
        setVerifiedPhone(null)
      }
      toast({ title: t("error_title"), description: failText(res.code), variant: "destructive" })
      return
    }
    await loadMe(secret)
    setSending(false)
    setEditing(false)
    setChallenge(null)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const requestCode = async (forIntent: "send" | "see") => {
    if (!api || !phoneE164) return
    setIntent(forIntent)
    setOtpBusy(true)
    setOtpError(null)
    const res = await api.call<{ challengeId: string; phoneMasked: string; testCode?: string }>("/code", { method: "POST", json: { phone: form.mobile, locale: locale === "en" ? "en" : "ar" }, session: null })
    setOtpBusy(false)
    if (!res.ok) {
      const text = res.code === "TOO_SOON" ? te("otp_err_too_soon") : failText(res.code)
      setOtpError(text)
      toast({ title: t("error_title"), description: text, variant: "destructive" })
      return
    }
    setChallenge({ id: res.data.challengeId, masked: res.data.phoneMasked, testCode: res.data.testCode ?? null })
  }

  const verify = async (code: string) => {
    if (!api || !challenge || !phoneE164) return
    setOtpBusy(true)
    setOtpError(null)
    const res = await api.call<{ session: { secret: string; expiresAt: string } }>("/verify", { method: "POST", json: { phone: form.mobile, challengeId: challenge.id, code }, session: null })
    setOtpBusy(false)
    if (!res.ok) {
      setOtpError(failText(res.code))
      return
    }
    saveSession(api.token, { secret: res.data.session.secret, expiresAt: res.data.session.expiresAt, phone: phoneE164 })
    setVerifiedPhone(phoneE164)
    setChallenge(null)
    if (intent === "see") {
      const got = await loadMe(res.data.session.secret)
      if (got?.offer) setForm(formFromOffer(got.offer, phoneE164))
      setSeeing(false)
      return
    }
    await post(res.data.session.secret)
  }

  const send = async () => {
    if (inert || issues.length || sending) return
    const stored = api?.session()
    if (stored && stored.phone === phoneE164) return post(stored.secret)
    await requestCode("send")
  }

  const ask = async (question: string): Promise<boolean> => {
    if (!api) return false
    const res = await api.call("/ask", { method: "POST", json: { question } })
    if (!res.ok) {
      toast({ title: t("error_title"), description: failText(res.code), variant: "destructive" })
      return false
    }
    return true
  }

  const bafo = async (prices: Record<number, string>, total: string): Promise<boolean> => {
    if (!api) return false
    const res = await api.call("/bafo", { method: "POST", json: lineMode ? { lines: Object.entries(prices).map(([i, p]) => ({ rfqProductIndex: Number(i), unitPrice: p.replace(/,/g, "") })) } : { total: total.replace(/,/g, "") } })
    if (!res.ok) {
      toast({ title: t("error_title"), description: failText(res.code), variant: "destructive" })
      return false
    }
    await loadMe()
    return true
  }

  const answer = async (inquiryId: string, text: string): Promise<boolean> => {
    if (!api) return false
    const res = await api.call("/answer", { method: "POST", json: { inquiryId, answer: text } })
    if (!res.ok) {
      toast({ title: t("error_title"), description: failText(res.code), variant: "destructive" })
      return false
    }
    return true
  }

  const company = data.contractorName
  const groups = useMemo(() => {
    const out: Array<{ place: string | null; lines: typeof rfq.lines }> = []
    for (const l of rfq.lines) {
      const place = l.place ? placeText(l.place, locale) : null
      const last = out[out.length - 1]
      if (last && last.place === place) last.lines.push(l)
      else out.push({ place, lines: [l] })
    }
    return out
  }, [rfq, locale])

  const shell = (children: React.ReactNode) => (
    <LinkShell company={company} langHref={langHref}>
      {children}
    </LinkShell>
  )

  const phoneShown = verifiedPhone ? localMobile(verifiedPhone) : undefined

  // ---- Closed: no form at all ------------------------------------------------------------------------------------
  if (!open) {
    const offer = me?.offer
    return shell(
      <>
        <LinkHead rfq={rfq} />
        {offer && me?.result ? (
          <>
            <LinkResult result={me.result} rfq={rfq} />
            {me.tasks && offer && <LinkTasks tasks={me.tasks} offer={offer} rfq={rfq} onBafo={bafo} onAnswer={answer} />}
          </>
        ) : (
          <LinkClosed rfq={rfq}>
            {!inert && (
              <div className="space-y-2 border-t pt-3 text-start">
                {!seeing ? (
                  <button type="button" onClick={() => setSeeing(true)} className="text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t("closed_see")}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="lk-see-mobile" className="text-xs font-semibold">
                      {t("closed_see_hint")}
                    </Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input id="lk-see-mobile" inputMode="tel" dir="ltr" placeholder="05XXXXXXXX" value={form.mobile} onChange={(e) => patchForm({ mobile: e.target.value })} className="h-11 w-44 text-start" />
                      <Button type="button" disabled={otpBusy || !phoneE164} onClick={() => void requestCode("see")} className="min-h-11">
                        {otpBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : t("closed_see_btn")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </LinkClosed>
        )}
        {challenge && <OtpBox phoneMasked={challenge.masked} testCode={challenge.testCode} busy={otpBusy} error={otpError} onVerify={(c) => void verify(c)} onResend={() => void requestCode(intent)} verifyLabel={t("otp_verify")} />}
        <PromoCard phone={phoneShown} preview={inert} />
      </>
    )
  }

  // ---- Sent: the short page ------------------------------------------------------------------------------------------
  const offer = me?.offer
  if (offer && !editing) {
    return shell(
      <>
        <LinkDone company={company} total={offer.vatRegistered ? offer.gross : offer.total} nonVat={!offer.vatRegistered} validUntil={offer.validUntil} close={rfq.closeDay} version={offer.n} onEdit={() => setEditing(true)} preview={inert} />
        {me?.tasks && <LinkTasks tasks={me.tasks} offer={offer} rfq={rfq} onBafo={bafo} onAnswer={answer} />}
        <PromoCard phone={phoneShown} preview={inert} />
      </>
    )
  }

  // ---- The form ----------------------------------------------------------------------------------------------------------
  const lump = !lineMode
  return shell(
    <>
      {offer && editing && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-semibold text-foreground" role="note">
          {t("edit_note", { date: fmtDay(offer.sentAt, locale), close: fmtDay(rfq.closeDay, locale) })}
        </p>
      )}
      <LinkHead rfq={rfq} />
      <TrustLine company={company} notes={rfq.notes} />
      {!offer && <PromoCard preview={inert} />}

      {rfq.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {rfq.attachments.map((a) => (
            <li key={a.url}>
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Download size={12} aria-hidden="true" />
                <span className="max-w-[200px] truncate" dir="auto">
                  {a.name}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-3 rounded-md border bg-card p-3.5" aria-labelledby="link-price-title">
        <h2 id="link-price-title" className="flex flex-wrap items-center gap-x-2 text-sm font-bold text-foreground">
          <Tag size={15} className="text-primary" aria-hidden="true" />
          {t("price_title")}
          <span className="text-xs font-normal text-muted-foreground">{lump ? t("price_sub_lump") : t("price_sub_line")}</span>
        </h2>
        {groups.map((g, gi) => (
          <div key={`${g.place}-${gi}`} className="space-y-2.5">
            {groups.length > 1 && g.place && <p className="text-xs font-bold text-muted-foreground">{t("group_delivery", { place: g.place })}</p>}
            {g.lines.map((l) => (
              <LinkLine key={l.index} line={l} state={lineOf(form, l.index)} lump={lump} onChange={(patch) => setLine(l.index, patch)} disabled={inert} />
            ))}
          </div>
        ))}
        {lump && (
          <div className="space-y-1.5">
            <Label htmlFor="lk-total" className="text-xs font-semibold">
              {t("lump_label")} <span className="text-destructive">*</span>
            </Label>
            <Input id="lk-total" inputMode="decimal" dir="ltr" placeholder="0.00" disabled={inert} value={form.total} onChange={(e) => patchForm({ total: e.target.value.replace(/[^\d.,]/g, "") })} className="h-11 text-start" />
          </div>
        )}
        <LinkTotals net={checked.net} nonVat={form.nonVat} />
      </section>

      <OfferFields
        form={form}
        onChange={patchForm}
        close={rfq.closeDay}
        verified={sessionHolds}
        lineMode={lineMode}
        manyLines={rfq.lines.length > 1}
        termsLabel={termsText(rfq, t)}
        extras={extras}
        onExtras={setExtras}
        pdf={pdf}
        onPdf={setPdf}
        papers={papers}
        onPapers={setPapers}
        onRefused={(message) => toast({ title: t("error_title"), description: message, variant: "destructive" })}
        disabled={inert}
        nameLocked={Boolean(offer)}
      />

      <LinkQa queries={data.queries} onAsk={ask} disabled={inert} />

      {challenge && <OtpBox phoneMasked={challenge.masked} testCode={challenge.testCode} busy={otpBusy || sending} error={otpError} onVerify={(c) => void verify(c)} onResend={() => void requestCode("send")} />}

      <div className="sticky bottom-0 z-30 -mx-4 flex flex-wrap items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <p className={issues.length ? "min-w-0 flex-1 text-xs font-semibold text-warning" : "min-w-0 flex-1 text-xs font-semibold text-success"} id="lk-warn" aria-live="polite">
          {warn}
        </p>
        <Button type="button" id="lk-send" disabled={inert || issues.length > 0 || sending || otpBusy} onClick={() => void send()} className="min-h-11 gap-1.5">
          {sending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} className="rtl-flip" aria-hidden="true" />}
          {offer ? t("submit_edit") : t("submit")}
        </Button>
      </div>
    </>
  )
}
