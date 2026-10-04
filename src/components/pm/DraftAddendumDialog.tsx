"use client"

// Amend the contract (form 5, WF-08): the terms as they should read after the
// addendum, starting from what is in force; a reason from the list ("other"
// stated), an optional note and the addendum or its draft. Saving leaves it
// awaiting signature — the contract in force does not move until the
// signature is recorded. Whoever signs (approve) may record it already signed
// in the same step: dated, and checked as a signature would be.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { MfgFileField, type UploadedFile } from "@/components/manufacturing/MfgFileField"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { ADDENDUM_REASONS, capBelowHeld, draftBlocks, earliestSignDay, signBlocks, type AddendumReason } from "@/lib/pm/addenda"
import { draftAddendum, PmAddendumError, type AddendumActor } from "@/lib/pm/addendum-writes"
import { pmMoney, todayDay } from "@/lib/pm/format"
import { termChanges, type ContractTerms, type TermKey } from "@/lib/pm/terms"
import { TermChangeList } from "./TermChangeList"
import { TermsFields } from "./TermsFields"

export function DraftAddendumDialog({
  open,
  onOpenChange,
  projectId,
  orgId = "",
  access,
  actor,
  terms,
  lifecycle,
  contractValue,
  retentionHeld,
  lastSigned = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  orgId?: string
  access: PmAccess
  actor: AddendumActor
  /** The contract in force now. */
  terms: ContractTerms
  lifecycle: string
  contractValue: number
  retentionHeld: number
  lastSigned?: string | null
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [next, setNext] = useState<ContractTerms>(terms)
  const [reason, setReason] = useState<AddendumReason | null>(null)
  const [reasonText, setReasonText] = useState("")
  const [note, setNote] = useState("")
  const [file, setFile] = useState<UploadedFile | null>(null)
  const [signedOn, setSignedOn] = useState(today)
  const [signatory, setSignatory] = useState("")
  const [busy, setBusy] = useState<"draft" | "sign" | null>(null)
  const canSign = !access.ctx.archived && access.allowed("addendum.sign")
  const money = access.has("money")

  useEffect(() => {
    if (open) {
      setNext({ ...terms, damages: { ...terms.damages } })
      setReason(null)
      setReasonText("")
      setNote("")
      setFile(null)
      setSignedOn(todayDay())
      setSignatory("")
    }
  }, [open, terms])

  const changes = useMemo(() => termChanges(terms, next), [terms, next])
  const changed = useMemo(() => new Set(changes.map((c) => c.key)), [changes])
  const blocks = draftBlocks({ lifecycle, archived: access.ctx.archived, terms, next, reason, reasonText, contractValue, retentionHeld })
  const sBlocks = signBlocks({ lifecycle, archived: access.ctx.archived, addendum: { status: "draft", day: today, changes }, terms, signedOn: signedOn || null, lastSignedOn: lastSigned, today, contractValue, retentionHeld }).filter((b) => b !== "cap_below_held")
  const cap = capBelowHeld(changes, contractValue, retentionHeld)
  const earliest = earliestSignDay(today, lastSigned)

  const blockText = (b: string) =>
    b === "cap_below_held" && cap ? t("amend.block.cap_below_held", { cap: pmMoney(cap.cap), held: pmMoney(cap.held) }) : t(`amend.block.${b}` as "amend.block.stale", { date: earliest })

  const hint = (k: TermKey): string | undefined => {
    if (!changed.has(k)) return undefined
    if (k === "payer") return t("amend.hint.payer")
    if (k === "retention") return money ? t("amend.hint.retention", { held: pmMoney(retentionHeld) }) : t("amend.hint.retention_nomoney")
    if (k === "advance") return t("amend.hint.advance")
    if (k === "paymentDays" || k === "consultantDays") return t("amend.hint.periods")
    if (k === "defectsDays") return t("amend.hint.defects")
    if (k === "basis") return t("amend.hint.basis")
    return undefined
  }

  const save = async (sign: boolean) => {
    if (!firestore || blocks.length || !reason || (sign && sBlocks.length)) return
    setBusy(sign ? "sign" : "draft")
    try {
      const seq = await draftAddendum(firestore, access.ctx, projectId, actor, { next, reason, reasonText, note, files: file ? [file] : [], signNow: sign ? { signedOn, signatory } : null })
      toast({ title: sign ? t("amend.signed", { no: String(seq).padStart(2, "0") }) : t("amend.drafted", { no: String(seq).padStart(2, "0") }) })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmAddendumError && err.blocks[0] ? `amend.block.${err.blocks[0]}` : "error.save"
      toast({ title: t(msg, { cap: "", held: "", date: earliest }), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("amend.draft_title")}</DialogTitle>
          <DialogDescription>{t("amend.draft_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Callout tone="info">{t("amend.three_doors")}</Callout>
          <TermsFields value={next} onChange={(k, v) => setNext((d) => ({ ...d, [k]: v }))} disabled={busy !== null} changed={changed} idPrefix="amd" contractValue={money ? contractValue : undefined} hint={hint} />
          <TermChangeList changes={changes} className="rounded-xl border bg-muted/30 p-3" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amd-reason">{t("amend.reason")}</Label>
              <Select value={reason ?? ""} onValueChange={(v) => setReason(v as AddendumReason)} disabled={busy !== null}>
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
                <Input id="amd-reason-text" value={reasonText} onChange={(e) => setReasonText(e.target.value)} disabled={busy !== null} dir="auto" />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amd-note">{t("amend.note")}</Label>
            <Textarea id="amd-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("amend.note_ph")} disabled={busy !== null} dir="auto" />
          </div>
          <MfgFileField orgId={orgId} area="pm" folder={`projects/${projectId}/addenda`} value={file} onChange={setFile} label={t("amend.draft_file")} hint={t("amend.draft_file_hint")} />
          {canSign && (
            <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
              <p className="text-xs text-muted-foreground sm:col-span-2">{t("amend.sign_now_note")}</p>
              <div className="space-y-1.5">
                <Label htmlFor="amd-now-date">{t("amend.signed_on")}</Label>
                <Input id="amd-now-date" type="date" min={earliest} max={today} dir="ltr" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} disabled={busy !== null} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amd-now-signatory">{t("amend.signatory")}</Label>
                <Input id="amd-now-signatory" value={signatory} onChange={(e) => setSignatory(e.target.value)} disabled={busy !== null} dir="auto" />
              </div>
            </div>
          )}
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map(blockText)} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>
            {t("cancel")}
          </Button>
          <Button variant={canSign ? "outline" : "default"} onClick={() => void save(false)} disabled={busy !== null || blocks.length > 0}>
            {busy === "draft" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("amend.save_draft")}
          </Button>
          {canSign && (
            <Button className="bg-success text-success-foreground hover:bg-success/90" onClick={() => void save(true)} disabled={busy !== null || blocks.length > 0 || sBlocks.length > 0}>
              {busy === "sign" ? <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" /> : <Check size={16} className="me-1.5" aria-hidden="true" />}
              {t("amend.save_signed")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
