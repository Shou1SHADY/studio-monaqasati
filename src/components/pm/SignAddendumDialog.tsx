"use client"

// Record the addendum's signature (form 6, AMD-04/05/09). The date is not
// before the draft or the last signature, and never in the future; who signed
// for the client is optional. A draft overtaken by another signature shows
// both values and cannot be signed; a cap below the retention held — even if a
// certificate raised it after drafting — is refused with the amounts.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MfgFileField, type UploadedFile } from "@/components/manufacturing/MfgFileField"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePmTermText } from "@/hooks/usePmTermText"
import { PmAccessError } from "@/lib/pm/access"
import { addendumNo, capBelowHeld, earliestSignDay, isFinancial, signBlocks, staleChanges, type PmAddendum } from "@/lib/pm/addenda"
import { PmAddendumError, signAddendum, type AddendumActor } from "@/lib/pm/addendum-writes"
import { pmMoney, todayDay } from "@/lib/pm/format"
import type { ContractTerms } from "@/lib/pm/terms"
import { TermChangeList } from "./TermChangeList"

export function SignAddendumDialog({
  open,
  onOpenChange,
  projectId,
  access,
  actor,
  addendum,
  terms,
  lifecycle,
  lastSigned,
  contractValue,
  retentionHeld,
  orgId = "",
}: {
  orgId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  access: PmAccess
  actor: AddendumActor
  addendum: PmAddendum
  terms: ContractTerms
  lifecycle: string
  lastSigned: string | null
  contractValue: number
  retentionHeld: number
}) {
  const t = useTranslations("Portal.PM")
  const text = usePmTermText()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [signedOn, setSignedOn] = useState(today)
  const [signatory, setSignatory] = useState("")
  const [file, setFile] = useState<UploadedFile | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setSignedOn(todayDay())
      setSignatory("")
      setFile(null)
    }
  }, [open])

  const stale = staleChanges(addendum.changes, terms)
  const cap = capBelowHeld(addendum.changes, contractValue, retentionHeld)
  const blocks = signBlocks({ lifecycle, archived: access.ctx.archived, addendum, terms, signedOn: signedOn || null, lastSignedOn: lastSigned, today, contractValue, retentionHeld })
  const earliest = earliestSignDay(addendum.day, lastSigned)

  const blockText = (b: (typeof blocks)[number]) => {
    if (b === "cap_below_held" && cap) return t("amend.block.cap_below_held", { cap: pmMoney(cap.cap), held: pmMoney(cap.held) })
    if (b === "before_draft" || b === "before_last") return t(`amend.block.${b}`, { date: earliest })
    return t(`amend.block.${b}`)
  }

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      await signAddendum(firestore, access.ctx, projectId, actor, addendum.seq, { signedOn, signatory, files: file ? [file] : [] })
      toast({ title: t("amend.signed", { no: addendumNo(addendum.seq) }) })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmAddendumError && err.blocks[0] ? `amend.block.${err.blocks[0]}` : "error.save"
      toast({ title: t(msg, { cap: "", held: "", date: earliest }), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("amend.sign_title", { no: addendumNo(addendum.seq) })}</DialogTitle>
          <DialogDescription>{t("amend.sign_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <TermChangeList changes={addendum.changes} className="rounded-xl border bg-muted/30 p-3" />
          {stale.length > 0 && (
            <Callout tone="block" title={t("amend.stale_title")}>
              <ul className="space-y-0.5">
                {stale.map((s) => (
                  <li key={s.key}>{t("amend.stale_line", { term: t(`terms.${s.key}` as "terms.save"), drafted: text(s.key, s.drafted), now: text(s.key, s.now) })}</li>
                ))}
              </ul>
            </Callout>
          )}
          {isFinancial(addendum.changes) && !stale.length && <Callout tone="info">{t("amend.finance_note")}</Callout>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amd-sign-date">{t("amend.signed_on")}</Label>
              <Input id="amd-sign-date" type="date" min={earliest} max={today} dir="ltr" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amd-signatory">{t("amend.signatory")}</Label>
              <Input id="amd-signatory" value={signatory} onChange={(e) => setSignatory(e.target.value)} disabled={busy} />
            </div>
          </div>
          <MfgFileField orgId={orgId} area="pm" folder={`projects/${projectId}/addenda`} value={file} onChange={setFile} label={t("amend.signed_file")} hint={t("amend.signed_file_hint")} />
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map(blockText)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("amend.sign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
