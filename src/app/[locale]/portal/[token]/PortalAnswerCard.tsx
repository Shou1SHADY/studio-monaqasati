"use client"

// One record waiting on the consultant, with the one answer it takes. He adds
// and never edits: a choice (and his words where the choice needs them), the
// inspection's day, or his reply — nothing of ours is editable here.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, FileText, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { portalAge, PORTAL_LATE_DAYS } from "@/lib/pm/consultant-portal"
import { letterLabel } from "@/lib/pm/correspondence"
import { pmDate } from "@/lib/pm/format"
import type { PortalAnswer, PortalLine, PortalViewItem } from "@/lib/pm/portal-links"
import { cn } from "@/lib/utils"

const CHOICES = { subm: ["appA", "appB", "rej"], wir: ["pass", "cond", "fail"] } as const
const NEEDS_NOTE = new Set(["appB", "rej", "cond", "fail"])
const TONE: Record<string, string> = {
  appA: "border-success bg-success text-success-foreground",
  pass: "border-success bg-success text-success-foreground",
  appB: "border-warning bg-warning text-warning-foreground",
  cond: "border-warning bg-warning text-warning-foreground",
  rej: "border-destructive bg-destructive text-destructive-foreground",
  fail: "border-destructive bg-destructive text-destructive-foreground",
}

export function itemLabel(kind: PortalViewItem["kind"], no: string, locale: string, t: (key: string, values?: Record<string, string>) => string) {
  return t(`no.${kind}`, { no: kind === "corr" ? letterLabel({ dir: "out", no }, locale) : no })
}

export function PortalAnswerCard({
  item,
  today,
  busy,
  onAnswer,
}: {
  item: PortalViewItem
  today: string
  busy: boolean
  onAnswer: (answer: PortalAnswer) => void
}) {
  const t = useTranslations("PmPortal")
  const locale = useLocale()
  const d = item.detail
  const [choice, setChoice] = useState<string>("")
  const [note, setNote] = useState("")
  const [on, setOn] = useState(today)
  const [text, setText] = useState("")
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

  const noteNeeded = NEEDS_NOTE.has(choice)
  const noteMissing = noteNeeded && !note.trim()

  const submit = () => {
    if (d.kind === "subm" && choice) onAnswer({ kind: "subm", seq: d.seq, decision: choice as "appA" | "appB" | "rej", note: note.trim() || undefined })
    else if (d.kind === "wir" && choice) onAnswer({ kind: "wir", seq: d.seq, result: choice as "pass" | "cond" | "fail", note: note.trim() || undefined, on })
    else if (d.kind === "punch") onAnswer({ kind: "punch", seq: d.seq })
    else if (d.kind === "corr" && text.trim()) onAnswer({ kind: "corr", seq: d.seq, text: text.trim() })
    else if (d.kind === "ncr") onAnswer({ kind: "ncr", seq: d.seq, accept: true })
  }

  const ready = d.kind === "punch" || d.kind === "ncr" ? true : d.kind === "corr" ? Boolean(text.trim()) : Boolean(choice) && !noteMissing && (d.kind !== "wir" || (Boolean(on) && on <= today))

  return (
    <li className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">
            <bdi>{itemLabel(item.kind, item.no, locale, t)}</bdi>
          </p>
          <p className="text-sm text-foreground" dir="auto">
            {item.title}
          </p>
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
      </dl>

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
        {(d.kind === "subm" || d.kind === "wir") && (
          <>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={t("a.choose")}>
              {CHOICES[d.kind].map((c) => (
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
                  {t(`a.${c}`)}
                </button>
              ))}
            </div>
            {d.kind === "wir" && (
              <div className="space-y-1">
                <Label htmlFor={`on-${id}`} className="text-xs">
                  {t("a.result_on")}
                </Label>
                <Input id={`on-${id}`} type="date" dir="ltr" max={today} className="h-11" value={on} disabled={busy} onChange={(e) => setOn(e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor={`note-${id}`} className="text-xs">
                {noteNeeded ? t("a.note_required") : t("a.note")}
              </Label>
              <Textarea id={`note-${id}`} dir="auto" rows={2} maxLength={1000} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
            </div>
          </>
        )}
        {d.kind === "corr" && (
          <div className="space-y-1">
            <Label htmlFor={`reply-${id}`} className="text-xs">
              {t("a.reply")}
            </Label>
            <Textarea id={`reply-${id}`} dir="auto" rows={3} maxLength={2000} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
          </div>
        )}
        {d.kind === "punch" && <p className="text-xs text-muted-foreground">{t("a.punch_hint")}</p>}
        {d.kind === "ncr" && <p className="text-xs text-muted-foreground">{t("a.ncr_hint")}</p>}
        <Button className="h-11 w-full gap-1.5" disabled={busy || !ready} onClick={submit}>
          {busy ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          {d.kind === "punch" ? t("a.confirm_punch") : d.kind === "ncr" ? t("a.accept_ncr") : d.kind === "corr" ? t("a.send_reply") : t("a.submit")}
        </Button>
      </div>
    </li>
  )
}
