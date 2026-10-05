// HR 1.0 — Today's rows of the optional growth features (the prototype's x5Decisions for `train` and `perf`):
// on-duty people without a valid safety certificate and a session due to record (HR manager), a supervisor's own
// workers without one; reviews awaiting approval (flagging a rater mostly «outstanding»), raises to apply (HR
// manager), workers still to rate (the rater), the raise proposal (management). Each row only when its feature
// is on and for the hand that acts on it — never a row another module holds (TD-03). Pure: no I/O.

import { hrAllowed, type HrContext } from "./access"
import type { EmployeePay, HrEmployee } from "./employee"
import { cycleOpen, isApproved, isSent, mayApplyRaise, raiseFor, raisePlan, raters, reviewEligible, type Band, type HrReview, type ReviewCycle } from "./performance"
import type { HrFeature } from "./settings"
import type { HrSite } from "./sites"
import type { FactPart, TodayItem } from "./today"
import { certGaps, gapBad, inSession, nextSession, trainHours, type TrainingSession } from "./training"

export interface GrowthTodayInput {
  ctx: HrContext
  today: string
  features: ReadonlySet<HrFeature>
  renewWindowDays: number
  recordWeight: number
  employees: readonly HrEmployee[]
  sites: readonly Pick<HrSite, "id" | "type">[]
  sessions: readonly TrainingSession[]
  cycle: ReviewCycle | null
  reviews: readonly HrReview[]
  /** Pay by employee (money roles only) — the management row's monthly figure. */
  pays?: ReadonlyMap<string, EmployeePay>
}

