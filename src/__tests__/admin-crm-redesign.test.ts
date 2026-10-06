import {
  NO_LEAD_FILTERS,
  activityState,
  buildClientRows,
  buildLeadRows,
  clientCards,
  companySizeRange,
  contactSchema,
  deriveContacts,
  effectiveContacts,
  findSimilarLead,
  formatCrmDate,
  inActivitySegment,
  inLeadSegment,
  leadCards,
  leadChannel,
  leadDashboard,
  leadKind,
  leadMatches,
  leadSegmentCounts,
  matchesLeadFilters,
  mergeDirection,
  mergeRecords,
  sortActivities,
  stageTotals,
  summarizeActivities,
  withPrimary,
  type CrmActivity,
  type LeadRow,
} from "@/lib/admin-crm"

// Thursday 1 Oct 2026, noon.
const now = new Date(2026, 9, 1, 12, 0, 0)
const secs = (daysAgo: number) => ({ seconds: (now.getTime() - daysAgo * 86_400_000) / 1000 })
const lead = (id: string, over: Partial<Parameters<typeof buildLeadRows>[0][number]> = {}, rec: Record<string, object> = {}) =>
  buildLeadRows([{ id, source: "demo", createdAt: secs(1), ...over }], rec, now)[0]
const act = (over: Partial<CrmActivity>): CrmActivity => ({ id: "a", clientId: "c", type: "call", note: "", ...over })

describe("ADM-01/02 leads: segments, cards and filters", () => {
  const rows = [
    lead("new", {}, { lead_demo_new: { ownerUid: "u1", ownerName: "A", expectedValue: 18000 } }),
    lead("silent", { createdAt: secs(10) }),
    lead("lost", {}, { lead_demo_lost: { stage: "lost" } }),
    lead("won", { status: "converted" }),
    lead("gone", { archived: true }),
  ]

  it("the strip says where a lead is: open, converted, lost, all (live ones), removed", () => {
    expect(leadSegmentCounts(rows)).toEqual({ open: 2, converted: 1, lost: 1, all: 4, removed: 1 })
    expect(inLeadSegment(rows[4], "all")).toBe(false)
    expect(inLeadSegment(rows[4], "removed")).toBe(true)
  })

  it("the four cards: leads, silent 7+ days, no owner, expected value of open leads only", () => {
    const c = leadCards(rows)
    expect(c.leads).toBe(4)
    expect(c.noContact).toBe(1) // 10 days since arrival, never contacted; 7 days counts ("7 or more")
    expect(c.unowned).toBe(1)
    expect(c.expectedValue).toBe(18000)
    expect(c.valued).toBe(1)
    expect(c.unvalued).toBe(1)
  })

  it("exactly 7 silent days already counts as silent", () => {
    expect(lead("x", { createdAt: secs(7) }).stale).toBe(true)
    expect(lead("y", { createdAt: secs(6) }).stale).toBe(false)
  })

  it("a lead takes the source it came from; a manual one the source typed, else «other»", () => {
    expect(leadChannel({ source: "demo" })).toBe("demo")
    expect(leadChannel({ source: "manual", manualSource: "ad" })).toBe("ad")
    expect(leadChannel({ source: "manual", manualSource: "outreach" })).toBe("outreach")
    expect(leadChannel({ source: "manual" })).toBe("other")
    expect(leadChannel({ source: "manual", manualSource: "weird" })).toBe("other")
  })

  it("contractor / supplier from the ticked company types; both sides read as unspecified", () => {
    expect(leadKind(["contractor"])).toBe("contractor")
    expect(leadKind(["developer"])).toBe("contractor")
    expect(leadKind(["manufacturer"])).toBe("supplier")
    expect(leadKind(["contractor", "supplier"])).toBe("unspecified")
    expect(leadKind([])).toBe("unspecified")
  })

  it("filters: source, owner (me / nobody / one), type, last contact, duplicates only", () => {
    const ctx = { meUid: "u1", hasDuplicates: false }
    const mine = rows[0]
    expect(matchesLeadFilters(mine, NO_LEAD_FILTERS, ctx)).toBe(true)
    expect(matchesLeadFilters(mine, { ...NO_LEAD_FILTERS, channels: ["ad"] }, ctx)).toBe(false)
    expect(matchesLeadFilters(mine, { ...NO_LEAD_FILTERS, channels: ["ad", "demo"] }, ctx)).toBe(true)
    expect(matchesLeadFilters(mine, { ...NO_LEAD_FILTERS, owner: "me" }, ctx)).toBe(true)
    expect(matchesLeadFilters(mine, { ...NO_LEAD_FILTERS, owner: "none" }, ctx)).toBe(false)
    expect(matchesLeadFilters(rows[1], { ...NO_LEAD_FILTERS, owner: "none" }, ctx)).toBe(true)
    expect(matchesLeadFilters(rows[1], { ...NO_LEAD_FILTERS, contact: "over7" }, ctx)).toBe(true)
    expect(matchesLeadFilters(rows[1], { ...NO_LEAD_FILTERS, contact: "never" }, ctx)).toBe(true)
    expect(matchesLeadFilters(mine, { ...NO_LEAD_FILTERS, dupesOnly: true }, ctx)).toBe(false)
    expect(matchesLeadFilters(mine, { ...NO_LEAD_FILTERS, dupesOnly: true }, { ...ctx, hasDuplicates: true })).toBe(true)
  })

  it("board columns: count and money per open stage, removed leads excluded", () => {
    const totals = stageTotals(rows)
    expect(totals.new).toEqual({ count: 2, value: 18000 })
    expect(totals.negotiation).toEqual({ count: 0, value: 0 })
  })
})

