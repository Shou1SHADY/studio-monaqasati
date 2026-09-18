// What the 17 Sep 2026 customer review found, pinned so it cannot come back:
// an order the workshop pointed at could not be found in Sales; an accountant
// could not get from an entry to its document; the owner could not act at a
// station that named a lead; a legacy owner read as a member.

import { foldSearchText, matchesSearch } from "@/lib/search-text"
import { salesOrderMatchesSearch, type SalesOrder } from "@/lib/sales-orders"
import { quotationMatchesSearch } from "@/lib/sales"
import type { CrmQuotation } from "@/lib/crm"
import { originalSourceId, sourceDocumentPath } from "@/lib/accounting/source-links"
import type { JournalEntry } from "@/lib/accounting/journal"
import { DEFAULT_MFG_SETTINGS, ownsCandidate, type Actor, type Candidate, type DeptCapacityFields } from "@/lib/manufacturing-engine"
import { myStations } from "@/lib/manufacturing-view"
import { mfgLinks } from "@/lib/mfg-events"
import { legacyAwareRole } from "@/hooks/usePermissions"

jest.mock("@/firebase", () => ({}))

describe("search text", () => {
  it("folds the Arabic letter forms people type interchangeably", () => {
    expect(foldSearchText("شركة الأُفُق")).toBe(foldSearchText("شركه الافق"))
    expect(foldSearchText("مبنى")).toBe(foldSearchText("مبني"))
    expect(foldSearchText("QT-٢٠٢٦/٠١٤")).toBe("qt-2026/014")
  })

  it("matches every word, in any field, in any order", () => {
    const fields = ["شركة الأفق للمقاولات", "رخام كرارة 2سم", "QT-2026/014"]
    expect(matchesSearch("افق رخام", fields)).toBe(true)
    expect(matchesSearch("رخام الافق", fields)).toBe(true)
    expect(matchesSearch("افق جرانيت", fields)).toBe(false)
    expect(matchesSearch("   ", fields)).toBe(true)
  })
})

describe("finding a sales order from what another module knows", () => {
  const order = {
    orderNumber: 131,
    quotationNumber: "Q-MFGE2E",
    contactName: "شركة الأفق للمقاولات",
    projectName: "فلل النخيل",
    lines: [{ name: "رخام كرارة أبيض" }],
  } as unknown as SalesOrder

  it("is found by the QUOTATION's number — all the workshop has", () => {
    expect(salesOrderMatchesSearch(order, "Q-MFGE2E")).toBe(true)
    expect(salesOrderMatchesSearch(order, "q-mfge2e")).toBe(true)
    expect(salesOrderMatchesSearch(order, "mfge")).toBe(true)
  })

  it("is found by its own number, the client, the project and a product", () => {
    for (const term of ["SO-131", "#131", "131", "الافق", "فلل النخيل", "كراره"]) expect(salesOrderMatchesSearch(order, term)).toBe(true)
    expect(salesOrderMatchesSearch(order, "SO-132")).toBe(false)
  })

  it("is found by the reference of one of its work orders", () => {
    expect(salesOrderMatchesSearch(order, "WO-2026/043")).toBe(false)
    expect(salesOrderMatchesSearch(order, "WO-2026/043", ["WO-2026/043"])).toBe(true)
  })

  it("the workshop's link to Sales carries the quotation number when it knows no order", () => {
    expect(mfgLinks.salesOrders()).toBe("sales/orders")
    expect(mfgLinks.salesOrders("Q-MFGE2E")).toBe("sales/orders?q=Q-MFGE2E")
    expect(mfgLinks.salesOrders("QT-2026/014")).toBe("sales/orders?q=QT-2026%2F014")
  })
})

describe("finding a quotation", () => {
  const q = { quotationNumber: "QT-2026/014", contactName: "مؤسسة البناء", items: [{ name: "جرانيت أسود" }], workOrderNumber: 43 } as unknown as CrmQuotation
  it("by the number as stored and as the Arabic screen shows it", () => {
    expect(quotationMatchesSearch(q, "QT-2026/014")).toBe(true)
    expect(quotationMatchesSearch(q, "ع.س-2026/014")).toBe(true)
    expect(quotationMatchesSearch(q, "2026/014")).toBe(true)
  })
  it("by a product on it and by its work order", () => {
    expect(quotationMatchesSearch(q, "جرانيت اسود")).toBe(true)
    expect(quotationMatchesSearch(q, "#43")).toBe(true)
    expect(quotationMatchesSearch(q, "رخام")).toBe(false)
  })
})

