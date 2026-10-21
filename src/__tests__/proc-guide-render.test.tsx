/**
 * Procurement 2.0, FLW-01..03 / B-10 / R-30 — the guide page over the real message files: it follows the company's package,
 * the package chips only change what the page shows (no write, no request, no call), its buttons are plain links the
 * viewer may follow, and the numbers it quotes are the company's own.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

import fs from "fs"
import path from "path"
import React from "react"
import { act, fireEvent, render } from "@testing-library/react"
import { dumpDb, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import GuidePage from "@/app/[locale]/(contractor)/contractor/rfqs/guide/page"
import { GuideLink } from "@/components/procurement/guide/GuideLink"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const text = () => document.body.textContent ?? ""
const stations = () => Array.from(document.querySelectorAll("[data-station]")).map((e) => e.getAttribute("data-station"))
const chip = (label: string) => Array.from(document.querySelectorAll('[data-testid="guide-package"] button')).find((b) => (b.textContent ?? "").trim() === label) as HTMLButtonElement
const hrefs = () => Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"))

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

async function open(uid = ORG) {
  setSignedIn(uid)
  setPathname("/contractor/rfqs/guide", "")
  missingKeys.clear()
  const view = render(<GuidePage />)
  await flush()
  return view
}

let fetchSpy: jest.Mock

beforeEach(() => {
  resetFakeDb()
  setLocale("ar")
  fetchSpy = jest.fn()
  global.fetch = fetchSpy as unknown as typeof fetch
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة", email: "o@test.sa" })
  seed("teamGroups/g_req", { organizationId: ORG, name: "requester", key: null, permissions: ["projects.view"] })
  seed("users/req", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_req", name: "مهندس", email: "r@test.sa" })
})

describe("the guide follows the company's package", () => {
  it("without Projects: the team's door, the buyer on behalf, Inventory — and the eight stations in the prototype's words", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management", "manufacturing"] })
    await open()
    expect(stations()).toEqual(["request", "incoming", "publish", "offers", "award", "supply", "receive", "close"])
    expect(Array.from(document.querySelectorAll("[data-source]")).map((e) => e.getAttribute("data-source"))).toEqual(["team", "buy", "inv"])
    expect(text()).toContain("كيف تعمل المشتريات")
    expect(text()).toContain("الترسية والأمر")
    expect(text()).toContain("ما لا يتغيّر بين الباقات")
    expect(missingKeys.size).toBe(0)
  })

  it("with the full package: the projects replace the team, the workshop joins", async () => {
    await open()
    expect(Array.from(document.querySelectorAll("[data-source]")).map((e) => e.getAttribute("data-source"))).toEqual(["pm", "inv", "mfg"])
    expect(document.querySelector('[data-station="request"]')?.textContent).toContain("إدارة المشاريع")
    expect(document.querySelector('[data-station="close"]')?.textContent).toContain("الفاتورة والمطابقة الثلاثية والصرف عند المالية")
  })

  it("quotes the company's own approval limit at the award", async () => {
    seed(`procurementSettings/${ORG}`, { organizationId: ORG, managerApprovalLimit: 240000 })
    await open()
    expect(document.querySelector('[data-station="award"]')?.textContent).toContain("240,000")
  })

  it("speaks English with the prototype's English names", async () => {
    setLocale("en")
    await open()
    expect(text()).toContain("How Procurement works")
    expect(text()).toContain("Award and order")
    expect(text()).toContain("Closing and payment")
    expect(missingKeys.size).toBe(0)
  })
})

describe("the package chips preview and never write (B-10, R-30)", () => {
  it("turning a connector on or off redraws the page and leaves the database and the network untouched", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management", "manufacturing", "payments", "hr"] })
    await open()
    const before = dumpDb()
    expect(document.querySelector('[data-station="request"]')?.textContent).toContain("طالب المواد")
    fireEvent.click(chip("إدارة المشاريع"))
    fireEvent.click(chip("التصنيع"))
    fireEvent.click(chip("المالية"))
    expect(document.querySelector('[data-station="request"]')?.textContent).toContain("إدارة المشاريع")
    expect(Array.from(document.querySelectorAll("[data-source]")).map((e) => e.getAttribute("data-source"))).toEqual(["pm", "inv", "mfg"])
    expect(document.querySelector('[data-testid="guide-legend"]')?.textContent).toContain("الورشة")
    expect(dumpDb()).toBe(before)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("says it is a preview and gives the way back to the company's own package", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: [] })
    await open()
    expect(text()).toContain("معاينة هنا فقط — الاشتراك يُضبط من بوابة الإدارة.")
    fireEvent.click(chip("إدارة المشاريع"))
    expect(text()).toContain("عُد إلى باقتي")
    expect(document.querySelector('[data-station="request"]')?.getAttribute("data-station")).toBe("request")
    const back = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "عُد إلى باقتي") as HTMLElement
    fireEvent.click(back)
    expect(document.querySelector('[data-station="request"]')?.textContent).toContain("إدارة المشاريع")
    expect(text()).toContain("معاينة هنا فقط — الاشتراك يُضبط")
  })

  it("a company WITH Projects previewing a team package is told the preview creates nothing", async () => {
    await open()
    fireEvent.click(chip("إدارة المشاريع"))
    expect(document.querySelector('[data-station="request"]')?.textContent).toContain("معاينة فقط: في اشتراككم تصل الطلبات من «إدارة المشاريع»، فلا تُنشئ المعاينة طلباً.")
  })

  it("the guide's components do not import anything that creates a request", () => {
    const dir = path.join(process.cwd(), "src", "components", "procurement", "guide")
    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(path.join(dir, file), "utf8")
      expect(source).not.toMatch(/RaiseMaterialRequest|addDoc|setDoc|updateDoc|runTransaction|writeBatch|fetch\(/)
    }
  })
})

describe("the buttons are plain links the viewer may follow", () => {
  it("the owner is offered every door; none is a button that acts", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management"] })
    await open()
    expect(hrefs()).toEqual(expect.arrayContaining(["/contractor/rfqs/requests", "/contractor/rfqs/new", "/contractor/rfqs", "/contractor/chats", "/contractor/goods-received", "/contractor/rfqs/orders", "/contractor/rfqs/my-requests"]))
    expect(document.querySelectorAll('[data-station] button')).toHaveLength(0)
  })

  it("a requester with no Procurement permission is not shown the pages he cannot open, and goes back to «طلباتي»", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management"] })
    await open("req")
    const all = hrefs()
    expect(all).not.toContain("/contractor/rfqs/new")
    expect(all).not.toContain("/contractor/rfqs/orders")
    expect(all).toContain("/contractor/rfqs/my-requests")
    expect(all).toContain("/contractor/chats")
    const strip = Array.from(document.querySelectorAll("a")).find((a) => (a.textContent ?? "").includes("عُد إلى المشتريات"))
    expect(strip?.getAttribute("href")).toBe("/contractor/rfqs/my-requests")
  })

  it("the owner's way back is Today", async () => {
    await open()
    const strip = Array.from(document.querySelectorAll("a")).find((a) => (a.textContent ?? "").includes("عُد إلى المشتريات"))
    expect(strip?.getAttribute("href")).toBe("/contractor/rfqs/today")
  })
})

describe("GuideLink", () => {
  it("is the door from Incoming and from «طلباتي», with each page's own words", () => {
    setLocale("ar")
    const { container } = render(
      <>
        <GuideLink />
        <GuideLink variant="mine" />
      </>,
    )
    const links = Array.from(container.querySelectorAll("a"))
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/contractor/rfqs/guide", "/contractor/rfqs/guide"])
    expect(links.map((a) => a.textContent)).toEqual(["كيف تعمل المشتريات؟", "كيف يسير طلبي بعد الإرسال؟"])
  })
})
