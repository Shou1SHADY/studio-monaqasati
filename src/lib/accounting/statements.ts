// The four statements (القوائم المالية) — income, financial position, cash flow,
// changes in equity — as data, not markup, so the same computation serves the
// screen, the Excel export and the tests.
//
// Each statement is declared as a row spec and evaluated against the balance
// windows from balances.ts. Declaring rather than hand-summing is what keeps the
// statements honest: a new account under an existing rollup appears in its
// statement automatically, instead of silently falling out of a hand-written sum.

import { nodeBalance, nodeNatural, cashFlowMovement, type BalanceMap, type PeriodWindows } from "./balances"
import { round2 } from "./journal"
import { ACC } from "./accounts"

export type StatementRowType = "header" | "line" | "subtotal" | "total"

export interface StatementRow {
  type: StatementRowType
  labelAr: string
  labelEn: string
  /** Account codes rolled into this row. Absent on computed rows. */
  codes?: string[]
  /** Names the value so later rows can compute from it. */
  key?: string
  value: number | null
}

// ---------------------------------------------------------------------------
// Income statement (قائمة الدخل)
// ---------------------------------------------------------------------------

interface IsSpec {
  type: StatementRowType
  ar: string
  en: string
  codes?: string[]
  key?: string
  calc?: (acc: Record<string, number>) => number
}

const INCOME_STATEMENT_SPEC: IsSpec[] = [
  { type: "header", ar: "الإيرادات", en: "Revenue" },
  { type: "line", ar: "إيرادات عقود المقاولات", en: "Construction contract revenue", codes: ["4101"] },
  { type: "line", ar: "إيرادات أخرى", en: "Other income", codes: ["42"] },
  { type: "subtotal", ar: "إجمالي الإيرادات", en: "Total revenue", codes: ["4"], key: "revenue" },
  { type: "header", ar: "تكلفة الإيراد", en: "Cost of revenue" },
  { type: "line", ar: "مواد", en: "Materials", codes: ["5101"] },
  { type: "line", ar: "عمالة مباشرة", en: "Direct labour", codes: ["5102"] },
  { type: "line", ar: "مقاولون من الباطن", en: "Subcontractors", codes: ["5103"] },
  { type: "line", ar: "معدات وتشغيل", en: "Plant & operations", codes: ["5104"] },
  { type: "line", ar: "مصروفات مشروع مباشرة", en: "Direct project costs", codes: ["5105"] },
  { type: "line", ar: "إهلاك معدات المشاريع", en: "Plant depreciation", codes: ["5106"] },
  { type: "subtotal", ar: "إجمالي تكلفة الإيراد", en: "Total cost of revenue", codes: ["51"], key: "cogs" },
  { type: "total", ar: "مجمل الربح", en: "Gross profit", key: "grossProfit", calc: (a) => a.revenue - a.cogs },
  { type: "header", ar: "المصروفات التشغيلية", en: "Operating expenses" },
  { type: "line", ar: "مصروفات إدارية وعمومية", en: "General & administrative", codes: ["5201"] },
  { type: "line", ar: "مصروفات بيع وتسويق", en: "Selling & marketing", codes: ["5202"] },
  { type: "line", ar: "إهلاك الأصول الإدارية", en: "Administrative depreciation", codes: ["5203"] },
  { type: "subtotal", ar: "إجمالي المصروفات التشغيلية", en: "Total operating expenses", codes: ["52"], key: "opex" },
  { type: "total", ar: "الربح التشغيلي", en: "Operating profit", key: "operating", calc: (a) => a.grossProfit - a.opex },
  { type: "line", ar: "أعباء تمويل", en: "Finance costs", codes: ["53"], key: "finance" },
  { type: "total", ar: "الربح قبل الزكاة", en: "Profit before zakat", key: "beforeZakat", calc: (a) => a.operating - a.finance },
  { type: "line", ar: "الزكاة", en: "Zakat", codes: ["54"], key: "zakat" },
  { type: "total", ar: "صافي ربح الفترة", en: "Net profit for the period", key: "netProfit", calc: (a) => a.beforeZakat - a.zakat },
]

export interface IncomeStatement {
  rows: StatementRow[]
  totals: Record<string, number>
}

export function incomeStatement(movement: BalanceMap): IncomeStatement {
  const totals: Record<string, number> = {}
  const rows: StatementRow[] = []
  for (const spec of INCOME_STATEMENT_SPEC) {
    let value: number | null = null
    if (spec.calc) value = round2(spec.calc(totals))
    else if (spec.codes) {
      // Revenue is credit-natured and cost debit-natured; taking the absolute of
      // the natural balance lets both read as positive magnitudes on the face of
      // the statement, which is how a reader expects to see them.
      value = round2(spec.codes.reduce((sum, code) => sum + Math.abs(nodeNatural(movement, code)), 0))
    }
    if (spec.key) totals[spec.key] = value || 0
    rows.push({ type: spec.type, labelAr: spec.ar, labelEn: spec.en, codes: spec.codes, key: spec.key, value })
  }
  return { rows, totals }
}

