/**
 * "My to-dos": what a person sees (grouped, in order, only theirs), finishing one
 * through the dialog, and planning a new one.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { Activity } from "@/lib/activities"

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})
jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}|${Object.values(params).join(",")}` : key),
}))
jest.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
jest.mock("@/firebase", () => ({ useFirestore: () => ({}), useUser: () => ({ user: { uid: "u1", displayName: "Mona", email: "m@x.sa" } }) }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isOrgOwner: false }) }))
jest.mock("@/hooks/useResolvedProfile", () => ({ useResolvedProfile: () => ({ profile: { name: "Mona" }, organizationId: "org" }) }))
jest.mock("@/hooks/useOrgMembers", () => ({
  useOrgMembers: () => ({ orgMembers: [{ id: "u1", name: "Mona" }, { id: "u2", name: "Omar" }], isLoading: false }),
}))

let rows: Activity[] = []
jest.mock("@/hooks/useActivities", () => {
  const lib = jest.requireActual<typeof import("@/lib/activities")>("@/lib/activities")
  const fmt = jest.requireActual<typeof import("@/lib/pm/format")>("@/lib/pm/format")
  return {
    useActivities: () => ({ loading: false, activities: rows }),
    useMyActivities: (_org: string, uid: string) => {
      const groups = lib.groupMine(rows, uid, fmt.todayDay())
      return { loading: false, activities: rows, groups, counts: lib.countsOf(groups) }
    },
  }
})
const complete = jest.fn()
const create = jest.fn()
jest.mock("@/lib/activity-writes", () => ({
  ...jest.requireActual("@/lib/activity-writes"),
  completeActivity: (...args: unknown[]) => complete(...args),
  createActivity: (...args: unknown[]) => create(...args),
}))

import { MyActivities } from "@/components/activities/MyActivities"
import { todayDay } from "@/lib/pm/format"

const shift = (days: number) => new Date(Date.parse(`${todayDay()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

const act = (over: Partial<Activity> = {}): Activity => ({
  id: "a1",
  organizationId: "org",
  type: "todo",
  summary: "Call the supplier",
  note: null,
  dueOn: todayDay(),
  assigneeId: "u1",
  assigneeName: "Mona",
  createdById: "u2",
  createdByName: "Omar",
  status: "open",
  target: null,
  targetKey: null,
  ...over,
})

beforeEach(() => {
  complete.mockReset()
  complete.mockResolvedValue(undefined)
  create.mockReset()
  create.mockResolvedValue("new")
  rows = []
})

describe("My to-dos screen", () => {
  it("says so when nothing is planned for me", () => {
    render(<MyActivities portal="contractor" />)
    expect(screen.getByText("empty_mine")).toBeInTheDocument()
  })

  it("groups mine as overdue, today and coming up, and leaves other people's out", () => {
    rows = [
      act({ id: "1", summary: "Late one", dueOn: shift(-2) }),
      act({ id: "2", summary: "Today one" }),
      act({ id: "3", summary: "Later one", dueOn: shift(4) }),
      act({ id: "4", summary: "Not mine", assigneeId: "u9" }),
    ]
    render(<MyActivities portal="contractor" />)
    expect(screen.getByText("group_overdue")).toBeInTheDocument()
    expect(screen.getByText("group_today")).toBeInTheDocument()
    expect(screen.getByText("group_planned")).toBeInTheDocument()
    expect(screen.getByText("Late one")).toBeInTheDocument()
    expect(screen.queryByText("Not mine")).not.toBeInTheDocument()
    expect(screen.queryByText("empty_mine")).not.toBeInTheDocument()
  })

  it("links an activity to the document it is about", () => {
    rows = [act({ target: { kind: "po", id: "po1", label: "PO-2026/012", href: "/contractor/rfqs/orders?po=po1" } })]
    render(<MyActivities portal="contractor" />)
    expect(screen.getByRole("link", { name: /PO-2026\/012/ })).toHaveAttribute("href", "/contractor/rfqs/orders?po=po1")
  })

  it("lists what I planned for others under its own heading", () => {
    rows = [act({ id: "5", summary: "For Omar", assigneeId: "u2", assigneeName: "Omar", createdById: "u1", createdByName: "Mona" })]
    render(<MyActivities portal="contractor" />)
    expect(screen.getByText("group_by_me")).toBeInTheDocument()
    expect(screen.getByText("For Omar")).toBeInTheDocument()
  })

  it("finishes one through the dialog with the outcome", async () => {
    rows = [act()]
    render(<MyActivities portal="contractor" />)
    fireEvent.click(screen.getByRole("button", { name: "done" }))
    expect(screen.getByText("done_title")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("feedback_label"), { target: { value: "confirmed" } })
    fireEvent.click(screen.getByRole("button", { name: "mark_done" }))
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    const [, actor, portal, id, feedback] = complete.mock.calls[0]
    expect(actor).toMatchObject({ uid: "u1", name: "Mona" })
    expect([portal, id, feedback]).toEqual(["contractor", "a1", "confirmed"])
  })

  it("plans a new one: the save stays shut until it says what, then writes it for the chosen person", async () => {
    render(<MyActivities portal="supplier" />)
    fireEvent.click(screen.getByRole("button", { name: "add" }))
    const save = screen.getByRole("button", { name: "save" })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/f_summary/), { target: { value: "Chase the invoice" } })
    fireEvent.change(screen.getByLabelText(/f_assignee/), { target: { value: "u2" } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const [, actor, orgId, portal, input] = create.mock.calls[0]
    expect(actor).toMatchObject({ uid: "u1" })
    expect([orgId, portal]).toEqual(["org", "supplier"])
    expect(input).toMatchObject({ type: "todo", summary: "Chase the invoice", dueOn: todayDay(), assignee: { id: "u2", name: "Omar" } })
  })
})
