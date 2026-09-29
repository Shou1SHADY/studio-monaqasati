// A PM 1.0 project's head and Pulse (the prototype's first tab), derived on
// every read — nothing here is stored:
//   · the head: the day count, the progress tile's note, whether a certificate
//     is worth preparing (the prototype offers it above SAR 1,000 unbilled);
//   · the money trail — what the contract is worth, executed, billed and
//     collected, against the cost budget, committed, actual and paid, with the
//     projected penalty and the work done under unapproved variations;
//   · what waits on another module, late first (the act is theirs, so a row
//     only opens where the thing sits);
//   · the BOQ divisions against their planned progress — each division's plan
//     comes from the programme's activities where its items are scheduled, and
//     from the project's planned line where they are not;
//   · the project log — the latest dated facts from its own records.
// A figure with no source (the cost budget before items carry an estimated
// cost) is null and says so; it is never invented.

import { awaitingReply } from "../inventory/project-supply"
import { daysBetween } from "./site"
import type { ReqLine } from "./supply"

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const two = (n: number) => String(n).padStart(2, "0")
const d10 = (s: string | null | undefined) => (s ? s.slice(0, 10) : "")

// ── The head ─────────────────────────────────────────────────────────────────

/** «اليوم X من Y»: days elapsed since the start against the duration in force. */
export function projectDays(startOn: string | null | undefined, effectiveDays: number, today: string): { el: number; tot: number } | null {
  if (!startOn || !(effectiveDays > 0)) return null
  return { el: today < d10(startOn) ? 0 : daysBetween(d10(startOn), today), tot: effectiveDays }
}

/** The prototype offers «أعِدّ مستخلصاً» only when this much is executed and unbilled. */
export const PREPARE_OFFER_AT = 1000
/** Above this the unbilled tile turns red. */
export const UNBILLED_ALARM = 50_000

export type ProgressNote = { kind: "plan"; planned: number; dv: number } | { kind: "no_boq" } | { kind: "all_unpriced" } | { kind: "no_plan" }

export function progressNote(f: { itemCount: number; unpricedCount: number; planned: number | null; progress: number | null }): ProgressNote {
  if (f.planned) return { kind: "plan", planned: f.planned, dv: Math.round((f.progress ?? 0) - f.planned) }
  if (!f.itemCount) return { kind: "no_boq" }
  if (f.unpricedCount === f.itemCount) return { kind: "all_unpriced" }
  return { kind: "no_plan" }
}

export const progressTone = (n: ProgressNote): "bad" | "good" | "neutral" => (n.kind !== "plan" ? "neutral" : n.dv < -4 ? "bad" : n.dv > 2 ? "good" : "neutral")

/** The Pulse's top note: no BOQ yet, or every imported item without a rate. */
export function boqNote(itemCount: number, unpricedCount: number): "no_boq" | "all_unpriced" | null {
  if (!itemCount) return "no_boq"
  return unpricedCount === itemCount ? "all_unpriced" : null
}

// ── The money trail ──────────────────────────────────────────────────────────

export interface TrailItem {
  quantity: number
  rate: number
  executed: number
  billed: number
}

export interface TrailInput {
  /** The signed contract value (`project.budget`); the priced BOQ when it is not set. */
  contractBase: number
  items: TrailItem[]
  variations: Array<{ status: string; value: number; cost: number; executedPct: number; billedPct?: number }>
  /** Consultant deductions returned to "unbilled" until claimed again. */
  cutPool: number
  certificates: Array<{ status: string; net: number; collected?: number | null }>
  /** From the cost roll-up (`projectCost`); `budget` null while no line carries an estimated cost. */
  cost: { budget: number | null; committed: number; actual: number; paid: number }
}

export interface MoneyTrail {
  contract: number
  voApproved: number
  executed: number
  executedPct: number
  billed: number
  /** Executed and not claimed (the gap the prototype flags above SAR 1,000). */
  gap: number
  collected: number
  outstanding: number
  budget: number | null
  committed: number
  actual: number
  paid: number
  /** Owed to suppliers: actual − paid. */
  due: number
  /** Executed under a variation not yet approved — neither executed nor claimable. */
  voRisk: number
  /** Realised margin so far: executed − actual cost. */
  margin: number
}

export const TRAIL_GAP = 1000

export const collectedShare = (c: { status: string; collected?: number | null }) =>
  c.status === "paid" ? 1 : c.status === "part" ? Math.min(1, Math.max(0, c.collected ?? 0)) : 0