/** Net profit straight from the ledger — revenue less expenses, no spec walk. */
export function netProfit(movement: BalanceMap): number {
  const revenue = Math.abs(nodeNatural(movement, "4"))
  const expenses = Math.abs(nodeNatural(movement, "5"))
  return round2(revenue - expenses)
}

// ---------------------------------------------------------------------------
// Statement of financial position (قائمة المركز المالي)
// ---------------------------------------------------------------------------

export interface BalanceSheetSection {
  labelAr: string
  labelEn: string
  rows: Array<{ code: string; labelAr: string; labelEn: string; value: number }>
  total: number
}

export interface BalanceSheet {
  currentAssets: BalanceSheetSection
  nonCurrentAssets: BalanceSheetSection
  currentLiabilities: BalanceSheetSection
  nonCurrentLiabilities: BalanceSheetSection
  equity: BalanceSheetSection
  totalAssets: number
  totalLiabilitiesAndEquity: number
  /** Assets − (liabilities + equity). Non-zero means the ledger is broken. */
  difference: number
}

type SectionSpec = [string, string, Array<[string, string, string]>]

const BS_SPEC: Record<string, SectionSpec> = {
  currentAssets: ["الأصول المتداولة", "Current assets", [
    ["1101", "النقد وما في حكمه", "Cash and cash equivalents"],
    [ACC.clientsReceivable, "عملاء — عقود ومستخلصات", "Clients — contracts & certificates"],
    [ACC.doubtfulAllowance, "مخصص ديون مشكوك في تحصيلها", "Allowance for doubtful debts"],
    [ACC.retentionReceivable, "محتجزات لدى العملاء", "Retention receivable"],
    [ACC.contractAsset, "أعمال منفذة غير مفوترة", "Unbilled work (contract asset)"],
    ["1104", "المخزون", "Inventory"],
    [ACC.advancesToSuppliers, "دفعات مقدمة للموردين", "Advances to suppliers"],
    [ACC.vatInput, "ضريبة القيمة المضافة — مدخلات", "VAT — input"],
    [ACC.prepaidExpenses, "مصروفات مدفوعة مقدماً", "Prepaid expenses"],
    [ACC.refundableDeposits, "تأمينات مستردة", "Refundable deposits"],
    [ACC.guaranteeCashMargin, "هامش نقدي مقابل خطابات الضمان", "Cash margin on guarantees"],
  ]],
  nonCurrentAssets: ["الأصول غير المتداولة", "Non-current assets", [
    ["1201", "الأصول الثابتة — بالتكلفة", "PPE — at cost"],
    ["1202", "مجمع الإهلاك", "Accumulated depreciation"],
  ]],
  currentLiabilities: ["الخصوم المتداولة", "Current liabilities", [
    [ACC.suppliersPayable, "موردون ومقاولو باطن", "Suppliers & subcontractors"],
    [ACC.subcontractorRetentionPayable, "محتجزات مستحقة لمقاولي الباطن", "Retention payable to subcontractors"],
    [ACC.advancesFromClients, "دفعات مقدمة من العملاء", "Advances from clients"],
    [ACC.contractLiability, "فواتير تفوق الأعمال المنفذة", "Billings in excess of work"],
    [ACC.employeeAccruals, "مستحقات الموظفين", "Employee accruals"],
    ["2103", "التزامات ضريبية وزكوية", "Tax & zakat liabilities"],
  ]],
  nonCurrentLiabilities: ["الخصوم غير المتداولة", "Non-current liabilities", [
    [ACC.bankLoan, "قروض طويلة الأجل", "Long-term loans"],
    [ACC.endOfServiceProvision, "مخصص مكافأة نهاية الخدمة", "End-of-service provision"],
  ]],
  equity: ["حقوق الملكية", "Equity", [
    [ACC.paidInCapital, "رأس المال المدفوع", "Paid-in capital"],
    [ACC.retainedEarnings, "أرباح مبقاة — مرحّلة", "Retained earnings brought forward"],
  ]],
}

function section(map: BalanceMap, spec: SectionSpec): BalanceSheetSection {
  const rows = spec[2].map(([code, labelAr, labelEn]) => ({
    code,
    labelAr,
    labelEn,
    value: nodeNatural(map, code),
  }))
  return { labelAr: spec[0], labelEn: spec[1], rows, total: round2(rows.reduce((s, r) => s + r.value, 0)) }
}

