"use client"

// Amend the contract (form 5, WF-08): the terms as they should read after the
// addendum, starting from what is in force; a reason from the list ("other"
// stated) and an optional note. Saving leaves it awaiting signature — the
// contract in force does not move until the signature is recorded.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { ADDENDUM_REASONS, capBelowHeld, draftBlocks, type AddendumReason } from "@/lib/pm/addenda"
import { draftAddendum, PmAddendumError, type AddendumActor } from "@/lib/pm/addendum-writes"
import { pmMoney } from "@/lib/pm/format"
import { termChanges, type ContractTerms } from "@/lib/pm/terms"
import { TermChangeList } from "./TermChangeList"
import { TermsFields } from "./TermsFields"

export function DraftAddendumDialog({
  open,
  onOpenChange,
  projectId,
  access,
  actor,
  terms,
  lifecycle,
  contractValue,
  retentionHeld,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  access: PmAccess
  actor: AddendumActor
  /** The contract in force now. */
  terms: ContractTerms
  lifecycle: string
  contractValue: number
  retentionHeld: number
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [next, setNext] = useState<ContractTerms>(terms)
  const [reason, setReason] = useState<AddendumReason | null>(null)
  const [reasonText, setReasonText] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setNext({ ...terms, damages: { ...terms.damages } })
      setReason(null)
      setReasonText("")
      setNote("")
    }
  }, [open, terms])

  const changes = useMemo(() => termChanges(terms, next), [terms, next])
  const changed = useMemo(() => new Set(changes.map((c) => c.key)), [changes])
  const blocks = draftBlocks({ lifecycle, archived: access.ctx.archived, terms, next, reason, reasonText, contractValue, retentionHeld })
  const cap = capBelowHeld(changes, contractValue, retentionHeld)

  const blockText = (b: (typeof blocks)[number]) => (b === "cap_below_held" && cap ? t("amend.block.cap_below_held", { cap: pmMoney(cap.cap), held: pmMoney(cap.held) }) : t(`amend.block.${b}`))

  const save = async () => {
    if (!firestore || blocks.length || !reason) return
    setBusy(true)
    try {
      const seq = await draftAddendum(firestore, access.ctx, projectId, actor, { next, reason, reasonText, note })
      toast({ title: t("amend.drafted", { no: String(seq).padStart(2, "0") }) })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmAddendumError && err.blocks[0] ? `amend.block.${err.blocks[0]}` : "error.save"
      toast({ title: t(msg, { cap: "", held: "" }), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("amend.draft_title")}</DialogTitle>
          <DialogDescription>{t("amend.draft_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Callout tone="info">{t("amend.three_doors")}</Callout>
          <TermsFields value={next} onChange={(k, v) => setNext((d) => ({ ...d, [k]: v }))} disabled={busy} changed={changed} idPrefix="amd" />
          <TermChangeList changes={changes} className="rounded-xl border bg-muted/30 p-3" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amd-reason">{t("amend.reason")}</Label>
              <Select value={reason ?? ""} onValueChange={(v) => setReason(v as AddendumReason)} disabled={busy}>
                <SelectTrigger id="amd-reason">
                  <SelectValue placeholder={t("amend.pick_reason")} />
                </SelectTrigger>
                <SelectContent>
                  {ADDENDUM_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`amend.reasons.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {reason === "other" && (
              <div className="space-y-1.5">
                <Label htmlFor="amd-reason-text">{t("amend.reason_text")}</Label>
                <Input id="amd-reason-text" value={reasonText} onChange={(e) => setReasonText(e.target.value)} disabled={busy} />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amd-note">{t("amend.note")}</Label>
            <Textarea id="amd-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map(blockText)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("amend.save_draft")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
