"use client"

// The measurement sheet (form 17, WF-04 — the prototype's formMS): the lines
// measured inline, the day measured (not the day typed), the period it covers,
// the proof behind it (passed inspections on its items) and the take-off or
// photos. It moves nothing until the PM approves it — unless the writer holds
// approve, in which case saving approves it and says so. The site engineer
// sees no prices.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import type { PmAttachment } from "@/lib/pm/attachments"
import { pmMoney, todayDay } from "@/lib/pm/format"
import { wirNo, type PmInspection } from "@/lib/pm/inspection"
import { sheetNo, sheetWriteBlocks, type MeasuredItem, type SheetLine } from "@/lib/pm/measurement"
import { PmSheetError, writeSheet, type SheetActor } from "@/lib/pm/measurement-writes"
import type { PricingBasis } from "@/lib/pm/terms"
import { PmFilesField } from "./PmAttachments"

export interface SheetItem extends MeasuredItem {
  code: string
  description: string
  unit: string
}

export function WriteSheetDialog({
  open,
  onOpenChange,
  projectId,
  orgId,
  access,
  actor,
  items,
  basis,
  lines,
  inspections,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  orgId?: string | null
  access: PmAccess
  actor: SheetActor
  items: SheetItem[]
  basis: PricingBasis
  lines: SheetLine[]
  inspections: PmInspection[]
  onSaved?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [day, setDay] = useState(today)
  const [note, setNote] = useState("")
  const [files, setFiles] = useState<PmAttachment[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setDay(todayDay())
      setNote("")
      setFiles([])
    }
  }, [open])

  const self = access.has("approve")
  const money = access.has("money")
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const blocks = [...sheetWriteBlocks({ archived: access.ctx.archived, basis, lines, items }), ...(day && day <= today ? [] : ["bad_day" as const])]
  const total = lines.reduce((a, l) => a + l.qty * Math.max(0, byId.get(l.itemId)?.rate ?? 0), 0)
  const unpriced = lines.some((l) => !((byId.get(l.itemId)?.rate ?? 0) > 0))
  const ids = new Set(lines.map((l) => l.itemId))
  const proof = inspections.filter((w) => ids.has(w.itemId) && (w.status === "pass" || w.status === "cond"))
  const fmt = (n: number) => n.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { maximumFractionDigits: 2 })

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      const r = await writeSheet(firestore, access.ctx, projectId, actor, { day, lines, note, files })
      toast({ title: t(r.self ? "meas.saved_self" : "meas.saved", { no: sheetNo(r.seq) }), description: r.wentLive ? t("meas.went_live") : undefined })
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmSheetError && err.blocks[0] ? `meas.block.${err.blocks[0]}` : "error.save"
      toast({ title: t(msg), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("meas.new_title")}</DialogTitle>
          <DialogDescription>{t("meas.confirm_note")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ul className="divide-y rounded-xl border">
            {lines.map((l) => {
              const i = byId.get(l.itemId)
              const passed = i?.gate?.pmInspect && proof.some((w) => w.itemId === l.itemId)
              return (
                <li key={l.itemId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-sm font-semibold" dir="auto">
                      {i?.description || l.code}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span dir="ltr">{i?.code ?? l.code}</span>
                      {passed ? ` · ${t("meas.passed_insp")}` : ""}
                    </p>
                  </div>
                  <b className="tabular-nums" dir="ltr">
                    {fmt(l.qty)}
                  </b>
                  <span className="text-xs text-muted-foreground">{i?.unit}</span>
                  {money && (
                    <span className="w-28 text-end text-xs tabular-nums" dir="ltr">
                      {pmMoney(l.qty * Math.max(0, i?.rate ?? 0))}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ms-day">{t("meas.day")}</Label>
              <Input id="ms-day" type="date" max={today} dir="ltr" value={day} onChange={(e) => setDay(e.target.value)} disabled={busy} />
              <p className="text-[11px] text-muted-foreground">{t("meas.day_hint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ms-note">{t("meas.period")}</Label>
              <Input id="ms-note" value={note} placeholder={t("meas.period_ph")} onChange={(e) => setNote(e.target.value)} disabled={busy} dir="auto" />
            </div>
          </div>
          <PmFilesField orgId={orgId} folder={`projects/${projectId}/sheets`} value={files} onChange={setFiles} label={t("meas.files")} hint={t("meas.files_hint")} disabled={busy} />
          {proof.length > 0 && (
            <Callout tone="info">
              {t("meas.proof", { list: proof.slice(0, 3).map((w) => t("wir.no", { no: wirNo(w.seq) })).join(" · ") + (proof.length > 3 ? ` +${proof.length - 3}` : "") })}
            </Callout>
          )}
          {money && (
            <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3 text-sm">
              <span className="font-semibold">{t("meas.sheet_value")}</span>
              <b className="tabular-nums" dir="ltr">
                {pmMoney(total)}
              </b>
            </div>
          )}
          {unpriced && <Callout tone="warn">{t("meas.unpriced_warn")}</Callout>}
          {!self && (
            <Callout tone="warn">
              <span className="inline-flex items-start gap-1.5">
                <ShieldCheck size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                {t("meas.not_self")}
              </span>
            </Callout>
          )}
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`meas.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t(self ? "meas.record_approve" : "meas.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
