// The equipment desk (Warehouses → equipment desk): the approved equipment
// requests of every project of the company, waiting for the store keeper's
// answer — allocate a unit of the fleet, busy until a date, an alternative, or
// not in the fleet. Until this desk existed the site typed the desk's answer
// itself. Pure: no I/O.

import { daysBetween, plantReplyBlocks, type PlantReplyBlock, type PlantReplyKind, type PmPlantRequest } from "./supply"

export interface DeskRequest extends PmPlantRequest {
  projectId: string
  projectName: string
  projectNo: string | null
}

/** Waiting for the desk: approved, not answered, not yet received on site. */
export const withDesk = (r: Pick<PmPlantRequest, "status" | "rep" | "got">): boolean => r.status === "go" && !r.rep && !r.got

/** The earliest need-by date first — the request that must be answered soonest — then project and number. */
export function deskQueue(rows: DeskRequest[]): DeskRequest[] {
  return rows
    .filter(withDesk)
    .sort((a, b) => a.from.localeCompare(b.from) || a.projectName.localeCompare(b.projectName) || a.seq - b.seq)
}

/** The desk's recent answers, newest first. */
export function deskAnswered(rows: DeskRequest[], limit = 20): DeskRequest[] {
  return rows
    .filter((r) => r.status === "go" && r.rep != null)
    .sort((a, b) => (b.rep?.on ?? "").localeCompare(a.rep?.on ?? "") || b.seq - a.seq)
    .slice(0, limit)
}

/** Days from today until the equipment is needed; negative once the need-by date has passed. */
export const daysToNeed = (r: Pick<PmPlantRequest, "from">, today: string): number => daysBetween(today, r.from)

export type DeskUrgency = "late" | "soon" | "later"

/** `late`: needed already, still unanswered · `soon`: needed within three days. */
export function deskUrgency(r: Pick<PmPlantRequest, "from">, today: string): DeskUrgency {
  const d = daysToNeed(r, today)
  return d < 0 ? "late" : d <= 3 ? "soon" : "later"
}

export interface DeskSummary {
  waiting: number
  late: number
  soon: number
}

export function deskSummary(rows: DeskRequest[], today: string): DeskSummary {
  const queue = deskQueue(rows)
  return {
    waiting: queue.length,
    late: queue.filter((r) => deskUrgency(r, today) === "late").length,
    soon: queue.filter((r) => deskUrgency(r, today) === "soon").length,
  }
}

export type DeskBlock = PlantReplyBlock

/** Answering: once, on an approved request nobody answered yet, in a project that is still open. */
export function deskReplyBlocks(input: {
  projectClosed: boolean
  r: Pick<PmPlantRequest, "status" | "rep">
  k: PlantReplyKind | null
  unit?: string | null
  free?: string | null
  text?: string | null
  on: string
  today: string
}): DeskBlock[] {
  return plantReplyBlocks({ archived: input.projectClosed, r: input.r, k: input.k, unit: input.unit, free: input.free, text: input.text, on: input.on, today: input.today })
}
