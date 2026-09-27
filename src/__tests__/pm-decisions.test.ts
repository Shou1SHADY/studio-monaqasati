/**
 * PM 1.0 — decisions are computed (DEC-01, §12): each appears with its cause,
 * carries its severity, amount and age, points to the tab that solves it, and
 * disappears when the cause is solved. An archived project raises none.
 */

import { projectDecisions, type DecisionFacts } from "@/lib/pm/decisions"
import { defaultTerms } from "@/lib/pm/terms"

const base: DecisionFacts = {
  lifecycle: "live",
  managerless: false,
  startOn: "2026-01-01",
  plannedStart: "2026-01-01",
  durationDays: 300,
  baseValue: 1_000_000,
  terms: defaultTerms(),
  acceptances: {},
  items: [{ quantity: 100, rate: 10_000, executed: 90 }],
  sheets: [],
  addenda: [],
  certificates: [],
  punch: [],
  variations: [],
  claims: [],
  today: "2026-09-27",
}
const kinds = (f: Partial<DecisionFacts>) => projectDecisions({ ...base, ...f }).map((d) => d.kind)

describe("decisions", () => {
  it("a healthy project raises nothing; an archived one never does", () => {
    expect(kinds({})).toEqual([])
    expect(kinds({ lifecycle: "closed", managerless: true })).toEqual([])
  })

  it("red first: no manager, unpriced work, a failed inspection, overdue collection", () => {
    const d = projectDecisions({
      ...base,
      managerless: true,
      items: [{ quantity: 10, rate: 0, executed: 2 }, { quantity: 100, rate: 10_000, executed: 90, gate: { pmInspect: true, pmWir: "fail" } }],
      sheets: [{ status: "wait", day: "2026-09-20" }],
      certificates: [{ status: "appr", net: 50_000, dueOn: "2026-09-01", collected: 0.4 }],
    })
    expect(d.filter((x) => x.severity === "red").map((x) => x.kind).sort()).toEqual(["collection_overdue", "no_pm", "unpriced_executed", "wir_failed"])
    expect(d.find((x) => x.kind === "collection_overdue")).toMatchObject({ amount: 30_000, tab: "ipc" })
    expect(d.find((x) => x.kind === "sheets_waiting")).toMatchObject({ severity: "amber", count: 1, age: 7, tab: "pmMeasure" })
    expect(d[d.length - 1].severity).not.toBe("red")
  })

  it("variations, claims, addenda and samples raise theirs", () => {
    expect(
      kinds({
        variations: [{ status: "wait", value: 20_000, executedPct: 0.3, day: "2026-09-01" }],
        claims: [{ status: "draft", eventOn: "2026-08-01" }, { status: "sub", eventOn: "2026-09-01" }],
        addenda: [{ status: "draft", day: "2026-09-10" }],
        items: [{ quantity: 100, rate: 10_000, executed: 90, pmSample: true, pmSub: "rej" }],
      }).sort()
    ).toEqual(["addendum_unsigned", "claim_notice_late", "claim_waiting", "sample_missing", "vo_waiting", "vo_work"])
  })

  it("delay damages run on the effective duration — a granted extension removes them", () => {
    const terms = { ...defaultTerms(), damages: { on: true, weeklyRate: 0.005, cap: 0.1 } }
    const late = { terms, items: [{ quantity: 100, rate: 10_000, executed: 20 }] }
    expect(kinds(late)).toContain("damages")
    expect(kinds({ ...late, claims: [{ status: "appr", eventOn: "2026-02-01", response: { days: 3000 } }] })).not.toContain("damages")
  })

  it("handovers: ready for provisional at 99%, final once the punch list is closed", () => {
    expect(kinds({ items: [{ quantity: 100, rate: 10_000, executed: 99 }] })).toEqual(["provisional_ready"])
    const prov = { acceptances: { prov: { on: "2026-09-01", by: "pm1" } } }
    expect(kinds({ ...prov, punch: [{ status: "fix" }] })).toEqual([])
    expect(kinds({ ...prov, punch: [{ status: "done" }] })).toEqual(["final_ready"])
  })

  it("a project in planning whose start date passed", () => {
    expect(projectDecisions({ ...base, lifecycle: "plan", startOn: null, plannedStart: "2026-09-01" })).toEqual([{ kind: "plan_overdue", severity: "amber", age: 26, tab: "info" }])
  })
})
