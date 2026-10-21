"use client"

// The deal drawer's tracker (PRD NAV-05: five stages), its "next step" box with the button for it, and the four figures.
// One deal is in exactly one stage (G-01) and shows exactly one next step.

import type { ReactNode } from "react"
import { AlertTriangle, Bell, Check, Clock, FileText, Package, Send, Star, Truck, Upload, Wallet, X, type LucideIcon } from "lucide-react"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { displayCategory } from "@/lib/constants"
import { r2 } from "@/lib/supplier-free/deal-logic"
import type { Deal } from "@/lib/supplier-free/types"
import type { Free } from "./useFree"
import { useActions, type ActionKind } from "./ActionsProvider"
import { leftText } from "./TaskCard"
import { actionBtn } from "./ui"

type Step = { k: string; s: "done" | "cur" | "bad" | "todo"; sub: string }

export function Tracker({ f, d }: { f: Free; d: Deal }) {
  const { t, fmt, L } = f
  const st = L.stage(d)
  const o = d.offer
  const cl = d.closed && d.closed.k
  const lost = cl === "lost" || cl === "noaward"
  const paid = cl === "paid"
  const delivered = st === "collect" || paid
  const rc = L.receipts(d)
  const lastShip = rc.length ? rc[rc.length - 1].date : null
  const nd = d.invs.length && !paid ? L.nextDue(d) : null
  const steps: Step[] = [
    { k: "tReq", s: "done", sub: fmt.date(d.posted) },
    { k: "tOffer", s: o ? "done" : st === "new" ? "cur" : "todo", sub: o && o.v[0] ? fmt.date(o.v[0].at) : t("tBy", { x: fmt.date(d.deadline) }) },
    { k: "tAward", s: d.po ? "done" : lost ? "bad" : o ? "cur" : "todo", sub: d.po ? fmt.date((o && o.wonAt) || d.po.at) : lost ? t(cl === "lost" ? "tLost" : "tNoAward") : "" },
    { k: "tDeliver", s: delivered ? "done" : st === "deliver" ? "cur" : cl === "declined" ? "bad" : "todo", sub: delivered && lastShip ? fmt.date(lastShip) : d.po && d.po.acc ? t("tCommit", { x: fmt.date(d.po.acc.date) }) : "" },
    { k: "tPay", s: paid ? "done" : st === "collect" ? "cur" : "todo", sub: paid && d.closed ? fmt.date(d.closed.at) : nd ? t("tDue", { x: fmt.date(nd.due) }) : "" },
  ]
  const dot = { done: "bg-success text-white", cur: "bg-cta text-white ring-4 ring-cta/20", bad: "bg-destructive text-white", todo: "bg-muted text-muted-foreground" }
  return (
    <ol role="list" aria-label={t("trackerLbl")} className="grid grid-cols-5 gap-1 rounded-xl border bg-card p-3">
      {steps.map((x, i) => (
        <li key={x.k} className="flex min-w-0 flex-col items-center gap-1 text-center">
          <span className={cn("grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold", dot[x.s])}>{x.s === "done" ? <Check size={13} aria-hidden="true" /> : x.s === "bad" ? <X size={13} aria-hidden="true" /> : i + 1}</span>
          <b className="text-[11px] leading-tight">{t(x.k)}</b>
          <small className="min-h-[1rem] text-[10px] leading-tight text-muted-foreground">{x.sub}</small>
        </li>
      ))}
    </ol>
  )
}

const TONE = {
  amber: "border-warning/30 bg-warning/5",
  red: "border-destructive/30 bg-destructive/5",
  blue: "border-cta/25 bg-cta/5",
  green: "border-success/30 bg-success/5",
  slate: "border-border bg-muted/40",
} as const
const TICON = { amber: "bg-warning/15 text-warning", red: "bg-destructive/15 text-destructive", blue: "bg-cta/15 text-cta", green: "bg-success/15 text-success", slate: "bg-muted text-muted-foreground" } as const

interface Btn {
  label: string
  kind?: ActionKind
  href?: string
  tone?: "primary" | "outline" | "danger"
  icon?: LucideIcon
}