describe("ADM-03 dashboard", () => {
  it("conversion rate is over the leads that arrived in the last 90 days", () => {
    const r: LeadRow[] = [
      lead("a", { status: "converted", createdAt: secs(5), convertedAt: secs(2) }),
      lead("b", { createdAt: secs(30) }),
      lead("c", { createdAt: secs(200) }),
      lead("d", { createdAt: secs(10) }),
    ]
    const d = leadDashboard(r, now)
    expect(d.conversionRate).toBe(33) // 1 of the 3 that arrived in 90 days; the 200-day-old one is outside
    expect(d.convertedThisMonth).toBe(0) // converted 2 days before 1 Oct: September
    expect(d.convertedLastMonth).toBe(1)
    expect(d.openByStage.new).toBe(3)
    expect(leadDashboard([], now).conversionRate).toBeNull()
  })
})

describe("ADM-08 activities", () => {
  const today = "2026-10-01"
  it("a scheduled activity is the follow-up; its date makes it late, today or ahead", () => {
    expect(activityState(act({ status: "scheduled", dueDate: "2026-09-30" }), today)).toBe("overdue")
    expect(activityState(act({ status: "scheduled", dueDate: today }), today)).toBe("today")
    expect(activityState(act({ status: "scheduled", dueDate: "2026-10-05" }), today)).toBe("scheduled")
    expect(activityState(act({ status: "done" }), today)).toBe("done")
    expect(activityState(act({}), today)).toBe("done") // a legacy log line
  })

  it("next follow-up = the nearest scheduled date; last contact = the latest done call/WhatsApp/meeting/e-mail", () => {
    const d = deriveContacts([
      act({ id: "1", status: "scheduled", dueDate: "2026-10-08" }),
      act({ id: "2", status: "scheduled", dueDate: "2026-10-03" }),
      act({ id: "3", status: "done", type: "whatsapp", dueDate: "2026-09-28" }),
      act({ id: "4", status: "done", type: "call", dueDate: "2026-09-20" }),
      act({ id: "5", status: "done", type: "task", dueDate: "2026-09-30" }), // a task is not contact
    ]).c
    expect(d.nextFollowUp).toBe("2026-10-03")
    expect(d.lastContactAt.slice(0, 10)).toBe("2026-09-28")
  })

  it("feeds the lead row, replacing the old typed fields", () => {
    const row = buildLeadRows([{ id: "x", source: "demo", createdAt: secs(20) }], { lead_demo_x: { nextFollowUp: "2026-01-01" } }, now, {
      lead_demo_x: { lastContactAt: "2026-09-29T09:00:00.000Z", nextFollowUp: "2026-10-04" },
    })[0]
    expect(row.nextFollowUp).toBe("2026-10-04")
    expect(row.daysSinceContact).toBe(2)
    expect(row.stale).toBe(false)
  })

  it("counts open / late / today / within 7 days / done, and done this week (week starts Sunday)", () => {
    const list = [
      act({ id: "1", status: "scheduled", dueDate: "2026-09-29" }),
      act({ id: "2", status: "scheduled", dueDate: today }),
      act({ id: "3", status: "scheduled", dueDate: "2026-10-07" }),
      act({ id: "4", status: "scheduled", dueDate: "2026-10-20" }),
      act({ id: "5", status: "done", dueDate: "2026-09-28" }),
      act({ id: "6", status: "done", dueDate: "2026-09-10" }),
    ]
    expect(summarizeActivities(list, now)).toEqual({ open: 4, overdue: 1, today: 1, within7: 2, done: 2, doneThisWeek: 1, all: 6 })
    expect(list.filter((a) => inActivitySegment(a, "overdue", now)).map((a) => a.id)).toEqual(["1"])
    expect(list.filter((a) => inActivitySegment(a, "within7", now)).map((a) => a.id)).toEqual(["2", "3"])
  })

  it("sorts soonest first, undated last, done ones newest first", () => {
    const sorted = sortActivities([
      act({ id: "done-old", status: "done", dueDate: "2026-09-01" }),
      act({ id: "later", status: "scheduled", dueDate: "2026-10-09" }),
      act({ id: "done-new", status: "done", dueDate: "2026-09-20" }),
      act({ id: "soon", status: "scheduled", dueDate: "2026-10-02" }),
    ])
    expect(sorted.map((a) => a.id)).toEqual(["soon", "later", "done-new", "done-old"])
  })
})

