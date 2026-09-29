/**
 * @jest-environment node
 *
 * The PM consultant portal (PM 1.0, the prototype's بوابة الاستشاري). What
 * must hold: a session is a hashed secret with an expiry, the answer bodies
 * accept exactly the five answers, what he sees never carries money, and an
 * answer to a record that no longer waits on him is refused — also inside the
 * transaction that writes it.
 */

jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "SERVER_TS" } }))

import {
  PORTAL_MAX_SESSIONS,
  PORTAL_SESSION_TTL_MS,
  PortalAnswerError,
  addSession,
  answerBody,
  applyPortalAnswer,
  hashSecret,
  linkRefusal,
  mayManagePortal,
  newSessionSecret,
  planAnswer,
  portalView,
  projectRefusal,
  riyadhDay,
  sessionValid,
  type PmPortalLink,
  type PortalAnswer,
  type PortalSourceDocs,
} from "@/lib/pm/portal-links"
import type { Firestore } from "firebase-admin/firestore"

const NOW = Date.UTC(2026, 8, 29, 10, 0, 0)
const TODAY = "2026-09-29"
const ctx = { today: TODAY, nowIso: new Date(NOW).toISOString(), actor: { by: "portal:L1", byName: "م. سامي" } }

describe("sessions", () => {
  it("stores only a hash of the secret, and the hash is stable", () => {
    const secret = newSessionSecret()
    expect(secret).toMatch(/^[a-f0-9]{64}$/)
    expect(hashSecret(secret)).toBe(hashSecret(secret))
    expect(hashSecret(secret)).not.toBe(secret)
    const { sessions } = addSession([], hashSecret(secret), NOW)
    expect(JSON.stringify(sessions)).not.toContain(secret)
  })

  it("opens for the live secret only, and never after it expires", () => {
    const secret = newSessionSecret()
    const { sessions, expiresAt } = addSession(undefined, hashSecret(secret), NOW)
    expect(Date.parse(expiresAt) - NOW).toBe(PORTAL_SESSION_TTL_MS)
    expect(sessionValid(sessions, secret, NOW + 1000)).toBe(true)
    expect(sessionValid(sessions, secret, NOW + PORTAL_SESSION_TTL_MS + 1)).toBe(false)
    expect(sessionValid(sessions, newSessionSecret(), NOW)).toBe(false)
    expect(sessionValid(sessions, hashSecret(secret), NOW)).toBe(false)
    expect(sessionValid(sessions, "not-a-secret", NOW)).toBe(false)
    expect(sessionValid(sessions, null, NOW)).toBe(false)
  })

  it("drops expired sessions and keeps the newest few", () => {
    let sessions = addSession([], hashSecret(newSessionSecret()), NOW - PORTAL_SESSION_TTL_MS - 1).sessions
    sessions = addSession(sessions, hashSecret(newSessionSecret()), NOW).sessions
    expect(sessions).toHaveLength(1)
    for (let i = 0; i < PORTAL_MAX_SESSIONS + 5; i++) sessions = addSession(sessions, hashSecret(newSessionSecret()), NOW + i).sessions
    expect(sessions).toHaveLength(PORTAL_MAX_SESSIONS)
  })

  it("refuses a revoked or expired link", () => {
    expect(linkRefusal(null, NOW)).toBe("missing")
    expect(linkRefusal({ status: "revoked", expiresAt: new Date(NOW + 1e6).toISOString() }, NOW)).toBe("revoked")
    expect(linkRefusal({ status: "open", expiresAt: new Date(NOW - 1).toISOString() }, NOW)).toBe("expired")
    expect(linkRefusal({ status: "open", expiresAt: new Date(NOW + 1e6).toISOString() }, NOW)).toBeNull()
  })

  it("dates in Saudi time, whatever the server's zone", () => {
    expect(riyadhDay(Date.UTC(2026, 8, 29, 22, 0, 0))).toBe("2026-09-30")
    expect(riyadhDay(Date.UTC(2026, 8, 29, 20, 59, 0))).toBe("2026-09-29")
  })
})

