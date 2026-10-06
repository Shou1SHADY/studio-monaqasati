/**
 * The admin CRM leads tab (ADM-01…03): four number cards, one segment strip, four open columns,
 * ten cards then "show more", a card applies its filter, and a stage change asks why first.
 */
import { fireEvent, render, screen, within } from "@testing-library/react"
import type { AdminCrm } from "@/hooks/useAdminCrm"
import { buildLeadRows, leadMatches, type LeadDoc } from "@/lib/admin-crm"

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})
jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}|${Object.values(params).join(",")}` : key),
}))
jest.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
jest.mock("@/firebase", () => ({ useFirestore: () => ({}), useUser: () => ({ user: { uid: "u1" } }) }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
const changeStage = jest.fn(() => Promise.resolve())
jest.mock("@/lib/admin-crm-writes", () => ({
  ...jest.requireActual("@/lib/admin-crm-writes"),
  changeStage: (...a: unknown[]) => (changeStage as unknown as (...x: unknown[]) => Promise<void>)(...a),
  setLeadArchived: jest.fn(() => Promise.resolve()),
}))

import { LeadsTab } from "@/components/admin/crm/LeadsTab"

const now = new Date()
const secs = (daysAgo: number) => ({ seconds: (now.getTime() - daysAgo * 86_400_000) / 1000 })

function crmWith(docs: LeadDoc[], records: Record<string, object> = {}): AdminCrm {
  const leadRows = buildLeadRows(docs, records, now)
  return {
    user: { uid: "u1", email: "me@x.sa" },
    staff: [{ id: "u1", name: "Me" }],
    records,
    activities: [],
    quoteCount: {},
    leadRows,
    clientRows: [],
    matches: leadMatches(leadRows, []),
    leadDocs: { demo: [], onboarding: [] },
    loading: { leads: false, clients: false, activities: false },
  } as unknown as AdminCrm
}
const lead = (i: number, over: Partial<LeadDoc> = {}): LeadDoc => ({ id: `l${i}`, source: "demo", name: `Lead Number ${i}`, createdAt: secs(1), ...over })

describe("leads tab", () => {
  beforeEach(() => changeStage.mockClear())

  it("shows the four open stages only as columns, with the segment strip and its counts", () => {
    const crm = crmWith([lead(1), lead(2, { status: "converted" }), lead(3)], { lead_demo_l3: { stage: "lost" } })
    render(<LeadsTab crm={crm} view="board" onView={() => {}} />)
    for (const stage of ["stage_new", "stage_contacted", "stage_demo", "stage_negotiation"]) expect(screen.getByRole("region", { name: stage })).toBeTruthy()
    expect(screen.queryByRole("region", { name: "stage_lost" })).toBeNull()
    expect(screen.queryByRole("region", { name: "stage_converted" })).toBeNull()
    const tabs = screen.getAllByRole("tab")
    expect(tabs.map((t) => t.textContent)).toEqual(["segment_open1", "segment_converted1", "segment_lost1", "segment_all3", "segment_removed0"])
  })

  it("a column shows its first ten cards, then «show more»", () => {
    const crm = crmWith(Array.from({ length: 13 }, (_, i) => lead(i)))
    render(<LeadsTab crm={crm} view="board" onView={() => {}} />)
    const col = screen.getByRole("region", { name: "stage_new" })
    expect(within(col).getAllByRole("article")).toHaveLength(10)
    fireEvent.click(within(col).getByText("show_more|3"))
    expect(within(col).getAllByRole("article")).toHaveLength(13)
  })

  it("the «no owner» card applies its filter", () => {
    const crm = crmWith([lead(1), lead(2)], { lead_demo_l1: { ownerUid: "u1", ownerName: "Me" } })
    render(<LeadsTab crm={crm} view="list" onView={() => {}} />)
    expect(screen.getAllByRole("row")).toHaveLength(3) // header + two
    fireEvent.click(screen.getByRole("button", { name: /kpi_unowned/ }))
    expect(screen.getAllByRole("row")).toHaveLength(2)
    expect(screen.getByText("Lead Number 2")).toBeTruthy()
  })

  it("moving a card to another stage asks for the reason before anything is saved", () => {
    const crm = crmWith([lead(1)])
    render(<LeadsTab crm={crm} view="board" onView={() => {}} />)
    fireEvent.change(screen.getByLabelText("board_move_to"), { target: { value: "demo" } })
    expect(changeStage).not.toHaveBeenCalled()
    expect(screen.getByText("stage_reason_title")).toBeTruthy()
  })

  it("a long e-mail is one left-to-right line, whole on hover", () => {
    const email = "someone.with.a.very.long.address@dynamikindustrial.com"
    const crm = crmWith([lead(1, { email })])
    render(<LeadsTab crm={crm} view="list" onView={() => {}} />)
    const el = screen.getByTitle(email)
    expect(el.getAttribute("dir")).toBe("ltr")
    expect(el.className).toContain("truncate")
  })
})
