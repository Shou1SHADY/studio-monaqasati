/**
 * HR 1.0 — every screen rendered for real, as each role, in Arabic (AC-12,
 * qa_sweep / qa_guards): a stand-in for clicking through HR before anyone signs
 * in on UAT. The pages mount over the in-memory Firestore with a small company:
 * two workplaces, one person per role ON the record (each staff user is also an
 * employee — README "My file for every employee"), workers on the site (one
 * with an expired iqama), a pending leave of the HR manager's own and one of a
 * worker, and an earlier payroll.
 *
 * Roles, as the PRD's matrix: HR manager (`employees.manage`), government
 * relations (`hr.gov`), payroll (`hr.payroll`), the site supervisor
 * (`hr.supervisor`), management (`hr.management`), a plain employee — and the
 * owner, who is HR manager and management. Each render must not throw, must
 * resolve every message key, must show exactly the rail the prototype's TABS()
 * gives that role, and never a riyal amount where RL-03 hides pay.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => {
  const nav = jest.requireActual("@/test-utils/render-world").navigationMock
  return { ...nav, useParams: () => ({ id: mockRoute.id, locale: "ar" }) }
})
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

import React from "react"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, pushed, queriesRun, setPathname, setSignedIn } from "@/test-utils/render-world"
import { todayDay } from "@/lib/hr/format"
import { addDays } from "@/lib/hr/statutory"
import TodayPage from "@/app/[locale]/(contractor)/contractor/hr/page"
import PeoplePage from "@/app/[locale]/(contractor)/contractor/hr/people/page"
import FilePage from "@/app/[locale]/(contractor)/contractor/hr/people/[id]/page"
import SitesPage from "@/app/[locale]/(contractor)/contractor/hr/sites/page"
import SitePage from "@/app/[locale]/(contractor)/contractor/hr/sites/[id]/page"
import AttendancePage from "@/app/[locale]/(contractor)/contractor/hr/attendance/page"
import PayrollPage from "@/app/[locale]/(contractor)/contractor/hr/payroll/page"
import ReportsPage from "@/app/[locale]/(contractor)/contractor/hr/reports/page"
import SettingsPage from "@/app/[locale]/(contractor)/contractor/hr/settings/page"
import MePage from "@/app/[locale]/(contractor)/contractor/hr/me/page"

const mockRoute = { id: "w1" }

installDomShims()
jest.setTimeout(60_000)

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

const ORG = "own"
const TODAY = todayDay()
const d = (n: number) => addDays(TODAY, n)
const lastMonth = addDays(`${TODAY.slice(0, 7)}-01`, -1).slice(0, 7)
const olderMonth = addDays(`${lastMonth}-01`, -1).slice(0, 7)

type Role = "owner" | "manager" | "gov" | "payroll" | "supervisor" | "management" | "employee"
const ROLES: Role[] = ["owner", "manager", "gov", "payroll", "supervisor", "management", "employee"]
const UID: Record<Role, string> = { owner: ORG, manager: "hrm", gov: "gro", payroll: "po", supervisor: "sup", management: "mg", employee: "emp1" }
const PERM: Record<Exclude<Role, "owner">, string[]> = {
  manager: ["employees.manage"],
  gov: ["hr.gov"],
  payroll: ["hr.payroll"],
  supervisor: ["hr.supervisor"],
  management: ["hr.management"],
  employee: ["projects.view"],
}
const RIYAL = "⃁"

const employee = (id: string, over: Record<string, unknown>) => ({
  organizationId: ORG,
  names: { ar: `موظف ${id}`, en: `Employee ${id}` },
  nationality: "eg",
  gender: "m",
  idNo: `2${id.length}00000000`,
  trade: "mason",
  category: "labour",
  siteId: "s1",
  join: "2021-03-01",
  source: "local",
  contract: { type: "open" },
  probation: { end: "2021-05-29", decision: "confirmed" },
  status: "active",
  docs: { iqama: d(300), passport: d(700) },
  leaveTaken: 5,
  ...over,
})

function buildWorld() {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البناء", email: "owner@test.sa" })
  for (const r of Object.keys(PERM) as Exclude<Role, "owner">[]) {
    seed(`teamGroups/g_${r}`, { organizationId: ORG, name: r, key: null, permissions: PERM[r] })
    seed(`users/${UID[r]}`, { organizationId: ORG, organizationRole: "member", defaultGroupId: `g_${r}`, name: `مستخدم ${r}`, email: `${UID[r]}@test.sa` })
  }
  seed(`hrSettings/${ORG}`, { organizationId: ORG, features: [], businessType: "contractor", defaultsAppliedFor: "contractor", establishment: { name: "شركة البناء", cr: "1010101010" }, policies: {} })
  seed("hrSites/s1", { organizationId: ORG, name: "برج الواحة", type: "project", projectId: "p1", active: true, supervisorUserId: "sup", supervisorEmployeeId: "e_sup", endDate: d(30) })
  seed("hrSites/hq", { organizationId: ORG, name: "المكتب الرئيسي", type: "hq", active: true })
  const people: Array<[string, Record<string, unknown>]> = [
    ["e_hrm", { no: 1, userId: "hrm", trade: "hrOfficer", nationality: "sa", siteId: "hq", docs: {} }],
    ["e_gro", { no: 2, userId: "gro", trade: "govRelations", nationality: "sa", siteId: "hq", docs: {} }],
    ["e_po", { no: 3, userId: "po", trade: "accountant", siteId: "hq" }],
    ["e_sup", { no: 4, userId: "sup", trade: "foreman" }],
    ["e_mg", { no: 5, userId: "mg", trade: "siteEngineer", siteId: "hq" }],
    ["e_emp", { no: 6, userId: "emp1" }],
    ["w1", { no: 7, docs: { iqama: d(-5), passport: d(20) } }],
    ["w2", { no: 8, siteId: null }],
  ]
  for (const [id, over] of people) {
    seed(`employees/${id}`, employee(id, over))
    seed(`employeePay/${id}`, { organizationId: ORG, employeeId: id, basic: 4000 + 100 * (over.no as number), housing: 1000, transport: 400, iban: `SA44200000012345678912${over.no}` })
  }
  const leave = (id: string, emp: string, userId: string, siteId: string, over: Record<string, unknown> = {}) =>
    seed(`hrRequests/${id}`, {
      organizationId: ORG,
      no: `LV-2026/00${id.slice(-1)}`,
      kind: "leave",
      employeeId: emp,
      employeeUserId: userId,
      employeeName: `موظف ${emp}`,
      siteId,
      lineManagerId: null,
      lineManagerUserId: null,
      deciderLevel: "manager",
      filedBy: { by: userId, byName: null, at: `${TODAY}T08:00:00Z` },
      onBehalf: false,
      state: "pending",
      leave: { type: "annual", from: d(10), to: d(12), days: 3, balance: 60, fromBalance: 3, unpaidDays: 0, travel: false },
      createdAt: `${TODAY}T08:00:00Z`,
      ...over,
    })
  // Projects asks for two masons on the tower from today (WF-12).
  seed("manpowerRequests/mr1", { organizationId: ORG, no: "MP-2026/007", projectId: "p1", projectName: "برج الواحة", siteId: "s1", trade: "mason", count: 2, from: TODAY, state: "open", requested: { by: "pmu", byName: "مدير المشروع", at: `${TODAY}T07:00:00Z` }, answer: null })
  // The HR manager's own leave goes to management (LV-05) — he never decides it.
  leave("q1", "e_hrm", "hrm", "hq", { deciderLevel: "management" })
  // A worker's leave: the site's supervisor endorses it, the HR manager decides.
  leave("q2", "e_emp", "emp1", "s1", { lineManagerId: "e_sup", lineManagerUserId: "sup" })
  seed(`hrPayrolls/${ORG}__${olderMonth}`, {
    organizationId: ORG,
    month: olderMonth,
    key: olderMonth,
    kind: "main",
    state: "paid",
    prepared: { by: "po", byName: null, at: "" },
    lines: [
      { employeeId: "e_sup", siteId: "s1", costKind: "direct", gross: 6000, net: 5400, gosiEmployer: 120, eosAccrual: 250 },
      { employeeId: "e_hrm", siteId: "hq", costKind: "admin", gross: 7000, net: 6300, gosiEmployer: 830, eosAccrual: 290 },
    ],
  })
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

type Screen = { path: string; id?: string; node: () => React.ReactElement; tab: string }
const SCREENS: Record<string, Screen> = {
  today: { path: "/contractor/hr", tab: "today", node: () => <TodayPage /> },
  people: { path: "/contractor/hr/people", tab: "people", node: () => <PeoplePage /> },
  file: { path: "/contractor/hr/people/w1", id: "w1", tab: "people", node: () => <FilePage /> },
  ownFile: { path: "/contractor/hr/people/e_hrm", id: "e_hrm", tab: "people", node: () => <FilePage /> },
  sites: { path: "/contractor/hr/sites", tab: "sites", node: () => <SitesPage /> },
  site: { path: "/contractor/hr/sites/s1", id: "s1", tab: "sites", node: () => <SitePage /> },
  bench: { path: "/contractor/hr/sites/__bench__", id: "__bench__", tab: "sites", node: () => <SitePage /> },
  attendance: { path: "/contractor/hr/attendance", tab: "attendance", node: () => <AttendancePage /> },
  payroll: { path: "/contractor/hr/payroll", tab: "payroll", node: () => <PayrollPage /> },
  reports: { path: "/contractor/hr/reports", tab: "reports", node: () => <ReportsPage /> },
  settings: { path: "/contractor/hr/settings", tab: "settings", node: () => <SettingsPage /> },
  me: { path: "/contractor/hr/me", tab: "me", node: () => <MePage /> },
}

async function openAs(role: Role, name: string) {
  const s = SCREENS[name]
  mockRoute.id = s.id ?? ""
  setSignedIn(UID[role])
  setPathname(s.path)
  missingKeys.clear()
  pushed.length = 0
  const view = render(s.node())
  await flush()
  return view
}

const text = () => document.body.textContent ?? ""
const buttons = () => Array.from(document.querySelectorAll("button, a")).map((b) => (b.textContent ?? "").trim())
const railLabels = () => Array.from(document.querySelectorAll("nav a")).map((a) => (a.textContent ?? "").trim().replace(/\d+$/, ""))

// The prototype's TABS(): only the BUILT tabs (attendance, hiring, platforms and
// performance are optional features, off in this company).
// The workplaces tab carries the company's word (ST-06): a contractor's «المواقع». Attendance is core.
const TAB_AR: Record<string, string> = { today: "اليوم", people: "الموظفون", sites: "المواقع", attendance: "الحضور", payroll: "الرواتب", reports: "التقارير", settings: "الإعدادات", me: "ملفي" }
const RAIL: Record<Role, string[]> = {
  owner: ["today", "people", "sites", "attendance", "payroll", "reports", "settings"],
  manager: ["today", "people", "sites", "attendance", "payroll", "reports", "settings", "me"],
  gov: ["today", "people", "reports", "me"],
  payroll: ["today", "people", "sites", "attendance", "payroll", "reports", "me"],
  supervisor: ["today", "sites", "me"],
  management: ["today", "people", "sites", "attendance", "payroll", "reports", "me"],
  employee: ["me"],
}
/** RL-03 — no riyal figure reaches these, outside their own file. */
const NO_PAY: Role[] = ["gov", "supervisor", "employee"]

