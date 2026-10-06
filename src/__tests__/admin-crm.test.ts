import { buildClientRows, summarizeClients, contactsClient, toDateKey, STALE_DAYS, buildLeadRows, summarizeLeads, leadCrmId, manualLeadSchema, leadMatches, leadIntake, phoneKey } from "@/lib/admin-crm"

const now = new Date(2026, 9, 1, 12, 0, 0)
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()

describe("admin client CRM", () => {
  it("lists only contractors and suppliers, defaulting a new client to onboarding", () => {
    const rows = buildClientRows(
      [
        { id: "a", role: "Contractor", name: "Al Noor", email: "a@x.sa" },
        { id: "b", role: "Supplier", email: "b@x.sa" },
        { id: "c", role: "Admin", name: "Staff" },
      ],
      {},
      now,
    )
    expect(rows.map((r) => r.id)).toEqual(["a", "b"])
    expect(rows[0].stage).toBe("onboarding")
    expect(rows[1].name).toBe("b@x.sa")
  })

  it("ignores a stored stage that is not one of the four", () => {
    const [row] = buildClientRows([{ id: "a", role: "Contractor" }], { a: { stage: "vip" } }, now)
    expect(row.stage).toBe("onboarding")
  })

  it("marks a client never contacted, or silent past the limit, as stale", () => {
    const rows = buildClientRows(
      [
        { id: "never", role: "Contractor" },
        { id: "old", role: "Contractor" },
        { id: "fresh", role: "Contractor" },
        { id: "gone", role: "Supplier" },
      ],
      {
        old: { lastContactAt: daysAgo(STALE_DAYS + 1) },
        fresh: { lastContactAt: daysAgo(STALE_DAYS) },
        gone: { stage: "churned" },
      },
      now,
    )
    expect(Object.fromEntries(rows.map((r) => [r.id, r.stale]))).toEqual({
      never: true,
      old: true,
      fresh: false,
      gone: false,
    })
    expect(rows.find((r) => r.id === "old")?.daysSinceContact).toBe(STALE_DAYS + 1)
  })

  it("flags a follow-up due today or earlier, never a future one or a churned client", () => {
    const rows = buildClientRows(
      [
        { id: "today", role: "Contractor" },
        { id: "past", role: "Contractor" },
        { id: "future", role: "Contractor" },
        { id: "gone", role: "Contractor" },
      ],
      {
        today: { nextFollowUp: toDateKey(now) },
        past: { nextFollowUp: "2026-09-01" },
        future: { nextFollowUp: "2026-10-02" },
        gone: { nextFollowUp: "2026-09-01", stage: "churned" },
      },
      now,
    )
    expect(rows.filter((r) => r.followUpDue).map((r) => r.id)).toEqual(["today", "past"])
  })

  it("summarises stages, due follow-ups, stale and unowned clients", () => {
    const rows = buildClientRows(
      [
        { id: "1", role: "Contractor" },
        { id: "2", role: "Supplier" },
        { id: "3", role: "Supplier" },
      ],
      {
        "1": { stage: "active", ownerUid: "u1", lastContactAt: daysAgo(2), nextFollowUp: "2026-09-30" },
        "2": { stage: "at_risk" },
        "3": { stage: "churned" },
      },
      now,
    )
    expect(summarizeClients(rows)).toEqual({
      total: 3,
      byStage: { onboarding: 0, active: 1, at_risk: 1, churned: 1 },
      followUpsDue: 1,
      stale: 1,
      unowned: 1,
    })
  })

  it("counts a call, meeting or e-mail as contact but not a note", () => {
    expect(contactsClient("call")).toBe(true)
    expect(contactsClient("meeting")).toBe(true)
    expect(contactsClient("email")).toBe(true)
    expect(contactsClient("note")).toBe(false)
  })
})

