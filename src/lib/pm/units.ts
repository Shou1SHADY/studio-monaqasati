// PM 1.0 — delivery units (the prototype's وحدات التسليم, section `zone`). On a
// project of several villas, floors or sites one progress figure is a
// comfortable lie: 43% may be one unit about to hand over and another not
// built. The BOQ stays one; what is split is each line's quantity and its
// executed. Execution reaches a unit only through an approved measurement that
// names it — work done before the split, or measured without a unit, stays
// visibly "not attributed" and is never guessed. Lines no unit holds are
// "project-wide works". A unit hands over when its work is complete and it has
// no open punch item or open/failed inspection; that releases half its share
// of the retention to Finance (prj:HND:<project>:U<no>:prov). Pure: no I/O.

import type { PmEvent } from "./events"
import type { ContractTerms } from "./terms"

/** `projects/{id}/pmUnits/{NN}` — created together, once, when the section is set up. */
export const PM_UNITS = "pmUnits"

export const UNITS_MIN = 2
export const UNITS_MAX = 40

/** A unit is ready at this progress (the prototype's 99.5). */
export const UNIT_DONE_AT = 99.5

export interface UnitLine {
  /** The unit's share of the line's contract quantity. */
  q: number
  /** Executed on this unit — moved only by an approved measurement naming it. */
  ex: number
}

export interface UnitHandover {
  on: string
  by: string
  byName?: string | null
}

export interface PmUnit {
  id: string
  seq: number
  name: string
  /** Planned handover day, `YYYY-MM-DD`. */
  plan: string | null
  ho: UnitHandover | null
  /** BOQ item id → the unit's share. */
  lines: Record<string, UnitLine>
}

export interface UnitItem {
  id: string
  quantity: number
  rate: number
  executed: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const DAY_MS = 86_400_000
const days = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY_MS)

export const unitNo = (seq: number) => String(seq).padStart(2, "0")

/** The equal split the setup makes: every line with a quantity is shared evenly;
 * nothing executed is attributed — it stays "not attributed" until measured. */
export function splitEqually(items: Array<Pick<UnitItem, "id" | "quantity">>, count: number, label: string): Array<Omit<PmUnit, "id">> {
  const n = Math.max(UNITS_MIN, Math.min(UNITS_MAX, Math.floor(count)))
  const name = label.trim()
  return Array.from({ length: n }, (_, i) => {
    const lines: Record<string, UnitLine> = {}
    for (const it of items) if (it.quantity > 0) lines[it.id] = { q: r2(it.quantity / n), ex: 0 }
    return { seq: i + 1, name: `${name} ${i + 1}`, plan: null, ho: null, lines }
  })
}

export interface UnitFigures {
  /** Σ share × rate. */
  contract: number
  /** Σ executed × rate. */
  earned: number
  /** earned / contract, 0 without a contract share. */
  progress: number
  /** Lines the unit holds a share of. */
  lines: number
}

export function unitFigures(unit: Pick<PmUnit, "lines">, items: Array<Pick<UnitItem, "id" | "rate">>): UnitFigures {
  let contract = 0
  let earned = 0
  let lines = 0
  for (const it of items) {
    const l = unit.lines[it.id]
    if (!l || !(l.q > 0)) continue
    lines += 1
    const rate = it.rate > 0 ? it.rate : 0
    contract += l.q * rate
    earned += l.ex * rate
  }
  return { contract: r2(contract), earned: r2(earned), progress: contract > 0 ? (earned / contract) * 100 : 0, lines }
}

/** Lines no unit holds a share of — they stay on the project. */
export const commonItems = <T extends Pick<UnitItem, "id">>(units: Array<Pick<PmUnit, "lines">>, items: T[]): T[] => items.filter((it) => !units.some((u) => (u.lines[it.id]?.q ?? 0) > 0))

/** Executed on allocated lines but on no unit — stated, never split by guesswork. */
export function unattributed(units: Array<Pick<PmUnit, "lines">>, items: UnitItem[]): number {
  return r2(
    items.reduce((a, it) => {
      const shares = units.map((u) => u.lines[it.id]).filter((l): l is UnitLine => Boolean(l))
      if (!shares.length) return a
      const onUnits = shares.reduce((t, l) => t + l.ex, 0)
      return a + Math.max(0, it.executed - onUnits) * (it.rate > 0 ? it.rate : 0)
    }, 0)
  )
}

