/**
 * The equipment desk screen: what the store keeper sees, in what order, who is
 * turned away, and a full answer through the dialog.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { DeskRequest } from "@/lib/pm/plant-desk"

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})
jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}|${Object.values(params).join(",")}` : key),
}))
jest.mock("@/firebase", () => ({ useFirestore: () => ({}), useUser: () => ({ user: { uid: "st1", displayName: "Store keeper", email: "s@x.sa" } }) }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))

let perms: { can: (p: string) => boolean; isLoading: boolean } = { can: (p: string) => p === "warehouses.manage", isLoading: false }
let desk: { loading: boolean; projects: unknown[]; rows: DeskRequest[] } = { loading: false, projects: [], rows: [] }
jest.mock("@/hooks/usePermissions", () => ({ usePermissions: () => perms }))
jest.mock("@/hooks/useResolvedProfile", () => ({ useResolvedProfile: () => ({ profile: { name: "Store keeper" }, organizationId: "org" }) }))
jest.mock("@/hooks/useOrgPlantRequests", () => ({ useOrgPlantRequests: () => desk }))
const answer = jest.fn()
jest.mock("@/lib/pm/plant-desk-writes", () => ({
  ...jest.requireActual("@/lib/pm/plant-desk-writes"),
  answerPlantRequest: (...args: unknown[]) => answer(...args),
}))

import { EquipmentDesk } from "@/components/inventory/EquipmentDesk"
import { todayDay } from "@/lib/pm/format"

const row = (over: Partial<DeskRequest> = {}): DeskRequest => ({
  id: "01",
  seq: 1,
  category: "light",
  what: "Generator",
  activityId: null,
  from: "2999-01-10",
  to: "2999-01-20",
  qty: 1,
  operator: false,
  whyK: "site",
  why: null,
  status: "go",
  day: "2026-10-01",
  by: "se1",
  byName: "Site",
  projectId: "p1",
  projectName: "Villas",
  projectNo: "PJ-2026/001",
  ...over,
})

beforeEach(() => {
  answer.mockReset()
  answer.mockResolvedValue(undefined)
  perms = { can: (p: string) => p === "warehouses.manage", isLoading: false }
  desk = { loading: false, projects: [], rows: [] }
})

describe("the equipment desk screen", () => {
  it("turns away someone without the manage-warehouses permission", () => {
    perms = { can: () => false, isLoading: false }
    render(<EquipmentDesk />)
    expect(screen.getByText("no_access_title")).toBeInTheDocument()
    expect(screen.queryByText("waiting_title")).not.toBeInTheDocument()
  })

  it("says so when nothing waits", () => {
    render(<EquipmentDesk />)
    expect(screen.getByText("waiting_empty")).toBeInTheDocument()
    expect(screen.getByText("answered_empty")).toBeInTheDocument()
  })

  it("lists what waits with the earliest need-by date first, and not what is unapproved or answered", () => {
    desk.rows = [
      row({ id: "02", seq: 2, what: "Crane", from: "2999-03-01", to: "2999-03-05" }),
      row({ id: "01", seq: 1, what: "Generator", from: "2999-02-01", to: "2999-02-05" }),
      row({ id: "03", seq: 3, what: "Waiting for the manager", status: "wait" }),
      row({ id: "04", seq: 4, what: "Already answered", rep: { k: "none", on: "2026-10-01", by: "st1", byName: "Store keeper" } }),
    ]
    render(<EquipmentDesk />)
    const waiting = screen.getAllByText(/Generator|Crane/).map((n) => n.textContent)
    expect(waiting.findIndex((t) => t?.includes("Generator"))).toBeLessThan(waiting.findIndex((t) => t?.includes("Crane")))
    expect(screen.queryByText(/Waiting for the manager/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/Already answered/)).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "answer" })).toHaveLength(2)
  })

  it("marks a request that is needed and still unanswered", () => {
    desk.rows = [row({ from: "2000-01-01", to: "2000-01-05" })]
    render(<EquipmentDesk />)
    expect(screen.getAllByText("urgency_late").length).toBeGreaterThan(0)
  })

  it("answers through the dialog: pick the kind, give the unit, save", async () => {
    desk.rows = [row()]
    render(<EquipmentDesk />)
    fireEvent.click(screen.getByRole("button", { name: "answer" }))
    expect(screen.getByText("answer_title")).toBeInTheDocument()
    const save = screen.getByRole("button", { name: "plantreq.rep.save" })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole("radio", { name: "plantreq.st.alloc" }))
    fireEvent.change(screen.getByLabelText(/plantreq\.rep\.unit/), { target: { value: "GEN-04" } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1))
    const [, actor, projectId, seq, input] = answer.mock.calls[0]
    expect(actor).toEqual({ uid: "st1", name: "Store keeper" })
    expect(projectId).toBe("p1")
    expect(seq).toBe(1)
    expect(input).toMatchObject({ k: "alloc", unit: "GEN-04", on: todayDay() })
  })

  it("keeps the dialog's save closed until the answer is complete", () => {
    desk.rows = [row()]
    render(<EquipmentDesk />)
    fireEvent.click(screen.getByRole("button", { name: "answer" }))
    fireEvent.click(screen.getByRole("radio", { name: "plantreq.st.late" }))
    expect(screen.getByRole("button", { name: "plantreq.rep.save" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/plantreq\.rep\.free/), { target: { value: "2999-01-05" } })
    expect(screen.getByRole("button", { name: "plantreq.rep.save" })).toBeEnabled()
  })
})
