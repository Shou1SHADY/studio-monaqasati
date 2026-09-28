// PM 1.0 — plant on site (PRD EQP-08…15, WF-14; the prototype's «المعدات في
// الموقع»). The plant register belongs to the plant desk; the project keeps
// what is ON ITS SITE: the handover note (meter · fuel · accessories ·
// condition · photos), a day log in five states, the off-hire request and the
// desk's confirmation, and the hand-back note. Charged on possession, not use:
//   any work in a day (or transit)      → a full day
//   idle/standby, no work within ±3 days → two-thirds (CPA clause 25)
//   idle/standby with work within ±3     → a full day
//   breakdown                            → nothing — it is the owner's
// Tools are custody, never day-rated. A request alone stops nothing: the
// charge runs until the desk confirms. A meter never runs backwards.
// Pure: no I/O.

import type { PmAttachment } from "./attachments"

/** `projects/{id}/pmPlant/{NN}`, numbered by the project's `pm.plantCount`. */
export const PM_PLANT = "pmPlant"

export const PLANT_CATEGORIES = ["tool", "light", "heavy", "lift"] as const
export type PlantCategory = (typeof PLANT_CATEGORIES)[number]
/** Heavy and lifting plant carry a meter, a licence and an operator. */
export const hasMeter = (c: PlantCategory) => c === "heavy" || c === "lift"

export const PLANT_OWNERSHIP = ["own", "hire"] as const
export type PlantOwnership = (typeof PLANT_OWNERSHIP)[number]

export const PLANT_DAY_STATES = ["work", "idle", "stby", "move", "down"] as const
export type PlantDayState = (typeof PLANT_DAY_STATES)[number]

export const PLANT_CONDITIONS = ["ok", "note", "bad"] as const
export type PlantCondition = (typeof PLANT_CONDITIONS)[number]

export const FUEL_LEVELS = ["full", "3/4", "1/2", "1/4"] as const

export const OFF_REASONS = ["done", "idle", "bad", "swap", "oth"] as const
export type OffReason = (typeof OFF_REASONS)[number]

/** Idle without work within ±3 days is charged at two-thirds. */
export const IDLE_SHARE = 2 / 3
export const IDLE_ALERT_DAYS = 5
export const LICENCE_WARN_DAYS = 30

export interface PlantNote {
  on: string
  meter?: number | null
  fuel?: string | null
  accessories?: string | null
  condition: PlantCondition
  remark?: string | null
  files?: PmAttachment[]
  by: string
  byName?: string | null
}

export interface PmPlant {
  id: string
  seq: number
  /** The unit's tag («م-114») and what it is. */
  tag: string
  name: string
  category: PlantCategory
  ownership: PlantOwnership
  supplier?: string | null
  qty: number
  /** Day rate — money; 0/absent = not rated (custody). */
  dayRate?: number | null
  from: string
  /** The planned return date. */
  to: string
  /** Operating licence expiry (heavy/lift), when known. */
  licenceTo?: string | null
  /** use = on site · req = off-hire requested · back = returned. */
  status: "use" | "req" | "back"
  handover: PlantNote
  /** Day log: date → state. */
  days: Record<string, PlantDayState>
  offReq?: { on: string; ready: string; why: OffReason; whyText?: string | null; by: string; byName?: string | null } | null
  offNo?: string | null
  offOk?: { on: string; by: string; byName?: string | null } | null
  back?: PlantNote | null
  by: string
  byName?: string | null
}

export const plantNo = (seq: number) => String(seq).padStart(2, "0")

const DAY_MS = 86_400_000
const dn = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / DAY_MS
const r2 = (n: number) => Math.round(n * 100) / 100

/** The day log, newest first. */
export const dayLog = (p: Pick<PmPlant, "days">) =>
  Object.entries(p.days ?? {})
    .map(([day, st]) => ({ day, st }))
    .sort((a, b) => b.day.localeCompare(a.day))

/** What one logged day charges the project. */
export function dayCost(p: Pick<PmPlant, "dayRate" | "category" | "days" | "qty">, day: string): number {
  const rate = p.category === "tool" ? 0 : Math.max(0, p.dayRate ?? 0) * Math.max(1, p.qty || 1)
  const st = p.days?.[day]
  if (!rate || !st || st === "down") return 0
  if (st === "work" || st === "move") return rate
  const worked = Object.entries(p.days).some(([d, s]) => s === "work" && Math.abs(dn(d) - dn(day)) <= 3)
  return worked ? rate : r2(rate * IDLE_SHARE)
}

export const plantCost = (p: Pick<PmPlant, "dayRate" | "category" | "days" | "qty">) => r2(Object.keys(p.days ?? {}).reduce((a, d) => a + dayCost(p, d), 0))

