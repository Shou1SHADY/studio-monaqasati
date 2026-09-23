"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Download, FileCode2, FileSpreadsheet, FileText, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useToast } from "@/hooks/use-toast"
import { exportDocument, type ExportDoc, type ExportFormat } from "@/lib/accounting/export"

/**
 * "Export to" — Excel, PDF and XBRL for whatever the screen shows. The document
 * is built only when a format is picked: a year of journal lines is not worth
 * assembling on every render — or on every open — for a menu. `hasXbrl` says up
 * front whether the screen has an XBRL form.
 */
export function ExportMenu({ build, disabled, hasXbrl = true }: { build: () => ExportDoc | null; disabled?: boolean; hasXbrl?: boolean }) {
  const t = useTranslations("Portal.Shared")
  const { toast } = useToast()
  const [busy, setBusy] = useState<ExportFormat | null>(null)

  const run = async (format: ExportFormat) => {
    const doc = build()
    if (!doc) return
    setBusy(format)
    try {
      const ok = await exportDocument(doc, format)
      if (!ok) toast({ title: t(format === "pdf" ? "acc_export_popup_blocked" : "acc_export_failed"), variant: "destructive" })
    } catch (err) {
      console.error(err)
      toast({ title: t("acc_export_failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2" disabled={disabled || !!busy}>
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {t("acc_export_to")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("acc_export_hint")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onSelect={() => run("xlsx")}>
          <FileSpreadsheet size={15} className="text-success" aria-hidden="true" />
          {t("acc_export_xlsx")}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onSelect={() => run("pdf")}>
          <FileText size={15} className="text-destructive" aria-hidden="true" />
          {t("acc_export_pdf")}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" disabled={!hasXbrl} onSelect={() => run("xbrl")}>
          <FileCode2 size={15} className="text-cta" aria-hidden="true" />
          <span className="flex flex-col">
            {t("acc_export_xbrl")}
            {!hasXbrl && <span className="text-[11px] text-muted-foreground">{t("acc_export_xbrl_none")}</span>}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
