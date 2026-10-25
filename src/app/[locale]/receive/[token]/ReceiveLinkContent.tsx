"use client"

// The receiver's side (PRD 2.0 RCV-03, G-09). Whoever stands at the truck — with an account or with the link and a code — counts what
// arrived, says how much of it he accepts and, for what he does not, why (damaged · off spec · short in the pack · other), attaches the
// proof (a photo of the shipment, the weighbridge ticket, the mill certificate) and presses «أكّد الاستلام». That press IS the signature
// AND the receipt: the server draws the GR number and lands the goods in the same act, so the page ends on «سُجّل السند». The count is
// blind — the ordered quantity is never sent to this page — and a line left blank did not arrive (it is sent as 0).

import { fitForUpload } from "@/lib/upload-fit"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import { Camera, CheckCircle2, FileText, Loader2, Printer, ShieldCheck, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useUser } from "@/firebase"
import { RECEIVER_REJECT_REASONS } from "@/lib/procurement/receipt-count"
import { receiptPrintInputFromFacts, type ReceiptPrintFacts, type ReceiptPrintInput } from "@/lib/procurement/receipt-print"
import { ReceiptDocumentDialog } from "@/components/procurement/ReceiptDocumentDialog"
import { cn } from "@/lib/utils"
import { Link } from "@/i18n/routing"
import { ReceivePageHead } from "@/components/procurement/receive/ReceivePageHead"

interface LinkData {
  receiverName: string
  phoneMasked: string
  supplierName: string
  poNumber: string | null
  rfqTitle: string
  deliveryDate: string | null
  forwardedBy: string
  note?: string | null
  noNotice?: boolean
  where?: "warehouse" | "project" | "site"
  /** RC-06: where the goods go and for which company (the header strip and the meta row). */
  placeName?: string | null
  address?: string | null
  mapUrl?: string | null
  companyName?: string | null
  noticeNumber?: string | null
  lines: Array<{ poLineId: string; name: string; unit: string }>
  receiverUserId?: string | null
  files?: Array<{ name: string; url: string; kind: "photo" | "ticket" | "cert" }>
}

interface Row {
  arrived: string
  accepted: string
  reason: string
  note: string
}

interface Done {
  docNumber: string
  placeName: string | null
  print: ReceiptPrintFacts
}

/** A quantity typed in either script: Arabic-Indic digits and thousands separators are read as the receiver meant them. */
export function toNum(s: string): number | null {
  const t = (s || "").trim()
  if (!t) return null
  const n = Number(t.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[,٬\s]/g, ""))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** What he accepted: the figure typed, else everything that arrived — the count only splits when he says part was not accepted. */
export const acceptedOf = (r: Pick<Row, "arrived" | "accepted">): number => {
  const arrived = toNum(r.arrived) ?? 0
  return r.accepted.trim() === "" ? arrived : (toNum(r.accepted) ?? arrived)
}

