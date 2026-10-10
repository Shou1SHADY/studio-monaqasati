/**
 * «رحلة الفرصة» v1.1 (7 Oct 2026) — CRM owns the deal, Sales prices it. Pins each item of the spec:
 * OPP-01 deliverables / probability by stage · OPP-02 the number · OPP-03 conditions are facts, «not checked» never
 * blocks · OPP-04 the offer and the pricing state come from Sales' records · OPP-05 the stage follows facts — no award
 * from «new» (the bug: estimate → cost → price → award jumped a «new» deal to «won») · OPP-06 the award needs a sent
 * offer · OPP-07 the project kind follows the work type · OPP-08 the board's figure: «no estimate», never «0 SAR»,
 * headers that add up their cards, a passed tender deadline out of the totals.
 */
import { render, screen } from "@testing-library/react"
import {
  DEFAULT_STAGE_PROBABILITY,
  canRecordAward,
  effectiveProbability,
  fitCheck,
  gatesRemaining,
  opportunityDeliverables,
  opportunityGates,
  stageMoveBlock,
  summarizeOpportunities,
  type CrmOpportunity,
  type CrmOrgProfile,
  type CrmQuotation,
} from "@/lib/crm"
import { currentOffer, currentOffersByDeal, dealFigure, deadlinePassed, isReplaced, offerVersions, pricingState, revisionPending } from "@/lib/crm-journey"
import { displayDocNumber } from "@/lib/sales-numbering"
import { expiryNotice, riyadhToday, selectExpiredOffers } from "@/lib/crm-offer-expiry"
import type { QuoteRequest } from "@/lib/sales-transfers"

