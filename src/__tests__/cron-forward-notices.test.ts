/** @jest-environment node */

type Doc = Record<string, unknown>
const store = new Map<string, Doc>()
let autoId = 0

const split = (path: string) => {
  const i = path.lastIndexOf("/")
  return { col: path.slice(0, i), id: path.slice(i + 1) }
}

const docRef = (path: string): Record<string, unknown> => ({
  id: split(path).id,
  path,
  get: async () => ({ exists: store.has(path), id: split(path).id, data: () => store.get(path), ref: docRef(path) }),
  update: async (patch: Doc) => {
    store.set(path, { ...(store.get(path) || {}), ...patch })
  },
  set: async (data: Doc) => {
    store.set(path, data)
  },
  collection: (name: string) => collectionRef(`${path}/${name}`),
})

const matching = (col: string, filters: Array<[string, unknown]>) =>
  Array.from(store.entries())
    .filter(([path, data]) => split(path).col === col && filters.every(([f, v]) => data[f] === v))
    .map(([path, data]) => ({ id: split(path).id, data: () => data, ref: docRef(path) }))

const queryRef = (col: string, filters: Array<[string, unknown]>): Record<string, unknown> => ({
  __col: col,
  __filters: filters,
  where: (f: string, _op: string, v: unknown) => queryRef(col, [...filters, [f, v]]),
  get: async () => {
    const docs = matching(col, filters)
    return { docs, size: docs.length, empty: docs.length === 0 }
  },
})

const collectionRef = (col: string): Record<string, unknown> => ({
  ...queryRef(col, []),
  doc: (id?: string) => docRef(`${col}/${id ?? `auto${++autoId}`}`),
  add: async (data: Doc) => {
    const path = `${col}/auto${++autoId}`
    store.set(path, data)
    return docRef(path)
  },
})

let txQueue: Promise<unknown> = Promise.resolve()

const mockDb = {
  collection: (name: string) => collectionRef(name),
  runTransaction: <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const tx = {
      get: async (target: { get: () => Promise<unknown> }) => target.get(),
      update: (ref: { update: (p: Doc) => Promise<void> }, patch: Doc) => void ref.update(patch),
      set: (ref: { set: (d: Doc) => Promise<void> }, data: Doc) => void ref.set(data),
    }
    const result = txQueue.then(() => fn(tx))
    txQueue = result.catch(() => undefined)
    return result
  },
}

jest.mock("@/lib/firebaseAdmin", () => ({ getAdminFirestore: () => mockDb }))

import { NextRequest } from "next/server"
import { GET, POST } from "@/app/api/cron/forward-notices/route"

const ORG = "org1"
const NOW = new Date("2026-09-22T09:00:00+03:00").getTime()
const SECRET = "s3cret-value"

const call = (headers: Record<string, string> = {}, method: "GET" | "POST" = "GET") => {
  const req = new NextRequest("http://localhost/api/cron/forward-notices", { method, headers })
  return (method === "GET" ? GET : POST)(req)
}
const authed = () => call({ authorization: `Bearer ${SECRET}` })

const seedNotice = (id: string, over: Doc = {}) =>
  store.set(`deliveries/${id}`, {
    contractorOrgId: ORG,
    status: "pending_confirmation",
    supplierName: "Al Rajhi",
    deliveryDate: "2026-09-22",
    poId: "po1",
    lines: [],
    ...over,
  })

const seedReceiver = (id: string, over: Doc = {}) =>
  store.set(`procurementReceivers/${id}`, {
    organizationId: ORG,
    name: "Nasser",
    title: "Store keeper",
    module: "inventory",
    phone: "0501234567",
    warehouseIds: [],
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  })

const links = () => matching("receiptLinks", [])
const delivery = (id: string) => store.get(`deliveries/${id}`) as { forwardedTo?: Record<string, unknown> }

let nowSpy: jest.SpyInstance
let errorSpy: jest.SpyInstance

beforeEach(() => {
  store.clear()
  autoId = 0
  process.env.CRON_SECRET = SECRET
  nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW)
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)
  store.set("purchaseOrders/po1", { organizationId: ORG, projectId: null })
})

afterEach(() => {
  nowSpy.mockRestore()
  errorSpy.mockRestore()
  delete process.env.CRON_SECRET
})

describe("GET /api/cron/forward-notices — who may call it", () => {
  it("refuses everything when CRON_SECRET is not set, even with a bearer", async () => {
    delete process.env.CRON_SECRET
    seedNotice("n1")
    seedReceiver("r1")
    const res = await call({ authorization: "Bearer anything" })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: true, code: "NOT_CONFIGURED" })
    expect(links()).toHaveLength(0)
  })

  it("refuses a call with no bearer, a wrong one, or another scheme", async () => {
    seedNotice("n1")
    seedReceiver("r1")
    const attempts: Array<Record<string, string>> = [{}, { authorization: "Bearer wrong" }, { authorization: SECRET }, { authorization: `Basic ${SECRET}` }]
    for (const headers of attempts) {
      const res = await call(headers)
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ error: true, code: "UNAUTHORISED" })
    }
    expect(links()).toHaveLength(0)
    expect(delivery("n1").forwardedTo).toBeUndefined()
  })

  it("accepts the right secret on GET and on POST", async () => {
    expect((await authed()).status).toBe(200)
    const res = await call({ authorization: `Bearer ${SECRET}` }, "POST")
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
  })
})

