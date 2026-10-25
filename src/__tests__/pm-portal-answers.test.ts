/**
 * @jest-environment node
 *
 * PM 1.1 — the consultant portal's money and time answers (CP-06/07/08/09),
 * his refusals (PN-04 / NCR-02), the link tied to the project's representative
 * (PRJ-01, CP-02/03) and the hashed token. One planner per answer, run by the
 * internal write and by the portal's Admin transaction alike, so his reply has
 * exactly the effect of his letter — and only one of the two doors counts.
 */

jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "SERVER_TS" } }))

import type { Firestore } from "firebase-admin/firestore"
import { LINK_COLLECTIONS } from "@/lib/links/hash"
import { expectedDue, planCertify, planRefuseFix, planRejectPlan, planRespond, type CertifiableCertificate } from "@/lib/pm/consultant-answers"
import { portalItems, portalLinkState } from "@/lib/pm/consultant-portal"
import { planSend, repChangeRevokes } from "@/lib/pm/consultant-portal-server"
import {
  answerBody,
  applyPortalAnswer,
  consultantBody,
  filesAllowed,
  planAnswer,
  portalView,
  type PmPortalLink,
  type PortalSourceDocs,
} from "@/lib/pm/portal-links"
import { defaultTerms } from "@/lib/pm/terms"

const NOW = Date.UTC(2026, 9, 25, 9, 0, 0)
const TODAY = "2026-10-25"
const terms = { ...defaultTerms({ advance: 0.1, retention: 0.1 }), retentionCap: 0.05, paymentDays: 30, consultantDays: 14 }

const cert = (over: Partial<CertifiableCertificate> = {}): CertifiableCertificate => ({
  seq: 3,
  status: "sub",
  terms,
  contractValue: 1_000_000,
  gross: 200_000,
  recovery: 20_000,
  retention: 20_000,
  vat: 27_000,
  net: 187_000,
  ...over,
})
const certCtx = (over: Record<string, unknown> = {}) => ({
  today: TODAY,
  nowIso: new Date(NOW).toISOString(),
  actor: { by: "portal:L1", byName: "م. سامي" },
  viaPortal: true,
  organizationId: "O",
  projectId: "P",
  projectNo: "PJ-2026/014",
  totals: { retentionHeld: 20_000, advanceRecovered: 20_000, cutPool: 0 },
  termsNow: { paymentDays: 45 },
  ...over,
})

describe("planCertify — one planner for both doors (CP-08, IPC-03, IPC-06)", () => {
  it("recomputes on the certified value, returns the cut to unbilled, sends prj:IPC at the certified amount", () => {
    const r = planCertify(cert(), { certified: 180_000, reason: "qty", consultantRef: " C-114 " }, certCtx())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.cut).toBe(20_000)
    expect(r.plan.certPatch).toMatchObject({ status: "appr", certified: 180_000, cut: 20_000, cutReason: "qty", consultantRef: "C-114", certBy: "portal:L1", certByName: "م. سامي", viaPortal: true, certOn: TODAY })
    expect(r.plan.pmTotals).toEqual({ retentionHeld: 18_000, advanceRecovered: 18_000, cutPool: 20_000 })
    expect(r.plan.event).toMatchObject({ key: "prj:IPC:PJ-2026/014:03", kind: "IPC", amount: 180_000, by: "portal:L1" })
  })

  it("dates the payment from the contract IN FORCE on certification day, not the one it was prepared under (IPC-06)", () => {
    const r = planCertify(cert(), { certified: 200_000 }, certCtx({ termsNow: { paymentDays: 45 } }))
    expect(r.ok && r.plan.dueOn).toBe("2026-12-09")
    expect(r.ok && r.plan.event.params.due).toBe("2026-12-09")
  })

  it("a deduction above one riyal names a reason, and 'other' says which; up to a riyal asks nothing", () => {
    expect(planCertify(cert(), { certified: 199_999.5 }, certCtx()).ok).toBe(true)
    expect(planCertify(cert(), { certified: 199_998 }, certCtx())).toEqual({ ok: false, code: "BLOCKED", blocks: ["cut_reason"] })
    expect(planCertify(cert(), { certified: 190_000, reason: "oth" }, certCtx())).toEqual({ ok: false, code: "BLOCKED", blocks: ["cut_text"] })
    const r = planCertify(cert(), { certified: 190_000, reason: "oth", reasonNote: " بند خارج النطاق " }, certCtx())
    expect(r.ok && r.plan.certPatch).toMatchObject({ cutReason: "oth", cutNote: "بند خارج النطاق" })
    expect(planCertify(cert(), { certified: 200_001 }, certCtx())).toEqual({ ok: false, code: "BLOCKED", blocks: ["over_gross"] })
  })

  it("a certificate no longer with him is not waiting — whichever door came first wins (CP-09)", () => {
    expect(planCertify(cert({ status: "appr" }), { certified: 200_000 }, certCtx())).toEqual({ ok: false, code: "NOT_WAITING" })
  })

  it("the expected due date when it goes to him: his period + the payment period (IPC-06)", () => {
    expect(expectedDue("2026-10-01", { consultantDays: 14, paymentDays: 30 })).toBe("2026-11-14")
  })
})

