/**
 * Procurement 2.0 — the comparison tab rendered for real (WP-S3-06): the worked example RFQ-2026/011 (CMP-01/02, G-02, R-20, R-31),
 * suppliers as columns up to five offers and as rows beyond with a sticky supplier column and a manual toggle (CMP-03), ★ with the 0.5 %
 * tie band, the fact rows (CMP-04), «آخر شراء» by specification (CMP-05), the strip and the sort by a material (CMP-14/15), a cell locked
 * by an excluded / expired offer or a live order (CMP-18), the pick pinned to the offer version and dropped with its banner (G-14, R-14),
 * a lump sum (CMP-12), and a viewer who sees no prices. Ports the old comparison render test; the seal tests go with the seal.
 */

import { fireEvent, render, screen, within } from "@testing-library/react"

jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => {
    const t = (key: string, vars?: Record<string, unknown>) => `${namespace.split(".").pop()}.${key}${vars ? JSON.stringify(vars) : ""}`
    t.has = () => false
    t.rich = t
    return t
  },
}))
jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})

import { RfqCompareGrid, type RfqCompareGridProps } from "@/components/procurement/rfq/RfqCompareGrid"
import type { AwardPicks, PlanOffer, PlanRfq } from "@/lib/procurement/award-plan"
import { specKeyOf } from "@/lib/procurement/prices"
import { resolvePolicies } from "@/lib/procurement/policies"
import type { PurchaseOrder } from "@/lib/procurement/types"

const today = "2026-10-22"
const policies = resolvePolicies(null)
const angle = { nodeId: "n-angle", specs: [{ name: { ar: "المقاس" }, value: { ar: "50×50×5" } }] }
const prod = (name: string, quantity: number, over: Record<string, unknown> = {}) => ({ name, quantity, unitOfMeasure: "م", deliverySiteId: "s1", ...over })
const rfq = { id: "r1", status: "New", deadline: "2026-10-30", pricingMode: "line", products: [prod("Angles 50x50x5", 175, { material: angle }), prod("Timber planks", 320)] } as unknown as PlanRfq
const offer = (id: string, name: string, lines: Array<Record<string, unknown>>, over: Record<string, unknown> = {}): PlanOffer =>
  ({ id, companyName: name, organizationId: `org_${id}`, supplierId: `u_${id}`, status: "قيد المراجعة", lines, vatRegistered: true, vatRate: 0.15, leadDays: 5, validUntil: "2026-11-30", offerPdfUrl: `${id}.pdf`, versions: [{ n: 1 }], price: "0", ...over }) as unknown as PlanOffer
const A = offer("A", "Quality", [{ rfqProductIndex: 0, unitPrice: 12.5 }, { rfqProductIndex: 1, unitPrice: 3.6 }])
const S = offer("S", "Sharq", [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12, packKey: "12 m piece" }, { rfqProductIndex: 1, unitPrice: 3.7 }])
const M = offer("M", "Wusta", [{ rfqProductIndex: 0, unitPrice: 74, packLen: 6, packKey: "6 m piece" }, { rfqProductIndex: 1, unitPrice: 3.7 }])
const H = offer("H", "Ufuq", [{ rfqProductIndex: 0, unitPrice: 12.9 }, { rfqProductIndex: 1, unitPrice: 3.7 }])
const AM = offer("AM", "Amal", [{ rfqProductIndex: 0, unitPrice: 80, packLen: 6, packKey: "6 m piece" }, { rfqProductIndex: 1, unitPrice: 13.5, packLen: 4, packKey: "4 m board" }], { vatRegistered: false, vatRate: 0, validUntil: "2026-10-24", offerPdfUrl: null })

function renderIt(over: Partial<RfqCompareGridProps> = {}) {
  const onPicksChange = jest.fn<void, [AwardPicks]>()
  const onReview = jest.fn()
  const utils = render(
    <RfqCompareGrid
      rfq={rfq}
      offers={[A, S, M, H, AM]}
      decisions={{}}
      orders={[]}
      receipts={[]}
      history={[]}
      policies={policies}
      verifiedOf={() => true}
      picks={{}}
      onPicksChange={onPicksChange}
      canPick
      showPrices
      today={today}
      actor={{ uid: "u", isOwner: false, canPrepare: true, canApprove: false }}
      onReview={onReview}
      {...over}
    />
  )
  return { onPicksChange, onReview, ...utils }
}
const cell = (line: string, supplier: string) => screen.getByLabelText(new RegExp(`pick_label.*"line":"${line}.*"supplier":"${supplier}"`)) as HTMLButtonElement

