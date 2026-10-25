/**
 * Procurement 2.0 (PKG-05, B-11, SET-02): the subscription as the company sees it — read-only, base and the three
 * connectors, the eight package states each with the right pills; the package chip in the top bar of the Procurement pages;
 * the Settings segment «الاشتراك» for the owner and whoever approves orders; and the delivery site's map link and kinds.
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
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import { PackageChip, showsPackageChip } from "@/components/procurement/PackageChip"
import { SubscriptionPanel } from "@/components/procurement/SubscriptionPanel"
import SettingsPage from "@/app/[locale]/(contractor)/contractor/rfqs/settings/page"
import { PACKAGE_STATES, offFor } from "@/lib/procurement/package"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const text = () => document.body.textContent ?? ""
const count = (needle: string) => text().split(needle).length - 1

const LABEL: Record<string, string> = {
  full: "الكاملة",
  base: "الأساسية",
  pm: "الأساسية + المشاريع",
  fin: "الأساسية + المالية",
  mfg: "الأساسية + التصنيع",
  pm_fin: "الأساسية + المشاريع + المالية",
  pm_mfg: "الأساسية + المشاريع + التصنيع",
  fin_mfg: "الأساسية + المالية + التصنيع",
}

function seedCompany(off: string[] | null) {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa" })
  seed(`users/mgr`, { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_mgr", name: "نورة", email: "m@test.sa" })
  seed(`users/exp`, { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_exp", name: "سلمان", email: "e@test.sa" })
  seed(`teamGroups/g_mgr`, { organizationId: ORG, name: "manager", key: null, permissions: ["po.approve"] })
  seed(`teamGroups/g_exp`, { organizationId: ORG, name: "expediter", key: null, permissions: ["po.expedite"] })
  if (off) seed(`companyModules/${ORG}`, { organizationId: ORG, off })
}

describe("the subscription panel is read-only and names the package (B-11)", () => {
  beforeEach(() => {
    setLocale("ar")
    setPathname("/contractor/rfqs/settings", "")
    setSignedIn(ORG)
    missingKeys.clear()
  })

  for (const state of PACKAGE_STATES) {
    it(`the «${state.id}» package: its own pills, no switch to flip`, async () => {
      seedCompany(offFor(state.pkg))
      const view = render(<SubscriptionPanel />)
      await flush()
      const on = Object.values(state.pkg).filter(Boolean).length
      expect(count("ضمن الاشتراك")).toBe(on)
      expect(count("ما يضيفه الاشتراك")).toBe(3 - on)
      expect(count("الباقة الأساسية")).toBe(2)
      expect(text()).toContain(`الباقة: ${LABEL[state.id]}`)
      for (const name of ["المشتريات", "المخزون", "إدارة المشاريع", "المالية", "التصنيع"]) expect(text()).toContain(name)
      expect(text()).toContain("يفتح فريق مدماك الاشتراك من بوابة الإدارة")
      // Addressed to the company, never the admin's onboarding question about it («هل يدير…؟ / هل لديه…؟», UI review).
      expect(text()).not.toMatch(/هل يدير|هل يريد|هل لديه/)
      expect(text()).toContain("إن كنتم تديرون مشاريع")
      expect(document.querySelectorAll('button, input, select, textarea, [role="switch"], [role="checkbox"]')).toHaveLength(0)
      const rows = Array.from(document.querySelectorAll("[data-connector]")) as HTMLElement[]
      expect(rows.map((r) => `${r.dataset.connector}:${r.dataset.subscribed}`)).toEqual([`pm:${state.pkg.pm}`, `fin:${state.pkg.fin}`, `mfg:${state.pkg.mfg}`])
      expect([...missingKeys]).toEqual([])
      view.unmount()
    })
  }

  it("each row opens with its unit's icon, a connector not subscribed greyed and dashed (ST-04)", async () => {
    seedCompany(offFor({ pm: false, fin: true, mfg: false }))
    const view = render(<SubscriptionPanel />)
    await flush()
    const icons = Array.from(document.querySelectorAll("li span.grid > svg")).map((svg) => svg.getAttribute("data-icon"))
    expect(icons).toEqual(["ShoppingCart", "Warehouse", "Building2", "Wallet", "Wrench"])
    const tile = (conn: string) => document.querySelector(`[data-connector="${conn}"] span`) as HTMLElement
    expect(tile("pm").className).toContain("border-dashed")
    expect(tile("fin").className).not.toContain("border-dashed")
    expect(tile("fin").className).toContain("text-success")
    view.unmount()
  })

  it("a connector the company has not got says what it does without it", async () => {
    seedCompany(offFor({ pm: false, fin: true, mfg: false }))
    const view = render(<SubscriptionPanel />)
    await flush()
    expect(text()).toContain("غير مشترك — «طلب مواد» يرفعه الفريق داخل المشتريات")
    expect(text()).toContain("غير مشترك — لا مصدر للورشة ولا «اسأل الورشة»")
    expect(text()).not.toContain("غير مشترك — أمر الشراء المعتمد يصل المالية")
    expect(text()).toContain("أمر الشراء المعتمد يصل المالية التزاماً")
    view.unmount()
  })

  it("speaks English when the page does", async () => {
    setLocale("en")
    seedCompany(["manufacturing"])
    const view = render(<SubscriptionPanel />)
    await flush()
    expect(text()).toContain("Subscription")
    expect(text()).toContain("Package: Base + Projects + Finance")
    expect([...missingKeys]).toEqual([])
    view.unmount()
    setLocale("ar")
  })
})

describe("the Settings segment «الاشتراك»", () => {
  const segmentNames = () => Array.from(document.querySelectorAll('[role="tab"]')).map((b) => (b.textContent || "").trim())
  beforeEach(() => {
    setLocale("ar")
    setPathname("/contractor/rfqs/settings", "")
    missingKeys.clear()
    seedCompany(["payments", "manufacturing"])
  })

  it("the owner and whoever approves orders see it, and it opens the panel", async () => {
    for (const uid of [ORG, "mgr"]) {
      setSignedIn(uid)
      const view = render(<SettingsPage />)
      await flush()
      expect(segmentNames()).toContain("الاشتراك")
      await act(async () => void fireEvent.click(Array.from(document.querySelectorAll('[role="tab"]')).find((b) => (b.textContent || "").trim() === "الاشتراك")!))
      await flush()
      expect(text()).toContain("باقتكم الآن: المشتريات + المشاريع")
      expect(text()).toContain("الباقة: الأساسية + المشاريع")
      expect([...missingKeys]).toEqual([])
      view.unmount()
    }
  })

  it("opens the segment a link names — the prototype's `loc` and `rcv` too, never Policies by mistake (UI review)", async () => {
    setSignedIn(ORG)
    const selected = () => (document.querySelector('[role="tab"][aria-selected="true"]')?.textContent || "").trim()
    for (const [seg, name] of [["sites", "مواقع التسليم"], ["loc", "مواقع التسليم"], ["rcv", "المستلمون"], ["sub", "الاشتراك"]]) {
      setPathname("/contractor/rfqs/settings", `seg=${seg}`)
      const view = render(<SettingsPage />)
      await flush()
      expect(selected()).toBe(name)
      view.unmount()
    }
  })

  it("a member who only expedites does not", async () => {
    setSignedIn("exp")
    const view = render(<SettingsPage />)
    await flush()
    expect(segmentNames()).not.toContain("الاشتراك")
    expect(segmentNames()).toContain("مواقع التسليم")
    view.unmount()
  })
})

describe("the package chip in the top bar", () => {
  beforeEach(() => {
    setLocale("ar")
    setSignedIn(ORG)
    missingKeys.clear()
  })

  it("is on the Procurement pages only", () => {
    for (const p of ["/contractor/rfqs", "/contractor/rfqs/settings", "/contractor/rfqs/abc/offers", "/contractor/goods-received", "/contractor/suppliers", "/contractor/suppliers/x"]) expect(showsPackageChip(p)).toBe(true)
    for (const p of ["/contractor", "/contractor/projects", "/contractor/rfqs-archive", "/supplier/rfqs", "/contractor/crm/leads", null, undefined, ""]) expect(showsPackageChip(p)).toBe(false)
  })

  it("names the company's package, and nothing off the Procurement pages", async () => {
    seedCompany(["project-management"])
    setPathname("/contractor/rfqs/orders", "")
    let view = render(<PackageChip pathname="/contractor/rfqs/orders" />)
    await flush()
    expect(document.querySelector('[data-testid="package-chip"]')?.textContent).toBe("الباقة: الأساسية + المالية + التصنيع")
    view.unmount()
    view = render(<PackageChip pathname="/contractor/projects" />)
    await flush()
    expect(document.querySelector('[data-testid="package-chip"]')).toBeNull()
    view.unmount()
  })

  it("a company with no module document has the full package", async () => {
    seedCompany(null)
    setPathname("/contractor/suppliers", "")
    const view = render(<PackageChip pathname="/contractor/suppliers" />)
    await flush()
    expect(document.querySelector('[data-testid="package-chip"]')?.textContent).toBe("الباقة: الكاملة")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
})

describe("the delivery site's map link and kinds in Settings (SET-02)", () => {
  const open = async () => {
    const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((b) => (b.textContent || "").trim() === "مواقع التسليم")!
    await act(async () => void fireEvent.click(tab))
    await flush()
  }
  beforeEach(() => {
    setLocale("ar")
    setPathname("/contractor/rfqs/settings", "")
    setSignedIn(ORG)
    missingKeys.clear()
  })

  it("lists a site's map link as a link the supplier would open, and edits it with the site", async () => {
    seedCompany(null)
    seed(`procurementSettings/${ORG}`, { organizationId: ORG, deliverySites: [{ id: "s1", kind: "site", name: "فيلا النرجس", city: "الرياض", district: "النرجس", address: "", receiverId: null, mapUrl: "https://maps.app.goo.gl/x" }] })
    const view = render(<SettingsPage />)
    await flush()
    await open()
    const link = Array.from(document.querySelectorAll("a")).find((a) => (a.textContent || "").trim() === "الخريطة") as HTMLAnchorElement
    expect(link.href).toBe("https://maps.app.goo.gl/x")
    expect(link.rel).toContain("noopener")
    await act(async () => void fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "عدّل")!))
    await flush()
    const field = document.querySelector("#ds-map") as HTMLInputElement
    expect(field.value).toBe("https://maps.app.goo.gl/x")
    expect(document.querySelector("#ds-kind")).toBeNull()
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("a site with no default receiver says so in the table: no auto-forward (ST-03)", async () => {
    seedCompany(null)
    seed(`procurementSettings/${ORG}`, { organizationId: ORG, deliverySites: [{ id: "s1", kind: "site", name: "فيلا النرجس", city: "الرياض", district: "النرجس", address: "", receiverId: null }] })
    const view = render(<SettingsPage />)
    await flush()
    await open()
    const row = Array.from(document.querySelectorAll("tbody tr")).find((r) => (r.textContent || "").includes("فيلا النرجس")) as HTMLElement
    expect(row.textContent).toContain("بلا مستلم — لا يُحوَّل تلقائياً")
    view.unmount()
  })

  it("a new site can be a workshop's warehouse only with Manufacturing in the package", async () => {
    for (const [off, hasWorkshop] of [
      [[], true],
      [["manufacturing"], false],
    ] as const) {
      seedCompany([...off])
      const view = render(<SettingsPage />)
      await flush()
      await open()
      await act(async () => void fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "أضف موقعاً")!))
      await flush()
      const kind = document.querySelector("#ds-kind") as HTMLSelectElement
      expect(Array.from(kind.options).map((o) => o.value)).toEqual(hasWorkshop ? ["site", "warehouse", "workshop"] : ["site", "warehouse"])
      view.unmount()
    }
  })

  it("a map link that is not an https address is refused before anything is sent", async () => {
    seedCompany(null)
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({}) }))
    ;(global as unknown as { fetch: unknown }).fetch = fetchMock
    const view = render(<SettingsPage />)
    await flush()
    await open()
    await act(async () => void fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "أضف موقعاً")!))
    await flush()
    await act(async () => void fireEvent.change(document.querySelector("#ds-name")!, { target: { value: "فيلا" } }))
    await act(async () => void fireEvent.change(document.querySelector("#ds-city")!, { target: { value: "الرياض" } }))
    await act(async () => void fireEvent.change(document.querySelector("#ds-map")!, { target: { value: "http://insecure.example.com" } }))
    await act(async () => void fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "احفظ")!))
    await flush()
    expect(text()).toContain("رابط الخريطة غير صالح")
    expect(fetchMock).not.toHaveBeenCalled()
    view.unmount()
  })
})