describe("planRespond — the claim (CP-08, CLM-02/03)", () => {
  it("granted days issue the next programme revision; a rejection none", () => {
    const ctx = { today: TODAY, actor: { by: "portal:L1", byName: "م. سامي" }, viaPortal: true, archived: false, programmeRev: 2 }
    const r = planRespond({ status: "sub", kind: "time" }, { response: "part", days: 10, amount: null, ref: "L-9" }, ctx)
    expect(r.ok && r.plan.revision).toBe(3)
    expect(r.ok && r.plan.claimPatch).toMatchObject({ status: "part", revision: 3, response: { days: 10, amount: 0, ref: "L-9", viaPortal: true, byName: "م. سامي" } })
    const rej = planRespond({ status: "sub", kind: "both" }, { response: "rej", days: null, amount: null }, ctx)
    expect(rej.ok && rej.plan.revision).toBeNull()
    expect(planRespond({ status: "sub", kind: "time" }, { response: "appr", days: null, amount: null }, ctx)).toEqual({ ok: false, code: "BLOCKED", blocks: ["days_required"] })
    expect(planRespond({ status: "appr", kind: "time" }, { response: "appr", days: 3, amount: null }, ctx)).toEqual({ ok: false, code: "NOT_WAITING" })
  })
})

describe("his refusals from his letter (PN-04 / NCR-02)", () => {
  const ctx = { today: TODAY, actor: { by: "qa1", byName: "سارة" }, viaPortal: false, archived: false }
  it("a refused fix goes back open, the refused fix and the recorder kept", () => {
    const fix = { on: "2026-10-20", by: "se1", note: "أعيدت" }
    const r = planRefuseFix({ status: "fix", source: "cons", day: "2026-10-01", fix }, " لم يُعالج ", ctx)
    expect(r).toEqual({ ok: true, patch: { status: "open", fix: null, rejects: [{ on: TODAY, by: "qa1", byName: "سارة", note: "لم يُعالج", refused: fix, viaPortal: false, recordedOn: TODAY }] } })
    expect(planRefuseFix({ status: "fix", source: "cons", day: "2026-10-01", fix }, "  ", ctx)).toEqual({ ok: false, code: "BLOCKED", blocks: ["no_note"] })
    expect(planRefuseFix({ status: "fix", source: "own", day: "2026-10-01", fix }, "x", ctx)).toEqual({ ok: false, code: "NOT_WAITING" })
  })
  it("a rejected plan reopens the NCR for a new plan", () => {
    const plan = { on: "2026-10-22", text: "إعادة الصب" }
    const r = planRejectPlan({ status: "plan", day: "2026-10-01", plan }, "لا يعالج السبب", ctx)
    expect(r.ok && r.patch).toMatchObject({ status: "open", plan: null, rejects: [{ note: "لا يعالج السبب", refused: plan, viaPortal: false }] })
    expect(planRejectPlan({ status: "open", day: "2026-10-01" }, "x", ctx)).toEqual({ ok: false, code: "NOT_WAITING" })
  })
})

