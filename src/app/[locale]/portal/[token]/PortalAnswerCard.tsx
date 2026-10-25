"use client"

// One record waiting on the consultant, with the one answer it takes. He adds
// and never edits: a choice (and his words where the choice needs them), the
// inspection's day, his reply, the value he certifies or the days he grants —
// nothing of ours is editable here. A fix or a corrective plan he may accept,
// or refuse with his reason (it goes back open). Every answer may carry his
// files (CP-07): they go up through the link's own upload route first.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, FileText, Loader2, Paperclip, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CUT_REASON_ABOVE, CUT_REASONS } from "@/lib/pm/certificate"
import { portalAge, PORTAL_LATE_DAYS } from "@/lib/pm/consultant-portal"
import { letterLabel } from "@/lib/pm/correspondence"
import { pmDate, pmMoney } from "@/lib/pm/format"
import type { PortalAnswer, PortalLine, PortalViewItem } from "@/lib/pm/portal-links"
import { fitForUpload } from "@/lib/upload-fit"
import { cn } from "@/lib/utils"

const CHOICES = { subm: ["appA", "appB", "rej"], wir: ["pass", "cond", "fail"], punch: ["ok", "no"], ncr: ["ok", "no"], claim: ["appr", "part", "rej"] } as const
const NEEDS_NOTE = new Set(["appB", "rej", "cond", "fail", "no"])
const GOOD = "border-success bg-success text-success-foreground"
const WARN = "border-warning bg-warning text-warning-foreground"
const BAD = "border-destructive bg-destructive text-destructive-foreground"
const TONE: Record<string, string> = { appA: GOOD, ok: GOOD, pass: GOOD, appr: GOOD, appB: WARN, cond: WARN, part: WARN, rej: BAD, no: BAD, fail: BAD }

export interface UploadedFile {
  url: string
  name: string
}

export function itemLabel(kind: PortalViewItem["kind"], no: string, locale: string, t: (key: string, values?: Record<string, string>) => string) {
  return t(`no.${kind}`, { no: kind === "corr" ? letterLabel({ dir: "out", no }, locale) : no })
}

