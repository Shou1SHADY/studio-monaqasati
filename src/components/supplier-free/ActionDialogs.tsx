"use client"

// The windows of what a supplier does to a deal. Every window blocks for a reason written in its footer (never a
// silently disabled button), and every act is one write the rules and the server re-check.

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { AlertTriangle, Loader2, Paperclip, Star } from "lucide-react"
import { getAuth } from "firebase/auth"
import { useStorage } from "@/firebase"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { invoiceBlocks, invoiceCap, type InvoiceBlockCode, type InvoiceFacts } from "@/lib/supplier-free/invoice-rules"
import { acceptOrder, declineOrder, DECLINE_REASONS, reportDelivery } from "@/lib/supplier-free/po-writes"
import { confirmTransfer, rateContractor, registerWarranty, reportTransferMissing, sendDealMessage } from "@/lib/supplier-free/money-writes"
import { confirmSample, declineInvitation, submitFinalPrice, withdrawQuote, type QuoteContext } from "@/lib/supplier-free/quote-writes"
import { uploadSupplierFile } from "@/lib/supplier-free/uploads"
import { r2 } from "@/lib/supplier-free/deal-logic"
import type { Deal, DeclineReason } from "@/lib/supplier-free/types"
import type { Free } from "./useFree"
import { poErrorText, useWriteEnv, type WriteEnv } from "./ActionsProvider"
import { ReceiptDoc } from "./ReceiptDoc"
import { docWord, termsText } from "./ui"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { useFree } from "./useFree"

interface Open {
  kind: string
  dealId: string
  ref?: string
}

const inputCls = "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"  // the shared Input's look (16px on phones: no zoom on focus)

