"use client"

// «صدّر سندات الاستلام» (PRD 2.0 RCV-06): for the accountant or the archive. A period, a location and a format — Excel, CSV, or a zip with one
// print-ready document per receipt (save each as PDF from the print dialog) — and, when asked, the receipts' photos, weighbridge tickets and
// invoices in a folder per receipt. A company without Finance can send it straight to the accountant's address in the policies.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { Download, Loader2, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Chip } from "@/components/module-ui/Chip"
import { useToast } from "@/hooks/use-toast"
import { riyadhDay } from "@/lib/hr/format"
import {
  ALL_PLACES,
  defaultPeriod,
  exportCounts,
  exportCsv,
  exportFilename,
  exportMatrix,
  exportRows,
  exportedReceipts,
  receiptsZip,
  voucherFile,
  type ExportFilter,
  type ExportFormat,
  type ExportWords,
} from "@/lib/procurement/receipt-export"
import { receiptDocumentHtml, type ReceiptPrintInput } from "@/lib/procurement/receipt-print"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"
import type { PurchaseOrder } from "@/lib/procurement/types"

const FORMATS: ExportFormat[] = ["xlsx", "csv", "zip"]

async function workbook(matrix: string[][], rtl: boolean, title: string): Promise<Uint8Array> {
  const XLSX = await import("xlsx")
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(matrix)
  ws["!cols"] = (matrix[0] || []).map(() => ({ wch: 18 }))
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31))
  if (rtl) wb.Workbook = { Views: [{ RTL: true }] }
  return new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer)
}

const toBase64 = (bytes: Uint8Array): string => {
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export interface ReceiptExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deliveries: DeskDelivery[]
  orders: PurchaseOrder[]
  warehouses: Array<{ id: string; name: string }>
  /** The printable input of one receipt (company, supplier identity, place) — the zip holds one document per receipt. */
  printInput: (d: DeskDelivery) => ReceiptPrintInput
  withPrices: boolean
  financeOn: boolean
  reasonLabel: (code: string) => string
}

