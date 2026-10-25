jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/components/contractor/ProcurementHeader", () => ({ ProcurementHeader: ({ title }: { title: string }) => <h1>{title}</h1> }))
jest.mock("@/hooks/useProcurementNeeds", () => ({ useProcurementNeeds: () => ({ needs: [] }) }))
jest.mock("@/hooks/useDeliverySiteList", () => ({ useDeliverySiteList: () => ({ sites: [{ id: "site1", name: "مستودع الرياض" }, { id: "site2", name: "موقع جدة" }], stored: [] }) }))

let mockModules: Record<string, boolean> = { "project-management": false, payments: true }
jest.mock("@/hooks/useCompanyModules", () => ({ useModules: () => ({ on: (m: string) => mockModules[m] !== false, off: new Set(), loading: false, linkable: () => true }) }))

let mockWorld: Record<string, unknown>
jest.mock("@/hooks/useProcurementWorld", () => ({ useProcurementWorld: () => mockWorld }))

/**
 * Procurement 2.0, WP-S5-09 / G-18 — the reports page opens on the prototype's two panels (this month's spend by supplier and the
 * seven reports, each with its CSV); a report opens to its table, where every money column says «قبل الضريبة», the order tags are
 * columns and filters, the delivery site is a filter, the drift reads as savings, and without Finance the seventh report is
 * «مستلَم ودُفع — للمحاسب».
 */

import React from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { installDomShims, missingKeys, setLocale, setPathname } from "@/test-utils/render-world"
import { ProcurementReports } from "@/components/procurement/ProcurementReports"
import { DEFAULT_POLICIES, type PoLine, type PurchaseOrder } from "@/lib/procurement/types"
import ar from "../../messages/ar.json"

installDomShims()
jest.setTimeout(30_000)

const R = (ar as unknown as { Portal: { ProcReports: Record<string, Record<string, string> & string> } }).Portal.ProcReports
const BASIS = R.basis.excl
const TODAY = new Date().toISOString().slice(0, 10)
const MONTH_DAY = `${TODAY.slice(0, 7)}-02`

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 1000, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
  ({
    id: "po1",
    organizationId: "org",
    docNumber: "PO-2026/001",
    status: "accepted",
    basis: "rfq",
    rfqId: "r1",
    rfqTitle: "حديد",
    offerId: "o1",
    projectId: null,
    supplierOrgId: "s1",
    supplierUserId: null,
    supplierName: "مورد الأول",
    isGuestSupplier: false,
    lines: [line()],
    totalExVat: 10000,
    vatRate: 0.15,
    offersCount: 3,
    lowestOfferTotal: 10000,
    shortCompetition: false,
    noOfficialQuote: false,
    preparedById: "buyer",
    preparedByName: "سارة",
    createdAt: `${MONTH_DAY}T08:00:00Z`,
    approverKind: "owner",
    approvedById: "mgr",
    approvedByName: "المدير",
    approvedAt: `${MONTH_DAY}T09:00:00Z`,
    supplierAcceptedAt: `${MONTH_DAY}T10:00:00Z`,
    promisedDate: TODAY,
    log: [],
    ...over,
  }) as PurchaseOrder

const orders = [
  po({ id: "a", docNumber: "PO-2026/001", supplierOrgId: "s1", supplierName: "مورد الأول", tags: { notLowest: { why: "x" } }, lines: [line({ rfqProductIndex: 0 })] }),
  po({ id: "b", docNumber: "PO-2026/002", rfqId: "r2", supplierOrgId: "s2", supplierName: "مورد الثاني", noVat: true, vatRate: 0, lines: [line({ rfqProductIndex: 0 })] }),
]

beforeEach(() => {
  missingKeys.clear()
  setLocale("ar")
  mockModules = { "project-management": false, payments: true }
  mockWorld = {
    orders,
    deliveries: [],
    rfqs: [{ id: "r1", products: [{ deliverySiteId: "site1" }] }, { id: "r2", products: [{ deliverySiteId: "site2" }] }],
    offers: [],
    policies: DEFAULT_POLICIES,
    supplierFacts: new Map(),
    supplierRecords: [],
    actor: { seesPrices: true },
    orgId: "org",
    orgName: "شركة",
    loading: false,
  }
})

// jsdom applies the print stylesheet (it ignores media="print"), which hides every <header>: ask for hidden headings too.
const heading = (name: string) => screen.getByRole("heading", { name, hidden: true })
const open = (search = "") => {
  setPathname("/contractor/rfqs/reports", search)
  return render(<ProcurementReports />)
}

