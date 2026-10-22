/**
 * Procurement 2.0, WP-S1-11 (NFR-01 / G-16) — what the ruleset no longer allows a browser to do, and the size it saved. The orders
 * raised without an RFQ, a buyer's own small order, a sample request, a guest's invitation and the rated flag are server routes now;
 * the rules for them are gone, not weakened. What the browser still writes stays: the buyer's log-only entries, the bell's read
 * marks, the supplier's own offer. The ruleset must stay under the ceiling (a 151,102-character ruleset was refused; 150,113 too).
 */
import fs from "fs"
import path from "path"

const raw = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\r\n/g, "\n")
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ")
const rules = strip(raw)

const block = (start: string, endMarker: RegExp): string => {
  const at = raw.indexOf(start)
  expect(at).toBeGreaterThan(-1)
  const rest = raw.slice(at + start.length)
  const end = rest.search(endMarker)
  return strip(start + (end < 0 ? rest : rest.slice(0, end)))
}
const fn = (name: string): string => block(`function ${name}(`, /\n {4}(function |match \/|\/\/ [A-Z])/)

describe("purchase orders: no client creates one", () => {
  const orders = block("match /purchaseOrders/{poId} {", /\n {4}\/\/ The order's conversation/)

  it("has no create rule at all (the server writes every order)", () => {
    expect(orders).not.toMatch(/allow create/)
    expect(orders).toMatch(/allow update: if isSignedIn\(\) && poUpdateOk\(poId\)/)
    expect(orders).toMatch(/allow delete: if isAdmin\(\)/)
  })

  it("has no self-issue rule and no self-issue limit read: the buyer's own order is /api/procurement/po/self-issue", () => {
    expect(rules).not.toContain("poSelfIssues")
    expect(rules).not.toContain("poSelfIssueLimit")
    expect(rules).not.toContain("buyerSelfIssueLimit")
  })

  it("keeps the approval on the limit INCLUDING VAT and the owner-only retroactive order", () => {
    const approves = fn("poApproves")
    expect(approves).toContain("resource.data.get('totalExVat', 0) * (1 + resource.data.get('vatRate', 0)) <= poManagerLimit()")
    expect(approves).toContain("resource.data.get('basis', '') != 'retroactive'")
  })
})

describe("offers: the buying side writes nothing but the bell's read mark", () => {
  const offers = block("match /offers/{offerId} {", /\n {4}\/\/ The buyer's decisions about an offer/)

  it("the contractor-update branch and its permission helper are gone", () => {
    expect(rules).not.toContain("hasOfferDecisionPermission")
    const update = offers.match(/allow update: if ([\s\S]*?);/)?.[1] ?? ""
    for (const gone of ["rfqData(", "isContractorOrg()", "actsOnRfq", "hasOrgAny", "hasRfq", "'مقبول'"]) expect(update).not.toContain(gone)
  })

  it("an update is the admin's, the supplier's own (without the buying side's keys), or the buying company's read mark", () => {
    const update = offers.match(/allow update: if ([\s\S]*?);/)?.[1] ?? ""
    expect(update).toContain("isAdmin()")
    expect(update).toContain("!changedKeys().hasAny(buyerOfferKeys().concat([")
    expect(update).toContain("changedKeys().hasOnly(['contractorReadAt', 'contractorUnread'])")
  })

  it("a created offer is still only the admin's or a recorded manual one", () => {
    const create = offers.match(/allow create: if ([\s\S]*?);/)?.[1] ?? ""
    expect(create).toContain("isAdmin()")
    expect(create).toContain("isManualOffer")
  })
})

describe("RFQs: the branches that went to the server", () => {
  const update = fn("rfqUpdateOk")

  it("no award, cancellation, early close, extension or reduction round is written by a browser", () => {
    for (const gone of ["awardSplit", "'Awarded'", "cancellation", "closedEarly", "reductionRound", "invitedSupplierOrgIds", "unawardedLines"]) expect(update).not.toContain(gone)
  })

  it("what stays: a draft's owner, the buyer's log-only entry with one more offer counted, the supplier's counter, the admin", () => {
    expect(update).toContain("rfqLogAppendsOne()")
    expect(update).toContain("ck.hasOnly(['log', 'offersCount', 'updatedAt'])")
    expect(update).toContain("ck.hasOnly(['offersCount'])")
    expect(update).toContain("isAdmin()")
    expect(update).toContain("resource.data.get('status', '') == 'Draft'")
  })
})

describe("the size", () => {
  it("is well under the ceiling: the 1 Oct 2026 refusal was at 151,102 and the plan netted a reduction", () => {
    expect(rules.length).toBeLessThan(145_000)
  })
})
