/**
 * Admin → Free suppliers and Admin → Subscribed suppliers, over the real message files: the free journey's companies
 * apart from the full plan's, the five numbers, the seven chips, the search, approving a company and moving it to the full plan.
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
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import AdminFreeSuppliersPage from "@/app/[locale]/(admin)/admin/free-suppliers/page"
import AdminSuppliersPage from "@/app/[locale]/(admin)/admin/suppliers/page"

installDomShims()
jest.setTimeout(60_000)

const FILE = { url: "https://files/x.pdf" }
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const text = () => document.body.textContent ?? ""
const kpi = (id: string) => document.querySelector(`[data-kpi="${id}"] b`)?.textContent
const chip = (label: string) => Array.from(document.querySelectorAll("button[aria-pressed]")).find((b) => (b.textContent ?? "").trim().startsWith(label)) as HTMLButtonElement
const rowOf = (name: string) => Array.from(document.querySelectorAll("tbody tr")).find((r) => (r.textContent ?? "").includes(name)) as HTMLElement | undefined
const inRow = (name: string, label: string) => rowOf(name)?.querySelector(`button[aria-label^="${label}"]`) as HTMLButtonElement | null | undefined
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === label) as HTMLButtonElement | undefined

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

beforeEach(() => {
  resetFakeDb()
  setLocale("ar")
  missingKeys.clear()
  seed("users/adm", { role: "Admin", name: "Admin A", email: "a@x.sa" })
  setSignedIn("adm")
  setPathname("/admin/free-suppliers")

  // Free: signed up herself, documents sent and asked to be approved, has quoted twice this month and has an order.
  seed("users/fa1", { role: "Supplier", name: "خالد", companyName: "شركة النور", phone: "+966500000001", city: "الرياض", specializations: ["رخام"], organizationId: "fa1", organizationRole: "owner", signupSource: "self", createdAt: ago(3), legalDocuments: { cr: FILE, vat: FILE }, verificationRequested: true })
  // Free: invited by a contractor, no documents yet.
  seed("users/fb1", { role: "Supplier", name: "سعد", companyName: "مؤسسة الأفق", phone: "+966500000002", organizationId: "fb1", organizationRole: "owner", invitedBy: "con1", createdAt: ago(20) })
  // Free: approved, came through a guest offer.
  seed("users/fc1", { role: "Supplier", name: "ماجد", companyName: "شركة الريان", phone: "+966500000003", organizationId: "fc1", organizationRole: "owner", isVerified: true, createdAt: ago(60), legalDocuments: { cr: FILE, vat: FILE } })
  // Paid: the full plan.
  seed("users/pd1", { role: "Supplier", name: "شركة الأساس المشتركة", phone: "+966500000009", organizationId: "pd1", organizationRole: "owner", isVerified: true, createdAt: ago(200), legalDocuments: { cr: FILE, vat: FILE } })
  seed("companyPlans/pd1", { organizationId: "pd1", supplierPlan: "full" })
  seed("offers/o1", { organizationId: "fa1", createdAt: ago(0.01), updatedAt: ago(0.01) })
  seed("offers/o2", { organizationId: "fa1", createdAt: ago(0.02), updatedAt: ago(0.02) })
  seed("offers/o3", { organizationId: "fc1", wasGuestOffer: true, createdAt: ago(90), updatedAt: ago(90) })
  seed("purchaseOrders/po1", { supplierOrgId: "fa1" })
  seed("purchaseOrders/po2", { supplierOrgId: "pd1" })
})

describe("Admin → Free suppliers", () => {
  const open = async () => {
    const view = render(<AdminFreeSuppliersPage />)
    await flush()
    return view
  }

  it("lists the free companies and not the subscribed one", async () => {
    await open()
    expect(text()).toContain("الموردون المجانيون")
    for (const name of ["شركة النور", "مؤسسة الأفق", "شركة الريان"]) expect(rowOf(name)).toBeTruthy()
    expect(text()).not.toContain("شركة الأساس المشتركة")
    expect(missingKeys.size).toBe(0)
  })

  it("counts the five numbers over the free companies", async () => {
    await open()
    expect(kpi("total")).toBe("3")
    expect(kpi("waiting")).toBe("1")
    expect(kpi("joined7")).toBe("1")
    expect(kpi("joined30")).toBe("2")
    expect(kpi("active")).toBe("1")
  })

  it("says how each company came, from the stored mark, the invitation mark and the claimed guest offer", async () => {
    await open()
    expect(rowOf("شركة النور")?.textContent).toContain("تسجيل ذاتي")
    expect(rowOf("مؤسسة الأفق")?.textContent).toContain("أضافه مقاول")
    expect(rowOf("شركة الريان")?.textContent).toContain("من عرض ضيف")
  })

  it("shows the approval state, the quotes this month and the orders of each company", async () => {
    await open()
    expect(rowOf("شركة النور")?.textContent).toContain("بانتظار الاعتماد")
    expect(rowOf("مؤسسة الأفق")?.textContent).toContain("مستندات ناقصة")
    expect(rowOf("شركة الريان")?.textContent).toContain("معتمد")
    const cells = Array.from(rowOf("شركة النور")?.querySelectorAll("td") ?? []).map((c) => c.textContent)
    expect(cells).toContain("2")
    await waitFor(() => expect(Array.from(rowOf("شركة النور")?.querySelectorAll("td") ?? []).map((c) => c.textContent)).toContain("1"))
    await waitFor(() => expect(Array.from(rowOf("مؤسسة الأفق")?.querySelectorAll("td") ?? []).map((c) => c.textContent)).toContain("0"))
  })

  it("shows the quotes against the monthly allowance when the admin set one", async () => {
    seed("platformSettings/supplierQuota", { freeMonthlyQuotes: 30 })
    await open()
    expect(document.querySelector('[data-testid="free-allowance"]')?.textContent).toContain("30")
    expect(Array.from(rowOf("شركة النور")?.querySelectorAll("td") ?? []).map((c) => c.textContent)).toContain("2 / 30")
  })

  it("puts the company waiting for approval first", async () => {
    await open()
    const names = Array.from(document.querySelectorAll("tbody tr")).map((r) => r.textContent ?? "")
    expect(names[0]).toContain("شركة النور")
  })

  it("the chips segment the list and carry the counts of the whole list", async () => {
    await open()
    fireEvent.click(chip("بانتظار الاعتماد"))
    expect(rowOf("شركة النور")).toBeTruthy()
    expect(rowOf("مؤسسة الأفق")).toBeUndefined()
    fireEvent.click(chip("لم يرفعوا المستندات"))
    expect(rowOf("مؤسسة الأفق")).toBeTruthy()
    expect(rowOf("شركة النور")).toBeUndefined()
    fireEvent.click(chip("سجّلوا بأنفسهم"))
    expect(rowOf("شركة النور")).toBeTruthy()
    fireEvent.click(chip("أضافهم مقاول"))
    expect(rowOf("مؤسسة الأفق")).toBeTruthy()
    fireEvent.click(chip("من عرض ضيف"))
    expect(rowOf("شركة الريان")).toBeTruthy()
    expect(rowOf("شركة النور")).toBeUndefined()
    fireEvent.click(chip("معتمدون"))
    expect(rowOf("شركة الريان")).toBeTruthy()
    fireEvent.click(chip("الكل"))
    expect(document.querySelectorAll("tbody tr")).toHaveLength(3)
    expect(chip("الكل").textContent).toContain("3")
  })

  it("the search narrows the list by name, mobile and city, across the chips", async () => {
    await open()
    const box = document.querySelector("input") as HTMLInputElement
    fireEvent.change(box, { target: { value: "الافق" } })
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1)
    expect(rowOf("مؤسسة الأفق")).toBeTruthy()
    fireEvent.change(box, { target: { value: "500000001" } })
    expect(rowOf("شركة النور")).toBeTruthy()
    fireEvent.change(box, { target: { value: "الرياض" } })
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1)
    fireEvent.change(box, { target: { value: "لا أحد" } })
    expect(text()).toContain("لا موردون مجانيون مطابقون")
  })

  it("approving a company marks it verified and tells its owner", async () => {
    await open()
    expect(inRow("مؤسسة الأفق", "اعتماد المنشأة")?.disabled).toBe(true)
    expect(inRow("شركة الريان", "اعتماد المنشأة")).toBeNull()
    await act(async () => void fireEvent.click(inRow("شركة النور", "اعتماد المنشأة") as HTMLButtonElement))
    await flush()
    expect(readDoc("users/fa1")).toMatchObject({ isVerified: true, verificationRequested: false })
    expect(listCollection("users/fa1/notifications")).toEqual([expect.objectContaining({ type: "supplier_approved" })])
    expect(kpi("waiting")).toBe("0")
  })

  it("switching to the full plan asks first, then writes the plan and the company leaves the free list", async () => {
    await open()
    await act(async () => void fireEvent.click(inRow("شركة النور", "نقل إلى الباقة الكاملة") as HTMLButtonElement))
    await flush()
    expect(text()).toContain("نقل شركة النور إلى الباقة الكاملة؟")
    expect(readDoc("companyPlans/fa1")).toBeNull()
    await act(async () => void fireEvent.click(button("انقل إلى الباقة الكاملة") as HTMLButtonElement))
    await flush()
    expect(readDoc("companyPlans/fa1")).toMatchObject({ supplierPlan: "full", organizationId: "fa1", updatedById: "adm" })
    expect(rowOf("شركة النور")).toBeUndefined()
    expect(kpi("total")).toBe("2")
  })

  it("cancelling the confirmation writes nothing", async () => {
    await open()
    await act(async () => void fireEvent.click(inRow("شركة النور", "نقل إلى الباقة الكاملة") as HTMLButtonElement))
    await flush()
    await act(async () => void fireEvent.click(button("إلغاء") as HTMLButtonElement))
    await flush()
    expect(readDoc("companyPlans/fa1")).toBeNull()
    expect(rowOf("شركة النور")).toBeTruthy()
  })

  it("opens the supplier's file with its documents, how it came and its activity, and offers no delete", async () => {
    await open()
    await act(async () => void fireEvent.click(inRow("شركة النور", "فتح ملف المورد") as HTMLButtonElement))
    await flush()
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent).toContain("تفاصيل المورد")
    expect(dialog.textContent).toContain("السجل التجاري (CR)")
    expect(dialog.textContent).toContain("فتح الملف")
    expect(dialog.querySelector('[data-testid="free-facts"]')?.textContent).toContain("تسجيل ذاتي")
    expect(dialog.textContent).not.toContain("حذف الحساب")
    expect(dialog.textContent).toContain("توثيق الحساب")
  })

  it("does not offer to withdraw an approval from the free list", async () => {
    await open()
    await act(async () => void fireEvent.click(inRow("شركة الريان", "فتح ملف المورد") as HTMLButtonElement))
    await flush()
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent).not.toContain("إلغاء التوثيق")
  })

  it("links back to the subscribed suppliers", async () => {
    await open()
    expect(document.querySelector('a[href="/admin/suppliers"]')?.textContent).toContain("الموردون المشتركون")
  })

  it("reads in English too", async () => {
    setLocale("en")
    await open()
    expect(text()).toContain("Free suppliers")
    expect(text()).toContain("Waiting approval")
    expect(rowOf("شركة النور")?.textContent).toContain("Self sign-up")
    expect(missingKeys.size).toBe(0)
  })
})

describe("Admin → Subscribed suppliers", () => {
  const open = async () => {
    setPathname("/admin/suppliers")
    const view = render(<AdminSuppliersPage />)
    await flush()
    return view
  }

  it("lists the full plan's companies only, under the new name", async () => {
    await open()
    expect(text()).toContain("الموردون المشتركون")
    expect(text()).toContain("شركة الأساس المشتركة")
    for (const name of ["خالد", "سعد", "ماجد"]) expect(text()).not.toContain(name)
    expect(missingKeys.size).toBe(0)
  })

  it("links to the free suppliers with their count", async () => {
    await open()
    const link = document.querySelector('[data-testid="free-suppliers-link"]') as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe("/admin/free-suppliers")
    expect(link.textContent).toContain("الموردون المجانيون (3)")
  })

  it("a company moved to the full plan appears here and leaves the free count", async () => {
    seed("companyPlans/fb1", { organizationId: "fb1", supplierPlan: "full" })
    await open()
    expect(text()).toContain("سعد")
    expect((document.querySelector('[data-testid="free-suppliers-link"]') as HTMLElement).textContent).toContain("(2)")
  })

  it("a team member of a free company is not listed either", async () => {
    seed("users/fa1m", { role: "Supplier", name: "عضو الفريق", organizationId: "fa1", organizationRole: "member" })
    await open()
    expect(text()).not.toContain("عضو الفريق")
  })

  it("keeps verifying a company with the same write and notice as before", async () => {
    seed("users/pd2", { role: "Supplier", name: "شركة الدعم", organizationId: "pd2", organizationRole: "owner", createdAt: ago(5), legalDocuments: { cr: FILE, vat: FILE } })
    seed("companyPlans/pd2", { organizationId: "pd2", supplierPlan: "full" })
    await open()
    const row = Array.from(document.querySelectorAll("tbody tr")).find((r) => (r.textContent ?? "").includes("شركة الدعم")) as HTMLElement
    await act(async () => void fireEvent.click(row.querySelector('button[aria-label="توثيق"]') as HTMLButtonElement))
    await flush()
    expect(readDoc("users/pd2")).toMatchObject({ isVerified: true, verificationRequested: false })
    expect(listCollection("users/pd2/notifications")).toEqual([expect.objectContaining({ type: "supplier_approved" })])
  })
})
