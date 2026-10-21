"use client"

// One task of "Need your reply" (PRD TDY-02…04) in words: what a named contractor asked, or what stalls without the
// supplier — its title, two facts and its act. The portal home shows each as a decision card (home-model.ts).

import type { Task } from "@/lib/supplier-free/world-logic"
import type { Deal } from "@/lib/supplier-free/types"
import type { Free } from "./useFree"
import type { ActionKind } from "./ActionsProvider"

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
      return { title: o?.reduce?.target ? t("aReduce", { v: fmt.money(o.reduce.target) }) : t("aReduceBetter"), facts: [...base, [t("dsOffer"), fmt.money(L.offerTotal(d))]], action: { label: t("btnReply"), href: href({ deal: d.id }) } }
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
