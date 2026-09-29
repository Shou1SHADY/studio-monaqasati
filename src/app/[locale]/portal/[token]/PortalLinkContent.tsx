"use client"

// The consultant's side of the PM portal: the link names the project, a
// one-time code on his mobile opens a 12-hour session (kept in this tab's
// sessionStorage), and he answers what waits on him. No price, cost or amount
// ever reaches this page — the server sends named fields only.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, History, Link2, Loader2, LogOut, ShieldCheck, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PortalKind } from "@/lib/pm/consultant-portal"
import { pmDate } from "@/lib/pm/format"
import type { PortalAnswer, PortalHistoryEntry, PortalViewItem } from "@/lib/pm/portal-links"
import { itemLabel, PortalAnswerCard } from "./PortalAnswerCard"

interface LinkInfo {
  projectName: string
  projectNo: string | null
  consultantName: string
  phoneMasked: string
}

interface Items {
  today: string
  readOnly: boolean
  items: PortalViewItem[]
  history: PortalHistoryEntry[]
}

const KINDS: PortalKind[] = ["subm", "wir", "punch", "corr", "ncr"]
const BLOCKS = new Set(["no_note", "bad_date", "no_choice", "no_text", "before_letter", "future_day", "bad_day"])
const SESSION_HEADER = "x-portal-session"

const storeKey = (token: string) => `pm-portal:${token}`

function readSession(token: string): string | null {
  try {
    const raw = sessionStorage.getItem(storeKey(token))
    if (!raw) return null
    const s = JSON.parse(raw) as { session?: string; expiresAt?: string }
    return s.session && s.expiresAt && Date.parse(s.expiresAt) > Date.now() ? s.session : null
  } catch {
    return null
  }
}

function writeSession(token: string, value: { session: string; expiresAt: string } | null) {
  try {
    if (value) sessionStorage.setItem(storeKey(token), JSON.stringify(value))
    else sessionStorage.removeItem(storeKey(token))
  } catch {
    return
  }
}

