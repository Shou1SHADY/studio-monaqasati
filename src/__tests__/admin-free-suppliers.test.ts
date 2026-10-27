/**
 * Admin → Free suppliers (pure maths): which companies are free, how each came, the KPIs, the chips, the sort, and the
 * counts taken from a few collection reads (the month's offers, the claimed guest offers, the accepted invitations).
 */

import type { ListedCompany } from "@/lib/admin-accounts"
import {
  buildFreeSupplierRows,
  claimedOrgIdsOf,
  deriveSource,
  describeSource,
  explicitSource,
  filterCounts,
  filterFreeRows,
  freeCompanies,
  freeKpis,
  fullOrgIdsOf,
  inFilter,
  invitedOrgIdsOf,
  isSubscribedAccount,
  offerActivity,
  orderCounts,
  quotaState,
  riyadhMonthStartISO,
  sortFreeRows,
  tsMs,
  type FreeSupplierRow,
  type FreeWorld,
} from "@/lib/admin-free-suppliers"

type Rec = Record<string, unknown>

const NOW = Date.parse("2026-10-27T09:00:00Z")
const DAY = 86_400_000
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()
const FILE = { url: "https://files/x.pdf" }
const NO_CTX = { invitedOrgIds: new Set<string>(), claimedOrgIds: new Set<string>() }

const company = (id: string, doc: Rec = {}, extra: Partial<ListedCompany> = {}): ListedCompany => ({ orgId: id, source: "user", ownerUserId: id, doc: { id, ...doc }, ...extra })

function world(over: Partial<FreeWorld> = {}): FreeWorld {
  const companies = over.companies ?? []
  return {
    companies,
    usersById: new Map(companies.map((c) => [c.orgId, c.doc as Rec])),
    fullOrgIds: new Set(),
    invitedOrgIds: new Set(),
    claimedOrgIds: new Set(),
    monthOffers: [],
    month: "2026-10",
    ...over,
  }
}

describe("tsMs", () => {
  it("reads an ISO string, a number, a Firestore Timestamp and nothing", () => {
    expect(tsMs("2026-10-27T09:00:00Z")).toBe(NOW)
    expect(tsMs(NOW)).toBe(NOW)
    expect(tsMs({ seconds: NOW / 1000 })).toBe(NOW)
    expect(tsMs({ toDate: () => new Date(NOW) })).toBe(NOW)
    expect(tsMs({ toMillis: () => NOW })).toBe(NOW)
    for (const bad of [null, undefined, "", "soon", {}]) expect(tsMs(bad)).toBeNull()
  })
})

describe("the plans: a company is free unless its plan is full", () => {
  it("reads the full ones; no document, or anything else, is free", () => {
    const full = fullOrgIdsOf([{ id: "a", supplierPlan: "full" }, { id: "b", supplierPlan: "free" }, { id: "c" }, { id: "d", supplierPlan: "gold" }])
    expect([...full]).toEqual(["a"])
    expect(fullOrgIdsOf(null).size).toBe(0)
  })
  it("splits companies so each is in exactly one place", () => {
    const companies = [company("a"), company("b"), company("c")]
    const full = new Set(["b"])
    const free = freeCompanies(companies, full).map((c) => c.orgId)
    expect(free).toEqual(["a", "c"])
    for (const c of companies) expect(isSubscribedAccount({ id: c.orgId }, full)).toBe(!free.includes(c.orgId))
  })
  it("judges an account by its ACTIVE company: a team member follows his owner's plan", () => {
    const full = new Set(["owner1"])
    expect(isSubscribedAccount({ id: "member1", organizationId: "owner1" }, full)).toBe(true)
    expect(isSubscribedAccount({ id: "member2", organizationId: "owner2" }, full)).toBe(false)
    expect(isSubscribedAccount({ id: "owner1" }, full)).toBe(true)
  })
})

