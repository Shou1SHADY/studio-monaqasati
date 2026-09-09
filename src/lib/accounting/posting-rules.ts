// Posting rules — the translation layer between a business event and the debits
// and credits that record it.
//
// This file is the whole integration contract. Every module that moves money
// (IPC, Sales, Manufacturing, Inventory, Payroll) describes WHAT happened;
// nothing outside this file decides WHICH accounts move. Two consequences worth
// keeping: an accountant can audit the company's entire posting policy by
// reading one file, and a change of policy (say, waste to its own expense line)
// is a change here rather than a hunt through UI components.
//
// Every rule returns unbalanced-by-construction line arrays that `buildEntry`
// then validates — the rule states intent, the journal enforces the invariant.

import { ACC } from "./accounts"
import { round2, type JournalLine, type SourceType } from "./journal"

type Line = Partial<JournalLine> & { account: string }

export interface PostingContext {
  organizationId: string
  userId: string
  userName: string
  /** Applied to lines that do not set their own. */
  branch?: string | null
}

export interface PostingResult {
  sourceType: SourceType
  sourceId: string
  date: string
  description: string
  lines: Line[]
  costCenter: string
  /** True when the rule found nothing to post (a zero-value document). */
  empty?: boolean
}

/**
 * Default cost centres. Real orgs configure their own; these keep every line
 * classified so the "every line has a cost centre" integrity check passes from
 * the first entry rather than after a migration.
 */
export const COST_CENTERS = {
  execution: "C1",
  projects: "C2",
  admin: "C3",
  procurement: "C4",
} as const

export const DEFAULT_COST_CENTERS = [
  { code: "C1", nameAr: "التنفيذ", nameEn: "Execution" },
  { code: "C2", nameAr: "إدارة المشاريع", nameEn: "Project management" },
  { code: "C3", nameAr: "الإدارة العامة", nameEn: "General administration" },
  { code: "C4", nameAr: "المشتريات والمخزون", nameEn: "Procurement & inventory" },
]

// ---------------------------------------------------------------------------
// 1. IPC claim submitted (مستخلص)
// ---------------------------------------------------------------------------

export interface IpcClaimEvent {
  claimId: string
  claimNumber: number
  projectId: string
  projectName?: string | null
  date: string
  /** Value of work certified this period, before any deduction. */
  gross: number
  retention: number
  advanceRecovery: number
  vat: number
  /** gross − retention − advanceRecovery + vat. */
  net: number
  clientId?: string | null
  clientName?: string | null
}

/**
 * Certifying work is the revenue event, not collecting the cash.
 *
 * The gross value becomes revenue; the money is then split by where it actually
 * sits: the net is a receivable, the retention is a receivable the client holds
 * back until handover, and the advance recovery repays part of what the client
 * already paid in. VAT is a liability from the moment the certificate issues,
 * whether or not it has been collected.
 */
export function postIpcClaim(e: IpcClaimEvent): PostingResult {
  const dim = { project: e.projectId, projectName: e.projectName ?? null, party: e.clientId ?? null, partyName: e.clientName ?? null }
  return {
    sourceType: "ipc_claim",
    sourceId: e.claimId,
    date: e.date,
    description: `مستخلص رقم ${e.claimNumber}${e.projectName ? ` — ${e.projectName}` : ""}`,
    costCenter: COST_CENTERS.projects,
    lines: [
      { ...dim, account: ACC.clientsReceivable, debit: e.net, note: "صافي مستحق" },
      { ...dim, account: ACC.retentionReceivable, debit: e.retention, note: "محتجز" },
      { ...dim, account: ACC.advancesFromClients, debit: e.advanceRecovery, note: "استرداد دفعة مقدمة" },
      { ...dim, account: ACC.contractRevenue, credit: e.gross, note: "قيمة أعمال منجزة" },
      { ...dim, account: ACC.vatOutput, credit: e.vat, note: "ضريبة القيمة المضافة — مخرجات" },
    ],
    empty: round2(e.gross) === 0,
  }
}

// ---------------------------------------------------------------------------
// 2. IPC claim collected
// ---------------------------------------------------------------------------

export interface IpcCollectionEvent {
  claimId: string
  claimNumber: number
  projectId: string
  projectName?: string | null
  date: string
  amount: number
  bankAccount?: string
  clientId?: string | null
  clientName?: string | null
}

