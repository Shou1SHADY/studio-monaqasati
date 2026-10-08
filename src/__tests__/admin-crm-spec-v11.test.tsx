/**
 * «صفحة إدارة علاقات العملاء في بوابة الإدارة — التعديلات المطلوبة» v1.1 — the points the first build left out:
 * the admin lists on the subscribers' CRM components (toolbar, segment strip, number cards), «removed» before «all»,
 * the expected-value card naming how many leads carry a value, the card's «arrived …» when nothing is booked, the
 * clients tab's filters / cards / actions, the activities' lead-or-client filter, a merge that brings the other
 * requester along and says what it moves, and a lead edit that never flattens the request's finer types.
 */
import { fireEvent, render, screen, within } from "@testing-library/react"
import type { AdminCrm } from "@/hooks/useAdminCrm"
import {
  LEAD_SEGMENTS,
  arrivedAgo,
  buildClientRows,
  calendarDaysSince,
  deriveContacts,
  buildLeadRows,
  clientContactBuckets,
  leadContactBuckets,
  leadMatches,
  planMerge,
  type ClientUser,
  type CrmActivity,
  type LeadDoc,
} from "@/lib/admin-crm"

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})
jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}|${Object.values(params).join(",")}` : key),
}))
jest.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/admin/crm",
}))
jest.mock("@/firebase", () => ({ useFirestore: () => ({}), useUser: () => ({ user: { uid: "u1" } }) }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
const updateDoc = jest.fn((..._a: unknown[]) => Promise.resolve())
jest.mock("firebase/firestore", () => ({
  ...jest.requireActual("firebase/firestore"),
  doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` }),
  updateDoc: (...a: unknown[]) => updateDoc(...a),
  serverTimestamp: () => "ts",
}))

import { ActivitiesTab } from "@/components/admin/crm/ActivitiesTab"
import { ClientsTab } from "@/components/admin/crm/ClientsTab"
import { LeadsTab } from "@/components/admin/crm/LeadsTab"
import { updateLeadDetails } from "@/lib/admin-crm-writes"

const now = new Date()
const secs = (daysAgo: number) => ({ seconds: (now.getTime() - daysAgo * 86_400_000) / 1000 })
const lead = (i: number, over: Partial<LeadDoc> = {}): LeadDoc => ({ id: `l${i}`, source: "demo", name: `Lead ${i}`, createdAt: secs(1), ...over })

function crmOf({ leads = [], users = [], records = {}, activities = [] }: { leads?: LeadDoc[]; users?: ClientUser[]; records?: Record<string, object>; activities?: CrmActivity[] }): AdminCrm {
  const leadRows = buildLeadRows(leads, records, now)
  const clientRows = buildClientRows(users, records, now)
  return {
    user: { uid: "u1", email: "me@x.sa" },
    staff: [{ id: "u1", name: "Me" }, { id: "u2", name: "Sara" }],
    records,
    activities,
    quoteCount: {},
    leadRows,
    clientRows,
    matches: leadMatches(leadRows, []),
    leadDocs: { demo: [], onboarding: [] },
    loading: { leads: false, clients: false, activities: false },
  } as unknown as AdminCrm
}

describe("ADM-02 / ADM-07 on the leads tab", () => {
  it("the segment strip ends «removed · all», as the spec orders it", () => {
    expect([...LEAD_SEGMENTS]).toEqual(["open", "converted", "lost", "removed", "all"])
  })

  it("the expected-value card says how many leads carry a value, not how many do not", () => {
    const crm = crmOf({ leads: [lead(1), lead(2), lead(3)], records: { lead_demo_l1: { expectedValue: 6000 }, lead_demo_l2: { expectedValue: 12000 } } })
    render(<LeadsTab crm={crm} view="list" onView={() => {}} />)
    expect(screen.getByText("kpi_expected_hint|2")).toBeTruthy()
  })

  it("is the shared toolbar: views, filters and the view menu, beside search", () => {
    render(<LeadsTab crm={crmOf({ leads: [lead(1)] })} view="list" onView={() => {}} />)
    expect(screen.getByRole("button", { name: /crm_saved_views/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /crm_filters/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: "crm_view_options" })).toBeTruthy()
  })
})

describe("ADM-03 card", () => {
  it("a lead with no follow-up shows how long it has waited — hours on its first day, then days", () => {
    expect(arrivedAgo(now.getTime() - 5 * 3_600_000, now)).toEqual({ unit: "hours", n: 5 })
    expect(arrivedAgo(now.getTime() - 3 * 86_400_000, now)).toEqual({ unit: "days", n: 3 })
    expect(arrivedAgo(0, now)).toBeNull()
  })

  it("the board card carries it beside the owner", () => {
    render(<LeadsTab crm={crmOf({ leads: [lead(1, { createdAt: secs(3) })] })} view="board" onView={() => {}} />)
    expect(screen.getByText(/arrived_ago\|days,3/)).toBeTruthy()
  })
})

describe("last-contact filters", () => {
  it("a lead never reached that arrived 7+ days ago is both «never» and «silent 7+»", () => {
    expect(leadContactBuckets({ daysSinceContact: null, silentDays: 9 })).toEqual(["never", "over7"])
    expect(leadContactBuckets({ daysSinceContact: 2, silentDays: 2 })).toEqual(["within7"])
    expect(clientContactBuckets({ daysSinceContact: 45 })).toEqual(["over30"])
  })
})

