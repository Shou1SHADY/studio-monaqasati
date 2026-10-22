/** @jest-environment node */
/**
 * Procurement 2.0 — the ORDER LINK (WF-17, MSG-03/04, G-06, G-08, G-17, R-22, R-23, B-14): the buyer's send mints an address whose
 * token is stored only as a hash; the page shows ONE order; the supplier outside the platform accepts, asks for a change, declines
 * (the order stays alive for the buyer), reports a delivery by a day and a note — never a quantity — and writes to the buyer;
 * a cancelled or completed order takes no act. Over the in-memory Admin Firestore.
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

import { POST as send } from "@/app/api/procurement/po/send/route"
import { GET as viewLink } from "@/app/api/po-link/[token]/route"
import { POST as accept } from "@/app/api/po-link/[token]/accept/route"
import { POST as decline } from "@/app/api/po-link/[token]/decline/route"
import { POST as requestChange } from "@/app/api/po-link/[token]/request-change/route"
import { POST as report } from "@/app/api/po-link/[token]/report-delivery/route"
import { POST as reply } from "@/app/api/po-link/[token]/reply/route"
import { POST as acceptVersion } from "@/app/api/po-link/[token]/accept-version/route"
import { POST as me } from "@/app/api/po-link/[token]/me/route"
import { hashToken } from "@/lib/links/hash"
import { mintOrderLink } from "@/lib/procurement/po-link-server"
import { poLinkActs, poLinkState } from "@/lib/po-link"
import { poState } from "@/lib/procurement/po-state"
import { scrubTokens } from "@/lib/sentry-options"
import type { PurchaseOrder } from "@/lib/procurement/types"

const ORG = "org1"
const line = (over: Record<string, unknown> = {}) => ({ id: "l1", name: "رمل أحمر", unit: "م³", quantity: 20, unitPrice: 88, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const order = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/014",
  status: "sent",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "رمل",
  offerId: "o1",
  supplierOrgId: "guest",
  supplierUserId: null,
  supplierName: "مؤسسة الرمال",
  isGuestSupplier: true,
  lines: [line()],
  totalExVat: 1760,
  vatRate: 0.15,
  offersCount: 3,
  lowestOfferTotal: 1760,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: "prep",
  preparedByName: "سعد",
  createdAt: "2026-10-10T08:00:00Z",
  approverKind: "manager",
  approvedById: "mgr",
  approvedByName: "منى",
  approvedAt: "2026-10-11T08:00:00Z",
  sentAt: "2026-10-12T08:00:00Z",
  sentChannel: "whatsapp",
  dueDate: "2026-10-30",
  paymentTerms: "30 يوماً",
  site: { id: "s1", name: "موقع السلي", city: "الرياض", district: "السلي", address: "طريق الخرج", mapUrl: "https://maps.example/x", receiver: { name: "أبو فهد", phone: "0551234567" }, access: { unload: "sup", slot: "صباحاً" } },
  tags: { notLowest: { why: "سرعة التوريد" } },
  log: [{ at: "2026-10-12T08:00:00Z", byId: "mgr", byName: "منى", action: "sent", params: { channel: "whatsapp" } }],
  ...over,
})
const accepted = (over: Record<string, unknown> = {}) => order({ status: "accepted", supplierAcceptedAt: "2026-10-13T08:00:00Z", promisedDate: "2026-10-30", ...over })

let token = ""
const url = (path = "") => `http://localhost/api/po-link/${token}${path}`
const ctx = () => ({ params: Promise.resolve({ token }) })
const post = async (route: (r: NextRequest, c: { params: Promise<{ token: string }> }) => Promise<Response>, body: unknown) => {
  const res = await route(new NextRequest(url(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx())
  return { status: res.status, json: (await res.json()) as { success?: boolean; data?: { view?: Record<string, any> }; code?: string } }
}
const stored = () => mockDb.get("purchaseOrders/po1") as unknown as PurchaseOrder & Record<string, any>
const events = () => mockDb.list("procEvents").map((e) => e.key as string)
const noteTo = (uid: string) => mockDb.list(`users/${uid}/notifications`)

async function open(po: Record<string, unknown>) {
  mockDb.seed("purchaseOrders/po1", po)
  token = (await mintOrderLink(mockDb as never, { id: "po1", organizationId: ORG } as PurchaseOrder))!.split("/po/")[1]
}

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, { [ORG]: { uid: ORG, orgId: ORG, name: "المالك", can: () => true } })
  mockDb.seed("users/org1", { companyName: "البنيان الحديثة" })
  mockDb.seed("users/prep", { organizationId: ORG })
})

describe("the buyer's send hands the composer a real address", () => {
  it("WhatsApp: a 22-character token on /po/, only its hash stored (hash lookup, no plain token anywhere)", async () => {
    mockDb.seed("purchaseOrders/po1", order({ status: "approved", sentAt: null, sentChannel: null, sentById: null }))
    const res = await send(new NextRequest("http://localhost/api/procurement/po/send", { method: "POST", headers: { authorization: `Bearer ${ORG}`, "content-type": "application/json" }, body: JSON.stringify({ poId: "po1", channel: "whatsapp" }) }))
    const json = (await res.json()) as { data?: { link?: string } }
    expect(res.status).toBe(200)
    const link = json.data?.link as string
    expect(link).toMatch(/\/po\/[A-Za-z0-9_-]{22}$/)
    const tok = link.split("/po/")[1]
    const everything = JSON.stringify([...mockDb.docs.values()])
    expect(everything).not.toContain(tok)
    const linkDoc = mockDb.get("orderLinks/po1") as { tokenHashes: string[] }
    expect(linkDoc.tokenHashes).toEqual([hashToken(tok)])
    expect(mockDb.get(`linkTokens/${hashToken(tok)}`)).toMatchObject({ kind: "po", linkId: "po1" })
  })

  it("the portal channel mints nothing", async () => {
    mockDb.seed("purchaseOrders/po1", order({ status: "approved", sentAt: null, supplierOrgId: "sup1", supplierUserId: "su1", isGuestSupplier: false }))
    const res = await send(new NextRequest("http://localhost/api/procurement/po/send", { method: "POST", headers: { authorization: `Bearer ${ORG}`, "content-type": "application/json" }, body: JSON.stringify({ poId: "po1", channel: "portal" }) }))
    expect(((await res.json()) as { data: { link: string | null } }).data.link).toBeNull()
  })
})

describe("what the page shows — one order, nothing else (G-06, B-14)", () => {
  it("shows the order as the supplier reads it: a bare number, the place with its map, the day, the lines and the total incl. VAT", async () => {
    await open(order())
    mockDb.seed("purchaseOrders/po2", order({ docNumber: "PO-2026/099", supplierName: "مورد آخر", totalExVat: 999999 }))
    const res = await viewLink(new NextRequest(url()), ctx())
    expect(res.status).toBe(200)
    const view = ((await res.json()) as { data: { view: Record<string, any> } }).data.view
    expect(view).toMatchObject({ no: "2026/014", company: "البنيان الحديثة", state: "awaiting", dueDate: "2026-10-30", terms: "30 يوماً" })
    expect(view.site).toMatchObject({ city: "الرياض", district: "السلي", mapUrl: "https://maps.example/x" })
    expect(view.total).toEqual({ kind: "incl", amount: 2024, exVat: 1760 })
    expect(view.receiver).toBeNull()
    expect(view.acts).toEqual({ accept: true, requestChange: true, decline: true, report: false, reply: true, acceptVersion: false })
    const text = JSON.stringify(view)
    expect(text).not.toContain("2026/099")
    expect(text).not.toContain("مورد آخر")
    expect(text).not.toContain("منى")
    expect(text).not.toContain("سعد")
    expect(text).not.toContain("سرعة التوريد")
  })

  it("the receiver's name and mobile appear only after he accepts", async () => {
    await open(accepted())
    const view = ((await (await viewLink(new NextRequest(url()), ctx())).json()) as { data: { view: Record<string, any> } }).data.view
    expect(view.receiver).toEqual({ name: "أبو فهد", phone: "0551234567" })
  })

  it("a wrong token opens nothing; an order not sent yet has no page", async () => {
    await open(order())
    token = "x".repeat(22)
    expect((await viewLink(new NextRequest(url()), ctx())).status).toBe(404)
    token = "short"
    expect((await viewLink(new NextRequest(url()), ctx())).status).toBe(400)
    await open(order({ status: "approved", sentAt: null }))
    expect((await viewLink(new NextRequest(url()), ctx())).status).toBe(409)
  })
})

describe("accepting — the date he commits to is the order's", () => {
  it("accepts once: accepted, the due day is his promise, recorded as the link's, the log and the ACC event, the buyer is told", async () => {
    await open(order())
    const res = await post(accept, {})
    expect(res.status).toBe(200)
    expect(res.json.data?.view?.state).toBe("accepted")
    expect(stored()).toMatchObject({ status: "accepted", promisedDate: "2026-10-30", acceptanceRecordedBy: "link" })
    expect(stored().log.at(-1)).toMatchObject({ action: "supplier_accepted", params: { date: "2026-10-30", recordedBy: "link" } })
    expect(events()).toContain("proc:PO:PO-2026/014:V1:ACC")
    expect(noteTo("prep").map((n) => n.type)).toContain("po_supplier_accepted")
    expect((await post(accept, {})).status).toBe(409)
  })

  it("an old order with no due date asks him for one", async () => {
    await open(order({ dueDate: null, requestedDeliveryDate: null }))
    expect((await post(accept, {})).json.code).toBe("DATE_REQUIRED")
    expect((await post(accept, { date: "2026-10-31" })).status).toBe(200)
    expect(stored().promisedDate).toBe("2026-10-31")
  })
})

describe("declining — the order stays alive, red, for the buyer (PO-13, R-23)", () => {
  it("keeps it SENT with the decline on it, tells the buyer, leaves the DEC event — and nothing more can be accepted", async () => {
    await open(order())
    const res = await post(decline, { reason: "date" })
    expect(res.status).toBe(200)
    expect(stored().status).toBe("sent")
    expect(stored().supplierDecline).toMatchObject({ reason: "date", byName: "مؤسسة الرمال" })
    expect(res.json.data?.view?.state).toBe("declined")
    expect(events()).toContain("proc:PO:PO-2026/014:V1:DEC")
    expect(noteTo("prep").map((n) => n.type)).toContain("po_supplier_declined")
    expect(poState(stored() as PurchaseOrder, { notices: [], financeOn: false, acceptanceDays: 1, now: new Date("2026-10-13T08:00:00Z") })).toMatchObject({ k: "dec", who: "us" })
    expect((await post(accept, {})).status).toBe(409)
    expect((await post(decline, { reason: "stock" })).status).toBe(409)
  })

  it("«سبب آخر» needs words", async () => {
    await open(order())
    expect((await post(decline, { reason: "other" })).status).toBe(400)
    expect((await post(decline, { reason: "other", note: "أغلقنا المصنع" })).status).toBe(200)
  })
})

describe("asking for a change — a message the buyer must answer", () => {
  it("is a typed message in the thread and an open ask on the order until the buyer writes back; the order itself is unchanged", async () => {
    await open(order())
    const res = await post(requestChange, { text: "نطلب تأخير التوريد يومين" })
    expect(res.status).toBe(200)
    expect(stored().status).toBe("sent")
    expect(stored().changeAsked).toMatchObject({ seq: 1 })
    const msgs = mockDb.list("poMessages")
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ by: "sup", kind: "change", channel: "link", poId: "po1" })
    expect(String(msgs[0].text)).toContain("نطلب تأخير التوريد يومين")
  })
})

describe("reporting the delivery — a day and a note, never a quantity (G-08, WF-17)", () => {
  it("two reports the same day are two notices, REP1 and REP2, numbered on the order; each is a pending notice without goods", async () => {
    await open(accepted())
    expect((await post(report, { offset: 0, note: "شاحنة أولى 7 صباحاً" })).status).toBe(200)
    expect((await post(report, { offset: 0, note: "شاحنة ثانية" })).status).toBe(200)
    const notices = mockDb.list("deliveries")
    expect(notices.map((n) => n.seq).sort()).toEqual([1, 2])
    expect(events()).toEqual(expect.arrayContaining(["proc:PO:PO-2026/014:REP1", "proc:PO:PO-2026/014:REP2"]))
    for (const n of notices) {
      expect(n).toMatchObject({ poId: "po1", status: "pending_confirmation", reportedBy: "link", isGuestDelivery: true })
      expect(Object.keys(n).filter((k) => /qty|quantit|driver|plate|paper|window|lines|got|accepted/i.test(k) && !/deliveryPersonName/.test(k))).toEqual([])
    }
    expect(stored().noticeSeq).toBe(2)
    expect(stored().log.filter((e: { action: string }) => e.action === "delivery_reported")).toHaveLength(2)
  })

  it("refuses a quantity, a driver or a plate, a day outside today..the day after, and a report before he accepted", async () => {
    await open(accepted())
    expect((await post(report, { offset: 0, qty: 5 })).status).toBe(400)
    expect((await post(report, { offset: 0, driverName: "سالم" })).status).toBe(400)
    expect((await post(report, { offset: 3 })).status).toBe(400)
    await open(order())
    expect((await post(report, { offset: 0 })).status).toBe(409)
  })

  it("the count appears on the link once the receiver counted", async () => {
    await open(accepted())
    await post(report, { offset: 1 })
    const noticeId = mockDb.list("deliveries")[0].id
    mockDb.seed(`deliveries/${noticeId}`, { ...mockDb.get(`deliveries/${noticeId}`), closedByReceipt: { deliveryId: "r1", docNumber: "GR-2026/001" } })
    mockDb.seed("deliveries/r1", { poId: "po1", status: "confirmed", docNumber: "GR-2026/001", lines: [{ accepted: 18, rejected: 2 }] })
    const view = ((await (await viewLink(new NextRequest(url()), ctx())).json()) as { data: { view: Record<string, any> } }).data.view
    expect(view.notices[0].count).toEqual({ accepted: 18, rejected: 2 })
  })
})

describe("a cancelled or completed order takes no act (G-17, R-22)", () => {
  it("cancelled: every act is refused, the page says so with the reason, the conversation is read-only", async () => {
    await open(order({ status: "cancelled", cancelledReason: "لم تعد الحاجة قائمة", log: [{ at: "2026-10-14T08:00:00Z", byId: ORG, byName: "المالك", action: "cancelled", note: "لم تعد الحاجة قائمة" }] }))
    const view = ((await (await viewLink(new NextRequest(url()), ctx())).json()) as { data: { view: Record<string, any> } }).data.view
    expect(view.state).toBe("cancelled")
    expect(view.cancel).toMatchObject({ why: "لم تعد الحاجة قائمة" })
    expect(Object.values(view.acts).every((v) => v === false)).toBe(true)
    for (const [route, body] of [[accept, {}], [decline, { reason: "stock" }], [requestChange, { text: "تعديل" }], [report, { offset: 0 }], [reply, { text: "مرحبا" }]] as const) {
      expect((await post(route as never, body)).status).toBe(409)
    }
    expect(mockDb.list("poMessages")).toHaveLength(0)
  })

  it("completed: no accept and no report; a word is still allowed", () => {
    const done = order({ status: "accepted", supplierAcceptedAt: "x", lines: [line({ accepted: 20 })] }) as unknown as PurchaseOrder
    expect(poLinkState(done)).toBe("complete")
    expect(poLinkActs(done)).toMatchObject({ accept: false, decline: false, report: false, reply: true })
  })
})

describe("replying — the conversation, from the link", () => {
  it("stores his message as the supplier's, on the link channel, and keeps the order's summary (the buyer has an unread)", async () => {
    await open(order())
    const res = await post(reply, { text: "وصلني الأمر، سأؤكد غداً" })
    expect(res.status).toBe(200)
    expect(res.json.data?.view?.thread.some((i: { sys: boolean; message?: { by: string } }) => !i.sys && i.message?.by === "sup")).toBe(true)
    expect(stored().chat).toMatchObject({ seq: 1, supSeq: 1, usSeq: 0, lastBy: "sup" })
    expect(events()).toContain("proc:PO:PO-2026/014:MSG1:SUP")
    expect(noteTo("prep").map((n) => n.type)).toContain("doc_comment")
  })

  it("an empty message and a file that is not this order's are refused", async () => {
    await open(order())
    expect((await post(reply, { text: "   " })).status).toBe(400)
    const foreign = await post(reply, { text: "x", file: { name: "a.pdf", url: "https://evil.example/a.pdf" } })
    expect([foreign.status, foreign.json.code]).toEqual([400, "FILE_NOT_YOURS"])
    expect(mockDb.list("poMessages")).toHaveLength(0)
    const ok = "https://firebasestorage.googleapis.com/v0/b/bkt/o/" + encodeURIComponent("organizations/org1/po/po1/chat/1-a.pdf") + "?alt=media&token=t"
    expect((await post(reply, { text: "ملف", file: { name: "a.pdf", url: ok } })).status).toBe(200)
  })

  it("opening the conversation marks what the buyer wrote as read", async () => {
    await open(order({ chat: { seq: 1, usSeq: 1, supSeq: 0, lastAt: "2026-10-13T08:00:00Z", lastText: "ننتظر قبولك", lastBy: "us", lastFile: false, readBy: {}, supReadSeq: 0 } }))
    mockDb.seed("poMessages/po1__1", { poId: "po1", organizationId: ORG, supplierOrgId: "guest", seq: 1, by: "us", authorId: "prep", authorName: "سعد", text: "ننتظر قبولك", file: null, channel: "whatsapp", at: "2026-10-13T08:00:00Z" })
    const before = ((await (await viewLink(new NextRequest(url()), ctx())).json()) as { data: { view: Record<string, any> } }).data.view
    expect(before.unread).toBe(1)
    const res = await post(me, {})
    expect(res.json.data?.view?.unread).toBe(0)
    expect(stored().chat.supReadSeq).toBe(1)
    const again = ((await (await viewLink(new NextRequest(url()), ctx())).json()) as { data: { view: Record<string, any> } }).data.view
    expect(again.thread.find((i: { sys: boolean; message?: { by: string; authorName: string } }) => !i.sys && i.message?.by === "us").message.authorName).toBe("البنيان الحديثة")
  })
})

describe("a version he accepts (PO-15)", () => {
  it("the buyer's new date waits for «قبلت الإصدار 2»; accepting stamps the version and leaves the ACC event", async () => {
    await open(accepted({ ver: 2, versions: [{ n: 1, at: "2026-10-12T08:00:00Z", byName: "منى", kind: "sent", acceptedAt: "2026-10-13T08:00:00Z" }, { n: 2, at: "2026-10-15T08:00:00Z", byName: "منى", kind: "date", params: { date: "2026-11-02" } }] }))
    const view = ((await (await viewLink(new NextRequest(url()), ctx())).json()) as { data: { view: Record<string, any> } }).data.view
    expect(view.pendingVersion).toMatchObject({ n: 2, kind: "date", date: "2026-11-02" })
    expect((await post(acceptVersion, { version: 3 })).status).toBe(409)
    expect((await post(acceptVersion, { version: 2 })).status).toBe(200)
    expect(stored().versions?.[1]?.acceptedAt).toBeTruthy()
    expect(events()).toContain("proc:PO:PO-2026/014:V2:ACC")
  })
})

describe("the link's own cap", () => {
  it("the 121st act in an hour is refused with a wait", async () => {
    await open(order())
    let last = 0
    for (let i = 0; i < 121; i++) last = (await post(me, {})).status
    expect(last).toBe(429)
  })
})

describe("the token never reaches Sentry", () => {
  it("masks the page and the API address of an order link", () => {
    expect(scrubTokens("https://x.sa/po/AbCdEfGhIjKlMnOpQrStUv")).toBe("https://x.sa/po/[token]")
    expect(scrubTokens("/api/po-link/AbCdEfGhIjKlMnOpQrStUv/report-delivery")).toBe("/api/po-link/[token]/report-delivery")
  })
})
