"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarClock, CheckCheck, CheckSquare, FileUp, Link2, Loader2, Mail, Phone, Users, X, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Link } from "@/i18n/routing"
import { NOTE_MAX, bucketOf, dueLabel, isOpen, mayManage, rescheduleBlock, type Activity, type ActivityType } from "@/lib/activities"
import { ActivityError, cancelActivity, completeActivity, rescheduleActivity, type ActivityActor, type ActivityPortal } from "@/lib/activity-writes"
import { pmDate } from "@/lib/pm/format"
import { cn } from "@/lib/utils"

export const TYPE_ICON: Record<ActivityType, LucideIcon> = { todo: CheckSquare, call: Phone, meeting: Users, email: Mail, document: FileUp }
const DUE_TONE: Record<"overdue" | "today" | "planned", PillTone> = { overdue: "bad", today: "warn", planned: "mute" }

export interface ActivityRowProps {
  activity: Activity
  today: string
  actor: ActivityActor
  portal: ActivityPortal
  /** Show who it is for (the list of what I planned) instead of who planned it. */
  forOthers?: boolean
}

export function ActivityRow({ activity: a, today, actor, portal, forOthers }: ActivityRowProps) {
  const t = useTranslations("Portal.Activities")
  const locale = useLocale()
  const [dialog, setDialog] = useState<"done" | "move" | null>(null)
  const Icon = TYPE_ICON[a.type]
  const open = isOpen(a)
  const bucket = bucketOf(a, today)
  const due = dueLabel(a, today)
  const manage = mayManage(a, actor.uid, Boolean(actor.isOwner))

  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3">
      <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", open && bucket === "overdue" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
        <Icon size={15} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold" dir="auto">
          {a.summary}
        </p>
        <p className="text-xs text-muted-foreground" dir="auto">
          {t(`type_${a.type}`)} · {forOthers ? t("assigned_to", { name: a.assigneeName || "—" }) : t("assigned_by", { name: a.createdByName || "—" })}
          {a.status === "done" && a.doneByName ? ` · ${t("done_by", { name: a.doneByName, date: pmDate(a.doneOn, locale) })}` : ""}
          {a.status === "cancelled" ? ` · ${t("cancelled")}` : ""}
        </p>
        {a.note && (
          <p className="mt-1 whitespace-pre-line text-xs text-foreground/80" dir="auto">
            {a.note}
          </p>
        )}
        {a.feedback && (
          <p className="mt-1 rounded-md bg-success/10 px-2 py-1 text-xs text-success" dir="auto">
            {a.feedback}
          </p>
        )}
        {a.target && (
          <Link href={a.target.href} className="mt-1 inline-flex items-center gap-1 rounded text-xs font-semibold text-cta underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Link2 size={12} aria-hidden="true" />
            <span dir="auto">{a.target.label}</span>
          </Link>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {open ? (
          <StatusPill tone={DUE_TONE[bucket]}>{t(`due_${due.kind}`, { n: due.days })}</StatusPill>
        ) : (
          <StatusPill tone={a.status === "done" ? "ok" : "mute"}>{t(a.status === "done" ? "status_done" : "status_cancelled")}</StatusPill>
        )}
        {open && manage && (
          <>
            <Button size="sm" onClick={() => setDialog("done")}>
              <CheckCheck size={14} className="me-1" aria-hidden="true" />
              {t("done")}
            </Button>
            <Button size="icon" variant="outline" className="h-9 w-9" aria-label={t("reschedule")} title={t("reschedule")} onClick={() => setDialog("move")}>
              <CalendarClock size={15} aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
      {dialog === "done" && <DoneDialog activity={a} actor={actor} portal={portal} onClose={() => setDialog(null)} />}
      {dialog === "move" && <MoveDialog activity={a} actor={actor} today={today} onClose={() => setDialog(null)} />}
    </div>
  )
}

function DoneDialog({ activity, actor, portal, onClose }: { activity: Activity; actor: ActivityActor; portal: ActivityPortal; onClose: () => void }) {
  const t = useTranslations("Portal.Activities")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [feedback, setFeedback] = useState("")
  const [busy, setBusy] = useState(false)

  const fail = (err: unknown) => {
    console.error(err)
    toast({ title: t("save_failed"), variant: "destructive" })
  }
  const save = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      await completeActivity(firestore, actor, portal, activity.id, feedback)
      toast({ title: t("done_toast") })
      onClose()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }
  const cancel = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      await cancelActivity(firestore, actor, activity.id)
      toast({ title: t("cancelled_toast") })
      onClose()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("done_title")}</DialogTitle>
          <DialogDescription dir="auto">{activity.summary}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="act-feedback">{t("feedback_label")}</Label>
          <Textarea id="act-feedback" dir="auto" rows={3} maxLength={NOTE_MAX} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t("feedback_ph")} />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void cancel()} disabled={busy}>
            <X size={14} className="me-1" aria-hidden="true" />
            {t("cancel_activity")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              {t("close")}
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
              {t("mark_done")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MoveDialog({ activity, actor, today, onClose }: { activity: Activity; actor: ActivityActor; today: string; onClose: () => void }) {
  const t = useTranslations("Portal.Activities")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [dueOn, setDueOn] = useState(activity.dueOn < today ? today : activity.dueOn)
  const [busy, setBusy] = useState(false)
  const block = rescheduleBlock(dueOn, today)

  const save = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      await rescheduleActivity(firestore, actor, activity.id, dueOn)
      toast({ title: t("rescheduled_toast") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: err instanceof ActivityError && err.code === "blocked" ? t(`block_${err.blocks[0]}`) : t("save_failed"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("reschedule_title")}</DialogTitle>
          <DialogDescription dir="auto">{activity.summary}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="act-move">{t("new_day")}</Label>
          <Input id="act-move" type="date" dir="ltr" min={today} value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </div>
        <BlockingReasons title={t("cannot_save")} reasons={block ? [t(`block_${block}`)] : []} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("close")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || block !== null}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
