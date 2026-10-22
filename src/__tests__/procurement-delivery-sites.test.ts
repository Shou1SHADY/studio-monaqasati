import { deliverySites, linkedProjectId, orderDeliveryFields, projectSiteId, siteLine, storedSites, upsertSite } from "@/lib/procurement/delivery-sites"

describe("delivery sites (PUR-10)", () => {
  const stored = storedSites([{ id: "s1", kind: "site", name: "موقع الدمام", city: "الدمام", district: "الشاطئ", address: "", receiverId: "r1" }, { bad: true }])
  it("reads the stored list and ignores what is not a site", () => {
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ id: "s1", receiverId: "r1" })
  })
  it("adds the warehouses, and with Project Management the projects, once", () => {
    const all = deliverySites({ stored, warehouses: [{ id: "w1", name: "المستودع المركزي" }, { id: "w2", name: "مخزن المشروع", projectId: "p1" }], projects: [{ id: "p1", name: "مجمع الياسمين", location: "الرياض" }], pmOn: true })
    expect(all.map((s) => s.id).sort()).toEqual(["prj_p1", "s1", "wh_w1"])
    expect(all.find((s) => s.id === projectSiteId("p1"))).toMatchObject({ kind: "project", city: "الرياض", district: "", address: "الرياض" })
  })
  it("adds no project of its own without Project Management, and hides none already stored (NFR-08: a package change is a migration, not a filter)", () => {
    const all = deliverySites({ stored: [...stored, { id: "prj_p1", kind: "project", name: "x", city: "", district: "", address: "", receiverId: null, projectId: "p1" }], warehouses: [], projects: [{ id: "p1" }, { id: "p2", name: "غير مخزّن" }], pmOn: false })
    expect(all.map((s) => s.id).sort()).toEqual(["prj_p1", "s1"])
  })
  it("prints city and district as the supplier reads them, and saves in place", () => {
    expect(siteLine({ city: "الرياض", district: "حي الياسمين" })).toBe("الرياض — حي الياسمين")
    expect(upsertSite(stored, { ...stored[0], city: "الخبر" })[0].city).toBe("الخبر")
  })
})

// Review of 20 Oct 2026: the second save of any site failed — `retired: undefined` on every
// live site, and Firestore refuses an undefined field.
describe("what is written back has no undefined field", () => {
  const hasUndefined = (o: object) => Object.values(o).some((v) => v === undefined)
  it("a site read back carries no `retired: undefined`", () => {
    const [site] = storedSites([{ id: "s1", kind: "site", name: "موقع", city: "الرياض", district: "", address: "" }])
    expect("retired" in site).toBe(false)
    expect(storedSites([{ id: "s2", kind: "site", name: "قديم", city: "الرياض", retired: true }])[0].retired).toBe(true)
  })
  it("upsertSite writes no undefined, whatever the site came with", () => {
    const stored = storedSites([{ id: "s1", kind: "site", name: "موقع", city: "الرياض", district: "", address: "" }])
    const next = upsertSite(stored, { id: "w1", kind: "warehouse", name: "المستودع", city: "الرياض", district: "", address: "", receiverId: null, retired: undefined })
    expect(next.some(hasUndefined)).toBe(false)
  })
})

describe("a work site linked to a project (PUR-10)", () => {
  const linked = storedSites([{ id: "s1", kind: "site", name: "مجمع الياسمين — 5 فلل", city: "الرياض", district: "الياسمين", address: "", projectId: "p1" }])

  it("keeps the project it is linked to when read back", () => {
    expect(linked[0].projectId).toBe("p1")
    expect(linkedProjectId(linked[0])).toBe("p1")
    expect(linkedProjectId({ kind: "warehouse", projectId: "p1" })).toBeNull()
    expect(linkedProjectId({ kind: "site", projectId: null })).toBeNull()
  })

  it("is the project's site: the project does not join the list a second time", () => {
    const all = deliverySites({ stored: linked, warehouses: [], projects: [{ id: "p1", name: "مجمع الياسمين" }, { id: "p2", name: "برج العليا" }], pmOn: true })
    expect(all.map((s) => s.id).sort()).toEqual(["prj_p2", "s1"])
  })

  it("survives a save", () => {
    expect(upsertSite([], { ...linked[0], city: "جدة" })[0]).toMatchObject({ projectId: "p1", city: "جدة" })
  })
})

describe("the order keeps the district as well as the city (PUR-10)", () => {
  it("takes the offer's place, and the RFQ's district while the city is the RFQ's", () => {
    expect(orderDeliveryFields({}, { city: "الرياض", district: "الياسمين" })).toEqual({ deliveryLocation: "الرياض", deliveryDistrict: "الياسمين" })
    expect(orderDeliveryFields({ deliveryLocation: "الرياض" }, { city: "الرياض", district: "الياسمين" })).toEqual({ deliveryLocation: "الرياض", deliveryDistrict: "الياسمين" })
  })

  it("never lends the RFQ's district to another city", () => {
    expect(orderDeliveryFields({ deliveryLocation: "جدة" }, { city: "الرياض", district: "الياسمين" })).toEqual({ deliveryLocation: "جدة", deliveryDistrict: null })
  })

  it("the offer's own district wins", () => {
    expect(orderDeliveryFields({ deliveryLocation: "جدة", deliveryDistrict: "الروضة" }, { city: "الرياض", district: "الياسمين" })).toEqual({ deliveryLocation: "جدة", deliveryDistrict: "الروضة" })
  })

  it("is null where nothing is known", () => {
    expect(orderDeliveryFields({}, {})).toEqual({ deliveryLocation: null, deliveryDistrict: null })
  })
})
