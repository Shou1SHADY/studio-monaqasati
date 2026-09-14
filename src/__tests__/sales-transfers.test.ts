// Transfer notices & quote requests — the derivations the screens trust.

import {
  QUOTE_DECLINE_REASONS,
  discountCapPercent,
  installmentNoticeState,
  quotationPriceIssues,
  reportableInstallments,
  shouldReleaseOrder,
  validateTransferReport,
  type TransferNotice,
} from "@/lib/sales-transfers"
import { installmentStates } from "@/lib/sales"
import { INSTALLMENT_DEPOSIT_ID } from "@/lib/crm"
import type { SalesOrder } from "@/lib/sales-orders"

const notice = (over: Partial<TransferNotice>): TransferNotice => ({
  id: "n1",
  organizationId: "org",
  noticeNumber: "TN-AAAAAA",
  quotationId: "q1",
  quotationNumber: "QT-1",
  installmentId: INSTALLMENT_DEPOSIT_ID,
  installmentLabel: "دفعة مقدمة",
  contactId: "c1",
  amountStated: 1000,
  transferDate: "2026-09-14",
  status: "reported",
  reportedAt: "2026-09-14T10:00:00.000Z",
  createdByUserId: "u1",
  createdByUserName: "بائع",
  ...over,
})

const quotation = (over: Partial<Parameters<typeof installmentStates>[0]> = {}) => ({
  amount: 10000,
  installments: [
    { id: INSTALLMENT_DEPOSIT_ID, label: "دفعة مقدمة", percent: 30 },
    { id: "balance", label: "الباقي", percent: 70 },
  ],
  payments: null,
  ...over,
})

describe("validateTransferReport", () => {
  const today = "2026-09-15"
  it("rejects a non-positive or non-finite amount", () => {
    expect(validateTransferReport({ amount: 0, transferDate: today, today })).toBe("bad_amount")
    expect(validateTransferReport({ amount: -5, transferDate: today, today })).toBe("bad_amount")
    expect(validateTransferReport({ amount: NaN, transferDate: today, today })).toBe("bad_amount")
  })
  it("rejects a future transfer date, accepts today and the past", () => {
    expect(validateTransferReport({ amount: 100, transferDate: "2026-09-16", today })).toBe("future_date")
    expect(validateTransferReport({ amount: 100, transferDate: today, today })).toBeNull()
    expect(validateTransferReport({ amount: 100, transferDate: "2026-09-01", today })).toBeNull()
  })
  it("rejects an empty date", () => {
    expect(validateTransferReport({ amount: 100, transferDate: "", today })).toBe("future_date")
  })
})

describe("installmentNoticeState", () => {
  const [deposit, balance] = installmentStates(quotation())

  it("is not_reported with no notices", () => {
    expect(installmentNoticeState(deposit, [])).toBe("not_reported")
  })
  it("is awaiting_finance while the latest notice is reported", () => {
    expect(installmentNoticeState(deposit, [notice({})])).toBe("awaiting_finance")
  })
  it("is not_found when Finance could not match the deposit", () => {
    expect(installmentNoticeState(deposit, [notice({ status: "not_found" })])).toBe("not_found")
  })
  it("a fresh report after not_found puts it back with Finance", () => {
    const older = notice({ id: "n1", status: "not_found", reportedAt: "2026-09-10T10:00:00.000Z" })
    const newer = notice({ id: "n2", status: "reported", reportedAt: "2026-09-14T10:00:00.000Z" })
    expect(installmentNoticeState(deposit, [older, newer])).toBe("awaiting_finance")
  })
  it("settled money on the quotation wins over any notice state", () => {
    const paid = installmentStates(
      quotation({
        payments: {
          [INSTALLMENT_DEPOSIT_ID]: { paidAt: "2026-09-14T10:00:00.000Z", paidAmount: 3000, paidByUserId: "f1", paidByUserName: "مالية", note: null },
        },
      })
    )[0]
    expect(installmentNoticeState(paid, [notice({ status: "not_found" })])).toBe("confirmed")
  })
  it("notices for another instalment do not speak for this one", () => {
    expect(installmentNoticeState(balance, [notice({})])).toBe("not_reported")
  })
})