interface Next {
  tone: keyof typeof TONE
  icon: LucideIcon
  title: string
  text?: string
  btns: Btn[]
  rated?: number
}

export function nextStep(f: Free, d: Deal, href: (p: Record<string, string | null>) => string): Next {
  const { t, fmt, L, rel, pl } = f
  const st = L.stage(d)
  const o = d.offer
  const btns: Btn[] = []
  const quote = (mode: string) => href({ quote: d.id, mode })
  if (st === "new") {
    const n = L.daysTo(d.deadline)
    btns.push({ label: t("btnOffer"), href: quote("new"), icon: Send })
    if (d.channel === "invite") btns.push({ label: t("btnNoQuote"), kind: "no-quote", tone: "outline" })
    return { tone: n <= 2 ? "amber" : "blue", icon: Send, title: t("nxNewT", { x: rel(d.deadline) }), text: t(d.pricing === "total" ? "nxNewTotal" : "nxNewItem"), btns }
  }
  if (st === "offered" && o) {
    if (o.status === "reduce" && o.reduce) {
      btns.push({ label: t("btnLower"), href: quote("reduce") }, { label: t("btnFinal"), kind: "final", tone: "outline" })
      return {
        tone: "amber",
        icon: AlertTriangle,
        title: o.reduce.target > 0 ? t("nxReduceT", { v: fmt.money(o.reduce.target), cur: fmt.money(L.offerTotal(d)), d: fmt.money(r2(L.offerTotal(d) - o.reduce.target)) }) : t("nxBetterT", { cur: fmt.money(L.offerTotal(d)) }),
        text: t("nxReduceX", { x: fmt.date(o.reduce.by), r: rel(o.reduce.by) }),
        btns,
      }
    }
    if (o.reval) {
      btns.push({ label: t("btnConfirmPrice"), href: quote("reval") })
      return { tone: "amber", icon: AlertTriangle, title: t("nxRevalT"), text: o.reval.note || t("nxRevalX"), btns }
    }
    if (o.status === "sample" && o.sample) {
      btns.push({ label: t("btnSampleSent"), kind: "sample-sent" })
      return { tone: "amber", icon: Package, title: t("nxSampleT", { w: o.sample.what }), text: t("nxSampleX", { p: o.sample.place, x: fmt.date(o.sample.by) }), btns }
    }
    if (o.status === "sampleSent" && o.sample) return { tone: "blue", icon: Package, title: t("nxSampleSentT", { x: fmt.date(o.sample.sentAt) }), text: t("nxWaitX"), btns }
    const open = L.daysTo(d.deadline) >= 0
    if (open) btns.push({ label: t("btnEditOffer"), href: quote("edit"), tone: "outline" }, { label: t("btnWithdraw"), kind: "withdraw", tone: "outline" })
    return { tone: "blue", icon: Clock, title: t("nxReviewT"), text: open ? t("nxReviewOpen", { x: fmt.date(d.deadline) }) : t("nxReviewClosed", { x: rel(d.deadline) }), btns }
  }
  if ((st === "deliver" || st === "collect") && d.po) {
    const w = L.waiting(d)[0]
    let n: Next
    if (!d.po.acc) {
      btns.push({ label: t("btnAcceptPO"), kind: "accept-po", icon: Check }, { label: t("btnDeclinePO"), kind: "decline-po", tone: "danger" })
      n = { tone: "amber", icon: FileText, title: t("nxPOT", { po: d.po.no, v: fmt.money(L.poValue(d)) }), text: t("nxPOX", { x: fmt.date(d.po.need, true) }), btns }
    } else if (st === "deliver" && w) {
      const ot = L.shipOnTime(d, w)
      btns.push({ label: t("btnRemind"), kind: "remind", tone: "outline", icon: Bell })
      n = { tone: ot ? "blue" : "amber", icon: Clock, title: t(ot ? "nxRepT" : "nxRepLateT", { x: fmt.date(w.date, true) }), text: t("nxRepX", { c: L.C(d.c)?.name || "" }), btns }
    } else if (st === "deliver" && L.isLate(d)) {
      btns.push({ label: t("btnDeliver"), kind: "deliver", icon: Truck })
      n = { tone: "red", icon: AlertTriangle, title: t("nxLateT", { x: pl("pl_late", -L.daysTo(d.po.acc.date)) }), text: t("nxLateX", { x: leftText(f, d) }), btns }
    } else if (st === "deliver") {
      btns.push({ label: t("btnDeliver"), kind: "deliver", icon: Truck })
      n = { tone: "blue", icon: Truck, title: t("nxShipT", { x: fmt.date(d.po.acc.date, true), r: rel(d.po.acc.date) }), text: t("nxShipX"), btns }
    } else if (L.canInvoice(d)) {
      btns.push({ label: t("btnInvoice"), kind: "invoice", icon: Upload })
      n = { tone: "amber", icon: FileText, title: t("nxInvT"), text: t("nxInvX", { v: fmt.money(L.gotValue(d)) }), btns }
    } else if (L.payIssue(d)) {
      n = { tone: "red", icon: AlertTriangle, title: t("nxPayMissT"), text: t("nxPayMissX"), btns }
    } else if (L.paidSent(d) > 0) {
      const p = d.pays.find((x) => x.st === "sent")
      btns.push({ label: t("btnPayOk"), kind: "pay-ok", icon: Check }, { label: t("btnPayMissing"), kind: "pay-miss", tone: "outline" })
      n = { tone: "amber", icon: Wallet, title: t("nxPaySentT", { v: fmt.money(p?.amt || 0), x: fmt.date(p?.at) }), text: t("nxPaySentX", { b: p?.bank || "", r: p?.ref || "" }), btns }
    } else {
      const nd = L.nextDue(d)
      const late = !!nd && L.daysTo(nd.due) < 0
      if (late) btns.push({ label: t("btnPayRemind"), kind: "pay-remind", tone: "outline", icon: Bell })
      n = { tone: late ? "amber" : "blue", icon: Wallet, title: nd ? t("nxDueT", { v: fmt.money(nd.amt), x: fmt.date(nd.due, true) }) : t("nxDueNone"), text: nd ? (late ? t("nxDueLate", { r: rel(nd.due) }) : t("nxDueX", { r: rel(nd.due) })) : undefined, btns }
    }
    // Something received and not billed yet is billable at any time (one invoice per receipt), beside whatever else is next.
    if (st === "deliver" && d.po.acc && L.canInvoice(d)) n.btns.push({ label: t("btnInvoiceShort"), kind: "invoice", tone: "outline", icon: Upload })
    return n
  }
  const k = d.closed ? d.closed.k : ""
  if (k === "paid") {
    if (d.rated) return { tone: "green", icon: Check, title: t("nxPaidT", { x: fmt.date(d.closed?.at, true) }), text: t("nxPaidX"), btns, rated: d.rated.stars }
    btns.push({ label: t("btnRate"), kind: "rate", tone: "outline", icon: Star })
    return { tone: "green", icon: Check, title: t("nxPaidT", { x: fmt.date(d.closed?.at, true) }), text: t("nxPaidX"), btns }
  }
  if (k === "lost") return { tone: "slate", icon: X, title: t("nxLostT"), text: o?.out?.why ? t("nxLostWhy", { w: t(`why_${o.out.why}` as "why_price") }) : t("nxLostNoWhy"), btns }
  if (k === "noaward") return { tone: "slate", icon: X, title: t("nxNoAwardT"), text: o?.out?.why ? t("nxNoAwardWhy", { w: t(`why_${o.out.why}` as "why_price") }) : undefined, btns }
  if (k === "noquote") return { tone: "slate", icon: X, title: t("nxNoQuoteT"), btns }
  if (k === "withdrawn") return { tone: "slate", icon: X, title: t("nxWithdrawnT"), btns }
  return { tone: "slate", icon: X, title: t("nxDeclinedT"), text: d.po?.decl ? t(`dr_${d.po.decl.why}` as "dr_stock") : undefined, btns }
}

