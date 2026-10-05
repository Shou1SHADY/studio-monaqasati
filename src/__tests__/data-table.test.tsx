/**
 * The shared DataTable: sorting in the reader's language, figures that line up
 * under their heading in Arabic, totals, tones, "show more", the empty state,
 * and a card per row on a phone.
 */

import { fireEvent, render, screen, within } from "@testing-library/react"

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})

let locale = "ar"
jest.mock("next-intl", () => ({ useLocale: () => locale }))
let mobile = false
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile }))

import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"

type Row = { id: string; name: string; net: number | null; held?: boolean }
const rows: Row[] = [
  { id: "1", name: "يوسف", net: 4200 },
  { id: "2", name: "أحمد", net: 15000, held: true },
  { id: "3", name: "إبراهيم", net: null },
]
const columns: DataColumn<Row>[] = [
  { key: "name", header: "الاسم", cell: (r) => r.name, sortValue: (r) => r.name },
  { key: "net", header: "الصافي", numeric: true, cell: (r) => (r.net == null ? "—" : r.net.toLocaleString("en-US")), sortValue: (r) => r.net, footer: "19,200" },
]
const labels = { sortBy: (c: string) => `رتّب حسب ${c}`, showMore: (n: number) => `اعرض ${n} أخرى` }
const names = () => screen.getAllByRole("row").slice(1, -1).map((tr) => within(tr).getAllByRole("cell")[0].textContent)

beforeEach(() => {
  locale = "ar"
  mobile = false
})

describe("DataTable", () => {
  it("sorts by a column in the reader's language, toggling the direction and saying so (aria-sort)", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="المسير" labels={labels} empty="—" />)
    const byName = screen.getByRole("button", { name: "رتّب حسب الاسم" })
    fireEvent.click(byName)
    // أ and إ are one letter to the reader: إبراهيم (ب) comes before أحمد (ح).
    expect(names()).toEqual(["إبراهيم", "أحمد", "يوسف"])
    expect(screen.getByRole("columnheader", { name: /الاسم/ })).toHaveAttribute("aria-sort", "ascending")
    fireEvent.click(byName)
    expect(names()).toEqual(["يوسف", "أحمد", "إبراهيم"])
    expect(screen.getByRole("columnheader", { name: /الاسم/ })).toHaveAttribute("aria-sort", "descending")
  })

  it("an empty figure sorts last either way", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="المسير" labels={labels} empty="—" />)
    fireEvent.click(screen.getByRole("button", { name: "رتّب حسب الصافي" }))
    expect(names()).toEqual(["يوسف", "أحمد", "إبراهيم"])
    fireEvent.click(screen.getByRole("button", { name: "رتّب حسب الصافي" }))
    expect(names()).toEqual(["أحمد", "يوسف", "إبراهيم"])
  })

  it("figures keep the table's direction (so they sit under their heading) and isolate their digits", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="المسير" labels={labels} empty="—" />)
    const cell = screen.getByText("15,000").closest("td") as HTMLElement
    expect(cell).not.toHaveAttribute("dir")
    expect(cell.className).toContain("text-end")
    expect(screen.getByText("15,000").tagName).toBe("BDI")
    expect(screen.getByText("15,000")).toHaveAttribute("dir", "ltr")
    expect(screen.getByRole("columnheader", { name: /الصافي/ }).className).toContain("text-end")
  })

  it("the totals row, the row's tone on its first cell, the caption", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="المسير" labels={labels} empty="—" rowTone={(r) => (r.held ? "warn" : undefined)} />)
    expect(screen.getByText("19,200").closest("tfoot")).not.toBeNull()
    expect((screen.getByText("أحمد").closest("td") as HTMLElement).className).toContain("border-s-warning")
    expect((screen.getByText("يوسف").closest("td") as HTMLElement).className).not.toContain("border-s-")
    expect(screen.getByText("المسير", { selector: "caption" })).toBeInTheDocument()
  })

  it("shows a page, then the rest on request", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="المسير" labels={labels} empty="—" pageSize={2} />)
    expect(names()).toHaveLength(2)
    fireEvent.click(screen.getByRole("button", { name: "اعرض 1 أخرى" }))
    expect(names()).toHaveLength(3)
    expect(screen.queryByRole("button", { name: /اعرض/ })).toBeNull()
  })

  it("no rows: the empty state instead of a table", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} caption="المسير" labels={labels} empty={<p>لا أحد</p>} />)
    expect(screen.getByText("لا أحد")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("on a phone: a card per row with each column's label, no sideways table", () => {
    mobile = true
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="المسير" labels={labels} empty="—" />)
    expect(screen.queryByRole("table")).toBeNull()
    const list = screen.getByRole("list", { name: "المسير" })
    expect(within(list).getAllByRole("listitem")).toHaveLength(3)
    expect(within(list).getAllByText("الصافي")).toHaveLength(3)
    expect(screen.getByText("19,200")).toBeInTheDocument()
  })
})
