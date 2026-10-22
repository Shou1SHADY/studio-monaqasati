/** @jest-environment node */
/**
 * Procurement 2.0 — an RFQ's life after it is published (WP-S3-09; RFQ-13, RFQ-14, RFQ-15, WF-26, R-12): extend, reopen, cancel
 * with a reason (its lines go back to «الواردة», the invitees and bidders are told), remind the non-bidders, rename — and the
 * «لا عرض حيّاً» reading both exits hang from.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

let mockDb = new FakeAdminDb()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => mockDb,
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (!t.startsWith("tok:")) throw new Error("bad token")
      return { uid: t.slice(4) }
    },
  }),
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }), arrayUnion: (v: unknown) => [v], delete: () => "DEL" } }))
jest.mock("@/lib/sms", () => ({ isSmsConfigured: () => false, sendSms: async () => ({ sent: false }), sendWhatsApp: async () => ({ sent: false }), sendDirectMessage: async () => ({ sent: false }), normalizePhoneE164: (p: string | undefined | null) => (p ? String(p) : null) }))

import { POST as lifecycleRoute } from "@/app/api/procurement/rfq/lifecycle/route"
import { POST as renameRoute } from "@/app/api/procurement/rfq/rename/route"
import { createTeamRequest } from "@/lib/procurement/incoming-server"
import { incomingDocId, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { RfqError, type RfqCaller } from "@/lib/procurement/rfq-server/common"
import { lifecycleSchema, renameRfq, runLifecycle, type LifecycleInput } from "@/lib/procurement/rfq-server/lifecycle"
import { publishRfq, publishSchema } from "@/lib/procurement/rfq-server/publish"
import { cancelReasonRefusal, deadlineRefusal, extendPatch } from "@/lib/procurement/rfq-lifecycle-rules"
import { earliestNewDeadline, noLiveOffer } from "@/lib/procurement/rfq-no-live"
import { shareLinkState } from "@/lib/procurement/guest-supplier"
import { findLinkByToken } from "@/lib/links/hash"
import type { Firestore } from "firebase-admin/firestore"

const ORG = "org1"
const NOW = new Date("2026-10-22T08:00:00.000Z")
const db = () => mockDb as unknown as Firestore
const OWNER: RfqCaller = { uid: ORG, name: "Saad", orgId: ORG, can: () => true }
const BUYER: RfqCaller = { uid: "buyer", name: "Buyer", orgId: ORG, can: (p) => p === "offers.accept" }
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof RfqError ? e.code : String(e)))
const run = (input: Record<string, unknown>, c: RfqCaller = OWNER, now = NOW) => runLifecycle(db(), c, lifecycleSchema.parse(input) as LifecycleInput, now)
const rfq = (id = "R1") => mockDb.get(`rfqs/${id}`) as Record<string, unknown> & { log: Array<{ action: string; note?: string | null }> }
const notices = (uid: string) => mockDb.list(`users/${uid}/notifications`) as unknown as Array<{ type: string; rfqId: string; i18n: { message: string; params: Record<string, string> } }>
const events = () => [...mockDb.docs].filter(([k]) => k.startsWith("procEvents/")).map(([, d]) => d) as unknown as Array<{ key: string; id: string; payload: { change?: string } }>

const seedRfq = (over: Record<string, unknown> = {}, id = "R1") =>
  mockDb.seed(`rfqs/${id}`, {
    organizationId: ORG,
    contractorId: ORG,
    createdByUserId: ORG,
    rfqNumber: "RFQ-2026/011",
    title: "زوايا حديد",
    status: "New",
    visibility: "private",
    deadline: "2026-10-25",
    allowedSupplierOrgIds: ["s1", "s2"],
    invitedSupplierOrgIds: ["s1", "s2"],
    products: [{ name: "زوايا", quantity: 10, unitOfMeasure: "م" }],
    pubVer: 1,
    log: [],
    ...over,
  })
const seedOffer = (id: string, supplier: string, over: Record<string, unknown> = {}) =>
  mockDb.seed(`offers/${id}`, { rfqId: "R1", contractorOrgId: ORG, supplierId: supplier, organizationId: supplier, status: "قيد المراجعة", price: "100", rfqTitle: "زوايا حديد", ...over })

beforeEach(() => {
  mockDb = new FakeAdminDb()
  mockDb.seed(`users/${ORG}`, { organizationId: ORG, name: "المالك" })
})

describe("the rules (pure)", () => {
  it("a new deadline is later than today and later than the one it replaces", () => {
    expect(deadlineRefusal("2026-10-25", "2026-10-26", "2026-10-22")).toBeNull()
    expect(deadlineRefusal("2026-10-25", "2026-10-25", "2026-10-22")).toBe("date_invalid")
    expect(deadlineRefusal("2026-10-20", "2026-10-21", "2026-10-22")).toBe("date_invalid")
    expect(deadlineRefusal("2026-10-20", "2026-10-22", "2026-10-22")).toBeNull()
    expect(earliestNewDeadline("2026-10-25", NOW)).toBe("2026-10-26")
    expect(earliestNewDeadline("2026-10-20", NOW)).toBe("2026-10-22")
  })

  it("«سبب آخر» needs four letters", () => {
    expect(cancelReasonRefusal("other", "abc")).toBe("reason_required")
    expect(cancelReasonRefusal("other", "abcd")).toBeNull()
    expect(cancelReasonRefusal("need", undefined)).toBeNull()
  })

  it("an extension adds each new supplier once, to a private round's list too", () => {
    expect(extendPatch({ visibility: "private", allowedSupplierOrgIds: ["s1"], invitedSupplierOrgIds: [] }, ["s1", "s2", "s2"])).toEqual({ fresh: ["s2"], allowedSupplierOrgIds: ["s1", "s2"], invitedSupplierOrgIds: ["s2"] })
  })

  it("RFQ-15 · «لا عرض حيّاً»: closed empty, or every offer excluded; waiting for a first offer is not it", () => {
    const open = { status: "New", deadline: "2026-10-25" }
    const closed = { status: "New", deadline: "2026-10-20" }
    expect(noLiveOffer(open, [], {}, NOW)).toBeNull()
    expect(noLiveOffer(closed, [], {}, NOW)).toBe("closed_empty")
    expect(noLiveOffer(closed, [{ id: "a" }], {}, NOW)).toBeNull()
    expect(noLiveOffer(open, [{ id: "a" }], { a: { shortlist: null, exclusion: { code: "spec", text: null, at: "", byId: "", byName: "" } } }, NOW)).toBe("all_excluded")
    expect(noLiveOffer(open, [{ id: "a", status: "مرفوض" }], {}, NOW)).toBe("all_excluded")
    expect(noLiveOffer({ status: "Awarded", deadline: "2026-10-20" }, [], {}, NOW)).toBeNull()
    expect(noLiveOffer({ status: "Cancelled" }, [], {}, NOW)).toBeNull()
  })
})

describe("RFQ-14 · extend and reopen", () => {
  beforeEach(() => {
    seedRfq()
    seedOffer("o1", "s1")
    seedOffer("o2", "guest", { isGuestOffer: true })
  })

  it("moves the date, tells EVERY invitee (not only the new ones), logs it and leaves the V2 event", async () => {
    const res = await run({ action: "extend", rfqId: "R1", deadline: "2026-10-30", addSupplierOrgIds: ["s3"] })
    expect(res).toMatchObject({ action: "extend", deadline: "2026-10-30", count: 1, reopened: false })
    expect(rfq()).toMatchObject({ deadline: "2026-10-30", pubVer: 2, invitedSupplierOrgIds: ["s1", "s2", "s3"], allowedSupplierOrgIds: ["s1", "s2", "s3"] })
    expect(rfq().log[0]).toMatchObject({ action: "extended" })
    expect(notices("s1")[0]).toMatchObject({ type: "rfq_extended", rfqId: "R1", i18n: { message: "pn_rfq_extended" } })
    expect(notices("s2")).toHaveLength(1)
    expect(notices("s3")[0].type).toBe("rfq_extended")
    expect(notices("guest")).toHaveLength(0)
    expect(events().some((e) => e.key.endsWith(":V2") && e.payload.change === "extended")).toBe(true)
  })

  it("refuses a date that is not later, one in the past, a closed RFQ, a stranger and a buyer who did not raise it", async () => {
    expect(await refusal(run({ action: "extend", rfqId: "R1", deadline: "2026-10-25" }))).toBe("date_invalid")
    expect(await refusal(run({ action: "extend", rfqId: "R1", deadline: "2026-10-21" }))).toBe("date_invalid")
    seedRfq({ status: "Awarded" }, "R2")
    expect(await refusal(run({ action: "extend", rfqId: "R2", deadline: "2026-11-01" }))).toBe("rfq_not_open")
    expect(await refusal(run({ action: "extend", rfqId: "R1", deadline: "2026-11-01" }, BUYER))).toBe("no_permission")
    expect(await refusal(run({ action: "extend", rfqId: "R1", deadline: "2026-11-01" }, { ...OWNER, uid: "x", orgId: "org9" }))).toBe("no_permission")
    expect(await refusal(run({ action: "extend", rfqId: "nope", deadline: "2026-11-01" }))).toBe("rfq_missing")
  })

  it("a buyer extends the RFQ he raised", async () => {
    seedRfq({ createdByUserId: "buyer" }, "R3")
    expect(await refusal(run({ action: "extend", rfqId: "R3", deadline: "2026-11-01" }, BUYER))).toBeNull()
  })

  it("WF-26 · reopening a closed round (date passed) sets a new date, keeps excluded offers excluded, and the link works again", async () => {
    seedRfq({ deadline: "2026-10-20", closedEarly: { at: "2026-10-19", byId: "x", byName: "x", reason: "r", originalDeadline: "2026-10-25" } }, "R4")
    seedOffer("ox", "s2", { rfqId: "R4", status: "مرفوض" })
    mockDb.seed("offerDecisions/ox", { exclusion: { code: "spec" } })
    mockDb.seed("rfqShareLinks/L1", { rfqId: "R4", revoked: false, expiresWith: "deadline", tokenHashes: [], organizationId: ORG })
    expect(shareLinkState({ expiresWith: "deadline" }, rfq("R4") as never, NOW)).toBe("closed")
    const res = await run({ action: "reopen", rfqId: "R4", deadline: "2026-10-28" })
    expect(res).toMatchObject({ action: "reopen", reopened: true })
    expect(rfq("R4")).toMatchObject({ deadline: "2026-10-28", closedEarly: null })
    expect(shareLinkState({ expiresWith: "deadline" }, rfq("R4") as never, NOW)).toBe("open")
    expect(mockDb.get("offers/ox")).toMatchObject({ status: "مرفوض" })
    expect(mockDb.get("offerDecisions/ox")).toMatchObject({ exclusion: { code: "spec" } })
    expect(notices("s2").find((n) => n.type === "rfq_reopened")).toBeTruthy()
    expect(events().some((e) => e.payload.change === "reopened")).toBe(true)
  })

  it("«مدّد» and «أعد فتحه» are one act: the server reads the date, not the button", async () => {
    seedRfq({ deadline: "2026-10-20" }, "R5")
    expect((await run({ action: "extend", rfqId: "R5", deadline: "2026-10-27" })).reopened).toBe(true)
  })
})

describe("RFQ-15 / R-12 / WF-26 · cancel", () => {
  const publishWithRequest = async () => {
    mockDb.seed("users/eng1", { organizationId: ORG, organizationRole: "member", name: "فهد" })
    const req = await createTeamRequest(
      db(),
      ORG,
      { uid: "eng1", name: "فهد" },
      {
        lines: [
          { name: "حديد 16", unit: "طن", quantity: 12 },
          { name: "رمل لياسة", unit: "م³", quantity: 30 },
        ],
        needBy: "2026-11-10",
        siteId: null,
        place: { label: "مجمع الياسمين", city: "الرياض", district: "" },
        requestedFor: { kind: "member", id: "eng1", name: "فهد" },
      },
      NOW
    )
    const source = { kind: "team_request", purchaseRequestId: req.mrKey.slice("team:".length) }
    const material = { nodeId: "n1", subId: "s1", rootId: "r1", path: [{ ar: "حديد", en: "Steel" }], specs: [] }
    const res = await publishRfq(
      db(),
      OWNER,
      publishSchema.parse({
        title: "حديد ورمل",
        audience: "private",
        deadline: "2026-10-25",
        pricing: "line",
        recipients: ["s1"],
        doc: {
          city: "الرياض",
          products: [
            { name: "حديد 16", quantity: 12, unitOfMeasure: "طن", material, deliveryCity: "الرياض", needSource: source, needLine: 0 },
            { name: "رمل لياسة", quantity: 30, unitOfMeasure: "م³", material, deliveryCity: "الرياض", needSource: source, needLine: 1 },
          ],
        },
      }),
      NOW
    )
    return { req, res }
  }

  it("a reason is required — «سبب آخر» with four letters — and the RFQ stays on record as cancelled", async () => {
    seedRfq()
    expect(await refusal(run({ action: "cancel", rfqId: "R1", code: "other", note: "ab" }))).toBe("reason_required")
    expect(rfq().status).toBe("New")
    await run({ action: "cancel", rfqId: "R1", code: "other", note: "تغيّر قرار الإدارة" })
    expect(rfq()).toMatchObject({ status: "Cancelled", cancellation: { code: "other", note: "تغيّر قرار الإدارة", byId: ORG }, pubVer: 2 })
    expect(rfq().log[0]).toMatchObject({ action: "cancelled" })
    expect(await refusal(run({ action: "cancel", rfqId: "R1", code: "need" }))).toBe("rfq_not_open")
  })

  it("tells the invitees AND the bidders (a guest has no inbox): bidders get the result «أُغلق الطلب دون ترسية» with the reason, invitees the cancellation", async () => {
    seedRfq({ allowedSupplierOrgIds: ["s1", "s2"] })
    seedOffer("o3", "s9")
    seedOffer("o1", "s1")
    seedOffer("og", "guest", { isGuestOffer: true })
    seedOffer("ow", "s7", { status: "مسحوب" })
    await run({ action: "cancel", rfqId: "R1", code: "price" })
    for (const u of ["s1", "s9"]) expect(notices(u)[0]).toMatchObject({ type: "rfq_outcome", i18n: { params: { rfq: "2026/011", result: "@pn_rfq_outcome_noaward", reason: "@pn_rfq_outcome_why_price" } } })
    expect(notices("s1")).toHaveLength(1)
    expect(notices("s2")[0]).toMatchObject({ type: "rfq_cancelled", i18n: { params: { reason: "@pn_rfq_cancel_why_price" } } })
    expect(notices("guest")).toHaveLength(0)
    expect(notices("s7")).toHaveLength(0)
    expect(events().some((e) => e.payload.change === "cancelled")).toBe(true)
  })

  it("a comparing round (date passed, offers in) may be cancelled too", async () => {
    seedRfq({ deadline: "2026-10-20" })
    seedOffer("o1", "s1")
    expect(await refusal(run({ action: "cancel", rfqId: "R1", code: "spec" }))).toBeNull()
  })

  it("R-12 · the lines it held go back to «الواردة», the legacy stamp is lifted and the requester is told; a draft or an award is not cancelled", async () => {
    const { req, res } = await publishWithRequest()
    const before = mockDb.get(`procIncoming/${incomingDocId(ORG, req.mrKey)}`) as unknown as IncomingDoc
    expect(before.lines.every((l) => l.ps === "rfq")).toBe(true)
    const out = await run({ action: "cancel", rfqId: res.id, code: "need" })
    expect(out.count).toBe(2)
    const after = mockDb.get(`procIncoming/${incomingDocId(ORG, req.mrKey)}`) as unknown as IncomingDoc
    expect(after.lines.every((l) => !l.ps)).toBe(true)
    expect(after.st).toBe("new")
    expect(mockDb.get(`rfqs/${res.id}`)).toMatchObject({ status: "Cancelled" })
    seedRfq({ status: "Draft" }, "RD")
    seedRfq({ status: "Awarded" }, "RA")
    expect(await refusal(run({ action: "cancel", rfqId: "RD", code: "need" }))).toBe("rfq_not_open")
    expect(await refusal(run({ action: "cancel", rfqId: "RA", code: "need" }))).toBe("rfq_not_open")
  })
})

describe("RFQ-13 · remind the non-bidders", () => {
  beforeEach(() => {
    seedRfq({ reachedOrgIds: ["s3"] })
    seedOffer("o1", "s1")
  })

  it("tells only the invitees and reached suppliers who have not quoted, with a fresh link for the off-platform message", async () => {
    mockDb.seed("rfqShareLinks/L1", { rfqId: "R1", revoked: false, expiresWith: "deadline", tokenHashes: [], organizationId: ORG })
    const res = await run({ action: "remind", rfqId: "R1" })
    expect(res.told).toBe(2)
    expect(notices("s1")).toHaveLength(0)
    expect(notices("s2")[0]).toMatchObject({ type: "rfq_remind" })
    expect(notices("s3")).toHaveLength(1)
    expect(res.link).toMatch(/\/rfq\/[A-Za-z0-9_-]{22}$/)
    expect(await findLinkByToken(db(), "rfq", res.link!.split("/").pop()!)).toMatchObject({ ok: true })
    expect(rfq().log.some((e) => e.action === "reminded")).toBe(true)
  })

  it("nobody to remind and no link is a refusal; a closed round is not reminded", async () => {
    seedOffer("o2", "s2")
    seedOffer("o3", "s3")
    expect(await refusal(run({ action: "remind", rfqId: "R1" }))).toBe("nothing_to_remind")
    seedRfq({ deadline: "2026-10-20" }, "R2")
    expect(await refusal(run({ action: "remind", rfqId: "R2" }))).toBe("rfq_not_open")
  })
})

describe("ED-05 · rename", () => {
  it("renames, logs, and keeps the copies on offers and the link in step", async () => {
    seedRfq()
    seedOffer("o1", "s1")
    mockDb.seed("rfqShareLinks/L1", { rfqId: "R1", rfqTitle: "زوايا حديد" })
    await renameRfq(db(), OWNER, { rfqId: "R1", title: "  زوايا وخشب — الخرج  " }, NOW)
    expect(rfq()).toMatchObject({ title: "زوايا وخشب — الخرج", titleEditedAt: NOW.toISOString() })
    expect(rfq().log[0]).toMatchObject({ action: "renamed" })
    expect(mockDb.get("offers/o1")).toMatchObject({ rfqTitle: "زوايا وخشب — الخرج" })
    expect(mockDb.get("rfqShareLinks/L1")).toMatchObject({ rfqTitle: "زوايا وخشب — الخرج" })
  })

  it("a name of two letters, another buyer's RFQ and a cancelled one are refused", async () => {
    seedRfq()
    expect(await refusal(renameRfq(db(), OWNER, { rfqId: "R1", title: "  ab " }, NOW))).toBe("title_invalid")
    expect(await refusal(renameRfq(db(), BUYER, { rfqId: "R1", title: "اسم جديد" }, NOW))).toBe("no_permission")
    seedRfq({ status: "Cancelled" }, "R2")
    expect(await refusal(renameRfq(db(), OWNER, { rfqId: "R2", title: "اسم جديد" }, NOW))).toBe("rfq_not_open")
  })
})

describe("the routes", () => {
  const post = (route: (r: Request) => Promise<Response>, token: string | null, body: unknown) => route(new NextRequest("http://x/api", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }))

  it("401 without a sign-in, 400 for a body that is not an act, the refusal's reason otherwise", async () => {
    seedRfq()
    expect((await post(lifecycleRoute, null, { action: "remind", rfqId: "R1" })).status).toBe(401)
    expect((await post(lifecycleRoute, `tok:${ORG}`, { action: "explode", rfqId: "R1" })).status).toBe(400)
    const late = await post(lifecycleRoute, `tok:${ORG}`, { action: "extend", rfqId: "R1", deadline: "2026-10-01" })
    expect(late.status).toBe(400)
    expect(await late.json()).toMatchObject({ error: true, reason: "date_invalid" })
    const ok = await post(renameRoute, `tok:${ORG}`, { rfqId: "R1", title: "اسم جديد" })
    expect(await ok.json()).toMatchObject({ success: true, data: { title: "اسم جديد" } })
  })
})