describe("how a company came", () => {
  it("takes the stored signupSource first, from the owner's account", () => {
    expect(deriveSource({ orgId: "a", owner: { signupSource: "self", invitedBy: "someone" } }, NO_CTX)).toBe("self")
    expect(deriveSource({ orgId: "a", owner: { signupSource: "guest_claim" } }, { invitedOrgIds: new Set(["a"]), claimedOrgIds: new Set() })).toBe("guest_claim")
    expect(explicitSource("invited")).toBe("invited")
    expect(explicitSource("unknown")).toBeNull()
    expect(explicitSource("whatever")).toBeNull()
  })
  it("ignores a stored value it does not know and derives instead", () => {
    expect(deriveSource({ orgId: "a", owner: { signupSource: "referral", invitedById: "u9" } }, NO_CTX)).toBe("invited")
  })
  it("derives «invited» from an invitedBy mark or an accepted invitation", () => {
    expect(deriveSource({ orgId: "a", owner: { invitedBy: "u1" } }, NO_CTX)).toBe("invited")
    expect(deriveSource({ orgId: "a", owner: {} }, { invitedOrgIds: new Set(["a"]), claimedOrgIds: new Set() })).toBe("invited")
    expect(deriveSource({ orgId: "a", owner: { invitedBy: "  " } }, NO_CTX)).toBe("unknown")
  })
  it("derives «guest_claim» from a guest offer the company now owns, and «unknown» from nothing", () => {
    expect(deriveSource({ orgId: "a", owner: {} }, { invitedOrgIds: new Set(), claimedOrgIds: new Set(["a"]) })).toBe("guest_claim")
    expect(deriveSource({ orgId: "a", owner: {}, company: {} }, NO_CTX)).toBe("unknown")
  })
  it("an invitation outranks a claimed guest offer", () => {
    expect(deriveSource({ orgId: "a", owner: {} }, { invitedOrgIds: new Set(["a"]), claimedOrgIds: new Set(["a"]) })).toBe("invited")
  })
  it("collects the claimed and the invited companies from the reads", () => {
    expect([...claimedOrgIdsOf([{ wasGuestOffer: true, organizationId: "a" }, { wasGuestOffer: true }, { organizationId: "b" }, { wasGuestOffer: false, organizationId: "c" }])]).toEqual(["a"])
    expect([...invitedOrgIdsOf([{ acceptedSupplierOrgId: "a" }, { acceptedSupplierOrgId: "" }, {}, { acceptedSupplierOrgId: "b" }])]).toEqual(["a", "b"])
    expect(claimedOrgIdsOf(null).size + invitedOrgIdsOf(undefined).size).toBe(0)
  })
  it("describes each source with its label key and tone, «unknown» as «not specified»", () => {
    expect(describeSource("self")).toEqual({ labelKey: "source_self", tone: "ok" })
    expect(describeSource("invited")).toEqual({ labelKey: "source_invited", tone: "info" })
    expect(describeSource("guest_claim")).toEqual({ labelKey: "source_guest_claim", tone: "warn" })
    expect(describeSource("unknown")).toEqual({ labelKey: "source_unknown", tone: "mute" })
  })
})

describe("the month's counts", () => {
  it("starts the Riyadh month three hours before UTC midnight", () => {
    expect(riyadhMonthStartISO("2026-10")).toBe("2026-09-30T21:00:00.000Z")
  })
  it("counts a company's quotes in the Riyadh month and its latest activity; a guest's offer belongs to nobody", () => {
    const offers: Rec[] = [
      { organizationId: "a", createdAt: "2026-10-03T08:00:00.000Z", updatedAt: "2026-10-09T08:00:00.000Z" },
      { organizationId: "a", createdAt: "2026-10-05T08:00:00.000Z" },
      { organizationId: "b", createdAt: "2026-10-05T08:00:00.000Z" },
      { organizationId: "a", createdAt: "2026-09-30T20:00:00.000Z" },
      { organizationId: "a", createdAt: "2026-10-06T08:00:00.000Z", isGuestOffer: true },
      { createdAt: "2026-10-06T08:00:00.000Z" },
    ]
    const act = offerActivity(offers, "2026-10")
    expect(act.get("a")).toEqual({ quotes: 2, last: Date.parse("2026-10-09T08:00:00.000Z") })
    expect(act.get("b")?.quotes).toBe(1)
    expect(act.size).toBe(2)
    expect(offerActivity(null, "2026-10").size).toBe(0)
  })
  it("counts orders per supplier company", () => {
    const counts = orderCounts([{ supplierOrgId: "a" }, { supplierOrgId: "a" }, { supplierOrgId: "b" }, { supplierOrgId: "" }, {}])
    expect([...counts]).toEqual([["a", 2], ["b", 1]])
  })
  it("compares the quotes with the allowance only when there is one", () => {
    expect(quotaState(30, 30)).toEqual({ used: 30, limit: 30, full: true })
    expect(quotaState(12, 30).full).toBe(false)
    expect(quotaState(500, null).full).toBe(false)
  })
})