describe("answer bodies", () => {
  it("accept the five answers", () => {
    const ok: unknown[] = [
      { kind: "subm", seq: 1, decision: "appB", note: "مع ملاحظة" },
      { kind: "wir", seq: 2, result: "pass", on: TODAY },
      { kind: "punch", seq: 3 },
      { kind: "corr", seq: 4, text: "موافق" },
      { kind: "ncr", seq: 5, accept: true },
    ]
    for (const body of ok) expect(answerBody.safeParse(body).success).toBe(true)
  })

  it("refuse anything else", () => {
    const bad: unknown[] = [
      { kind: "subm", seq: 1, decision: "maybe" },
      { kind: "subm", seq: 0, decision: "appA" },
      { kind: "subm", seq: 1.5, decision: "appA" },
      { kind: "wir", seq: 2, result: "pass" },
      { kind: "wir", seq: 2, result: "pass", on: "29/09/2026" },
      { kind: "corr", seq: 4, text: "   " },
      { kind: "ncr", seq: 5, accept: false },
      { kind: "boq", seq: 1, quantity: 99 },
      { kind: "punch" },
      null,
    ]
    for (const body of bad) expect(answerBody.safeParse(body).success).toBe(false)
  })

  it("carry nothing but the answer — a quantity or price in the body is dropped", () => {
    const parsed = answerBody.parse({ kind: "subm", seq: 1, decision: "appA", unitPrice: 5, quantity: 10 })
    expect(parsed).toEqual({ kind: "subm", seq: 1, decision: "appA" })
  })
})

const MONEY_KEYS = ["unitPrice", "estCost", "cost", "amount", "price", "budget", "total", "supplier", "margin"]

function sources(): PortalSourceDocs {
  return {
    submittals: [
      { id: "01", seq: 1, itemId: "L1", code: "03-01", supplier: "مصنع السعر 987654", what: "بلاط بورسلان", rev: 1, status: "sub", day: "2026-09-10", by: "u1" },
      { id: "02", seq: 2, itemId: "L1", code: "03-01", supplier: "x", rev: 1, status: "appA", day: "2026-09-01", by: "u1" },
    ],
    inspections: [
      { id: "01", seq: 1, itemId: "L2", code: "04-02", location: "الدور الأول", party: "consultant", status: "open", attempts: [{ n: 1, on: "2026-09-20", result: null, by: "u1" }] },
      { id: "02", seq: 2, itemId: "L2", location: "السطح", party: "client", status: "open", attempts: [{ n: 1, on: "2026-09-21", result: null, by: "u1" }] },
    ],
    punch: [
      { id: "01", seq: 1, what: "شرخ", location: "غرفة 3", severity: "a", source: "cons", status: "fix", day: "2026-09-05", by: "u1", fix: { on: "2026-09-15", by: "u2", note: "أعيد اللياسة" } },
      { id: "02", seq: 2, what: "باب", location: "مدخل", severity: "b", source: "own", status: "fix", day: "2026-09-05", by: "u1", fix: { on: "2026-09-15", by: "u2" } },
    ],
    letters: [
      { id: "01", seq: 1, no: "014/001", dir: "out", party: "cons", subject: "طلب اعتماد", day: "2026-09-12", due: 7, status: "out", links: ["RFI-07"], by: "u1" },
      { id: "02", seq: 2, no: "014/001", dir: "in", party: "cons", subject: "وارد", day: "2026-09-12", due: 7, status: "in", links: [], by: "u1" },
    ],
    ncrs: [
      { id: "01", seq: 1, itemId: "L2", code: "04-02", what: "خرسانة ضعيفة", severity: "a", root: "معالجة ناقصة", cost: 987654, status: "plan", day: "2026-09-08", by: "u1", plan: { on: "2026-09-18", by: "u1", text: "كسر وإعادة الصب", cost: 123456 } },
    ],
    lines: {
      L1: { itemNo: "03-01", descriptionAr: "بلاط", descriptionEn: "Tiles", unit: "م2", unitPrice: 987654, estCost: 123456, amount: 5, budget: 1 },
      L2: { itemNo: "04-02", descriptionAr: "خرسانة", descriptionEn: "Concrete", unit: "م3", unitPrice: 987654 },
    },
  }
}

