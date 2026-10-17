"use client"

// The collapsible sections of the deal drawer (PRD NAV-05): the request · my quote · the purchase order · delivery and
// receipts · invoices and transfers · warranty · the conversation. Each reads the deal — nothing here keeps a figure of its own.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Bell, ClipboardList, FileText, MessageSquare, Paperclip, Send, Shield, Truck, Upload, Wallet } from "lucide-react"
import { arrayRemove, collection, doc, orderBy, query, updateDoc, type Firestore } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { useToast } from "@/hooks/use-toast"
import { useSupplierQuestions } from "@/hooks/useSupplierQuestions"
import { Callout } from "@/components/module-ui/Callout"
import { displayCategory } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { r2 } from "@/lib/supplier-free/deal-logic"
import { riyadhDayOf } from "@/lib/supplier-free/format"
import { sendDealMessage } from "@/lib/supplier-free/money-writes"
import { canRegisterWarranty } from "@/lib/supplier-free/warranty"
import type { Deal, DealReceipt, DealReport } from "@/lib/supplier-free/types"
import type { Free } from "./useFree"
import { useActions } from "./ActionsProvider"
import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Pill, actionBtn, docWord, stk, termsText } from "./ui"
import { InstalmentPill } from "./Pills"

const lblCls = "text-xs text-muted-foreground"
const th = "px-3 py-2 text-start text-xs font-bold text-muted-foreground"
const td = "px-3 py-2 text-sm tabular-nums"
// Inner tables stack into labelled rows on a phone, as the lists do (NFR-03: no sideways scroll at 390px).
const stkWrap = "rounded-lg border md:overflow-x-auto"
const stkHead = "bg-muted/30 max-md:hidden"
const stkRow = "border-t max-md:block max-md:px-3 max-md:py-2 max-md:first:border-t-0"

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <dt className={lblCls}>{k}</dt>
      <dd className="text-sm font-bold">{v}</dd>
    </div>
  )
}

function Money({ children }: { children: ReactNode }) {
  return (
    <span className="tabular-nums" dir="ltr">
      {children}
    </span>
  )
}

function SmallBtn({ onClick, icon: Icon, children, tone = "outline" }: { onClick: () => void; icon?: typeof Bell; children: ReactNode; tone?: "outline" | "primary" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={actionBtn(tone === "primary" ? "primary" : "outline")}
    >
      {Icon && <Icon size={13} aria-hidden="true" />}
      {children}
    </button>
  )
}

// ---- The request -----------------------------------------------------------------------------------------

