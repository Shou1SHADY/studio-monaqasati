/**
 * Procurement 1.5, PUR-10 (question 4): a company WITHOUT Project Management — the team asks
 * for materials itself («طلب مواد»). The request reaches the incoming desk with no technical
 * approval, carries its own number «ط.م-2026/014», and its progress is READ from the RFQs and
 * orders that name it, never written back.
 */
import { displayNeedRef } from "@/lib/procurement/format"
import { needSourceParam, parseNeedSource } from "@/lib/procurement/needs"
import { incomingFromNeed } from "@/lib/procurement/rfq-editor"
import { needKeyOfSource, rfqNeedSources } from "@/lib/procurement/rfq-view"
import { requestCards } from "@/lib/procurement/incoming-requests"
import { buildNeedRows } from "@/lib/procurement/need-desk"
import {
  rfqNamesRequest,
  teamNeed,
  teamProgress,
  teamRequestRefusal,
  teamRequestState,
  teamSource,
  withdrawRefusal,
  type TeamRequestDoc,
} from "@/lib/procurement/team-requests"
import { DEFAULT_POLICIES, type PurchaseOrder } from "@/lib/procurement/types"

const req = (over: Partial<TeamRequestDoc> = {}): TeamRequestDoc => ({
  id: "t1",
  organizationId: "org",
  number: "MAT-2026/014",
  lines: [
    { name: "بلك اسمنتي مفرغ 20", unit: "حبة", quantity: 2000 },
    { name: "اسمنت عادي", unit: "كيس", quantity: 200 },
  ],
  needBy: "2026-11-10",
  siteId: "site_yasmin",
  place: { label: "مجمع الياسمين — 5 فلل", city: "Riyadh", district: "الياسمين" },
  note: "التسليم صباحاً من البوابة الشمالية",
  requestedById: "u1",
  requestedByName: "فهد",
  createdAt: "2026-10-20T08:00:00Z",
  status: "open",
  ...over,
})
const order = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
  ({ id: "po1", organizationId: "org", docNumber: "PO-2026/021", status: "accepted", rfqId: "r1", lines: [{ id: "l1", name: "بلك", unit: "حبة", quantity: 2000, unitPrice: 4, accepted: 0, rejected: 0, held: 0, cancelled: 0 }], ...over }) as PurchaseOrder

describe("the number reads «ط.م-2026/014» in Arabic and MR-2026/014 in English (Procurement 2.0, REQ-04), MAT-2026/014 stored", () => {
  it("display", () => {
    expect(displayNeedRef("MAT-2026/014", "ar")).toBe("ط.م-2026/014")
    expect(displayNeedRef("MAT-2026/014", "en")).toBe("MR-2026/014")
    // The project's own number still reads as before.
    expect(displayNeedRef("MR 03", "ar")).toBe("ط.م 03")
  })
})

describe("what stops it being sent", () => {
  const today = "2026-10-20"
  it("every row needs a material, a quantity and a unit; a need-by date not past; a place with its city", () => {
    expect(teamRequestRefusal(req(), today)).toBeNull()
    expect(teamRequestRefusal(req({ lines: [] }), today)).toBe("lines")
    expect(teamRequestRefusal(req({ lines: [{ name: "x", unit: "", quantity: 1 }] }), today)).toBe("lines")
    expect(teamRequestRefusal(req({ lines: [{ name: "x", unit: "t", quantity: 0 }] }), today)).toBe("lines")
    expect(teamRequestRefusal(req({ needBy: "2026-10-19" }), today)).toBe("need_by")
    expect(teamRequestRefusal(req({ place: { label: "", city: "Riyadh", district: "" } }), today)).toBe("place")
    expect(teamRequestRefusal(req({ place: { label: "موقع", city: "", district: "" } }), today)).toBe("place")
  })
})