describe("the seven sources, by section (CP-06)", () => {
  const base = {
    submittals: [{ seq: 1, status: "sub", day: "2026-10-01", title: "بلاط" }],
    inspections: [],
    punch: [],
    letters: [],
    ncrs: [{ seq: 1, status: "plan", day: "2026-10-02", title: "تعشيش" }],
    certificates: [{ seq: 4, status: "sub", apprOn: "2026-10-03" }, { seq: 3, status: "appr", apprOn: "2026-09-01" }],
    claims: [{ seq: 2, status: "sub", submittedOn: "2026-10-04", cause: "تأخر التسليم" }],
  }
  it("certificates and claims submitted to him join the five, oldest first", () => {
    expect(portalItems(base).map((x) => `${x.kind}:${x.no}`)).toEqual(["subm:01", "ncr:01", "ipc:04", "claim:02"])
  })
  it("a section that is off takes its source off his page", () => {
    expect(portalItems({ ...base, sections: ["contract", "procure", "subm", "claim"] }).map((x) => x.kind)).toEqual(["subm", "claim"])
  })
})

describe("what he sees of a certificate and a claim (CP-11/12)", () => {
  const src: PortalSourceDocs = {
    submittals: [],
    inspections: [],
    punch: [],
    letters: [],
    ncrs: [],
    certificates: [
      {
        id: "04",
        seq: 4,
        status: "sub",
        lines: [{ itemId: "L1", code: "03-01", qty: 10, rate: 500, amount: 5000 }],
        voLines: [{ voId: "v1", seq: 2, title: "زيادة", value: 9000, from: 0, to: 0.5, amount: 4500 }],
        cutsIncluded: 500,
        gross: 10_000,
        recovery: 987_654,
        retention: 123_456,
        vat: 1,
        net: 1,
        terms,
        contractValue: 555_555,
        prep: "u",
        prepOn: "2026-10-01",
        apprOn: "2026-10-03",
      } as unknown as NonNullable<PortalSourceDocs["certificates"]>[number],
    ],
    claims: [{ id: "02", seq: 2, kind: "both", cause: "تأخر", eventOn: "2026-09-01", daysAsked: 20, amountAsked: 777_777, status: "sub", by: "u", submittedOn: "2026-10-04" }],
    lines: { L1: { itemNo: "03-01", descriptionAr: "بلاط", descriptionEn: "Tiles", unit: "م2", unitPrice: 500, estCost: 333_333 } },
  }
  it("lines with rates and amounts summing to the gross — never cost, retention, recovery or the claim's amount", () => {
    const view = portalView(src, TODAY)
    const ipc = view.find((x) => x.kind === "ipc")?.detail
    expect(ipc).toMatchObject({ kind: "ipc", gross: 10_000, cuts: 500, consultantDays: 14, lines: [{ code: "03-01", descriptionAr: "بلاط", qty: 10, rate: 500, amount: 5000 }] })
    if (ipc?.kind === "ipc") expect(ipc.lines.reduce((a, l) => a + l.amount, 0) + ipc.voLines.reduce((a, l) => a + l.amount, 0) + ipc.cuts).toBe(ipc.gross)
    const json = JSON.stringify(view)
    for (const n of ["987654", "123456", "555555", "333333", "777777"]) expect(json).not.toContain(n)
    expect(view.find((x) => x.kind === "claim")?.detail).toMatchObject({ claimKind: "both", daysAsked: 20 })
  })
})

