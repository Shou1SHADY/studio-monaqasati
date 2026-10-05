/**
 * HR 1.0 — the growth tab (optional `perf` + `train`) rendered for real, as each role, in Arabic: who sees the tab
 * (HR manager, supervisor, management — labelled by the switches), a rater sees only the people his reviews name,
 * pay and raise figures only to pay roles and management (RL-03), the employee his own review once approved —
 * with «اطّلعت» — and his certificates; the HR manager's settings carry the raise policies.
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
// The attachments panel reads Storage through the real provider — not part of what is checked here.
jest.mock("@/components/hr/HrEmployeeFiles", () => ({ HrEmployeeFiles: () => null }))

import React from "react"
import { act, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import { todayDay } from "@/lib/hr/format"
import { cycleId, reviewId } from "@/lib/hr/performance"
import { addDays } from "@/lib/hr/statutory"
import GrowthPage from "@/app/[locale]/(contractor)/contractor/hr/perf/page"
import FilePage from "@/app/[locale]/(contractor)/contractor/hr/people/[id]/page"
import MePage from "@/app/[locale]/(contractor)/contractor/hr/me/page"
import SettingsPage from "@/app/[locale]/(contractor)/contractor/hr/settings/page"
import TodayPage from "@/app/[locale]/(contractor)/contractor/hr/page"

const mockRoute = { id: "" }
installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const TODAY = todayDay()
const d = (n: number) => addDays(TODAY, n)
type Role = "manager" | "gov" | "payroll" | "supervisor" | "management" | "employee"
const UID: Record<Role, string> = { manager: "hrm", gov: "gro", payroll: "po", supervisor: "sup", management: "mg", employee: "emp1" }
const PERM: Record<Role, string[]> = { manager: ["employees.manage"], gov: ["hr.gov"], payroll: ["hr.payroll"], supervisor: ["hr.supervisor"], management: ["hr.management"], employee: ["projects.view"] }
const RIYAL = "⃁"
const CYC = cycleId(ORG, d(-10))

const person = (id: string, over: Record<string, unknown>) => ({
  organizationId: ORG,
  names: { ar: `موظف ${id}`, en: `Employee ${id}` },
  nationality: "eg",
  gender: "m",
  trade: "mason",
  category: "labour",
  siteId: "s1",
  join: "2021-03-01",
  source: "local",
  contract: { type: "open" },
  probation: { end: "2021-05-29", decision: "confirmed" },
  status: "active",
  docs: { iqama: d(300), passport: d(700) },
  leaveTaken: 0,
  ...over,
})

const review = (eid: string, over: Record<string, unknown>) =>
  seed(`hrReviews/${reviewId(CYC, eid)}`, {
    organizationId: ORG,
    kind: "review",
    cycleId: CYC,
    employeeId: eid,
    employeeUserId: null,
    employeeName: `موظف ${eid}`,
    employeeNo: 1,
    trade: "mason",
    category: "labour",
    siteId: "s1",
    raterEmployeeId: "e_sup",
    raterUserId: "sup",
    raterName: "موظف e_sup",
    st: "draft",
    rec: { abs: 1, pen: 0, ot: 0, injury: false },
    ...over,
  })

function buildWorld() {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", email: "owner@test.sa" })
  for (const r of Object.keys(PERM) as Role[]) {
    seed(`teamGroups/g_${r}`, { organizationId: ORG, name: r, key: null, permissions: PERM[r] })
    seed(`users/${UID[r]}`, { organizationId: ORG, organizationRole: "member", defaultGroupId: `g_${r}`, name: `مستخدم ${r}`, email: `${UID[r]}@test.sa` })
  }
  seed(`hrSettings/${ORG}`, { organizationId: ORG, features: ["perf", "train"], businessType: "contractor", defaultsAppliedFor: "contractor", establishment: { name: "شركة البناء" }, policies: {} })
  seed("hrSites/s1", { organizationId: ORG, name: "برج الواحة", type: "project", projectId: "p1", active: true, supervisorUserId: "sup", supervisorEmployeeId: "e_sup" })
  seed("hrSites/s2", { organizationId: ORG, name: "مشروع الشاطئ", type: "project", projectId: "p2", active: true })
  seed("hrSites/hq", { organizationId: ORG, name: "المكتب الرئيسي", type: "hq", active: true })
  const people: Array<[string, Record<string, unknown>]> = [
    ["e_hrm", { no: 1, userId: "hrm", trade: "hrOfficer", nationality: "sa", category: "staff", siteId: "hq", docs: {} }],
    ["e_gro", { no: 2, userId: "gro", trade: "govRelations", nationality: "sa", category: "staff", siteId: "hq", docs: {} }],
    ["e_po", { no: 3, userId: "po", trade: "accountant", category: "staff", siteId: "hq" }],
    ["e_sup", { no: 4, userId: "sup", trade: "foreman", category: "staff", certs: { ind: d(200), hgt: d(200), fa: d(200) } }],
    ["e_mg", { no: 5, userId: "mg", trade: "siteEngineer", category: "staff", siteId: "hq" }],
    ["e_emp", { no: 6, userId: "emp1", trade: "carpenter", certs: { ind: d(-3) } }],
    ["w1", { no: 7, certs: { ind: d(40), hgt: d(400) }, trade: "steelFixer" }],
    ["w9", { no: 9, siteId: "s2" }],
  ]
  for (const [id, over] of people) {
    seed(`employees/${id}`, person(id, over))
    seed(`employeePay/${id}`, { organizationId: ORG, employeeId: id, basic: 4000, housing: 1000, transport: 400, iban: `SA4420000001234567891${over.no}` })
  }
  seed(`hrReviews/${CYC}`, { organizationId: ORG, kind: "cycle", open: d(-10), close: d(20), year: TODAY.slice(0, 4), raise: null, by: "hrm", byName: "مدير", at: "" })
  review("w1", { st: "draft", sc: { o: 3 } })
  // The employee's own review: approved — he sees it and acknowledges.
  review("e_emp", { employeeUserId: "emp1", st: "ok", sc: { o: 3 }, score: 4.8, band: "A", note: "عمل ممتاز", okBy: "hrm" })
  // Another site's worker, rated by management: the supervisor never sees it.
  review("w9", { siteId: "s2", raterEmployeeId: null, raterUserId: null, raterName: null, st: "done", sc: { o: 2 } })
  review("e_po", { category: "staff", trade: "accountant", siteId: "hq", raterEmployeeId: null, raterUserId: null, raterName: null, st: "draft" })
  seed("hrTraining/t1", { organizationId: ORG, kind: "session", course: "ind", at: d(5), siteId: "s1", seats: 15, ppl: ["e_emp"], names: { e_emp: "موظف e_emp" }, siteIds: ["s1"], state: "plan", by: "hrm", byName: null, createdAt: "" })
  seed("hrTraining/t2", { organizationId: ORG, kind: "session", course: "fa", at: d(-20), siteId: null, seats: 6, ppl: ["e_sup"], names: {}, siteIds: ["s1"], state: "done", abs: [], by: "hrm", byName: null, createdAt: "" })
  seed(`hrEvents/${ORG}__hr:TRN:t2`, { organizationId: ORG, key: "hr:TRN:t2", kind: "TRN", month: d(-20).slice(0, 7), session: "t2", course: "fa", at: d(-20), count: 1, amount: 280, lines: [], state: "sent" })
}

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
async function open(role: Role, node: () => React.ReactElement, path: string, search = "", id = "") {
  mockRoute.id = id
  setSignedIn(UID[role])
  setPathname(path, search)
  missingKeys.clear()
  const view = render(node())
  await flush()
  return view
}
const text = () => document.body.textContent ?? ""
const railLabels = () => Array.from(document.querySelectorAll("nav a")).map((a) => (a.textContent ?? "").trim().replace(/\d+$/, ""))
const buttons = () => Array.from(document.querySelectorAll("button, a")).map((b) => (b.textContent ?? "").trim())

beforeAll(() => buildWorld())

describe("the growth tab, as each role", () => {
  it.each(["manager", "supervisor", "management"] as Role[])("%s has «الأداء والتدريب» on the rail and the page opens with every key resolved", async (role) => {
    const view = await open(role, () => <GrowthPage />, "/contractor/hr/perf")
    expect([...missingKeys]).toEqual([])
    expect(railLabels()).toContain("الأداء والتدريب")
    expect(text()).not.toContain("ليس ضمن دورك")
    expect(text()).not.toMatch(/MISSING|undefined|NaN|Invalid Date/)
    view.unmount()
  })

  it.each(["gov", "payroll", "employee"] as Role[])("%s has no growth tab and is refused the page", async (role) => {
    const view = await open(role, () => <GrowthPage />, "/contractor/hr/perf")
    expect(railLabels()).not.toContain("الأداء والتدريب")
    if (role !== "employee") expect(text()).toContain("ليس ضمن دورك")
    view.unmount()
  })

  it("a rater sees only the people his reviews name — no figure in riyals", async () => {
    const view = await open("supervisor", () => <GrowthPage />, "/contractor/hr/perf")
    expect(text()).toContain("عمالي — درجة لكل عامل")
    expect(text()).toContain("موظف w1")
    expect(text()).not.toContain("موظف w9")
    expect(text()).not.toContain("المقيِّمون — المعايرة قبل الاعتماد")
    expect(buttons()).toContain("أرسل 1 للاعتماد")
    expect(text()).not.toContain(RIYAL)
    view.unmount()
  })

  it("the HR manager calibrates per rater and sees the raises in riyals; management sees the reviews it rates", async () => {
    let view = await open("manager", () => <GrowthPage />, "/contractor/hr/perf")
    expect(text()).toContain("المقيِّمون — المعايرة قبل الاعتماد")
    expect(text()).toContain("توزيع النتائج")
    expect(text()).toContain("زيادات التقييم شهرياً")
    expect(text()).toContain(RIYAL)
    expect(buttons()).toContain("أعدّ المقترح")
    view.unmount()
    view = await open("management", () => <GrowthPage />, "/contractor/hr/perf")
    expect(text()).toContain("فريقي من الكادر") // e_po's review names no rater — management's
    expect(text()).toContain("الإدارة")
    expect(buttons()).not.toContain("أعدّ المقترح")
    view.unmount()
  })

  it("training: the HR manager's gaps and sessions with the cost waiting on Finance; the supervisor's workers by name, no cost", async () => {
    let view = await open("manager", () => <GrowthPage />, "/contractor/hr/perf", "seg=train")
    expect([...missingKeys]).toEqual([])
    expect(text()).toContain("الفجوات — بالشهادة ومكان العمل")
    expect(text()).toContain("صرف التكلفة")
    expect(text()).toContain("على رأس العمل بلا شهادة سارية")
    expect(buttons()).toContain("جدول جلسة")
    view.unmount()
    view = await open("supervisor", () => <GrowthPage />, "/contractor/hr/perf", "seg=train")
    expect(text()).toContain("شهادات عمالي — بالاسم")
    expect(text()).toContain("موظف e_emp")
    expect(buttons()).not.toContain("جدول جلسة")
    expect(text()).not.toContain(RIYAL)
    view.unmount()
  })
})

describe("the file, My file, Today and settings", () => {
  it("the employee file: the performance card (band to the office) and the certificates with why they are required", async () => {
    let view = await open("manager", () => <FilePage />, "/contractor/hr/people/e_emp", "", "e_emp")
    expect(text()).toContain("الأداء")
    expect(text()).toContain("ممتاز")
    view.unmount()
    view = await open("manager", () => <FilePage />, "/contractor/hr/people/w1", "", "w1")
    const docs = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("الوثائق والشهادات"))
    await act(async () => void docs?.click())
    await flush()
    expect(text()).toContain("الشهادات والتدريب")
    expect(text()).toContain("كل من في موقع أو ورشة أو مستودع")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("My file: his approved review with «اطّلعت»; his certificates with the session he is booked on", async () => {
    const view = await open("employee", () => <MePage />, "/contractor/hr/me")
    expect(text()).toContain("تقييمي")
    expect(text()).toContain("ممتاز")
    expect(text()).toContain("عمل ممتاز")
    expect(buttons()).toContain("اطّلعت")
    const docs = Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("role") === "tab" && (b.textContent ?? "").includes("وثائقي"))
    await act(async () => void docs?.click())
    await flush()
    expect(text()).toContain("شهاداتي وتدريبي")
    expect(text()).toContain("شهادة منتهية أو ناقصة")
    expect(text()).toContain("أنت مسجَّل في جلسة")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("Today: the HR manager's reviews awaiting approval and certificates gap; the supervisor's team to rate", async () => {
    let view = await open("manager", () => <TodayPage />, "/contractor/hr")
    expect(text()).toContain("تقييماً بانتظار اعتمادك")
    expect(text()).toContain("على رأس العمل بلا شهادة سلامة سارية")
    expect([...missingKeys]).toEqual([])
    view.unmount()
    view = await open("supervisor", () => <TodayPage />, "/contractor/hr")
    expect(text()).toContain("قيّم فريقك")
    view.unmount()
  })

  it("settings: the review raises by band and the record weight, with performance on", async () => {
    const view = await open("manager", () => <SettingsPage />, "/contractor/hr/settings")
    expect(text()).toContain("نِسب زيادات التقييم")
    expect(text()).toContain("وزن السجل في نتيجة التقييم")
    expect(text()).toContain("الشهادات المطلوبة")
    view.unmount()
  })
})
