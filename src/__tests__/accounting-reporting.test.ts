/**
 * Accounting reporting layer — fiscal periods, display scale, expandable
 * statements, management analytics, manual vouchers and settlements.
 *
 * Built on one small company whose every figure is computed by hand below, so
 * a regression shows up as a wrong number rather than a changed snapshot.
 */

import { ACC } from "@/lib/accounting/accounts"
import { buildEntry, type JournalEntry, type JournalLine } from "@/lib/accounting/journal"
import { periodWindows } from "@/lib/accounting/balances"
import { balanceSheet, cashFlowStatement, incomeStatement } from "@/lib/accounting/statements"
import {
  customPeriod,
  elapsedDays,
  fiscalMonths,
  fiscalPeriodOptions,
  fiscalYearChoices,
  fiscalYearLabel,
  fiscalYearOf,
  fiscalYearRange,
  normalizeStartMonth,
  resolvePeriod,
} from "@/lib/accounting/periods"
import { formatMoney, formatMoneyCompact } from "@/lib/accounting/display"
import {
  accountBreakdown,
  balanceSheetTree,
  cashFlowTree,
  defaultExpandedIds,
  expandableIds,
  incomeStatementTree,
  type TreeNode,
} from "@/lib/accounting/statement-tree"
import {
  accountStatement,
  agingReport,
  auditTrail,
  cashConversionCycle,
  expenseBreakdown,
  ledgerParties,
  liquidity,
  monthlyTrend,
  openBalancesByParty,
  projectProfitability,
} from "@/lib/accounting/analytics"
import { validateManualEntry } from "@/lib/accounting/manual-entry"
import { settlementLines, suggestedSettlementAmount } from "@/lib/accounting/settlements"
import { normalizeAccountingSettings } from "@/lib/accounting/settings"

// ─────────────────────────────────────────────────────────────────────────────
// Fixture: one calendar year of a small contractor
// ─────────────────────────────────────────────────────────────────────────────

let seq = 0
function entry(
  date: string,
  lines: Array<Partial<JournalLine> & { account: string }>,
  extra: Partial<JournalEntry> = {}
): JournalEntry {
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
    defaultCostCenter: "C3",
  })
  return { id: `e${seq}`, ...built, ...extra }
}

const C1 = { party: "c1", partyName: "Client One" }
const S1 = { party: "s1", partyName: "Supplier One" }

const ENTRIES: JournalEntry[] = [
  entry("2026-01-01", [
    { account: ACC.bankMain, debit: 100_000 },
    { account: ACC.paidInCapital, credit: 100_000 },
  ]),
  entry("2026-02-10", [
    { account: ACC.inventoryMaterials, debit: 30_000 },
    { ...S1, account: ACC.suppliersPayable, credit: 30_000 },
  ]),
  entry("2026-03-05", [
    { ...C1, account: ACC.clientsReceivable, debit: 11_500, project: "p1", projectName: "Tower" },
    { ...C1, account: ACC.sundryIncome, credit: 10_000, project: "p1", projectName: "Tower" },
    { ...C1, account: ACC.vatOutput, credit: 1_500 },
  ]),
  entry("2026-03-06", [
    { account: ACC.costMaterials, debit: 6_000, project: "p1", projectName: "Tower" },
    { account: ACC.inventoryMaterials, credit: 6_000 },
  ]),
  entry("2026-04-15", [
    { account: ACC.bankMain, debit: 5_000 },
    { ...C1, account: ACC.clientsReceivable, credit: 5_000 },
  ]),
  entry("2026-05-20", [
    { ...S1, account: ACC.suppliersPayable, debit: 10_000 },
    { account: ACC.bankMain, credit: 10_000 },
  ]),
  entry(
    "2026-06-30",
    [
      { account: ACC.rentAndUtilities, debit: 2_000 },
      { account: ACC.bankMain, credit: 2_000 },
    ],
    { kind: "manual", createdAt: "2026-09-01T10:00:00.000Z" }
  ),
  entry("2026-07-10", [
    { account: ACC.plantAndMachinery, debit: 20_000 },
    { account: ACC.bankMain, credit: 20_000 },
  ]),
  // A draft is a proposal — nothing below may count it.
  entry(
    "2026-07-11",
    [
      { account: ACC.marketing, debit: 99_999 },
      { account: ACC.bankMain, credit: 99_999 },
    ],
    { status: "draft" }
  ),
]

const YEAR = periodWindows(ENTRIES, "2026-01-01", "2026-12-31")

// ─────────────────────────────────────────────────────────────────────────────
// Fiscal periods
// ─────────────────────────────────────────────────────────────────────────────

