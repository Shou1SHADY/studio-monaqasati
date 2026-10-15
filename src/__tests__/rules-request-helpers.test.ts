import { readFileSync } from "fs"
import { join } from "path"

// The 15 Oct 2026 size refactor folded `request.resource.data.contractorOrgId == getOrganizationId()` into
// `request.isContractorOrg()`. It compiles, but `request` has no such method: the expression is an evaluation
// error and every branch that used it denied — supplier connection requests, contractor favourites, supplier
// delivery notices, manual receipts, guarantee answers. The helpers read `resource`; on a create use `rd()`.
describe("firestore.rules", () => {
  const rules = readFileSync(join(process.cwd(), "firestore.rules"), "utf8").replace(/\/\/[^\n]*/g, "")

  it("never calls a helper as a method of request", () => {
    expect(rules.match(/request\.[a-z]\w*\(/gi) ?? []).toEqual([])
  })

  it("names the creating company through rd() where the old rule did", () => {
    expect(rules).toContain("rd().supplierOrgId == getOrganizationId()")
    expect(rules).toContain("rd().contractorOrgId == getOrganizationId()")
  })
})
