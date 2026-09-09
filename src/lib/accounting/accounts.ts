// Chart of accounts (دليل الحسابات) — the catalog every journal line points at.
//
// Codes encode the tree: 1 digit = type, 2 = group, 4 = sub-group, 6 = the
// postable leaf. A line may only ever hit a leaf (`postable`), never a rollup —
// posting to a rollup would double-count it in every report that sums children.
//
// `nature` is the side that INCREASES the account (D debit, C credit); reports
// flip a balance into its natural sign for display. `cashFlow` tags the leaf for
// the indirect cash-flow statement:
//   cash — the cash line itself      wc  — working-capital movement
//   dep  — a non-cash add-back       inv — investing        fin — financing
// Leaves with no tag never reach the cash-flow statement (P&L accounts roll up
// through net profit instead).
//
// This catalog is the DEFAULT seed. An org's live accounts are copies in
// `accounting_accounts`, so a company may rename or add leaves without the
// platform's catalog changing under it.

export type AccountNature = "D" | "C"
export type CashFlowClass = "cash" | "wc" | "dep" | "inv" | "fin"
/** 1 assets · 2 liabilities · 3 equity · 4 revenue · 5 expenses */
export type AccountType = "1" | "2" | "3" | "4" | "5"

export interface AccountDef {
  code: string
  nameAr: string
  nameEn: string
  nature: AccountNature
  cashFlow: CashFlowClass | null
  postable: boolean
}

export interface Account extends AccountDef {
  /** 1–4, derived from code length. */
  level: number
  parent: string | null
  type: AccountType
}

type Row = [string, string, string, AccountNature, CashFlowClass | null, boolean]