jest.mock("next-intl", () => ({
  useLocale: () => "ar",
  useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}|${Object.values(params).join(",")}` : key),
}))
jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})
jest.mock("@/i18n/routing", () => ({ Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))

import { OppFigure } from "@/components/crm/OppBits"
import { projectKindOf } from "@/components/crm/CrmHandoverDialog"
import { recordAward, requestPricing, requestRevision } from "@/lib/crm-opportunity-writes"

const TODAY = "2026-10-08"
const go = { go: true, at: "2026-10-06T08:00:00Z", byId: "u1", byName: "Saad" }

function deal(o: Partial<CrmOpportunity> = {}): CrmOpportunity {
  return { id: "d1", contactId: "c1", contactName: "Al Yasmin", title: "Al Nuzha", stage: "new", track: "tender", state: "open", value: 0, organizationId: "org", ...o }
}
function quote(o: Partial<CrmQuotation> = {}): CrmQuotation {
  return { id: "q1", organizationId: "org", contactId: "c1", opportunityId: "d1", quotationNumber: "QT-2026/118", amount: 47500, status: "sent", sentAt: "2026-10-09", revision: 1, ...o } as CrmQuotation
}
function req(o: Partial<QuoteRequest> = {}): QuoteRequest {
  return { id: "r1", organizationId: "org", requestNumber: "RQ-2026/031", contactId: "c1", opportunityId: "d1", lines: [], status: "new", requestedByUserId: "u1", requestedByUserName: "Saad", requestedAt: "2026-10-07T09:00:00Z", ...o }
}

describe("OPP-02 the number", () => {
  it("is stored Latin and reads «ف-2026/014» in Arabic", () => {
    expect(displayDocNumber("OP-2026/014", "ar")).toBe("ف-2026/014")
    expect(displayDocNumber("OP-2026/014", "en")).toBe("OP-2026/014")
  })
})

describe("OPP-03 before «qualified»: three facts", () => {
  it("no estimate is demanded; the tender documents are a FILE, the bid decision is RECORDED", () => {
    const d = deal()
    expect(opportunityGates(d).map((g) => g.id)).toEqual(["bid_docs", "fit", "go_no_go"])
    expect(gatesRemaining(d).map((g) => g.id)).toEqual(["bid_docs", "go_no_go"])
    const ready = deal({ fileCounts: { tender_docs: 1 }, goDecision: go })
    expect(gatesRemaining(ready)).toEqual([])
  })

  it("a direct request has no tender documents to upload", () => {
    expect(opportunityGates(deal({ track: "quotation" })).map((g) => g.id)).toEqual(["fit", "go_no_go"])
  })

  it("eligibility without a value is «not checked» — a warning, never a block; only a computed conflict blocks", () => {
    const profile: CrmOrgProfile = { id: "org", organizationId: "org", classifications: { buildings: 3 }, annualCeiling: 10_000_000, underExecution: 8_000_000 }
    const bare = deal({ scopeTypes: ["residential"], fileCounts: { tender_docs: 1 }, goDecision: go })
    expect(fitCheck(bare, profile).status).toBe("unchecked")
    expect(gatesRemaining(bare, { profile })).toEqual([])
    // grade 3 allows up to 15M, capacity left is 2M: a 5M offer is a computed conflict
    expect(fitCheck(bare, profile, 5_000_000).status).toBe("conflict")
    expect(gatesRemaining(bare, { profile, offerValue: 5_000_000 }).map((g) => g.id)).toEqual(["fit"])
    expect(fitCheck(bare, profile, 1_000_000).status).toBe("ok")
  })
})

describe("OPP-05 the stage follows facts", () => {
  const qualified = deal({ stage: "qualified" })
  it("«proposal» is reached only by the pricing request, never by a stage move", () => {
    expect(stageMoveBlock(qualified, "proposal")).toBe("pricing")
  })
  it("«negotiation» needs an offer Sales sent", () => {
    const proposal = deal({ stage: "proposal" })
    expect(stageMoveBlock(proposal, "negotiation")).toBe("offer")
    expect(stageMoveBlock(proposal, "negotiation", { offerSent: true })).toBeNull()
  })
  it("the award: only in proposal / negotiation, only on a sent offer — never from «new»", () => {
    expect(canRecordAward(deal(), true)).toBe(false)
    expect(canRecordAward(deal({ stage: "qualified" }), true)).toBe(false)
    expect(canRecordAward(deal({ stage: "proposal" }), false)).toBe(false)
    expect(canRecordAward(deal({ stage: "proposal" }), true)).toBe(true)
    expect(canRecordAward(deal({ stage: "negotiation" }), true)).toBe(true)
  })
  it("the write refuses an award with no sent offer — the old «new → won» jump", async () => {
    await expect(
      recordAward({} as never, deal(), { uid: "u1", name: "Saad" }, null, { value: 1, bidderCount: 1, ourRank: 1, reason: "price", note: "", notice: { title: "", message: "", i18n: { title: "", message: "", params: {} } } })
    ).rejects.toThrow("no_offer")
  })
  it("pricing is asked from «qualified» (or again after a decline), a revision only with what the client asks", async () => {
    const notice = { title: "", message: "", i18n: { title: "", message: "", params: {} } }
    await expect(requestPricing({} as never, deal(), { uid: "u1", name: "Saad" }, { files: [], note: "", notification: notice })).rejects.toThrow("not_qualified")
    await expect(requestRevision({} as never, deal({ stage: "proposal" }), { uid: "u1", name: "Saad" }, quote(), { ask: "  ", dueDate: null, notification: notice })).rejects.toThrow("ask_required")
  })
})

describe("OPP-04 the offer comes from Sales", () => {
  const v1 = quote({ id: "q1", supersededById: "q2" })
  const v2 = quote({ id: "q2", quotationNumber: "QT-2026/118-2", amount: 44800, revision: 2, sentAt: "2026-10-12", validUntil: "2026-11-11" })
  const draft = quote({ id: "q3", status: "draft", revision: 3, amount: 1 })
  const issued = quote({ id: "q4", status: "issued", revision: 4, amount: 2 })

  it("versions are the SENT ones, newest first; the current is the one nobody replaced", () => {
    expect(offerVersions([v1, v2, draft, issued], "d1").map((q) => q.id)).toEqual(["q2", "q1"])
    expect(currentOffer([v1, v2, draft, issued], "d1")?.id).toBe("q2")
    expect(currentOffersByDeal([v1, v2, draft]).get("d1")?.amount).toBe(44800)
  })

  it("the pricing state: with Sales → offer → revision → offer; a decline comes back with its reason", () => {
    const d = deal({ stage: "proposal" })
    expect(pricingState(d, [], [], TODAY).kind).toBe("none")
    expect(pricingState(d, [req()], [], TODAY).kind).toBe("at_sales")
    expect(pricingState(d, [req({ status: "quoted" })], [issued], TODAY).kind).toBe("at_sales") // issued, not yet sent
    expect(pricingState(d, [req({ status: "quoted" })], [v2], TODAY).kind).toBe("offer")
    const rev = req({ id: "r2", kind: "revision", revisionOfQuotationId: "q2", requestedAt: "2026-10-13T09:00:00Z" })
    expect(pricingState(d, [req({ status: "quoted" }), rev], [v2], TODAY).kind).toBe("revision")
    expect(pricingState(d, [req({ status: "declined", declineReason: "spec" })], [], TODAY).kind).toBe("declined")
  })

  it("while Sales drafts the revision, the client's version stays the deal's offer — only the award waits", async () => {
    // Sales stamps supersededById on v1 the moment the draft v2 opens; v2 is not sent yet.
    const held = quote({ id: "q1", amount: 47500, supersededById: "q2", validUntil: "2026-11-08" })
    const drafting = quote({ id: "q2", status: "draft", revision: 2, amount: 44800 })
    const quotes = [held, drafting]
    const d = deal({ stage: "negotiation", value: 30000, expectedCloseDate: "2026-09-30" })
    expect(currentOffer(quotes, "d1")?.id).toBe("q1")
    expect(currentOffersByDeal(quotes).get("d1")?.amount).toBe(47500)
    expect(dealFigure(d, currentOffer(quotes, "d1"), TODAY)).toEqual({ amount: 47500, kind: "offer", overdue: false })
    const rev = req({ id: "r2", kind: "revision", status: "quoted", revisionOfQuotationId: "q1" })
    expect(pricingState(d, [rev], quotes, TODAY).kind).toBe("revision")
    expect(isReplaced(held, offerVersions(quotes, "d1"))).toBe(false)
    expect(revisionPending(currentOffer(quotes, "d1"))).toBe(true)
    const notice = { title: "", message: "", i18n: { title: "", message: "", params: {} } }
    await expect(
      recordAward({} as never, d, { uid: "u1", name: "Saad" }, held, { value: 47500, bidderCount: 1, ourRank: 1, reason: "price", note: "", notice })
    ).rejects.toThrow("revision_pending")
    // Once v2 is sent, v1 is replaced and v2 is the offer.
    const sent = { ...drafting, status: "sent" as const, sentAt: "2026-10-12" }
    expect(currentOffer([held, sent], "d1")?.id).toBe("q2")
    expect(isReplaced(held, offerVersions([held, sent], "d1"))).toBe(true)
  })

  it("an offer past its validity with no answer says so", () => {
    const s = pricingState(deal({ stage: "proposal" }), [], [quote({ validUntil: "2026-10-01" })], TODAY)
    expect(s.kind === "offer" && s.expired).toBe(true)
  })
})

describe("OPP-08 the board's figure", () => {
  it("offer, else estimate, else none — and an absent estimate is «no estimate», never 0", () => {
    expect(dealFigure(deal({ value: 30000 }), quote({ amount: 120000 }), TODAY)).toEqual({ amount: 120000, kind: "offer", overdue: false })
    expect(dealFigure(deal({ value: 30000 }), null, TODAY)).toEqual({ amount: 30000, kind: "estimate", overdue: false })
    expect(dealFigure(deal(), null, TODAY)).toEqual({ amount: null, kind: "none", overdue: false })
    render(<OppFigure opp={deal()} figure={{ amount: null, kind: "none", overdue: false }} />)
    expect(screen.getByText("crm_no_estimate")).toBeTruthy()
    expect(screen.queryByText(/0 ر\.س/)).toBeNull()
  })

  it("a tender whose deadline passed with no offer is held out of the open pipeline", () => {
    const late = deal({ value: 380000, expectedCloseDate: "2026-09-17" })
    expect(deadlinePassed(late, false, TODAY)).toBe(true)
    expect(deadlinePassed(late, true, TODAY)).toBe(false)
    expect(deadlinePassed(deal({ track: "quotation", expectedCloseDate: "2026-09-17" }), false, TODAY)).toBe(false)
  })

  it("open value = Σ figures, leaving out «no estimate» and passed deadlines; weighted «by stage»", () => {
    const deals = [
      deal({ id: "a", value: 30000, stage: "qualified" }),
      deal({ id: "b", value: 85000, stage: "proposal" }),
      deal({ id: "c", stage: "negotiation" }),
      deal({ id: "d" }), // no estimate
      deal({ id: "e", value: 380000, expectedCloseDate: "2026-09-17" }), // past its deadline
    ]
    const offers = new Map([["c", quote({ opportunityId: "c", amount: 120000 })]])
    const s = summarizeOpportunities(deals, (o) => dealFigure(o, offers.get(o.id) ?? null, TODAY))
    expect(s.openValue).toBe(235000)
    expect(s.excludedNoValue).toBe(1)
    expect(s.excludedOverdue).toBe(1)
    expect(s.weightedValue).toBe(Math.round(30000 * 0.25 + 85000 * 0.4 + 120000 * 0.7))
  })
})

describe("OPP-01 and OPP-07", () => {
  it("probability: the deal's own, else its stage's from settings, else the default table", () => {
    expect(effectiveProbability({ stage: "new", probability: 55 })).toBe(55)
    expect(effectiveProbability({ stage: "new", probability: null })).toBe(DEFAULT_STAGE_PROBABILITY.new)
    expect(effectiveProbability({ stage: "proposal" }, { stageProbabilities: { proposal: 35 } })).toBe(35)
  })
  it("a deal from before «what we deliver» was a project", () => {
    expect(opportunityDeliverables(deal())).toEqual(["project"])
    expect(opportunityDeliverables(deal({ deliverables: ["supply", "service"] }))).toEqual(["supply", "service"])
  })
  it("the handover's project kind follows the deal's work type — no second list", () => {
    expect(projectKindOf({ scopeTypes: ["residential"] })).toBe("bld")
    expect(projectKindOf({ scopeTypes: ["infrastructure", "mep"] })).toBe("infra")
    expect(projectKindOf({ scopeTypes: ["facilities"] })).toBe("mnt")
    expect(projectKindOf({ scopeTypes: [], customScopeActivity: "roads" })).toBe("road")
  })
})

describe("OPP-04 #8 an offer that lapses unanswered tells the requester — once", () => {
  const lapsed = quote({ validUntil: "2026-10-01" })
  const requesters = new Map([["r1", "u-req"]])
  const open = deal({ stage: "proposal", docNumber: "OP-2026/014", pricingRequestId: "r1", createdById: "u-maker" })

  it("selects the deal's current sent offer past validity, addressed to whoever asked Sales", () => {
    const [hit] = selectExpiredOffers([open], [lapsed], requesters, TODAY)
    expect(hit.quote.id).toBe("q1")
    expect(hit.recipientId).toBe("u-req")
    // No request on record: the deal's creator hears it.
    expect(selectExpiredOffers([deal({ stage: "proposal", createdById: "u-maker" })], [lapsed], new Map(), TODAY)[0].recipientId).toBe("u-maker")
  })

  it("never twice, never for a still-valid, revising, answered or closed one", () => {
    expect(selectExpiredOffers([{ ...open, expiryNoticeQuoteId: "q1" }], [lapsed], requesters, TODAY)).toEqual([])
    expect(selectExpiredOffers([open], [quote({ validUntil: TODAY })], requesters, TODAY)).toEqual([])
    expect(selectExpiredOffers([open], [quote({ validUntil: "2026-10-01", supersededById: "q2" })], requesters, TODAY)).toEqual([])
    expect(selectExpiredOffers([open], [quote({ validUntil: "2026-10-01", status: "accepted" })], requesters, TODAY)).toEqual([])
    expect(selectExpiredOffers([{ ...open, state: "lost", stage: "lost" }], [lapsed], requesters, TODAY)).toEqual([])
  })

  it("the notice names the deal and offer in Latin params (each reader localises) and opens the deal", () => {
    const n = expiryNotice({ opp: open, quote: lapsed, recipientId: "u-req" }, "2026-10-08T05:00:00Z")
    expect(n.i18n.params).toEqual({ number: "OP-2026/014", title: "Al Nuzha", offer: "QT-2026/118" })
    expect(n.message).toContain("ف-2026/014")
    expect(n.link).toBe("crm/opportunities/d1")
    expect(riyadhToday(new Date("2026-10-07T22:30:00Z"))).toBe("2026-10-08")
  })
})