/**
 * The balance sheet at `closing`, with the period's own profit added into
 * equity.
 *
 * That last part is what makes it balance before year-end close: revenue and
 * expense accounts still hold their balances (they are only zeroed at closing),
 * so the profit they represent has not yet reached retained earnings. Adding it
 * here is the same adjustment a closing entry would make permanent.
 */
export function balanceSheet(closing: BalanceMap): BalanceSheet {
  const currentAssets = section(closing, BS_SPEC.currentAssets)
  const nonCurrentAssets = section(closing, BS_SPEC.nonCurrentAssets)
  const currentLiabilities = section(closing, BS_SPEC.currentLiabilities)
  const nonCurrentLiabilities = section(closing, BS_SPEC.nonCurrentLiabilities)

  const equity = section(closing, BS_SPEC.equity)
  // Every unclosed period's result, not just this one: closing balances still
  // carry revenue and expenses from prior periods too.
  equity.rows.push({
    code: "__result",
    labelAr: "نتيجة الفترة والفترات السابقة",
    labelEn: "Result for the period and prior periods",
    value: netProfit(closing),
  })
  equity.total = round2(equity.rows.reduce((s, r) => s + r.value, 0))

  const totalAssets = round2(currentAssets.total + nonCurrentAssets.total)
  const totalLiabilitiesAndEquity = round2(
    currentLiabilities.total + nonCurrentLiabilities.total + equity.total
  )
  return {
    currentAssets,
    nonCurrentAssets,
    currentLiabilities,
    nonCurrentLiabilities,
    equity,
    totalAssets,
    totalLiabilitiesAndEquity,
    difference: round2(totalAssets - totalLiabilitiesAndEquity),
  }
}

// ---------------------------------------------------------------------------
// Cash flow (قائمة التدفق النقدي) — indirect method
// ---------------------------------------------------------------------------

export interface CashFlowStatement {
  rows: StatementRow[]
  operating: number
  investing: number
  financing: number
  netChange: number
  openingCash: number
  closingCash: number
  /** Opening + net change − closing. Non-zero means a tagging error. */
  difference: number
}

/**
 * Indirect cash flow, derived entirely from the `cashFlow` tag on each account.
 *
 * The identity that makes it work: every entry balances, so the movement of the
 * cash accounts equals the negated movement of everything else. Profit plus the
 * non-cash add-backs plus working-capital swings therefore reconciles to the
 * actual bank movement — and `difference` proves it did on every render.
 */
export function cashFlowStatement(windows: PeriodWindows): CashFlowStatement {
  const { movement, opening, closing } = windows

  const profit = netProfit(movement)
  // Depreciation lives as a credit on the accumulated-depreciation account;
  // its movement is negative, so negating gives the positive add-back.
  const depreciation = round2(-cashFlowMovement(movement, "dep"))
  // A working-capital asset going up consumes cash — hence the sign flip.
  const workingCapital = round2(-cashFlowMovement(movement, "wc"))
  const operating = round2(profit + depreciation + workingCapital)

  const investing = round2(-cashFlowMovement(movement, "inv"))
  const financing = round2(-cashFlowMovement(movement, "fin"))
  const netChange = round2(operating + investing + financing)

  const openingCash = round2(nodeBalance(opening, "1101"))
  const closingCash = round2(nodeBalance(closing, "1101"))

  const rows: StatementRow[] = [
    { type: "header", labelAr: "التدفق النقدي من الأنشطة التشغيلية", labelEn: "Operating activities", value: null },
    { type: "line", labelAr: "صافي ربح الفترة", labelEn: "Net profit for the period", value: profit },
    { type: "line", labelAr: "إهلاك (مصروف غير نقدي)", labelEn: "Depreciation (non-cash)", value: depreciation },
    { type: "line", labelAr: "التغير في رأس المال العامل", labelEn: "Change in working capital", value: workingCapital },
    { type: "subtotal", labelAr: "صافي النقد من الأنشطة التشغيلية", labelEn: "Net cash from operating activities", key: "operating", value: operating },
    { type: "header", labelAr: "الأنشطة الاستثمارية", labelEn: "Investing activities", value: null },
    { type: "subtotal", labelAr: "صافي النقد من الأنشطة الاستثمارية", labelEn: "Net cash from investing activities", key: "investing", value: investing },
    { type: "header", labelAr: "الأنشطة التمويلية", labelEn: "Financing activities", value: null },
    { type: "subtotal", labelAr: "صافي النقد من الأنشطة التمويلية", labelEn: "Net cash from financing activities", key: "financing", value: financing },
    { type: "total", labelAr: "صافي التغير في النقد", labelEn: "Net change in cash", key: "netChange", value: netChange },
    { type: "line", labelAr: "النقد في بداية الفترة", labelEn: "Cash at beginning of period", value: openingCash },
    { type: "total", labelAr: "النقد في نهاية الفترة", labelEn: "Cash at end of period", value: closingCash },
  ]

  return {
    rows,
    operating,
    investing,
    financing,
    netChange,
    openingCash,
    closingCash,
    difference: round2(openingCash + netChange - closingCash),
  }
}

