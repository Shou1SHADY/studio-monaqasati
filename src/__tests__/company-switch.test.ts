import { companyPortalPath, switchTargetRole } from "@/lib/company-switch"

// switchTargetRole must derive the account's next role from exactly the two
// sources firestore.rules re-derives it from — primaryRole for the primary org,
// organizations/{id}.role for a secondary one, the CURRENT role as the fallback
// for both. Any drift here is a permission-denied switch in production.
describe("switchTargetRole", () => {
  const uid = "user-1"

  it("restores primaryRole when switching back to the primary company", () => {
    expect(
      switchTargetRole({ targetOrgId: uid, uid, currentRole: "Supplier", primaryRole: "Contractor" })
    ).toBe("Contractor")
  })

  it("keeps the current role for a primary company with no primaryRole recorded", () => {
    expect(switchTargetRole({ targetOrgId: uid, uid, currentRole: "Contractor" })).toBe("Contractor")
  })

  it("takes a secondary company's role from its organizations doc", () => {
    expect(
      switchTargetRole({
        targetOrgId: "org-2",
        uid,
        currentRole: "Contractor",
        primaryRole: "Contractor",
        orgRole: "Supplier",
      })
    ).toBe("Supplier")
  })

  it("leaves the role untouched for a legacy company whose doc predates the role field", () => {
    // The rule's fallback is resource.data.role — the role the account carries
    // right now — NOT primaryRole. Switching out of a Supplier company into a
    // role-less one must therefore stay Supplier, or the write is rejected.
    expect(
      switchTargetRole({
        targetOrgId: "org-legacy",
        uid,
        currentRole: "Supplier",
        primaryRole: "Contractor",
      })
    ).toBe("Supplier")
  })

  it("ignores primaryRole for secondary companies that declare a role", () => {
    expect(
      switchTargetRole({
        targetOrgId: "org-3",
        uid,
        currentRole: "Supplier",
        primaryRole: "Supplier",
        orgRole: "Contractor",
      })
    ).toBe("Contractor")
  })
})

describe("companyPortalPath", () => {
  it("routes each role to its portal, unprefixed for the default locale", () => {
    expect(companyPortalPath("Supplier", "ar")).toBe("/supplier")
    expect(companyPortalPath("Contractor", "ar")).toBe("/contractor")
    expect(companyPortalPath("Supplier", "en")).toBe("/en/supplier")
    expect(companyPortalPath(undefined, "en")).toBe("/en/contractor")
  })
})
