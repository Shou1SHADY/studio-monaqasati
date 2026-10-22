/** @jest-environment node */
/**
 * Procurement 2.0 — the server half of «الطلب الوارد» over an in-memory Admin Firestore (WP-S2-03/05/08): what comes in and
 * how once (idempotent ingest, one MAT sequence, a closed connector brings in nothing new and hides nothing open), what the
 * RFQs and orders do to the lines (R-10, R-12, WF-26), «تعذّر الشراء» (R-29, WF-27), the requester (WF-01, WF-02, REQ-03) and
 * the `proc:ST` events (NFR-02).
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

let mockDb = new FakeAdminDb()
const mockSendSms = jest.fn(async (_m: { to: string; body: string }) => ({ sent: true }))
const mockSendWhatsApp = jest.fn(async (_m: { to: string; body: string }) => ({ sent: true }))
const mockSendDirect = jest.fn(async (_m: { to: string; body: string }) => ({ sent: true }))

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
  sendSms: (m: { to: string; body: string }) => mockSendSms(m),
  sendWhatsApp: (m: { to: string; body: string }) => mockSendWhatsApp(m),
  sendDirectMessage: (m: { to: string; body: string }) => mockSendDirect(m),
  normalizePhoneE164: (p: string | undefined | null) => (p ? String(p).replace(/\s/g, "") : null),
}))

import { POST as incomingRoute } from "@/app/api/procurement/incoming/route"
import { GET as myRequestsRoute, POST as teamRoute } from "@/app/api/procurement/team-requests/route"
import { GET as cronRoute } from "@/app/api/cron/incoming-sync/route"
import {
  clockOf,
  createTeamRequest,
  failIncoming,
  linkPo,
  linkRfq,
  migrateLegacyTeam,
  myRequests,
  notifyFailed,
  planIncoming,
  releaseRfq,
  resolveRequestedFor,
  smsText,
  syncAllIncoming,
  syncIncoming,
  withdrawIncoming,
} from "@/lib/procurement/incoming-server"
import { incomingDocId, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { EVENTS } from "@/lib/procurement/package-data"
import type { Firestore } from "firebase-admin/firestore"

const ORG = "org1"
const NOW = new Date("2026-10-21T08:00:00.000Z")
/** A request is asked about when it arrives and held for the stores' answer for a day: these tests raise theirs three days before NOW, so the window has lapsed and the material is to be bought. */
const ASKED = new Date("2026-10-18T08:00:00.000Z")
const db = () => mockDb as unknown as Firestore
const doc = (mrKey: string) => mockDb.get(`procIncoming/${incomingDocId(ORG, mrKey)}`) as unknown as IncomingDoc | undefined
const incoming = () => mockDb.list("procIncoming") as unknown as IncomingDoc[]
const events = () => [...mockDb.docs].filter(([k]) => k.startsWith("procEvents/")).map(([, d]) => d) as unknown as Array<{ key: string; id: string; payload: Record<string, unknown>; refs: Record<string, unknown> }>
const statusEvents = () => events().filter((e) => e.id === "pm_status" || e.id === "mfg_status")
const notices = (uid: string) => mockDb.list(`users/${uid}/notifications`)
const by = { uid: "buyer", name: "المشتري" }

const teamSrc = (id: string) => ({ kind: "team_request", purchaseRequestId: id })
const pmSrc = { kind: "project_request", projectId: "P1", purchaseRequestId: "03" }
const rfq = (id: string, status: string, products: Array<{ name: string; unit: string; src: Record<string, unknown>; line: number }>, over: Record<string, unknown> = {}) =>
  mockDb.seed(`rfqs/${id}`, { organizationId: ORG, status, rfqNumber: `RFQ-2026/${id}`, products: products.map((p) => ({ name: p.name, unitOfMeasure: p.unit, needSource: p.src, needLine: p.line })), ...over })
const po = (id: string, rfqId: string, indexes: number[], over: Record<string, unknown> = {}) =>
  mockDb.seed(`purchaseOrders/${id}`, {
    organizationId: ORG,
    status: "accepted",
    docNumber: `PO-2026/${id}`,
    rfqId,
    supplierName: "مورد سري",
    promisedDate: "2026-11-02",
    totalExVat: 999,
    lines: indexes.map((i, n) => ({ id: `l${n}`, name: "x", unit: "u", quantity: 10, unitPrice: 77, accepted: 0, rejected: 0, held: 0, cancelled: 0, rfqProductIndex: i })),
    ...over,
  })

const person = (uid: string, over: Record<string, unknown> = {}) => mockDb.seed(`users/${uid}`, { organizationId: ORG, organizationRole: "member", name: `u-${uid}`, phone: "+966500000099", ...over })
const group = (uid: string, permissions: string[]) => {
  mockDb.seed(`teamGroups/g-${uid}`, { organizationId: ORG, permissions, name: "g" })
  mockDb.seed(`users/${uid}`, { ...(mockDb.get(`users/${uid}`) || {}), defaultGroupId: `g-${uid}` })
}

