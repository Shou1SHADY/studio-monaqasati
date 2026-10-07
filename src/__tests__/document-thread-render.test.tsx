/**
 * The documents component on screen: the thread, who may post, sharing against
 * keeping it internal, and the tabs.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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
jest.mock("firebase/storage", () => ({ getDownloadURL: jest.fn(), ref: jest.fn(), uploadBytes: jest.fn() }))
jest.mock("@/firebase", () => ({ useFirestore: () => ({}), useStorage: () => ({}), useUser: () => ({ user: { uid: "bu1", displayName: "Mona", email: "m@x.sa" } }) }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isOrgOwner: false }) }))

let orgId = "buy"
jest.mock("@/hooks/useResolvedProfile", () => ({ useResolvedProfile: () => ({ profile: { name: "Mona" }, organizationId: orgId }) }))
jest.mock("@/hooks/useOrgMembers", () => ({ useOrgMembers: () => ({ orgMembers: [], isLoading: false }) }))
jest.mock("@/hooks/useActivities", () => ({ useActivities: () => ({ loading: false, activities: [] }) }))

let entries: ThreadEntry[] = []
jest.mock("@/hooks/useDocumentThread", () => ({ useDocumentThread: () => ({ loading: false, entries }) }))
const comment = jest.fn()
jest.mock("@/lib/document-thread-writes", () => ({
  ...jest.requireActual("@/lib/document-thread-writes"),
  postComment: (...args: unknown[]) => comment(...args),
}))

import { DocumentThread } from "@/components/documents/DocumentThread"

const target = { kind: "po" as const, id: "p1", label: "PO-2026/012", href: "/contractor/rfqs/orders?po=p1" }
const registered = { buyerOrgId: "buy", supplierOrgId: "sup" }

const entry = (over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id: "n1",
  targetKey: "po:p1",
  targetKind: "po",
  targetId: "p1",
  targetLabel: "PO-2026/012",
  targetHref: "/contractor/rfqs/orders?po=p1",
  targetSupplierHref: "/supplier/orders?po=p1",
  kind: "comment",
  visibility: "shared",
  body: "When can you deliver?",
  file: null,
  authorId: "bu1",
  authorName: "Mona",
  authorOrgId: "buy",
  buyerOrgId: "buy",
  supplierOrgId: "sup",
  at: "2026-10-05T10:00:00.000Z",
  ...over,
})

beforeEach(() => {
  comment.mockReset()
  comment.mockResolvedValue("n")
  orgId = "buy"
  entries = []
})

describe("the documents component", () => {
  it("says so when nothing was said yet", () => {
    render(<DocumentThread portal="contractor" target={target} parties={registered} />)
    expect(screen.getByText("comments_empty")).toBeInTheDocument()
  })

  it("lists comments with who wrote them and whether the other company sees them", () => {
    entries = [entry(), entry({ id: "n2", body: "Internal only", visibility: "internal", supplierOrgId: null })]
    render(<DocumentThread portal="contractor" target={target} parties={registered} />)
    expect(screen.getByText("When can you deliver?")).toBeInTheDocument()
    expect(screen.getByText("Internal only")).toBeInTheDocument()
    expect(screen.getAllByText("shared_with|party_supplier")).toHaveLength(2)
    expect(screen.getAllByText("internal").length).toBeGreaterThan(0)
  })

  it("posts a comment shared with the other company by default, with who to tell", async () => {
    render(<DocumentThread portal="contractor" target={target} parties={registered} notify={{ buyer: ["bu1"], supplier: ["su1"] }} />)
    const send = screen.getByRole("button", { name: "send" })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText("comment_label"), { target: { value: "Please confirm" } })
    expect(send).toBeEnabled()
    fireEvent.click(send)
    await waitFor(() => expect(comment).toHaveBeenCalledTimes(1))
    const [, actor, input] = comment.mock.calls[0]
    expect(actor).toMatchObject({ uid: "bu1", orgId: "buy" })
    expect(input).toMatchObject({ visibility: "shared", body: "Please confirm", notify: { supplier: ["su1"] }, parties: registered })
  })

  it("posts internally when chosen", async () => {
    render(<DocumentThread portal="contractor" target={target} parties={registered} />)
    fireEvent.click(screen.getByRole("button", { name: "internal" }))
    fireEvent.change(screen.getByLabelText("comment_label"), { target: { value: "Price is high" } })
    fireEvent.click(screen.getByRole("button", { name: "send" }))
    await waitFor(() => expect(comment).toHaveBeenCalledTimes(1))
    expect(comment.mock.calls[0][2]).toMatchObject({ visibility: "internal" })
  })

  it("on a guest supplier's document offers internal only", () => {
    render(<DocumentThread portal="contractor" target={target} parties={{ buyerOrgId: "buy", supplierOrgId: "guest" }} />)
    expect(screen.getByRole("button", { name: /shared_with/ })).toBeDisabled()
    expect(screen.getByText("guest_note")).toBeInTheDocument()
  })

  it("lets a company that is no party read but not write", () => {
    orgId = "stranger"
    render(<DocumentThread portal="contractor" target={target} parties={registered} />)
    expect(screen.getByText("read_only")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "send" })).not.toBeInTheDocument()
  })

  it("shows files with their size and the history with the document's own log", () => {
    entries = [entry({ id: "f1", kind: "file", body: "", file: { name: "quote.pdf", size: 2048, contentType: "application/pdf", path: "p" } })]
    render(<DocumentThread portal="contractor" target={target} parties={registered} log={[{ at: "2026-10-05T12:00:00.000Z", byName: "Omar", text: "approved the order" }]} />)
    fireEvent.click(screen.getByRole("tab", { name: /tab_files/ }))
    expect(screen.getByText("quote.pdf")).toBeInTheDocument()
    expect(screen.getByText(/2 KB/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: /tab_history/ }))
    expect(screen.getByText("Omar — approved the order")).toBeInTheDocument()
    expect(screen.getByText(/h_file/)).toBeInTheDocument()
  })
})

import { OfferThreadDialog } from "@/components/documents/OfferThreadDialog"

describe("the discussion on an offer", () => {
  const offer = { id: "o1", rfqId: "r1", rfqTitle: "Steel bars", contractorOrgId: "buy", organizationId: "sup", supplierId: "su1", contractorId: "bu1" }

  it("opens the thread of the offer in a window titled by the request", () => {
    render(<OfferThreadDialog offer={offer} portal="contractor" onClose={() => undefined} />)
    expect(screen.getByText("offer_title")).toBeInTheDocument()
    expect(screen.getAllByText("Steel bars").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "send" })).toBeDisabled()
  })

  it("posts on the offer, shared with its supplier", async () => {
    render(<OfferThreadDialog offer={offer} portal="contractor" onClose={() => undefined} />)
    fireEvent.change(screen.getByLabelText("comment_label"), { target: { value: "Can you reduce the price?" } })
    fireEvent.click(screen.getByRole("button", { name: "send" }))
    await waitFor(() => expect(comment).toHaveBeenCalledTimes(1))
    const input = comment.mock.calls[0][2]
    expect(input).toMatchObject({ visibility: "shared", body: "Can you reduce the price?", target: { kind: "offer", id: "o1" }, parties: { buyerOrgId: "buy", supplierOrgId: "sup" }, notify: { supplier: ["su1"] } })
  })

  it("says so when the offer has no company details", () => {
    render(<OfferThreadDialog offer={{ id: "o2" }} portal="contractor" onClose={() => undefined} />)
    expect(screen.getByText("offer_unavailable")).toBeInTheDocument()
  })
})
