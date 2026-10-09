/**
 * Deleting a deal or a client takes its quotations with it. The rules let only crm.close / sales.approve remove
 * a quotation that has left draft, so without that right the delete is refused before anything is touched.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import type { Firestore } from "firebase/firestore"
import { fakeFirestore, listCollection, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { deleteContactCascade, deleteOpportunityCascade, ISSUED_QUOTES } from "@/lib/crm-writes"

const db = fakeFirestore as unknown as Firestore
const ORG = "org1"

function world(quoteStatus: string) {
  seed("crmContacts/c1", { organizationId: ORG, name: "Client" })
  seed("crmOpportunities/o1", { organizationId: ORG, contactId: "c1", title: "Deal" })
  seed("crmQuotations/q1", { organizationId: ORG, contactId: "c1", opportunityId: "o1", status: quoteStatus })
  seed("crmActivities/a1", { organizationId: ORG, contactId: "c1", opportunityId: "o1" })
}
const count = (c: string) => listCollection(c).length

beforeEach(() => resetFakeDb())

describe("deleting a deal", () => {
  it("is refused untouched when it holds an issued quotation and the member may not delete one", async () => {
    world("issued")
    await expect(deleteOpportunityCascade(db, "o1", ORG, false)).rejects.toThrow(ISSUED_QUOTES)
    expect([count("crmQuotations"), count("crmOpportunities"), count("crmActivities")]).toEqual([1, 1, 1])
  })

  it("goes through for a closer or approver", async () => {
    world("sent")
    await deleteOpportunityCascade(db, "o1", ORG, true)
    expect([count("crmQuotations"), count("crmOpportunities")]).toEqual([0, 0])
  })

  it("goes through for anyone when every quotation is still a draft", async () => {
    world("draft")
    await deleteOpportunityCascade(db, "o1", ORG, false)
    expect([count("crmQuotations"), count("crmOpportunities")]).toEqual([0, 0])
  })
})

describe("deleting a client", () => {
  it("is refused untouched when one of its quotations has left draft", async () => {
    world("accepted")
    await expect(deleteContactCascade(db, "c1", ORG, false)).rejects.toThrow(ISSUED_QUOTES)
    expect([count("crmContacts"), count("crmQuotations"), count("crmOpportunities")]).toEqual([1, 1, 1])
  })

  it("removes everything for a closer or approver", async () => {
    world("accepted")
    await deleteContactCascade(db, "c1", ORG, true)
    expect([count("crmContacts"), count("crmQuotations"), count("crmOpportunities"), count("crmActivities")]).toEqual([0, 0, 0, 0])
  })
})
