/**
 * HR — the government platforms tab, the pre-Mudad check and their Today rows rendered for real, per role, in
 * Arabic (package F2; optional features `gov` and `mudad` ON). The Platforms tab is government relations' —
 * the HR manager's only when nobody holds that role, never payroll's or management's (the prototype's TABS);
 * government relations never sees a riyal there, and a wage reconciliation tells him so; payroll sees the
 * pre-Mudad check on the payroll.
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
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import { todayDay } from "@/lib/hr/format"
import { addDays } from "@/lib/hr/statutory"
import TodayPage from "@/app/[locale]/(contractor)/contractor/hr/page"
import PayrollPage from "@/app/[locale]/(contractor)/contractor/hr/payroll/page"
import PlatformsPage from "@/app/[locale]/(contractor)/contractor/hr/platforms/page"
import SettingsPage from "@/app/[locale]/(contractor)/contractor/hr/settings/page"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const TODAY = todayDay()
const d = (n: number) => addDays(TODAY, n)
const lastMonth = addDays(`${TODAY.slice(0, 7)}-01`, -1).slice(0, 7)
const RIYAL = "⃁"

type Role = "manager" | "gov" | "payroll" | "management"
const UID: Record<Role, string> = { manager: "hrm", gov: "gro", payroll: "po", management: "mg" }
const PERM: Record<Role, string> = { manager: "employees.manage", gov: "hr.gov", payroll: "hr.payroll", management: "hr.management" }

function buildWorld({ govHeld }: { govHeld: boolean }) {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", email: "owner@test.sa" })
  for (const r of Object.keys(PERM) as Role[]) {
    if (r === "gov" && !govHeld) continue
    seed(`teamGroups/g_${r}`, { organizationId: ORG, name: r, key: null, permissions: [PERM[r]] })
    seed(`users/${UID[r]}`, { organizationId: ORG, organizationRole: "member", defaultGroupId: `g_${r}`, name: `مستخدم ${r}`, email: `${UID[r]}@test.sa` })
  }
  seed(`hrSettings/${ORG}`, { organizationId: ORG, features: ["gov", "mudad"], businessType: "contractor", defaultsAppliedFor: "contractor", establishment: { name: "شركة البناء", minPct: 30 }, policies: {} })
  seed("hrSites/s1", { organizationId: ORG, name: "برج الواحة", type: "project", active: true })
  const base = { organizationId: ORG, gender: "m", trade: "mason", category: "labour", siteId: "s1", source: "local", contract: { type: "open" }, probation: { end: "2021-05-29", decision: "confirmed" }, status: "active", leaveTaken: 0 }
  // A joiner of three days ago (Qiwa contract, GOSI registration) and a worker whose iqama is due.
  seed("employees/n1", { ...base, no: 1, names: { ar: "منضم جديد" }, nationality: "eg", idNo: "2000000001", join: d(-3), docs: { iqama: d(300), insurance: d(300) } })
  seed("employees/w2", { ...base, no: 2, names: { ar: "عامل التجديد" }, nationality: "in", idNo: "2000000002", join: "2022-01-01", docs: { iqama: d(20), insurance: d(200) } })
  seed("employees/s3", { ...base, no: 3, names: { ar: "موظف سعودي" }, nationality: "sa", idNo: "1000000003", join: "2022-01-01", docs: {} })
  for (const [id, basic] of [["n1", 3000], ["w2", 3200], ["s3", 6000]] as const) seed(`employeePay/${id}`, { organizationId: ORG, employeeId: id, basic, housing: 750, transport: 300, iban: "SA4420000001234567891234" })
  // Last month's payroll, prepared: one line Mudad will flag (net of zero).
  seed(`hrPayrolls/${ORG}__${lastMonth}`, {
    organizationId: ORG,
    month: lastMonth,
    key: lastMonth,
    kind: "main",
    state: "prepared",
    prepared: { by: "po", byName: "مستخدم payroll", at: `${TODAY}T08:00:00Z` },
    lines: [{ employeeId: "w2", name: "عامل التجديد", no: 2, siteId: "s1", costKind: "direct", held: false, heldReason: null, gross: 4000, net: 0, monthWage: 4000, gosiEmployee: 0, advance: 4000, penalties: 0, sickDeduction: 0, unpaidDeduction: 0, basic: 3200, cost: 4000, eosAccrual: 0, leaveAccrual: 0, attendance: { present: 26, absent: 0, sick: 0, permission: 0, declared: 0, overtimeHours: 0 } }],
  })
}

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

async function open(uid: string, path: string, node: React.ReactElement) {
  setSignedIn(uid)
  setPathname(path)
  missingKeys.clear()
  const view = render(node)
  await flush()
  return view
}

const text = () => document.body.textContent ?? ""
const rail = () => Array.from(document.querySelectorAll("nav a")).map((a) => (a.textContent ?? "").trim().replace(/\d+$/, ""))
const buttons = () => Array.from(document.querySelectorAll("button, a")).map((b) => (b.textContent ?? "").trim())

describe("with a member holding government relations", () => {
  beforeAll(() => buildWorld({ govHeld: true }))

  it.each(["gov", "manager", "payroll", "management"] as Role[])("the Platforms tab on the rail as %s — government relations' only", async (role) => {
    const view = await open(UID[role], "/contractor/hr", <TodayPage />)
    expect({ role, missing: [...missingKeys] }).toEqual({ role, missing: [] })
    expect({ role, platforms: rail().includes("المنصات") }).toEqual({ role, platforms: role === "gov" })
    view.unmount()
  })

  it("government relations: the tasks by platform, the authorities, Nitaqat's what-if — and never a riyal", async () => {
    const view = await open(UID.gov, "/contractor/hr/platforms", <PlatformsPage />)
    expect([...missingKeys]).toEqual([])
    for (const x of ["ما يجب فعله على المنصات", "قوى — وزارة الموارد البشرية", "وثّق عقده في قوى", "سجّله مشتركاً", "جدّد الإقامة", "الجهات", "أعمال مفتوحة على المنصات", "فروقات من آخر مطابقة", "أقدم مطابقة", "ماذا لو؟ — النطاق", "ملف المنشأة"])
      expect({ x, shown: text().includes(x) }).toEqual({ x, shown: true })
    expect(text()).not.toContain(RIYAL)
    // He reconciles; switching a platform off is the HR manager's.
    expect(buttons()).toContain("طابق بملف")
    expect(buttons()).not.toContain("أطفئ")
    // A wage reconciliation tells him he sees presence only.
    const gosi = Array.from(document.querySelectorAll("li")).find((li) => (li.textContent ?? "").startsWith("التأمينات الاجتماعية"))
    fireEvent.click(Array.from(gosi!.querySelectorAll("button")).find((b) => b.textContent?.includes("طابق بملف"))!)
    await flush()
    expect(text()).toContain("المقارنة بالأجر لمسؤول الرواتب أو مدير الموارد البشرية")
    view.unmount()
  })

  it("Today: government relations' platform row opens the tab; the HR manager's goes to the documents", async () => {
    let view = await open(UID.gov, "/contractor/hr", <TodayPage />)
    expect(text()).toContain("أعمال على المنصات")
    expect(Array.from(document.querySelectorAll("a")).some((a) => a.getAttribute("href") === "/contractor/hr/platforms")).toBe(true)
    view.unmount()
    view = await open(UID.manager, "/contractor/hr", <TodayPage />)
    // Three rows a group, then «عرض N أخرى».
    for (const b of Array.from(document.querySelectorAll("button")).filter((x) => x.textContent?.startsWith("عرض "))) fireEvent.click(b)
    await flush()
    expect(text()).toContain("أعمال على المنصات")
    expect(Array.from(document.querySelectorAll("a")).some((a) => a.getAttribute("href") === "/contractor/hr/people?filter=docs")).toBe(true)
    view.unmount()
  })

  it("payroll: the pre-Mudad check on the payroll, the finding to justify, and the Today row", async () => {
    let view = await open(UID.payroll, "/contractor/hr/payroll", <PayrollPage />)
    expect([...missingKeys]).toEqual([])
    expect(text()).toContain("فحص الالتزام قبل مُدد")
    expect(text()).toContain("صافيه صفر أو أقل")
    expect(buttons()).toContain("برّر")
    view.unmount()
    view = await open(UID.payroll, "/contractor/hr", <TodayPage />)
    expect(text()).toContain("فحص ما قبل مُدد")
    view.unmount()
  })

  it("Settings: the platforms followed, under the `gov` feature", async () => {
    const view = await open(UID.manager, "/contractor/hr/settings", <SettingsPage />)
    expect([...missingKeys]).toEqual([])
    expect(text()).toContain("الجهات التي تتابعها")
    expect(text()).toContain("هدف — دعم التوظيف")
    view.unmount()
  })
})

describe("with nobody holding government relations", () => {
  beforeAll(() => buildWorld({ govHeld: false }))

  it("the HR manager carries the Platforms tab, switches a platform off there, and his Today row opens it; management still has no tab", async () => {
    let view = await open(UID.manager, "/contractor/hr", <TodayPage />)
    expect(rail()).toContain("المنصات")
    expect(Array.from(document.querySelectorAll("a")).some((a) => a.getAttribute("href") === "/contractor/hr/platforms")).toBe(true)
    view.unmount()
    view = await open(UID.manager, "/contractor/hr/platforms", <PlatformsPage />)
    expect([...missingKeys]).toEqual([])
    expect(text()).not.toContain("ليس ضمن دورك")
    expect(buttons()).toContain("أطفئ")
    view.unmount()
    view = await open(UID.management, "/contractor/hr/platforms", <PlatformsPage />)
    expect(text()).toContain("ليس ضمن دورك")
    view.unmount()
  })
})
