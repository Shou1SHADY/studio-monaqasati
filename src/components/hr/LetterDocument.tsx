"use client"

// The letter itself (EM-08, WF-24 step 4), in the LETTER's language — not the
// reader's: an English letter reads in English on an Arabic screen. The
// letterhead, name, ID, nationality, position, join date and the feminine
// wording always come from the card; a free letter's body is the signer's
// text. A salary or embassy letter's figures show only to who may see pay
// (RL-03) — "•••" for everyone else. Money is written "SAR" / "ريال": the
// riyal glyph's font does not reach the print window.

import { useEffect, useState, type ReactNode } from "react"
import { NextIntlClientProvider, useLocale, useTimeZone, useTranslations, type AbstractIntlMessages } from "next-intl"
import { Loader2 } from "lucide-react"
import { escapeHtml } from "@/components/accounting/print"
import { hrDate } from "@/lib/hr/format"
import { letterNoDisplay, letterTotal, type HrLetter, type LetterCard, type LetterHead, type LetterLang, type LetterPay, type SignerLevel } from "@/lib/hr/letters"
import { cn } from "@/lib/utils"

/** Renders its children with the letter's language as the locale — the other
 * language's messages are fetched once, only when a letter needs them. */
export function LetterInLanguage({ lang, children }: { lang: LetterLang; children: ReactNode }) {
  const locale = useLocale()
  const timeZone = useTimeZone()
  const [messages, setMessages] = useState<AbstractIntlMessages | null>(null)
  useEffect(() => {
    if (lang === locale) return
    let live = true
    import(`../../../messages/${lang}.json`)
      .then((m: { default: { Portal: { HR: AbstractIntlMessages } } }) => {
        if (live) setMessages({ Portal: { HR: m.default.Portal.HR } })
      })
      .catch((err) => console.error(err))
    return () => {
      live = false
    }
  }, [lang, locale])
  if (lang === locale) return <>{children}</>
  if (!messages) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin text-muted-foreground" size={22} aria-hidden="true" />
      </div>
    )
  }
  return (
    <NextIntlClientProvider locale={lang} messages={messages} timeZone={timeZone}>
      {children}
    </NextIntlClientProvider>
  )
}

export interface LetterDocumentProps {
  letter: Pick<HrLetter, "kind" | "title" | "addressee" | "lang" | "serial" | "issuedOn" | "travel">
  card: LetterCard
  head: LetterHead
  /** Null with `payHidden`: the viewer may not see it; null without: not on the record. */
  pay: Pick<LetterPay, "basic" | "housing" | "transport"> | null
  payHidden: boolean
  /** A free letter's body — the signer's text (or, in preview, what he is writing). */
  text: string | null
  signer: { name: string | null; role: SignerLevel } | null
  today: string
  /** An embassy letter's travel window when the preview names a leave not yet stored. */
  travel?: { from: string; to: string } | null
  className?: string
}

