/**
 * PM 1.1 — the consultant's answers recorded from his letter (the internal
 * door), and the decisions about him. The internal writes run the same pure
 * planners as the portal: a refused fix / rejected plan reopens with history
 * (PN-04 / NCR-02); the certificate's expected due date is set when it goes to
 * him and its due date comes from the contract in force on certification day
 * (IPC-06). Decisions: the certificate past his period (amber, red at 2×, with
 * the link's state), the unopened link (CP-13), DEC-01's duty narrowing and
 * section silencing (FX-59…62), and late letters by direction (COR-01).
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { approveCertificate, certifyCertificate, type PmCertificate } from "@/lib/pm/certificate-writes"
import { projectDecisions, type DecisionFacts } from "@/lib/pm/decisions"
import { rejectNcrPlan } from "@/lib/pm/ncr-writes"
import type { PmNcr } from "@/lib/pm/ncr"
import { refuseFix } from "@/lib/pm/punch-writes"
import type { PunchItem } from "@/lib/pm/punch"
import { todayDay } from "@/lib/pm/format"
import { defaultTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const seA = { uid: "se1", name: "Omar" }
const pmA = { uid: "pm1", name: "Abdullah" }
const terms = { ...defaultTerms({ advance: 0.1, retention: 0.1 }), retentionCap: 0.05, paymentDays: 30, consultantDays: 14 }

beforeEach(() => resetFakeDb())

describe("the consultant's refusal recorded from his letter (PN-04 / NCR-02)", () => {
  it("a refused fix reopens the punch item, the refused fix kept with the recorder's name", async () => {
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live" } })
    const fix = { on: "2026-09-01", by: "se1", byName: "Omar", note: "Re-plastered" }
    seed("projects/p1/pmPunch/01", { seq: 1, what: "Crack", location: "Stair", severity: "a", source: "cons", status: "fix", day: "2026-08-20", by: "se1", fix })
    await expect(refuseFix(db, site, "p1", seA, 1, "  ")).rejects.toMatchObject({ code: "blocked", blocks: ["no_note"] })
    await refuseFix(db, site, "p1", seA, 1, "Crack still visible")
    const p = readDoc<PunchItem>("projects/p1/pmPunch/01") as PunchItem
    expect(p.status).toBe("open")
    expect(p.fix).toBeNull()
    expect(p.rejects).toEqual([{ on: todayDay(), by: "se1", byName: "Omar", note: "Crack still visible", refused: fix, viaPortal: false, recordedOn: todayDay() }])
    await expect(refuseFix(db, site, "p1", seA, 1, "again")).rejects.toMatchObject({ blocks: ["wrong_state"] })
  })

  it("a rejected corrective plan reopens the NCR for a new plan", async () => {
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live" } })
    const plan = { on: "2026-09-02", by: "se1", text: "Break out and recast" }
    seed("projects/p1/pmNcrs/01", { seq: 1, itemId: "", severity: "a", root: "Cover", cost: 1, status: "plan", day: "2026-08-20", by: "se1", plan })
    await rejectNcrPlan(db, site, "p1", seA, 1, "Does not treat the cause")
    const n = readDoc<PmNcr>("projects/p1/pmNcrs/01") as PmNcr
    expect(n).toMatchObject({ status: "open", plan: null })
    expect(n.rejects?.[0]).toMatchObject({ note: "Does not treat the cause", refused: plan, viaPortal: false })
  })
})

describe("IPC-06 — the due dates come from the contract in force", () => {
  const seedCert = (status: string) => {
    seed("projects/p1", { organizationId: "org", budget: 1_000_000, projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/009", lifecycle: "live", terms, original: terms, addendaCount: 1, retentionHeld: 20_000, advanceRecovered: 20_000, cutPool: 0 } })
    seed("projects/p1/pmAddenda/01", { status: "signed", signedSeq: 1, changes: [{ key: "paymentDays", from: 30, to: 60 }, { key: "consultantDays", from: 14, to: 21 }] })
    seed("projects/p1/pmCertificates/01", { seq: 1, status, prep: "qs1", prepOn: "2026-09-01", gross: 200_000, recovery: 20_000, retention: 20_000, vat: 27_000, net: 187_000, terms, contractValue: 1_000_000, lines: [], cutsIncluded: 0 })
  }
  const plus = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

  it("going to the consultant sets the expected due date: his period + the payment period, both in force", async () => {
    seedCert("int")
    await approveCertificate(db, pm, "p1", pmA, 1)
    expect((readDoc<PmCertificate>("projects/p1/pmCertificates/01") as PmCertificate).expDue).toBe(plus(todayDay(), 81))
  })

  it("certification dates the payment by the payment period in force today, not the prepared one", async () => {
    seedCert("sub")
    await certifyCertificate(db, pm, "p1", pmA, 1, { certified: 200_000 })
    expect((readDoc<PmCertificate>("projects/p1/pmCertificates/01") as PmCertificate).dueOn).toBe(plus(todayDay(), 60))
  })

  it("an 'other' deduction is refused without its words (RSN-01)", async () => {
    seedCert("sub")
    await expect(certifyCertificate(db, pm, "p1", pmA, 1, { certified: 150_000, reason: "oth" })).rejects.toMatchObject({ blocks: ["cut_text"] })
  })
})

const TODAY = "2026-10-25"
const base: DecisionFacts = {
  lifecycle: "live",
  managerless: false,
  startOn: "2026-01-01",
  plannedStart: "2026-01-01",
  durationDays: 300,
  baseValue: 1_000_000,
  terms,
  acceptances: {},
  items: [{ id: "i1", code: "03-01", quantity: 100, rate: 10_000, executed: 90, billed: 90 }],
  sheets: [],
  addenda: [],
  certificates: [],
  punch: [],
  variations: [],
  claims: [],
  eac: { on: "2026-10-20" },
  today: TODAY,
}
const find = (f: Partial<DecisionFacts>, k: string) => projectDecisions({ ...base, ...f }).find((d) => d.kind === k)
const viewer = (keys: string[], owner = false) => ({ uid: "u1", has: (k: string) => keys.includes(k), owner })

describe("CP-13 — the consultant decisions", () => {
  const sub = (apprOn: string) => ({ status: "sub" as const, net: 1000, apprOn, prepOn: "2026-09-01" })
  it("a certificate with him is a decision only past his period: amber, red past twice it, in the money group", () => {
    expect(find({ certificates: [sub("2026-10-15")] }, "cert_consultant")).toBeUndefined()
    expect(find({ certificates: [sub("2026-10-05")], consultant: "دار" }, "cert_consultant")).toMatchObject({ severity: "amber", age: 20, vars: { days: 14, link: "unsent" }, detail: "detail_unsent" })
    expect(find({ certificates: [sub("2026-09-20")], consultant: "دار", portal: { sentOn: "2026-09-21", seenOn: null } }, "cert_consultant")).toMatchObject({ severity: "red", detail: "detail_sent", tab: "pmCorr" })
    expect(find({ certificates: [sub("2026-10-05")] }, "cert_consultant")).toMatchObject({ detail: "detail_letter", tab: "ipc" })
    expect(find({ certificates: [sub("2026-10-05")], viewer: viewer(["approve"]) }, "cert_consultant")).toBeUndefined()
  })

  it("a link sent three days ago and never opened, while something waits on him, is the approver's decision", () => {
    const portal = { sentOn: "2026-10-22", seenOn: null }
    expect(find({ portal, portalWaiting: 2, viewer: viewer(["approve"]) }, "portal_unopened")).toMatchObject({ severity: "amber", count: 2, age: 3 })
    expect(find({ portal: { sentOn: "2026-10-23", seenOn: null }, portalWaiting: 2 }, "portal_unopened")).toBeUndefined()
    expect(find({ portal: { ...portal, seenOn: "2026-10-23" }, portalWaiting: 2 }, "portal_unopened")).toBeUndefined()
    expect(find({ portal, portalWaiting: 0 }, "portal_unopened")).toBeUndefined()
    expect(find({ portal, portalWaiting: 2, viewer: viewer(["measure", "money"]) }, "portal_unopened")).toBeUndefined()
  })
})

describe("DEC-01 — each decision reaches its duty, and only while its section is on (FX-59…62)", () => {
  const obstacles = [{ id: "o1", type: "rfi", closeOn: null, itemIds: ["i1"], openOn: "2026-10-01" }] as unknown as DecisionFacts["obstacles"]
  it("an obstacle that blocks an item reaches daily | approve, and goes with the rfi section", () => {
    expect(find({ obstacles, viewer: viewer(["daily"]) }, "obstacle_blocking")).toBeDefined()
    expect(find({ obstacles, viewer: viewer(["money", "prep", "hse"]) }, "obstacle_blocking")).toBeUndefined()
    expect(find({ obstacles, sections: ["contract", "procure", "claim"] }, "obstacle_blocking")).toBeUndefined()
    expect(find({ obstacles, sections: ["contract", "procure", "rfi"] }, "obstacle_blocking")).toBeDefined()
  })

  it("a request awaiting approval is the approver's, not the requester's", () => {
    const requests = [{ id: "r1", title: "Cement", status: "pending", requestedByUserId: "se1", day: "2026-10-20", lines: [{ itemId: "i1", code: "03-01", key: "k", name: "Cement", unit: "bag", qty: 1 }] }] as unknown as DecisionFacts["requests"]
    expect(find({ requests, viewer: viewer(["req"]) }, "req_waiting")).toBeUndefined()
    expect(find({ requests, viewer: viewer(["approve"]) }, "req_waiting")).toBeDefined()
  })

  it("plant decisions reach whoever runs the plant (req | daily | approve), and go with the eqp section", () => {
    const plant = [{ status: "on", to: "2026-10-01", days: 10, dayRate: 100, category: "heavy", qty: 1, licenceTo: null, offOk: false }] as unknown as DecisionFacts["plant"]
    expect(find({ plant, viewer: viewer(["req"]) }, "eqp_overdue")).toBeDefined()
    expect(find({ plant, viewer: viewer(["money", "prep", "hse"]) }, "eqp_overdue")).toBeUndefined()
  })

  it("re-rating lives with variations: switching vo off silences it", () => {
    const f = { terms: { ...terms, basis: "rem" as const }, items: [{ id: "i1", quantity: 100, rate: 10, executed: 200 }] }
    expect(find(f, "rerate")).toBeDefined()
    expect(find({ ...f, sections: ["contract", "procure", "claim"] }, "rerate")).toBeUndefined()
    expect(find({ ...f, sections: ["contract", "procure", "claim", "vo"] }, "rerate")).toBeDefined()
  })
})

describe("COR-01 — a late letter: ours to answer is red, theirs to answer amber", () => {
  const letter = (dir: "in" | "out") => ({ status: dir === "in" ? ("in" as const) : ("out" as const), day: "2026-10-01", due: 7, party: "cons" as const, dir })
  it("by direction, not by party", () => {
    expect(find({ letters: [letter("out")] }, "letters_late")?.severity).toBe("amber")
    expect(find({ letters: [letter("in")] }, "letters_late")).toMatchObject({ severity: "red", detail: "detail_in" })
  })
})
