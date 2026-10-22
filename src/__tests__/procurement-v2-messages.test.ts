/** @jest-environment node */
/**
 * Procurement 2.0 — the order's conversation (MSG-01…05, WF-19, B-08): one thread per sent order between its company and its
 * supplier; messages are written only by the routes; the order's own facts (sent · accepted · reported · receipt) are read off its
 * log and never stored; «محادثاتي» lists the sent orders unread first with a search by supplier or number; a cancelled order is
 * read-only; nothing in `src/` talks to WhatsApp's servers.
 */

import fs from "node:fs"
import path from "node:path"
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

import { POST as message } from "@/app/api/procurement/po/message/route"
import { POST as markRead } from "@/app/api/procurement/po/message/read/route"
import { POST as linkRoute } from "@/app/api/procurement/po/message/link/route"
import { chatRows, orderFacts, threadOf, unreadChatCount, unreadForBuyer, unreadForSupplier, changeAskOpen, type PoMessage, type PoWithChat } from "@/lib/procurement/po-messages"
import type { PurchaseOrder } from "@/lib/procurement/types"

const ORG = "org1"
const person = (uid: string, orgId: string, name: string, perms: string[] | "all") => ({ uid, orgId, name, can: perms === "all" ? () => true : (p: string) => perms.includes(p) })
const order = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/008",
  status: "sent",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "حديد",
  offerId: "o1",
  supplierOrgId: "sup1",
  supplierUserId: "su1",
  supplierName: "مصنع الجودة",
  isGuestSupplier: false,
  lines: [{ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0 }],
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
  approvedAt: "2026-10-11T08:00:00Z",
  sentAt: "2026-10-12T08:00:00Z",
  sentChannel: "portal",
  log: [{ at: "2026-10-12T08:00:00Z", byId: "mgr", byName: "منى", action: "sent", params: { channel: "portal" } }],
  ...over,
})

const run = async (route: (r: NextRequest) => Promise<Response>, user: string, body: unknown, path = "message") => {
  const res = await route(new NextRequest(`http://localhost/api/procurement/po/${path}`, { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
  return { status: res.status, json: (await res.json()) as { success?: boolean; data?: Record<string, unknown>; reason?: string; code?: string } }
}
const stored = () => mockDb.get("purchaseOrders/po1") as unknown as PoWithChat & Record<string, any>
const noteTo = (uid: string) => mockDb.list(`users/${uid}/notifications`)

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, {
    [ORG]: person(ORG, ORG, "المالك", "all"),
    clerk: person("clerk", ORG, "ريم", ["po.expedite"]),
    viewer: person("viewer", ORG, "قارئ", []),
    su1: person("su1", "sup1", "سامر", "all"),
    other: person("other", "sup9", "مورد آخر", "all"),
    stranger: person("stranger", "org2", "غريب", "all"),
  })
  mockDb.seed("users/su1", { organizationId: "sup1" })
  mockDb.seed("users/prep", { organizationId: ORG })
})