const ROWS: Row[] = [
  ["1", "الأصول", "Assets", "D", null, false],
  ["11", "الأصول المتداولة", "Current assets", "D", null, false],
  ["1101", "النقد وما في حكمه", "Cash and cash equivalents", "D", null, false],
  ["110101", "الصندوق", "Petty cash", "D", "cash", true],
  ["110102", "البنك الأهلي — الحساب الجاري", "SNB — current account", "D", "cash", true],
  ["110103", "مصرف الراجحي — حساب المشاريع", "Al Rajhi — projects account", "D", "cash", true],
  ["1102", "الذمم المدينة", "Trade receivables", "D", null, false],
  ["110201", "عملاء — عقود ومستخلصات", "Clients — contracts & certificates", "D", "wc", true],
  ["110202", "محتجزات لدى العملاء", "Retention receivable", "D", "wc", true],
  ["110203", "مخصص ديون مشكوك في تحصيلها", "Allowance for doubtful debts", "C", "wc", true],
  ["1103", "أصول العقود", "Contract assets", "D", null, false],
  ["110301", "أعمال منفذة غير مفوترة (أصل عقدي)", "Unbilled work (contract asset)", "D", "wc", true],
  ["1104", "المخزون", "Inventory", "D", null, false],
  ["110401", "مخزون مواد إنشائية", "Construction materials", "D", "wc", true],
  // Manufacturing leaves. The reference chart is construction-only; this
  // platform also runs work orders, and their value must rest somewhere real
  // between leaving raw stock and being sold — never in an expense account,
  // which would recognise a cost before the sale that earns it.
  ["110402", "بضاعة تحت التصنيع", "Work in progress", "D", "wc", true],
  ["110403", "مخزون تام الصنع", "Finished goods", "D", "wc", true],
  ["1105", "أرصدة مدينة أخرى", "Other receivables", "D", null, false],
  ["110501", "دفعات مقدمة للموردين", "Advances to suppliers", "D", "wc", true],
  ["110502", "ضريبة القيمة المضافة — مدخلات", "VAT — input", "D", "wc", true],
  ["110503", "مصروفات مدفوعة مقدماً", "Prepaid expenses", "D", "wc", true],
  ["110504", "تأمينات مستردة لدى الجهات", "Refundable deposits", "D", "wc", true],
  ["110505", "هامش نقدي مقابل خطابات الضمان", "Cash margin on guarantees", "D", "wc", true],
  ["12", "الأصول غير المتداولة", "Non-current assets", "D", null, false],
  ["1201", "الأصول الثابتة", "Property, plant & equipment", "D", null, false],
  ["120101", "معدات وآليات", "Plant & machinery", "D", "inv", true],
  ["120102", "سيارات ومركبات", "Vehicles", "D", "inv", true],
  ["120103", "أجهزة ومعدات مكتبية", "Office equipment", "D", "inv", true],
  ["1202", "مجمع الإهلاك", "Accumulated depreciation", "C", null, false],
  ["120201", "مجمع إهلاك الأصول الثابتة", "Accumulated depreciation", "C", "dep", true],
  ["2", "الخصوم", "Liabilities", "C", null, false],
  ["21", "الخصوم المتداولة", "Current liabilities", "C", null, false],
  ["2101", "الذمم الدائنة", "Trade payables", "C", null, false],
  ["210101", "موردون ومقاولو باطن", "Suppliers & subcontractors", "C", "wc", true],
  ["210102", "محتجزات مستحقة لمقاولي الباطن", "Retention payable to subcontractors", "C", "wc", true],
  ["2102", "مستحقات ودفعات مقدمة", "Accruals & advances", "C", null, false],
  ["210201", "دفعات مقدمة من العملاء", "Advances from clients", "C", "wc", true],
  ["210202", "مستحقات الموظفين (رواتب وتأمينات)", "Employee accruals", "C", "wc", true],
  ["210203", "فواتير تفوق الأعمال المنفذة (التزام عقدي)", "Billings in excess of work (contract liability)", "C", "wc", true],
  ["2103", "التزامات ضريبية وزكوية", "Tax & zakat liabilities", "C", null, false],
  ["210301", "ضريبة القيمة المضافة — مخرجات", "VAT — output", "C", "wc", true],
  ["210302", "ضريبة استقطاع مستحقة", "Withholding tax payable", "C", "wc", true],
  ["210303", "الزكاة المستحقة", "Zakat payable", "C", "wc", true],
  ["22", "الخصوم غير المتداولة", "Non-current liabilities", "C", null, false],
  ["2201", "قروض طويلة الأجل", "Long-term loans", "C", null, false],
  ["220101", "قرض بنكي — تمويل معدات", "Bank loan — equipment finance", "C", "fin", true],
  ["2202", "التزامات الموظفين طويلة الأجل", "Long-term employee obligations", "C", null, false],
  ["220201", "مخصص مكافأة نهاية الخدمة", "End-of-service provision", "C", "wc", true],
  ["3", "حقوق الملكية", "Equity", "C", null, false],
  ["31", "رأس المال", "Share capital", "C", null, false],
  ["3101", "رأس المال المدفوع", "Paid-in capital", "C", null, false],
  ["310101", "رأس المال المدفوع", "Paid-in capital", "C", "fin", true],
  ["32", "الأرباح المبقاة", "Retained earnings", "C", null, false],
  ["3201", "الأرباح المبقاة", "Retained earnings", "C", null, false],
  ["320101", "أرباح مبقاة — مرحّلة", "Retained earnings brought forward", "C", "fin", true],
  ["4", "الإيرادات", "Revenue", "C", null, false],
  ["41", "إيرادات العقود والمبيعات", "Contract & sales revenue", "C", null, false],
  ["4101", "إيرادات عقود المقاولات", "Construction contract revenue", "C", null, false],
  ["410101", "إيرادات عقود — مستخلصات معتمدة", "Contract revenue — certified", "C", null, true],
  ["42", "إيرادات أخرى", "Other income", "C", null, false],
  ["4201", "إيرادات متنوعة", "Sundry income", "C", null, false],
  ["420101", "إيرادات متنوعة", "Sundry income", "C", null, true],
  ["5", "المصروفات", "Expenses", "D", null, false],
  ["51", "تكلفة الإيراد", "Cost of revenue", "D", null, false],
  ["5101", "مواد", "Materials", "D", null, false],
  ["510101", "مواد إنشائية", "Construction materials", "D", null, true],
  ["5102", "عمالة مباشرة", "Direct labour", "D", null, false],
  ["510201", "أجور عمالة المشاريع", "Project labour wages", "D", null, true],
  ["5103", "مقاولون من الباطن", "Subcontractors", "D", null, false],
  ["510301", "أعمال مقاولي الباطن", "Subcontracted works", "D", null, true],
  ["5104", "معدات وتشغيل", "Plant & operations", "D", null, false],
  ["510401", "إيجار معدات ووقود", "Plant hire & fuel", "D", null, true],
  ["5105", "مصروفات مشروع مباشرة", "Direct project costs", "D", null, false],
  ["510501", "مصروفات موقع مباشرة", "Direct site costs", "D", null, true],
  ["5106", "إهلاك معدات المشاريع", "Plant depreciation", "D", null, false],
  ["510601", "إهلاك المعدات والآليات الإنشائية", "Depreciation — construction plant", "D", null, true],
  ["52", "المصروفات التشغيلية", "Operating expenses", "D", null, false],
  ["5201", "إدارية وعمومية", "General & administrative", "D", null, false],
  ["520101", "رواتب إدارية", "Administrative salaries", "D", null, true],
  ["520102", "إيجارات ومرافق", "Rent & utilities", "D", null, true],
  ["520103", "مصروفات مكتبية واتصالات", "Office & communications", "D", null, true],
  ["520104", "أتعاب مهنية واستشارات", "Professional fees", "D", null, true],
  ["520105", "مخصص ديون مشكوك في تحصيلها", "Allowance for doubtful debts", "D", null, true],
  ["5202", "بيع وتسويق", "Selling & marketing", "D", null, false],
  ["520201", "دعاية وتسويق", "Advertising & marketing", "D", null, true],
  ["5203", "الإهلاك", "Depreciation", "D", null, false],
  ["520301", "إهلاك الأصول الإدارية", "Depreciation — administrative assets", "D", null, true],
  ["53", "أعباء تمويل", "Finance costs", "D", null, false],
  ["5301", "فوائد ورسوم بنكية", "Interest & bank charges", "D", null, false],
  ["530101", "فوائد ورسوم بنكية", "Interest & bank charges", "D", null, true],
  ["54", "الزكاة", "Zakat", "D", null, false],
  ["5401", "الزكاة الشرعية", "Zakat", "D", null, false],
  ["540101", "الزكاة الشرعية", "Zakat", "D", null, true],
]