describe("ADM-06/09/10 contacts, merge, clients", () => {
  it("before anyone is entered the person who asked is the main contact", () => {
    expect(effectiveContacts(undefined, { name: "Sami", phone: "055", email: "" })).toEqual([{ id: "origin", name: "Sami", title: "", phone: "055", email: "", primary: true }])
    expect(effectiveContacts([], { name: "", phone: "", email: "" })).toEqual([])
  })

  it("there is exactly one main contact", () => {
    const list = [
      { id: "a", name: "A", title: "", phone: "1", email: "", primary: true },
      { id: "b", name: "B", title: "", phone: "2", email: "", primary: false },
    ]
    expect(withPrimary(list, "b").map((c) => c.primary)).toEqual([false, true])
    expect(withPrimary(list.map((c) => ({ ...c, primary: false }))).map((c) => c.primary)).toEqual([true, false])
    expect(withPrimary([])).toEqual([])
  })

  it("a contact needs a name and a phone or an email", () => {
    const ok = { name: "Reem", title: "", phone: "0559876543", email: "", primary: false }
    expect(contactSchema.safeParse(ok).success).toBe(true)
    expect(contactSchema.safeParse({ ...ok, phone: "" }).success).toBe(false)
    expect(contactSchema.safeParse({ ...ok, phone: "", email: "r@x.sa" }).success).toBe(true)
  })

  it("a possible duplicate is offered with its reason, and not again once dismissed", () => {
    const rows = buildLeadRows(
      [
        { id: "1", source: "demo", name: "Sami Harbi", phone: "0551234567", createdAt: secs(30) },
        { id: "2", source: "onboarding", name: "Someone", phone: "+966551234567", createdAt: secs(2) },
      ],
      {},
      now,
    )
    const a = "lead_demo_1"
    const b = "lead_onboarding_2"
    expect(leadMatches(rows, []).get(a)?.reasons[b]).toBe("phone")
    expect(leadMatches(rows, [], { [a]: [b] }).has(a)).toBe(false)
    expect(leadMatches(rows, [], { [b]: [a] }).has(a)).toBe(false) // either side's «not a duplicate» counts
  })

  it("while typing a new lead, an existing live lead with that phone, e-mail or full name is found", () => {
    const rows = buildLeadRows([{ id: "1", source: "demo", name: "Sami Harbi", email: "s@x.sa", phone: "0551234567" }, { id: "2", source: "demo", name: "Gone Lead", phone: "0559999999", archived: true }], {}, now)
    expect(findSimilarLead(rows, { phone: "+966 55 123 4567" })?.reason).toBe("phone")
    expect(findSimilarLead(rows, { email: "S@X.SA" })?.reason).toBe("email")
    expect(findSimilarLead(rows, { name: "sami harbi" })?.reason).toBe("name")
    expect(findSimilarLead(rows, { name: "Sami" })).toBeNull() // one word is not a match
    expect(findSimilarLead(rows, { phone: "0559999999" })).toBeNull() // a removed lead is not offered
  })

  it("merging keeps the older record and moves the other's contacts in", () => {
    expect(mergeDirection({ crmId: "new", createdMs: 200 }, { crmId: "old", createdMs: 100 })).toEqual({ keep: "old", drop: "new" })
    const merged = mergeRecords(
      { ownerUid: "", plan: "", contacts: [{ id: "1", name: "Sami", title: "", phone: "0551234567", email: "", primary: true }], expectedValue: 0 },
      { ownerUid: "u2", ownerName: "Shady", plan: "growth", contacts: [{ id: "2", name: "Sami H", title: "GM", phone: "+966551234567", email: "", primary: true }, { id: "3", name: "Reem", title: "", phone: "0559876543", email: "", primary: false }], expectedValue: 5000 },
    )
    expect(merged.contacts?.map((c) => c.name)).toEqual(["Sami", "Reem"]) // the same phone is one person
    expect(merged.contacts?.filter((c) => c.primary)).toHaveLength(1)
    expect(merged).toMatchObject({ ownerUid: "u2", ownerName: "Shady", plan: "growth", expectedValue: 5000 })
  })

  it("client cards: all, no contact 30+ days, no owner, at risk — churned ones are not chased", () => {
    const rows = buildClientRows(
      [
        { id: "a", role: "Contractor" },
        { id: "b", role: "Supplier" },
        { id: "c", role: "Contractor" },
      ],
      { b: { stage: "at_risk", ownerUid: "u", lastContactAt: new Date(now.getTime() - 3 * 86_400_000).toISOString() }, c: { stage: "churned" } },
      now,
    )
    expect(clientCards(rows)).toEqual({ total: 3, noContact: 1, unowned: 1, atRisk: 1 })
  })

  it("a converted client reads its contact history from the lead it came from", () => {
    const rows = buildClientRows([{ id: "u1", role: "Contractor" }], { u1: { convertedFromLead: "lead_demo_x" } }, now, { lead_demo_x: { lastContactAt: "2026-09-30T08:00:00.000Z", nextFollowUp: "" } })
    expect(rows[0].daysSinceContact).toBe(1)
  })
})

describe("ADM-11 display", () => {
  it("one date format: day, month name, year — Latin digits in Arabic too", () => {
    expect(formatCrmDate("2026-10-21", "en")).toBe("21 Oct 2026")
    expect(formatCrmDate("2026-10-21", "ar")).toMatch(/^21 .+ 2026$/)
    expect(formatCrmDate("2026-10-21", "ar")).not.toMatch(/[٠-٩]/)
    expect(formatCrmDate(0, "en")).toBe("—")
    expect(formatCrmDate("garbage", "en")).toBe("—")
    expect(formatCrmDate(null, "ar")).toBe("—")
  })

  it("company size is numbers only, ascending, whatever order it was stored in", () => {
    expect(companySizeRange("employees 50 – 10")).toBe("10–50")
    expect(companySizeRange("10-50")).toBe("10–50")
    expect(companySizeRange("200+ employees")).toBe("200+")
    expect(companySizeRange("")).toBe("")
    expect(companySizeRange("large")).toBe("")
  })
})