export function moneyTrail(i: TrailInput): MoneyTrail {
  const priced = i.items.filter((x) => x.rate > 0)
  const boqValue = priced.reduce((a, x) => a + x.quantity * x.rate, 0)
  const voApproved = r2(i.variations.filter((v) => v.status === "appr").reduce((a, v) => a + v.value, 0))
  const contract = r2((i.contractBase > 0 ? i.contractBase : boqValue) + voApproved)
  const voEarned = i.variations.filter((v) => v.status === "appr").reduce((a, v) => a + v.value * v.executedPct, 0)
  const executed = r2(priced.reduce((a, x) => a + x.executed * x.rate, 0) + voEarned)
  // Variation work billed (its billed share) counts as billed, as in the prototype's pBilled.
  const voBilled = i.variations.filter((v) => v.status === "appr").reduce((a, v) => a + v.value * (v.billedPct ?? 0), 0)
  const billed = r2(Math.max(0, priced.reduce((a, x) => a + x.billed * x.rate, 0) + voBilled - i.cutPool))
  const collected = r2(i.certificates.filter((c) => c.status !== "void").reduce((a, c) => a + c.net * collectedShare(c), 0))
  const voRisk = r2(i.variations.filter((v) => v.status !== "appr" && v.executedPct > 0).reduce((a, v) => a + v.value * v.executedPct, 0))
  return {
    contract,
    voApproved,
    executed,
    executedPct: contract > 0 ? r1((executed / contract) * 100) : 0,
    billed,
    gap: r2(executed - billed),
    collected,
    outstanding: r2(billed - collected),
    budget: i.cost.budget,
    committed: r2(i.cost.committed),
    actual: r2(i.cost.actual),
    paid: r2(i.cost.paid),
    due: r2(i.cost.actual - i.cost.paid),
    voRisk,
    margin: r2(executed - i.cost.actual),
  }
}

/** The prototype shows the trail to money holders, on a contract with a value,
 * not every item unpriced, and with billing or cost switched on. */
export function showMoneyTrail(f: { money: boolean; contract: number; itemCount: number; unpricedCount: number; ipcOn: boolean; costOn: boolean }): boolean {
  return f.money && f.contract > 0 && f.unpricedCount < f.itemCount && (f.ipcOn || f.costOn)
}

export interface PenaltyNote {
  amount: number
  /** The cap is reached: the note turns red. */
  atCap: boolean
  behind: number
  delayDays: number
  weeks: number
  /** Percent of the contract per week, and the cap, as the terms say them. */
  ratePct: number
  capPct: number
  overMargin: boolean
}

export function penaltyNote(f: {
  damages: { on: boolean; weeklyRate: number; cap: number }
  contract: number
  delay: { planned: number; delayDays: number; damages: number } | null
  progress: number | null
  margin: number
}): PenaltyNote | null {
  if (!f.delay || !(f.delay.damages > 0)) return null
  return {
    amount: f.delay.damages,
    atCap: f.delay.damages >= f.damages.cap * f.contract - 0.01,
    behind: Math.round(f.delay.planned - (f.progress ?? 0)),
    delayDays: f.delay.delayDays,
    weeks: Math.floor(f.delay.delayDays / 7),
    ratePct: r2(f.damages.weeklyRate * 100),
    capPct: r2(f.damages.cap * 100),
    overMargin: f.delay.damages > f.margin,
  }
}

// ── Waiting on other modules ─────────────────────────────────────────────────

/** A wait older than this at another module is late — what is on time is counted, not listed. */
export const WAIT_LATE_DAYS = 3
export const WAIT_CAP = 4

export type WaitModule = "proc" | "fin" | "inv" | "crm"

export type WaitKind = "po" | "request" | "request_rfq" | "request_inv" | "cert_invoice" | "retention" | "crm_returned" | "store_return" | "store_sret"

export interface WaitRow {
  id: string
  module: WaitModule
  kind: WaitKind
  params: Record<string, string | number>
  /** The sub-line: `sub` is a key under the same family, with its own params. */
  sub: { kind: string; params: Record<string, string | number> }
  amount?: number
  age: number
  late: boolean
  projectId: string | null
  /** Where the row opens: a tab of its project, or a page. */
  tab?: string
  href?: string
}

const ageOf = (from: string | null | undefined, today: string) => (d10(from) ? daysBetween(d10(from), today) : 0)

