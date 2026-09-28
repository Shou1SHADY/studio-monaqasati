/**
 * The RFQ comparison (R-01, R-02, R-03) rendered for real: a cell click picks
 * that supplier for that line, «pick lowest» picks every line's lowest, the
 * award bar counts n of m, and a viewer without prices sees «—» and cannot pick.
 */

import { fireEvent, render, screen } from "@testing-library/react"

jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => {
    const t = (key: string, vars?: Record<string, unknown>) => `${namespace}.${key}${vars ? JSON.stringify(vars) : ""}`
    t.has = () => false
    t.rich = t
    return t
  },
}))

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})

import { RfqComparison } from "@/components/procurement/rfq/RfqComparison"
import type { RfqOfferView, RfqView } from "@/components/procurement/rfq/rfqOfferView"
import type { Picks } from "@/lib/procurement/rfq-award"

const rfq: RfqView = {
  id: "r1",
  status: "New",
  pricingMode: "line",
  products: [
    { name: "Rebar", quantity: 10, unitOfMeasure: "t" },
    { name: "Cement", quantity: 100, unitOfMeasure: "bag" },
  ],
}
const offers: RfqOfferView[] = [
  { id: "A", companyName: "Alpha", price: "30500", lines: [{ rfqProductIndex: 0, unitPrice: 3000 }, { rfqProductIndex: 1, unitPrice: 5 }], offerPdfUrl: "a.pdf" },
  { id: "B", companyName: "Beta", price: "28400", lines: [{ rfqProductIndex: 0, unitPrice: 2800 }, { rfqProductIndex: 1, unitPrice: 4 }], isGuestOffer: true, priceBasis: "exw" },
]

function renderIt(over: Partial<Parameters<typeof RfqComparison>[0]> = {}) {
  const onPicksChange = jest.fn<void, [Picks]>()
  const onAward = jest.fn()
  render(
    <RfqComparison
      rfq={rfq}
      offers={offers}
      picks={{}}
      onPicksChange={onPicksChange}
      canPick
      showPrices
      sealed={false}
      sealedUntil="Sep 30, 2026"
      notes={[]}
      onAward={onAward}
      canCloseEarly={false}
      onCloseEarly={() => {}}
      round="none"
      onAskRound={() => {}}
      {...over}
    />
  )
  return { onPicksChange, onAward }
}

describe("RfqComparison", () => {
  it("a cell click picks that supplier for that line", () => {
    const { onPicksChange } = renderIt()
    fireEvent.click(screen.getByLabelText(/cmp\.cell_pick_label.*"line":"Cement".*"supplier":"Alpha"/))
    expect(onPicksChange).toHaveBeenCalledWith({ 1: "A" })
  })

  it("«pick lowest» takes each line's lowest rate", () => {
    const { onPicksChange } = renderIt()
    fireEvent.click(screen.getByText("Portal.Procurement.rfqd.cmp.pick_lowest"))
    expect(onPicksChange).toHaveBeenCalledWith({ 0: "B", 1: "B" })
  })

  it("counts what is picked and opens the award", () => {
    const { onAward } = renderIt({ picks: { 0: "A" } })
    expect(screen.getByText(/cmp\.awarded_n_of_m\{"picked":1,"of":2\}/)).toBeTruthy()
    fireEvent.click(screen.getByText("Portal.Procurement.rfqd.cmp.award_btn"))
    expect(onAward).toHaveBeenCalled()
  })

  it("shows the column flags: guest, official quote, delivery basis", () => {
    renderIt()
    expect(screen.getByText("Portal.Procurement.rfqd.cmp.guest")).toBeTruthy()
    expect(screen.getByText("Portal.Procurement.rfqd.cmp.quote_attached")).toBeTruthy()
    expect(screen.getByText("Portal.Procurement.rfqd.cmp.no_quote")).toBeTruthy()
    expect(screen.getByText(/cmp\.basis_exw/)).toBeTruthy()
  })

  it("without prices: every figure is «—» and no cell can be picked", () => {
    const { onPicksChange } = renderIt({ showPrices: false })
    expect(document.body.textContent).not.toMatch(/2,800|3,000/)
    const cell = screen.getByLabelText(/cmp\.cell_pick_label.*"line":"Rebar".*"supplier":"Beta"/) as HTMLButtonElement
    expect(cell.disabled).toBe(true)
    fireEvent.click(cell)
    expect(onPicksChange).not.toHaveBeenCalled()
  })

  it("sealed: says when it opens and offers the manager an early close", () => {
    const onCloseEarly = jest.fn()
    renderIt({ sealed: true, canCloseEarly: true, onCloseEarly })
    expect(document.body.textContent).not.toMatch(/2,800/)
    fireEvent.click(screen.getByText("Portal.Procurement.rfqd.cmp.close_now"))
    expect(onCloseEarly).toHaveBeenCalled()
  })
})
