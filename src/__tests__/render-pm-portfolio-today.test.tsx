/**
 * Portfolio Today across two projects (fix wave F, V1-pm-portfolio-04/08): the
 * group chips show whenever there is a decision — one group included, as the
 * prototype's decList — and «معلّق عند غيرنا» lists each project's approved
 * material requests Procurement has not ordered, not only on a project's own
 * page. Rendered over the in-memory Firestore as the org owner.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)

import React from "react"
import { act, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, setPathname, setSignedIn } from "@/test-utils/render-world"
import { PmPortfolioToday } from "@/components/pm/PmPortfolioToday"
import { todayDay } from "@/lib/pm/format"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const DAY = 86_400_000
const base = new Date(`${todayDay()}T00:00:00Z`).getTime()
const d = (n: number) => new Date(base + n * DAY).toISOString().slice(0, 10)

function project(id: string, name: string, material: string) {
  seed(`projects/${id}`, {
    organizationId: ORG,
    contractorId: ORG,
    name,
    budget: 0,
    status: "planning",
    projectManagerId: ORG,
    projectManagerName: "المالك",
    pm: { no: `PJ-2026/0${id.slice(1)}`, lifecycle: "plan", kind: "bld", startOn: d(-5), durationDays: 200, terms: null, acceptances: {} },
    createdAt: new Date(base - 30 * DAY).toISOString(),
  })
  seed(`projects/${id}/purchaseRequests/01`, {
    pm: false,
    seq: 1,
    title: material,
    status: "approved",
    lines: [{ itemId: null, code: null, key: material, name: material, unit: "كيس", qty: 100 }],
    requestedByUserId: ORG,
    day: d(-12),
    approvedOn: d(-10),
  })
}

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

beforeAll(() => {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", email: "owner@test.sa" })
  project("P1", "مستودعات الخرج", "إسمنت مقاوم")
  project("P2", "مدرسة النرجس", "حديد 12 مم")
})

it("one group of decisions still shows its chips; both projects' requests wait on Procurement", async () => {
  setSignedIn(ORG)
  setPathname("/contractor/projects/today")
  const view = render(<PmPortfolioToday />)
  await flush()
  const text = document.body.textContent ?? ""
  expect(text).toContain("مستودعات الخرج")
  expect(text).toContain("مدرسة النرجس")
  // Only «بانتظار دورك» (two plans past their start): the chip row still shows.
  const chips = document.querySelector('[role="tablist"][aria-label="يحتاج قرارك"]')
  expect(chips?.textContent).toContain("بانتظار دورك")
  expect(text).toContain("إسمنت مقاوم — معتمد، بانتظار أمر شراء")
  expect(text).toContain("حديد 12 مم — معتمد، بانتظار أمر شراء")
  view.unmount()
})
