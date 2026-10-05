// HR 1.0 — Hiring's rows on Today (the prototype's x5Decisions, r = hr / gov /
// mgmt; optional: hire — with the switch off, none). Each row is one this
// viewer may act on, with its facts and its first action on the Hiring tab:
// the HR manager — an opening that will miss its date, candidates waiting on
// him; government relations (or the HR manager with nobody in the role) — an
// accepted candidate to convert, a recruitment batch's next step, new joiners
// without Qiwa / GOSI; management — a new position and an offer above the band
// to decide (amounts only to management, who sees pay). Pure.

import { hrAllowed, type HrContext } from "./access"
import type { HrEmployee } from "./employee"
import {
  bandOf,
  onboardingList,
  onboardingOpen,
  openingEta,
  openingLate,
  positionCost,
  waitsOnUs,
  type Candidate,
  type CandidatePay,
  type HiredEmployee,
  type Opening,
} from "./hiring"
import type { HrSite } from "./sites"
import type { HrPolicies } from "./statutory"
import type { FactPart, TodayItem } from "./today"

export interface HiringWorld {
  openings: Opening[]
  candidates: Candidate[]
  /** Candidates' money — present only for pay roles (RL-03). */
  pays: Map<string, CandidatePay>
  policies: HrPolicies
}

export function hiringTodayItems(i: { ctx: HrContext; today: string; hiring: HiringWorld; employees: HrEmployee[]; sites: HrSite[]; govDesk: boolean }): TodayItem[] {
  const { ctx, today, hiring } = i
  const out: TodayItem[] = []
  const site = (id: string | null) => (id ? (i.sites.find((s) => s.id === id)?.name ?? "") : "")
  const open = hiring.openings.filter((o) => o.state === "open")
  const live = new Set(open.map((o) => o.id))

  if (hrAllowed(ctx, "hire.manage")) {
    for (const o of open) {
      const late = openingLate(o, hiring.candidates, today)
      if (!late) continue
      const eta = openingEta(o, hiring.candidates, today)
      out.push({
        key: `job_late:${o.id}`,
        group: "due",
        severity: "amber",
        kind: "job_late",
        params: { trade: o.trade, site: site(o.siteId), n: late },
        facts: [{ k: "needed", p: { date: o.need } }, { k: "expected", p: { date: eta.date } }, { k: `eta_${eta.why}` }],
        href: `hiring?job=${o.id}`,
        action: "open",
      })
    }
    const mine = hiring.candidates.filter((c) => live.has(c.openingId) && waitsOnUs(c))
    if (mine.length)
      out.push({
        key: "cand_wait",
        group: "requests",
        severity: "blue",
        kind: "cand_wait",
        params: { n: mine.length },
        facts: [{ k: "cand_split", p: { a: mine.filter((c) => c.stage === "new").length, b: mine.filter((c) => c.stage === "int").length, c: mine.filter((c) => c.stage === "acc").length } }],
        href: "hiring?seg=cand",
        action: "candidates",
      })
  }

  if (i.govDesk) {
    if (hrAllowed(ctx, "hire.convert"))
      for (const c of hiring.candidates.filter((x) => x.stage === "acc" && live.has(x.openingId)))
        out.push({
          key: `cand_acc:${c.id}`,
          group: "requests",
          severity: "amber",
          kind: "cand_accepted",
          params: { name: c.names.ar, date: c.offer?.start ?? today },
          facts: [{ k: "trade", p: { trade: c.trade } }, { k: "site", p: { site: site(c.siteId) } }, { k: "convert_on_signing" }],
          href: `hiring?job=${c.openingId}&convert=${c.id}`,
          action: "convert",
        })
    if (hrAllowed(ctx, "hire.batch"))
      for (const o of open.filter((x) => x.track === "batch" && x.batch && x.batch.stage !== "auth"))
        out.push({
          key: `batch:${o.id}`,
          group: "due",
          severity: "blue",
          kind: `batch_${o.batch!.stage}`,
          params: { trade: o.trade, site: site(o.siteId) },
          facts: [...(o.batch!.agency ? [{ k: "quote", p: { text: o.batch!.agency } }] : []), { k: "expected", p: { date: openingEta(o, hiring.candidates, today).date } }],
          href: `hiring?job=${o.id}`,
          action: "record_next",
        })
    if (hrAllowed(ctx, "hire.onboard")) {
      const missing = onboardingList(i.employees as HiredEmployee[], today).filter(onboardingOpen)
      if (missing.length) out.push({ key: "onb", group: "due", severity: "blue", kind: "onb_missing", params: { n: missing.length }, href: "hiring?seg=join", action: "onboarding" })
    }
  }

  if (hrAllowed(ctx, "hire.approve")) {
    for (const o of hiring.openings.filter((x) => x.state === "wait")) {
      const facts: FactPart[] = []
      if (o.why) facts.push({ k: "quote", p: { text: o.why } })
      facts.push({ k: "cost_month", p: { cost: positionCost(o.trade, o.q, hiring.policies) } })
      out.push({ key: `job_wait:${o.id}`, group: "requests", severity: "amber", kind: "job_approve", params: { trade: o.trade, site: site(o.siteId), n: o.q }, facts, href: `hiring?job=${o.id}`, action: "open" })
    }
    for (const c of hiring.candidates.filter((x) => x.stage === "offer" && x.offer?.state === "mg")) {
      const basic = hiring.pays.get(c.id)?.basic ?? null
      const band = bandOf(c.trade, hiring.policies)
      const facts: FactPart[] = [{ k: "trade", p: { trade: c.trade } }]
      if (basic != null && band) facts.push({ k: "offer_vs_ceiling", p: { basic, ceiling: band[1] } })
      out.push({ key: `offer_mg:${c.id}`, group: "requests", severity: "amber", kind: "offer_above", params: { name: c.names.ar }, facts, href: `hiring?job=${c.openingId}`, action: "open" })
    }
  }
  return out
}