describe("the rows", () => {
  const owner = (id: string, extra: Rec = {}) => ({ name: "خالد", role: "Supplier", ...extra, id })

  it("lists the free companies only, with company name before the owner's name and the owner's phone", () => {
    const a = company("a", { ...owner("a"), companyName: "شركة النور", phone: "+966500000001", city: "الرياض", specializations: ["رخام", "جرانيت"], createdAt: iso(3), legalDocuments: { cr: FILE, vat: FILE }, verificationRequested: true })
    const b = company("b", { ...owner("b"), name: "شركة الأساس" })
    const rows = buildFreeSupplierRows(world({ companies: [a, b], fullOrgIds: new Set(["b"]) }))
    expect(rows.map((r) => r.id)).toEqual(["a"])
    expect(rows[0]).toMatchObject({ name: "شركة النور", ownerName: "خالد", phone: "+966500000001", city: "الرياض", specializations: ["رخام", "جرانيت"], approval: "pending", hasAllRequiredDocs: true, verified: false })
  })
  it("reads a legacy company whose name is the company's: no separate owner name", () => {
    const rows = buildFreeSupplierRows(world({ companies: [company("a", { ...owner("a"), name: "مؤسسة الأفق" })] }))
    expect(rows[0]).toMatchObject({ name: "مؤسسة الأفق", ownerName: "" })
  })
  it("takes the join day from createdAt, else signedUpAt, else joinedAt (the public sign-up writes the last two)", () => {
    const rows = buildFreeSupplierRows(
      world({
        companies: [
          company("a", { ...owner("a"), createdAt: iso(5), signedUpAt: iso(9) }),
          company("b", { ...owner("b"), joinedAt: { seconds: (NOW - 2 * DAY) / 1000 } }),
          company("c", { ...owner("c"), signedUpAt: { seconds: (NOW - 4 * DAY) / 1000 }, joinedAt: iso(1) }),
        ],
      }),
    )
    expect(rows.map((r) => r.joinedAt)).toEqual([NOW - 5 * DAY, NOW - 2 * DAY, NOW - 4 * DAY])
  })
  it("a secondary company reads its owner's account for the name, the phone and the sign-up mark", () => {
    const org = company("org1", { name: "فرع جدة", role: "Supplier", legalDocuments: { cr: FILE, vat: FILE } }, { source: "org", ownerUserId: "u1" })
    const w = world({ companies: [org], usersById: new Map([["u1", { id: "u1", name: "سعد", phone: "+966511111111", signupSource: "self", lastLoginAt: iso(1) }]]) })
    expect(buildFreeSupplierRows(w)[0]).toMatchObject({ source: "org", name: "فرع جدة", ownerName: "سعد", phone: "+966511111111", signup: "self", lastActivityAt: NOW - DAY })
  })
  it("quotes this month and the latest activity come from the offers and the last sign-in, whichever is newer", () => {
    const a = company("a", { ...owner("a"), lastLoginAt: "2026-10-01T08:00:00.000Z" })
    const rows = buildFreeSupplierRows(world({ companies: [a], monthOffers: [{ organizationId: "a", createdAt: "2026-10-08T08:00:00.000Z" }, { organizationId: "a", createdAt: "2026-10-09T08:00:00.000Z" }] }))
    expect(rows[0].quotesThisMonth).toBe(2)
    expect(rows[0].lastActivityAt).toBe(Date.parse("2026-10-09T08:00:00.000Z"))
    const none = buildFreeSupplierRows(world({ companies: [company("z", owner("z"))] }))
    expect(none[0]).toMatchObject({ quotesThisMonth: 0, lastActivityAt: null })
  })
  it("derives the source of each row from the three reads", () => {
    const w = world({
      companies: [company("s", owner("s", { signupSource: "self" })), company("i", owner("i")), company("g", owner("g")), company("u", owner("u"))],
      invitedOrgIds: new Set(["i"]),
      claimedOrgIds: new Set(["g"]),
    })
    expect(Object.fromEntries(buildFreeSupplierRows(w).map((r) => [r.id, r.signup]))).toEqual({ s: "self", i: "invited", g: "guest_claim", u: "unknown" })
  })
})

