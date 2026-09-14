"use client"

// The submittals register's act (T8, FL-07): the technical office or the
// consultant returns the shop drawing with A (approved), B (approved as noted —
// production proceeds and the notes show at cutting) or C (revise and
// resubmit — back to design). Manufacturing produced and submitted it; it only
// reads the code.

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, FileText, Loader2, PencilRuler } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { DrawingCode } from "@/lib/manufacturing-engine"
import { recordDrawingResult, type Actor, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { emitMfgEvent } from "@/lib/mfg-events"
import { RecordedAsLine, errText } from "@/components/inventory/MfgOutsideBits"

export interface DrawingTarget {
  order: WorkOrderV2
  orderRef: string
  productName: string
}

const CODES: DrawingCode[] = ["A", "B", "C"]

export function ProjectDrawingResultDialog({
  target,
  orgId,
  actor,
  link,
  onClose,
}: {
  target: DrawingTarget | null
  orgId: string
  actor: Actor
  link: string | null
  onClose: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const [code, setCode] = useState<DrawingCode>("A")
  const [notes, setNotes] = useState("")
  const [approver, setApprover] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCode("A")
    setNotes("")
    setApprover("")
    setError(null)
  }, [target?.order.id])

  if (!target) return null
  const d = target.order.drawing
  const notesRequired = code === "B" || code === "C"
  const notesMissing = notesRequired && !notes.trim()

  const submit = async () => {
    if (!firestore || busy) return
    if (notesMissing) {
      setError(t("mfg4_err_notes_required"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await recordDrawingResult(firestore, { orderId: target.order.id, code, notes: notes.trim() || null, approverName: approver.trim() || null, actor })
      await emitMfgEvent(firestore, {
        kind: "drawing_result",
        copy: t,
        organizationId: orgId,
        actor,
        to: [{ permission: "manufacturing.manage" }, { users: [d?.submittedById] }],
        params: { ref: target.orderRef, code, notes: notes.trim() ? ` — ${notes.trim()}` : "" },
        workOrderId: target.order.id,
        link,
      })
      toast({ title: t("mfx_prj_drawing_done", { code, order: target.orderRef }) })
      onClose()
    } catch (err) {
      console.error(err)
      setError(errText(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilRuler size={18} className="text-cta" aria-hidden="true" />
            {t("mfx_prj_drawing_title")}
          </DialogTitle>
          <DialogDescription>{t("mfx_prj_drawing_desc", { order: target.orderRef, product: target.productName })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <dl className="overflow-hidden rounded-xl border bg-white text-xs">
            <div className="flex gap-3 border-b border-border/60 px-3.5 py-2">
              <dt className="w-28 shrink-0 text-muted-foreground">{t("mfx_prj_revision")}</dt>
              <dd className="font-semibold text-foreground" dir="ltr">{d?.revision ?? 1}</dd>
            </div>
            {d?.submittedBy && (
              <div className="flex gap-3 border-b border-border/60 px-3.5 py-2">
                <dt className="w-28 shrink-0 text-muted-foreground">{t("mfx_prj_submitted_by")}</dt>
                <dd className="font-semibold text-foreground" dir="auto">{d.submittedBy}</dd>
              </div>
            )}
            {d?.note && (
              <div className="flex gap-3 border-b border-border/60 px-3.5 py-2">
                <dt className="w-28 shrink-0 text-muted-foreground">{t("mfx_prj_submit_note")}</dt>
                <dd className="font-semibold text-foreground" dir="auto">{d.note}</dd>
              </div>
            )}
            {(d?.cutList?.length || 0) > 0 && (
              <div className="flex gap-3 border-b border-border/60 px-3.5 py-2">
                <dt className="w-28 shrink-0 text-muted-foreground">{t("mfx_prj_cut_list")}</dt>
                <dd className="font-semibold text-foreground">{t("mfx_prj_cut_pieces", { count: d?.cutList?.length || 0 })}</dd>
              </div>
            )}
            {d?.fileUrl && (
              <div className="px-3.5 py-2">
                <a
                  href={d.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-sm font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FileText size={13} aria-hidden="true" />
                  {d.fileName || t("mfx_prj_open_drawing")}
                </a>
              </div>
            )}
          </dl>

          <div className="space-y-1.5">
            <Label>{t("mfx_prj_code")}</Label>
            <RadioGroup value={code} onValueChange={(v) => { setCode(v as DrawingCode); setError(null) }} className="gap-2">
              {CODES.map((c) => (
                <label
                  key={c}
                  htmlFor={`mfx-code-${c}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border-2 bg-white px-3 py-2.5 transition-colors",
                    code === c ? (c === "C" ? "border-destructive bg-destructive/5" : "border-cta bg-cta/5") : "border-border hover:border-slate-300"
                  )}
                >
                  <RadioGroupItem id={`mfx-code-${c}`} value={c} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-foreground">{t(`mfx_prj_code_${c.toLowerCase()}`)}</span>
                    <span className="block text-[11px] leading-relaxed text-muted-foreground">{t(`mfx_prj_code_${c.toLowerCase()}_hint`)}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mfx-drawing-notes">
              {t("mfx_prj_result_notes")}
              {notesRequired && <span className="ms-0.5 text-destructive">*</span>}
            </Label>
            <Textarea
              id="mfx-drawing-notes"
              rows={3}
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setError(null) }}
              aria-invalid={!!error && notesMissing}
              disabled={busy}
              placeholder={code === "C" ? t("mfx_prj_notes_c_placeholder") : code === "B" ? t("mfx_prj_notes_b_placeholder") : ""}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mfx-drawing-approver">{t("mfx_prj_approver")}</Label>
            <Input id="mfx-drawing-approver" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder={t("mfx_prj_approver_placeholder")} disabled={busy} dir="auto" />
          </div>

          <ul className="space-y-1 rounded-xl border bg-white px-3.5 py-2.5 text-xs text-slate-700">
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {t(`mfx_prj_code_${code.toLowerCase()}_effect`)}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {t("mfx_prj_drawing_effect_notify")}
            </li>
          </ul>

          <RecordedAsLine name={actor.name} />
        </div>

        <DialogFooter className="flex-wrap items-center gap-2">
          {error && (
            <span className="me-auto flex items-center gap-1.5 text-[11px] font-semibold text-destructive">
              <AlertTriangle size={13} aria-hidden="true" /> {error}
            </span>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("crm_cancel")}
          </Button>
          <Button onClick={submit} disabled={busy} variant={code === "C" ? "destructive" : "default"} className="gap-2">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {t("mfx_prj_drawing_btn", { code })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