describe("ADM-10 clients tab", () => {
  const users: ClientUser[] = [
    { id: "c1", role: "Contractor", name: "Alpha Build", createdAt: secs(40) },
    { id: "c2", role: "Supplier", name: "Beta Supply", createdAt: secs(20) },
    { id: "c3", role: "Contractor", name: "Gamma Lost", createdAt: secs(90) },
  ]
  const records = { c1: { stage: "active", ownerUid: "u1", ownerName: "Me" }, c3: { stage: "churned" } }

  it("the «no owner» card opens a list of exactly that many — a lost client needs no owner", () => {
    render(<ClientsTab crm={crmOf({ users, records })} />)
    fireEvent.click(screen.getByRole("button", { name: /kpi_unowned/ }))
    const rows = screen.getAllByRole("row").slice(1)
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText("Beta Supply")).toBeTruthy()
  })

  it("every row has its actions (open the file · log an activity), and the list can be shown as cards", () => {
    render(<ClientsTab crm={crmOf({ users, records })} />)
    expect(screen.getAllByRole("button", { name: "activity_log" })).toHaveLength(3)
    expect(screen.getAllByLabelText("open_client_file")).toHaveLength(3)
    fireEvent.click(screen.getByRole("button", { name: /view_cards/ }))
    expect(screen.getAllByRole("article")).toHaveLength(3)
  })
})

describe("ADM-08 activities tab", () => {
  it("each row says whose it is — a lead's by its company, a client's by name — and a filter tells them apart", () => {
    const activities = [
      { id: "a1", clientId: "lead_demo_l1", type: "call", status: "scheduled", dueDate: "2099-01-01", title: "Call the lead", note: "" },
      { id: "a2", clientId: "c1", type: "email", status: "scheduled", dueDate: "2099-01-02", title: "Mail the client", note: "" },
    ] as CrmActivity[]
    const crm = crmOf({ leads: [lead(1, { company: "Lead Co" })], users: [{ id: "c1", role: "Contractor", name: "Client Co" }], activities })
    render(<ActivitiesTab crm={crm} dialogOpen={false} onDialogOpen={() => {}} />)
    expect(screen.getByText(/lead_badge · Lead Co/)).toBeTruthy()
    expect(screen.getByText(/client_badge · Client Co/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /crm_saved_views/ }))
    fireEvent.click(screen.getByRole("button", { name: "view_lead_activities" }))
    expect(screen.queryByText("Mail the client")).toBeNull()
    expect(screen.getByText("Call the lead")).toBeTruthy()
  })
})

describe("ADM-09 merge", () => {
  const keep = { crmId: "k", name: "Sami", phone: "0551234567", email: "" }
  const drop = { crmId: "d", name: "Reem", phone: "0559876543", email: "reem@x.sa" }

  it("brings the other record's requester along as a contact of its own, never a second main one", () => {
    const { record, contactsMoved } = planMerge(keep, drop, {})
    expect(contactsMoved).toBe(1)
    expect(record.contacts?.map((c) => [c.id, c.name, c.primary])).toEqual([
      ["origin", "Sami", true],
      ["c_from_d", "Reem", false],
    ])
  })

  it("the same person on both sides moves nothing", () => {
    expect(planMerge(keep, { ...keep, crmId: "d" }, {}).contactsMoved).toBe(0)
  })
})

describe("ADM-05 edit", () => {
  beforeEach(() => updateDoc.mockClear())
  const values = { kind: "contractor" as const, name: "Sami", company: "Ofuq", phone: "0551234567", email: "", city: "Riyadh" }

  it("an edit that keeps the type leaves the request's finer types alone", async () => {
    await updateLeadDetails({} as never, { id: "x", source: "onboarding", kind: "contractor" }, values)
    const [ref, patch] = updateDoc.mock.calls[0] as [{ path: string }, Record<string, unknown>]
    expect(ref.path).toBe("onboardingRequests/x")
    expect(patch).not.toHaveProperty("businessTypes")
  })

  it("changing the type writes it", async () => {
    await updateLeadDetails({} as never, { id: "x", source: "demo", kind: "supplier" }, values)
    const [ref, patch] = updateDoc.mock.calls[0] as [{ path: string }, Record<string, unknown>]
    expect(ref.path).toBe("demoRequests/x")
    expect(patch.businessTypes).toEqual(["contractor"])
  })
})

describe("last contact, as people count it", () => {
  it("a call on the 6th is two days ago on the 8th, at any hour", () => {
    const morning = new Date(2026, 9, 8, 8, 40)
    const doneOnThe6th = Date.parse("2026-10-06T12:00:00.000Z") // how a done activity's day is stored
    expect(calendarDaysSince(doneOnThe6th, morning)).toBe(2)
    expect(calendarDaysSince(new Date(2026, 9, 8, 1, 0).getTime(), morning)).toBe(0)
  })

  it("a converted client keeps its lead-time contacts once it has an activity of its own (ADM-10 #4)", () => {
    const at = new Date(2026, 9, 8, 9, 0)
    const activities = [
      { id: "a", clientId: "lead_demo_l7", type: "meeting", status: "done", dueDate: "2026-09-29", note: "" },
      { id: "b", clientId: "c1", type: "call", status: "scheduled", dueDate: "2026-10-09", note: "" },
    ] as CrmActivity[]
    const [row] = buildClientRows([{ id: "c1", role: "Contractor", name: "Client" }], { c1: { convertedFromLead: "lead_demo_l7" } }, at, deriveContacts(activities))
    expect(row.daysSinceContact).toBe(9)
    expect(row.nextFollowUp).toBe("2026-10-09")
  })
})
