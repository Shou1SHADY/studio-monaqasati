/**
 * HR 1.0 — the Payroll page as the prototype has it (slice 4 / package E),
 * rendered in Arabic over the in-memory Firestore: the segments (the month
 * still running, the last months, the Advances), the lines opening on the
 * exceptions by cost centre, the Mudad file previewed with the establishment's
 * Mudad number before it is downloaded, the Advances segment, and Finance's
 * desk recording the month's GOSI payment. Pay stays with pay roles (RL-03).
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
import { act, fireEvent, render, screen } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import { todayDay } from "@/lib/hr/format"
import { addDays } from "@/lib/hr/statutory"
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { computePayroll } from "@/lib/hr/payroll"
import type { HrSite } from "@/lib/hr/sites"
import PayrollPage from "@/app/[locale]/(contractor)/contractor/hr/payroll/page"
import HrDeskPage from "@/app/[locale]/(contractor)/contractor/accounting/hr-desk/page"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const TODAY = todayDay()
const LAST = addDays(`${TODAY.slice(0, 7)}-01`, -1).slice(0, 7)
const OLDER = addDays(`${LAST}-01`, -1).slice(0, 7)
const RIYAL = "⃁"

const sites: HrSite[] = [
  { id: "s1", organizationId: ORG, name: "برج الواحة", type: "project", projectId: "p1", active: true },
  { id: "hq", organizationId: ORG, name: "المكتب الرئيسي", type: "hq", active: true },
]
const emp = (id: string, no: number, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: ORG, no, names: { ar: `موظف ${no}`, en: `Employee ${no}` }, nationality: "eg", gender: "m", idNo: `2${no}00000000`, trade: "mason", category: "labour", siteId: "s1", join: "2021-03-01", source: "local", contract: { type: "open" }, probation: { end: "2021-05-29", decision: "confirmed" }, status: "active", docs: {}, leaveTaken: 0, ...over }) as HrEmployee
const employees = [emp("w1", 7), emp("w2", 8), emp("w3", 9, { siteId: "hq" })]
const pay = (id: string, over: Partial<EmployeePay> = {}): EmployeePay => ({ organizationId: ORG, employeeId: id, basic: 4_000, housing: 1_000, transport: 400, iban: "SA4480000123456789012345", ibanState: "ok", ...over })
const pays = new Map<string, EmployeePay>([
  ["w1", pay("w1")],
  ["w2", pay("w2", { advance: { amount: 1_200, balance: 660, instalment: 540 } })],
  ["w3", pay("w3")],
])

function world() {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", email: "owner@test.sa" })
  seed("teamGroups/g_po", { organizationId: ORG, name: "payroll", key: null, permissions: ["hr.payroll"] })
  seed("users/po", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_po", name: "محاسب الرواتب", email: "po@test.sa" })
  seed("teamGroups/g_gro", { organizationId: ORG, name: "gov", key: null, permissions: ["hr.gov"] })
  seed("users/gro", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_gro", name: "العلاقات", email: "gro@test.sa" })
  seed(`hrSettings/${ORG}`, { organizationId: ORG, features: [], businessType: "contractor", defaultsAppliedFor: "contractor", establishment: { name: "شركة البناء", gosi: "520000431", mudad: "MD-7-1234567" }, policies: {} })
  seed(`accounting_settings/${ORG}`, { organizationId: ORG, enabled: true })
  for (const s of sites) seed(`hrSites/${s.id}`, s as unknown as Record<string, unknown>)
  for (const e of employees) seed(`employees/${e.id}`, e as unknown as Record<string, unknown>)
  for (const [id, p] of pays) seed(`employeePay/${id}`, p as unknown as Record<string, unknown>)
  // The older month: closed, one absence, prepared → approved → posted by Finance.
  const wm: WorkplaceMonth = { id: `${ORG}__s1__${OLDER}`, organizationId: ORG, siteId: "s1", month: OLDER, days: { [`${OLDER}-03`]: { by: "s", byName: null, at: "", listed: ["w1", "w2"], ex: { w1: { status: "absent" } } } }, declarations: [], closed: { by: "s", byName: null, at: "", asIs: false, missing: [] } }
  seed(`hrAttendance/${wm.id}`, wm as unknown as Record<string, unknown>)
  const { lines } = computePayroll({ month: OLDER, employees, pays, sites, attendance: [wm], requests: [] })
  seed(`hrPayrolls/${ORG}__${OLDER}`, { organizationId: ORG, month: OLDER, key: OLDER, kind: "main", state: "posted", lines, prepared: { by: "po", byName: "P", at: `${OLDER}-28` }, approved: { by: ORG, byName: "O", at: `${OLDER}-28` }, posted: { by: ORG, byName: "O", at: `${LAST}-02`, entry: null } })
}

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
async function open(uid: string, node: React.ReactElement, path: string) {
  setSignedIn(uid)
  setPathname(path)
  missingKeys.clear()
  const view = render(node)
  await flush()
  return view
}
const text = () => document.body.textContent ?? ""
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { month: "long", year: "numeric" })
async function click(name: string | RegExp) {
  const hit = [...screen.queryAllByRole("tab", { name }), ...screen.queryAllByRole("button", { name })][0]
  expect({ name: String(name), found: Boolean(hit) }).toEqual({ name: String(name), found: true })
  await act(async () => void fireEvent.click(hit))
  await flush()
}

beforeEach(() => world())

describe("the Payroll page (slice 4)", () => {
  it("segments: the month still running, the last months, the Advances — the running month has no lines, only the contract estimate", async () => {
    const view = await open("po", <PayrollPage />, "/contractor/hr/payroll")
    const tabs = screen.getAllByRole("tab").map((x) => x.textContent ?? "")
    expect(tabs.some((x) => x.includes("الحضور جارٍ"))).toBe(true)
    expect(tabs.some((x) => x.includes("السلف"))).toBe(true)
    await click(/الحضور جارٍ/)
    expect(text()).toContain("تقدير من العقود")
    expect(text()).toContain("لا سطور قبل نهاية الشهر")
    expect({ missing: [...missingKeys] }).toEqual({ missing: [] })
    view.unmount()
  })

  it("a payroll opens on the exceptions by cost centre; all lines a click away; the Mudad file is previewed with the establishment's Mudad number", async () => {
    const view = await open("po", <PayrollPage />, "/contractor/hr/payroll")
    await click(monthName(OLDER))
    expect(text()).toContain("الاستثناءات بحسب مركز التكلفة")
    // w1 (absent) and w2 (advance) are exceptions; w3 — the contract wage as agreed — is not.
    expect(text()).toContain("موظف 7")
    expect(text()).toContain("موظف 8")
    expect(text()).not.toContain("موظف 9")
    await click(/كل السطور \(3\)/)
    expect(text()).toContain("موظف 9")
    await click("ملف أجور مُدد")
    expect(text()).toContain("MD-7-1234567")
    expect(text()).toContain("RJHI")
    expect(text()).toContain("نزّل CSV")
    expect({ missing: [...missingKeys] }).toEqual({ missing: [] })
    expect(text()).not.toMatch(/NaN|undefined|Invalid Date/)
    view.unmount()
  })

  it("the Advances segment lists the running advance with its months left", async () => {
    const view = await open("po", <PayrollPage />, "/contractor/hr/payroll")
    await click(/^السلف/)
    expect(text()).toContain("سلف قائمة")
    expect(text()).toContain("بعد 2 أشهر")
    expect({ missing: [...missingKeys] }).toEqual({ missing: [] })
    view.unmount()
  })

  it("government relations never reaches the payroll's figures (RL-03)", async () => {
    const view = await open("gro", <PayrollPage />, "/contractor/hr/payroll")
    expect(text()).not.toContain(RIYAL)
    view.unmount()
  })
})

describe("Finance's HR desk (PY-09)", () => {
  it("lists the month's GOSI contributions to pay and shows each event's entry before it is posted", async () => {
    seed(`hrEvents/${ORG}__hr:EOS:${OLDER}`, { organizationId: ORG, key: `hr:EOS:${OLDER}`, kind: "EOS", month: OLDER, payrollKey: OLDER, state: "sent", debit: [{ costKind: "direct", siteId: "s1", projectId: "p1", amount: 100 }], credit: { eosProvision: 70, leaveProvision: 30 } })
    const view = await open(ORG, <HrDeskPage />, "/contractor/accounting/hr-desk")
    expect(text()).toContain("اشتراكات التأمينات للسداد")
    expect(text()).toContain(OLDER)
    expect(screen.getAllByRole("button", { name: "سجّل السداد" }).length).toBeGreaterThan(0)
    expect(text()).toContain("القيد")
    expect({ missing: [...missingKeys] }).toEqual({ missing: [] })
    view.unmount()
  })
})