export function PortalLinkContent() {
  const { token } = useParams<{ token: string }>()
  const locale = useLocale()
  const t = useTranslations("PmPortal")

  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [session, setSession] = useState<string | null>(null)
  const [data, setData] = useState<Items | null>(null)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [testCode, setTestCode] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const endSession = useCallback(() => {
    writeSession(token, null)
    setSession(null)
    setData(null)
    setChallengeId(null)
    setCode("")
  }, [token])

  const loadItems = useCallback(
    async (secret: string) => {
      const res = await fetch(`/api/pm-portal/${token}/items`, { headers: { [SESSION_HEADER]: secret }, cache: "no-store" })
      const body = await res.json().catch(() => null)
      if (res.status === 401) {
        endSession()
        return
      }
      if (res.status === 410) {
        setLoadError(body?.code || "LINK_REVOKED")
        return
      }
      if (!res.ok) {
        setError(t("err_generic"))
        return
      }
      setData(body.data as Items)
    },
    [token, endSession, t]
  )

  useEffect(() => {
    let cancelled = false
    fetch(`/api/pm-portal/${token}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok) {
          setLoadError(body?.code || "NOT_FOUND")
          return
        }
        setInfo(body.data as LinkInfo)
        const stored = readSession(token)
        if (stored) {
          setSession(stored)
          await loadItems(stored)
        }
      })
      .catch(() => !cancelled && setLoadError("NETWORK"))
    return () => {
      cancelled = true
    }
  }, [token, loadItems])

  const sendCode = async () => {
    setError(null)
    setBusy("code")
    try {
      const res = await fetch(`/api/pm-portal/${token}/code?locale=${locale === "en" ? "en" : "ar"}`, { method: "POST" })
      const body = await res.json().catch(() => null)
      if (res.status === 429) return setError(t("err_too_soon"))
      if (res.status === 410) return setLoadError(body?.code || "LINK_REVOKED")
      if (!res.ok) return setError(t("err_code_send"))
      setChallengeId(body.data.challengeId)
      setTestCode(body.data.testCode ?? null)
    } catch {
      setError(t("err_generic"))
    } finally {
      setBusy(null)
    }
  }

  const verify = async () => {
    if (!challengeId) return
    setError(null)
    setBusy("verify")
    try {
      const res = await fetch(`/api/pm-portal/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        writeSession(token, body.data)
        setSession(body.data.session)
        setTestCode(null)
        await loadItems(body.data.session)
        return
      }
      if (body?.code === "WRONG_CODE") setError(t("err_wrong_code"))
      else if (body?.code === "CODE_EXPIRED") {
        setError(t("err_code_expired"))
        setChallengeId(null)
        setCode("")
      } else if (res.status === 410) setLoadError(body?.code || "LINK_REVOKED")
      else setError(t("err_generic"))
    } catch {
      setError(t("err_generic"))
    } finally {
      setBusy(null)
    }
  }

  const answer = async (key: string, input: PortalAnswer) => {
    if (!session) return
    setError(null)
    setNotice(null)
    setBusy(key)
    try {
      const res = await fetch(`/api/pm-portal/${token}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [SESSION_HEADER]: session },
        body: JSON.stringify(input),
      })
      const body = await res.json().catch(() => null)
      if (res.ok) setNotice(t("a.done"))
      else if (res.status === 401) {
        endSession()
        setError(t("err_session"))
        return
      } else if (body?.code === "NOT_WAITING" || body?.code === "NOT_FOUND") setError(t("err_not_waiting"))
      else if (body?.code === "PROJECT_CLOSED") setError(t("read_only"))
      else if (body?.code === "BLOCKED") {
        const first = (body.blocks as string[] | undefined)?.find((b) => BLOCKS.has(b))
        setError(first ? t(`block.${first}`) : t("err_generic"))
        return
      } else if (res.status === 410) return setLoadError(body?.code || "LINK_REVOKED")
      else {
        setError(t("err_generic"))
        return
      }
      await loadItems(session)
    } catch {
      setError(t("err_generic"))
    } finally {
      setBusy(null)
    }
  }

  const groups = useMemo(() => KINDS.map((k) => ({ kind: k, items: (data?.items ?? []).filter((x) => x.kind === k) })).filter((g) => g.items.length), [data])

  if (loadError) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <TriangleAlert className="text-warning" size={32} aria-hidden="true" />
          <h1 className="text-lg font-bold text-foreground">{t("closed_title")}</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{t(`closed_${closedReason(loadError)}`)}</p>
        </div>
      </Shell>
    )
  }

  if (!info) {
    return (
      <Shell>
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-label={t("loading")} />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <header className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-module">
          <Link2 size={14} aria-hidden="true" />
          {t("eyebrow")}
        </p>
        <h1 className="text-xl font-black leading-relaxed text-foreground" dir="auto">
          {info.projectName || info.projectNo || t("project_unknown")}
        </h1>
        {info.projectNo && info.projectName && (
          <p className="text-sm text-muted-foreground" dir="ltr">
            {info.projectNo}
          </p>
        )}
        <p className="pt-1 text-sm text-foreground">{t("intro", { name: info.consultantName })}</p>
        <p className="text-xs text-muted-foreground">{t("no_prices")}</p>
      </header>

      {!session ? (
        <section className="space-y-3 rounded-xl border bg-muted/30 p-4" aria-live="polite">
          <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
            <ShieldCheck size={16} className="text-module" aria-hidden="true" />
            {t("verify_title")}
          </p>
          {!challengeId ? (
            <>
              <p className="text-xs text-muted-foreground">{t("verify_body", { phone: info.phoneMasked })}</p>
              <Button className="h-11 w-full" disabled={busy !== null} onClick={sendCode}>
                {busy === "code" ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : null}
                {t("send_code")}
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{t("code_sent", { phone: info.phoneMasked })}</p>
              {testCode && <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">{t("test_code", { code: testCode })}</p>}
              <Label htmlFor="portal-code" className="text-xs">
                {t("code_label")}
              </Label>
              <Input
                id="portal-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                dir="ltr"
                className="h-12 text-center text-lg tracking-latin tabular-nums"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[^0-9]/g, ""))}
              />
              <Button className="h-11 w-full" disabled={busy !== null || code.length !== 6} onClick={verify}>
                {busy === "verify" ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : null}
                {t("open")}
              </Button>
              <button
                type="button"
                className="min-h-11 w-full rounded-md text-center text-xs text-muted-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={busy !== null}
                onClick={sendCode}
              >
                {t("resend")}
              </button>
            </>
          )}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </section>
      ) : !data ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-muted-foreground" size={24} aria-label={t("loading")} />
        </div>
      ) : (
        <>
          <div aria-live="polite" className="space-y-2">
            {notice && (
              <p className="flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
                <CheckCircle2 size={16} aria-hidden="true" />
                {notice}
              </p>
            )}
            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

          <section className="space-y-4" aria-labelledby="pending-h">
            <div className="flex items-center justify-between gap-2">
              <h2 id="pending-h" className="text-base font-bold text-foreground">
                {t("pending_title")}
              </h2>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">{t("pending_count", { count: data.items.length })}</span>
            </div>
            {data.readOnly ? (
              <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{t("read_only")}</p>
            ) : groups.length === 0 ? (
              <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{t("nothing")}</p>
            ) : (
              groups.map((g) => (
                <div key={g.kind} className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground">{t(`kind.${g.kind}`)}</h3>
                  <ul className="space-y-3">
                    {g.items.map((x) => {
                      const key = `${x.kind}-${x.no}`
                      return <PortalAnswerCard key={key} item={x} today={data.today} busy={busy === key} onAnswer={(a) => answer(key, a)} />
                    })}
                  </ul>
                </div>
              ))
            )}
          </section>

          <section className="space-y-2" aria-labelledby="history-h">
            <h2 id="history-h" className="flex items-center gap-1.5 text-sm font-bold text-foreground">
              <History size={15} aria-hidden="true" />
              {t("history_title")}
            </h2>
            {data.history.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("history_empty")}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {data.history.map((h) => (
                  <li key={`${h.kind}-${h.no}-${h.at}`} className="flex items-start justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        <bdi>{itemLabel(h.kind, h.no, locale, t)}</bdi> — {t(`what.${h.what}`)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" dir="auto">
                        {h.title}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{pmDate(h.at, locale)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Button variant="outline" className="h-11 w-full gap-1.5" onClick={endSession}>
            <LogOut size={15} className="rtl-flip" aria-hidden="true" />
            {t("end_session")}
          </Button>
        </>
      )}

      <p className="text-center text-[11px] text-muted-foreground">{t("footer", { name: info.consultantName })}</p>
    </Shell>
  )
}

function closedReason(code: string): "expired" | "revoked" | "missing" {
  if (code === "LINK_EXPIRED") return "expired"
  if (code === "LINK_REVOKED") return "revoked"
  return "missing"
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-4 py-6" data-accent="pm">
      <div className="mx-auto max-w-lg space-y-6">{children}</div>
    </main>
  )
}