beforeAll(() => buildWorld())

describe.each(ROLES)("as %s", (role) => {
  it.each(Object.keys(SCREENS))("%s renders with every key resolved, the role's rail, and pay only where RL-03 allows", async (name) => {
    const s = SCREENS[name]
    const view = await openAs(role, name)
    expect({ name, role, missing: [...missingKeys] }).toEqual({ name, role, missing: [] })
    expect(text()).not.toMatch(/MISSING|undefined|NaN|Invalid Date/)
    const offered = RAIL[role].includes(s.tab)
    if (role !== "employee" || name === "me") {
      const rail = railLabels()
      // The rail shows when there is more than one tab (ModuleHeader).
      if (RAIL[role].length > 1) expect({ name, role, rail: Object.keys(TAB_AR).filter((k) => rail.includes(TAB_AR[k])) }).toEqual({ name, role, rail: RAIL[role] })
    }
    if (name === "today" && !offered) expect(pushed).toContain("/contractor/hr/me")
    else expect({ name, role, refused: text().includes("ليس ضمن دورك") }).toEqual({ name, role, refused: !offered })
    if (NO_PAY.includes(role) && name !== "me") expect({ name, role, riyal: text().includes(RIYAL) }).toEqual({ name, role, riyal: false })
    view.unmount()
  })
})