describe("the worked example RFQ-2026/011 — one effective price per request unit (CMP-01, G-02, R-20)", () => {
  it("shows the effective price big, the piece line in the buyer's words and the price per metre received", () => {
    renderIt()
    expect(cell("Angles", "Quality").textContent).toContain("12.50")
    expect(cell("Angles", "Sharq").textContent).toContain("12.51")
    expect(cell("Angles", "Wusta").textContent).toContain("12.69")
    expect(cell("Angles", "Amal").textContent).toContain("13.71")
    const sharq = cell("Angles", "Sharq").textContent as string
    expect(sharq).toContain("15 12 m piece")
    expect(sharq).toContain('"received":180')
    expect(sharq).toContain('"extra":5')
    expect(sharq).toContain("per_received")
    expect(sharq).toContain("12.17")
    expect(cell("Angles", "Amal").textContent).toContain("13.33")
  })
  it("marks ★ on the lowest AND on every tie within 0.5 % (12.50 and 12.51), not on 12.69 (R-31)", () => {
    renderIt()
    expect(within(cell("Angles", "Quality")).getByText("cmp2.lowest")).toBeTruthy()
    expect(within(cell("Angles", "Sharq")).getByText("cmp2.lowest")).toBeTruthy()
    expect(within(cell("Angles", "Wusta")).queryByText("cmp2.lowest")).toBeNull()
    expect(within(cell("Timber", "Amal")).getByText("cmp2.lowest")).toBeTruthy()
  })
  it("the fact rows: total incl. VAT, the lowest complete, validity ending soon, a missing official quote, and who is new to us", () => {
    renderIt()
    const text = document.body.textContent || ""
    expect(text).toContain("3,840.43")
    expect(text).toContain("cmp2.lowest_complete")
    expect(text).toContain("cmp2.validity_soon")
    expect(text).toContain("cmp2.quote_missing")
    expect(text).toContain("cmp2.new_to_us")
    expect(text).toContain("cmp2.no_vat")
  })
  it("«آخر شراء» appears under a material by its specification, with the order number — or nothing", () => {
    const { specKey } = specKeyOf({ name: "Angles", unitOfMeasure: "م", material: angle })
    const hit = { id: "h1", organizationId: "o", materialKey: "x", specKey, name: "Angles", unit: "م", supplierOrgId: "s", supplierName: "s", price: 4.35, day: "2026-09-01", kind: "po" as const, poId: "p", poNumber: "PO-2026/008" }
    renderIt({ history: [hit] })
    expect(document.body.textContent).toContain("last_buy")
    expect(document.body.textContent).toContain("2026/008")
  })
  it("a price paid for ANOTHER specification of the same name is not shown", () => {
    const other = specKeyOf({ name: "Angles", unitOfMeasure: "م", material: { nodeId: "n-angle", specs: [{ name: { ar: "المقاس" }, value: { ar: "40×40×4" } }] } }).specKey
    const hit = { id: "h2", organizationId: "o", materialKey: "x", specKey: other, name: "Angles", unit: "م", supplierOrgId: "s", supplierName: "s", price: 3, day: "2026-09-01", kind: "po" as const, poId: "p", poNumber: "PO-2026/007" }
    renderIt({ history: [hit] })
    expect(document.body.textContent).not.toContain("last_buy")
  })
})

describe("columns up to five offers, rows beyond, and a manual toggle (CMP-03)", () => {
  it("five offers: suppliers are columns and the material column is sticky", () => {
    renderIt()
    const head = screen.getAllByRole("columnheader")
    expect(head.map((h) => h.textContent).join(" ")).toContain("Quality")
    expect(head[0].className).toContain("sticky")
  })
  it("six offers switch to rows (a sticky supplier column), and the toggle turns it back", () => {
    const six = offer("X", "Extra", [{ rfqProductIndex: 0, unitPrice: 14 }, { rfqProductIndex: 1, unitPrice: 4 }])
    renderIt({ offers: [A, S, M, H, AM, six] })
    const rowHead = screen.getAllByRole("rowheader")
    expect(rowHead.map((h) => h.textContent).join(" ")).toContain("Extra")
    expect(rowHead[0].className).toContain("sticky")
    fireEvent.click(screen.getByText("cmp2.suppliers_columns"))
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent).join(" ")).toContain("Extra")
  })
})

