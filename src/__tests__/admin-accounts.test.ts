import { companiesOfRole, companyOf } from "@/lib/admin-accounts"

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

describe("the admin's company list — one row per company, never one per account", () => {
  const users = [
    { id: "own1", role: "Contractor", name: "Banyan", organizationId: "own1", organizationRole: "owner" },
    { id: "mem1", role: "Contractor", name: "Walid", organizationId: "own1", organizationRole: "member" },
    { id: "mem2", role: "Contractor", name: "Sara", organizationId: "own1", organizationRole: "member" },
    { id: "solo", role: "Contractor", name: "Legacy solo" },
    // switched into his second (contractor) company; his own primary company is a contractor too
    { id: "u2", role: "Contractor", primaryRole: "Contractor", name: "Rukn", organizationId: "org-9", organizationRole: "owner" },
    // a supplier owner switched into a contractor company: only that company is a contractor
    { id: "s1", role: "Contractor", primaryRole: "Supplier", name: "Supplier Co", organizationId: "org-7", organizationRole: "owner" },
    // a contractor owner switched into a supplier company: his primary company still lists
    { id: "u3", role: "Supplier", primaryRole: "Contractor", name: "Qimma", organizationId: "org-s", organizationRole: "owner" },
  ]
  const orgs = [
    { id: "org-9", role: "Contractor", name: "Rukn Two", ownerUserId: "u2" },
    { id: "org-7", role: "Contractor", name: "From supplier", ownerUserId: "s1" },
    { id: "org-x", role: "Contractor", name: "Not active now", ownerUserId: "u2" },
    { id: "org-s", role: "Supplier", name: "Qimma Supply", ownerUserId: "u3" },
  ]
  const list = companiesOfRole("Contractor", users, orgs)
  const ids = list.map((c) => c.orgId).sort()

  it("team members are not companies", () => {
    expect(ids).not.toContain("mem1")
    expect(ids).not.toContain("mem2")
    expect(list.filter((c) => c.orgId === "own1")).toHaveLength(1)
  })

  it("lists owners' primary companies and every contractor organisation, each once", () => {
    expect(ids).toEqual(["org-7", "org-9", "org-x", "own1", "solo", "u2", "u3"])
  })

  it("a secondary company's identity and verification are its organizations doc, a primary one's the owner's users doc", () => {
    expect(list.find((c) => c.orgId === "org-9")).toMatchObject({ source: "org", ownerUserId: "u2", doc: { name: "Rukn Two" } })
    expect(list.find((c) => c.orgId === "u2")).toMatchObject({ source: "user", ownerUserId: "u2", doc: { name: "Rukn" } })
    expect(list.find((c) => c.orgId === "org-x")).toMatchObject({ source: "org", ownerUserId: "u2" })
  })

  it("a legacy organisation doc with no role takes the role of the owner switched into it (identity overlay)", () => {
    const legacy = companiesOfRole("Contractor", [{ id: "u9", role: "Contractor", primaryRole: "Supplier", organizationId: "org-old", organizationRole: "owner" }], [], new Map([["u9", { name: "Old Org" }]]))
    expect(legacy).toEqual([{ orgId: "org-old", source: "org", ownerUserId: "u9", doc: { id: "org-old", name: "Old Org" } }])
  })
})
