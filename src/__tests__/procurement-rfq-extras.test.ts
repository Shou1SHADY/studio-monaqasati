import {
  GUEST_PAPER_MAX_BYTES,
  answeredQueries,
  deadlineEnd,
  guestInviteOf,
  guestInvitesNewestFirst,
  guestOtpRequired,
  guestOtpSubject,
  guestOtpSubjectRange,
  guestPaperPath,
  guestPaperRefusal,
  mergeGuestPapers,
  normalizeGuestMobile,
  safeFileName,
  shareLinkState,
  shareLinkValidUntil,
  type GuestPaper,
} from "@/lib/procurement/guest-supplier"
import {
  earliestNeedBy,
  extendPool,
  guestLinkLine,
  invitableRecipients,
  paidBeforeDelivery,
  profileOfFacts,
  publicReach,
  sourcingBlockOf,
  suggestRfqTitle,
} from "@/lib/procurement/rfq-extras"
import { scrubTokens } from "@/lib/sentry-options"

const TODAY = "2026-09-29"
const TREE = { "حديد ومعادن": ["حديد تسليح", "حديد مجلفن"], "خرسانة": ["خرسانة جاهزة"] }

describe("guest page — one-time code", () => {
  it("normalises Saudi mobiles and international numbers to E.164", () => {
    expect(normalizeGuestMobile("0551234567")).toBe("+966551234567")
    expect(normalizeGuestMobile("055 123 4567")).toBe("+966551234567")
    expect(normalizeGuestMobile("551234567")).toBe("+966551234567")
    expect(normalizeGuestMobile("966551234567")).toBe("+966551234567")
    expect(normalizeGuestMobile("00966551234567")).toBe("+966551234567")
    expect(normalizeGuestMobile("+966551234567")).toBe("+966551234567")
    expect(normalizeGuestMobile("+201001234567")).toBe("+201001234567")
    expect(normalizeGuestMobile("0112345678")).toBeNull()
    expect(normalizeGuestMobile("+96611234567")).toBeNull()
    expect(normalizeGuestMobile("abc")).toBeNull()
    expect(normalizeGuestMobile("")).toBeNull()
  })

  it("binds a code to the link AND the number", () => {
    const a = guestOtpSubject("L1", "+966551234567")
    expect(a).not.toBe(guestOtpSubject("L1", "+966551234568"))
    expect(a).not.toBe(guestOtpSubject("L2", "+966551234567"))
    const [from, to] = guestOtpSubjectRange("L1")
    expect(a >= from && a <= to).toBe(true)
    const other = guestOtpSubject("L10", "+966551234567")
    expect(other >= from && other <= to).toBe(false)
  })

  it("asks for a code only where one can be delivered — or on UAT, where it is shown", () => {
    expect(guestOtpRequired(true, false)).toBe(true)
    expect(guestOtpRequired(false, true)).toBe(true)
    expect(guestOtpRequired(false, false)).toBe(false)
  })
})

describe("guest page — papers", () => {
  it("takes PDF/JPG/PNG up to 5MB, nothing else", () => {
    expect(guestPaperRefusal({ type: "application/pdf", size: 1000 })).toBeNull()
    expect(guestPaperRefusal({ type: "image/png", size: GUEST_PAPER_MAX_BYTES })).toBeNull()
    expect(guestPaperRefusal({ type: "image/jpeg", size: GUEST_PAPER_MAX_BYTES + 1 })).toBe("size")
    expect(guestPaperRefusal({ type: "application/zip", size: 10 })).toBe("type")
    expect(guestPaperRefusal({ type: "application/pdf", size: 0 })).toBe("empty")
    expect(guestPaperRefusal(null)).toBe("empty")
  })

  it("stores a paper under the guest link, with a safe name", () => {
    expect(guestPaperPath("L1", "O1", "cr", "سجل تجاري (1).pdf", 42)).toBe("rfqShareLinks/L1/papers/O1/cr-42-1_.pdf")
    expect(safeFileName("../../etc/passwd")).toBe("etc_passwd")
    expect(safeFileName("", "vat")).toBe("vat")
  })

  it("keeps one paper per kind — the newer replaces the older", () => {
    const old: GuestPaper = { kind: "cr", name: "old.pdf", url: "u1", contentType: "application/pdf", size: 1, at: "2026-09-01" }
    const vat: GuestPaper = { kind: "vat", name: "vat.pdf", url: "u2", contentType: "application/pdf", size: 1, at: "2026-09-01" }
    const fresh: GuestPaper = { ...old, name: "new.pdf", url: "u3", at: "2026-09-29" }
    expect(mergeGuestPapers([old, vat], [fresh]).map((p) => p.name)).toEqual(["new.pdf", "vat.pdf"])
    expect(mergeGuestPapers(null, [])).toEqual([])
  })
})

