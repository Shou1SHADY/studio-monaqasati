"use client"

// «صدّر للمحاسبة» on «أوامر الشراء» of a company WITHOUT Finance (Procurement 1.5, PUR-10): a period,
// then the approved orders and the goods receipts in fixed columns (Excel or CSV), with the
// supplier invoices' links — downloaded, or sent to the accountant's address in the policies.
// An export, not a link to his system.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { Download, Loader2, Mail } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Chip } from "@/components/module-ui/Chip"
import { Callout } from "@/components/module-ui/Callout"
import { addDays, todayOf } from "@/lib/procurement/po"
import { ORDER_COLUMNS, RECEIPT_COLUMNS, accountantExport, toCsv, type Cell } from "@/lib/procurement/accountant-export"
import type { FinancelessPo } from "@/lib/procurement/payment-mark"
import type { ReceiptFact } from "@/lib/procurement/types"

type Format = "xlsx" | "csv"
type What = { po: boolean; grn: boolean; inv: boolean }
const WHAT: ReadonlyArray<keyof What> = ["po", "grn", "inv"]

const monthStart = (today: string) => `${today.slice(0, 7)}-01`

async function workbook(tables: Array<{ title: string; head: string[]; rows: Cell[][] }>, rtl: boolean): Promise<string> {
  const XLSX = await import("xlsx")
  const wb = XLSX.utils.book_new()
  for (const t of tables) {
    const ws = XLSX.utils.aoa_to_sheet([t.head, ...t.rows])
    ws["!cols"] = t.head.map(() => ({ wch: 18 }))
    XLSX.utils.book_append_sheet(wb, ws, t.title.slice(0, 31))
  }
  if (rtl) wb.Workbook = { Views: [{ RTL: true }] }
  return XLSX.write(wb, { bookType: "xlsx", type: "base64" }) as string
}

const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function AccountantExportDialog({ open, onOpenChange, orders, receipts }: { open: boolean; onOpenChange: (o: boolean) => void; orders: FinancelessPo[]; receipts: ReceiptFact[] }) {
  const t = useTranslations("Portal.ProcOrders.export")
  const tp = useTranslations("Portal.ProcOrders.pay")
  const locale = useLocale()
  const { toast } = useToast()
  const today = todayOf(new Date())
  const [from, setFrom] = useState(() => monthStart(today))
  const [to, setTo] = useState(today)
  const [format, setFormat] = useState<Format>("xlsx")
  const [what, setWhat] = useState<What>({ po: true, grn: true, inv: true })
  const [busy, setBusy] = useState<null | "download" | "send">(null)
  const [noAccountant, setNoAccountant] = useState(false)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to

  const data = useMemo(() => (valid ? accountantExport(orders, receipts, { from, to }, (s) => tp(`state_${s}`)) : null), [valid, orders, receipts, from, to, tp])
  const tables = () =>
    data
      ? [
          ...(what.po ? [{ title: t("sheet_orders"), head: ORDER_COLUMNS.map((c) => t(`ocol_${c}`)), rows: data.orders }] : []),
          ...(what.grn ? [{ title: t("sheet_receipts"), head: RECEIPT_COLUMNS.map((c) => t(`rcol_${c}`)), rows: data.receipts }] : []),
          ...(what.inv ? [{ title: t("sheet_invoices"), head: [t("icol_order"), t("icol_name"), t("icol_url")], rows: data.invoices.map((i) => [i.order, i.name, i.url] as Cell[]) }] : []),
        ]
      : []
  const withZip = what.inv && (data?.invoices.length ?? 0) > 0
  const nothing = !what.po && !what.grn && !what.inv
  const tableName = `procurement-${from}-${to}.${format}`
  const filename = withZip ? `procurement-${from}-${to}.zip` : tableName
  const tableBase64 = async () => (format === "xlsx" ? workbook(tables(), locale === "ar") : toBase64(toCsv(tables())))
  // The table, and — when the supplier invoices are asked for — a zip that carries them beside it (the server reads each file from its own order).
  const content = async () => {
    const table = await tableBase64()
    if (!withZip || !data) return table
    const token = (await getAuth().currentUser?.getIdToken()) || ""
    const res = await fetch("/api/procurement/receipt-export", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "invoices", poIds: data.poIds, table: { filename: tableName, base64: table } }),
    })
    if (!res.ok) throw new Error("zip")
    const bytes = new Uint8Array(await res.arrayBuffer())
    let bin = ""
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }

  const download = async () => {
    setBusy("download")
    try {
      const b64 = await content()
      const bin = atob(b64)
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: withZip ? "application/zip" : format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: t(withZip ? "downloaded" : "downloaded_file") })
    } catch {
      toast({ title: tp("failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const send = async () => {
    setBusy("send")
    setNoAccountant(false)
    try {
      const token = (await getAuth().currentUser?.getIdToken()) || ""
      const res = await fetch("/api/procurement/to-accountant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind: "export", filename, content: await content(), period: `${from} — ${to}` }),
      })
      const body = (await res.json().catch(() => null)) as { code?: string; data?: { to?: string } } | null
      if (res.ok) {
        toast({ title: tp("sent_to", { to: body?.data?.to || "" }) })
        onOpenChange(false)
      } else if (body?.code === "NO_ACCOUNTANT") setNoAccountant(true)
      else toast({ title: tp("not_sent"), variant: "destructive" })
    } catch {
      toast({ title: tp("not_sent"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Chip selected={from === monthStart(today) && to === today} onClick={() => (setFrom(monthStart(today)), setTo(today))}>
              {t("this_month")}
            </Chip>
            <Chip
              selected={from === monthStart(addDays(monthStart(today), -1)) && to === addDays(monthStart(today), -1)}
              onClick={() => {
                const end = addDays(monthStart(today), -1)
                setFrom(monthStart(end))
                setTo(end)
              }}
            >
              {t("last_month")}
            </Chip>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ax-from" className="text-xs">{t("from")}</Label>
              <Input id="ax-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ax-to" className="text-xs">{t("to")}</Label>
              <Input id="ax-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} dir="ltr" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t("format")}>
            <span className="text-xs font-semibold text-muted-foreground">{t("format")}</span>
            <Chip selected={format === "xlsx"} onClick={() => setFormat("xlsx")}>
              Excel
            </Chip>
            <Chip selected={format === "csv"} onClick={() => setFormat("csv")}>
              CSV
            </Chip>
          </div>
          <div className="space-y-1.5" role="group" aria-label={t("what_label")}>
            {WHAT.map((k) => (
              <label key={k} className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={what[k]} onChange={() => setWhat((w) => ({ ...w, [k]: !w[k] }))} />
                <span>{t(`what_${k}`)}</span>
              </label>
            ))}
          </div>
          <Callout tone="info">{t("fixed_columns")}</Callout>
          {data && (
            <p className="text-sm text-muted-foreground">
              {t("counts", { orders: data.orders.length, receipts: data.receipts.length, invoices: data.invoices.length })}
            </p>
          )}
          {noAccountant && <Callout tone="warn">{t("no_accountant")}</Callout>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="gap-1.5" disabled={!data || nothing || busy != null} onClick={() => void send()}>
            {busy === "send" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            {t("send")}
          </Button>
          <Button className="gap-1.5" disabled={!data || nothing || busy != null} onClick={() => void download()}>
            {busy === "download" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {t("download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
