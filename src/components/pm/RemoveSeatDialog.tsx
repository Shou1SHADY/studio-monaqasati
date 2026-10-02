"use client"

// Remove someone from the project (TM-01): a stated reason and an exit date of
// today or earlier. Access ends at once; what they recorded or approved stays
// in their name — the seat is closed, never deleted.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError, type PmSeat } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { removeBlocks } from "@/lib/pm/team"
import { PmTeamError, removeSeat, type TeamActor } from "@/lib/pm/team-writes"

export function RemoveSeatDialog({
  open,
  onOpenChange,
  projectId,
  access,
  actor,
  seat,
  name,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  access: PmAccess
  actor: TeamActor
  seat: PmSeat
  name: string
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [exitDate, setExitDate] = useState(today)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setExitDate(todayDay())
      setReason("")
    }
  }, [open])

  const blocks = useMemo(
    () => removeBlocks({ seat, exitDate: exitDate || null, reason, today, admin: access.ctx.ceiling.has("admin") }),
    [seat, exitDate, reason, today, access.ctx.ceiling]
  )

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      await removeSeat(firestore, access.ctx, projectId, actor, seat.uid, { exitDate, reason })
      toast({ title: t("team.removed", { name }) })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmTeamError && err.blocks[0] ? `team.block.${err.blocks[0]}` : "error.save"
      toast({ title: t(msg), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("team.remove_title", { name })}</DialogTitle>
          <DialogDescription>{t("team.remove_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {seat.role === "pm" && <Callout tone="warn">{t("team.remove_pm_note")}</Callout>}
          <div className="space-y-1.5">
            <Label htmlFor="seat-exit">{t("team.exit_date")}</Label>
            <Input id="seat-exit" type="date" max={today} dir="ltr" value={exitDate} onChange={(e) => setExitDate(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seat-why">{t("team.exit_reason")}</Label>
            <Textarea id="seat-why" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`team.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("team.remove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