describe("guest page — answered queries", () => {
  it("shows the question and answer only, oldest answer first, never the asker", () => {
    const out = answeredQueries([
      { question: "Q2", reply: "A2", repliedAt: "2026-09-20" },
      { question: "Q1", reply: "A1", repliedAt: "2026-09-10" },
      { question: "Q3", reply: "  " },
      { question: "", reply: "orphan" },
    ])
    expect(out).toEqual([
      { question: "Q1", answer: "A1", answeredAt: "2026-09-10" },
      { question: "Q2", answer: "A2", answeredAt: "2026-09-20" },
    ])
    expect(Object.keys(out[0])).toEqual(["question", "answer", "answeredAt"])
  })
})

describe("share link — valid until the deadline", () => {
  const now = new Date("2026-09-29T10:00:00Z")
  it("a deadline-bound link is open until the deadline's end, closed after, gone once the RFQ is decided", () => {
    const link = { expiresWith: "deadline" as const, expiresAt: "2026-09-30T23:59:59.999Z" }
    expect(shareLinkState(link, { status: "New", deadline: "2026-09-29" }, now)).toBe("open")
    expect(shareLinkState(link, { status: "New", deadline: "2026-09-28" }, now)).toBe("closed")
    expect(shareLinkState(link, { status: "New", deadline: "2026-10-05" }, now)).toBe("open")
    expect(shareLinkState(link, { status: "Awarded", deadline: "2026-10-05" }, now)).toBe("gone")
    expect(shareLinkState({ ...link, revoked: true }, { status: "New", deadline: "2026-10-05" }, now)).toBe("gone")
  })

  it("an extension reopens a closed link — the validity follows the RFQ", () => {
    const link = { expiresWith: "deadline" as const }
    expect(shareLinkValidUntil(link, { deadline: "2026-10-05" })).toBe("2026-10-05T23:59:59.999Z")
    expect(shareLinkState(link, { status: "New", deadline: "2026-10-05" }, new Date("2026-10-03T00:00:00Z"))).toBe("open")
  })

  it("an older 3-day link keeps its fixed expiry", () => {
    const link = { expiresAt: "2026-09-30T00:00:00Z" }
    expect(shareLinkState(link, { status: "New", deadline: "2026-10-05" }, now)).toBe("open")
    expect(shareLinkState(link, { status: "New", deadline: "2026-10-05" }, new Date("2026-10-01T00:00:00Z"))).toBe("gone")
    expect(shareLinkValidUntil(link, { deadline: "2026-10-05" })).toBe("2026-09-30T00:00:00Z")
  })

  it("reads a deadline stored with a time", () => {
    expect(deadlineEnd("2026-10-05T00:00:00.000Z")).toBe("2026-10-05T23:59:59.999Z")
    expect(deadlineEnd(null)).toBeNull()
    expect(deadlineEnd("soon")).toBeNull()
  })
})

describe("share dialog — «دعوات الزوار»", () => {
  it("records a channel share or a platform email; a copied link invites nobody", () => {
    expect(guestInviteOf("whatsapp", null, "t", "Ali")).toEqual({ to: null, channel: "wa", at: "t", byName: "Ali" })
    expect(guestInviteOf("email", null, "t", "Ali")?.channel).toBe("mail")
    expect(guestInviteOf("email", "s@x.sa", "t", "Ali")).toEqual({ to: "s@x.sa", channel: "plat", at: "t", byName: "Ali" })
    expect(guestInviteOf("link", null, "t", "Ali")).toBeNull()
    expect(guestInviteOf(null, null, "t", "Ali")).toBeNull()
  })

  it("lists the newest first", () => {
    const list = guestInvitesNewestFirst([
      { to: null, channel: "wa", at: "2026-09-01", byName: "" },
      { to: "a@b.sa", channel: "plat", at: "2026-09-05", byName: "" },
    ])
    expect(list.map((x) => x.at)).toEqual(["2026-09-05", "2026-09-01"])
  })

  it("the invited list says «أُرسل الرابط إلى n · m منهم قدّموا» only once the link was sent", () => {
    expect(guestLinkLine(3, 1)).toEqual({ sent: 3, offered: 1 })
    expect(guestLinkLine(0, 2)).toBeNull()
    expect(guestLinkLine(undefined, 0)).toBeNull()
  })
})

describe("RFQ form — suggested title", () => {
  const copy = { and: " و", more: (n: number) => ` و${n} أخرى` }
  it("names the first two lines, counts the rest, and adds the project when all lines share one", () => {
    expect(suggestRfqTitle([{ name: "حديد تسليح", project: "برج أ" }], copy)).toBe("حديد تسليح — برج أ")
    expect(suggestRfqTitle([{ name: "حديد" }, { name: "أسمنت" }], copy)).toBe("حديد وأسمنت")
    expect(suggestRfqTitle([{ name: "حديد", project: "أ" }, { name: "أسمنت", project: "ب" }, { name: "رمل", project: "أ" }], copy)).toBe("حديد وأسمنت و1 أخرى")
    expect(suggestRfqTitle([{ name: "  " }], copy)).toBe("")
  })

  it("the earliest need-by of all lines", () => {
    expect(earliestNeedBy([{ needBy: "2026-10-10" }, { needBy: "" }, { needBy: "2026-10-02T00:00:00Z" }, {}])).toBe("2026-10-02")
    expect(earliestNeedBy([{}])).toBeNull()
  })
})

