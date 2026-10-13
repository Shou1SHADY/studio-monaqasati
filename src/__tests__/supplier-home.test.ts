/**
 * The supplier's home is the contractor's home (one PortalHomeView); what differs is its
 * numbers: the RFQs open to him, his offers, and the orders waiting for his acceptance.
 */
import fs from "fs"
import path from "path"
import { daysToDeadline, msOf, openRfqs, recentOffers, supplierDecisions, supplierHomeCounts, type HomeOffer, type HomeRfq } from "@/lib/supplier-home"
import { SUPPLIER_COMPONENTS, resolveActiveSupplierComponent } from "@/lib/portal-components"
import type { PurchaseOrder } from "@/lib/procurement/types"

const NOW = Date.parse("2026-10-13T12:00:00Z")
const day = (offset: number) => new Date(NOW + offset * 86_400_000).toISOString().slice(0, 10)

const po = (over: Partial<PurchaseOrder>): PurchaseOrder =>
  ({
    id: "p1",
    organizationId: "buyer",
    docNumber: "PO-2026/001",
    status: "sent",
    basis: "rfq",
    rfqId: "r1",
    rfqTitle: "Rebar",
    offerId: "o1",
    projectId: null,
    supplierOrgId: "sup",
    supplierUserId: "u1",
    supplierName: "Sup",
    isGuestSupplier: false,
    lines: [],
    totalExVat: 100,
    vatRate: 0.15,
    offersCount: 1,
    lowestOfferTotal: null,
    shortCompetition: false,
    noOfficialQuote: false,
    preparedById: "b",
    preparedByName: "B",
    createdAt: "2026-10-01T08:00:00.000Z",
    approverKind: "manager",
    sentAt: "2026-10-10T08:00:00.000Z",
    log: [],
    ...over,
  }) as PurchaseOrder

const rfqs: HomeRfq[] = [
  { id: "r1", title: "Rebar", status: "New", deadline: day(5) },
  { id: "r2", title: "Cement", status: "New", deadline: day(0) },
  { id: "r3", title: "Tiles", status: "New", deadline: day(-1) },
  { id: "r4", title: "Paint", status: "Closed", deadline: day(9) },
  { id: "r5", title: "Pipes", status: "New", deadline: null },
]
const offers: HomeOffer[] = [
  { id: "o1", rfqId: "r1", rfqTitle: "Rebar", status: "قيد المراجعة", createdAt: "2026-10-12T08:00:00.000Z" },
  { id: "o2", rfqId: "rX", rfqTitle: "Old one", status: "Accepted", createdAt: { seconds: Date.parse("2026-09-01T00:00:00Z") / 1000 } },
]

describe("the supplier's home numbers", () => {
  it("counts an RFQ open until the end of its deadline day, and one with no deadline as open", () => {
    expect(daysToDeadline(day(0), NOW)).toBe(0)
    expect(daysToDeadline(day(-1), NOW)).toBeLessThan(0)
    expect(openRfqs(rfqs, NOW).map((r) => r.id)).toEqual(["r1", "r2", "r5"])
  })

  it("counts the open RFQs, those he has not answered, his offers by state, and his orders", () => {
    const counts = supplierHomeCounts({ rfqs, offers, orders: [po({}), po({ id: "p2", status: "accepted", supplierAcceptedAt: "2026-10-11T00:00:00Z" }), po({ id: "p3", status: "approved", sentAt: null })], now: NOW })
    expect(counts).toMatchObject({ openRfqs: 3, unanswered: 2, pendingOffers: 1, acceptedOffers: 1, ordersToAccept: 1, ordersInDelivery: 1 })
    // An order the buyer has not dispatched is the buyer's draft — never counted on the supplier's side.
    expect(counts.ordersTotal).toBe(2)
  })

  it("asks for the orders to accept first (oldest dispatch first), then the unanswered RFQs (soonest deadline first)", () => {
    const list = supplierDecisions({
      rfqs,
      offers,
      orders: [po({ id: "late", sentAt: "2026-10-05T08:00:00.000Z", docNumber: "PO-2026/002" }), po({})],
      now: NOW,
      seesRfqs: true,
    })
    expect(list.map((d) => d.id)).toEqual(["po:late", "po:p1", "rfq:r2", "rfq:r5"])
    expect(list[0]).toMatchObject({ kind: "po_to_accept", waitingDays: 8, href: "/supplier/orders?po=late" })
    expect(list[2]).toMatchObject({ kind: "rfq_to_answer", daysLeft: 0, href: "/supplier/rfqs?search=Cement" })
  })

  it("leaves the RFQs out for a member who cannot see them", () => {
    const list = supplierDecisions({ rfqs, offers, orders: [po({})], now: NOW, seesRfqs: false })
    expect(list.map((d) => d.kind)).toEqual(["po_to_accept"])
  })

  it("continues from the offers sent most recently, reading either kind of date", () => {
    expect(msOf({ toMillis: () => 5 })).toBe(5)
    expect(recentOffers(offers).map((o) => o.id)).toEqual(["o1", "o2"])
  })
})

describe("one home for both portals", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")

  it("renders the same PortalHomeView on the contractor's and the supplier's home", () => {
    for (const portal of ["contractor", "supplier"]) {
      expect(read(`src/app/[locale]/(${portal})/${portal}/page.tsx`)).toMatch(/<PortalHomeView\b/)
    }
  })

  it("sends the old launcher page of both portals to the home", () => {
    for (const portal of ["contractor", "supplier"]) {
      expect(read(`src/app/[locale]/(${portal})/${portal}/apps/page.tsx`)).toContain(`redirect({ href: "/${portal}", locale })`)
    }
  })

  it("opens Order Management on the orders, not on the home it sits in", () => {
    const om = SUPPLIER_COMPONENTS.find((c) => c.id === "project-management")!
    expect(om.homeHref).toBe("/supplier/orders")
    expect(resolveActiveSupplierComponent("/supplier/orders").id).toBe("project-management")
  })
})
