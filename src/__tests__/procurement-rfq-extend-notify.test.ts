/**
 * An RFQ extended with new invitees tells each newly added supplier (the
 * prototype's invitation) — and never re-notifies one already invited.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { extendRfq } from "@/lib/procurement/rfq-extend-writes"
import type { RfqWriteActor } from "@/lib/procurement/rfq-access"

const db = fakeFirestore as unknown as Firestore
const NOW = new Date("2026-09-20T09:00:00Z")
const manager: RfqWriteActor = { uid: "mgr", name: "Hind", isOwner: false, canPrepare: false, canApprove: true, canExpedite: true, canReceive: false, seesPrices: true }

describe("extending an RFQ", () => {
  beforeEach(() => {
    resetFakeDb()
    seed("rfqs/r1", { title: "Rebar", status: "New", visibility: "private", allowedSupplierOrgIds: ["s1"], invitedSupplierOrgIds: ["s1"], createdByUserId: "mgr", log: [] })
  })

  it("notifies only the suppliers it adds", async () => {
    const added = await extendRfq(db, manager, "r1", { deadline: "2026-09-30", addSupplierOrgIds: ["s1", "s2", "s3"] }, NOW)
    expect(added).toBe(2)
    expect(listCollection("users/s1/notifications")).toHaveLength(0)
    expect(listCollection<{ type: string; rfqId: string }>("users/s2/notifications")).toEqual([expect.objectContaining({ type: "rfq_invited", rfqId: "r1" })])
    expect(listCollection("users/s3/notifications")).toHaveLength(1)
  })
})