describe("the document behind a journal entry", () => {
  const entry = (sourceType: JournalEntry["sourceType"], sourceId: string, project?: string) =>
    ({ sourceType, sourceId, lines: [{ account: "110101", debit: 1, credit: 0, project: project ?? null }] }) as unknown as JournalEntry

  it("opens the work order the materials were received on", () => {
    expect(sourceDocumentPath(entry("mfg_material_receipt", "wo123__WR-2026/007"), "contractor")).toBe("manufacturing/workshop?order=wo123")
    expect(sourceDocumentPath(entry("work_order_issue", "wo123"), "supplier")).toBe("manufacturing/workshop?order=wo123")
  })

  it("a scrap id is not a work-order id — it opens the workshop, not a wrong order", () => {
    expect(sourceDocumentPath(entry("mfg_scrap", "scr_9"), "contractor")).toBe("manufacturing/workshop")
  })

  it("tells a quotation instalment from a payment against an invoice", () => {
    expect(sourceDocumentPath(entry("sales_payment", "quoteA__deposit"), "contractor")).toBe("sales/quotations/quoteA")
    expect(sourceDocumentPath(entry("sales_payment", "inv77__invoice"), "contractor")).toBe("sales/fulfillment")
  })

  it("a claim opens its project — which only the contractor portal has", () => {
    expect(sourceDocumentPath(entry("ipc_claim", "claim1", "proj9"), "contractor")).toBe("projects/proj9")
    expect(sourceDocumentPath(entry("ipc_claim", "claim1", "proj9"), "supplier")).toBeNull()
    expect(sourceDocumentPath(entry("ipc_claim", "claim1"), "contractor")).toBeNull()
  })

  it("a reversal leads to the same document as the entry it reverses", () => {
    expect(originalSourceId({ sourceId: "wo123__WR-2026/007__reversal" })).toBe("wo123__WR-2026/007")
    expect(sourceDocumentPath(entry("mfg_material_receipt", "wo123__WR-2026/007__reversal"), "contractor")).toBe("manufacturing/workshop?order=wo123")
  })

  it("a manual voucher has no other document", () => {
    expect(sourceDocumentPath(entry("manual_voucher", "v1"), "contractor")).toBeNull()
    expect(sourceDocumentPath(entry("opening", "OPEN-2026"), "contractor")).toBeNull()
  })
})

describe("who may act at a station that names a lead", () => {
  const departments = [
    { id: "cut", name: "القص", leadUserId: "lead-1" },
    { id: "polish", name: "التلميع", leadUserId: null },
    { id: "qc", name: "الفحص والتغليف", qcStation: true, leadUserId: null },
  ] as unknown as DeptCapacityFields[]
  const atCut = { key: "confirm_receipt", owner: { kind: "station", departmentId: "cut" }, severity: "a" } as unknown as Candidate
  const all = { manage: true, work: true, qc: true, cost: true, view: true }

  it("the named lead acts; another hand and the workshop manager do not (PRD D9)", () => {
    expect(ownsCandidate(atCut, { uid: "lead-1", ...all, manage: false } as Actor, departments, DEFAULT_MFG_SETTINGS)).toBe(true)
    expect(ownsCandidate(atCut, { uid: "someone", ...all } as Actor, departments, DEFAULT_MFG_SETTINGS)).toBe(false)
  })

  it("the org owner may stand in — issued materials must not sit 'not received' because the lead is away", () => {
    const owner = { uid: "owner-1", owner: true, ...all } as Actor
    expect(ownsCandidate(atCut, owner, departments, DEFAULT_MFG_SETTINGS)).toBe(true)
    expect(ownsCandidate(atCut, owner, departments, DEFAULT_MFG_SETTINGS, "lead")).toBe(true)
    // …as a station's hand, not as something the manager persona inherits
    expect(ownsCandidate(atCut, owner, departments, DEFAULT_MFG_SETTINGS, "manager")).toBe(false)
  })

  it("the owner's stations are every station that is not Quality's", () => {
    expect(myStations({ uid: "owner-1", owner: true, ...all } as Actor, departments, "lead").sort()).toEqual(["cut", "polish"])
    expect(myStations({ uid: "lead-1", ...all } as Actor, departments, "lead")).toEqual(["cut"])
  })
})

describe("the role the security rules see", () => {
  it("no organizationRole field = an account from before the migration = owner, as in firestore.rules", () => {
    expect(legacyAwareRole({ organizationId: "u1" })).toBe("owner")
  })
  it("a present field is taken as it is, and no profile is nobody", () => {
    expect(legacyAwareRole({ organizationRole: "member" })).toBe("member")
    expect(legacyAwareRole({ organizationRole: "owner" })).toBe("owner")
    expect(legacyAwareRole({ organizationRole: null })).toBeNull()
    expect(legacyAwareRole(null)).toBeNull()
    expect(legacyAwareRole(undefined)).toBeNull()
  })
})
