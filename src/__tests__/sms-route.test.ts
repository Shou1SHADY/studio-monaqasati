/**
 * @jest-environment node
 *
 * /api/sms, the real route. It used to text any number with any words for
 * anyone who asked — an open relay on the company's Twilio account the day the
 * keys went in. These pin the four properties that closed it: a signed-in
 * caller, no free text, the recipient taken from the database rather than the
 * request, and one text per event.
 */

type Doc = Record<string, unknown>
const store = new Map<string, Doc>()
const sent: Array<{ to: string; body: string }> = []
let smsConfigured = true
let verifyConfigured = false
const verifications: Array<{ to: string; locale: string }> = []

function docRef(path: string) {
  return {
    id: path.split("/").pop()!,
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (data: Doc) => void store.set(path, { ...data }),
    update: async (data: Doc) => void store.set(path, { ...(store.get(path) || {}), ...data }),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}
function collectionRef(path: string) {
  return { doc: (id: string) => docRef(`${path}/${id}`) }
}

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (!token.startsWith("uid:")) throw new Error("bad token")
      return { uid: token.slice(4) }
    },
  }),
  getAdminFirestore: () => ({ collection: (name: string) => collectionRef(name) }),
}))

jest.mock("@/lib/sms", () => {
  const actual = jest.requireActual("@/lib/sms")
  return {
    ...actual,
    isSmsConfigured: () => smsConfigured,
    isVerifyConfigured: () => verifyConfigured,
    startVerification: async (to: string, locale: string) => {
      verifications.push({ to, locale })
      return { sent: true, verificationSid: "VE" + "a".repeat(32) }
    },
    sendSms: async (msg: { to: string; body: string }) => {
      sent.push(msg)
      return { sent: true }
    },
  }
})

import { POST } from "@/app/api/sms/route"

const call = (payload: unknown, uid?: string) =>
  POST(
    new Request("http://localhost/api/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(uid ? { Authorization: `Bearer uid:${uid}` } : {}) },
      body: JSON.stringify(payload),
    })
  )

beforeEach(() => {
  store.clear()
  sent.length = 0
  smsConfigured = true
  verifyConfigured = false
  verifications.length = 0
  store.set("users/contractor1", { phone: "0501234567" })
  store.set("users/supplier1", { twoFactorEnabled: true, phone: "0559876543" })
  store.set("rfqs/rfq1", { contractorId: "contractor1", title: "حديد تسليح" })
  store.set("offers/offer1", { supplierId: "supplier1", rfqId: "rfq1", price: "12000" })
})

describe("who may send", () => {
  it("refuses a caller who is not signed in", async () => {
    const res = await call({ kind: "new_offer", offerId: "offer1" })
    expect(res.status).toBe(401)
    expect(sent).toHaveLength(0)
  })

  it("refuses the old free-text form outright", async () => {
    const res = await call({ to: "+966500000000", body: "anything at all" }, "supplier1")
    expect(res.status).toBe(400)
    expect(sent).toHaveLength(0)
  })
})

describe("a new offer", () => {
  it("texts the contractor who asked, from the database, not the request", async () => {
    const res = await call({ kind: "new_offer", offerId: "offer1", to: "+966511111111" }, "supplier1")
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe("+966501234567")
    expect(sent[0].body).toContain("حديد تسليح")
  })

  it("only for the supplier's own offer", async () => {
    const res = await call({ kind: "new_offer", offerId: "offer1" }, "someoneElse")
    expect(res.status).toBe(403)
    expect(sent).toHaveLength(0)
  })

  it("once — a second tap sends nothing", async () => {
    await call({ kind: "new_offer", offerId: "offer1" }, "supplier1")
    await call({ kind: "new_offer", offerId: "offer1" }, "supplier1")
    expect(sent).toHaveLength(1)
  })
})

describe("the contractor's notification — written here, where the seal is known", () => {
  const notice = () => store.get("users/contractor1/notifications/new_offer__offer1") as { i18n: { message: string; params: Record<string, string> }; message: string } | undefined

  it("names the amount in an open round", async () => {
    await call({ kind: "new_offer", offerId: "offer1" }, "supplier1")
    expect(notice()?.i18n).toMatchObject({ message: "pn_new_offer", params: { price: "12,000" } })
    expect(sent[0].body).toContain("١٢٬٠٠٠")
  })

  it("names no amount in a sealed round — not in the bell, not in the text (UAT, 23 Sep)", async () => {
    store.set("rfqs/rfq1", { contractorId: "contractor1", organizationId: "contractor1", title: "حديد تسليح", deadline: "2099-01-01" })
    store.set("procurementSettings/contractor1", { sealOffersUntilDeadline: true })
    await call({ kind: "new_offer", offerId: "offer1" }, "supplier1")
    expect(notice()?.i18n.message).toBe("pn_new_offer_sealed")
    expect(JSON.stringify(notice())).not.toMatch(/12000|12,000|١٢٬٠٠٠/)
    expect(sent[0].body).not.toMatch(/12000|12,000|١٢٬٠٠٠/)
  })

  it("an awarded RFQ is no longer sealed", async () => {
    store.set("rfqs/rfq1", { contractorId: "contractor1", title: "حديد تسليح", deadline: "2099-01-01", status: "Awarded" })
    store.set("procurementSettings/contractor1", { sealOffersUntilDeadline: true })
    await call({ kind: "new_offer", offerId: "offer1" }, "supplier1")
    expect(notice()?.i18n.message).toBe("pn_new_offer")
  })

  it("still notifies when there is no SMS gateway", async () => {
    smsConfigured = false
    await call({ kind: "new_offer", offerId: "offer1" }, "supplier1")
    expect(notice()).toBeDefined()
    expect(sent).toHaveLength(0)
  })
})

describe("the sign-in code", () => {
  it("goes to the caller's own number on file", async () => {
    const res = await call({ kind: "login_code" }, "supplier1")
    expect(res.status).toBe(200)
    expect(sent[0].to).toBe("+966559876543")
    const code = (store.get("users/supplier1/2fa/current") as { code: string }).code
    expect(sent[0].body).toContain(code)
  })

  it("never reaches the response in production", async () => {
    smsConfigured = false
    const res = await call({ kind: "login_code" }, "supplier1")
    const payload = (await res.json()) as { data: { testCode?: string } }
    expect(payload.data.testCode).toBeUndefined()
  })

  it("is refused for an account without two-step sign-in", async () => {
    const res = await call({ kind: "login_code" }, "contractor1")
    expect(res.status).toBe(409)
    expect(sent).toHaveLength(0)
  })

  it("cannot be requested again within a minute", async () => {
    await call({ kind: "login_code" }, "supplier1")
    const res = await call({ kind: "login_code" }, "supplier1")
    expect(res.status).toBe(429)
    expect(sent).toHaveLength(1)
  })

  it("goes through Twilio Verify when it is set up — no code of ours is made or stored", async () => {
    verifyConfigured = true
    const res = await call({ kind: "login_code", locale: "en" }, "supplier1")
    expect(res.status).toBe(200)
    expect(verifications).toEqual([{ to: "+966559876543", locale: "en" }])
    expect(sent).toHaveLength(0)
    const stored = store.get("users/supplier1/2fa/current") as { code?: string; verificationSid?: string }
    expect(stored.code).toBeUndefined()
    expect(stored.verificationSid).toBe("VE" + "a".repeat(32))
    const again = await call({ kind: "login_code" }, "supplier1")
    expect(again.status).toBe(429)
    expect(verifications).toHaveLength(1)
  })
})
