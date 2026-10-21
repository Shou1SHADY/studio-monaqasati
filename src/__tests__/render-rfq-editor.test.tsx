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
import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { fromPmRequest } from "@/lib/procurement/incoming-ingest"
import { incomingDocId } from "@/lib/procurement/incoming-state"
import type { ProjectRequestDoc } from "@/lib/procurement/needs"
import { installDomShims, missingKeys, pushed, setPathname, setSignedIn } from "@/test-utils/render-world"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { approveMaterialRequest, createMaterialRequest } from "@/lib/pm/supply-writes"
import { todayDay } from "@/lib/pm/format"
import NewRfqPage from "@/app/[locale]/(contractor)/contractor/rfqs/new/page"
import RequestsPage from "@/app/[locale]/(contractor)/contractor/rfqs/requests/page"

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
  seed("invitations/inv1", { type: "supplier_invite", contractorOrgId: ORG, companyName: "مؤسسة الفهد", phone: "+966550000000", status: "pending", createdAt: "2026-10-12T09:00:00.000Z" })
  const db = fakeFirestore as unknown as Firestore
  const ctx: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
  await createMaterialRequest(db, ctx, "P1", { uid: ORG, name: "م. فهد" }, { title: "بلوك وأسمنت", needBy: d(20), notes: null, lines: [{ itemId: "b1", name: "أسمنت بورتلاندي عادي", unit: "كيس", qty: 200 }] })
  await approveMaterialRequest(db, ctx, "P1", { uid: ORG, name: "م. فهد" }, "01")
  // Procurement 2.0: the desk reads the STORED request — what the sync brings in once the project manager has approved.
  const approved = readDoc<Record<string, unknown>>("projects/P1/purchaseRequests/01")
  if (approved) {
    const stored = fromPmRequest(ORG, { id: "P1", name: "مجمع الياسمين" }, { ...approved, id: "01" } as unknown as ProjectRequestDoc & Record<string, unknown>, {}, { siteId: "prj_P1", label: "مجمع الياسمين", city: "الرياض", district: "حي الياسمين" })
    seed(`procIncoming/${incomingDocId(ORG, stored.mrKey)}`, stored as unknown as Record<string, unknown>)
  }
}

const text = () => document.body.textContent ?? ""