describe("it travels like any request — a source the RFQ and the editor understand", () => {
  it("source ↔ ?requests= param ↔ need key", () => {
    const s = teamSource("t1")
    expect(needSourceParam(s)).toBe("team:t1")
    expect(parseNeedSource("team:t1")).toEqual(s)
    expect(needKeyOfSource(s)).toBe("team:t1")
    expect(rfqNeedSources({ needSources: [s] })).toEqual([s])
  })
  it("on the desk it is a «team» need, new, with no project and its own site", () => {
    const n = teamNeed(req(), [], [])
    expect(n).toMatchObject({ key: "team:t1", kind: "team", state: "action", refLabel: "MAT-2026/014", projectId: null, projectName: null, siteId: "site_yasmin", requestedBy: "فهد" })
    expect(n.lines.map((l) => l.quantity)).toEqual([2000, 200])
  })
  it("the editor places it at its site, or at the typed address", () => {
    const sites = [{ id: "site_yasmin", kind: "site" as const, name: "مجمع الياسمين — 5 فلل", city: "Riyadh", district: "الياسمين", address: "", receiverId: null }]
    expect(incomingFromNeed(teamNeed(req(), [], []), sites)).toMatchObject({ siteId: "site_yasmin", label: "مجمع الياسمين — 5 فلل", city: "Riyadh", district: "الياسمين", ref: "MAT-2026/014" })
    expect(incomingFromNeed(teamNeed(req({ siteId: null, place: { label: "حي النرجس، شارع 12", city: "Riyadh", district: "النرجس" } }), [], []), sites)).toMatchObject({ siteId: null, label: "حي النرجس، شارع 12", city: "Riyadh" })
  })
  it("arrives as ONE request card, new, with «انشره» / «جهّزه» like a project's", () => {
    const n = teamNeed(req(), [], [])
    const rows = buildNeedRows([n], { now: new Date("2026-10-20T08:00:00Z"), policies: DEFAULT_POLICIES, agreements: [], history: [], orders: [], rfqs: [], onHand: () => null, makeable: () => false, mfgRequests: {} })
    const cards = requestCards(rows, [])
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ key: "team:t1", state: "new" })
  })
})

describe("its progress is read from the RFQs and orders that name it", () => {
  const rfq = { id: "r1", status: "New", rfqNumber: "RFQ-2026/031", needSources: [teamSource("t1")] }
  it("a draft naming it is not «in offers» (it is Procurement's «مُجهَّز»)", () => {
    expect(teamProgress("t1", [{ ...rfq, status: "Draft" }], []).rfq).toBeNull()
    expect(rfqNamesRequest({ ...rfq, status: "Draft" }, "t1")).toBe(true)
  })
  it("sent → in offers → in an order → on the way → received", () => {
    expect(teamRequestState(req(), teamProgress("t1", [], []))).toBe("sent")
    expect(teamRequestState(req(), teamProgress("t1", [rfq], []))).toBe("rfq")
    expect(teamRequestState(req(), teamProgress("t1", [rfq], [order()]))).toBe("order")
    const partial = order({ lines: [{ id: "l1", name: "بلك", unit: "حبة", quantity: 2000, unitPrice: 4, accepted: 500, rejected: 0, held: 0, cancelled: 0 }] })
    expect(teamRequestState(req(), teamProgress("t1", [rfq], [partial]))).toBe("on_way")
    const full = order({ lines: [{ id: "l1", name: "بلك", unit: "حبة", quantity: 2000, unitPrice: 4, accepted: 2000, rejected: 0, held: 0, cancelled: 0 }] })
    expect(teamRequestState(req(), teamProgress("t1", [rfq], [full]))).toBe("received")
    expect(teamNeed(req(), [rfq], [full])).toMatchObject({ state: "done", endKind: "arrived", poNumber: "PO-2026/021", rfqNumber: "RFQ-2026/031" })
  })
  it("a cancelled order does not count; another RFQ's order does not either", () => {
    expect(teamProgress("t1", [rfq], [order({ status: "cancelled" })]).po).toBeNull()
    expect(teamProgress("t1", [rfq], [order({ rfqId: "other" })]).po).toBeNull()
  })
  it("declined: «تعذّر الشراء» with the reason; the desk shows it failed", () => {
    const declined = req({ status: "declined", declinedReason: "المادة متوقفة لدى المصانع", declinedByName: "سارة" })
    expect(teamRequestState(declined, teamProgress("t1", [], []))).toBe("declined")
    expect(teamNeed(declined, [], [])).toMatchObject({ state: "done", endKind: "refused", endNote: "المادة متوقفة لدى المصانع" })
  })
})

describe("its requester withdraws it — only his, only while nobody put it in an RFQ", () => {
  it("refusals", () => {
    expect(withdrawRefusal(req(), "u1", false)).toBeNull()
    expect(withdrawRefusal(req(), "u2", false)).toBe("not_yours")
    expect(withdrawRefusal(req({ status: "declined" }), "u1", false)).toBe("closed")
    expect(withdrawRefusal(req(), "u1", true)).toBe("in_rfq")
  })
})