export type UnitBlockKey = "no_alloc" | "progress" | "punch" | "wir"
export interface UnitBlock {
  key: UnitBlockKey
  n?: number
  pct?: number
}

/** What stops a unit's handover — computed facts, not reminders. */
export function unitBlocks(unit: Pick<PmUnit, "id" | "lines">, items: Array<Pick<UnitItem, "id" | "rate">>, open: { punch: Array<{ unit?: string | null }>; inspections: Array<{ unit?: string | null }> }): UnitBlock[] {
  const f = unitFigures(unit, items)
  if (f.contract <= 0) return [{ key: "no_alloc" }]
  const out: UnitBlock[] = []
  if (f.progress < UNIT_DONE_AT) out.push({ key: "progress", pct: Math.round(f.progress * 100) / 100 })
  const punch = open.punch.filter((p) => p.unit === unit.id).length
  if (punch) out.push({ key: "punch", n: punch })
  const wir = open.inspections.filter((w) => w.unit === unit.id).length
  if (wir) out.push({ key: "wir", n: wir })
  return out
}

export const unitDone = (unit: Pick<PmUnit, "ho">) => unit.ho != null

/** Half the unit's share of the retention is released at its handover; the rest after the defects year. */
export const unitRetention = (contract: number, terms: Pick<ContractTerms, "retention" | "retentionCap">) => r2(contract * Math.min(terms.retention, terms.retentionCap) * 0.5)

/** Progress a week the unit needs from today to meet its planned day; null without one. */
export function unitNeed(progress: number, plan: string | null, today: string): number | null {
  if (!plan) return null
  const left = days(today, plan)
  return left > 0 ? (100 - progress) / (left / 7) : Infinity
}

/** Progress a week the unit itself has achieved since the project started. */
export function unitRate(progress: number, startedOn: string | null, today: string): number {
  if (!startedOn) return 0
  const el = days(startedOn, today)
  return el > 0 ? progress / (el / 7) : 0
}

/** Its date is unrealistic when it must run faster than it ever has. */
export function unitTight(unit: Pick<PmUnit, "ho" | "plan">, f: Pick<UnitFigures, "contract" | "progress">, startedOn: string | null, today: string): boolean {
  if (unitDone(unit) || !unit.plan || f.contract <= 0) return false
  const need = unitNeed(f.progress, unit.plan, today) ?? 0
  return need > Math.max(unitRate(f.progress, startedOn, today), 0.01) * 1.02
}

export type UnitState = "done" | "ready" | "risk" | "work"

export function unitState(unit: Pick<PmUnit, "ho" | "plan">, blocks: UnitBlock[], tight: boolean): UnitState {
  if (unitDone(unit)) return "done"
  if (!blocks.length) return "ready"
  return tight ? "risk" : "work"
}

/** An approved measurement naming units: each unit's executed moves by what the
 * line actually moved, capped at the unit's share. Returns unit id → changed lines. */
export function attributeToUnits(units: Array<Pick<PmUnit, "id" | "lines" | "ho">>, lines: Array<{ itemId: string; unit?: string | null; approved?: number | null }>): Record<string, Record<string, UnitLine>> {
  const out: Record<string, Record<string, UnitLine>> = {}
  for (const l of lines) {
    const got = l.approved ?? 0
    if (!l.unit || !(got > 0)) continue
    const u = units.find((x) => x.id === l.unit)
    const share = u?.lines[l.itemId]
    if (!u || !share || unitDone(u)) continue
    const cur = out[u.id]?.[l.itemId] ?? share
    out[u.id] = { ...(out[u.id] ?? {}), [l.itemId]: { q: cur.q, ex: r2(Math.min(cur.q, cur.ex + got)) } }
  }
  return out
}

/** prj:HND:<project>:U<no>:prov — the unit's provisional handover, with the retention it makes claimable. */
export function unitHandoverEvent(input: { organizationId: string; projectId: string; projectNo: string; unit: Pick<PmUnit, "seq" | "name">; on: string; claimable: number; by: string; at: string }): PmEvent {
  return {
    key: `prj:HND:${input.projectNo}:U${unitNo(input.unit.seq)}:prov`,
    kind: "HND",
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectNo: input.projectNo,
    amount: input.claimable,
    params: { stage: "unit", unit: input.unit.name, on: input.on },
    by: input.by,
    at: input.at,
  }
}
