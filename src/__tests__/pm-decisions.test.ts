/**
 * PM 1.0 — decisions are computed (DEC-01, §12): each appears with its cause,
 * carries the prototype's severity, amount and age, points to the tab that
 * solves it, reaches only the duty that answers it, and disappears when the
 * cause is solved. An archived project raises none.
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
  items: [{ quantity: 100, rate: 10_000, executed: 90, billed: 90 }],
  sheets: [],
  addenda: [],
  certificates: [],
  punch: [],
  variations: [],
  claims: [],
  eac: { on: "2026-09-20" },
  today: "2026-09-27",
}
const kinds = (f: Partial<DecisionFacts>) => projectDecisions({ ...base, ...f }).map((d) => d.kind)
const find = (f: Partial<DecisionFacts>, k: string) => projectDecisions({ ...base, ...f }).find((d) => d.kind === k)

describe("decisions", () => {
  it("a healthy project raises nothing; an archived one never does", () => {
    expect(kinds({})).toEqual([])
    expect(kinds({ lifecycle: "closed", managerless: true })).toEqual([])
  })

  it("red first: no manager, unpriced work, a failed inspection", () => {
    const d = projectDecisions({
      ...base,
      managerless: true,
      items: [{ quantity: 10, rate: 0, executed: 2 }, { quantity: 100, rate: 10_000, executed: 90, billed: 90, gate: { pmInspect: true, pmWir: "fail" } }],
      sheets: [{ status: "wait", day: "2026-09-25" }],
    })
    expect(d.filter((x) => x.severity === "red").map((x) => x.kind).sort()).toEqual(["no_pm", "unpriced_executed", "wir_failed"])
    expect(d.find((x) => x.kind === "sheets_waiting")).toMatchObject({ severity: "amber", count: 1, age: 2, tab: "pmMeasure" })
    expect(d[d.length - 1].severity).not.toBe("red")
  })

  it("a sheet waiting more than 4 days turns red", () => {
    expect(find({ sheets: [{ status: "wait", day: "2026-09-20" }] }, "sheets_waiting")?.severity).toBe("red")
  })

  it("collection is amber when late, red past 30 days", () => {
    expect(find({ certificates: [{ status: "appr", net: 50_000, dueOn: "2026-09-10", collected: 0.4 }] }, "collection_overdue")).toMatchObject({ severity: "amber", amount: 30_000, tab: "ipc" })
    expect(find({ certificates: [{ status: "appr", net: 50_000, dueOn: "2026-08-01", collected: 0 }] }, "collection_overdue")?.severity).toBe("red")
  })

  it("an IPC is ready when more than 40,000 of executed work is unbilled", () => {
    expect(find({ items: [{ quantity: 100, rate: 10_000, executed: 90, billed: 80 }] }, "ipc_ready")).toMatchObject({ severity: "red", amount: 100_000, tab: "ipc" })
    expect(kinds({ items: [{ quantity: 100, rate: 10_000, executed: 90, billed: 87 }] })).not.toContain("ipc_ready")
  })

  it("variations, claims and addenda raise theirs; work before approval is red", () => {
    expect(
      kinds({
        variations: [{ status: "wait", value: 20_000, executedPct: 0.3, day: "2026-09-01" }],
        claims: [{ status: "draft", eventOn: "2026-08-01" }, { status: "sub", eventOn: "2026-09-01" }, { status: "draft", eventOn: "2026-09-05" }],
        addenda: [{ status: "draft", day: "2026-09-10" }],
      }).sort()
    ).toEqual(["addendum_unsigned", "claim_notice_due", "claim_notice_late", "claim_waiting", "vo_waiting", "vo_work"])
    expect(find({ variations: [{ status: "wait", value: 20_000, executedPct: 0.3, day: "2026-09-01" }] }, "vo_work")?.severity).toBe("red")
  })

  it("samples: a rejected latest revision is red, one with the consultant over 10 days amber", () => {
    const f = { submittals: [{ itemId: "a", status: "rej", rev: 1, day: "2026-09-20" }, { itemId: "b", status: "sub", rev: 1, day: "2026-09-10" }, { itemId: "c", status: "rej", rev: 1, day: "2026-09-01" }, { itemId: "c", status: "appA", rev: 2, day: "2026-09-15" }] }
    expect(find(f, "sample_rejected")).toMatchObject({ severity: "red", count: 1 })
    expect(find(f, "sample_late")).toMatchObject({ severity: "amber", count: 1 })
  })

  it("the certificate you prepared asks someone else; another's asks you", () => {
    const certificates = [
      { status: "int" as const, net: 10_000, prep: "u1", prepOn: "2026-09-20" },
      { status: "int" as const, net: 20_000, prep: "u2", prepOn: "2026-09-25" },
    ]
    const d = projectDecisions({ ...base, certificates, viewer: { uid: "u1", has: () => true } })
    expect(d.find((x) => x.kind === "cert_internal")).toMatchObject({ severity: "red", count: 1, amount: 20_000 })
    expect(d.find((x) => x.kind === "cert_mine")).toMatchObject({ severity: "amber", count: 1, amount: 10_000 })
  })

  it("delay damages run on the effective duration — a granted extension removes them; slipping more than 4 points is flagged", () => {
    const terms = { ...defaultTerms(), damages: { on: true, weeklyRate: 0.005, cap: 0.1 } }
    const late = { terms, items: [{ quantity: 100, rate: 10_000, executed: 20, billed: 20 }] }
    expect(kinds(late)).toEqual(expect.arrayContaining(["damages", "slip"]))
    expect(kinds({ ...late, claims: [{ status: "appr", eventOn: "2026-02-01", response: { days: 3000 } }] })).not.toContain("damages")
  })

  it("handovers: ready for provisional at 99%, final once the punch list is closed, red when the defects period ended", () => {
    expect(kinds({ items: [{ quantity: 100, rate: 10_000, executed: 99, billed: 99 }] })).toEqual(["provisional_ready"])
    const prov = { acceptances: { prov: { on: "2026-09-01", by: "pm1" } } }
    expect(kinds({ ...prov, punch: [{ status: "fix" }] })).toEqual([])
    expect(kinds({ ...prov, punch: [{ status: "done" }] })).toEqual(["final_ready"])
    expect(find({ acceptances: { prov: { on: "2025-06-01", by: "pm1" } } }, "final_overdue")?.severity).toBe("red")
  })

  it("a live project asks for its monthly reconciliation when none is approved or the last is over 35 days old", () => {
    expect(find({ eac: null }, "cvr_stale")).toMatchObject({ severity: "amber", count: 0, tab: "pmCvr" })
    expect(find({ eac: { on: "2026-08-01" } }, "cvr_stale")).toMatchObject({ count: 57, age: 57 })
    expect(kinds({ lifecycle: "plan", eac: null, startOn: null, plannedStart: null })).not.toContain("cvr_stale")
  })

  it("a project on hold: amber, red past 30 days", () => {
    expect(find({ lifecycle: "hold", holdSince: "2026-09-10" }, "hold")?.severity).toBe("amber")
    expect(find({ lifecycle: "hold", holdSince: "2026-08-01" }, "hold")?.severity).toBe("red")
  })

  it("a project in planning whose start date passed", () => {
    expect(projectDecisions({ ...base, lifecycle: "plan", startOn: null, plannedStart: "2026-09-01" })).toEqual([{ kind: "plan_overdue", severity: "amber", age: 26, tab: "info" }])
  })

  it("each decision reaches only the duty that answers it — a site engineer sees no money, no manager and no contract", () => {
    const facts: Partial<DecisionFacts> = {
      managerless: true,
      items: [{ quantity: 10, rate: 0, executed: 2 }, { quantity: 100, rate: 10_000, executed: 90, billed: 50, gate: { pmInspect: true, pmWir: "fail" } }],
      sheets: [{ status: "wait", day: "2026-09-25" }],
      claims: [{ status: "draft", eventOn: "2026-08-01" }],
      addenda: [{ status: "draft", day: "2026-09-10" }],
    }
    const site = new Set(["measure", "daily", "req", "rcv", "qa", "hse"])
    expect(projectDecisions({ ...base, ...facts, viewer: { uid: "s", has: (k) => site.has(k) } }).map((d) => d.kind)).toEqual(["wir_failed"])
    const owner = projectDecisions({ ...base, ...facts, viewer: { uid: "o", has: () => true } }).map((d) => d.kind)
    expect(owner).toEqual(expect.arrayContaining(["no_pm", "unpriced_executed", "ipc_ready", "wir_failed", "sheets_waiting", "claim_notice_late", "addendum_unsigned"]))
  })
})
