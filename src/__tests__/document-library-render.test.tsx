/**
 * The Documents page on screen: every file the company can see, searched and filtered,
 * with the document it belongs to one click away.
 */
import { fireEvent, render, screen, within } from "@testing-library/react"
import { filesOf, type LibraryFile } from "@/lib/document-library"
import type { ThreadEntry } from "@/lib/document-thread"

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})
jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}|${Object.values(params).join(",")}` : key),
}))
jest.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
jest.mock("firebase/storage", () => ({ getDownloadURL: jest.fn().mockResolvedValue("https://files.example/x"), ref: jest.fn() }))
jest.mock("@/firebase", () => ({ useStorage: () => ({}), useUser: () => ({ user: { uid: "u1" } }) }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))
jest.mock("@/hooks/useResolvedProfile", () => ({ useResolvedProfile: () => ({ profile: {}, organizationId: "buy" }) }))

let rows: LibraryFile[] = []
let loading = false
jest.mock("@/hooks/useDocumentLibrary", () => ({ useDocumentLibrary: () => ({ loading, files: rows }) }))

import { DocumentLibrary } from "@/components/documents/DocumentLibrary"

const entry = (over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id: "n1",
  targetKey: "po:p1",
  targetKind: "po",
  targetId: "p1",
  targetLabel: "PO-2026/012",
  targetHref: "/contractor/rfqs/orders?po=p1",
  targetSupplierHref: "/supplier/orders?po=p1",
  kind: "file",
  visibility: "shared",
  body: "",
  file: { name: "quote.pdf", size: 2048, contentType: "application/pdf", path: "p1" },
  authorId: "u1",
  authorName: "Mona",
  authorOrgId: "buy",
  buyerOrgId: "buy",
  supplierOrgId: "sup",
  at: "2026-10-05T10:00:00.000Z",
  ...over,
})

beforeEach(() => {
  rows = []
  loading = false
})

describe("the Documents page", () => {
  it("says what would be here when nothing is attached yet", () => {
    render(<DocumentLibrary portal="contractor" />)
    expect(screen.getByText("empty_title")).toBeInTheDocument()
    expect(screen.getByText("empty_desc")).toBeInTheDocument()
  })

  it("lists each file with the document it belongs to, linking to it on the viewer's own side", () => {
    rows = filesOf([entry()])
    const { unmount } = render(<DocumentLibrary portal="contractor" />)
    expect(screen.getByText("quote.pdf")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "PO-2026/012" })).toHaveAttribute("href", "/contractor/rfqs/orders?po=p1")
    unmount()
    render(<DocumentLibrary portal="supplier" />)
    expect(screen.getByRole("link", { name: "PO-2026/012" })).toHaveAttribute("href", "/supplier/orders?po=p1")
  })

  it("counts the files, the shared ones and the ones I added", () => {
    rows = filesOf([entry({ id: "a" }), entry({ id: "b", supplierOrgId: null, authorId: "u2" }), entry({ id: "c", authorId: "u2" })])
    render(<DocumentLibrary portal="contractor" />)
    const kpi = (label: string) => screen.getAllByText(label)[0].parentElement as HTMLElement
    expect(within(kpi("kpi_files")).getByText("3")).toBeInTheDocument()
    expect(within(kpi("kpi_shared")).getByText("2")).toBeInTheDocument()
    expect(within(kpi("kpi_mine")).getByText("1")).toBeInTheDocument()
  })

  it("searches across the file, the document and who added it, and says when nothing matches", () => {
    rows = filesOf([entry({ id: "a" }), entry({ id: "b", file: { name: "site photo.png", size: 1, contentType: "image/png", path: "p2" }, targetLabel: "Rebar RFQ", targetKind: "offer", targetId: "o1", authorName: "Omar" })])
    render(<DocumentLibrary portal="contractor" />)
    fireEvent.change(screen.getByLabelText("search_label"), { target: { value: "omar" } })
    expect(screen.queryByText("quote.pdf")).not.toBeInTheDocument()
    expect(screen.getByText("site photo.png")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("search_label"), { target: { value: "zzz" } })
    expect(screen.getByText("empty_filtered")).toBeInTheDocument()
  })

  it("filters by type and clears the filters again", () => {
    rows = filesOf([entry({ id: "a" }), entry({ id: "b", file: { name: "site photo.png", size: 1, contentType: "image/png", path: "p2" } })])
    render(<DocumentLibrary portal="contractor" />)
    fireEvent.click(screen.getByRole("button", { name: /type_image/ }))
    expect(screen.queryByText("quote.pdf")).not.toBeInTheDocument()
    expect(screen.getByText("site photo.png")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "clear_filters" }))
    expect(screen.getByText("quote.pdf")).toBeInTheDocument()
    expect(screen.getByText("site photo.png")).toBeInTheDocument()
  })

  it("only offers the types that exist", () => {
    rows = filesOf([entry()])
    render(<DocumentLibrary portal="contractor" />)
    expect(screen.getByRole("button", { name: /type_pdf/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /type_image/ })).not.toBeInTheDocument()
  })
})

describe("the Documents page laid out as Odoo's", () => {
  it("shows files as cards first, and as the sortable list when asked", () => {
    rows = filesOf([entry()])
    render(<DocumentLibrary portal="contractor" />)
    expect(screen.getByRole("button", { name: /view_kanban/ })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /view_list/ }))
    expect(screen.getByRole("table")).toBeInTheDocument()
    expect(screen.getByText("quote.pdf")).toBeInTheDocument()
  })

  it("carries an active filter as a facet in the search bar, removable on its own", () => {
    rows = filesOf([entry({ id: "a" }), entry({ id: "b", file: { name: "site photo.png", size: 1, contentType: "image/png", path: "p2" } })])
    render(<DocumentLibrary portal="contractor" />)
    fireEvent.click(screen.getByRole("button", { name: /type_image/ }))
    expect(screen.queryByText("quote.pdf")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "remove_filter_named|type_image" }))
    expect(screen.getByText("quote.pdf")).toBeInTheDocument()
  })

  it("opens a file's details with its record, who added it, and the way to the record", () => {
    rows = filesOf([entry()])
    render(<DocumentLibrary portal="supplier" />)
    fireEvent.click(screen.getByRole("button", { name: "details_of|quote.pdf" }))
    const panel = screen.getByRole("dialog")
    expect(within(panel).getByText("details_title")).toBeInTheDocument()
    expect(within(panel).getByText("Mona")).toBeInTheDocument()
    expect(within(panel).getByRole("link", { name: /go_to_record/ })).toHaveAttribute("href", "/supplier/orders?po=p1")
    expect(within(panel).getByRole("button", { name: /open_file/ })).toBeInTheDocument()
  })
})
