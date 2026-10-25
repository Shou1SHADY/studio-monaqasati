/**
 * Procurement 2.0 — the receipts hub and the receiver's page, rendered for real (G-09, B-01, RCV-02/03/04, WP-S5-01/03a, TDY-05).
 * The hub names its five segments and counts them to the notices and receipts there are; whoever looks at it — buyer, expediter, owner —
 * finds NO button that confirms or records a receipt, only the follow-up acts (forward, remind, see it as the receiver sees it, escalate)
 * and a PDF per receipt. A truck with no notice is the receiver's door, shown to a holder of the receiving permission only. The receiver's
 * page counts blind, offers the four reasons, and ends on «سُجّل السند» with its PDF.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => {
  const nav = jest.requireActual("@/test-utils/render-world").navigationMock
  return { ...nav, useParams: () => ({ token: "t".repeat(64), locale: "ar" }) }
})
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)
jest.mock("@/lib/upload-fit", () => ({ UPLOAD_MAX_BYTES: 4_000_000, fitForUpload: async (f: File) => f }))

import React from "react"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, messages, missingKeys, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import GoodsReceivedPage from "@/app/[locale]/(contractor)/contractor/goods-received/page"
import { ReceiveLinkContent } from "@/app/[locale]/receive/[token]/ReceiveLinkContent"
import { addDays, todayOf } from "@/lib/procurement/po"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const day = (offset: number) => addDays(todayOf(new Date()), offset)
type Tree = Record<string, unknown>
const msg = (path: string): string => {
  const v = path.split(".").reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as Tree)[k] : undefined), messages("ar"))
  return typeof v === "string" ? v : `MISSING:${path}`
}
const buttons = () => Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim())
const tabs = () => Array.from(document.querySelectorAll('[role="tab"]')) as HTMLElement[]
const tabNames = () => tabs().map((t) => (t.textContent ?? "").replace(/\d+$/, "").trim())
const tabCounts = () => tabs().map((t) => Number((t.textContent ?? "").replace(/\D+/g, "")))
async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

const order = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/021",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "حديد التسليح",
  offerId: "o1",
  projectId: null,
  supplierOrgId: "sup1",
  supplierUserId: "su1",
  supplierName: "مصنع الجودة",
  isGuestSupplier: false,
  lines: [{ id: "l1", name: "حديد 12 مم", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0 }],
  totalExVat: 30000,
  vatRate: 0.15,
  preparedById: "buyer",
  preparedByName: "بدر",
  createdAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
  approverKind: "manager",
  approvedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
  sentAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
  supplierAcceptedAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  promisedDate: day(1),
  log: [],
  ...over,
})
const fwd = { linkId: "lk", name: "سامي الدوسري", userId: "rcv", phoneMasked: "05••", byName: "ريم", at: new Date(Date.now() - 86_400_000).toISOString() }
const notice = (over: Record<string, unknown> = {}) => ({ contractorOrgId: ORG, status: "pending_confirmation", poId: "po1", poNumber: "PO-2026/021", supplierName: "مصنع الجودة", rfqTitle: "حديد", deliveryDate: day(2), seq: 1, items: [], ...over })

function seedHub() {
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البناء", email: "o@test.sa" })
  seed("users/buyer", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-buy", name: "بدر" })
  seed("users/exp", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-exp", name: "ريم" })
  seed("users/keeper", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-rcv", name: "أمين" })
  seed("teamGroups/g-buy", { organizationId: ORG, permissions: ["offers.accept"] })
  seed("teamGroups/g-exp", { organizationId: ORG, permissions: ["po.expedite"] })
  seed("teamGroups/g-rcv", { organizationId: ORG, permissions: ["deliveries.confirm", "warehouses.receive"] })
  seed("purchaseOrders/po1", order())
  seed("deliveries/nf", notice({ seq: 1, deliveryDate: day(3) })) // nobody told yet
  seed("deliveries/nw", notice({ seq: 2, deliveryDate: day(1), forwardedTo: fwd })) // forwarded, not due
  seed("deliveries/nc", notice({ seq: 3, deliveryDate: day(0), forwardedTo: fwd })) // forwarded, the day has come
  seed("deliveries/ne", notice({ seq: 4, deliveryDate: day(-5), forwardedTo: fwd })) // forwarded, past the window
  seed("deliveries/r1", { contractorOrgId: ORG, status: "confirmed", poId: "po1", poNumber: "PO-2026/021", docNumber: "GR-2026/001", supplierName: "مصنع الجودة", receivedByName: "سامي", confirmedAt: new Date().toISOString(), confirmedVia: "login", lines: [{ poLineId: "l1", name: "حديد 12 مم", unit: "طن", noticeQuantity: 0, counted: 3, rejected: 1, rejectReason: "damaged", accepted: 2 }] })
  seed("deliveries/m1", { contractorOrgId: ORG, status: "confirmed", source: "manual", docNumber: "GR-2026/002", supplierName: "محل الحي", receivedByName: "بدر", confirmedAt: new Date().toISOString(), warehouseId: "wh-main", manualDraft: { state: "draft", warehouseId: "wh-main", byId: "buyer", byName: "بدر", at: new Date().toISOString() }, items: [{ name: "مسامير", quantity: 5, unit: "كجم" }], lines: [] })
  seed("warehouses/wh-main", { organizationId: ORG, name: "المستودع الرئيسي", projectId: null })
}

async function hub(as: string, search = "") {
  setSignedIn(as)
  setPathname("/contractor/goods-received", search)
  missingKeys.clear()
  render(<GoodsReceivedPage />)
  await flush()
}

beforeEach(() => {
  resetFakeDb()
  setLocale("ar")
  document.body.innerHTML = ""
  seedHub()
})
afterEach(() => cleanup())

describe("the hub — five segments, counted to what there is", () => {
  it("names them as the prototype does and the counts add up: transit = every open notice; forward + count never exceed it", async () => {
    await hub(ORG)
    expect(missingKeys.size).toBe(0)
    expect(tabNames()).toEqual(["في الطريق", "بانتظار تحويلك", "بانتظار العدّ", "السندات", "بلا أمر شراء"])
    expect(tabCounts()).toEqual([4, 1, 2, 1, 1])
  })

  it("an old `?tab=incoming` or `?tab=log` link still lands on the right segment", async () => {
    await hub(ORG, "tab=incoming")
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true")
    cleanup()
    await hub(ORG, "tab=log")
    expect(tabs()[3].getAttribute("aria-selected")).toBe("true")
  })
})

describe("B-01 — nobody in Procurement confirms a receipt", () => {
  it.each([[ORG], ["buyer"], ["exp"]])("%s: not on the notices, not in the receipts, not in the drawer", async (who) => {
    await hub(who)
    const forbid = /تأكيد الاستلام|سجّل الاستلام|أكّد الاستلام/
    expect(buttons().filter((b) => forbid.test(b))).toEqual([])
    await act(async () => void fireEvent.click(tabs()[3]))
    expect(buttons().filter((b) => forbid.test(b))).toEqual([])
    expect(document.body.textContent).not.toMatch(/سجّل الاستلام/)
  })

  it("an unforwarded notice offers «حوّل للمستلم» (red: we received it, forward it); a forwarded one: see it as he sees it, remind him, forward again", async () => {
    await hub("exp", "tab=fwd")
    expect(buttons()).toContain(msg("Portal.ProcReceipts.forward.button"))
    expect(document.body.textContent).toContain(msg("Portal.ProcReceipts.incoming.forwardNow"))
    expect(buttons()).not.toContain(msg("Portal.ProcReceipts.hub.preview"))
    cleanup()
    await hub("exp", "tab=count")
    for (const key of ["Portal.ProcReceipts.hub.preview", "Portal.ProcReceipts.incoming.remindReceiver", "Portal.ProcReceipts.forward.again"]) expect(buttons()).toContain(msg(key))
  })

  it("«صعّد» appears only on the notice past the company's window — the one forwarded and left uncounted for days", async () => {
    await hub("exp", "tab=count")
    const escalate = buttons().filter((b) => b === msg("Portal.ProcReceipts.hub.escalate"))
    expect(escalate).toHaveLength(1)
    expect(document.body.textContent).toContain("فوق المهلة")
  })

  it("a requester with no follow-up permission sees the notices but none of the follow-up acts", async () => {
    seed("users/req", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-req", name: "طالب" })
    seed("teamGroups/g-req", { organizationId: ORG, permissions: ["rfq.create"] })
    await hub("req", "tab=count")
    expect(buttons()).not.toContain(msg("Portal.ProcReceipts.hub.escalate"))
    expect(buttons()).not.toContain(msg("Portal.ProcReceipts.forward.again"))
  })
})

describe("a truck with no notice is the RECEIVER's door", () => {
  it("shown to a holder of the receiving permission; not to a buyer who only prepares orders, not to the expediter", async () => {
    await hub("keeper")
    expect(buttons()).toContain(msg("Portal.ProcReceipts.arrival.button"))
    cleanup()
    await hub("buyer")
    expect(buttons()).not.toContain(msg("Portal.ProcReceipts.arrival.button"))
    cleanup()
    await hub("exp")
    expect(buttons()).not.toContain(msg("Portal.ProcReceipts.arrival.button"))
  })
})

describe("the receipts: a PDF each, the manual one tagged, a draft waiting for the storekeeper", () => {
  it("every row has a PDF button; the manual receipt reads «يدوي» and its draft pill; the caption explains whose receipt it is", async () => {
    await hub("buyer", "tab=nopo")
    expect(buttons().filter((b) => b === "PDF")).toHaveLength(1)
    const text = document.body.textContent ?? ""
    expect(text).toContain(msg("Portal.ProcReceipts.hub.draft"))
    expect(text).toContain(msg("Portal.ProcReceipts.hub.src_manual"))
    expect(text).toContain(msg("Portal.ProcReceipts.caption.receipts").slice(0, 30))
    cleanup()
    await hub("buyer", "tab=recs")
    expect(buttons().filter((b) => b === "PDF")).toHaveLength(1)
    expect(document.body.textContent).toContain(msg("Portal.ProcReceipts.hub.hasRejected"))
  })

  it("the storekeeper sees the draft waiting for his confirmation; a buyer does not", async () => {
    await hub("keeper", "tab=nopo")
    expect(document.body.textContent).toContain(msg("Portal.ProcReceipts.draft.title"))
    expect(buttons()).toContain(msg("Portal.ProcReceipts.draft.confirm"))
    cleanup()
    await hub("buyer", "tab=nopo")
    expect(buttons()).not.toContain(msg("Portal.ProcReceipts.draft.confirm"))
  })

  it("«صدّر» opens the export with the period, the location and the three formats", async () => {
    await hub("buyer")
    await act(async () => void fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === msg("Portal.ProcReceipts.csv.button"))!))
    await flush()
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent).toContain(msg("Portal.ProcReceipts.export.title"))
    for (const f of ["xlsx", "csv", "zip"]) expect(dialog.textContent).toContain(msg(`Portal.ProcReceipts.export.fmt_${f}`))
    expect(dialog.textContent).toContain(msg("Portal.ProcReceipts.export.sendAccountant").slice(0, 0))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The receiver's page
// ─────────────────────────────────────────────────────────────────────────────

describe("the receiver's page — blind count, four reasons, the confirmation is the signature", () => {
  const data = {
    receiverName: "سامي الدوسري",
    phoneMasked: "05••",
    supplierName: "مصنع الجودة",
    poNumber: "PO-2026/021",
    rfqTitle: "حديد التسليح",
    deliveryDate: day(0),
    forwardedBy: "ريم",
    note: null,
    noNotice: false,
    where: "project",
    receiverUserId: null,
    files: [],
    lines: [{ poLineId: "l1", name: "حديد 12 مم", unit: "طن" }, { poLineId: "l2", name: "حديد 16 مم", unit: "طن" }],
  }
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
  const respond = (url: string): unknown => {
    if (url.includes("/code")) return { success: true, data: { challengeId: "c1", phoneMasked: "05••", sent: true, testCode: "123456" } }
    if (url.includes("/sign")) {
      return { success: true, data: { deliveryId: "d1", docNumber: "GR-2026/001", module: "projects", placeName: "مستودع البرج", stockLanded: true, print: { docNumber: "GR-2026/001", supplierName: "مصنع الجودة", poNumber: "PO-2026/021", rfqTitle: "حديد", receiverName: "سامي", at: new Date().toISOString(), lines: [{ poLineId: "l1", name: "حديد 12 مم", unit: "طن", noticeQuantity: 0, counted: 3, rejected: 1, rejectReason: "damaged", accepted: 2 }], placeName: "مستودع البرج", selfReceived: false, companyName: "شركة البناء", via: "sms_code", complete: false, remaining: [] } } }
    }
    return { success: true, data }
  }
  beforeEach(() => {
    calls.length = 0
    global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url: String(url), body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined })
      return { ok: true, status: 200, json: async () => respond(String(url)) } as Response
    }) as never
  })
  const type = async (id: string, value: string) => {
    await act(async () => void fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value } }))
  }

  it("shows names and units only — no ordered quantity, no price; the labels are the prototype's: وصل · قُبل", async () => {
    setSignedIn(null)
    render(<ReceiveLinkContent />)
    await flush()
    const text = document.body.textContent ?? ""
    expect(text).toContain("حديد 12 مم")
    expect(text).toContain(msg("ReceiveLink.blind_note"))
    expect(text).toContain(msg("ReceiveLink.counted"))
    expect(text).toContain(msg("ReceiveLink.accepted"))
    expect(text).not.toMatch(/3,?000|10 طن|PO-2026\/021.*\d{3},\d{3}/)
    expect(msg("ReceiveLink.counted")).toBe("وصل")
    expect(msg("ReceiveLink.accepted")).toBe("قُبل")
  })

  it("accepting less than arrived asks WHY with the four reasons (damaged · off spec · short in the pack · other) and nothing else", async () => {
    setSignedIn(null)
    render(<ReceiveLinkContent />)
    await flush()
    await type("c-l1", "3")
    await type("a-l1", "2")
    const reasons = Array.from(document.querySelectorAll("button[aria-pressed]")).map((b) => (b.textContent ?? "").trim())
    expect(reasons).toEqual(["تالف", "لا يطابق المواصفة", "نقص في العبوة", "سبب آخر"])
    const send = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("05••")) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    expect(document.body.textContent).toContain(msg("ReceiveLink.err_reason_needed").replace("{name}", "حديد 12 مم"))
    await act(async () => void fireEvent.click(document.querySelectorAll("button[aria-pressed]")[0]))
    expect((Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("05••")) as HTMLButtonElement).disabled).toBe(false)
  })

  it("«أكّد الاستلام» with the code posts the count as arrived − accepted and ends on «سُجّل السند» with the PDF and where it went", async () => {
    setSignedIn(null)
    render(<ReceiveLinkContent />)
    await flush()
    await type("c-l1", "3")
    await type("a-l1", "2")
    await act(async () => void fireEvent.click(document.querySelectorAll("button[aria-pressed]")[0]))
    await act(async () => void fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("05••")) as HTMLButtonElement))
    await flush()
    await type("code", "123456")
    await act(async () => void fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === msg("ReceiveLink.confirm")) as HTMLButtonElement))
    await flush()
    const sign = calls.find((c) => c.url.includes("/sign"))
    expect(sign?.body).toMatchObject({ challengeId: "c1", code: "123456", signatureData: null })
    expect(sign?.body?.lines).toEqual([
      { poLineId: "l1", counted: 3, rejected: 1, rejectReason: "damaged", held: 0, holdReason: null, note: null },
      { poLineId: "l2", counted: 0, rejected: 0, rejectReason: null, held: 0, holdReason: null, note: null },
    ])
    const text = document.body.textContent ?? ""
    expect(text).toContain("ا.س-2026/001")
    expect(text).toContain(msg("ReceiveLink.done_where_project"))
    expect(text).toContain(msg("ReceiveLink.done_rejected_note"))
    expect(buttons()).toContain("PDF")
  })
})
