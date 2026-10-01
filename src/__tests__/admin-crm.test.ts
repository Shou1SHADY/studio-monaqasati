import { buildClientRows, summarizeClients, contactsClient, toDateKey, STALE_DAYS } from "@/lib/admin-crm"

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