describe("what he sees", () => {
  it("lists only what waits on him, oldest first", () => {
    const view = portalView(sources(), TODAY)
    expect(view.map((x) => `${x.kind}:${x.no}`)).toEqual(["subm:01", "corr:014/001", "punch:01", "ncr:01", "wir:01"])
  })

  it("never carries a price, a cost, an amount or the supplier", () => {
    const json = JSON.stringify(portalView(sources(), TODAY))
    for (const key of MONEY_KEYS) expect(json).not.toContain(`"${key}"`)
    expect(json).not.toContain("987654")
    expect(json).not.toContain("123456")
    expect(json).toContain("كسر وإعادة الصب")
    expect(json).toContain("Concrete")
  })
})

describe("answers", () => {
  const answer = (a: PortalAnswer, record: Record<string, unknown> | null) => planAnswer(a, record, ctx)

  it("refuse a record that no longer waits on him", () => {
    expect(answer({ kind: "subm", seq: 2, decision: "appA" }, { seq: 2, status: "appA", day: "2026-09-01", itemId: "L1" })).toEqual({ ok: false, code: "NOT_WAITING" })
    expect(answer({ kind: "wir", seq: 2, result: "pass", on: TODAY }, { seq: 2, status: "open", party: "client", attempts: [{ n: 1, on: TODAY }] })).toEqual({ ok: false, code: "NOT_WAITING" })
    expect(answer({ kind: "wir", seq: 1, result: "pass", on: TODAY }, { seq: 1, status: "pass", party: "consultant", attempts: [{ n: 1, on: TODAY }] })).toEqual({ ok: false, code: "NOT_WAITING" })
    expect(answer({ kind: "punch", seq: 2 }, { seq: 2, status: "fix", source: "own", day: "2026-09-05" })).toEqual({ ok: false, code: "NOT_WAITING" })
    expect(answer({ kind: "punch", seq: 1 }, { seq: 1, status: "done", source: "cons", day: "2026-09-05" })).toEqual({ ok: false, code: "NOT_WAITING" })
    expect(answer({ kind: "corr", seq: 1, text: "نعم" }, { seq: 1, no: "014/001", dir: "out", party: "cons", status: "rep", day: "2026-09-12" })).toEqual({ ok: false, code: "NOT_WAITING" })
    expect(answer({ kind: "corr", seq: 1, text: "نعم" }, { seq: 1, no: "014/001", dir: "out", party: "own", status: "out", day: "2026-09-12" })).toEqual({ ok: false, code: "NOT_WAITING" })
    expect(answer({ kind: "ncr", seq: 1, accept: true }, { seq: 1, status: "open", day: "2026-09-08" })).toEqual({ ok: false, code: "NOT_WAITING" })
    expect(answer({ kind: "ncr", seq: 1, accept: true }, null)).toEqual({ ok: false, code: "NOT_FOUND" })
  })

  it("run the internal screens' rules", () => {
    expect(answer({ kind: "subm", seq: 1, decision: "rej" }, { seq: 1, status: "sub", day: "2026-09-10", itemId: "L1" })).toEqual({ ok: false, code: "BLOCKED", blocks: ["no_note"] })
    expect(answer({ kind: "wir", seq: 1, result: "fail", note: "تعشيش", on: "2026-09-30" }, { seq: 1, status: "open", party: "consultant", attempts: [{ n: 1, on: TODAY }] })).toEqual({
      ok: false,
      code: "BLOCKED",
      blocks: ["bad_date"],
    })
    expect(answer({ kind: "wir", seq: 1, result: "cond", on: TODAY }, { seq: 1, status: "open", party: "consultant", attempts: [{ n: 1, on: TODAY }] })).toEqual({ ok: false, code: "BLOCKED", blocks: ["no_note"] })
  })

  it("record a sample decision in his name and move the BOQ line's gate", () => {
    const r = answer({ kind: "subm", seq: 1, decision: "appB", note: "بلون أفتح" }, { seq: 1, status: "sub", day: "2026-09-10", itemId: "L1", what: "بلاط" })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.patch).toEqual({ status: "appB", reply: { on: TODAY, by: "portal:L1", byName: "م. سامي", note: "بلون أفتح", files: [], recordedOn: TODAY, viaPortal: true } })
    expect(r.plan.line).toEqual({ itemId: "L1", patch: { pmSub: "appB" } })
    expect(r.plan.entry).toEqual({ kind: "subm", no: "01", title: "بلاط", what: "appB" })
  })

  it("record an inspection result on the current attempt and move the line's pmWir", () => {
    const r = answer(
      { kind: "wir", seq: 1, result: "pass", on: "2026-09-28" },
      { seq: 1, status: "open", party: "consultant", itemId: "L2", location: "الدور الأول", attempts: [{ n: 1, on: "2026-09-01", result: "fail" }, { n: 2, on: "2026-09-20", result: null }] }
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const attempts = r.plan.patch.attempts as Array<Record<string, unknown>>
    expect(attempts[0]).toEqual({ n: 1, on: "2026-09-01", result: "fail" })
    expect(attempts[1]).toMatchObject({ n: 2, result: "pass", rOn: "2026-09-28", rByName: "م. سامي", viaPortal: true })
    expect(r.plan.patch.status).toBe("pass")
    expect(r.plan.line).toEqual({ itemId: "L2", patch: { pmWir: "pass" } })
  })

  it("confirm a punch item as the consultant, reply to a letter, accept a plan", () => {
    const p = answer({ kind: "punch", seq: 1 }, { seq: 1, status: "fix", source: "cons", day: "2026-09-05", fix: { on: "2026-09-15" }, what: "شرخ" })
    expect(p.ok && p.plan.patch).toEqual({ status: "done", conf: { on: TODAY, by: "portal:L1", byName: "م. سامي", party: "cons", partyText: null, files: [], viaPortal: true } })
    const c = answer({ kind: "corr", seq: 1, text: " موافق " }, { seq: 1, no: "014/001", dir: "out", party: "cons", status: "out", day: "2026-09-12", subject: "طلب" })
    expect(c.ok && c.plan.patch).toEqual({ status: "rep", reply: { text: "موافق", on: TODAY, by: "portal:L1", byName: "م. سامي", file: null, viaPortal: true } })
    const n = answer({ kind: "ncr", seq: 1, accept: true }, { seq: 1, status: "plan", day: "2026-09-08", plan: { on: "2026-09-18", text: "x" }, root: "r" })
    expect(n.ok && n.plan.patch).toMatchObject({ status: "done", accepted: { on: TODAY, cost: null, viaPortal: true } })
  })
})

