import {
  QUOTATION_STATUS_ACTIONS,
  collectInstallments,
  quotationTimeline,
  salesDashboard,
  statusStamp,
} from "@/lib/sales"
import { defaultInstallments, type CrmQuotation } from "@/lib/crm"

function quote(overrides: Partial<CrmQuotation> & { id: string }): CrmQuotation {
  return {
    contactId: "c1",
    contactName: "شركة البناء",
    quotationNumber: `Q-${overrides.id.toUpperCase()}`,
    amount: 1000,
    status: "draft",
    organizationId: "org",
    ...overrides,
  }
}
const schedule = defaultInstallments({ deposit: "دفعة مقدمة", balance: "المتبقي" })

describe("status workflow", () => {
  it("lets a draft be sent, accepted or rejected; accepted is final; rejected can be re-sent", () => {
    expect(QUOTATION_STATUS_ACTIONS.draft).toEqual(["sent", "accepted", "rejected"])
    expect(QUOTATION_STATUS_ACTIONS.sent).toEqual(["accepted", "rejected"])
    expect(QUOTATION_STATUS_ACTIONS.accepted).toEqual([])
    expect(QUOTATION_STATUS_ACTIONS.rejected).toEqual(["sent"])
  })

  it("stamps the moment a status is entered, and nothing when it does not change", () => {
    expect(statusStamp("draft", "sent", "T1")).toEqual({ sentAt: "T1" })
    expect(statusStamp("sent", "accepted", "T2")).toEqual({ acceptedAt: "T2" })
    expect(statusStamp("sent", "rejected", "T3")).toEqual({ rejectedAt: "T3" })
    expect(statusStamp("accepted", "accepted", "T4")).toEqual({})
    expect(statusStamp(undefined, "draft", "T5")).toEqual({})
  })
})

describe("collectInstallments", () => {
  const list = [
    quote({ id: "old", status: "accepted", amount: 1000, date: "2026-08-01", installments: schedule, payments: { deposit: { paidAt: "2026-08-05", paidAmount: 300, paidByUserId: null, paidByUserName: null, note: null } } }),
    quote({ id: "new", status: "accepted", amount: 500, date: "2026-09-01" }),
    quote({ id: "sent", status: "sent", amount: 9999 }),
  ]
  const { due, received } = collectInstallments(list)

  it("lists what accepted quotations still owe, oldest quotation first", () => {
    expect(due.map((d) => [d.quotation.id, d.installment.id, d.installment.amount])).toEqual([
      ["old", "balance", 700],
      ["new", "full", 500],
    ])
  })

  it("lists what came in, latest first, and ignores quotations not yet accepted", () => {
    expect(received.map((d) => [d.quotation.id, d.installment.id])).toEqual([["old", "deposit"]])
  })
})

describe("salesDashboard", () => {
  const list = [
    quote({ id: "a", status: "draft", date: "2026-09-01" }),
    quote({ id: "b", status: "sent", date: "2026-09-03" }),
    quote({ id: "c", status: "accepted", amount: 4000, date: "2026-09-02", installments: schedule }),
    quote({ id: "d", status: "rejected", date: "2026-09-04" }),
  ]
  const data = salesDashboard(list, 2)

  it("counts per status, shows the latest quotations and the largest amounts due", () => {
    expect(data.statusCounts).toEqual({ draft: 1, sent: 1, accepted: 1, rejected: 1 })
    expect(data.recent.map((q) => q.id)).toEqual(["d", "b"])
    expect(data.due.map((d) => [d.installment.id, d.installment.amount])).toEqual([["balance", 2800], ["deposit", 1200]])
    expect(data.dueCount).toBe(2)
    expect(data.totals.awaitingPayment).toBe(4000)
  })
})