describe("the RFQ editor (PUR-02/03)", () => {
  beforeEach(async () => {
    await world()
    setSignedIn(ORG)
    missingKeys.clear()
  })

  it("a place typed by hand keeps its district box while the name is typed — the box does not vanish after the first letter", async () => {
    setPathname("/contractor/rfqs/new")
    render(<NewRfqPage />)
    await flush()
    const city = document.querySelector('select[aria-label="مدينة التسليم"]') as HTMLSelectElement | null
    expect(city).not.toBeNull()
    await act(async () => void fireEvent.change(city!, { target: { value: "الرياض" } }))
    const box = () => document.querySelector('input[aria-label="الحي"]') as HTMLInputElement | null
    expect(box()).not.toBeNull()
    await act(async () => void fireEvent.change(box()!, { target: { value: "ح" } }))
    expect(box()).not.toBeNull()
    await act(async () => void fireEvent.change(box()!, { target: { value: "حي الياسمين" } }))
    expect(box()?.value).toBe("حي الياسمين")
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
    expect(option.textContent).toContain("16 مم")
    await act(async () => void fireEvent.click(option))
    await flush()
    const qty = document.querySelector('input[aria-label="الكمية"]') as HTMLInputElement
    await act(async () => void fireEvent.change(qty, { target: { value: "8" } }))
    await act(async () => void fireEvent.click(Array.from(document.querySelectorAll('[role="group"][aria-label="المشروع أو موقع التسليم"] button')).find((b) => (b.textContent || "").includes("مجمع الياسمين"))!))
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

  it("the incoming list shows the request under its number, and «انشره» opens its panel on the request", async () => {
    setPathname("/contractor/rfqs/requests", "")
    let view = render(<RequestsPage />)
    await flush()
    expect(text()).toContain("ط.م 01")
    expect(text()).toContain("أسمنت بورتلاندي عادي")
    expect([...missingKeys]).toEqual([])
    view.unmount()
    setPathname("/contractor/rfqs/requests", "publish=project:P1:01")
    view = render(<RequestsPage />)
    await flush()
    // The material came as words: step 1 «الطلب» asks for it on its row before publishing.
    expect(text()).toContain("الطلب")
    expect(text()).toContain("اختر المادة")
    expect(text()).toContain("لنشر بعض المواد فقط")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
  it("the panel opens on the request colouring the uncategorised row from the start, and says who asked, who approved, the last day and the BOQ item", async () => {
    setPathname("/contractor/rfqs/requests", "publish=project:P1:01")
    const view = render(<RequestsPage />)
    await flush()
    // No «التالي» was pressed: the row lacking its material already says so.
    expect(text()).toContain("اختر المادة أو فئتها الفرعية في الصف 1")
    expect(Array.from(document.querySelectorAll("li")).some((x) => x.classList.contains("bg-destructive/5"))).toBe(true)
    expect(text()).toContain("طلبه م. فهد")
    expect(text()).toContain("اعتمده م. فهد")
    expect(text()).toContain("آخر يوم للطلب")
    expect(text()).toContain("09-01-01 · لياسة داخلية")
    // The need-by date of a request from a project is information, not a field.
    expect(document.querySelector('input[type="date"]')).toBeNull()
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("pressing the request's row opens its panel on the request; «انشره» opens the publishing step; «التفاصيل» is the panel too", async () => {
    setPathname("/contractor/rfqs/requests", "")
    const view = render(<RequestsPage />)
    await flush()
    const li = Array.from(document.querySelectorAll("li")).find((x) => (x.textContent || "").includes("ط.م 01"))!
    pushed.length = 0
    await act(async () => void fireEvent.click(li))
    expect(pushed.at(-1)).toContain("publish=project%3AP1%3A01")
    expect(pushed.at(-1)).toContain("step=1")
    const press = async (label: string) => {
      pushed.length = 0
      const b = Array.from(li.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === label)!
      expect(b).toBeDefined()
      await act(async () => void fireEvent.click(b))
    }
    await press("انشره")
    expect(pushed.at(-1)).toContain("publish=project%3AP1%3A01")
    expect(pushed.at(-1)).not.toContain("step=")
    await press("التفاصيل")
    expect(pushed.at(-1)).toContain("step=1")
    view.unmount()
  })

  it("the group's city and district are filled from the project and can be changed from the header", async () => {
    setPathname("/contractor/rfqs/new", "requests=project:P1:01")
    const view = render(<NewRfqPage />)
    await flush()
    expect(text()).toContain("الرياض — حي الياسمين")
    const edit = document.querySelector('button[aria-label="تعديل المدينة والحي"]') as HTMLButtonElement | null
    expect(edit).not.toBeNull()
    await act(async () => void fireEvent.click(edit!))
    const city = document.querySelector('select[aria-label="مدينة التسليم"]') as HTMLSelectElement
    expect(city.value).toBe("الرياض")
    await act(async () => void fireEvent.change(city, { target: { value: "جدة" } }))
    const district = document.querySelector('input[aria-label="الحي"]') as HTMLInputElement
    expect(district.value).toBe("حي الياسمين")
    await act(async () => void fireEvent.change(district, { target: { value: "الروضة" } }))
    const done = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "تم")!
    await act(async () => void fireEvent.click(done))
    expect(text()).toContain("جدة — الروضة")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("«لا تجد مورّدك؟» opens the invitation window with the duplicate hint: a number invited before reads «دُعي في …»", async () => {
    setPathname("/contractor/rfqs/new", "")
    const view = render(<NewRfqPage />)
    await flush()
    const box = document.querySelector('input[role="combobox"]') as HTMLInputElement
    await act(async () => void fireEvent.change(box, { target: { value: "حديد 16" } }))
    await flush()
    const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) => (o.textContent || "").includes("اسياخ حديد التسليح"))!
    await act(async () => void fireEvent.click(option))
    await flush()
    await act(async () => void fireEvent.change(document.querySelector('input[aria-label="الكمية"]') as HTMLInputElement, { target: { value: "8" } }))
    await act(async () => void fireEvent.click(Array.from(document.querySelectorAll('[role="group"][aria-label="المشروع أو موقع التسليم"] button')).find((b) => (b.textContent || "").includes("مجمع الياسمين"))!))
    await flush()
    const press = async (label: string) => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim().startsWith(label))!
      expect(b).toBeDefined()
      await act(async () => void fireEvent.click(b))
      await flush()
    }
    await press("التالي: النشر")
    await press("خاص")
    await press("لا تجد مورّدك؟")
    const contact = document.querySelector('[role="dialog"] input[placeholder="05xxxxxxxx"]') as HTMLInputElement
    expect(contact).not.toBeNull()
    await act(async () => void fireEvent.change(contact, { target: { value: "0550000000" } }))
    await flush()
    expect(text()).toContain("دُعي في 12 أكتوبر")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
})
