"use client"

// Orders & delivery (PRD ORD-01…15, WF-07…11): the contractor's orders by WHOSE MOVE it is — yours, the contractor's,
// complete — a panel per state and a row per order with its next step in colour and ONE button. Everything about one
// order (lines, reports, receipts, warranty) lives in its drawer.

import { useMemo } from "react"
import { AlertTriangle, Bell, Check, Clock, FileText, Truck } from "lucide-react"
import { Link } from "@/i18n/routing"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { cn } from "@/lib/utils"
import type { Deal } from "@/lib/supplier-free/types"
import { actionBtn, SearchBox, FreePage, docWord, useQueryState, useRowGo, type PageKpi } from "./ui"
import { leftText } from "./TaskCard"
import { useActions } from "./ActionsProvider"
import { useFree, type Free } from "./useFree"

const GROUPS = [
  { k: "pgNew", icon: FileText, f: (f: Free, d: Deal) => f.L.poSt(d) === "new" },
  { k: "pgSupply", icon: Truck, f: (f: Free, d: Deal) => f.L.poSt(d) === "supply" },
  { k: "pgWait", icon: Clock, f: (f: Free, d: Deal) => f.L.poSt(d) === "wait" },
  { k: "pgDone", icon: Check, f: (f: Free, d: Deal) => f.L.poSt(d) === "done" },
]

const TONE_ICON = { amber: "bg-warning/10 text-warning", blue: "bg-cta/10 text-cta", red: "bg-destructive/10 text-destructive", violet: "bg-violet/10 text-violet", green: "bg-success/10 text-success" } as const

function OrderRow({ f, d, href }: { f: Free; d: Deal; href: (p: Record<string, string | null>) => string }) {
  const go = useRowGo()
  const { t, fmt, L, pl } = f
  const act = useActions()
  const st = L.poSt(d)
  const c = L.C(d.c)
  const pct = L.deliveredPct(d)
  let Icon = FileText
  let tone: keyof typeof TONE_ICON = "blue"
  let next = ""
  let nextTone = ""
  let btn: { label: string; run: () => void; outline?: boolean; icon?: typeof Bell } | null = null
  if (!d.po) return null
  if (st === "new") {
    tone = "amber"
    next = t("orNew", { x: fmt.date(d.po.need, true) })
    nextTone = "text-warning"
    btn = { label: t("btnAcceptPO"), run: () => act.open("accept-po", d.id), icon: Check }
  } else if (st === "supply") {
    const late = L.isLate(d)
    Icon = late ? AlertTriangle : Truck
    tone = late ? "red" : "blue"
    nextTone = late ? "text-destructive" : ""
    next = late && d.po.acc ? t("orLate", { x: pl("pl_late", -L.daysTo(d.po.acc.date)), l: leftText(f, d) }) : t("orSupply", { x: fmt.date(d.po.acc?.date, true), l: leftText(f, d) })
    btn = { label: t("btnDeliver"), run: () => act.open("deliver", d.id), icon: Truck }
  } else if (st === "wait") {
    const w = L.waiting(d)[0]
    const ot = L.shipOnTime(d, w)
    Icon = Clock
    tone = ot ? "violet" : "amber"
    nextTone = ot ? "" : "text-warning"
    next = t(ot ? "orRep" : "orRepLate", { x: fmt.date(w.date, true) })
    btn = { label: t("btnRemindShort"), run: () => act.open("remind", d.id), outline: true, icon: Bell }
  } else {
    Icon = Check
    tone = "green"
    const is = L.invSt(d)
    const nd = L.nextDue(d)
    next = is === "toinv" ? t("orToinv") : is === "sent" ? t("orSent") : is === "due" ? (nd ? t("orDue", { x: fmt.date(nd.due, true) }) : t("ibDue")) : t("orPaid")
    nextTone = is === "toinv" || is === "sent" ? "text-warning" : ""
  }
  return (
    <li {...go(href({ deal: d.id }))} className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/30">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", TONE_ICON[tone])}>
        <Icon size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 basis-60">
        <Link href={href({ deal: d.id }) as never} scroll={false} className="block truncate text-sm font-bold hover:text-module" dir="auto">
          {d.title}
        </Link>
        <span className="block text-xs text-muted-foreground">
          {docWord(f, "po", d.po.no)} · <bdi>{c?.name}</bdi> · <span dir="ltr">{fmt.money(L.poValue(d))}</span>
          {(st === "supply" || st === "wait") && ` · ${t("delivered")} ${pct}%`}
        </span>
        <span className={cn("mt-0.5 block text-xs font-semibold", nextTone)}>{next}</span>
      </div>
      {btn && (
        <button
          type="button"
          onClick={btn.run}
          className={actionBtn(btn.outline ? "outline" : "primary")}
        >
          {btn.icon && <btn.icon size={13} aria-hidden="true" />}
          {btn.label}
        </button>
      )}
    </li>
  )
}

