/**
 * The Pulse's derived views: the BOQ divisions furthest behind the planned
 * progress, and the project log from the project's own dated records.
 */

import { projectLog, sectionsBehind, type LogFacts } from "@/lib/pm/pulse"

describe("sections behind", () => {
  const items = [
    { division: "Concrete", quantity: 100, rate: 100, executed: 30 },
    { division: "Concrete", quantity: 100, rate: 100, executed: 50 },
    { division: "Finishes", quantity: 10, rate: 1000, executed: 1 },
    { division: "Earthworks", quantity: 10, rate: 100, executed: 10 },
    { division: "Unpriced", quantity: 10, rate: 0, executed: 0 },
  ]
  it("ranks the divisions behind the planned line, worst first", () => {
    expect(sectionsBehind(items, 50)).toEqual([
      { division: "Finishes", progress: 10, deviation: -40, value: 10000 },
      { division: "Concrete", progress: 40, deviation: -10, value: 20000 },
    ])
  })
  it("says nothing before anything is planned", () => {
    expect(sectionsBehind(items, null)).toEqual([])
    expect(sectionsBehind(items, 0)).toEqual([])
  })
})

describe("the project log", () => {
  const facts: LogFacts = {
    startedAt: "2026-06-01T08:00:00.000Z",
    acceptances: null,
    sheets: [{ seq: 1, status: "ok", day: "2026-07-01" }, { seq: 2, status: "wait", day: "2026-09-01" }],
    variations: [{ seq: 1, title: "Extra slab", status: "appr", day: "2026-08-10", value: 50000 }],
    claims: [{ seq: 1, status: "sub", eventOn: "2026-07-20", noticeOn: "2026-07-22", submittedOn: "2026-08-01" }],
    addenda: [],
    certificates: [{ seq: 1, status: "appr", prepOn: "2026-08-15", certOn: "2026-08-25", certified: 180000 }],
    ncrs: [{ seq: 1, status: "open", day: "2026-09-10" }],
    money: true,
  }
  it("lists the latest dated facts, newest first", () => {
    expect(projectLog(facts).map((e) => e.kind)).toEqual(["ncr", "cert_certified", "vo_approved", "claim_submitted", "sheet", "started"])
  })
  it("hides certificates and values from a member without money", () => {
    const log = projectLog({ ...facts, money: false }, 10)
    expect(log.some((e) => e.kind.startsWith("cert_"))).toBe(false)
    expect(log.find((e) => e.kind === "vo_approved")?.params.value).toBe(0)
  })
})