export function poWaitRows(
  pos: Array<{ id: string; docNumber: string; supplierName: string; projectId: string | null; promisedDate?: string | null; sentAt?: string | null; approvedAt?: string | null; createdAt: string; totalExVat?: number; lines: Array<{ name: string; quantity: number; unit: string }> }>,
  today: string
): WaitRow[] {
  return pos.map((po): WaitRow => {
    const age = ageOf(po.sentAt ?? po.approvedAt ?? po.createdAt, today)
    const promised = d10(po.promisedDate)
    return {
      id: `po:${po.id}`,
      module: "proc",
      kind: "po",
      params: { no: po.docNumber, supplier: po.supplierName },
      sub: promised
        ? { kind: "po_promised", params: { lines: po.lines.slice(0, 2).map((l) => `${l.name} ${l.quantity} ${l.unit}`).join(" · "), date: promised } }
        : { kind: "po_lines", params: { lines: po.lines.slice(0, 2).map((l) => `${l.name} ${l.quantity} ${l.unit}`).join(" · ") } },
      amount: po.totalExVat,
      age,
      late: promised ? promised < today : age >= WAIT_LATE_DAYS,
      projectId: po.projectId,
      href: `/contractor/rfqs/orders?po=${po.id}`,
    }
  })
}

/** A project's approved material request, one row per module holding a part of
 * it (the prototype's waitingOn): lines Inventory has not answered yet wait on
 * the store's authorisation; what is left to buy waits on Procurement. A line
 * issued from stock in full is on its way to us — ours to receive, nobody's wait. */
export function requestWaitRows(
  requests: Array<{ id: string; title: string; status: string; pm?: boolean; withdrawn?: boolean; rfqId?: string | null; rfqNumber?: string | null; poId?: string | null; mfgRequestId?: string | null; approvedOn?: string | null; day?: string | null; needBy?: string | null; lines: Array<Partial<ReqLine>> }>,
  projectId: string,
  today: string
): WaitRow[] {
  return requests
    .filter((r) => r.status === "approved" && !r.withdrawn && !r.poId && !r.mfgRequestId && r.lines.some((l) => !l.cl))
    .flatMap((r): WaitRow[] => {
      const age = ageOf(r.approvedOn ?? r.day, today)
      // Late when it has waited, or when the site needs it within three days (the prototype's need ≤ 3).
      const needSoon = Boolean(d10(r.needBy)) && daysBetween(today, d10(r.needBy)) <= WAIT_LATE_DAYS
      const late = age >= WAIT_LATE_DAYS || needSoon
      const open = r.lines.filter((l) => !l.cl)
      const atStore = r.pm ? open.filter((l) => awaitingReply({ pm: r.pm, status: "approved", withdrawn: r.withdrawn, poId: r.poId }, l as ReqLine)) : []
      const toBuy = r.pm ? open.filter((l) => !atStore.includes(l) && (l.inv?.k !== "issue" || (Number(l.inv.kept) || 0) > 0)) : open
      const out: WaitRow[] = []
      if (atStore.length)
        out.push({ id: `reqinv:${r.id}`, module: "inv", kind: "request_inv", params: { title: r.title }, sub: { kind: "request_items", params: { count: atStore.length } }, age, late, projectId, tab: "pmReq" })
      if (toBuy.length)
        out.push({
          id: `req:${r.id}`,
          module: "proc",
          kind: r.rfqId ? "request_rfq" : "request",
          params: { title: r.title, rfq: r.rfqNumber ?? "" },
          sub: { kind: "request_items", params: { count: toBuy.length } },
          age,
          late,
          projectId,
          tab: "pmReq",
        })
      return out
    })
}

/** Material the site sent back to a main warehouse that the keeper has not received
 * yet (prj:RET) — and non-conforming material going back to the supplier, which
 * Procurement claims. */
export function storeWaitRows(
  stores: Array<{ id: string; name: string; unit: string; moves: Array<{ t: string; st?: string | null; q: number; on: string; warehouseName?: string | null }> }>,
  projectId: string,
  today: string
): WaitRow[] {
  return stores.flatMap((x) =>
    x.moves
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => (m.t === "ret" || m.t === "sret") && m.st === "wait")
      .map(({ m, i }): WaitRow => {
        const age = ageOf(m.on, today)
        const ret = m.t === "ret"
        return {
          id: `${ret ? "inv" : "sret"}:${x.id}:${i}`,
          module: ret ? "inv" : "proc",
          kind: ret ? "store_return" : "store_sret",
          params: { name: x.name, q: m.q, unit: x.unit },
          sub: ret ? { kind: "store_return_to", params: { wh: m.warehouseName || "—" } } : { kind: "sret_claim", params: {} },
          age,
          late: age >= WAIT_LATE_DAYS,
          projectId,
          tab: "pmStore",
        }
      })
  )
}

