/**
 * HR 1.0 — the punch feature's screens rendered for real, per role, in Arabic
 * (optional: punch): the Attendance tab's exceptions and sources, the employee
 * file's «البصمة» and «الوردية», My day with the punch button, the sheet of a
 * shift workplace, Today's rows, the lateness and roster reports — and with the
 * feature off none of it shows. Same in-memory world as render-hr-roles.
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
import { installDomShims, missingKeys, pushed, setPathname, setSignedIn } from "@/test-utils/render-world"
import { todayDay } from "@/lib/hr/format"
import { addDays } from "@/lib/hr/statutory"
import TodayPage from "@/app/[locale]/(contractor)/contractor/hr/page"
import FilePage from "@/app/[locale]/(contractor)/contractor/hr/people/[id]/page"
import SitePage from "@/app/[locale]/(contractor)/contractor/hr/sites/[id]/page"
import AttendancePage from "@/app/[locale]/(contractor)/contractor/hr/attendance/page"
import ReportsPage from "@/app/[locale]/(contractor)/contractor/hr/reports/page"
import SettingsPage from "@/app/[locale]/(contractor)/contractor/hr/settings/page"
import MePage from "@/app/[locale]/(contractor)/contractor/hr/me/page"

const mockRoute = { id: "w1" }

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const TODAY = todayDay()
const d = (n: number) => addDays(TODAY, n)
// The last working day before today (not a Friday) — the exceptions are read on it.
const PREV = [1, 2, 3].map((n) => d(-n)).find((x) => new Date(`${x}T00:00:00Z`).getUTCDay() !== 5) as string
const MONTH = PREV.slice(0, 7)

type Role = "owner" | "manager" | "payroll" | "supervisor" | "management" | "gov" | "employee"
const UID: Record<Role, string> = { owner: ORG, manager: "hrm", gov: "gro", payroll: "po", supervisor: "sup", management: "mg", employee: "emp1" }
const PERM: Record<Exclude<Role, "owner">, string[]> = {
  manager: ["employees.manage"],
  gov: ["hr.gov"],
  payroll: ["hr.payroll"],
  supervisor: ["hr.supervisor"],
  management: ["hr.management"],
  employee: ["projects.view"],
}

const employee = (id: string, over: Record<string, unknown>) => ({
  organizationId: ORG,
  names: { ar: `موظف ${id}`, en: `Employee ${id}` },
  nationality: "eg",
  gender: "m",
  trade: "mason",
  category: "labour",
  siteId: "wh",
  join: "2021-03-01",
  source: "local",
  contract: { type: "open" },
  probation: { end: "2021-05-29", decision: "confirmed" },
  status: "active",
  docs: { iqama: d(300), passport: d(700) },
  leaveTaken: 5,
  ...over,
})

function buildWorld(features: string[]) {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البناء", email: "owner@test.sa" })
  for (const r of Object.keys(PERM) as Exclude<Role, "owner">[]) {
    seed(`teamGroups/g_${r}`, { organizationId: ORG, name: r, key: null, permissions: PERM[r] })
    seed(`users/${UID[r]}`, { organizationId: ORG, organizationRole: "member", defaultGroupId: `g_${r}`, name: `مستخدم ${r}`, email: `${UID[r]}@test.sa` })
  }
  seed(`hrSettings/${ORG}`, { organizationId: ORG, features, businessType: "contractor", defaultsAppliedFor: "contractor", establishment: { name: "شركة البناء" }, policies: {} })
  // A warehouse that punches by device and runs two shifts; the head office by the app, fence set.
  seed("hrSites/wh", {
    organizationId: ORG,
    name: "مستودع الرياض",
    type: "warehouse",
    active: true,
    supervisorUserId: "sup",
    att: { source: "device" },
    shifts: { on: true, list: [{ id: "m", in: "07:00", out: "15:00" }, { id: "e", in: "15:00", out: "23:00" }] },
  })
  seed("hrSites/hq", { organizationId: ORG, name: "المكتب الرئيسي", type: "hq", active: true, att: { source: "app", geo: { lat: 24.7, lng: 46.7, r: 150 } } })
  const people: Array<[string, Record<string, unknown>]> = [
    ["e_hrm", { no: 1, userId: "hrm", trade: "hrOfficer", nationality: "sa", siteId: "hq" }],
    ["e_po", { no: 3, userId: "po", trade: "accountant", siteId: "hq" }],
    ["e_sup", { no: 4, userId: "sup", trade: "foreman" }],
    ["e_mg", { no: 5, userId: "mg", trade: "siteEngineer", siteId: "hq" }],
    ["e_emp", { no: 6, userId: "emp1", siteId: "hq" }],
    ["w1", { no: 7, shift: { id: "e", from: "2026-01-01" } }],
    ["w2", { no: 8 }],
  ]
  for (const [id, over] of people) {
    seed(`employees/${id}`, employee(id, over))
    seed(`employeePay/${id}`, { organizationId: ORG, employeeId: id, basic: 4000, housing: 1000, transport: 400 })
  }
  // The device file of PREV: w2 late and still in at 17:30 after a morning shift (overtime); w1 no punch.
  seed(`hrAttendance/${ORG}__wh__${MONTH}`, {
    organizationId: ORG,
    siteId: "wh",
    month: MONTH,
    days: {},
    declarations: [],
    closed: null,
    pd: { [PREV]: { w2: { in: "07:40", out: "17:30", src: "dev" }, e_sup: { in: "06:58", out: "15:02", src: "dev" } } },
    imports: [{ by: "po", byName: null, at: `${d(-4)}T08:00:00Z`, rows: 3, saved: 2, dup: 0, dawn: 0, unknown: ["9901"], days: [PREV] }],
  })
  // An employee's correction request with his supervisor.
  seed("hrRequests/q1", {
    organizationId: ORG,
    no: "AQ-2026/001",
    kind: "attfix",
    employeeId: "w1",
    employeeName: "موظف w1",
    siteId: "wh",
    lineManagerUserId: "sup",
    deciderLevel: "manager",
    state: "pending",
    attfix: { type: "miss", day: PREV, reason: "نسيت" },
    createdAt: `${TODAY}T07:00:00Z`,
  })
}

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

type Screen = { path: string; id?: string; node: () => React.ReactElement }
const SCREENS: Record<string, Screen> = {
  today: { path: "/contractor/hr", node: () => <TodayPage /> },
  attendance: { path: "/contractor/hr/attendance", node: () => <AttendancePage /> },
  file: { path: "/contractor/hr/people/w1", id: "w1", node: () => <FilePage /> },
  site: { path: "/contractor/hr/sites/wh", id: "wh", node: () => <SitePage /> },
  reports: { path: "/contractor/hr/reports", node: () => <ReportsPage /> },
  settings: { path: "/contractor/hr/settings", node: () => <SettingsPage /> },
  me: { path: "/contractor/hr/me", node: () => <MePage /> },
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

describe("punch on — every screen, every role, every key resolved", () => {
  beforeAll(() => buildWorld(["punch"]))
  const ROLES: Role[] = ["owner", "manager", "payroll", "supervisor", "management", "gov", "employee"]
  it.each(ROLES.flatMap((r) => Object.keys(SCREENS).map((s) => [r, s] as const)))("%s · %s", async (role, name) => {
    const view = await openAs(role, name)
    expect({ role, name, missing: [...missingKeys] }).toEqual({ role, name, missing: [] })
    expect(text()).not.toMatch(/MISSING|undefined|NaN|Invalid Date/)
    view.unmount()
  })
})

describe("punch on — what each role sees and may do", () => {
  beforeAll(() => buildWorld(["punch"]))

  it("the Attendance tab: exceptions grouped, the correction request, each workplace's source with its actions (HR manager)", async () => {
    const view = await openAs("manager", "attendance")
    for (const x of ["استثناءات البصمة", "النظام يقترح والإنسان يقرّر", "لم يسجّل حضوره", "تأخير", "إضافي ينتظر اعتماداً", "طلبات تصحيح من الموظفين", "موظف w1 — نسيت البصمة", "مصدر الحضور لكل مكان عمل", "جهاز بصمة — يُستورد ملفه", "تطبيق الموظف بسياج جغرافي", "صباحية/مسائية", "نطاق 150 م", "1 أرقام مجهولة", "استثناءات تنتظر قراراً"])
      expect({ x, shown: text().includes(x) }).toEqual({ x, shown: true })
    for (const b of ["استئذان", "غائب", "سجّل مخالفة", "ليس إضافياً", "اعتمد", "اقبل", "ارفض", "استورد ملف الجهاز", "الورديات", "غيّر"]) expect({ b, offered: buttons().includes(b) }).toEqual({ b, offered: true })
    // Form am opens with the three sources.
    fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "غيّر") as Element)
    await flush()
    expect(text()).toContain("أيّاً كان المصدر، فالنتيجة حالة اليوم نفسها التي يقرؤها المسير")
    expect(text()).toContain("كشف المشرف")
    view.unmount()
  })

  it("payroll decides punch exceptions and imports files, but neither records a violation nor changes a source", async () => {
    const view = await openAs("payroll", "attendance")
    expect(buttons()).toContain("استورد ملف الجهاز")
    expect(buttons()).toContain("استئذان")
    expect(buttons()).not.toContain("سجّل مخالفة")
    expect(buttons()).not.toContain("الورديات")
    view.unmount()
  })

  it("management reads the tab without a single decision button", async () => {
    const view = await openAs("management", "attendance")
    expect(text()).toContain("استثناءات البصمة")
    for (const b of ["استئذان", "غائب", "اعتمد", "استورد ملف الجهاز", "غيّر"]) expect({ b, offered: buttons().includes(b) }).toEqual({ b, offered: false })
    view.unmount()
  })

  it("Today: the HR manager is asked to decide the exceptions; payroll about the overtime before closing", async () => {
    let view = await openAs("manager", "today")
    expect(text()).toContain("استثناءات البصمة —")
    view.unmount()
    view = await openAs("payroll", "today")
    expect(text()).toContain("إضافي وخروج ناقص من البصمة")
    expect(text()).toContain("ملف بصمة مستودع الرياض لم يُستورد منذ")
    view.unmount()
  })

  it("the employee file: «البصمة» with the evening shift, and «الوردية» for the HR manager and the workplace's supervisor — not payroll", async () => {
    const sectionShown = async (role: Role) => {
      const view = await openAs(role, "file")
      const seg = Array.from(document.querySelectorAll("[role=tablist] button")).find((b) => (b.textContent ?? "").startsWith("الحضور والإجازات"))
      if (seg) fireEvent.click(seg)
      await flush()
      const out = { role, punches: text().includes("مرات التأخير هذا الشهر"), evening: text().includes("مسائية"), shift: buttons().includes("الوردية") }
      view.unmount()
      return out
    }
    expect(await sectionShown("manager")).toEqual({ role: "manager", punches: true, evening: true, shift: true })
    expect(await sectionShown("supervisor")).toEqual({ role: "supervisor", punches: true, evening: true, shift: true })
    expect(await sectionShown("payroll")).toEqual({ role: "payroll", punches: true, evening: true, shift: false })
  })

  it("the sheet of a shift workplace: chips per shift, the second-shift toggle, and where its days come from", async () => {
    const view = await openAs("supervisor", "site")
    expect(text()).toContain("حضور هذا المكان من: جهاز بصمة — يُستورد ملفه")
    expect(text()).toContain("صباحية 07:00–15:00")
    expect(text()).toContain("مسائية 15:00–23:00")
    expect(buttons()).toContain("وردية ثانية")
    view.unmount()
  })

  it("My day: «الدوام», the source, and the punch button with its location note on an app workplace", async () => {
    const view = await openAs("employee", "me")
    for (const x of ["الدوام", "08:00–17:00", "تطبيق الموظف بسياج جغرافي", "بصمة اليوم", "لم تسجّل بعد", "يُقرأ موقعك لحظة البصمة فقط"]) expect({ x, shown: text().includes(x) }).toEqual({ x, shown: true })
    expect(buttons()).toContain("سجّل حضوري")
    // The consent comes first, before any location is read.
    fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "سجّل حضوري") as Element)
    await flush()
    expect(text()).toContain("موقعك — لحظة البصمة فقط")
    expect(buttons()).toContain("أوافق — اقرأ موقعي الآن")
    view.unmount()
  })

  it("the reports: lateness and the shift roster join; settings no longer call punch a later release", async () => {
    let view = await openAs("manager", "reports")
    expect(text()).toContain("التأخير واستثناءات البصمة")
    expect(text()).toContain("جدول الورديات")
    view.unmount()
    view = await openAs("manager", "settings")
    const row = Array.from(document.querySelectorAll("li, label, div")).map((x) => x.textContent ?? "").find((x) => x.includes("البصمة") && x.length < 300) ?? ""
    expect(row).not.toContain("إصدار لاحق")
    view.unmount()
  })
})

describe("punch off — nothing of it shows; the core sheet works as before", () => {
  beforeAll(() => buildWorld([]))

  it("no exceptions, no sources, no punch box, no shift chips, no lateness report", async () => {
    let view = await openAs("manager", "attendance")
    expect(text()).not.toContain("استثناءات البصمة")
    expect(text()).not.toContain("مصدر الحضور لكل مكان عمل")
    view.unmount()
    view = await openAs("employee", "me")
    expect(buttons()).not.toContain("سجّل حضوري")
    expect(text()).not.toContain("بصمة اليوم")
    view.unmount()
    view = await openAs("supervisor", "site")
    expect(buttons()).not.toContain("وردية ثانية")
    expect(text()).not.toContain("حضور هذا المكان من")
    view.unmount()
    view = await openAs("manager", "reports")
    expect(text()).not.toContain("جدول الورديات")
    view.unmount()
    view = await openAs("manager", "file")
    expect(buttons()).not.toContain("الوردية")
    view.unmount()
  })
})
