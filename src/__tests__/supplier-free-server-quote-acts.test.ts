/**
 * Supplier 1.0 — the free supplier's quote acts on the server (NFR-08): every blocking rule the quote form shows is
 * enforced again where it cannot be skipped — an open request, a deadline not passed (a cut reply runs on its
 * reply-by), a request that reaches him, `quoteBlocks` — and the version, the withdrawal, the sample note and the
 * declined invitation are written as the readers expect. Runs the real handlers over an in-memory Admin Firestore.
 */

import { notifyNamed } from "@/lib/supplier-free/server-notify"
import { QuoteActError, quoteActSchema, runQuoteAct, type QuoteAct, type QuoteSupplier } from "@/lib/supplier-free/server-quote-acts"
import { competingOffers } from "@/lib/procurement/award"

jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/supplier-free/server-notify", () => ({ notifyNamed: jest.fn(async () => 1) }))

type Doc = Record<string, unknown>

const applyPatch = (cur: Doc, patch: Doc): Doc => {
  const next = { ...cur }
  for (const [k, v] of Object.entries(patch)) {
    const inc = v && typeof v === "object" && "__inc" in (v as Doc) ? Number((v as { __inc: number }).__inc) : null
    next[k] = inc != null ? (Number(cur[k]) || 0) + inc : v
  }
  return next
}

class FakeDb {
  docs = new Map<string, Doc>()
  private n = 0
  ref(path: string) {
    const id = path.split("/").pop() as string
    return {
      path,
      id,
      get: async () => ({ exists: this.docs.has(path), id, data: () => this.docs.get(path) }),
      set: async (data: Doc, opts?: { merge?: boolean }) => {
        this.docs.set(path, opts?.merge ? deepMerge(this.docs.get(path) || {}, data) : data)
      },
      update: async (patch: Doc) => {
        if (!this.docs.has(path)) throw new Error(`no document ${path}`)
        this.docs.set(path, applyPatch(this.docs.get(path) as Doc, patch))
      },
      collection: (name: string) => this.collection(`${path}/${name}`),
    }
  }
  collection(name: string) {
    const query = (filters: [string, unknown][]) => ({
      where: (f: string, _op: string, v: unknown) => query([...filters, [f, v]]),
      limit: () => query(filters),
      get: async () => {
        const rows = [...this.docs].filter(([k, d]) => k.startsWith(`${name}/`) && k.split("/").length === name.split("/").length + 1 && filters.every(([f, v]) => d[f] === v))
        return { empty: rows.length === 0, docs: rows.map(([k, d]) => ({ id: k.split("/").pop() as string, data: () => d })) }
      },
    })
    return {
      doc: (id?: string) => this.ref(`${name}/${id ?? `n${++this.n}`}`),
      where: (f: string, _op: string, v: unknown) => query([[f, v]]),
    }
  }
  async runTransaction<T>(fn: (tx: { get: (r: ReturnType<FakeDb["ref"]>) => Promise<unknown>; set: (r: ReturnType<FakeDb["ref"]>, d: Doc) => void; update: (r: ReturnType<FakeDb["ref"]>, d: Doc) => void }) => Promise<T>): Promise<T> {
    // Writes land only when the function returns: a refusal writes nothing.
    const writes: Array<() => Promise<void>> = []
    const out = await fn({ get: (r) => r.get(), set: (r, d) => void writes.push(() => r.set(d)), update: (r, d) => void writes.push(() => r.update(d)) })
    for (const w of writes) await w()
    return out
  }
}

function deepMerge(a: Doc, b: Doc): Doc {
  const out: Doc = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? deepMerge(a[k] as Doc, v as Doc) : v
  return out
}

// 2026-10-13 09:00 in Riyadh.
const NOW = new Date("2026-10-13T06:00:00Z")
const SUP: QuoteSupplier = { uid: "su", name: "Sami", orgId: "sup", company: "Al Noor", field: { specs: ["طوب وبلوك"], cities: ["الرياض"] } }

