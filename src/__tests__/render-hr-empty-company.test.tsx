/**
 * HR on a company as production has them: an owner who never opened HR (no
 * `hrSettings` document, no workplace, no employee), a legacy solo account (no
 * `organizationRole` at all), and a company whose `hrSettings` was saved by the
 * first HR release (before the establishment, platform, policy-log and new policy
 * fields). Every HR page must render for the owner without throwing — on UAT
 * every company was seeded, so nothing else exercised these shapes.
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
import { act, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, setPathname, setSignedIn } from "@/test-utils/render-world"
import TodayPage from "@/app/[locale]/(contractor)/contractor/hr/page"
import PeoplePage from "@/app/[locale]/(contractor)/contractor/hr/people/page"
import SitesPage from "@/app/[locale]/(contractor)/contractor/hr/sites/page"
import AttendancePage from "@/app/[locale]/(contractor)/contractor/hr/attendance/page"
import PayrollPage from "@/app/[locale]/(contractor)/contractor/hr/payroll/page"
import ReportsPage from "@/app/[locale]/(contractor)/contractor/hr/reports/page"
import SettingsPage from "@/app/[locale]/(contractor)/contractor/hr/settings/page"
import MePage from "@/app/[locale]/(contractor)/contractor/hr/me/page"
import HiringPage from "@/app/[locale]/(contractor)/contractor/hr/hiring/page"
import PlatformsPage from "@/app/[locale]/(contractor)/contractor/hr/platforms/page"
import PerfPage from "@/app/[locale]/(contractor)/contractor/hr/perf/page"

const mockRoute = { id: "" }
installDomShims()
jest.setTimeout(60_000)

const ORG = "solo-owner"
const PAGES: Array<[string, string, () => React.ReactElement]> = [
  ["today", "/contractor/hr", () => <TodayPage />],
  ["people", "/contractor/hr/people", () => <PeoplePage />],
  ["sites", "/contractor/hr/sites", () => <SitesPage />],
  ["attendance", "/contractor/hr/attendance", () => <AttendancePage />],
  ["payroll", "/contractor/hr/payroll", () => <PayrollPage />],
  ["reports", "/contractor/hr/reports", () => <ReportsPage />],
  ["settings", "/contractor/hr/settings", () => <SettingsPage />],
  ["me", "/contractor/hr/me", () => <MePage />],
  ["hiring", "/contractor/hr/hiring", () => <HiringPage />],
  ["platforms", "/contractor/hr/platforms", () => <PlatformsPage />],
  ["perf", "/contractor/hr/perf", () => <PerfPage />],
]

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

async function renderAll(): Promise<string[]> {
  const failures: string[] = []
  const errors = jest.spyOn(console, "error").mockImplementation(() => {})
  for (const [name, path, node] of PAGES) {
    setSignedIn(ORG)
    setPathname(path)
    try {
      const view = render(node())
      await flush()
      view.unmount()
    } catch (e) {
      failures.push(`${name}: ${(e as Error).message}`)
    }
  }
  errors.mockRestore()
  return failures
}

describe("HR on a company that never opened HR (production)", () => {
  it("a legacy solo owner with no hrSettings: every page renders", async () => {
    resetFakeDb()
    seed(`users/${ORG}`, { role: "Contractor", name: "مالك قديم", companyName: "شركة قديمة", email: "old@test.sa" })
    expect(await renderAll()).toEqual([])
  })

  it("an owner whose hrSettings was saved by the first HR release: every page renders", async () => {
    resetFakeDb()
    seed(`users/${ORG}`, { role: "Contractor", organizationId: ORG, organizationRole: "owner", name: "مالك", companyName: "شركة", email: "o@test.sa" })
    // The first release's shape: no establishment fields beyond these, no platforms, no log, old policies only.
    seed(`hrSettings/${ORG}`, { organizationId: ORG, features: [], businessType: "contractor", establishment: { name: "شركة" }, policies: { housingShare: 0.25 } })
    expect(await renderAll()).toEqual([])
  })
})