// ---------------------------------------------------------------------------
// Changes in equity (التغيرات في حقوق الملكية)
// ---------------------------------------------------------------------------

export interface EquityStatementRow {
  labelAr: string
  labelEn: string
  capital: number
  retained: number
  total: number
}

export function equityStatement(windows: PeriodWindows): { rows: EquityStatementRow[]; closingTotal: number } {
  const openingCapital = nodeNatural(windows.opening, ACC.paidInCapital)
  const openingRetained = round2(nodeNatural(windows.opening, ACC.retainedEarnings) + netProfit(windows.opening))
  const capitalMovement = nodeNatural(windows.movement, ACC.paidInCapital)
  const profit = netProfit(windows.movement)

  const rows: EquityStatementRow[] = [
    {
      labelAr: "الرصيد في بداية الفترة",
      labelEn: "Balance at beginning of period",
      capital: openingCapital,
      retained: openingRetained,
      total: round2(openingCapital + openingRetained),
    },
    {
      labelAr: "زيادة رأس المال",
      labelEn: "Capital introduced",
      capital: capitalMovement,
      retained: 0,
      total: capitalMovement,
    },
    {
      labelAr: "صافي ربح الفترة",
      labelEn: "Net profit for the period",
      capital: 0,
      retained: profit,
      total: profit,
    },
  ]
  const closing: EquityStatementRow = {
    labelAr: "الرصيد في نهاية الفترة",
    labelEn: "Balance at end of period",
    capital: round2(openingCapital + capitalMovement),
    retained: round2(openingRetained + profit),
    total: round2(openingCapital + capitalMovement + openingRetained + profit),
  }
  rows.push(closing)
  return { rows, closingTotal: closing.total }
}

// ---------------------------------------------------------------------------
// Where money is locked (أين المال محبوس)
//
// An executive read of the balance sheet: real assets that cannot be spent
// today, each with the reason it is held and the screen that releases it.
// ---------------------------------------------------------------------------

export interface LockedCashRow {
  code: string
  labelAr: string
  labelEn: string
  value: number
  reasonAr: string
}

export function lockedCash(closing: BalanceMap): {
  availableCash: number
  rows: LockedCashRow[]
  total: number
  ratio: number
} {
  const availableCash = nodeNatural(closing, "1101")
  const candidates: Array<[string, string, string, string]> = [
    [ACC.clientsReceivable, "ذمم العملاء", "Client receivables", "فواتير ومستخلصات صدرت ولم تُحصّل بعد"],
    [ACC.retentionReceivable, "محتجزات لدى العملاء", "Retention receivable", "تُفرج عند التسليم النهائي وانتهاء فترة الضمان"],
    [ACC.contractAsset, "أعمال منفذة غير مفوترة", "Unbilled work", "أعمال نُفّذت ولم تُقدَّم بمستخلص بعد — قدّم المستخلص"],
    ["1104", "المخزون", "Inventory", "مواد وبضاعة قائمة — تتحول لنقد عند الصرف أو البيع"],
    [ACC.advancesToSuppliers, "دفعات مقدمة للموردين", "Advances to suppliers", "دُفعت مقدماً وتُخصم من فواتير قادمة"],
    [ACC.vatInput, "ضريبة القيمة المضافة — مدخلات", "VAT input", "تُخصم من ضريبة المخرجات في الإقرار القادم"],
    [ACC.guaranteeCashMargin, "هامش نقدي مقابل خطابات الضمان", "Guarantee cash margin", "محجوز لدى البنك حتى انتهاء الضمان"],
    [ACC.refundableDeposits, "تأمينات مستردة", "Refundable deposits", "تُسترد من الجهات عند إغلاق الأعمال"],
    [ACC.prepaidExpenses, "مصروفات مدفوعة مقدماً", "Prepaid expenses", "تُطفأ على أشهر الفترة"],
  ]
  const rows = candidates
    .map(([code, labelAr, labelEn, reasonAr]) => ({ code, labelAr, labelEn, reasonAr, value: nodeNatural(closing, code) }))
    .filter((r) => r.value > 0.5)
    .sort((a, b) => b.value - a.value)
  const total = round2(rows.reduce((s, r) => s + r.value, 0))
  return { availableCash, rows, total, ratio: availableCash > 0 ? round2(total / availableCash) : 0 }
}
