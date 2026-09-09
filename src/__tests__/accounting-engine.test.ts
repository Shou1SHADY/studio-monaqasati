/**
 * The accounting engine's proof of correctness.
 *
 * The suite builds a small but complete company — opening balances, an IPC
 * certificate, a collection, a manufacturing run, a payroll — and then checks
 * the same properties an auditor would: every entry balances, the trial balance
 * nets to zero, the balance sheet balances, and the cash-flow statement
 * reconciles to the actual bank movement.
 */

import {
  CHART_OF_ACCOUNTS,
  ACCOUNT_BY_CODE,
  ACC,
  POSTABLE_ACCOUNTS,
  accountName,
  descendantsOf,
  isPostable,
  naturalSign,
} from "@/lib/accounting/accounts"
import {
  buildEntry,
  buildReversal,
  entryDocId,
  isPeriodClosed,
  nextEntryNumber,
  periodOf,
  NonPostableAccountError,
  UnbalancedEntryError,
  type AccountingPeriod,
  type JournalEntry,
} from "@/lib/accounting/journal"
import {
  accountLedger,
  aggregate,
  integrityChecks,
  nodeBalance,
  nodeNatural,
  periodWindows,
  reconcileControl,
  trialBalance,
} from "@/lib/accounting/balances"
import {
  balanceSheet,
  cashFlowStatement,
  equityStatement,
  incomeStatement,
  lockedCash,
  netProfit,
} from "@/lib/accounting/statements"
import {
  postIpcClaim,
  postIpcCollection,
  postMaterialIssue,
  postPayroll,
  postSalesPayment,
  postSalesQuotationAccepted,
  postVatSettlement,
  postWorkOrderDelivery,
  postWorkOrderIssue,
} from "@/lib/accounting/posting-rules"

// ─────────────────────────────────────────────────────────────────────────────
// Chart of accounts
// ─────────────────────────────────────────────────────────────────────────────