const team = async (n = 3, over: Partial<Parameters<typeof createTeamRequest>[3]> = {}, who = { uid: "eng1", name: "م. فهد" }) =>
  createTeamRequest(
    db(),
    ORG,
    who,
    {
      lines: [
        { name: "الاسمنت العادي", unit: "كيس", quantity: 200 },
        { name: "حديد 16", unit: "طن", quantity: 12 },
        { name: "رمل لياسة", unit: "م³", quantity: 30 },
      ].slice(0, n),
      needBy: "2026-11-10",
      siteId: null,
      place: { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" },
      requestedFor: { kind: "member", id: who.uid, name: who.name },
      ...over,
    },
    ASKED
  )

const pmRequest = (over: Record<string, unknown> = {}, id = "03") =>
  mockDb.seed(`projects/P1/purchaseRequests/${id}`, {
    pm: true,
    seq: 3,
    title: "بلوك الدور الثاني",
    status: "approved",
    needBy: "2026-11-11",
    requestedByUserId: "eng1",
    requestedByUserName: "م. فهد العتيبي",
    approvedByName: "م. خالد",
    approvedOn: "2026-10-20",
    createdAt: "2026-10-19T08:00:00.000Z",
    lines: [
      { itemId: "i1", code: "04-01-01", key: "k1", name: "بلك اسمنتي مفرغ 20", unit: "حبة", qty: 2000, inv: { k: "none", q: 0, kept: 2000, on: "2026-10-20" } },
      { itemId: "i1", code: "04-01-01", key: "k2", name: "اسمنت عادي", unit: "كيس", qty: 150, inv: { k: "none", q: 0, kept: 150, on: "2026-10-20" } },
    ],
    items: [{ name: "بلك اسمنتي مفرغ 20", unit: "حبة", quantity: 2000, itemId: "i1" }, { name: "اسمنت عادي", unit: "كيس", quantity: 150, itemId: "i1" }],
    ...over,
  })

beforeEach(() => {
  mockDb = new FakeAdminDb()
  mockSendSms.mockClear()
  mockSendWhatsApp.mockClear()
  mockSendDirect.mockClear()
  mockDb.seed(`users/${ORG}`, { organizationId: ORG, name: "المالك" })
  mockDb.seed("projects/P1", { organizationId: ORG, name: "مجمع الياسمين", location: "الرياض - حي الياسمين" })
  person("eng1", { name: "م. فهد" })
})

describe("WF-01 — a team's request is created whole and numbered from the one MAT sequence (REQ-04)", () => {
  it("the team, the workshop and the next team request draw 001 · 002 · 003 from the same counter", async () => {
    mockDb.seed(`companyModules/${ORG}`, { off: ["project-management"] })
    const a = await team(1)
    expect(a).toMatchObject({ src: "team", st: "new", no: "MAT-2026/001", mrKey: expect.stringMatching(/^team:/) })
    expect(doc(a.mrKey)).toMatchObject({ requesterIds: ["eng1"], requestedById: "eng1", status: "open" })
    mockDb.seed("workOrders/WO1", {
      organizationId: ORG,
      docNumber: "WO-2026/052",
      productId: "prod1",
      productName: "درج رخام — فيلا الملقا",
      purchaseRequests: [{ id: "PRQ1", itemName: "غراء رخام", unit: "كيس", quantity: 20, needBy: "2026-11-01", note: null, by: "ورشة", byId: "w1", at: "2026-10-20T08:00:00Z", state: "sent" }],
    })
    const r = await syncIncoming(db(), ORG, { now: NOW })
    expect(r.created).toBe(1)
    expect(doc("mfg:WO1:PRQ1")).toMatchObject({ src: "mfg", no: "MAT-2026/002", workOrderNo: "WO-2026/052", st: "new" })
    const b = await team(1)
    expect(b.no).toBe("MAT-2026/003")
    expect((mockDb.get(`mfgCounters/${ORG}__MAT__2026`) as { last: number }).last).toBe(3)
  })
})

describe("ingest is idempotent and moves the legacy requests across once", () => {
  it("a legacy «طلب مواد» becomes one document however many times it is brought in; the old one is marked migrated, never deleted", async () => {
    mockDb.seed("procTeamRequests/L1", { organizationId: ORG, number: "MAT-2026/009", lines: [{ name: "اسمنت", unit: "كيس", quantity: 5 }], needBy: "2026-11-01", place: { label: "المستودع", city: "الرياض", district: "" }, requestedById: "eng1", requestedByName: "فهد", createdAt: "2026-10-01T00:00:00Z", status: "open", notifiedState: "rfq" })
    expect(await migrateLegacyTeam(db(), ORG)).toBe(1)
    expect(await migrateLegacyTeam(db(), ORG)).toBe(0)
    await syncIncoming(db(), ORG, { now: NOW })
    await syncIncoming(db(), ORG, { now: NOW })
    expect(incoming()).toHaveLength(1)
    expect(doc("team:L1")).toMatchObject({ no: "MAT-2026/009", notifiedState: "rfq", legacyId: "L1" })
    expect(mockDb.get("procTeamRequests/L1")).toMatchObject({ status: "migrated" })
  })

  it("a project's approved request is brought in whole; a pending one never is", async () => {
    pmRequest()
    pmRequest({ status: "pending" }, "04")
    const r = await syncIncoming(db(), ORG, { now: NOW })
    expect(r.created).toBe(1)
    expect(incoming().map((d) => d.mrKey)).toEqual(["pm:P1:03"])
    expect(doc("pm:P1:03")).toMatchObject({ no: "MR 03", projectName: "مجمع الياسمين", approvedBy: { name: "م. خالد", on: "2026-10-20" }, place: { label: "مجمع الياسمين", city: "الرياض" } })
    expect(doc("pm:P1:03")?.lines).toHaveLength(2)
    await syncIncoming(db(), ORG, { now: NOW })
    expect(incoming()).toHaveLength(1)
  })

  it("B-13 / NFR-08 — a closed connector brings in nothing NEW, and hides nothing already open", async () => {
    pmRequest()
    await syncIncoming(db(), ORG, { now: NOW })
    expect(incoming()).toHaveLength(1)
    pmRequest({}, "05")
    mockDb.seed(`companyModules/${ORG}`, { off: ["project-management"] })
    const r = await syncIncoming(db(), ORG, { now: NOW })
    expect(r.created).toBe(0)
    expect(incoming().map((d) => d.mrKey)).toEqual(["pm:P1:03"])
    pmRequest({ lines: [{ itemId: "i1", code: "x", key: "k1", name: "بلك اسمنتي مفرغ 20", unit: "حبة", qty: 1800 }, { itemId: "i1", code: "x", key: "k2", name: "اسمنت عادي", unit: "كيس", qty: 150 }] })
    await syncIncoming(db(), ORG, { now: NOW })
    expect(doc("pm:P1:03")?.lines[0].qty).toBe(1800)
    expect(doc("pm:P1:03")?.st).toBe("new")
  })

  it("the dry run reads only: what would come in and in which state", async () => {
    pmRequest()
    mockDb.seed("procTeamRequests/L1", { organizationId: ORG, number: "MAT-2026/009", lines: [{ name: "اسمنت", unit: "كيس", quantity: 5 }], needBy: "2026-11-01", place: { label: "x", city: "y", district: "" }, requestedById: "eng1", requestedByName: "فهد", createdAt: "2026-10-01T00:00:00Z", status: "declined", declinedReason: "غير متوفر" })
    const before = mockDb.writes.length
    const plan = await planIncoming(db(), ORG, NOW)
    expect(plan).toMatchObject({ legacy: 1, pm: 1, mfg: 0, states: { new: 1, fail: 1 } })
    expect(mockDb.writes.length).toBe(before)
  })
})

describe("R-10 / R-12 / WF-26 — the RFQs and orders put lines where they are, and give them back", () => {
  it("a partial award: the awarded line is in its order, the two left out come back — one request, partly handled, nothing lost", async () => {
    const t = await team(3)
    const id = t.mrKey.split(":")[1]
    const names = [["الاسمنت العادي", "كيس"], ["حديد 16", "طن"], ["رمل لياسة", "م³"]]
    rfq("1", "New", names.map(([name, unit], line) => ({ name, unit, src: teamSrc(id), line })))
    await syncIncoming(db(), ORG, { now: NOW })
    expect(doc(t.mrKey)).toMatchObject({ st: "rfq" })
    expect(doc(t.mrKey)?.lines.map((l) => l.ps)).toEqual(["rfq", "rfq", "rfq"])
    mockDb.seed("rfqs/1", { ...(mockDb.get("rfqs/1") as object), status: "Awarded", unawardedLines: [1, 2] })
    po("9", "1", [0])
    await syncIncoming(db(), ORG, { now: NOW })
    const after = doc(t.mrKey) as IncomingDoc
    expect(after.st).toBe("part")
    expect(after.lines.map((l) => l.ps ?? null)).toEqual(["po", null, null])
    expect(after.lines[0]).toMatchObject({ poId: "9", poNumber: "PO-2026/9" })
    expect(after.log.map((e) => e.act)).toEqual(expect.arrayContaining(["created", "rfq", "po", "released"]))
  })

  it("a cancelled RFQ hands every line back and the request is new again", async () => {
    const t = await team(2)
    const id = t.mrKey.split(":")[1]
    rfq("1", "New", [{ name: "الاسمنت العادي", unit: "كيس", src: teamSrc(id), line: 0 }, { name: "حديد 16", unit: "طن", src: teamSrc(id), line: 1 }])
    await syncIncoming(db(), ORG, { now: NOW })
    expect(doc(t.mrKey)?.st).toBe("rfq")
    mockDb.seed("rfqs/1", { ...(mockDb.get("rfqs/1") as object), status: "Cancelled" })
    await syncIncoming(db(), ORG, { now: NOW })
    expect(doc(t.mrKey)).toMatchObject({ st: "new" })
    expect(doc(t.mrKey)?.lines.every((l) => !l.ps)).toBe(true)
  })

  it("the explicit acts agree with the reading: link-rfq then release (an award that left a line out)", async () => {
    const t = await team(2)
    rfq("1", "New", [{ name: "الاسمنت العادي", unit: "كيس", src: teamSrc(t.mrKey.split(":")[1]), line: 0 }, { name: "حديد 16", unit: "طن", src: teamSrc(t.mrKey.split(":")[1]), line: 1 }])
    expect(await linkRfq(db(), ORG, by, { mrKey: t.mrKey, rfqId: "ghost", rfqNumber: "RFQ-2026/9" }, { now: NOW })).toBe("holder_missing")
    const linked = await linkRfq(db(), ORG, by, { mrKey: t.mrKey, rfqId: "1", rfqNumber: "RFQ-2026/1" }, { now: NOW })
    expect(linked).toMatchObject({ moved: true })
    expect(doc(t.mrKey)?.st).toBe("rfq")
    rfq("2", "New", [{ name: "الاسمنت العادي", unit: "كيس", src: teamSrc(t.mrKey.split(":")[1]), line: 0 }])
    expect(await linkRfq(db(), ORG, by, { mrKey: t.mrKey, rfqId: "2", rfqNumber: "RFQ-2026/2", lines: [0] }, { now: NOW })).toBe("already_in_hand")
    await releaseRfq(db(), ORG, by, { mrKey: t.mrKey, rfqId: "1", lines: [1] }, { now: NOW })
    expect(doc(t.mrKey)?.st).toBe("part")
    expect(doc(t.mrKey)?.lines.map((l) => l.ps ?? null)).toEqual(["rfq", null])
    await syncIncoming(db(), ORG, { now: NOW })
    expect(doc(t.mrKey)?.lines.map((l) => l.ps ?? null)).toEqual(["rfq", null])
    po("P1", "1", [])
    po("P2", "1", [])
    const ordered = await linkPo(db(), ORG, by, { mrKey: t.mrKey, poId: "P1", poNumber: "PO-2026/001", lines: [1] }, { now: NOW })
    expect(ordered).toMatchObject({ moved: true })
    expect(await linkPo(db(), ORG, by, { mrKey: t.mrKey, poId: "P2", poNumber: "PO-2026/002", lines: [1] }, { now: NOW })).toBe("already_in_hand")
  })

  it("an order that arrived in full completes the request, and the second look changes nothing", async () => {
    const t = await team(1)
    rfq("1", "Awarded", [{ name: "الاسمنت العادي", unit: "كيس", src: teamSrc(t.mrKey.split(":")[1]), line: 0 }])
    po("9", "1", [0], { status: "accepted", lines: [{ id: "l0", name: "x", unit: "u", quantity: 10, unitPrice: 1, accepted: 10, rejected: 0, held: 0, cancelled: 0, rfqProductIndex: 0 }] })
    await syncIncoming(db(), ORG, { now: NOW })
    expect(doc(t.mrKey)).toMatchObject({ st: "done", status: "closed" })
    const writes = mockDb.writes.length
    await syncIncoming(db(), ORG, { now: NOW })
    expect(mockDb.writes.length).toBe(writes)
  })
})

describe("proc:ST — the status of a project's line goes out once per change, V growing (NFR-02)", () => {
  it("rfq → V2, po → V3, each its own key; nothing for a team's request; a closed Projects connector sends none", async () => {
    pmRequest()
    await syncIncoming(db(), ORG, { now: NOW })
    rfq("1", "New", [{ name: "بلك اسمنتي مفرغ 20", unit: "حبة", src: pmSrc, line: 0 }])
    await syncIncoming(db(), ORG, { now: NOW })
    expect(statusEvents().map((e) => e.key)).toEqual([`proc:ST:pm.P1.03:1:V2`])
    expect(statusEvents()[0]).toMatchObject({ id: "pm_status", payload: { state: "rfq", rfq: "RFQ-2026/1" }, refs: { mrKey: "pm:P1:03", line: 1 } })
    mockDb.seed("rfqs/1", { ...(mockDb.get("rfqs/1") as object), status: "Awarded" })
    po("9", "1", [0])
    await syncIncoming(db(), ORG, { now: NOW })
    expect(statusEvents().map((e) => e.key).sort()).toEqual([`proc:ST:pm.P1.03:1:V2`, `proc:ST:pm.P1.03:1:V3`])
    await syncIncoming(db(), ORG, { now: NOW })
    expect(statusEvents()).toHaveLength(2)
    const t = await team(1)
    rfq("2", "New", [{ name: "الاسمنت العادي", unit: "كيس", src: teamSrc(t.mrKey.split(":")[1]), line: 0 }])
    await syncIncoming(db(), ORG, { now: NOW })
    expect(statusEvents()).toHaveLength(2)
    expect(EVENTS.find((e) => e.id === "pm_status")?.key).toBe("proc:ST:<mr_id>:<line_no>:V<n>")
  })

  it("with Project Management out of the package the event is not sent, the state still moves", async () => {
    pmRequest()
    await syncIncoming(db(), ORG, { now: NOW })
    mockDb.seed(`companyModules/${ORG}`, { off: ["project-management"] })
    rfq("1", "New", [{ name: "بلك اسمنتي مفرغ 20", unit: "حبة", src: pmSrc, line: 0 }])
    await syncIncoming(db(), ORG, { now: NOW })
    expect(doc("pm:P1:03")?.lines[0].ps).toBe("rfq")
    expect(statusEvents()).toHaveLength(0)
  })
})

describe("R-29 / WF-27 — «تعذّر الشراء» on the server", () => {
  it("closes only the lines still to buy, leaves a line in an RFQ alone, names the reason and the alternative, leaves proc:ST for a project's request", async () => {
    pmRequest()
    await syncIncoming(db(), ORG, { now: NOW })
    rfq("1", "New", [{ name: "بلك اسمنتي مفرغ 20", unit: "حبة", src: pmSrc, line: 0 }])
    await syncIncoming(db(), ORG, { now: NOW })
    const res = await failIncoming(db(), ORG, by, { mrKey: "pm:P1:03", code: "avail", alt: "مكافئ من الخرج" }, { now: NOW })
    expect(res).toMatchObject({ moved: true })
    const d = doc("pm:P1:03") as IncomingDoc
    expect(d.lines.map((l) => l.ps)).toEqual(["rfq", "fail"])
    expect(d.lines[1].fail).toMatchObject({ code: "avail", why: "المادة غير متوفرة في السوق", alt: "مكافئ من الخرج", by: "المشتري" })
    expect(d.st).toBe("rfq")
    const fail = events().find((e) => e.refs.line === 2)
    expect(fail).toMatchObject({ payload: { state: "fail", why: "المادة غير متوفرة في السوق", alt: "مكافئ من الخرج" } })
    expect(await failIncoming(db(), ORG, by, { mrKey: "pm:P1:03", code: "nooff" }, { now: NOW })).toBe("nothing_to_close")
  })

  it("«سبب آخر» needs four characters; an unknown request is not found", async () => {
    const t = await team(1)
    expect(await failIncoming(db(), ORG, by, { mrKey: t.mrKey, code: "other", note: "xyz" }, { now: NOW })).toBe("reason")
    expect(await failIncoming(db(), ORG, by, { mrKey: "team:nope", code: "nooff" }, { now: NOW })).toBe("not_found")
    const done = await failIncoming(db(), ORG, by, { mrKey: t.mrKey, code: "other", note: "تعذّر التوريد من الموردين" }, { now: NOW })
    expect(done).toMatchObject({ moved: true })
    expect(doc(t.mrKey)).toMatchObject({ st: "fail", status: "closed" })
  })

  it("the requester hears the reason and the alternative: a notification for an account, an SMS (never WhatsApp) for a receiver without one", async () => {
    const t = await team(1)
    await failIncoming(db(), ORG, by, { mrKey: t.mrKey, code: "price", alt: "مورد آخر" }, { now: NOW })
    await notifyFailed(db(), doc(t.mrKey) as IncomingDoc, by, NOW.toISOString())
    expect(notices("eng1")).toHaveLength(1)
    expect(notices("eng1")[0]).toMatchObject({ type: "team_request_declined", i18n: { message: "pn_team_request_failed", params: { number: "MAT-2026/001", reason: "الأسعار فوق الميزانية بكثير", alt: "مورد آخر" } } })
    const r = await createTeamRequest(db(), ORG, by, { lines: [{ name: "رمل", unit: "م³", quantity: 3 }], needBy: "2026-11-10", place: { label: "الخرج", city: "الخرج", district: "" }, requestedFor: { kind: "receiver", id: "r1", name: "سالم القحطاني", phone: "+966500000001" } }, ASKED)
    await failIncoming(db(), ORG, by, { mrKey: r.mrKey, code: "avail" }, { now: NOW })
    await notifyFailed(db(), doc(r.mrKey) as IncomingDoc, by)
    expect(mockSendSms).toHaveBeenCalledTimes(1)
    expect(mockSendSms.mock.calls[0][0]).toMatchObject({ to: "+966500000001" })
    expect(mockSendSms.mock.calls[0][0].body).toContain("المادة غير متوفرة في السوق")
    expect(mockSendWhatsApp).not.toHaveBeenCalled()
    expect(mockSendDirect).not.toHaveBeenCalled()
    expect(notices("eng1")).toHaveLength(1)
  })
})

describe("the requester — «طلباتي» (REQ-01), on behalf (REQ-03)", () => {
  it("sees where each request stands in four steps and never a price or a supplier; withdraws it only before an RFQ", async () => {
    const t = await team(1)
    const id = t.mrKey.split(":")[1]
    let mine = await myRequests(db(), ORG, "eng1", NOW)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ no: "MAT-2026/001", step: "placed", withdrawable: true, lines: [{ name: "الاسمنت العادي", qty: 200, kind: "buy" }] })
    rfq("1", "Awarded", [{ name: "الاسمنت العادي", unit: "كيس", src: teamSrc(id), line: 0 }])
    po("9", "1", [0])
    mine = await myRequests(db(), ORG, "eng1", NOW)
    expect(mine[0]).toMatchObject({ step: "order", poNumber: "PO-2026/9", promisedDate: "2026-11-02", withdrawable: false })
    const text = JSON.stringify(mine)
    for (const secret of ["مورد سري", "unitPrice", "totalExVat", "999", "77"]) expect(text).not.toContain(secret)
    expect(await withdrawIncoming(db(), ORG, { uid: "eng1", name: "فهد" }, { mrKey: t.mrKey }, { now: NOW })).toBe("in_rfq")
  })

  it("withdraw: only his, only while nothing is in hand; the request ends and leaves the desk", async () => {
    const t = await team(1)
    expect(await withdrawIncoming(db(), ORG, { uid: "stranger", name: "غريب" }, { mrKey: t.mrKey }, { now: NOW })).toBe("not_yours")
    const ok = await withdrawIncoming(db(), ORG, { uid: "eng1", name: "فهد" }, { mrKey: t.mrKey }, { now: NOW })
    expect(ok).toMatchObject({ moved: true })
    expect(doc(t.mrKey)).toMatchObject({ st: "wd", status: "closed", withdrawn: { by: "eng1" } })
    expect(await withdrawIncoming(db(), ORG, { uid: "eng1", name: "فهد" }, { mrKey: t.mrKey }, { now: NOW })).toBe("closed")
    await syncIncoming(db(), ORG, { now: NOW })
    expect(doc(t.mrKey)?.st).toBe("wd")
  })

  it("a request raised on behalf is read by whoever raised it and, with an account, by the member it is for", async () => {
    person("eng2", { name: "م. سامي" })
    const onBehalf = await team(1, { requestedFor: { kind: "member", id: "eng2", name: "م. سامي" } }, { uid: "buyer", name: "المشتري" })
    expect(doc(onBehalf.mrKey)).toMatchObject({ requesterIds: ["buyer", "eng2"], requestedFor: { name: "م. سامي" }, requestedBy: { id: "buyer" } })
    expect((await myRequests(db(), ORG, "eng2", NOW)).map((r) => r.no)).toEqual(["MAT-2026/001"])
    expect((await myRequests(db(), ORG, "buyer", NOW)).map((r) => r.no)).toEqual(["MAT-2026/001"])
    expect(await myRequests(db(), ORG, "eng1", NOW)).toEqual([])
  })

  it("resolves who it is for: himself, a member of THIS company, a receiver with or without an account", async () => {
    mockDb.seed("users/foreign", { organizationId: "other", name: "غريب" })
    mockDb.seed("procurementReceivers/r1", { organizationId: ORG, name: "سالم", phone: "+966500000001", active: true })
    mockDb.seed("procurementReceivers/r2", { organizationId: ORG, name: "نايف", phone: "+966500000002", userId: "eng1", active: true })
    mockDb.seed("procurementReceivers/r3", { organizationId: "other", name: "x", phone: "1" })
    expect(await resolveRequestedFor(db(), ORG, by, undefined)).toMatchObject({ kind: "member", id: "buyer" })
    expect(await resolveRequestedFor(db(), ORG, by, { kind: "member", id: "eng1" })).toMatchObject({ kind: "member", id: "eng1" })
    expect(await resolveRequestedFor(db(), ORG, by, { kind: "member", id: "foreign" })).toBeNull()
    expect(await resolveRequestedFor(db(), ORG, by, { kind: "receiver", id: "r1" })).toMatchObject({ kind: "receiver", name: "سالم", phone: "+966500000001" })
    expect(await resolveRequestedFor(db(), ORG, by, { kind: "receiver", id: "r2" })).toMatchObject({ kind: "member", id: "eng1" })
    expect(await resolveRequestedFor(db(), ORG, by, { kind: "receiver", id: "r3" })).toBeNull()
  })

  it("moves forward tell him once: in an RFQ, in an order, arrived — and the second look is quiet", async () => {
    const t = await team(1)
    const id = t.mrKey.split(":")[1]
    rfq("1", "New", [{ name: "الاسمنت العادي", unit: "كيس", src: teamSrc(id), line: 0 }])
    await syncIncoming(db(), ORG, { now: NOW })
    await syncIncoming(db(), ORG, { now: NOW })
    expect(notices("eng1").map((n) => (n as unknown as { i18n: { message: string } }).i18n.message)).toEqual(["pn_team_request_rfq"])
    mockDb.seed("rfqs/1", { ...(mockDb.get("rfqs/1") as object), status: "Awarded" })
    po("9", "1", [0])
    const r = await syncIncoming(db(), ORG, { now: NOW })
    expect(r.told).toBe(1)
    expect(notices("eng1")).toHaveLength(2)
    expect(doc(t.mrKey)?.notifiedState).toBe("order")
  })
})