describe("the answer bodies and files", () => {
  it("accept a certification and a claim response; files only from his own uploads", () => {
    expect(answerBody.safeParse({ kind: "ipc", seq: 1, certified: 100, reason: "oth", reasonNote: "x" }).success).toBe(true)
    expect(answerBody.safeParse({ kind: "ipc", seq: 1, certified: -1 }).success).toBe(false)
    expect(answerBody.safeParse({ kind: "claim", seq: 1, response: "part", days: 5 }).success).toBe(true)
    expect(answerBody.safeParse({ kind: "claim", seq: 1, response: "maybe" }).success).toBe(false)
    expect(filesAllowed([{ url: "https://x/a" }], [{ url: "https://x/a", name: "a", path: "p", at: "t" }])).toBe(true)
    expect(filesAllowed([{ url: "https://evil/b" }], [{ url: "https://x/a", name: "a", path: "p", at: "t" }])).toBe(false)
  })

  it("an attached file travels with his answer", () => {
    const r = planAnswer(
      { kind: "subm", seq: 1, decision: "appA", files: [{ url: "https://x/a.pdf", name: "a.pdf" }] },
      { seq: 1, status: "sub", day: "2026-10-01", itemId: "L1" },
      { today: TODAY, nowIso: "t", actor: { by: "portal:L1", byName: "م" } }
    )
    expect(r.ok && (r.plan.patch.reply as { files: unknown[] }).files).toEqual([{ url: "https://x/a.pdf", name: "a.pdf" }])
  })
})

describe("the representative and the link (PRJ-01, CP-02/03)", () => {
  it("the details accept a Saudi mobile in either form and an e-mail; the route refuses anything else", () => {
    expect(consultantBody.safeParse({ projectId: "P", consultant: "دار", repName: "سامي", repPhone: "0501234567", repEmail: "" }).success).toBe(true)
    expect(consultantBody.safeParse({ projectId: "P", consultant: "دار", repName: "سامي", repPhone: "", repEmail: "not-an-email" }).success).toBe(false)
  })

  it("a new representative or mobile, or removing the consultant, revokes; an e-mail does not", () => {
    const before = { consultant: "دار", rep: { name: "سامي", phone: "+966501234567", email: null } }
    expect(repChangeRevokes(before, { consultant: "دار", rep: { name: "سامي", phone: "+966501234567", email: "s@x.sa" } })).toBeNull()
    expect(repChangeRevokes(before, { consultant: "دار", rep: { name: "سامي", phone: "+966509999999", email: null } })).toBe("rep_changed")
    expect(repChangeRevokes(before, { consultant: "دار", rep: { name: "خالد", phone: "+966501234567", email: null } })).toBe("rep_changed")
    expect(repChangeRevokes(before, { consultant: null, rep: null })).toBe("consultant_removed")
  })

  it("a resend reuses the live link to the same mobile; a new mobile makes a new one and revokes the rest", () => {
    const link = (over: Partial<PmPortalLink>): PmPortalLink => ({ projectId: "P", organizationId: "O", consultant: { name: "س", phone: "+966501234567" }, status: "open", createdById: "u", createdByName: "u", createdAt: "2026-10-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z", ...over })
    const links = [{ id: "A", link: link({}) }, { id: "B", link: link({ status: "revoked" }) }]
    expect(planSend(links, "+966501234567", NOW)).toEqual({ reuse: "A", revoke: [] })
    expect(planSend(links, "+966509999999", NOW)).toEqual({ reuse: null, revoke: ["A"] })
    expect(planSend([{ id: "A", link: link({ expiresAt: "2026-01-01T00:00:00Z" }) }], "+966501234567", NOW)).toEqual({ reuse: null, revoke: ["A"] })
  })

  it("the portal token is hashed in the shared index like every other link", () => {
    expect(LINK_COLLECTIONS.pm).toBe("pmPortalLinks")
  })

  it("the link state the certificate decision states", () => {
    expect(portalLinkState({ consultant: null })).toBe("letter")
    expect(portalLinkState({ consultant: "دار", portal: null })).toBe("unsent")
    expect(portalLinkState({ consultant: "دار", portal: { sentOn: TODAY, seenOn: null } })).toBe("sent")
    expect(portalLinkState({ consultant: "دار", portal: { sentOn: TODAY, seenOn: TODAY } })).toBe("seen")
  })
})