describe("fiscal periods", () => {
  it("names a fiscal year by the calendar year it opens in", () => {
    expect(fiscalYearOf("2026-04-01", 4)).toBe(2026)
    expect(fiscalYearOf("2027-03-31", 4)).toBe(2026)
    expect(fiscalYearOf("2026-03-31", 4)).toBe(2025)
    expect(fiscalYearOf("2026-12-31", 1)).toBe(2026)
    expect(fiscalYearRange(2026, 4)).toEqual({ from: "2026-04-01", to: "2027-03-31" })
    expect(fiscalYearLabel(2026, 4)).toBe("2026/27")
    expect(fiscalYearLabel(2026, 1)).toBe("2026")
  })

  it("computes Q1, H1 and the months from the company's start month", () => {
    const opts = fiscalPeriodOptions({ fiscalYear: 2026, startMonth: 4, today: "2026-09-13" })
    const byKey = Object.fromEntries(opts.map((o) => [o.key, o]))
    expect(byKey.Q1).toMatchObject({ from: "2026-04-01", to: "2026-06-30" })
    expect(byKey.Q4).toMatchObject({ from: "2027-01-01", to: "2027-03-31" })
    expect(byKey.H1).toMatchObject({ from: "2026-04-01", to: "2026-09-30" })
    expect(byKey.H2).toMatchObject({ from: "2026-10-01", to: "2027-03-31" })
    expect(byKey.M01).toMatchObject({ from: "2026-04-01", to: "2026-04-30" })
    expect(byKey.M11).toMatchObject({ from: "2027-02-01", to: "2027-02-28" })
    expect(byKey.YTD).toMatchObject({ from: "2026-04-01", to: "2026-09-13" })
    expect(byKey.Q1.labelAr).toContain("الربع الأول")
    expect(byKey.Q1.labelEn).toBe("Q1 2026/27 (Apr – Jun 2026)")
  })

  it("keeps the calendar quarters for a January year", () => {
    const opts = fiscalPeriodOptions({ fiscalYear: 2026, startMonth: 1, today: "2027-02-01" })
    expect(opts.find((o) => o.key === "Q1")).toMatchObject({ from: "2026-01-01", to: "2026-03-31" })
    // A past year's year-to-date is the whole year.
    expect(opts.find((o) => o.key === "YTD")).toMatchObject({ to: "2026-12-31" })
    expect(fiscalMonths(2026, 1)).toHaveLength(12)
  })

  it("resolves custom ranges and falls back from anything stale", () => {
    expect(resolvePeriod({ key: "CUSTOM", fiscalYear: null, customFrom: "2026-05-01", customTo: "2026-05-15" }, 1)).toMatchObject({
      kind: "custom",
      from: "2026-05-01",
      to: "2026-05-15",
    })
    expect(customPeriod("2026-06-10", "2026-06-01")).toMatchObject({ from: "2026-06-01", to: "2026-06-10" })
    const stale = resolvePeriod({ key: "CUSTOM", fiscalYear: 2026, customFrom: "bad", customTo: "" }, 1, "2026-09-13")
    expect(stale.key).toBe("FY")
    expect(resolvePeriod({ key: "NOPE", fiscalYear: 2025, customFrom: "", customTo: "" }, 7)).toMatchObject({ key: "FY", from: "2025-07-01" })
    expect(normalizeStartMonth(13)).toBe(1)
  })

  it("offers every fiscal year that has entries, newest first", () => {
    expect(fiscalYearChoices(["2024-02-01", "2026-01-01", "junk"], 1, "2026-09-13")).toEqual([2026, 2025, 2024])
  })

  it("measures elapsed days, capped at today", () => {
    expect(elapsedDays("2026-01-01", "2026-12-31", "2027-01-05")).toBe(365)
    expect(elapsedDays("2026-01-01", "2026-12-31", "2026-01-10")).toBe(10)
  })
})

