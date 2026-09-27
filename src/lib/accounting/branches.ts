// Financials by branch (customer review, 27 Sep 2026): the per-project
// financials switch became per region/branch — "Riyadh office", "Jeddah
// office" instead of project names. Still a customisation, off by default.
//
// The org names its branches in Accounting settings and places each project
// in one. A journal line belongs to a branch by its own `branch` when a posting
// sets one, otherwise through its project; a line with neither (head-office
// overheads, most manual vouchers) is "not assigned to a branch" — shown as
// such, never spread across branches by guesswork. Pure: no I/O.

import { round2, type JournalEntry, type JournalLine } from "./journal"

export interface Branch {
  id: string
  name: string
}

/** The filter value for lines that belong to no branch. */
export const UNASSIGNED_BRANCH = "__none__"

/** project id → branch id. */
export type ProjectBranches = Record<string, string>

/** The branch a line reports under, or null. */
export function branchOfLine(line: Pick<JournalLine, "branch" | "project">, projectBranches: ProjectBranches | null | undefined): string | null {
  if (line.branch) return line.branch
  return (line.project && projectBranches?.[line.project]) || null
}

/** Does the line pass a branch filter (a branch id, or UNASSIGNED_BRANCH)? */
export function lineInBranch(line: Pick<JournalLine, "branch" | "project">, branch: string, projectBranches: ProjectBranches | null | undefined): boolean {
  const b = branchOfLine(line, projectBranches)
  return branch === UNASSIGNED_BRANCH ? b === null : b === branch
}

/** Named branches only, names trimmed, ids unique. */
export function normalizeBranches(raw: unknown): Branch[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Branch[] = []
  for (const b of raw) {
    const id = typeof b?.id === "string" ? b.id.trim() : ""
    const name = typeof b?.name === "string" ? b.name.trim() : ""
    if (!id || !name || id === UNASSIGNED_BRANCH || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name })
  }
  return out
}

/** Only placements into a branch that exists survive — a removed branch
 * releases its projects to "not assigned". */
export function normalizeProjectBranches(raw: unknown, branches: Branch[]): ProjectBranches {
  if (!raw || typeof raw !== "object") return {}
  const ids = new Set(branches.map((b) => b.id))
  const out: ProjectBranches = {}
  for (const [project, branch] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof branch === "string" && ids.has(branch)) out[project] = branch
  }
  return out
}

export const newBranchId = () => `br_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export interface BranchResult {
  /** A branch id, or UNASSIGNED_BRANCH. */
  branch: string
  revenue: number
  cost: number
  profit: number
  /** Percent of revenue; null without revenue. */
  margin: number | null
}

/** Revenue, cost and profit per branch in the period — every named branch
 * (even at zero), then what belongs to none when there is any. */
export function branchProfitability(entries: JournalEntry[], from: string, to: string, branches: Branch[], projectBranches: ProjectBranches): BranchResult[] {
  const acc = new Map<string, { revenue: number; cost: number }>()
  for (const b of branches) acc.set(b.id, { revenue: 0, cost: 0 })
  for (const entry of entries) {
    if (entry.status !== "posted" || entry.date < from || entry.date > to) continue
    for (const line of entry.lines) {
      const type = line.account[0]
      if (type !== "4" && type !== "5") continue
      const key = branchOfLine(line, projectBranches) ?? UNASSIGNED_BRANCH
      const r = acc.get(key) ?? { revenue: 0, cost: 0 }
      if (type === "4") r.revenue += line.credit - line.debit
      else r.cost += line.debit - line.credit
      acc.set(key, r)
    }
  }
  const rows: BranchResult[] = []
  for (const [branch, r] of acc) {
    const revenue = round2(r.revenue)
    const cost = round2(r.cost)
    if (branch === UNASSIGNED_BRANCH && revenue === 0 && cost === 0) continue
    const profit = round2(revenue - cost)
    rows.push({ branch, revenue, cost, profit, margin: revenue > 0.005 ? Math.round((profit / revenue) * 1000) / 10 : null })
  }
  const order = (b: string) => (b === UNASSIGNED_BRANCH ? 1 : 0)
  return rows.sort((a, b) => order(a.branch) - order(b.branch) || b.revenue - a.revenue)
}