/** Finance's side: a certified certificate not yet in the books (the tax invoice
 * waits on it), and retention a handover made claimable that Finance has not
 * released. Read from PM's outbox against the journal — Finance's own records. */
export function financeWaitRows(
  f: {
    events: Array<{ key: string; kind: string; projectId: string; amount: number; params: Record<string, string | number>; at: string }>
    /** Journal source ids already posted (`eventDocId(key)`). */
    posted: ReadonlySet<string>
    /** Projects whose retention Finance has released in full. */
    released: ReadonlySet<string>
    /** Certificates still collectable ("appr") by project and number — a paid one waits on nobody. */
    open?: ReadonlySet<string>
    /** Accounting is off: nothing is ever posted, so a row says Finance works outside the books,
     * and a certificate waits only while it is still collectable (`open`). */
    booksOff?: boolean
    today: string
  }
): WaitRow[] {
  const out: WaitRow[] = []
  for (const e of f.events) {
    const docId = e.key.replace(/\//g, "_")
    if (f.posted.has(docId)) continue
    const age = ageOf(e.at, f.today)
    if (e.kind === "IPC") {
      const seq = Number(e.params.certificate) || 0
      if (f.open && !f.open.has(`${e.projectId}:${seq}`)) continue
      out.push({ id: `fin:${docId}`, module: "fin", kind: "cert_invoice", params: { no: two(seq) }, sub: { kind: f.booksOff ? "books_off" : "sent_on", params: { date: d10(e.at) } }, amount: Number(e.params.net) || e.amount, age, late: age >= WAIT_LATE_DAYS, projectId: e.projectId, tab: "ipc" })
    } else if (e.kind === "HND" && e.amount > 0) {
      const stage = String(e.params.stage) === "final" ? "final" : "prov"
      if (stage === "final" && f.released.has(e.projectId)) continue
      out.push({ id: `fin:${docId}`, module: "fin", kind: "retention", params: { stage }, sub: { kind: f.booksOff ? "retention_books_off" : "retention_desk", params: {} }, amount: e.amount, age, late: age >= WAIT_LATE_DAYS, projectId: e.projectId, tab: "pmClose" })
    }
  }
  return out
}

export function crmWaitRows(handovers: Array<{ id: string; title: string; returned?: { missing: unknown[]; at: string } | null }>, today: string): WaitRow[] {
  return handovers.map((h): WaitRow => {
    const age = ageOf(h.returned?.at, today)
    return { id: `crm:${h.id}`, module: "crm", kind: "crm_returned", params: { title: h.title }, sub: { kind: "missing", params: { count: h.returned?.missing.length ?? 0 } }, age, late: age >= WAIT_LATE_DAYS, projectId: null, href: "/contractor/projects/inbox" }
  })
}

export interface WaitingView {
  total: number
  late: number
  shown: WaitRow[]
  byModule: Array<{ module: WaitModule; count: number }>
  /** The "show all" button: something on time is hidden, or more late rows than the cap. */
  more: boolean
}

export function waitingView(rows: WaitRow[], showAll: boolean, cap = WAIT_CAP): WaitingView {
  const sorted = rows.slice().sort((a, b) => Number(b.late) - Number(a.late) || b.age - a.age)
  const late = sorted.filter((r) => r.late)
  const byModule = new Map<WaitModule, number>()
  for (const r of rows) byModule.set(r.module, (byModule.get(r.module) ?? 0) + 1)
  return {
    total: rows.length,
    late: late.length,
    shown: showAll ? sorted : late.slice(0, cap),
    byModule: Array.from(byModule.entries()).map(([module, count]) => ({ module, count })),
    more: !showAll && (rows.length - late.length > 0 || late.length > cap),
  }
}

// ── Sections against their plan ──────────────────────────────────────────────

export interface SectionItem {
  id?: string
  division: string
  quantity: number
  rate: number
  executed: number
}

export interface SectionRow {
  division: string
  progress: number
  deviation: number
  value: number
  planned?: number
}

/** Each item's planned % today from the activities that schedule it (their mean). */
export function itemPlanFromActivities(activities: Array<{ from: string; to: string; itemIds: string[] }>, today: string): Map<string, number> {
  const acc = new Map<string, { s: number; n: number }>()
  for (const a of activities) {
    const f = Date.parse(`${d10(a.from)}T00:00:00Z`)
    const t = Date.parse(`${d10(a.to)}T00:00:00Z`)
    const now = Date.parse(`${today}T00:00:00Z`)
    const pc = t <= f ? (today >= d10(a.to) ? 100 : 0) : Math.min(100, Math.max(0, ((now - f) / (t - f)) * 100))
    for (const id of a.itemIds) {
      const cur = acc.get(id) ?? { s: 0, n: 0 }
      acc.set(id, { s: cur.s + pc, n: cur.n + 1 })
    }
  }
  return new Map(Array.from(acc.entries()).map(([id, v]) => [id, r1(v.s / v.n)]))
}

/** Every priced division against its planned progress, worst first (none when
 * nothing is planned yet). */
export function sectionRows(items: SectionItem[], planned: number | null, itemPlan?: ReadonlyMap<string, number>): SectionRow[] {
  if ((planned == null || planned <= 0) && !itemPlan?.size) return []
  const base = planned ?? 0
  const by = new Map<string, { c: number; e: number; p: number }>()
  for (const i of items) {
    if (!i.division || !(i.rate > 0) || !(i.quantity > 0)) continue
    const s = by.get(i.division) || { c: 0, e: 0, p: 0 }
    const v = i.quantity * i.rate
    s.c += v
    s.e += Math.min(i.executed, i.quantity) * i.rate
    s.p += v * (i.id && itemPlan?.has(i.id) ? (itemPlan.get(i.id) as number) : base)
    by.set(i.division, s)
  }
  return Array.from(by.entries())
    .map(([division, s]) => {
      const progress = r1((s.e / s.c) * 100)
      const plan = r1(s.p / s.c)
      return itemPlan?.size ? { division, progress, deviation: r1(progress - plan), value: s.c, planned: plan } : { division, progress, deviation: r1(progress - base), value: s.c }
    })
    .sort((a, b) => a.deviation - b.deviation || b.value - a.value)
}

/** The divisions furthest behind the planned progress, worst first. */
export function sectionsBehind(items: SectionItem[], planned: number | null, top = 4): SectionRow[] {
  return sectionRows(items, planned)
    .filter((s) => s.deviation < 0)
    .slice(0, top)
}

/** The Pulse's panel: the four divisions furthest from their plan — ahead ones
 * included when fewer are behind — only where something is planned by now. */
export function sectionDeviations(items: SectionItem[], planned: number | null, itemPlan?: ReadonlyMap<string, number>, top = 4): SectionRow[] {
  return sectionRows(items, planned, itemPlan)
    .filter((s) => (s.planned ?? planned ?? 0) > 0)
    .slice(0, top)
}

// ── The project log ──────────────────────────────────────────────────────────

export type LogKind =
  | "started"
  | "sheet"
  | "vo"
  | "claim_notice"
  | "claim_submitted"
  | "claim_answered"
  | "addendum_signed"
  | "cert"
  | "obstacle"
  | "ncr"
  | "prov"
  | "final"
  | "over_budget"

export type LogSub = "unit_cost" | "duration" | "defects" | "vo_status" | "cert_net" | "obs_open" | "obs_closed"

export interface LogEntry {
  day: string
  kind: LogKind
  tone: "ok" | "warn" | "bad" | "info"
  /** `value` and `net` are riyal amounts, 0 when not shown. */
  params: Record<string, string | number>
  sub?: { kind: LogSub; params: Record<string, string | number> }
}

export interface LogFacts {
  startedAt?: string | null
  location?: string | null
  durationDays?: number
  defectsDays?: number
  acceptances?: { prov?: { on: string } | null; final?: { on: string } | null } | null
  sheets: Array<{ seq: number; status: string; day: string }>
  variations: Array<{ seq: number; title: string; status: string; day: string; value: number; decision?: { on: string } | null }>
  claims: Array<{ seq: number; status: string; eventOn: string; noticeOn?: string | null; submittedOn?: string | null; response?: { on: string; days: number } | null }>
  addenda: Array<{ seq: number; status: string; signedOn?: string | null }>
  certificates: Array<{ seq: number; status: string; prepOn?: string | null; certOn?: string | null; collectedOn?: string | null; dueOn?: string | null; net?: number; certified?: number | null; gross?: number; collected?: number | null }>
  ncrs: Array<{ seq: number; status: string; day: string }>
  obstacles?: Array<{ type: string; seq: number; title: string; impact: string; openOn: string; closeOn?: string | null }>
  /** Lines whose actual cost runs past the budget of what they executed (cost roll-up). */
  overBudget?: Array<{ code: string; over: number; unitActual: number; unitBudget: number }>
  /** A member without money sees no certificate and no value. */
  money: boolean
  today?: string
}

export const LOG_TOP = 5
/** An item enters the log once it is this far over its budget. */
export const OVER_BUDGET_LOG = 25_000

export function projectLog(f: LogFacts, top = LOG_TOP): LogEntry[] {
  const out: LogEntry[] = []
  const today = f.today ?? ""
  const add = (day: string | null | undefined, kind: LogKind, tone: LogEntry["tone"], params: LogEntry["params"] = {}, sub?: LogEntry["sub"]) => {
    if (d10(day)) out.push({ day: d10(day), kind, tone, params, ...(sub ? { sub } : {}) })
  }
  add(f.startedAt, "started", "ok", { where: f.location ?? "" }, f.durationDays ? { kind: "duration", params: { days: f.durationDays } } : undefined)
  add(f.acceptances?.prov?.on, "prov", "ok", {}, f.defectsDays ? { kind: "defects", params: { days: f.defectsDays } } : undefined)
  add(f.acceptances?.final?.on, "final", "ok")
  for (const s of f.sheets) if (s.status === "ok") add(s.day, "sheet", "ok", { no: two(s.seq) })
  for (const v of f.variations) {
    const day = v.status === "appr" || v.status === "rej" ? (v.decision?.on ?? v.day) : v.day
    add(day, "vo", v.status === "appr" ? "ok" : v.status === "rej" ? "bad" : "warn", { no: two(v.seq), title: v.title, value: f.money ? v.value : 0 }, { kind: "vo_status", params: { status: v.status } })
  }
  for (const c of f.claims) {
    if (c.response) add(c.response.on, "claim_answered", "ok", { no: two(c.seq), days: c.response.days })
    else if (c.submittedOn) add(c.submittedOn, "claim_submitted", "warn", { no: two(c.seq) })
    else if (c.noticeOn) add(c.noticeOn, "claim_notice", "warn", { no: two(c.seq) })
  }
  for (const a of f.addenda) if (a.status === "signed") add(a.signedOn, "addendum_signed", "info", { no: two(a.seq) })
  if (f.money) {
    for (const c of f.certificates) {
      if (c.status === "void") continue
      const day = [c.prepOn, c.certOn, c.collectedOn].map(d10).filter(Boolean).sort().pop()
      const overdue = (c.status === "appr" || c.status === "part") && Boolean(c.dueOn) && d10(c.dueOn) < today
      add(day, "cert", c.status === "paid" ? "ok" : overdue ? "bad" : "info", { no: two(c.seq), value: c.certified ?? c.gross ?? 0 }, { kind: "cert_net", params: { net: c.net ?? 0, status: c.status } })
    }
  }
  for (const o of f.obstacles ?? []) {
    const sub: LogEntry["sub"] = o.closeOn ? { kind: "obs_closed", params: { days: daysBetween(o.openOn, o.closeOn) } } : { kind: "obs_open", params: { days: today ? daysBetween(o.openOn, today) : 0, impact: o.impact } }
    add(o.openOn, "obstacle", o.closeOn ? "ok" : "warn", { type: o.type, no: two(o.seq), title: o.title }, sub)
  }
  for (const n of f.ncrs) add(n.day, "ncr", n.status === "done" ? "ok" : "bad", { no: two(n.seq) })
  if (f.money && today)
    for (const b of f.overBudget ?? [])
      if (b.over > OVER_BUDGET_LOG)
        add(today, "over_budget", "bad", { code: b.code, value: b.over }, { kind: "unit_cost", params: { actual: b.unitActual, budget: b.unitBudget, pct: b.unitBudget > 0 ? Math.round((b.unitActual / b.unitBudget - 1) * 100) : 0 } })
  return out.sort((a, b) => b.day.localeCompare(a.day)).slice(0, top)
}
