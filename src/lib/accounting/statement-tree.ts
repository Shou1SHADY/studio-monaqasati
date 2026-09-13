// Expandable statements — the three primary statements as trees whose leaves
// are real ledger accounts.
//
// statements.ts computes each statement's face (the figures a reader signs);
// this module hangs the evidence under every figure: a line expands into the
// postable accounts it sums, each carrying its account number, so a reader can
// walk from "Inventory 1,240,000" down to 110402 Work in progress without
// leaving the statement. Every node also names the account codes behind it,
// which is what the breakdown drawer opens.
//
// Values on the face come straight from statements.ts so the tree can never
// disagree with the flat statement; only the account children are computed
// here, from the same balance windows.

import { CHART_OF_ACCOUNTS, ACCOUNT_BY_CODE, naturalSign } from "./accounts"
import { type BalanceMap, type PeriodWindows } from "./balances"
import { round2 } from "./journal"
import {
  balanceSheet,
  cashFlowStatement,
  incomeStatement,
  netProfit,
  type BalanceSheet,
  type BalanceSheetSection,
  type CashFlowStatement,
  type IncomeStatement,
} from "./statements"

export type TreeNodeKind = "group" | "line" | "account" | "total"

/** Which balance a figure (and its breakdown) reads. */
export type TreeBasis = "movement" | "closing" | "opening"

export interface TreeNode {
  id: string
  kind: TreeNodeKind
  labelAr: string
  labelEn: string
  value: number | null
  basis: TreeBasis
  /** Account codes (leaves or rollups) this figure is made of. Absent on
   * purely presentational rows. */
  codes?: string[]
  /** Set on account rows — the leaf's own number. */
  accountCode?: string
  children?: TreeNode[]
  /** Groups: the subtotal row printed after the children while expanded. When
   * collapsed, the group's own row carries the figure instead. */
  totalLabelAr?: string
  totalLabelEn?: string
}

const EPSILON = 0.005

/**
 * The postable accounts under `codes` that carry a balance in `map`, one row
 * each. `effect` turns a signed balance into the figure the statement shows
 * (natural sign for balances, negated movement for cash-flow effects).
 */
export function accountLeaves(
  codes: string[],
  map: BalanceMap,
  basis: TreeBasis,
  effect: (code: string, signedBalance: number) => number = naturalSign
): TreeNode[] {
  const out: TreeNode[] = []
  const seen = new Set<string>()
  for (const prefix of codes) {
    for (const account of CHART_OF_ACCOUNTS) {
      if (!account.postable || seen.has(account.code) || !account.code.startsWith(prefix)) continue
      const movement = map[account.code]
      if (!movement) continue
      const value = round2(effect(account.code, movement.balance))
      if (Math.abs(value) < EPSILON) continue
      seen.add(account.code)
      out.push({
        id: `acc:${basis}:${account.code}`,
        kind: "account",
        labelAr: account.nameAr,
        labelEn: account.nameEn,
        value,
        basis,
        codes: [account.code],
        accountCode: account.code,
      })
    }
  }
  return out.sort((a, b) => (a.accountCode! < b.accountCode! ? -1 : 1))
}

/** A leaf code needs no children — expanding it would only repeat itself. */
function isLeaf(code: string): boolean {
  return ACCOUNT_BY_CODE[code]?.postable === true
}

// ---------------------------------------------------------------------------
// Income statement
// ---------------------------------------------------------------------------

/** What each computed total is made of, for the breakdown drawer. */
const INCOME_TOTAL_CODES: Record<string, string[]> = {
  grossProfit: ["4", "51"],
  operating: ["4", "51", "52"],
  beforeZakat: ["4", "51", "52", "53"],
  netProfit: ["4", "5"],
}