export function NextBox({ f, d, href }: { f: Free; d: Deal; href: (p: Record<string, string | null>) => string }) {
  const { t, L } = f
  const act = useActions()
  const n = nextStep(f, d, href)
  const Icon = n.icon
  const btnCls = (tone: Btn["tone"]) => actionBtn(tone === "outline" ? "outline" : tone === "danger" ? "danger" : "primary")
  return (
    <div className={cn("flex flex-wrap items-start gap-3 rounded-xl border p-3.5", TONE[n.tone])}>
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", TICON[n.tone])}>
        <Icon size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <small className="text-[11px] font-semibold text-muted-foreground">{t(L.stage(d) === "done" ? "outcome" : "nextStep")}</small>
        <b className="block text-sm leading-snug" dir="auto">
          {n.title}
        </b>
        {n.text && (
          <span className="mt-0.5 block text-xs text-muted-foreground" dir="auto">
            {n.text}
          </span>
        )}
        {n.rated != null && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-bold text-success">
            <Star size={12} aria-hidden="true" />
            {t("rated", { n: n.rated })}
          </span>
        )}
      </div>
      {n.btns.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {n.btns.map((b, i) => {
            const BI = b.icon
            const inner = (
              <>
                {BI && <BI size={13} aria-hidden="true" />}
                {b.label}
              </>
            )
            return b.href ? (
              <Link key={i} href={b.href as never} scroll={false} className={btnCls(b.tone)}>
                {inner}
              </Link>
            ) : (
              <button key={i} type="button" onClick={() => b.kind && act.open(b.kind, d.id)} className={btnCls(b.tone)}>
                {inner}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <span className="block text-[11px] font-semibold text-muted-foreground">{label}</span>
      <span className="mt-0.5 block text-lg font-black tabular-nums" dir="ltr">
        {value}
      </span>
      {sub && <span className="block text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

export function DealStats({ f, d }: { f: Free; d: Deal }) {
  const { t, fmt, L, rel } = f
  if (d.po) {
    const pct = L.deliveredPct(d)
    const gross = L.grossTotal(d)
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("dsPO")} value={fmt.money(L.poValue(d))} sub={t("beforeVat")} />
        <Stat
          label={t("delivered")}
          value={`${pct}%`}
          sub={
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full bg-success" style={{ width: `${pct}%` }} />
            </span>
          }
        />
        <Stat label={t("dsInv")} value={d.invs.length ? fmt.money(gross) : "—"} sub={d.invs.length ? t("inclVat") : t("invPerReceipt")} />
        <Stat label={t("dsPaid")} value={fmt.money(L.paidOk(d))} sub={d.invs.length ? t("dsLeft", { v: fmt.money(L.owed(d)) }) : undefined} />
      </div>
    )
  }
  if (d.offer && L.curV(d)) {
    const v = L.curV(d)
    const tot = L.offerTotal(d)
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("dsOffer")} value={fmt.money(tot)} sub={t("beforeVat")} />
        <Stat label={t("sumGross")} value={fmt.money(r2(tot * (1 + L.quoteVatRate(d, v))))} sub={t("inclVat")} />
        <Stat label={t("fValid")} value={v?.valid ? fmt.date(v.valid, true) : "—"} sub={v?.valid ? rel(v.valid) : undefined} />
        <Stat label={t("fVersion")} value={d.offer.v.length} sub={fmt.date(v?.at, true)} />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label={t("thItems")} value={d.items.length} sub={t(d.pricing === "total" ? "prTotal" : "prItem")} />
      <Stat label={t("fDeadline")} value={fmt.date(d.deadline, true)} sub={rel(d.deadline)} />
      <Stat label={t("fNeedBy")} value={fmt.date(d.needBy, true)} sub={rel(d.needBy)} />
      <Stat label={t("fCat")} value={<span dir="auto">{displayCategory(d.cat, f.locale)}</span>} sub={t(`ch_${d.channel}`)} />
    </div>
  )
}

