/**
 * Procurement 1.5 (PUR-02/03): the rows editor rendered for real over the in-memory
 * Firestore, in Arabic — a project's approved material request arrives as ONE group
 * with its number, its row keeps the words and the unit it came with, every message key
 * resolves, and «التالي» stops on the row that lacks its material, naming the row.
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
import { act, fireEvent, render } from "@testing-library/react"
import type { Firestore } from "firebase/firestore"
import { fakeFirestore, listCollection, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { approveMaterialRequest, createMaterialRequest } from "@/lib/pm/supply-writes"
import { todayDay } from "@/lib/pm/format"
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

const d = (n: number) => {
  const x = new Date(`${todayDay()}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

async function world() {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
  seed(`projects/P1`, { organizationId: ORG, contractorId: ORG, name: "مجمع الياسمين", status: "in_progress", projectManagerId: ORG, enabledSections: ["procure"], pm: { no: "PJ-2026/001", lifecycle: "live", startOn: d(-30), durationDays: 200 } })
  seed(`projects/P1/boqItems/b1`, { itemNo: "09-01-01", descriptionAr: "لياسة داخلية", unit: "م²", quantity: 5000, unitPrice: 40, executedQuantity: 0 })
  seed(`procurementSettings/${ORG}`, { organizationId: ORG, deliverySites: [{ id: "prj_P1", kind: "project", name: "مجمع الياسمين", city: "الرياض", district: "حي الياسمين", address: "", receiverId: null, projectId: "P1" }] })
  const db = fakeFirestore as unknown as Firestore
  const ctx: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
  await createMaterialRequest(db, ctx, "P1", { uid: ORG, name: "م. فهد" }, { title: "بلوك وأسمنت", needBy: d(20), notes: null, lines: [{ itemId: "b1", name: "أسمنت بورتلاندي عادي", unit: "كيس", qty: 200 }] })
  await approveMaterialRequest(db, ctx, "P1", { uid: ORG, name: "م. فهد" }, "01")
}

const text = () => document.body.textContent ?? ""

describe("the RFQ editor (PUR-02/03)", () => {
  beforeEach(async () => {
    await world()
    setSignedIn(ORG)
    missingKeys.clear()
  })

  it("takes the incoming request as one group with its number, the row as it arrived", async () => {
    setPathname("/contractor/rfqs/new", "requests=project:P1:01")
    const view = render(<NewRfqPage />)
    await flush()
    expect(text()).toContain("طلب عروض أسعار جديد")
    expect(text()).toContain("مجمع الياسمين")
    expect(text()).toContain("أسمنت بورتلاندي عادي")
    expect(text()).toContain("الرياض — حي الياسمين")
    expect((Array.from(document.querySelectorAll("input")) as HTMLInputElement[]).some((i) => i.value === "كيس")).toBe(true)
    expect([...missingKeys]).toEqual([])

    // «التالي: النشر» stops on the row, naming it: the material is not picked yet.
    const next = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes("التالي: النشر"))!
    await act(async () => void fireEvent.click(next))
    await flush()
    expect(text()).toContain("اختر المادة أو فئتها الفرعية في الصف 1")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("opens empty with the search row and the three steps", async () => {
    setPathname("/contractor/rfqs/new", "")
    const view = render(<NewRfqPage />)
    await flush()
    for (const s of ["المواد", "النشر", "المراجعة", "الصق من إكسل"]) expect(text()).toContain(s)
    expect(document.querySelector('input[role="combobox"]')).not.toBeNull()
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("types a material, places it, steps through publish and review, and publishes ONE RFQ", async () => {
    setPathname("/contractor/rfqs/new", "")
    const view = render(<NewRfqPage />)
    await flush()
    const box = document.querySelector('input[role="combobox"]') as HTMLInputElement
    await act(async () => void fireEvent.change(box, { target: { value: "حديد 16" } }))
    await flush()
    const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) => (o.textContent || "").includes("اسياخ حديد التسليح"))!
    expect(option.textContent).toContain("16 mm")
    await act(async () => void fireEvent.click(option))
    await flush()
    const qty = document.querySelector('input[aria-label="الكمية"]') as HTMLInputElement
    await act(async () => void fireEvent.change(qty, { target: { value: "8" } }))
    const place = document.querySelector('select[aria-label="المشروع أو موقع التسليم"]') as HTMLSelectElement
    await act(async () => void fireEvent.change(place, { target: { value: "prj_P1" } }))
    await flush()
    const press = async (label: string) => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim().startsWith(label))!
      expect(b).toBeDefined()
      await act(async () => void fireEvent.click(b))
      await flush()
    }
    await press("التالي: النشر")
    expect(text()).toContain("الموعد النهائي للعروض") // one line: no pricing choice, as before
    await press("التالي: المراجعة")
    expect(text()).toContain("يُنشر طلب واحد")
    expect([...missingKeys]).toEqual([])
    await press("انشر")
    await flush()
    const rfqs = listCollection<Record<string, unknown>>("rfqs").filter((r) => r.status === "New")
    expect(rfqs).toHaveLength(1)
    const r = rfqs[0]
    expect(r.rfqNumber).toMatch(/^RFQ-\d{4}\/\d{3}$/)
    expect(r.subCategoryIds).toHaveLength(1)
    expect(r).toMatchObject({ city: "الرياض", district: "حي الياسمين", pricingMode: "line", visibility: "public" })
    expect((r.products as Array<Record<string, unknown>>)[0]).toMatchObject({ quantity: 8, unitOfMeasure: "طن", deliveryDistrict: "حي الياسمين" })
    expect(text()).toContain("نُشر طلب العروض")
    view.unmount()
  })
})
