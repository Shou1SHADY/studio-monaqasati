/**
 * The Documents page shows a file added on the document thread next to a file that was attached
 * on a record long before it: both with their record, who and when, both openable, both found by
 * the same search and filters.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { filesOf, mergeLibrary, type LibraryItem } from "@/lib/document-library"
import { crmRecordFiles, projectRecordFiles, receiptRecordFiles, rfqRecordFiles } from "@/lib/document-records"
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
const getDownloadURL = jest.fn().mockResolvedValue("https://files.example/fresh")
jest.mock("firebase/storage", () => ({ getDownloadURL: (...args: unknown[]) => getDownloadURL(...args), ref: (_s: unknown, path: string) => ({ path }) }))
jest.mock("@/firebase", () => ({ useStorage: () => ({}), useUser: () => ({ user: { uid: "u1" } }) }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))
jest.mock("@/hooks/useResolvedProfile", () => ({ useResolvedProfile: () => ({ profile: {}, organizationId: "buy" }) }))

let rows: LibraryItem[] = []
jest.mock("@/hooks/useDocumentLibrary", () => ({ useDocumentLibrary: () => ({ loading: false, files: rows }) }))

import { DocumentLibrary } from "@/components/documents/DocumentLibrary"

const thread = (over: Partial<ThreadEntry> = {}): ThreadEntry => ({
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
  file: { name: "quote.pdf", size: 2048, contentType: "application/pdf", path: "documents/buy/po:p1/1-quote.pdf" },
  authorId: "u1",
  authorName: "Mona",
  authorOrgId: "buy",
  buyerOrgId: "buy",
  supplierOrgId: "sup",
  at: "2026-10-05T10:00:00.000Z",
  ...over,
})

const older = () => [
  ...rfqRecordFiles({ id: "r1", title: "Rebar supply", status: "New", createdAt: "2026-09-20T08:00:00.000Z", createdByUserName: "Omar", attachments: [{ name: "spec.pdf", url: "https://files.test/spec.pdf", path: "rfqs/pdfs/1700000000000-spec.pdf" }] }),
  ...projectRecordFiles("pmSheets", { id: "03", seq: 3, by: "u2", byName: "Hind", day: "2026-09-10", files: [{ url: "https://files.test/takeoff.png", name: "takeoff.png" }] }, { id: "pj1", name: "Yasmin Villas", pm: { no: "PJ-2026/001" } }),
  ...crmRecordFiles({ id: "f1", name: "boq.xlsx", path: "organizations/buy/crm/opportunities/d1/1_boq.xlsx", size: 4096, byName: "Nader", at: "2026-09-01T10:00:00.000Z" }, { id: "d1", title: "Tower B", docNumber: "OP-2026/014" }, "en"),
  ...receiptRecordFiles({ id: "d9", source: "manual", contractorOrgId: "buy", poNumber: "PO-2026/020", createdAt: "2026-08-30T10:00:00.000Z", attachmentUrls: ["https://files.test/1700000000000_invoice.jpg"] }, "en"),
]

beforeEach(() => {
  rows = mergeLibrary(filesOf([thread()]), older())
  getDownloadURL.mockClear()
  window.open = jest.fn()
})

describe("the Documents page with files from before the thread", () => {
  it("lists a thread file and older record files together, each with its record and who added it", () => {
    render(<DocumentLibrary portal="contractor" />)
    for (const name of ["quote.pdf", "spec.pdf", "takeoff.png", "boq.xlsx", "invoice.jpg"]) expect(screen.getByText(name)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "PO-2026/012" })).toHaveAttribute("href", "/contractor/rfqs/orders?po=p1")
    expect(screen.getByRole("link", { name: "Rebar supply" })).toHaveAttribute("href", "/contractor/rfqs/r1")
    expect(screen.getByRole("link", { name: "Yasmin Villas" })).toHaveAttribute("href", "/contractor/projects/pj1?tab=pmMeasure")
    expect(screen.getByRole("link", { name: "Tower B" })).toHaveAttribute("href", "/contractor/crm/opportunities/d1")
    expect(screen.getByText("rec_pm_sheet · #03")).toBeInTheDocument()
    expect(screen.getByText("rec_crm_file · OP-2026/014")).toBeInTheDocument()
    expect(screen.getByText("kind_po")).toBeInTheDocument()
    expect(screen.getByText("Omar")).toBeInTheDocument()
  })

  it("opens a record file from the link it keeps, and a Storage-path file with a fresh one", async () => {
    render(<DocumentLibrary portal="contractor" />)
    fireEvent.click(screen.getByText("spec.pdf"))
    expect(window.open).toHaveBeenCalledWith("https://files.test/spec.pdf", "_blank", "noopener,noreferrer")
    expect(getDownloadURL).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText("boq.xlsx"))
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://files.example/fresh", "_blank", "noopener,noreferrer"))
    expect(getDownloadURL).toHaveBeenCalledWith({ path: "organizations/buy/crm/opportunities/d1/1_boq.xlsx" })
  })

  it("counts both kinds: the files, the shared ones and the ones I added", () => {
    render(<DocumentLibrary portal="contractor" />)
    const kpi = (label: string) => screen.getAllByText(label)[0].parentElement as HTMLElement
    expect(within(kpi("kpi_files")).getByText("5")).toBeInTheDocument()
    expect(within(kpi("kpi_shared")).getByText("2")).toBeInTheDocument()
    expect(within(kpi("kpi_mine")).getByText("1")).toBeInTheDocument()
  })

  it("offers a chip for each kind of record the company has, and filters by it", () => {
    render(<DocumentLibrary portal="contractor" />)
    expect(screen.getByRole("button", { name: /kind_rfq_plural/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /kind_project_plural/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /kind_crm_plural/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /kind_receipt_plural/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /kind_project_plural/ }))
    expect(screen.getByText("takeoff.png")).toBeInTheDocument()
    expect(screen.queryByText("quote.pdf")).not.toBeInTheDocument()
    expect(screen.queryByText("spec.pdf")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "clear_filters" }))
    expect(screen.getByText("quote.pdf")).toBeInTheDocument()
  })

  it("does not offer a chip for a kind of record the company has none of", () => {
    rows = mergeLibrary(filesOf([thread()]), [])
    render(<DocumentLibrary portal="contractor" />)
    expect(screen.queryByRole("button", { name: /kind_crm_plural/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /kind_po_plural/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /kind_offer_plural/ })).toBeInTheDocument()
  })

  it("searches across both kinds", () => {
    render(<DocumentLibrary portal="contractor" />)
    fireEvent.change(screen.getByLabelText("search_label"), { target: { value: "yasmin" } })
    expect(screen.getByText("takeoff.png")).toBeInTheDocument()
    expect(screen.queryByText("quote.pdf")).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("search_label"), { target: { value: "mona" } })
    expect(screen.getByText("quote.pdf")).toBeInTheDocument()
    expect(screen.queryByText("takeoff.png")).not.toBeInTheDocument()
  })

  it("opens a record on the supplier's own side where the record has one", () => {
    render(<DocumentLibrary portal="supplier" />)
    expect(screen.getByRole("link", { name: "Tower B" })).toHaveAttribute("href", "/supplier/crm/opportunities/d1")
    expect(screen.getByRole("link", { name: "Rebar supply" })).toHaveAttribute("href", "/supplier/rfqs")
  })
})
