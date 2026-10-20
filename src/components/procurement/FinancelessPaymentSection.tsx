"use client"

// «الدفع» on an order of a company WITHOUT Finance (Procurement 1.5, PUR-10, question 5): it
// takes the place of «مسار المال». An optional status — لم يُدفع · دُفع جزء · دُفع — with its day,
// the advance marked paid (the supplier's date counts from it), the receipt so far, and the
// supplier's invoice as a FILE sent to the accountant. No ledger, no «أوقف صرف فاتورة»: the
// company's accounting lives in its own system. The status never stops the order closing,
// and the supplier reads it on his order.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { collection, doc, query, serverTimestamp, setDoc, where } from "firebase/firestore"
import { Download, Loader2, Mail, Upload } from "lucide-react"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Chip } from "@/components/module-ui/Chip"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { sarLtr } from "@/lib/riyal"
import { fitForUpload } from "@/lib/upload-fit"
import { lineOutstanding, todayOf } from "@/lib/procurement/po"
import { PAYMENT_STATES, paymentStateOf, type FinancelessPo, type InvoiceFile, type PaymentState } from "@/lib/procurement/payment-mark"
import { fmtDayLong } from "@/lib/procurement/format"
import { receiptProgress } from "@/lib/procurement/next-step"
import { PROCUREMENT_SETTINGS, type ProcActor } from "@/lib/procurement/types"

const TONE: Record<PaymentState, "mute" | "warn" | "ok"> = { unpaid: "mute", part: "warn", paid: "ok" }