/** Cash arrives and the receivable it settles disappears. No revenue here — that
 * was recognised when the work was certified. */
export function postIpcCollection(e: IpcCollectionEvent): PostingResult {
  const dim = { project: e.projectId, projectName: e.projectName ?? null, party: e.clientId ?? null, partyName: e.clientName ?? null }
  return {
    sourceType: "ipc_collection",
    sourceId: e.claimId,
    date: e.date,
    description: `تحصيل مستخلص رقم ${e.claimNumber}${e.projectName ? ` — ${e.projectName}` : ""}`,
    costCenter: COST_CENTERS.admin,
    lines: [
      { ...dim, account: e.bankAccount || ACC.bankMain, debit: e.amount, note: "تحصيل" },
      { ...dim, account: ACC.clientsReceivable, credit: e.amount, note: `سداد مستخلص ${e.claimNumber}` },
    ],
    empty: round2(e.amount) === 0,
  }
}

// ---------------------------------------------------------------------------
// 3. Sales quotation accepted
// ---------------------------------------------------------------------------

export interface SalesQuotationEvent {
  quotationId: string
  quotationNumber: string
  date: string
  /** Total including nothing — VAT is derived below. */
  amount: number
  vatPercent: number
  contactId: string
  contactName?: string | null
  /** A post-manufacturing sale delivers immediately; a pre-manufacturing one is
   * an order that still has to be produced. */
  phase: "pre_manufacturing" | "post_manufacturing"
}

/**
 * Acceptance is the sale.
 *
 * The customer now owes the amount plus VAT, and the business has earned the
 * revenue. A pre-manufacturing acceptance is an order rather than a delivery, so
 * it posts nothing until the goods exist — recognising revenue on an order the
 * factory has not built yet would overstate both revenue and receivables.
 */
export function postSalesQuotationAccepted(e: SalesQuotationEvent): PostingResult | null {
  if (e.phase === "pre_manufacturing") return null
  const vat = round2((e.amount * (Number(e.vatPercent) || 0)) / 100)
  const dim = { party: e.contactId, partyName: e.contactName ?? null }
  return {
    sourceType: "sales_quotation",
    sourceId: e.quotationId,
    date: e.date,
    description: `عرض سعر مقبول ${e.quotationNumber}${e.contactName ? ` — ${e.contactName}` : ""}`,
    costCenter: COST_CENTERS.admin,
    lines: [
      { ...dim, account: ACC.clientsReceivable, debit: round2(e.amount + vat), note: "مستحق من العميل" },
      { ...dim, account: ACC.sundryIncome, credit: e.amount, note: "إيراد مبيعات" },
      { ...dim, account: ACC.vatOutput, credit: vat, note: "ضريبة القيمة المضافة — مخرجات" },
    ],
    empty: round2(e.amount) === 0,
  }
}

// ---------------------------------------------------------------------------
// 4. Sales payment received
// ---------------------------------------------------------------------------

export interface SalesPaymentEvent {
  quotationId: string
  quotationNumber: string
  installmentId: string
  date: string
  amount: number
  contactId: string
  contactName?: string | null
  bankAccount?: string
  /** Money taken before the goods exist is a liability, not revenue. */
  isAdvance: boolean
}

export function postSalesPayment(e: SalesPaymentEvent): PostingResult {
  const dim = { party: e.contactId, partyName: e.contactName ?? null }
  return {
    sourceType: "sales_payment",
    sourceId: `${e.quotationId}__${e.installmentId}`,
    date: e.date,
    description: `دفعة على عرض السعر ${e.quotationNumber}${e.contactName ? ` — ${e.contactName}` : ""}`,
    costCenter: COST_CENTERS.admin,
    lines: [
      { ...dim, account: e.bankAccount || ACC.bankMain, debit: e.amount, note: "مقبوضات" },
      {
        ...dim,
        account: e.isAdvance ? ACC.advancesFromClients : ACC.clientsReceivable,
        credit: e.amount,
        note: e.isAdvance ? "دفعة مقدمة من العميل" : "سداد مستحق",
      },
    ],
    empty: round2(e.amount) === 0,
  }
}

// ---------------------------------------------------------------------------
// 5. Manufacturing — materials issued into a work order
// ---------------------------------------------------------------------------

