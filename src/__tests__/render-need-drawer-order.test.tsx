/**
 * V5-proc-front-08: the need-line drawer offers «أمر على الاتفاقية» / «أمر مباشر» /
 * «أمر مباشر بمصدر وحيد — بسبب» only to whoever may prepare an order — a member
 * who only runs RFQs (the seeded supply-chain group) keeps the RFQ buttons, and
 * never meets the write layer's `no_permission` refusal.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)

import React from "react"
import { act, render } from "@testing-library/react"
import { resetFakeDb } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setSignedIn } from "@/test-utils/render-world"
import { NeedLineDrawer, type NeedLineActs } from "@/components/procurement/NeedLineDrawer"
import { buildNeedRows, type DeskFacts } from "@/lib/procurement/need-desk"
import { projectNeed } from "@/lib/procurement/needs"
import { materialKey, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { DEFAULT_POLICIES } from "@/lib/procurement/types"

installDomShims()

const NOW = new Date("2026-09-22T08:00:00Z")
const TODAY = "2026-09-22"
const history: PriceHistoryEntry[] = [{ id: "h", organizationId: "org", materialKey: materialKey("Cement", "bag"), name: "Cement", unit: "bag", supplierOrgId: "s1", supplierName: "Cement Co", price: 18, day: "2026-09-01", kind: "po", poId: null, poNumber: null }]
const agreements: PriceAgreement[] = [{ id: "a1", organizationId: "org", docNumber: "AG-2026/001", supplierOrgId: "s1", supplierName: "Cement Co", from: "2026-01-01", until: "2026-12-31", lines: [{ name: "Sand", unit: "m3", price: 40 }], preparedById: "m", preparedByName: "M", createdAt: "" }]
const facts: DeskFacts = { now: NOW, policies: DEFAULT_POLICIES, agreements, history, orders: [], rfqs: [], onHand: () => null, makeable: () => false, mfgRequests: {} }
const need = (items: Array<{ name: string; quantity: number; unit: string }>, id: string) =>
  projectNeed({ id: "p1", name: "Villas" }, { id, title: "L2", items, status: "approved", needBy: "2026-10-30", requestedByUserName: "Yasser", createdAt: "2026-09-22T06:00:00Z" }, "PR-1")

const ORDER_LABELS = ["أمر على الاتفاقية", "أمر مباشر", "أمر مباشر بمصدر وحيد — بسبب"]
const acts = (canOrder: boolean): NeedLineActs => ({ canAct: true, canRfq: true, canOrder, seesPrices: true, onRfq: jest.fn(), onOrder: jest.fn(), onProceed: jest.fn(), onAskWorkshop: jest.fn(), onBuyNotMake: jest.fn(), onWorkshopLapsed: jest.fn() })
const labels = () => Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim())

async function show(items: Array<{ name: string; quantity: number; unit: string }>, canOrder: boolean) {
  const [row] = buildNeedRows([need(items, `pr-${items[0].name}`)], facts)
  const view = render(<NeedLineDrawer row={row} agreements={agreements} history={history} cap={DEFAULT_POLICIES.directPurchaseCap} today={TODAY} acts={acts(canOrder)} orgId="org" onClose={() => undefined} />)
  await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
  return { view, row }
}

beforeEach(() => {
  resetFakeDb()
  setSignedIn("u1")
  missingKeys.clear()
})

describe.each([
  ["an agreement line", [{ name: "Sand", quantity: 5, unit: "m3" }], "agreement"],
  ["a small direct line", [{ name: "Cement", quantity: 10, unit: "bag" }], "direct"],
] as const)("%s", (_label, items, path) => {
  it("the preparer gets the order button and the RFQ button", async () => {
    const { view, row } = await show([...items], true)
    expect(row.path).toBe(path)
    expect(labels().some((l) => ORDER_LABELS.includes(l))).toBe(true)
    expect(labels().some((l) => l.startsWith("اطلب عروض"))).toBe(true)
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("a member who only runs RFQs keeps the RFQ button and meets no order button", async () => {
    const { view } = await show([...items], false)
    expect(labels().filter((l) => ORDER_LABELS.includes(l))).toEqual([])
    expect(labels().some((l) => l.startsWith("اطلب عروض"))).toBe(true)
    view.unmount()
  })
})
