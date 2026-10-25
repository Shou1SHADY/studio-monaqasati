/**
 * Procurement 2.0, ADM-01..04 / WF-22 — the admin's screens over the real message files: the contractor's page (needs
 * suggest, five shortcuts, three connector cards, «what changes» before the save, the acknowledgement), the contractors list
 * (a package column, the strip of four numbers) and «المسار والعقود» (36 events, the eight rules, the eight states).
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => {
  const world = jest.requireActual("@/test-utils/render-world")
  const React = jest.requireActual<typeof import("react")>("react")
  return {
    ...world.firebaseMock,
    useUser: () => {
      const base = world.firebaseMock.useUser()
      const user = React.useMemo(() => (base.user ? { ...base.user, getIdToken: async () => "tok" } : null), [base.user])
      return { ...base, user }
    },
  }
})
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

import React from "react"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, pushed, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import { ContractorPackagePage } from "@/components/admin/packages/ContractorPackagePage"
import { ContractorPackagePreview } from "@/components/admin/packages/ContractorPackagePreview"
import { PipelineContractPage } from "@/components/admin/packages/PipelineContractPage"
import AdminContractorsPage from "@/app/[locale]/(admin)/admin/contractors/page"
import { EVENTS } from "@/lib/procurement/package-data"

installDomShims()
jest.setTimeout(60_000)

const ORG = "org1"
const text = () => document.body.textContent ?? ""
const byLabel = (label: string) => document.querySelector(`[role="switch"][aria-label="${label}"]`) as HTMLElement
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === label) as HTMLButtonElement | undefined

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

type Call = { url: string; method: string; body: Record<string, unknown> | null }
let calls: Call[] = []
let impactBody: Record<string, unknown> = { from: {}, to: {}, off: [], changes: [], hrDependent: false, projectsCapped: false, scanCap: 300, warnings: [] }
let saveStatus = 200

beforeEach(() => {
  resetFakeDb()
  setLocale("ar")
  pushed.length = 0
  missingKeys.clear()
  calls = []
  saveStatus = 200
  impactBody = { changes: [], hrDependent: false, projectsCapped: false, scanCap: 300, warnings: [] }
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const call: Call = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null }
    calls.push(call)
    if (call.method === "POST") return { ok: saveStatus === 200, status: saveStatus, json: async () => (saveStatus === 200 ? { success: true, data: { unchanged: false, off: [], changed: [] } } : { error: true, code: "ACK_REQUIRED" }) } as Response
    return { ok: true, status: 200, json: async () => ({ success: true, data: impactBody }) } as Response
  }) as unknown as typeof fetch
  seed("users/adm", { role: "Admin", name: "Admin A", email: "a@x.sa" })
  seed(`users/${ORG}`, { role: "Contractor", name: "شركة البنيان", city: "الرياض", organizationId: ORG, organizationRole: "owner", isVerified: true })
  setSignedIn("adm")
  setPathname(`/admin/contractors/${ORG}`)
})

describe("the contractor's package page", () => {
  const open = async (off?: string[], needs?: Record<string, unknown>) => {
    if (off) seed(`companyModules/${ORG}`, { organizationId: ORG, off, ...(needs ? { needs } : {}) })
    const view = render(<ContractorPackagePage orgId={ORG} />)
    await flush()
    return view
  }

  it("shows the company, its package name, the three questions, three connector cards and the five shortcuts", async () => {
    await open(["manufacturing"], { pm: 1, fin: 1, mfg: 0 })
    expect(text()).toContain("شركة البنيان")
    expect(document.querySelector('[data-testid="package-label"]')?.textContent).toBe("الأساسية + المشاريع + المالية")
    expect(document.querySelectorAll("[data-conn]").length).toBeGreaterThanOrEqual(3)
    for (const name of ["الأساسية", "مقاول بلا محاسبة", "مقاول", "مصنع", "الكاملة"]) expect(button(name)).toBeTruthy()
    expect(text()).toContain("هل يدير مشاريع لها مواقع وجداول كميات")
    expect(missingKeys.size).toBe(0)
  })

  it("a company with no document is the full package", async () => {
    await open()
    expect(document.querySelector('[data-testid="package-label"]')?.textContent).toBe("الكاملة")
  })

  it("a «yes» to a need the package does not have is warned, and a «no» to one it does have is questioned", async () => {
    await open(["manufacturing"], { pm: 1, fin: 1, mfg: 1 })
    expect(text()).toContain("أجاب «نعم» عن هذا الاحتياج وهو مغلق.")
    await open([], { mfg: 0 })
    expect(text()).toContain("مفتوح مع أن جوابه «لا» — تأكّد أنه يحتاجه.")
  })

  it("WF-22: opening Manufacturing shows its rule and the sentence, then the save posts the new list", async () => {
    await open(["manufacturing"], { pm: 1, fin: 1, mfg: 1 })
    impactBody = { changes: [{ conn: "mfg", to: "on", impact: {} }], hrDependent: false, projectsCapped: false, scanCap: 300, warnings: [] }
    fireEvent.click(byLabel("التصنيع"))
    await waitFor(() => expect(text()).toContain("تُسأل الورشة من الآن عن الرخام والجرانيت والحجر"), { timeout: 3000 })
    expect(text()).toContain("يُفتح: التصنيع")
    expect(text()).toContain("يُضاف مستودع الورشة موقع تسليم")
    const impactCall = calls.find((c) => c.method === "GET")
    expect(impactCall?.url).toContain(`orgId=${ORG}`)
    expect(impactCall?.url).toContain("off=")
    const save = button("احفظ الباقة") as HTMLButtonElement
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true))
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ orgId: ORG, off: [], needs: { pm: 1, fin: 1, mfg: 1 } })
  })

  it("closing Manufacturing names the workshop's unanswered questions and the answers that stay, and the save waits for the acknowledgement", async () => {
    await open([])
    impactBody = {
      changes: [{ conn: "mfg", to: "off", impact: { workshopAsksUnanswered: 3, workshopAnswersWithWorkOrder: 1 } }],
      hrDependent: false,
      projectsCapped: false,
      scanCap: 300,
      warnings: [],
    }
    fireEvent.click(byLabel("التصنيع"))
    await waitFor(() => expect(document.querySelector('[data-testid="impact-mfg"]')).toBeTruthy(), { timeout: 3000 })
    const sentence = document.querySelector('[data-testid="impact-mfg"]')?.textContent ?? ""
    expect(sentence).toContain("3 أسئلة")
    expect(sentence).toContain("ردّ واحد")
    const save = button("احفظ الباقة") as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(document.querySelector('[data-testid="impact-panel"] input[type="checkbox"]') as HTMLElement)
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true))
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ off: ["manufacturing"], ack: true })
  })

  it("closing Finance says HR goes with it, locks HR's switch, and a company over the cap is told the count is 300+", async () => {
    await open([])
    impactBody = {
      changes: [{ conn: "fin", to: "off", impact: { ordersAwaitingPayment: 2, advancesRequested: 1 } }],
      hrDependent: true,
      projectsCapped: true,
      scanCap: 300,
      warnings: [],
    }
    fireEvent.click(byLabel("المالية"))
    await waitFor(() => expect(document.querySelector('[data-testid="impact-fin"]')).toBeTruthy(), { timeout: 3000 })
    expect(document.querySelector('[data-testid="impact-fin"]')?.textContent).toContain("أمران")
    expect(text()).toContain("إغلاق المالية والمحاسبة يُغلق معه")
    expect(text()).toContain("أكثر من 300 مشروع")
    expect((byLabel("الموارد البشرية") as HTMLButtonElement).disabled).toBe(true)
    expect(byLabel("الموارد البشرية").getAttribute("aria-checked")).toBe("false")
  })

  it("a shortcut sets the whole package; undo returns to the stored one; nothing is posted before Save", async () => {
    await open([])
    fireEvent.click(button("الأساسية") as HTMLElement)
    expect(document.querySelector('[data-testid="package-label"]')?.textContent).toBe("الأساسية")
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0)
    fireEvent.click(button("تراجع") as HTMLElement)
    expect(document.querySelector('[data-testid="package-label"]')?.textContent).toBe("الكاملة")
    expect(text()).toContain("الباقة محفوظة كما هي.")
  })

  it("answering a need question alone enables Save and posts the answer without any impact lookup", async () => {
    await open([])
    const group = document.querySelector('[role="group"][aria-label="إدارة المشاريع"]') as HTMLElement
    fireEvent.click(Array.from(group.querySelectorAll("button")).find((b) => b.textContent === "نعم") as HTMLElement)
    const save = button("احفظ الباقة") as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true))
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(0)
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ needs: { pm: 1 } })
  })

  it("a company that does not exist says so", async () => {
    render(<ContractorPackagePage orgId="ghost" />)
    await flush()
    expect(text()).toContain("لم نجد هذا المقاول")
  })

  it("never offers to open the contractor's portal", async () => {
    await open([])
    expect(text()).not.toContain("افتح بوابته")
    expect(document.querySelector('a[href^="/contractor"]')).toBeNull()
  })
})

describe("the subscription status and the read-only preview (AD-01, AD-03)", () => {
  const open = async (data?: Record<string, unknown>) => {
    if (data) seed(`companyModules/${ORG}`, { organizationId: ORG, ...data })
    const view = render(<ContractorPackagePage orgId={ORG} />)
    await flush()
    return view
  }
  const pill = () => document.querySelector("header [data-subscription]")?.textContent

  it("no field is «نشط», beside the verification status that stays", async () => {
    await open([] as never)
    expect(pill()).toBe("اشتراك نشط")
    expect(document.querySelector("header")?.textContent).toMatch(/^شركة البنيانالرياضنشطاشتراك نشط/)
  })

  it("the admin sets «تجريبي» from the page: it waits for Save, then posts with the package", async () => {
    await open({ off: [] })
    const group = document.querySelector('[role="group"][aria-label="حالة الاشتراك"]') as HTMLElement
    fireEvent.click(Array.from(group.querySelectorAll("button")).find((b) => b.textContent === "تجريبي") as HTMLElement)
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0)
    const save = button("احفظ الباقة") as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true))
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ orgId: ORG, subscription: "trial" })
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(0)
  })

  it("a stored «trial» reads «تجريبي»; an unchanged status is not posted", async () => {
    await open({ off: [], subscription: "trial" })
    expect(pill()).toBe("اشتراك تجريبي")
    const group = document.querySelector('[role="group"][aria-label="إدارة المشاريع"]') as HTMLElement
    fireEvent.click(Array.from(group.querySelectorAll("button")).find((b) => b.textContent === "نعم") as HTMLElement)
    fireEvent.click(button("احفظ الباقة") as HTMLElement)
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true))
    expect(calls.find((c) => c.method === "POST")?.body).not.toHaveProperty("subscription")
  })

  it("«اعرض كما يراها» opens the admin's preview — and is disabled while a change is unsaved", async () => {
    await open({ off: [] })
    const link = Array.from(document.querySelectorAll("a")).find((a) => (a.textContent ?? "").includes("اعرض كما يراها")) as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe(`/admin/contractors/${ORG}/preview`)
    fireEvent.click(byLabel("التصنيع"))
    await flush()
    expect(Array.from(document.querySelectorAll("a")).some((a) => (a.textContent ?? "").includes("اعرض كما يراها"))).toBe(false)
    expect((button("اعرض كما يراها") as HTMLButtonElement).disabled).toBe(true)
    expect(text()).toContain("احفظ الباقة أو تراجع أولاً.")
  })

  it("the preview shows the SAVED package read-only: its menu, its subscription panel and how Procurement works — no link into the portal", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["manufacturing"], subscription: "trial" })
    setPathname(`/admin/contractors/${ORG}/preview`)
    render(<ContractorPackagePreview orgId={ORG} />)
    await flush()
    expect(text()).toContain("معاينة للقراءة فقط")
    expect(document.querySelector('[data-testid="preview-package-label"]')?.textContent).toBe("الأساسية + المشاريع + المالية")
    expect(document.querySelector("[data-subscription]")?.textContent).toBe("اشتراك تجريبي")
    const modules = Array.from(document.querySelectorAll('[data-testid="preview-modules"] > li')).map((li) => li.getAttribute("data-module"))
    expect(modules).toContain("procurement")
    expect(modules).not.toContain("manufacturing")
    expect(document.querySelector('[data-testid="preview-hidden"]')?.textContent).toContain("التصنيع")
    expect(document.querySelector('[data-connector="mfg"]')?.getAttribute("data-subscribed")).toBe("false")
    expect(document.querySelectorAll('[data-testid="guide-stations"] [data-station]').length).toBeGreaterThan(0)
    expect(document.querySelector('a[href^="/contractor"]')).toBeNull()
    expect(document.querySelectorAll('button, input, select, [role="switch"]')).toHaveLength(0)
    expect(missingKeys.size).toBe(0)
  })
})

describe("the contractors list (ADM-01)", () => {
  it("adds the package, the version and the strip of four numbers, and opens the page instead of a dialog", async () => {
    seed("users/c2", { role: "Contractor", name: "مؤسسة ركن", organizationId: "c2", organizationRole: "owner" })
    seed("companyModules/c2", { organizationId: "c2", off: ["project-management", "manufacturing"], needs: { pm: 1, fin: 1, mfg: 0 } })
    setPathname("/admin/contractors")
    render(<AdminContractorsPage />)
    await flush(10)
    const kpis = Array.from(document.querySelectorAll('[data-testid="package-kpis"] [data-kpi]')).map((li) => [li.getAttribute("data-kpi"), li.querySelector("b")?.textContent])
    expect(kpis).toEqual([["subscribers", "2"], ["full", "1"], ["no_fin", "0"], ["mismatch", "1"]])
    const labels = Array.from(document.querySelectorAll('[data-testid="version-label"]')).map((e) => e.textContent)
    expect(labels).toEqual(expect.arrayContaining(["الكاملة", "الأساسية + المالية"]))
    expect(text()).toContain("أجاب «نعم» عن المشاريع")
    expect(button("مقاول جديد")).toBeTruthy()
    expect(text()).toContain("المقاولون والباقات")
    expect(missingKeys.size).toBe(0)
  })
})

describe("the contractors list rows (AD-02, AD-03)", () => {
  it("say «{city} · {N} users · since {date}» under the name, carry the subscription status, and the package opens the page", async () => {
    seed(`users/${ORG}`, { role: "Contractor", name: "شركة البنيان", city: "الرياض", organizationId: ORG, organizationRole: "owner", isVerified: true, createdAt: "2026-03-05T08:00:00Z" })
    seed("users/m1", { role: "Contractor", name: "عضو", organizationId: ORG, organizationRole: "member" })
    seed("users/m2", { role: "Supplier", name: "عضو آخر", organizationId: ORG, organizationRole: "member" })
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], subscription: "trial" })
    setPathname("/admin/contractors")
    render(<AdminContractorsPage />)
    await flush(12)
    const row = Array.from(document.querySelectorAll("tbody tr")).find((r) => r.querySelector("span.font-bold")?.textContent === "شركة البنيان") as HTMLElement
    const sub = row.querySelector('[data-testid="contractor-subline"]')?.textContent ?? ""
    expect(sub).toContain("الرياض")
    expect(sub).toContain("3 مستخدمين")
    expect(sub).toMatch(/منذ .*2026/)
    expect(row.querySelector("[data-subscription]")?.textContent).toBe("اشتراك تجريبي")
    const links = Array.from(row.querySelectorAll("a")).map((a) => a.getAttribute("href"))
    expect(links.filter((h) => h === `/admin/contractors/${ORG}`).length).toBe(2)
    expect(missingKeys.size).toBe(0)
  })
})

describe("«المسار والعقود» (ADM-04)", () => {
  beforeEach(() => setPathname("/admin/pipeline"))

  it("lists the 36 events with their keys, the eight rules and the eight states", () => {
    render(<PipelineContractPage />)
    expect(document.querySelectorAll("[data-event]")).toHaveLength(36)
    expect(document.querySelector('[data-testid="contract-count"]')?.textContent).toContain("36")
    expect(document.querySelectorAll('[data-testid="eight-rules"] li')).toHaveLength(8)
    expect(document.querySelectorAll('[data-testid="states-matrix"] tbody tr')).toHaveLength(8)
    for (const e of EVENTS) expect(text()).toContain(e.key)
    expect(missingKeys.size).toBe(0)
  })

  it("filters the contract by unit and shows each unit's count", () => {
    render(<PipelineContractPage />)
    fireEvent.click(button("المالية") as HTMLElement)
    expect(document.querySelectorAll("[data-event]")).toHaveLength(EVENTS.filter((e) => e.unit === "fin").length)
    fireEvent.click(button("الكل") as HTMLElement)
    expect(document.querySelectorAll("[data-event]")).toHaveLength(36)
  })

  it("trying a package dots a closed connector with its fallback and lights it when open", () => {
    render(<PipelineContractPage />)
    const box = () => document.querySelector('[data-testid="package-pipeline"] [data-unit="fin"]')
    expect(box()?.getAttribute("data-state")).toBe("on")
    fireEvent.click(byLabel("المالية"))
    expect(box()?.getAttribute("data-state")).toBe("off")
    expect(box()?.textContent).toContain("بدونه:")
  })

  it("in English the same page reads in English", () => {
    setLocale("en")
    render(<PipelineContractPage />)
    expect(text()).toContain("Pipeline and contract")
    expect(text()).toContain("The eight rules")
    expect(text()).toContain("Quote (supplier portal or visitor link)")
    expect(missingKeys.size).toBe(0)
  })
})