export function ReceiptExportDialog({ open, onOpenChange, deliveries, orders, warehouses, printInput, withPrices, financeOn, reasonLabel }: ReceiptExportDialogProps) {
  const t = useTranslations("Portal.ProcReceipts.export")
  const tm = useTranslations("Portal.ProcReceipts.module")
  const locale = useLocale()
  const { toast } = useToast()
  const [period, setPeriod] = useState(() => defaultPeriod(new Date()))
  const [place, setPlace] = useState<string>(ALL_PLACES)
  const [format, setFormat] = useState<ExportFormat>("xlsx")
  const [withFiles, setWithFiles] = useState(false)
  const [busy, setBusy] = useState<null | "download" | "send">(null)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(period.from) && /^\d{4}-\d{2}-\d{2}$/.test(period.to) && period.from <= period.to
  const filter: ExportFilter = useMemo(() => ({ from: period.from, to: period.to, place }), [period, place])
  const counts = useMemo(() => (valid ? exportCounts(deliveries, filter) : { total: 0, manual: 0 }), [valid, deliveries, filter])
  const placeName = (id: string) => warehouses.find((w) => w.id === id)?.name || ""

  const words: ExportWords = {
    headers: {
      receipt: t("col_receipt"),
      date: t("col_date"),
      supplier: t("col_supplier"),
      po: t("col_po"),
      material: t("col_material"),
      unit: t("col_unit"),
      counted: t("col_counted"),
      accepted: t("col_accepted"),
      rejected: t("col_rejected"),
      reason: t("col_reason"),
      place: t("col_place"),
      receiver: t("col_receiver"),
      recordedIn: t("col_recordedIn"),
      invoice_no: t("col_invoice_no"),
      invoice_value: t("col_invoice_value"),
      kind: t("col_kind"),
    },
    recordedIn: { procurement: tm("procurement"), inventory: tm("inventory"), projects: tm("projects") },
    kind: { receipt: t("kind_receipt"), manual: t("kind_manual"), noNotice: t("kind_noNotice") },
    reasons: reasonLabel,
    noPo: t("noPo"),
  }

  const file = async (ext: ExportFormat): Promise<{ filename: string; bytes: Uint8Array; type: string }> => {
    const chosen = exportedReceipts(deliveries, filter)
    const matrix = exportMatrix(exportRows(chosen, orders, placeName, words, withPrices), words, withPrices)
    const table = ext === "csv" ? new TextEncoder().encode(exportCsv(matrix)) : await workbook(matrix, locale === "ar", t("sheet"))
    if (ext === "xlsx") return { filename: exportFilename(filter, "xlsx"), bytes: table, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    if (ext === "csv") return { filename: exportFilename(filter, "csv"), bytes: table, type: "text/csv;charset=utf-8" }
    const documents = chosen.map((d) => ({ id: d.id, name: voucherFile(d.docNumber, d.id), html: receiptDocumentHtml(printInput(d), { autoPrint: false }) }))
    const tableName = exportFilename(filter, "xlsx")
    const tableBytes = await workbook(matrix, locale === "ar", t("sheet"))
    if (withFiles) {
      const user = getAuth().currentUser
      if (!user) throw new Error("auth")
      const res = await fetch("/api/procurement/receipt-export", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ action: "zip", ids: chosen.map((d) => d.id), documents, table: { filename: tableName, base64: toBase64(tableBytes) }, withFiles: true }),
      })
      if (!res.ok) throw new Error("zip")
      return { filename: exportFilename(filter, "zip"), bytes: new Uint8Array(await res.arrayBuffer()), type: "application/zip" }
    }
    return { filename: exportFilename(filter, "zip"), bytes: receiptsZip({ table: { filename: tableName, bytes: tableBytes }, documents: documents.map((d) => ({ name: d.name, html: d.html })) }), type: "application/zip" }
  }

  const download = async () => {
    setBusy("download")
    try {
      const f = await file(format)
      const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.type }))
      const a = document.createElement("a")
      a.href = url
      a.download = f.filename
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: t("exported", { n: counts.total }) })
      onOpenChange(false)
    } catch {
      toast({ title: t("failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const send = async () => {
    const user = getAuth().currentUser
    if (!user) return
    setBusy("send")
    try {
      const f = await file(format)
      const res = await fetch("/api/procurement/receipt-export", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ action: "send", filename: f.filename, base64: toBase64(f.bytes), period: `${period.from} → ${period.to}` }),
      })
      const body = (await res.json().catch(() => null)) as { data?: { to?: string }; code?: string } | null
      if (res.ok) {
        toast({ title: t("sent", { to: body?.data?.to || "" }) })
        onOpenChange(false)
      } else toast({ title: body?.code === "NO_ACCOUNTANT" ? t("noAccountant") : t("failed"), variant: "destructive" })
    } catch {
      toast({ title: t("failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("sub")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rx-from">{t("from")}</Label>
              <Input id="rx-from" type="date" dir="ltr" max={riyadhDay(new Date())} value={period.from} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rx-to">{t("to")}</Label>
              <Input id="rx-to" type="date" dir="ltr" max={riyadhDay(new Date())} value={period.to} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} className="h-10" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rx-place">{t("location")}</Label>
            <Select value={place} onValueChange={setPlace}>
              <SelectTrigger id="rx-place" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PLACES}>{t("allLocations")}</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("format")}</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("format")}>
              {FORMATS.map((f) => (
                <Chip key={f} selected={format === f} onClick={() => setFormat(f)}>
                  {t(`fmt_${f}`)}
                </Chip>
              ))}
            </div>
            {format === "zip" && <p className="text-[11px] leading-relaxed text-muted-foreground">{t("zipHint")}</p>}
          </div>
          {format === "zip" && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} />
              <span>
                {t("attach")}
                <span className="block text-[11px] text-muted-foreground">{t("attachHint")}</span>
              </span>
            </label>
          )}
          <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground" aria-live="polite">
            {valid ? t("count", { n: counts.total, manual: counts.manual }) : t("badPeriod")}
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {!financeOn && (
            <Button type="button" variant="outline" className="gap-1.5" disabled={!valid || counts.total === 0 || busy !== null} onClick={() => void send()}>
              {busy === "send" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Mail size={15} aria-hidden="true" />}
              {t("sendAccountant")}
            </Button>
          )}
          <Button type="button" className="gap-1.5" disabled={!valid || counts.total === 0 || busy !== null} onClick={() => void download()}>
            {busy === "download" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {t("download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
