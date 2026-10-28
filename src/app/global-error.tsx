"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect, useState } from "react"
import { isTransientLoadError, mayAutoRetry, reloadAfterLoadError } from "@/lib/transient-error"

const RETRY_KEY = "mdmak:auto-retry-at"

// This boundary renders outside every provider — no locale, no translations, no
// stylesheet — so its few words are kept here in both languages, and it is styled inline.
const TEXT = {
  ar: { title: "لم تُحمَّل الصفحة", body: "انقطع الاتصال أو حدث خطأ أثناء التحميل. أعد التحميل، وإن تكرّر فأخبرنا.", reload: "أعد التحميل" },
  en: { title: "The page did not load", body: "The connection dropped or something failed while loading. Reload; if it happens again, tell us.", reload: "Reload" },
}

// The last-resort boundary for a crash in the root layout itself. A page that failed to
// LOAD ("Connection closed", PUR-09 #3) reloads once by itself; otherwise a message in the
// page's language and a reload button replace Next's black "Application error" screen.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const transient = isTransientLoadError(error)
  const [show, setShow] = useState(!transient)
  const [lang, setLang] = useState<"ar" | "en">("ar")

  useEffect(() => {
    Sentry.captureException(error)
    setLang(window.location.pathname.startsWith("/en") ? "en" : "ar")
    if (!transient) return
    let last: number | null = null
    try { last = Number(sessionStorage.getItem(RETRY_KEY)) || null } catch { /* storage blocked */ }
    if (!mayAutoRetry(last, Date.now())) { setShow(true); return }
    try { sessionStorage.setItem(RETRY_KEY, String(Date.now())) } catch { /* storage blocked */ }
    reloadAfterLoadError(error)
  }, [error, transient])

  const tx = TEXT[lang]
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC", color: "#0F172A", fontFamily: "system-ui, sans-serif" }}>
        {show && (
          <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
            <h1 style={{ fontSize: 22, lineHeight: 1.6, margin: "0 0 8px" }}>{tx.title}</h1>
            <p style={{ color: "#334155", lineHeight: 1.7, margin: "0 0 20px" }}>{tx.body}</p>
            <button type="button" onClick={() => reloadAfterLoadError(error)} style={{ background: "#0369A1", color: "#fff", border: 0, borderRadius: 10, padding: "12px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer", minHeight: 44 }}>
              {tx.reload}
            </button>
          </div>
        )}
      </body>
    </html>
  )
}
