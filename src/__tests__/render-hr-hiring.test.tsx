/**
 * HR 1.0 — the Hiring tab rendered for real, as each role, in Arabic (optional: hire, on in this company).
 * The prototype's TABS(): «التوظيف» for the HR manager, government relations and management only. Each
 * render must resolve every key; government relations works the pipeline and converts without a riyal
 * (RL-03); management decides a new position and an offer above the band; the HR manager runs the rest.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

import React from "react"
import { act, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import { todayDay } from "@/lib/hr/format"
import { addDays } from "@/lib/hr/statutory"
import HiringPage from "@/app/[locale]/(contractor)/contractor/hr/hiring/page"
import TodayPage from "@/app/[locale]/(contractor)/contractor/hr/page"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const TODAY = todayDay()
const d = (n: number) => addDays(TODAY, n)
type Role = "owner" | "manager" | "gov" | "payroll" | "supervisor" | "management" | "employee"
const ROLES: Role[] = ["owner", "manager", "gov", "payroll", "supervisor", "management", "employee"]
const UID: Record<Role, string> = { owner: ORG, manager: "hrm", gov: "gro", payroll: "po", supervisor: "sup", management: "mg", employee: "emp1" }
const PERM: Record<Exclude<Role, "owner">, string[]> = { manager: ["employees.manage"], gov: ["hr.gov"], payroll: ["hr.payroll"], supervisor: ["hr.supervisor"], management: ["hr.management"], employee: ["projects.view"] }
const RIYAL = "⃁"
/** The prototype's matrix: who has the Hiring tab. */
const HIRES: Role[] = ["owner", "manager", "gov", "management"]

const stamp = { by: "hrm", byName: "مدير الموارد", at: `${TODAY}T08:00:00Z` }
const opening = (id: string, over: Record<string, unknown>) => ({
  organizationId: ORG,
  kind: "opening",
  pay: false,
  no: `JOB-2026/00${id.slice(-1)}`,
  trade: "accountant",
  q: 1,
  siteId: "s1",
  need: d(-5),
  src: "new",
  ref: null,
  track: "ind",
  state: "open",
  filled: 0,
  why: null,
  opened: stamp,
  batch: null,
  ...over,
})
const candidate = (id: string, over: Record<string, unknown>) => ({
  organizationId: ORG,
  kind: "candidate",
  pay: false,
  openingId: "j1",
  trade: "accountant",
  siteId: "s1",
  names: { ar: `مرشح ${id}`, en: `Candidate ${id}` },
  nat: "sa",
  gender: "m",
  src: "ref",
  phone: null,
  stage: "new",
  added: stamp,
  intAt: null,
  sc: null,
  offer: null,
  why: null,
  employeeId: null,
  ...over,
})
const offer = (state: string) => ({ ...stamp, start: d(3), until: d(5), ct: "open", state, over: state === "mg" })

