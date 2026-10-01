/**
 * «عيّنة قيد الاعتماد» on what Procurement reads (SUB-03): the mark stays on
 * the request's items through every later rewrite — a receipt, a stop, a change
 * decided — and comes off only when the consultant approves, whichever door the
 * approval comes through (our own record of it, or his portal).
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { FakeFirestoreError, fakeFirestore, firestoreModule, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { Firestore as AdminFirestore } from "firebase-admin/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { applyPortalAnswer, type PmPortalLink } from "@/lib/pm/portal-links"
import { recordSampleReply } from "@/lib/pm/sample-writes"
import { materialKeyOf, storeIdOf } from "@/lib/pm/store"
import { itemsAfterSampleApproval, pendingKept, requestOf } from "@/lib/pm/supply"
import { decideChange, receiveOnProject, stopLine } from "@/lib/pm/supply-writes"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const pmActor = { uid: "pm1", name: "PM" }
const siteActor = { uid: "se1", name: "Site" }
const P = "projects/p1"
const R = `${P}/purchaseRequests/01`
const cement = materialKeyOf("Cement", "bag")
const sand = materialKeyOf("Sand", "m3")
const mesh = materialKeyOf("Mesh", "m2")
const items = () => readDoc<{ items: Array<{ name: string; samplePending?: boolean }> }>(R)?.items ?? []
const marked = () => items().filter((i) => i.samplePending).map((i) => i.name)

const request = {
  pm: true,
  seq: 1,
  title: "Cement",
  status: "approved",
  requestedByUserId: "se1",
  poId: "po1",
  poNumber: "PO-2026/001",
  lines: [
    { itemId: "i1", code: "04-02-01", key: cement, name: "Cement", unit: "bag", qty: 100, receipts: [] },
    { itemId: "i1", code: "04-02-01", key: sand, name: "Sand", unit: "m3", qty: 20, receipts: [] },
    { itemId: "i1", code: "04-02-01", key: mesh, name: "Mesh", unit: "m2", qty: 60, receipts: [], chg: { st: "wait" } },
  ],
  items: [
    { name: "Cement", quantity: 100, unit: "bag", itemId: "i1", samplePending: true },
    { name: "Sand", quantity: 20, unit: "m3", itemId: "i1", samplePending: true },
  ],
}

beforeEach(() => {
  resetFakeDb()
  seed(P, { organizationId: "org", name: "Villas", projectManagerId: "pm1", pm: { no: "PJ-2026/001", lifecycle: "live" } })
  seed(`${P}/boqItems/i1`, { itemNo: "04-02-01", descriptionAr: "لياسة", unit: "m2", quantity: 10000, executedQuantity: 2000, pmSample: true, pmSub: "sub" })
  seed(`${P}/pmStore/${storeIdOf(cement)}`, { key: cement, name: "Cement", unit: "bag", rates: { i1: { r: 0.2, w: 5, ex0: 1000, src: "rate" } }, moves: [] })
  seed(`${P}/pmSubmittals/01`, { seq: 1, itemId: "i1", status: "sub", day: "2026-09-01", supplier: "Al Jazira", what: "Cement 42.5", by: "se1" })
  seed(R, request)
  seed("purchaseOrders/po1", { organizationId: "org", status: "accepted", projectId: "p1", docNumber: "PO-2026/001", lines: [{ id: "l1", name: "Cement", unit: "bag", quantity: 100, unitPrice: 20, accepted: 0, rejected: 0, held: 0, cancelled: 0 }], log: [] })
})

describe("the mark is kept across rewrites", () => {
  it("a stored request is read with the marks it carries", () => {
    expect([...pendingKept(requestOf({ id: "01", ...request }))]).toEqual(["i1"])
  })

  it("a receipt, a stop and a change decision all leave it on", async () => {
    await receiveOnProject(db, site, "p1", siteActor, "01", 0, { acc: 40, rej: 0, dn: "DN-1", note: null, short: false })
    expect(marked()).toEqual(["Cement", "Sand"])
    await stopLine(db, pm, "p1", pmActor, "01", 1, "need", null)
    expect(marked()).toEqual(["Cement"])
    await decideChange(db, pm, "p1", pmActor, "01", 2, { st: "no" })
    expect(marked()).toEqual(["Cement"])
  })
})

describe("the consultant's approval lifts it — through either door", () => {
  it("only the marks on that BOQ item, and nothing when none is there", () => {
    expect(itemsAfterSampleApproval(request, "i1")).toEqual([
      { name: "Cement", quantity: 100, unit: "bag", itemId: "i1" },
      { name: "Sand", quantity: 20, unit: "m3", itemId: "i1" },
    ])
    expect(itemsAfterSampleApproval(request, "i2")).toBeNull()
  })

  it("recorded by us: lifted inside the reply's own transaction — not by a later write the rules may refuse unseen", async () => {
    const later = jest.spyOn(firestoreModule, "updateDoc").mockImplementation(() => Promise.reject(new FakeFirestoreError("permission-denied", "Missing or insufficient permissions.")))
    try {
      await recordSampleReply(db, pm, "p1", pmActor, 1, { reply: "appA", note: null })
    } finally {
      later.mockRestore()
    }
    expect(marked()).toEqual([])
    expect(readDoc<{ pmSub: string }>(`${P}/boqItems/i1`)?.pmSub).toBe("appA")
  })

  it("a rejection leaves it on, and a request no longer live is left alone", async () => {
    seed(`${P}/purchaseRequests/02`, { ...request, seq: 2, status: "rejected" })
    await recordSampleReply(db, pm, "p1", pmActor, 1, { reply: "rej", note: "wrong grade" })
    expect(marked()).toEqual(["Cement", "Sand"])
    seed(`${P}/pmSubmittals/02`, { seq: 2, itemId: "i1", status: "sub", day: "2026-09-10", supplier: "Al Jazira", what: "Cement 52.5", by: "se1" })
    await recordSampleReply(db, pm, "p1", pmActor, 2, { reply: "appB", note: "as noted" })
    expect(marked()).toEqual([])
    expect(readDoc<{ items: Array<{ samplePending?: boolean }> }>(`${P}/purchaseRequests/02`)?.items.every((i) => i.samplePending)).toBe(true)
  })

  it("answered on his portal: the same transaction rewrites the requests' items", async () => {
    type Doc = Record<string, unknown>
    const NOW = Date.UTC(2026, 8, 29, 10, 0, 0)
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
    const store = new Map<string, Doc>([
      ["pmPortalLinks/L1", link as unknown as Doc],
      ["projects/P", { organizationId: "O", name: "النرجس", projectManagerId: "pm1", pm: { lifecycle: "live", no: "PJ-2026/014" } }],
      ["projects/P/pmSubmittals/01", { seq: 1, status: "sub", day: "2026-09-10", itemId: "i1", what: "Cement 42.5" }],
      ["projects/P/boqItems/i1", { itemNo: "04-02-01", pmSample: true, pmSub: "sub" }],
      ["projects/P/purchaseRequests/01", request],
      ["projects/P/purchaseRequests/02", { ...request, status: "rejected" }],
      ["projects/P/purchaseRequests/03", { title: "legacy", status: "approved", items: [{ name: "Nails", quantity: 3, unit: "kg" }] }],
    ])
    const updates: Array<{ path: string; patch: Doc }> = []
    type Ref = { path: string; collection: (n: string) => Coll }
    type Coll = { collectionPath: string; doc: (id: string) => Ref }
    const ref = (p: string): Ref => ({ path: p, collection: (n: string) => coll(`${p}/${n}`) })
    const coll = (p: string): Coll => ({ collectionPath: p, doc: (id: string) => ref(`${p}/${id}`) })
    const admin = {
      collection: (n: string) => coll(n),
      runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
        fn({
          get: async (r: Partial<Ref & Coll>) => {
            if (r.collectionPath) {
              const prefix = `${r.collectionPath}/`
              const docs = [...store.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/")).map((k) => ({ id: k.slice(prefix.length), ref: ref(k), exists: true, data: () => store.get(k) }))
              return { docs }
            }
            return { exists: store.has(r.path as string), data: () => store.get(r.path as string) }
          },
          update: (r: { path: string }, patch: Doc) => updates.push({ path: r.path, patch }),
        }),
    } as unknown as AdminFirestore

    await applyPortalAnswer(admin, "L1", { kind: "subm", seq: 1, decision: "appA" }, NOW)
    const req = updates.filter((u) => u.path.includes("/purchaseRequests/"))
    expect(req.map((u) => u.path)).toEqual(["projects/P/purchaseRequests/01"])
    expect(req[0].patch.items).toEqual([
      { name: "Cement", quantity: 100, unit: "bag", itemId: "i1" },
      { name: "Sand", quantity: 20, unit: "m3", itemId: "i1" },
    ])
    expect(updates.find((u) => u.path === "projects/P/boqItems/i1")?.patch).toMatchObject({ pmSub: "appA" })
  })
})
