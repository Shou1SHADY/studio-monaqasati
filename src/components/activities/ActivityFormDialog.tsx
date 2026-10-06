"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Link2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { ChoiceChips } from "@/components/pm/ContractBits"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { ACTIVITY_TYPES, NOTE_MAX, SUMMARY_MAX, activityBlocks, type ActivityTarget, type ActivityType } from "@/lib/activities"
import { ActivityError, createActivity, type ActivityPortal } from "@/lib/activity-writes"
import { todayDay } from "@/lib/pm/format"

export interface ActivityFormDialogProps {
  portal: ActivityPortal
  /** The document it is about, when planned from one. */
  target?: ActivityTarget | null
  onClose: () => void
}

/** Plans a follow-up: what, by when, for whom — and, from a document, about it. */
export function ActivityFormDialog({ portal, target = null, onClose }: ActivityFormDialogProps) {
  const t = useTranslations("Portal.Activities")
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile, organizationId } = useResolvedProfile(user?.uid)
  const { orgMembers } = useOrgMembers(organizationId || null)
  const { toast } = useToast()
  const today = todayDay()
  const [type, setType] = useState<ActivityType>("todo")
  const [summary, setSummary] = useState("")
  const [dueOn, setDueOn] = useState(today)
  const [assigneeId, setAssigneeId] = useState(user?.uid ?? "")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const actorName = ((profile as { name?: string } | null)?.name || user?.displayName || user?.email || "") as string
  const people = useMemo(() => {
    const named = orgMembers.map((m) => ({ id: m.id, name: (m.name || m.email || m.id) as string }))
    return named.some((p) => p.id === user?.uid) ? named : [{ id: user?.uid ?? "", name: actorName }, ...named]
  }, [orgMembers, user?.uid, actorName])
  const blocks = activityBlocks({ type, summary, note, dueOn, assigneeId, today })
  const shown = summary.trim() ? blocks : blocks.filter((b) => b !== "no_summary")

  const save = async () => {
    const assignee = people.find((p) => p.id === assigneeId)
    if (!firestore || !user || !organizationId || !assignee) return
    setBusy(true)
    try {
      await createActivity(firestore, { uid: user.uid, name: actorName }, organizationId, portal, { type, summary, note, dueOn, assignee, target })
      toast({ title: t("created_toast") })
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("add_title")}</DialogTitle>
          <DialogDescription>{t("add_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("f_type")}</Label>
            <ChoiceChips label={t("f_type")} options={ACTIVITY_TYPES.map((x) => ({ id: x, label: t(`type_${x}`) }))} value={type} onChange={setType} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-summary">{t("f_summary")} *</Label>
            <Input id="act-summary" dir="auto" maxLength={SUMMARY_MAX} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t("f_summary_ph")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="act-due">{t("f_due")} *</Label>
              <Input id="act-due" type="date" dir="ltr" min={today} value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-assignee">{t("f_assignee")} *</Label>
              <NativeSelect id="act-assignee" className="w-full" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === user?.uid ? ` ${t("me")}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-note">{t("f_note")}</Label>
            <Textarea id="act-note" dir="auto" rows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("f_note_ph")} />
          </div>
          {target && (
            <p className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              <Link2 size={13} aria-hidden="true" />
              <span>{t("f_target")}:</span>
              <b className="text-foreground" dir="auto">
                {target.label}
              </b>
            </p>
          )}
          <BlockingReasons title={t("cannot_save")} reasons={shown.map((b) => t(`block_${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("close")}
          </Button>
          <Button onClick={() => void save()} disabled={blocks.length > 0 || busy || !organizationId}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
