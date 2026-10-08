/**
 * Admin CRM polish (8 Oct 2026): what made the CRM look unfinished in use — a history line one click from gone, a
 * permanent delete without a question, a card whose number did not match the list it opened, «N of M» counting
 * the wrong pool during a search, «0 days ago», "contacted" painted in the converted green, and a lead page that
 * could not convert its lead.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"
import type { AdminCrm } from "@/hooks/useAdminCrm"
import { buildLeadRows, leadMatches, type CrmActivity, type LeadDoc } from "@/lib/admin-crm"

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
}))
jest.mock("@/firebase", () => ({ useFirestore: () => ({}), useUser: () => ({ user: { uid: "u1" } }) }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock("@/lib/admin-crm-writes", () => ({
  ...jest.requireActual("@/lib/admin-crm-writes"),
  changeStage: jest.fn(() => Promise.resolve()),
  setLeadArchived: jest.fn(() => Promise.resolve()),
}))

import { ActivityRow } from "@/components/admin/crm/ActivityRow"
import { LeadsTab } from "@/components/admin/crm/LeadsTab"
import { STAGE_TONE } from "@/components/admin/crm/parts"

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

describe("activity rows", () => {
  const base: CrmActivity = { id: "a1", clientId: "c1", type: "call", status: "scheduled", dueDate: "2026-10-09", title: "Call back", note: "" }

  it("a delete asks first, and nothing is deleted until it is confirmed", () => {
    const onDelete = jest.fn()
    render(<ActivityRow a={base} today="2026-10-08" onToggle={() => {}} onEdit={() => {}} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole("button", { name: "delete" }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByText("activity_delete_title")).toBeTruthy()
    fireEvent.click(screen.getAllByRole("button", { name: "delete" }).at(-1) as HTMLElement)
    expect(onDelete).toHaveBeenCalledWith(base)
  })

  it("a stage change — with the reason the team recorded — and the conversion line cannot be deleted", () => {
    const stage: CrmActivity = { id: "s1", clientId: "c1", type: "stage", from: "new", to: "contacted", note: "Asked for a demo", status: "done" }
    const converted: CrmActivity = { id: "s2", clientId: "c1", type: "note", system: "converted", note: "", status: "done" }
    for (const a of [stage, converted]) {
      const { unmount } = render(<ActivityRow a={a} today="2026-10-08" onToggle={() => {}} onEdit={() => {}} onDelete={() => {}} />)
      expect(screen.queryByRole("button", { name: "delete" })).toBeNull()
      unmount()
    }
  })
})

describe("leads tab numbers", () => {
  it("the «leads» card counts every live lead and opens the list that has exactly that many", () => {
    const crm = crmWith([lead(1), lead(2, { status: "converted" }), lead(3)], { lead_demo_l3: { stage: "lost" } })
    render(<LeadsTab crm={crm} view="list" onView={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /kpi_total_leads/ }))
    expect(screen.getByRole("button", { name: /^segment_all/ }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getAllByRole("row")).toHaveLength(4) // header + three
    expect(screen.getByText("crm_showing_count|3,3")).toBeTruthy()
  })

  it("search, segment and filters work together (ADM-02 #4), Arabic-folded, and the segments count what the search left", () => {
    const crm = crmWith([lead(1, { name: "أحمد سالم" }), lead(2, { name: "احمد علي", status: "converted" }), lead(3, { name: "Beta" })])
    render(<LeadsTab crm={crm} view="list" onView={() => {}} />)
    expect(screen.getByText(/^crm_showing_count\|2,2/)).toBeTruthy() // open: أحمد سالم, Beta
    fireEvent.change(screen.getByLabelText("crm_search_placeholder"), { target: { value: "احمد" } })
    expect(screen.getByText(/^crm_showing_count\|1,1/)).toBeTruthy() // open and matching: أحمد سالم only
    expect(screen.getByText("أحمد سالم")).toBeTruthy()
    expect(screen.getByRole("button", { name: /^segment_converted/ }).textContent).toBe("segment_converted1")
  })
})

describe("wording and colour", () => {
  it("days since contact reads as Arabic and English do — never «0 days ago»", () => {
    // A one-level ICU plural, picked the way next-intl does: an exact «=n» first, else the locale's plural category.
    const fmt = (msg: string, locale: string, n: number) => {
      const branches = Object.fromEntries([...msg.matchAll(/(=\d+|zero|one|two|few|many|other) \{([^{}]*)\}/g)].map((m) => [m[1], m[2]]))
      const text = branches[`=${n}`] ?? branches[new Intl.PluralRules(locale).select(n)] ?? branches.other
      return text.replace("#", String(n))
    }
    const a = ar.Portal.Admin.Crm.days_ago
    const e = en.Portal.Admin.Crm.days_ago
    expect([0, 1, 2, 3, 11, 100].map((n) => fmt(a, "ar", n))).toEqual(["اليوم", "أمس", "منذ يومين", "منذ 3 أيام", "منذ 11 يومًا", "منذ 100 يوم"])
    expect([0, 1, 5].map((n) => fmt(e, "en", n))).toEqual(["Today", "Yesterday", "5 days ago"])
  })

  it("each open stage has its own colour, and none of them is the converted green", () => {
    const open = ["new", "contacted", "demo", "negotiation"].map((s) => STAGE_TONE[s].bar)
    expect(new Set(open).size).toBe(4)
    expect(open).not.toContain(STAGE_TONE.converted.bar)
  })
})
