/**
 * PM 1.0 permissions (PRD §3–§4), ported from the prototype's QA pack 3/7:
 * the action matrix by role, the zero-duty member refused everything, no duty
 * that guards nothing, assignment that only narrows, and the archive lock.
 */

import {
  PM_DUTIES,
  PM_GUARD,
  PM_SYSTEM_CEILINGS,
  effectiveDuties,
  mayApproveCertificate,
  mayApproveSubCertificate,
  mayManageTeam,
  mayWithdrawAddendum,
  pmAllowed,
  pmCan,
  pmRefusal,
  pmSeesProject,
  seatActive,
  teamProblems,
  type PmAction,
  type PmContext,
  type PmKey,
  type PmProjectRole,
  type PmSeat,
} from "@/lib/pm/access"

const ceiling = (k: keyof typeof PM_SYSTEM_CEILINGS) => new Set<PmKey>(PM_SYSTEM_CEILINGS[k])
const seat = (role: PmProjectRole, over: Partial<PmSeat> = {}): PmSeat => ({ uid: "u", role, ...over })

// The seven columns of the PRD's matrix: system ceiling × project role. The HSE
// officer, site supervisor and "other" sit on the site-level ceiling; "other"
// starts with nothing ticked.
const COLUMNS: Record<string, PmContext> = {
  owner: { ceiling: ceiling("owner"), seat: null, archived: false },
  pm: { ceiling: ceiling("pm"), seat: seat("pm"), archived: false },
  site: { ceiling: ceiling("site"), seat: seat("site"), archived: false },
  qs: { ceiling: ceiling("qs"), seat: seat("qs"), archived: false },
  hse: { ceiling: ceiling("site"), seat: seat("hse"), archived: false },
  supervisor: { ceiling: ceiling("site"), seat: seat("supervisor"), archived: false },
  other: { ceiling: ceiling("site"), seat: seat("other", { roleName: "Surveyor", off: [...PM_DUTIES] }), archived: false },
}
const ORDER = ["owner", "pm", "site", "qs", "hse", "supervisor", "other"] as const

// ● = allowed, · = refused, in the PRD's column order.
const MATRIX: Array<[PmAction, string]> = [
  ["project.create", "●●·····"],
  ["boq.import", "●●·····"],
  ["terms.complete", "●●·●···"],
  ["addendum.draft", "●●·●···"],
  ["addendum.sign", "●●·····"],
  ["measurement.write", "●●●●···"],
  ["measurement.approve", "●●·····"],
  ["qa.record", "●●●····"],
  ["submittal.record", "●●●●···"],
  ["weeklyPlan.manage", "●●●●···"],
  ["daily.write", "●·●·●●·"],
  ["hse.record", "●●··●··"],
  ["supply.request", "●●●····"],
  ["store.move", "●●●····"],
  ["plant.request", "●●●····"],
  ["supply.receive", "●●●····"],
  ["subcontract.manage", "●●·●···"],
  ["variation.log", "●●·●···"],
  ["variation.decide", "●●·····"],
  ["claim.draft", "●●·●···"],
  ["certificate.prepare", "●●·●···"],
  ["certificate.certify", "●●·····"],
  ["correspondence.write", "●●·●···"],
  ["request.decide", "●●·····"],
  ["programme.manage", "●●·····"],
  ["document.manage", "●●·····"],
  ["consultantPortal.manage", "●●·····"],
  ["reconciliation.manage", "●●·····"],
  ["sections.manage", "●●·····"],
  ["project.start", "●●·····"],
  ["handover.provisional", "●●·····"],
  ["handover.final", "●●·····"],
  ["project.close", "●●·····"],
  ["project.archive", "●●·····"],
]

const row = (a: PmAction) => ORDER.map((c) => (pmAllowed(COLUMNS[c], a) ? "●" : "·")).join("")

describe("the PRD's action matrix, by role", () => {
  it.each(MATRIX)("%s → %s", (action, expected) => {
    expect(row(action)).toBe(expected)
  })

  it("sees amounts: owner, PM and QS only", () => {
    expect(ORDER.map((c) => (pmCan(COLUMNS[c], "money") ? "●" : "·")).join("")).toBe("●●·●···")
  })

  it("internal certificate approval (never the preparer): owner and PM", () => {
    expect(ORDER.map((c) => (mayApproveCertificate(COLUMNS[c], "approver", "preparer") ? "●" : "·")).join("")).toBe("●●·····")
  })

  it("team changes: owner, the PM on their project, and the QS office (all projects)", () => {
    expect(ORDER.map((c) => (mayManageTeam(COLUMNS[c], false) ? "●" : "·")).join("")).toBe("●●·●···")
  })
})