const rfq = (over: Doc = {}): Doc => ({
  organizationId: "con",
  contractorId: "con",
  rfqNumber: "RFQ-2026/031",
  title: "بلوك",
  category: "طوب وبلوك",
  city: "الرياض",
  status: "New",
  visibility: "public",
  pricingMode: "line",
  deadline: "2026-10-13",
  products: [
    { name: "بلوك مفرغ", quantity: 100, unitOfMeasure: "حبة" },
    { name: "بلوك مصمت", quantity: 50, unitOfMeasure: "حبة" },
  ],
  offersCount: 0,
  ...over,
})
const values = (over: Doc = {}) => ({ prices: { i1: "2.5", i2: "3" }, skip: {}, total: "", arrive: "", valid: "2026-10-27", note: "", ...over })
const offer = (over: Doc = {}): Doc => ({
  rfqId: "r1",
  supplierId: "su",
  organizationId: "sup",
  status: "قيد المراجعة",
  price: "400",
  lines: [{ rfqProductIndex: 0, unitPrice: 2.5 }, { rfqProductIndex: 1, unitPrice: 3 }],
  deliveryBatches: [{ location: "x", deliveryDate: "", price: "400", quantity: "150" }],
  validUntil: "2026-10-27",
  createdAt: "2026-10-10T08:00:00.000Z",
  ...over,
})

const withDb = (seed: Record<string, Doc>) => {
  const db = new FakeDb()
  for (const [k, v] of Object.entries(seed)) db.docs.set(k, v)
  return db
}
const run = (db: FakeDb, act: Record<string, unknown>, now = NOW) => runQuoteAct(db as never, SUP, quoteActSchema.parse(act) as QuoteAct, now)
const refusal = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof QuoteActError ? e.code : String(e)))

beforeEach(() => jest.clearAllMocks())

describe("a new quote", () => {
  it("is written on an open request in his field, as every reader expects, with its first version", async () => {
    const db = withDb({ "rfqs/r1": rfq() })
    const { offerId } = (await run(db, { action: "quote.new", rfqId: "r1", values: values() })) as { offerId: string }
    const saved = db.docs.get(`offers/${offerId}`) as Doc & { versions: Doc[] }
    expect(saved).toMatchObject({ supplierId: "su", organizationId: "sup", status: "قيد المراجعة", price: "400", contractorOrgId: "con", validUntil: "2026-10-27" })
    expect(saved.versions).toHaveLength(1)
    expect(saved.versions[0]).toMatchObject({ n: 1, total: 400 })
    expect(db.docs.get("rfqs/r1")?.offersCount).toBe(1)
    expect(db.docs.get(`users/con/notifications/new_offer__${offerId}`)).toMatchObject({ type: "new_offer", rfqId: "r1" })
  })

  it("is refused on a closed request, after the deadline's day, on a private request that does not name him, outside his field, and by the quote rules", async () => {
    expect(await refusal(run(withDb({ "rfqs/r1": rfq({ status: "Awarded" }) }), { action: "quote.new", rfqId: "r1", values: values() }))).toBe("rfq_closed")
    expect(await refusal(run(withDb({ "rfqs/r1": rfq({ deadline: "2026-10-12" }) }), { action: "quote.new", rfqId: "r1", values: values() }))).toBe("deadline")
    expect(await refusal(run(withDb({ "rfqs/r1": rfq({ visibility: "private", allowedSupplierOrgIds: ["other"] }) }), { action: "quote.new", rfqId: "r1", values: values() }))).toBe("not_reached")
    expect(await refusal(run(withDb({ "rfqs/r1": rfq({ category: "حديد" }) }), { action: "quote.new", rfqId: "r1", values: values() }))).toBe("not_reached")
    expect(await refusal(run(withDb({ "rfqs/r1": rfq() }), { action: "quote.new", rfqId: "r1", values: values({ prices: { i1: "0" } }) }))).toBe("blocked")
    expect(await refusal(run(withDb({ "rfqs/r1": rfq() }), { action: "quote.new", rfqId: "r1", values: values({ valid: "" }) }))).toBe("blocked")
  })

  it("the deadline is a whole day in Riyadh: quoting at 23:00 on the deadline still goes", async () => {
    const late = new Date("2026-10-13T20:00:00Z") // 23:00 in Riyadh
    const db = withDb({ "rfqs/r1": rfq() })
    await expect(run(db, { action: "quote.new", rfqId: "r1", values: values() }, late)).resolves.toBeTruthy()
  })

  it("an invited private request reaches him whatever his field; a second quote is an edit, not a new one", async () => {
    const db = withDb({ "rfqs/r1": rfq({ visibility: "private", invitedSupplierOrgIds: ["sup"], category: "حديد" }) })
    await run(db, { action: "quote.new", rfqId: "r1", values: values() })
    expect(await refusal(run(db, { action: "quote.new", rfqId: "r1", values: values() }))).toBe("already_quoted")
  })
})

