"use client"

// Withdraw a draft before signing (form 7, AMD-06): a reason from the list
// ("other" stated). Nothing is deleted — it stays in the contract record as
// "withdrawn before signing".

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { addendumNo, WITHDRAW_REASONS, withdrawBlocks, type PmAddendum, type WithdrawReason } from "@/lib/pm/addenda"
import { PmAddendumError, withdrawAddendum, type AddendumActor } from "@/lib/pm/addendum-writes"

export function WithdrawAddendumDialog({
  open,
  onOpenChange,
  projectId,
  access,
  actor,
  addendum,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  access: PmAccess
  actor: AddendumActor
  addendum: PmAddendum
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [reason, setReason] = useState<WithdrawReason | null>(null)
  const [reasonText, setReasonText] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setReason(null)
      setReasonText("")
    }
  }, [open])

  const blocks = withdrawBlocks({ addendum, reason, reasonText })

  const save = async () => {
    if (!firestore || blocks.length || !reason) return
    setBusy(true)
    try {
      await withdrawAddendum(firestore, access.ctx, projectId, actor, addendum.seq, { reason, reasonText })
      toast({ title: t("amend.withdrawn", { no: addendumNo(addendum.seq) }) })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmAddendumError && err.blocks[0] ? `amend.withdraw_block.${err.blocks[0]}` : "error.save"
      toast({ title: t(msg), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("amend.withdraw_title", { no: addendumNo(addendum.seq) })}</DialogTitle>
          <DialogDescription>{t("amend.withdraw_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="amd-wd-reason">{t("amend.reason")}</Label>
            <Select value={reason ?? ""} onValueChange={(v) => setReason(v as WithdrawReason)} disabled={busy}>
              <SelectTrigger id="amd-wd-reason">
                <SelectValue placeholder={t("amend.pick_reason")} />
              </SelectTrigger>
              <SelectContent>
                {WITHDRAW_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`amend.withdraw_reasons.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {reason === "other" && (
            <div className="space-y-1.5">
              <Label htmlFor="amd-wd-text">{t("amend.reason_text")}</Label>
              <Input id="amd-wd-text" value={reasonText} onChange={(e) => setReasonText(e.target.value)} disabled={busy} />
            </div>
          )}
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`amend.withdraw_block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("amend.withdraw")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
