/**
 * Procurement 2.0 (ED-02/03/04, WF-08): the editor's delivery place as chips, «+ موقع جديد» that adds the place and
 * picks it at once, and the optional delivery options per place — rendered for real over the in-memory Firestore, in Arabic.
 * The server's route is simulated at `fetch` (its own test is `procurement-v2-sites.test.ts`).
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
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, fireEvent, render } from "@testing-library/react"
import { listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import { todayDay } from "@/lib/pm/format"
import { normaliseMapUrl } from "@/lib/procurement/delivery-site-input"
import type { DeliverySite } from "@/lib/procurement/delivery-sites"
import NewRfqPage from "@/app/[locale]/(contractor)/contractor/rfqs/new/page"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const tree = readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")
const posted: Array<{ url: string; body: { site: Record<string, unknown> } }> = []

// The route, as far as the screen can tell: it stores the site in the settings document and answers with it.
const serverFetch = async (url: string, init?: { body?: string }) => {
  if (String(url).includes("material-tree")) return { ok: true, json: async () => JSON.parse(tree) }
  if (String(url).includes("/api/procurement/delivery-sites")) {
    const body = JSON.parse(init?.body || "{}") as { site: Record<string, unknown> }
    posted.push({ url: String(url), body })
    const mapUrl = body.site.mapUrl ? normaliseMapUrl(body.site.mapUrl) : null
    const saved = { id: `site_new${posted.length}`, ...body.site, ...(mapUrl ? { mapUrl } : {}), address: "", receiverId: body.site.receiverId || null }
    const doc: { deliverySites?: DeliverySite[] } = readDoc<{ deliverySites?: DeliverySite[] }>(`procurementSettings/${ORG}`) || {}
    seed(`procurementSettings/${ORG}`, { ...doc, organizationId: ORG, deliverySites: [...(doc.deliverySites || []), saved] })
    return { ok: true, json: async () => ({ success: true, data: { site: saved } }) }
  }
  return { ok: false, json: async () => ({}) }
}
beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(serverFetch)
})

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

const text = () => document.body.textContent ?? ""
const buttons = (root: ParentNode = document) => Array.from(root.querySelectorAll("button")) as HTMLButtonElement[]
const chipsOf = (index = 0) => document.querySelectorAll('[role="group"][aria-label="المشروع أو موقع التسليم"]')[index] as HTMLElement
const chip = (group: ParentNode, label: string) => buttons(group).find((b) => (b.textContent || "").includes(label))
const click = async (el: Element | undefined) => {
  expect(el).toBeDefined()
  await act(async () => void fireEvent.click(el!))
  await flush()
}
const press = async (label: string) => click(buttons().find((b) => (b.textContent || "").trim().startsWith(label)))

async function addIronRow() {
  const box = document.querySelector('input[role="combobox"]') as HTMLInputElement
  await act(async () => void fireEvent.change(box, { target: { value: "حديد 16" } }))
  await flush()
  await click(Array.from(document.querySelectorAll('[role="option"]')).find((o) => (o.textContent || "").includes("اسياخ حديد التسليح")))
  await act(async () => void fireEvent.change(document.querySelector('input[aria-label="الكمية"]') as HTMLInputElement, { target: { value: "8" } }))
}

const publish = async () => {
  await press("التالي: النشر")
  await press("التالي: المراجعة")
  await press("انشر")
  await flush()
}

describe("the editor's delivery place and options (ED-02/03/04)", () => {
  beforeEach(() => {
    resetFakeDb()
    posted.length = 0
    seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
    seed(`projects/P1`, { organizationId: ORG, contractorId: ORG, name: "مجمع الياسمين", status: "in_progress", projectManagerId: ORG, enabledSections: ["procure"], pm: { no: "PJ-2026/001", lifecycle: "live", startOn: todayDay(), durationDays: 200 } })
    seed(`procurementSettings/${ORG}`, {
      organizationId: ORG,
      deliverySites: [
        { id: "prj_P1", kind: "project", name: "مجمع الياسمين", city: "الرياض", district: "حي الياسمين", address: "", receiverId: null, projectId: "P1" },
        { id: "s2", kind: "site", name: "برج العليا", city: "الرياض", district: "العليا", address: "", receiverId: null },
        { id: "old", kind: "site", name: "موقع قديم", city: "جدة", district: "", address: "", receiverId: null, retired: true },
      ],
    })
    setSignedIn(ORG)
    setPathname("/contractor/rfqs/new", "")
    missingKeys.clear()
  })

  it("the place is a chip per site — a retired one is not offered — and pressing one fills the group's city and district", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    expect(document.querySelector('select[aria-label="المشروع أو موقع التسليم"]')).toBeNull()
    const group = chipsOf()
    expect(group).toBeDefined()
    const names = buttons(group).map((b) => (b.textContent || "").trim())
    expect(names).toEqual(expect.arrayContaining(["مجمع الياسمين", "برج العليا", "موقع جديد"]))
    expect(names).not.toContain("موقع قديم")
    expect(chip(group, "برج العليا")!.getAttribute("aria-pressed")).toBe("false")
    await click(chip(group, "برج العليا"))
    expect(chip(chipsOf(), "برج العليا")!.getAttribute("aria-pressed")).toBe("true")
    expect(text()).toContain("الرياض — العليا")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("a place another group of the request uses is disabled, with its hint", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await click(chip(chipsOf(), "مجمع الياسمين"))
    await click(buttons().find((b) => (b.textContent || "").includes("مشروع آخر أو موقع تسليم")))
    expect(document.querySelectorAll('[role="group"][aria-label="المشروع أو موقع التسليم"]')).toHaveLength(2)
    const taken = chip(chipsOf(1), "مجمع الياسمين")!
    expect(taken.disabled).toBe(true)
    expect(taken.getAttribute("title")).toBe("في مجموعة أخرى من الطلب")
    expect(chip(chipsOf(1), "برج العليا")!.disabled).toBe(false)
    // The first group keeps its own place chosen and enabled.
    expect(chip(chipsOf(0), "مجمع الياسمين")).toMatchObject({ disabled: false })
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("WF-08: «+ موقع جديد» adds the place, picks it at once, and names the request after it", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await addIronRow()
    await click(chip(chipsOf(), "موقع جديد"))
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent).toContain("موقع تسليم جديد")
    expect(dialog.textContent).toContain("يرى المورّد المدينة والحي فقط")

    // The name and the city are required: the dialog says so and writes nothing.
    await click(buttons(dialog).find((b) => (b.textContent || "").includes("أضِف واختره")))
    expect(dialog.textContent).toContain("اكتب اسم الموقع.")
    expect(dialog.textContent).toContain("اختر المدينة.")
    expect(posted).toHaveLength(0)

    await act(async () => void fireEvent.change(dialog.querySelector("#nl-name")!, { target: { value: "مستودع الخرج" } }))
    await click(buttons(dialog).find((b) => (b.textContent || "").includes("مستودع")))
    await act(async () => void fireEvent.change(dialog.querySelector("#nl-city")!, { target: { value: "الخرج" } }))
    await act(async () => void fireEvent.change(dialog.querySelector("#nl-district")!, { target: { value: "حي السلي" } }))
    await act(async () => void fireEvent.change(dialog.querySelector("#nl-map")!, { target: { value: "http://insecure.example.com/x" } }))
    await click(buttons(dialog).find((b) => (b.textContent || "").includes("أضِف واختره")))
    expect(dialog.textContent).toContain("رابط الخريطة غير صالح")
    expect(posted).toHaveLength(0)
    await act(async () => void fireEvent.change(dialog.querySelector("#nl-map")!, { target: { value: "maps.app.goo.gl/abc" } }))
    await click(buttons(dialog).find((b) => (b.textContent || "").includes("أضِف واختره")))

    expect(posted).toHaveLength(1)
    expect(posted[0].body.site).toMatchObject({ name: "مستودع الخرج", kind: "warehouse", city: "الخرج", district: "حي السلي", mapUrl: "https://maps.app.goo.gl/abc" })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(chip(chipsOf(), "مستودع الخرج")!.getAttribute("aria-pressed")).toBe("true")
    expect(text()).toContain("الخرج — حي السلي")

    await publish()
    const rfqs = listCollection<Record<string, unknown>>("rfqs").filter((r) => r.status === "New")
    expect(rfqs).toHaveLength(1)
    expect(String(rfqs[0].title)).toContain("مستودع الخرج")
    expect(rfqs[0]).toMatchObject({ city: "الخرج", district: "حي السلي" })
    expect((rfqs[0].editorGroups as Array<Record<string, unknown>>)[0]).toMatchObject({ siteId: "site_new1", label: "مستودع الخرج" })
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("a refused save (not the owner's or the approver's) leaves the dialog open and says why", async () => {
    ;(global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: false, json: async () => ({ error: true, code: "FORBIDDEN" }) }))
    const view = render(<NewRfqPage />)
    await flush()
    await click(chip(chipsOf(), "موقع جديد"))
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    await act(async () => void fireEvent.change(dialog.querySelector("#nl-name")!, { target: { value: "فيلا" } }))
    await act(async () => void fireEvent.change(dialog.querySelector("#nl-city")!, { target: { value: "الرياض" } }))
    await click(buttons(dialog).find((b) => (b.textContent || "").includes("أضِف واختره")))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(listCollection("procurementSettings")).toHaveLength(1)
    expect(chip(chipsOf(), "فيلا")).toBeUndefined()
    view.unmount()
  })

  it("the delivery options are optional, toggle off when pressed again, and reach the RFQ per place", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await addIronRow()
    await click(chip(chipsOf(), "مجمع الياسمين"))
    for (const label of ["التسليم", "اختياري", "التنزيل على المورّد", "التنزيل علينا", "صباحاً", "مساءً", "أي وقت", "ملاحظة للوصول"]) expect(text()).toContain(label)
    const press1 = (label: string) => click(buttons().find((b) => (b.textContent || "").trim() === label))
    await press1("التنزيل علينا")
    expect(buttons().find((b) => (b.textContent || "").trim() === "التنزيل علينا")!.getAttribute("aria-pressed")).toBe("true")
    await press1("التنزيل علينا")
    expect(buttons().find((b) => (b.textContent || "").trim() === "التنزيل علينا")!.getAttribute("aria-pressed")).toBe("false")
    await press1("التنزيل على المورّد")
    await press1("صباحاً")
    await press1("ملاحظة للوصول")
    const note = document.querySelector('input[aria-label="ملاحظة للوصول"]') as HTMLInputElement
    expect(note.placeholder).toContain("البوابة الشمالية")
    await act(async () => void fireEvent.change(note, { target: { value: "البوابة الشمالية، والطريق يتسع لشاحنة 12 م" } }))

    await publish()
    const rfq = listCollection<Record<string, unknown>>("rfqs").find((r) => r.status === "New")!
    expect(rfq.deliveryOptions).toEqual({ prj_P1: { unload: "supplier", slot: "am", note: "البوابة الشمالية، والطريق يتسع لشاحنة 12 م" } })
    expect((rfq.editorGroups as Array<Record<string, unknown>>)[0].delivery).toEqual(rfq.deliveryOptions && (rfq.deliveryOptions as Record<string, unknown>).prj_P1)
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("an RFQ published with no delivery option carries an empty set, not a missing one", async () => {
    const view = render(<NewRfqPage />)
    await flush()
    await addIronRow()
    await click(chip(chipsOf(), "مجمع الياسمين"))
    await publish()
    const rfq = listCollection<Record<string, unknown>>("rfqs").find((r) => r.status === "New")!
    expect(rfq.deliveryOptions).toEqual({})
    view.unmount()
  })
})
