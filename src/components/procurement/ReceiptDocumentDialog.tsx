"use client"

// «سند الاستلام … — PDF» (prototype `grn-pdf`, RC-01/RC-02): the receipt shown INSIDE the app as the A4 page it prints as — the
// same document the print window and the export zip carry (`receiptDocumentHtml`) — on a muted backdrop, with three acts:
// download it as a PDF, print it, close. It opens from the receipts list, the receipt drawer (stacked over it) and the
// receiver's done page. The PDF is made by the browser's own print-to-PDF (no PDF library is shipped with the app): «نزّل PDF»
// opens the print sheet on the page with the receipt's number as the file name, and the reader picks «Save as PDF» — so the
// Arabic is shaped and laid out right-to-left by the browser exactly as on screen. If the frame cannot print, the old
// self-printing window is the fallback.

import { useMemo, useRef } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Download, FileText, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { printGoodsReceipt, receiptDocumentHtml, type ReceiptPrintInput } from "@/lib/procurement/receipt-print"

/** Print what the frame holds; the top window's title is the default file name of a saved PDF, so it carries the receipt's number. */
export function printFrame(frame: HTMLIFrameElement | null, fileName: string): boolean {
  const win = frame?.contentWindow
  if (!win) return false
  const before = document.title
  try {
    document.title = fileName
    win.focus()
    win.print()
    return true
  } catch {
    return false
  } finally {
    // The print sheet is modal in every browser we support: the title goes back once it closes.
    setTimeout(() => {
      document.title = before
    }, 0)
  }
}

export function ReceiptDocumentDialog({ input, onOpenChange }: { input: ReceiptPrintInput | null; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("Portal.ProcReceipts.doc")
  const tr = useTranslations("Portal.ProcReceipts")
  const locale = useLocale()
  const { toast } = useToast()
  const frame = useRef<HTMLIFrameElement>(null)
  const html = useMemo(() => (input ? receiptDocumentHtml(input, { autoPrint: false }) : ""), [input])
  if (!input) return null
  const number = input.displayNumber

  const print = (download: boolean) => {
    if (printFrame(frame.current, number)) {
      if (download) toast({ title: t("downloadHint") })
      return
    }
    if (!printGoodsReceipt(input)) toast({ title: tr("drawer.popupBlocked"), variant: "destructive" })
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="flex max-h-[94vh] max-w-3xl flex-col gap-3 p-4 sm:p-6">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2">
            <FileText size={16} className="text-module" aria-hidden="true" />
            <span>{t("title", { number })}</span>
          </DialogTitle>
          <DialogDescription>{t("caption")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-2 sm:p-4">
          <iframe ref={frame} title={t("frame", { number })} srcDoc={html} className="mx-auto block h-[65vh] w-full max-w-[210mm] rounded-md border bg-background shadow-sm" />
        </div>
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" className="gap-1.5" onClick={() => print(true)}>
              <Download size={15} aria-hidden="true" />
              {t("download")}
            </Button>
            <Button type="button" variant="outline" className="gap-1.5" onClick={() => print(false)}>
              <Printer size={15} aria-hidden="true" />
              {t("print")}
            </Button>
          </div>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
