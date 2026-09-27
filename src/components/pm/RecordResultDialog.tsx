"use client"

// Inspection result (form 19, WIR-03): passed · passed with comments · failed.
// No choice, no save — here, in the write, and in the rules.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { resultBlocks, WIR_RESULTS, wirNo, type PmInspection, type WirResult } from "@/lib/pm/inspection"
import { PmInspectionError, recordResult, type InspectionActor } from "@/lib/pm/inspection-writes"

export function RecordResultDialog({
  open,
  onOpenChange,
  projectId,
  access,
  actor,
  inspection,
  itemLabel,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  access: PmAccess
  actor: InspectionActor
  inspection: PmInspection
  itemLabel: string
  onSaved?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [result, setResult] = useState<WirResult | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setResult(null)
      setNote("")
    }
  }, [open])

  const blocks = resultBlocks({ archived: access.ctx.archived, status: inspection.status, result })

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      await recordResult(firestore, access.ctx, projectId, actor, inspection.seq, { result, note })
      toast({ title: t("wir.recorded", { no: wirNo(inspection.seq) }) })
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("wir.record_title", { no: wirNo(inspection.seq) })}</DialogTitle>
          <DialogDescription dir="auto">
            {itemLabel} · {inspection.location}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <RadioGroup value={result ?? ""} onValueChange={(v) => setResult(v as WirResult)} className="gap-2" aria-label={t("wir.result")}>
            {WIR_RESULTS.map((r) => (
              <Label key={r} htmlFor={`wir-r-${r}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 font-semibold hover:border-module/40">
                <RadioGroupItem id={`wir-r-${r}`} value={r} disabled={busy} />
                {t(`wir.status.${r}`)}
              </Label>
            ))}
          </RadioGroup>
          <div className="space-y-1.5">
            <Label htmlFor="wir-note">{t("wir.note")}</Label>
            <Textarea id="wir-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
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
