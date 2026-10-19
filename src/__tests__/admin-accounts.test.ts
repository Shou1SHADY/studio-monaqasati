import { companyOf } from "@/lib/admin-accounts"

const rows = [
  { id: "own1", name: "Banyan", organizationId: "own1", organizationRole: "owner" },
  { id: "mem1", name: "Walid", organizationId: "own1", organizationRole: "member" },
  { id: "mem2", name: "Orphan", organizationId: "gone", organizationRole: "member" },
  { id: "solo", name: "Legacy solo" },
  { id: "u2", name: "Second company", organizationId: "org-doc-9", organizationRole: "owner" },
]

describe("which company an account row belongs to", () => {
  it("an owner's row is his own company", () => {
    expect(companyOf(rows[0], rows)).toEqual({ orgId: "own1", name: "Banyan", memberOf: null })
  })

  it("a legacy solo account with no organisation fields is its own company", () => {
    expect(companyOf(rows[3], rows)).toEqual({ orgId: "solo", name: "Legacy solo", memberOf: null })
  })

  it("a team member's row opens the owner's company and names it", () => {
    expect(companyOf(rows[1], rows)).toEqual({ orgId: "own1", name: "Banyan", memberOf: "Banyan" })
  })

  it("a member whose owner is not in the loaded list still reaches the right company, under his own name", () => {
    expect(companyOf(rows[2], rows)).toEqual({ orgId: "gone", name: "Orphan", memberOf: null })
  })

  it("an owner of a secondary company keeps that company's document", () => {
    expect(companyOf(rows[4], rows)).toEqual({ orgId: "org-doc-9", name: "Second company", memberOf: null })
  })
})
