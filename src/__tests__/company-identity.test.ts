/**
 * The company's sensitive identity (DEV-60): the pure helpers, and the
 * properties of firestore.rules that keep it away from the company's own team
 * members. The Jest suites run over an in-memory Firestore with no rules, so the
 * rule text is pinned here the way hr-rules.test.ts pins HR's.
 */
import fs from "fs"
import path from "path"
import { COMPANY_IDENTITY, SENSITIVE_IDENTITY_KEYS, identityGaps, pickIdentity, resolveIdentity } from "@/lib/company-identity"

const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\r\n/g, "\n")

function block(collection: string): string {
  const start = rules.search(new RegExp(`\\n    match /${collection}/\\{`))
  expect(start).toBeGreaterThan(-1)
  const rest = rules.slice(start + 1)
  const next = rest.slice(1).search(/\n    match \//)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

function allow(body: string, op: string): string[] {
  const clean = body.replace(/\/\/[^\n]*/g, "")
  return [...clean.matchAll(/allow ([a-z, ]+): if ([\s\S]*?);/g)].filter((m) => m[1].split(",").map((s) => s.trim()).includes(op)).map((m) => m[2])
}

describe("company identity helpers", () => {
  it("names the sensitive fields: registration, tax number, certificate files, bank details", () => {
    expect([...SENSITIVE_IDENTITY_KEYS].sort()).toEqual(["bankName", "crNumber", "iban", "legalDocuments", "taxNumber"])
    expect(COMPANY_IDENTITY).toBe("companyIdentity")
  })

  it("picks only the sensitive fields a profile holds, leaving blanks and everything else out", () => {
    const profile = { name: "Acme", crNumber: " 1010123456 ", taxNumber: "", iban: undefined, legalDocuments: { cr: { url: "u" } }, city: "Riyadh" }
    expect(pickIdentity(profile)).toEqual({ crNumber: " 1010123456 ", legalDocuments: { cr: { url: "u" } } })
    expect(pickIdentity(null)).toEqual({})
    expect(pickIdentity({ taxNumber: 300000000000003 }).taxNumber).toBe("300000000000003")
    expect(pickIdentity({ legalDocuments: {} })).toEqual({})
  })

  it("keeps the old profile fields on top while they exist, and fills what they lack from the identity document", () => {
    const stored = { crNumber: "STALE", iban: "SA03" }
    const legacy = { crNumber: "NEWER", taxNumber: "300000000000003" }
    expect(resolveIdentity(stored, legacy)).toEqual({ crNumber: "NEWER", taxNumber: "300000000000003", iban: "SA03" })
    expect(resolveIdentity(null, legacy)).toEqual({ crNumber: "NEWER", taxNumber: "300000000000003" })
    expect(resolveIdentity(null, null)).toEqual({})
  })

  it("is the identity document alone once the old fields are removed", () => {
    expect(resolveIdentity({ crNumber: "1010123456", legalDocuments: { cr: { url: "u" } } }, { name: "Acme", city: "Riyadh" })).toEqual({ crNumber: "1010123456", legalDocuments: { cr: { url: "u" } } })
  })

  it("lists what the old profile holds that the identity document does not match", () => {
    expect(identityGaps(null, { crNumber: "1", taxNumber: "3" })).toEqual(["crNumber", "taxNumber"])
    expect(identityGaps({ crNumber: "1", taxNumber: "3" }, { crNumber: "1", taxNumber: "3" })).toEqual([])
    expect(identityGaps({ crNumber: "1" }, { crNumber: "2" })).toEqual(["crNumber"])
    expect(identityGaps({ crNumber: "1" }, {})).toEqual([])
  })
})

describe("companyIdentity rules", () => {
  const body = block("companyIdentity")

  it("keeps the company's own team members out, and lets the owner, the admin and outsiders in", () => {
    const read = allow(body, "get").join(" ")
    expect(read).toContain("isAdmin()")
    expect(read).toContain("isCompanyOwner(orgId)")
    expect(read).toContain("!isOrgMember(orgId)")
  })

  it("does not let a member through by reading the document with a query", () => {
    expect(allow(body, "list")).toEqual(["isAdmin()"])
  })

  it("lets only the owner or the admin write, and nobody delete", () => {
    const write = allow(body, "update").join(" ")
    expect(write).toContain("isCompanyOwner(orgId)")
    expect(write).not.toContain("isOrgMember")
    expect(allow(body, "delete")).toEqual(["false"])
  })

  it("answers a missing document instead of erroring: the read never touches resource.data", () => {
    expect(body).not.toContain("resource.data")
  })

  it("finds a company's owner by its own uid or by the organizations doc, without reading a missing doc", () => {
    const fn = rules.slice(rules.indexOf("function isCompanyOwner"), rules.indexOf("function isCompanyOwner") + 500)
    expect(fn).toContain("request.auth.uid == orgId")
    expect(fn).toContain("exists(/databases/$(database)/documents/organizations/$(orgId))")
    expect(fn).toContain("ownerUserId")
  })
})

describe("mirroring a profile write", () => {
  const { identityPatch } = jest.requireActual<typeof import("@/lib/company-identity")>("@/lib/company-identity")

  it("keeps the sensitive keys a write names, even when blank, and nothing else", () => {
    expect(identityPatch({ name: "Acme", crNumber: "", taxNumber: "300000000000003", city: "Riyadh" })).toEqual({ crNumber: "", taxNumber: "300000000000003" })
    expect(identityPatch({ legalDocuments: { cr: { url: "u", expiryDate: "2027-01-01" } } })).toEqual({ legalDocuments: { cr: { url: "u", expiryDate: "2027-01-01" } } })
    expect(identityPatch({ taxNumber: 300000000000003 }).taxNumber).toBe("300000000000003")
    expect(identityPatch({ name: "Acme", certificates: [] })).toEqual({})
    expect(identityPatch({ crNumber: undefined })).toEqual({})
    expect(identityPatch(null)).toEqual({})
  })
})

describe("companyPrintProfile rules", () => {
  const body = block("companyPrintProfile")

  it("lets the whole team read what the owner chose to print, and nobody outside", () => {
    const read = allow(body, "get").join(" ")
    expect(read).toContain("isOrgMember(orgId)")
    expect(read).toContain("isCompanyOwner(orgId)")
    expect(read).toContain("isAdmin()")
    expect(read).not.toContain("!isOrgMember")
  })

  it("lets only the owner or the admin write it, and nobody delete it", () => {
    const write = allow(body, "update").join(" ")
    expect(write).toContain("isCompanyOwner(orgId)")
    expect(write).not.toContain("isOrgMember")
    expect(allow(body, "delete")).toEqual(["false"])
  })

  it("answers a missing document instead of erroring", () => {
    expect(body).not.toContain("resource.data")
  })
})

describe("companyPublicFacts rules", () => {
  const body = block("companyPublicFacts")

  it("is readable by any signed-in user, with a list for the directory", () => {
    expect(allow(body, "get")).toEqual(["isSignedIn()"])
    expect(allow(body, "list")).toEqual(["isSignedIn()"])
  })

  it("is written only by the owner or the admin, and never deleted", () => {
    const write = allow(body, "update").join(" ")
    expect(write).toContain("isCompanyOwner(orgId)")
    expect(write).not.toContain("isOrgMember")
    expect(allow(body, "delete")).toEqual(["false"])
  })
})
