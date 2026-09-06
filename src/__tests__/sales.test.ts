import {
  SALES_TABS,
  applyInstallmentPayment,
  findPriceItem,
  installmentStates,
  isAwaitingPayment,
  isFullyPaid,
  isQuotationPaid,
  nextUnpaidInstallment,
  paidSoFar,
  paymentRecipients,
  priceItemToQuotationLine,
  quotationMatchesSearch,
  quotationMatchesTab,
  quotationPrefillFromWorkOrder,
  salesTotals,
} from "@/lib/sales"
import {
  defaultInstallments,
  installmentAmount,
  quotationInstallments,
  quotationPhase,
  validateInstallments,
  type CrmQuotation,
} from "@/lib/crm"
import { ALL_PERMISSION } from "@/lib/permissions"
import type { WorkOrder } from "@/lib/manufacturing"

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

describe("quotationPhase", () => {
  it("reads quotations written before phases existed as pre-manufacturing", () => {
    expect(quotationPhase({})).toBe("pre_manufacturing")
    expect(quotationPhase({ phase: null })).toBe("pre_manufacturing")
    expect(quotationPhase({ phase: "post_manufacturing" })).toBe("post_manufacturing")
  })
})

describe("payment schedule", () => {
  it("defaults to a 30% deposit and the balance on delivery", () => {
    expect(schedule.map((i) => [i.id, i.percent])).toEqual([["deposit", 30], ["balance", 70]])
  })

  it("treats a quotation without a schedule as one full payment", () => {
    const list = quotationInstallments({ installments: null })
    expect(list).toEqual([{ id: "full", label: "", percent: 100 }])
    expect(installmentAmount({ amount: 1234.5 }, list[0])).toBe(1234.5)
    expect(installmentAmount({ amount: 1000 }, { percent: 30 })).toBe(300)
    expect(installmentAmount({ amount: 999 }, { percent: 33.333 })).toBe(333)
  })

  it("validates that installments are named, sane, and add up to 100%", () => {
    expect(validateInstallments([])).toBeNull()
    expect(validateInstallments(schedule)).toBeNull()
    expect(validateInstallments([{ id: "a", label: "", percent: 100 }])).toBe("empty_label")
    expect(validateInstallments([{ id: "a", label: "x", percent: 0 }, { id: "b", label: "y", percent: 100 }])).toBe("bad_percent")
    expect(validateInstallments([{ id: "a", label: "x", percent: 40 }, { id: "b", label: "y", percent: 40 }])).toBe("not_100")
  })
})

