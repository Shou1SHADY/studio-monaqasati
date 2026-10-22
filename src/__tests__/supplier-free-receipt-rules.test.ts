import { readFileSync } from "fs"
import { join } from "path"

// B-01 → Procurement 2.0 (G-08, G-09): the goods receipt is the contractor's document, and now no browser writes a delivery
// at all except Procurement regularising a manual receipt. A supplier's notice (a day and a note) is written by the server, which
// is what keeps a supplier from writing a confirmed delivery the free journey's invoice cap would then read.
describe("deliveries rules (B-01)", () => {
  const rules = readFileSync(join(process.cwd(), "firestore.rules"), "utf8").replace(/\/\/[^\n]*/g, "")
  const start = rules.indexOf("match /deliveries/{deliveryId}")
  const block = rules.slice(start, rules.indexOf("allow delete", start))

  it("no browser creates a delivery: not a supplier, not the contractor", () => {
    expect(block).not.toMatch(/allow create/)
    expect(rules).not.toMatch(/function supNoticeOnly/)
  })

  it("no supplier branch updates one, and a contractor may only regularise a manual receipt that has no order", () => {
    expect(block).not.toContain("isSupplierOrg() && resource.data.status")
    expect(block).not.toMatch(/procBuyerReceives/)
    expect(block).toContain("resource.data.get('source', '') == 'manual'")
    expect(block).toContain("resource.data.get('poId', null) == null")
  })
})