describe("KPIs, chips, search and sort", () => {
  const row = (id: string, over: Partial<FreeSupplierRow> = {}): FreeSupplierRow => ({
    id,
    source: "user",
    ownerUserId: id,
    name: id,
    ownerName: "",
    phone: "",
    email: "",
    city: "",
    specializations: [],
    crNumber: "",
    taxNumber: "",
    signup: "self",
    approval: "ready",
    verified: false,
    verificationRequested: false,
    hasAllRequiredDocs: true,
    joinedAt: NOW - 100 * DAY,
    lastActivityAt: null,
    quotesThisMonth: 0,
    doc: {},
    ...over,
  })
  const rows = [
    row("pending-new", { approval: "pending", joinedAt: NOW - 2 * DAY, quotesThisMonth: 3, signup: "self", name: "شركة النور", city: "الرياض" }),
    row("missing-old", { approval: "missing", hasAllRequiredDocs: false, joinedAt: NOW - 20 * DAY, signup: "invited", name: "مؤسسة الأفق" }),
    row("approved-guest", { approval: "approved", verified: true, joinedAt: NOW - 40 * DAY, signup: "guest_claim", lastActivityAt: NOW - DAY, quotesThisMonth: 1 }),
    row("ready-unknown", { approval: "ready", signup: "unknown", joinedAt: null }),
  ]

  it("counts the five KPIs: total, waiting (documents in and requested), joined in 7 and 30 days, active this month", () => {
    expect(freeKpis(rows, NOW)).toEqual({ total: 4, waiting: 1, joined7: 1, joined30: 2, active: 2 })
    expect(freeKpis([], NOW)).toEqual({ total: 0, waiting: 0, joined7: 0, joined30: 0, active: 0 })
  })
  it("a join day in the future is not «joined in the last days»", () => {
    expect(freeKpis([row("x", { joinedAt: NOW + DAY })], NOW).joined7).toBe(0)
  })
  it("the seven chips segment the list", () => {
    const ids = (f: Parameters<typeof inFilter>[1]) => rows.filter((r) => inFilter(r, f)).map((r) => r.id)
    expect(ids("all")).toHaveLength(4)
    expect(ids("waiting")).toEqual(["pending-new"])
    expect(ids("approved")).toEqual(["approved-guest"])
    expect(ids("no_docs")).toEqual(["missing-old"])
    expect(ids("self")).toEqual(["pending-new"])
    expect(ids("invited")).toEqual(["missing-old"])
    expect(ids("guest_claim")).toEqual(["approved-guest"])
    expect(filterCounts(rows)).toEqual({ all: 4, waiting: 1, approved: 1, no_docs: 1, self: 1, invited: 1, guest_claim: 1 })
  })
  it("the search narrows the chosen chip, folding Arabic letter forms", () => {
    expect(filterFreeRows(rows, { filter: "all", search: "النور" }).map((r) => r.id)).toEqual(["pending-new"])
    expect(filterFreeRows(rows, { filter: "all", search: "افق" }).map((r) => r.id)).toEqual(["missing-old"])
    expect(filterFreeRows(rows, { filter: "waiting", search: "الافق" })).toEqual([])
    expect(filterFreeRows(rows, { filter: "all", search: "" })).toHaveLength(4)
    expect(filterFreeRows(rows, { filter: "all", search: "رياض" }).map((r) => r.id)).toEqual(["pending-new"])
  })
  it("sorts by what needs the admin first, by newest, or by activity", () => {
    expect(sortFreeRows(rows, "attention").map((r) => r.id)).toEqual(["pending-new", "ready-unknown", "missing-old", "approved-guest"])
    expect(sortFreeRows(rows, "newest").map((r) => r.id)).toEqual(["pending-new", "missing-old", "approved-guest", "ready-unknown"])
    expect(sortFreeRows(rows, "activity").map((r) => r.id)[0]).toBe("approved-guest")
  })
})