export function growthTodayItems(i: GrowthTodayInput): TodayItem[] {
  const { ctx, today } = i
  const out: TodayItem[] = []
  const byId = new Map(i.employees.map((e) => [e.id, e]))
  const siteType = (id: string | null | undefined) => i.sites.find((s) => s.id === id)?.type ?? null

  if (i.features.has("train")) {
    const gaps = certGaps(i.employees, siteType, today, i.renewWindowDays)
    if (hrAllowed(ctx, "train.manage")) {
      const bad = gaps.filter((g) => gapBad(g, byId.get(g.employeeId), today))
      if (bad.length) {
        const booked = bad.filter((g) => inSession(i.sessions, g.employeeId, g.cert)).length
        out.push({ key: "train:gaps", group: "blocking", severity: "red", kind: "train_gaps", params: { count: bad.length }, facts: [{ k: "train_booked", p: { n: booked } }], href: "perf?seg=train", action: "schedule" })
      }
      for (const s of i.sessions)
        if (s.state === "plan" && s.at <= today)
          out.push({ key: `train:session:${s.id}`, group: "due", severity: "amber", kind: "train_session", params: { count: s.ppl.length, date: s.at }, facts: [{ k: "course", p: { course: s.course } }, { k: "train_record_why" }], href: `perf?seg=train&session=${s.id}`, action: "record" })
    } else if (ctx.roles.has("supervisor") && ctx.sites.length) {
      const mine = gaps.filter((g) => g.siteId && ctx.sites.includes(g.siteId) && gapBad(g, byId.get(g.employeeId), today))
      if (mine.length) {
        const next = nextSession(i.sessions, "ind")
        const facts: FactPart[] = [next ? { k: "train_next", p: { date: next.at } } : { k: "train_ask_hr" }]
        out.push({ key: "train:mine", group: "blocking", severity: "red", kind: "train_gaps_mine", params: { count: mine.length }, facts, href: "perf?seg=train", action: "view" })
      }
    }
  }

  const cycle = i.cycle
  if (i.features.has("perf") && cycle) {
    const own = (r: HrReview) => !ctx.owner && (r.employeeUserId === ctx.uid || r.employeeId === ctx.employeeId)
    if (hrAllowed(ctx, "perf.approve")) {
      const pend = i.reviews.filter((r) => r.st === "done" && !own(r))
      if (pend.length) {
        const flagged = raters(i.reviews, i.recordWeight).filter((x) => x.flag && x.pend)
        const facts: FactPart[] = flagged.length ? [{ k: "perf_flagged", p: { names: flagged.map((x) => x.name ?? "—").join("، ") } }] : [{ k: "perf_per_rater" }]
        out.push({ key: "perf:pending", group: "requests", severity: "blue", kind: "perf_pending", params: { count: pend.length }, facts, href: "perf", action: "calibrate" })
      }
    }
    const raise = cycle.raise
    if (raise?.state === "ok" && (hrAllowed(ctx, "perf.raise") || ctx.roles.has("management"))) {
      const mineToApply = i.reviews.filter((r) => raiseFor(r, raise, i.recordWeight) && mayApplyRaise(ctx, r))
      if (mineToApply.length) out.push({ key: "perf:apply", group: "due", severity: "amber", kind: "perf_apply", params: { count: mineToApply.length, date: raise.eff }, facts: [{ k: "perf_apply_why" }], href: "perf", action: "apply" })
    }
    if (raise?.state === "mg" && hrAllowed(ctx, "perf.raise.decide")) {
      const facts: FactPart[] = [{ k: "perf_raise_from", p: { date: raise.eff } }]
      if (i.pays && hrAllowed(ctx, "pay.view")) {
        const people = new Map(i.employees.map((e) => [e.id, e]))
        const plan = raisePlan(i.reviews.filter(isApproved), { pct: raise.pct, weight: i.recordWeight, pays: i.pays, people, today })
        facts.unshift({ k: "perf_raise_cost", p: { cost: plan.total } })
      }
      out.push({ key: "perf:raises", group: "requests", severity: "amber", kind: "perf_raises", params: { count: raise.n }, facts, href: "perf", action: "open" })
    }
    if (cycleOpen(cycle, today)) {
      const toRate = i.reviews.filter((r) => r.raterUserId === ctx.uid && r.st === "draft" && !own(r))
      if (toRate.length) out.push({ key: "perf:rate", group: "due", severity: "amber", kind: "perf_rate", params: { count: toRate.length, date: cycle.close }, facts: [{ k: "perf_rate_how" }], href: "perf", action: "rate" })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The growth tab's three numbers (TD-04: each is the count of what it opens)
// ---------------------------------------------------------------------------

export interface GrowthKpi {
  id: string
  value: number
  /** Riyals — shown only to money roles; `hidden` reads «•••». */
  money?: boolean
  hidden?: boolean
  note: string
  params: Record<string, string | number>
  tone: "good" | "bad" | "warn" | "neutral"
}

/** Training (the prototype's trainView KPIs): on duty without a valid certificate · expiring in 60 days ·
 * scheduled sessions with the year's training hours. A supervisor counts his own workplaces. */
export function trainingKpis(i: { today: string; renewWindowDays: number; employees: readonly HrEmployee[]; sites: readonly Pick<HrSite, "id" | "type">[]; sessions: readonly TrainingSession[]; scope: readonly string[] | null }): GrowthKpi[] {
  const byId = new Map(i.employees.map((e) => [e.id, e]))
  const people = i.scope ? i.employees.filter((e) => e.siteId && i.scope!.includes(e.siteId)) : i.employees
  const gaps = certGaps(people, (id) => i.sites.find((s) => s.id === id)?.type ?? null, i.today, i.renewWindowDays)
  const bad = gaps.filter((g) => gapBad(g, byId.get(g.employeeId), i.today))
  const soon = gaps.filter((g) => g.state === "d30" || g.state === "d60")
  const planned = i.sessions.filter((s) => s.state === "plan")
  return [
    { id: "train_bad", value: bad.length, note: "note", params: { n: bad.filter((g) => inSession(i.sessions, g.employeeId, g.cert)).length }, tone: bad.length ? "bad" : "good" },
    { id: "train_soon", value: soon.length, note: "note", params: {}, tone: soon.length ? "warn" : "good" },
    { id: "train_planned", value: planned.length, note: "note", params: { seats: planned.reduce((a, s) => a + s.ppl.length, 0), hours: trainHours(i.sessions, i.today.slice(0, 4)) }, tone: "neutral" },
  ]
}

/** Performance (the prototype's perfView KPIs). The office: completed of the eligible · awaiting approval (with
 * rater skew) · review raises a month (money). A rater: sent of his team · drafts not sent · awaiting HR. */
export function perfKpis(i: {
  ctx: HrContext
  today: string
  cycle: ReviewCycle
  reviews: readonly HrReview[]
  employees: readonly HrEmployee[]
  recordWeight: number
  pct: Record<Band, number>
  pays: ReadonlyMap<string, EmployeePay> | null
}): GrowthKpi[] {
  const office = i.ctx.owner || i.ctx.roles.has("manager") || i.ctx.roles.has("management")
  if (!office) {
    const team = i.reviews.filter((r) => r.raterUserId === i.ctx.uid)
    const sent = team.filter(isSent).length
    const drafts = team.filter((r) => r.st === "draft" && r.sc).length
    return [
      { id: "perf_team_sent", value: sent, note: "note", params: { of: team.length, date: i.cycle.close }, tone: sent < team.length ? "warn" : "good" },
      { id: "perf_drafts", value: drafts, note: "note", params: {}, tone: drafts ? "warn" : "good" },
      { id: "perf_team_wait", value: team.filter((r) => r.st === "done").length, note: "note", params: {}, tone: "neutral" },
    ]
  }
  const live = i.employees.filter((e) => e.status === "active" || e.status === "leave")
  const eligible = live.filter((e) => reviewEligible(e, i.today)).length
  const sent = i.reviews.filter(isSent).length
  const pend = i.reviews.filter((r) => r.st === "done").length
  const flagged = raters(i.reviews, i.recordWeight).filter((x) => x.flag && x.pend).length
  const approved = i.reviews.filter(isApproved)
  const people = new Map(i.employees.map((e) => [e.id, e]))
  const plan = i.pays ? raisePlan(approved, { pct: i.cycle.raise?.pct ?? i.pct, weight: i.recordWeight, pays: i.pays, people, today: i.today }) : null
  const raise = i.cycle.raise
  return [
    { id: "perf_done", value: sent, note: "note", params: { of: Math.max(eligible, i.reviews.length), date: i.cycle.close, outside: Math.max(0, live.length - eligible) }, tone: sent < i.reviews.length ? "warn" : "good" },
    { id: i.ctx.roles.has("manager") || i.ctx.owner ? "perf_pending" : "perf_pending_hr", value: pend, note: flagged ? "flagged" : "none", params: { n: flagged }, tone: pend ? "warn" : "good" },
    { id: "perf_raises", value: plan?.total ?? 0, money: true, hidden: !plan, note: raise ? (raise.state === "mg" ? "with_mgmt" : "approved") : "none", params: { n: approved.length, date: raise?.eff ?? "" }, tone: "neutral" },
  ]
}