describe("what each role sees and may do (the PRD's matrix, qa_guards)", () => {
  it("Today: three KPIs per role, the HR manager's figures in riyals, government relations' renewal queue by person", async () => {
    let view = await openAs("manager", "today")
    expect(text()).toContain("على رأس العمل اليوم")
    expect(text()).toContain("الرواتب — آخر شهر")
    expect(text()).toContain(RIYAL)
    expect(text()).toContain("أماكن العمل اليوم")
    expect(text()).toContain("مواقع تنتهي قريباً")
    view.unmount()
    view = await openAs("gov", "today")
    expect(text()).toContain("إقامات منتهية الآن")
    expect(text()).toContain("التجديد بالترتيب")
    // DC-04 — w1's passport and iqama are ONE trip, in order.
    expect(text()).toContain("معاملة واحدة بالترتيب: جواز السفر ← الإقامة")
    view.unmount()
    view = await openAs("supervisor", "today")
    expect(text()).toContain("عمالي اليوم")
    expect(text()).not.toContain("التجديد بالترتيب")
    view.unmount()
    view = await openAs("management", "today")
    expect(text()).toContain("إقامات منتهية على المواقع")
    view.unmount()
  })

  it("nobody approves his own request: the HR manager's leave is management's to decide; the worker's is the supervisor's to endorse", async () => {
    const decide = async (role: Role) => {
      const view = await openAs(role, "today")
      const out = { role, approve: buttons().filter((b) => b === "اعتماد").length, endorse: buttons().includes("توصية") }
      view.unmount()
      return out
    }
    expect(await decide("manager")).toEqual({ role: "manager", approve: 1, endorse: false }) // the worker's only
    expect(await decide("management")).toEqual({ role: "management", approve: 1, endorse: false }) // the HR manager's
    expect(await decide("supervisor")).toEqual({ role: "supervisor", approve: 0, endorse: true })
    expect(await decide("gov")).toEqual({ role: "gov", approve: 0, endorse: false })
  })

  it("the employee file: four tiles and five segments for pay roles; government relations reads ••• and has no pay segment", async () => {
    let view = await openAs("manager", "file")
    for (const x of ["رصيد الإجازة", "الأجر والتكلفة", "أقرب وثيقة", "حضور", "نظرة عامة", "الوثائق والشهادات", "الحضور والإجازات", "الأجر والمسير", "الطلبات والسجل"]) expect({ x, shown: text().includes(x) }).toEqual({ x, shown: true })
    expect(text()).toContain("تكلفة الشركة")
    view.unmount()
    view = await openAs("gov", "file")
    expect(text()).toContain("•••")
    expect(text()).toContain("مخفي لدورك")
    expect(text()).not.toContain("الأجر والمسير")
    expect(buttons()).toContain("تسجيل تجديد")
    expect(buttons()).not.toContain("تعديل الأجر")
    view.unmount()
  })

  it("on his own file the HR manager changes no pay, decides no probation and starts no exit of his own", async () => {
    const view = await openAs("manager", "ownFile")
    expect(buttons()).not.toContain("تعديل الأجر")
    expect(buttons()).not.toContain("إنهاء الخدمة")
    expect(buttons()).not.toContain("ربط مستخدم")
    view.unmount()
  })

  it("the supervisor records an injury or a violation from his own site's page (DC-07, PN-01)", async () => {
    let view = await openAs("supervisor", "site")
    expect(text()).toContain("عمال هذا المكان")
    expect(buttons()).toContain("إصابة عمل")
    expect(buttons()).toContain("مخالفة")
    view.unmount()
    view = await openAs("management", "site")
    expect(buttons()).not.toContain("إصابة عمل")
    view.unmount()
  })

  it("reports: money ones for pay roles only; turnover for the HR manager and management", async () => {
    const seen = async (role: Role) => {
      const view = await openAs(role, "reports")
      const out = { role, register: text().includes("كشف الموظفين"), eos: text().includes("مخصص نهاية الخدمة"), turnover: text().includes("دوران العمالة"), mudad: text().includes("ملف حماية الأجور") }
      view.unmount()
      return out
    }
    expect(await seen("manager")).toEqual({ role: "manager", register: true, eos: true, turnover: true, mudad: true })
    expect(await seen("payroll")).toEqual({ role: "payroll", register: true, eos: true, turnover: false, mudad: true })
    expect(await seen("gov")).toEqual({ role: "gov", register: true, eos: false, turnover: false, mudad: false })
    expect(await seen("management")).toEqual({ role: "management", register: true, eos: true, turnover: true, mudad: true })
  })

  it("My file for every staff user on the record: his own card, his own pay — never the request actions on himself", async () => {
    for (const role of ["manager", "gov", "payroll", "supervisor", "management", "employee"] as Role[]) {
      const view = await openAs(role, "me")
      expect({ role, card: text().includes(`موظف e_`) }).toEqual({ role, card: true })
      expect({ role, approve: buttons().includes("اعتماد") }).toEqual({ role, approve: false })
      view.unmount()
    }
  })
})