function buildWorld() {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", email: "owner@test.sa" })
  for (const r of Object.keys(PERM) as Exclude<Role, "owner">[]) {
    seed(`teamGroups/g_${r}`, { organizationId: ORG, name: r, key: null, permissions: PERM[r] })
    seed(`users/${UID[r]}`, { organizationId: ORG, organizationRole: "member", defaultGroupId: `g_${r}`, name: `مستخدم ${r}` })
  }
  seed(`hrSettings/${ORG}`, { organizationId: ORG, features: ["hire"], businessType: "contractor", defaultsAppliedFor: "contractor", establishment: { name: "شركة البناء", visas: 4, minPct: 20 }, policies: {} })
  seed("hrSites/s1", { organizationId: ORG, name: "برج الواحة", type: "project", projectId: "p1", active: true, supervisorUserId: "sup" })
  const people: Array<[string, Record<string, unknown>]> = [
    ["e_hrm", { no: 1, userId: "hrm", trade: "hrOfficer", nationality: "sa" }],
    ["e_gro", { no: 2, userId: "gro", trade: "govRelations", nationality: "sa" }],
    ["e_po", { no: 3, userId: "po", trade: "accountant" }],
    ["e_sup", { no: 4, userId: "sup", trade: "foreman" }],
    ["e_mg", { no: 5, userId: "mg", trade: "siteEngineer" }],
    ["e_emp", { no: 6, userId: "emp1" }],
    ["new1", { no: 7, join: d(-4), docs: {}, hiredFrom: { openingId: "j1", no: "JOB-2026/001", candidateId: null }, onb: {} }],
    ["gone", { no: 8, status: "leaving", lastDay: d(20) }],
  ]
  for (const [id, over] of people) {
    seed(`employees/${id}`, { organizationId: ORG, names: { ar: `موظف ${id}`, en: `Employee ${id}` }, nationality: "eg", gender: "m", trade: "mason", category: "labour", siteId: "s1", join: "2021-03-01", source: "local", contract: { type: "open" }, probation: { end: "2021-05-29", decision: "confirmed" }, status: "active", docs: { iqama: d(300) }, leaveTaken: 0, ...over })
    seed(`employeePay/${id}`, { organizationId: ORG, employeeId: id, basic: 5000, housing: 1250, transport: 500, iban: "SA4420000001234567891234" })
  }
  seed("hrHiring/j1", opening("j1", {}))
  seed("hrHiring/j2", opening("j2", { state: "wait", why: "مسؤول سلامة مقيم", trade: "safety" }))
  seed("hrHiring/j3", opening("j3", { trade: "steelFixer", q: 4, track: "batch", need: d(60), batch: { stage: "visa", agency: "مكتب الخليج", nat: "bd", sel: 4, eta: d(30), issued: 4, visas: 4, reserved: 0 } }))
  seed("hrHiring/c1", candidate("c1", {}))
  seed("hrHiring/c2", candidate("c2", { stage: "acc", offer: offer("acc") }))
  seed("hrHiring/c3", candidate("c3", { stage: "offer", offer: offer("mg") }))
  seed("hrHiring/c3__pay", { organizationId: ORG, kind: "offer", pay: true, candidateId: "c3", openingId: "j1", ask: 9000, basic: 9800 })
  seed("hrHiring/c2__pay", { organizationId: ORG, kind: "offer", pay: true, candidateId: "c2", openingId: "j1", ask: null, basic: 7000 })
}

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
async function open(role: Role, node: React.ReactElement, path: string, search = "") {
  setSignedIn(UID[role])
  setPathname(path, search)
  missingKeys.clear()
  const view = render(node)
  await flush()
  return view
}
const text = () => document.body.textContent ?? ""
const buttons = () => Array.from(document.querySelectorAll("button, a")).map((b) => (b.textContent ?? "").trim())
const railHas = (label: string) => Array.from(document.querySelectorAll("nav a")).some((a) => (a.textContent ?? "").trim().replace(/\d+$/, "") === label)

beforeAll(() => buildWorld())

describe.each(ROLES)("as %s", (role) => {
  it("the Hiring tab: on the rail and open for the hiring roles only, every key resolved, pay only where RL-03 allows", async () => {
    const view = await open(role, <HiringPage />, "/contractor/hr/hiring")
    expect({ role, missing: [...missingKeys] }).toEqual({ role, missing: [] })
    expect(text()).not.toMatch(/MISSING|undefined|NaN|Invalid Date/)
    if (role !== "employee") expect({ role, rail: railHas("التوظيف") }).toEqual({ role, rail: HIRES.includes(role) })
    expect({ role, refused: text().includes("ليس ضمن دورك") }).toEqual({ role, refused: !HIRES.includes(role) })
    if (HIRES.includes(role)) {
      expect(text()).toContain("شواغر مفتوحة")
      expect(text()).toContain("لن يُسدّ في موعد الحاجة")
    }
    if (role === "gov") expect(text()).not.toContain(RIYAL)
    view.unmount()
  })

  it("the opening's page, the candidates and onboarding render too", async () => {
    if (!HIRES.includes(role)) return
    for (const search of ["job=j1", "job=j2", "job=j3", "seg=cand", "seg=join"]) {
      const view = await open(role, <HiringPage />, "/contractor/hr/hiring", search)
      expect({ role, search, missing: [...missingKeys] }).toEqual({ role, search, missing: [] })
      expect(text()).not.toMatch(/MISSING|undefined|NaN|Invalid Date/)
      if (role === "gov") expect({ search, riyal: text().includes(RIYAL) }).toEqual({ search, riyal: false })
      view.unmount()
    }
  })
})