describe("reportableInstallments", () => {
  it("only the next unreported instalment carries the button", () => {
    const states = installmentStates(quotation())
    const out = reportableInstallments(states, [])
    expect(out.map((s) => s.id)).toEqual([INSTALLMENT_DEPOSIT_ID])
  })
  it("nothing is reportable while the next sits with Finance", () => {
    const states = installmentStates(quotation())
    expect(reportableInstallments(states, [notice({})])).toEqual([])
  })
  it("a not_found instalment always accepts a fresh report", () => {
    const states = installmentStates(quotation())
    const out = reportableInstallments(states, [notice({ status: "not_found" })])
    expect(out.map((s) => s.id)).toEqual([INSTALLMENT_DEPOSIT_ID])
  })
  it("after the deposit settles, the balance becomes the next", () => {
    const states = installmentStates(
      quotation({
        payments: {
          [INSTALLMENT_DEPOSIT_ID]: { paidAt: "2026-09-14T10:00:00.000Z", paidAmount: 3000, paidByUserId: "f1", paidByUserName: "مالية", note: null },
        },
      })
    )
    expect(reportableInstallments(states, []).map((s) => s.id)).toEqual(["balance"])
  })
})

describe("shouldReleaseOrder", () => {
  const order = (over: Partial<SalesOrder>): SalesOrder =>
    ({
      id: "o1",
      organizationId: "org",
      orderNumber: 1,
      type: "standard",
      status: "awaiting_deposit",
      contactId: "c1",
      payment: { kind: "deposit", depositPercent: 30, depositPaid: false },
      vatPercent: 15,
      lines: [],
      createdByUserId: "u1",
      createdByUserName: "بائع",
      ...over,
    }) as SalesOrder

  it("releases a deposit-gated order when its deposit confirms", () => {
    expect(shouldReleaseOrder(order({}), INSTALLMENT_DEPOSIT_ID)).toBe(true)
  })
  it("never releases on a non-deposit instalment", () => {
    expect(shouldReleaseOrder(order({}), "balance")).toBe(false)
  })
  it("never touches an order already running or on credit", () => {
    expect(shouldReleaseOrder(order({ status: "running" }), INSTALLMENT_DEPOSIT_ID)).toBe(false)
    expect(shouldReleaseOrder(order({ payment: { kind: "credit", creditDays: 30 } }), INSTALLMENT_DEPOSIT_ID)).toBe(false)
    expect(shouldReleaseOrder(null, INSTALLMENT_DEPOSIT_ID)).toBe(false)
  })
})

describe("discountCapPercent", () => {
  it("owner has no cap, approver 8, everyone else 3", () => {
    expect(discountCapPercent({ isOwner: true, canApprove: true })).toBeNull()
    expect(discountCapPercent({ isOwner: false, canApprove: true })).toBe(8)
    expect(discountCapPercent({ isOwner: false, canApprove: false })).toBe(3)
  })
})

describe("quotationPriceIssues", () => {
  const list = [
    { name: "باب HDF", unitPrice: 1240, cost: 790 },
    { name: "خدمة نقل", unitPrice: 550, cost: null },
    { name: "كلادينج", unitPrice: 690 },
  ]

  it("blocks selling below cost for everyone — even the owner", () => {
    const issues = quotationPriceIssues([{ name: "باب HDF", unitPrice: 700 }], list, null)
    expect(issues).toEqual([{ name: "باب HDF", kind: "below_cost" }])
  })
  it("blocks a discount beyond the role's cap", () => {
    const issues = quotationPriceIssues([{ name: "باب HDF", unitPrice: 1178 }], list, 3)
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe("over_cap")
    expect(issues[0].discountPercent).toBeCloseTo(5, 0)
  })
  it("passes a discount inside the cap, and any price for the uncapped owner", () => {
    expect(quotationPriceIssues([{ name: "باب HDF", unitPrice: 1215 }], list, 3)).toEqual([])
    expect(quotationPriceIssues([{ name: "باب HDF", unitPrice: 800 }], list, null)).toEqual([])
  })
  it("a line with no cost can discount but never below nothing to compare", () => {
    expect(quotationPriceIssues([{ name: "كلادينج", unitPrice: 650 }], list, 8)).toEqual([])
    const capped = quotationPriceIssues([{ name: "كلادينج", unitPrice: 650 }], list, 3)
    expect(capped[0]?.kind).toBe("over_cap")
  })
  it("free lines not on the list pass untouched", () => {
    expect(quotationPriceIssues([{ name: "بند حر", unitPrice: 1 }], list, 3)).toEqual([])
  })
  it("matches names case-insensitively and trimmed", () => {
    const issues = quotationPriceIssues([{ name: "  باب hdf ", unitPrice: 700 }], list, null)
    expect(issues).toEqual([{ name: "  باب hdf ", kind: "below_cost" }])
  })
})

describe("decline reasons", () => {
  it("exactly the five factual reasons the PRD names", () => {
    expect(QUOTE_DECLINE_REASONS).toEqual(["not_in_line", "capacity", "spec", "bought_in", "closed_in_crm"])
  })
})
