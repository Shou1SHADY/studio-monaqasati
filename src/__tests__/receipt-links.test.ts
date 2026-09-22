/**
 * @jest-environment node
 *
 * The receipt link (22 Sep review): Procurement forwards a delivery to whoever
 * receives it — often someone with no account — who counts what arrived,
 * signs, and confirms with a code texted to their phone. What must hold:
 * every line is answered, rejects never exceed what arrived and name a reason,
 * a link opens only while it is live, and the public page gives away neither
 * the supplier's quantities (the count is blind) nor the phone number.
 */

import type { DeliveryLine } from "@/lib/procurement/types"

type Doc = Record<string, unknown>
const store = new Map<string, Doc>()

function docRef(path: string) {
  return {
    id: path.split("/").pop()!,
    get: async () => ({ exists: store.has(path), id: path.split("/").pop()!, data: () => store.get(path) }),
  }
}
function collectionRef(name: string) {
  return {
    doc: (id: string) => docRef(`${name}/${id}`),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => {
          const docs = [...store.entries()]
            .filter(([k, v]) => k.startsWith(`${name}/`) && v[field] === value)
            .map(([k, v]) => ({ id: k.split("/").pop()!, data: () => v }))
          return { docs, empty: docs.length === 0 }
        },
      }),
    }),
  }
}

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => ({ collection: (name: string) => collectionRef(name) }),
}))

import { buildReport, linkRefusal, receiverFrom } from "@/lib/receipt-links"
import { GET } from "@/app/api/receipt-links/[token]/route"

const base: DeliveryLine[] = [
  { poLineId: "l1", name: "Cement", unit: "bag", noticeQuantity: 100 },
  { poLineId: "l2", name: "Sand", unit: "m3", noticeQuantity: 20 },
]
const answer = (over: Partial<{ poLineId: string; counted: number; rejected: number; rejectReason: "damaged" | null }> = {}) => ({
  poLineId: "l1",
  counted: 100,
  rejected: 0,
  rejectReason: null,
  ...over,
})

describe("the receiver's count", () => {
  it("accepts every line answered, a reject with its reason", () => {
    const r = buildReport({ lines: [answer({ rejected: 3, rejectReason: "damaged" }), answer({ poLineId: "l2", counted: 18 })] }, base)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lines.map((l) => [l.poLineId, l.counted, l.rejected, l.rejectReason])).toEqual([["l1", 100, 3, "damaged"], ["l2", 18, 0, null]])
  })

  it("refuses a line left out — it would read as nothing arrived", () => {
    expect(buildReport({ lines: [answer()] }, base)).toMatchObject({ ok: false, error: "missing_line", poLineId: "l2" })
  })

  it("refuses more rejected than received, and a reject without a reason", () => {
    expect(buildReport({ lines: [answer({ counted: 2, rejected: 3, rejectReason: "damaged" }), answer({ poLineId: "l2" })] }, base)).toMatchObject({ error: "rejected_over_counted" })
    expect(buildReport({ lines: [answer({ rejected: 3 }), answer({ poLineId: "l2" })] }, base)).toMatchObject({ error: "reject_needs_reason" })
  })

  it("refuses a line that is not on the delivery, or one answered twice", () => {
    expect(buildReport({ lines: [answer({ poLineId: "ghost" }), answer({ poLineId: "l2" })] }, base)).toMatchObject({ error: "unknown_line" })
    expect(buildReport({ lines: [answer(), answer()] }, base)).toMatchObject({ error: "unknown_line" })
  })

  it("refuses a signature for nothing at all", () => {
    expect(buildReport({ lines: [answer({ counted: 0 }), answer({ poLineId: "l2", counted: 0 })] }, base)).toMatchObject({ error: "nothing_counted" })
  })
})

describe("whether a link still opens", () => {
  const future = new Date(Date.now() + 60_000).toISOString()
  it("opens while open and in date — and not once used, replaced or expired", () => {
    expect(linkRefusal({ status: "open", expiresAt: future }, Date.now())).toBeNull()
    expect(linkRefusal({ status: "signed", expiresAt: future }, Date.now())).toBe("signed")
    expect(linkRefusal({ status: "revoked", expiresAt: future }, Date.now())).toBe("revoked")
    expect(linkRefusal({ status: "open", expiresAt: new Date(Date.now() - 1).toISOString() }, Date.now())).toBe("expired")
    expect(linkRefusal(null, Date.now())).toBe("missing")
  })
})

describe("who the code goes to", () => {
  it("a person's number as typed, normalised; none when it cannot be", () => {
    expect(receiverFrom({ kind: "person", name: "Abu Salem", phone: "0501234567" }, null)).toMatchObject({ phone: "+966501234567", userId: null })
    expect(receiverFrom({ kind: "person", name: "Abu Salem", phone: "12" }, null)).toBeNull()
  })

  it("a member's number on file, unless Procurement supplies one", () => {
    expect(receiverFrom({ kind: "user", userId: "u1" }, { name: "Salman", phone: "0559876543" })).toMatchObject({ phone: "+966559876543", userId: "u1", name: "Salman" })
    expect(receiverFrom({ kind: "user", userId: "u1" }, { name: "Salman" })).toBeNull()
    expect(receiverFrom({ kind: "user", userId: "u1", phone: "0551112222" }, { name: "Salman" })).toMatchObject({ phone: "+966551112222" })
  })
})

describe("the public page's data", () => {
  const TOKEN = "a".repeat(64)
  beforeEach(() => {
    store.clear()
    store.set("receiptLinks/link1", {
      token: TOKEN,
      deliveryId: "d1",
      organizationId: "org1",
      receiver: { kind: "person", userId: null, name: "Abu Salem", phone: "+966501234567" },
      status: "open",
      createdById: "u9",
      createdByName: "Shady",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    store.set("deliveries/d1", {
      contractorOrgId: "org1",
      status: "pending_confirmation",
      supplierName: "Al-Yamama",
      poNumber: "PO-2026/014",
      lines: base,
    })
  })

  const read = async (token: string) => {
    const res = await GET(new Request(`http://localhost/api/receipt-links/${token}`) as never, { params: Promise.resolve({ token }) })
    return { status: res.status, body: (await res.json()) as { data?: Record<string, unknown>; code?: string } }
  }

  it("lists the lines without the supplier's quantities — the count is blind", async () => {
    const { status, body } = await read(TOKEN)
    expect(status).toBe(200)
    expect(body.data?.lines).toEqual([
      { poLineId: "l1", name: "Cement", unit: "bag" },
      { poLineId: "l2", name: "Sand", unit: "m3" },
    ])
    expect(JSON.stringify(body)).not.toContain("noticeQuantity")
  })

  it("shows only the last digits of the phone", async () => {
    const { body } = await read(TOKEN)
    expect(body.data?.phoneMasked).toBe("•••• 4567")
    expect(JSON.stringify(body)).not.toContain("501234567")
  })

  it("opens nothing once the delivery has been booked", async () => {
    store.set("deliveries/d1", { ...store.get("deliveries/d1"), status: "confirmed" })
    expect((await read(TOKEN)).status).toBe(410)
  })

  it("refuses a malformed or unknown token", async () => {
    expect((await read("nope")).status).toBe(400)
    expect((await read("b".repeat(64))).status).toBe(404)
  })
})
