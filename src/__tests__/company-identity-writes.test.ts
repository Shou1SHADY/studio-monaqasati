const setDoc = jest.fn()
jest.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  serverTimestamp: () => "TS",
  setDoc: (...args: unknown[]) => setDoc(...args),
}))

import type { Firestore } from "firebase/firestore"
import { mirrorCompanyIdentity } from "@/lib/company-identity-writes"

const db = {} as Firestore

describe("mirrorCompanyIdentity", () => {
  beforeEach(() => {
    setDoc.mockReset()
    setDoc.mockResolvedValue(undefined)
  })

  it("writes the sensitive fields to the identity document and only the public ones to the public facts, merged", async () => {
    await mirrorCompanyIdentity(db, "orgA", { name: "Acme", crNumber: "1010", taxNumber: "300000000000003", legalDocuments: { cr: { url: "u", expiryDate: "2027-05-01" } } })
    const byPath = Object.fromEntries(setDoc.mock.calls.map(([ref, data, options]) => [ref.path, { data, options }]))
    expect(Object.keys(byPath).sort()).toEqual(["companyIdentity/orgA", "companyPublicFacts/orgA"])
    expect(byPath["companyIdentity/orgA"].data).toEqual({ crNumber: "1010", taxNumber: "300000000000003", legalDocuments: { cr: { url: "u", expiryDate: "2027-05-01" } }, updatedAt: "TS" })
    expect(byPath["companyPublicFacts/orgA"].data).toEqual({ vat: "300000000000003", hasCr: true, crExpiry: "2027-05-01", updatedAt: "TS" })
    expect(byPath["companyPublicFacts/orgA"].data).not.toHaveProperty("crNumber")
    expect(byPath["companyPublicFacts/orgA"].data).not.toHaveProperty("legalDocuments")
    expect(byPath["companyIdentity/orgA"].options).toEqual({ merge: true })
  })

  it("leaves the public facts alone when a write names no public fact (a bank detail)", async () => {
    await mirrorCompanyIdentity(db, "orgA", { iban: "SA03 8000 0000 6080 1016 7519" })
    expect(setDoc.mock.calls.map(([ref]) => ref.path)).toEqual(["companyIdentity/orgA"])
  })

  it("does nothing for a write that carries no sensitive field, or no company", async () => {
    await mirrorCompanyIdentity(db, "orgA", { name: "Acme", city: "Riyadh" })
    await mirrorCompanyIdentity(db, "", { crNumber: "1" })
    expect(setDoc).not.toHaveBeenCalled()
  })

  it("never lets a failed mirror break the save it follows", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    setDoc.mockRejectedValue(new Error("permission-denied"))
    await expect(mirrorCompanyIdentity(db, "orgA", { crNumber: "1" })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})