describe("payment state", () => {
  const scheduled = quote({ id: "s", status: "accepted", amount: 1000, installments: schedule })

  it("computes each installment's amount and what was paid against it", () => {
    const states = installmentStates(scheduled)
    expect(states.map((s) => [s.id, s.amount, s.payment])).toEqual([["deposit", 300, null], ["balance", 700, null]])
    expect(paidSoFar(scheduled)).toBe(0)
    expect(isFullyPaid(scheduled)).toBe(false)
    expect(isAwaitingPayment(scheduled)).toBe(true)
    expect(nextUnpaidInstallment(scheduled)?.id).toBe("deposit")
  })

  it("records one installment, then the rest, and only then calls the quotation paid", () => {
    const deposit = { paidAt: "2026-09-06T10:00:00.000Z", paidAmount: 300, paidByUserId: "u", paidByUserName: "وليد", note: null }
    const afterDeposit = applyInstallmentPayment(scheduled, "deposit", deposit)
    expect(afterDeposit).toMatchObject({ paidAmount: 300, paidAt: null, allPaid: false })

    const partlyPaid = { ...scheduled, payments: afterDeposit.payments, paidAmount: afterDeposit.paidAmount }
    expect(paidSoFar(partlyPaid)).toBe(300)
    expect(isAwaitingPayment(partlyPaid)).toBe(true)
    expect(nextUnpaidInstallment(partlyPaid)?.id).toBe("balance")

    const balance = { ...deposit, paidAt: "2026-09-07T10:00:00.000Z", paidAmount: 700 }
    const settled = applyInstallmentPayment(partlyPaid, "balance", balance)
    expect(settled).toMatchObject({ paidAmount: 1000, paidAt: balance.paidAt, allPaid: true })
    const done = { ...partlyPaid, payments: settled.payments, paidAt: settled.paidAt, paidAmount: settled.paidAmount }
    expect(isFullyPaid(done)).toBe(true)
    expect(isAwaitingPayment(done)).toBe(false)
  })

  it("keeps the meaning of a quotation marked paid before schedules existed", () => {
    const legacy = quote({ id: "l", status: "accepted", amount: 500, paidAt: "2026-09-01", paidAmount: 500, paidByUserName: "وليد" })
    expect(installmentStates(legacy)[0]).toMatchObject({ id: "full", amount: 500, payment: { paidAmount: 500, paidByUserName: "وليد" } })
    expect(paidSoFar(legacy)).toBe(500)
    expect(isQuotationPaid(legacy)).toBe(true)
    expect(isAwaitingPayment(legacy)).toBe(false)
  })

  it("is awaiting payment only when accepted", () => {
    expect(isAwaitingPayment(quote({ id: "a", status: "sent" }))).toBe(false)
    expect(isAwaitingPayment(quote({ id: "b", status: "accepted" }))).toBe(true)
  })
})

describe("quotationMatchesTab", () => {
  const pre = quote({ id: "pre", status: "sent" })
  const post = quote({ id: "post", status: "accepted", phase: "post_manufacturing" })
  const paid = quote({ id: "paid", status: "accepted", paidAt: "2026-09-02", phase: "post_manufacturing" })

  it("routes each quotation to the right tabs", () => {
    expect(SALES_TABS.filter((tab) => quotationMatchesTab(pre, tab))).toEqual(["all", "pre"])
    expect(SALES_TABS.filter((tab) => quotationMatchesTab(post, tab))).toEqual(["all", "post", "awaiting"])
    expect(SALES_TABS.filter((tab) => quotationMatchesTab(paid, tab))).toEqual(["all", "post", "paid"])
  })
})

describe("salesTotals", () => {
  const list = [
    quote({ id: "draft", status: "draft", amount: 500 }),
    quote({ id: "sent", status: "sent", amount: 2000 }),
    quote({ id: "acc", status: "accepted", amount: 3000 }),
    quote({ id: "paid", status: "accepted", amount: 4000, paidAt: "2026-09-02", paidAmount: 3900 }),
    quote({ id: "paidfull", status: "accepted", amount: 100.5, paidAt: "2026-09-03" }),
    quote({ id: "part", status: "accepted", amount: 1000, installments: schedule, payments: { deposit: { paidAt: "2026-09-04", paidAmount: 300, paidByUserId: null, paidByUserName: null, note: null } } }),
    quote({ id: "rej", status: "rejected", amount: 9999 }),
  ]
  const totals = salesTotals(list)

  it("sums the pipeline, what is accepted, what is still owed and what was paid", () => {
    expect(totals.quoted).toBe(2000 + 3000 + 4000 + 100.5 + 1000)
    expect(totals.accepted).toBe(3000 + 4000 + 100.5 + 1000)
    expect(totals.awaitingPayment).toBe(3000 + 100 + 0 + 700)
    expect(totals.paid).toBe(3900 + 100.5 + 300)
  })

  it("counts per tab", () => {
    expect(totals.counts).toEqual({ all: 7, pre: 7, post: 0, awaiting: 2, paid: 2 })
  })

  it("is all zeros with nothing to sum", () => {
    expect(salesTotals([])).toEqual({
      quoted: 0,
      accepted: 0,
      awaitingPayment: 0,
      paid: 0,
      counts: { all: 0, pre: 0, post: 0, awaiting: 0, paid: 0 },
    })
  })
})