describe("admin CRM leads", () => {
  const secs = (n: number) => ({ seconds: Math.floor((now.getTime() - n * 86_400_000) / 1000) })

  it("keys a lead's CRM record by source and id", () => {
    expect(leadCrmId("manual", "x1")).toBe("lead_manual_x1")
  })

  it("starts a lead at new and ignores an unknown stored stage", () => {
    const rows = buildLeadRows(
      [
        { id: "a", source: "demo", name: "A", createdAt: secs(0) },
        { id: "b", source: "demo", name: "B", createdAt: secs(0) },
      ],
      { lead_demo_b: { stage: "vip" } },
      now,
    )
    expect(rows.map((r) => r.stage)).toEqual(["new", "new"])
  })

  it("reads a converted lead as converted and never stale or due", () => {
    const [row] = buildLeadRows(
      [{ id: "a", source: "onboarding", status: "converted", createdAt: secs(30) }],
      { lead_onboarding_a: { stage: "contacted", nextFollowUp: "2026-01-01" } },
      now,
    )
    expect(row.stage).toBe("converted")
    expect(row.stale).toBe(false)
    expect(row.followUpDue).toBe(false)
  })

  it("marks an untouched lead stale after the limit, from its creation date", () => {
    const rows = buildLeadRows(
      [
        { id: "old", source: "demo", createdAt: secs(STALE_DAYS + 3) },
        { id: "fresh", source: "demo", createdAt: secs(1) },
        { id: "touched", source: "demo", createdAt: secs(30) },
      ],
      { lead_demo_touched: { lastContactAt: daysAgo(2) } },
      now,
    )
    expect(rows.map((r) => r.stale)).toEqual([true, false, false])
  })

  it("does not call a lost lead stale", () => {
    const [row] = buildLeadRows([{ id: "a", source: "demo", createdAt: secs(40) }], { lead_demo_a: { stage: "lost" } }, now)
    expect(row.stale).toBe(false)
  })

  it("summarizes open leads, stages, and the unowned ones", () => {
    const rows = buildLeadRows(
      [
        { id: "a", source: "demo", createdAt: secs(0) },
        { id: "b", source: "manual", createdAt: secs(0) },
        { id: "c", source: "demo", createdAt: secs(0) },
      ],
      { lead_manual_b: { ownerUid: "u1", stage: "demo" }, lead_demo_c: { stage: "lost" } },
      now,
    )
    const s = summarizeLeads(rows)
    expect(s.total).toBe(3)
    expect(s.open).toBe(2)
    expect(s.byStage.demo).toBe(1)
    expect(s.unowned).toBe(1)
  })

  it("carries what tells a demo request from a join request", () => {
    const rows = buildLeadRows(
      [
        { id: "d", source: "demo", preferredDate: "2026-10-08", businessTypes: ["manufacturer", "supplier"], createdAt: secs(0) },
        { id: "o", source: "onboarding", city: "Riyadh", size: "10-50", companyTypes: ["contractor"], companyTypeOther: "Crane hire", createdAt: secs(0) },
        { id: "old", source: "demo", businessType: "manufacturer", createdAt: secs(40) },
      ],
      {},
      now,
    )
    expect(rows[0]).toMatchObject({ source: "demo", preferredDate: "2026-10-08", types: ["supplier", "manufacturer"] })
    expect(rows[1]).toMatchObject({ source: "onboarding", city: "Riyadh", size: "10-50", types: ["contractor"], typeOther: "Crane hire", preferredDate: "" })
    expect(rows[2].types).toEqual(["manufacturer"])
  })

  it("needs a name and one way to reach the lead", () => {
    const ok = { source: "ad", kind: "unspecified", name: "Sara", company: "", phone: "0501234567", email: "", city: "", ownerUid: "u1", note: "" }
    expect(manualLeadSchema.safeParse(ok).success).toBe(true)
    expect(manualLeadSchema.safeParse({ ...ok, name: "S" }).success).toBe(false)
    expect(manualLeadSchema.safeParse({ ...ok, phone: "" }).success).toBe(false)
    expect(manualLeadSchema.safeParse({ ...ok, phone: "", email: "S@X.sa" }).success).toBe(true)
    expect(manualLeadSchema.safeParse({ ...ok, email: "nope" }).success).toBe(false)
    expect(manualLeadSchema.safeParse({ ...ok, phone: "abc12345" }).success).toBe(false)
  })

  it("requires the source, and only the three a person can pick by hand", () => {
    const ok = { source: "outreach", kind: "contractor", name: "Sara", company: "", phone: "0501234567", email: "", city: "", ownerUid: "", note: "" }
    expect(manualLeadSchema.safeParse(ok).success).toBe(true)
    expect(manualLeadSchema.safeParse({ ...ok, source: undefined }).success).toBe(false)
    expect(manualLeadSchema.safeParse({ ...ok, source: "demo" }).success).toBe(false)
    expect(manualLeadSchema.safeParse({ ...ok, kind: "partner" }).success).toBe(false)
  })
})