export function incomeStatementTree(movement: BalanceMap): { nodes: TreeNode[]; statement: IncomeStatement } {
  const statement = incomeStatement(movement)
  const nodes: TreeNode[] = []
  let group: TreeNode | null = null

  statement.rows.forEach((row, i) => {
    const id = `is:${row.key ?? i}`
    if (row.type === "header") {
      group = { id, kind: "group", labelAr: row.labelAr, labelEn: row.labelEn, value: null, basis: "movement", codes: [], children: [] }
      nodes.push(group)
      return
    }
    if (row.type === "subtotal" && group) {
      group.value = row.value
      group.codes = row.codes
      group.totalLabelAr = row.labelAr
      group.totalLabelEn = row.labelEn
      group = null
      return
    }
    if (row.type === "line") {
      const codes = row.codes ?? []
      const node: TreeNode = {
        id,
        kind: "line",
        labelAr: row.labelAr,
        labelEn: row.labelEn,
        value: row.value,
        basis: "movement",
        codes,
        // Natural sign: revenue and cost both read positive, and a contra
        // balance (a credit note in revenue) shows as the negative it is.
        children: accountLeaves(codes, movement, "movement"),
      }
      ;(group ? group.children! : nodes).push(node)
      return
    }
    nodes.push({
      id,
      kind: "total",
      labelAr: row.labelAr,
      labelEn: row.labelEn,
      value: row.value,
      basis: "movement",
      codes: row.key ? INCOME_TOTAL_CODES[row.key] : undefined,
    })
  })
  return { nodes, statement }
}

// ---------------------------------------------------------------------------
// Statement of financial position
// ---------------------------------------------------------------------------

function sectionGroup(id: string, section: BalanceSheetSection, closing: BalanceMap): TreeNode {
  return {
    id,
    kind: "group",
    labelAr: section.labelAr,
    labelEn: section.labelEn,
    value: section.total,
    basis: "closing",
    codes: section.rows.map((r) => (r.code === "__result" ? ["4", "5"] : [r.code])).flat(),
    totalLabelAr: `إجمالي ${section.labelAr}`,
    totalLabelEn: `Total ${section.labelEn.toLowerCase()}`,
    children: section.rows.map((row): TreeNode => {
      if (row.code === "__result") {
        return {
          id: `${id}:result`,
          kind: "line",
          labelAr: row.labelAr,
          labelEn: row.labelEn,
          value: row.value,
          basis: "closing",
          codes: ["4", "5"],
          children: [
            { id: `${id}:result:rev`, kind: "line", labelAr: "الإيرادات المتراكمة", labelEn: "Accumulated revenue", value: round2(-sumBalance(closing, "4")), basis: "closing", codes: ["4"], children: accountLeaves(["4"], closing, "closing") },
            { id: `${id}:result:exp`, kind: "line", labelAr: "المصروفات المتراكمة", labelEn: "Accumulated expenses", value: round2(-sumBalance(closing, "5")), basis: "closing", codes: ["5"], children: accountLeaves(["5"], closing, "closing", (_c, b) => -b) },
          ],
        }
      }
      return {
        id: `bs:${row.code}`,
        kind: isLeaf(row.code) ? "account" : "line",
        labelAr: row.labelAr,
        labelEn: row.labelEn,
        value: row.value,
        basis: "closing",
        codes: [row.code],
        accountCode: isLeaf(row.code) ? row.code : undefined,
        children: isLeaf(row.code) ? undefined : accountLeaves([row.code], closing, "closing"),
      }
    }),
  }
}

function sumBalance(map: BalanceMap, prefix: string): number {
  let s = 0
  for (const code of Object.keys(map)) if (code.startsWith(prefix)) s += map[code].balance
  return round2(s)
}