/** Days logged since it last worked (all logged days when it never worked). */
export function idleSince(p: Pick<PmPlant, "days">): number {
  const L = dayLog(p)
  const i = L.findIndex((x) => x.st === "work")
  return i < 0 ? L.length : i
}

/** Working days ÷ logged days, %; null with nothing logged. */
export function utilisation(p: Pick<PmPlant, "days">): number | null {
  const L = dayLog(p)
  return L.length ? Math.round((L.filter((x) => x.st === "work").length / L.length) * 100) : null
}

/** Days past its planned return (0 when not past). */
export const overdueDays = (p: Pick<PmPlant, "to" | "status">, today: string) => (p.status === "back" ? 0 : Math.max(0, Math.round(dn(today) - dn(p.to))))

/** The licence gate: expired blocks, within 30 days warns. */
export function licenceState(p: Pick<PmPlant, "licenceTo" | "category">, today: string): "none" | "ok" | "warn" | "expired" {
  if (!hasMeter(p.category) || !p.licenceTo) return "none"
  const left = Math.round(dn(p.licenceTo) - dn(today))
  return left < 0 ? "expired" : left <= LICENCE_WARN_DAYS ? "warn" : "ok"
}

export const onSite = <T extends Pick<PmPlant, "status">>(list: T[]) => list.filter((p) => p.status !== "back")

const DAY = /^\d{4}-\d{2}-\d{2}$/

export type HandoverBlock = "archived" | "no_name" | "bad_qty" | "bad_dates" | "no_meter" | "bad_rate" | "licence_expired" | "no_remark"

export function handoverBlocks(input: {
  archived: boolean
  name: string
  qty: number
  from: string
  to: string
  category: PlantCategory
  meter?: number | null
  dayRate?: number | null
  licenceTo?: string | null
  condition: PlantCondition
  remark?: string | null
  today: string
}): HandoverBlock[] {
  const out: HandoverBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.name.trim()) out.push("no_name")
  if (!(Number.isInteger(input.qty) && input.qty >= 1)) out.push("bad_qty")
  if (!DAY.test(input.from) || !DAY.test(input.to) || input.to < input.from || input.from > input.today) out.push("bad_dates")
  if (hasMeter(input.category) && !(typeof input.meter === "number" && Number.isFinite(input.meter) && input.meter >= 0)) out.push("no_meter")
  if (input.dayRate != null && !(Number.isFinite(input.dayRate) && input.dayRate >= 0)) out.push("bad_rate")
  if (licenceState({ category: input.category, licenceTo: input.licenceTo }, input.today) === "expired") out.push("licence_expired")
  if (input.condition !== "ok" && !input.remark?.trim()) out.push("no_remark")
  return out
}

export type DayBlock = "archived" | "returned" | "bad_day" | "no_state"

export function dayBlocks(input: { archived: boolean; status: PmPlant["status"]; day: string; from: string; today: string; st: unknown }): DayBlock[] {
  const out: DayBlock[] = []
  if (input.archived) out.push("archived")
  if (input.status === "back") out.push("returned")
  if (!DAY.test(input.day) || input.day > input.today || input.day < input.from) out.push("bad_day")
  if (!(PLANT_DAY_STATES as readonly unknown[]).includes(input.st)) out.push("no_state")
  return out
}

export type OffBlock = "archived" | "wrong_state" | "no_reason" | "bad_day"

export function offBlocks(input: { archived: boolean; status: PmPlant["status"]; why: OffReason | null; whyText?: string | null; ready: string; today: string }): OffBlock[] {
  const out: OffBlock[] = []
  if (input.archived) out.push("archived")
  if (input.status !== "use") out.push("wrong_state")
  if (!input.why || (input.why === "oth" && !input.whyText?.trim())) out.push("no_reason")
  if (!DAY.test(input.ready) || input.ready < input.today) out.push("bad_day")
  return out
}

export type BackBlock = "archived" | "not_confirmed" | "no_meter" | "meter_back" | "no_remark"

/** Handing back needs the desk's confirmation; the meter reading is not below the handover's. */
export function backBlocks(input: { archived: boolean; plant: Pick<PmPlant, "status" | "offOk" | "category" | "handover">; meter?: number | null; condition: PlantCondition; remark?: string | null }): BackBlock[] {
  const out: BackBlock[] = []
  if (input.archived) out.push("archived")
  if (input.plant.status !== "req" || !input.plant.offOk) out.push("not_confirmed")
  if (hasMeter(input.plant.category)) {
    if (!(typeof input.meter === "number" && Number.isFinite(input.meter))) out.push("no_meter")
    else if (input.plant.handover.meter != null && input.meter < input.plant.handover.meter) out.push("meter_back")
  }
  if (input.condition !== "ok" && !input.remark?.trim()) out.push("no_remark")
  return out
}