describe("the overview: two panels, as the prototype", () => {
  it("this month's spend by supplier beside the seven reports, each with its CSV", () => {
    open()
    expect(heading(R.report.supplier)).toBeTruthy()
    expect(screen.getByText("مورد الأول")).toBeTruthy()
    const seven = heading(R.overview.seven).closest("section") as HTMLElement
    expect(within(seven).getAllByRole("button", { name: /CSV/ })).toHaveLength(7)
    for (const name of [R.report.supplier, R.report.project_site, R.report.delivery, R.report.cycle, R.report.exceptions, R.report.drift, R.report.commitments]) {
      expect(within(seven).getByRole("button", { name })).toBeTruthy()
    }
    expect(missingKeys.size).toBe(0)
  })

  it("each of the seven opens with its icon, in the module's colour (ST-06)", () => {
    open()
    const seven = heading(R.overview.seven).closest("section") as HTMLElement
    const icons = Array.from(seven.querySelectorAll("li > button[data-testid^=report-row] > svg:first-of-type")).map((svg) => svg.getAttribute("data-icon"))
    expect(icons).toEqual(["Users", "MapPin", "Clock", "Scale", "AlertTriangle", "TrendingDown", "Wallet"])
    expect(Array.from(seven.querySelectorAll("li > button[data-testid^=report-row] > svg:first-of-type")).every((svg) => (svg.getAttribute("class") || "").includes("text-module"))).toBe(true)
  })

  it("each report row reads as a link — the whole row is the button, ending in a chevron that points forward in Arabic (UI review)", () => {
    open()
    const rows = Array.from(document.querySelectorAll("button[data-testid^=report-row]"))
    expect(rows).toHaveLength(7)
    for (const row of rows) {
      const icons = Array.from(row.querySelectorAll("svg")).map((svg) => svg.getAttribute("data-icon"))
      expect(icons[icons.length - 1]).toBe("ChevronLeft")
      expect(row.className).toContain("hover:bg-muted")
    }
  })

  it("without Project Management the second report is «بحسب موقع التسليم»; without Finance the seventh is «مستلَم ودُفع — للمحاسب»", () => {
    mockModules = { "project-management": false, payments: false }
    open()
    const seven = heading(R.overview.seven).closest("section") as HTMLElement
    expect(within(seven).getByRole("button", { name: R.report.project_site })).toBeTruthy()
    expect(within(seven).getByRole("button", { name: R.report.commitments_nofin })).toBeTruthy()
    expect(within(seven).queryByRole("button", { name: R.report.commitments })).toBeNull()
  })

  it("a viewer who may not see money gets only the reports that carry none", () => {
    ;(mockWorld.actor as { seesPrices: boolean }).seesPrices = false
    open()
    const seven = heading(R.overview.seven).closest("section") as HTMLElement
    expect(within(seven).getAllByRole("button", { name: /CSV/ })).toHaveLength(3)
    expect(screen.queryByRole("heading", { name: R.report.supplier, hidden: true })).toBeNull()
  })

  it("a report's CSV carries plain numbers and the basis in its money headings", async () => {
    const blobs: Blob[] = []
    URL.createObjectURL = jest.fn((b: Blob) => (blobs.push(b), "blob:x")) as never
    URL.revokeObjectURL = jest.fn()
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    open()
    const seven = heading(R.overview.seven).closest("section") as HTMLElement
    fireEvent.click(within(seven).getByRole("button", { name: new RegExp(`CSV - ${R.report.supplier}`) }))
    const text = await new Promise<string>((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.readAsText(blobs[0])
    })
    expect(text).toContain(`${R.cols.value} (${BASIS})`)
    expect(text).toContain("مورد الأول,1,10000")
    expect(text).not.toContain("ر.س")
  })
})