describe("picking (CMP-06) and the pick pinned to the version (G-14)", () => {
  it("a click picks that supplier's VERSION for that line", () => {
    const { onPicksChange } = renderIt()
    fireEvent.click(cell("Timber", "Amal"))
    expect(onPicksChange).toHaveBeenCalledWith({ 1: { offerId: "AM", rev: 1 } })
  })
  it("«اختر الأقل لكل بند» picks each line's lowest total; «الأقل من الموثّقين» only suppliers with an official quote", () => {
    const { onPicksChange } = renderIt()
    fireEvent.click(screen.getByText("cmp2.pick_lowest"))
    expect(onPicksChange).toHaveBeenLastCalledWith({ 0: { offerId: "A", rev: 1 }, 1: { offerId: "AM", rev: 1 } })
    fireEvent.click(screen.getByText("cmp2.pick_lowest_safe"))
    expect(onPicksChange).toHaveBeenLastCalledWith({ 0: { offerId: "A", rev: 1 }, 1: { offerId: "A", rev: 1 } })
  })
  it("«رسِّ كل ما سعّره عليه» picks every line the supplier priced", () => {
    const { onPicksChange } = renderIt()
    fireEvent.click(screen.getAllByText(/award_all_of.*Quality/)[0])
    expect(onPicksChange).toHaveBeenCalledWith({ 0: { offerId: "A", rev: 1 }, 1: { offerId: "A", rev: 1 } })
  })
  it("the bar: «اختير N من M», the suppliers, the total incl. VAT, «امسح» and «راجع الترسية»", () => {
    const { onPicksChange, onReview } = renderIt({ picks: { 0: { offerId: "A", rev: 1 } } })
    expect(document.body.textContent).toContain('chosen_n_of_m{"n":1,"m":2}')
    expect(document.body.textContent).toContain("2,515.63")
    fireEvent.click(screen.getByText("cmp2.review"))
    expect(onReview).toHaveBeenCalled()
    fireEvent.click(screen.getByText("cmp2.clear"))
    expect(onPicksChange).toHaveBeenCalledWith({})
  })
  it("an offer edited after the pick (rev 2) drops out with «عُدّل بعد اختيارك» and the render still works (R-14)", () => {
    const edited = { ...A, versions: [{ n: 1 }, { n: 2 }] } as PlanOffer
    const { onPicksChange } = renderIt({ offers: [edited, S, M, H, AM], picks: { 0: { offerId: "A", rev: 1 } } })
    expect(onPicksChange).toHaveBeenCalledWith({})
    expect(document.body.textContent).toContain("cmp2.dropped")
    expect(document.body.textContent).toContain("Quality")
  })
})

describe("cells that cannot be awarded (CMP-18)", () => {
  it("an expired offer is locked and offers «اطلب تأكيد السعر»", () => {
    const onAskReval = jest.fn()
    const old = { ...AM, validUntil: "2026-10-21" } as PlanOffer
    renderIt({ offers: [A, S, M, H, old], onAskReval })
    expect(cell("Angles", "Amal").disabled).toBe(true)
    fireEvent.click(screen.getAllByText("cmp2.ask_reval")[0])
    expect(onAskReval).toHaveBeenCalled()
  })
  it("the last valid day is not expired", () => {
    renderIt({ offers: [A, S, M, H, { ...AM, validUntil: today } as PlanOffer] })
    expect(cell("Angles", "Amal").disabled).toBe(false)
  })
  it("an excluded offer is shown and locked, and can be hidden", () => {
    renderIt({ decisions: { H: { shortlist: null, exclusion: { code: "spec", text: null, at: "x", byId: "u", byName: "u" } } } })
    expect(cell("Angles", "Ufuq").disabled).toBe(true)
    fireEvent.click(screen.getByText(/hide_excluded/))
    expect(screen.queryAllByLabelText(/"supplier":"Ufuq"/)).toHaveLength(0)
  })
  it("a line a live order already carries shows its order and cannot be picked", () => {
    const live = { id: "po9", docNumber: "PO-2026/009", rfqId: "r1", status: "approved", offerId: "S", lines: [{ id: "l1", rfqProductIndex: 0 }], supplierOrgId: "org_S", supplierName: "Sharq", isGuestSupplier: false } as unknown as PurchaseOrder
    renderIt({ orders: [live] })
    expect(cell("Angles", "Quality").disabled).toBe(true)
    expect(cell("Angles", "Quality").textContent).toContain("locked_order")
    expect(cell("Timber", "Quality").disabled).toBe(false)
  })
})

describe("CMP-14 / CMP-15 — the strip and the sort by a material", () => {
  it("names the lowest per material and sorts the suppliers by its effective price", () => {
    renderIt()
    expect(document.body.textContent).toContain("cmp2.strip_title")
    const before = screen.getAllByRole("columnheader").slice(1).map((h) => h.textContent?.slice(0, 6))
    fireEvent.click(screen.getAllByText("cmp2.sort_by")[1])
    const after = screen.getAllByRole("columnheader").slice(1).map((h) => h.textContent?.slice(0, 6))
    expect(after[0]).toContain("Amal")
    expect(after).not.toEqual(before)
  })
})

describe("a lump sum and a viewer without prices", () => {
  it("lump-sum offers: cells say «ضمن المبلغ الإجمالي» and the lowest total is the lowest complete", () => {
    const l1 = offer("L1", "Lump1", [], { lump: 5000, price: "5000" })
    const l2 = offer("L2", "Lump2", [], { lump: 5200, price: "5200" })
    renderIt({ offers: [l1, l2], rfq: { ...rfq, pricingMode: "total" } as PlanRfq })
    expect(screen.getAllByText("cmp2.in_lump").length).toBeGreaterThan(0)
    expect(document.body.textContent).toContain("cmp2.lowest_complete")
  })
  it("without prices every figure is «—» and no cell can be picked", () => {
    const { onPicksChange } = renderIt({ showPrices: false })
    expect(document.body.textContent).not.toMatch(/12\.5|2,187|3,840/)
    const c = cell("Angles", "Quality")
    expect(c.disabled).toBe(true)
    fireEvent.click(c)
    expect(onPicksChange).not.toHaveBeenCalled()
  })
})
