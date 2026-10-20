// PUR-05: the invitation to the platform — its states, its one contact field, its text, its duplicates.
import { channelFits, contactOf, duplicateOf, finalInviteText, invitationState, inviteExpiresAt, LINK_TOKEN } from "@/lib/procurement/invitations"

const NOW = new Date("2026-10-20T09:00:00Z")

describe("an invitation's state", () => {
  it("is sent, then opened, then joined", () => {
    expect(invitationState({ status: "pending", createdAt: "2026-10-19T09:00:00Z" }, NOW)).toBe("sent")
    expect(invitationState({ status: "pending", createdAt: "2026-10-19T09:00:00Z", openedAt: "2026-10-19T10:00:00Z" }, NOW)).toBe("opened")
    expect(invitationState({ status: "accepted", createdAt: "2026-09-01T09:00:00Z" }, NOW)).toBe("joined")
  })
  it("expires 30 days after it was sent — sending it again restarts the 30", () => {
    const later = new Date("2026-12-20T09:00:00Z")
    expect(invitationState({ status: "pending", createdAt: "2026-11-01T09:00:00Z" }, later)).toBe("expired")
    expect(invitationState({ status: "pending", createdAt: "2026-11-01T09:00:00Z", renewedAt: "2026-12-18T09:00:00Z" }, later)).toBe("sent")
    expect(inviteExpiresAt({ createdAt: "2026-11-01T00:00:00.000Z" })).toBe("2026-12-01T00:00:00.000Z")
  })
  it("one sent before expiry existed counts its 30 days from the release, not from its own day (review of 20 Oct)", () => {
    expect(invitationState({ status: "pending", createdAt: "2026-09-15T09:00:00Z" }, NOW)).toBe("sent")
    expect(inviteExpiresAt({ createdAt: "2026-09-15T09:00:00Z" })).toBe("2026-11-19T00:00:00.000Z")
  })
})

describe("«الجوال أو البريد» in one field", () => {
  it("tells a Saudi mobile from an address, and which channels each allows", () => {
    expect(contactOf("0550000000")).toEqual({ phone: "0550000000", email: null })
    expect(contactOf("+966 55 000 0000")).toEqual({ phone: "0550000000", email: null })
    expect(contactOf("Sales@Fahd.sa")).toEqual({ phone: null, email: "sales@fahd.sa" })
    expect(contactOf("12345")).toEqual({ phone: null, email: null })
    expect(channelFits("sms", contactOf("0550000000"))).toBe(true)
    expect(channelFits("email", contactOf("0550000000"))).toBe(false)
  })
})

it("the ready text gets the link where it stands, or at the end", () => {
  expect(finalInviteText(`سجّلوا من هنا: ${LINK_TOKEN}`, "https://x/j/1")).toBe("سجّلوا من هنا: https://x/j/1")
  expect(finalInviteText("تفضّلوا", "https://x/j/1")).toBe("تفضّلوا\nhttps://x/j/1")
})

it("a number invited before, or a supplier already on the platform, is said before inviting", () => {
  const invs = [{ id: "i1", status: "pending", phone: "0550000000", createdAt: "2026-10-12T08:00:00Z" }]
  expect(duplicateOf(contactOf("+966550000000"), invs, [])).toEqual({ kind: "invited", invitationId: "i1", day: "2026-10-12" })
  expect(duplicateOf(contactOf("0550000000"), invs, [{ orgId: "s1", name: "مؤسسة الفهد", phone: "0550000000" }])).toMatchObject({ kind: "registered", orgId: "s1" })
  expect(duplicateOf(contactOf("0560000000"), invs, [])).toBeNull()
})