describe("writing — the side is read from the caller and the order, never from the request", () => {
  it("the buyer's team writes: stored, numbered, the summary kept, the MSG event left, the registered supplier told", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    const res = await run(message, ORG, { poId: "po1", text: "متى تصل الشحنة الأولى؟" })
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ poId: "po1", seq: 1 })
    expect(mockDb.get("poMessages/po1__1")).toMatchObject({ by: "us", authorId: ORG, text: "متى تصل الشحنة الأولى؟", organizationId: ORG, supplierOrgId: "sup1", channel: "portal" })
    expect(stored().chat).toMatchObject({ seq: 1, usSeq: 1, supSeq: 0, lastBy: "us", lastText: "متى تصل الشحنة الأولى؟" })
    expect(mockDb.list("procEvents").map((e) => e.key)).toContain("proc:PO:PO-2026/008:MSG1")
    expect(noteTo("su1").map((n) => n.type)).toEqual(["doc_comment"])
  })

  it("the registered supplier answers from his portal: his side, the other event, the buyer's preparer told, unread for the team", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    await run(message, ORG, { poId: "po1", text: "؟" })
    const res = await run(message, "su1", { poId: "po1", text: "نجهّزها خلال 10 أيام" })
    expect(res.status).toBe(200)
    expect(mockDb.get("poMessages/po1__2")).toMatchObject({ by: "sup", authorId: "su1" })
    expect(mockDb.list("procEvents").map((e) => e.key)).toContain("proc:PO:PO-2026/008:MSG2:SUP")
    expect(noteTo("prep").map((n) => n.type)).toContain("doc_comment")
    expect(unreadForBuyer(stored(), "clerk")).toBe(true)
    expect(unreadForBuyer(stored(), ORG)).toBe(true)
  })

  it("a stranger, another supplier and a member with no right to talk to suppliers are refused", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    expect((await run(message, "stranger", { poId: "po1", text: "x" })).status).toBe(403)
    expect((await run(message, "other", { poId: "po1", text: "x" })).status).toBe(403)
    expect((await run(message, "viewer", { poId: "po1", text: "x" })).status).toBe(403)
    expect((await run(message, "clerk", { poId: "po1", text: "x" })).status).toBe(200)
    expect(mockDb.list("poMessages")).toHaveLength(1)
  })

  it("an empty message, an unknown key and a file the order did not store are refused", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    expect((await run(message, ORG, { poId: "po1", text: "  " })).status).toBe(400)
    expect((await run(message, ORG, { poId: "po1", text: "x", side: "sup" })).status).toBe(400)
    expect((await run(message, ORG, { poId: "po1", text: "x", file: { name: "a.pdf", url: "https://evil.example/a.pdf" } })).status).toBeGreaterThanOrEqual(400)
    expect(mockDb.list("poMessages")).toHaveLength(0)
  })

  it("a cancelled order is read-only, an order not sent yet has no conversation", async () => {
    mockDb.seed("purchaseOrders/po1", order({ status: "cancelled" }))
    expect((await run(message, ORG, { poId: "po1", text: "x" })).status).toBe(409)
    mockDb.seed("purchaseOrders/po1", order({ status: "approved", sentAt: null }))
    expect((await run(message, ORG, { poId: "po1", text: "x" })).status).toBe(409)
  })

  it("an off-platform supplier is told nothing by the server (B-08): the message is stored and the screen opens WhatsApp", async () => {
    mockDb.seed("purchaseOrders/po1", order({ supplierOrgId: "guest", supplierUserId: null, isGuestSupplier: true }))
    const res = await run(message, ORG, { poId: "po1", text: "أرجو التأكيد", channel: "whatsapp" })
    expect(res.status).toBe(200)
    expect(mockDb.get("poMessages/po1__1")).toMatchObject({ channel: "whatsapp", supplierOrgId: "guest" })
    expect(mockDb.writes.filter(([p]) => /\/notifications\//.test(p)).filter(([p]) => !p.startsWith("users/org1") && !p.startsWith("users/prep"))).toEqual([])
  })
})

describe("reading", () => {
  it("opening the thread clears the reader's own unread only", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    await run(message, "su1", { poId: "po1", text: "جاهزون" })
    expect(unreadForBuyer(stored(), "clerk")).toBe(true)
    await run(markRead, "clerk", { poId: "po1" }, "message/read")
    expect(unreadForBuyer(stored(), "clerk")).toBe(false)
    expect(unreadForBuyer(stored(), ORG)).toBe(true)
    await run(message, ORG, { poId: "po1", text: "تمام" })
    expect(unreadForSupplier(stored())).toBe(true)
    await run(markRead, "su1", { poId: "po1" }, "message/read")
    expect(unreadForSupplier(stored())).toBe(false)
  })

  it("the buyer asks for a fresh order link only for his own sent order", async () => {
    mockDb.seed("purchaseOrders/po1", order({ supplierOrgId: "guest", supplierUserId: null, isGuestSupplier: true }))
    const ok = await run(linkRoute, ORG, { poId: "po1" }, "message/link")
    expect(ok.status).toBe(200)
    expect(String(ok.json.data?.link)).toMatch(/\/po\/[A-Za-z0-9_-]{22}$/)
    expect((await run(linkRoute, "stranger", { poId: "po1" }, "message/link")).status).toBe(404)
  })
})

describe("the thread — messages and the order's facts, in the order they came", () => {
  const po = order({
    supplierAcceptedAt: "2026-10-13T09:00:00Z",
    log: [
      { at: "2026-10-12T08:00:00Z", byId: "mgr", byName: "منى", action: "sent", params: { channel: "whatsapp" } },
      { at: "2026-10-13T09:00:00Z", byId: "prep", byName: "سعد", action: "supplier_accepted", params: { recordedBy: "buyer", date: "2026-10-30" } },
      { at: "2026-10-14T07:00:00Z", byId: "link:po1", byName: "مصنع", action: "delivery_reported", note: "شاحنة 7 صباحاً", params: { date: "2026-10-15", seq: 1 } },
    ],
  }) as unknown as PurchaseOrder
  const msg = (seq: number, by: "us" | "sup", at: string, text: string): PoMessage => ({ id: `po1__${seq}`, poId: "po1", seq, by, authorId: "x", authorName: "x", text, file: null, channel: "portal", at })

  it("sent · accepted (on his behalf) · reported delivery · receipt recorded come from the order, interleaved with what was written", () => {
    const facts = orderFacts(po, [{ docNumber: "GR-2026/001", status: "confirmed", confirmedAt: "2026-10-15T10:00:00Z" }])
    expect(facts.map((f) => f.kind)).toEqual(["sent_whatsapp", "accepted_for", "reported", "receipt"])
    expect(facts[1].params.name).toBe("سعد")
    const thread = threadOf(po, [msg(1, "us", "2026-10-13T10:00:00Z", "هل تؤكد؟"), msg(2, "sup", "2026-10-14T06:00:00Z", "نعم")], [])
    expect(thread.map((i) => (i.sys ? i.kind : `m${i.message.seq}`))).toEqual(["sent_whatsapp", "accepted_for", "m1", "m2", "reported"])
  })

  it("the supplier's ask for a change stays open until the buyer writes back", () => {
    const asked = { ...(po as PoWithChat), changeAsked: { at: "2026-10-14T08:00:00Z", seq: 2, text: "تأخير" }, chat: { seq: 2, usSeq: 1, supSeq: 2, lastAt: null, lastText: null, lastBy: "sup" as const, lastFile: false, readBy: {}, supReadSeq: 0 } }
    expect(changeAskOpen(asked)).not.toBeNull()
    expect(changeAskOpen({ ...asked, chat: { ...asked.chat, usSeq: 3, seq: 3 } })).toBeNull()
  })
})