describe("the guard itself (QA 3/7)", () => {
  it("a member holding no duty is refused every duty-guarded action", () => {
    const zero = COLUMNS.other
    const leaks = (Object.keys(PM_GUARD) as PmAction[]).filter((a) => {
      const keys = [...(PM_GUARD[a] as { all?: PmKey[]; any?: PmKey[] }).all ?? [], ...((PM_GUARD[a] as { any?: PmKey[] }).any ?? [])]
      return keys.some((k) => (PM_DUTIES as readonly string[]).includes(k)) && pmAllowed(zero, a)
    })
    expect(leaks).toEqual([])
  })

  it("every duty guards something — a checkbox that does nothing is a lie (INV-13)", () => {
    const full: PmContext = { ceiling: ceiling("owner"), seat: seat("other", { roleName: "QA", off: [] }), archived: false }
    const everything = (Object.keys(PM_GUARD) as PmAction[]).filter((a) => pmAllowed(full, a))
    for (const duty of PM_DUTIES) {
      const without: PmContext = { ...full, seat: seat("other", { roleName: "QA", off: [duty] }) }
      const lost = everything.filter((a) => !pmAllowed(without, a))
      // `ipc`, `client` and `ipcOk` also guard reading and in-handler rules; the
      // guard table must still lose at least one action for every other duty.
      if (duty === "ipcOk") expect(mayApproveCertificate(without, "a", "b")).toBe(false)
      else expect(lost.length).toBeGreaterThan(0)
    }
  })

  it("an archived project refuses every change, the owner's included, but keeps system keys", () => {
    const archived: PmContext = { ...COLUMNS.owner, archived: true }
    const allowed = (Object.keys(PM_GUARD) as PmAction[]).filter((a) => pmAllowed(archived, a))
    expect(allowed.sort()).toEqual(["boq.import", "project.create"])
    expect(pmRefusal(archived, "measurement.write")).toBe("archived")
    expect(pmCan(archived, "money")).toBe(true)
    expect(mayManageTeam(archived, false)).toBe(false)
    expect(mayWithdrawAddendum(archived, "u", "u")).toBe(false)
  })

  it("someone off the team with no `all` holds no duty and does not see the project", () => {
    const outsider: PmContext = { ceiling: ceiling("pm"), seat: null, archived: false }
    expect(pmRefusal(outsider, "measurement.write")).toBe("not_on_team")
    expect(pmSeesProject(outsider)).toBe(false)
    expect(pmSeesProject({ ceiling: ceiling("qs"), seat: null })).toBe(true)
  })
})

describe("assignment narrows, never grants (S-10, RL-01)", () => {
  it("a site-level person seated as project manager gets only what the site ceiling allows", () => {
    const d = effectiveDuties(ceiling("site"), seat("pm"))
    expect(d).not.toContain("approve")
    expect(d).not.toContain("ipcOk")
    expect(d).toEqual(expect.arrayContaining(["measure", "daily", "qa", "hse", "req", "rcv"]))
  })

  it("removing a duty from one person removes exactly that", () => {
    const d = effectiveDuties(ceiling("site"), seat("site", { off: ["req"] }))
    expect(d).toEqual(["measure", "daily", "qa", "rcv"])
  })

  it("the template caps the ceiling: a site engineer never gets `hse` from the engineer role", () => {
    expect(effectiveDuties(ceiling("site"), seat("site"))).not.toContain("hse")
  })
})

describe("rules that need the action's data", () => {
  const pm = COLUMNS.pm
  it("a certificate is never approved by its preparer, unless self-approval is recorded", () => {
    expect(mayApproveCertificate(pm, "u2", "u2")).toBe(false)
    expect(mayApproveCertificate(pm, "u2", "u2", true)).toBe(true)
  })
  it("a sub certificate needs ipcOk, another preparer, and fits the riyal limit", () => {
    expect(mayApproveSubCertificate(pm, "u2", "u4", 70_000, 75_000)).toBe(true)
    expect(mayApproveSubCertificate(pm, "u2", "u4", 80_000, 75_000)).toBe(false)
    expect(mayApproveSubCertificate(pm, "u2", "u2", 1_000, 75_000)).toBe(false)
  })
  it("an addendum is withdrawn by its drafter or by approve", () => {
    expect(mayWithdrawAddendum(COLUMNS.qs, "u4", "u4")).toBe(true)
    expect(mayWithdrawAddendum(COLUMNS.qs, "u4", "u2")).toBe(false)
    expect(mayWithdrawAddendum(pm, "u2", "u4")).toBe(true)
  })
  it("appointing or removing the project manager is the owner's alone", () => {
    expect(mayManageTeam(COLUMNS.owner, true)).toBe(true)
    expect(mayManageTeam(pm, true)).toBe(false)
  })
})

describe("the team", () => {
  it("someone removed with today's date is off the team today", () => {
    expect(seatActive({ to: "2026-09-25" }, "2026-09-25")).toBe(false)
    expect(seatActive({ to: "2026-09-26" }, "2026-09-25")).toBe(true)
    expect(seatActive({ to: null }, "2026-09-25")).toBe(true)
  })
  it("exactly one live project manager, and an `other` role must be named", () => {
    const today = "2026-09-25"
    expect(teamProblems([seat("site")], today)).toEqual(["no_pm"])
    expect(teamProblems([seat("pm"), seat("pm", { uid: "b" })], today)).toEqual(["two_pms"])
    expect(teamProblems([seat("pm"), seat("pm", { uid: "b", to: "2026-09-01" })], today)).toEqual([])
    expect(teamProblems([seat("pm"), seat("other", { roleName: " " })], today)).toEqual(["unnamed_other"])
  })
})
