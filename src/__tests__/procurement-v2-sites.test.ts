/** @jest-environment node */
/**
 * Procurement 2.0 — delivery places and delivery options (ED-02/03/04, SET-02, WF-08):
 *  - the chips: a place used by another group is disabled, the chosen one comes first, a retired one only while chosen;
 *  - a site's map link is an https address (anything else is refused) and the workshop is a kind only with Manufacturing;
 *  - the editor's group keeps its delivery options through the draft, and they travel to the RFQ and to the order;
 *  - `POST /api/procurement/delivery-sites` — the server writes the sites: the owner and whoever approves orders change them;
 *    whoever builds a request may also add a new one (ED-22).
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCaller = jest.fn()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (t !== "good") throw new Error("bad")
      return { uid: "u1" }
    },
  }),
  getAdminFirestore: () => mockDb,
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", arrayUnion: (...xs: unknown[]) => ({ union: xs }) } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: (...a: unknown[]) => mockCaller(...a) }))

import { POST } from "@/app/api/procurement/delivery-sites/route"
import { cleanDelivery, deliveryLine, readDeliveryOptions } from "@/lib/procurement/delivery-options"
import { normaliseMapUrl, siteInputSchema } from "@/lib/procurement/delivery-site-input"
import { deliverySites, manualSite, orderDeliveryFields, siteChips, storedSites, upsertSite, type DeliverySite } from "@/lib/procurement/delivery-sites"
import { deliveryOptionsOf, groupsFromRfq, groupsMeta, newGroup, blankLine, type EditorGroup } from "@/lib/procurement/rfq-editor"

const site = (id: string, name: string, over: Partial<DeliverySite> = {}): DeliverySite => ({ id, kind: "site", name, city: "الرياض", district: "", address: "", receiverId: null, ...over })

describe("the location chips (ED-03)", () => {
  const all = [site("a", "مجمع الياسمين"), site("b", "برج العليا"), site("c", "مستودع الخرج", { kind: "warehouse" }), site("d", "قديم", { retired: true })]

  it("one chip per place, the chosen one first", () => {
    const chips = siteChips(all, { selectedId: "b" })
    expect(chips.map((c) => c.site.id)).toEqual(["b", "a", "c"])
    expect(chips[0]).toMatchObject({ selected: true, disabled: false })
  })

  it("a place another group of the request uses is disabled; the group's own is not", () => {
    const chips = siteChips(all, { selectedId: "a", usedByOtherGroups: ["b", "a"] })
    expect(chips.find((c) => c.site.id === "b")?.disabled).toBe(true)
    expect(chips.find((c) => c.site.id === "a")).toMatchObject({ selected: true, disabled: false })
    expect(chips.find((c) => c.site.id === "c")?.disabled).toBe(false)
  })

  it("a retired place is shown only while it is the chosen one", () => {
    expect(siteChips(all, {}).some((c) => c.site.id === "d")).toBe(false)
    expect(siteChips(all, { selectedId: "d" }).some((c) => c.site.id === "d")).toBe(true)
  })
})

describe("a site's map link and kind (SET-02)", () => {
  it("accepts an https address, with or without the scheme, and refuses everything else", () => {
    expect(normaliseMapUrl("https://maps.app.goo.gl/abc")).toBe("https://maps.app.goo.gl/abc")
    expect(normaliseMapUrl("maps.app.goo.gl/abc")).toBe("https://maps.app.goo.gl/abc")
    expect(normaliseMapUrl("")).toBeNull()
    expect(normaliseMapUrl("http://maps.example.com/x")).toBeNull()
    expect(normaliseMapUrl("javascript:alert(1)")).toBeNull()
    expect(normaliseMapUrl("ftp://x.example.com/y")).toBeNull()
    expect(normaliseMapUrl("not a link")).toBeNull()
  })

  it("the schema needs a name and a city, takes an optional map link, and refuses a bad one", () => {
    expect(siteInputSchema.safeParse({ name: "فيلا النرجس", city: "الرياض" }).success).toBe(true)
    expect(siteInputSchema.safeParse({ name: "", city: "الرياض" }).success).toBe(false)
    expect(siteInputSchema.safeParse({ name: "فيلا", city: "" }).success).toBe(false)
    const withMap = siteInputSchema.parse({ name: "فيلا", city: "الرياض", mapUrl: "maps.app.goo.gl/x" })
    expect(withMap.mapUrl).toBe("https://maps.app.goo.gl/x")
    expect(siteInputSchema.parse({ name: "فيلا", city: "الرياض", mapUrl: "  " }).mapUrl).toBeNull()
    expect(siteInputSchema.safeParse({ name: "فيلا", city: "الرياض", mapUrl: "http://x.sa/y" }).success).toBe(false)
    expect(siteInputSchema.safeParse({ name: "فيلا", city: "الرياض", organizationId: "other" }).success).toBe(false)
  })

  it("the stored list keeps a valid map link, drops an invalid one, and reads the workshop kind", () => {
    const [a, b, c] = storedSites([
      { id: "s1", kind: "site", name: "موقع", city: "الرياض", mapUrl: "https://maps.app.goo.gl/x" },
      { id: "s2", kind: "site", name: "موقع 2", city: "الرياض", mapUrl: "javascript:alert(1)" },
      { id: "s3", kind: "workshop", name: "مستودع الورشة", city: "الرياض" },
    ])
    expect(a.mapUrl).toBe("https://maps.app.goo.gl/x")
    expect("mapUrl" in b).toBe(false)
    expect(c.kind).toBe("workshop")
    expect(upsertSite([], a)[0].mapUrl).toBe("https://maps.app.goo.gl/x")
  })

  it("the workshop's warehouse is a place only with Manufacturing in the package", () => {
    const stored = storedSites([{ id: "w", kind: "workshop", name: "مستودع الورشة", city: "الرياض" }, { id: "s", kind: "site", name: "موقع", city: "الرياض" }])
    const read = (mfgOn?: boolean) => deliverySites({ stored, warehouses: [], projects: [], pmOn: false, mfgOn }).map((x) => x.id).sort()
    expect(read(true)).toEqual(["s", "w"])
    expect(read(false)).toEqual(["s"])
    expect(read()).toEqual(["s", "w"])
  })

  it("a typed-in place is the buyer's to name; a project's or a warehouse record's is not", () => {
    expect(manualSite({ kind: "site" })).toBe(true)
    expect(manualSite({ kind: "workshop" })).toBe(true)
    expect(manualSite({ kind: "warehouse", warehouseId: null })).toBe(true)
    expect(manualSite({ kind: "warehouse", warehouseId: "w1" })).toBe(false)
    expect(manualSite({ kind: "project", projectId: "p1" })).toBe(false)
  })
})

describe("delivery options (ED-04)", () => {
  const withRows = (over: Partial<EditorGroup>): EditorGroup => newGroup({ lines: [{ ...blankLine(), name: "حديد", quantity: "5", unit: "طن" }], ...over })

  it("keeps only what was chosen, the note trimmed", () => {
    expect(cleanDelivery({ unload: "supplier", slot: null, note: "  البوابة الشمالية  " })).toEqual({ unload: "supplier", note: "البوابة الشمالية" })
    expect(cleanDelivery({ unload: "nobody", slot: "noon", note: " " })).toBeNull()
    expect(cleanDelivery(null)).toBeNull()
    expect(readDeliveryOptions({ s1: { slot: "am" }, s2: { slot: "x" }, "": { slot: "pm" } })).toEqual({ s1: { slot: "am" } })
  })

  it("is set per group, keyed by its place, and a group with no stored place by its own key", () => {
    const a = withRows({ key: "g1", siteId: "s1", delivery: { unload: "us", slot: "any" } })
    const b = withRows({ key: "g2", siteId: null, delivery: { note: "اتصل قبل الوصول" } })
    const c = withRows({ key: "g3", siteId: "s3", delivery: { unload: null, slot: null, note: "" } })
    const empty = newGroup({ key: "g4", siteId: "s4", delivery: { slot: "pm" } })
    expect(deliveryOptionsOf([a, b, c, empty])).toEqual({ s1: { unload: "us", slot: "any" }, g2: { note: "اتصل قبل الوصول" } })
  })

  it("survives the draft: written with the group, read back on reopen", () => {
    const g = withRows({ key: "g1", siteId: "s1", delivery: { unload: "supplier", slot: "am", note: "الطريق يتسع لشاحنة 12 م" } })
    const meta = groupsMeta([g])
    expect(meta[0].delivery).toEqual({ unload: "supplier", slot: "am", note: "الطريق يتسع لشاحنة 12 م" })
    const back = groupsFromRfq({ editorGroups: meta, products: [{ name: "حديد", quantity: 5, unitOfMeasure: "طن", deliverySiteId: "s1" }] })
    expect(back[0].delivery).toEqual({ unload: "supplier", slot: "am", note: "الطريق يتسع لشاحنة 12 م" })
    expect(groupsFromRfq({ editorGroups: groupsMeta([withRows({ key: "g9" })]), products: [] })[0].delivery).toBeUndefined()
  })

  it("travels with the order: the RFQ's options are carried by the award, none when it set none", () => {
    const rfq = { city: "الرياض", district: "العليا", deliveryOptions: { s1: { unload: "supplier", slot: "am", note: "x" }, junk: { slot: "nope" } } }
    expect(orderDeliveryFields({}, rfq)).toEqual({ deliveryLocation: "الرياض", deliveryDistrict: "العليا", deliveryOptions: { s1: { unload: "supplier", slot: "am", note: "x" } } })
    expect(orderDeliveryFields({}, { city: "الرياض", district: "العليا" })).toEqual({ deliveryLocation: "الرياض", deliveryDistrict: "العليا" })
  })

  it("reads as the supplier reads it", () => {
    const t = (k: string) => ({ deliv_unload_supplier: "التنزيل على المورّد", deliv_slot_am: "صباحاً" })[k] ?? k
    expect(deliveryLine({ unload: "supplier", slot: "am" }, t)).toBe("التنزيل على المورّد · صباحاً")
    expect(deliveryLine(null, t)).toBe("")
  })
})

const ORG = "org1"
const headers = { authorization: "Bearer good", "content-type": "application/json" }
const call = (body: unknown, auth = true) =>
  POST(new NextRequest("http://localhost/api/procurement/delivery-sites", { method: "POST", headers: auth ? headers : { "content-type": "application/json" }, body: JSON.stringify(body) }))
const caller = (can: (p: string) => boolean) => ({ uid: "u1", orgId: ORG, name: "نورة", can })
const settings = () => mockDb.get(`procurementSettings/${ORG}`) as { deliverySites?: DeliverySite[]; organizationId?: string; updatedById?: string; sealOffersUntilDeadline?: boolean } | undefined

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockCaller.mockReset()
  mockCaller.mockResolvedValue(caller((p) => p === "po.approve"))
  mockDb.seed(`procurementSettings/${ORG}`, { organizationId: ORG, sealOffersUntilDeadline: false, deliverySites: [site("s0", "موقع قديم")] })
})

describe("POST /api/procurement/delivery-sites (ED-03, SET-02)", () => {
  it("refuses a request without a valid sign-in", async () => {
    expect((await call({ site: { name: "فيلا", city: "الرياض" } }, false)).status).toBe(401)
    expect(mockDb.writes).toHaveLength(0)
  })

  it("refuses a member who only asks for materials", async () => {
    mockCaller.mockResolvedValue(caller(() => false))
    const res = await call({ site: { name: "فيلا", city: "الرياض" } })
    expect(res.status).toBe(403)
    expect(settings()?.deliverySites).toHaveLength(1)
  })

  it("the owner and whoever approves orders add a site: it gets an id, the rest of the settings stays", async () => {
    const res = await call({ site: { name: "فيلا حي النرجس", city: "الرياض", district: "النرجس", kind: "site", mapUrl: "maps.app.goo.gl/x" } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.site).toMatchObject({ name: "فيلا حي النرجس", city: "الرياض", district: "النرجس", mapUrl: "https://maps.app.goo.gl/x", kind: "site" })
    expect(body.data.site.id).toMatch(/^site_/)
    const doc = settings()!
    expect(doc.deliverySites!.map((s) => s.name)).toEqual(["موقع قديم", "فيلا حي النرجس"])
    expect(doc.sealOffersUntilDeadline).toBe(false)
    expect(doc.organizationId).toBe(ORG)
    expect(doc.updatedById).toBe("u1")
  })

  it("whoever builds a request adds a new site from «+ موقع جديد», but never changes or retires a stored one (ED-22)", async () => {
    for (const perm of ["rfq.create", "rfq.manage", "offers.accept"]) {
      mockCaller.mockResolvedValue(caller((p) => p === perm))
      const res = await call({ site: { name: `موقع ${perm}`, city: "الرياض" } })
      expect(res.status).toBe(200)
    }
    expect(settings()!.deliverySites!.map((s) => s.name)).toEqual(["موقع قديم", "موقع rfq.create", "موقع rfq.manage", "موقع offers.accept"])
    mockCaller.mockResolvedValue(caller((p) => p === "rfq.manage"))
    expect((await call({ site: { id: "s0", name: "موقع قديم", city: "جدة" } })).status).toBe(403)
    expect((await call({ site: { name: "موقع متقاعد", city: "جدة", retired: true } })).status).toBe(403)
    expect(settings()!.deliverySites!.find((s) => s.id === "s0")?.city).not.toBe("جدة")
    expect(settings()!.deliverySites).toHaveLength(4)
  })

  it("a site with an id already stored is replaced, not added again", async () => {
    const res = await call({ site: { id: "s0", name: "موقع قديم", city: "جدة", mapUrl: "https://maps.app.goo.gl/y", retired: true } })
    expect(res.status).toBe(200)
    const list = settings()!.deliverySites!
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: "s0", city: "جدة", mapUrl: "https://maps.app.goo.gl/y", retired: true })
  })

  it("a map link that is not https is refused, and nothing is written", async () => {
    for (const bad of ["http://maps.example.com/x", "javascript:alert(1)", "hello"]) {
      const res = await call({ site: { name: "فيلا", city: "الرياض", mapUrl: bad } })
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe("BAD_MAP_URL")
    }
    expect(settings()?.deliverySites).toHaveLength(1)
  })

  it("needs a name and a city, and cannot name another company", async () => {
    expect((await call({ site: { name: "فيلا", city: "" } })).status).toBe(400)
    expect((await call({ site: { name: " ", city: "الرياض" } })).status).toBe(400)
    expect((await call({ site: { name: "فيلا", city: "الرياض" }, orgId: "org2" })).status).toBe(400)
    expect((await call({ site: { name: "فيلا", city: "الرياض", organizationId: "org2" } })).status).toBe(400)
  })

  it("the workshop's warehouse needs Manufacturing in the package", async () => {
    mockDb.seed(`companyModules/${ORG}`, { off: ["manufacturing"] })
    const refused = await call({ site: { name: "مستودع الورشة", city: "الرياض", kind: "workshop" } })
    expect(refused.status).toBe(409)
    expect((await refused.json()).code).toBe("MFG_OFF")
    mockDb.seed(`companyModules/${ORG}`, { off: [] })
    expect((await call({ site: { name: "مستودع الورشة", city: "الرياض", kind: "workshop" } })).status).toBe(200)
    expect(settings()!.deliverySites!.some((s) => s.kind === "workshop")).toBe(true)
  })

  it("a receiver must be one of the company's own", async () => {
    mockDb.seed("procurementReceivers/r1", { organizationId: ORG, name: "أبو فهد" })
    mockDb.seed("procurementReceivers/r2", { organizationId: "org2", name: "غريب" })
    expect((await call({ site: { name: "فيلا", city: "الرياض", receiverId: "r2" } })).status).toBe(400)
    expect((await call({ site: { name: "فيلا", city: "الرياض", receiverId: "nobody" } })).status).toBe(400)
    const ok = await call({ site: { name: "فيلا", city: "الرياض", receiverId: "r1" } })
    expect(ok.status).toBe(200)
    expect((await ok.json()).data.site.receiverId).toBe("r1")
  })

  it("an unreadable body is a bad request", async () => {
    const res = await POST(new NextRequest("http://localhost/api/procurement/delivery-sites", { method: "POST", headers, body: "{not json" }))
    expect(res.status).toBe(400)
  })
})
