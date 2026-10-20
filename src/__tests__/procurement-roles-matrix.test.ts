import { roleRows } from "@/lib/procurement/roles-matrix"

describe("Settings → roles (PUR-08)", () => {
  it("the owner holds every act; the approver up to his limit; the expediter follows up", () => {
    const rows = roleRows({ financeOn: true, pmOn: true, ownerStepsBack: false })
    expect(rows.every((r) => r.cells.owner === true)).toBe(true)
    expect(rows.find((r) => r.id === "approve")?.cells.manager).toBe("limit")
    expect(rows.filter((r) => r.cells.expediter === true).map((r) => r.id)).toEqual(["expedite"])
    expect(rows.map((r) => r.id)).not.toContain("mark_paid")
  })
  it("the owner who stepped back reads prices and approves only", () => {
    const rows = roleRows({ financeOn: true, pmOn: true, ownerStepsBack: true })
    expect(rows.filter((r) => r.cells.owner === true).map((r) => r.id)).toEqual(["prices", "approve"])
  })
  it("shows «يعلّم الدفع» without Finance and «يرفع طلب مواد» without Project Management", () => {
    const ids = roleRows({ financeOn: false, pmOn: false, ownerStepsBack: false }).map((r) => r.id)
    expect(ids).toEqual(expect.arrayContaining(["mark_paid", "raise_request"]))
  })
})
