"use client"

// Inspection result (form 19, WIR-03 — the prototype's formWirR): passed ·
// passed with comments · failed, as it came from the inspecting party, on the
// day of the signed form, with the form attached. No choice, no save; a
// failure or a pass with comments carries the inspector's words.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import type { PmAttachment } from "@/lib/pm/attachments"
import { todayDay } from "@/lib/pm/format"
import { resultBlocks, WIR_RESULTS, wirNo, type PmInspection, type WirResult } from "@/lib/pm/inspection"
import { PmInspectionError, recordResult, type InspectionActor } from "@/lib/pm/inspection-writes"
import { PmFilesField } from "./PmAttachments"

export function RecordResultDialog({
  open,
  onOpenChange,
  projectId,
  orgId,
  access,
  actor,
  inspection,
  itemLabel,
  partyName,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  orgId?: string | null
  access: PmAccess
  actor: InspectionActor
  inspection: PmInspection
  itemLabel: string
  partyName?: string
  onSaved?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [result, setResult] = useState<WirResult | null>(null)
  const [note, setNote] = useState("")
  const [on, setOn] = useState(today)
  const [files, setFiles] = useState<PmAttachment[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setResult(null)
      setNote("")
      setOn(todayDay())
      setFiles([])
    }
  }, [open])

  const blocks = resultBlocks({ archived: access.ctx.archived, status: inspection.status, result, note, on, today })
  const needNote = result === "fail" || result === "cond"

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      await recordResult(firestore, access.ctx, projectId, actor, inspection.seq, { result, note, on, files })
      toast({ title: t(result === "fail" ? "wir.recorded_fail" : "wir.recorded", { no: wirNo(inspection.seq), code: inspection.code ?? "" }) })
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmInspectionError && err.blocks[0] ? `wir.block.${err.blocks[0]}` : "error.save"
      toast({ title: t(msg), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("wir.record_title", { no: wirNo(inspection.seq) })}</DialogTitle>
          <DialogDescription dir="auto">
            {itemLabel} · {inspection.location}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Callout tone="info">{t("wir.result_note", { party: partyName ?? t(`wir.party.${inspection.party}`), code: inspection.code ?? "" })}</Callout>
          <RadioGroup value={result ?? ""} onValueChange={(v) => setResult(v as WirResult)} className="gap-2" aria-label={t("wir.result")}>
            {WIR_RESULTS.map((r) => (
              <Label key={r} htmlFor={`wir-r-${r}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 font-semibold hover:border-module/40">
                <RadioGroupItem id={`wir-r-${r}`} value={r} disabled={busy} />
                {t(`wir.status.${r}`)}
              </Label>
            ))}
          </RadioGroup>
          <div className="space-y-1.5">
            <Label htmlFor="wir-rd">{t("wir.result_date")}</Label>
            <Input id="wir-rd" type="date" dir="ltr" max={today} value={on} onChange={(e) => setOn(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wir-note">
              {t("wir.inspector_note")}
              {needNote && <span className="ms-0.5 text-destructive">*</span>}
            </Label>
            <Textarea id="wir-note" value={note} placeholder={result === "fail" ? t("wir.note_ph_fail") : result === "cond" ? t("wir.note_ph_cond") : t("wir.note_ph_pass")} onChange={(e) => setNote(e.target.value)} disabled={busy} dir="auto" />
          </div>
          <PmFilesField orgId={orgId} folder={`projects/${projectId}/inspections`} value={files} onChange={setFiles} label={t("wir.form_files")} hint={t("wir.form_files_hint")} disabled={busy} />
          {result === "fail" && <Callout tone="block">{t("wir.fail_warn")}</Callout>}
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`wir.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("wir.record")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