describe("quotationTimeline", () => {
  it("tells the story in order: created, sent, accepted, work order, payments", () => {
    const q = quote({
      id: "t",
      status: "accepted",
      date: "2026-09-01",
      sentAt: "2026-09-02T09:00:00.000Z",
      acceptedAt: "2026-09-03T09:00:00.000Z",
      workOrderId: "wo", workOrderNumber: 4,
      installments: schedule,
      payments: { deposit: { paidAt: "2026-09-04T09:00:00.000Z", paidAmount: 300, paidByUserId: null, paidByUserName: null, note: null } },
    })
    expect(quotationTimeline(q).map((e) => e.kind)).toEqual(["created", "sent", "accepted", "work_order", "payment"])
  })

  it("skips what never happened and reads a Firestore timestamp as the creation", () => {
    const q = quote({ id: "u", createdAt: { toDate: () => new Date("2026-09-05T00:00:00.000Z") } })
    expect(quotationTimeline(q)).toEqual([{ at: "2026-09-05T00:00:00.000Z", kind: "created" }])
  })

  it("does not credit a post-manufacturing quotation with opening its linked order", () => {
    const q = quote({ id: "v", status: "accepted", date: "2026-09-01", phase: "post_manufacturing", workOrderId: "wo", workOrderNumber: 9 })
    expect(quotationTimeline(q).map((e) => e.kind)).toEqual(["created"])
  })
})

describe("partial payments", () => {
  const { applyInstallmentPayment, installmentStates, isFullyPaid, nextUnpaidInstallment, paidSoFar } = jest.requireActual<typeof import("@/lib/sales")>("@/lib/sales")
  const entry = (paidAmount: number, paidAt: string) => ({ paidAt, paidAmount, paidByUserId: "u", paidByUserName: "وليد", note: null })
  const scheduled = quote({ id: "p", status: "accepted", amount: 1000, installments: schedule })

  it("keeps an installment due until its amount is fully covered", () => {
    const first = applyInstallmentPayment(scheduled, "deposit", entry(100, "2026-09-01"))
    expect(first).toMatchObject({ paidAmount: 100, paidAt: null, allPaid: false, installmentSettled: false })
    const partly = { ...scheduled, payments: first.payments, paidAmount: first.paidAmount }
    const deposit = installmentStates(partly)[0]
    expect(deposit).toMatchObject({ paid: 100, remaining: 200, settled: false })
    expect(deposit.entries).toHaveLength(1)
    expect(nextUnpaidInstallment(partly)?.id).toBe("deposit")
    expect(paidSoFar(partly)).toBe(100)

    const second = applyInstallmentPayment(partly, "deposit", entry(200, "2026-09-02"))
    expect(second).toMatchObject({ paidAmount: 300, allPaid: false, installmentSettled: true })
    const settled = { ...partly, payments: second.payments, paidAmount: second.paidAmount }
    expect(installmentStates(settled)[0]).toMatchObject({ paid: 300, remaining: 0, settled: true })
    expect(installmentStates(settled)[0].entries.map((e) => e.paidAmount)).toEqual([100, 200])
    expect(nextUnpaidInstallment(settled)?.id).toBe("balance")

    const last = applyInstallmentPayment(settled, "balance", entry(700, "2026-09-03"))
    expect(last).toMatchObject({ paidAmount: 1000, paidAt: "2026-09-03", allPaid: true })
    expect(isFullyPaid({ ...settled, payments: last.payments, paidAt: last.paidAt })).toBe(true)
  })

  it("lists each partial payment as its own received row and the remainder as due", () => {
    const first = applyInstallmentPayment(scheduled, "deposit", entry(100, "2026-09-01"))
    const partly = { ...scheduled, payments: first.payments }
    const { due, received } = collectInstallments([partly])
    expect(due.map((d) => [d.installment.id, d.installment.remaining])).toEqual([["deposit", 200], ["balance", 700]])
    expect(received.map((r) => [r.installment.id, r.entry?.paidAmount])).toEqual([["deposit", 100]])
    expect(quotationTimeline(partly).filter((e) => e.kind === "payment")).toHaveLength(1)
  })
})
