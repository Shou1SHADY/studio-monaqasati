/**
 * The admin's writes on a supplier company, shared by the subscribed list and the free list: where the standing lives
 * (the owner's account or a secondary company's document), approving it and telling the owner, deciding a change of
 * specializations. Over the in-memory Firestore.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { decideSupplierSpecs, setSupplierApproval, standingRefOfAccount, standingRefOfCompany } from "@/lib/supplier-admin-writes"

const db = fakeFirestore as never

beforeEach(() => {
  resetFakeDb()
  jest.spyOn(console, "warn").mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe("where a company's standing lives", () => {
  it("is the owner's account for a primary company and the organizations document for a secondary one", () => {
    expect(standingRefOfAccount(db, { id: "u1" }).path).toBe("users/u1")
    expect(standingRefOfAccount(db, { id: "u1", organizationId: "u1", organizationRole: "owner" }).path).toBe("users/u1")
    expect(standingRefOfAccount(db, { id: "u1", organizationId: "org9", organizationRole: "owner" }).path).toBe("organizations/org9")
    // A team member is not a company: his row stays his own account.
    expect(standingRefOfAccount(db, { id: "m1", organizationId: "u1", organizationRole: "member" }).path).toBe("users/m1")
    expect(standingRefOfCompany(db, { id: "u1", source: "user" }).path).toBe("users/u1")
    expect(standingRefOfCompany(db, { id: "org9", source: "org" }).path).toBe("organizations/org9")
  })
})

describe("approving a company", () => {
  it("marks it verified, clears its request and tells the owner it can quote now", async () => {
    seed("users/u1", { role: "Supplier", name: "A", isVerified: false, verificationRequested: true })
    await setSupplierApproval(db, { standing: standingRefOfCompany(db, { id: "u1", source: "user" }), notifyUserId: "u1", verify: true })
    expect(readDoc("users/u1")).toMatchObject({ isVerified: true, verificationRequested: false })
    const notices = listCollection<Record<string, unknown>>("users/u1/notifications")
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ type: "supplier_approved", userId: "u1", read: false, link: "/supplier/rfqs" })
    expect(notices[0].i18n).toMatchObject({ title: "pn_supplier_approved_title", message: "pn_supplier_approved" })
  })
  it("writes a secondary company's approval on the organization and tells its owner", async () => {
    seed("users/u1", { role: "Supplier", organizationId: "org9", organizationRole: "owner" })
    seed("organizations/org9", { role: "Supplier", name: "Branch", isVerified: false })
    await setSupplierApproval(db, { standing: standingRefOfCompany(db, { id: "org9", source: "org" }), notifyUserId: "u1", verify: true })
    expect(readDoc("organizations/org9")).toMatchObject({ isVerified: true })
    expect(readDoc("users/u1")).not.toHaveProperty("isVerified")
    expect(listCollection("users/u1/notifications")).toHaveLength(1)
  })
  it("withdrawing an approval tells nobody", async () => {
    seed("users/u1", { role: "Supplier", isVerified: true })
    await setSupplierApproval(db, { standing: standingRefOfCompany(db, { id: "u1", source: "user" }), notifyUserId: "u1", verify: false })
    expect(readDoc("users/u1")).toMatchObject({ isVerified: false })
    expect(listCollection("users/u1/notifications")).toHaveLength(0)
  })
})

describe("a request to change specializations and coverage", () => {
  const pending = { pendingSpecializations: ["رخام"], pendingCoverageCities: ["جدة"] }
  const seedSupplier = () => seed("users/u1", { role: "Supplier", specializations: ["حديد"], coverageCities: ["الرياض"], ...pending })
  const notice = { title: "T", message: "M" }

  it("approving applies both lists, clears the request and tells the owner", async () => {
    seedSupplier()
    await decideSupplierSpecs(db, { standing: standingRefOfCompany(db, { id: "u1", source: "user" }), notifyUserId: "u1", approve: true, ...pending, notice })
    const doc = readDoc<Record<string, unknown>>("users/u1")
    expect(doc).toMatchObject({ specializations: ["رخام"], coverageCities: ["جدة"] })
    expect(doc).not.toHaveProperty("pendingSpecializations")
    expect(listCollection("users/u1/notifications")).toEqual([expect.objectContaining({ type: "specs_decision", title: "T", message: "M" })])
  })
  it("refusing keeps the approved lists and still clears the request", async () => {
    seedSupplier()
    await decideSupplierSpecs(db, { standing: standingRefOfCompany(db, { id: "u1", source: "user" }), notifyUserId: "u1", approve: false, ...pending, notice })
    const doc = readDoc<Record<string, unknown>>("users/u1")
    expect(doc).toMatchObject({ specializations: ["حديد"], coverageCities: ["الرياض"] })
    expect(doc).not.toHaveProperty("pendingCoverageCities")
  })
})
