"use client"

// Invoices & transfers (PRD BIL-01…08, WF-12…14): YOUR invoice first, then the contractor's transfer. One invoice per
// receipt; a row per invoice with the step, what is left and ONE button; Mdmak neither issues the invoice nor collects the
// money — the supplier uploads his own file and only CONFIRMS a transfer, never records a payment (B-07, B-08).

import { useMemo } from "react"
import { AlertTriangle, Bell, CalendarDays, Check, Clock, FileText, Search, Upload, Wallet } from "lucide-react"
import { Link } from "@/i18n/routing"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { cn } from "@/lib/utils"
import { r2 } from "@/lib/supplier-free/deal-logic"
import type { InvoiceRow } from "@/lib/supplier-free/world-logic"
import { FreePage, GroupHead, docWord, useQueryState, useRowGo, type PageKpi } from "./ui"
import { useActions } from "./ActionsProvider"
import { useFree, type Free } from "./useFree"

const GROUPS = [
  { k: "igYou", tone: "r" as const, f: (r: InvoiceRow) => r.st === "toinv" || r.st === "sent" },
  { k: "igDue", tone: "a" as const, f: (r: InvoiceRow) => r.st === "due" },
  { k: "igPaid", tone: "g" as const, f: (r: InvoiceRow) => r.st === "paid" },
]

function Row({ f, r, href }: { f: Free; r: InvoiceRow; href: (p: Record<string, string | null>) => string }) {
  const go = useRowGo()
  const { t, fmt, L, rel } = f
  const act = useActions()
  const d = r.deal
  const c = L.C(d.c)
  const inv = r.n != null ? d.invs[r.n] : null
  let Icon = Clock
  let tone = "bg-violet/10 text-violet"
  let next = ""
  let nextTone = ""
  let btn: { label: string; run: () => void; outline?: boolean; icon?: typeof Bell } | null = null
  if (r.st === "toinv") {
    Icon = Upload
    tone = "bg-warning/10 text-warning"
    next = t("ivToinv", { v: fmt.money(r.gross) })
    nextTone = "text-warning"
    btn = { label: t("btnInvoiceShort"), run: () => act.open("invoice", d.id), icon: Upload }
  } else if (r.st === "sent") {
    const p = d.pays.find((x) => x.st === "sent")
    Icon = Wallet
    tone = "bg-warning/10 text-warning"
    next = t("ivSent", { v: fmt.money(p?.amt || 0), x: fmt.date(p?.at) })
    nextTone = "text-warning"
    btn = { label: t("btnConfirmPay"), run: () => act.open("pay-ok", d.id, p?.id) }
  } else if (r.st === "due") {
    const nd = L.nextDue(d)
    const od = r.late
    Icon = r.issue ? AlertTriangle : Clock
    tone = r.issue || od ? "bg-destructive/10 text-destructive" : "bg-violet/10 text-violet"
    nextTone = r.issue || od ? "text-destructive" : ""
    next = r.issue ? t("nxPayMissT") : nd ? t(od ? "ivLate" : "ivDue", { x: fmt.date(nd.due, true), r: rel(nd.due) }) : ""
    if (od && !r.issue) btn = { label: t("btnRemindShort"), run: () => act.open("pay-remind", d.id), outline: true, icon: Bell }
    if (r.issue) {
      const last = d.pays[d.pays.length - 1]
      if (last && last.st === "miss" && last.id) btn = { label: t("btnPayLateOk"), run: () => act.open("pay-late", d.id, last.id), outline: true }
    }
  } else {
    Icon = Check
    tone = "bg-success/10 text-success"
    next = t("ivPaid")
  }
  const amt = r.st === "paid" ? r.gross : r.left
  return (
    <li {...go(href({ deal: r.deal.id }))} className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/30">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", tone)}>
        <Icon size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 basis-60">
        <Link href={href({ deal: d.id }) as never} scroll={false} className="block truncate text-sm font-bold hover:text-module" dir="auto">
          {d.title}
        </Link>
        <span className="block text-xs text-muted-foreground">
          {inv ? t("invNo2", { n: inv.no }) : t("invNotYet")} · {d.po ? docWord(f, "po", d.po.no) : ""} · <bdi>{c?.name}</bdi>
        </span>
        <span className={cn("mt-0.5 block text-xs font-semibold", nextTone)}>{next}</span>
      </div>
      <div className="text-end">
        <b className="block text-sm tabular-nums" dir="ltr">
          {fmt.money(amt)}
        </b>
        <small className="text-[11px] text-muted-foreground">{r.st === "paid" ? t("ivPaidAmt") : r.st === "toinv" ? t("estFromGrn") : t("balLeft")}</small>
      </div>
      {btn && (
        <button
          type="button"
          onClick={btn.run}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", btn.outline ? "border bg-card hover:bg-muted/50" : "bg-cta text-cta-foreground hover:bg-cta/90")}
        >
          {btn.icon && <btn.icon size={13} aria-hidden="true" />}
          {btn.label}
        </button>
      )}
    </li>
  )
}

