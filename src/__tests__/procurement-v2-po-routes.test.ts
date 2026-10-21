/** @jest-environment node */
/**
 * Procurement 2.0 — the purchase order's acts as SERVER routes (WP-S4-07 / WP-S4-09): the limit compared INCLUDING VAT (G-18),
 * the preparer never approves his own order (the owner excepted), a direct award above the cap is the owner's with its reason
 * (G-16 / R-36), an order is sent only once approved and an off-platform supplier gets the order LINK message (B-08: nothing is
 * sent from here), cancelling takes a structured reason and a choice for the materials as a NEW VERSION (WF-25 / R-11 / R-22),
 * closing short and a new date are versions the supplier accepts (PO-15), and an advance to a supplier with no record waits for
 * the owner before Finance is asked for it (PO-14). Over the fake Admin Firestore, one transaction per act.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => (t === "bad" ? Promise.reject(new Error("bad")) : { uid: t }) }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ file: () => ({ save: async () => undefined }) }) }),
  getStorageBucketName: () => "bkt",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => ({ union: xs }), serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: async (_db: unknown, uid: string) => mockCallers[uid] ?? null }))

import { POST as approve } from "@/app/api/procurement/po/approve/route"
import { POST as returnPo } from "@/app/api/procurement/po/return/route"
import { POST as send } from "@/app/api/procurement/po/send/route"
import { POST as cancel } from "@/app/api/procurement/po/cancel/route"
import { POST as closeShort } from "@/app/api/procurement/po/close-short/route"
import { POST as rejectDecision } from "@/app/api/procurement/po/reject-decision/route"
import { POST as advanceApprove } from "@/app/api/procurement/po/advance-approve/route"
import { POST as changeDate } from "@/app/api/procurement/po/date/route"
import { POST as acceptVersion } from "@/app/api/procurement/po/accept-version/route"
import { approveOnAwardAllowed, cancelOrder, poCtx, sendOrder } from "@/lib/procurement/po-server"
import { poLinkUrl } from "@/lib/procurement/po-server"
import { poState, poVer } from "@/lib/procurement/po-state"
import type { PurchaseOrder } from "@/lib/procurement/types"

const ORG = "org1"
const NOW = new Date("2026-10-19T09:00:00Z")
const can = (...ps: string[]) => (p: string) => ps.includes(p)
const person = (uid: string, orgId: string, name: string, perms: string[] | "all") => ({ uid, orgId, name, can: perms === "all" ? () => true : can(...perms) })

const line = (over: Record<string, unknown> = {}) => ({ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const order = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/001",
  status: "awaiting_approval",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "حديد",
  offerId: "o1",
  supplierOrgId: "sup1",
  supplierUserId: "su1",
  supplierName: "مصنع الجودة",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 30000,
  vatRate: 0.15,
  offersCount: 3,
  lowestOfferTotal: 30000,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: "prep",
  preparedByName: "سعد",
  createdAt: "2026-10-10T08:00:00Z",
  approverKind: "manager",
  approvedAt: null,
  returnedReason: null,
  leadTimeDays: 10,
  log: [],
  ...over,
})
const approved = (over: Record<string, unknown> = {}) => order({ status: "approved", approvedById: "mgr", approvedByName: "منى", approvedAt: "2026-10-11T08:00:00Z", ...over })
const sentOrder = (over: Record<string, unknown> = {}) => approved({ status: "sent", sentAt: "2026-10-12T08:00:00Z", sentChannel: "portal", ...over })
const accepted = (over: Record<string, unknown> = {}) => sentOrder({ status: "accepted", supplierAcceptedAt: "2026-10-13T08:00:00Z", promisedDate: "2026-10-30", ...over })

const req = (path: string, user: string, body: unknown) => new NextRequest(`http://localhost/api/procurement/po/${path}`, { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) })
const run = async (route: (r: NextRequest) => Promise<Response>, path: string, user: string, body: Record<string, unknown>) => {
  const res = await route(req(path, user, { poId: "po1", ...body }))
  return { status: res.status, json: (await res.json()) as { success?: boolean; data?: Record<string, unknown>; reason?: string; code?: string; error?: boolean } }
}
const stored = () => mockDb.get("purchaseOrders/po1") as unknown as PurchaseOrder & Record<string, unknown>
const events = () => mockDb.list("procEvents").map((e) => e.key as string)
const noteTo = (uid: string) => mockDb.list(`users/${uid}/notifications`)

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, {
    [ORG]: person(ORG, ORG, "المالك", "all"),
    mgr: person("mgr", ORG, "منى", ["po.approve", "offers.accept", "po.expedite"]),
    prep: person("prep", ORG, "سعد", ["offers.accept", "po.expedite", "po.approve"]),
    clerk: person("clerk", ORG, "ريم", ["offers.accept", "po.expedite"]),
    stranger: person("stranger", "org2", "غريب", "all"),
    su1: person("su1", "sup1", "سامر", "all"),
    other: person("other", "sup9", "مورد آخر", "all"),
  })
  mockDb.seed("users/su1", { organizationId: "sup1" })
})

describe("approving — the limit includes VAT (G-18), never your own order, the owner above the limit", () => {
  it("an order whose figure is under the limit EXCLUDING VAT but over it INCLUDING VAT goes to the owner", async () => {
    mockDb.seed("purchaseOrders/po1", order({ totalExVat: 140000, lines: [line({ quantity: 1, unitPrice: 140000 })], approverKind: "owner" }))
    const manager = await run(approve, "approve", "mgr", {})
    expect(manager.status).toBe(409)
    expect(manager.json.reason).toBe("above_limit")
    expect(stored().status).toBe("awaiting_approval")
    const owner = await run(approve, "approve", ORG, {})
    expect(owner.status).toBe(200)
    expect(stored().status).toBe("sent")
  })
  it("a manager approves what is within the limit, the order is sent on the portal in his name, Finance and the receivers are told, the history is written", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    const res = await run(approve, "approve", "mgr", {})
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ poId: "po1", status: "sent", ver: 1 })
    const po = stored()
    expect(po).toMatchObject({ approvedById: "mgr", sentById: "mgr", sentChannel: "portal" })
    expect(po.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(po.versions?.[0]).toMatchObject({ n: 1, kind: "sent" })
    expect(po.log.map((e) => e.action)).toEqual(["approved", "sent"])
    expect(noteTo("su1").some((n) => n.type === "po_sent")).toBe(true)
    expect(events()).toEqual(expect.arrayContaining(["proc:PO:PO-2026/001:V1:FIN", "proc:PO:PO-2026/001:V1:INV", "proc:PO:PO-2026/001:V1"]))
    expect(mockDb.list("priceHistory")).toHaveLength(1)
  })
  it("G-16 · the preparer never approves his own order — the owner may, and it is logged as his own", async () => {
    mockDb.seed("purchaseOrders/po1", order({ preparedById: "mgr" }))
    const own = await run(approve, "approve", "mgr", {})
    expect(own.json.reason).toBe("own_order")
    mockDb.seed("purchaseOrders/po1", order({ preparedById: ORG, approverKind: "owner" }))
    const owner = await run(approve, "approve", ORG, {})
    expect(owner.status).toBe(200)
    expect(stored().log[0].params).toMatchObject({ selfApproved: 1 })
  })
  it("a clerk without the approval permission is refused; another company's order does not exist", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    expect((await run(approve, "approve", "clerk", {})).json.reason).toBe("no_permission")
    expect((await run(approve, "approve", "stranger", {})).status).toBe(404)
  })
  it("R-36 · a direct award above the cap needs its reason and the owner alone approves it", async () => {
    mockDb.seed("purchaseOrders/po1", order({ basis: "direct", rfqId: null, offerId: null, totalExVat: 10950, lines: [line({ quantity: 10, unitPrice: 1095 })], awardReasonText: null }))
    expect((await run(approve, "approve", ORG, {})).json.reason).toBe("reason_required")
    mockDb.seed("purchaseOrders/po1", order({ basis: "direct", rfqId: null, offerId: null, totalExVat: 10950, lines: [line({ quantity: 10, unitPrice: 1095 })], awardReasonText: "مورّد وحيد لهذه المادة" }))
    expect((await run(approve, "approve", "mgr", {})).json.reason).toBe("owner_only")
    expect((await run(approve, "approve", ORG, {})).status).toBe(200)
  })
  it("«اعتمده الآن بصفتك المالك» is the owner's alone", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    expect((await run(approve, "approve", "mgr", { asOwner: true })).json.reason).toBe("owner_only")
    expect(approveOnAwardAllowed({ isOwner: true })).toBe(true)
    expect(approveOnAwardAllowed({ isOwner: false })).toBe(false)
  })
  it("a guest supplier's order waits to be sent: the preparer is told to send it, nothing is sent", async () => {
    mockDb.seed("purchaseOrders/po1", order({ isGuestSupplier: true, supplierOrgId: "guest", supplierUserId: null }))
    const res = await run(approve, "approve", "mgr", {})
    expect(res.json.data).toMatchObject({ status: "approved" })
    expect(noteTo("prep").some((n) => n.type === "po_ready_to_send")).toBe(true)
  })
  it("without a token nothing happens; a bad request is a 400", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    expect((await approve(new NextRequest("http://localhost/x", { method: "POST", body: "{}" }))).status).toBe(401)
    expect((await approve(req("approve", "mgr", { nope: 1 }))).status).toBe(400)
  })
  it("return: with a reason, to its preparer; the order stays awaiting approval", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    expect((await run(returnPo, "return", "mgr", { reason: "" })).status).toBe(400)
    expect((await run(returnPo, "return", "mgr", { reason: "السعر مرتفع" })).status).toBe(200)
    expect(stored()).toMatchObject({ status: "awaiting_approval", returnedReason: "السعر مرتفع" })
    expect(noteTo("prep").some((n) => n.type === "po_returned")).toBe(true)
  })
})

describe("PO-14 · an advance to a supplier with no supply record waits for the owner", () => {
  it("approval stamps the gate and Finance is NOT asked; the owner approves it, then Finance is", async () => {
    mockDb.seed("purchaseOrders/po1", order({ advancePercent: 30, isGuestSupplier: true, supplierOrgId: "guest", supplierUserId: null }))
    await run(approve, "approve", "mgr", {})
    expect(stored().advanceOwner).toEqual({ required: true, approvedAt: null })
    expect(events().some((k) => k.startsWith("proc:ADV:"))).toBe(false)
    expect((await run(advanceApprove, "advance-approve", "mgr", {})).json.reason).toBe("owner_only")
    const ok = await run(advanceApprove, "advance-approve", ORG, {})
    expect(ok.status).toBe(200)
    expect(stored().advanceOwner).toMatchObject({ required: true, approvedById: ORG })
    expect(stored().log.at(-1)?.action).toBe("advance_owner_approved")
    expect(events()).toContain("proc:ADV:ADV-2026/001")
    expect((await run(advanceApprove, "advance-approve", ORG, {})).json.reason).toBe("advance_not_waiting")
  })
  it("a supplier we have delivered with before is not gated, and Finance is asked at once", async () => {
    mockDb.seed("purchaseOrders/old", order({ status: "closed", supplierAcceptedAt: "2026-01-01T00:00:00Z", docNumber: "PO-2026/000" }))
    mockDb.seed("purchaseOrders/po1", order({ advancePercent: 30 }))
    await run(approve, "approve", "mgr", {})
    expect(stored().advanceOwner).toBeUndefined()
    expect(events()).toContain("proc:ADV:ADV-2026/001")
  })
  it("the policy off lets every advance go to Finance", async () => {
    mockDb.seed("procurementSettings/org1", { advanceUnknownSupplierOwner: false })
    mockDb.seed("purchaseOrders/po1", order({ advancePercent: 30 }))
    await run(approve, "approve", "mgr", {})
    expect(stored().advanceOwner).toBeUndefined()
  })
})

describe("sending — only once approved; the portal for a registered supplier, the order LINK message for an off-platform one", () => {
  it("an order awaiting approval is never sent (G-16)", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    expect((await run(send, "send", "mgr", { channel: "whatsapp" })).json.reason).toBe("wrong_state")
    expect(stored().status).toBe("awaiting_approval")
  })
  it("a guest has no portal to send to", async () => {
    mockDb.seed("purchaseOrders/po1", approved({ isGuestSupplier: true, supplierOrgId: "guest", supplierUserId: null }))
    expect((await run(send, "send", "mgr", { channel: "portal" })).json.reason).toBe("no_portal")
  })
  it("WhatsApp: the dispatch is recorded as version 1 with the channel, and the answer carries the link when wave C mints one", async () => {
    mockDb.seed("purchaseOrders/po1", approved({ isGuestSupplier: true, supplierOrgId: "guest", supplierUserId: null }))
    const res = await run(send, "send", "mgr", { channel: "whatsapp", contact: { phone: "0551234567" } })
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ status: "sent", ver: 1, link: null })
    expect(stored()).toMatchObject({ status: "sent", sentChannel: "whatsapp", sentById: "mgr" })
    expect(events()).toContain("proc:PO:PO-2026/001:V1")
    mockDb.seed("purchaseOrders/po2", approved({ isGuestSupplier: true, supplierOrgId: "guest", supplierUserId: null, docNumber: "PO-2026/002" }))
    const ctx = await poCtx(mockDb as never, mockCallers.mgr as never, { now: NOW, mintOrderLink: async () => poLinkUrl("abcdefghijklmnopqrstuv") })
    const linked = await sendOrder(ctx, { poId: "po2", channel: "whatsapp" })
    expect(linked.link).toBe("https://mdmaktech.sa/po/abcdefghijklmnopqrstuv")
  })
  it("«أُرسل خارج النظام» records the fact with no channel", async () => {
    mockDb.seed("purchaseOrders/po1", approved())
    await run(send, "send", "mgr", { channel: "outside" })
    expect(stored()).toMatchObject({ status: "sent", sentChannel: null })
    expect(stored().log.at(-1)?.params).toMatchObject({ outside: 1 })
  })
  it("B-08 · nothing in the server code reaches a WhatsApp API", () => {
    const fs = jest.requireActual("fs") as typeof import("fs")
    const files = ["src/lib/procurement/po-server.ts", "src/lib/procurement/po-route.ts", "src/lib/procurement/po-client.ts"]
    for (const f of files) expect(fs.readFileSync(f, "utf8")).not.toMatch(/graph\.facebook|api\.whatsapp|sendBeacon/)
  })
})

describe("WF-25 · cancel with a reason and what happens to its materials — a new version", () => {
  it("a supplier who did not accept in time: cancelled as version 2, the choice recorded for the re-award, Finance and Inventory get the version", async () => {
    mockDb.seed("purchaseOrders/po1", sentOrder({ supplierAcceptedAt: null }))
    const res = await run(cancel, "cancel", "mgr", { why: "nacc", then: "reaward" })
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ status: "cancelled", ver: 2 })
    const po = stored()
    expect(po.cancelledReason).toBe("لم يقبله المورد في مهلته")
    expect(po.cancelChoice).toMatchObject({ why: "nacc", then: "reaward", version: 2, resolved: false })
    expect(po.versions?.map((v) => v.kind)).toEqual(["sent", "cancel"])
    expect(po.log.at(-1)).toMatchObject({ action: "cancelled", note: "لم يقبله المورد في مهلته", params: { why: "nacc", then: "reaward", ver: 2 } })
    expect(events()).toEqual(expect.arrayContaining(["proc:PO:PO-2026/001:V2", "proc:PO:PO-2026/001:V2:FIN", "proc:PO:PO-2026/001:V2:INV"]))
    expect(noteTo("su1").some((n) => n.type === "po_cancelled")).toBe(true)
  })
  it("the buyer's words win for «سبب آخر», which needs them; the English reason reads in English", async () => {
    mockDb.seed("purchaseOrders/po1", sentOrder())
    expect((await run(cancel, "cancel", "mgr", { why: "other", note: "ab", then: "back" })).json.reason).toBe("reason_required")
    expect((await run(cancel, "cancel", "mgr", { why: "other", note: "تغيّر التصميم", then: "back" })).status).toBe(200)
    expect(stored().cancelledReason).toBe("تغيّر التصميم")
    mockDb.seed("purchaseOrders/po1", sentOrder({ docNumber: "PO-2026/009" }))
    await run(cancel, "cancel", "mgr", { why: "need", then: "back", locale: "en" })
    expect(stored().cancelledReason).toBe("No longer needed")
  })
  it("R-11 · «لا شيء» is refused for an order whose items came from a request; re-award needs an RFQ", async () => {
    mockDb.seed("purchaseOrders/po1", sentOrder({ purchaseSource: { kind: "project_request", projectId: "p1" } }))
    expect((await run(cancel, "cancel", "mgr", { why: "need", then: "none" })).json.reason).toBe("items_pending")
    mockDb.seed("purchaseOrders/po1", sentOrder({ rfqId: null, offerId: null, basis: "direct" }))
    expect((await run(cancel, "cancel", "mgr", { why: "need", then: "reaward" })).json.reason).toBe("no_rfq")
    expect((await run(cancel, "cancel", "mgr", { why: "need", then: "none" })).status).toBe(200)
  })
  it("nothing received may be cancelled; a cancelled order cannot be cancelled again (R-22: no acts on it)", async () => {
    mockDb.seed("purchaseOrders/po1", accepted({ lines: [line({ accepted: 3 })] }))
    expect((await run(cancel, "cancel", "mgr", { why: "need", then: "back" })).json.reason).toBe("has_receipts")
    mockDb.seed("purchaseOrders/po1", accepted())
    await run(cancel, "cancel", "mgr", { why: "need", then: "back" })
    expect((await run(cancel, "cancel", "mgr", { why: "need", then: "back" })).json.reason).toBe("already_cancelled")
    expect((await run(send, "send", "mgr", { channel: "outside" })).json.reason).toBe("wrong_state")
    expect((await run(changeDate, "date", "mgr", { date: "2026-11-01" })).json.reason).toBe("wrong_state")
  })
  it("the typed hook receives the choice and the version (wave C's seam)", async () => {
    mockDb.seed("purchaseOrders/po1", sentOrder())
    const seen: unknown[] = []
    const ctx = await poCtx(mockDb as never, mockCallers.mgr as never, { now: NOW })
    await cancelOrder(ctx, { poId: "po1", why: "chg", then: "back" }, async (_db, po, choice) => void seen.push({ id: po.id, ...choice }))
    expect(seen).toEqual([{ id: "po1", then: "back", why: "chg", version: 2 }])
  })
  it("R-23 · a supplier who declined keeps the order live; the buyer cancels it with «اعتذر المورّد»", async () => {
    mockDb.seed("purchaseOrders/po1", sentOrder({ supplierDecline: { at: "2026-10-14T08:00:00Z", reason: "price", byId: "su1", byName: "سامر" } }))
    const po = { ...stored(), id: "po1" }
    expect(poState(po, { notices: [], financeOn: true, acceptanceDays: 1, now: NOW })).toMatchObject({ k: "dec", who: "us" })
    expect((await run(cancel, "cancel", "mgr", { why: "dec", then: "reaward" })).status).toBe(200)
    expect(stored().supplierDecline).toBeTruthy()
    expect(stored().status).toBe("cancelled")
  })
  it("a buyer acts on his own orders; the owner reads others' (R-26) — and another company's order is not there", async () => {
    mockDb.seed("purchaseOrders/po1", sentOrder({ preparedById: "someone-else" }))
    expect((await run(cancel, "cancel", "clerk", { why: "need", then: "back" })).json.reason).toBe("not_your_order")
    expect((await run(cancel, "cancel", "stranger", { why: "need", then: "back" })).status).toBe(404)
  })
})

describe("PO-10 / PO-15 · closing short and a new date are versions; the supplier accepts them", () => {
  it("close short: needs its reason and something still owed; the supplier is told", async () => {
    mockDb.seed("purchaseOrders/po1", accepted({ lines: [line({ accepted: 6 })] }))
    expect((await run(closeShort, "close-short", "mgr", { reason: "" })).status).toBe(400)
    const res = await run(closeShort, "close-short", "mgr", { reason: "لن يصل الباقي" })
    expect(res.json.data).toMatchObject({ status: "closed", ver: 2 })
    expect(stored()).toMatchObject({ closedShort: true, closeReason: "لن يصل الباقي" })
    expect(stored().versions?.at(-1)).toMatchObject({ kind: "close_short", n: 2 })
    expect(events()).toContain("proc:PO:PO-2026/001:V2")
    expect(noteTo("su1").some((n) => n.type === "po_closed")).toBe(true)
    mockDb.seed("purchaseOrders/po1", accepted({ lines: [line({ accepted: 10 })] }))
    expect((await run(closeShort, "close-short", "mgr", { reason: "x" })).json.reason).toBe("wrong_state")
  })
  it("a new date is version 2; only HIS supplier accepts it, once; the acceptance is on the order and in the outbox", async () => {
    mockDb.seed("purchaseOrders/po1", accepted())
    expect((await run(changeDate, "date", "mgr", { date: "not-a-date" })).status).toBe(400)
    const res = await run(changeDate, "date", "mgr", { date: "2026-11-05", note: "تأخر المصنع" })
    expect(res.json.data).toMatchObject({ ver: 2 })
    expect(stored()).toMatchObject({ promisedDate: "2026-11-05" })
    expect(poVer(stored())).toBe(2)
    expect(noteTo("su1").some((n) => n.type === "po_date_updated")).toBe(true)

    expect((await run(acceptVersion, "accept-version", "other", { version: 2 })).json.reason).toBe("not_your_order")
    expect((await run(acceptVersion, "accept-version", "su1", { version: 3 })).json.reason).toBe("version_missing")
    const ok = await run(acceptVersion, "accept-version", "su1", { version: 2 })
    expect(ok.status).toBe(200)
    expect(stored().versions?.find((v) => v.n === 2)).toMatchObject({ acceptedByName: "سامر" })
    expect(stored().log.at(-1)).toMatchObject({ action: "version_accepted", params: { ver: 2 } })
    expect(events()).toContain("proc:PO:PO-2026/001:V2:ACC")
    expect((await run(acceptVersion, "accept-version", "su1", { version: 2 })).json.reason).toBe("version_missing")
    expect(noteTo(ORG).concat(noteTo("prep")).some((n) => n.type === "po_supplier_accepted")).toBe(true)
  })
})

describe("a rejected quantity is a decision with the supplier", () => {
  it("replace keeps it owed; reduce cancels it; a discount needs a price; an order with no reject refuses", async () => {
    mockDb.seed("purchaseOrders/po1", accepted({ lines: [line({ accepted: 6, rejected: 2 })] }))
    expect((await run(rejectDecision, "reject-decision", "mgr", { lineId: "l1", decision: "discount" })).json.reason).toBe("price_missing")
    const res = await run(rejectDecision, "reject-decision", "mgr", { lineId: "l1", decision: "replace", replaceBy: "2026-11-01", note: "بديل" })
    expect(res.status).toBe(200)
    expect(stored().lines[0]).toMatchObject({ rejectDecision: "replace", rejectReplaceBy: "2026-11-01" })
    expect(events()).toContain("proc:PO:PO-2026/001:REJ1")
    mockDb.seed("purchaseOrders/po1", accepted({ lines: [line({ accepted: 6 })] }))
    expect((await run(rejectDecision, "reject-decision", "mgr", { lineId: "l1", decision: "reduce" })).json.reason).toBe("nothing_rejected")
    expect((await run(rejectDecision, "reject-decision", "mgr", { lineId: "nope", decision: "reduce" })).json.reason).toBe("line_missing")
  })
})

describe("the outbox follows the package: a company without Finance sends no commitment", () => {
  it("with Finance off no commitment is queued; the order's own version and its arrival still are", async () => {
    mockDb.seed(`companyModules/${ORG}`, { off: ["payments"] })
    mockDb.seed("purchaseOrders/po1", order())
    await run(approve, "approve", "mgr", {})
    expect(events().sort()).toEqual(["proc:PO:PO-2026/001:V1", "proc:PO:PO-2026/001:V1:INV"])
  })
})