describe("sourcing — who may be invited or awarded", () => {
  it("judges by our record alone while the profile is unread", () => {
    expect(sourcingBlockOf({ verified: false }, undefined, TODAY)).toBe("unverified")
    expect(sourcingBlockOf({ crExpiry: "2026-01-01" }, undefined, TODAY)).toBe("cr_expired")
    expect(sourcingBlockOf(null, undefined, TODAY)).toBeNull()
  })

  it("with the profile read: no VAT or an expired CR blocks", () => {
    expect(sourcingBlockOf(null, { vat: "", crExpiry: null }, TODAY)).toBe("no_vat")
    expect(sourcingBlockOf(null, { vat: "300000000000003", crExpiry: "2026-09-01" }, TODAY)).toBe("cr_expired")
    expect(sourcingBlockOf({ verified: true }, { vat: "300000000000003", crExpiry: "2027-09-01" }, TODAY)).toBeNull()
  })

  it("reads SupplierFacts: an unknown VAT is not held against him", () => {
    expect(profileOfFacts(null)).toBeUndefined()
    expect(profileOfFacts({ orgId: "s", hasVatNumber: null, verified: null, crExpiry: null })).toBeUndefined()
    expect(profileOfFacts({ orgId: "s", hasVatNumber: false, verified: true, crExpiry: null })).toEqual({ vat: "", crExpiry: null })
  })

  it("the private list defaults to everyone invitable and drops the blocked from an explicit pick", () => {
    const block = (id: string) => (id === "b" ? ("unverified" as const) : null)
    expect(invitableRecipients(["a", "b", "c"], null, block)).toEqual(["a", "c"])
    expect(invitableRecipients(["a", "b", "c"], ["b", "c"], block)).toEqual(["c"])
  })
})

describe("public reach and the extension pool", () => {
  const platform = [
    { orgId: "p1", name: "حديد الشرق", categories: ["حديد تسليح"], record: null },
    { orgId: "p2", name: "خرسانة الوسطى", categories: ["خرسانة"], record: null },
    { orgId: "p3", name: "غير موثّق", categories: ["حديد ومعادن"], record: { verified: false } },
    { orgId: "p4", name: "خدمات", categories: ["حديد ومعادن"], record: { kind: "svc" as const } },
    { orgId: "p5", name: "شركتنا", memberIds: ["m5"], categories: ["حديد ومعادن"], record: null },
  ]

  it("reaches the material suppliers of the RFQ's categories, less the unvouched", () => {
    expect(publicReach(platform, ["حديد ومعادن"], TREE).map((s) => s.orgId)).toEqual(["p1", "p5"])
    expect(publicReach(platform, ["", "خرسانة"], TREE).map((s) => s.orgId)).toEqual(["p2"])
    expect(publicReach(platform, [], TREE)).toEqual([])
  })

  it("pools ours first (favourites on top), then the platform's of the same categories, never the invited", () => {
    const ours = [
      { orgId: "o1", name: "بكر", isFavorite: false },
      { orgId: "o2", name: "أحمد", isFavorite: true },
      { orgId: "p1", name: "حديد الشرق", isFavorite: false },
    ]
    const pool = extendPool(ours, platform, ["حديد ومعادن"], ["o1", "m5"], TREE)
    expect(pool.map((p) => [p.orgId, p.platform, p.favourite])).toEqual([
      ["o2", false, true],
      ["p1", false, false],
    ])
  })
})

describe("award — the payment line", () => {
  it("says Finance pays before delivery for cash or an advance", () => {
    expect(paidBeforeDelivery({ creditDays: 0 })).toBe(true)
    expect(paidBeforeDelivery({ advancePercent: 30, creditDays: 30 })).toBe(true)
    expect(paidBeforeDelivery({ creditDays: 30 })).toBe(false)
    expect(paidBeforeDelivery({})).toBe(false)
    expect(paidBeforeDelivery({ creditDays: "" })).toBe(false)
  })
})

describe("Sentry keeps the guest routes' tokens masked", () => {
  it("masks the code and papers routes", () => {
    const token = "a".repeat(64)
    expect(scrubTokens(`https://www.mdmaktech.sa/api/rfq-share/${token}/code`)).toBe("https://www.mdmaktech.sa/api/rfq-share/[token]/code")
    expect(scrubTokens(`/api/guest-offer/${token}/papers`)).toBe("/api/guest-offer/[token]/papers")
  })
})