export function FreeOrders() {
  const f = useFree()
  const { t, L, fmt } = f
  const q = useQueryState()
  const seg = (["all", "you", "them", "done"] as const).find((x) => x === q.get("seg")) || "all"
  const search = (q.get("q") || "").trim()
  const base = useMemo(() => L.deals.filter((d) => d.po && L.poSt(d) !== "declined"), [L])
  const cnt = (k: string) => base.filter((d) => k === "all" || L.WHO[L.poSt(d) as string] === k).length
  const list = useMemo(
    () =>
      base
        .filter((d) => (seg === "all" || L.WHO[L.poSt(d) as string] === seg) && (!search || L.matchQ(d, search)))
        .sort((a, b) => Number(L.isLate(b)) - Number(L.isLate(a)) || (b.po?.at || "").localeCompare(a.po?.at || "")),
    [base, L, seg, search]
  )
  const k = L.dashK()
  const newOrders = base.filter((d) => L.poSt(d) === "new")
  const supply = base.filter((d) => L.poSt(d) === "supply")
  const lateN = base.filter(L.isLate).length
  const groups = GROUPS.map((g) => ({ g, items: list.filter((d) => g.f(f, d)) })).filter((x) => x.items.length)
  const href = q.href

  const kpis: PageKpi[] = [
    { id: "new", icon: FileText, label: t("pkNew"), value: newOrders.length, sub: newOrders.length ? `${fmt.money(newOrders.reduce((s, d) => s + L.poValue(d), 0))} · ${t("beforeVat")}` : t("pkNewNone"), tone: newOrders.length ? "warn" : "up", href: href({ seg: "you" }) },
    { id: "supply", icon: Truck, label: t("pkSupply"), value: fmt.kM(k.accUnsent), unit: fmt.cur, sub: `${f.pl("pl_po", supply.length)} · ${lateN ? t("dkLate", { n: lateN }) : t("dkOnTrack")}`, tone: lateN ? "down" : "up", href: href({ seg: "you" }) },
    { id: "them", icon: Clock, label: t("pkThem"), value: cnt("them"), sub: t("pkThemSub"), tone: "neutral", href: href({ seg: "them" }) },
  ]
  return (
    <FreePage icon={FileText} title={t("navOrders")} description={t("poSub")} kpis={kpis}>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedNav
          ariaLabel={t("navOrders")}
          active={seg}
          onSelect={(id) => q.set({ seg: id === "all" ? "" : id })}
          segments={[
            { id: "all", label: t("pwAll"), count: cnt("all") },
            { id: "you", label: t("pwYou"), count: cnt("you"), tone: "warn" },
            { id: "them", label: t("pwThem"), count: cnt("them") },
            { id: "done", label: t("pwDone"), count: cnt("done") },
          ]}
        />
        <SearchBox value={search} onSearch={(v) => q.set({ q: v }, { replace: true })} placeholder={t("poSearchPh")} />
      </div>
      {!list.length ? (
        <EmptyState
          icon={FileText}
          title={t(search ? "listEmptyF" : (`poEmpty_${seg}` as "poEmpty_all"))}
          action={
            search ? (
              <Link href={href({ q: "" }) as never} className={actionBtn("outline", "md")}>
                {t("clearFilters")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map(({ g, items }) => {
            const GI = g.icon
            return (
              <section key={g.k} className="overflow-hidden rounded-xl border bg-card">
                <header className="flex items-center gap-2 border-b px-4 py-3">
                  <GI size={16} className="text-module" aria-hidden="true" />
                  <h3 className="text-sm font-bold">{t(g.k as "pgNew")}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">{items.length}</span>
                </header>
                <ul className="divide-y">
                  {items.map((d) => (
                    <OrderRow key={d.id} f={f} d={d} href={href} />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </FreePage>
  )
}
