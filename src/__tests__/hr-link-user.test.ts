/**
 * HR 1.0 — linking an employee record to a platform user (ES-00, RL-02, RL-03).
 * The link decides whose pay a person reads and which record is "his own", so
 * it is the HR manager's alone — government relations sees no pay and must not
 * be able to give himself someone's — and nobody links or unlinks himself (the
 * owner excepted). firestore.rules says the same; this is the client's side.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { hrAllowed, type HrContext, type HrRole } from "@/lib/hr/access"
import { linkUser } from "@/lib/hr/employee-writes"

const db = fakeFirestore as unknown as Firestore
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const actor = (uid: string) => ({ uid, name: uid })

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", { organizationId: "org", no: 1, names: { ar: "أحمد" }, userId: null })
  seed("employees/e2", { organizationId: "org", no: 2, names: { ar: "مدير الموارد" }, userId: "hrm" })
})

it("government relations is not offered the link and cannot make it", async () => {
  const gov = ctx(["gov"], { uid: "g" })
  expect(hrAllowed(gov, "employee.edit")).toBe(false)
  await expect(linkUser(db, gov, "e1", actor("g"), "g")).rejects.toMatchObject({ code: "no_role" })
  expect(readDoc<{ userId: string | null }>("employees/e1")?.userId).toBeNull()
})

it("the HR manager links another person — never himself onto a record, never himself off one", async () => {
  const hrm = ctx(["manager"], { uid: "hrm", employeeId: "e2" })
  await linkUser(db, hrm, "e1", actor("hrm"), "worker")
  expect(readDoc<{ userId: string | null }>("employees/e1")?.userId).toBe("worker")
  await expect(linkUser(db, hrm, "e1", actor("hrm"), "hrm")).rejects.toMatchObject({ code: "own_request" })
  await expect(linkUser(db, hrm, "e2", actor("hrm"), null)).rejects.toMatchObject({ code: "own_request" })
  expect(readDoc<{ userId: string | null }>("employees/e2")?.userId).toBe("hrm")
})

it("the owner, who has nobody above him, links himself", async () => {
  const owner = ctx(["manager", "management"], { uid: "own", owner: true })
  await linkUser(db, owner, "e1", actor("own"), "own")
  expect(readDoc<{ userId: string | null }>("employees/e1")?.userId).toBe("own")
})