export interface WorkOrderIssueEvent {
  workOrderId: string
  orderNumber: number
  title: string
  date: string
  /** Snapshotted cost of every input drawn from the source warehouse. */
  materialCost: number
  projectId?: string | null
  projectName?: string | null
}

/**
 * Raw stock becomes work in progress. Nothing is consumed and nothing is earned
 * — the value simply moves between two inventory accounts, which is the
 * bookkeeping form of "material value stays in inventory until sale".
 */
export function postWorkOrderIssue(e: WorkOrderIssueEvent): PostingResult {
  const dim = { project: e.projectId ?? null, projectName: e.projectName ?? null }
  return {
    sourceType: "work_order_issue",
    sourceId: e.workOrderId,
    date: e.date,
    description: `صرف مواد لأمر التشغيل رقم ${e.orderNumber} — ${e.title}`,
    costCenter: COST_CENTERS.procurement,
    lines: [
      { ...dim, account: ACC.inventoryWip, debit: e.materialCost, note: "مواد داخل التصنيع" },
      { ...dim, account: ACC.inventoryMaterials, credit: e.materialCost, note: "سحب من المخزون" },
    ],
    empty: round2(e.materialCost) === 0,
  }
}

// ---------------------------------------------------------------------------
// 6. Manufacturing — finished goods received into a warehouse
// ---------------------------------------------------------------------------

export interface WorkOrderDeliveryEvent {
  workOrderId: string
  orderNumber: number
  deliveryNoteId: string
  date: string
  /** unitCost × quantity of the finished item that landed. */
  value: number
  warehouseName?: string | null
  projectId?: string | null
  projectName?: string | null
  /** A project warehouse means the goods were issued to a job, not stocked. */
  toProject: boolean
}

/**
 * Production finishes and the work in progress becomes something countable.
 *
 * Landing in a project warehouse is where the value finally becomes project
 * cost: the goods left the business's stock and went into a job. Landing in a
 * central or distribution warehouse keeps it as finished-goods inventory.
 */
export function postWorkOrderDelivery(e: WorkOrderDeliveryEvent): PostingResult {
  const dim = { project: e.projectId ?? null, projectName: e.projectName ?? null }
  return {
    sourceType: "work_order_delivery",
    sourceId: e.deliveryNoteId,
    date: e.date,
    description: `استلام إنتاج أمر التشغيل رقم ${e.orderNumber}${e.warehouseName ? ` — ${e.warehouseName}` : ""}`,
    costCenter: e.toProject ? COST_CENTERS.execution : COST_CENTERS.procurement,
    lines: [
      {
        ...dim,
        account: e.toProject ? ACC.costMaterials : ACC.inventoryFinishedGoods,
        debit: e.value,
        note: e.toProject ? "تكلفة مواد للمشروع" : "مخزون تام الصنع",
      },
      { ...dim, account: ACC.inventoryWip, credit: e.value, note: "خروج من تحت التصنيع" },
    ],
    empty: round2(e.value) === 0,
  }
}

// ---------------------------------------------------------------------------
// 7. Materials issued to a project (صرف) — including the wasted portion
// ---------------------------------------------------------------------------

export interface MaterialIssueEvent {
  batchId: string
  date: string
  projectId?: string | null
  projectName?: string | null
  /** quantityTaken × unitCost — everything that left the shelf. */
  totalValue: number
  /** The part of it that was wasted, for the note only: both halves are cost. */
  wasteValue: number
  itemName: string
}

/**
 * Stock leaves and becomes project cost.
 *
 * The wasted portion is deliberately not split into its own expense account:
 * waste is a cost of the job that produced it, and burying it in a separate line
 * would let a project look cheaper than it was. The waste ledger already reports
 * the split for anyone who needs it, and the note carries it on the entry.
 */
export function postMaterialIssue(e: MaterialIssueEvent): PostingResult {
  const dim = { project: e.projectId ?? null, projectName: e.projectName ?? null }
  const wasteNote = e.wasteValue > 0 ? ` (منها هدر ${round2(e.wasteValue)})` : ""
  return {
    sourceType: "material_issue",
    sourceId: e.batchId,
    date: e.date,
    description: `صرف ${e.itemName} للمشروع${wasteNote}`,
    costCenter: COST_CENTERS.execution,
    lines: [
      { ...dim, account: ACC.costMaterials, debit: e.totalValue, note: `صرف ${e.itemName}${wasteNote}` },
      { ...dim, account: ACC.inventoryMaterials, credit: e.totalValue, note: "خروج من المخزون" },
    ],
    empty: round2(e.totalValue) === 0,
  }
}