describe("a new version", () => {
  it("keeps a legacy quote's price as version 1 and adds the edit as version 2 (OFR-03)", async () => {
    const db = withDb({ "rfqs/r1": rfq(), "offers/o1": offer() })
    await run(db, { action: "quote.version", offerId: "o1", mode: "edit", values: values({ prices: { i1: "2", i2: "3" } }) })
    const saved = db.docs.get("offers/o1") as Doc & { versions: Array<{ n: number; total: number }> }
    expect(saved.versions.map((v) => [v.n, v.total])).toEqual([
      [1, 400],
      [2, 350],
    ])
    expect(saved.price).toBe("350")
    expect(saved.priceHistory).toEqual([expect.objectContaining({ price: "400" })])
    // A third edit numbers on.
    await run(db, { action: "quote.version", offerId: "o1", mode: "edit", values: values({ prices: { i1: "1.5", i2: "3" } }) })
    expect((db.docs.get("offers/o1") as { versions: Array<{ n: number }> }).versions.map((v) => v.n)).toEqual([1, 2, 3])
  })

  it("an edit closes with the deadline; a cut reply runs on its reply-by date instead", async () => {
    const after = new Date("2026-10-15T06:00:00Z")
    expect(await refusal(run(withDb({ "rfqs/r1": rfq(), "offers/o1": offer() }), { action: "quote.version", offerId: "o1", mode: "edit", values: values() }, after))).toBe("deadline")
    const cut = offer({ status: "مطلوب تخفيض", reductionAt: "2026-10-13T08:00:00.000Z", reductionBy: "2026-10-16", targetPrice: 350 })
    const db = withDb({ "rfqs/r1": rfq(), "offers/o1": cut })
    await run(db, { action: "quote.version", offerId: "o1", mode: "reduce", values: values({ prices: { i1: "2", i2: "3" } }) }, after)
    expect(db.docs.get("offers/o1")).toMatchObject({ status: "قيد المراجعة", reductionReply: { kind: "lowered" } })
    const past = new Date("2026-10-17T06:00:00Z")
    expect(await refusal(run(withDb({ "rfqs/r1": rfq(), "offers/o1": cut }), { action: "quote.version", offerId: "o1", mode: "reduce", values: values() }, past))).toBe("reply_closed")
    expect(await refusal(run(withDb({ "rfqs/r1": rfq(), "offers/o1": cut }), { action: "quote.final", offerId: "o1" }, past))).toBe("reply_closed")
  })

  it("never on another company's quote, an awarded one or a withdrawn one", async () => {
    expect(await refusal(run(withDb({ "rfqs/r1": rfq(), "offers/o1": offer({ organizationId: "other" }) }), { action: "quote.version", offerId: "o1", mode: "edit", values: values() }))).toBe("not_yours")
    expect(await refusal(run(withDb({ "rfqs/r1": rfq(), "offers/o1": offer({ status: "مقبول", poId: "p1" }) }), { action: "quote.version", offerId: "o1", mode: "edit", values: values() }))).toBe("wrong_state")
    expect(await refusal(run(withDb({ "rfqs/r1": rfq(), "offers/o1": offer({ status: "مسحوب", withdrawnAt: "x" }) }), { action: "quote.version", offerId: "o1", mode: "edit", values: values() }))).toBe("wrong_state")
  })
})