describe("the project and who sends", () => {
  it("refuses a closed project, another company's, or a legacy one", () => {
    expect(projectRefusal({ organizationId: "O", pm: { lifecycle: "closed" } }, "O")).toBe("PROJECT_CLOSED")
    expect(projectRefusal({ organizationId: "X", pm: { lifecycle: "live" } }, "O")).toBe("NOT_FOUND")
    expect(projectRefusal({ organizationId: "O" }, "O")).toBe("NOT_PM_PROJECT")
    expect(projectRefusal(undefined, "O")).toBe("NOT_FOUND")
    expect(projectRefusal({ organizationId: "O", pm: { lifecycle: "live" } }, "O")).toBeNull()
  })

  it("lets the owner / pm.manage and the project's manager send", () => {
    expect(mayManagePortal({ uid: "u", can: () => true }, { projectManagerId: null })).toBe(true)
    expect(mayManagePortal({ uid: "pm", can: () => false }, { projectManagerId: "pm" })).toBe(true)
    expect(mayManagePortal({ uid: "x", can: () => false }, { projectManagerId: "pm" })).toBe(false)
    expect(mayManagePortal({ uid: "x", can: () => false }, { projectManagerId: null })).toBe(false)
  })
})

describe("applyPortalAnswer — the transaction re-reads and refuses", () => {
  type Doc = Record<string, unknown>
  function fakeDb(store: Map<string, Doc>) {
    const updates: Array<{ path: string; patch: Doc }> = []
    type Ref = { path: string; collection: (n: string) => { doc: (id: string) => Ref } }
    const ref = (path: string): Ref => ({
      path,
      collection: (n: string) => ({ doc: (id: string) => ref(`${path}/${n}/${id}`) }),
    })
    const db = {
      collection: (n: string) => ({ doc: (id: string) => ref(`${n}/${id}`) }),
      runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
        fn({
          get: async (r: { path: string }) => ({ exists: store.has(r.path), data: () => store.get(r.path) }),
          update: (r: { path: string }, patch: Doc) => updates.push({ path: r.path, patch }),
        }),
    }
    return { db: db as unknown as Firestore, updates }
  }

  const link: PmPortalLink = {
    token: "t".repeat(64),
    projectId: "P",
    organizationId: "O",
    consultant: { name: "م. سامي", phone: "+966500000000" },
    status: "open",
    createdById: "u1",
    createdByName: "مالك",
    createdAt: new Date(NOW - 1e6).toISOString(),
    expiresAt: new Date(NOW + 1e9).toISOString(),
    history: [],
  }

  it("writes the record, the line and the history in one go", async () => {
    const store = new Map<string, Doc>([
      ["pmPortalLinks/L1", link as unknown as Doc],
      ["projects/P", { organizationId: "O", name: "النرجس", projectManagerId: "pm1", pm: { lifecycle: "live", no: "PJ-2026/014" } }],
      ["projects/P/pmSubmittals/01", { seq: 1, status: "sub", day: "2026-09-10", itemId: "L1", what: "بلاط" }],
      ["projects/P/boqItems/L1", { itemNo: "03-01" }],
    ])
    const { db, updates } = fakeDb(store)
    const out = await applyPortalAnswer(db, "L1", { kind: "subm", seq: 1, decision: "appA" }, NOW)
    expect(out.entry).toMatchObject({ kind: "subm", no: "01", what: "appA", byName: "م. سامي" })
    expect(updates.map((u) => u.path)).toEqual(["projects/P/pmSubmittals/01", "projects/P/boqItems/L1", "pmPortalLinks/L1"])
    expect(updates[1].patch).toMatchObject({ pmSub: "appA" })
    expect((updates[2].patch.history as unknown[]).length).toBe(1)
  })

  it("refuses when the record was answered meanwhile, and writes nothing", async () => {
    const store = new Map<string, Doc>([
      ["pmPortalLinks/L1", link as unknown as Doc],
      ["projects/P", { organizationId: "O", pm: { lifecycle: "live" } }],
      ["projects/P/pmSubmittals/01", { seq: 1, status: "rej", day: "2026-09-10", itemId: "L1" }],
    ])
    const { db, updates } = fakeDb(store)
    await expect(applyPortalAnswer(db, "L1", { kind: "subm", seq: 1, decision: "appA" }, NOW)).rejects.toMatchObject({ code: "NOT_WAITING" })
    expect(updates).toEqual([])
  })

  it("refuses on a closed project and on a revoked link", async () => {
    const closed = new Map<string, Doc>([
      ["pmPortalLinks/L1", link as unknown as Doc],
      ["projects/P", { organizationId: "O", pm: { lifecycle: "closed" } }],
      ["projects/P/pmNcrs/01", { seq: 1, status: "plan", day: "2026-09-08" }],
    ])
    await expect(applyPortalAnswer(fakeDb(closed).db, "L1", { kind: "ncr", seq: 1, accept: true }, NOW)).rejects.toBeInstanceOf(PortalAnswerError)
    await expect(applyPortalAnswer(fakeDb(closed).db, "L1", { kind: "ncr", seq: 1, accept: true }, NOW)).rejects.toMatchObject({ code: "PROJECT_CLOSED" })
    const revoked = new Map<string, Doc>([["pmPortalLinks/L1", { ...link, status: "revoked" } as unknown as Doc]])
    await expect(applyPortalAnswer(fakeDb(revoked).db, "L1", { kind: "ncr", seq: 1, accept: true }, NOW)).rejects.toMatchObject({ code: "LINK_REVOKED" })
  })
})
