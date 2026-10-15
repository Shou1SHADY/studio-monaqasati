"use client"

// The state words of the free journey, one tone per meaning on every screen (PRD NAV-07, G-05): the quote's state,
// the order's, the invoice's, the instalment's — and the one pill a deal shows in its drawer header and its lists.

import type { Deal } from "@/lib/supplier-free/types"
import type { OfferState } from "@/lib/supplier-free/deal-logic"
import type { PillTone } from "@/components/module-ui/StatusPill"
import type { Free } from "./useFree"
import { DeadlinePill, Pill } from "./ui"

const OFF: Record<string, [PillTone, string]> = {
  declinedPo: ["mute", "obDeclinedPo"],
  reduce: ["warn", "obReduce"],
  sample: ["warn", "obSample"],
  sampleSent: ["info", "obSampleSent"],
  review: ["info", "obReview"],
  won: ["ok", "obWon"],
  lost: ["mute", "obLost"],
  noaward: ["mute", "obNoAward"],
  withdrawn: ["mute", "obWithdrawn"],
  noquote: ["mute", "obNoQuote"],
}

export function OfferPill({ f, d }: { f: Free; d: Deal }) {
  const s = f.L.offerSt(d) as Exclude<OfferState, null>
  const b = s ? OFF[s] : null
  return b ? (
    <Pill tone={b[0]} dot>
      {f.t(b[1] as "obWon")}
    </Pill>
  ) : null
}

export function PoPill({ f, d }: { f: Free; d: Deal }) {
  const { t, L, pl } = f
  const s = L.poSt(d)
  if (s === "new") return <Pill tone="warn" dot>{t("pbNew")}</Pill>
  if (s === "supply") return L.isLate(d) && d.po?.acc ? <Pill tone="bad" dot>{pl("pl_late", -L.daysTo(d.po.acc.date))}</Pill> : <Pill tone="info" dot>{t("pbSupply")}</Pill>
  if (s === "wait") return <Pill tone={L.isLate(d) ? "warn" : "info"} dot>{t("pbWait")}</Pill>
  if (s === "done") return <Pill tone="ok" dot>{t("pbDone")}</Pill>
  return <Pill tone="mute">{t("pbDeclined")}</Pill>
}

export function InvPill({ f, d }: { f: Free; d: Deal }) {
  const { t, L } = f
  const s = L.invSt(d)
  if (s === "toinv") return <Pill tone="warn" dot>{t("ibToinv")}</Pill>
  if (s === "sent") return <Pill tone="warn" dot>{t("ibSent")}</Pill>
  if (s === "paid") return <Pill tone="ok" dot>{t("ibPaid")}</Pill>
  if (L.payIssue(d)) return <Pill tone="bad" dot>{t("ibMiss")}</Pill>
  return L.isOverdue(d) ? <Pill tone="bad" dot>{t("ibLate")}</Pill> : <Pill tone="mute" dot>{t("ibDue")}</Pill>
}

export function InstalmentPill({ f, state, due, rel }: { f: Free; state: "paid" | "sent" | "late" | "due"; due: string; rel: (iso: string) => string }) {
  const { t } = f
  if (state === "paid") return <Pill tone="ok" dot>{t("instPaid")}</Pill>
  if (state === "sent") return <Pill tone="warn" dot>{t("instSent")}</Pill>
  if (state === "late") return <Pill tone="bad" dot>{t("instLate")}</Pill>
  return <Pill tone="mute">{t("instDue", { x: rel(due) })}</Pill>
}

/** The one pill a deal wears, by its stage. */
export function DealPill({ f, d }: { f: Free; d: Deal }) {
  const { t, L } = f
  const st = L.stage(d)
  if (st === "new") return <DeadlinePill f={f} iso={d.deadline} />
  if (st === "offered") return <OfferPill f={f} d={d} />
  if (st === "deliver") return <PoPill f={f} d={d} />
  if (st === "collect") return L.waiting(d).length ? <PoPill f={f} d={d} /> : <InvPill f={f} d={d} />
  const k = d.closed ? d.closed.k : ""
  if (k === "paid") return <Pill tone="ok" dot>{t("ibPaid")}</Pill>
  if (k === "declined") return <PoPill f={f} d={d} />
  if (k === "noquote") return <Pill tone="mute">{t("obNoQuote")}</Pill>
  return <OfferPill f={f} d={d} />
}