describe("withdraw, sample sent, decline", () => {
  it("a withdrawal before the deadline leaves the comparison and the award (OFR-04)", async () => {
    const db = withDb({ "rfqs/r1": rfq(), "offers/o1": offer() })
    await run(db, { action: "quote.withdraw", offerId: "o1" })
    const saved = db.docs.get("offers/o1") as Doc
    expect(saved).toMatchObject({ status: "مسحوب", withdrawnAt: NOW.toISOString(), withdrawnById: "su" })
    expect(competingOffers([{ id: "o1", ...saved } as { id: string; status?: string }])).toHaveLength(0)
    expect(notifyNamed).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({ kind: "sup_quote_withdrawn", organizationId: "con" }), ["con"])
  })

  it("but not after the deadline", async () => {
    expect(await refusal(run(withDb({ "rfqs/r1": rfq({ deadline: "2026-10-12" }), "offers/o1": offer() }), { action: "quote.withdraw", offerId: "o1" }))).toBe("deadline")
  })

  it("sample sent keeps the date, who received it and his note (OFR-06)", async () => {
    const db = withDb({ "rfqs/r1": rfq(), "offers/o1": offer({ sampleStatus: "مطلوبة" }) })
    await run(db, { action: "quote.sample", offerId: "o1", sentAt: "2026-10-12", receivedBy: "خالد", note: "في كرتونة" })
    expect(db.docs.get("offers/o1")).toMatchObject({ sampleStatus: "تم الإرسال", sampleSentAt: "2026-10-12", sampleReceivedBy: "خالد", sampleNote: "في كرتونة" })
    expect(await refusal(run(withDb({ "rfqs/r1": rfq(), "offers/o1": offer() }), { action: "quote.sample", offerId: "o1", sentAt: "2026-10-12" }))).toBe("wrong_state")
    expect(await refusal(run(withDb({ "rfqs/r1": rfq(), "offers/o1": offer({ sampleStatus: "مطلوبة" }) }), { action: "quote.sample", offerId: "o1", sentAt: "2026-10-14" }))).toBe("date_future")
  })

  it("only an invitation that names him can be declined, and the mark is his own", async () => {
    const db = withDb({ "rfqs/r1": rfq({ visibility: "private", allowedSupplierOrgIds: ["sup"] }) })
    await run(db, { action: "quote.decline", rfqId: "r1", note: "لا مخزون" })
    expect(db.docs.get("supplierWorkspace/sup")).toMatchObject({ organizationId: "sup", declined: { r1: { at: "2026-10-13", note: "لا مخزون" } } })
    expect(await refusal(run(withDb({ "rfqs/r1": rfq() }), { action: "quote.decline", rfqId: "r1" }))).toBe("not_reached")
  })
})

// ---- NFR-06: every act on a quote leaves who, when and what changed ------------------------------------------------

describe("the quote's log (NFR-06)", () => {
  const logOf = (db: FakeDb, offerId: string) =>
    [...db.docs].filter(([k]) => k.startsWith(`offers/${offerId}/log/`)).map(([, d]) => d as Doc & { action: string; detail: Doc })

  it("records the new quote, each version, the final answer, the sample and the withdrawal, by name and time", async () => {
    const db = withDb({ "rfqs/r1": rfq() })
    const { offerId } = (await run(db, { action: "quote.new", rfqId: "r1", values: values() })) as { offerId: string }
    await run(db, { action: "quote.version", offerId, mode: "edit", values: values({ prices: { i1: "2", i2: "3" } }) })
    db.docs.set(`offers/${offerId}`, { ...(db.docs.get(`offers/${offerId}`) as Doc), status: "مطلوب تخفيض", reductionBy: "2026-10-16", sampleStatus: "مطلوبة" })
    await run(db, { action: "quote.final", offerId, note: "أقل سعر" })
    await run(db, { action: "quote.sample", offerId, sentAt: "2026-10-12", receivedBy: "خالد" })
    await run(db, { action: "quote.withdraw", offerId })
    const log = logOf(db, offerId)
    expect(log.map((e) => e.action)).toEqual(["quote.new", "quote.version", "quote.final", "quote.sample", "quote.withdraw"])
    for (const e of log) expect(e).toMatchObject({ at: NOW.toISOString(), byId: "su", byName: "Sami", orgId: "sup" })
    expect(log[0].detail).toMatchObject({ total: 400, validUntil: "2026-10-27" })
    expect(log[1].detail).toMatchObject({ mode: "edit", version: 2, total: 350, from: 400 })
    expect(log[2].detail).toMatchObject({ note: "أقل سعر" })
    expect(log[3].detail).toMatchObject({ sentAt: "2026-10-12", receivedBy: "خالد" })
    expect(log[4].detail).toMatchObject({ from: "قيد المراجعة" })
  })

  it("a refused act writes nothing to the log", async () => {
    const db = withDb({ "rfqs/r1": rfq({ deadline: "2026-10-12" }), "offers/o1": offer() })
    expect(await refusal(run(db, { action: "quote.withdraw", offerId: "o1" }))).toBe("deadline")
    expect(logOf(db, "o1")).toHaveLength(0)
  })

  it("a declined invitation names who declined it", async () => {
    const db = withDb({ "rfqs/r1": rfq({ visibility: "private", allowedSupplierOrgIds: ["sup"] }) })
    await run(db, { action: "quote.decline", rfqId: "r1", note: "لا مخزون" })
    expect(db.docs.get("supplierWorkspace/sup")).toMatchObject({ declined: { r1: { byId: "su", byName: "Sami", atTime: NOW.toISOString() } } })
  })
})