export function PortalAnswerCard({
  item,
  today,
  busy,
  onAnswer,
  onUpload,
}: {
  item: PortalViewItem
  today: string
  busy: boolean
  onAnswer: (answer: PortalAnswer) => void
  /** Uploads one file through the link; null when it could not. */
  onUpload: (file: File) => Promise<UploadedFile | null>
}) {
  const t = useTranslations("PmPortal")
  const locale = useLocale()
  const d = item.detail
  const [choice, setChoice] = useState<string>("")
  const [note, setNote] = useState("")
  const [on, setOn] = useState(today)
  const [text, setText] = useState("")
  const [certified, setCertified] = useState("")
  const [reason, setReason] = useState("")
  const [reasonText, setReasonText] = useState("")
  const [ref, setRef] = useState("")
  const [days, setDays] = useState("")
  const [amount, setAmount] = useState("")
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(false)
  const age = portalAge(item.day, today)
  const id = `${item.kind}-${item.no}`

  const lineText = (l: PortalLine | null) => (l ? [l.code, locale === "ar" ? l.descriptionAr || l.descriptionEn : l.descriptionEn || l.descriptionAr].filter(Boolean).join(" · ") : "")
  const row = (label: string, value: string | null | undefined) =>
    value ? (
      <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
        <dt className="shrink-0 text-xs text-muted-foreground sm:w-32">{label}</dt>
        <dd className="text-sm text-foreground" dir="auto">
          {value}
        </dd>
      </div>
    ) : null

  const noteNeeded = NEEDS_NOTE.has(choice) && d.kind !== "claim"
  const noteMissing = noteNeeded && !note.trim()
  const numberOf = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))))

  // Certificate: never above the submitted gross; a deduction above a riyal names its reason, "other" stated.
  const cert = d.kind === "ipc" ? numberOf(certified) : NaN
  const cut = d.kind === "ipc" && Number.isFinite(cert) ? d.gross - cert : 0
  const ipcIssue =
    d.kind !== "ipc" ? null : !(cert > 0) ? "bad_amount" : cert > d.gross + 0.005 ? "over_gross" : cut > CUT_REASON_ABOVE && !reason ? "cut_reason" : cut > CUT_REASON_ABOVE && reason === "oth" && !reasonText.trim() ? "cut_text" : null
  // Claim: days granted unless rejected, on an extension; an amount on a cost claim.
  const claimDays = numberOf(days)
  const claimAmount = numberOf(amount)
  const claimIssue =
    d.kind !== "claim"
      ? null
      : !choice
        ? "no_choice"
        : choice !== "rej" && d.claimKind !== "cost" && !(Number.isInteger(claimDays) && claimDays > 0)
          ? "days_required"
          : choice !== "rej" && d.claimKind !== "time" && !(Number.isFinite(claimAmount) && claimAmount >= 0)
            ? "bad_amount"
            : null

  const attached = files.length ? files : undefined
  const submit = () => {
    if (d.kind === "subm" && choice) onAnswer({ kind: "subm", seq: d.seq, decision: choice as "appA" | "appB" | "rej", note: note.trim() || undefined, files: attached })
    else if (d.kind === "wir" && choice) onAnswer({ kind: "wir", seq: d.seq, result: choice as "pass" | "cond" | "fail", note: note.trim() || undefined, on, files: attached })
    else if ((d.kind === "punch" || d.kind === "ncr") && choice) onAnswer({ kind: d.kind, seq: d.seq, accept: choice === "ok", note: note.trim() || undefined, files: attached })
    else if (d.kind === "corr" && text.trim()) onAnswer({ kind: "corr", seq: d.seq, text: text.trim(), files: attached })
    else if (d.kind === "ipc" && !ipcIssue)
      onAnswer({
        kind: "ipc",
        seq: d.seq,
        certified: cert,
        reason: cut > 0.005 && reason ? (reason as (typeof CUT_REASONS)[number]) : undefined,
        reasonText: reason === "oth" ? reasonText.trim() || undefined : undefined,
        consultantRef: ref.trim() || undefined,
        files: attached,
      })
    else if (d.kind === "claim" && !claimIssue)
      onAnswer({
        kind: "claim",
        seq: d.seq,
        response: choice as "appr" | "part" | "rej",
        days: choice === "rej" || d.claimKind === "cost" ? null : claimDays,
        amount: choice === "rej" || d.claimKind === "time" ? null : claimAmount,
        ref: ref.trim() || undefined,
        files: attached,
      })
  }

  const ready =
    d.kind === "corr"
      ? Boolean(text.trim())
      : d.kind === "ipc"
        ? !ipcIssue
        : d.kind === "claim"
          ? !claimIssue
          : Boolean(choice) && !noteMissing && (d.kind !== "wir" || (Boolean(on) && on <= today))

  const pick = async (list: FileList | null) => {
    const file = list?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(false)
    try {
      const fitted = (await fitForUpload(file)) ?? file
      const up = await onUpload(fitted)
      if (up) setFiles((f) => [...f, up].slice(0, 10))
      else setUploadError(true)
    } finally {
      setUploading(false)
    }
  }

  const choices = d.kind === "corr" || d.kind === "ipc" ? null : CHOICES[d.kind]
  const choiceLabel = (c: string) =>
    c === "ok" ? t(d.kind === "punch" ? "a.confirm_punch" : "a.accept_ncr") : c === "no" ? t("a.reject_note") : d.kind === "claim" ? t(`a.claim_${c}`) : t(`a.${c}`)

  return (
    <li className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">
            <bdi>{itemLabel(item.kind, item.no, locale, t)}</bdi>
          </p>
          {item.title && (
            <p className="text-sm text-foreground" dir="auto">
              {item.title}
            </p>
          )}
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", age > PORTAL_LATE_DAYS ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
          {t("waiting", { count: age })}
        </span>
      </div>

      <dl className="space-y-1.5">
        {d.kind === "subm" && (
          <>
            {row(t("f.item"), lineText(d.item))}
            {row(t("f.what"), d.what)}
            {row(t("f.rev_label"), t("f.rev", { rev: String(d.rev) }))}
            {row(t("f.submitted"), pmDate(d.submittedOn, locale))}
          </>
        )}
        {d.kind === "wir" && (
          <>
            {row(t("f.item"), lineText(d.item))}
            {row(t("f.location"), d.location)}
            {row(t("f.unit"), d.unit)}
            {row(t("f.attempt_label"), t("f.attempt", { n: String(d.attempt) }))}
            {row(t("f.booked"), pmDate(d.bookedOn, locale))}
          </>
        )}
        {d.kind === "punch" && (
          <>
            {row(t("f.location"), d.location)}
            {row(t("f.severity"), t(`sev.${d.severity === "a" ? "a" : "b"}`))}
            {row(t("f.raised"), pmDate(d.raisedOn, locale))}
            {row(t("f.fixed"), d.fixedOn ? pmDate(d.fixedOn, locale) : null)}
            {row(t("f.fix_note"), d.fixNote)}
          </>
        )}
        {d.kind === "corr" && (
          <>
            {row(t("f.sent"), pmDate(d.sentOn, locale))}
            {row(t("f.due_label"), d.due > 0 ? t("f.due", { count: d.due }) : null)}
            {row(t("f.refs"), d.links.join("، "))}
          </>
        )}
        {d.kind === "ncr" && (
          <>
            {row(t("f.item"), lineText(d.item))}
            {row(t("f.what_wrong"), d.what)}
            {row(t("f.severity"), t(`sev.${d.severity === "a" ? "a" : "b"}`))}
            {row(t("f.root"), d.root)}
            {row(t("f.plan"), d.plan)}
            {row(t("f.plan_on"), d.planOn ? pmDate(d.planOn, locale) : null)}
          </>
        )}
        {d.kind === "ipc" && (
          <>
            {row(t("f.period"), [d.periodFrom, d.periodTo].filter(Boolean).map((x) => pmDate(x, locale)).join(" — "))}
            {row(t("f.submitted"), d.submittedOn ? pmDate(d.submittedOn, locale) : null)}
            {row(t("f.your_period"), d.consultantDays !== null ? t("f.days_n", { count: d.consultantDays }) : null)}
          </>
        )}
        {d.kind === "claim" && (
          <>
            {row(t("f.claim_kind"), t(`f.claim_kinds.${d.claimKind}`))}
            {row(t("f.event"), pmDate(d.eventOn, locale))}
            {row(t("f.notice"), d.noticeOn ? pmDate(d.noticeOn, locale) : null)}
            {row(t("f.submitted"), d.submittedOn ? pmDate(d.submittedOn, locale) : null)}
            {row(t("f.days_asked"), d.claimKind !== "cost" && d.daysAsked ? t("f.days_n", { count: d.daysAsked }) : null)}
          </>
        )}
      </dl>

      {d.kind === "ipc" && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <caption className="sr-only">{t("f.lines")}</caption>
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-start font-semibold">{t("f.item")}</th>
                <th className="px-2 py-1.5 text-end font-semibold">{t("f.qty")}</th>
                <th className="px-2 py-1.5 text-end font-semibold">{t("f.rate")}</th>
                <th className="px-2 py-1.5 text-end font-semibold">{t("f.amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.lines.map((l, i) => (
                <tr key={`${l.code}-${i}`}>
                  <td className="px-2 py-1.5" dir="auto">
                    {lineText(l)}
                    {l.unit ? <span className="text-muted-foreground"> · {l.unit}</span> : null}
                  </td>
                  <td className="px-2 py-1.5 text-end tabular-nums" dir="ltr">
                    {l.qty.toLocaleString("en-US")}
                  </td>
                  <td className="px-2 py-1.5 text-end tabular-nums" dir="ltr">
                    {pmMoney(l.rate)}
                  </td>
                  <td className="px-2 py-1.5 text-end tabular-nums" dir="ltr">
                    {pmMoney(l.amount)}
                  </td>
                </tr>
              ))}
              {d.voLines.map((v) => (
                <tr key={`vo-${v.no}`}>
                  <td className="px-2 py-1.5" colSpan={3} dir="auto">
                    {t("f.vo_line", { no: v.no, title: v.title })}
                  </td>
                  <td className="px-2 py-1.5 text-end tabular-nums" dir="ltr">
                    {pmMoney(v.amount)}
                  </td>
                </tr>
              ))}
              {d.cuts > 0 && (
                <tr>
                  <td className="px-2 py-1.5" colSpan={3}>
                    {t("f.cuts")}
                  </td>
                  <td className="px-2 py-1.5 text-end tabular-nums" dir="ltr">
                    {pmMoney(d.cuts)}
                  </td>
                </tr>
              )}
              <tr className="bg-muted/30 font-bold">
                <td className="px-2 py-1.5" colSpan={3}>
                  {t("f.gross")}
                </td>
                <td className="px-2 py-1.5 text-end tabular-nums" dir="ltr">
                  {pmMoney(d.gross)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {d.files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("f.files")}>
          {d.files.map((f) => (
            <li key={f.url}>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-2.5 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <FileText size={13} aria-hidden="true" />
                <span dir="auto" className="max-w-[12rem] truncate">
                  {f.name}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 border-t pt-3">
        {d.kind === "punch" && <p className="text-xs text-muted-foreground">{t("a.punch_hint")}</p>}
        {d.kind === "ncr" && <p className="text-xs text-muted-foreground">{t("a.ncr_hint")}</p>}
        {d.kind === "ipc" && <p className="text-xs text-muted-foreground">{t("a.ipc_hint")}</p>}
        {d.kind === "claim" && <p className="text-xs text-muted-foreground">{t("a.claim_hint")}</p>}
        {choices && (
          <div className={cn("grid gap-1.5", choices.length === 2 ? "grid-cols-2" : "grid-cols-3")} role="group" aria-label={t("a.choose")}>
            {choices.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={choice === c}
                disabled={busy}
                onClick={() => setChoice(choice === c ? "" : c)}
                className={cn(
                  "min-h-11 rounded-lg border px-2 py-1.5 text-xs font-bold leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60",
                  choice === c ? TONE[c] : "border-border bg-background text-foreground hover:bg-muted"
                )}
              >
                {choiceLabel(c)}
              </button>
            ))}
          </div>
        )}
        {d.kind === "wir" && (
          <div className="space-y-1">
            <Label htmlFor={`on-${id}`} className="text-xs">
              {t("a.result_on")}
            </Label>
            <Input id={`on-${id}`} type="date" dir="ltr" max={today} className="h-11" value={on} disabled={busy} onChange={(e) => setOn(e.target.value)} />
          </div>
        )}
        {d.kind === "ipc" && (
          <>
            <div className="space-y-1">
              <Label htmlFor={`cert-${id}`} className="text-xs">
                {t("a.certified")}
              </Label>
              <Input id={`cert-${id}`} type="text" inputMode="decimal" dir="ltr" className="h-11" value={certified} disabled={busy} onChange={(e) => setCertified(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("a.certified_max", { amount: pmMoney(d.gross) })}</p>
            </div>
            {cut > 0.005 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">{cut > CUT_REASON_ABOVE ? t("a.cut_reason_required") : t("a.cut_reason")}</p>
                <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={t("a.cut_reason")}>
                  {CUT_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={reason === r}
                      disabled={busy}
                      onClick={() => setReason(reason === r ? "" : r)}
                      className={cn(
                        "min-h-11 rounded-lg border px-2 py-1.5 text-xs font-bold leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60",
                        reason === r ? WARN : "border-border bg-background text-foreground hover:bg-muted"
                      )}
                    >
                      {t(`a.cut_reasons.${r}`)}
                    </button>
                  ))}
                </div>
                {reason === "oth" && (
                  <Input aria-label={t("a.cut_note")} placeholder={t("a.cut_note")} dir="auto" className="h-11" maxLength={500} value={reasonText} disabled={busy} onChange={(e) => setReasonText(e.target.value)} />
                )}
              </div>
            )}
          </>
        )}
        {d.kind === "claim" && choice && choice !== "rej" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {d.claimKind !== "cost" && (
              <div className="space-y-1">
                <Label htmlFor={`days-${id}`} className="text-xs">
                  {t("a.days")}
                </Label>
                <Input id={`days-${id}`} type="text" inputMode="numeric" dir="ltr" className="h-11" value={days} disabled={busy} onChange={(e) => setDays(e.target.value)} />
              </div>
            )}
            {d.claimKind !== "time" && (
              <div className="space-y-1">
                <Label htmlFor={`amount-${id}`} className="text-xs">
                  {t("a.amount")}
                </Label>
                <Input id={`amount-${id}`} type="text" inputMode="decimal" dir="ltr" className="h-11" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
              </div>
            )}
          </div>
        )}
        {(d.kind === "ipc" || d.kind === "claim") && (
          <div className="space-y-1">
            <Label htmlFor={`ref-${id}`} className="text-xs">
              {t(d.kind === "ipc" ? "a.cons_ref" : "a.letter_ref")}
            </Label>
            <Input id={`ref-${id}`} dir="auto" className="h-11" maxLength={80} value={ref} disabled={busy} onChange={(e) => setRef(e.target.value)} />
          </div>
        )}
        {d.kind !== "corr" && d.kind !== "ipc" && d.kind !== "claim" && (
          <div className="space-y-1">
            <Label htmlFor={`note-${id}`} className="text-xs">
              {noteNeeded ? t("a.note_required") : t("a.note")}
            </Label>
            <Textarea id={`note-${id}`} dir="auto" rows={2} maxLength={1000} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        {d.kind === "corr" && (
          <div className="space-y-1">
            <Label htmlFor={`reply-${id}`} className="text-xs">
              {t("a.reply")}
            </Label>
            <Textarea id={`reply-${id}`} dir="auto" rows={3} maxLength={2000} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
          </div>
        )}

        <div className="space-y-1.5">
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <li key={f.url} className="flex max-w-full items-center gap-1 rounded-lg border bg-muted/40 py-1 pe-1 ps-2 text-xs">
                  <FileText size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 truncate" dir="auto">
                    {f.name}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    aria-label={t("a.remove_file", { name: f.name })}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label
            className={cn(
              "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-3 text-xs text-muted-foreground hover:bg-muted focus-within:ring-2 focus-within:ring-ring",
              (busy || uploading || files.length >= 10) && "pointer-events-none opacity-60"
            )}
          >
            {uploading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Paperclip size={14} aria-hidden="true" />}
            {uploading ? t("a.uploading") : t("a.attach")}
            <input type="file" accept="image/*,application/pdf" className="sr-only" disabled={busy || uploading} onChange={(e) => void pick(e.target.files)} />
          </label>
          {uploadError && (
            <p className="text-xs text-destructive" role="alert">
              {t("a.upload_failed")}
            </p>
          )}
        </div>

        {ipcIssue && certified.trim() !== "" && ipcIssue !== "bad_amount" && <p className="text-xs text-destructive">{t(`block.${ipcIssue}`)}</p>}
        <Button className="h-11 w-full gap-1.5" disabled={busy || uploading || !ready} onClick={submit}>
          {busy ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          {d.kind === "corr" ? t("a.send_reply") : d.kind === "ipc" ? t("a.certify") : t("a.submit")}
        </Button>
      </div>
    </li>
  )
}
