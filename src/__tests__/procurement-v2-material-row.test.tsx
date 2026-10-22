/**
 * Procurement 2.0 — the single material row (CAT-02/03/05/06/07), rendered for real in Arabic over the in-memory
 * Firestore: «الأكثر طلباً» adds a material with its usual specs in one tap; «خيارات ▾» on a result fills the row
 * with specs and a quantity; the warranty is a switch with a duration that reaches the RFQ's products; a pasted
 * list matches the tree or waits with «اختر المادة»; what a material is sold in (rolls, bars) rides on the RFQ.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)
const mockPublish = jest.fn()
jest.mock("@/lib/procurement/rfq-lifecycle-client", () => ({ ...jest.requireActual("@/lib/procurement/rfq-lifecycle-client"), publishRfqCall: (input: unknown) => mockPublish(input) }))

import React from "react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import { indexTree } from "@/lib/materials/tree"
import { popularChips } from "@/lib/materials/popular"
import type { MaterialTreeFile } from "@/lib/materials/types"
import {
  blankLine,
  groupsFromRfq,
  lineGaps,
  linesFromPaste,
  newGroup,
  parsePaste,
  rfqLinesDoc,
  unitNote,
  warrantyOf,
  warrantyPatch,
  type EditorGroup,
} from "@/lib/procurement/rfq-editor"
import NewRfqPage from "@/app/[locale]/(contractor)/contractor/rfqs/new/page"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const treeJson = readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")
const index = indexTree((JSON.parse(treeJson) as MaterialTreeFile).roots)
beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => (String(url).includes("material-tree") ? { ok: true, json: async () => JSON.parse(treeJson) } : { ok: false, json: async () => ({}) }))
})

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const text = () => document.body.textContent ?? ""
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === label) as HTMLButtonElement | undefined
const click = async (el: Element | undefined) => {
  expect(el).toBeDefined()
  await act(async () => void fireEvent.click(el!))
  await flush()
}
const day = (n: number) => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

beforeEach(() => {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
  seed(`procurementSettings/${ORG}`, { organizationId: ORG, deliverySites: [{ id: "prj_P1", kind: "project", name: "مجمع الياسمين", city: "الرياض", district: "حي الياسمين", address: "", receiverId: null, projectId: "P1" }] })
  setSignedIn(ORG)
  setPathname("/contractor/rfqs/new", "")
  missingKeys.clear()
})

describe("«الأكثر طلباً» (CAT-03)", () => {
  it("resolves the six chips on the tree by path and spec, with no id in the code", () => {
    const chips = popularChips(index)
    expect(chips.map((c) => c.key)).toEqual(["rebar16", "rebar12", "opc", "block20", "c30", "plasterSand"])
    const rebar = chips[0].hit
    expect(rebar.node.ar).toBe("اسياخ حديد التسليح")
    expect(rebar.preset.map((p) => `${p.spec.ar}=${p.value.ar}`)).toEqual(["المقاس=16 مم", "الدرجة=G60"])
    expect(chips[3].hit.preset.map((p) => p.value.ar)).toEqual(["بلوك اسمنتي مفرغ", "20×20×40 سم"])
    expect(chips[4].hit.preset.map((p) => p.value.ar)).toEqual(["C30"])
    expect(chips[5].hit.preset).toEqual([])
    expect(popularChips(null)).toEqual([])
  })

  it("a chip whose material the platform team hid does not appear", () => {
    const roots = JSON.parse(treeJson).roots as MaterialTreeFile["roots"]
    const hide = (n: MaterialTreeFile["roots"][number]) => {
      if (n.ar === "رمل لياسة") n.hidden = true
      n.children.forEach(hide)
    }
    roots.forEach(hide)
    expect(popularChips(indexTree(roots)).map((c) => c.key)).not.toContain("plasterSand")
  })

  it("sits under the search box with «تصفّح الشجرة», and a tap adds the row with its size and grade and the material's unit", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    expect(text()).toContain("الأكثر طلباً:")
    for (const c of ["حديد 16", "حديد 12", "أسمنت عادي", "بلوك 20 مفرغ", "خرسانة C30", "رمل لياسة", "تصفّح الشجرة"]) expect(button(c)).toBeDefined()
    await click(button("حديد 16"))
    expect(text()).toContain("اسياخ حديد التسليح")
    expect(document.querySelector('button[aria-label="المقاس: 16 مم"]')).not.toBeNull()
    expect(document.querySelector('button[aria-label="الدرجة: G60"]')).not.toBeNull()
    expect(text()).toContain("طن")
    expect(button("حديد 12")).toBeDefined()
    await click(button("حديد 12"))
    expect(document.querySelector('button[aria-label="المقاس: 12 مم"]')).not.toBeNull()
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
})

describe("«خيارات ▾» on a search result (CAT-03)", () => {
  it("opens the material's specs and a quantity inside the search, and «أضِفها» fills the row in one go", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    const box = document.querySelector('input[role="combobox"]') as HTMLInputElement
    await act(async () => void fireEvent.change(box, { target: { value: "اسمنت عادي" } }))
    await flush()
    const opener = document.querySelector('button[aria-label="خيارات الاسمنت العادي"]')
    await click(opener ?? undefined)
    expect(text()).toContain("← النتائج")
    expect(text()).toContain("اختر ما يلزم فقط — والباقي يحدّده المورّد.")
    await click(Array.from(document.querySelectorAll('[role="listbox"] button')).find((b) => (b.textContent || "").trim() === "50 كجم"))
    const qty = document.querySelector('[role="listbox"] input') as HTMLInputElement
    await act(async () => void fireEvent.change(qty, { target: { value: "200" } }))
    await click(button("أضِفها"))
    expect(document.querySelector('button[aria-label="الوزن: 50 كجم"]')).not.toBeNull()
    expect((document.querySelector('input[aria-label="الكمية"]') as HTMLInputElement).value).toBe("200")
    expect(text()).toContain("كيس")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("«← النتائج» goes back to the results without adding a row", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    const box = document.querySelector('input[role="combobox"]') as HTMLInputElement
    await act(async () => void fireEvent.change(box, { target: { value: "اسمنت عادي" } }))
    await click(document.querySelector('button[aria-label="خيارات الاسمنت العادي"]') ?? undefined)
    await click(button("← النتائج"))
    expect(document.querySelector('button[aria-label="خيارات الاسمنت العادي"]')).not.toBeNull()
    expect(document.querySelector('input[aria-label="الكمية"]')).toBeNull()
    view.unmount()
  })
})

describe("the warranty is a switch with a duration (CAT-05)", () => {
  it("switches on at a year, offers 6 months · a year · 2 · 3 · 5 years, and off clears it", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await click(button("حديد 16"))
    const toggle = () => document.querySelector('button[aria-label="يتطلب ضماناً — شغّله أو أطفئه"]') as HTMLButtonElement
    expect(toggle().getAttribute("aria-pressed")).toBe("false")
    expect(document.querySelector('select[aria-label="مدة الضمان"]')).toBeNull()
    await click(toggle())
    const select = document.querySelector('select[aria-label="مدة الضمان"]') as HTMLSelectElement
    expect(select.value).toBe("12")
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["6 أشهر", "سنة", "سنتان", "3 سنوات", "5 سنوات"])
    await act(async () => void fireEvent.change(select, { target: { value: "36" } }))
    expect((document.querySelector('select[aria-label="مدة الضمان"]') as HTMLSelectElement).value).toBe("36")
    await click(toggle())
    expect(document.querySelector('select[aria-label="مدة الضمان"]')).toBeNull()
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("the duration reaches the published RFQ's products, with what the material is sold in — and a deadline of TODAY is accepted", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await click(button("حديد 16"))
    await click(document.querySelector('button[aria-label="يتطلب ضماناً — شغّله أو أطفئه"]') ?? undefined)
    await act(async () => void fireEvent.change(document.querySelector('select[aria-label="مدة الضمان"]')!, { target: { value: "36" } }))
    const box = document.querySelector('input[role="combobox"]') as HTMLInputElement
    await act(async () => void fireEvent.change(box, { target: { value: "سلك شائك" } }))
    await flush()
    const hit = Array.from(document.querySelectorAll('[role="option"]')).find((o) => (o.textContent || "").includes("سلك شائك"))
    await click(hit)
    // each row is drawn twice (the table row and the phone card): the first of every pair is the table's
    const qtys = Array.from(document.querySelectorAll('input[aria-label="الكمية"]')) as HTMLInputElement[]
    expect(qtys).toHaveLength(4)
    await act(async () => void fireEvent.change(qtys[0], { target: { value: "8" } }))
    await act(async () => void fireEvent.change(qtys[2], { target: { value: "100" } }))
    await act(async () => void fireEvent.click(Array.from(document.querySelectorAll('[role="group"][aria-label="المشروع أو موقع التسليم"] button')).find((b) => (b.textContent || "").includes("مجمع الياسمين"))!))
    await flush()
    await click(button("التالي: النشر"))
    const date = document.querySelector('input[type="date"]') as HTMLInputElement
    await act(async () => void fireEvent.change(date, { target: { value: day(-1) } }))
    await click(button("التالي: المراجعة"))
    expect(text()).toContain("مضى هذا التاريخ: اختر اليوم أو بعده.")
    expect(text()).not.toContain("يُنشر طلب واحد")
    await act(async () => void fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: day(0) } }))
    await click(button("التالي: المراجعة"))
    expect(text()).toContain("يُنشر طلب واحد")
    mockPublish.mockImplementation(async (input: { deadline: string }) => ({ id: "R9", number: "RFQ-2026/009", guestUrl: null, reached: 0, closesOn: input.deadline, direct: false, dirOver: false, directEst: null, linkedRequests: 0, edited: false }))
    await click(button("انشر"))
    const sent = mockPublish.mock.calls[0][0] as { deadline: string; doc: { products: Array<Record<string, unknown>> } }
    expect(sent.deadline).toBe(day(0))
    const [rebar, wire] = sent.doc.products
    expect(rebar).toMatchObject({ requiresWarranty: true, warrantyMonths: 36, unitOfMeasure: "طن" })
    expect(rebar.saleUnits).toBeUndefined()
    expect(wire).toMatchObject({ requiresWarranty: false })
    expect(wire.warrantyMonths).toBeUndefined()
    expect((wire.saleUnits as Array<{ ar: string; lengthM: number }>).map((u) => [u.ar, u.lengthM])).toEqual([
      ["لفة 25 م", 25],
      ["لفة 50 م", 50],
    ])
    view.unmount()
  })

  it("reads a year for an RFQ or a BOQ item that only said «requires a warranty», and keeps the duration it was given", () => {
    expect(warrantyOf({ requiresWarranty: true })).toBe(12)
    expect(warrantyOf({ warrantyMonths: 60, requiresWarranty: true })).toBe(60)
    expect(warrantyOf({})).toBeNull()
    expect(warrantyPatch(null)).toEqual({ warrantyMonths: null, requiresWarranty: false })
    const groups: EditorGroup[] = [newGroup({ city: "الرياض", lines: [{ ...blankLine(), name: "حديد", quantity: "1", unit: "طن", ...warrantyPatch(24) }] })]
    const doc = rfqLinesDoc(groups, "ar", () => null, { draft: true })
    expect(doc.products[0]).toMatchObject({ requiresWarranty: true, warrantyMonths: 24 })
    const back = groupsFromRfq({ products: doc.products, editorGroups: [] })
    expect(back[0].lines[0]).toMatchObject({ warrantyMonths: 24, requiresWarranty: true })
    const legacy = groupsFromRfq({ products: [{ name: "x", quantity: 1, unitOfMeasure: "طن", requiresWarranty: true }], editorGroups: [] })
    expect(legacy[0].lines[0].warrantyMonths).toBe(12)
    const none = groupsFromRfq({ products: [{ name: "x", quantity: 1, unitOfMeasure: "طن", warrantyMonths: 7 }], editorGroups: [] })
    expect(none[0].lines[0].warrantyMonths).toBeNull()
  })
})

describe("«الصق من إكسل» (CAT-07)", () => {
  const rows = parsePaste("اسياخ حديد التسليح 16\t8\tطن\nشي مجهول تماماً\t3\tحبة\nالاسمنت العادي\t100\tحبة\n")

  it("matches the tree where one material fits; the rest waits with «اختر المادة»; a unit that differs from the material's is kept and said", () => {
    expect(rows.map((r) => [r.name, r.quantity, r.unit])).toEqual([
      ["اسياخ حديد التسليح 16", "8", "طن"],
      ["شي مجهول تماماً", "3", "حبة"],
      ["الاسمنت العادي", "100", "حبة"],
    ])
    const lines = linesFromPaste(rows, index)
    expect(lines[0].material?.path.at(-1)?.ar).toBe("اسياخ حديد التسليح")
    expect(lines[0].material?.specs.map((s) => s.value.ar)).toEqual(["16 مم"])
    expect(lineGaps(lines[1])).toEqual(["material"])
    expect(lines[1].material).toBeNull()
    expect(lines[2].material?.path.at(-1)?.ar).toBe("الاسمنت العادي")
    expect(unitNote(lines[2], index)).toEqual({ kind: "differs", units: ["كيس", "طن"] })
    expect(lines[2].unit).toBe("حبة")
  })

  it("the dialog adds the rows and the editor says which one needs its material", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await click(button("الصق من إكسل"))
    const area = document.querySelector('textarea[aria-label="الصق من إكسل"]') as HTMLTextAreaElement
    await act(async () => void fireEvent.change(area, { target: { value: "اسياخ حديد التسليح 16\t8\tطن\nشي مجهول تماماً\t3\tحبة" } }))
    await click(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim().startsWith("أضِف")))
    expect(text()).toContain("اسياخ حديد التسليح")
    expect(text()).toContain("شي مجهول تماماً")
    await click(button("التالي: النشر"))
    expect(text()).toContain("اختر المادة أو فئتها الفرعية في الصف 2")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
})