function Shell({
  title,
  sub,
  onClose,
  busy,
  footerNote,
  actions,
  children,
  wide,
}: {
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  busy?: boolean
  footerNote?: ReactNode
  actions?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        className={cn("max-h-[92vh] gap-0 overflow-hidden p-0", wide ? "max-w-2xl" : "max-w-lg")}
        onKeyDown={(e) => {
          // Enter submits a form field the way the prototype's modal does; a textarea, a select and a button keep their own Enter
          if (e.key !== "Enter" || e.shiftKey || (e.target as HTMLElement).tagName !== "INPUT") return
          const primary = e.currentTarget.querySelector<HTMLButtonElement>("[data-primary]")
          if (primary && !primary.disabled) {
            e.preventDefault()
            primary.click()
          }
        }}
      >
        <DialogHeader className="border-b px-5 py-4 text-start">
          <DialogTitle dir="auto">{title}</DialogTitle>
          {sub ? <DialogDescription dir="auto">{sub}</DialogDescription> : <DialogDescription className="sr-only">.</DialogDescription>}
        </DialogHeader>
        <div className="max-h-[68vh] space-y-3 overflow-y-auto px-5 py-4">{children}</div>
        {(actions || footerNote) && (
          <div className="flex flex-wrap items-center gap-3 border-t bg-muted/20 px-5 py-3">
            <p className="min-w-0 flex-1 text-xs font-semibold text-destructive" role="status">
              {footerNote && (
                <span className="inline-flex items-start gap-1.5">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{footerNote}</span>
                </span>
              )}
            </p>
            {actions}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Footer({ f, onClose, busy, disabled, label, onSubmit, danger }: { f: Free; onClose: () => void; busy: boolean; disabled: boolean; label: string; onSubmit: () => void; danger?: boolean }) {
  return (
    <>
      <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
        {f.t("cancel")}
      </Button>
      <Button type="button" data-primary onClick={onSubmit} disabled={disabled || busy} variant={danger ? "destructive" : "default"}>
        {busy && <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" />}
        {label}
      </Button>
    </>
  )
}

export function ActionDialogs({ open, onClose }: { open: Open; onClose: () => void }) {
  const f = useFree()
  const env = useWriteEnv()
  const d = f.world.deals.find((x) => x.id === open.dealId)
  if (!d || !env) return null
  const common = { f, d, env, onClose }
  switch (open.kind) {
    case "accept-po":
      return <AcceptPo {...common} />
    case "decline-po":
      return <DeclinePo {...common} />
    case "deliver":
      return <Deliver {...common} />
    case "invoice":
      return <Invoice {...common} />
    case "pay-ok":
      return <PayOk {...common} refId={open.ref} />
    case "pay-miss":
      return <PayMiss {...common} refId={open.ref} />
    case "sample-sent":
      return <SampleSent {...common} />
    case "final":
      return <FinalPrice {...common} />
    case "withdraw":
      return <Withdraw {...common} />
    case "no-quote":
      return <NoQuote {...common} />
    case "warranty":
      return <Warranty {...common} />
    case "rate":
      return <Rate {...common} />
    case "grn":
      return <GrnView {...common} grn={open.ref} />
    default:
      return null
  }
}

interface P {
  f: Free
  d: Deal
  env: WriteEnv
  onClose: () => void
}

function useRun(f: Free, onClose: () => void) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    try {
      const msg = await fn()
      if (msg) toast({ title: msg })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: poErrorText(f, err), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

function quoteCtx(f: Free, d: Deal, env: WriteEnv): QuoteContext | null {
  const rfq = f.rawRfq(d.id)
  if (!rfq) return null
  return { firestore: env.firestore, uid: env.uid, orgId: env.orgId, userName: env.userName, companyName: env.company, today: f.today, rfq, deal: d, papers: [], fileUrl: null, side: env.side }
}

// ---- Accept the order -------------------------------------------------------------------------------

function AcceptPo({ f, d, onClose }: P) {
  const { t, fmt, today, L } = f
  const po = f.poOf(d.id)
  const [date, setDate] = useState(d.po?.need && d.po.need >= today ? d.po.need : today)
  const [note, setNote] = useState("")
  const { busy, run } = useRun(f, onClose)
  if (!d.po || !po) return null
  const c = L.C(d.c)
  const block = !date ? t("blkDate") : date < today ? t("blkCommitPast") : ""
  const later = !block && d.po.need && date > d.po.need
  return (
    <Shell
      wide
      title={t("mAcceptT", { po: d.po.no })}
      sub={t("mAcceptHint", { x: fmt.date(d.po.need, true) })}
      onClose={onClose}
      busy={busy}
      footerNote={block}
      actions={
        <Footer
          f={f}
          onClose={onClose}
          busy={busy}
          disabled={!!block}
          label={t("btnAcceptPO")}
          onSubmit={() =>
            void run(async () => {
              await acceptOrder(po.id, { promisedDate: date, note })
              return t("tAccepted", { po: d.po?.no || "" })
            })
          }
        />
      }
    >
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start">{t("thItem")}</th>
              <th className="px-3 text-start">{t("thUnitPrice")}</th>
              <th className="px-3 text-start">{t("thOrdered")}</th>
            </tr>
          </thead>
          <tbody>
            {d.po.lines.map((l) => {
              const i = d.items.find((x) => x.id === l.it)
              return (
                <tr key={l.it} className="border-t">
                  <td className="px-3 py-2 font-bold">
                    <bdi>{i?.name}</bdi>
                  </td>
                  <td className="px-3 tabular-nums" dir="ltr">
                    {l.price != null ? fmt.money(l.price) : "—"}
                  </td>
                  <td className="px-3 tabular-nums" dir="ltr">
                    {fmt.n(l.qty)} {i?.unit}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("fPOValue")}</dt>
          <dd className="font-black tabular-nums" dir="ltr">
            {fmt.money(L.poValue(d))} <small className="font-normal text-muted-foreground">{t("beforeVat")}</small>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("fSite")}</dt>
          <dd className="font-bold">
            <bdi>{d.po.site || "—"}</bdi>
          </dd>
        </div>
      </dl>
      <Callout tone="info">{t("ofTermsLine", { c: c?.name || "", x: termsText(f, d.po.terms) })}</Callout>
      <label className="block text-sm font-semibold">
        {t("fCommitDate")} <span className="text-destructive">*</span>
        <input type="date" min={today} className={`${inputCls} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {later && <Callout tone="warn">{t("mAcceptLater", { x: fmt.date(d.po.need, true) })}</Callout>}
      <label className="block text-sm font-semibold">
        {t("fNoteC")}
        <textarea rows={2} maxLength={500} className={`${inputCls} mt-1 h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </Shell>
  )
}

// ---- Decline the order ---------------------------------------------------------------------------------

function DeclinePo({ f, d, onClose }: P) {
  const { t } = f
  const po = f.poOf(d.id)
  const [reason, setReason] = useState<DeclineReason | "">("")
  const [note, setNote] = useState("")
  const { busy, run } = useRun(f, onClose)
  if (!d.po || !po) return null
  const block = reason ? "" : t("blkReason")
  return (
    <Shell
      title={t("mDeclineT", { po: d.po.no })}
      sub={t("mDeclineSub")}
      onClose={onClose}
      busy={busy}
      footerNote={block}
      actions={
        <Footer
          f={f}
          onClose={onClose}
          busy={busy}
          disabled={!!block}
          label={t("btnDeclinePO")}
          danger
          onSubmit={() =>
            void run(async () => {
              const reasonText = t(`dr_${reason}` as "dr_stock")
              // The prototype's decline also says why in the conversation: «السبب — الملاحظة».
              await declineOrder(po.id, { reason: reason as DeclineReason, reasonText, note, message: note.trim() ? `${reasonText} — ${note.trim()}` : reasonText })
              return t("tDeclined")
            })
          }
        />
      }
    >
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-sm font-semibold">{t("mDeclineWhy")}</legend>
        {DECLINE_REASONS.map((r) => (
          <label key={r} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", reason === r && "border-module bg-module/5")}>
            <input type="radio" name="decl" checked={reason === r} onChange={() => setReason(r)} />
            {t(`dr_${r}` as "dr_stock")}
          </label>
        ))}
      </fieldset>
      <label className="block text-sm font-semibold">
        {t("fNoteC")}
        <textarea rows={2} maxLength={500} className={`${inputCls} mt-1 h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </Shell>
  )
}

// ---- Report delivery ------------------------------------------------------------------------------------

function Deliver({ f, d, onClose }: P) {
  const { t, today, fmt, L } = f
  const po = f.poOf(d.id)
  const [date, setDate] = useState(today)
  const [note, setNote] = useState("")
  const { busy, run } = useRun(f, onClose)
  if (!d.po || !po) return null
  const c = L.C(d.c)
  const future = date > today
  const block = !date ? t("blkDate") : future ? t("blkRepFuture") : ""
  const after = !block && d.po.acc && date > d.po.acc.date
  return (
    <Shell
      title={t("mRepT", { c: c?.name || "" })}
      sub={t("mRepSub", { po: docWord(f, "po", d.po.no) })}
      onClose={onClose}
      busy={busy}
      footerNote={block}
      actions={
        <Footer
          f={f}
          onClose={onClose}
          busy={busy}
          disabled={!!block}
          label={t("btnRepSend")}
          onSubmit={() =>
            void run(async () => {
              const said = t("msgRep", { x: fmt.date(date, true) })
              await reportDelivery(po.id, { date, note, message: note.trim() ? `${said} — ${note.trim()}` : said })
              return t("tRepSent", { c: c?.name || "" })
            })
          }
        />
      }
    >
      <label className="block text-sm font-semibold">
        {t("fRepDate")} <span className="text-destructive">*</span>
        <input type="date" max={today} className={`${inputCls} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {after && d.po.acc && <Callout tone="warn">{t("mRepLate", { x: fmt.date(d.po.acc.date, true) })}</Callout>}
      <label className="block text-sm font-semibold">
        {t("fNote")}
        <textarea rows={3} maxLength={500} placeholder={t("mRepPh")} className={`${inputCls} mt-1 h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </Shell>
  )
}

// ---- Upload the invoice -----------------------------------------------------------------------------------

const INV_BLOCK_KEY: Record<InvoiceBlockCode, string> = {
  number: "blkInvNo",
  duplicate: "blkInvDup",
  noReceipt: "blkInvNoRcpt",
  billed: "blkInvBilled",
  amount: "blkInvAmt",
  over: "blkInvOver",
  dateBefore: "blkInvDate",
  dateFuture: "blkInvDate",
  file: "blkInvFile",
}

function Invoice({ f, d, env, onClose }: P) {
  const { t, fmt, today, L, world } = f
  const storage = useStorage()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const po = f.poOf(d.id)
  const pendingRcpts = useMemo(() => L.uninvoicedReceipts(d), [L, d])
  const [picked, setPicked] = useState<string[]>(() => pendingRcpts.map((r) => r.grn))
  const [number, setNumber] = useState("")
  const [date, setDate] = useState(today)
  const [amount, setAmount] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const vatOn = L.vatRate > 0

  const facts: InvoiceFacts = useMemo(
    () => ({
      today,
      receipts: L.billableReceipts(d).map((r) => ({ id: r.grn, day: r.okAt, net: d.po && L.isLump(d.po) ? null : L.receiptNet(d, r) })),
      billed: d.invs.flatMap((i) => i.grns || []),
      lumpTotalWhenComplete: d.po && L.isLump(d.po) && L.allGot(d) ? d.po.lump || 0 : null,
      usedNumbers: world.deals.flatMap((x) => x.invs.map((i) => i.no)),
    }),
    [today, L, d, world.deals]
  )
  const cap = invoiceCap(facts, picked)
  // The amount follows the receipts picked until the supplier types his own.
  const [typed, setTyped] = useState(false)
  useEffect(() => {
    if (!typed) setAmount(cap > 0 ? String(cap) : "")
  }, [cap, typed])
  const lastDay = facts.receipts.filter((r) => picked.includes(r.id)).map((r) => r.day).sort().pop()
  useEffect(() => {
    if (lastDay && date < lastDay) setDate(lastDay < today ? lastDay : today)
  }, [lastDay]) // the date follows the receipts picked, not each keystroke

  const net = Number(amount) || 0
  const blocks = invoiceBlocks(facts, { number, date, amountNet: net, hasFile: !!file, grns: picked })
  const vat = r2(net * L.vatRate)
  const rcptWord = (g: string) => docWord(f, "grn", g)
  const blockText = (b: InvoiceBlockCode) => {
    if (b === "over") return t("blkInvOver", { v: fmt.money(cap) })
    if (b === "dateBefore" || b === "dateFuture") return t("blkInvDate", { x: fmt.date(lastDay || today, true) })
    return t(INV_BLOCK_KEY[b] as "blkInvNo")
  }
  if (!d.po || !po) return null

  const submit = async () => {
    if (blocks.length || !storage || !file) return
    setBusy(true)
    try {
      const up = await uploadSupplierFile(storage, env.orgId, "invoices", file)
      const token = await getAuth().currentUser?.getIdToken()
      const res = await fetch("/api/supplier-free/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ poId: po.id, grns: picked, number: number.trim(), date, amountNet: net, fileName: up.name, fileUrl: up.url }),
      })
      if (!res.ok) {
        // The server ran the same rule again (another invoice may have billed the receipt meanwhile): say which one.
        const refusal = (await res.json().catch(() => null)) as { blocks?: InvoiceBlockCode[] } | null
        const first = refusal?.blocks?.[0]
        toast({ title: first ? blockText(first) : t("errSave"), variant: "destructive" })
        return
      }
      toast({ title: t("tInvSent", { c: L.C(d.c)?.name || "" }) })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t("errSave"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      wide
      title={t("mInvT", { po: d.po.no })}
      sub={t("mInvSub", { v: fmt.money(cap) })}
      onClose={onClose}
      busy={busy}
      footerNote={blocks.length ? <>{blockText(blocks[0])}{blocks.length > 1 && <span className="font-normal text-muted-foreground"> · {t("plusMore", { n: f.pl("pl_more", blocks.length - 1) })}</span>}</> : null}
      actions={<Footer f={f} onClose={onClose} busy={busy} disabled={blocks.length > 0} label={t("btnSendInv")} onSubmit={() => void submit()} />}
    >
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-sm font-semibold">{t("invCovers")}</legend>
        {L.receipts(d).map((r) => {
          const billed = facts.billed.includes(r.grn)
          return (
            <label key={r.grn} className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm", billed && "opacity-50")}>
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={billed}
                  checked={picked.includes(r.grn)}
                  onChange={(e) => {
                    setTyped(false)
                    setPicked((p) => (e.target.checked ? [...p, r.grn] : p.filter((x) => x !== r.grn)))
                  }}
                />
                <b>{rcptWord(r.no || "")}</b>
                <span className="text-xs text-muted-foreground">{fmt.date(r.okAt, true)}</span>
              </span>
              <span className="tabular-nums" dir="ltr">
                {billed ? t("invBilled") : d.po && L.isLump(d.po) ? "—" : fmt.money(L.receiptNet(d, r))}
              </span>
            </label>
          )
        })}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">
          {t("fInvNo")} <span className="text-destructive">*</span>
          <input className={`${inputCls} mt-1`} dir="ltr" value={number} placeholder={t("fInvNoPh")} onChange={(e) => setNumber(e.target.value)} />
        </label>
        <label className="block text-sm font-semibold">
          {t("fInvDate")} <span className="text-destructive">*</span>
          <input type="date" max={today} min={lastDay || undefined} className={`${inputCls} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <label className="block text-sm font-semibold">
        {t("fInvAmt")} <span className="text-destructive">*</span>
        <input type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" className={`${inputCls} mt-1`} value={amount} onChange={(e) => (setTyped(true), setAmount(e.target.value))} />
      </label>
      {net > 0 && (
        <p className="text-sm text-muted-foreground" dir="auto">
          {vatOn ? t("mInvVat", { v: fmt.money(vat), g: fmt.money(r2(net + vat)) }) : t("mInvNoVat", { g: fmt.money(net) })}
        </p>
      )}
      {net > 0 && net < cap - 0.009 && <Callout tone="warn">{t("mInvDiff", { v: fmt.money(cap) })}</Callout>}
      <div>
        <p className="mb-1 text-sm font-semibold">
          {t("fInvFile")} <span className="text-destructive">*</span>
        </p>
        <input id="inv-file" type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <label htmlFor="inv-file" className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-bold hover:bg-muted/50">
          <Paperclip size={14} aria-hidden="true" />
          {t("chooseFile")}
        </label>
        <span className="ms-2 text-xs text-muted-foreground" dir="auto">
          {file ? file.name : t("noFile")}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">{t("fInvFileHint")}</p>
      </div>
    </Shell>
  )
}

// ---- Transfers ------------------------------------------------------------------------------------------------

function transferOf(d: Deal, refId?: string) {
  return d.pays.find((p) => (refId ? p.id === refId : p.st === "sent"))
}

function PayOk({ f, d, env, onClose, refId }: P & { refId?: string }) {
  const { t, fmt, L } = f
  const po = f.poOf(d.id)
  const tr = transferOf(d, refId)
  const { busy, run } = useRun(f, onClose)
  if (!po || !tr || !tr.id) return null
  const c = L.C(d.c)
  return (
    <Shell
      title={t("mPayOkT")}
      sub={t("mPayOkX", { c: c?.name || "" })}
      onClose={onClose}
      busy={busy}
      actions={
        <Footer
          f={f}
          onClose={onClose}
          busy={busy}
          disabled={false}
          label={t("btnConfirmPay")}
          onSubmit={() =>
            void run(async () => {
              await confirmTransfer(env.firestore, env.side, po, { id: tr.id as string, amount: tr.amt, bank: tr.bank, ref: tr.ref, state: tr.st })
              const after = L.owed(d) - tr.amt
              return t(after <= 0.01 && L.allGot(d) ? "tPaidFull" : "tPayOk")
            })
          }
        />
      }
    >
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{t("thAmount")}</dt>
          <dd className="font-black tabular-nums" dir="ltr">
            {fmt.money(tr.amt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("fBank")}</dt>
          <dd className="font-bold">{tr.bank}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("fRef")}</dt>
          <dd className="font-bold" dir="ltr">
            {tr.ref}
          </dd>
        </div>
      </dl>
    </Shell>
  )
}

function PayMiss({ f, d, env, onClose, refId }: P & { refId?: string }) {
  const { t } = f
  const po = f.poOf(d.id)
  const tr = transferOf(d, refId)
  const [note, setNote] = useState("")
  const { busy, run } = useRun(f, onClose)
  if (!po || !tr || !tr.id) return null
  return (
    <Shell
      title={t("mPayMissT")}
      onClose={onClose}
      busy={busy}
      actions={
        <Footer
          f={f}
          onClose={onClose}
          busy={busy}
          disabled={false}
          label={t("btnPayMissing")}
          danger
          onSubmit={() =>
            void run(async () => {
              await reportTransferMissing(env.firestore, env.side, po, { id: tr.id as string, amount: tr.amt, bank: tr.bank, ref: tr.ref, state: tr.st }, note || t("msgPayMissing", { r: tr.ref }))
              return t("tPayMiss")
            })
          }
        />
      }
    >
      <label className="block text-sm font-semibold">
        {t("fNote")}
        <textarea rows={3} maxLength={500} placeholder={t("mPayMissPh")} className={`${inputCls} mt-1 h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </Shell>
  )
}

// ---- Quote-side acts ----------------------------------------------------------------------------------------------

function SampleSent({ f, d, env, onClose }: P) {
  const { t, today, fmt } = f
  const [sentAt, setSentAt] = useState(today)
  const [by, setBy] = useState("")
  const [note, setNote] = useState("")
  const { busy, run } = useRun(f, onClose)
  const offer = f.rawOffer(d.id)
  const ctx = quoteCtx(f, d, env)
  const block = !sentAt ? t("blkDate") : sentAt > today ? t("blkRepFuture") : ""
  return (
    <Shell
      title={t("mSampleT")}
      sub={d.offer?.sample ? `${d.offer.sample.what} · ${d.offer.sample.place}` : undefined}
      onClose={onClose}
      busy={busy}
      footerNote={block}
      actions={
        <Footer
          f={f}
          onClose={onClose}
          busy={busy}
          disabled={!!block || !offer || !ctx}
          label={t("btnSampleSent")}
          onSubmit={() =>
            void run(async () => {
              if (!offer || !ctx) return
              await confirmSample(ctx, offer.id, { sentAt, receivedBy: by, note })
              await sendDealMessage(env.firestore, { chatId: offer.id, offer, uid: env.side.actor.uid, text: [t("msgSample", { x: f.fmt.date(sentAt, true) }), note.trim()].filter(Boolean).join(" — ") }).catch(() => undefined)
              return t("tSample")
            })
          }
        />
      }
    >
      <label className="block text-sm font-semibold">
        {t("fSampleAt")}
        <input type="date" max={today} className={`${inputCls} mt-1`} value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
      </label>
      <label className="block text-sm font-semibold">
        {t("fSampleWith")}
        <input className={`${inputCls} mt-1`} value={by} onChange={(e) => setBy(e.target.value)} />
      </label>
      <label className="block text-sm font-semibold">
        {t("fNote")}
        <textarea rows={2} maxLength={500} className={`${inputCls} mt-1 h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {d.offer?.sample && <p className="text-xs text-muted-foreground">{t("ocSampleBy", { x: fmt.date(d.offer.sample.by) })}</p>}
    </Shell>
  )
}

function FinalPrice({ f, d, env, onClose }: P) {
  const { t, fmt, L } = f
  const [note, setNote] = useState("")
  const { busy, run } = useRun(f, onClose)
  const offer = f.rawOffer(d.id)
  const ctx = quoteCtx(f, d, env)
  return (
    <Shell
      title={t("mFinalT")}
      sub={t("mFinalSub", { v: fmt.money(L.offerTotal(d)) })}
      onClose={onClose}
      busy={busy}
      actions={
        <Footer
          f={f}
          onClose={onClose}
          busy={busy}
          disabled={!offer || !ctx}
          label={t("btnFinal")}
          onSubmit={() =>
            void run(async () => {
              if (!offer || !ctx) return
              await submitFinalPrice(ctx, offer.id, note)
              return t("tFinal")
            })
          }
        />
      }
    >
      <textarea rows={3} maxLength={500} placeholder={t("mFinalPh")} aria-label={t("fNote")} className={`${inputCls} h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
    </Shell>
  )
}

function Withdraw({ f, d, env, onClose }: P) {
  const { t } = f
  const [note, setNote] = useState("")
  const { busy, run } = useRun(f, onClose)
  const offer = f.rawOffer(d.id)
  const ctx = quoteCtx(f, d, env)
  return (
    <Shell
      title={t("mWithdrawT", { t: d.title })}
      sub={t("mWithdrawSub")}
      onClose={onClose}
      busy={busy}
      actions={
        <Footer
          f={f}
          onClose={onClose}
          busy={busy}
          disabled={!offer || !ctx}
          label={t("btnWithdraw")}
          danger
          onSubmit={() =>
            void run(async () => {
              if (!offer || !ctx) return
              await withdrawQuote(ctx, offer.id)
              if (note.trim()) await sendDealMessage(env.firestore, { chatId: offer.id, offer, uid: env.side.actor.uid, text: note.trim().slice(0, 500) }).catch(() => undefined)
              return t("tWithdrawn")
            })
          }
        />
      }
    >
      <Callout tone="warn">{t("mWithdrawSub")}</Callout>
      <textarea rows={3} maxLength={500} placeholder={t("mWithdrawPh")} aria-label={t("fNote")} className={`${inputCls} h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
    </Shell>
  )
}

function NoQuote({ f, d, env, onClose }: P) {
  const { t } = f
  const [note, setNote] = useState("")
  const { busy, run } = useRun(f, onClose)
  const ctx = quoteCtx(f, d, env)
  return (
    <Shell
      title={t("mNoQuoteT", { t: d.title })}
      sub={t("mNoQuoteSub")}
      onClose={onClose}
      busy={busy}
      actions={
        <Footer
          f={f}
          onClose={onClose}
          busy={busy}
          disabled={!ctx}
          label={t("btnNoQuote")}
          danger
          onSubmit={() =>
            void run(async () => {
              if (!ctx) return
              await declineInvitation(ctx, note)
              return t("tNoQuote")
            })
          }
        />
      }
    >
      <label className="block text-sm font-semibold">
        {t("fNoteC")}
        <textarea rows={3} maxLength={500} className={`${inputCls} mt-1 h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </Shell>
  )
}

// ---- Warranty and rating -----------------------------------------------------------------------------------------------

function Warranty({ f, d, env, onClose }: P) {
  const { t, today } = f
  const storage = useStorage()
  const po = f.poOf(d.id)
  // Only what the contractor accepted at the gate can carry a warranty (ORD-14); the server checks it again.
  const items = d.po ? d.po.lines.filter((l) => l.got > 0).map((l) => d.items.find((i) => i.id === l.it)).filter((i): i is NonNullable<typeof i> => !!i) : []
  const [item, setItem] = useState(items[0]?.id || "")
  const [until, setUntil] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const { busy, run } = useRun(f, onClose)
  const block = !until || until <= today ? t("blkWarDate") : !file ? t("blkWarFile") : ""
  if (!po) return null
  return (
    <Shell
      title={t("mWarT")}
      sub={t("mWarSub")}
      onClose={onClose}
      busy={busy}
      footerNote={block}
      actions={
        <Footer
          f={f}
          onClose={onClose}
          busy={busy}
          disabled={!!block}
          label={t("btnWarSend")}
          onSubmit={() =>
            void run(async () => {
              if (!storage || !file) return
              const up = await uploadSupplierFile(storage, env.orgId, "warranties", file)
              await registerWarranty(env.firestore, env.side, po, { itemId: item, until, file: { name: up.name, url: up.url } }, today)
              return t("tWar", { c: f.L.C(d.c)?.name || "" })
            })
          }
        />
      }
    >
      <label className="block text-sm font-semibold">
        {t("fWarItem")}
        <NativeSelect className={`${inputCls} mt-1`} value={item} onChange={(e) => setItem(e.target.value)}>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="block text-sm font-semibold">
        {t("fWarUntil")}
        <input type="date" min={today} className={`${inputCls} mt-1`} value={until} onChange={(e) => setUntil(e.target.value)} />
      </label>
      <div>
        <p className="mb-1 text-sm font-semibold">{t("fWarFile")}</p>
        <input id="war-file" type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <label htmlFor="war-file" className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-bold hover:bg-muted/50">
          <Paperclip size={14} aria-hidden="true" />
          {t("chooseFile")}
        </label>
        <span className="ms-2 text-xs text-muted-foreground" dir="auto">
          {file ? file.name : t("noFile")}
        </span>
      </div>
    </Shell>
  )
}

function Rate({ f, d, onClose }: P) {
  const { t, L } = f
  const po = f.poOf(d.id)
  const offer = f.rawOffer(d.id)
  const [stars, setStars] = useState(0)
  const [text, setText] = useState("")
  const { busy, run } = useRun(f, onClose)
  const c = L.C(d.c)
  const rfq = f.rawRfq(d.id)
  const block = stars ? "" : t("blkStars")
  if (!po || !offer || !rfq) return null
  return (
    <Shell
      title={t("mRateT", { c: c?.name || "" })}
      sub={t("mRateSub")}
      onClose={onClose}
      busy={busy}
      footerNote={block}
      actions={
        <Footer
          f={f}
          onClose={onClose}
          busy={busy}
          disabled={!!block}
          label={t("btnRateSend")}
          onSubmit={() =>
            void run(async () => {
              await rateContractor({ po, stars, text })
              return t("tRated")
            })
          }
        />
      }
    >
      <div role="radiogroup" aria-label={t("mRateStars")} className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n}`} onClick={() => setStars(n)} className="rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Star size={28} className={n <= stars ? "fill-warning text-warning" : "text-muted-foreground/40"} aria-hidden="true" />
          </button>
        ))}
      </div>
      <textarea rows={3} maxLength={1000} placeholder={t("mRatePh")} aria-label={t("fNote")} className={`${inputCls} h-auto py-2`} value={text} onChange={(e) => setText(e.target.value)} />
    </Shell>
  )
}

function GrnView({ f, d, onClose, grn }: P & { grn?: string }) {
  const r = f.L.receipts(d).find((x) => x.grn === grn)
  if (!r) return null
  return (
    <Shell
      title={f.t("grnModalT", { n: (r.no || "").replace(/^\D+-?/, "") || "—" })}
      onClose={onClose}
      wide
      actions={
        <Button type="button" variant="outline" onClick={onClose}>
          {f.t("close")}
        </Button>
      }
    >
      <ReceiptDoc f={f} d={d} r={r} />
    </Shell>
  )
}

