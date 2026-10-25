"use client"

// Where the consultant's reply came from (CP-10) and what he refused (PN-04 /
// NCR-02). Every reply the portal recorded carries `viaPortal`; one recorded
// from his letter names its recorder on the row already. A refusal of a fix or
// a corrective plan — by the portal or from his letter — reopens the record and
// stays on it as history; quality records one from his letter here.

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Link2, Loader2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Callout } from "@/components/module-ui/Callout"
import { StatusPill } from "@/components/module-ui/StatusPill"
import type { PmAttachment } from "@/lib/pm/attachments"
import type { PortalRejection } from "@/lib/pm/consultant-portal"
import { pmDate, todayDay } from "@/lib/pm/format"
import { AttachmentTag, PmFilesField } from "./PmAttachments"

/** «ردّ عبر البوابة · date» beside a reply the portal recorded; nothing otherwise. */
export function ReplySource({ viaPortal, on }: { viaPortal?: boolean | null; on?: string | null }) {
  const t = useTranslations("Portal.PM.reply")
  const locale = useLocale()
  if (!viaPortal) return null
  return (
    <StatusPill tone="module">
      <Link2 size={12} aria-hidden="true" />
      {on ? t("via_portal_on", { date: pmDate(on, locale) }) : t("via_portal")}
    </StatusPill>
  )
}

/** The consultant's refusals on a record, oldest first: his reason, the day, and the door it came by. */
export function RejectsHistory({ rejects, kind }: { rejects?: PortalRejection[] | null; kind: "fix" | "plan" }) {
  const t = useTranslations("Portal.PM.reply")
  const locale = useLocale()
  if (!rejects?.length) return null
  return (
    <ul className="mt-1.5 space-y-1 border-s-2 border-destructive/30 ps-2" aria-label={t(kind === "fix" ? "rejects_fix" : "rejects_plan")}>
      {rejects.map((r, i) => (
        <li key={`${r.on}-${i}`} className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-semibold text-destructive">{t(kind === "fix" ? "refused_fix_on" : "rejected_plan_on", { date: pmDate(r.on, locale) })}</span>
          <span dir="auto">— {r.note}</span>
          {r.viaPortal ? <ReplySource viaPortal /> : <span>{t("from_letter", { name: r.byName || "—" })}</span>}
          <AttachmentTag files={r.files} />
        </li>
      ))}
    </ul>
  )
}

/** Record the consultant's refusal from his letter: his reason (required), the letter's day, his letter (optional). */
export function RefuseDialog({
  open,
  onOpenChange,
  kind,
  title,
  orgId,
  folder,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: "fix" | "plan"
  /** The record's number and title. */
  title: string
  orgId?: string | null
  folder: string
  onSave: (input: { note: string; on: string; files: PmAttachment[] }) => Promise<boolean>
}) {
  const t = useTranslations("Portal.PM.reply")
  const today = todayDay()
  const [note, setNote] = useState("")
  const [on, setOn] = useState(today)
  const [files, setFiles] = useState<PmAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (open) {
      setNote("")
      setOn(todayDay())
      setFiles([])
      setTried(false)
    }
  }, [open])

  const missing = !note.trim()
  const badDay = !on || on > today
  const save = async () => {
    setTried(true)
    if (missing || badDay) return
    setBusy(true)
    try {
      if (await onSave({ note: note.trim(), on, files })) onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(kind === "fix" ? "refuse_fix_title" : "reject_plan_title")}</DialogTitle>
          <DialogDescription dir="auto">{title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Callout tone="warn">{t(kind === "fix" ? "refuse_fix_desc" : "reject_plan_desc")}</Callout>
          <div className="space-y-1.5">
            <Label htmlFor="cr-note">
              {t("reason")} <span className="text-destructive">*</span>
            </Label>
            <Textarea id="cr-note" dir="auto" rows={3} maxLength={1000} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} aria-invalid={tried && missing} />
            {tried && missing && (
              <p className="text-xs text-destructive" role="alert">
                {t("reason_required")}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-on">{t("letter_on")}</Label>
            <Input id="cr-on" type="date" dir="ltr" max={today} className="h-11" value={on} disabled={busy} onChange={(e) => setOn(e.target.value)} aria-invalid={tried && badDay} />
            {tried && badDay && (
              <p className="text-xs text-destructive" role="alert">
                {t("bad_day")}
              </p>
            )}
          </div>
          <PmFilesField orgId={orgId} folder={folder} value={files} onChange={setFiles} label={t("letter_file")} disabled={busy} />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void save()}>
            {busy ? <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" /> : <Undo2 size={15} className="me-1.5 rtl-flip" aria-hidden="true" />}
            {t(kind === "fix" ? "refuse_fix_save" : "reject_plan_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
