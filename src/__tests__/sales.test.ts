import {
  SALES_TABS,
  isAwaitingPayment,
  isQuotationPaid,
  paymentRecipients,
  quotationMatchesSearch,
  quotationMatchesTab,
  quotationPrefillFromWorkOrder,
  salesTotals,
} from "@/lib/sales"
import { quotationPhase, type CrmQuotation } from "@/lib/crm"
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

describe("quotationPhase", () => {
  it("reads quotations written before phases existed as pre-manufacturing", () => {
    expect(quotationPhase({})).toBe("pre_manufacturing")
    expect(quotationPhase({ phase: null })).toBe("pre_manufacturing")
    expect(quotationPhase({ phase: "post_manufacturing" })).toBe("post_manufacturing")
  })
})

describe("payment state", () => {
  it("is awaiting payment only when accepted and not yet paid", () => {
    expect(isAwaitingPayment(quote({ id: "a", status: "accepted" }))).toBe(true)
    expect(isAwaitingPayment(quote({ id: "b", status: "accepted", paidAt: "2026-09-01" }))).toBe(false)
    expect(isAwaitingPayment(quote({ id: "c", status: "sent" }))).toBe(false)
    expect(isQuotationPaid(quote({ id: "d", paidAt: "2026-09-01" }))).toBe(true)
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
    quote({ id: "rej", status: "rejected", amount: 9999 }),
  ]
  const totals = salesTotals(list)

  it("sums the pipeline, what is accepted, what is owed and what was paid", () => {
    expect(totals.quoted).toBe(9100.5)
    expect(totals.accepted).toBe(7100.5)
    expect(totals.awaitingPayment).toBe(3000)
    // A partial payment counts what was actually paid; a full one falls back to the amount.
    expect(totals.paid).toBe(4000.5)
  })

  it("counts per tab", () => {
    expect(totals.counts).toEqual({ all: 6, pre: 6, post: 0, awaiting: 1, paid: 2 })
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

  it("never notifies the person recording the payment", () => {
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