describe("applyPortalAnswer — a certification through the portal (CP-08)", () => {
  type Doc = Record<string, unknown>
  function fakeDb(store: Map<string, Doc>) {
    const writes: Array<{ op: string; path: string; patch: Doc }> = []
    type Query = { path: string; field: string; value: unknown }
    type Coll = { doc: (id: string) => Ref; where: (field: string, op: string, value: unknown) => Query }
    type Ref = { path: string; collection: (n: string) => Coll }
    const ref = (path: string): Ref => ({
      path,
      collection: (n: string) => ({ doc: (id: string) => ref(`${path}/${n}/${id}`), where: (field: string, _op: string, value: unknown) => ({ path: `${path}/${n}`, field, value }) }),
    })
    const db = {
      collection: (n: string) => ({ doc: (id: string) => ref(`${n}/${id}`) }),
      runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
        fn({
          get: async (r: { path: string; field?: string; value?: unknown }) =>
            r.field
              ? { docs: [...store.entries()].filter(([k, v]) => k.startsWith(`${r.path}/`) && k.split("/").length === r.path.split("/").length + 1 && v[r.field as string] === r.value).map(([, v]) => ({ data: () => v })) }
              : { exists: store.has(r.path), data: () => store.get(r.path) },
          update: (r: { path: string }, patch: Doc) => writes.push({ op: "update", path: r.path, patch }),
          set: (r: { path: string }, patch: Doc) => writes.push({ op: "set", path: r.path, patch }),
        }),
    }
    return { db: db as unknown as Firestore, writes }
  }
  const link: PmPortalLink = {
    projectId: "P",
    organizationId: "O",
    consultant: { name: "م. سامي", phone: "+966500000000" },
    status: "open",
    createdById: "u1",
    createdByName: "مالك",
    createdAt: new Date(NOW - 1e6).toISOString(),
    expiresAt: new Date(NOW + 1e9).toISOString(),
    history: [],
    uploads: [{ url: "https://x/cert.pdf", name: "cert.pdf", path: "p", at: "t" }],
  }
  const project = (over: Doc = {}) => ({ organizationId: "O", name: "النرجس", projectManagerId: "pm1", pm: { lifecycle: "live", no: "PJ-2026/014", original: terms, terms, addendaCount: 1, retentionHeld: 20_000, advanceRecovered: 20_000, cutPool: 0 }, ...over })
  const certDoc = { ...cert(), seq: 3, apprOn: "2026-10-01", prepOn: "2026-09-30" }

  it("writes the certificate, the project's totals and one prj:IPC — dated by the signed addendum's payment period", async () => {
    const store = new Map<string, Doc>([
      ["pmPortalLinks/L1", link as unknown as Doc],
      ["projects/P", project()],
      ["projects/P/pmCertificates/03", certDoc as unknown as Doc],
      ["projects/P/pmAddenda/01", { status: "signed", signedSeq: 1, changes: [{ key: "paymentDays", from: 30, to: 60 }] }],
    ])
    const { db, writes } = fakeDb(store)
    const out = await applyPortalAnswer(db, "L1", { kind: "ipc", seq: 3, certified: 180_000, reason: "qty", files: [{ url: "https://x/cert.pdf", name: "cert.pdf" }] }, NOW)
    expect(out.event).toMatchObject({ key: "prj:IPC:PJ-2026/014:03", amount: 180_000 })
    const certW = writes.find((w) => w.path === "projects/P/pmCertificates/03")?.patch
    expect(certW).toMatchObject({ status: "appr", certified: 180_000, cut: 20_000, dueOn: "2026-12-24", viaPortal: true, certFiles: [{ url: "https://x/cert.pdf", name: "cert.pdf" }] })
    expect((writes.find((w) => w.path === "projects/P")?.patch.pm as Doc).cutPool).toBe(20_000)
    expect(writes.find((w) => w.op === "set" && w.path === "pmEvents/O__prj:IPC:PJ-2026_014:03")).toBeDefined()
    expect(out.entry).toMatchObject({ kind: "ipc", no: "03", what: "certified" })
  })

  it("refuses a file he did not upload, a section switched off, and a certificate already certified by letter", async () => {
    const base = () => new Map<string, Doc>([["pmPortalLinks/L1", link as unknown as Doc], ["projects/P", project()], ["projects/P/pmCertificates/03", certDoc as unknown as Doc]])
    await expect(applyPortalAnswer(fakeDb(base()).db, "L1", { kind: "ipc", seq: 3, certified: 1, files: [{ url: "https://evil/x", name: "x" }] }, NOW)).rejects.toMatchObject({ code: "BLOCKED", blocks: ["bad_file"] })
    const off = base()
    off.set("projects/P", project({ enabledSections: ["contract", "procure", "corr"] }))
    await expect(applyPortalAnswer(fakeDb(off).db, "L1", { kind: "ipc", seq: 3, certified: 200_000 }, NOW)).rejects.toMatchObject({ code: "NOT_WAITING" })
    const done = base()
    done.set("projects/P/pmCertificates/03", { ...certDoc, status: "appr" } as unknown as Doc)
    const f = fakeDb(done)
    await expect(applyPortalAnswer(f.db, "L1", { kind: "ipc", seq: 3, certified: 200_000 }, NOW)).rejects.toMatchObject({ code: "NOT_WAITING" })
    expect(f.writes).toEqual([])
  })

  it("a claim response through the portal issues the programme revision", async () => {
    const store = new Map<string, Doc>([
      ["pmPortalLinks/L1", link as unknown as Doc],
      ["projects/P", project({ pm: { lifecycle: "live", no: "PJ-2026/014", terms, programmeRev: 1 } })],
      ["projects/P/pmClaims/02", { seq: 2, kind: "time", status: "sub", cause: "تأخر", eventOn: "2026-09-01", daysAsked: 20, amountAsked: 0 }],
    ])
    const { db, writes } = fakeDb(store)
    await applyPortalAnswer(db, "L1", { kind: "claim", seq: 2, response: "appr", days: 20 }, NOW)
    expect((writes.find((w) => w.path === "projects/P")?.patch.pm as Doc).programmeRev).toBe(2)
    expect(writes.find((w) => w.path === "projects/P/pmClaims/02")?.patch).toMatchObject({ status: "appr", revision: 2 })
  })

  it("an inspection result moves the BOQ line only from the item's newest inspection (MS-03, 1.1)", async () => {
    const store = new Map<string, Doc>([
      ["pmPortalLinks/L1", link as unknown as Doc],
      ["projects/P", project()],
      ["projects/P/pmInspections/01", { seq: 1, itemId: "L2", unit: "V1", party: "consultant", status: "open", location: "الدور الأول", attempts: [{ n: 1, on: "2026-10-20" }] }],
      ["projects/P/pmInspections/02", { seq: 2, itemId: "L2", unit: "V2", party: "consultant", status: "open", location: "الدور الثاني", attempts: [{ n: 1, on: "2026-10-21" }] }],
      ["projects/P/boqItems/L2", { itemNo: "04-02", pmWir: "open", pmWirByUnit: { V2: "open" } }],
    ])
    const older = fakeDb(store)
    await applyPortalAnswer(older.db, "L1", { kind: "wir", seq: 1, result: "pass", on: "2026-10-24" }, NOW)
    expect(older.writes.find((w) => w.path === "projects/P/boqItems/L2")?.patch).toMatchObject({ pmWirByUnit: { V2: "open", V1: "pass" } })
    expect(older.writes.find((w) => w.path === "projects/P/boqItems/L2")?.patch.pmWir).toBeUndefined()
    const newest = fakeDb(store)
    await applyPortalAnswer(newest.db, "L1", { kind: "wir", seq: 2, result: "fail", note: "تعشيش", on: "2026-10-24" }, NOW)
    expect(newest.writes.find((w) => w.path === "projects/P/boqItems/L2")?.patch).toMatchObject({ pmWir: "fail", pmWirByUnit: { V2: "fail" } })
  })
})
