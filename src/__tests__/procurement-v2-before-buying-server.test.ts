/** @jest-environment node */
/**
 * Procurement 2.0 — «قبل الشراء» over an in-memory Admin Firestore (WP-S2-04): a request is asked about when it arrives
 * (`proc:ISS`), Inventory answers through the route (`inv:CHK`, V growing), the workshop is asked and answers only with
 * Manufacturing in the package (`proc:MK` with the last price, `mfg:MK`), a window that lapses fails open on the next pass and a
 * late answer is refused, and closing the connector never reverts an answer that has a work order (NFR-08).
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

let mockDb = new FakeAdminDb()

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ name: "b", file: () => ({ save: async () => undefined }) }) }),
  getStorageBucketName: () => "b",
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (!t.startsWith("tok:")) throw new Error("bad token")
      return { uid: t.slice(4) }
    },
  }),
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "SERVER_TS", increment: (n: number) => ({ __inc: n }), arrayUnion: (v: unknown) => [v] } }))
jest.mock("@/lib/sms", () => ({
  isSmsConfigured: () => true,
  sendSms: async () => ({ sent: true }),
  sendWhatsApp: async () => ({ sent: true }),
  sendDirectMessage: async () => ({ sent: true }),
  normalizePhoneE164: (p: string | undefined | null) => (p ? String(p).replace(/\s/g, "") : null),
}))

import { POST as incomingRoute } from "@/app/api/procurement/incoming/route"
import { createTeamRequest, syncIncoming, syncAllIncoming } from "@/lib/procurement/incoming-server"
import { incomingDocId, lineBuyQty, replyClockOf, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { WORKSHOP_MAKE_SUBS } from "@/lib/procurement/stock-check"
import { DEFAULT_RESOLVED_POLICIES } from "@/lib/procurement/policies"
import type { MaterialPick } from "@/lib/materials/types"
import type { Firestore } from "firebase-admin/firestore"

const ORG = "org1"
const DAY = 86_400_000
const NOW = new Date("2026-10-21T08:00:00.000Z")
// The route reads the real clock: pin it to the day the windows below are built from, or they lapse once that day has passed.
jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] })
const at = (n: number) => new Date(NOW.getTime() + n * DAY)
const db = () => mockDb as unknown as Firestore
const doc = (mrKey: string) => mockDb.get(`procIncoming/${incomingDocId(ORG, mrKey)}`) as unknown as IncomingDoc | undefined
const events = () => [...mockDb.docs].filter(([k]) => k.startsWith("procEvents/")).map(([, d]) => d) as unknown as Array<{ key: string; id: string; payload: Record<string, unknown>; refs: Record<string, unknown> }>
const keys = (id: string) => events().filter((e) => e.id === id).map((e) => e.key).sort()
const clockAt = (n: number) => replyClockOf(at(n), DEFAULT_RESOLVED_POLICIES)

const as = (uid: string, body: unknown) => new NextRequest("http://localhost/api/procurement/incoming", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tok:${uid}` }, body: JSON.stringify(body) })
const call = async (uid: string, body: unknown) => {
  const res = await incomingRoute(as(uid, body))
  return { status: res.status, json: (await res.json()) as { success?: boolean; code?: string } }
}

const person = (uid: string, permissions: string[]) => {
  mockDb.seed(`teamGroups/g-${uid}`, { organizationId: ORG, permissions, name: "g" })
  mockDb.seed(`users/${uid}`, { organizationId: ORG, organizationRole: "member", name: `u-${uid}`, defaultGroupId: `g-${uid}` })
}

const stone = (): MaterialPick => ({ nodeId: WORKSHOP_MAKE_SUBS[0], subId: WORKSHOP_MAKE_SUBS[0], rootId: "floors", path: [{ ar: "الارضيات", en: "Floors" }], specs: [] })
const by = { uid: "eng1", name: "م. فهد" }

const raise = (now: Date, lines: Array<{ name: string; unit: string; quantity: number; material?: MaterialPick }>, needBy = "2026-11-22") =>
  createTeamRequest(db(), ORG, by, { lines, needBy, siteId: null, place: { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" }, requestedFor: { kind: "member", id: "eng1", name: "م. فهد" } }, now)

beforeEach(() => {
  mockDb = new FakeAdminDb()
  mockDb.seed(`users/${ORG}`, { organizationId: ORG, name: "المالك" })
  mockDb.seed(`companyModules/${ORG}`, { off: ["project-management"] })
  mockDb.seed("warehouses/w1", { organizationId: ORG, name: "المستودع المركزي" })
  mockDb.seed("warehouses/wx", { organizationId: "other", name: "مستودع غريب" })
  mockDb.seed("users/eng1", { organizationId: ORG, organizationRole: "member", name: "م. فهد" })
  person("keeper", ["warehouses.manage"])
  person("buyer", ["rfq.manage"])
  person("lead", ["manufacturing.manage"])
})

describe("INC-07 — a request that arrives is asked about at once (proc:ISS)", () => {
  it("every material line waits for the stores, with the day the window ends, and one proc:ISS leaves for each", async () => {
    const t = await raise(NOW, [{ name: "البلك الاسمنتي", unit: "حبة", quantity: 2000 }, { name: "الاسمنت العادي", unit: "كيس", quantity: 200 }])
    const d = doc(t.mrKey) as IncomingDoc
    expect(d.st).toBe("new")
    expect(d.lines.map((l) => l.stk)).toEqual([expect.objectContaining({ st: "wait", src: "proc", until: "2026-10-22" }), expect.objectContaining({ st: "wait", src: "proc", until: "2026-10-22" })])
    const ref = t.mrKey.replace(/:/g, ".")
    expect(keys("inv_issue")).toEqual([`proc:ISS:${ref}:1`, `proc:ISS:${ref}:2`])
    expect(events().find((e) => e.id === "inv_issue")?.payload).toMatchObject({ material: "البلك الاسمنتي", qty: 2000, unit: "حبة", for: "مجمع الياسمين" })
    expect(lineBuyQty(d.lines[0], clockAt(0))).toBe(0)
  })

  it("an approved project request is asked about when the sync brings it in; one the stores already answered is not", async () => {
    mockDb.seed(`companyModules/${ORG}`, { off: [] })
    mockDb.seed("projects/P1", { organizationId: ORG, name: "مجمع الياسمين", location: "الرياض - حي الياسمين" })
    mockDb.seed("projects/P1/purchaseRequests/03", {
      pm: true,
      seq: 3,
      status: "approved",
      needBy: "2026-11-11",
      requestedByUserId: "eng1",
      requestedByUserName: "م. فهد",
      createdAt: "2026-10-19T08:00:00.000Z",
      lines: [
        { itemId: "i1", code: "04-01", key: "k1", name: "بلك", unit: "حبة", qty: 2000 },
        { itemId: "i1", code: "04-01", key: "k2", name: "اسمنت", unit: "كيس", qty: 150, inv: { k: "none", q: 0, kept: 150, on: "2026-10-20" } },
      ],
      items: [{ name: "بلك", unit: "حبة", quantity: 2000, itemId: "i1" }, { name: "اسمنت", unit: "كيس", quantity: 150, itemId: "i1" }],
    })
    await syncIncoming(db(), ORG, { now: NOW })
    const d = doc("pm:P1:03") as IncomingDoc
    expect(d.lines[0].stk).toMatchObject({ st: "wait", src: "proc" })
    expect(d.lines[1].stk).toMatchObject({ st: "none" })
    expect(d.lines[1].stk?.src).toBeUndefined()
    expect(keys("inv_issue")).toEqual(["proc:ISS:pm.P1.03:1"])
    await syncIncoming(db(), ORG, { now: NOW })
    expect(keys("inv_issue")).toHaveLength(1)
  })
})

describe("WF-04 — Inventory's reply through the route (inv:CHK)", () => {
  it("issues 500 of 2,000 from the central warehouse: 1,500 are to publish, and inv:CHK …:V1 is left", async () => {
    const t = await raise(NOW, [{ name: "البلك", unit: "حبة", quantity: 2000 }])
    const res = await call("keeper", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "part", give: 500, warehouseId: "w1", why: "الباقي غير متوفر" })
    expect(res.status).toBe(200)
    const d = doc(t.mrKey) as IncomingDoc
    expect(d.lines[0].stk).toMatchObject({ st: "part", give: 500, rv: 1, wh: { id: "w1", name: "المستودع المركزي" }, by: "u-keeper" })
    expect(lineBuyQty(d.lines[0], clockAt(0))).toBe(1500)
    expect(keys("inv_check")).toEqual([`proc:ISS:${t.mrKey.replace(/:/g, ".")}:1`.replace("proc:ISS", "inv:CHK") + ":V1"])
    expect(events().find((e) => e.id === "inv_check")?.payload).toMatchObject({ state: "part", give: 500, warehouse: "المستودع المركزي" })
  })

  it("a correction is V2; a warehouse of another company is refused; the answer is Inventory's alone", async () => {
    const t = await raise(NOW, [{ name: "البلك", unit: "حبة", quantity: 2000 }])
    expect((await call("buyer", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "none" })).status).toBe(403)
    expect((await call("eng1", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "none" })).status).toBe(403)
    expect((await call("keeper", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "issue", warehouseId: "wx" })).json.code).toBe("NO_WAREHOUSE")
    expect((await call("keeper", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "none" })).status).toBe(200)
    expect((await call("keeper", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "tied", why: "محجوز لبرج العليا" })).status).toBe(200)
    expect(keys("inv_check").map((k) => k.slice(-3))).toEqual([":V1", ":V2"])
    expect(((doc(t.mrKey) as IncomingDoc).lines[0].stk)).toMatchObject({ st: "tied", why: "محجوز لبرج العليا", rv: 2 })
  })

  it("R-xx: after the window the line was bought in full — a late reply is refused and changes nothing", async () => {
    const t = await raise(at(-3), [{ name: "البلك", unit: "حبة", quantity: 2000 }])
    const res = await call("keeper", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "part", give: 500, warehouseId: "w1" })
    expect(res.status).toBe(409)
    expect(res.json.code).toBe("WINDOW_LAPSED")
    expect((doc(t.mrKey) as IncomingDoc).lines[0].stk).toMatchObject({ st: "wait" })
    expect(keys("inv_check")).toEqual([])
  })

  it("a reply for a line in an RFQ is refused; a request nobody asked about is not found", async () => {
    const t = await raise(NOW, [{ name: "البلك", unit: "حبة", quantity: 2000 }])
    mockDb.seed(`procIncoming/${incomingDocId(ORG, t.mrKey)}`, { ...(doc(t.mrKey) as object), lines: (doc(t.mrKey) as IncomingDoc).lines.map((l) => ({ ...l, ps: "rfq", rfqId: "q1" })) } as Record<string, unknown>)
    expect((await call("keeper", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "none" })).json.code).not.toBe(undefined)
    expect((await call("keeper", { action: "stock-reply", mrKey: "team:none", line: 1, kind: "none" })).status).toBe(404)
  })
})

describe("it fails open on the next pass — no button (INC-07)", () => {
  it("the sync after the window writes the lapse down and the whole quantity is to buy; the daily job does the same", async () => {
    const t = await raise(NOW, [{ name: "البلك", unit: "حبة", quantity: 2000 }])
    await syncIncoming(db(), ORG, { now: at(1) })
    expect((doc(t.mrKey) as IncomingDoc).lines[0].stk).toMatchObject({ st: "wait" })
    const totals = await syncAllIncoming(db(), at(3))
    expect(totals.failed).toBe(0)
    const d = doc(t.mrKey) as IncomingDoc
    expect(d.lines[0].stk).toMatchObject({ st: "none", auto: "timeout" })
    expect(lineBuyQty(d.lines[0], clockAt(3))).toBe(2000)
    expect(d.log.some((e) => e.act === "proceed")).toBe(true)
    expect((await call("keeper", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "issue", warehouseId: "w1" })).json.code).toBe("WINDOW_LAPSED")
  })

  it("`proceed` by hand closes the same questions and nothing else", async () => {
    const t = await raise(at(-3), [{ name: "البلك", unit: "حبة", quantity: 10 }])
    expect((await call("keeper", { action: "proceed", mrKey: t.mrKey })).status).toBe(403)
    expect((await call("buyer", { action: "proceed", mrKey: t.mrKey })).status).toBe(200)
    expect((doc(t.mrKey) as IncomingDoc).lines[0].stk).toMatchObject({ auto: "timeout" })
  })
})

describe("INC-08 / WF-05 — «اسأل الورشة» and the workshop's answer", () => {
  const raiseStone = (now: Date) => raise(now, [{ name: "أرضيات رخام بيج", unit: "م²", quantity: 380, material: stone() }, { name: "رمل", unit: "م³", quantity: 4 }])

  it("B-05: without Manufacturing in the package the route refuses; for a material that is not stone it refuses", async () => {
    const t = await raiseStone(NOW)
    mockDb.seed(`companyModules/${ORG}`, { off: ["project-management", "manufacturing"] })
    expect((await call("buyer", { action: "ask-mfg", mrKey: t.mrKey, lines: [1] })).json.code).toBe("CONNECTOR_OFF")
    mockDb.seed(`companyModules/${ORG}`, { off: ["project-management"] })
    expect((await call("buyer", { action: "ask-mfg", mrKey: t.mrKey, lines: [2] })).json.code).toBe("NOT_MAKEABLE")
    expect((await call("eng1", { action: "ask-mfg", mrKey: t.mrKey, lines: [1] })).status).toBe(403)
  })

  it("B-04: the buyer asks, with the last price we paid; the line waits; proc:MK leaves once", async () => {
    mockDb.seed("priceHistory/h1", { organizationId: ORG, materialKey: "ارضيات رخام بيج|م2", name: "أرضيات رخام بيج", unit: "م²", price: 285, day: "2025-06-02", poNumber: "PO-2025/188", kind: "po", supplierOrgId: "s", supplierName: "s" })
    const t = await raiseStone(NOW)
    const res = await call("buyer", { action: "ask-mfg", mrKey: t.mrKey, lines: [1], note: "الدرج 14 قائمة" })
    expect(res.status).toBe(200)
    const d = doc(t.mrKey) as IncomingDoc
    expect(d.lines[0].mk).toMatchObject({ st: "ask", src: "proc", note: "الدرج 14 قائمة" })
    expect(keys("mfg_ask")).toEqual([`proc:MK:${t.mrKey.replace(/:/g, ".")}:1`])
    expect((await call("buyer", { action: "ask-mfg", mrKey: t.mrKey, lines: [1] })).json.code).toBe("ALREADY_ASKED")
  })

  it("the workshop makes 300 of 380 under a work order: 80 are bought; only manufacturing.manage answers; mfg:MK …:V1 is left", async () => {
    const t = await raiseStone(NOW)
    await call("keeper", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "none" })
    await call("buyer", { action: "ask-mfg", mrKey: t.mrKey, lines: [1] })
    expect((await call("buyer", { action: "mfg-reply", mrKey: t.mrKey, line: 1, kind: "part", make: 300, wo: "أت-2026/061" })).status).toBe(403)
    const res = await call("lead", { action: "mfg-reply", mrKey: t.mrKey, line: 1, kind: "part", make: 300, wo: "أت-2026/061", why: "طاقة القص تكفي" })
    expect(res.status).toBe(200)
    const d = doc(t.mrKey) as IncomingDoc
    expect(d.lines[0].mk).toMatchObject({ st: "part", make: 300, wo: "أت-2026/061", rv: 1 })
    expect(lineBuyQty(d.lines[0], clockAt(0))).toBe(80)
    expect(keys("mfg_reply")).toEqual([`mfg:MK:${t.mrKey.replace(/:/g, ".")}:1:V1`])
  })

  it("after a day with no answer the decision returns to the buyer and a late answer is refused", async () => {
    const t = await raiseStone(at(-3))
    await call("keeper", { action: "stock-reply", mrKey: t.mrKey, line: 2, kind: "none" }).catch(() => undefined)
    const asked = await call("buyer", { action: "ask-mfg", mrKey: t.mrKey, lines: [1] })
    expect(asked.status).toBe(200)
    mockDb.seed(`procIncoming/${incomingDocId(ORG, t.mrKey)}`, { ...(doc(t.mrKey) as object), lines: (doc(t.mrKey) as IncomingDoc).lines.map((l) => (l.mk ? { ...l, mk: { ...l.mk, at: at(-3).toISOString() } } : l)) } as Record<string, unknown>)
    expect((await call("lead", { action: "mfg-reply", mrKey: t.mrKey, line: 1, kind: "make", wo: "أت-1" })).json.code).toBe("WINDOW_LAPSED")
  })

  it("NFR-08: the connector closes — an unanswered question returns to the buyer, an answer with a work order stands", async () => {
    const t = await raise(NOW, [
      { name: "رخام أ", unit: "م²", quantity: 100, material: stone() },
      { name: "رخام ب", unit: "م²", quantity: 100, material: stone() },
    ])
    await call("keeper", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "none" })
    await call("keeper", { action: "stock-reply", mrKey: t.mrKey, line: 2, kind: "none" })
    await call("buyer", { action: "ask-mfg", mrKey: t.mrKey, lines: [1, 2] })
    await call("lead", { action: "mfg-reply", mrKey: t.mrKey, line: 1, kind: "part", make: 40, wo: "أت-2026/070" })
    mockDb.seed(`companyModules/${ORG}`, { off: ["project-management", "manufacturing"] })
    await syncIncoming(db(), ORG, { now: NOW })
    const d = doc(t.mrKey) as IncomingDoc
    expect(d.lines[0].mk).toMatchObject({ st: "part", make: 40, wo: "أت-2026/070" })
    expect(d.lines[1].mk).toMatchObject({ st: "buy", auto: "closed" })
    expect(lineBuyQty(d.lines[0], clockAt(0))).toBe(60)
    expect(lineBuyQty(d.lines[1], clockAt(0))).toBe(100)
  })
})
