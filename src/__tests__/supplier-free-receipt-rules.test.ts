import { readFileSync } from "fs"
import { join } from "path"

// B-01: the goods receipt is the contractor's document. A supplier's delivery notice is born unconfirmed, carries no
// receipt fields, and the supplier may touch it only while it is still unconfirmed — the free journey's invoice cap
// and figures read confirmed deliveries, so a supplier who could write one could invoice goods nobody received.
describe("deliveries rules (B-01)", () => {
  const rules = readFileSync(join(process.cwd(), "firestore.rules"), "utf8").replace(/\/\/[^\n]*/g, "")
  const block = rules.slice(rules.indexOf("match /deliveries/{deliveryId}"), rules.indexOf("allow delete", rules.indexOf("match /deliveries/{deliveryId}")))

  it("a supplier's notice is pending and carries no confirmation or receipt number", () => {
    expect(rules).toMatch(/function supNoticeOnly\(\) \{\s*return rd\(\)\.status == 'pending_confirmation' && !rd\(\)\.keys\(\)\.hasAny\(\['confirmedAt', 'confirmedByUserId', 'docNumber'\]\);/)
    expect(block).toMatch(/allow create: if \(isSupplier\(\)\s*&& rd\(\)\.supplierOrgId == getOrganizationId\(\)\s*&& supNoticeOnly\(\)\)/)
  })

  it("the supplier's update branch requires an unconfirmed notice that stays unconfirmed", () => {
    expect(block).toContain("(isSupplierOrg() && resource.data.status == 'pending_confirmation' && supNoticeOnly())")
  })
})
