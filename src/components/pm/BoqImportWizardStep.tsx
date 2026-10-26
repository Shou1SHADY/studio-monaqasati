"use client"

// The BOQ step of the new-project wizard (and of a project created by hand): the same window as the
// project's own BOQ — upload a file as received, fill the template, or type the items — with the
// result held in the wizard until the project is accepted.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { CheckCircle2, Pencil, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { sarLtr } from "@/lib/riyal"
import { currentLinesOf, payloadTotal, type BoqImportPayload } from "@/lib/pm/boq-import-payload"
import { BoqImportDialog, type BoqImportMode } from "./BoqImportDialog"

export function BoqImportWizardStep({
  payload,
  awardValue,
  prefer,
  disabled,
  onApply,
}: {
  payload: BoqImportPayload | null
  awardValue: number | null
  /** The source the person chose first: where the window opens when nothing is held yet. */
  prefer: "upload" | "manual"
  disabled: boolean
  onApply: (payload: BoqImportPayload) => void
}) {
  const t = useTranslations("Portal.PmBoqImport")
  const [open, setOpen] = useState<{ mode: BoqImportMode; start: "upload" | "manual" } | null>(null)
  const unpriced = payload ? payload.lines.filter((l) => !l.rate).length : 0
  const total = payload ? Math.round(payloadTotal(payload)).toLocaleString("en-US") : ""
  return (
    <div className="space-y-3">
      <Callout tone="info">{t("wizard.note")}</Callout>
      {payload ? (
        <div className="space-y-2 rounded-xl border p-3">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-success">
            <CheckCircle2 size={16} aria-hidden="true" />
            {t("wizard.loaded", { items: t("items_count", { count: payload.lines.length }), total: sarLtr(total) })}
            {unpriced > 0 && <span className="text-xs font-normal text-muted-foreground">· {t("wizard.unpriced", { count: unpriced })}</span>}
            {payload.fileName && (
              <span className="text-xs font-normal text-muted-foreground" dir="auto">
                · {t("wizard.from_file", { file: payload.fileName })}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="max-md:h-11" disabled={disabled} onClick={() => setOpen({ mode: "edit", start: "manual" })}>
              <Pencil size={14} className="me-1.5" aria-hidden="true" />
              {t("wizard.review")}
            </Button>
            <Button type="button" variant="outline" size="sm" className="max-md:h-11" disabled={disabled} onClick={() => setOpen({ mode: "replace", start: "upload" })}>
              <Upload size={14} className="me-1.5" aria-hidden="true" />
              {t("panel.upload_other")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant={prefer === "upload" ? "default" : "outline"} className="max-md:h-11" disabled={disabled} onClick={() => setOpen({ mode: "create", start: "upload" })}>
            <Upload size={15} className="me-1.5" aria-hidden="true" />
            {t("wizard.upload")}
          </Button>
          <Button type="button" variant={prefer === "manual" ? "default" : "outline"} className="max-md:h-11" disabled={disabled} onClick={() => setOpen({ mode: "create", start: "manual" })}>
            <Pencil size={15} className="me-1.5" aria-hidden="true" />
            {t("wizard.manual")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("wizard.none")}</span>
        </div>
      )}
      <BoqImportDialog
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        mode={open?.mode ?? "create"}
        start={open?.start}
        awardValue={awardValue}
        current={open?.mode === "edit" && payload ? currentLinesOf(payload) : undefined}
        currentCount={payload?.lines.length ?? 0}
        onApply={async (next) => onApply(next)}
      />
    </div>
  )
}