const figure = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Must be rendered inside `LetterInLanguage` for the letter's language. */
export function LetterDocument({ letter, card, head, pay, payHidden, text, signer, today, travel, className }: LetterDocumentProps) {
  const t = useTranslations("Portal.HR.letter_doc")
  const tHr = useTranslations("Portal.HR")
  const lang = letter.lang
  const g = card.gender === "f" ? "f" : "m"
  const co = head.name || t("the_company")
  const date = (d: string | null | undefined) => hrDate(d, lang)
  const nat = tHr.has(`nat.${card.nationality}`) ? tHr(`nat.${card.nationality}` as "nat.sa") : card.nationality
  const trade = tHr.has(`trade.${card.trade}`) ? tHr(`trade.${card.trade}` as "trade.mason") : card.trade
  const name = lang === "en" ? card.nameEn || card.nameAr : card.nameAr
  const who = t("who", { gender: g, name, nat, saudi: card.nationality === "sa" ? "yes" : "no", id: card.idNo || "—" })
  const base = { co, who, gender: g, trade, join: date(card.join) }
  const amount = (n: number) => (payHidden ? "•••" : t("amount", { n: figure(n) }))
  const trip = travel ?? letter.travel ?? null
  const words = (text ?? "").trim()

  let body: ReactNode
  if (letter.kind === "sal") {
    body = (
      <>
        <p>{t("sal_body", base)}</p>
        <table data-l="pay" className="my-2 w-full border-collapse text-sm">
          <tbody>
            {(["basic", "housing", "transport"] as const).map((k) => (
              <tr key={k} className="border-b">
                <td className="py-1">{t(k)}</td>
                <td className="py-1 text-end tabular-nums" dir="ltr">
                  {pay || payHidden ? amount(pay?.[k] ?? 0) : "—"}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-1 font-bold">{t("total")}</td>
              <td className="py-1 text-end font-bold tabular-nums" dir="ltr">
                {pay || payHidden ? amount(pay ? letterTotal(pay) : 0) : "—"}
              </td>
            </tr>
          </tbody>
        </table>
        <p>{t("closing", { gender: g })}</p>
      </>
    )
  } else if (letter.kind === "emb") {
    const leave = trip ? t("emb_leave", { gender: g, from: date(trip.from), to: date(trip.to) }) : ""
    body = <p>{t("emb_body", { ...base, total: pay || payHidden ? amount(pay ? letterTotal(pay) : 0) : "—", leave })}</p>
  } else if (letter.kind === "exp") {
    body = <p>{t("exp_body", { ...base, last: date(card.lastDay ?? today) })}</p>
  } else if (letter.kind === "noc") {
    body = (
      <>
        <p>{t("noc_body", base)}</p>
        <p data-l="quote" className="whitespace-pre-line border-s-4 border-module/40 px-3 py-2" dir="auto">
          {words}
        </p>
        <p>{t("closing", { gender: g })}</p>
      </>
    )
  } else {
    body = (
      <>
        {letter.title && (
          <p data-l="title" className="text-center font-bold" dir="auto">
            {letter.title}
          </p>
        )}
        <p>{t("oth_body", base)}</p>
        <p className="whitespace-pre-line" dir="auto">
          {words}
        </p>
        <p>{t("closing", { gender: g })}</p>
      </>
    )
  }

  const headLine = [head.cr ? t("cr", { cr: head.cr }) : null, head.mol ? t("mol", { mol: head.mol }) : null, t("hr")].filter(Boolean).join(" · ")

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className={cn("rounded-xl border bg-background p-5 text-sm leading-loose text-foreground", className)}>
      <div data-l="head" className="text-center">
        <p className="text-base font-bold">{co}</p>
        <p className="text-xs text-muted-foreground">{headLine}</p>
      </div>
      <div data-l="meta" className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {t("no")}: <span dir="ltr">{letter.serial ? letterNoDisplay(letter.serial, lang) : t("no_pending")}</span>
        </span>
        <span>
          {t("date")}: {date(letter.issuedOn ?? today)}
        </span>
      </div>
      <p data-l="to" className="mt-3 font-bold" dir="auto">
        {t("to")}: {letter.addressee}
      </p>
      <div data-l="body" className="mt-2 space-y-2">
        {body}
      </div>
      <div data-l="sign" className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <span className="text-xs text-muted-foreground">{t("source")}</span>
        {signer && (
          <span className="text-center">
            <b dir="auto">{signer.name || "—"}</b>
            <br />
            <span className="text-xs text-muted-foreground">{t(`role.${signer.role}`)}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/** A self-written print window: the letter's own markup, plain styles, no portal chrome. */
export function printLetter(el: HTMLElement | null, title: string, lang: LetterLang) {
  if (!el) return
  const w = window.open("", "_blank", "width=760,height=980")
  if (!w) return
  const dir = lang === "ar" ? "rtl" : "ltr"
  const css = `@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:"Noto Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif;color:#000;margin:0;font-size:14px;line-height:1.9}
  [data-l=head]{text-align:center;border-bottom:2px solid #000;padding-bottom:8px}[data-l=head] p{margin:0}[data-l=head] p:first-child{font-size:20px;font-weight:700;line-height:1.6}
  [data-l=meta]{display:flex;justify-content:space-between;margin-top:12px;font-size:12px;color:#333}[data-l=to]{margin-top:16px;font-weight:700}
  [data-l=body] p{margin:10px 0}[data-l=title]{text-align:center;font-weight:700}[data-l=quote]{border-inline-start:3px solid #555;padding:6px 12px;white-space:pre-line}
  [data-l=pay]{width:100%;border-collapse:collapse;margin:8px 0}[data-l=pay] td{border-bottom:1px solid #ccc;padding:4px 6px}[data-l=pay] td:last-child{text-align:end}
  [data-l=sign]{display:flex;justify-content:space-between;align-items:flex-end;margin-top:48px;font-size:12px}[data-l=sign] b{font-size:14px}`
  w.document.write(
    `<!doctype html><html dir="${dir}" lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${el.innerHTML}</body></html>`
  )
  w.document.close()
  w.focus()
  w.print()
}
