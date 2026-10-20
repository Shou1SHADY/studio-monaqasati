import { deliverySites, projectSiteId, siteLine, storedSites, upsertSite } from "@/lib/procurement/delivery-sites"

describe("delivery sites (PUR-10)", () => {
  const stored = storedSites([{ id: "s1", kind: "site", name: "موقع الدمام", city: "الدمام", district: "الشاطئ", address: "", receiverId: "r1" }, { bad: true }])
  it("reads the stored list and ignores what is not a site", () => {
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ id: "s1", receiverId: "r1" })
  })
  it("adds the warehouses, and with Project Management the projects, once", () => {
    const all = deliverySites({ stored, warehouses: [{ id: "w1", name: "المستودع المركزي" }, { id: "w2", name: "مخزن المشروع", projectId: "p1" }], projects: [{ id: "p1", name: "مجمع الياسمين", location: "الرياض" }], pmOn: true })
    expect(all.map((s) => s.id).sort()).toEqual(["prj_p1", "s1", "wh_w1"])
    expect(all.find((s) => s.id === projectSiteId("p1"))).toMatchObject({ kind: "project", city: "", address: "الرياض" })
  })
  it("shows no project without Project Management", () => {
    const all = deliverySites({ stored: [...stored, { id: "prj_p1", kind: "project", name: "x", city: "", district: "", address: "", receiverId: null, projectId: "p1" }], warehouses: [], projects: [{ id: "p1" }], pmOn: false })
    expect(all.map((s) => s.kind)).toEqual(["site"])
  })
  it("prints city and district as the supplier reads them, and saves in place", () => {
    expect(siteLine({ city: "الرياض", district: "حي الياسمين" })).toBe("الرياض — حي الياسمين")
    expect(upsertSite(stored, { ...stored[0], city: "الخبر" })[0].city).toBe("الخبر")
  })
})