export function ReceiveLinkContent() {
  const { token } = useParams<{ token: string }>()
  const locale = useLocale()
  const t = useTranslations("ReceiveLink")
  const tp = useTranslations("Portal.Procurement")
  const tPrint = useTranslations("Portal.ProcReceipts.print")

  const [data, setData] = useState<LinkData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [receiverName, setReceiverName] = useState("")
  const [note, setNote] = useState("")
  const [files, setFiles] = useState<NonNullable<LinkData["files"]>>([])
  const [uploading, setUploading] = useState(false)
  const { user } = useUser()
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [testCode, setTestCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [doc, setDoc] = useState<ReceiptPrintInput | null>(null)

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
        setFiles(d.files || [])
        setRows(Object.fromEntries(d.lines.map((l) => [l.poLineId, { arrived: "", accepted: "", reason: "", note: "" }])))
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
      const arrived = toNum(r?.arrived ?? "") ?? 0
      const accepted = acceptedOf(r ?? { arrived: "", accepted: "" })
      if (accepted > arrived) return t("err_accepted_over", { name: l.name })
      if (arrived - accepted > 0 && !r?.reason) return t("err_reason_needed", { name: l.name })
    }
    if (!data.lines.some((l) => (toNum(rows[l.poLineId]?.arrived ?? "") ?? 0) > 0)) return t("err_nothing_counted")
    if (receiverName.trim().length < 2) return t("err_name")
    return null
  }, [data, rows, receiverName, t])

  // The member the delivery was forwarded to, signed in as himself: his sign-in is the confirmation.
  const byLogin = Boolean(data?.receiverUserId && user && user.uid === data.receiverUserId)

  const upload = useCallback(
    async (list: FileList | null, kind: "photo" | "ticket" | "cert") => {
      if (!list?.length) return
      setUploading(true)
      setError(null)
      try {
        for (const picked of Array.from(list)) {
          // A phone photo is re-encoded to fit the host's request limit; a PDF over it is refused here.
          const f = await fitForUpload(picked)
          if (!f) {
            setError(t("err_file_big"))
            break
          }
          const fd = new FormData()
          fd.append("file", f)
          fd.append("kind", kind)
          const res = await fetch(`/api/receipt-links/${token}/files`, { method: "POST", body: fd })
          const body = await res.json().catch(() => null)
          if (!res.ok) {
            setError(t(body?.code === "TOO_BIG" ? "err_file_big" : body?.code === "BAD_TYPE" ? "err_file_type" : body?.code === "TOO_MANY" ? "err_file_many" : "err_generic"))
            break
          }
          setFiles((cur) => [...cur, body.data.file])
        }
      } finally {
        setUploading(false)
      }
    },
    [token, t]
  )

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
    if (!data || (!challengeId && !byLogin)) return
    setError(null)
    setBusy(true)
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (byLogin && user) headers.Authorization = `Bearer ${await user.getIdToken()}`
      const res = await fetch(`/api/receipt-links/${token}/sign`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...(byLogin ? {} : { challengeId, code: code.trim() }),
          receiverName: receiverName.trim(),
          note: note.trim() || null,
          signatureData: null,
          lines: data.lines.map((l) => {
            const r = rows[l.poLineId]
            const arrived = toNum(r.arrived) ?? 0
            const rejected = Math.max(0, arrived - acceptedOf(r))
            return { poLineId: l.poLineId, counted: arrived, rejected, rejectReason: rejected > 0 ? r.reason : null, held: 0, holdReason: null, note: rejected > 0 ? r.note.trim() || null : null }
          }),
        }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        setDone({ docNumber: body.data.docNumber, placeName: body.data.placeName ?? null, print: body.data.print })
        return
      }
      if (body?.code === "WRONG_CODE") setError(t("err_wrong_code"))
      else if (body?.code === "CODE_EXPIRED") {
        setError(t("err_code_expired"))
        setChallengeId(null)
        setCode("")
      } else if (body?.code === "OVER_RECEIPT") setError(t("err_over_receipt"))
      else if (res.status === 410) setLoadError(body?.code || "LINK_SIGNED")
      else setError(t("err_generic"))
    } finally {
      setBusy(false)
    }
  }, [data, challengeId, code, receiverName, note, rows, token, t, byLogin, user])

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
    const accepted = done.print.lines.reduce((s, l) => s + (l.accepted ?? 0), 0)
    const rejected = done.print.lines.reduce((s, l) => s + (l.rejected ?? 0), 0)
    const print = () =>
      setDoc(
        receiptPrintInputFromFacts(done.print, {
          locale,
          displayNumber: displayReceiptNumber(done.docNumber, locale),
          displayPoNumber: done.print.poNumber ? displayPoNumber(done.print.poNumber, locale) : null,
          t: (k, p) => tPrint(k as "title", p),
          tp: (k, p) => tp(k as "doc.GR", p),
          now: new Date(),
        })
      )
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="text-success" size={40} aria-hidden="true" />
          <h1 className="text-lg font-bold text-foreground">{t("done_title", { no: displayReceiptNumber(done.docNumber, locale) })}</h1>
          <p className="max-w-sm text-sm text-foreground">
            {t("done_accepted", { qty: accepted })}
            {rejected > 0 ? ` ${t("done_rejected", { qty: rejected })}` : ""}
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {data.where === "project" ? t("done_where_project") : data.where === "site" ? t("done_where_site") : t("done_where_warehouse")}
            {done.placeName ? ` — ${done.placeName}` : ""}. {rejected > 0 ? t("done_rejected_note") : ""}
          </p>
          <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={print}>
            <Printer size={15} aria-hidden="true" />
            {t("done_pdf")}
          </Button>
        </div>
        <ReceiptDocumentDialog input={doc} onOpenChange={(o) => !o && setDoc(null)} />
      </Shell>
    )
  }

  const whereText = data.where === "project" ? t("where_project") : data.where === "site" ? t("where_site") : t("where_warehouse")

  return (
    <Shell>
      <div className="space-y-2">
        <ReceivePageHead
          companyName={data.companyName}
          supplierName={data.supplierName}
          poNumber={data.poNumber}
          noticeNumber={data.noticeNumber}
          rfqTitle={data.rfqTitle}
          placeName={data.placeName}
          address={data.address}
          mapUrl={data.mapUrl}
          deliveryDate={data.deliveryDate}
          localeSwitch={
            <Link href={`/receive/${token}`} locale={locale === "ar" ? "en" : "ar"} className="inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("switch_lang")}
            </Link>
          }
        />
        <p className="pt-1 text-sm text-foreground">{data.noNotice ? t("intro_arrival") : t("intro", { name: data.forwardedBy })}</p>
        {data.note && (
          <p className="mt-2 rounded-lg border border-cta/30 bg-cta/5 p-3 text-sm leading-relaxed text-foreground">
            <b>{t("procurement_note")}:</b> <span dir="auto">{data.note}</span>
          </p>
        )}
      </div>

      <section className="space-y-2" aria-labelledby="lines-h">
        <h2 id="lines-h" className="text-sm font-bold text-foreground">{t("lines_title")}</h2>
        <p className="text-xs text-muted-foreground">{t("blind_note")}</p>
        <p className="text-xs text-muted-foreground">{t("blank_hint")}</p>
        <ul className="space-y-3">
          {data.lines.map((l) => {
            const r = rows[l.poLineId]
            const arrived = toNum(r?.arrived ?? "") ?? 0
            const rejected = Math.max(0, arrived - acceptedOf(r ?? { arrived: "", accepted: "" }))
            return (
              <li key={l.poLineId} className="space-y-3 rounded-xl border bg-card p-4">
                <p className="font-semibold text-foreground">
                  {l.name} <span className="text-xs font-normal text-muted-foreground">({l.unit})</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`c-${l.poLineId}`} className="text-xs">{t("counted")}</Label>
                    <Input id={`c-${l.poLineId}`} inputMode="decimal" dir="ltr" className="h-11 tabular-nums" value={r?.arrived ?? ""} onChange={(e) => setRow(l.poLineId, { arrived: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`a-${l.poLineId}`} className="text-xs">{t("accepted")}</Label>
                    <Input id={`a-${l.poLineId}`} inputMode="decimal" dir="ltr" placeholder={r?.arrived || "0"} className="h-11 tabular-nums" value={r?.accepted ?? ""} onChange={(e) => setRow(l.poLineId, { accepted: e.target.value })} />
                  </div>
                </div>
                {rejected > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">{t("rejected_n", { qty: rejected })}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {RECEIVER_REJECT_REASONS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={r.reason === c}
                          onClick={() => setRow(l.poLineId, { reason: r.reason === c ? "" : c })}
                          className={cn(
                            "min-h-11 rounded-full border px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
      </section>

      <section className="space-y-2" aria-labelledby="files-h">
        <h2 id="files-h" className="text-sm font-bold text-foreground">
          {t("files_title")} <span className="text-xs font-normal text-muted-foreground">({t("optional")})</span>
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {(["photo", "ticket", "cert"] as const).map((k) => (
            <label key={k} className={cn("flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-2 text-center text-xs font-semibold text-muted-foreground hover:border-module/40 hover:text-foreground", uploading && "pointer-events-none opacity-60")}>
              {k === "photo" ? <Camera size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}
              {t(`file_${k}`)}
              <input type="file" className="sr-only" accept={k === "photo" ? "image/*" : "image/*,application/pdf"} capture={k === "photo" ? "environment" : undefined} multiple={k === "photo"} onChange={(e) => void upload(e.target.files, k)} />
            </label>
          ))}
        </div>
        {uploading && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> {t("uploading")}</p>}
        {files.length > 0 && (
          <ul className="space-y-1 text-xs">
            {files.map((f) => (
              <li key={f.url} className="flex items-center gap-2">
                <CheckCircle2 size={12} className="text-success" aria-hidden="true" />
                <a href={f.url} target="_blank" rel="noreferrer" className="truncate text-cta hover:underline">{t(`file_${f.kind}`)} · {f.name}</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-muted/30 p-4" aria-live="polite">
        <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <ShieldCheck size={16} className="text-module" aria-hidden="true" />
          {t("verify_title")}
        </p>
        {byLogin ? (
          <>
            <p className="text-xs text-muted-foreground">{t("verify_login", { name: user?.displayName || receiverName })}</p>
            {problem && <p className="text-xs text-destructive">{problem}</p>}
            <Button className="h-11 w-full" disabled={busy || Boolean(problem)} onClick={confirm}>
              {busy ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : null}
              {t("confirm")}
            </Button>
          </>
        ) : !challengeId ? (
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
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("code_scope")}</p>
            <Button className="h-11 w-full" disabled={busy || code.length !== 6 || Boolean(problem)} onClick={confirm}>
              {busy ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : null}
              {t("confirm")}
            </Button>
            <button type="button" className="w-full text-center text-xs text-muted-foreground underline" disabled={busy} onClick={sendCode}>
              {t("resend")}
            </button>
          </>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("confirm_is_signature")} · {whereText}
        </p>
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
