"use client"

// One task of "Need your reply" (PRD TDY-02…04): what a named contractor asked, or what stalls without the supplier.
// A coloured domain badge, the due label, the title, the deal, two facts, and two buttons — the act itself and Details.

import { AlertTriangle, FileText, Link2, Package, Send, Truck, Wallet, type LucideIcon } from "lucide-react"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { TASK_DOMAIN, type Task, type TaskDomain, type TaskKind } from "@/lib/supplier-free/world-logic"
import type { Deal } from "@/lib/supplier-free/types"
import { DueText } from "./ui"
import type { Free } from "./useFree"
import { useActions, type ActionKind } from "./ActionsProvider"

const DOMAIN: Record<TaskDomain, { badge: string; edge: string; icon: LucideIcon; key: string }> = {
  offers: { badge: "bg-indigo/10 text-indigo", edge: "bg-indigo", icon: Send, key: "ag_offers" },
  supply: { badge: "bg-teal/10 text-teal", edge: "bg-teal", icon: Truck, key: "ag_supply" },
  money: { badge: "bg-success/10 text-success", edge: "bg-success", icon: Wallet, key: "ag_money" },
  links: { badge: "bg-destructive/10 text-destructive", edge: "bg-destructive", icon: Link2, key: "ag_conn" },
}

export const TASK_ICON: Record<TaskKind, LucideIcon> = {
  aInviteRfq: Send,
  aReduce: AlertTriangle,
  aSample: Package,
  aAcceptPO: FileText,
  aLate: AlertTriangle,
  aShipSoon: Truck,
  aInvoice: FileText,
  aPaySent: Wallet,
  aConnInvite: Link2,
}

/** "8 t of 12 mm steel + 1 more item": what is still left on an order. */
export function leftText(f: Free, d: Deal): string {
  if (!d.po) return ""
  const left = d.po.lines
    .map((l) => ({ s: f.L.lineSt(l), i: d.items.find((x) => x.id === l.it) }))
    .filter((x) => x.s.left > 0 && x.i)
  if (!left.length) return ""
  const first = left[0]
  return `${f.fmt.n(first.s.left)} ${first.i?.unit} ${first.i?.name}${left.length > 1 ? ` ${f.t("plusMore", { n: f.pl("pl_item", left.length - 1) })}` : ""}`
}

export interface TaskView {
  title: string
  facts: [string, string][]
  action: { label: string; kind?: ActionKind; href?: string }
}

export function taskView(f: Free, a: Task, href: (p: Record<string, string | null>) => string): TaskView {
  const { t, fmt, L } = f
  if (a.kind === "aConnInvite") {
    const c = a.c ? L.C(a.c) : null
    return { title: t("aConnInvite"), facts: [[t("thContractor"), c?.name || "—"], [t("fCity"), c?.city || "—"]], action: { label: t("btnReview"), href: "/supplier/connections?tab=inv" } }
  }
  const d = f.world.deals.find((x) => x.id === a.deal) as Deal
  const c = L.C(d.c)
  const o = d.offer
  const base: [string, string][] = [[t("thContractor"), c?.name || "—"]]
  switch (a.kind) {
    case "aInviteRfq":
      return { title: t("aInviteRfq"), facts: [...base, [t("thItems"), f.pl("pl_item", d.items.length)]], action: { label: t("btnOffer"), href: href({ quote: d.id, mode: "new" }) } }
    case "aReduce":
      return { title: t("aReduce", { v: fmt.money(o?.reduce?.target || 0) }), facts: [...base, [t("dsOffer"), fmt.money(L.offerTotal(d))]], action: { label: t("btnReply"), href: href({ deal: d.id }) } }
    case "aSample":
      return { title: t("aSample", { w: o?.sample?.what || "" }), facts: [...base, [t("fSite"), o?.sample?.place || "—"]], action: { label: t("btnSampleShort"), kind: "sample-sent" } }
    case "aAcceptPO":
      return { title: t("aAcceptPO", { po: d.po?.no || "", v: fmt.money(L.poValue(d)) }), facts: [...base, [t("fPONeed"), fmt.date(d.po?.need, true)]], action: { label: t("btnAcceptPO"), kind: "accept-po" } }
    case "aLate":
      return { title: t("aLate", { x: leftText(f, d) }), facts: [...base, [t("fCommit"), fmt.date(d.po?.acc?.date, true)]], action: { label: t("btnDeliver"), kind: "deliver" } }
    case "aShipSoon":
      return { title: t("aShipSoon"), facts: [...base, [t("fCommit"), fmt.date(d.po?.acc?.date, true)]], action: { label: t("btnDeliver"), kind: "deliver" } }
    case "aInvoice":
      return { title: t("aInvoice"), facts: [...base, [t("estFromGrn"), fmt.money(L.uninvoicedGross(d))]], action: { label: t("btnInvoiceShort"), kind: "invoice" } }
    default:
      return { title: t("aPaySent", { v: fmt.money(L.paidSent(d)) }), facts: [...base, [t("fBank"), d.pays.find((p) => p.st === "sent")?.bank || "—"]], action: { label: t("btnConfirmPay"), kind: "pay-ok" } }
  }
}

export function TaskCard({ f, a, href }: { f: Free; a: Task; href: (p: Record<string, string | null>) => string }) {
  const { t } = f
  const act = useActions()
  const v = taskView(f, a, href)
  const dom = DOMAIN[TASK_DOMAIN[a.kind]]
  const Icon = dom.icon
  const d = a.deal ? f.world.deals.find((x) => x.id === a.deal) : null
  const btn = "inline-flex h-8 items-center rounded-lg px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  return (
    <article className="relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-card p-4 ps-5">
      <span className={cn("absolute inset-y-0 start-0 w-1", dom.edge)} aria-hidden="true" />
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold", dom.badge)}>
          <Icon size={12} aria-hidden="true" />
          {t(dom.key)}
        </span>
        <span className="flex-1" />
        {a.due && <DueText f={f} iso={a.due} />}
      </div>
      <h3 className="text-sm font-bold leading-snug" dir="auto">
        {v.title}
      </h3>
      {d && (
        <Link href={href({ deal: d.id }) as never} scroll={false} className="flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <FileText size={13} aria-hidden="true" />
          <bdi className="line-clamp-1">{d.title}</bdi>
        </Link>
      )}
      <dl className="grid grid-cols-2 gap-2 text-xs">
        {v.facts.map(([k, val]) => (
          <div key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-bold">
              <bdi>{val}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-1 flex gap-2">
        {v.action.href ? (
          <Link href={v.action.href as never} scroll={false} className={cn(btn, "bg-cta text-cta-foreground hover:bg-cta/90")}>
            {v.action.label}
          </Link>
        ) : (
          <button type="button" onClick={() => v.action.kind && d && act.open(v.action.kind, d.id)} className={cn(btn, "bg-cta text-cta-foreground hover:bg-cta/90")}>
            {v.action.label}
          </button>
        )}
        <Link href={(d ? href({ deal: d.id }) : "/supplier/connections?tab=inv") as never} scroll={false} className={cn(btn, "border bg-card hover:bg-muted/50")}>
          {t("details")}
        </Link>
      </div>
    </article>
  )
}
