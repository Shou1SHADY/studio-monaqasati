/**
 * The award tells the project's request which order answers it (REQ-03, WF-09
 * step 4, STK-09). A material bought through an RFQ carried only `rfqId` on the
 * request — the order's `poId` was written on the offer alone — so the line
 * stayed "with Procurement, an RFQ is out" for ever and could never be received
 * on the project. The link is written in the award's own transaction.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { materialKeyOf, storeIdOf } from "@/lib/pm/store"
import { lineLink, linePhase, receivable, requestOf } from "@/lib/pm/supply"
import { receiveOnProject } from "@/lib/pm/supply-writes"
import { projectNeed, type ProjectRequestDoc } from "@/lib/procurement/needs"
import { DEFAULT_POLICIES, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import { awardRfq, createPurchaseOrderFromAward, type AwardOfferLike, type AwardRfqInput, type RfqLike } from "@/lib/procurement/writes"

const db = fakeFirestore as unknown as Firestore
const NOW = new Date("2026-09-22T09:00:00Z")
const ORG = "owner-uid"
const buyer: ProcActor = { uid: "buyer", name: "Badr", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }

const P = "projects/p1"
const R = (id: string) => `${P}/purchaseRequests/${id}`
const cement = materialKeyOf("Cement", "bag")
const blocks = materialKeyOf("Blocks", "pc")
const source = (id: string) => ({ kind: "project_request", projectId: "p1", purchaseRequestId: id })
const raw = (id: string) => readDoc<Record<string, unknown>>(R(id)) as Record<string, unknown>
const stored = (id: string) => requestOf({ id, ...raw(id) })

const request = (over: Record<string, unknown> = {}) => ({
  pm: true,
  seq: 1,
  title: "Cement",
  status: "approved",
  requestedByUserId: "se1",
  rfqId: "rfq1",
  lines: [{ itemId: "i1", code: "04-02-01", key: cement, name: "Cement", unit: "bag", qty: 100, receipts: [] }],
  items: [{ name: "Cement", quantity: 100, unit: "bag", itemId: "i1" }],
  ...over,
})

const rfq: RfqLike = { id: "rfq1", title: "Cement", organizationId: ORG, contractorId: "buyer", projectId: "p1", city: "الرياض", products: [{ name: "Cement", quantity: 100, unitOfMeasure: "bag" }], purchaseSource: source("01") }
const offer: AwardOfferLike = { id: "of1", price: "2000", supplierId: "sup-user", organizationId: "sup-org", companyName: "Cement Co", offerPdfUrl: "x.pdf" }

beforeEach(() => {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG })
  seed(P, { organizationId: ORG, name: "Villas", projectManagerId: "pm1", pm: { no: "PJ-2026/001", lifecycle: "live" } })
  seed(`${P}/boqItems/i1`, { itemNo: "04-02-01", descriptionAr: "لياسة", unit: "m2", quantity: 10000, executedQuantity: 2000 })
  seed(`${P}/pmStore/${storeIdOf(cement)}`, { key: cement, name: "Cement", unit: "bag", rates: { i1: { r: 0.2, w: 5, ex0: 1000, src: "rate" } }, moves: [] })
  seed(R("01"), request())
  seed("rfqs/rfq1", { ...rfq, status: "New" })
  seed("offers/of1", { ...offer, status: "مقبول" })
})

describe("the single award (createPurchaseOrderFromAward)", () => {
  it("writes the order on the request the RFQ was raised for, with the order itself", async () => {
    const po = await createPurchaseOrderFromAward(db, buyer, { rfq, offer, offers: [offer], policies: DEFAULT_POLICIES }, { now: NOW })
    expect(raw("01")).toMatchObject({ rfqId: "rfq1", poId: po.id, poNumber: po.docNumber })
    // Procurement's desk: in hand as an order.
    expect(projectNeed({ id: "p1", name: "Villas" }, { id: "01", ...raw("01") } as ProjectRequestDoc, "PR-01")).toMatchObject({ state: "order", poId: po.id })
    // The project: an order is out for the line.
    const r = stored("01")
    expect(linePhase(r, r.lines[0])).toBe("po")
  })

  it("the line is then received on the project once the order is on its way", async () => {
    const po = await createPurchaseOrderFromAward(db, buyer, { rfq, offer, offers: [offer], policies: DEFAULT_POLICIES }, { now: NOW })
    seed(`purchaseOrders/${po.id}`, { ...(readDoc<Record<string, unknown>>(`purchaseOrders/${po.id}`) as Record<string, unknown>), status: "sent" })
    expect(await receiveOnProject(db, site, "p1", { uid: "se1", name: "Site" }, "01", 0, { acc: 60, rej: 0, dn: "DN-1", note: null, short: false })).toBe("01")
    expect(stored("01").lines[0].receipts?.[0]).toMatchObject({ q: 60, grn: "01" })
  })

  it("reads the needs the RFQ form picked (needSources, a line's own source) from the RFQ itself", async () => {
    seed(R("02"), request({ seq: 2 }))
    seed("rfqs/rfq1", { ...rfq, purchaseSource: null, status: "New", needSources: [source("01")], products: [{ name: "Cement", quantity: 100, unitOfMeasure: "bag", needSource: source("01"), needLine: 0 }, { name: "Cement", quantity: 100, unitOfMeasure: "bag", needSource: source("02"), needLine: 0 }] })
    // The screen hands over the RFQ without its need links — as RfqOffersView does.
    const po = await createPurchaseOrderFromAward(db, buyer, { rfq: { ...rfq, purchaseSource: null }, offer, offers: [offer], policies: DEFAULT_POLICIES }, { now: NOW })
    expect(raw("01").poId).toBe(po.id)
    expect(raw("02").poId).toBe(po.id)
  })

  it("leaves alone a request that moved on: answered by another RFQ, or already on an order", async () => {
    seed(R("01"), request({ rfqId: "rfq9" }))
    seed(R("02"), request({ seq: 2, poId: "po-old", poNumber: "PO-2026/900" }))
    seed("rfqs/rfq1", { ...rfq, status: "New", needSources: [source("02")] })
    await createPurchaseOrderFromAward(db, buyer, { rfq, offer, offers: [offer], policies: DEFAULT_POLICIES }, { now: NOW })
    expect(raw("01").poId).toBeUndefined()
    expect(raw("02")).toMatchObject({ poId: "po-old", poNumber: "PO-2026/900" })
  })

  it("an archived project's request is left as it is — and the award still goes through", async () => {
    seed(P, { organizationId: ORG, name: "Villas", projectManagerId: "pm1", pm: { no: "PJ-2026/001", lifecycle: "closed" } })
    const po = await createPurchaseOrderFromAward(db, buyer, { rfq, offer, offers: [offer], policies: DEFAULT_POLICIES }, { now: NOW })
    expect(po.created).toBe(true)
    expect(raw("01").poId).toBeUndefined()
  })

  it("an offer that already names its order writes nothing again", async () => {
    const first = await createPurchaseOrderFromAward(db, buyer, { rfq, offer, offers: [offer], policies: DEFAULT_POLICIES }, { now: NOW })
    const again = await createPurchaseOrderFromAward(db, buyer, { rfq, offer, offers: [offer], policies: DEFAULT_POLICIES }, { now: NOW })
    expect(again).toMatchObject({ id: first.id, created: false })
    expect(listCollection("purchaseOrders")).toHaveLength(1)
  })
})

describe("the comparison's award (awardRfq)", () => {
  const offerA: AwardOfferLike = { id: "A", price: "2000", supplierId: "ua", organizationId: "oa", companyName: "A Co", offerPdfUrl: "a.pdf" }
  const offerB: AwardOfferLike = { id: "B", price: "3000", supplierId: "ub", organizationId: "ob", companyName: "B Co", offerPdfUrl: "b.pdf" }
  const products = [
    { name: "Cement", description: "Cement", quantity: 100, unitOfMeasure: "bag", needSource: source("01"), needLine: 0 },
    { name: "Blocks", description: "Blocks", quantity: 1000, unitOfMeasure: "pc", needSource: source("01"), needLine: 1 },
  ]
  const rfqDoc: RfqLike = { id: "rfq1", title: "Cement and blocks", organizationId: ORG, contractorId: "buyer", projectId: "p1", city: "الرياض", products }
  const group = (o: AwardOfferLike, lines: number[], total: number) => ({ offer: o, lines: lines.map((i) => ({ rfqProductIndex: i, unitPrice: null })), total, requestedDeliveryDate: null, lowestForLines: null, offLowest: false })
  const input = (groups: AwardRfqInput["groups"]): AwardRfqInput => ({ rfq: rfqDoc, offers: [offerA, offerB], groups, unpicked: [], awardReason: null, breakdown: false, policies: DEFAULT_POLICIES })

  beforeEach(() => {
    seed(R("01"), request({ lines: [...request().lines, { itemId: "i1", code: "04-02-01", key: blocks, name: "Blocks", unit: "pc", qty: 1000, receipts: [] }], items: [...request().items, { name: "Blocks", quantity: 1000, unit: "pc", itemId: "i1" }] }))
    seed("rfqs/rfq1", { ...rfqDoc, status: "New", needSources: [source("01")] })
    seed("offers/A", { ...offerA, status: "قيد المراجعة" })
    seed("offers/B", { ...offerB, status: "قيد المراجعة" })
  })

  it("one supplier takes it all: the request names his order", async () => {
    const [po] = await awardRfq(db, buyer, input([group(offerA, [0, 1], 5000)]), { now: NOW })
    expect(raw("01")).toMatchObject({ poId: po.id, poNumber: po.docNumber })
    expect(raw("01").lineLinks).toBeUndefined()
  })

  it("split between two suppliers: each line is under the order that carries it", async () => {
    const out = await awardRfq(db, buyer, input([group(offerA, [0], 2000), group(offerB, [1], 3000)]), { now: NOW })
    const a = out.find((o) => o.offerId === "A") as { id: string; docNumber: string }
    const b = out.find((o) => o.offerId === "B") as { id: string; docNumber: string }
    const r = stored("01")
    expect(r.poId).toBe(a.id)
    expect(lineLink(r, r.lines[0])).toMatchObject({ poId: a.id, poNumber: a.docNumber })
    expect(lineLink(r, r.lines[1])).toMatchObject({ poId: b.id, poNumber: b.docNumber })
    // The second supplier's order still awaits approval while the first is out: only the first line is receivable.
    const status = (id: string) => ({ status: id === a.id ? "sent" : (readDoc<PurchaseOrder>(`purchaseOrders/${id}`) as PurchaseOrder).status })
    expect(receivable(r, r.lines[0], status(lineLink(r, r.lines[0]).poId as string))).toBe(true)
    expect(receivable(r, r.lines[1], status(lineLink(r, r.lines[1]).poId as string))).toBe(false)
  })

  it("a request none of whose lines was awarded keeps waiting on the RFQ", async () => {
    seed(R("02"), request({ seq: 2 }))
    seed("rfqs/rfq1", { ...rfqDoc, status: "New", needSources: [source("01"), source("02")], products: [...products, { name: "Sand", description: "Sand", quantity: 5, unitOfMeasure: "m3", needSource: source("02"), needLine: 0 }] })
    await awardRfq(db, buyer, { ...input([group(offerA, [0, 1], 5000)]), unpicked: [2] }, { now: NOW })
    expect(raw("02").poId).toBeUndefined()
    expect(raw("01").poId).toBeDefined()
  })
})