describe("lead duplicates, clients, removal and intake", () => {
  const at = (y: number, m: number, d: number) => ({ seconds: new Date(y, m, d, 10).getTime() / 1000 })

  it("one phone in three spellings is one person", () => {
    expect(phoneKey("0501234567")).toBe(phoneKey("+966 50 123 4567"))
    expect(phoneKey("00966501234567")).toBe(phoneKey("0501234567"))
    expect(phoneKey("12")).toBe("")
  })

  it("flags the same person under a second e-mail, and a lead who already holds an account", () => {
    const rows = buildLeadRows(
      [
        { id: "d1", source: "demo", name: "أحمد حمدان", email: "ahmed@a.sa", phone: "0501234567" },
        { id: "o1", source: "onboarding", name: "Ahmed H", email: "ahmed@b.sa", phone: "+966501234567" },
        { id: "o2", source: "onboarding", name: "احمد حمدان", email: "other@c.sa" },
        { id: "m1", source: "manual", name: "Sara", email: "sara@x.sa" },
        { id: "gone", source: "demo", name: "Junk", email: "ahmed@a.sa", archived: true },
      ],
      {},
      now,
    )
    const m = leadMatches(rows, [{ name: "Sara Co", email: "SARA@x.sa", phone: "" }])
    expect(m.get(leadCrmId("demo", "d1"))?.duplicates.sort()).toEqual([leadCrmId("onboarding", "o1"), leadCrmId("onboarding", "o2")].sort())
    expect(m.get(leadCrmId("onboarding", "o2"))?.duplicates).toEqual([leadCrmId("demo", "d1")]) // أحمد / احمد fold to one name
    expect(m.get(leadCrmId("manual", "m1"))).toMatchObject({ duplicates: [], client: "Sara Co" })
    expect(m.get(leadCrmId("demo", "d1"))?.reasons[leadCrmId("onboarding", "o1")]).toBe("phone")
    expect(m.get(leadCrmId("onboarding", "o2"))?.reasons[leadCrmId("demo", "d1")]).toBe("name")
    expect(m.has(leadCrmId("demo", "gone"))).toBe(false)
  })

  it("a removed lead leaves the counts but is kept", () => {
    const rows = buildLeadRows([{ id: "a", source: "demo" }, { id: "b", source: "demo", archived: true }], {}, now)
    expect(rows.find((r) => r.id === "b")?.archived).toBe(true)
    expect(summarizeLeads(rows)).toMatchObject({ total: 1, open: 1 })
  })

  it("counts intake by Sunday-to-Saturday week and by calendar month, with this month's sources", () => {
    // now = Thu 1 Oct 2026: the week began Sun 27 Sep; last week Sun 20 Sep.
    const rows = buildLeadRows(
      [
        { id: "1", source: "demo", createdAt: at(2026, 9, 1) },
        { id: "2", source: "onboarding", createdAt: at(2026, 8, 27) },
        { id: "3", source: "onboarding", createdAt: at(2026, 8, 22) },
        { id: "4", source: "manual", createdAt: at(2026, 8, 2) },
        { id: "5", source: "demo", createdAt: at(2026, 7, 30) },
        { id: "6", source: "demo" },
      ],
      {},
      now,
    )
    expect(leadIntake(rows, now)).toEqual({ thisWeek: 2, lastWeek: 1, thisMonth: 1, lastMonth: 3, bySource: { demo: 1, onboarding: 0, ad: 0, outreach: 0, other: 0 } })
  })
})

import { readFileSync } from "fs"
import { join } from "path"
import { clientSourceOf, dealSchema, isClientPlan, stageChangeSchema, buildClientRows as rowsOf } from "@/lib/admin-crm"

describe("client record: subscription, source; every stage change states why (6 Oct 2026)", () => {
  it("a client's subscription is one of the pricing packages or a trial — anything else reads as unset", () => {
    expect(isClientPlan("growth")).toBe(true)
    expect(isClientPlan("gold")).toBe(false)
    const [a, b] = rowsOf([{ id: "a", role: "Contractor" }, { id: "b", role: "Supplier" }], { a: { plan: "enterprise" }, b: { plan: "gold" } }, now)
    expect(a).toMatchObject({ plan: "enterprise" })
    expect(a).not.toHaveProperty("idNo") // ADM-05: the ID / passport field is gone
    expect(b.plan).toBeNull()
  })

  it("the source: set by hand wins, else the lead the account was created from, else he signed up", () => {
    expect(clientSourceOf({ convertedFromLeadCollection: "demoRequests" })).toBe("demo")
    expect(clientSourceOf({ convertedFromLeadCollection: "onboardingRequests" })).toBe("onboarding")
    expect(clientSourceOf({})).toBe("signup")
    expect(clientSourceOf({ convertedFromLeadCollection: "demoRequests" }, { source: "referral" })).toBe("referral")
    expect(clientSourceOf({}, { source: "nonsense" })).toBe("signup")
  })

  it("a stage change needs a reason; a deal needs a title, an amount and a day", () => {
    expect(stageChangeSchema.safeParse({ reason: "  " }).success).toBe(false)
    expect(stageChangeSchema.safeParse({ reason: "called, wants a demo" }).success).toBe(true)
    expect(dealSchema.safeParse({ kind: "quote", title: "Pro Growth — 12 months", plan: "growth", amount: 12000, date: "2026-10-06", note: "" }).success).toBe(true)
    expect(dealSchema.safeParse({ kind: "quote", title: "x", plan: null, amount: -1, date: "06/10/2026", note: "" }).success).toBe(false)
  })

  it("opportunities and quotes are platform staff's only, and never deleted", () => {
    const rules = readFileSync(join(process.cwd(), "firestore.rules"), "utf8")
    const block = rules.slice(rules.indexOf("match /adminCrmDeals/{dealId}"), rules.indexOf("match /adminCrmActivities/{activityId}"))
    expect(block).toMatch(/allow get, list, create, update: if isAdmin\(\);/)
    expect(block).toMatch(/allow delete: if false;/)
  })
})