export function balanceSheetTree(closing: BalanceMap): { nodes: TreeNode[]; statement: BalanceSheet } {
  const bs = balanceSheet(closing)
  const current = sectionGroup("bs:ca", bs.currentAssets, closing)
  const nonCurrent = sectionGroup("bs:nca", bs.nonCurrentAssets, closing)
  const currentLiab = sectionGroup("bs:cl", bs.currentLiabilities, closing)
  const nonCurrentLiab = sectionGroup("bs:ncl", bs.nonCurrentLiabilities, closing)
  const equity = sectionGroup("bs:eq", bs.equity, closing)
  const totalLiabilities = round2(bs.currentLiabilities.total + bs.nonCurrentLiabilities.total)

  const nodes: TreeNode[] = [
    {
      id: "bs:assets",
      kind: "group",
      labelAr: "الأصول",
      labelEn: "Assets",
      value: bs.totalAssets,
      basis: "closing",
      codes: ["1"],
      totalLabelAr: "إجمالي الأصول",
      totalLabelEn: "Total assets",
      children: [current, nonCurrent],
    },
    {
      id: "bs:liabilities",
      kind: "group",
      labelAr: "الخصوم",
      labelEn: "Liabilities",
      value: totalLiabilities,
      basis: "closing",
      codes: ["2"],
      totalLabelAr: "إجمالي الخصوم",
      totalLabelEn: "Total liabilities",
      children: [currentLiab, nonCurrentLiab],
    },
    equity,
    {
      id: "bs:total-le",
      kind: "total",
      labelAr: "إجمالي الخصوم وحقوق الملكية",
      labelEn: "Total liabilities and equity",
      value: bs.totalLiabilitiesAndEquity,
      basis: "closing",
      codes: ["2", "3", "4", "5"],
    },
  ]
  return { nodes, statement: bs }
}

// ---------------------------------------------------------------------------
// Cash flow — indirect method
// ---------------------------------------------------------------------------

function taggedCodes(tag: string): string[] {
  return CHART_OF_ACCOUNTS.filter((a) => a.postable && a.cashFlow === tag).map((a) => a.code)
}

/** Cash effect of an account's movement: an asset rising consumes cash, a
 * liability rising supplies it — both are the negated signed balance. */
const cashEffect = (_code: string, signedBalance: number) => -signedBalance

export function cashFlowTree(windows: PeriodWindows): { nodes: TreeNode[]; statement: CashFlowStatement } {
  const cf = cashFlowStatement(windows)
  const { movement, opening, closing } = windows
  const profit = netProfit(movement)
  const dep = taggedCodes("dep")
  const wc = taggedCodes("wc")
  const inv = taggedCodes("inv")
  const fin = taggedCodes("fin")
  const depreciation = cf.rows.find((r) => r.labelEn.startsWith("Depreciation"))?.value ?? 0
  const workingCapital = cf.rows.find((r) => r.labelEn === "Change in working capital")?.value ?? 0

  const nodes: TreeNode[] = [
    {
      id: "cf:operating",
      kind: "group",
      labelAr: "التدفق النقدي من الأنشطة التشغيلية",
      labelEn: "Operating activities",
      value: cf.operating,
      basis: "movement",
      codes: ["4", "5", ...dep, ...wc],
      totalLabelAr: "صافي النقد من الأنشطة التشغيلية",
      totalLabelEn: "Net cash from operating activities",
      children: [
        {
          id: "cf:profit",
          kind: "line",
          labelAr: "صافي ربح الفترة",
          labelEn: "Net profit for the period",
          value: profit,
          basis: "movement",
          codes: ["4", "5"],
          children: accountLeaves(["4", "5"], movement, "movement", cashEffect),
        },
        {
          id: "cf:dep",
          kind: "line",
          labelAr: "إهلاك (مصروف غير نقدي)",
          labelEn: "Depreciation (non-cash)",
          value: depreciation,
          basis: "movement",
          codes: dep,
          children: accountLeaves(dep, movement, "movement", cashEffect),
        },
        {
          id: "cf:wc",
          kind: "line",
          labelAr: "التغير في رأس المال العامل",
          labelEn: "Change in working capital",
          value: workingCapital,
          basis: "movement",
          codes: wc,
          children: accountLeaves(wc, movement, "movement", cashEffect),
        },
      ],
    },
    {
      id: "cf:investing",
      kind: "group",
      labelAr: "الأنشطة الاستثمارية",
      labelEn: "Investing activities",
      value: cf.investing,
      basis: "movement",
      codes: inv,
      totalLabelAr: "صافي النقد من الأنشطة الاستثمارية",
      totalLabelEn: "Net cash from investing activities",
      children: accountLeaves(inv, movement, "movement", cashEffect),
    },
    {
      id: "cf:financing",
      kind: "group",
      labelAr: "الأنشطة التمويلية",
      labelEn: "Financing activities",
      value: cf.financing,
      basis: "movement",
      codes: fin,
      totalLabelAr: "صافي النقد من الأنشطة التمويلية",
      totalLabelEn: "Net cash from financing activities",
      children: accountLeaves(fin, movement, "movement", cashEffect),
    },
    { id: "cf:net", kind: "total", labelAr: "صافي التغير في النقد", labelEn: "Net change in cash", value: cf.netChange, basis: "movement", codes: ["1101"] },
    {
      id: "cf:opening",
      kind: "line",
      labelAr: "النقد في بداية الفترة",
      labelEn: "Cash at beginning of period",
      value: cf.openingCash,
      basis: "opening",
      codes: ["1101"],
      children: accountLeaves(["1101"], opening, "opening"),
    },
    {
      id: "cf:closing",
      kind: "total",
      labelAr: "النقد في نهاية الفترة",
      labelEn: "Cash at end of period",
      value: cf.closingCash,
      basis: "closing",
      codes: ["1101"],
      children: accountLeaves(["1101"], closing, "closing"),
    },
  ]
  return { nodes, statement: cf }
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

/** Ids of every node that can expand — what "expand all" opens. */
export function expandableIds(nodes: TreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.children && n.children.length > 0) {
        out.push(n.id)
        walk(n.children)
      }
    }
  }
  walk(nodes)
  return out
}

