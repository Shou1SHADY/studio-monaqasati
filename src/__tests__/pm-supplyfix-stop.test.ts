/**
 * «أوقِف ما لم يصل» on the order (REQ-04, P-19): the stop lands on the order's
 * line of THAT material — the BOQ item only tells two lines of it apart — and
 * it is recorded whatever stage the order is at, as long as it still lives.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { materialKeyOf } from "@/lib/pm/store"
import { requestOf } from "@/lib/pm/supply"
import { stopLine } from "@/lib/pm/supply-writes"
import { pmStopLine } from "@/lib/procurement/po-extra-writes"
import type { PoLine, PurchaseOrder } from "@/lib/procurement/types"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const pmActor = { uid: "pm1", name: "PM" }

const poLine = (over: Partial<PoLine>): PoLine => ({ id: "l1", name: "Blocks", unit: "pc", quantity: 1000, unitPrice: 3, accepted: 0, rejected: 0, held: 0, cancelled: 0, boqItemId: "A", rfqProductIndex: 0, ...over })
const order = (lines: PoLine[], status: PurchaseOrder["status"] = "accepted") => ({ lines, status })

describe("pmStopLine", () => {
  const blocks = poLine({ id: "l1" })
  const cement = poLine({ id: "l2", name: "Cement", unit: "bag", quantity: 100 })

  it("blocks and cement on one BOQ item: stopping cement lands on cement", () => {
    expect(pmStopLine(order([blocks, cement]), { name: "Cement", unit: "bag", boqItemId: "A" })?.id).toBe("l2")
  })

  it("the BOQ item tells two lines of the same material apart", () => {
    const other = poLine({ id: "l3", name: "Cement", unit: "bag", quantity: 50, boqItemId: "B" })
    expect(pmStopLine(order([cement, other]), { name: "Cement", unit: "bag", boqItemId: "B" })?.id).toBe("l3")
    expect(pmStopLine(order([cement, other]), { name: "Cement", unit: "bag", boqItemId: "A" })?.id).toBe("l2")
  })

  it("never lands on another material because it shares the item", () => {
    expect(pmStopLine(order([blocks]), { name: "Cement", unit: "bag", boqItemId: "A" })).toBeNull()
  })

  it("reads the material as Arabic is typed: أ/ا, ة/ه", () => {
    const ar = poLine({ id: "l4", name: "اسمنت مقاوم", unit: "كيس" })
    expect(pmStopLine(order([ar]), { name: "أسمنت مقاوم", unit: "كيس", boqItemId: null })?.id).toBe("l4")
  })

  it("an order awaiting approval, approved or sent takes the stop too; a closed or cancelled one has nothing to stop", () => {
    for (const st of ["awaiting_approval", "approved", "sent", "accepted"] as const) expect(pmStopLine(order([cement], st), { name: "Cement", unit: "bag" })?.id).toBe("l2")
    for (const st of ["closed", "cancelled"] as const) expect(pmStopLine(order([cement], st), { name: "Cement", unit: "bag" })).toBeNull()
    expect(pmStopLine(order([{ ...cement, accepted: 100 }]), { name: "Cement", unit: "bag" })).toBeNull()
  })
})

describe("stopLine", () => {
  const P = "projects/p1"
  const key = materialKeyOf("Cement", "bag")
  beforeEach(() => {
    resetFakeDb()
    seed(P, { organizationId: "org", name: "Villas", projectManagerId: "pm1", pm: { no: "PJ-2026/001", lifecycle: "live" } })
    seed(`${P}/purchaseRequests/01`, { pm: true, seq: 1, title: "Cement", status: "approved", requestedByUserId: "se1", poId: "po1", poNumber: "PO-2026/001", lines: [{ itemId: "A", code: "04-01", key, name: "Cement", unit: "bag", qty: 100, receipts: [] }], items: [{ name: "Cement", quantity: 100, unit: "bag", itemId: "A" }] })
  })

  it("an order born of an RFQ names its line by the category picked there: the RFQ line's description says which material it is", async () => {
    seed("rfqs/rfq1", { status: "Awarded", products: [{ name: "مواد بناء", description: "Blocks", unitOfMeasure: "pc" }, { name: "مواد بناء", description: "Cement", unitOfMeasure: "bag" }] })
    seed("purchaseOrders/po1", {
      organizationId: "org",
      status: "accepted",
      projectId: "p1",
      rfqId: "rfq1",
      lines: [poLine({ id: "l1", name: "مواد بناء", unit: "pc", boqItemId: null, rfqProductIndex: 0 }), poLine({ id: "l2", name: "مواد بناء", unit: "bag", quantity: 100, boqItemId: null, rfqProductIndex: 1 })],
      log: [],
    })
    await stopLine(db, pm, "p1", pmActor, "01", 0, "need", null)
    expect(readDoc<{ pmCancelKey?: string }>("purchaseOrders/po1")?.pmCancelKey).toBe("l2")
  })

  it.each(["awaiting_approval", "approved", "sent"])("records the stop on an order that is %s — the project line never closes behind Procurement's back", async (status) => {
    seed("purchaseOrders/po1", { organizationId: "org", status, projectId: "p1", lines: [poLine({ id: "l1" }), poLine({ id: "l2", name: "Cement", unit: "bag", quantity: 100 })], log: [] })
    await stopLine(db, pm, "p1", pmActor, "01", 0, "need", null)
    const po = readDoc<{ pmCancels?: Record<string, { projectId: string; requestId: string }>; pmCancelKey?: string }>("purchaseOrders/po1")
    expect(po?.pmCancelKey).toBe("l2")
    expect(po?.pmCancels).toEqual({ l2: expect.objectContaining({ projectId: "p1", requestId: "01" }) })
    expect(requestOf({ id: "01", ...(readDoc<Record<string, unknown>>(`${P}/purchaseRequests/01`) as Record<string, unknown>) }).lines[0].cl?.t).toBe("cancel")
  })
})
