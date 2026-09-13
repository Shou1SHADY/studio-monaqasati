"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useTranslations } from "next-intl"
import { Download, Loader2 } from "lucide-react"
import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Only the print copy is visible to the printer: every other child of <body>
// (the portal chrome, toasts, the on-screen preview) is removed from the
// printed page, and on screen the print copy never shows. `@page` owns the
// paper; the margin box numbers pages where the browser supports it.
const PRINT_CSS = `
@media screen {
  .quotation-print-root { display: none !important; }
}
@media print {
  @page {
    size: A4;
    margin: 10mm 12mm 14mm;
    @bottom-center { content: counter(page) "/" counter(pages); font-size: 8pt; }
  }
  html, body { background: white !important; height: auto !important; overflow: visible !important; }
  body > *:not(.quotation-print-root) { display: none !important; }
  .quotation-print-root { display: block !important; }
}
`

/** Resolves once every image under `root` has loaded (or failed), or after
 * the timeout — a logo still downloading would otherwise print blank. */
function waitForImages(root: HTMLElement | null, timeoutMs: number): Promise<void> {
  if (!root) return Promise.resolve()
  const pending = Array.from(root.querySelectorAll("img")).filter((img) => !img.complete)
  if (pending.length === 0) return Promise.resolve()
  return Promise.race([
    Promise.all(
      pending.map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true })
            img.addEventListener("error", () => resolve(), { once: true })
          })
      )
    ).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ])
}

/**
 * "Download PDF": mounts a full-size copy of the quotation sheet straight
 * under <body>, waits for its logo and fonts, and opens the browser's print
 * dialog with a print stylesheet that shows only that copy — "Save as PDF"
 * produces the file. The document title becomes the suggested file name.
 */
export function QuotationPrintButton({
  sheet,
  documentTitle,
  label,
  className,
  disabled,
  variant = "outline",
  size,
}: {
  /** The sheet to print — rendered only while printing. */
  sheet: ReactNode
  documentTitle: string
  label?: string
  className?: string
  disabled?: boolean
  variant?: ButtonProps["variant"]
  size?: ButtonProps["size"]
}) {
  const t = useTranslations("Portal.Shared")
  const [job, setJob] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef(documentTitle)
  titleRef.current = documentTitle

  useEffect(() => {
    if (job === 0) return
    let cancelled = false
    const previousTitle = document.title
    const finish = () => {
      document.title = previousTitle
      setMounted(false)
    }
    window.addEventListener("afterprint", finish, { once: true })
    ;(async () => {
      await waitForImages(rootRef.current, 5000)
      try {
        await document.fonts?.ready
      } catch {
        /* fonts API unavailable — print with what is loaded */
      }
      if (cancelled) return
      setPreparing(false)
      document.title = titleRef.current
      window.print()
    })()
    return () => {
      cancelled = true
      window.removeEventListener("afterprint", finish)
      document.title = previousTitle
    }
  }, [job])

  const start = () => {
    setPreparing(true)
    setMounted(true)
    setJob((j) => j + 1)
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={cn("gap-2", className)}
        onClick={start}
        disabled={disabled || preparing}
        title={t("sales_qb_pdf_hint")}
      >
        {preparing ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
        {label ?? t("sales_qb_download_pdf")}
      </Button>
      {mounted &&
        typeof document !== "undefined" &&
        createPortal(
          <div ref={rootRef} className="quotation-print-root" aria-hidden="true">
            <style>{PRINT_CSS}</style>
            {sheet}
          </div>,
          document.body
        )}
    </>
  )
}
