/**
 * An owner whose company has procurement staff reads the team's RFQs but still runs the ones he raised himself, so an RFQ
 * raised before the team existed is never left with nobody who can share, extend or award it.
 */
import { actsOnRfq, awardsOnRfq, closesRfqEarly, ownerRaised, type RfqRunner } from "@/lib/procurement/rfq-access"

const OWNER = "owner-uid"
const owner = (ownerHasTeam: boolean): RfqRunner => ({ uid: OWNER, isOwner: true, canPrepare: true, canApprove: true, ownerHasTeam })
const buyer: RfqRunner = { uid: "buyer-uid", isOwner: false, canPrepare: false, canApprove: false, managesRfqs: true }
const manager: RfqRunner = { uid: "mgr-uid", isOwner: false, canPrepare: true, canApprove: true }

const raisedByOwner = { createdByUserId: OWNER }
const raisedByOwnerLegacy = { contractorId: OWNER }
const raisedByBuyer = { createdByUserId: "buyer-uid" }

describe("the owner and the RFQs he raised", () => {
  it("runs every RFQ while the company has no procurement staff", () => {
    expect(actsOnRfq(raisedByBuyer, owner(false))).toBe(true)
    expect(actsOnRfq(raisedByOwner, owner(false))).toBe(true)
  })

  it("with staff, runs the ones he raised (new field or legacy contractorId) and reads the team's", () => {
    expect(actsOnRfq(raisedByOwner, owner(true))).toBe(true)
    expect(actsOnRfq(raisedByOwnerLegacy, owner(true))).toBe(true)
    expect(actsOnRfq(raisedByBuyer, owner(true))).toBe(false)
    expect(actsOnRfq({}, owner(true))).toBe(false)
  })

  it("awards and closes early only what he runs", () => {
    expect(awardsOnRfq(raisedByOwner, owner(true))).toBe(true)
    expect(closesRfqEarly(raisedByOwner, owner(true))).toBe(true)
    expect(awardsOnRfq(raisedByBuyer, owner(true))).toBe(false)
    expect(closesRfqEarly(raisedByBuyer, owner(true))).toBe(false)
  })

  it("only an owner raises an RFQ as an owner", () => {
    expect(ownerRaised(raisedByOwner, owner(true))).toBe(true)
    expect(ownerRaised(raisedByOwner, buyer)).toBe(false)
  })

  it("leaves a buyer on his own RFQs and a manager on every RFQ", () => {
    expect(actsOnRfq(raisedByBuyer, buyer)).toBe(true)
    expect(actsOnRfq(raisedByOwner, buyer)).toBe(false)
    expect(actsOnRfq(raisedByOwner, manager)).toBe(true)
    expect(actsOnRfq(raisedByBuyer, manager)).toBe(true)
  })

  it("the prod case: an owner's RFQ with a supply-chain member who did not raise it is run by the owner, not by nobody", () => {
    expect(actsOnRfq(raisedByOwner, buyer)).toBe(false)
    expect(actsOnRfq(raisedByOwner, owner(true))).toBe(true)
  })
})
