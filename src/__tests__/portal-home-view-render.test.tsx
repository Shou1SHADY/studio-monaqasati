/**
 * The portal home both portals render: a tile per module the member can open, the
 * locked ones with "request access", the decisions of the day — the same screen
 * whether a contractor or a supplier signs in.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})
jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}|${Object.values(params).join(",")}` : key),
}))
jest.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
const addDoc = jest.fn().mockResolvedValue({ id: "x" })
jest.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => addDoc(...args),
  collection: (_db: unknown, ...segments: string[]) => segments.join("/"),
  query: () => null,
  where: () => null,
}))
jest.mock("@/firebase", () => ({
  useFirestore: () => ({}),
  useUser: () => ({ user: { uid: "m1", email: "m@x.sa" } }),
  useMemoFirebase: () => null,
  useCollection: () => ({ data: [] }),
}))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
let owner = false
jest.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ can: (p: string) => owner || p === "offers.view", isOrgOwner: owner, groups: [{ id: "g1", name: "Sales team" }] }),
}))

import { PortalHomeView, type PortalHomeViewProps } from "@/components/portal-home/PortalHomeView"
import { SUPPLIER_COMPONENTS } from "@/lib/portal-components"

const props = (over: Partial<PortalHomeViewProps> = {}): PortalHomeViewProps => ({
  profile: { name: "Mona Ali", defaultGroupId: "g1" },
  orgId: "org1",
  companyName: "Acme Supply",
  modules: SUPPLIER_COMPONENTS,
  kpis: [{ key: "decisions", value: 2, label: "home_kpi_decisions_label", dot: true }],
  tileStats: { procurement: "tile_stats_sales|3,1" },
  badges: new Map([["procurement", 2]]),
  urgentTiles: new Set(),
  recent: [],
  decisions: {
    loading: false,
    items: [{ id: "rfq:r1", moduleId: "procurement", title: "decision_rfq_to_answer|Rebar", actionLabel: "decision_rfq_action", href: "/supplier/rfqs?search=Rebar" }],
  },
  ...over,
})

beforeEach(() => {
  owner = false
  addDoc.mockClear()
})

describe("the portal home", () => {
  it("greets the member by first name with his group, and shows the live numbers", () => {
    render(<PortalHomeView {...props()} />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Mona")
    expect(screen.getByText("Sales team")).toBeInTheDocument()
    expect(screen.getByText("home_kpi_decisions_label")).toBeInTheDocument()
  })

  it("opens the modules the member may enter, with their numbers and what needs action", () => {
    render(<PortalHomeView {...props()} />)
    const sales = screen.getByRole("link", { name: /supplier_component_sales/ })
    expect(sales).toHaveAttribute("href", "/supplier/rfqs")
    expect(within(sales).getByText("tile_stats_sales|3,1")).toBeInTheDocument()
    expect(within(sales).getByText("2")).toBeInTheDocument()
    // My to-dos and Documents are every member's.
    expect(screen.getByRole("link", { name: /component_activities/ })).toHaveAttribute("href", "/supplier/activities")
    expect(screen.getByRole("link", { name: /component_documents/ })).toHaveAttribute("href", "/supplier/documents")
  })

  it("shows a module he cannot open as locked, and asks the owner for it", async () => {
    render(<PortalHomeView {...props()} />)
    expect(screen.queryByRole("link", { name: /component_finance/ })).not.toBeInTheDocument()
    const ask = screen.getAllByRole("button", { name: /tile_request_access/ })[0]
    fireEvent.click(ask)
    await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(2))
    expect(addDoc.mock.calls[0][0]).toBe("accessRequests")
    expect(addDoc.mock.calls[0][1]).toMatchObject({ organizationId: "org1", requesterId: "m1", status: "pending" })
    expect(addDoc.mock.calls[1][0]).toBe("users/org1/notifications")
  })

  it("lists the decisions of the day with one action each", () => {
    render(<PortalHomeView {...props()} />)
    expect(screen.getByText("decision_rfq_to_answer|Rebar")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /decision_rfq_action/ })).toHaveAttribute("href", "/supplier/rfqs?search=Rebar")
  })

  it("says nothing is waiting when nothing is", () => {
    owner = true
    render(<PortalHomeView {...props({ decisions: { loading: false, items: [] } })} />)
    expect(screen.getByText("home_priorities_empty")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /tile_request_access/ })).not.toBeInTheDocument()
  })
})