describe("who does what on Hiring (WF-17/18, ST-03)", () => {
  it("the HR manager screens, sees the band and the pay, opens new openings — and does not approve a position", async () => {
    let view = await open("manager", <HiringPage />, "/contractor/hr/hiring", "job=j1")
    expect(buttons()).toEqual(expect.arrayContaining(["قابِل", "استبعد", "أضف مرشحاً", "أغلق الشاغر", "شاغر جديد"]))
    expect(text()).toContain("نطاق الأساسي للمهنة")
    expect(text()).toContain("بانتظار الإدارة — فوق النطاق")
    expect(text()).toContain(RIYAL)
    view.unmount()
    view = await open("manager", <HiringPage />, "/contractor/hr/hiring", "job=j2")
    expect(buttons()).not.toContain("اعتمد الوظيفة")
    expect(text()).toContain("وظيفة جديدة = تكلفة جديدة")
    view.unmount()
    // Exits without a replacement — a suggestion.
    view = await open("manager", <HiringPage />, "/contractor/hr/hiring")
    expect(text()).toContain("خروج بلا بديل")
    expect(buttons()).toContain("افتح شاغراً بديلاً")
    view.unmount()
  })

  it("government relations converts the accepted and moves the batch — without a riyal, without screening", async () => {
    let view = await open("gov", <HiringPage />, "/contractor/hr/hiring", "job=j1")
    expect(buttons()).toContain("حوّله إلى موظف")
    expect(buttons()).not.toContain("قابِل")
    expect(buttons()).not.toContain("شاغر جديد")
    expect(text()).not.toContain("نطاق الأساسي للمهنة")
    view.unmount()
    view = await open("gov", <HiringPage />, "/contractor/hr/hiring", "job=j3")
    expect(buttons()).toContain("سجّل الواصلين موظفين")
    expect(text()).toContain("تأشيرات صدرت ولم يصل أصحابها")
    view.unmount()
    view = await open("gov", <HiringPage />, "/contractor/hr/hiring", "seg=join")
    expect(text()).toContain("موظف new1")
    expect(buttons()).toContain("العقد موثّق في قوى")
    view.unmount()
  })

  it("management approves the position and the offer above the band; Today asks it for both", async () => {
    let view = await open("management", <HiringPage />, "/contractor/hr/hiring", "job=j2")
    expect(buttons()).toEqual(expect.arrayContaining(["اعتمد الوظيفة", "ارفض"]))
    view.unmount()
    view = await open("management", <HiringPage />, "/contractor/hr/hiring", "job=j1")
    expect(buttons()).toEqual(expect.arrayContaining(["اعتمد العرض", "أعده"]))
    expect(buttons()).not.toContain("قابِل")
    view.unmount()
    view = await open("management", <TodayPage />, "/contractor/hr")
    expect(text()).toContain("وظيفة جديدة للاعتماد")
    expect(text()).toContain("عرض فوق النطاق — مرشح c3")
    view.unmount()
  })

  it("with Hiring off, the tab and its rows are gone", async () => {
    seed(`hrSettings/${ORG}`, { organizationId: ORG, features: [], businessType: "contractor", defaultsAppliedFor: "contractor", establishment: {}, policies: {} })
    let view = await open("manager", <TodayPage />, "/contractor/hr")
    expect(railHas("التوظيف")).toBe(false)
    expect(text()).not.toContain("مرشحون ينتظرون خطوة منك")
    view.unmount()
    view = await open("manager", <HiringPage />, "/contractor/hr/hiring")
    expect(text()).toContain("ليس ضمن دورك")
    view.unmount()
    buildWorld()
  })
})
