/**
 * Procurement 2.0, WP-S2-00 — three faults of 1.5 on the demand side, each rendered or read for real:
 * «انشره/جهّزه» on a team's «طلب مواد» opened an empty editor (useOpenNeeds never read the team's requests),
 * the success panel said «وصل إلى لا أحد من الموردين بعد», and a deadline of TODAY was refused (R-32).
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
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, fireEvent, render, renderHook } from "@testing-library/react"
import { listCollection, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import { useOpenNeeds } from "@/hooks/useOpenNeeds"
import { RfqPublishedPanel } from "@/components/procurement/rfq-editor/RfqPublishedPanel"
import type { TeamRequestDoc } from "@/lib/procurement/team-requests"
import NewRfqPage from "@/app/[locale]/(contractor)/contractor/rfqs/new/page"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const tree = readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")
beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => (String(url).includes("material-tree") ? { ok: true, json: async () => JSON.parse(tree) } : { ok: false, json: async () => ({}) }))
})

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const text = () => document.body.textContent ?? ""
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === label) as HTMLButtonElement | undefined
const day = (n: number) => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const teamRequest: TeamRequestDoc = {
  id: "T1",
  organizationId: ORG,
  number: "MR-2026/014",
  lines: [{ name: "بلك أسمنتي مفرغ 20 سم", unit: "حبة", quantity: 2000 }],
  needBy: day(20),
  siteId: "site1",
  place: { label: "مجمع الياسمين", city: "الرياض", district: "حي الياسمين" },
  note: null,
  requestedById: "eng1",
  requestedByName: "م. فهد",
  createdAt: "2026-10-20T09:00:00.000Z",
  status: "open",
}

beforeEach(() => {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
  seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management"] })
  seed(`procurementSettings/${ORG}`, { organizationId: ORG, deliverySites: [{ id: "prj_P1", kind: "project", name: "مجمع الياسمين", city: "الرياض", district: "حي الياسمين", address: "", receiverId: null, projectId: "P1" }] })
  seed(`procTeamRequests/T1`, teamRequest as unknown as Record<string, unknown>)
  setSignedIn(ORG)
  setPathname("/contractor/rfqs/requests", "")
  missingKeys.clear()
})

describe("«انشره/جهّزه» on a team's «طلب مواد» (INC-04)", () => {
  it("useOpenNeeds lists the team's request when Project Management is off", async () => {
    const { result } = renderHook(() => useOpenNeeds({ orgId: ORG, rfqs: [], orders: [] }, true))
    await flush()
    expect(result.current.map((n) => n.key)).toEqual(["team:T1"])
    expect(result.current[0].lines.map((l) => [l.name, l.quantity])).toEqual([["بلك أسمنتي مفرغ 20 سم", 2000]])
  })

  it("a withdrawn request is not offered", async () => {
    seed(`procTeamRequests/T1`, { ...teamRequest, status: "withdrawn" } as unknown as Record<string, unknown>)
    const { result } = renderHook(() => useOpenNeeds({ orgId: ORG, rfqs: [], orders: [] }, true))
    await flush()
    expect(result.current).toEqual([])
  })

  it("the editor opened for it is filled with its place, its number and its row — not empty", async () => {
    setPathname("/contractor/rfqs/new", "requests=team:T1")
    const view = render(<NewRfqPage />)
    await flush()
    expect(text()).toContain("بلك أسمنتي مفرغ 20 سم")
    expect(text()).toContain("مجمع الياسمين")
    expect(text()).toContain("الرياض — حي الياسمين")
    expect((Array.from(document.querySelectorAll("input")) as HTMLInputElement[]).some((i) => i.value === "2000")).toBe(true)
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
})

describe("the success panel (ED-08)", () => {
  const panel = (reached: number | null, closesOn: string | null) =>
    render(<RfqPublishedPanel number="RFQ-2026/003" reached={reached} closesOn={closesOn} guestUrl={null} title="t" openHref="/x" onNew={() => undefined} />)

  it("says no matching supplier yet and points at the visitor link when it reached nobody", () => {
    const view = panel(0, "26 أكتوبر")
    expect(text()).toContain("لم يصل إلى أي مورّد مختص بعد — شارك رابط الزوار أدناه. وتُغلق العروض 26 أكتوبر.")
    expect(text()).not.toContain("لا أحد من الموردين")
    view.unmount()
    const nodate = panel(0, null)
    expect(text()).toContain("لم يصل إلى أي مورّد مختص بعد — شارك رابط الزوار أدناه.")
    nodate.unmount()
  })

  it("counts the suppliers it did reach, in Arabic plurals", () => {
    let view = panel(1, "26 أكتوبر")
    expect(text()).toContain("وصل إلى مورد واحد، وتُغلق العروض 26 أكتوبر.")
    view.unmount()
    view = panel(9, "26 أكتوبر")
    expect(text()).toContain("وصل إلى 9 موردين، وتُغلق العروض 26 أكتوبر.")
    view.unmount()
  })
})

describe("the deadline (R-32)", () => {
  async function toPublishStep() {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: [] })
    setPathname("/contractor/rfqs/new", "")
    const view = render(<NewRfqPage />)
    await flush()
    const box = document.querySelector('input[role="combobox"]') as HTMLInputElement
    await act(async () => void fireEvent.change(box, { target: { value: "حديد 16" } }))
    await flush()
    await act(async () => void fireEvent.click(Array.from(document.querySelectorAll('[role="option"]')).find((o) => (o.textContent || "").includes("اسياخ حديد التسليح"))!))
    await flush()
    await act(async () => void fireEvent.change(document.querySelector('input[aria-label="الكمية"]')!, { target: { value: "8" } }))
    await act(async () => void fireEvent.change(document.querySelector('select[aria-label="المشروع أو موقع التسليم"]')!, { target: { value: "prj_P1" } }))
    await flush()
    await act(async () => void fireEvent.click(button("التالي: النشر")!))
    await flush()
    return view
  }

  it("a deadline that has passed is refused with the new words; today is accepted and moves on", async () => {
    const view = await toPublishStep()
    const date = () => document.querySelector('input[type="date"]') as HTMLInputElement
    expect(date().min).toBe(day(0))
    await act(async () => void fireEvent.change(date(), { target: { value: day(-1) } }))
    await act(async () => void fireEvent.click(button("التالي: المراجعة")!))
    await flush()
    expect(text()).toContain("الموعد النهائي مضى: اختر اليوم أو بعده.")
    expect(button("انشر")).toBeUndefined()
    await act(async () => void fireEvent.change(date(), { target: { value: day(0) } }))
    await act(async () => void fireEvent.click(button("التالي: المراجعة")!))
    await flush()
    expect(button("انشر")).toBeDefined()
    await act(async () => void fireEvent.click(button("انشر")!))
    await flush()
    expect(listCollection<Record<string, unknown>>("rfqs").find((r) => r.status === "New")?.deadline).toBe(day(0))
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
})