describe("quotationMatchesSearch", () => {
  const q = quote({ id: "x", quotationNumber: "Q-AB12CD", contactName: "مؤسسة النور", workOrderNumber: 7 })
  it("matches number, customer and linked order, case-insensitively", () => {
    expect(quotationMatchesSearch(q, "")).toBe(true)
    expect(quotationMatchesSearch(q, "ab12")).toBe(true)
    expect(quotationMatchesSearch(q, "النور")).toBe(true)
    expect(quotationMatchesSearch(q, "#7")).toBe(true)
    expect(quotationMatchesSearch(q, "zzz")).toBe(false)
  })
})

describe("price list", () => {
  const items = [
    { id: "a", name: "باب حديد", unit: "قطعة", unitPrice: 850 },
    { id: "b", name: "Marble 60x60", unit: "m2", unitPrice: 120 },
  ]
  it("finds an item by name regardless of case and spacing", () => {
    expect(findPriceItem(items, " marble 60X60 ")?.id).toBe("b")
    expect(findPriceItem(items, "")).toBeUndefined()
    expect(findPriceItem(items, "رخام")).toBeUndefined()
  })
  it("turns a priced item into a quotation line", () => {
    expect(priceItemToQuotationLine(items[0], 4)).toEqual({ name: "باب حديد", quantity: 4, unit: "قطعة", unitPrice: 850 })
  })
})

describe("paymentRecipients", () => {
  const groups = [
    { id: "g-fin", permissions: ["invoices.manage" as const] },
    { id: "g-super", permissions: [ALL_PERMISSION] },
    { id: "g-sales", permissions: ["sales.manage" as const] },
  ]
  const members = [
    { id: "walid", defaultGroupId: "g-fin" },
    { id: "boss", defaultGroupId: "g-super" },
    { id: "rep", defaultGroupId: "g-sales" },
    { id: "nogroup", defaultGroupId: null },
  ]

  it("tells the owner and everyone whose group can manage invoices", () => {
    expect(paymentRecipients({ ownerId: "owner", actorId: "rep", members, groups }).sort()).toEqual(["boss", "owner", "walid"])
  })

  it("never notifies the person acting", () => {
    expect(paymentRecipients({ ownerId: "owner", actorId: "owner", members, groups }).sort()).toEqual(["boss", "walid"])
    expect(paymentRecipients({ ownerId: "owner", actorId: "walid", members, groups }).sort()).toEqual(["boss", "owner"])
  })

  it("does not duplicate an owner who is also a listed member", () => {
    const withOwner = [...members, { id: "owner", defaultGroupId: "g-fin" }]
    expect(paymentRecipients({ ownerId: "owner", actorId: "rep", members: withOwner, groups }).filter((id) => id === "owner")).toHaveLength(1)
  })
})

describe("quotationPrefillFromWorkOrder", () => {
  const base: WorkOrder = {
    id: "wo-9",
    organizationId: "org",
    orderNumber: 9,
    title: "أبواب",
    items: [],
    source: { kind: "quotation", contactId: "c1", contactName: "شركة البناء" },
    status: "done",
    currentStageIndex: 0,
    stages: [],
    createdByUserId: "u",
    createdByUserName: "u",
    output: { name: "باب حديد", quantity: 4, unit: "قطعة" },
  }

  it("turns the finished output into one unpriced line and keeps the customer", () => {
    expect(quotationPrefillFromWorkOrder(base)).toEqual({
      items: [{ name: "باب حديد", quantity: 4, unit: "قطعة", unitPrice: 0 }],
      workOrderId: "wo-9",
      workOrderNumber: 9,
      contactId: "c1",
      contactName: "شركة البناء",
    })
  })

  it("leaves the customer open for a manual order", () => {
    const manual = { ...base, source: { kind: "manual" as const } }
    expect(quotationPrefillFromWorkOrder(manual)).toMatchObject({ contactId: null, contactName: null })
  })
})
