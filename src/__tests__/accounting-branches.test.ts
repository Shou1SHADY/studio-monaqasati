/**
 * Financials by branch (customer review, 27 Sep 2026) — the per-project switch
 * became per region/branch. A line belongs to a branch by its own `branch`,
 * else through its project; a line with neither is "not assigned", never
 * spread by guesswork. Off by default; removing a branch releases its projects.
 */

import { ACC } from "@/lib/accounting/accounts"
import { periodWindows } from "@/lib/accounting/balances"
import {
  branchOfLine,
  branchProfitability,
  lineInBranch,
  normalizeBranches,
  normalizeProjectBranches,
  UNASSIGNED_BRANCH,
} from "@/lib/accounting/branches"
import { buildEntry, type JournalEntry, type JournalLine } from "@/lib/accounting/journal"
import { normalizeAccountingSettings } from "@/lib/accounting/settings"
import { netProfit } from "@/lib/accounting/statements"

let seq = 0
function entry(date: string, lines: Array<Partial<JournalLine> & { account: string }>): JournalEntry {
  seq += 1
  const built = buildEntry({
    organizationId: "org1",
    date,
    kind: "auto",
    sourceType: "manual_voucher",
    sourceId: `v${seq}`,
    description: `entry ${seq}`,
    lines,
    entryNumber: seq,
    userId: "u1",
    userName: "Tester",
  })
  return { id: `e${seq}`, ...built }
}

const RUH = { id: "ruh", name: "Riyadh office" }
const JED = { id: "jed", name: "Jeddah office" }
const MAP = { tower: "ruh", mall: "jed" }

const ENTRIES = [
  // Riyadh project: revenue 10,000, cost 6,000
  entry("2026-03-05", [
    { account: ACC.clientsReceivable, debit: 10_000, project: "tower" },
    { account: ACC.sundryIncome, credit: 10_000, project: "tower" },
  ]),
  entry("2026-03-06", [
    { account: ACC.costMaterials, debit: 6_000, project: "tower" },
    { account: ACC.bankMain, credit: 6_000 },
  ]),
  // Jeddah project: revenue 4,000
  entry("2026-04-01", [
    { account: ACC.clientsReceivable, debit: 4_000, project: "mall" },
    { account: ACC.sundryIncome, credit: 4_000, project: "mall" },
  ]),
  // A line tagged with its branch directly, no project
  entry("2026-04-02", [
    { account: ACC.costMaterials, debit: 500, branch: "jed" },
    { account: ACC.bankMain, credit: 500 },
  ]),
  // Head-office overhead: no project, no branch
  entry("2026-04-03", [
    { account: ACC.costMaterials, debit: 1_000 },
    { account: ACC.bankMain, credit: 1_000 },
  ]),
]

describe("which branch a line reports under", () => {
  it("its own branch first, then its project's; otherwise none", () => {
    expect(branchOfLine({ branch: "jed", project: "tower" }, MAP)).toBe("jed")
    expect(branchOfLine({ project: "tower" }, MAP)).toBe("ruh")
    expect(branchOfLine({ project: "villa" }, MAP)).toBeNull()
    expect(branchOfLine({}, MAP)).toBeNull()
    expect(lineInBranch({}, UNASSIGNED_BRANCH, MAP)).toBe(true)
    expect(lineInBranch({ project: "tower" }, UNASSIGNED_BRANCH, MAP)).toBe(false)
  })

  it("filters the statements by branch through the project map", () => {
    const ruh = periodWindows(ENTRIES, "2026-01-01", "2026-12-31", { branch: "ruh", projectBranches: MAP })
    expect(netProfit(ruh.movement)).toBe(4_000)
    const jed = periodWindows(ENTRIES, "2026-01-01", "2026-12-31", { branch: "jed", projectBranches: MAP })
    expect(netProfit(jed.movement)).toBe(3_500)
    const none = periodWindows(ENTRIES, "2026-01-01", "2026-12-31", { branch: UNASSIGNED_BRANCH, projectBranches: MAP })
    expect(netProfit(none.movement)).toBe(-1_000)
  })

  it("results by branch: every named branch, then what belongs to none", () => {
    const rows = branchProfitability(ENTRIES, "2026-01-01", "2026-12-31", [RUH, JED, { id: "dmm", name: "Dammam office" }], MAP)
    expect(rows.map((r) => [r.branch, r.revenue, r.cost, r.profit])).toEqual([
      ["ruh", 10_000, 6_000, 4_000],
      ["jed", 4_000, 500, 3_500],
      ["dmm", 0, 0, 0],
      [UNASSIGNED_BRANCH, 0, 1_000, -1_000],
    ])
    expect(rows[0].margin).toBe(40)
    expect(rows[2].margin).toBeNull()
  })
})

describe("the settings", () => {
  it("off by default, with no branches", () => {
    expect(normalizeAccountingSettings(null)).toMatchObject({ branchReports: false, branches: [], projectBranches: {} })
  })

  it("keeps named, unique branches; a removed branch releases its projects", () => {
    expect(normalizeBranches([RUH, { id: "x", name: "  " }, { id: "ruh", name: "dup" }, { id: UNASSIGNED_BRANCH, name: "bad" }])).toEqual([RUH])
    expect(normalizeProjectBranches({ tower: "ruh", mall: "jed" }, [RUH])).toEqual({ tower: "ruh" })
    const s = normalizeAccountingSettings({ branchReports: true, branches: [RUH, JED], projectBranches: { tower: "ruh", mall: "gone" } } as never)
    expect(s).toMatchObject({ branchReports: true, projectBranches: { tower: "ruh" } })
  })
})
