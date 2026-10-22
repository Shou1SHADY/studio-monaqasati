/** @jest-environment node */
/**
 * Procurement 2.0 — the boundaries the package draws, on the SERVER, in each of the eight states (QA pack 3/5, B-02, B-03, B-04, B-05, B-09,
 * B-13; G-10 for the server half): the same act is tried in every combination of the three connectors and is refused exactly when its
 * connector says so — a screen hidden by the switch is also refused when the request arrives by hand.
 *   B-09  the team's «طلب مواد» exists only without Projects;        B-13  a closed connector brings nothing new and hides nothing open;
 *   B-04/B-05  «اسأل الورشة» only with Manufacturing (the workshop decides, Procurement asks);
 *   B-02  with Finance the buyer records no payment;                  B-03  without Finance the buyer's mark never closes an order once Finance is back.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => ({ uid: t.replace(/^tok:/, "") }) }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ name: "bkt", file: () => ({ save: async () => undefined }) }) }),
  getStorageBucketName: () => "bkt",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => xs, serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: async (_db: unknown, uid: string) => mockCallers[uid] ?? null }))
jest.mock("@/lib/sms", () => ({
  isSmsConfigured: () => true,
  sendSms: async () => ({ sent: true }),
  sendWhatsApp: async () => ({ sent: true }),
  sendDirectMessage: async () => ({ sent: true }),
  normalizePhoneE164: (p: string | undefined | null) => (p ? String(p) : null),
}))

import { POST as teamRoute } from "@/app/api/procurement/team-requests/route"
import { POST as incomingRoute } from "@/app/api/procurement/incoming/route"
import { POST as paymentRoute } from "@/app/api/procurement/payment-mark/route"
import { createTeamRequest, syncIncoming } from "@/lib/procurement/incoming-server"
import { incomingDocId, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { PACKAGE_STATES, offFor, type PackageState } from "@/lib/procurement/package"
import { poState } from "@/lib/procurement/po-state"
import { WORKSHOP_MAKE_SUBS } from "@/lib/procurement/stock-check"
import type { PurchaseOrder } from "@/lib/procurement/types"
import type { Firestore } from "firebase-admin/firestore"

type Doc = Record<string, any>
const ORG = "org1"
const NOW = new Date("2026-10-22T09:00:00Z")
jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] })
const db = () => mockDb as unknown as Firestore
const can = (...ps: string[]) => (p: string) => ps.includes(p)
const person = (uid: string, name: string, perms: string[] | "all") => ({ uid, orgId: ORG, name, can: perms === "all" ? () => true : can(...perms) })

const post = async (route: (r: NextRequest) => Promise<Response>, path: string, user: string, body: unknown) => {
  const res = await route(new NextRequest(`http://localhost/api/procurement/${path}`, { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
  return { status: res.status, json: (await res.json()) as { success?: boolean; code?: string; data?: Doc } }
}
const stone = { nodeId: WORKSHOP_MAKE_SUBS[0], subId: WORKSHOP_MAKE_SUBS[0], rootId: "floors", path: [{ ar: "الارضيات", en: "Floors" }], specs: [] }
const incoming = () => mockDb.list("procIncoming") as unknown as IncomingDoc[]

function world(state: PackageState) {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, {
    [ORG]: person(ORG, "المالك", "all"),
    eng1: person("eng1", "م. فهد", []),
    buyer: person("buyer", "ريم", ["rfq.manage", "offers.accept"]),
    mgr: person("mgr", "منى", ["po.approve", "offers.accept"]),
  })
  mockDb.seed(`users/${ORG}`, { organizationId: ORG, name: "المالك" })
  mockDb.seed("users/eng1", { organizationId: ORG, organizationRole: "member", name: "م. فهد" })
  mockDb.seed("users/buyer", { organizationId: ORG, organizationRole: "member", name: "ريم", defaultGroupId: "g-buyer" })
  mockDb.seed("teamGroups/g-buyer", { organizationId: ORG, name: "buyer", permissions: ["rfq.manage", "offers.accept"] })
  mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: offFor(state.pkg) })
}

const poDoc = (over: Doc = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/001",
  status: "approved",
  approvedAt: "2026-10-12T08:00:00Z",
  basis: "rfq",
  rfqId: "r1",
  supplierOrgId: "sup1",
  supplierName: "مصنع الجودة",
  lines: [{ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0 }],
  totalExVat: 30000,
  vatRate: 0.15,
  createdAt: "2026-10-10T08:00:00Z",
  log: [],
  ...over,
})

describe.each(PACKAGE_STATES.map((s) => [s.id, s] as const))("the %s package", (_id, state) => {
  beforeEach(() => world(state))

  it(`B-09 — a teammate's «طلب مواد» is accepted only without Projects (${state.pkg.pm ? "refused" : "accepted"})`, async () => {
    const res = await post(teamRoute, "team-requests", "eng1", { action: "create", lines: [{ name: "رمل لياسة", unit: "م³", quantity: 5 }], needBy: "2099-01-01", place: { label: "المستودع", city: "الرياض", district: "" } })
    if (state.pkg.pm) expect([res.status, res.json.code]).toEqual([409, "PROJECTS_ON"])
    else expect(res.status).toBe(200)
    expect(incoming()).toHaveLength(state.pkg.pm ? 0 : 1)
  })

  it("B-13 — a closed connector brings nothing new into «الواردة» and hides nothing that was already open", async () => {
    mockDb.seed("projects/P1", { organizationId: ORG, name: "مجمع الياسمين" })
    mockDb.seed("projects/P1/purchaseRequests/03", { pm: true, seq: 3, status: "approved", needBy: "2026-11-11", requestedByUserId: "eng1", requestedByUserName: "م. فهد", createdAt: "2026-10-19T08:00:00.000Z", lines: [{ itemId: "i1", code: "x", key: "k1", name: "بلك", unit: "حبة", qty: 100 }], items: [{ name: "بلك", unit: "حبة", quantity: 100, itemId: "i1" }] })
    mockDb.seed("workOrders/WO1", { organizationId: ORG, docNumber: "WO-2026/052", productId: "p", productName: "درج", purchaseRequests: [{ id: "PRQ1", itemName: "غراء", unit: "كيس", quantity: 20, needBy: "2026-11-01", note: null, by: "ورشة", byId: "w1", at: "2026-10-20T08:00:00Z", state: "sent" }] })
    await syncIncoming(db(), ORG, { now: NOW })
    const keys = incoming().map((d) => d.mrKey).sort()
    expect(keys).toEqual([...(state.pkg.pm ? ["pm:P1:03"] : []), ...(state.pkg.mfg ? ["mfg:WO1:PRQ1"] : [])].sort())
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: offFor({ pm: false, fin: state.pkg.fin, mfg: false }) })
    await syncIncoming(db(), ORG, { now: NOW })
    expect(incoming().map((d) => d.mrKey).sort()).toEqual(keys)
  })

  it(`B-04 / B-05 — «اسأل الورشة» is the buyer's question and exists only with Manufacturing (${state.pkg.mfg ? "asked" : "CONNECTOR_OFF"})`, async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: offFor({ ...state.pkg, pm: false }) })
    const t = await createTeamRequest(db(), ORG, { uid: "eng1", name: "م. فهد" }, { lines: [{ name: "أرضيات رخام بيج", unit: "م²", quantity: 380, material: stone as never }], needBy: "2026-11-22", siteId: null, place: { label: "مجمع الياسمين", city: "الرياض", district: "" }, requestedFor: { kind: "member", id: "eng1", name: "م. فهد" } }, NOW)
    const asked = await post(incomingRoute, "incoming", "buyer", { action: "ask-mfg", mrKey: t.mrKey, lines: [1] })
    if (state.pkg.mfg) {
      expect(asked.status).toBe(200)
      expect((mockDb.get(`procIncoming/${incomingDocId(ORG, t.mrKey)}`) as unknown as IncomingDoc).lines[0].mk).toMatchObject({ st: "ask" })
      const byEng = await post(incomingRoute, "incoming", "eng1", { action: "mfg-reply", mrKey: t.mrKey, line: 1, kind: "make", wo: "أت-1" })
      expect(byEng.status).toBe(403)
    } else {
      expect([asked.status, asked.json.code]).toEqual([409, "CONNECTOR_OFF"])
    }
  })

  it(`B-02 — recording a payment is Finance's with Finance (${state.pkg.fin ? "FINANCE_ON" : "the buyer marks it"})`, async () => {
    mockDb.seed("purchaseOrders/po1", poDoc())
    const res = await post(paymentRoute, "payment-mark", "mgr", { poId: "po1", kind: "status", state: "paid", day: "2026-10-20" })
    if (state.pkg.fin) {
      expect([res.status, res.json.code]).toEqual([409, "FINANCE_ON"])
      expect((mockDb.get("purchaseOrders/po1") as Doc).paymentMark).toBeUndefined()
    } else {
      expect(res.status).toBe(200)
      expect((mockDb.get("purchaseOrders/po1") as Doc).paymentMark).toMatchObject({ state: "paid", day: "2026-10-20" })
    }
    expect((await post(paymentRoute, "payment-mark", "buyer", { poId: "po1", kind: "status", state: "paid", day: "2026-10-20" })).status).toBe(403)
  })
})

describe("B-03 — the buyer's mark never closes an order once Finance is in the package", () => {
  const received = (over: Doc = {}) => poDoc({ status: "accepted", supplierAcceptedAt: "2026-10-13T08:00:00Z", lines: [{ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 10, rejected: 0, held: 0, cancelled: 0 }], ...over })
  const read = (po: Doc, financeOn: boolean) => poState({ id: "po1", ...po } as unknown as PurchaseOrder, { notices: [], financeOn, acceptanceDays: 1, now: NOW })

  it("marked paid by the buyer while Finance was off: «مكتمل» then; the same order with Finance on stays «بانتظار الدفع» until Finance records the payment", () => {
    const marked = received({ paymentMark: { state: "paid", day: "2026-10-20", byName: "منى", at: "2026-10-20T08:00:00Z" }, paySrc: "buyer" })
    expect(read(marked, false).k).toBe("done")
    expect(read(marked, true).k).toBe("unpaid")
  })

  it("and Finance's own payment, which closes the order, makes it «مكتمل» with Finance on", () => {
    const paid = received({ status: "closed", closedByPayment: true })
    expect(read(paid, true).k).toBe("done")
  })
})