describe("a supervisor asks only what the rules let him ask (RL-01, §3 #18)", () => {
  // A list query the rules cannot prove is refused WHOLE — the screen breaks. For the supervisor of s1, each
  // collection the rules scope by workplace must be asked by his workplace (or about himself).
  type Q = (typeof queriesRun)[number]
  const eq = (q: Q, field: string) => (q.constraints ?? []).filter((c) => c.type === "where" && c.op === "==" && c.field === field).map((c) => c.value)
  const mine = (q: Q, field: string) => eq(q, field).includes("sup")
  const hisSite = (q: Q) => eq(q, "siteId").length > 0 && eq(q, "siteId").every((s) => s === "s1")
  const PROVABLE: Record<string, (q: Q) => boolean> = {
    employees: (q) => mine(q, "userId") || hisSite(q),
    hrInjuries: (q) => mine(q, "employeeUserId") || hisSite(q),
    hrAssignFixes: hisSite,
    hrRequests: (q) => mine(q, "employeeUserId") || (eq(q, "kind").includes("leave") && hisSite(q)),
    hrViolations: (q) => mine(q, "employeeUserId"),
    hrAttendance: () => false,
  }

  it.each(Object.keys(SCREENS))("%s", async (name) => {
    queriesRun.length = 0
    const view = await openAs("supervisor", name)
    const asked = queriesRun.filter((q) => q.path in PROVABLE)
    for (const q of asked) expect({ name, path: q.path, where: q.constraints, provable: PROVABLE[q.path](q) }).toEqual({ name, path: q.path, where: q.constraints, provable: true })
    view.unmount()
  })

  it("…and his own site's page does ask: its people, injuries and corrections, by his workplace", async () => {
    queriesRun.length = 0
    const view = await openAs("supervisor", "site")
    for (const c of ["employees", "hrInjuries", "hrAssignFixes"]) expect({ c, asked: queriesRun.some((q) => q.path === c && hisSite(q)) }).toEqual({ c, asked: true })
    expect(text()).toContain("موظف e_emp")
    view.unmount()
  })
})

