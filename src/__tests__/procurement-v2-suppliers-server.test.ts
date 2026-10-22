/** @jest-environment node */
/**
 * Procurement 2.0, SUP-01..03 / NFR-03 on the server: the platform directory is served a page at a time from daily cards
 * (never the whole platform to the browser), the cards count what a supplier completed across ALL buyers, only verified
 * suppliers are listed, and an off-platform supplier is added to «موردينا» by the mobile a code proved — nothing typed.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => (t === "bad" ? Promise.reject(new Error("bad")) : { uid: t }) }),
  getAdminFirestore: () => mockDb,
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: async (_db: unknown, uid: string) => mockCallers[uid] ?? null }))

import { GET as directory } from "@/app/api/procurement/suppliers/route"
import { POST as addGuest } from "@/app/api/procurement/suppliers/add-guest/route"
import { ensureSupplierStats, rebuildSupplierStats } from "@/lib/procurement/supplier-stats-server"
import { SUPPLIER_STATS, SUPPLIER_STATS_META, type SupplierCard } from "@/lib/procurement/supplier-stats"
import { guestSupplierKey } from "@/lib/procurement/supplier-offplatform"

const ORG = "buyer1"
const caller = (can: (p: string) => boolean = () => true, orgId = ORG) => ({ uid: "u1", name: "سعد", orgId, can })

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  mockCallers.manager = caller()
  mockCallers.expediter = caller((p) => p === "po.expedite")
  mockCallers.outsider = caller(() => false)
})

const line = (accepted: number) => ({ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 100, accepted, rejected: 0, held: 0, cancelled: 0 })
const supplierUser = (id: string, over: Record<string, unknown> = {}) =>
  mockDb.seed(`users/${id}`, { role: "Supplier", organizationId: id, organizationRole: "owner", companyName: `مورد ${id}`, city: "الرياض", specializations: [], specialtyIds: ["steel"], isVerified: true, createdAt: "2024-05-01T00:00:00Z", phone: "0501234567", email: `${id}@x.sa`, taxNumber: "300000000000003", ...over })
const order = (id: string, supplierOrgId: string, over: Record<string, unknown> = {}) =>
  mockDb.seed(`purchaseOrders/${id}`, {
    organizationId: id.startsWith("o-b2") ? "buyer2" : ORG,
    docNumber: `PO-2026/${id}`,
    status: "accepted",
    supplierOrgId,
    supplierAcceptedAt: "2026-09-01T08:00:00Z",
    promisedDate: "2026-09-10",
    lines: [line(10)],
    totalExVat: 1000,
    vatRate: 0.15,
    log: [],
    ...over,
  })
const receipt = (id: string, poId: string, supplierOrgId: string, day: string) => mockDb.seed(`deliveries/${id}`, { poId, supplierOrgId, status: "confirmed", confirmedAt: `${day}T08:00:00Z`, deliveryDate: day, lines: [] })
const fresh = () => mockDb.seed(`${SUPPLIER_STATS}/${SUPPLIER_STATS_META}`, { updatedAt: new Date().toISOString(), rebuildingUntil: null })

const get = async (user: string, qs = "") => {
  const res = await directory(new NextRequest(`http://localhost/api/procurement/suppliers${qs}`, { headers: { authorization: `Bearer ${user}` } }))
  return { status: res.status, json: (await res.json()) as { data?: Record<string, unknown> & { rows?: Array<Record<string, unknown>>; cards?: SupplierCard[] }; code?: string } }
}

describe("the daily cards", () => {
  it("counts what a supplier completed across ALL buyers, with on-time and a computed rating", async () => {
    supplierUser("s1")
    supplierUser("s2")
    for (const [i, buyerKey] of ["o-b1-1", "o-b2-1", "o-b1-2", "o-b2-2"].entries()) {
      order(buyerKey, "s1")
      receipt(`r${i}`, buyerKey, "s1", i === 3 ? "2026-09-20" : "2026-09-09")
    }
    order("o-b1-open", "s1", { lines: [line(0)] })
    order("o-x", "s2", { lines: [line(0)] })
    await rebuildSupplierStats(mockDb as never, new Date("2026-10-20T08:00:00Z"))
    const s1 = mockDb.get(`${SUPPLIER_STATS}/s1`) as unknown as SupplierCard
    expect(s1.completedOps).toBe(4)
    expect(s1.judgedOrders).toBe(5)
    expect(s1.onTimePercent).toBe(60)
    expect(s1.rating).not.toBeNull()
    expect((mockDb.get(`${SUPPLIER_STATS}/s2`) as unknown as SupplierCard).completedOps).toBe(0)
    expect((mockDb.get(`${SUPPLIER_STATS}/s2`) as unknown as SupplierCard).rating).toBeNull()
  })

  it("rebuilds 300 supplier companies in one pass, each with its own numbers", async () => {
    for (let i = 0; i < 300; i++) supplierUser(`m${i}`)
    order("o-m7", "m7")
    receipt("r-m7", "o-m7", "m7", "2026-09-09")
    const t0 = performance.now()
    const { suppliers } = await rebuildSupplierStats(mockDb as never, new Date("2026-10-20T08:00:00Z"))
    expect(suppliers).toBe(300)
    expect(performance.now() - t0).toBeLessThan(5000)
    expect((mockDb.get(`${SUPPLIER_STATS}/m7`) as unknown as SupplierCard).completedOps).toBe(1)
    expect((mockDb.get(`${SUPPLIER_STATS}/m8`) as unknown as SupplierCard).completedOps).toBe(0)
  })

  it("keeps public facts only — no phone, e-mail or tax number — and the verified flag", async () => {
    supplierUser("s1", { isVerified: false })
    await rebuildSupplierStats(mockDb as never)
    const card = mockDb.get(`${SUPPLIER_STATS}/s1`) as Record<string, unknown>
    expect(Object.keys(card)).not.toEqual(expect.arrayContaining(["phone"]))
    expect(JSON.stringify(card)).not.toMatch(/0501234567|s1@x\.sa|300000000000003/)
    expect(card.verified).toBe(false)
  })

  it("a supplier company with two accounts is one card", async () => {
    supplierUser("s1")
    mockDb.seed("users/s1-member", { role: "Supplier", organizationId: "s1", organizationRole: "member", name: "عضو" })
    await rebuildSupplierStats(mockDb as never)
    expect(mockDb.list(SUPPLIER_STATS).filter((d) => d.id !== SUPPLIER_STATS_META)).toHaveLength(1)
  })

  it("is rebuilt when a day old, not when fresh, and once while another request holds the lock", async () => {
    supplierUser("s1")
    expect((await ensureSupplierStats(mockDb as never)).rebuilt).toBe(true)
    expect((await ensureSupplierStats(mockDb as never)).rebuilt).toBe(false)
    const now = new Date()
    mockDb.seed(`${SUPPLIER_STATS}/${SUPPLIER_STATS_META}`, { updatedAt: new Date(now.getTime() - 26 * 3_600_000).toISOString(), rebuildingUntil: new Date(now.getTime() + 60_000).toISOString() })
    expect((await ensureSupplierStats(mockDb as never, now)).rebuilt).toBe(false)
    mockDb.seed(`${SUPPLIER_STATS}/${SUPPLIER_STATS_META}`, { updatedAt: new Date(now.getTime() - 26 * 3_600_000).toISOString(), rebuildingUntil: null })
    expect((await ensureSupplierStats(mockDb as never, now)).rebuilt).toBe(true)
  })
})

describe("GET /api/procurement/suppliers — the directory a page at a time", () => {
  const seed300 = () => {
    for (let i = 0; i < 300; i++) {
      mockDb.seed(`${SUPPLIER_STATS}/d${i}`, {
        orgId: `d${i}`,
        name: `مورد ${String(i).padStart(3, "0")}`,
        city: ["الرياض", "جدة", "الدمام"][i % 3],
        coverageCities: [],
        specialties: [`sub${i % 12}`],
        since: "2024-01-01",
        verified: i % 15 !== 0,
        hasProfile: i % 2 === 0,
        hasWorks: false,
        hasCerts: i % 4 === 0,
        completedOps: i,
        judgedOrders: i,
        onTimePercent: 90,
        rejectPercent: 1,
        rating: 4,
        reviewAvg: null,
        reviewCount: 0,
        updatedAt: "2026-10-20T00:00:00Z",
      })
    }
    fresh()
  }

  it("answers 24 of the verified, the counts, and what is left — never the whole platform", async () => {
    seed300()
    const { status, json } = await get("manager")
    expect(status).toBe(200)
    expect(json.data?.rows).toHaveLength(24)
    expect(json.data?.total).toBe(280)
    expect(json.data?.matched).toBe(280)
    expect(json.data?.remaining).toBe(256)
    expect(json.data?.more).toBe(24)
    expect((json.data?.rows || []).every((r) => r.verified === true)).toBe(true)
    expect((json.data?.rows || [])[0].completedOps).toBe(299)
  })

  it("filters by specialty, city and status and sorts on the server; pages with an offset", async () => {
    seed300()
    const filtered = await get("manager", `?city=${encodeURIComponent("جدة")}&specialty=sub4&status=prof&sort=name`)
    const rows = filtered.json.data?.rows || []
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.city === "جدة" && (r.specialties as string[]).includes("sub4") && r.hasProfile === true)).toBe(true)
    const names = rows.map((r) => String(r.name))
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "ar")))
    const first = await get("manager", "?limit=10")
    const second = await get("manager", "?limit=10&offset=10")
    expect((second.json.data?.rows || [])[0].orgId).not.toBe((first.json.data?.rows || [])[0].orgId)
    expect((second.json.data?.rows || []).map((r) => r.orgId)).not.toEqual(expect.arrayContaining((first.json.data?.rows || []).map((r) => r.orgId)))
    expect(second.json.data?.remaining).toBe(260)
  })

  it("marks the suppliers this company already keeps (link, record, favourite) and filters «ليسوا من مورّدينا»", async () => {
    seed300()
    mockDb.seed("contractorSupplierLinks/l1", { contractorOrgId: ORG, supplierOrgId: "d1", status: "active" })
    mockDb.seed(`supplierRecords/${ORG}__d2`, { organizationId: ORG, supplierOrgId: "d2" })
    mockDb.seed("users/u1", { favoriteSuppliers: ["d3"] })
    const all = await get("manager", "?limit=48&sort=name&q=" + encodeURIComponent("مورد 00"))
    const ours = (all.json.data?.rows || []).filter((r) => r.ours).map((r) => r.orgId)
    expect(ours.sort()).toEqual(["d1", "d2", "d3"])
    const notOurs = await get("manager", "?status=notours&limit=48&q=" + encodeURIComponent("مورد 00"))
    expect((notOurs.json.data?.rows || []).some((r) => r.ours)).toBe(false)
  })

  it("serves the platform numbers of named suppliers, verified or not, for a supplier's file", async () => {
    seed300()
    const { json } = await get("manager", "?ids=d0,d1,missing")
    expect((json.data?.cards || []).map((c) => c.orgId)).toEqual(["d0", "d1"])
    expect(json.data?.cards?.[0].verified).toBe(false)
  })

  it("answers «موجود في المنصة» for an invitation: the id and the name behind a mobile or e-mail, nothing else", async () => {
    seed300()
    supplierUser("sx", { phone: "+966551234567", email: "sx@company.sa", companyName: "شركة س", taxNumber: "300000000000003" })
    const byPhone = await get("manager", "?contact=" + encodeURIComponent("0551234567"))
    expect(byPhone.json.data).toEqual({ match: { orgId: "sx", name: "شركة س" } })
    const byMail = await get("manager", "?contact=" + encodeURIComponent("SX@Company.sa"))
    expect(byMail.json.data).toEqual({ match: { orgId: "sx", name: "شركة س" } })
    expect((await get("manager", "?contact=" + encodeURIComponent("0509999999"))).json.data).toEqual({ match: null })
    expect((await get("manager", "?contact=nonsense")).json.data).toEqual({ match: null })
  })

  it("is for the buying team: no token 401, no procurement permission 403, bad query 400", async () => {
    seed300()
    expect((await directory(new NextRequest("http://localhost/api/procurement/suppliers"))).status).toBe(401)
    expect((await get("bad")).status).toBe(401)
    expect((await get("outsider")).status).toBe(403)
    expect((await get("expediter")).status).toBe(200)
    expect((await get("manager", "?sort=hacked")).status).toBe(400)
    expect((await get("manager", "?limit=1000")).status).toBe(400)
  })

  it("renders 300 suppliers' worth of reading in well under a second", async () => {
    seed300()
    const t0 = performance.now()
    await get("manager", "?q=" + encodeURIComponent("مورد") + "&sort=rate")
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})

describe("POST /api/procurement/suppliers/add-guest — «أضِفه إلى موردينا» for a supplier with no account", () => {
  const rfq = (org = ORG) => mockDb.seed("rfqs/r1", { organizationId: org, title: "حديد" })
  const guestOffer = (over: Record<string, unknown> = {}) =>
    mockDb.seed("offers/of1", { rfqId: "r1", isGuestOffer: true, organizationId: "guest", supplierName: "محل الحي", guestContact: { name: "أبو خالد", phone: "0561112299", phoneVerified: true, vatNumber: "300111222333003" }, ...over })
  const post = async (user: string, body: unknown) => {
    const res = await addGuest(new NextRequest("http://localhost/api/procurement/suppliers/add-guest", { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
    return { status: res.status, json: (await res.json()) as { data?: { supplierOrgId: string; created: boolean }; code?: string } }
  }
  const KEY = guestSupplierKey("0561112299") as string

  it("keeps an unverified record keyed by the verified mobile, tagged as coming from a visitor link", async () => {
    rfq()
    guestOffer()
    const { status, json } = await post("manager", { offerId: "of1" })
    expect(status).toBe(200)
    expect(json.data).toEqual({ supplierOrgId: KEY, created: true })
    expect(KEY).toBe("guest_966561112299")
    expect(mockDb.get(`supplierRecords/${ORG}__${KEY}`)).toMatchObject({ supplierName: "أبو خالد", source: "guest_link", verified: false, kind: "mat", organizationId: ORG, supplierOrgId: KEY, guestPhone: "+966561112299", addedById: "u1" })
  })

  it("is idempotent: the same man from the same number is one supplier", async () => {
    rfq()
    guestOffer()
    await post("manager", { offerId: "of1" })
    const again = await post("manager", { offerId: "of1" })
    expect(again.json.data?.created).toBe(false)
    expect(mockDb.writes.filter(([p]) => p.startsWith("supplierRecords/"))).toHaveLength(1)
  })

  it("is named by the order too", async () => {
    rfq()
    guestOffer()
    mockDb.seed("purchaseOrders/po1", { organizationId: ORG, offerId: "of1" })
    expect((await post("manager", { poId: "po1" })).json.data?.supplierOrgId).toBe(KEY)
  })

  it("refuses a mobile nobody proved — it is no key", async () => {
    rfq()
    guestOffer({ guestContact: { name: "أبو خالد", phone: "0561112299", phoneVerified: false } })
    const { status, json } = await post("manager", { offerId: "of1" })
    expect(status).toBe(409)
    expect(json.code).toBe("PHONE_NOT_VERIFIED")
    expect(mockDb.list("supplierRecords")).toHaveLength(0)
  })

  it("refuses a registered supplier's offer (he is added from the directory) and another company's offer", async () => {
    rfq()
    guestOffer({ isGuestOffer: false })
    expect((await post("manager", { offerId: "of1" })).json.code).toBe("NOT_A_GUEST")
    mockDb.docs.clear()
    rfq("other-org")
    guestOffer()
    expect((await post("manager", { offerId: "of1" })).status).toBe(404)
  })

  it("is for whoever keeps the supplier file, and takes only an offer or an order", async () => {
    rfq()
    guestOffer()
    expect((await post("expediter", { offerId: "of1" })).status).toBe(403)
    expect((await post("manager", {})).status).toBe(400)
    expect((await post("manager", { offerId: "of1", name: "مصطنع" })).status).toBe(400)
  })
})
