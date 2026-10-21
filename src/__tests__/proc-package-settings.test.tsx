/**
 * Procurement 2.0 — Settings (SET-01, SET-04, PRD §4 row 12, §14): the policies carry the module that owns them and are the
 * OWNER's alone; whoever approves orders reads them and keeps the delivery sites; the roles table is the PRD's matrix, its
 * requester column and the workshop's reply window following the package.
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
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import SettingsPage from "@/app/[locale]/(contractor)/contractor/rfqs/settings/page"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"

function world(options: { off?: string[] } = {}) {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة", email: "o@test.sa" })
  seed("teamGroups/g_manager", { organizationId: ORG, name: "manager", key: null, permissions: ["po.approve", "offers.accept", "projects.view"] })
  seed("users/mgr", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_manager", name: "نورة", email: "m@test.sa" })
  seed("teamGroups/g_follower", { organizationId: ORG, name: "follower", key: null, permissions: ["po.expedite", "projects.view"] })
  seed("users/fol", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_follower", name: "سلمان", email: "f@test.sa" })
  if (options.off) seed(`companyModules/${ORG}`, { organizationId: ORG, off: options.off })
}

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

async function open(uid: string) {
  setSignedIn(uid)
  setPathname("/contractor/rfqs/settings", "")
  missingKeys.clear()
  const view = render(<SettingsPage />)
  await flush()
  return view
}

const text = () => document.body.textContent ?? ""
const buttons = () => Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim())
async function pick(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === label)
  if (!button) throw new Error(`no segment ${label}`)
  fireEvent.click(button)
  await flush()
}
const numberInputs = () => Array.from(document.querySelectorAll('input[type="number"]')) as HTMLInputElement[]

describe("the policies (§14)", () => {
  it("name the module that owns each, in the customer's words", async () => {
    world()
    const view = await open(ORG)
    expect([...missingKeys]).toEqual([])
    for (const label of [
      "الموعد النهائي الافتراضي للعروض",
      "مدة دورة العروض · الترسية والاعتماد",
      "آخر يوم للطلب",
      "مهلة قبول المورد للأمر",
      "تصعيد ما لم يُعدّ",
      "التعادل في المقارنة",
      "حدّ المنافسة",
      "سقف الأمر المباشر بلا عروض · نافذة التجزئة",
      "حدّ اعتماد مدير المشتريات",
      "دفعة مقدّمة لمورّد بلا سجل",
      "مهلة ردّ المخزون قبل الشراء",
      "نسبة السماح في الاستلام",
      "مهلة ردّ الورشة (نصنّع أم نشتري)",
      "التحويل التلقائي للمستلم",
    ])
      expect({ label, shown: text().includes(label) }).toEqual({ label, shown: true })
    for (const chip of ["من الإعدادات والحوكمة", "من المالية", "من المخزون", "من التصنيع"]) expect({ chip, shown: text().includes(chip) }).toEqual({ chip, shown: true })
    expect(text()).not.toMatch(/\b(proc|prj|inv|fin|mfg|sup):[A-Z]/)
    view.unmount()
  })

  it("show the defaults of the PRD as placeholders: 3 days, 10 days lead, 0.5%, 2 days to escalate, 1 day to accept", async () => {
    world()
    const view = await open(ORG)
    const placeholders = numberInputs().map((i) => i.placeholder)
    const has = (needle: string) => placeholders.some((p) => p.includes(needle))
    expect(["150,000", "5,000", "20,000", "0.5%", "5%"].filter((n) => !has(n))).toEqual([])
    expect(placeholders.filter((p) => p === "1").length).toBeGreaterThanOrEqual(3)
    view.unmount()
  })

  it("the workshop's reply window follows Manufacturing; the manager's limit says «من المالية» only with Finance", async () => {
    world({ off: ["manufacturing", "payments"] })
    const view = await open(ORG)
    expect(text()).not.toContain("مهلة ردّ الورشة")
    const limit = Array.from(document.querySelectorAll("p")).find((p) => p.textContent === "حدّ اعتماد مدير المشتريات")
    expect(limit?.parentElement?.textContent).not.toContain("من المالية")
    expect(limit?.parentElement?.textContent).toContain("من الإعدادات والحوكمة")
    view.unmount()
  })

  it("belong to the owner: the owner can save, the manager who approves orders only reads", async () => {
    world()
    let view = await open(ORG)
    expect(numberInputs().every((i) => !i.disabled)).toBe(true)
    expect(buttons()).toContain("احفظ")
    view.unmount()
    view = await open("mgr")
    expect(text()).toContain("السياسات يعدّلها المالك وحده")
    expect(numberInputs().every((i) => i.disabled)).toBe(true)
    expect(buttons()).not.toContain("احفظ")
    view.unmount()
  })
})

describe("the roles table (§4)", () => {
  it("is the matrix of the PRD: thirteen rows and five columns without Project Management", async () => {
    world({ off: ["project-management", "manufacturing"] })
    const view = await open(ORG)
    await pick("الأدوار")
    const head = Array.from(document.querySelectorAll("thead th")).map((h) => (h.textContent ?? "").trim())
    expect(head).toEqual(["ما يفعله", "مالك الشركة", "مدير المشتريات", "مسؤول المشتريات", "متابع التوريد", "طالب مواد"])
    expect(document.querySelectorAll("tbody tr")).toHaveLength(13)
    for (const row of ["يرى الأسعار والقيم", "يصعّد تسليماً لم يُعدّ", "يضبط السياسات والمواقع والمستلمين", "يرى الاشتراك (قراءة فقط)", "يسجّل سنداً يدوياً لشراء خارج المنصة"])
      expect({ row, shown: text().includes(row) }).toEqual({ row, shown: true })
    expect(text()).toContain("المواقع والمستلمون")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("«يسأل الورشة» joins the matrix with Manufacturing", async () => {
    world({ off: ["project-management"] })
    const view = await open(ORG)
    await pick("الأدوار")
    expect(document.querySelectorAll("tbody tr")).toHaveLength(14)
    expect(text()).toContain("يسأل الورشة: نصنّع أم نشتري")
    view.unmount()
  })

  it("with Project Management there is no requester and no «يرفع طلب مواد»", async () => {
    world()
    const view = await open(ORG)
    await pick("الأدوار")
    const head = Array.from(document.querySelectorAll("thead th")).map((h) => (h.textContent ?? "").trim())
    expect(head).not.toContain("طالب مواد")
    expect(text()).not.toContain("يرفع «طلب مواد»")
    view.unmount()
  })

  it("the expediter reads the matrix without a riyal limit; whoever sees prices reads «حتى 150,000»", async () => {
    world()
    let view = await open(ORG)
    await pick("الأدوار")
    expect(text()).toContain("حتى 150,000")
    view.unmount()
    view = await open("fol")
    await pick("الأدوار")
    expect(text()).not.toContain("حتى 150,000")
    view.unmount()
  })
})