describe("sites, the site page, the unassigned and the Attendance tab (§5 Sites, AT-03/04, AS-02)", () => {
  it("the Sites strip: the company's word, each place with present today, the unassigned with their monthly cost for pay roles", async () => {
    let view = await openAs("manager", "sites")
    expect(text()).toContain("الكل — المواقع")
    expect(text()).toContain("برج الواحة")
    expect(text()).toMatch(/بلا تسجيل اليوم|\d+\/\d+ حاضر/)
    expect(text()).toContain("1 إقامة منتهية")
    expect(text()).toContain(RIYAL)
    view.unmount()
    view = await openAs("supervisor", "sites")
    expect(text()).not.toContain("الكل — المواقع")
    view.unmount()
  })

  it("the site page: assigned · present today · the month, the ending warning, today and documents per person, Move, by trade", async () => {
    const view = await openAs("manager", "site")
    for (const x of ["المسندون", "حاضر اليوم", "حضور", "ينتهي خلال", "بالمهنة", "إقامة منتهية"]) expect({ x, shown: text().includes(x) }).toEqual({ x, shown: true })
    expect(buttons()).toContain("انقل")
    view.unmount()
  })

  it("the unassigned page: who, since when, their documents and Assign — the cost to pay roles only", async () => {
    let view = await openAs("manager", "bench")
    expect(text()).toContain("موظف w2")
    expect(buttons()).toContain("أسند")
    expect(text()).toContain("أجورهم")
    view.unmount()
    view = await openAs("supervisor", "bench")
    expect(text()).not.toContain("أجورهم")
    expect(text()).not.toContain(RIYAL)
    view.unmount()
  })

  it("the Attendance tab: present today, unrecorded days, last month's closing place by place with the declaration", async () => {
    const view = await openAs("manager", "attendance")
    expect(text()).toContain("حاضرون اليوم")
    expect(text()).toContain("أيام بلا تسجيل")
    expect(text()).toContain(`إقفال حضور ${lastMonth}`)
    expect(buttons()).toContain("سجّل الأيام الناقصة")
    fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "سجّل الأيام الناقصة")!)
    await flush()
    expect(text()).toContain("أقرّ أن هؤلاء كانوا على رأس العمل في هذه الأيام")
    expect(text()).toContain("أيام-عامل ستُسجَّل حضوراً")
    view.unmount()
  })

  it("a manpower request: the possible coverage before answering, then the two-step answer", async () => {
    const view = await openAs("manager", "sites")
    expect(text()).toContain("بانتظار ردّنا")
    expect(text()).toContain("التغطية الممكنة")
    fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "الرد بالخطة")!)
    await flush()
    for (const x of ["التغطية", "في الموعد", "بلا تغطية", "مستبعدون", "كيف يُغطّى الباقي"]) expect({ x, shown: text().includes(x) }).toEqual({ x, shown: true })
    view.unmount()
  })

  it("a recorded day is locked on the sheet: no save, the lock said (WF-04)", async () => {
    seed(`hrAttendance/${ORG}__s1__${TODAY.slice(0, 7)}`, { organizationId: ORG, siteId: "s1", month: TODAY.slice(0, 7), days: { [TODAY]: { by: "sup", byName: "المشرف", at: `${TODAY}T06:00:00Z`, listed: ["e_sup", "e_emp", "w1"], ex: {}, unlisted: [{ name: "سعيد", note: "من موقع آخر" }] } }, declarations: [], closed: null })
    const view = await openAs("supervisor", "site")
    expect(text()).toContain("هذا اليوم مسجَّل ومقفل")
    expect(buttons()).not.toContain("حفظ الكشف")
    // The sheet's "working here but not listed" is read back, not lost.
    expect(text()).toContain("سعيد")
    view.unmount()
  })
})
