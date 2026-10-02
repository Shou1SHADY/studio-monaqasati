"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { ArrowRightLeft, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { REASSIGN_REASONS, reassignBlocks, type HandoverCandidate, type PmHandover, type ReassignReason } from "@/lib/pm/handover"
import { reassignHandover, type PmActor } from "@/lib/pm/handover-writes"
import { cn } from "@/lib/utils"

function Choice({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex min-h-11 items-start gap-2.5 rounded-lg border px-3 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-module bg-module/10" : "hover:border-module/40"
      )}
    >
      <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border", on ? "border-module bg-module text-module-foreground" : "border-input")}>
        {on && <Check size={13} aria-hidden="true" />}
      </span>
      <span className="min-w-0">
        <b className="block font-semibold">{title}</b>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
    </button>
  )
}

/** Pass a handover to another manager with a reason (HO-04). It rejects the
 * assignment, not the project: it stays in "New projects" and does not go back to CRM. */
export function ReassignHandoverDialog({
  open,
  onOpenChange,
  handover,
  actor,
  candidates,
  myLive,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  handover: PmHandover
  actor: PmActor
  /** Project managers and the owner, without the manager it is addressed to now. */
  candidates: HandoverCandidate[]
  /** The live projects the addressed manager already runs — the load hint. */
  myLive: number
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [to, setTo] = useState("")
  const [reason, setReason] = useState<ReassignReason | null>(null)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setTo("")
      setReason(null)
      setText("")
    }
  }, [open])

  const blocks = reason ? reassignBlocks(handover, to, reason, text).map((b) => t(`reassign.block.${b}`)) : []
  const target = candidates.find((m) => m.uid === to)
  const ready = Boolean(reason && target && !blocks.length)

  const save = async () => {
    if (!firestore || !reason || !target || blocks.length) return
    setBusy(true)
    try {
      await reassignHandover(firestore, actor, handover.id, {
        to,
        toName: target.name,
        reason,
        reasonText: text.trim() || null,
        notification: { title: t("notif.reassigned_title"), message: t("notif.reassigned_message", { project: handover.title, by: actor.name ?? "" }) },
      })
      toast({ title: t("reassign.done_long", { name: target.name, reason: t(`reassign.reasons.${reason}`) }) })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("reassign.title")}</DialogTitle>
          <DialogDescription dir="auto">{t("reassign.sub", { project: handover.title })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Callout tone="info">{t("reassign.intro")}</Callout>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t("reassign.reason")} <span className="text-destructive">*</span>
            </legend>
            <div className="grid gap-2">
              {REASSIGN_REASONS.map((r) => (
                <Choice key={r} on={reason === r} onClick={() => setReason(r)} title={t(`reassign.reasons.${r}`)} sub={r === "load" ? t("reassign.load_hint", { count: myLive }) : undefined} />
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t("reassign.to_who")} <span className="text-destructive">*</span>
            </legend>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("reassign.no_candidates")}</p>
            ) : (
              <div className="grid gap-2">
                {candidates.map((c) => (
                  <Choice key={c.uid} on={to === c.uid} onClick={() => setTo(c.uid)} title={c.name} sub={`${t(`seat.${c.seat}.name`)} · ${t("reassign.live", { count: c.live })}`} />
                ))}
              </div>
            )}
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="reassign-text">
              {reason === "other" ? t("reassign.other_text") : t("reassign.note_optional")}
              {reason === "other" && <span className="text-destructive"> *</span>}
            </Label>
            <Textarea id="reassign-text" dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("reassign.note_ph")} disabled={busy} />
            {reason === "other" && <p className="text-xs text-muted-foreground">{t("reassign.other_hint")}</p>}
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={to ? blocks : []} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !ready}>
            {busy ? <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" /> : <ArrowRightLeft size={16} className="me-2" aria-hidden="true" />}
            {t("reassign.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