describe("what the job forwards", () => {
  it("forwards a lapsed notice to the register's receiver, tagged auto, with a link and a trail", async () => {
    seedNotice("n1")
    seedReceiver("r1")
    const body = await (await authed()).json()
    expect(body).toEqual({ success: true, data: { orgs: 1, pending: 1, forwarded: 1, skipped: 0, failed: 0 } })

    const fw = delivery("n1").forwardedTo
    expect(fw).toMatchObject({ name: "Nasser", byName: "Mdmak Tech", auto: true, userId: null, note: null })
    expect(String(fw?.phoneMasked)).not.toContain("0501234567")
    expect(links()).toHaveLength(1)
    const link = links()[0].data()
    expect(link).toMatchObject({ deliveryId: "n1", organizationId: ORG, status: "open", createdById: "system:auto-forward" })
    expect(fw?.linkId).toBe(links()[0].id)
  })

  it("running twice forwards once: one link, one forwardedTo, the second run reports nothing forwarded", async () => {
    seedNotice("n1")
    seedReceiver("r1")
    const first = await (await authed()).json()
    const linkId = delivery("n1").forwardedTo?.linkId
    const second = await (await authed()).json()
    expect(first.data.forwarded).toBe(1)
    expect(second.data.forwarded).toBe(0)
    expect(links()).toHaveLength(1)
    expect(delivery("n1").forwardedTo?.linkId).toBe(linkId)
  })

  it("two overlapping runs still forward once", async () => {
    seedNotice("n1")
    seedReceiver("r1")
    const [a, b] = await Promise.all([authed(), authed()])
    const forwarded = (await a.json()).data.forwarded + (await b.json()).data.forwarded
    expect(forwarded).toBe(1)
    expect(links()).toHaveLength(1)
  })

  it("does not touch a notice Procurement already forwarded by hand", async () => {
    const manual = { linkId: "l0", name: "Someone", userId: null, phoneMasked: "05xx", byName: "Buyer", at: "2026-09-21T07:00:00.000Z" }
    seedNotice("n1", { forwardedTo: manual })
    seedReceiver("r1")
    const body = await (await authed()).json()
    expect(body.data.forwarded).toBe(0)
    expect(delivery("n1").forwardedTo).toEqual(manual)
    expect(links()).toHaveLength(0)
  })

  it("leaves a notice still inside the window, one with no receiver to send it to, and a signed-off delivery", async () => {
    seedNotice("far", { deliveryDate: "2026-09-30" })
    seedNotice("done", { status: "confirmed" })
    seedNotice("old", { deliveryDate: "2026-08-01" })
    const noReceiver = await (await authed()).json()
    expect(noReceiver.data.forwarded).toBe(0)
    expect(links()).toHaveLength(0)

    seedReceiver("r1")
    const withReceiver = await (await authed()).json()
    expect(withReceiver.data.forwarded).toBe(0)
    expect(delivery("far").forwardedTo).toBeUndefined()
    expect(delivery("old").forwardedTo).toBeUndefined()
  })

  it("honours each company's own window and register", async () => {
    seedNotice("a1", { deliveryDate: "2026-09-25" })
    seedNotice("b1", { contractorOrgId: "org2", deliveryDate: "2026-09-25" })
    seedReceiver("ra")
    store.set("procurementSettings/org2", { forwardWindowDays: 3 })
    seedReceiver("rb", { organizationId: "org2", name: "Bandar" })
    const body = await (await authed()).json()
    expect(body.data).toMatchObject({ orgs: 2, forwarded: 1 })
    expect(delivery("a1").forwardedTo).toBeUndefined()
    expect(delivery("b1").forwardedTo).toMatchObject({ name: "Bandar", auto: true })
  })

  it("notifies a receiver who is a member, with the link and i18n keys", async () => {
    seedNotice("n1")
    seedReceiver("r1", { userId: "u1" })
    store.set("users/u1", { organizationId: ORG })
    await authed()
    const note = matching("users/u1/notifications", [])
    expect(note).toHaveLength(1)
    expect(note[0].data()).toMatchObject({
      userId: "u1",
      type: "receipt_forwarded",
      deliveryId: "n1",
      i18n: { title: "pn_receipt_auto_forwarded_title", message: "pn_receipt_auto_forwarded", params: { supplier: "Al Rajhi" } },
    })
    expect(String(note[0].data().link)).toBe(`/receive/${links()[0].data().token}`)
    expect(delivery("n1").forwardedTo).toMatchObject({ userId: "u1", auto: true })
  })

  it("writes no notification for a receiver who has no account", async () => {
    seedNotice("n1")
    seedReceiver("r1")
    await authed()
    expect(Array.from(store.keys()).filter((k) => k.includes("notifications"))).toHaveLength(0)
  })
})