export function SecRequest({ f, d }: { f: Free; d: Deal }) {
  const { t, fmt, L, rel, pl } = f
  const st = L.stage(d)
  const open = L.daysTo(d.deadline) >= 0 && (st === "new" || st === "offered")
  const [q, setQ] = useState("")
  const [sending, setSending] = useState(false)
  // His own questions with their state, and the answered ones of others without the asker (decision 10: visible to all
  // bidders) — served by the server; asking goes through it too, so the request's owner is told.
  const { rows: list, ask: askServer } = useSupplierQuestions(d.id)
  const { toast } = useToast()
  const ask = async () => {
    const text = q.trim()
    if (!text || !f.profile) return
    setSending(true)
    try {
      await askServer(text.slice(0, 1000))
      setQ("")
    } catch (err) {
      console.error(err)
      toast({ title: t("errSave"), variant: "destructive" })
    } finally {
      setSending(false)
    }
  }
  return (
    <DrawerSection title={<span className="inline-flex items-center gap-2"><ClipboardList size={15} aria-hidden="true" />{t("secReq")}</span>} count={d.items.length} defaultOpen={st === "new"}>
      <dl className="grid gap-3 py-2 sm:grid-cols-2">
        <KV k={t("fDeadline")} v={<>{fmt.date(d.deadline, true)}{st === "new" && <span className="ms-1 text-xs font-normal text-muted-foreground">({rel(d.deadline)})</span>}</>} />
        <KV k={t("fNeedBy")} v={fmt.date(d.needBy, true)} />
        <KV k={t("fPricing")} v={t(d.pricing === "total" ? "prTotal" : "prItem")} />
        <KV k={t("fTerms")} v={d.terms ? termsText(f, d.terms) : "—"} />
        <KV k={t("fChannel")} v={t(`ch_${d.channel}`)} />
        <KV k={t("fCat")} v={<span dir="auto">{displayCategory(d.cat, f.locale)}</span>} />
      </dl>
      <div className={stkWrap}>
        <table className={stk.table}>
          <thead className={stkHead}>
            <tr>
              <th className={th}>#</th>
              <th className={th}>{t("thItem")}</th>
              <th className={th}>{t("thQty")}</th>
              <th className={th}>{t("thUnit")}</th>
            </tr>
          </thead>
          <tbody className={stk.tbody}>
            {d.items.map((i, k) => (
              <tr key={i.id} className={stkRow}>
                <td className={cn(td, "text-muted-foreground", stk.wide)}>{k + 1}</td>
                <td className={cn("px-3 py-2 text-sm font-bold", stk.head)}>
                  <bdi>{i.name}</bdi>
                  {i.spec && <span className="block text-xs font-normal text-muted-foreground">{i.spec}</span>}
                </td>
                <td className={cn(td, stk.cell)} data-l={t("thQty")}>
                  <span dir="ltr">{fmt.n(i.qty)}</span>
                </td>
                <td className={cn("px-3 text-sm", stk.cell)} data-l={t("thUnit")}>{i.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {d.files.map((fl, i) => (
            <a key={i} href={fl.url || undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/30 px-2.5 py-1 text-xs">
              <Paperclip size={13} aria-hidden="true" />
              <bdi>{fl.n}</bdi>
              {fl.s && <small className="text-muted-foreground">{fl.s}</small>}
            </a>
          ))}
        </div>
      )}
      <h4 className="mt-4 text-sm font-bold">{t("qaTitle")}</h4>
      {list.length ? (
        <ul className="mt-2 space-y-2">
          {list.map((x, i) => (
            <li key={i} className="rounded-lg border p-2.5 text-sm">
              <b dir="auto">{x.question}</b>
              <span className="mt-0.5 block text-muted-foreground" dir="auto">
                {x.reply ? x.reply : <i>{t("qaWait")}</i>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">{t("qaNone")}</p>
      )}
      {open && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void ask()
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder={t("qaPh")} aria-label={t("qaPh")} className="h-9 min-w-0 flex-1" />
          <button disabled={sending || !q.trim()} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("qaSend")}
          </button>
        </form>
      )}
      <span className="sr-only">{pl("pl_item", d.items.length)}</span>
    </DrawerSection>
  )
}

// ---- My quote ----------------------------------------------------------------------------------------------

export function SecOffer({ f, d }: { f: Free; d: Deal }) {
  const { t, fmt, L } = f
  const o = d.offer
  const v = L.curV(d)
  if (!o || !v) return null
  const st = L.stage(d)
  const tot = L.offerTotal(d)
  const vatRate = L.quoteVatRate(d, v)
  const vat = r2(tot * vatRate)
  return (
    <DrawerSection title={<span className="inline-flex items-center gap-2"><Send size={15} aria-hidden="true" />{t("secOffer")}</span>} summary={<bdi>{fmt.money(tot)}</bdi>} defaultOpen={st === "offered" || (st === "done" && !d.po)}>
      <div className="space-y-3 py-2">
        {o.reduce && (
          <Callout tone="warn">
            <b>{t("reduceAsked", { v: fmt.money(o.reduce.target), x: fmt.date(o.reduce.at) })}</b>
            {o.reduce.note && <span> «{o.reduce.note}»</span>}
            {o.reduce.reply && (
              <span className="mt-1 block">
                {t(o.reduce.reply.kind === "lowered" ? "reduceLowered" : "reduceFinal", { x: fmt.date(o.reduce.reply.at) })}
              </span>
            )}
          </Callout>
        )}
        {o.sample && (
          <Callout tone="warn">
            <b>{t("sampleAsked", { w: o.sample.what, x: fmt.date(o.sample.at) })}</b> {t("samplePlace", { p: o.sample.place, x: fmt.date(o.sample.by) })}
            {o.sample.sentAt && <span className="mt-1 block">{t("sampleSentOn", { x: fmt.date(o.sample.sentAt) })}</span>}
          </Callout>
        )}
        {d.pricing === "total" ? (
          <p className="text-sm">
            {t("prTotalLbl")}: <b><Money>{fmt.money(tot)}</Money></b>
          </p>
        ) : (
          <div className={stkWrap}>
            <table className={stk.table}>
              <thead className={stkHead}>
                <tr>
                  <th className={th}>{t("thItem")}</th>
                  <th className={th}>{t("thQty")}</th>
                  <th className={th}>{t("thUnitPrice")}</th>
                  <th className={th}>{t("thTotal")}</th>
                </tr>
              </thead>
              <tbody className={stk.tbody}>
                {d.items.map((i) => {
                  const p = v.prices[i.id]
                  return (
                    <tr key={i.id} className={stkRow}>
                      <td className={cn("px-3 py-2 text-sm font-bold", stk.head)}>
                        <bdi>{i.name}</bdi>
                      </td>
                      <td className={cn(td, stk.cell)} data-l={t("thQty")}>
                        <span dir="ltr">{fmt.n(i.qty)} {i.unit}</span>
                      </td>
                      <td className={cn(td, stk.cell)} data-l={t("thUnitPrice")}>
                        {p != null ? <span dir="ltr">{fmt.money(p)}</span> : <span className="text-muted-foreground">{t("notSupplied")}</span>}
                      </td>
                      <td className={cn(td, stk.cell)} data-l={t("thTotal")}>
                        <span dir="ltr">{p != null ? fmt.money(r2(p * i.qty)) : "—"}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <dl className="space-y-1 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">{t("sumNet")}</dt><dd className="font-bold"><Money>{fmt.money(tot)}</Money></dd></div>
          {vatRate > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">{t("sumVat")}</dt><dd className="font-bold"><Money>{fmt.money(vat)}</Money></dd></div>}
          <div className="flex justify-between border-t pt-1 text-base"><dt className="font-bold">{t("sumGross")}</dt><dd className="font-black"><Money>{fmt.money(r2(tot + vat))}</Money></dd></div>
        </dl>
        <dl className="grid gap-3 sm:grid-cols-2">
          <KV k={t("fSentAt")} v={fmt.date(v.at, true)} />
          <KV k={t("fArrive")} v={v.arrive ? fmt.date(v.arrive, true) : <span className="font-normal text-muted-foreground">{t("notSet")}</span>} />
          <KV k={t("fValid")} v={fmt.date(v.valid, true)} />
          {o.v.length > 1 && <KV k={t("fVersion")} v={t("versionN", { n: o.v.length })} />}
        </dl>
        {v.note && (
          <p className="flex gap-2 rounded-lg border bg-muted/30 p-2.5 text-sm" dir="auto">
            <MessageSquare size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {v.note}
          </p>
        )}
        {o.v.length > 1 && (
          <ul className="flex flex-wrap gap-2 text-xs">
            {o.v.map((x, i) => (
              <li key={i} className={cn("rounded-full border px-2.5 py-1 tabular-nums", i === o.v.length - 1 ? "border-cta bg-cta/5 font-bold" : "text-muted-foreground")}>
                {t("versionShort", { n: i + 1 })} · {fmt.date(x.at)} · {fmt.money(L.offerTotal(d, x))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </DrawerSection>
  )
}

// ---- The purchase order -------------------------------------------------------------------------------------

export function SecPo({ f, d }: { f: Free; d: Deal }) {
  const { t, fmt, L } = f
  const po = d.po
  if (!po) return null
  const st = L.stage(d)
  const lines = po.lines.map((l) => ({ l, s: L.lineSt(l), i: d.items.find((x) => x.id === l.it) }))
  const anyRej = lines.some((x) => x.s.rej)
  const anyCan = lines.some((x) => x.s.can)
  return (
    <DrawerSection title={<span className="inline-flex items-center gap-2"><FileText size={15} aria-hidden="true" />{t("secPO")}</span>} summary={<bdi>{docWord(f, "po", po.no)}</bdi>} defaultOpen={st === "deliver"}>
      <dl className="grid gap-3 py-2 sm:grid-cols-2">
        <KV k={t("fPONo")} v={docWord(f, "po", po.no)} />
        <KV k={t("fPODate")} v={fmt.date(po.at, true)} />
        <KV k={t("fPOValue")} v={<><Money>{fmt.money(L.poValue(d))}</Money> <span className="text-xs font-normal text-muted-foreground">{t("beforeVat")}</span></>} />
        <KV k={t("fPONeed")} v={fmt.date(po.need, true)} />
        <KV k={t("fCommit")} v={po.acc ? fmt.date(po.acc.date, true) : <span className="text-warning">{t("notAccepted")}</span>} />
        <KV k={t("fSite")} v={<bdi>{po.site || "—"}</bdi>} />
        <KV k={t("fRcv")} v={<bdi>{po.rcv || "—"}</bdi>} />
        <KV k={t("fTerms")} v={termsText(f, po.terms)} />
      </dl>
      <div className={stkWrap}>
        <table className={stk.table}>
          <thead className={stkHead}>
            <tr>
              <th className={th}>{t("thItem")}</th>
              <th className={th}>{t("thUnitPrice")}</th>
              <th className={th}>{t("thOrdered")}</th>
              <th className={th}>{t("thGot")}</th>
              {anyRej && <th className={th}>{t("thRej")}</th>}
              {anyCan && <th className={th}>{t("thCan")}</th>}
              <th className={th}>{t("thLeft")}</th>
            </tr>
          </thead>
          <tbody className={stk.tbody}>
            {lines.map(({ l, s, i }) => (
              <tr key={l.it} className={stkRow}>
                <td className={cn("px-3 py-2 text-sm font-bold", stk.head)}><bdi>{i?.name}</bdi></td>
                <td className={cn(td, stk.cell)} data-l={t("thUnitPrice")}><span dir="ltr">{l.price != null ? fmt.money(l.price) : "—"}</span></td>
                <td className={cn(td, stk.cell)} data-l={t("thOrdered")}><span dir="ltr">{fmt.n(s.ord)} {i?.unit}</span></td>
                <td className={cn(td, stk.cell)} data-l={t("thGot")}><span dir="ltr">{fmt.n(s.got)}</span></td>
                {anyRej && <td className={cn(td, "text-destructive", stk.cell)} data-l={t("thRej")}><span dir="ltr">{fmt.n(s.rej)}</span></td>}
                {anyCan && <td className={cn(td, stk.cell)} data-l={t("thCan")}><span dir="ltr">{fmt.n(s.can)}</span></td>}
                <td className={cn(td, "font-bold", stk.cell)} data-l={t("thLeft")}><span dir="ltr">{fmt.n(s.left)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {po.cancelNote && <div className="mt-2"><Callout tone="warn">{po.cancelNote}</Callout></div>}
    </DrawerSection>
  )
}

// ---- Delivery and receipts ------------------------------------------------------------------------------------

function ReceiptCard({ f, d, r }: { f: Free; d: Deal; r: DealReceipt }) {
  const { t, fmt, L } = f
  const act = useActions()
  const ot = L.shipOnTime(d, r)
  return (
    <div className="rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <b className="text-sm tabular-nums">{docWord(f, "grn", r.no || "")}</b>
          <Pill tone="ok" dot>{t("rcRec", { x: fmt.date(r.okAt) })}</Pill>
          <Pill tone={ot ? "mute" : "bad"}>{t(ot ? "onTime" : "afterCommit")}</Pill>
        </div>
        <SmallBtn onClick={() => act.open("grn", d.id, r.grn)} icon={FileText}>{t("btnViewGrn")}</SmallBtn>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {t("grnArrived", { x: fmt.date(r.date, true) })}
        {r.by && <> · <bdi>{r.by.split(" — ")[0]}</bdi></>}
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {Object.entries(r.items).map(([k, q]) => {
          const i = d.items.find((x) => x.id === k)
          const g = r.got[k] != null ? r.got[k] : q
          return (
            <li key={k} className="flex justify-between gap-3">
              <span><bdi>{i?.name}</bdi></span>
              <b className="tabular-nums" dir="ltr">
                {fmt.n(q)} {i?.unit}
                {g !== q && <span className="ms-1 text-destructive">· {t("gotOf", { g: fmt.n(g), q: fmt.n(q) })}{r.why?.[k] && <span className="text-muted-foreground"> ({r.why[k]})</span>}</span>}
              </b>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ReportCard({ f, d, s }: { f: Free; d: Deal; s: DealReport }) {
  const { t, fmt, L } = f
  const act = useActions()
  return (
    <div className="rounded-xl border border-cta/30 bg-cta/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <b className="text-sm">{t("repT")}</b>
          <Pill tone="info" dot>{t("pbWait")}</Pill>
          {!L.shipOnTime(d, s) && <Pill tone="bad">{t("afterCommit")}</Pill>}
        </div>
        <SmallBtn onClick={() => act.open("remind", d.id)} icon={Bell}>{t("btnRemindShort")}</SmallBtn>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {t("repOn", { x: fmt.date(s.date, true) })}
        {s.note && <> · {s.note}</>}
      </p>
    </div>
  )
}

export function SecShip({ f, d }: { f: Free; d: Deal }) {
  const { t, pl, L } = f
  const act = useActions()
  const po = d.po
  if (!po || !po.acc) return null
  const st = L.stage(d)
  const rc = [...L.receipts(d)].reverse()
  const w = L.waiting(d)
  const can = !d.closed && !w.length && L.unsentValue(d) > 0
  const war = canRegisterWarranty(d.cat, rc.length > 0, !!d.war)
  return (
    <DrawerSection title={<span className="inline-flex items-center gap-2"><Truck size={15} aria-hidden="true" />{t("secShip")}</span>} count={rc.length || undefined} defaultOpen={st === "deliver" || st === "collect" || war}>
      <div className="space-y-2.5 py-2">
        {!w.length && !rc.length && <p className="text-xs text-muted-foreground">{t("noRcpt")}</p>}
        {w.map((s, i) => <ReportCard key={`w${i}`} f={f} d={d} s={s} />)}
        {rc.map((r) => <ReceiptCard key={r.grn} f={f} d={d} r={r} />)}
        {(can || war) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {can && <SmallBtn onClick={() => act.open("deliver", d.id)} icon={Truck} tone="primary">{t("btnDeliver")}</SmallBtn>}
            {war && <SmallBtn onClick={() => act.open("warranty", d.id)} icon={Shield}>{t("btnWarranty")}</SmallBtn>}
          </div>
        )}
      </div>
      <span className="sr-only">{rc.length ? pl("pl_grn", rc.length) : ""}</span>
    </DrawerSection>
  )
}

// ---- Invoices and transfers -------------------------------------------------------------------------------------

export function SecPay({ f, d }: { f: Free; d: Deal }) {
  const { t, fmt, L, rel } = f
  const act = useActions()
  if (!d.po || !d.po.acc) return null
  const st = L.stage(d)
  if (!(d.invs.length || L.canInvoice(d) || st === "collect" || (d.closed && d.closed.k === "paid"))) return null
  const alloc = L.invAlloc(d)
  // Which instalments the confirmed and reported money covers, invoice by invoice, oldest first.
  let ok = L.paidOk(d)
  let sent = L.paidSent(d)
  const instState = (amt: number, due: string) => {
    if (ok >= amt - 0.01) {
      ok = r2(ok - amt)
      return "paid" as const
    }
    if (ok + sent >= amt - 0.01) {
      sent = r2(sent - (amt - ok))
      ok = 0
      return "sent" as const
    }
    ok = 0
    return L.daysTo(due) < 0 ? ("late" as const) : ("due" as const)
  }
  const ordered = [...d.invs.map((i, n) => ({ i, n }))].sort((a, b) => a.i.date.localeCompare(b.i.date) || a.n - b.n)
  // Days after the instalment each transfer covers — over every invoice's schedule, not just the first (WF-14).
  const lateBy = L.payLateness(d)
  const fully = L.isFullyPaid(d)
  return (
    <DrawerSection title={<span className="inline-flex items-center gap-2"><Wallet size={15} aria-hidden="true" />{t("secPay")}</span>} summary={d.invs.length ? <bdi>{fmt.money(L.grossTotal(d))}</bdi> : undefined} defaultOpen={st === "collect" || (st === "done" && !!d.closed && d.closed.k === "paid") || L.canInvoice(d)}>
      <div className="space-y-3 py-2">
        {!d.invs.length ? (
          <Callout tone="info">
            <b>{t("noInvoice")}</b> {L.waiting(d).length ? t("noInvoiceWait") : t("noInvoiceX")}
          </Callout>
        ) : (
          ordered.map(({ i, n }) => (
            <div key={n} className="space-y-2 rounded-xl border p-3">
              <dl className="grid gap-3 sm:grid-cols-3">
                <KV k={t("thInvoice")} v={<bdi>{i.no}</bdi>} />
                <KV k={t("fInvDate")} v={fmt.date(i.date, true)} />
                <KV k={t("fTerms")} v={termsText(f, L.termsOf(d))} />
              </dl>
              {i.file && (
                <a href={i.fileUrl || undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/30 px-2.5 py-1 text-xs">
                  <Paperclip size={13} aria-hidden="true" />
                  <bdi>{i.file}</bdi>
                </a>
              )}
              <dl className="space-y-1 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">{t("sumNet")}</dt><dd className="font-bold"><Money>{fmt.money(i.amt)}</Money></dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">{t("sumVat")}</dt><dd className="font-bold"><Money>{fmt.money(r2(L.invGross(i) - i.amt))}</Money></dd></div>
                <div className="flex justify-between border-t pt-1 text-base"><dt className="font-bold">{t("sumGross")}</dt><dd className="font-black"><Money>{fmt.money(L.invGross(i))}</Money></dd></div>
              </dl>
              <div className={stkWrap}>
                <table className={stk.table}>
                  <thead className={stkHead}>
                    <tr><th className={th}>{t("thInstall")}</th><th className={th}>{t("thDue")}</th><th className={th}>{t("thAmount")}</th><th className={th}>{t("thState")}</th></tr>
                  </thead>
                  <tbody className={stk.tbody}>
                    {L.sched(d, i).map((x, k) => (
                      <tr key={k} className={stkRow}>
                        <td className={cn(td, stk.head)}><span dir="ltr">{x.pct}%</span></td>
                        <td className={cn(td, stk.cell)} data-l={t("thDue")}><span dir="ltr">{fmt.date(x.due, true)}</span></td>
                        <td className={cn(td, "font-bold", stk.cell)} data-l={t("thAmount")}><span dir="ltr">{fmt.money(x.amt)}</span></td>
                        <td className={cn("px-3 py-2", stk.cell)} data-l={t("thState")}><InstalmentPill f={f} state={instState(x.amt, x.due)} due={x.due} rel={rel} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
        {L.canInvoice(d) && (
          <div className="flex flex-wrap items-center gap-2">
            <SmallBtn onClick={() => act.open("invoice", d.id)} icon={Upload} tone="primary">{t("btnInvoice")}</SmallBtn>
            <span className="text-xs text-muted-foreground">{t("estFromGrn")}: <Money>{fmt.money(L.uninvoicedGross(d))}</Money></span>
          </div>
        )}
        {d.pays.length > 0 ? (
          <div>
            <h4 className="mb-2 text-sm font-bold">{t("paysTitle")}</h4>
            <ul className="divide-y rounded-lg border">
              {d.pays.map((p, i) => {
                const late = lateBy[i] || 0
                return (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0 text-sm">
                      <b className="tabular-nums" dir="ltr">{fmt.money(p.amt)}</b>
                      <span className="block text-xs text-muted-foreground">
                        {fmt.date(p.at, true)} · {p.bank} · <bdi>{p.ref}</bdi>
                        {p.note && ` · ${p.note}`}
                        {late > 0 && <span className="text-warning"> · {t("payLate", { x: f.pl("pl_day", late) })}</span>}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.st === "sent" ? <Pill tone="warn" dot>{t("paySent")}</Pill> : p.st === "ok" ? <Pill tone="ok" dot>{t("payOk", { x: fmt.date(p.okAt) })}</Pill> : <Pill tone="bad" dot>{t("payMissing")}</Pill>}
                      {p.st === "sent" && p.id && (
                        <>
                          <SmallBtn onClick={() => act.open("pay-ok", d.id, p.id)} tone="primary">{t("btnPayOk")}</SmallBtn>
                          <SmallBtn onClick={() => act.open("pay-miss", d.id, p.id)}>{t("btnPayMissing")}</SmallBtn>
                        </>
                      )}
                      {p.st === "miss" && p.id && <SmallBtn onClick={() => act.open("pay-late", d.id, p.id)}>{t("btnPayLateOk")}</SmallBtn>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          d.invs.length > 0 && <p className="text-xs text-muted-foreground">{t("noPays")}</p>
        )}
        {d.invs.length > 0 && (
          <dl className="space-y-1 rounded-lg bg-muted/40 px-3 py-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">{t("balPaid")}</dt><dd className="font-bold"><Money>{fmt.money(L.paidOk(d))}</Money></dd></div>
            {L.paidSent(d) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">{t("balSent")}</dt><dd className="font-bold"><Money>{fmt.money(L.paidSent(d))}</Money></dd></div>}
            <div className="flex justify-between border-t pt-1 text-base"><dt className="font-bold">{t("balLeft")}</dt><dd className="font-black"><Money>{fmt.money(L.owed(d))}</Money></dd></div>
          </dl>
        )}
        {alloc.length > 1 && !fully && <span className="sr-only">{alloc.length}</span>}
      </div>
    </DrawerSection>
  )
}

// ---- Warranty -----------------------------------------------------------------------------------------------

export function SecWar({ f, d }: { f: Free; d: Deal }) {
  const { t, fmt } = f
  const w = d.war
  if (!w) return null
  const item = d.items.find((i) => i.id === w.it)
  return (
    <DrawerSection title={<span className="inline-flex items-center gap-2"><Shield size={15} aria-hidden="true" />{t("secWar")}</span>} summary={w.st === "ok" ? t("warOk", { x: fmt.date(w.okAt) }) : t("warWait")} defaultOpen={false}>
      <dl className="grid gap-3 py-2 sm:grid-cols-3">
        <KV k={t("fWarItem")} v={<bdi>{item?.name || "—"}</bdi>} />
        <KV k={t("fWarUntil")} v={fmt.date(w.until, true)} />
        <KV k={t("fWarState")} v={w.st === "ok" ? <Pill tone="ok" dot>{t("warOk", { x: fmt.date(w.okAt) })}</Pill> : <Pill tone="info" dot>{t("warWait")}</Pill>} />
      </dl>
      {w.file && <span className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/30 px-2.5 py-1 text-xs"><Paperclip size={13} aria-hidden="true" /><bdi>{w.file}</bdi></span>}
    </DrawerSection>
  )
}

// ---- The conversation -----------------------------------------------------------------------------------------

/** Reading the conversation clears the reader's own counter and takes only HIM off the unread list — the other side's
 * flag is theirs to clear (MSG-01: writing `unreadFor: []` used to wipe the contractor's). */
export function markChatRead(firestore: Firestore, chatId: string, uid: string): Promise<void> {
  return updateDoc(doc(firestore, "chats", chatId), { unreadFor: arrayRemove(uid), [`unreadCounts.${uid}`]: 0 })
}

/** Which messages are the unread ones: the last `n` from the other side. */
export function unreadMarks(list: readonly { senderId?: string }[], myUid: string, n: number): Set<number> {
  const out = new Set<number>()
  for (let i = list.length - 1; i >= 0 && out.size < n; i--) if (list[i].senderId !== myUid) out.add(i)
  return out
}

export function SecMsgs({ f, d, focus }: { f: Free; d: Deal; focus: boolean }) {
  const { t, fmt, L } = f
  const firestore = useFirestore()
  const { user } = useUser()
  const c = L.C(d.c)
  const chatId = d.chat?.chatId || f.rawOffer(d.id)?.id || ""
  const mQ = useMemoFirebase(() => (firestore && chatId ? query(collection(firestore, "chats", chatId, "messages"), orderBy("createdAt", "asc")) : null), [firestore, chatId])
  const { data: msgs } = useCollection<{ senderId?: string; text?: string; createdAt?: string }>(mQ)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const unread = d.chat?.unread || 0
  // How many were unread when he opened it: those stay marked while he reads, though reading clears the counter.
  const unreadAtOpen = useRef<number | null>(null)
  if (unreadAtOpen.current === null) unreadAtOpen.current = unread
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [msgs?.length])
  // Reading it clears HIS counter only — the contractor's unread flag stays (MSG-01).
  useEffect(() => {
    if (!firestore || !user || !chatId || !unread) return
    void markChatRead(firestore, chatId, user.uid).catch(() => undefined)
  }, [firestore, user, chatId, unread])
  const offer = f.rawOffer(d.id)
  const send = async () => {
    if (!firestore || !user || !offer || !text.trim()) return
    setSending(true)
    const v = text
    setText("")
    try {
      await sendDealMessage(firestore, { chatId: offer.id, offer, uid: user.uid, text: v })
    } catch {
      setText(v)
    } finally {
      setSending(false)
    }
  }
  const list = useMemo(() => msgs || [], [msgs])
  const fresh = useMemo(() => unreadMarks(list, user?.uid || "", unreadAtOpen.current || 0), [list, user?.uid])
  return (
    <DrawerSection title={<span className="inline-flex items-center gap-2"><MessageSquare size={15} aria-hidden="true" />{t("secMsgs")}</span>} count={list.length || undefined} defaultOpen={focus || unread > 0}>
      <div id="sec-msgs" className="space-y-3 py-2">
        {list.length ? (
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {list.map((m, i) => {
              const mine = m.senderId === user?.uid
              const isNew = fresh.has(i)
              return (
                <div key={i}>
                  {isNew && !fresh.has(i - 1) && (
                    <p className="my-1 flex items-center gap-2 text-[11px] font-bold text-destructive" role="separator">
                      <span className="h-px flex-1 bg-destructive/30" aria-hidden="true" />
                      {t("newMsgs")}
                      <span className="h-px flex-1 bg-destructive/30" aria-hidden="true" />
                    </p>
                  )}
                  <div className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", mine ? "ms-auto bg-cta/10" : "bg-muted", isNew && "ring-1 ring-destructive/40")}>
                    <small className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      {isNew && <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-label={t("unreadDot")} />}
                      <span>{mine ? t("you") : c?.name} · {fmt.date(riyadhDayOf(m.createdAt))}</span>
                    </small>
                    <span dir="auto">{m.text}</span>
                  </div>
                </div>
              )
            })}
            <div ref={end} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("noMsgs")}</p>
        )}
        {offer ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={t("msgPh", { c: c?.name || "" })} aria-label={t("secMsgs")} className="h-9 min-w-0 flex-1" />
            <button disabled={sending || !text.trim()} className={buttonVariants({ size: "sm" })}>
              <Send size={14} aria-hidden="true" />
              {t("send")}
            </button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">{t("msgAfterQuote")}</p>
        )}
      </div>
    </DrawerSection>
  )
}