describe("chart of accounts", () => {
  it("derives level and parent from the code width", () => {
    expect(ACCOUNT_BY_CODE["1"]).toMatchObject({ level: 1, parent: null })
    expect(ACCOUNT_BY_CODE["11"]).toMatchObject({ level: 2, parent: "1" })
    expect(ACCOUNT_BY_CODE["1101"]).toMatchObject({ level: 3, parent: "11" })
    expect(ACCOUNT_BY_CODE["110101"]).toMatchObject({ level: 4, parent: "1101" })
  })

  it("gives every account a parent that exists, except the five roots", () => {
    const roots = CHART_OF_ACCOUNTS.filter((a) => a.parent === null)
    expect(roots.map((r) => r.code).sort()).toEqual(["1", "2", "3", "4", "5"])
    for (const a of CHART_OF_ACCOUNTS) {
      if (a.parent) expect(ACCOUNT_BY_CODE[a.parent]).toBeDefined()
    }
  })

  it("only lets leaves be postable", () => {
    for (const a of CHART_OF_ACCOUNTS) {
      if (a.postable) expect(a.level).toBe(4)
    }
    expect(POSTABLE_ACCOUNTS.length).toBeGreaterThan(40)
    expect(isPostable("110101")).toBe(true)
    expect(isPostable("1101")).toBe(false)
  })

  it("has no duplicate codes", () => {
    const codes = CHART_OF_ACCOUNTS.map((a) => a.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("names every account in both languages", () => {
    for (const a of CHART_OF_ACCOUNTS) {
      expect(a.nameAr.length).toBeGreaterThan(0)
      expect(a.nameEn.length).toBeGreaterThan(0)
    }
    expect(accountName("110101", "ar")).toBe("الصندوق")
    expect(accountName("110101", "en")).toBe("Petty cash")
  })

  it("points every named ACC constant at a postable account", () => {
    for (const code of Object.values(ACC)) {
      expect(ACCOUNT_BY_CODE[code]).toBeDefined()
      expect(isPostable(code)).toBe(true)
    }
  })

  it("rolls descendants up by code prefix", () => {
    const cash = descendantsOf("1101").map((a) => a.code)
    expect(cash).toEqual(["1101", "110101", "110102", "110103"])
  })

  it("flips credit-natured types into their natural sign", () => {
    expect(naturalSign("110101", 500)).toBe(500)
    expect(naturalSign("210101", -500)).toBe(500)
    expect(naturalSign("410101", -1000)).toBe(1000)
  })

  it("carries the manufacturing leaves the reference chart lacked", () => {
    expect(isPostable(ACC.inventoryWip)).toBe(true)
    expect(isPostable(ACC.inventoryFinishedGoods)).toBe(true)
    expect(ACCOUNT_BY_CODE[ACC.inventoryWip].parent).toBe("1104")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Journal
// ─────────────────────────────────────────────────────────────────────────────

const base = {
  organizationId: "org1",
  date: "2026-03-31",
  kind: "auto" as const,
  sourceType: "manual_voucher" as const,
  sourceId: "v1",
  description: "test",
  userId: "u1",
  userName: "Tester",
}

describe("buildEntry", () => {
  it("totals and stamps the period", () => {
    const e = buildEntry({
      ...base,
      lines: [
        { account: ACC.bankMain, debit: 1000 },
        { account: ACC.sundryIncome, credit: 1000 },
      ],
    })
    expect(e.totalDebit).toBe(1000)
    expect(e.totalCredit).toBe(1000)
    expect(e.period).toBe("2026-03")
    expect(e.status).toBe("posted")
  })

  it("refuses an unbalanced entry", () => {
    expect(() =>
      buildEntry({
        ...base,
        lines: [
          { account: ACC.bankMain, debit: 1000 },
          { account: ACC.sundryIncome, credit: 900 },
        ],
      })
    ).toThrow(UnbalancedEntryError)
  })

  it("refuses a line on a rollup account", () => {
    expect(() =>
      buildEntry({
        ...base,
        lines: [
          { account: "1101", debit: 100 },
          { account: ACC.sundryIncome, credit: 100 },
        ],
      })
    ).toThrow(NonPostableAccountError)
  })

  it("drops zero lines so optional components need no branching in rules", () => {
    const e = buildEntry({
      ...base,
      lines: [
        { account: ACC.bankMain, debit: 500 },
        { account: ACC.retentionReceivable, debit: 0 },
        { account: ACC.sundryIncome, credit: 500 },
      ],
    })
    expect(e.lines).toHaveLength(2)
  })

  it("tolerates sub-halala float drift but not a real gap", () => {
    expect(() =>
      buildEntry({
        ...base,
        lines: [
          { account: ACC.bankMain, debit: 100.004 },
          { account: ACC.sundryIncome, credit: 100 },
        ],
      })
    ).not.toThrow()
    expect(() =>
      buildEntry({
        ...base,
        lines: [
          { account: ACC.bankMain, debit: 100.5 },
          { account: ACC.sundryIncome, credit: 100 },
        ],
      })
    ).toThrow(UnbalancedEntryError)
  })

  it("applies default branch and cost centre only where a line has none", () => {
    const e = buildEntry({
      ...base,
      defaultBranch: "B1",
      defaultCostCenter: "C3",
      lines: [
        { account: ACC.bankMain, debit: 100, costCenter: "C1" },
        { account: ACC.sundryIncome, credit: 100 },
      ],
    })
    expect(e.lines[0]).toMatchObject({ branch: "B1", costCenter: "C1" })
    expect(e.lines[1]).toMatchObject({ branch: "B1", costCenter: "C3" })
  })
})

describe("entryDocId", () => {
  it("is deterministic, which is what makes posting idempotent", () => {
    expect(entryDocId("org1", "ipc_claim", "claim1")).toBe("org1__ipc_claim__claim1")
    expect(entryDocId("org1", "ipc_claim", "claim1")).toBe(entryDocId("org1", "ipc_claim", "claim1"))
    expect(entryDocId("org1", "ipc_collection", "claim1")).not.toBe(entryDocId("org1", "ipc_claim", "claim1"))
  })

  it("keeps two orgs apart on a source id that is not globally unique", () => {
    // Every org opens its books as "OPEN-2026" and settles VAT for "2026-03".
    // Without the org in the id these would be the same document, and one
    // company's opening balance would silently replace another's.
    expect(entryDocId("orgA", "opening", "OPEN-2026")).not.toBe(entryDocId("orgB", "opening", "OPEN-2026"))
    expect(entryDocId("orgA", "vat_settlement", "2026-03")).not.toBe(entryDocId("orgB", "vat_settlement", "2026-03"))
    expect(entryDocId("orgA", "payroll", "2026-03")).not.toBe(entryDocId("orgB", "payroll", "2026-03"))
  })
})

describe("buildReversal", () => {
  it("mirrors every line and points back at the original", () => {
    const original: JournalEntry = {
      ...buildEntry({
        ...base,
        lines: [
          { account: ACC.bankMain, debit: 700, project: "p1" },
          { account: ACC.sundryIncome, credit: 700, project: "p1" },
        ],
      }),
      id: "e1",
      entryNumber: 12,
    }
    const rev = buildReversal(original, { date: "2026-04-05", userId: "u1", userName: "Tester" })
    expect(rev.lines[0]).toMatchObject({ account: ACC.bankMain, debit: 0, credit: 700 })
    expect(rev.lines[1]).toMatchObject({ account: ACC.sundryIncome, debit: 700, credit: 0 })
    expect(rev.totalDebit).toBe(rev.totalCredit)
    expect(rev.reversesEntryId).toBe("e1")
    expect(rev.sourceId).toBe("v1__reversal")
  })
})

describe("periods", () => {
  const periods: AccountingPeriod[] = [
    { id: "1", organizationId: "org1", period: "2026-01", status: "closed" },
    { id: "2", organizationId: "org1", period: "2026-02", status: "open" },
  ]
  it("blocks a date inside a closed period only", () => {
    expect(isPeriodClosed(periods, "2026-01-15")).toBe(true)
    expect(isPeriodClosed(periods, "2026-02-15")).toBe(false)
    expect(isPeriodClosed(periods, "2026-05-15")).toBe(false)
  })
  it("derives the period key from the date", () => {
    expect(periodOf("2026-03-31")).toBe("2026-03")
  })
})

describe("nextEntryNumber", () => {
  it("continues past the highest, treating gaps as zero", () => {
    expect(nextEntryNumber([])).toBe(1)
    expect(nextEntryNumber([{ entryNumber: 4 }, {}, { entryNumber: 11 }])).toBe(12)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Posting rules
// ─────────────────────────────────────────────────────────────────────────────

const ctx = { organizationId: "org1", userId: "u1", userName: "Tester" }

/** Run a rule through buildEntry — the balance check is the assertion. */
function entryFor(result: ReturnType<typeof postIpcClaim> | null): Omit<JournalEntry, "id"> {
  if (!result) throw new Error("rule produced nothing")
  return buildEntry({
    organizationId: ctx.organizationId,
    date: result.date,
    kind: "auto",
    sourceType: result.sourceType,
    sourceId: result.sourceId,
    description: result.description,
    lines: result.lines,
    userId: ctx.userId,
    userName: ctx.userName,
    defaultCostCenter: result.costCenter,
  })
}

describe("posting rules", () => {
  it("posts an IPC certificate to revenue, receivables, retention and VAT", () => {
    // The seeded UAT claim: 332,000 gross, 10% retention, 5% advance, 15% VAT.
    const e = entryFor(
      postIpcClaim({
        claimId: "c1",
        claimNumber: 1,
        projectId: "p1",
        projectName: "برج العليا",
        date: "2026-03-31",
        gross: 332000,
        retention: 33200,
        advanceRecovery: 16600,
        vat: 42330,
        net: 324530,
      })
    )
    expect(e.totalDebit).toBe(e.totalCredit)
    expect(e.totalDebit).toBe(374330)
    const byAccount = Object.fromEntries(e.lines.map((l) => [l.account, l]))
    expect(byAccount[ACC.clientsReceivable].debit).toBe(324530)
    expect(byAccount[ACC.retentionReceivable].debit).toBe(33200)
    expect(byAccount[ACC.advancesFromClients].debit).toBe(16600)
    expect(byAccount[ACC.contractRevenue].credit).toBe(332000)
    expect(byAccount[ACC.vatOutput].credit).toBe(42330)
    expect(e.lines.every((l) => l.project === "p1")).toBe(true)
  })

  it("posts a claim with no retention or advance as a two-sided entry", () => {
    const e = entryFor(
      postIpcClaim({
        claimId: "c2",
        claimNumber: 2,
        projectId: "p1",
        date: "2026-04-30",
        gross: 100000,
        retention: 0,
        advanceRecovery: 0,
        vat: 15000,
        net: 115000,
      })
    )
    expect(e.lines).toHaveLength(3)
    expect(e.totalDebit).toBe(115000)
  })

  it("moves cash against the receivable on collection, recognising no revenue", () => {
    const e = entryFor(
      postIpcCollection({ claimId: "c1", claimNumber: 1, projectId: "p1", date: "2026-05-10", amount: 324530 })
    )
    expect(e.lines.map((l) => l.account)).toEqual([ACC.bankMain, ACC.clientsReceivable])
    expect(e.lines.some((l) => l.account.startsWith("4"))).toBe(false)
  })

  it("recognises a post-manufacturing sale but not a pre-manufacturing order", () => {
    const sold = postSalesQuotationAccepted({
      quotationId: "q1",
      quotationNumber: "Q-A1",
      date: "2026-03-10",
      amount: 20000,
      vatPercent: 15,
      contactId: "ct1",
      phase: "post_manufacturing",
    })
    const e = entryFor(sold)
    expect(e.totalDebit).toBe(23000)
    expect(
      postSalesQuotationAccepted({
        quotationId: "q2",
        quotationNumber: "Q-A2",
        date: "2026-03-10",
        amount: 20000,
        vatPercent: 15,
        contactId: "ct1",
        phase: "pre_manufacturing",
      })
    ).toBeNull()
  })

  it("treats a payment taken before delivery as a client advance, not a settlement", () => {
    const advance = entryFor(
      postSalesPayment({
        quotationId: "q1",
        quotationNumber: "Q-A1",
        installmentId: "deposit",
        date: "2026-03-12",
        amount: 6000,
        contactId: "ct1",
        isAdvance: true,
      })
    )
    expect(advance.lines[1].account).toBe(ACC.advancesFromClients)
    const settlement = entryFor(
      postSalesPayment({
        quotationId: "q1",
        quotationNumber: "Q-A1",
        installmentId: "balance",
        date: "2026-04-12",
        amount: 14000,
        contactId: "ct1",
        isAdvance: false,
      })
    )
    expect(settlement.lines[1].account).toBe(ACC.clientsReceivable)
  })

  it("keeps manufacturing value inside inventory until it reaches a project", () => {
    const issue = entryFor(
      postWorkOrderIssue({ workOrderId: "w1", orderNumber: 1, title: "أبواب", date: "2026-03-05", materialCost: 2400 })
    )
    expect(issue.lines.map((l) => l.account)).toEqual([ACC.inventoryWip, ACC.inventoryMaterials])
    expect(issue.lines.some((l) => l.account.startsWith("5"))).toBe(false)

    const toStock = entryFor(
      postWorkOrderDelivery({
        workOrderId: "w1",
        orderNumber: 1,
        deliveryNoteId: "dn1",
        date: "2026-03-20",
        value: 2400,
        toProject: false,
      })
    )
    expect(toStock.lines[0].account).toBe(ACC.inventoryFinishedGoods)

    const toProject = entryFor(
      postWorkOrderDelivery({
        workOrderId: "w2",
        orderNumber: 2,
        deliveryNoteId: "dn2",
        date: "2026-03-20",
        value: 2400,
        projectId: "p1",
        toProject: true,
      })
    )
    expect(toProject.lines[0].account).toBe(ACC.costMaterials)
  })

  it("charges the whole issued value to the project, waste included", () => {
    const e = entryFor(
      postMaterialIssue({
        batchId: "b1",
        date: "2026-03-15",
        projectId: "p1",
        totalValue: 5000,
        wasteValue: 400,
        itemName: "أسمنت",
      })
    )
    expect(e.lines[0]).toMatchObject({ account: ACC.costMaterials, debit: 5000 })
    expect(e.description).toContain("هدر")
  })

  it("splits payroll between project labour and admin, accruing the whole", () => {
    const e = entryFor(
      postPayroll({
        runId: "pr-2026-03",
        period: "2026-03",
        date: "2026-03-31",
        directLabour: 300000,
        adminSalaries: 210000,
        projectAllocations: [{ projectId: "p1", amount: 180000 }],
      })
    )
    expect(e.totalCredit).toBe(510000)
    const accrual = e.lines.find((l) => l.account === ACC.employeeAccruals)
    expect(accrual?.credit).toBe(510000)
    const allocated = e.lines.find((l) => l.account === ACC.costLabour && l.project === "p1")
    expect(allocated?.debit).toBe(180000)
  })

  it("settles VAT in the direction the net position points", () => {
    const payable = entryFor(
      postVatSettlement({ periodKey: "2026-03", date: "2026-04-15", outputVat: 42330, inputVat: 12000 })
    )
    const bankLine = payable.lines.find((l) => l.account === ACC.bankMain)
    expect(bankLine?.credit).toBe(30330)

    const reclaim = entryFor(
      postVatSettlement({ periodKey: "2026-04", date: "2026-05-15", outputVat: 5000, inputVat: 9000 })
    )
    expect(reclaim.lines.find((l) => l.account === ACC.bankMain)?.debit).toBe(4000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A whole company, end to end
// ─────────────────────────────────────────────────────────────────────────────

function post(
  result: ReturnType<typeof postIpcClaim> | null,
  n: number,
  kind: "auto" | "opening" = "auto"
): JournalEntry {
  if (!result) throw new Error("nothing to post")
  return {
    ...buildEntry({
      organizationId: "org1",
      date: result.date,
      kind,
      sourceType: result.sourceType,
      sourceId: result.sourceId,
      description: result.description,
      lines: result.lines,
      entryNumber: n,
      userId: "u1",
      userName: "Tester",
      defaultBranch: "B1",
      defaultCostCenter: result.costCenter,
    }),
    id: `e${n}`,
  }
}

function buildBooks(): JournalEntry[] {
  const opening: JournalEntry = {
    ...buildEntry({
      organizationId: "org1",
      date: "2025-12-31",
      kind: "opening",
      sourceType: "opening",
      sourceId: "OPEN-2026",
      description: "الأرصدة الافتتاحية",
      entryNumber: 1,
      userId: "u1",
      userName: "Tester",
      defaultBranch: "B1",
      defaultCostCenter: "C3",
      lines: [
        { account: ACC.bankMain, debit: 1000000 },
        { account: ACC.inventoryMaterials, debit: 200000 },
        { account: ACC.paidInCapital, credit: 1200000 },
      ],
    }),
    id: "e1",
  }

  return [
    opening,
    post(
      postIpcClaim({
        claimId: "c1",
        claimNumber: 1,
        projectId: "p1",
        projectName: "برج العليا",
        date: "2026-03-31",
        gross: 332000,
        retention: 33200,
        advanceRecovery: 0,
        vat: 43470,
        net: 342270,
      }),
      2
    ),
    post(
      postIpcCollection({ claimId: "c1", claimNumber: 1, projectId: "p1", date: "2026-03-31", amount: 200000 }),
      3
    ),
    post(
      postWorkOrderIssue({ workOrderId: "w1", orderNumber: 1, title: "أبواب", date: "2026-03-10", materialCost: 50000 }),
      4
    ),
    post(
      postWorkOrderDelivery({
        workOrderId: "w1",
        orderNumber: 1,
        deliveryNoteId: "dn1",
        date: "2026-03-25",
        value: 50000,
        projectId: "p1",
        toProject: true,
      }),
      5
    ),
    post(
      postPayroll({
        runId: "pr-2026-03",
        period: "2026-03",
        date: "2026-03-31",
        directLabour: 60000,
        adminSalaries: 40000,
        projectAllocations: [{ projectId: "p1", amount: 60000 }],
      }),
      6
    ),
  ]
}

describe("a full set of books", () => {
  const entries = buildBooks()
  const windows = periodWindows(entries, "2026-03-01", "2026-03-31")

  it("balances every entry", () => {
    for (const e of entries) expect(e.totalDebit).toBe(e.totalCredit)
  })

  it("balances the trial balance", () => {
    expect(trialBalance(windows).difference).toBe(0)
  })

  it("balances the statement of financial position", () => {
    const bs = balanceSheet(windows.closing)
    expect(bs.difference).toBe(0)
    expect(bs.totalAssets).toBeGreaterThan(0)
  })

  it("reconciles the cash-flow statement to the real bank movement", () => {
    const cf = cashFlowStatement(windows)
    expect(cf.difference).toBe(0)
    // Opening cash 1,000,000 + a 200,000 collection, less nothing paid out.
    expect(cf.openingCash).toBe(1000000)
    expect(cf.closingCash).toBe(1200000)
    expect(cf.netChange).toBe(200000)
  })

  it("computes the income statement from the period's movement only", () => {
    const is = incomeStatement(windows.movement)
    expect(is.totals.revenue).toBe(332000)
    // 50,000 of manufactured materials landed on the project + 60,000 labour.
    expect(is.totals.cogs).toBe(110000)
    expect(is.totals.grossProfit).toBe(222000)
    expect(is.totals.opex).toBe(40000)
    expect(is.totals.netProfit).toBe(182000)
    expect(netProfit(windows.movement)).toBe(182000)
  })

  it("carries the period result into equity", () => {
    const eq = equityStatement(windows)
    expect(eq.rows[0].capital).toBe(1200000)
    expect(eq.closingTotal).toBe(1382000)
    expect(balanceSheet(windows.closing).equity.total).toBe(eq.closingTotal)
  })

  it("passes every integrity check", () => {
    for (const check of integrityChecks(entries, windows)) {
      expect({ id: check.id, ok: check.ok }).toEqual({ id: check.id, ok: true })
    }
  })

  it("reconciles a control account against its sub-ledger", () => {
    // 342,270 certified less 200,000 collected.
    const ok = reconcileControl(windows.closing, ACC.clientsReceivable, "عملاء", 142270)
    expect(ok.ok).toBe(true)
    expect(ok.difference).toBe(0)
    expect(reconcileControl(windows.closing, ACC.clientsReceivable, "عملاء", 100000).ok).toBe(false)
  })

  it("reports the money that is real but not spendable", () => {
    const locked = lockedCash(windows.closing)
    expect(locked.availableCash).toBe(1200000)
    const codes = locked.rows.map((r) => r.code)
    expect(codes).toContain(ACC.clientsReceivable)
    expect(codes).toContain(ACC.retentionReceivable)
    expect(locked.total).toBeGreaterThan(0)
  })

  it("keeps a running balance on an account ledger", () => {
    const led = accountLedger(entries, ACC.bankMain, "2026-03-01", "2026-03-31")
    expect(led.openingBalance).toBe(1000000)
    expect(led.rows).toHaveLength(1)
    expect(led.closingBalance).toBe(1200000)
  })

  it("filters by project without disturbing the rollups", () => {
    const p1 = aggregate(entries, "2026-01-01", "2026-12-31", { project: "p1" })
    expect(nodeNatural(p1, ACC.contractRevenue)).toBe(332000)
    expect(nodeNatural(p1, ACC.costLabour)).toBe(60000)
    // Admin salaries carry no project, so they must not appear.
    expect(nodeBalance(p1, ACC.adminSalaries)).toBe(0)
  })

  it("excludes drafts from every balance", () => {
    const draft: JournalEntry = {
      ...buildEntry({
        organizationId: "org1",
        date: "2026-03-31",
        kind: "manual",
        sourceType: "manual_voucher",
        sourceId: "draft1",
        description: "مسودة",
        status: "draft",
        entryNumber: 99,
        userId: "u1",
        userName: "Tester",
        defaultCostCenter: "C3",
        lines: [
          { account: ACC.costDirectSite, debit: 46500 },
          { account: ACC.employeeAccruals, credit: 46500 },
        ],
      }),
      id: "draft1",
    }
    const withDraft = periodWindows([...entries, draft], "2026-03-01", "2026-03-31")
    expect(incomeStatement(withDraft.movement).totals.netProfit).toBe(182000)
    expect(trialBalance(withDraft).difference).toBe(0)
  })
})