export function FreeInvoices() {
  const f = useFree()
  const { t, L, fmt } = f
  const q = useQueryState()
  const seg = (["all", "you", "due", "paid"] as const).find((x) => x === q.get("seg")) || "all"
  const search = (q.get("q") || "").trim()
  const rows = useMemo(() => L.invoiceRows(), [L])
  const cnt = (k: string) => rows.filter((r) => k === "all" || L.INV_WHO[r.st] === k).length
  const list = useMemo(
    () =>
      rows.filter((r) => {
        if (seg !== "all" && L.INV_WHO[r.st] !== seg) return false
        if (!search) return true
        const inv = r.n != null ? r.deal.invs[r.n] : null
        return L.matchQ(r.deal, search) || !!(inv && inv.no.toLowerCase().includes(search.toLowerCase()))
      }),
    [rows, L, seg, search]
  )
  const k = L.dashK()
  const toinvN = rows.filter((r) => r.st === "toinv").length
  const sentN = rows.filter((r) => r.st === "sent").length
  const week = L.deals.map((d) => (d.invs.length ? L.nextDue(d) : null)).filter((nd): nd is NonNullable<typeof nd> => !!nd && L.daysTo(nd.due) >= 0 && L.daysTo(nd.due) <= 7)
  const groups = GROUPS.map((g) => ({ g, items: list.filter(g.f) })).filter((x) => x.items.length)
  const href = q.href

  const kpis: PageKpi[] = [
    { id: "owed", icon: Wallet, label: t("dkOwed"), value: fmt.kM(k.owed), unit: fmt.cur, sub: t("ikOwedSub", { n: f.pl("pl_inv", k.invN) }), tone: "neutral", href: href({ seg: "due" }) },
    { id: "you", icon: AlertTriangle, label: t("ivYouK"), value: toinvN + sentN, sub: toinvN + sentN ? t("ivYouSub", { a: toinvN, b: sentN }) : t("arCalm"), tone: toinvN + sentN ? "warn" : "up", href: href({ seg: "you" }) },
    { id: "week", icon: CalendarDays, label: t("ivWeek"), value: fmt.kM(r2(week.reduce((s, nd) => s + nd.amt, 0))), unit: fmt.cur, sub: week.length ? f.pl("pl_inst", week.length) : t("arCalm"), tone: "neutral", href: href({ seg: "due" }) },
  ]
  return (
    <FreePage icon={Wallet} title={t("navInvoices")} description={t("invSub")} kpis={kpis}>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedNav
          ariaLabel={t("navInvoices")}
          active={seg}
          onSelect={(id) => q.set({ seg: id === "all" ? "" : id })}
          segments={[
            { id: "all", label: t("pwAll"), count: cnt("all") },
            { id: "you", label: t("pwYou"), count: cnt("you"), tone: "warn" },
            { id: "due", label: t("isDue"), count: cnt("due") },
            { id: "paid", label: t("isPaid"), count: cnt("paid") },
          ]}
        />
        <form
          role="search"
          className="relative ms-auto"
          onSubmit={(e) => {
            e.preventDefault()
            q.set({ q: String(new FormData(e.currentTarget).get("q") || "") })
          }}
        >
          <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input name="q" defaultValue={search} key={search} placeholder={t("invSearchPh")} aria-label={t("invSearchPh")} className="h-9 w-64 rounded-lg border bg-card ps-8 pe-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </form>
      </div>
      {!list.length ? (
        <EmptyState
          icon={FileText}
          title={t(search ? "listEmptyF" : (`invEmpty_${seg}` as "invEmpty_all"))}
          action={
            search ? (
              <Link href={href({ q: "" }) as never} className="inline-flex h-9 items-center rounded-lg border bg-card px-3 text-sm font-bold">
                {t("clearFilters")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map(({ g, items }) => (
            <section key={g.k} className="overflow-hidden rounded-xl border bg-card">
              <header className="px-4 pt-3">
                <GroupHead label={t(g.k as "igYou")} n={items.length} value={g.k === "igPaid" ? undefined : fmt.money(r2(items.reduce((s, r) => s + r.left, 0)))} tone={g.tone} />
              </header>
              <ul className="divide-y">
                {items.map((r) => (
                  <Row key={r.key} f={f} r={r} href={href} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </FreePage>
  )
}
