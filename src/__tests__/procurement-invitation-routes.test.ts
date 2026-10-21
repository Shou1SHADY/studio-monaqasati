/** @jest-environment node */
/**
 * PUR-05 — inviting a supplier to the PLATFORM, on the server: sending (and sending again), cancelling,
 * the public lookup that records «فُتحت», and the supplier's acceptance that puts him in the inviter's
 * suppliers as «غير موثّق» and tells the inviter. Real handlers over an in-memory Admin Firestore.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockAuthEmails = new Map<string, string>()
const mockSendEmail = jest.fn(async (_m: { to: string; subject: string; html: string }) => ({ sent: true }))
const mockSendSms = jest.fn(async (_m: { to: string; body: string }) => ({ sent: true }))

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => mockDb,
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (!t.startsWith("tok:")) throw new Error("bad token")
      const uid = t.slice(4)
      return { uid, email: `${uid}@test.sa`, name: uid }
    },
    getUserByEmail: async (email: string) => {
      const uid = mockAuthEmails.get(email)
      if (!uid) throw new Error("no user")
      return { uid }
    },
  }),
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "SERVER_TS" } }))
jest.mock("@/lib/email", () => ({ sendEmail: (m: { to: string; subject: string; html: string }) => mockSendEmail(m), buildTeamInviteEmail: () => ({ subject: "s", html: "h" }) }))
jest.mock("@/lib/sms", () => ({ ...jest.requireActual("@/lib/sms"), sendSms: (m: { to: string; body: string }) => mockSendSms(m) }))

import { POST as send } from "@/app/api/invitations/send/route"
import { POST as cancel } from "@/app/api/invitations/cancel/route"
import { POST as accept } from "@/app/api/invitations/accept/route"
import { GET as lookup } from "@/app/api/invitations/lookup/route"
import { LINK_TOKEN } from "@/lib/procurement/invitations"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

const TOKEN = "a".repeat(64)
const OTHER_TOKEN = "b".repeat(64)

const json = (body: unknown, token?: string) =>
  new NextRequest("http://localhost/api/invitations/x", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer tok:${token}` } : {}) }, body: JSON.stringify(body) })
const post = (handler: (r: NextRequest) => Promise<Response>, body: unknown, uid?: string) => handler(json(body, uid))
const look = (token: string) => lookup(new NextRequest(`http://localhost/api/invitations/lookup?token=${token}`))
const invitations = () => mockDb.list("invitations")
const clockAt = (iso: string) => {
  jest.useFakeTimers({ doNotFake: ["setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate", "nextTick", "queueMicrotask", "performance", "hrtime"] })
  jest.setSystemTime(new Date(iso))
}
const noticesOf = (uid: string) => mockDb.list(`users/${uid}/notifications`)

const owner = (over: Record<string, unknown> = {}) => ({ role: "Contractor", organizationId: "acme", organizationRole: "owner", name: "Saad", companyName: "Acme Contracting", email: "acme@test.sa", ...over })
const supplierUser = (over: Record<string, unknown> = {}) => ({ role: "Supplier", organizationId: "sup1", organizationRole: "owner", name: "Fahd", companyName: "Fahd Building Materials", email: "sup1@test.sa", taxNumber: "300000000000003", ...over })
const pending = (over: Record<string, unknown> = {}) => ({
  type: "supplier_invite",
  status: "pending",
  inviteToken: TOKEN,
  contractorOrgId: "acme",
  contractorName: "Acme Contracting",
  invitedBy: "acme",
  invitedByName: "Saad",
  companyName: "Fahd Building Materials",
  phone: "0550000000",
  email: null,
  createdAt: new Date().toISOString(),
  ...over,
})

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockAuthEmails.clear()
  mockSendEmail.mockClear()
  mockSendSms.mockClear()
  jest.spyOn(console, "error").mockImplementation(() => undefined)
  mockDb.seed("users/acme", owner())
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe("POST /api/invitations/send — a supplier invitation", () => {
  const wa = { type: "supplier_invite", companyName: "Fahd Building Materials", phone: "0550000000", channel: "wa" }

  it("needs a signed-in user", async () => {
    expect((await post(send, wa)).status).toBe(401)
    expect((await post(send, wa, "nobody")).status).toBe(403)
    expect((await send(new NextRequest("http://localhost/x", { method: "POST", headers: { authorization: "Bearer forged" }, body: "{}" }))).status).toBe(401)
    expect(invitations()).toHaveLength(0)
  })

  it("is checked: a company name is needed, and a mobile for WhatsApp or a text message, an address for e-mail", async () => {
    expect((await post(send, { type: "supplier_invite", channel: "wa", phone: "0550000000" }, "acme")).status).toBe(400)
    expect((await post(send, { ...wa, phone: "12" }, "acme")).status).toBe(400)
    expect((await post(send, { ...wa, channel: "sms", phone: undefined }, "acme")).status).toBe(400)
    expect((await post(send, { ...wa, channel: "email", phone: undefined }, "acme")).status).toBe(400)
    expect((await post(send, { ...wa, channel: "fax" }, "acme")).status).toBe(400)
    expect(invitations()).toHaveLength(0)
  })

  it("is for contractors who hold the supplier file — not a supplier, not a member outside Procurement", async () => {
    mockDb.seed("users/sup1", supplierUser())
    expect((await post(send, wa, "sup1")).status).toBe(403)
    mockDb.seed("users/m1", owner({ organizationRole: "member", defaultGroupId: "g1" }))
    mockDb.seed("teamGroups/g1", { organizationId: "acme", name: "Site", permissions: ["projects.edit"] })
    const res = await post(send, wa, "m1")
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("FORBIDDEN")
    expect(invitations()).toHaveLength(0)
  })

  it("writes a pending invitation for the sender's company, with an unguessable token and the join link", async () => {
    const res = await post(send, { ...wa, contactName: "Abu Khaled", specialtyIds: ["cement"] }, "acme")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(invitations()).toHaveLength(1)
    const inv = invitations()[0]
    expect(inv).toMatchObject({ type: "supplier_invite", status: "pending", contractorOrgId: "acme", contractorName: "Acme Contracting", phone: "0550000000", companyName: "Fahd Building Materials", channel: "wa", specialtyIds: ["cement"] })
    expect(String(inv.inviteToken)).toMatch(/^[a-f0-9]{64}$/)
    expect(body.data.joinUrl).toContain(`/register?invite=${inv.inviteToken}`)
    expect(body.data).toMatchObject({ delivered: false, emailSent: false })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockSendSms).not.toHaveBeenCalled()
  })

  it("WhatsApp sends nothing from the platform; e-mail and the text message are sent in the company's name with the link placed", async () => {
    await post(send, { type: "supplier_invite", companyName: "Fahd", email: "fahd@x.sa", channel: "email", fullText: true, message: `Salam, register: ${LINK_TOKEN}` }, "acme")
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][0].html).toContain(`${invitations()[0].inviteToken}`)
    expect(mockSendEmail.mock.calls[0][0].html).not.toContain(LINK_TOKEN)

    await post(send, { ...wa, channel: "sms", fullText: true, message: `Salam ${LINK_TOKEN}` }, "acme")
    expect(mockSendSms).toHaveBeenCalledTimes(1)
    expect(mockSendSms.mock.calls[0][0].to).toBe("+966550000000")
  })

  it("sending again renews the same pending invitation instead of adding another", async () => {
    await post(send, wa, "acme")
    const first = invitations()[0]
    const again = await post(send, wa, "acme")
    expect(again.status).toBe(200)
    expect(invitations()).toHaveLength(1)
    expect(invitations()[0].inviteToken).toBe(first.inviteToken)
    expect(typeof invitations()[0].renewedAt).toBe("string")
  })

  it("never reuses another company's invitation to the same mobile", async () => {
    mockDb.seed("invitations/other", pending({ contractorOrgId: "rival", inviteToken: OTHER_TOKEN }))
    await post(send, wa, "acme")
    expect(invitations()).toHaveLength(2)
    expect(invitations().find((i) => i.id !== "other")?.contractorOrgId).toBe("acme")
    expect(mockDb.get("invitations/other")?.renewedAt).toBeUndefined()
  })

  it("refuses to invite his own address", async () => {
    const res = await post(send, { type: "supplier_invite", companyName: "Me", email: "acme@test.sa", channel: "email" }, "acme")
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("SELF_INVITE")
  })
})

describe("POST /api/invitations/cancel — «ألغِ»", () => {
  beforeEach(() => {
    mockDb.seed("invitations/i1", pending())
  })

  it("needs a signed-in user, and says which invitation", async () => {
    expect((await post(cancel, { invitationId: "i1" })).status).toBe(401)
    expect((await post(cancel, {}, "acme")).status).toBe(400)
    expect(mockDb.get("invitations/i1")?.status).toBe("pending")
  })

  it("is for whoever may invite suppliers for the company", async () => {
    mockDb.seed("users/m1", owner({ organizationRole: "member", defaultGroupId: "g1" }))
    mockDb.seed("teamGroups/g1", { organizationId: "acme", name: "Site", permissions: ["projects.edit"] })
    expect((await post(cancel, { invitationId: "i1" }, "m1")).status).toBe(403)
    expect(mockDb.get("invitations/i1")?.status).toBe("pending")
  })

  it("cancels a pending invitation of the caller's company — its link stops working at once", async () => {
    const res = await post(cancel, { invitationId: "i1" }, "acme")
    expect(res.status).toBe(200)
    expect(mockDb.get("invitations/i1")).toMatchObject({ status: "cancelled", cancelledByName: "Saad" })
    expect((await look(TOKEN)).status).toBe(410)
  })

  it("cannot cancel another company's invitation — it reads as not found", async () => {
    mockDb.seed("users/rival", owner({ organizationId: "rival", name: "Rival" }))
    const res = await post(cancel, { invitationId: "i1" }, "rival")
    expect(res.status).toBe(404)
    expect(mockDb.get("invitations/i1")?.status).toBe("pending")
  })

  it("only a supplier invitation, and only while pending", async () => {
    mockDb.seed("invitations/team", { type: "team_invite", status: "pending", organizationId: "acme", contractorOrgId: "acme" })
    expect((await post(cancel, { invitationId: "team" }, "acme")).status).toBe(404)
    mockDb.seed("invitations/done", pending({ status: "accepted" }))
    const res = await post(cancel, { invitationId: "done" }, "acme")
    expect(res.status).toBe(409)
    expect(mockDb.get("invitations/done")?.status).toBe("accepted")
  })
})

describe("GET /api/invitations/lookup — the link the supplier opens", () => {
  it("refuses a malformed token and an unknown one", async () => {
    expect((await look("short")).status).toBe(400)
    expect((await look(TOKEN)).status).toBe(404)
  })

  it("records «فُتحت» once, and returns only what the register page shows", async () => {
    mockDb.seed("invitations/i1", pending())
    const res = await look(TOKEN)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({ type: "supplier_invite", email: null, companyName: "Fahd Building Materials", contractorName: "Acme Contracting" })
    expect(JSON.stringify(body)).not.toContain(TOKEN)
    const openedAt = mockDb.get("invitations/i1")?.openedAt
    expect(typeof openedAt).toBe("string")
    await look(TOKEN)
    expect(mockDb.get("invitations/i1")?.openedAt).toBe(openedAt)
  })

  it("is closed once cancelled, accepted or expired", async () => {
    mockDb.seed("invitations/i1", pending({ status: "cancelled" }))
    expect((await look(TOKEN)).status).toBe(410)
    mockDb.seed("invitations/i1", pending({ status: "accepted" }))
    expect((await look(TOKEN)).status).toBe(410)
    mockDb.seed("invitations/i1", pending({ createdAt: "2026-10-21T00:00:00.000Z" }))
    clockAt("2026-12-30T00:00:00Z")
    const res = await look(TOKEN)
    expect(res.status).toBe(410)
    expect((await res.json()).code).toBe("INVITATION_EXPIRED")
    expect(mockDb.get("invitations/i1")?.openedAt).toBeUndefined()
  })
})

describe("POST /api/invitations/accept — the supplier joins", () => {
  beforeEach(() => {
    mockDb.seed("invitations/i1", pending())
    mockDb.seed("users/sup1", supplierUser())
  })

  it("needs a signed-in user and a well-formed token", async () => {
    expect((await post(accept, { token: TOKEN })).status).toBe(401)
    expect((await post(accept, { token: "nope" }, "sup1")).status).toBe(400)
    expect((await post(accept, { token: OTHER_TOKEN }, "sup1")).status).toBe(404)
  })

  it("links him to the inviter's company, as an UNVERIFIED supplier of theirs", async () => {
    const res = await post(accept, { token: TOKEN }, "sup1")
    expect(res.status).toBe(200)
    expect(mockDb.list("contractorSupplierLinks")).toEqual([expect.objectContaining({ contractorOrgId: "acme", supplierOrgId: "sup1", status: "active", requestedBy: "contractor" })])
    const record = mockDb.list("supplierRecords")
    expect(record).toHaveLength(1)
    expect(record[0]).toMatchObject({ organizationId: "acme", supplierOrgId: "sup1", verified: false, source: "invite", supplierName: "Fahd Building Materials", vatNumber: "300000000000003" })
    expect(mockDb.get("invitations/i1")).toMatchObject({ status: "accepted", acceptedSupplierOrgId: "sup1", acceptedBy: "sup1" })
  })

  it("tells the inviter, with message keys rather than fixed Arabic, and the supplier too", async () => {
    await post(accept, { token: TOKEN }, "sup1")
    const toInviter = noticesOf("acme")
    expect(toInviter).toHaveLength(1)
    expect(toInviter[0]).toMatchObject({
      type: "supplier_invite_accepted",
      i18n: { title: "pn_supplier_invite_accepted_title", message: "pn_supplier_invite_accepted", params: { name: "Fahd Building Materials" } },
    })
    expect(noticesOf("sup1")[0]).toMatchObject({ type: "supplier_connected", i18n: { title: "pn_supplier_connected_title", message: "pn_supplier_connected", params: { contractor: "Acme Contracting" } } })
  })

  it("keeps a record the inviter already holds, and does not link twice", async () => {
    mockDb.seed("supplierRecords/acme__sup1", { organizationId: "acme", supplierOrgId: "sup1", verified: true, source: "manual" })
    mockDb.seed("contractorSupplierLinks/l1", { contractorOrgId: "acme", supplierOrgId: "sup1", status: "active" })
    await post(accept, { token: TOKEN }, "sup1")
    expect(mockDb.list("contractorSupplierLinks")).toHaveLength(1)
    expect(mockDb.get("supplierRecords/acme__sup1")).toMatchObject({ verified: true, source: "manual" })
  })

  it("the token is the capability: cancelled, accepted or expired ones join nobody", async () => {
    clockAt("2026-12-30T00:00:00Z")
    for (const over of [{ status: "cancelled" }, { status: "accepted" }, { createdAt: "2026-10-21T00:00:00.000Z" }]) {
      mockDb.seed("invitations/i1", pending(over))
      const res = await post(accept, { token: TOKEN }, "sup1")
      expect(res.status).toBe(410)
    }
    expect(mockDb.list("contractorSupplierLinks")).toHaveLength(0)
    expect(noticesOf("acme")).toHaveLength(0)
  })

  it("only a supplier account joins, and never his own inviter's company", async () => {
    mockDb.seed("users/c2", owner({ organizationId: "c2" }))
    expect((await post(accept, { token: TOKEN }, "c2")).status).toBe(403)
    mockDb.seed("users/acme", owner({ role: "Supplier" }))
    expect((await post(accept, { token: TOKEN }, "acme")).status).toBe(400)
    expect(mockDb.list("contractorSupplierLinks")).toHaveLength(0)
  })

  it("registers a brand-new supplier from the token alone (no profile yet)", async () => {
    const res = await post(accept, { token: TOKEN, name: "Newcomer" }, "fresh")
    expect(res.status).toBe(200)
    expect(mockDb.get("users/fresh")).toMatchObject({ role: "Supplier", organizationId: "fresh", isVerified: false })
    expect(mockDb.list("supplierRecords")[0]).toMatchObject({ supplierOrgId: "fresh", verified: false })
  })
})

describe("the words of the accept notices", () => {
  const shared = (m: unknown) => (m as { Portal: { Shared: Record<string, string> } }).Portal.Shared
  it.each(["pn_team_joined", "pn_team_invite_accepted", "pn_supplier_connected", "pn_supplier_invite_accepted"])("%s exists in both languages, with its title", (key) => {
    for (const messages of [ar, en]) {
      expect(shared(messages)[key]).toBeTruthy()
      expect(shared(messages)[`${key}_title`]).toBeTruthy()
    }
  })

  it("tells the inviter the supplier joined as «not verified»", () => {
    expect(shared(ar).pn_supplier_invite_accepted).toContain("غير موثّق")
  })
})
