/**
 * The admin's components dialog: the switches a company has, what is already off, and what is saved.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})
jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}))
jest.mock("firebase/firestore", () => ({ doc: () => ({}) }))
let stored: { off?: string[] } | null = null
let loading = false
jest.mock("@/firebase", () => ({
  useFirestore: () => ({}),
  useUser: () => ({ user: { uid: "adm", displayName: "Admin", email: "a@x.sa", getIdToken: async () => "tok" } }),
  useMemoFirebase: (f: () => unknown) => f(),
  useDoc: () => ({ data: stored, isLoading: loading }),
}))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
const save = jest.fn()
jest.mock("@/lib/company-modules-writes", () => ({ setCompanyModules: (...args: unknown[]) => save(...args) }))

import { CompanyModulesDialog } from "@/components/admin/CompanyModulesDialog"

let pendingBody: unknown = {}
const fetchMock = jest.fn()

beforeEach(() => {
  pendingBody = {}
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ success: true, data: pendingBody }) }))
  global.fetch = fetchMock as unknown as typeof fetch
  save.mockReset()
  save.mockResolvedValue(undefined)
  stored = null
  loading = false
})

describe("the components dialog", () => {
  it("gives a contractor three switches, all on for a company nobody switched anything for", () => {
    render(<CompanyModulesDialog orgId="o1" companyName="Acme" portal="contractor" onClose={() => undefined} />)
    const sw = screen.getAllByRole("switch")
    expect(sw).toHaveLength(3)
    sw.forEach((s) => expect(s).toBeChecked())
  })

  it("gives a supplier two: no Project Management", () => {
    render(<CompanyModulesDialog orgId="o1" companyName="Acme" portal="supplier" onClose={() => undefined} />)
    expect(screen.getAllByRole("switch")).toHaveLength(2)
    expect(screen.queryByRole("switch", { name: "component_project_management" })).not.toBeInTheDocument()
  })

  it("shows what is already off", () => {
    stored = { off: ["hr"] }
    render(<CompanyModulesDialog orgId="o1" companyName="Acme" portal="contractor" onClose={() => undefined} />)
    expect(screen.getByRole("switch", { name: "component_hr" })).not.toBeChecked()
    expect(screen.getByRole("switch", { name: "component_manufacturing" })).toBeChecked()
  })

  it("saves exactly what was switched off, in the admin's name", async () => {
    const onClose = jest.fn()
    render(<CompanyModulesDialog orgId="o1" companyName="Acme" portal="contractor" onClose={onClose} />)
    fireEvent.click(screen.getByRole("switch", { name: "component_hr" }))
    fireEvent.click(screen.getByRole("switch", { name: "component_manufacturing" }))
    fireEvent.click(screen.getByRole("button", { name: "save" }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const [, orgId, off, actor] = save.mock.calls[0]
    expect(orgId).toBe("o1")
    expect([...off].sort()).toEqual(["hr", "manufacturing"])
    expect(actor).toEqual({ uid: "adm", name: "Admin" })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("switching one back on and saving writes an empty list", async () => {
    stored = { off: ["hr"] }
    render(<CompanyModulesDialog orgId="o1" companyName="Acme" portal="contractor" onClose={() => undefined} />)
    fireEvent.click(screen.getByRole("switch", { name: "component_hr" }))
    fireEvent.click(screen.getByRole("button", { name: "save" }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect([...save.mock.calls[0][2]]).toEqual([])
  })

  it("waits for the stored switches before it lets anyone save over them", () => {
    loading = true
    render(<CompanyModulesDialog orgId="o1" companyName="Acme" portal="contractor" onClose={() => undefined} />)
    expect(screen.queryAllByRole("switch")).toHaveLength(0)
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled()
  })

  it("switching something off with unfinished items warns with the counts and saves only on the second press", async () => {
    pendingBody = { hr: [{ key: "exits", count: 3 }] }
    render(<CompanyModulesDialog orgId="o1" companyName="Acme" portal="contractor" onClose={() => undefined} />)
    fireEvent.click(screen.getByRole("switch", { name: "component_hr" }))
    fireEvent.click(screen.getByRole("button", { name: "save" }))
    await waitFor(() => expect(screen.getByText("pending_title")).toBeInTheDocument())
    expect(screen.getByText("pending_exits")).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls[0][0]).toContain("orgId=o1")
    fireEvent.click(screen.getByRole("button", { name: "confirm_off" }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect([...save.mock.calls[0][2]]).toEqual(["hr"])
  })

  it("changing a switch after the warning asks again", async () => {
    pendingBody = { hr: [{ key: "exits", count: 3 }] }
    render(<CompanyModulesDialog orgId="o1" companyName="Acme" portal="contractor" onClose={() => undefined} />)
    fireEvent.click(screen.getByRole("switch", { name: "component_hr" }))
    fireEvent.click(screen.getByRole("button", { name: "save" }))
    await waitFor(() => expect(screen.getByText("pending_title")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("switch", { name: "component_hr" }))
    expect(screen.queryByText("pending_title")).not.toBeInTheDocument()
  })

  it("never asks the server when nothing is being switched off", async () => {
    stored = { off: ["hr"] }
    render(<CompanyModulesDialog orgId="o1" companyName="Acme" portal="contractor" onClose={() => undefined} />)
    fireEvent.click(screen.getByRole("switch", { name: "component_hr" }))
    fireEvent.click(screen.getByRole("button", { name: "save" }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a component with nothing in flight saves on the first press", async () => {
    render(<CompanyModulesDialog orgId="o1" companyName="Acme" portal="contractor" onClose={() => undefined} />)
    fireEvent.click(screen.getByRole("switch", { name: "component_manufacturing" }))
    fireEvent.click(screen.getByRole("button", { name: "save" }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(screen.queryByText("pending_title")).not.toBeInTheDocument()
  })
})