/** Groups open, lines and accounts closed — the statement's face with its
 * sections visible, the way it is usually first read. */
export function defaultExpandedIds(nodes: TreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.kind === "group" && n.children && n.children.length > 0) {
        out.push(n.id)
        walk(n.children)
      }
    }
  }
  walk(nodes)
  return out
}

// ---------------------------------------------------------------------------
// Account breakdown — what a clicked figure is made of
// ---------------------------------------------------------------------------

export interface AccountBreakdownRow {
  code: string
  nameAr: string
  nameEn: string
  /** All natural-signed: a credit-natured account shows its credit balance as positive. */
  opening: number
  debit: number
  credit: number
  closing: number
  /** Closing − opening, natural sign. */
  change: number
}

export function accountBreakdown(codes: string[], windows: PeriodWindows): { rows: AccountBreakdownRow[]; totals: Omit<AccountBreakdownRow, "code" | "nameAr" | "nameEn"> } {
  const rows: AccountBreakdownRow[] = []
  const seen = new Set<string>()
  for (const prefix of codes) {
    for (const account of CHART_OF_ACCOUNTS) {
      if (!account.postable || seen.has(account.code) || !account.code.startsWith(prefix)) continue
      const o = windows.opening[account.code]
      const m = windows.movement[account.code]
      const c = windows.closing[account.code]
      if (!o && !m && !c) continue
      seen.add(account.code)
      const opening = round2(naturalSign(account.code, o?.balance ?? 0))
      const closing = round2(naturalSign(account.code, c?.balance ?? 0))
      rows.push({
        code: account.code,
        nameAr: account.nameAr,
        nameEn: account.nameEn,
        opening,
        debit: round2(m?.debit ?? 0),
        credit: round2(m?.credit ?? 0),
        closing,
        change: round2(closing - opening),
      })
    }
  }
  rows.sort((a, b) => (a.code < b.code ? -1 : 1))
  const totals = rows.reduce(
    (t, r) => ({
      opening: round2(t.opening + r.opening),
      debit: round2(t.debit + r.debit),
      credit: round2(t.credit + r.credit),
      closing: round2(t.closing + r.closing),
      change: round2(t.change + r.change),
    }),
    { opening: 0, debit: 0, credit: 0, closing: 0, change: 0 }
  )
  return { rows, totals }
}
