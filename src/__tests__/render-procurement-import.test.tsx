/**
 * Procurement «ارفع ملف إكسل» (IMP 1.3) rendered for real over the in-memory Firestore, in Arabic: the button and the template in
 * step 1 (the paste is gone), the upload window, the review with its two groups and its questions («كم حبة؟»), the rows landing in the
 * editor with their source, the refusals of section 6 of the PRD, and who may upload at all. The server's memory route is simulated
 * at `fetch` (its own test is `procurement-material-memory.test.ts`).
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { getIdToken: async () => "id-token" } }) }))

import React from "react"
import fs from "fs"
import path from "path"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import NewRfqPage from "@/app/[locale]/(contractor)/contractor/rfqs/new/page"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const FIX = path.join(process.cwd(), "src", "test-utils", "fixtures", "boq-import")
const tree = fs.readFileSync(path.join(process.cwd(), "public/data/material-tree.json"), "utf8")
const posted: Array<{ url: string; method: string; body: Record<string, unknown> }> = []

beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (String(url).includes("material-tree")) return { ok: true, json: async () => JSON.parse(tree) }
    if (String(url).includes("/api/procurement/material-memory")) {
      if (init?.method === "POST") posted.push({ url: String(url), method: "POST", body: JSON.parse(init.body || "{}") })
      return { ok: true, json: async () => ({ success: true, data: { entries: [], count: 1 } }) }
    }
    return { ok: false, json: async () => ({}) }
  })
})

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const text = () => document.body.textContent ?? ""
const buttons = () => Array.from(document.querySelectorAll("button")) as HTMLButtonElement[]
const button = (label: string) => buttons().find((b) => (b.textContent || "").trim().includes(label))
const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy()
  await act(async () => void fireEvent.click(el!))
  await flush()
}

const fileOf = (rel: string) => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(FIX, rel)))
  const f = new File([bytes], path.basename(rel))
  Object.defineProperty(f, "arrayBuffer", { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  return f
}
const upload = async (rel: string, label = "ارفع ملف إكسل") => {
  await click(button(label))
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  expect(input).not.toBeNull()
  await act(async () => void fireEvent.change(input, { target: { files: [fileOf(rel)] } }))
  await flush(30)
}
const rows = () => Array.from(document.querySelectorAll('[data-testid="import-row"]')) as HTMLElement[]
const rowOf = (needle: string) => rows().find((r) => (r.textContent || "").includes(needle)) as HTMLElement

beforeEach(() => {
  resetFakeDb()
  posted.length = 0
  missingKeys.clear()
  setLocale("ar")
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
  setSignedIn(ORG)
  setPathname("/contractor/rfqs/new", "")
})

describe("step 1: the button and the template", () => {
  it("«ارفع ملف إكسل» and «قالب مدماك» are there and «الصق من إكسل» is gone", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    expect(text()).toContain("ارفع ملف إكسل")
    expect(text()).toContain("قالب مدماك")
    expect(text()).not.toContain("الصق من إكسل")
    expect(button("ارفع ملف إكسل")!.disabled).toBe(false)
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("«قالب مدماك» downloads the template file", async () => {
    const created: Blob[] = []
    Object.assign(URL, { createObjectURL: (b: Blob) => (created.push(b), "blob:t"), revokeObjectURL: () => {} })
    const view = render(<NewRfqPage />)
    await flush()
    const names: string[] = []
    const original = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      names.push(this.download)
    }
    await click(button("قالب مدماك"))
    HTMLAnchorElement.prototype.click = original
    expect(names).toEqual(["Mdmak-Materials-Template.xlsx"])
    expect(created).toHaveLength(1)
    expect(created[0].size).toBeGreaterThan(1000)
    view.unmount()
  })

  it("a member who cannot create an RFQ sees the button off and why (IMP-01)", async () => {
    seed("users/mem", { organizationId: ORG, organizationRole: "member", name: "سلمان", email: "m@test.sa", isVerified: true, profileCompleted: true })
    setSignedIn("mem")
    const view = render(<NewRfqPage />)
    await flush()
    expect(button("ارفع ملف إكسل")!.disabled).toBe(true)
    expect(text()).toContain("رفع ملف المواد لمن يملك إنشاء طلب عروض")
    view.unmount()
  })
})

describe("the upload window", () => {
  it("asks for a file, with the limits and the template", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await click(button("ارفع ملف إكسل"))
    for (const s of ["اسحب ملف إكسل هنا", "حتى 5 م.ب و500 بند", "حمّل قالب مدماك"]) expect(text()).toContain(s)
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it.each([
    ["boq-27/c19_corrupt.xlsx", "الملف محمي بكلمة مرور أو تالف"],
    ["boq-27/c25_empty.csv", "الملف فارغ"],
    ["boq-27/c21_cover_only.xlsx", "لم نجد في الملف جدولاً فيه مواد وكميات"],
    ["boq-27/c18_large.xlsx", "في الملف أكثر من 500 بند. قسّمه إلى ملفين."],
    ["materials/Mdmak-Materials-Template.xlsx", "وجدنا صف العناوين لكن لا مواد تحته"],
  ])("%s is refused with the PRD's message", async (rel, message) => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload(rel)
    expect(text()).toContain(message)
    expect(document.querySelector('input[type="file"]')).not.toBeNull()
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("a file with no quantity column is a «help us once» with the first rows in front of the user", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("materials/Sample-5-No-Quantity.xlsx")
    expect(text()).toContain("ساعدنا مرة واحدة")
    expect(text()).toContain("ليس في الملف عمود للكمية؟")
    expect(text()).toContain("حديد تسليح")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("choosing the quantity column once reads the sheet: the review follows and the choice is not asked again", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("materials/Sample-5-No-Quantity.xlsx")
    const qty = document.querySelector('select[aria-label="الكمية"]') as HTMLSelectElement
    expect(qty).not.toBeNull()
    const desc = document.querySelector('select[aria-label="اسم المادة أو الوصف"]') as HTMLSelectElement
    expect(desc.value).toBe("0")
    await act(async () => void fireEvent.change(qty, { target: { value: "1" } }))
    await flush()
    expect(document.querySelector('[data-testid="import-help"]')).toBeNull()
    expect(document.querySelector('[data-testid="import-summary"]')).not.toBeNull()
    expect(rows().length).toBeGreaterThan(0)
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
})

describe("the review", () => {
  it("a messy BOQ: 15 lines read, 9 ready, 5 need you, 1 not in the list; works and totals are listed as skipped", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("materials/Sample-3-BOQ-Messy.xlsx")
    const summary = document.querySelector('[data-testid="import-summary"]')!.textContent || ""
    expect(summary).toContain("قرأنا 15 بنداً من ملفك")
    expect(summary).toContain("9 جاهزة")
    expect(summary).toContain("5 تحتاج اختيارك")
    expect(summary).toContain("1 ليست في قائمة المواد")
    expect(text()).toContain("تحتاج اختيارك (5)")
    expect(text()).toContain("جاهزة (9)")
    expect(text()).toContain("تجاهلنا")
    expect(button("أضِف 14 مادة")).toBeDefined()
    expect(rows()).toHaveLength(14)
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("under each material the file’s words stay: «في ملفك: …»", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("materials/Sample-3-BOQ-Messy.xlsx")
    expect(rowOf("حديد 12 مم").textContent).toContain("في ملفك: «حديد 12 مم»")
    expect(rowOf("حديد 12 مم").textContent).toContain("اسياخ حديد التسليح")
    view.unmount()
  })

  it("pipes in metres ask «كم حبة؟» next to «في ملفك 350 متر» — no button keeps the number — and typing the count readies the row", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("samples/BOQ-5-MEP-Quotation.xlsx")
    const row = rowOf("ماسورة PPR حار")
    const qty = row.querySelector('input[aria-label="الكمية"]') as HTMLInputElement
    expect(qty.value).toBe("")
    expect(qty.placeholder).toBe("كم حبة؟")
    expect(row.textContent).toContain("في ملفك 350 متر — وهذه المادة تُطلب بـ«حبة»")
    expect(Array.from(row.querySelectorAll("button")).map((b) => b.textContent)).not.toContain("الوحدة صحيحة")
    expect(document.body.textContent).toContain("تحتاج اختيارك (")
    await act(async () => void fireEvent.change(qty, { target: { value: "٨٠" } }))
    expect((rowOf("ماسورة PPR حار").querySelector('input[aria-label="الكمية"]') as HTMLInputElement).value).toBe("80")
    expect(rowOf("ماسورة PPR حار").textContent).toContain("في ملفك 350 متر")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("kilos of rebar are converted to tons and the file’s number is shown", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("samples/BOQ-4-English-Bills.xlsx")
    const row = rowOf("12 mm diameter")
    expect((row.querySelector('input[aria-label="الكمية"]') as HTMLInputElement).value).toBe("6.8")
    expect(row.textContent).toContain("في ملفك 6800 kg")
    expect(row.textContent).toContain("طن")
    view.unmount()
  })

  it("a work line stays out: «ليست في قائمة المواد» is folded and nothing is added for it", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("materials/Sample-3-BOQ-Messy.xlsx")
    await click(button("ليست في قائمة المواد (1)"))
    expect(text()).toContain("ابحث في القائمة")
    expect(text()).toContain("أضِفها خارج القائمة")
    view.unmount()
  })

  it("«أرجعه» brings a skipped line back and «لا تُضِفه» removes one", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("materials/Sample-3-BOQ-Messy.xlsx")
    await click(document.querySelector('button[aria-label="لا تُضِفه"]'))
    expect(rows()).toHaveLength(13)
    expect(button("أضِف 13 مادة")).toBeDefined()
    await click(button("تجاهلنا"))
    expect(text()).toContain("حذفتَه")
    await click(buttons().filter((b) => (b.textContent || "").trim() === "أرجعه").pop())
    expect(rows().length).toBeGreaterThanOrEqual(14)
    view.unmount()
  })

  it("a pick from the closest three is remembered for the company (and said)", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("samples/BOQ-5-MEP-Quotation.xlsx")
    const row = rowOf("سلك 2.5")
    const select = row.querySelector("select") as HTMLSelectElement
    const nya = Array.from(select.options).find((o) => o.textContent === "سلك NYA")!
    await act(async () => void fireEvent.change(select, { target: { value: nya.value } }))
    await flush()
    expect(posted).toHaveLength(1)
    expect(posted[0].body).toMatchObject({ text: expect.stringContaining("سلك 2.5"), specs: [], brand: null })
    expect(rowOf("سلك 2.5").textContent).toContain("سلك NYA")
    view.unmount()
  })

  it("«ابحث في القائمة» opens the list search and a choice returns to the review", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("samples/BOQ-5-MEP-Quotation.xlsx")
    const select = rowOf("علب كهرباء").querySelector("select") as HTMLSelectElement
    await act(async () => void fireEvent.change(select, { target: { value: "search" } }))
    await flush()
    expect(text()).toContain("اختر المادة من القائمة")
    const box = document.querySelector('input[aria-label="ابحث باسم المادة أو المقاس…"]') as HTMLInputElement
    await act(async () => void fireEvent.change(box, { target: { value: "افياش" } }))
    await flush()
    const hit = Array.from(document.querySelectorAll("li button")).find((b) => (b.textContent || "").includes("افياش"))
    await click(hit)
    expect(document.querySelector('[data-testid="import-rows"]')).not.toBeNull()
    expect(rowOf("علب كهرباء").textContent).toContain("افياش")
    view.unmount()
  })

  it("«ليست في القائمة…» asks the category and keeps the words, flagged «خارج القائمة»", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("samples/BOQ-5-MEP-Quotation.xlsx")
    const select = rowOf("علب كهرباء").querySelector("select") as HTMLSelectElement
    await act(async () => void fireEvent.change(select, { target: { value: "outside" } }))
    await flush()
    expect(text()).toContain("من أي فئة هذه المادة؟")
    await click(document.querySelector('[role="dialog"] ul li button'))
    expect(rowOf("علب كهرباء").textContent).toContain("خارج القائمة")
    view.unmount()
  })
})

describe("«أضِف»: the rows reach the editor with their source", () => {
  it("the materials arrive as the editor’s own rows; what still needs a choice is finished there", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("materials/Sample-1-Template-Filled.xlsx")
    expect(button("أضِف 10 مواد")).toBeDefined()
    await click(button("أضِف 10 مواد"))
    expect(document.querySelector('[data-testid="import-rows"]')).toBeNull()
    expect(text()).toContain("اسياخ حديد التسليح")
    expect(text()).toContain("من ملفك · الصف 2")
    expect(text()).toContain("المقاس")
    expect(text()).toContain("16 مم")
    const qtys = (Array.from(document.querySelectorAll('input[aria-label="الكمية"]')) as HTMLInputElement[]).map((i) => i.value).filter(Boolean)
    expect(qtys).toEqual(expect.arrayContaining(["12", "3000", "85"]))
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("an unconverted unit says what the file said under the unit, and the next step stops on the row that lacks its quantity", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await upload("materials/Sample-1-Template-Filled.xlsx")
    await click(button("أضِف 10 مواد"))
    expect(text()).toContain("في الملف: 30 كيس")
    await click(button("التالي: النشر"))
    expect(Array.from(document.querySelectorAll("p.text-destructive")).map((p) => p.textContent).join(" ")).toContain("اكتب الكمية")
    view.unmount()
  })
})

describe("English", () => {
  it("the window, the review and the editor rows speak English too", async () => {
    setLocale("en")
    const view = render(<NewRfqPage />)
    await flush()
    await upload("materials/Sample-3-BOQ-Messy.xlsx", "Upload an Excel file")
    expect(text()).toContain("We read 15 items from your file")
    expect(text()).toContain("9 ready")
    expect(text()).toContain("Need you (5)")
    await click(buttons().find((b) => /^Add 14 materials/.test((b.textContent || "").trim())))
    expect(text()).toContain("from your file · row")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
})
