/**
 * Procurement 2.0 — the purchase order's state in the PRD's words (§8 table, prototype `poState` / `WHO` / `nextStep` / `poSeg`):
 * one state per order and who it waits on, one definition of «متأخرة» (R-25), the supplier's decline that keeps the order alive
 * (R-23), a lump sum (R-17), a supplier with no VAT (R-18), a piece order with its English unit (R-20), the header tags, the
 * versions of an order after it was sent (PO-15) and the owner's gate on an advance to a supplier with no record (PO-14).
 */

import { draftPurchaseOrder, draftSplitOrder, type AwardOfferLike, type AwardRfqInput, type RfqLike } from "@/lib/procurement/writes"
import { daysLate, isLumpSum, poCommitment, poValue } from "@/lib/procurement/po"
import { advanceNeedsOwner, advanceState } from "@/lib/procurement/po-extras"
import {
  advanceOwnerRequired,
  advanceOwnerWaiting,
  derivedVersionEntries,
  lineUnitName,
  nextVersionPatch,
  orderSiteKey,
  pendingVersion,
  pieceView,
  poDueDate,
  poNextStep,
  poSeg,
  poSiteOf,
  poState,
  poTags,
  poVer,
  poVersions,
  supplierHasRecord,
  versionNeedsAcceptance,
  type PoStateCtx,
} from "@/lib/procurement/po-state"
import { segmentOf } from "@/components/procurement/PoModel"
import { DEFAULT_POLICIES, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import type { StepNotice } from "@/lib/procurement/next-step"

const NOW = new Date("2026-10-19T09:00:00Z")
const ctx = (over: Partial<PoStateCtx> = {}): PoStateCtx => ({ notices: [], financeOn: false, acceptanceDays: 1, now: NOW, ...over })

const line = (over: Record<string, unknown> = {}) => ({ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (over: Partial<PurchaseOrder> & Record<string, unknown> = {}): PurchaseOrder =>
  ({
    id: "po1",
    organizationId: "org",
    docNumber: "PO-2026/014",
    status: "accepted",
    basis: "rfq",
    rfqId: "r1",
    rfqTitle: "حديد",
    offerId: "o1",
    supplierOrgId: "sup1",
    supplierUserId: "su1",
    supplierName: "مصنع الجودة",
    isGuestSupplier: false,
    lines: [line()],
    totalExVat: 30000,
    vatRate: 0.15,
    offersCount: 3,
    lowestOfferTotal: 30000,
    shortCompetition: false,
    noOfficialQuote: false,
    preparedById: "u1",
    preparedByName: "سعد",
    createdAt: "2026-10-10T08:00:00.000Z",
    approverKind: "manager",
    approvedById: "u2",
    approvedByName: "منى",
    approvedAt: "2026-10-11T08:00:00.000Z",
    sentAt: "2026-10-12T08:00:00.000Z",
    sentChannel: "portal",
    supplierAcceptedAt: "2026-10-13T08:00:00.000Z",
    promisedDate: "2026-10-30",
    log: [],
    ...over,
  }) as unknown as PurchaseOrder

const notice = (over: Partial<StepNotice> = {}): StepNotice => ({ id: "d1", poId: "po1", status: "pending_confirmation", deliveryDate: "2026-10-25", ...over })

describe("the state table (PUR-07 / PRD §8) — one state, who we wait on, since when", () => {
  it("not approved → the approver; returned → the preparer", () => {
    expect(poState(po({ status: "awaiting_approval", approvedAt: null }), ctx())).toMatchObject({ k: "appr", who: "app", since: "2026-10-10T08:00:00.000Z" })
    expect(poState(po({ status: "awaiting_approval", returnedReason: "السعر", log: [{ at: "2026-10-14T08:00:00Z", action: "returned", byId: "u2", byName: "منى" }] }), ctx())).toMatchObject({ k: "ret", who: "us", since: "2026-10-14T08:00:00Z" })
  })
  it("approved and not sent is ours to send", () => {
    expect(poState(po({ status: "approved" }), ctx())).toMatchObject({ k: "send", who: "us", since: "2026-10-11T08:00:00.000Z" })
  })
  it("sent → the supplier; past the acceptance window → «لم يقبل» still the supplier", () => {
    expect(poState(po({ status: "sent", sentAt: "2026-10-18T08:00:00Z", supplierAcceptedAt: null }), ctx())).toMatchObject({ k: "sent", who: "sup" })
    expect(poState(po({ status: "sent", sentAt: "2026-10-12T08:00:00Z", supplierAcceptedAt: null }), ctx())).toMatchObject({ k: "nacc", who: "sup", since: "2026-10-12T08:00:00Z" })
  })
  it("R-23: the supplier declined → the order stays LIVE in red, the move is ours, and the first button cancels it", () => {
    const declined = po({ status: "sent", supplierAcceptedAt: null, supplierDecline: { at: "2026-10-14T08:00:00Z", reason: "price", byId: "su1", byName: "سامر" } })
    const s = poState(declined, ctx())
    expect(s).toMatchObject({ k: "dec", who: "us", since: "2026-10-14T08:00:00Z" })
    const next = poNextStep(declined, ctx())
    expect(next.tone).toBe("bad")
    expect(next.buttons[0].id).toBe("cancel")
    expect(next.params.reason).toBe("price")
    expect(poSeg(declined, ctx())).toBe("act")
    // …and an order the OLD way (cancelled with his decline) is simply cancelled.
    expect(poState(po({ status: "cancelled", supplierDecline: { at: "x", reason: "other", byId: "s", byName: "s" } }), ctx()).k).toBe("cancel")
  })
  it("an advance: the owner's gate first (a supplier with no record), then Finance — or us without Finance", () => {
    const gated = po({ advancePercent: 30, advanceOwner: { required: true, approvedAt: null } })
    expect(advanceState(gated as never)).toBe("owner")
    expect(poState(gated, ctx())).toMatchObject({ k: "adv", who: "app" })
    const approved = po({ advancePercent: 30, advanceOwner: { required: true, approvedAt: "2026-10-14T08:00:00Z" } })
    expect(advanceNeedsOwner(approved)).toBe(false)
    expect(poState(approved, ctx({ financeOn: true }))).toMatchObject({ k: "adv", who: "fin" })
    expect(poState(approved, ctx({ financeOn: false }))).toMatchObject({ k: "adv", who: "us" })
    expect(poNextStep(gated, ctx()).buttons.map((b) => b.id)).toEqual(["approve_advance"])
    expect(poNextStep(approved, ctx({ financeOn: false })).buttons.map((b) => b.id)).toEqual(["mark_advance_paid"])
  })
  it("a reject nobody decided is ours; it comes before everything that follows", () => {
    expect(poState(po({ lines: [line({ accepted: 6, rejected: 2 })] }), ctx())).toMatchObject({ k: "rej", who: "us" })
    expect(poNextStep(po({ lines: [line({ accepted: 6, rejected: 2 })] }), ctx()).buttons.map((b) => b.id)).toEqual(["ask_replace", "ask_discount", "return_items"])
  })
  it("an open delivery notice: forward (us) · on the way (nobody) · to count (the receiver) · counted (us)", () => {
    expect(poState(po(), ctx({ notices: [notice()] }))).toMatchObject({ k: "fwd", who: "us" })
    expect(poState(po(), ctx({ notices: [notice({ forwardedTo: { name: "سالم", userId: "r1", at: "2026-10-18T08:00:00Z" } })] }))).toMatchObject({ k: "transit", who: "none" })
    expect(poState(po(), ctx({ notices: [notice({ deliveryDate: "2026-10-15", forwardedTo: { name: "سالم", userId: "r1", at: "2026-10-14T08:00:00Z" } })] }))).toMatchObject({ k: "count", who: "rcv" })
    expect(poState(po(), ctx({ notices: [notice({ receiverReport: { counted: 1 }, forwardedTo: { name: "سالم", userId: "r1" } })] }))).toMatchObject({ k: "book", who: "us" })
  })
  it("part received → the supplier; an off-platform supplier whose day came → us; late → the supplier; else waiting", () => {
    expect(poState(po({ lines: [line({ accepted: 4 })] }), ctx())).toMatchObject({ k: "part", who: "sup" })
    expect(poState(po({ isGuestSupplier: true, promisedDate: "2026-10-19" }), ctx())).toMatchObject({ k: "offp", who: "us" })
    expect(poState(po({ promisedDate: "2026-10-10" }), ctx())).toMatchObject({ k: "late", who: "sup" })
    expect(poState(po(), ctx())).toMatchObject({ k: "wait", who: "sup" })
  })
  it("fully received → Finance's payment with Finance, complete without it; closed and cancelled are over", () => {
    const full = po({ lines: [line({ accepted: 10 })] })
    expect(poState(full, ctx({ financeOn: true }))).toMatchObject({ k: "unpaid", who: "fin" })
    expect(poState(full, ctx({ financeOn: false }))).toMatchObject({ k: "done", who: "none" })
    expect(poState(po({ status: "closed", closedAt: "2026-10-17T08:00:00Z" }), ctx())).toMatchObject({ k: "done" })
    expect(poState(po({ status: "cancelled" }), ctx())).toMatchObject({ k: "cancel", who: "none" })
  })
  it("the sentence's numbers: how long, how much is left", () => {
    expect(poNextStep(po({ status: "awaiting_approval", approvedAt: null }), ctx()).params.days).toBe(9)
    expect(poNextStep(po({ lines: [line({ accepted: 4 })] }), ctx()).params).toMatchObject({ received: 4, ordered: 10, left: 6, unit: "طن" })
    expect(poNextStep(po({ promisedDate: "2026-10-10" }), ctx()).params.days).toBe(9)
  })
})

describe("R-25 · one definition of late, and the segments are a partition", () => {
  const orders = [
    po({ id: "a", status: "awaiting_approval", approvedAt: null }),
    po({ id: "b", status: "approved" }),
    po({ id: "c", promisedDate: "2026-10-10" }),
    po({ id: "d" }),
    po({ id: "e", lines: [line({ accepted: 10 })] }),
    po({ id: "f", status: "cancelled" }),
    po({ id: "g", status: "sent", sentAt: "2026-10-18T08:00:00Z", supplierAcceptedAt: null }),
  ]
  it("each order sits in exactly one of act · wait · late · done", () => {
    const seg = Object.fromEntries(orders.map((o) => [o.id, poSeg(o, ctx())]))
    expect(seg).toEqual({ a: "act", b: "act", c: "late", d: "wait", e: "done", f: "done", g: "wait" })
  })
  it("late is the lateness number the domain already computes — a notice in time that waits for OUR count is nobody's lateness", () => {
    const waiting = [notice({ poId: "c", deliveryDate: "2026-10-09", forwardedTo: { name: "سالم", userId: "r", at: "2026-10-08T08:00:00Z" } })]
    expect(daysLate(orders[2], NOW)).toBe(9)
    expect(poSeg(orders[2], ctx())).toBe("late")
    expect(daysLate(orders[2], NOW, waiting)).toBe(0)
    expect(poSeg(orders[2], ctx({ notices: waiting }))).toBe("wait")
  })
  it("old addresses keep opening the right segment", () => {
    expect(segmentOf("awaiting_approval")).toBe("act")
    expect(segmentOf("live")).toBe("wait")
    expect(segmentOf("received")).toBe("done")
    expect(segmentOf("late")).toBe("late")
    expect(segmentOf("act")).toBe("act")
    expect(segmentOf("nonsense")).toBeNull()
  })
})

describe("the header tags (PO-15)", () => {
  const policies = { directPurchaseCap: 5000, minOffers: 3 }
  it("not the lowest: the reason travels; low competition: n of 3; direct above the cap; lump sum; no VAT", () => {
    const tags = poTags(po({ lowestOfferTotal: 25000, awardReasonText: "أسرع توريد", shortCompetition: true, offersCount: 2, vatRate: 0, lines: [line({ unitPrice: null })] }), policies)
    expect(tags.map((t) => t.id)).toEqual(["notLowest", "lowComp", "lump", "noVat"])
    expect(tags[0]).toMatchObject({ why: "أسرع توريد" })
    expect(tags[1]).toMatchObject({ n: 2, of: 3 })
  })
  it("a direct order above the cap with its reason; stored tags win over the facts", () => {
    expect(poTags(po({ basis: "direct", rfqId: null, totalExVat: 10950, lines: [line({ quantity: 10, unitPrice: 1095 })], awardReasonText: "مورّد وحيد لهذه المادة" }), policies).map((t) => t.id)).toEqual(["directOver"])
    const stored = poTags(po({ tags: { notLowest: { why: "الضمان" }, lowComp: { n: 1, why: "عاجل لا يحتمل الانتظار" } } }), policies)
    expect(stored).toMatchObject([{ id: "notLowest", why: "الضمان" }, { id: "lowComp", why: "عاجل لا يحتمل الانتظار", n: 1 }])
  })
  it("an ordinary order carries no tag", () => {
    expect(poTags(po(), policies)).toEqual([])
  })
})

describe("R-17 · a lump sum is one value; R-18 · a supplier with no VAT carries none", () => {
  const rfq: RfqLike = { id: "r1", title: "طلب", organizationId: "org", products: [{ name: "مادة أ", quantity: 10, unitOfMeasure: "م" }, { name: "مادة ب", quantity: 4, unitOfMeasure: "كيس" }] }
  const actor: ProcActor = { uid: "u1", name: "سعد", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
  const base: AwardOfferLike = { id: "o1", price: "9000", supplierId: "su1", organizationId: "sup1", supplierName: "الأفق" }
  const draft = (offer: AwardOfferLike) => draftPurchaseOrder(actor, { rfq, offer, offers: [offer], policies: DEFAULT_POLICIES }, NOW)

  it("a lump-sum offer: lines carry no prices, the order's value is the one figure, with VAT on top", () => {
    const d = draft(base)
    const order = { ...d, id: "p", docNumber: "PO-1" } as PurchaseOrder
    expect(isLumpSum(order)).toBe(true)
    expect(order.lines.every((l) => l.unitPrice == null)).toBe(true)
    expect(poValue(order)).toBe(9000)
    expect(poCommitment(order)).toBe(10350)
    expect(poTags(order, { directPurchaseCap: 5000, minOffers: 3 }).map((t) => t.id)).toContain("lump")
  })
  it("a supplier who is not VAT-registered: no VAT on the order, and the header says so", () => {
    const d = draft({ ...base, vatRegistered: false })
    const order = { ...d, id: "p", docNumber: "PO-1" } as PurchaseOrder
    expect(order.vatRate).toBe(0)
    expect(order.noVat).toBe(true)
    expect(poCommitment(order)).toBe(poValue(order))
    expect(poTags(order, { directPurchaseCap: 5000, minOffers: 3 }).map((t) => t.id)).toContain("noVat")
    expect(draft(base).vatRate).toBe(0.15)
  })
})

describe("R-20 · a piece order: 30 × «قطعة 6 م» = 180 م (needed 175), and the unit has an English name", () => {
  const rfq: RfqLike = { id: "r2", title: "حديد", organizationId: "org", products: [{ name: "اسياخ حديد 12 مم", quantity: 175, unitOfMeasure: "م" }] }
  const offer: AwardOfferLike = { id: "o2", price: "2220", supplierId: "su1", organizationId: "sup1", supplierName: "الأفق" }
  const actor: ProcActor = { uid: "u1", name: "سعد", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
  const input: AwardRfqInput = {
    rfq,
    offers: [offer],
    groups: [{ offer, lines: [{ rfqProductIndex: 0, unitPrice: 74, pack: { len: 6, name: { ar: "قطعة 6 م", en: "6 m bar" }, base: "م" } }], total: 2220, requestedDeliveryDate: null, lowestForLines: 2220, offLowest: false }],
    unpicked: [],
    awardReason: null,
    breakdown: false,
    policies: DEFAULT_POLICIES,
  }
  const order = (() => ({ ...draftSplitOrder(actor, input, input.groups[0], NOW), id: "p", docNumber: "PO-1" }) as PurchaseOrder)()

  it("the order counts pieces and keeps the request's quantity and unit", () => {
    expect(order.lines[0]).toMatchObject({ unit: "قطعة 6 م", quantity: 30, pk: 6, need: 175, base: "م", unitPrice: 74 })
    expect(poValue(order)).toBe(2220)
  })
  it("shown in both languages: the pack's name translated, the total in the request unit, the surplus", () => {
    expect(pieceView(order.lines[0], "ar")).toMatchObject({ pieces: 30, unit: "قطعة 6 م", total: 180, base: "م", need: 175, extra: 5 })
    expect(pieceView(order.lines[0], "en")?.unit).toBe("6 m bar")
    expect(lineUnitName(order.lines[0], "en")).toBe("6 m bar")
    expect(lineUnitName(line() as never, "en")).toBe("طن")
    expect(pieceView(line() as never, "ar")).toBeNull()
  })
})

describe("order per supplier × site and the delivery site frozen on it (G-05)", () => {
  it("the key makes the pair; an order without a snapshot reads its location text", () => {
    expect(orderSiteKey("sup1", "siteA")).not.toBe(orderSiteKey("sup1", "siteB"))
    expect(orderSiteKey("sup1", "siteA")).toBe(orderSiteKey("sup1", "siteA"))
    expect(poSiteOf({ deliveryLocation: "الرياض", deliveryDistrict: "السلي" })).toMatchObject({ name: "الرياض", district: "السلي" })
    expect(poSiteOf({ site: { id: "s1", name: "موقع النخيل", receiver: { name: "سالم", phone: "0551234567" } } })?.receiver?.name).toBe("سالم")
    expect(poSiteOf({})).toBeNull()
  })
  it("a split award carries each group's site and key", () => {
    const rfq: RfqLike = { id: "r3", title: "t", organizationId: "org", products: [{ name: "أ", quantity: 1, unitOfMeasure: "م" }] }
    const offer: AwardOfferLike = { id: "o3", price: "100", supplierId: "su1", organizationId: "sup1", supplierName: "x" }
    const input: AwardRfqInput = { rfq, offers: [offer], unpicked: [], awardReason: null, breakdown: false, policies: DEFAULT_POLICIES, groups: [{ offer, lines: [{ rfqProductIndex: 0, unitPrice: 100 }], total: 100, requestedDeliveryDate: null, lowestForLines: 100, offLowest: false, site: { id: "siteA", name: "موقع أ" } }] }
    const d = draftSplitOrder({ uid: "u", name: "n", isOwner: true, canApprove: true, canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true }, input, input.groups[0], NOW)
    expect(d.site).toMatchObject({ id: "siteA" })
    expect(d.siteKey).toBe(orderSiteKey("sup1", "siteA"))
  })
})

describe("PO-15 · versions: cancel · a new date · closing short each make one", () => {
  const by = { uid: "u1", name: "سعد" }
  it("an order never changed is version 1; the log of an older order says how many it had", () => {
    expect(poVer(po())).toBe(1)
    const old = po({ log: [{ at: "2026-10-14T08:00:00Z", action: "date_updated", byId: "u", byName: "n", params: { date: "2026-11-01" }, note: null }, { at: "2026-10-15T08:00:00Z", action: "remainder_cancelled", byId: "u", byName: "n" }] })
    expect(derivedVersionEntries(old).map((v) => v.kind)).toEqual(["date", "close_short"])
    expect(poVer(old)).toBe(3)
    expect(poVersions(old).map((v) => v.n)).toEqual([1, 2, 3])
  })
  it("the next version opens from the stored or derived count, and the supplier is to accept a changed date or a short close", () => {
    const next = nextVersionPatch(po(), "date", by, "2026-10-20T08:00:00Z", { params: { date: "2026-11-02" } })
    expect(next.ver).toBe(2)
    expect(next.versions.map((v) => v.kind)).toEqual(["sent", "date"])
    expect(versionNeedsAcceptance({ kind: "date" })).toBe(true)
    expect(versionNeedsAcceptance({ kind: "cancel" })).toBe(false)
    const changed = po({ ver: 2, versions: next.versions })
    expect(pendingVersion(changed)?.n).toBe(2)
    const accepted = po({ ver: 2, versions: next.versions.map((v) => (v.n === 2 ? { ...v, acceptedAt: "2026-10-20T10:00:00Z" } : v)) })
    expect(pendingVersion(accepted)).toBeNull()
    expect(pendingVersion(po({ ...changed, sentAt: null }))).toBeNull()
  })
  it("a stored count never falls below what the log says", () => {
    const stale = po({ ver: 1, log: [{ at: "2026-10-14T08:00:00Z", action: "date_updated", byId: "u", byName: "n", note: null }] })
    expect(poVer(stale)).toBe(2)
  })
})

describe("PO-14 · an advance to a supplier with no supply record waits for the owner", () => {
  it("who counts as known: an accepted order of his before this one; a guest by his name", () => {
    const first = po({ id: "x", advancePercent: 30 })
    expect(supplierHasRecord(first, [])).toBe(false)
    expect(supplierHasRecord(first, [po({ id: "old", supplierAcceptedAt: "2026-01-01T00:00:00Z" })])).toBe(true)
    expect(supplierHasRecord(first, [po({ id: "old", supplierAcceptedAt: null })])).toBe(false)
    expect(supplierHasRecord(first, [po({ id: "old", status: "cancelled" })])).toBe(false)
    const guest = po({ id: "g", isGuestSupplier: true, supplierOrgId: "guest", supplierName: "مؤسسة الندى" })
    expect(supplierHasRecord(guest, [po({ id: "g0", isGuestSupplier: true, supplierOrgId: "guest", supplierName: "مؤسسة الندى", supplierAcceptedAt: "2026-02-01T00:00:00Z" })])).toBe(true)
  })
  it("the policy and an advance make the gate; the owner's list shows only what waits for him", () => {
    expect(advanceOwnerRequired(po({ advancePercent: 30 }), { advanceUnknownSupplierOwner: true }, false)).toBe(true)
    expect(advanceOwnerRequired(po({ advancePercent: 30 }), { advanceUnknownSupplierOwner: true }, true)).toBe(false)
    expect(advanceOwnerRequired(po({ advancePercent: 30 }), { advanceUnknownSupplierOwner: false }, false)).toBe(false)
    expect(advanceOwnerRequired(po(), { advanceUnknownSupplierOwner: true }, false)).toBe(false)
    const waiting = po({ id: "w", advancePercent: 30, advanceOwner: { required: true, approvedAt: null } })
    expect(advanceOwnerWaiting([waiting, po({ id: "n" })], { isOwner: true }).map((o) => o.id)).toEqual(["w"])
    expect(advanceOwnerWaiting([waiting], { isOwner: false })).toEqual([])
  })
  it("a buyer's own mark of the day paid is a reference once Finance is in the package (PO-07)", () => {
    const marked = po({ advancePercent: 30, advancePaidDay: "2026-10-14" })
    expect(advanceState(marked as never)).toBe("paid")
    expect(advanceState(marked as never, true)).toBe("requested")
  })
})

describe("what the supplier commits to by accepting", () => {
  it("the acceptance window plus his lead time, counted from the approval day", () => {
    expect(poDueDate("2026-10-19", 1, 10)).toBe("2026-10-30")
    expect(poDueDate("2026-10-19", 1, null)).toBeNull()
  })
})
