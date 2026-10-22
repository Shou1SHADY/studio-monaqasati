/**
 * PUR-04 rendered for real, in Arabic: the one material tree behind every picker. «تصفّح شجرة المواد» is
 * reachable from a row without typing; heavy-equipment rental is not a material; «دليل موردي المنصة» filters by
 * the tree's sub-categories; the admin's account and RFQ dialogs no longer offer the old category list.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)

import React from "react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setSignedIn } from "@/test-utils/render-world"
import { indexTree } from "@/lib/materials/tree"
import type { MaterialTreeFile } from "@/lib/materials/types"
import { MaterialSearchInput } from "@/components/materials/MaterialSearchInput"
import { SupplierDirectory } from "@/components/procurement/SupplierDirectory"
import { keyLabel } from "@/lib/materials/subs"
import { displayCategory } from "@/lib/constants"
import { EMPTY_SUPPLIER_FILTER } from "@/lib/procurement/supplier-list"
import { CreateAccountDialog } from "@/components/admin/CreateAccountDialog"
import { CreateMdmakRfqDialog } from "@/components/admin/CreateMdmakRfqDialog"
import { specialtyKeys } from "@/lib/materials/subs"

// The directory is read a page at a time from the server (SUP-01, NFR-03); the tree words it filters by are the screen's.
let mockDirectory: { rows: unknown[]; matched: number; total: number; remaining: number; more: number; facets: { specialties: Array<[string, number]>; cities: Array<[string, number]> }; loading: boolean; failed: boolean; loadMore: () => void; ready: boolean }
jest.mock("@/hooks/useSupplierDirectory", () => ({ ...jest.requireActual("@/hooks/useSupplierDirectory"), usePlatformDirectory: () => mockDirectory }))

installDomShims()
jest.setTimeout(60_000)

const treeJson = readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")
const index = indexTree((JSON.parse(treeJson) as MaterialTreeFile).roots)
const rebar = index.subs.find((s) => s.ar === "حديد التسليح")!.id

beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => (String(url).includes("material-tree") ? { ok: true, json: async () => JSON.parse(treeJson) } : { ok: false, json: async () => ({}) }))
})
beforeEach(() => {
  resetFakeDb()
  setSignedIn("admin1")
  missingKeys.clear()
})

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const text = () => document.body.textContent ?? ""

describe("«تصفّح شجرة المواد» from a row", () => {
  const mount = (props: Partial<React.ComponentProps<typeof MaterialSearchInput>> = {}) => {
    const onBrowse = jest.fn()
    const onFreeText = jest.fn()
    const view = render(<MaterialSearchInput index={index} onPick={jest.fn()} onBrowse={onBrowse} onFreeText={onFreeText} {...props} />)
    return { onBrowse, onFreeText, ...view }
  }

  it("is offered on an empty focused input, without typing a letter", () => {
    const { onBrowse } = mount()
    fireEvent.focus(document.querySelector("input")!)
    const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent?.includes("تصفّح شجرة المواد"))
    expect(option).toBeDefined()
    expect(document.body.textContent).not.toContain("غير موجود؟ اكتبه كما هو")
    fireEvent.click(option!)
    expect(onBrowse).toHaveBeenCalledWith("")
  })

  it("is a small action on the row all the time", () => {
    const { onBrowse } = mount()
    fireEvent.click(document.querySelector('button[aria-label="تصفّح شجرة المواد"]')!)
    expect(onBrowse).toHaveBeenCalledWith("")
  })

  it("says a heavy-equipment rental is not a material, and keeps it as typed under «المعدات › معدات أخرى»", () => {
    const { onFreeText } = mount()
    const input = document.querySelector("input")!
    fireEvent.change(input, { target: { value: "إيجار حفار" } })
    expect(text()).toContain("إيجار المعدات الثقيلة ليس مادة")
    expect(text()).toContain("معدات أخرى")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onFreeText).toHaveBeenCalledWith("إيجار حفار")
  })

  it("with Project Management on, sends the rental to its equipment desk instead of the list", () => {
    const { onFreeText } = mount({ pmOn: true })
    const input = document.querySelector("input")!
    fireEvent.change(input, { target: { value: "تأجير رافعة" } })
    expect(text()).toContain("مكتب المعدات في إدارة المشاريع")
    expect(document.body.textContent).not.toContain("غير موجود؟ اكتبه كما هو")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onFreeText).not.toHaveBeenCalled()
  })
})

describe("«دليل موردي المنصة» reads the tree", () => {
  const card = (orgId: string, subIds: string[], categories: string[]) => ({
    orgId,
    name: `مورد ${orgId}`,
    city: "الرياض",
    coverageCities: [],
    specialties: specialtyKeys(index, subIds, categories),
    since: "2025-01-01",
    verified: true,
    hasProfile: false,
    hasWorks: false,
    hasCerts: false,
    completedOps: 0,
    judgedOrders: 0,
    onTimePercent: null,
    rejectPercent: null,
    rating: null,
    reviewAvg: null,
    reviewCount: 0,
    updatedAt: "2026-10-21T00:00:00Z",
    ours: false,
  })

  it("offers the tree's sub-categories as the specialty filter (with their counts), and an older category name is still there to pick", async () => {
    const rows = [card("a", [rebar], []), card("b", [], ["خرسانة جاهزة"])]
    const facets = new Map<string, number>()
    for (const r of rows) for (const k of r.specialties) facets.set(k, (facets.get(k) || 0) + 1)
    mockDirectory = { rows, matched: 2, total: 2, remaining: 0, more: 0, facets: { specialties: [...facets.entries()], cities: [["الرياض", 2]] }, loading: false, failed: false, loadMore: () => {}, ready: true }
    const onFilter = jest.fn()
    render(
      <SupplierDirectory
        filter={EMPTY_SUPPLIER_FILTER}
        onFilter={onFilter}
        layout="rows"
        onLayout={jest.fn()}
        specialtyLabel={(k) => keyLabel(index, k, "ar", displayCategory)}
        mineIds={new Set()}
        onOpen={jest.fn()}
      />
    )
    await flush()
    const options = Array.from(document.querySelectorAll("option")).map((o) => o.textContent)
    expect(options).toContain("حديد التسليح · 1")
    expect(options.some((o) => o?.startsWith("خرسانة جاهزة"))).toBe(true)
    expect(document.body.textContent).toContain("حديد التسليح")
    const select = document.querySelectorAll("select")[0] as HTMLSelectElement
    await act(async () => void fireEvent.change(select, { target: { value: rebar } }))
    expect(onFilter).toHaveBeenCalledWith({ ...EMPTY_SUPPLIER_FILTER, specialty: rebar })
    expect(Array.from(missingKeys)).toEqual([])
  })
})

describe("the admin's dialogs use the tree", () => {
  it("creating a supplier account picks specialties from the material tree, not the old sixteen categories", async () => {
    render(<CreateAccountDialog lead={{ id: "l1", source: "demo", name: "فهد", company: "مصنع الشرق", email: "f@x.sa", phone: "0555", kind: "supplier" }} onOpenChange={jest.fn()} />)
    await flush()
    expect(text()).toContain("الحديد")
    expect(document.querySelector('input[placeholder="ابحث بفئة فرعية أو بمادة تحتها"]')).not.toBeNull()
    expect(text()).not.toContain("حديد ومعادن")
    expect(Array.from(missingKeys)).toEqual([])
  })

  it("an RFQ for the platform's own account picks a material from the tree, not a category and a sub-category", async () => {
    render(<CreateMdmakRfqDialog open onClose={jest.fn()} />)
    await flush()
    expect(document.querySelector('input[aria-label="اكتب اسم المادة… مثل «حديد 16» أو «بلوك 20»"]')).not.toBeNull()
    expect(text()).not.toContain("الفئة الرئيسية")
    expect(Array.from(missingKeys)).toEqual([])
  })
})
