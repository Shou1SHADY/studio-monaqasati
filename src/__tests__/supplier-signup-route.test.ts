/** @jest-environment node */
/**
 * Free supplier sign-up from the public page (/supplier-signup): the verify route makes the account and records how it
 * came to be (`signupSource`) and when (`signedUpAt`); the code is never spent for a new mobile before a name and a
 * company are given, a wrong code makes no account, another kind of account is refused, an existing supplier is simply
 * signed in. Real handler over an in-memory Admin Firestore and Auth.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockAuthUsers = new Map<string, string>()
const mockVerify = jest.fn(async (..._args: unknown[]): Promise<string> => "ok")
let mockNextUid = 0

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => mockDb,
  getAdminAuth: () => ({
    getUserByPhoneNumber: async (phone: string) => {
      const uid = mockAuthUsers.get(phone)
      if (!uid) throw new Error("no user")
      return { uid }
    },
    createUser: async ({ phoneNumber }: { phoneNumber: string }) => {
      const uid = `new${++mockNextUid}`
      mockAuthUsers.set(phoneNumber, uid)
      return { uid }
    },
    createCustomToken: async (uid: string) => `token-for-${uid}`,
  }),
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "SERVER_TS" } }))
jest.mock("@/lib/otp", () => ({ ...jest.requireActual("@/lib/otp"), verifyOtp: (...args: unknown[]) => mockVerify(...args) }))

import { POST as verify } from "@/app/api/supplier-free/phone/verify/route"

const PHONE = "0551234567"
const E164 = "+966551234567"
const NAME = "سامي العتيبي"
const COMPANY = "مؤسسة النور للتوريد"

const post = (body: Record<string, unknown>) =>
  verify(new NextRequest("http://localhost/api/supplier-free/phone/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: "challenge-12345", phone: PHONE, code: "123456", ...body }) }))

const user = (uid: string) => mockDb.get(`users/${uid}`) as Record<string, unknown> | undefined
const json = async (res: Response) => (await res.json()) as { success?: boolean; error?: boolean; code?: string; data?: { token?: string; created?: boolean; claimed?: number; needsProfile?: boolean } }

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockAuthUsers.clear()
  mockNextUid = 0
  mockVerify.mockReset()
  mockVerify.mockResolvedValue("ok")
  jest.spyOn(console, "error").mockImplementation(() => {})
})

describe("a new mobile from the public page", () => {
  it("asks for a name and a company first and does not spend the code", async () => {
    const res = await post({ source: "self" })
    expect(res.status).toBe(200)
    expect((await json(res)).data).toEqual({ needsProfile: true })
    expect(mockVerify).not.toHaveBeenCalled()
    expect(mockAuthUsers.size).toBe(0)
    expect(mockDb.list("users")).toEqual([])
  })

  it("makes a free Supplier who owns his company, marked self-signed and dated, and returns the sign-in token", async () => {
    const res = await post({ source: "self", name: NAME, company: COMPANY })
    const body = await json(res)
    expect(res.status).toBe(200)
    expect(body.data).toEqual({ token: "token-for-new1", created: true, claimed: 0 })
    expect(user("new1")).toMatchObject({
      id: "new1",
      role: "Supplier",
      organizationId: "new1",
      organizationRole: "owner",
      name: NAME,
      companyName: COMPANY,
      phone: E164,
      providers: ["phone"],
      isVerified: false,
      signupSource: "self",
      signedUpAt: "SERVER_TS",
    })
    expect(user("new1")).not.toHaveProperty("supplierPlan")
    expect(user("new1")).not.toHaveProperty("verificationRequested")
  })

  it("the guest pages, which send no source, make the same self-signed account when nothing was claimed", async () => {
    await post({ name: NAME, company: COMPANY })
    expect(user("new1")).toMatchObject({ signupSource: "self", signedUpAt: "SERVER_TS" })
  })

  it("is marked guest_claim when his earlier verified guest offers came to him with the account", async () => {
    mockDb.seed("offers/o1", { isGuestOffer: true, supplierId: "guest", rfqId: "r1", guestContact: { phone: E164, phoneVerified: true } })
    mockDb.seed("offers/o2", { isGuestOffer: true, supplierId: "guest", guestContact: { phone: "+966559999999", phoneVerified: true } })
    mockDb.seed("rfqs/r1", { category: "حديد", city: "الرياض" })
    const res = await post({ source: "self", name: NAME, company: COMPANY })
    expect((await json(res)).data).toMatchObject({ created: true, claimed: 1 })
    expect(user("new1")).toMatchObject({ signupSource: "guest_claim", signedUpAt: "SERVER_TS", specializations: ["حديد"] })
    expect(mockDb.get("offers/o1")).toMatchObject({ supplierId: "new1", isGuestOffer: false, wasGuestOffer: true })
    expect(mockDb.get("offers/o2")).toMatchObject({ supplierId: "guest", isGuestOffer: true })
  })

  it("refuses a source it does not know", async () => {
    const res = await post({ source: "admin", name: NAME, company: COMPANY })
    expect(res.status).toBe(400)
    expect((await json(res)).code).toBe("INVALID_INPUT")
    expect(mockAuthUsers.size).toBe(0)
  })
})

describe("the one-time code rules are unchanged", () => {
  it.each([
    ["wrong", 400, "OTP_WRONG"],
    ["expired", 400, "OTP_EXPIRED"],
    ["exhausted", 429, "OTP_EXHAUSTED"],
    ["consumed", 400, "OTP_USED"],
  ])("a %s code makes no account and gives no token", async (verdict, status, code) => {
    mockVerify.mockResolvedValue(verdict)
    const res = await post({ source: "self", name: NAME, company: COMPANY })
    const body = await json(res)
    expect(res.status).toBe(status)
    expect(body.code).toBe(code)
    expect(body.data).toBeUndefined()
    expect(mockAuthUsers.size).toBe(0)
    expect(mockDb.list("users")).toEqual([])
  })

  it("checks the code against the supplier-phone purpose and this mobile", async () => {
    await post({ source: "self", name: NAME, company: COMPANY })
    expect(mockVerify).toHaveBeenCalledTimes(1)
    expect(mockVerify).toHaveBeenCalledWith(mockDb, "challenge-12345", { purpose: "supplier_phone", subjectId: `supplier_phone:${E164}` }, "123456")
  })
})

describe("a mobile that already has an account", () => {
  it("a supplier is simply signed in, and his account keeps how it began", async () => {
    mockAuthUsers.set(E164, "sup1")
    mockDb.seed("users/sup1", { id: "sup1", role: "Supplier", name: "Old", companyName: "Old Co", organizationId: "sup1", signupSource: "invited" })
    const res = await post({ source: "self" })
    expect((await json(res)).data).toEqual({ token: "token-for-sup1", created: false, claimed: 0 })
    expect(user("sup1")).toMatchObject({ role: "Supplier", signupSource: "invited", lastLoginAt: "SERVER_TS" })
    expect(user("sup1")).not.toHaveProperty("signedUpAt")
    expect(mockDb.list("users")).toHaveLength(1)
  })

  it.each(["Contractor", "Admin"])("a %s mobile is refused with the existing message and gets no token", async (role) => {
    mockAuthUsers.set(E164, "u9")
    mockDb.seed("users/u9", { id: "u9", role, name: "X", organizationId: "u9" })
    const res = await post({ source: "self", name: NAME, company: COMPANY })
    const body = await json(res)
    expect(res.status).toBe(403)
    expect(body.code).toBe("WRONG_ROLE")
    expect(body.data).toBeUndefined()
    expect(user("u9")).toEqual({ id: "u9", role, name: "X", organizationId: "u9" })
  })
})