describe("display scale", () => {
  it("formats as reported, in thousands and in millions", () => {
    expect(formatMoney(1_234_567.891, "units")).toBe("1,234,567.89")
    expect(formatMoney(1_234_567.891, "thousands")).toBe("1,234.6")
    expect(formatMoney(1_234_567.891, "millions")).toBe("1.23")
    expect(formatMoney(-0.01, "thousands")).toBe("0.0")
    expect(formatMoneyCompact(2_500_000, "millions")).toBe("2.50M")
    expect(formatMoneyCompact(2_500.4, "units")).toBe("2,500")
  })

  it("normalizes settings", () => {
    expect(normalizeAccountingSettings({ fiscalYearStartMonth: 4, displayScale: "millions", enabled: true })).toEqual({
      enabled: true,
      fiscalYearStartMonth: 4,
      displayScale: "millions",
      projectReports: false,
      customerTermDays: 30,
      supplierTermDays: 30,
      whtRates: {},
    })
    expect(normalizeAccountingSettings(null)).toEqual({
      enabled: false,
      fiscalYearStartMonth: 1,
      displayScale: "units",
      projectReports: false,
      customerTermDays: 30,
      supplierTermDays: 30,
      whtRates: {},
    })
    // Bad values fall back rather than reaching a report.
    const odd = normalizeAccountingSettings({ customerTermDays: -4, supplierTermDays: 45, whtRates: { rent: 0.05, bad: 7 } } as never)
    expect(odd.customerTermDays).toBe(30)
    expect(odd.supplierTermDays).toBe(45)
    expect(odd.whtRates).toEqual({ rent: 0.05 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Expandable statements
// ─────────────────────────────────────────────────────────────────────────────

function find(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = n.children && find(n.children, id)
    if (hit) return hit
  }
  return undefined
}

const childSum = (n: TreeNode) => Math.round((n.children || []).reduce((s, c) => s + (c.value || 0), 0) * 100) / 100

describe("statement trees", () => {
  it("income statement: figures match the flat statement and lines open into accounts", () => {
    const { nodes } = incomeStatementTree(YEAR.movement)
    const flat = incomeStatement(YEAR.movement)
    const revenue = nodes.find((n) => n.kind === "group" && n.labelEn === "Revenue")!
    expect(revenue.value).toBe(flat.totals.revenue)
    expect(revenue.value).toBe(10_000)
    const other = revenue.children!.find((c) => c.labelEn === "Other income")!
    expect(other.children!.map((c) => [c.accountCode, c.value])).toEqual([[ACC.sundryIncome, 10_000]])
    const net = nodes.find((n) => n.id === "is:netProfit")!
    expect(net.value).toBe(2_000)
    expect(net.codes).toEqual(["4", "5"])
  })

  it("balance sheet: every line's accounts sum to the line, sections to the totals", () => {
    const { nodes, statement } = balanceSheetTree(YEAR.closing)
    expect(find(nodes, "bs:assets")!.value).toBe(statement.totalAssets)
    const inventory = find(nodes, "bs:1104")!
    expect(inventory.value).toBe(24_000)
    expect(inventory.children!.map((c) => c.accountCode)).toEqual([ACC.inventoryMaterials])
    const cash = find(nodes, "bs:1101")!
    expect(childSum(cash)).toBe(cash.value)
    const current = find(nodes, "bs:ca")!
    expect(childSum(current)).toBe(current.value)
    // A leaf row is its own account — nothing to expand, but it carries its number.
    const receivable = find(nodes, `bs:${ACC.clientsReceivable}`)!
    expect(receivable).toMatchObject({ kind: "account", accountCode: ACC.clientsReceivable, value: 6_500 })
    expect(balanceSheet(YEAR.closing).difference).toBe(0)
    const result = find(nodes, "bs:eq:result")!
    expect(childSum(result)).toBe(result.value)
  })

  it("cash flow: account effects reconcile to each activity", () => {
    const { nodes, statement } = cashFlowTree(YEAR)
    const flat = cashFlowStatement(YEAR)
    expect(statement.difference).toBe(0)
    expect(find(nodes, "cf:operating")!.value).toBe(flat.operating)
    expect(childSum(find(nodes, "cf:operating")!)).toBe(flat.operating)
    expect(childSum(find(nodes, "cf:wc")!)).toBe(find(nodes, "cf:wc")!.value)
    expect(childSum(find(nodes, "cf:profit")!)).toBe(2_000)
    const investing = find(nodes, "cf:investing")!
    expect(investing.value).toBe(-20_000)
    expect(childSum(investing)).toBe(-20_000)
    expect(childSum(find(nodes, "cf:closing")!)).toBe(flat.closingCash)
  })

  it("expands everything or only the sections", () => {
    const { nodes } = incomeStatementTree(YEAR.movement)
    const all = expandableIds(nodes)
    const defaults = defaultExpandedIds(nodes)
    expect(all.length).toBeGreaterThan(defaults.length)
    expect(defaults.every((id) => all.includes(id))).toBe(true)
  })

  it("breaks a figure down into its accounts with opening, movement and closing", () => {
    const { rows, totals } = accountBreakdown(["1101"], periodWindows(ENTRIES, "2026-04-01", "2026-06-30"))
    expect(rows).toEqual([
      { code: ACC.bankMain, nameAr: expect.any(String), nameEn: expect.any(String), opening: 100_000, debit: 5_000, credit: 12_000, closing: 93_000, change: -7_000 },
    ])
    expect(totals.closing).toBe(93_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

describe("cash conversion cycle", () => {
  it("computes DSO, DIO, DPO and the cycle on average balances", () => {
    const ccc = cashConversionCycle(YEAR, 365)
    // Receivables average (0 + 6,500) / 2 = 3,250 on revenue 10,000.
    expect(ccc.dso).toBe(118.6)
    // Inventory average 12,000 on cost of revenue 6,000.
    expect(ccc.dio).toBe(730)
    // Payables average 10,000 on cost of revenue 6,000.
    expect(ccc.dpo).toBe(608.3)
    expect(ccc.ccc).toBe(240.3)
  })

  it("returns null instead of dividing by nothing", () => {
    const empty = cashConversionCycle(periodWindows(ENTRIES, "2026-01-01", "2026-01-31"), 31)
    expect(empty.dso).toBeNull()
    expect(empty.dio).toBeNull()
    expect(empty.ccc).toBeNull()
  })

  it("reads liquidity off the closing position", () => {
    const l = liquidity(YEAR.closing)
    expect(l.cash).toBe(73_000)
    expect(l.currentLiabilities).toBe(21_500)
    expect(l.workingCapital).toBe(l.currentAssets - 21_500)
  })
})

describe("counterparties", () => {
  it("ages receivables first-in-first-out", () => {
    const aging = agingReport(ENTRIES, { accounts: [ACC.clientsReceivable], side: "debit", asOf: "2026-07-31" })
    expect(aging.rows).toEqual([{ key: "c1", name: "Client One", buckets: [0, 0, 0, 6_500], total: 6_500, oldestDate: "2026-03-05" }])
    const early = agingReport(ENTRIES, { accounts: [ACC.clientsReceivable], side: "debit", asOf: "2026-03-20" })
    expect(early.buckets).toEqual([11_500, 0, 0, 0])
  })

  it("ages payables from the credit side", () => {
    const aging = agingReport(ENTRIES, { accounts: [ACC.suppliersPayable], side: "credit", asOf: "2026-05-31" })
    expect(aging.total).toBe(20_000)
    expect(aging.buckets[3]).toBe(20_000)
  })

  it("builds a party statement with its opening balance", () => {
    const st = accountStatement(ENTRIES, { codes: [ACC.clientsReceivable], party: "c1", from: "2026-04-01", to: "2026-12-31" })
    expect(st.opening).toBe(11_500)
    expect(st.rows.map((r) => [r.credit, r.balance])).toEqual([[5_000, 6_500]])
    expect(st.closing).toBe(6_500)
    expect(st.nature).toBe("D")
    const payable = accountStatement(ENTRIES, { codes: [ACC.suppliersPayable], from: "2026-01-01", to: "2026-12-31" })
    expect(payable.nature).toBe("C")
    expect(payable.closing).toBe(-20_000)
  })

  it("lists parties and their open balances", () => {
    const parties = ledgerParties(ENTRIES, { accounts: [ACC.clientsReceivable, ACC.suppliersPayable] })
    expect(parties.map((p) => [p.key, p.balance])).toEqual([
      ["s1", -20_000],
      ["c1", 6_500],
    ])
    const open = openBalancesByParty(ENTRIES, [ACC.clientsReceivable, ACC.suppliersPayable], "2026-12-31")
    expect(open.find((o) => o.key === "s1")!.byAccount[ACC.suppliersPayable]).toBe(20_000)
  })
})

describe("trend, mix and projects", () => {
  it("builds the monthly trend with month-end cash", () => {
    const trend = monthlyTrend(ENTRIES, fiscalMonths(2026, 1))
    expect(trend[2]).toMatchObject({ revenue: 10_000, expenses: 6_000, profit: 4_000 })
    expect(trend[0].cash).toBe(100_000)
    expect(trend[6].cash).toBe(73_000)
    expect(trend[11].cash).toBe(73_000)
  })

  it("ranks the expense mix", () => {
    expect(expenseBreakdown(YEAR.movement).map((s) => [s.code, s.value])).toEqual([
      ["5101", 6_000],
      ["5201", 2_000],
    ])
  })

  it("computes project profitability from line dimensions", () => {
    expect(projectProfitability(ENTRIES, "2026-01-01", "2026-12-31")).toEqual([
      { project: "p1", projectName: "Tower", revenue: 10_000, cost: 6_000, profit: 4_000, margin: 40 },
    ])
  })
})

describe("audit trail", () => {
  it("flags backdated manual entries on control accounts and posting after a close", () => {
    const events = auditTrail(ENTRIES, [
      { id: "p6", organizationId: "org1", period: "2026-06", status: "closed", closedAt: "2026-07-05T08:00:00.000Z", closedByUserName: "CFO" },
    ])
    const rent = events.find((e) => e.entryNumber === 7)!
    expect(rent.flags.sort()).toEqual(["after_close", "backdated", "control_account", "manual"])
    expect(events[0].id).toBe("entry:e7")
    expect(events.find((e) => e.type === "period_closed")).toMatchObject({ userName: "CFO", period: "2026-06" })
    expect(events.find((e) => e.entryNumber === 9)!.type).toBe("entry_draft")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Manual vouchers and settlements
// ─────────────────────────────────────────────────────────────────────────────

describe("manual voucher validation", () => {
  const ok = { date: "2026-09-13", description: "Accrue rent" }

  it("accepts a balanced two-line voucher and ignores blank rows", () => {
    const v = validateManualEntry({
      ...ok,
      lines: [
        { account: ACC.rentAndUtilities, debit: "1500", credit: "" },
        { account: ACC.bankMain, debit: "", credit: "1500.00" },
        { account: "", debit: "", credit: "" },
      ],
    })
    expect(v.ok).toBe(true)
    expect(v.lines).toHaveLength(2)
    expect(v.totalDebit).toBe(1_500)
  })

  it("reports each problem where it is", () => {
    const v = validateManualEntry({
      date: "2026-02-30",
      description: " ",
      lines: [
        { account: "1101", debit: "10", credit: "" },
        { account: ACC.bankMain, debit: "5", credit: "5" },
        { account: "", debit: "3", credit: "" },
        { account: ACC.marketing, debit: "", credit: "" },
      ],
    })
    expect(v.ok).toBe(false)
    expect(v.lineIssues).toEqual({ 0: "not_postable", 1: "both_sides", 2: "no_account", 3: "no_amount" })
    expect(v.entryIssues).toEqual(expect.arrayContaining(["bad_date", "no_description", "unbalanced"]))
  })

  it("needs two lines and a real balance", () => {
    const one = validateManualEntry({ ...ok, lines: [{ account: ACC.bankMain, debit: "10", credit: "" }] })
    expect(one.entryIssues).toEqual(expect.arrayContaining(["min_lines", "unbalanced"]))
    const off = validateManualEntry({
      ...ok,
      lines: [
        { account: ACC.bankMain, debit: "10.01", credit: "" },
        { account: ACC.sundryIncome, debit: "", credit: "10" },
      ],
    })
    expect(off.difference).toBe(0.01)
    expect(off.entryIssues).toEqual(["unbalanced"])
  })
})

describe("settlements", () => {
  const balances = {
    [ACC.clientsReceivable]: 6_500,
    [ACC.advancesFromClients]: 2_000,
    [ACC.retentionReceivable]: 1_000,
    [ACC.suppliersPayable]: 20_000,
    [ACC.advancesToSuppliers]: 25_000,
  }

  it("suggests no more than both sides hold", () => {
    expect(suggestedSettlementAmount("customer_receipt", balances)).toBe(6_500)
    expect(suggestedSettlementAmount("client_advance_offset", balances)).toBe(2_000)
    expect(suggestedSettlementAmount("supplier_advance_offset", balances)).toBe(20_000)
    expect(suggestedSettlementAmount("retention_release", balances)).toBe(1_000)
    expect(suggestedSettlementAmount("customer_receipt", { [ACC.clientsReceivable]: -50 })).toBe(0)
  })

  it("builds balanced, party-tagged lines through the chosen cash account", () => {
    const lines = settlementLines("customer_receipt", { amount: 5_000, cashAccount: ACC.bankProjects, party: "c1", partyName: "Client One" })
    expect(lines).toEqual([
      expect.objectContaining({ account: ACC.bankProjects, debit: 5_000, credit: 0, party: "c1" }),
      expect.objectContaining({ account: ACC.clientsReceivable, debit: 0, credit: 5_000, partyName: "Client One" }),
    ])
    const v = validateManualEntry({ date: "2026-09-13", description: "Receipt", lines })
    expect(v.ok).toBe(true)
    expect(settlementLines("supplier_payment", { amount: 100 }).map((l) => l.account)).toEqual([ACC.suppliersPayable, ACC.bankMain])
  })
})
