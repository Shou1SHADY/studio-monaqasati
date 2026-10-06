"use client"

// Every stage change in the client CRM states why (agreed with the sales team,
// 6 Oct 2026): the board's drag, its "move to" select and the record's stage
// field all open this; the reason is kept in the record's history.

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { ArrowLeftRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { stageChangeSchema } from "@/lib/admin-crm"

export type PendingStage = { id: string; name: string; from: string; to: string }

export function StageReasonDialog({
  pending,
  stageLabel,
  onCancel,
  onConfirm,
}: {
  pending: PendingStage | null
  stageLabel: (stage: string) => string
  onCancel: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const t = useTranslations("Portal.Admin.Crm")
  const form = useForm<{ reason: string }>({ resolver: zodResolver(stageChangeSchema), defaultValues: { reason: "" } })
  useEffect(() => form.reset({ reason: "" }), [pending, form])

  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && !form.formState.isSubmitting && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight size={18} className="text-primary" aria-hidden="true" />
            {t("stage_reason_title")}
          </DialogTitle>
          <DialogDescription>
            {pending && t("stage_reason_desc", { name: pending.name, from: stageLabel(pending.from), to: stageLabel(pending.to) })}
          </DialogDescription>
        </DialogHeader>
        <form id="stage-reason" onSubmit={form.handleSubmit(async (v) => onConfirm(v.reason.trim()))} className="space-y-1.5">
          <Label htmlFor="stage-reason-text">{t("stage_reason_label")}</Label>
          <Textarea id="stage-reason-text" rows={3} autoFocus placeholder={t("stage_reason_placeholder")} {...form.register("reason")} />
          {form.formState.errors.reason && <p className="text-xs text-destructive">{t("stage_reason_required")}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={form.formState.isSubmitting}>
            {t("cancel")}
          </Button>
          <Button type="submit" form="stage-reason" disabled={form.formState.isSubmitting} className="gap-2">
            {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t("stage_reason_confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
