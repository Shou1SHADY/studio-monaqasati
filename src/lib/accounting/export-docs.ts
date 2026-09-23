// What each accounting screen exports — the ExportDoc every "Export to" menu
// hands to export.ts. Pure: the screen passes its data and a translator, so the
// file carries the same headings the reader sees, in the reader's language.

import { ACC, accountName } from "./accounts"
import { nodeNatural, type BalanceMap, type LedgerRow, type PeriodWindows, type TrialBalance } from "./balances"
import { round2, type JournalEntry } from "./journal"
import { balanceSheet, cashFlowStatement, incomeStatement } from "./statements"
import type { TreeNode } from "./statement-tree"
import type { AccountStatement } from "./analytics"
import type { ExportDoc, ExportRow, ExportSection, XbrlFact, XbrlGlEntry } from "./export"

type Translate = (key: string, values?: Record<string, string | number>) => string

interface DocBase {
  title: string
  subtitle?: string
  locale: string
  organizationId: string
  period: { from: string; to: string }
}

const label = (n: { labelAr: string; labelEn: string }, locale: string) => (locale === "ar" ? n.labelAr : n.labelEn)

/** A statement tree fully expanded: every figure, then the accounts it sums. */
export function treeRows(nodes: TreeNode[], locale: string, level = 0): ExportRow[] {
  const rows: ExportRow[] = []
  for (const node of nodes) {
    if (node.kind === "group") {
      rows.push({ cells: [label(node, locale), "", null], level, emphasis: "header" })
      rows.push(...treeRows(node.children ?? [], locale, level + 1))
      if (node.totalLabelAr || node.totalLabelEn) {
        rows.push({ cells: [locale === "ar" ? node.totalLabelAr ?? "" : node.totalLabelEn ?? "", "", node.value], level, emphasis: "subtotal" })
      }
      continue
    }
    rows.push({
      cells: [label(node, locale), node.accountCode ?? "", node.value],
      level,
      emphasis: node.kind === "total" ? "total" : undefined,
    })
    if (node.kind !== "account" && node.children?.length) rows.push(...treeRows(node.children, locale, level + 1))
  }
  return rows
}

function treeSection(nodes: TreeNode[], locale: string, t: Translate): ExportSection {
  return {
    columns: [
      { header: t("acc_export_col_item"), kind: "text" },
      { header: t("acc_account_code"), kind: "text" },
      { header: t("acc_export_col_amount_sar"), kind: "money" },
    ],
    rows: treeRows(nodes, locale),
  }
}

// IFRS concepts for the statements' figures. Expenses are reported as positive
// amounts (they are debit-balance concepts in the taxonomy), as on the face.

export function incomeFacts(movement: BalanceMap): XbrlFact[] {
  const t = incomeStatement(movement).totals
  const f = (concept: string, value: number): XbrlFact => ({ concept: `ifrs-full:${concept}`, value, context: "duration" })
  return [
    f("Revenue", t.revenue),
    f("CostOfSales", t.cogs),
    f("GrossProfit", t.grossProfit),
    f("AdministrativeExpense", round2(Math.abs(nodeNatural(movement, "5201")) + Math.abs(nodeNatural(movement, "5203")))),
    f("DistributionCosts", Math.abs(nodeNatural(movement, "5202"))),
    f("ProfitLossFromOperatingActivities", t.operating),
    f("FinanceCosts", t.finance),
    f("ProfitLossBeforeTax", t.beforeZakat),
    // Saudi filers present zakat where IFRS puts income tax.
    f("IncomeTaxExpenseContinuingOperations", t.zakat),
    f("ProfitLoss", t.netProfit),
  ]
}

export function balanceFacts(closing: BalanceMap): XbrlFact[] {
  const bs = balanceSheet(closing)
  const f = (concept: string, value: number): XbrlFact => ({ concept: `ifrs-full:${concept}`, value, context: "instant" })
  const n = (code: string) => nodeNatural(closing, code)
  return [
    f("CashAndCashEquivalents", n("1101")),
    f("CurrentTradeReceivables", round2(n(ACC.clientsReceivable) + n(ACC.retentionReceivable) - n(ACC.doubtfulAllowance))),
    f("CurrentContractAssets", n(ACC.contractAsset)),
    f("Inventories", n("1104")),
    f("CurrentAssets", bs.currentAssets.total),
    f("PropertyPlantAndEquipment", round2(n("1201") - n("1202"))),
    f("NoncurrentAssets", bs.nonCurrentAssets.total),
    f("Assets", bs.totalAssets),
    f("TradeAndOtherCurrentPayables", round2(n(ACC.suppliersPayable) + n(ACC.subcontractorRetentionPayable) + n(ACC.employeeAccruals))),
    f("CurrentContractLiabilities", round2(n(ACC.advancesFromClients) + n(ACC.contractLiability))),
    f("CurrentTaxLiabilities", n("2103")),
    f("CurrentLiabilities", bs.currentLiabilities.total),
    f("LongtermBorrowings", n("2201")),
    f("NoncurrentProvisionsForEmployeeBenefits", n("2202")),
    f("NoncurrentLiabilities", bs.nonCurrentLiabilities.total),
    f("Liabilities", round2(bs.currentLiabilities.total + bs.nonCurrentLiabilities.total)),
    f("IssuedCapital", n(ACC.paidInCapital)),
    f("RetainedEarnings", round2(bs.equity.total - n(ACC.paidInCapital))),
    f("Equity", bs.equity.total),
    f("EquityAndLiabilities", bs.totalLiabilitiesAndEquity),
  ]
}