// ---------------------------------------------------------------------------
// 8. Sales invoice issued (the `invoices` collection)
// ---------------------------------------------------------------------------

export interface SalesInvoiceEvent {
  invoiceId: string
  invoiceNumber: string
  date: string
  /** Sum of line items, before VAT. */
  subtotal: number
  vat: number
  clientName?: string | null
  projectId?: string | null
  projectName?: string | null
}

export function postSalesInvoice(e: SalesInvoiceEvent): PostingResult {
  const dim = { project: e.projectId ?? null, projectName: e.projectName ?? null, partyName: e.clientName ?? null }
  return {
    sourceType: "purchase_invoice",
    sourceId: e.invoiceId,
    date: e.date,
    description: `فاتورة ${e.invoiceNumber}${e.clientName ? ` — ${e.clientName}` : ""}`,
    costCenter: COST_CENTERS.admin,
    lines: [
      { ...dim, account: ACC.clientsReceivable, debit: round2(e.subtotal + e.vat), note: "مستحق من العميل" },
      { ...dim, account: ACC.sundryIncome, credit: e.subtotal, note: "إيراد" },
      { ...dim, account: ACC.vatOutput, credit: e.vat, note: "ضريبة القيمة المضافة — مخرجات" },
    ],
    empty: round2(e.subtotal) === 0,
  }
}

// ---------------------------------------------------------------------------
// 9. Payroll
// ---------------------------------------------------------------------------

export interface PayrollEvent {
  runId: string
  period: string
  date: string
  /** Wages of people working on jobs — a cost of revenue. */
  directLabour: number
  /** Everyone else — an operating expense. */
  adminSalaries: number
  projectAllocations?: Array<{ projectId: string; projectName?: string | null; amount: number }>
}

/** Salaries are earned when the month is worked, and paid later; the accrual
 * keeps the cost in the month that incurred it. */
export function postPayroll(e: PayrollEvent): PostingResult {
  const allocations = e.projectAllocations || []
  const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0))
  const unallocatedDirect = round2(e.directLabour - allocated)
  return {
    sourceType: "payroll",
    sourceId: e.runId,
    date: e.date,
    description: `مسير رواتب ${e.period}`,
    costCenter: COST_CENTERS.admin,
    lines: [
      ...allocations.map((a) => ({
        account: ACC.costLabour,
        debit: a.amount,
        project: a.projectId,
        projectName: a.projectName ?? null,
        costCenter: COST_CENTERS.execution,
        note: "أجور عمالة المشروع",
      })),
      { account: ACC.costLabour, debit: unallocatedDirect > 0 ? unallocatedDirect : 0, costCenter: COST_CENTERS.execution, note: "أجور عمالة غير موزعة" },
      { account: ACC.adminSalaries, debit: e.adminSalaries, note: "رواتب إدارية" },
      { account: ACC.employeeAccruals, credit: round2(e.directLabour + e.adminSalaries), note: "مستحق للموظفين" },
    ],
    empty: round2(e.directLabour + e.adminSalaries) === 0,
  }
}

export interface PayrollPaymentEvent {
  runId: string
  period: string
  date: string
  amount: number
  bankAccount?: string
}

export function postPayrollPayment(e: PayrollPaymentEvent): PostingResult {
  return {
    sourceType: "payroll_payment",
    sourceId: e.runId,
    date: e.date,
    description: `سداد رواتب ${e.period}`,
    costCenter: COST_CENTERS.admin,
    lines: [
      { account: ACC.employeeAccruals, debit: e.amount, note: "سداد مستحقات الموظفين" },
      { account: e.bankAccount || ACC.bankMain, credit: e.amount },
    ],
    empty: round2(e.amount) === 0,
  }
}

// ---------------------------------------------------------------------------
// 10. Operating expense
// ---------------------------------------------------------------------------

export interface ExpenseEvent {
  expenseId: string
  date: string
  description: string
  /** Postable expense leaf — the UI offers the 52xx range. */
  account: string
  amount: number
  vat: number
  paid: boolean
  bankAccount?: string
  projectId?: string | null
  projectName?: string | null
  supplierName?: string | null
}

