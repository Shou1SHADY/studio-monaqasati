"use client"

// The RFQ's life after it is published (Procurement 2.0 RFQ-13…15, WF-26): «مدّد» / «أعد فتحه» with a later date, «ألغِ الطلب»
// with a reason, «ذكّر من لم يقدّم». Each runs ONE server act (`/api/procurement/rfq/lifecycle`) and says its refusal in the dialog.

import { useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Copy, Loader2, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/module-ui/Callout"
import { Chip } from "@/components/module-ui/Chip"
import { lifecycleCall, RfqRouteError } from "@/lib/procurement/rfq-lifecycle-client"
import type { LifecycleResult } from "@/lib/procurement/rfq-server/lifecycle"
import { CANCEL_OTHER_MIN, RFQ_CANCEL_CODES, type RfqCancelCode } from "@/lib/procurement/rfq-detail"
import { earliestNewDeadline } from "@/lib/procurement/rfq-no-live"
import { fmtDayLong } from "@/lib/procurement/format"

export interface DialogRfq {
  id: string
  title?: string | null
  rfqNumber?: string | null
  deadline?: string | null
}

function useRefusal() {
  const tProc = useTranslations("Portal.Procurement")
  const t = useTranslations("Portal.Procurement.rfqlife")
  return (err: unknown): string => {
    const reason = err instanceof RfqRouteError ? err.reason : ""
    if (reason && tProc.has(`err_${reason}`)) return tProc(`err_${reason}`)
    return t("failed")
  }
}

function Shell({
  open,
  onOpenChange,
  title,
  sub,
  children,
  error,
  busy,
  submitLabel,
  disabled,
  onSubmit,
  destructive,
  hideSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  sub?: string
  children: ReactNode
  error: string | null
  busy: boolean
  submitLabel: string
  disabled: boolean
  onSubmit: () => void
  destructive?: boolean
  hideSubmit?: boolean
}) {
  const locale = useLocale()
  const t = useTranslations("Portal.Procurement.rfqlife")
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle>{title}</DialogTitle>
          {sub && <DialogDescription>{sub}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {children}
          {error && <Callout tone="block">{error}</Callout>}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {hideSubmit ? t("close") : t("back")}
          </Button>
          {!hideSubmit && (
            <Button onClick={onSubmit} disabled={busy || disabled} variant={destructive ? "destructive" : "default"} className="gap-2">
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {submitLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** «مدّد» while the round is open, «أعد فتحه» once its date has passed — one dialog, one act. */
export function ExtendRfqDialog({ open, onOpenChange, rfq, reopen, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; rfq: DialogRfq; reopen: boolean; onDone: (r: LifecycleResult) => void }) {
  const t = useTranslations("Portal.Procurement.rfqlife")
  const refusal = useRefusal()
  const min = earliestNewDeadline(rfq.deadline)
  const [date, setDate] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= min
  const submit = async () => {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const res = await lifecycleCall({ action: reopen ? "reopen" : "extend", rfqId: rfq.id, deadline: date })
      setDate("")
      onDone(res)
    } catch (err) {
      setError(refusal(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell open={open} onOpenChange={onOpenChange} title={reopen ? t("reopen_title") : t("extend_title")} sub={reopen ? t("reopen_sub") : t("extend_sub")} error={error} busy={busy} submitLabel={reopen ? t("reopen") : t("extend")} disabled={!valid} onSubmit={submit}>
      <div className="space-y-1.5">
        <Label htmlFor="rfq-new-deadline" className="text-xs font-bold">
          {t("new_deadline")} <span className="text-destructive">*</span>
        </Label>
        <Input id="rfq-new-deadline" type="date" min={min} dir="ltr" className="h-10 max-w-xs" value={date} onChange={(e) => setDate(e.target.value)} aria-required="true" />
        <p className="text-[11px] text-muted-foreground">{date && !valid ? t("err_date") : t("date_hint")}</p>
      </div>
    </Shell>
  )
}

export function CancelRfqDialog({ open, onOpenChange, rfq, hasNeeds, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; rfq: DialogRfq; hasNeeds: boolean; onDone: (r: LifecycleResult) => void }) {
  const t = useTranslations("Portal.Procurement.rfqlife")
  const refusal = useRefusal()
  const [code, setCode] = useState<RfqCancelCode | "">("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = code !== "" && (code !== "other" || note.trim().length >= CANCEL_OTHER_MIN)
  const submit = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const res = await lifecycleCall({ action: "cancel", rfqId: rfq.id, code, ...(code === "other" ? { note: note.trim() } : {}) })
      setCode("")
      setNote("")
      onDone(res)
    } catch (err) {
      setError(refusal(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell open={open} onOpenChange={onOpenChange} title={t("cancel_title", { number: rfq.rfqNumber || rfq.title || "" })} sub={t("cancel_sub")} error={error} busy={busy} submitLabel={t("cancel_submit")} disabled={!ready} onSubmit={submit} destructive>
      <div className="space-y-1.5">
        <p className="text-xs font-bold">
          {t("cancel_reason")} <span className="text-destructive">*</span>
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("cancel_reason")}>
          {RFQ_CANCEL_CODES.map((c) => (
            <Chip key={c} role="radio" aria-checked={code === c} selected={code === c} onClick={() => setCode(c)}>
              {t(`cancel_code_${c}`)}
            </Chip>
          ))}
        </div>
        {code === "other" && <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("cancel_other_ph")} aria-label={t("cancel_other_ph")} dir="auto" />}
      </div>
      {hasNeeds && <Callout tone="info">{t("cancel_back")}</Callout>}
    </Shell>
  )
}

/** «ذكّر من لم يقدّم»: the platform's suppliers are told at once; for one off the platform the dialog hands over the message with the link. */
export function RemindRfqDialog({ open, onOpenChange, rfq, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; rfq: DialogRfq; onDone: (r: LifecycleResult) => void }) {
  const t = useTranslations("Portal.Procurement.rfqlife")
  const locale = useLocale()
  const refusal = useRefusal()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<LifecycleResult | null>(null)
  const [copied, setCopied] = useState(false)
  const date = rfq.deadline ? fmtDayLong(rfq.deadline.slice(0, 10), locale) : ""
  const message = result?.link ? t("remind_message", { title: rfq.title || rfq.rfqNumber || "", date, url: result.link }) : ""
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await lifecycleCall({ action: "remind", rfqId: rfq.id })
      setResult(res)
      onDone(res)
    } catch (err) {
      setError(refusal(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setResult(null)
          setCopied(false)
          setError(null)
        }
        onOpenChange(o)
      }}
      title={t("remind_title")}
      sub={t("remind_sub")}
      error={error}
      busy={busy}
      submitLabel={t("remind")}
      disabled={false}
      onSubmit={submit}
      hideSubmit={Boolean(result)}
    >
      {result ? (
        <div className="space-y-3">
          <Callout tone="info">{t("remind_told", { count: result.told ?? 0 })}</Callout>
          {message && (
            <div className="space-y-2">
              <p className="text-xs font-bold">{t("remind_link_label")}</p>
              <p className="select-all rounded-md border bg-muted/40 p-2 text-xs" dir="auto">
                {message}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    void navigator.clipboard?.writeText(message)
                    setCopied(true)
                  }}
                >
                  <Copy size={14} aria-hidden="true" /> {copied ? t("copied") : t("copy")}
                </Button>
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                    <MessageCircle size={14} aria-hidden="true" /> {t("whatsapp")}
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <ul className="space-y-1 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
          <li>{t("remind_effect_platform")}</li>
          <li>{t("remind_effect_link")}</li>
        </ul>
      )}
    </Shell>
  )
}
