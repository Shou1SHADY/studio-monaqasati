/** @jest-environment node */
/**
 * A contractor whose trial has run out can take no action through the server: `callerOf` — the one door the procurement,
 * delivery-receipt and project routes start from — gives no caller for its company. Active, running-trial and never-set
 * companies are untouched, and another company's trial does not matter.
 */

import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"
import { callerOf } from "@/lib/receipt-links"

const db = new FakeAdminDb()
const NOW = new Date("2026-11-10T09:00:00Z")

jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] })

beforeEach(() => {
  db.docs.clear()
  db.seed("users/owner1", { name: "Owner", organizationId: "org1" })
  db.seed("users/member1", { name: "Member", organizationId: "org1", organizationRole: "member" })
  db.seed("users/other", { name: "Other", organizationId: "org2" })
})

describe("callerOf and a trial", () => {
  it("is refused once the trial has ended — the owner and a team member alike", async () => {
    db.seed("companyModules/org1", { organizationId: "org1", off: [], subscription: "trial", trialEndsAt: "2026-11-10T08:59:59.000Z" })
    expect(await callerOf(db as never, "owner1")).toBeNull()
    expect(await callerOf(db as never, "member1")).toBeNull()
  })

  it("works while the trial runs, with no trial set, and for a trial that was given no end", async () => {
    db.seed("companyModules/org1", { organizationId: "org1", off: [], subscription: "trial", trialEndsAt: "2026-11-10T09:00:01.000Z" })
    expect(await callerOf(db as never, "owner1")).toMatchObject({ uid: "owner1", orgId: "org1" })
    db.seed("companyModules/org1", { organizationId: "org1", off: [], subscription: "trial" })
    expect(await callerOf(db as never, "owner1")).not.toBeNull()
    db.docs.delete("companyModules/org1")
    expect(await callerOf(db as never, "owner1")).not.toBeNull()
  })

  it("an Active company keeps working even with old trial dates left on the document", async () => {
    db.seed("companyModules/org1", { organizationId: "org1", off: [], subscription: "active", trialEndsAt: "2020-01-01T00:00:00.000Z" })
    expect(await callerOf(db as never, "owner1")).not.toBeNull()
  })

  it("only the company whose trial ended is locked", async () => {
    db.seed("companyModules/org1", { organizationId: "org1", off: [], subscription: "trial", trialEndsAt: "2026-01-01T00:00:00.000Z" })
    expect(await callerOf(db as never, "other")).toMatchObject({ orgId: "org2" })
  })
})