describe("the routes", () => {
  const as = (uid: string, url: string, body?: unknown) => new NextRequest(`http://localhost${url}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", authorization: `Bearer tok:${uid}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const create = (uid: string, over: Record<string, unknown> = {}) =>
    teamRoute(as(uid, "/api/procurement/team-requests", { action: "create", lines: [{ name: "اسمنت", unit: "كيس", quantity: 5 }], needBy: "2099-01-01", place: { label: "المستودع", city: "الرياض", district: "" }, ...over }))
  const json = async (res: Response) => (await res.json()) as { success?: boolean; error?: boolean; code?: string; data?: Record<string, unknown> }

  beforeEach(() => mockDb.seed(`companyModules/${ORG}`, { off: ["project-management"] }))
  const lapse = (mrKey: string) => {
    const d = doc(mrKey) as IncomingDoc
    mockDb.seed(`procIncoming/${incomingDocId(ORG, mrKey)}`, { ...d, lines: d.lines.map((l) => (l.stk ? { ...l, stk: { ...l.stk, until: "2026-01-01" } } : l)) } as unknown as Record<string, unknown>)
  }

  it("WF-01: any member raises one for himself; with Projects in the package the server refuses (B-09)", async () => {
    const res = await create("eng1")
    expect(res.status).toBe(200)
    expect((await json(res)).data).toMatchObject({ number: "MAT-2026/001" })
    expect(incoming()).toHaveLength(1)
    mockDb.seed(`companyModules/${ORG}`, { off: [] })
    const refused = await create("eng1")
    expect(refused.status).toBe(409)
    expect((await json(refused)).code).toBe("PROJECTS_ON")
  })

  it("WF-02: only whoever sources raises one on behalf; a receiver without an account is told by SMS, never by WhatsApp", async () => {
    mockDb.seed("procurementReceivers/r1", { organizationId: ORG, name: "سالم القحطاني", phone: "+966500000001", active: true })
    const denied = await create("eng1", { requestedFor: { kind: "receiver", id: "r1" } })
    expect(denied.status).toBe(403)
    const ok = await create(ORG, { requestedFor: { kind: "receiver", id: "r1" } })
    expect(ok.status).toBe(200)
    const d = incoming()[0]
    expect(d).toMatchObject({ requestedFor: { kind: "receiver", name: "سالم القحطاني" }, requestedBy: { id: ORG }, requesterIds: [ORG] })
    expect(mockSendSms).toHaveBeenCalledWith({ to: "+966500000001", body: smsText("received", { no: d.no }) })
    expect(mockSendWhatsApp).not.toHaveBeenCalled()
    mockDb.seed("procurementReceivers/r2", { organizationId: ORG, name: "بلا جوال", phone: "", active: true })
    expect((await create(ORG, { requestedFor: { kind: "receiver", id: "r2" } })).status).toBe(400)
    expect((await create(ORG, { requestedFor: { kind: "member", id: "nobody" } })).status).toBe(400)
  })

  it("refuses what the service refuses: no lines, a past need-by date, no place", async () => {
    expect((await create("eng1", { needBy: "2020-01-01" })).status).toBe(400)
    expect((await create("eng1", { place: { label: "", city: "", district: "" } })).status).toBe(400)
    expect((await teamRoute(as("eng1", "/api/procurement/team-requests", { action: "create", lines: [], needBy: "2099-01-01", place: { label: "x", city: "y", district: "" } }))).status).toBe(400)
    expect((await teamRoute(as("nobody", "/api/procurement/team-requests", {}))).status).toBe(400)
  })

  it("GET returns his own requests; withdraw goes through the same rule", async () => {
    await create("eng1")
    const list = await json(await myRequestsRoute(as("eng1", "/api/procurement/team-requests")))
    expect((list.data?.requests as Array<{ no: string; step: string }>)[0]).toMatchObject({ no: "MAT-2026/001", step: "placed" })
    const key = (list.data?.requests as Array<{ id: string }>)[0].id
    expect((await teamRoute(as("someone", "/api/procurement/team-requests", { action: "withdraw", id: key }))).status).toBe(401)
    person("someone")
    expect((await teamRoute(as("someone", "/api/procurement/team-requests", { action: "withdraw", id: key }))).status).toBe(403)
    expect((await teamRoute(as("eng1", "/api/procurement/team-requests", { action: "withdraw", id: key }))).status).toBe(200)
    expect(incoming()[0].st).toBe("wd")
  })

  it("«تعذّر الشراء» is Procurement's: a requester is refused, the owner closes it and the requester is told", async () => {
    const made = await json(await create("eng1"))
    const mrKey = String(made.data?.id)
    lapse(mrKey)
    const refused = await incomingRoute(as("eng1", "/api/procurement/incoming", { action: "fail", mrKey, reason: "avail" }))
    expect(refused.status).toBe(403)
    const ok = await incomingRoute(as(ORG, "/api/procurement/incoming", { action: "fail", mrKey, reason: "avail", alt: "مكافئ" }))
    expect(ok.status).toBe(200)
    expect(doc(mrKey)).toMatchObject({ st: "fail" })
    expect(notices("eng1").some((n) => (n as unknown as { type: string }).type === "team_request_declined")).toBe(true)
    const again = await incomingRoute(as(ORG, "/api/procurement/incoming", { action: "fail", mrKey, reason: "avail" }))
    expect(again.status).toBe(409)
    expect((await json(again)).code).toBe("CLOSED")
    expect((await incomingRoute(as(ORG, "/api/procurement/incoming", { action: "fail", mrKey: "team:none", reason: "avail" }))).status).toBe(404)
    expect((await incomingRoute(as(ORG, "/api/procurement/incoming", { action: "fail", mrKey, reason: "weird" }))).status).toBe(400)
  })

  it("a buyer with the permission links and releases lines through the route; a member without it cannot", async () => {
    const made = await json(await create("eng1"))
    const mrKey = String(made.data?.id)
    lapse(mrKey)
    person("buyer", { organizationRole: "member" })
    group("buyer", ["rfq.manage"])
    rfq("1", "New", [{ name: "اسمنت", unit: "كيس", src: teamSrc(mrKey.split(":")[1]), line: 0 }])
    const linked = await incomingRoute(as("buyer", "/api/procurement/incoming", { action: "link-rfq", mrKey, rfqId: "1", rfqNumber: "RFQ-2026/1" }))
    expect(linked.status).toBe(200)
    expect(doc(mrKey)?.st).toBe("rfq")
    expect((await incomingRoute(as("eng1", "/api/procurement/incoming", { action: "release", mrKey, rfqId: "1" }))).status).toBe(403)
    expect((await incomingRoute(as("buyer", "/api/procurement/incoming", { action: "release", mrKey, rfqId: "1" }))).status).toBe(200)
    expect(doc(mrKey)?.st).toBe("new")
  })

  it("sync is open to any member of the company and reads the company's own", async () => {
    pmRequest()
    mockDb.seed(`companyModules/${ORG}`, { off: [] })
    const res = await incomingRoute(as("eng1", "/api/procurement/incoming", { action: "sync" }))
    expect(res.status).toBe(200)
    expect((await json(res)).data).toMatchObject({ created: 1 })
    expect((await incomingRoute(as("ghost", "/api/procurement/incoming", { action: "sync" }))).status).toBe(401)
  })
})

describe("the daily job", () => {
  it("is closed without its secret and runs every company that has something to read", async () => {
    const unconfigured = await cronRoute(new NextRequest("http://localhost/api/cron/incoming-sync"))
    expect(unconfigured.status).toBe(401)
    process.env.CRON_SECRET = "s3cret"
    try {
      expect((await cronRoute(new NextRequest("http://localhost/api/cron/incoming-sync", { headers: { authorization: "Bearer nope" } }))).status).toBe(401)
      pmRequest()
      const ok = await cronRoute(new NextRequest("http://localhost/api/cron/incoming-sync", { headers: { authorization: "Bearer s3cret" } }))
      expect(ok.status).toBe(200)
      expect(((await ok.json()) as { data: Record<string, number> }).data).toMatchObject({ orgs: 1, created: 1, failed: 0 })
      expect(incoming()).toHaveLength(1)
    } finally {
      delete process.env.CRON_SECRET
    }
    expect((await syncAllIncoming(db(), NOW)).orgs).toBe(1)
  })
})

describe("the reply clock reads the policies", () => {
  it("a company's own windows replace the day", async () => {
    mockDb.seed(`procurementSettings/${ORG}`, { inventoryReplyDays: 3, workshopReplyDays: 2 })
    expect(await clockOf(db(), ORG, NOW)).toMatchObject({ stockDays: 3, workshopDays: 2 })
    mockDb.docs.delete(`procurementSettings/${ORG}`)
    expect(await clockOf(db(), ORG, NOW)).toMatchObject({ stockDays: 1, workshopDays: 1 })
  })
})
