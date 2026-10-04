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

  it("writes only the sensitive fields, merged, to the company's identity document", async () => {
    await mirrorCompanyIdentity(db, "orgA", { name: "Acme", crNumber: "1010", legalDocuments: { cr: { url: "u" } } })
    expect(setDoc).toHaveBeenCalledTimes(1)
    const [ref, data, options] = setDoc.mock.calls[0]
    expect(ref).toEqual({ path: "companyIdentity/orgA" })
    expect(data).toEqual({ crNumber: "1010", legalDocuments: { cr: { url: "u" } }, updatedAt: "TS" })
    expect(options).toEqual({ merge: true })
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
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
