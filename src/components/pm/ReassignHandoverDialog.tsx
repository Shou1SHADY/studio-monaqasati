"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { REASSIGN_REASONS, reassignBlocks, type PmHandover, type ReassignReason } from "@/lib/pm/handover"
import { reassignHandover, type PmActor } from "@/lib/pm/handover-writes"
import { cn } from "@/lib/utils"

/** Pass a handover to another manager with a reason (HO-04). It stays in "New
 * projects" — it does not go back to CRM. */
export function ReassignHandoverDialog({
  open,
  onOpenChange,
  handover,
  actor,
  managers,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  handover: PmHandover
  actor: PmActor
  managers: Array<{ id: string; name: string }>
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [to, setTo] = useState("")
  const [reason, setReason] = useState<ReassignReason>("load")
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setTo("")
      setReason("load")
      setText("")
    }
  }, [open])

  const blocks = reassignBlocks(handover, to, reason, text).map((b) => t(`reassign.block.${b}`))
  const target = managers.find((m) => m.id === to)

  const save = async () => {
    if (!firestore || blocks.length || !target) return
    setBusy(true)
    try {
      await reassignHandover(firestore, actor, handover.id, {
        to,
        toName: target.name,
        reason,
        reasonText: reason === "other" ? text : null,
        notification: { title: t("notif.reassigned_title"), message: t("notif.reassigned_message", { project: handover.title, by: actor.name ?? "" }) },
      })
      toast({ title: t("reassign.done", { name: target.name }) })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("reassign.title")}</DialogTitle>
          <DialogDescription>{t("reassign.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reassign-to">{t("reassign.to")}</Label>
            <Select value={to} onValueChange={setTo} disabled={busy}>
              <SelectTrigger id="reassign-to">
                <SelectValue placeholder={t("reassign.pick")} />
              </SelectTrigger>
              <SelectContent>
                {managers
                  .filter((m) => m.id !== handover.to)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("reassign.reason")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {REASSIGN_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={reason === r}
                  onClick={() => setReason(r)}
                  className={cn(
                    "min-h-11 rounded-lg border px-3 text-start text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    reason === r ? "border-module bg-module/10 text-foreground" : "hover:border-module/40"
                  )}
                >
                  {t(`reassign.reasons.${r}`)}
                </button>
              ))}
            </div>
          </fieldset>
          {reason === "other" && (
            <div className="space-y-1.5">
              <Label htmlFor="reassign-text">{t("reassign.other_text")}</Label>
              <Textarea id="reassign-text" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
            </div>
          )}
          <BlockingReasons title={t("cannot_save")} reasons={to ? blocks : []} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !to || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("reassign.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
