jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)

/**
 * PUR-06 — one receiver in every screen. The order's line says who the notice WENT TO once it was
 * forwarded; the register's suggestion for the place is only a suggestion, and says so.
 */

import React from "react"
import { act, render, screen } from "@testing-library/react"
import { installDomShims, missingKeys, setSignedIn } from "@/test-utils/render-world"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { PoReceiverLine } from "@/components/procurement/PoReceiverLine"
import ar from "../../messages/ar.json"

installDomShims()

const ORG = "own"
const t = (ar as unknown as { Portal: { ProcReceipts: Record<string, string> } }).Portal.ProcReceipts
const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const forwarded = (over: Record<string, unknown> = {}) => ({
  poId: "po1",
  status: "pending_confirmation",
  forwardedTo: { linkId: "l1", name: "سالم القحطاني", userId: null, phoneMasked: "05****67", byName: "المشتري", at: "2026-10-18T08:00:00.000Z" },
  ...over,
})

beforeEach(() => {
  resetFakeDb()
  setSignedIn(ORG)
  missingKeys.clear()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك" })
  seed("procurementReceivers/r1", { organizationId: ORG, name: "أحمد العتيبي", title: "أمين المستودع", module: "inventory", phone: "0551002210", warehouseIds: [`central_${ORG}`], active: true, createdAt: "2026-09-01T00:00:00.000Z" })
})

const line = (notices: React.ComponentProps<typeof PoReceiverLine>["notices"]) => render(<PoReceiverLine organizationId={ORG} projectId={null} poId="po1" notices={notices} />)

it("with no notice forwarded, it is the register's suggestion — and says it is a suggestion", async () => {
  line([])
  await flush()
  expect(screen.getByText(t.received_by_suggested, { exact: false })).toBeTruthy()
  expect(screen.getByText("أحمد العتيبي")).toBeTruthy()
  expect(screen.queryByText(t.received_by)).toBeNull()
  expect(missingKeys.size).toBe(0)
})

it("once a notice is forwarded, it is the person it went to, not the suggestion", async () => {
  line([forwarded()])
  await flush()
  expect(screen.getByText("سالم القحطاني")).toBeTruthy()
  expect(screen.queryByText("أحمد العتيبي")).toBeNull()
  expect(screen.queryByText(t.received_by_suggested, { exact: false })).toBeNull()
})

it("shows him even when the register has nobody for the place", async () => {
  seed("procurementReceivers/r1", { organizationId: ORG, name: "أحمد العتيبي", title: "أمين", module: "inventory", phone: "0551002210", warehouseIds: [], active: false, createdAt: "2026-09-01T00:00:00.000Z" })
  line([forwarded()])
  await flush()
  expect(screen.getByText("سالم القحطاني")).toBeTruthy()
})

it("the latest forward wins, another order's notice and a received one do not count", async () => {
  line([
    forwarded({ forwardedTo: { name: "الأول", at: "2026-10-10T08:00:00.000Z" } }),
    forwarded({ forwardedTo: { name: "الأحدث", at: "2026-10-19T08:00:00.000Z" } }),
    forwarded({ poId: "other", forwardedTo: { name: "طلب آخر", at: "2026-10-20T08:00:00.000Z" } }),
    forwarded({ status: "confirmed", forwardedTo: { name: "استلم", at: "2026-10-21T08:00:00.000Z" } }),
  ])
  await flush()
  expect(screen.getByText("الأحدث")).toBeTruthy()
  expect(screen.queryByText("طلب آخر")).toBeNull()
  expect(screen.queryByText("استلم")).toBeNull()
})
