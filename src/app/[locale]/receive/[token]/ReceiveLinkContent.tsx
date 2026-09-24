"use client"

// The receiver's side of a forwarded delivery (22 Sep review). Whoever is
// standing at the gate — with or without an account — counts what arrived,
// marks what was rejected, signs, and confirms with a code texted to the
// mobile Procurement named. The count is blind: the supplier's quantities are
// deliberately not shown, so the receiver counts rather than agrees.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { displayPoNumber } from "@/lib/procurement/format"
import { CheckCircle2, Loader2, PackageCheck, ShieldCheck, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SignaturePad } from "@/components/SignaturePad"
import { REJECT_REASON_CODES } from "@/lib/procurement/po"
import { cn } from "@/lib/utils"

interface LinkData {
  receiverName: string
  phoneMasked: string
  supplierName: string
  poNumber: string | null
  rfqTitle: string
  deliveryDate: string | null
  forwardedBy: string
  lines: Array<{ poLineId: string; name: string; unit: string }>
}

interface Row {
  counted: string
  rejected: string
  reason: string
  note: string
}

/** A quantity typed in either script: Arabic-Indic digits and thousands
 * separators are read as the receiver meant them. */
function toNum(s: string): number | null {
  const t = (s || "").trim()
  if (!t) return null
  const n = Number(t.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[,٬\s]/g, ""))
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function ReceiveLinkContent() {
  const { token } = useParams<{ token: string }>()
  const locale = useLocale()
  const t = useTranslations("ReceiveLink")
  const tp = useTranslations("Portal.Procurement")

  const [data, setData] = useState<LinkData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [receiverName, setReceiverName] = useState("")
  const [note, setNote] = useState("")
  const [signature, setSignature] = useState<string | null>(null)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [testCode, setTestCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/receipt-links/${token}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok) {
          setLoadError(body?.code || "NOT_FOUND")
          return
        }
        const d = body.data as LinkData
        setData(d)
        setReceiverName(d.receiverName)
        setRows(Object.fromEntries(d.lines.map((l) => [l.poLineId, { counted: "", rejected: "", reason: "", note: "" }])))
      })
      .catch(() => !cancelled && setLoadError("NETWORK"))
    return () => {
      cancelled = true
    }
  }, [token])

  const setRow = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }))

  /** What the form still needs before a code is worth sending. */
  const problem = useMemo(() => {
    if (!data) return null
    for (const l of data.lines) {
      const r = rows[l.poLineId]
      const counted = toNum(r?.counted ?? "")
      if (counted === null) return t("err_count_every_line")
      const rejected = toNum(r?.rejected ?? "") ?? 0
      if (rejected > counted) return t("err_rejected_over", { name: l.name })
      if (rejected > 0 && !r.reason) return t("err_reason_needed", { name: l.name })
    }
    if (!data.lines.some((l) => (toNum(rows[l.poLineId]?.counted ?? "") ?? 0) > 0)) return t("err_nothing_counted")
    if (receiverName.trim().length < 2) return t("err_name")
    if (!signature) return t("err_signature")
    return null
  }, [data, rows, receiverName, signature, t])

  const sendCode = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/receipt-links/${token}/code?locale=${locale === "en" ? "en" : "ar"}`, { method: "POST" })
      const body = await res.json().catch(() => null)
      if (res.status === 429) {
        setError(t("err_too_soon"))
        return
      }
      if (!res.ok) {
        setError(t("err_code_send"))
        return
      }
      setChallengeId(body.data.challengeId)
      setTestCode(body.data.testCode ?? null)
    } finally {
      setBusy(false)
    }
  }, [token, locale, t])

  const confirm = useCallback(async () => {
    if (!data || !challengeId) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/receipt-links/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId,
          code: code.trim(),
          receiverName: receiverName.trim(),
          note: note.trim() || null,
          signatureData: signature,
          lines: data.lines.map((l) => {
            const r = rows[l.poLineId]
            const rejected = toNum(r.rejected) ?? 0
            return {
              poLineId: l.poLineId,
              counted: toNum(r.counted) ?? 0,
              rejected,
              rejectReason: rejected > 0 ? r.reason : null,
              note: r.note.trim() || null,
            }
          }),
        }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        setDone(true)
        return
      }
      if (body?.code === "WRONG_CODE") setError(t("err_wrong_code"))
      else if (body?.code === "CODE_EXPIRED") {
        setError(t("err_code_expired"))
        setChallengeId(null)
        setCode("")
      } else if (res.status === 410) setLoadError(body?.code || "LINK_SIGNED")
      else setError(t("err_generic"))
    } finally {
      setBusy(false)
    }
  }, [data, challengeId, code, receiverName, note, signature, rows, token, t])

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

  if (!data) {
    return (
      <Shell>
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-label={t("loading")} />
        </div>
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="text-success" size={40} aria-hidden="true" />
          <h1 className="text-lg font-bold text-foreground">{t("done_title")}</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{t("done_body", { name: data.forwardedBy })}</p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <header className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-module">
          <PackageCheck size={14} aria-hidden="true" />
          {t("eyebrow")}
        </p>
        <h1 className="text-xl font-black leading-relaxed text-foreground">{data.supplierName || t("supplier_unknown")}</h1>
        <p className="text-sm text-muted-foreground">
          {data.poNumber ? <span dir="ltr">{displayPoNumber(data.poNumber, locale)}</span> : null}
          {data.poNumber && data.rfqTitle ? " · " : ""}
          {data.rfqTitle}
        </p>
        <p className="pt-1 text-sm text-foreground">{t("intro", { name: data.forwardedBy })}</p>
      </header>

      <section className="space-y-2" aria-labelledby="lines-h">
        <h2 id="lines-h" className="text-sm font-bold text-foreground">{t("lines_title")}</h2>
        <p className="text-xs text-muted-foreground">{t("blind_note")}</p>
        <ul className="space-y-3">
          {data.lines.map((l) => {
            const r = rows[l.poLineId]
            const rejected = toNum(r?.rejected ?? "") ?? 0
            return (
              <li key={l.poLineId} className="space-y-3 rounded-xl border bg-card p-4">
                <p className="font-semibold text-foreground">
                  {l.name} <span className="text-xs font-normal text-muted-foreground">({l.unit})</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={`c-${l.poLineId}`} className="text-xs">{t("counted")}</Label>
                    <Input id={`c-${l.poLineId}`} inputMode="decimal" dir="ltr" className="h-11 tabular-nums" value={r?.counted ?? ""} onChange={(e) => setRow(l.poLineId, { counted: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`r-${l.poLineId}`} className="text-xs">{t("rejected")}</Label>
                    <Input id={`r-${l.poLineId}`} inputMode="decimal" dir="ltr" placeholder="0" className="h-11 tabular-nums" value={r?.rejected ?? ""} onChange={(e) => setRow(l.poLineId, { rejected: e.target.value })} />
                  </div>
                </div>
                {rejected > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">{t("reason")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {REJECT_REASON_CODES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={r.reason === c}
                          onClick={() => setRow(l.poLineId, { reason: r.reason === c ? "" : c })}
                          className={cn(
                            "min-h-9 rounded-full border px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            r.reason === c ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-background hover:bg-muted"
                          )}
                        >
                          {tp(`rejectReason.${c}`)}
                        </button>
                      ))}
                    </div>
                    <Input placeholder={t("line_note")} dir="auto" className="h-10 text-sm" value={r.note} onChange={(e) => setRow(l.poLineId, { note: e.target.value })} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="rn" className="text-xs">{t("your_name")}</Label>
          <Input id="rn" dir="auto" className="h-11" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="nt" className="text-xs">{t("note")}</Label>
          <Textarea id="nt" dir="auto" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">{t("signature")}</p>
          <SignaturePad value={signature} onChange={setSignature} clearLabel={t("signature_clear")} placeholderText={t("signature_placeholder")} height={120} />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border bg-muted/30 p-4" aria-live="polite">
        <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <ShieldCheck size={16} className="text-module" aria-hidden="true" />
          {t("verify_title")}
        </p>
        {!challengeId ? (
          <>
            <p className="text-xs text-muted-foreground">{t("verify_body", { phone: data.phoneMasked })}</p>
            {problem && <p className="text-xs text-destructive">{problem}</p>}
            <Button className="h-11 w-full" disabled={busy || Boolean(problem)} onClick={sendCode}>
              {busy ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : null}
              {t("send_code", { phone: data.phoneMasked })}
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t("code_sent", { phone: data.phoneMasked })}</p>
            {testCode && <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">{t("test_code", { code: testCode })}</p>}
            <Label htmlFor="code" className="text-xs">{t("code_label")}</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              dir="ltr"
              className="h-12 text-center text-lg tracking-latin tabular-nums"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[^0-9]/g, ""))}
            />
            <Button className="h-11 w-full" disabled={busy || code.length !== 6 || Boolean(problem)} onClick={confirm}>
              {busy ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : null}
              {t("confirm")}
            </Button>
            <button type="button" className="w-full text-center text-xs text-muted-foreground underline" disabled={busy} onClick={sendCode}>
              {t("resend")}
            </button>
          </>
        )}
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      </section>
    </Shell>
  )
}

function closedReason(code: string): "expired" | "used" | "revoked" | "missing" {
  if (code === "LINK_EXPIRED") return "expired"
  if (code === "LINK_SIGNED") return "used"
  if (code === "LINK_REVOKED") return "revoked"
  return "missing"
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-4 py-6" data-accent="cta">
      <div className="mx-auto max-w-md space-y-6">{children}</div>
    </main>
  )
}