export function FinancelessPaymentSection({ po, actor, orgId, Section }: { po: FinancelessPo & { advancePercent?: number | null }; actor: ProcActor; orgId: string; Section: (p: { title: string; children: React.ReactNode }) => React.ReactElement }) {
  const t = useTranslations("Portal.ProcOrders")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [marking, setMarking] = useState<null | "status" | "advance">(null)
  const [state, setState] = useState<PaymentState>(paymentStateOf(po))
  const [day, setDay] = useState(() => todayOf(new Date()))
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [askEmail, setAskEmail] = useState<null | { url: string; name: string }>(null)
  const [email, setEmail] = useState("")
  // The supplier's invoices from his portal («الفواتير والحوالات») beside the files uploaded here — one list, by link.
  const supQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "supplierInvoices"), where("buyerOrgId", "==", orgId), where("poId", "==", po.id)) : null), [firestore, orgId, po.id])
  const { data: supplierInvoices } = useCollection<{ number?: string; file?: { name?: string; url?: string }; createdAt?: string }>(supQ)
  const invoiceFiles = useMemo<InvoiceFile[]>(() => {
    const own = po.invoiceFiles || []
    const fromPortal = (supplierInvoices || [])
      .filter((i) => i.file?.url && !own.some((f) => f.url === i.file?.url))
      .map((i) => ({ name: i.file?.name || i.number || "", url: i.file?.url as string, from: "supplier" as const, number: i.number || null, at: i.createdAt || "" }))
    return [...fromPortal, ...own]
  }, [po.invoiceFiles, supplierInvoices])
  const marksPayment = actor.isOwner || actor.canApprove
  const files = actor.isOwner || actor.canPrepare || actor.canApprove
  const total = Math.round(po.totalExVat * (1 + (po.vatRate || 0)) * 100) / 100
  const progress = receiptProgress(po.lines)
  const done = po.lines.every((l) => lineOutstanding(l) <= 0)
  const advancePct = Number(po.advancePercent) || 0
  const money = (v: number) => sarLtr(v.toLocaleString("en-US", { maximumFractionDigits: 2 }))
  const token = async () => (await getAuth().currentUser?.getIdToken()) || ""

  const submitMark = async () => {
    setBusy("mark")
    try {
      const res = await fetch("/api/procurement/payment-mark", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ poId: po.id, kind: marking, state: marking === "status" ? state : undefined, day, amount: amount ? Number(amount.replace(/,/g, "")) : null, reference: reference || null }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast({ title: t("pay.saved") })
      setMarking(null)
      setAmount("")
      setReference("")
    } catch {
      toast({ title: t("pay.failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const upload = async (list: FileList | null) => {
    const picked = list?.[0]
    if (!picked) return
    setBusy("upload")
    try {
      const f = await fitForUpload(picked)
      if (!f) {
        toast({ title: t("pay.too_big"), variant: "destructive" })
        return
      }
      const fd = new FormData()
      fd.append("file", f)
      fd.append("poId", po.id)
      const res = await fetch("/api/procurement/invoice-file", { method: "POST", headers: { Authorization: `Bearer ${await token()}` }, body: fd })
      if (!res.ok) throw new Error(String(res.status))
      toast({ title: t("pay.invoice_saved") })
    } catch {
      toast({ title: t("pay.failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const sendToAccountant = async (url: string, name: string) => {
    setBusy(url)
    try {
      const res = await fetch("/api/procurement/to-accountant", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ kind: "invoice", poId: po.id, url, name }) })
      const body = (await res.json().catch(() => null)) as { code?: string; data?: { to?: string } } | null
      if (res.ok) toast({ title: t("pay.sent_to", { to: body?.data?.to || "" }) })
      // Setting the address is the owner's or the approver's (the settings rules); anyone else is told whom to ask.
      else if (body?.code === "NO_ACCOUNTANT") {
        if (actor.isOwner || actor.canApprove) setAskEmail({ url, name })
        else toast({ title: t("pay.no_accountant_ask"), variant: "destructive" })
      }
      else toast({ title: t("pay.not_sent"), variant: "destructive" })
    } catch {
      toast({ title: t("pay.not_sent"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const saveEmailAndSend = async () => {
    if (!firestore || !askEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return
    try {
      await setDoc(doc(firestore, PROCUREMENT_SETTINGS, orgId), { organizationId: orgId, accountantEmail: email.trim().toLowerCase(), updatedAt: serverTimestamp() }, { merge: true })
    } catch {
      toast({ title: t("pay.failed"), variant: "destructive" })
      return
    }
    const next = askEmail
    setAskEmail(null)
    await sendToAccountant(next.url, next.name)
  }

  const last = po.paymentMark
  return (
    <Section title={t("pay.title")}>
      <div className="flex flex-wrap items-center gap-2">
        {PAYMENT_STATES.map((s) => (
          <StatusPill key={s} tone={paymentStateOf(po) === s ? TONE[s] : "mute"} className={paymentStateOf(po) === s ? "" : "opacity-40"}>
            {t(`pay.state_${s}`)}
          </StatusPill>
        ))}
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("pay.total")}</dt>
          <dd className="font-semibold tabular-nums">{money(total)}</dd>
        </div>
        {advancePct > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t("pay.advance", { pct: advancePct })}</dt>
            <dd className="font-semibold">
              {po.advancePaidDay ? (
                t("pay.advance_paid", { date: fmtDayLong(po.advancePaidDay, locale, false) })
              ) : marksPayment ? (
                <Button size="sm" variant="outline" onClick={() => setMarking("advance")}>
                  {t("pay.mark_advance")}
                </Button>
              ) : (
                t("pay.advance_unpaid")
              )}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("pay.received")}</dt>
          <dd className="font-semibold">{done ? t("pay.received_done") : progress.byLines ? t("pay.received_lines", { done: progress.linesDone, total: progress.linesTotal }) : t("pay.received_of", { received: progress.received.toLocaleString("en-US"), ordered: progress.ordered.toLocaleString("en-US"), unit: progress.unit })}</dd>
        </div>
        {last && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("pay.last")}</dt>
            <dd className="text-end">
              {t(`pay.state_${last.state}`)} · {fmtDayLong(last.day, locale, false)}
              {last.reference ? ` · ${t("pay.ref", { ref: last.reference })}` : ""} · {last.byName}
            </dd>
          </div>
        )}
      </dl>

      <div className="space-y-2 border-t pt-3">
        <p className="text-xs font-semibold text-muted-foreground">{t("pay.invoices")}</p>
        {invoiceFiles.length === 0 && <p className="text-xs text-muted-foreground">{t("pay.no_invoice")}</p>}
        {invoiceFiles.map((f) => (
          <div key={f.url} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
            <span className="min-w-0 truncate" dir="auto">
              {f.number || f.name} <span className="text-xs text-muted-foreground">· {t(f.from === "buyer" ? "pay.from_buyer" : "pay.from_supplier")}</span>
              {f.sentToAccountantAt && <span className="ms-1 text-xs text-success">· {t("pay.sent_on", { date: fmtDayLong(f.sentToAccountantAt.slice(0, 10), locale, false) })}</span>}
            </span>
            <span className="flex gap-1.5">
              <Button asChild size="sm" variant="ghost" className="gap-1">
                <a href={f.url} target="_blank" rel="noreferrer">
                  <Download size={13} /> {t("pay.download")}
                </a>
              </Button>
              {files && (
                <Button size="sm" variant="outline" className="gap-1" disabled={busy === f.url} onClick={() => void sendToAccountant(f.url, f.number || f.name)}>
                  {busy === f.url ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} {t("pay.to_accountant")}
                </Button>
              )}
            </span>
          </div>
        ))}
        {files && (
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-3 text-xs font-semibold text-muted-foreground hover:text-foreground">
            {busy === "upload" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {t("pay.upload_invoice")}
            <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => void upload(e.target.files)} />
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-[11px] text-muted-foreground">{t("pay.optional")}</p>
        {marksPayment && (
          <Button size="sm" onClick={() => setMarking("status")}>
            {t("pay.mark")}
          </Button>
        )}
      </div>

      <Dialog open={!!marking} onOpenChange={(o) => !o && setMarking(null)}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{marking === "advance" ? t("pay.mark_advance") : t("pay.mark")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {marking === "status" && (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("pay.title")}>
                {PAYMENT_STATES.map((s) => (
                  <Chip key={s} selected={state === s} onClick={() => setState(s)}>
                    {t(`pay.state_${s}`)}
                  </Chip>
                ))}
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="pm-day" className="text-xs">{t("pay.day")}</Label>
              <Input id="pm-day" type="date" value={day} max={todayOf(new Date())} onChange={(e) => setDay(e.target.value)} dir="ltr" />
            </div>
            {marking === "status" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="pm-amount" className="text-xs">{t("pay.amount")}</Label>
                  <Input id="pm-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" className="tabular-nums" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pm-ref" className="text-xs">{t("pay.reference")}</Label>
                  <Input id="pm-ref" value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarking(null)} disabled={busy === "mark"}>
              {t("pay.cancel")}
            </Button>
            <Button onClick={() => void submitMark()} disabled={busy === "mark" || !day} className="gap-1.5">
              {busy === "mark" && <Loader2 size={14} className="animate-spin" />}
              {t("pay.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!askEmail} onOpenChange={(o) => !o && setAskEmail(null)}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("pay.ask_email")}</DialogTitle>
          </DialogHeader>
          <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="accountant@company.sa" aria-label={t("pay.ask_email")} />
          <p className="text-xs text-muted-foreground">{t("pay.ask_email_hint")}</p>
          <DialogFooter>
            <Button onClick={() => void saveEmailAndSend()} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>
              {t("pay.save_and_send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}