describe("«محادثاتي» — one row per sent order, unread first, searchable", () => {
  const mk = (id: string, name: string, no: string, extra: Record<string, unknown> = {}): PoWithChat => ({ ...(order({ docNumber: no, supplierName: name, ...extra }) as unknown as PurchaseOrder), id }) as PoWithChat
  const chat = (supSeq: number, lastAt: string, readBy: Record<string, number> = {}) => ({ seq: supSeq, usSeq: 0, supSeq, lastAt, lastText: "رد", lastBy: "sup" as const, lastFile: false, readBy, supReadSeq: 0 })
  const orders = [
    mk("a", "حديد الشرق", "PO-2026/001", { chat: chat(1, "2026-10-14T08:00:00Z", { u1: 1 }) }),
    mk("b", "إسمنت الخليج", "PO-2026/002", { chat: chat(1, "2026-10-13T08:00:00Z") }),
    mk("c", "رمل", "PO-2026/003", { status: "cancelled" }),
    mk("d", "أمر لم يُرسل", "PO-2026/004", { status: "approved", sentAt: null }),
  ]

  it("lists only sent, live orders; what is unread comes first, then the latest", () => {
    const rows = chatRows(orders, "u1", "")
    expect(rows.map((r) => r.po.id)).toEqual(["b", "a"])
    expect(rows[0].unread).toBe(true)
    expect(rows[1].unread).toBe(false)
  })

  it("finds a supplier or a number, in either script of the number", () => {
    expect(chatRows(orders, "u1", "الخليج").map((r) => r.po.id)).toEqual(["b"])
    expect(chatRows(orders, "u1", "2026/001").map((r) => r.po.id)).toEqual(["a"])
    expect(chatRows(orders, "u1", "zzz")).toEqual([])
  })

  it("the sidebar's counter is the conversations with something unread", () => {
    expect(unreadChatCount(orders, "u1")).toBe(1)
    expect(unreadChatCount(orders, "u2")).toBe(2)
  })

  it("an off-platform supplier is marked", () => {
    const rows = chatRows([mk("g", "ضيف", "PO-2026/005", { supplierOrgId: "guest", supplierUserId: null, isGuestSupplier: true })], "u1", "")
    expect(rows[0].offPlatform).toBe(true)
  })
})

describe("no WhatsApp integration in the conversation (B-08)", () => {
  // `lib/sms.ts` has a WhatsApp sender that the receivers' reminders use; the order's conversation and link never reach it.
  const files = [
    "src/lib/procurement/po-messages.ts",
    "src/lib/procurement/po-messages-server.ts",
    "src/lib/procurement/po-link-server.ts",
    "src/lib/procurement/po-link-route.ts",
    "src/lib/procurement/po-message-client.ts",
    "src/lib/procurement/notice-server.ts",
    "src/app/api/procurement/po/message/route.ts",
    "src/app/api/procurement/po/message/link/route.ts",
    "src/app/api/po-link/[token]/reply/route.ts",
    "src/components/procurement/chats/ConversationPanel.tsx",
    "src/components/procurement/chats/ChatsPage.tsx",
  ]
  it.each(files)("%s", (file) => {
    const code = fs.readFileSync(path.join(process.cwd(), file), "utf8")
    expect(code).not.toMatch(/@\/lib\/sms|sendDirectMessage|graph\.facebook\.com|api\.whatsapp|messaging_product/)
  })
  it("the only thing that opens WhatsApp is a wa.me address on the user's own device", () => {
    const code = fs.readFileSync(path.join(process.cwd(), "src/components/procurement/chats/ConversationPanel.tsx"), "utf8")
    expect(code).toMatch(/wa\.me|buildWhatsAppLink/)
    expect(code).not.toMatch(/fetch\(\s*[`"']https?:/)
  })
})