export function cashFlowFacts(windows: PeriodWindows): XbrlFact[] {
  const cf = cashFlowStatement(windows)
  const d = (concept: string, value: number): XbrlFact => ({ concept: `ifrs-full:${concept}`, value, context: "duration" })
  return [
    d("CashFlowsFromUsedInOperatingActivities", cf.operating),
    d("CashFlowsFromUsedInInvestingActivities", cf.investing),
    d("CashFlowsFromUsedInFinancingActivities", cf.financing),
    d("IncreaseDecreaseInCashAndCashEquivalents", cf.netChange),
    { concept: "ifrs-full:CashAndCashEquivalents", value: cf.openingCash, context: "opening" },
    { concept: "ifrs-full:CashAndCashEquivalents", value: cf.closingCash, context: "instant" },
  ]
}

export function statementExportDoc(
  base: DocBase & { fileName: string },
  nodes: TreeNode[],
  facts: XbrlFact[],
  t: Translate
): ExportDoc {
  return { ...base, sections: [treeSection(nodes, base.locale, t)], xbrl: { kind: "ifrs", facts } }
}

/** Journal entries as XBRL GL entries. */
export function glEntries(entries: JournalEntry[], locale: string): XbrlGlEntry[] {
  return entries.map((e) => ({
    number: e.entryNumber,
    date: e.date,
    description: e.description,
    enteredBy: e.createdByUserName || "",
    kind: e.kind,
    lines: e.lines.map((l) => ({
      account: l.account,
      accountName: accountName(l.account, locale),
      amount: l.debit > 0 ? l.debit : l.credit,
      side: l.debit > 0 ? ("D" as const) : ("C" as const),
      note: l.note,
    })),
  }))
}

export function journalExportDoc(base: DocBase, entries: JournalEntry[], t: Translate): ExportDoc {
  const rows: ExportRow[] = []
  for (const e of entries) {
    e.lines.forEach((l, i) => {
      rows.push({
        cells: [
          i === 0 ? e.date : "",
          i === 0 ? e.entryNumber : null,
          i === 0 ? e.description : "",
          l.account,
          accountName(l.account, base.locale),
          l.partyName || "",
          l.debit || null,
          l.credit || null,
          i === 0 ? t(e.kind === "auto" ? "acc_journal_kind_auto" : "acc_journal_kind_manual") : "",
          i === 0 ? t(e.status === "draft" ? "acc_status_draft" : "acc_status_posted") : "",
        ],
      })
    })
  }
  return {
    ...base,
    fileName: `${base.title}_${base.period.from}_${base.period.to}`,
    sections: [
      {
        columns: [
          { header: t("acc_date"), kind: "date" },
          { header: t("acc_export_col_entry_no"), kind: "number" },
          { header: t("acc_description"), kind: "text" },
          { header: t("acc_account_code"), kind: "text" },
          { header: t("acc_account_name"), kind: "text" },
          { header: t("acc_je_party"), kind: "text" },
          { header: t("acc_debit"), kind: "money" },
          { header: t("acc_credit"), kind: "money" },
          { header: t("acc_journal_kind"), kind: "text" },
          { header: t("acc_status"), kind: "text" },
        ],
        rows,
      },
    ],
    xbrl: { kind: "gl", entriesType: "journal", entries: glEntries(entries.filter((e) => e.status === "posted"), base.locale) },
  }
}

