/**
 * Procurement 2.0 finish pass, group C — what the screens now show of the prototype: the offer-visibility policy and the tie
 * sentence with the live percent, the receivers' access, the delivery sites' kind lines, the roles row for inviting suppliers, the
 * sidebar's module line, the header's account note, a request that failed with no reason, and the «قريباً» window's notify button.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

const mockToast = jest.fn()
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }))

import React from "react"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import SettingsPage from "@/app/[locale]/(contractor)/contractor/rfqs/settings/page"
import { SidebarProvider } from "@/components/ui/sidebar"
import { RoleSidebar } from "@/components/layout/role-sidebar"
import { SidebarToggle } from "@/components/layout/sidebar-toggle"
import { ReceiverRegister } from "@/components/procurement/ReceiverRegister"
import { DeliverySitesPanel } from "@/components/procurement/DeliverySitesPanel"
import { BnplSoonDialog } from "@/components/procurement/BnplSoonDialog"
import { MyTeamRequests } from "@/components/procurement/MyTeamRequests"
import { OwnerHoldsNote } from "@/components/procurement/settings/OwnerHoldsNote"
import type { ProcReceiver } from "@/lib/procurement/receivers"
import type { ProcActor } from "@/lib/procurement/types"
import type { DeliverySite } from "@/lib/procurement/delivery-sites"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const text = () => document.body.textContent ?? ""
const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const owner: ProcActor = { uid: ORG, name: "المالك", isOwner: true, canApprove: true, canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true }

beforeEach(() => {
  resetFakeDb()
  setLocale("ar")
  setSignedIn(ORG)
  missingKeys.clear()
  mockToast.mockClear()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة", email: "o@test.sa" })
})

async function openSettings() {
  setPathname("/contractor/rfqs/settings", "")
  const view = render(<SettingsPage />)
  await flush()
  return view
}

describe("Settings → policies", () => {
  it("opens with the offer-visibility row, and says the tie band with the percent the company set", async () => {
    const view = await openSettings()
    expect(text()).toContain("ظهور العروض")
    expect(text()).toContain("فور وصولها للمشتريات؛ والمورّد لا يرى أسعار غيره أبداً")
    expect(text()).not.toMatch(/مختوم/)
    expect(text()).toContain("فرق ≤ 0.5% عن الأقل يُعدّ «الأقل» بلا سبب")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("the tie sentence follows the company's own percent", async () => {
    seed(`procurementSettings/${ORG}`, { organizationId: ORG, tieBandPct: 2 })
    const view = await openSettings()
    expect(text()).toContain("فرق ≤ 2% عن الأقل يُعدّ «الأقل» بلا سبب")
    view.unmount()
  })

  it("without Finance an empty accountant's e-mail says it is asked on the first send; with one it does not", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["payments"] })
    let view = await openSettings()
    expect(text()).toContain("فارغ — يُطلب عند أول إرسال")
    view.unmount()
    seed(`procurementSettings/${ORG}`, { organizationId: ORG, accountantEmail: "acc@test.sa" })
    view = await openSettings()
    expect(text()).not.toContain("فارغ — يُطلب عند أول إرسال")
    view.unmount()
  })

  it("the roles table has the row for inviting suppliers, with the buyer's tick", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management", "manufacturing"] })
    const view = await openSettings()
    const segment = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "الأدوار") as HTMLElement
    fireEvent.click(segment)
    await flush()
    const row = Array.from(document.querySelectorAll("tbody tr")).find((r) => (r.textContent ?? "").includes("يدعو مورداً ويضيفه إلى مورّدينا"))
    expect(row).toBeTruthy()
    expect(Array.from(row?.querySelectorAll("td") ?? []).map((td) => (td.textContent ?? "").trim())).toEqual(["مسموح", "مسموح", "مسموح", "غير مسموح", "غير مسموح"])
    view.unmount()
  })
})

describe("Settings → receivers", () => {
  const person = (over: Partial<ProcReceiver>): ProcReceiver => ({
    id: "r1",
    organizationId: ORG,
    name: "أحمد العتيبي",
    title: "أمين المستودع",
    role: "warehouse_keeper",
    module: "inventory",
    phone: "0551002210",
    userId: null,
    warehouseIds: [],
    active: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdById: ORG,
    ...over,
  })

  it("says how each one is reached: his account's «مهامي», or a link and a code", async () => {
    const view = render(<ReceiverRegister receivers={[person({ userId: "u9" }), person({ id: "r2", name: "سالم", userId: null })]} warehouses={[]} actor={owner} orgId={ORG} mayEdit />)
    await flush()
    expect(text()).toContain("الوصول: حسابه: «مهامي»")
    expect(text()).toContain("الوصول: رابط ورمز")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("in English", async () => {
    setLocale("en")
    const view = render(<ReceiverRegister receivers={[person({ userId: "u9" })]} warehouses={[]} actor={owner} orgId={ORG} mayEdit />)
    await flush()
    expect(text()).toContain("Access: His account: My tasks")
    view.unmount()
  })
})

describe("Settings → delivery sites", () => {
  const site = (over: Partial<DeliverySite>): DeliverySite => ({ id: "s", kind: "site", name: "موقع", city: "الرياض", district: "العليا", address: "", receiverId: null, ...over })

  it("names where each kind comes from — Inventory's warehouse, a hand-added one, the workshop's store, a project's site", async () => {
    const sites = [
      site({ id: "wh_1", kind: "warehouse", name: "المستودع المركزي", warehouseId: "1" }),
      site({ id: "w2", kind: "warehouse", name: "مستودع يدوي" }),
      site({ id: "w3", kind: "workshop", name: "مستودع الورشة" }),
      site({ id: "p1", kind: "project", name: "مشروع", projectId: "p1" }),
    ]
    const view = render(<DeliverySitesPanel stored={[]} sites={sites} receivers={[]} mayEdit openRequests={() => 0} pmOn mfgOn />)
    await flush()
    const rows = Array.from(document.querySelectorAll("tbody tr")).map((r) => r.textContent ?? "")
    expect(rows[0]).toContain("مستودع رئيسي · من المخزون")
    expect(rows[1]).toContain("مستودع يدوي")
    expect(rows[1]).not.toContain("من المخزون")
    expect(rows[2]).toContain("مستودع الورشة · أُضيف من التصنيع")
    expect(rows[3]).toContain("أُضيف من إدارة المشاريع")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
})

describe("the sidebar and the header", () => {
  const openSidebar = async (path: string) => {
    setPathname(path, "")
    const view = render(
      <SidebarProvider>
        <RoleSidebar />
        <SidebarToggle />
      </SidebarProvider>
    )
    await flush()
    return view
  }

  it("Procurement's sidebar carries its module line; another module's does not", async () => {
    let view = await openSidebar("/contractor/rfqs/today")
    expect(text()).toContain("الطلبات الواردة · العروض · أوامر الشراء")
    view.unmount()
    view = await openSidebar("/contractor/projects")
    expect(text()).not.toContain("الطلبات الواردة · العروض · أوامر الشراء")
    view.unmount()
  })

  it("the toggle is named «اطوِ القائمة» while the menu is open, and «وسّع القائمة» once it is folded", async () => {
    const view = await openSidebar("/contractor/rfqs/today")
    const toggle = () => document.querySelector('[data-sidebar="trigger"]') as HTMLElement
    expect(toggle().getAttribute("aria-label")).toBe("اطوِ القائمة")
    fireEvent.click(toggle())
    await flush()
    expect(toggle().getAttribute("aria-label")).toBe("وسّع القائمة")
    view.unmount()
  })

  it("the owner is told he holds every procurement action — until he steps back; a member is never told", async () => {
    let view = render(<OwnerHoldsNote />)
    await flush()
    expect(text()).toContain("المالك يملك أفعال المشتريات كلها افتراضياً.")
    view.unmount()
    seed(`procurementSettings/${ORG}`, { organizationId: ORG, ownerStepsBack: true })
    view = render(<OwnerHoldsNote />)
    await flush()
    expect(text()).not.toContain("المالك يملك أفعال المشتريات")
    view.unmount()
    resetFakeDb()
    seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك" })
    seed("teamGroups/g", { organizationId: ORG, name: "g", key: null, permissions: ["po.approve"] })
    seed("users/mem", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g", name: "نورة" })
    setSignedIn("mem")
    view = render(<OwnerHoldsNote />)
    await flush()
    expect(text()).not.toContain("المالك يملك أفعال المشتريات")
    view.unmount()
  })
})

describe("a team request that failed", () => {
  const request = (failed: { why: string; alt: string } | null) => ({
    id: "n1",
    mrKey: "k1",
    no: "ط.م-2026/001",
    src: "team",
    place: { label: "موقع", city: "الرياض", district: "" },
    needBy: "2026-11-01",
    createdAt: "2026-10-20T00:00:00Z",
    requestedFor: { kind: "user", name: "أنا" },
    requestedBy: "أنا",
    note: null,
    st: "fail",
    step: "failed",
    lines: [{ name: "حديد", unit: "طن", qty: 2, kind: "material" }],
    rfqNumber: null,
    poNumber: null,
    promisedDate: null,
    failed,
    withdrawable: false,
  })
  const show = async (failed: { why: string; alt: string } | null) => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: { requests: [request(failed)] } }) })) as unknown as typeof fetch
    const view = render(<MyTeamRequests refreshKey={0} />)
    await flush()
    return view
  }

  it("with no reason recorded says to check with Procurement", async () => {
    const view = await show(null)
    expect(text()).toContain("تعذّر الشراء — راجع المشتريات")
    view.unmount()
  })

  it("with a reason keeps the reason", async () => {
    const view = await show({ why: "انتهى الصنف", alt: "" })
    expect(text()).toContain("تعذّر الشراء: انتهى الصنف")
    expect(text()).not.toContain("راجع المشتريات")
    view.unmount()
  })
})

describe("the pay-later window", () => {
  it("sends the request to be told at launch, closes, and says so", async () => {
    const fetchMock = jest.fn(async () => ({ ok: true })) as unknown as typeof fetch
    global.fetch = fetchMock
    const onOpenChange = jest.fn()
    const view = render(<BnplSoonDialog open onOpenChange={onOpenChange} />)
    await flush()
    expect(text()).toContain("لحسابك وحدّك الائتماني")
    fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("أبلغني حين يُطلق")) as HTMLElement)
    await flush()
    const [url, init] = (fetchMock as unknown as jest.Mock).mock.calls[0] as [string, { body: string; headers: Record<string, string> }]
    expect(url).toBe("/api/procurement/soon-notify")
    expect(JSON.parse(init.body)).toEqual({ topic: "bnpl" })
    expect(init.headers.Authorization).toBe(`Bearer token-${ORG}`)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockToast).toHaveBeenCalledWith({ title: "سنبلغك حين يُطلق الشراء بالأجل." })
    view.unmount()
  })

  it("says it could not save when the server refuses, and stays open", async () => {
    global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch
    const onOpenChange = jest.fn()
    const view = render(<BnplSoonDialog open onOpenChange={onOpenChange} />)
    await flush()
    fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("أبلغني حين يُطلق")) as HTMLElement)
    await flush()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }))
    view.unmount()
  })
})
