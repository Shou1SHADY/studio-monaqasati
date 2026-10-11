/**
 * "My to-dos" with the home page's decisions folded in: a decision waiting since
 * yesterday sits under Overdue next to a planned activity, counts in the KPIs,
 * opens its page, and cannot be ticked off here.
 */
import { render, screen, within } from "@testing-library/react"
import type { Activity } from "@/lib/activities"
import type { WorkQueueItem } from "@/hooks/useWorkQueue"

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
jest.mock("@/hooks/useOrgMembers", () => ({ useOrgMembers: () => ({ orgMembers: [{ id: "u1", name: "Mona" }], isLoading: false }) }))

let rows: Activity[] = []
let queueItems: WorkQueueItem[] = []
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
jest.mock("@/hooks/useQueueTasks", () => {
  const tasks = jest.requireActual<typeof import("@/lib/work-queue-tasks")>("@/lib/work-queue-tasks")
  const fmt = jest.requireActual<typeof import("@/lib/pm/format")>("@/lib/pm/format")
  return {
    useQueueTasks: () => ({
      loading: false,
      tasks: tasks.queueTasks(queueItems, { can: () => true, modules: { on: () => true, linkable: () => true }, today: fmt.todayDay() }),
    }),
  }
})

import { MyActivities } from "@/components/activities/MyActivities"
import { todayDay } from "@/lib/pm/format"

const dayAndAHalfAgo = Date.now() - 86_400_000 * 1.5

const activity: Activity = {
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
}

const approve = (over: Partial<WorkQueueItem> = {}): WorkQueueItem => ({
  id: "po_approve",
  type: "po_approve",
  tier: 2,
  sortMs: 0,
  actionUrl: "/contractor/rfqs/orders?filter=awaiting_approval",
  data: { count: 3 },
  since: dayAndAHalfAgo,
  ...over,
})

beforeEach(() => {
  rows = []
  queueItems = []
})

describe("My to-dos with the work queue", () => {
  it("lists a decision waiting since yesterday under Overdue, beside a real activity under Today", () => {
    rows = [activity]
    queueItems = [approve()]
    render(<MyActivities portal="contractor" />)
    expect(screen.getByText("group_overdue")).toBeInTheDocument()
    expect(screen.getByText("group_today")).toBeInTheDocument()
    expect(screen.getByText("Call the supplier")).toBeInTheDocument()
    expect(screen.getByText("queue_item_po_approve|3")).toBeInTheDocument()
    expect(screen.getByText("component_procurement")).toBeInTheDocument()
    expect(screen.getByText(/^queue_waiting\|/)).toBeInTheDocument()
    expect(screen.queryByText("empty_mine")).not.toBeInTheDocument()
  })

  it("counts the decision in the overdue figure and opens its page without a done button", () => {
    queueItems = [approve()]
    render(<MyActivities portal="contractor" />)
    const kpi = screen.getByText("kpi_overdue").parentElement as HTMLElement
    expect(within(kpi).getByText("1")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /queue_open/ })).toHaveAttribute("href", "/contractor/rfqs/orders?filter=awaiting_approval")
    expect(screen.queryByRole("button", { name: "done" })).not.toBeInTheDocument()
  })

  it("puts a decision that started today under Today, and shows the empty state only when both are empty", () => {
    queueItems = [approve({ since: Date.now() })]
    const { unmount } = render(<MyActivities portal="contractor" />)
    expect(screen.getByText("group_today")).toBeInTheDocument()
    expect(screen.queryByText("group_overdue")).not.toBeInTheDocument()
    expect(screen.getByText("queue_waiting_today")).toBeInTheDocument()
    unmount()
    queueItems = []
    render(<MyActivities portal="contractor" />)
    expect(screen.getByText("empty_mine")).toBeInTheDocument()
  })
})