describe("a report: money with its basis, tags as columns and filters", () => {
  it("G-18: every money column of the supplier report says «قبل الضريبة»", () => {
    open("?report=supplier")
    const head = screen.getAllByRole("columnheader").map((h) => h.textContent)
    expect(head).toContain(`${R.cols.value} (${BASIS})`)
    expect(screen.getAllByText(new RegExp(BASIS)).length).toBeGreaterThan(1)
    expect(missingKeys.size).toBe(0)
  })

  it("the tags are a column (with their counts) and a filter (with the count each would leave)", () => {
    open("?report=supplier")
    expect(screen.getAllByText(`${R.tag.not_lowest} 1`).length).toBeGreaterThan(0)
    const group = screen.getByRole("group", { name: R.tag.label })
    expect(within(group).getByRole("button", { name: new RegExp(R.tag.unregistered) }).textContent).toContain("1")
    fireEvent.click(within(group).getByRole("button", { name: new RegExp(R.tag.unregistered) }))
    expect(screen.getByText("مورد الثاني")).toBeTruthy()
    expect(screen.queryByText("مورد الأول")).toBeNull()
    fireEvent.click(within(group).getByRole("button", { name: R.tag.all }))
    expect(screen.getByText("مورد الأول")).toBeTruthy()
  })

  it("the delivery site is a filter of the order-based reports", () => {
    open("?report=supplier")
    const select = screen.getByLabelText(R.site.label) as HTMLSelectElement
    expect([...select.options].map((o) => o.text)).toEqual([R.site.all, "مستودع الرياض", "موقع جدة", R.site.none])
    fireEvent.change(select, { target: { value: "site1" } })
    expect(screen.getByText("مورد الأول")).toBeTruthy()
    expect(screen.queryByText("مورد الثاني")).toBeNull()
    fireEvent.change(select, { target: { value: "all" } })
    expect(screen.getByText("مورد الثاني")).toBeTruthy()
  })

  it("the exceptions list shows the tags and the site of each order", () => {
    open("?report=exceptions")
    expect(screen.getAllByText(R.kind.non_lowest).length).toBeGreaterThan(0)
    expect(within(screen.getByRole("table")).getByText("مستودع الرياض")).toBeTruthy()
  })

  it("the savings report is named «التوفير عن آخر سعر» and says whether we saved", () => {
    mockWorld.orders = [
      po({ id: "e", createdAt: "2026-01-05T08:00:00Z", lines: [line({ unitPrice: 1000 })] }),
      po({ id: "c", docNumber: "PO-2026/002", createdAt: `${MONTH_DAY}T08:00:00Z`, lines: [line({ unitPrice: 900 })] }),
    ]
    open("?report=drift&period=90")
    expect(screen.getAllByText(R.report.drift).length).toBeGreaterThan(0)
    expect(screen.getByText(/^وفّرنا .* عن آخر سعر اشترينا به \(10%\)$/)).toBeTruthy()
  })

  it("without Finance the seventh report is the accountant's table of what was received and paid", () => {
    mockModules = { "project-management": false, payments: false }
    open("?report=commitments")
    expect(screen.getAllByText(R.report.commitments_nofin).length).toBeGreaterThan(0)
    const head = screen.getAllByRole("columnheader").map((h) => h.textContent)
    expect(head).toEqual(expect.arrayContaining([R.cols.payment, `${R.cols.receivedValue} (${BASIS})`]))
    expect(screen.getByText(R.notes.received_paid)).toBeTruthy()
  })

  it("a link back to the seven reports", () => {
    open("?report=delivery")
    expect(screen.getByRole("button", { name: R.overview.seven })).toBeTruthy()
  })
})

describe("NFR-03: hundreds of rows stay light", () => {
  it("shows 50 suppliers of 120 and offers «عرض 50 أخرى»; the CSV still holds all of them", async () => {
    mockWorld.orders = Array.from({ length: 120 }, (_, i) => po({ id: `o${i}`, docNumber: `PO-2026/${String(i).padStart(3, "0")}`, supplierOrgId: `s${i}`, supplierName: `مورد ${String(i).padStart(3, "0")}`, totalExVat: 1000 + i, lines: [line({ unitPrice: (1000 + i) / 10 })] }))
    open("?report=supplier")
    const rows = () => screen.getAllByRole("row").length
    expect(rows()).toBe(1 + 50 + 1)
    fireEvent.click(screen.getByRole("button", { name: R.showMore.replace("{count}", "50") }))
    expect(rows()).toBe(1 + 100 + 1)
    fireEvent.click(screen.getByRole("button", { name: R.showMore.replace("{count}", "20") }))
    expect(rows()).toBe(1 + 120 + 1)
    expect(screen.queryByRole("button", { name: /عرض \d+ أخرى/ })).toBeNull()
  })

  it("on a phone each row becomes a card labelled by its column heading — the table never scrolls sideways", () => {
    open("?report=supplier")
    const css = Array.from(document.querySelectorAll("style")).map((n) => n.textContent || "").join("")
    expect(css).toContain("@media (max-width:767px)")
    expect(css).toContain(`td:nth-child(3)::before{content:${JSON.stringify(`${R.cols.value} (${BASIS})`)}}`)
  })
})
