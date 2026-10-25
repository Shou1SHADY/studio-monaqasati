// PUR-02: a project's group arrives with its city and district — read from the project's own free-text location.
import { deliverySites, placeFromText, projectSiteId } from "@/lib/procurement/delivery-sites"
import { rfqDisplayNumber } from "@/lib/procurement/format"

describe("a project's location read as a city and a district", () => {
  it("takes the city the text names and keeps the rest as the district", () => {
    expect(placeFromText("الرياض - حي الياسمين")).toEqual({ city: "الرياض", district: "حي الياسمين" })
    expect(placeFromText("حي الياسمين، الرياض")).toEqual({ city: "الرياض", district: "حي الياسمين" })
    expect(placeFromText("جدة")).toEqual({ city: "جدة", district: "" })
    expect(placeFromText("Riyadh, Al Yasmin")).toEqual({ city: "الرياض", district: "Al Yasmin" })
  })
  it("does not mistake a hamza variant, and takes the longest city", () => {
    expect(placeFromText("الاحساء - المبرز")).toEqual({ city: "الأحساء", district: "المبرز" })
    expect(placeFromText("خميس مشيط")).toEqual({ city: "خميس مشيط", district: "" })
  })
  it("keeps free text that names no city whole, as the district", () => {
    expect(placeFromText("طريق الملك فهد، حي العليا")).toEqual({ city: "", district: "طريق الملك فهد، حي العليا" })
    expect(placeFromText("")).toEqual({ city: "", district: "" })
    expect(placeFromText(undefined)).toEqual({ city: "", district: "" })
  })
  it("fills the project's site when it is not stored; a stored site keeps its own", () => {
    const base = { warehouses: [], pmOn: true }
    const auto = deliverySites({ ...base, stored: [], projects: [{ id: "p1", name: "مجمع الياسمين", location: "الرياض - حي الياسمين" }] })
    expect(auto.find((s) => s.id === projectSiteId("p1"))).toMatchObject({ city: "الرياض", district: "حي الياسمين", address: "الرياض - حي الياسمين" })
    const stored = deliverySites({ ...base, stored: [{ id: "prj_p1", kind: "project", name: "مجمع الياسمين", city: "الدمام", district: "الشاطئ", address: "", receiverId: null, projectId: "p1" }], projects: [{ id: "p1", name: "x", location: "الرياض" }] })
    expect(stored.find((s) => s.id === "prj_p1")).toMatchObject({ city: "الدمام", district: "الشاطئ" })
  })
})

describe("an RFQ's number on screen", () => {
  it("is the numbered one, or nothing — never a «RFQ-—» placeholder nor a piece of the document id", () => {
    expect(rfqDisplayNumber({ rfqNumber: "RFQ-2026/005" }, "en")).toBe("RFQ-2026/005")
    expect(rfqDisplayNumber({ rfqNumber: null }, "ar")).toBe("")
    expect(rfqDisplayNumber({}, "en")).toBe("")
  })
})