export function ledgerExportDoc(base: DocBase, account: string, opening: number, rows: LedgerRow[], entries: JournalEntry[], t: Translate): ExportDoc {
  const byId = new Map(entries.map((e) => [e.id, e]))
  return {
    ...base,
    fileName: `${account}_${base.period.from}_${base.period.to}`,
    sections: [
      {
        title: `${account} — ${accountName(account, base.locale)}`,
        columns: [
          { header: t("acc_date"), kind: "date" },
          { header: t("acc_export_col_entry_no"), kind: "number" },
          { header: t("acc_description"), kind: "text" },
          { header: t("acc_debit"), kind: "money" },
          { header: t("acc_credit"), kind: "money" },
          { header: t("acc_balance"), kind: "money" },
        ],
        rows: [
          { cells: ["", null, t("acc_opening_balance"), null, null, opening], emphasis: "subtotal" },
          ...rows.map((r) => ({ cells: [r.date, r.entryNumber, r.description, r.debit || null, r.credit || null, r.balance] })),
        ],
      },
    ],
    xbrl: {
      kind: "gl",
      entriesType: "ledger",
      entries: glEntries(
        [...new Set(rows.map((r) => r.entryId))].map((id) => byId.get(id)).filter((e): e is JournalEntry => !!e),
        base.locale
      ).map((e) => ({ ...e, lines: e.lines.filter((l) => l.account === account) })),
    },
  }
}

export function accountStatementExportDoc(base: DocBase & { fileName: string }, st: AccountStatement, entries: JournalEntry[], t: Translate): ExportDoc {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const accounts = new Set(st.rows.map((r) => r.account))
  return {
    ...base,
    sections: [
      {
        columns: [
          { header: t("acc_date"), kind: "date" },
          { header: t("acc_export_col_entry_no"), kind: "number" },
          { header: t("acc_description"), kind: "text" },
          { header: t("acc_account_code"), kind: "text" },
          { header: t("acc_je_party"), kind: "text" },
          { header: t("acc_debit"), kind: "money" },
          { header: t("acc_credit"), kind: "money" },
          { header: t("acc_balance"), kind: "money" },
        ],
        rows: [
          { cells: ["", null, t("acc_opening_balance"), "", "", null, null, st.opening], emphasis: "subtotal" },
          ...st.rows.map((r) => ({ cells: [r.date, r.entryNumber, r.description, r.account, r.partyName || "", r.debit || null, r.credit || null, r.balance] })),
          { cells: ["", null, t("acc_closing_balance"), "", "", st.totalDebit, st.totalCredit, st.closing], emphasis: "total" },
        ],
      },
    ],
    xbrl: {
      kind: "gl",
      entriesType: "account",
      entries: glEntries(
        [...new Set(st.rows.map((r) => r.entryId))].map((id) => byId.get(id)).filter((e): e is JournalEntry => !!e),
        base.locale
      ).map((e) => ({ ...e, lines: e.lines.filter((l) => accounts.has(l.account)) })),
    },
  }
}

export function trialBalanceExportDoc(base: DocBase, tb: TrialBalance, t: Translate): ExportDoc {
  return {
    ...base,
    fileName: `${base.title}_${base.period.to}`,
    sections: [
      {
        columns: [
          { header: t("acc_account_code"), kind: "text" },
          { header: t("acc_account_name"), kind: "text" },
          { header: `${t("acc_opening_balance")} — ${t("acc_debit")}`, kind: "money" },
          { header: `${t("acc_opening_balance")} — ${t("acc_credit")}`, kind: "money" },
          { header: `${t("acc_export_col_movement")} — ${t("acc_debit")}`, kind: "money" },
          { header: `${t("acc_export_col_movement")} — ${t("acc_credit")}`, kind: "money" },
          { header: `${t("acc_closing_balance")} — ${t("acc_debit")}`, kind: "money" },
          { header: `${t("acc_closing_balance")} — ${t("acc_credit")}`, kind: "money" },
        ],
        rows: [
          ...tb.rows.map((r) => ({
            cells: [r.code, accountName(r.code, base.locale), r.openingDebit, r.openingCredit, r.movementDebit, r.movementCredit, r.closingDebit, r.closingCredit],
          })),
          {
            cells: ["", t("acc_total"), tb.totals.openingDebit, tb.totals.openingCredit, tb.totals.movementDebit, tb.totals.movementCredit, tb.totals.closingDebit, tb.totals.closingCredit],
            emphasis: "total" as const,
          },
        ],
      },
    ],
    // A trial balance has no taxonomy of its own; its XBRL form is the ledger's.
  }
}

/** A plain two-column schedule (item, amount) with optional platform-namespace facts. */
export function scheduleExportDoc(
  base: DocBase & { fileName: string },
  sections: Array<{ title?: string; rows: Array<{ label: string; value: number | null; emphasis?: ExportRow["emphasis"]; level?: number }> }>,
  t: Translate,
  facts?: XbrlFact[]
): ExportDoc {
  return {
    ...base,
    sections: sections.map((s) => ({
      title: s.title,
      columns: [
        { header: t("acc_export_col_item"), kind: "text" },
        { header: t("acc_export_col_amount_sar"), kind: "money" },
      ],
      rows: s.rows.map((r) => ({ cells: [r.label, r.value], emphasis: r.emphasis, level: r.level })),
    })),
    xbrl: facts ? { kind: "ext", facts } : undefined,
  }
}
