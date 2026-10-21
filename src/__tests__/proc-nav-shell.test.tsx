/**
 * Procurement 2.0, NAV-01 / NAV-02 / NAV-06 — the sidebar's Procurement entries (the eight pages, the guide, the two «قريباً»
 * entries, the chats), the counts beside three of them, pay-later's dialog, and the page head's sticky rail that publishes the counts.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)

import React from "react"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import { SidebarProvider } from "@/components/ui/sidebar"
import { RoleSidebar } from "@/components/layout/role-sidebar"
import { noticesToForward, procNavBadges, publishProcNavBadges, readProcNavBadges, subscribeProcNavBadges } from "@/lib/procurement/nav-badges"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const text = () => document.body.textContent ?? ""

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

async function open(pathname = "/contractor/rfqs/today", uid = ORG) {
  setSignedIn(uid)
  setPathname(pathname, "")
  missingKeys.clear()
  const view = render(
    <SidebarProvider>
      <RoleSidebar />
    </SidebarProvider>,
  )
  await flush()
  return view
}

beforeEach(() => {
  resetFakeDb()
  setLocale("ar")
  act(() => publishProcNavBadges({}))
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة", email: "o@test.sa" })
})

describe("the sidebar's Procurement entries", () => {
  it("are the eight pages, the two «قريباً» entries, the guide and the chats — each name once", async () => {
    await open()
    const labels = Array.from(document.querySelectorAll("a, button, [aria-disabled]")).map((e) => (e.textContent ?? "").trim())
    for (const name of ["اليوم", "طلبات الشراء الواردة", "طلبات العروض", "أوامر الشراء", "سندات الاستلام", "الموردون", "التقارير", "الإعدادات", "كيف تعمل المشتريات؟", "محادثاتي"]) {
      expect(labels.filter((l) => l.startsWith(name))).toHaveLength(1)
    }
    expect(text()).toContain("سوق المواد")
    expect(text()).toContain("الشراء بالأجل")
    expect(text()).toContain("الدليل")
    expect(missingKeys.size).toBe(0)
  })

  it("the guide's entry opens the guide; the market's is dimmed text, pay-later's is a button", async () => {
    await open()
    const guide = Array.from(document.querySelectorAll("a")).find((a) => (a.textContent ?? "").includes("كيف تعمل المشتريات؟"))
    expect(guide?.getAttribute("href")).toBe("/contractor/rfqs/guide")
    const market = Array.from(document.querySelectorAll('[aria-disabled="true"]')).find((e) => (e.textContent ?? "").includes("سوق المواد"))
    expect(market).toBeTruthy()
    const bnpl = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("الشراء بالأجل"))
    expect(bnpl).toBeTruthy()
    expect((bnpl?.textContent ?? "")).toContain("قريباً")
  })

  it("pay-later opens its three-step dialog and says it only explains", async () => {
    await open()
    expect(text()).not.toContain("اشترِ الآن وادفع لاحقاً")
    fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("الشراء بالأجل")) as HTMLElement)
    await flush()
    expect(text()).toContain("الشراء بالأجل — قريباً")
    expect(text()).toContain("تختاره عند الترسية")
    expect(text()).toContain("يُدفع للمورد كاملاً")
    expect(text()).toContain("تسدّد الشركة على دفعات")
  })

  it("in English the names are the prototype's", async () => {
    setLocale("en")
    await open()
    for (const name of ["Today", "Incoming requests", "RFQs", "Purchase orders", "Receipts", "Suppliers", "Reports", "Settings", "How Procurement works", "My chats", "Materials market", "Buy now, pay later", "Guide"]) expect(text()).toContain(name)
    expect(text()).not.toContain("Goods receipts")
    expect(text()).not.toContain("Incoming purchase requests")
  })

  it("a member who holds no Procurement permission is not shown the guide's entry", async () => {
    seed("teamGroups/g_hr", { organizationId: ORG, name: "hr", key: null, permissions: ["projects.view"] })
    seed("users/plain", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_hr", name: "موظف", email: "p@test.sa" })
    await open("/contractor/rfqs/today", "plain")
    expect(text()).not.toContain("كيف تعمل المشتريات؟")
  })
})

describe("the counts beside three entries", () => {
  it("nothing is shown until a Procurement page has published its numbers", async () => {
    await open()
    expect(document.querySelectorAll('[data-testid="nav-badge"]')).toHaveLength(0)
  })

  it("Incoming and the RFQs carry a blue count, the receipts to forward a red one — and it follows the page's numbers live", async () => {
    await open()
    act(() => publishProcNavBadges(procNavBadges({ requests: 4, rfqs: 2 }, 3)))
    const badge = (href: string) => {
      const link = Array.from(document.querySelectorAll("a")).find((a) => a.getAttribute("href") === href)
      return link?.querySelector('[data-testid="nav-badge"]') as HTMLElement | null
    }
    expect(badge("/contractor/rfqs/requests")?.textContent).toBe("4")
    expect(badge("/contractor/rfqs/requests")?.className).toContain("bg-cta")
    expect(badge("/contractor/rfqs")?.textContent).toBe("2")
    expect(badge("/contractor/goods-received")?.textContent).toBe("3")
    expect(badge("/contractor/goods-received")?.className).toContain("bg-destructive")
    expect(badge("/contractor/rfqs/orders")).toBeNull()
    act(() => publishProcNavBadges(procNavBadges({ requests: 0, rfqs: 2 }, 0)))
    expect(badge("/contractor/rfqs/requests")).toBeNull()
    expect(badge("/contractor/goods-received")).toBeNull()
    expect(badge("/contractor/rfqs")?.textContent).toBe("2")
  })
})

describe("the counts' builder and store", () => {
  it("builds a badge only for a page that has something waiting", () => {
    expect(procNavBadges({}, 0)).toEqual({})
    expect(procNavBadges({ requests: 1, rfqs: 0, orders: 9, today: 5, receipts: 7 }, 2)).toEqual({
      "/contractor/rfqs/requests": { n: 1, tone: "blue" },
      "/contractor/goods-received": { n: 2, tone: "red" },
    })
  })

  it("counts the notices nobody has been told to receive yet", () => {
    expect(
      noticesToForward([
        { status: "pending_confirmation" },
        { status: "pending_confirmation", forwardedTo: { name: "x" } },
        { status: "pending_confirmation", receiverReport: {} },
        { status: "pending_confirmation", closedByReceipt: "d1" },
        { status: "confirmed" },
        { status: "pending_confirmation" },
      ]),
    ).toBe(2)
  })

  it("tells its listeners once per change and never for an identical set", () => {
    const seen = jest.fn()
    const off = subscribeProcNavBadges(seen)
    act(() => publishProcNavBadges({ "/a": { n: 1, tone: "red" } }))
    act(() => publishProcNavBadges({ "/a": { n: 1, tone: "red" } }))
    act(() => publishProcNavBadges({ "/a": { n: 2, tone: "red" } }))
    off()
    act(() => publishProcNavBadges({}))
    expect(seen).toHaveBeenCalledTimes(2)
    expect(readProcNavBadges()).toEqual({})
  })
})

describe("the page head: a sticky rail that feeds the sidebar's counts (NAV-01, NAV-02)", () => {
  it("renders the rail sticky under the top bar, and publishes the receipts waiting to be forwarded in red", async () => {
    const { ProcurementHeader } = await import("@/components/contractor/ProcurementHeader")
    seed("deliveries/d1", { contractorOrgId: ORG, status: "pending_confirmation", poId: "po1", deliveryDate: "2026-11-01", supplierName: "المورد" })
    seed("deliveries/d2", { contractorOrgId: ORG, status: "pending_confirmation", poId: "po1", deliveryDate: "2026-11-02", supplierName: "المورد", forwardedTo: { name: "مستلم", at: "2026-10-20T00:00:00Z" } })
    setSignedIn(ORG)
    setPathname("/contractor/rfqs/orders", "")
    render(<ProcurementHeader title="أوامر الشراء" description="d" />)
    await flush()
    const rail = document.querySelector('[data-testid="proc-rail"]') as HTMLElement
    expect(rail.className).toContain("sticky")
    expect(rail.className).toContain("top-14")
    expect(readProcNavBadges()["/contractor/goods-received"]).toEqual({ n: 1, tone: "red" })
  })
})