function levelOf(code: string): number {
  return code.length === 1 ? 1 : code.length === 2 ? 2 : code.length === 4 ? 3 : 4
}

function parentOf(code: string): string | null {
  const level = levelOf(code)
  if (level === 1) return null
  if (level === 2) return code.slice(0, 1)
  if (level === 3) return code.slice(0, 2)
  return code.slice(0, 4)
}

export const CHART_OF_ACCOUNTS: Account[] = ROWS.map(([code, nameAr, nameEn, nature, cashFlow, postable]) => ({
  code,
  nameAr,
  nameEn,
  nature,
  cashFlow,
  postable,
  level: levelOf(code),
  parent: parentOf(code),
  type: code[0] as AccountType,
}))

export const ACCOUNT_BY_CODE: Record<string, Account> = Object.fromEntries(
  CHART_OF_ACCOUNTS.map((a) => [a.code, a])
)

/** Only these may carry a journal line. */
export const POSTABLE_ACCOUNTS = CHART_OF_ACCOUNTS.filter((a) => a.postable)

export function accountName(code: string, locale = "ar"): string {
  const a = ACCOUNT_BY_CODE[code]
  if (!a) return code
  return locale === "ar" ? a.nameAr : a.nameEn
}

export function isPostable(code: string): boolean {
  return ACCOUNT_BY_CODE[code]?.postable === true
}

export function childrenOf(code: string): Account[] {
  return CHART_OF_ACCOUNTS.filter((a) => a.parent === code)
}

/**
 * Every account whose code sits under `code` in the tree, itself included.
 * Rollups are computed by code prefix, which is why the code scheme is fixed
 * width per level — "11" must never also prefix an unrelated branch.
 */
export function descendantsOf(code: string): Account[] {
  return CHART_OF_ACCOUNTS.filter((a) => a.code.startsWith(code))
}

/**
 * A balance's sign for display. Debit-natured types (assets, expenses) read
 * straight; credit-natured ones (liabilities, equity, revenue) are negated so a
 * credit balance shows as a positive figure on the statement.
 */
export function naturalSign(code: string, signedBalance: number): number {
  return code[0] === "1" || code[0] === "5" ? signedBalance : -signedBalance
}

// ---------------------------------------------------------------------------
// Named accounts
//
// Posting rules reference accounts through these constants, never through a
// literal code: an org that renames or re-numbers a leaf changes the mapping in
// one place instead of hunting string literals through the rule registry.
// ---------------------------------------------------------------------------

export const ACC = {
  pettyCash: "110101",
  bankMain: "110102",
  bankProjects: "110103",
  clientsReceivable: "110201",
  retentionReceivable: "110202",
  doubtfulAllowance: "110203",
  contractAsset: "110301",
  inventoryMaterials: "110401",
  inventoryWip: "110402",
  inventoryFinishedGoods: "110403",
  advancesToSuppliers: "110501",
  vatInput: "110502",
  prepaidExpenses: "110503",
  refundableDeposits: "110504",
  guaranteeCashMargin: "110505",
  plantAndMachinery: "120101",
  vehicles: "120102",
  officeEquipment: "120103",
  accumulatedDepreciation: "120201",
  suppliersPayable: "210101",
  subcontractorRetentionPayable: "210102",
  advancesFromClients: "210201",
  employeeAccruals: "210202",
  contractLiability: "210203",
  vatOutput: "210301",
  withholdingTaxPayable: "210302",
  zakatPayable: "210303",
  bankLoan: "220101",
  endOfServiceProvision: "220201",
  paidInCapital: "310101",
  retainedEarnings: "320101",
  contractRevenue: "410101",
  sundryIncome: "420101",
  costMaterials: "510101",
  costLabour: "510201",
  costSubcontractors: "510301",
  costPlantHire: "510401",
  costDirectSite: "510501",
  costPlantDepreciation: "510601",
  adminSalaries: "520101",
  rentAndUtilities: "520102",
  officeAndComms: "520103",
  professionalFees: "520104",
  doubtfulDebtExpense: "520105",
  marketing: "520201",
  adminDepreciation: "520301",
  financeCharges: "530101",
  zakatExpense: "540101",
} as const

export type NamedAccount = keyof typeof ACC