export function postExpense(e: ExpenseEvent): PostingResult {
  const dim = { project: e.projectId ?? null, projectName: e.projectName ?? null, partyName: e.supplierName ?? null }
  return {
    sourceType: "expense",
    sourceId: e.expenseId,
    date: e.date,
    description: e.description,
    costCenter: e.projectId ? COST_CENTERS.execution : COST_CENTERS.admin,
    lines: [
      { ...dim, account: e.account, debit: e.amount },
      { ...dim, account: ACC.vatInput, debit: e.vat, note: "ضريبة القيمة المضافة — مدخلات" },
      {
        ...dim,
        account: e.paid ? e.bankAccount || ACC.bankMain : ACC.suppliersPayable,
        credit: round2(e.amount + e.vat),
        note: e.paid ? "مدفوع" : "مستحق للمورد",
      },
    ],
    empty: round2(e.amount) === 0,
  }
}

// ---------------------------------------------------------------------------
// 11. Guarantee cash margin
// ---------------------------------------------------------------------------

export interface GuaranteeMarginEvent {
  guaranteeId: string
  date: string
  amount: number
  reference?: string | null
  projectId?: string | null
  projectName?: string | null
  release?: boolean
}

/** A bank guarantee ties up cash without spending it — the margin is still the
 * company's asset, just not available to use. */
export function postGuaranteeMargin(e: GuaranteeMarginEvent): PostingResult {
  const dim = { project: e.projectId ?? null, projectName: e.projectName ?? null }
  const label = e.reference ? ` — ${e.reference}` : ""
  return {
    sourceType: e.release ? "guarantee_release" : "guarantee_margin",
    sourceId: e.guaranteeId,
    date: e.date,
    description: e.release ? `الإفراج عن هامش خطاب ضمان${label}` : `هامش نقدي مقابل خطاب ضمان${label}`,
    costCenter: COST_CENTERS.admin,
    lines: e.release
      ? [
          { ...dim, account: ACC.bankMain, debit: e.amount, note: "إفراج" },
          { ...dim, account: ACC.guaranteeCashMargin, credit: e.amount },
        ]
      : [
          { ...dim, account: ACC.guaranteeCashMargin, debit: e.amount, note: "محجوز لدى البنك" },
          { ...dim, account: ACC.bankMain, credit: e.amount },
        ],
    empty: round2(e.amount) === 0,
  }
}

// ---------------------------------------------------------------------------
// 12. VAT settlement
// ---------------------------------------------------------------------------

export interface VatSettlementEvent {
  periodKey: string
  date: string
  outputVat: number
  inputVat: number
  bankAccount?: string
}

/**
 * Closing a VAT period: output VAT collected is cleared against input VAT
 * reclaimed, and only the difference moves in cash. A net reclaim reverses the
 * direction — the authority owes the business.
 */
export function postVatSettlement(e: VatSettlementEvent): PostingResult {
  const net = round2(e.outputVat - e.inputVat)
  const bank = e.bankAccount || ACC.bankMain
  return {
    sourceType: "vat_settlement",
    sourceId: e.periodKey,
    date: e.date,
    description: `تسوية ضريبة القيمة المضافة — ${e.periodKey}`,
    costCenter: COST_CENTERS.admin,
    lines: [
      { account: ACC.vatOutput, debit: e.outputVat, note: "إقفال ضريبة المخرجات" },
      { account: ACC.vatInput, credit: e.inputVat, note: "خصم ضريبة المدخلات" },
      net >= 0
        ? { account: bank, credit: net, note: "سداد للهيئة" }
        : { account: bank, debit: -net, note: "استرداد من الهيئة" },
    ],
    empty: round2(e.outputVat + e.inputVat) === 0,
  }
}

// ---------------------------------------------------------------------------
// 13. Manual journal voucher
// ---------------------------------------------------------------------------

export interface ManualVoucherEvent {
  voucherId: string
  date: string
  description: string
  lines: Array<{ account: string; debit?: number; credit?: number; project?: string | null; costCenter?: string | null; note?: string | null }>
}

export function postManualVoucher(e: ManualVoucherEvent): PostingResult {
  return {
    sourceType: "manual_voucher",
    sourceId: e.voucherId,
    date: e.date,
    description: e.description,
    costCenter: COST_CENTERS.admin,
    lines: e.lines,
    empty: e.lines.length === 0,
  }
}
