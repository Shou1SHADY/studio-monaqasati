/**
 * Procurement 2.0 — the editor and publishing gaps against the prototype (ED-03…20, ED-22, SP-05), rendered in Arabic:
 * focus to the new row's quantity and back, words kept «كما هو» when the window is dismissed, a group with rows removed
 * after a confirm, the paste toast, the footer's «مشروع» count, every spec as a cell, the search result's other specs and
 * its Enter tag, the browse window's captions and Enter, direct award as the private list's rows (pre-selected), each
 * supplier's sub-categories, the review's per-sub-category warning, private names and delivery options, the success
 * panel's message preview, «أبلغني حين يُطلق», and «+ موقع جديد» for whoever builds the request.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => {
  const { useMemo } = jest.requireActual("react")
  const base = jest.requireActual("@/test-utils/render-world").firebaseMock
  return {
    ...base,
    useUser: () => {
      const r = base.useUser()
      const user = useMemo(() => (r.user ? { ...r.user, getIdToken: async () => "tok" } : null), [r.user])
      return { ...r, user }
    },
  }
})
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { getIdToken: async () => "tok" } }) }))

import React from "react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import NewRfqPage from "@/app/[locale]/(contractor)/contractor/rfqs/new/page"
import { MaterialSpecCells } from "@/components/materials/MaterialSpecCells"
import { MaterialSearchInput } from "@/components/materials/MaterialSearchInput"
import { MaterialBrowserDialog } from "@/components/materials/MaterialBrowserDialog"
import { EditorPublish, type PublishValues } from "@/components/procurement/rfq-editor/EditorPublish"
import { EditorReview, type ReviewModel } from "@/components/procurement/rfq-editor/EditorReview"
import { RfqPublishedPanel } from "@/components/procurement/rfq-editor/RfqPublishedPanel"
import { BnplSoonDialog } from "@/components/procurement/rfq-editor/BnplSoonDialog"
import { orderRecipients } from "@/components/contractor/SupplierRecipientsPicker"
import { indexTree, pickOf } from "@/lib/materials/tree"
import { linesFromPaste, parsePaste, pasteSummary } from "@/lib/procurement/rfq-editor"
import { siteWriteRefusal } from "@/lib/procurement/delivery-sites"
import type { MaterialTreeFile } from "@/lib/materials/types"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const tree = readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")
const index = indexTree((JSON.parse(tree) as MaterialTreeFile).roots)
const calls: Array<{ url: string; body: Record<string, unknown> | null }> = []

beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    const u = String(url)
    if (u.includes("material-tree")) return { ok: true, json: async () => JSON.parse(tree) }
    calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : null })
    if (u.includes("/api/rfq-share/create")) return { ok: true, json: async () => ({ success: true, data: { url: "https://mdmaktech.sa/rfq/tok", expiresAt: null, invites: [] } }) }
    if (u.includes("/api/rfq-share/preview"))
      return { ok: true, json: async () => ({ success: true, data: { rfq: { title: "بلك", lines: [{}, {}], places: [], closeDay: null }, contractorName: "شركة البنيان", stats: { opens: 0 } } }) }
    return { ok: true, json: async () => ({ success: true, data: {} }) }
  })
})

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const text = () => document.body.textContent ?? ""
const buttons = () => Array.from(document.querySelectorAll("button")) as HTMLButtonElement[]
const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy()
  await act(async () => void fireEvent.click(el!))
  await flush()
}
const byText = (label: string) => buttons().find((b) => (b.textContent || "").trim().includes(label))
const box = () => document.querySelector('input[role="combobox"]') as HTMLInputElement
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => void fireEvent.change(el, { target: { value } }))
  await flush()
}

describe("pure helpers", () => {
  it("the paste toast counts matched rows, rows left on «اختر المادة», and units flagged (ED-09)", () => {
    const lines = linesFromPaste(parsePaste("اسياخ حديد التسليح 16\t8\tطن\nشيء لا يوجد\t3\tحبة\nاسياخ حديد التسليح 12\t2\tكيس"), index, { unitFromMaterial: true })
    expect(pasteSummary(lines)).toEqual({ matched: 2, noMaterial: 1, unitFlagged: 1 })
  })
  it("recipients: favourites, then «مختص», then by name (ED-14)", () => {
    const facts = new Map([["c", { onTime: null, crExpired: false, matches: true }]])
    const order = orderRecipients(
      [
        { orgId: "a", name: "ألف", isFavorite: false },
        { orgId: "b", name: "باء", isFavorite: true },
        { orgId: "c", name: "جيم", isFavorite: false },
      ],
      facts,
    ).map((o) => o.orgId)
    expect(order).toEqual(["b", "c", "a"])
  })
  it("«+ موقع جديد»: whoever builds a request adds; only an approver changes or retires a stored site (ED-22)", () => {
    const only = (p: string) => (q: string) => q === p
    expect(siteWriteRefusal(only("rfq.manage"), false, false)).toBeNull()
    expect(siteWriteRefusal(only("rfq.create"), false, false)).toBeNull()
    expect(siteWriteRefusal(only("offers.accept"), false, false)).toBeNull()
    expect(siteWriteRefusal(only("rfq.manage"), true, false)).toBe("FORBIDDEN")
    expect(siteWriteRefusal(only("rfq.manage"), false, true)).toBe("FORBIDDEN")
    expect(siteWriteRefusal(only("po.approve"), true, true)).toBeNull()
    expect(siteWriteRefusal(only("deliveries.confirm"), false, false)).toBe("FORBIDDEN")
  })
})

describe("step 1 components", () => {
  beforeEach(() => missingKeys.clear())

  it("every spec of the material is a cell — an unchosen one dashed «— » — and the brand and free cells are labelled (ED-05, ED-06)", () => {
    const bar = index.materials.find((m) => m.ar === "اسياخ حديد التسليح")!
    const pick = { ...pickOf(index, bar.id, [{ name: { ar: "المقاس", en: "Size" }, value: { ar: "16 مم", en: "16 mm" } }, { name: { ar: "أخرى", en: "Other" }, value: { ar: "مقصوص", en: "مقصوص" }, free: true }])!, brand: { ar: "سابك", en: "SABIC" } }
    const v = render(<MaterialSpecCells index={index} pick={pick} onChange={() => undefined} />)
    expect(document.querySelector('[aria-label="الدرجة: لم يُختر"]')).not.toBeNull()
    expect(text()).toContain("العلامة:")
    expect(text()).toContain("أخرى:")
    expect([...missingKeys]).toEqual([])
    v.unmount()
  })

  it("a search result lists the specs the words did not name and carries «Enter» on the active one (ED-04)", async () => {
    const v = render(<MaterialSearchInput index={index} onPick={() => undefined} onBrowse={() => undefined} onFreeText={() => undefined} />)
    await type(box(), "حديد 16")
    const first = document.querySelector('[role="option"][aria-selected="true"]')!
    expect(first.textContent).toContain("المقاس")
    expect(first.textContent).toContain("الدرجة")
    expect(first.querySelector("kbd")?.textContent).toBe("Enter")
    expect([...missingKeys]).toEqual([])
    v.unmount()
  })

  it("the browse window captions say what is inside, and Enter opens the first hit (ED-08)", async () => {
    const v = render(<MaterialBrowserDialog open onOpenChange={() => undefined} index={index} onAdd={() => undefined} />)
    await flush()
    expect(text()).toMatch(/فرعي/)
    // Into a category: its sub-categories hold materials.
    await click(buttons().find((b) => (b.textContent || "").startsWith("الحديد")))
    expect(text()).toMatch(/مواد|مادتان|مادة واحدة/)
    const s = document.querySelector('input[aria-label="ابحث باسم المادة أو المقاس"]') as HTMLInputElement
    await type(s as HTMLInputElement, "بلوك 20")
    await act(async () => void fireEvent.keyDown(s, { key: "Enter" }))
    await flush()
    expect(text()).toContain("البلك الاسمنتي")
    expect([...missingKeys]).toEqual([])
    v.unmount()
  })
})

describe("the editor page (ED-03, ED-07, ED-09, ED-11, ED-12, ED-22)", () => {
  beforeEach(() => {
    resetFakeDb()
    calls.length = 0
    missingKeys.clear()
    seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
    seed(`procurementSettings/${ORG}`, { organizationId: ORG, deliverySites: [{ id: "s2", kind: "site", name: "برج العليا", city: "الرياض", district: "العليا", address: "", receiverId: null }] })
    setSignedIn(ORG)
    setPathname("/contractor/rfqs/new", "")
  })

  it("a pick from the search box puts the focus on that row's quantity; Enter there goes back to the search box (ED-03)", async () => {
    const v = render(<NewRfqPage />)
    await flush()
    await type(box(), "حديد 16")
    await click(Array.from(document.querySelectorAll('[role="option"]')).find((o) => (o.textContent || "").includes("اسياخ حديد التسليح")))
    const qty = document.activeElement as HTMLInputElement
    expect(qty.getAttribute("aria-label")).toBe("الكمية")
    await act(async () => void fireEvent.keyDown(qty, { key: "Enter" }))
    expect(document.activeElement).toBe(box())
    v.unmount()
  })

  it("words kept «كما هو» stay as a row with «اختر المادة» when the window is dismissed (ED-07)", async () => {
    const v = render(<NewRfqPage />)
    await flush()
    await type(box(), "مادة نادرة جداً")
    await click(byText("اكتبه كما هو"))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => void fireEvent.keyDown(document.querySelector('[role="dialog"]')!, { key: "Escape" }))
    await flush()
    expect(text()).toContain("مادة نادرة جداً")
    expect(byText("اختر المادة")).toBeDefined()
    v.unmount()
  })

  it("a group with rows is removed after a confirm that counts its materials (ED-12); the footer counts places (ED-11)", async () => {
    const v = render(<NewRfqPage />)
    await flush()
    await type(box(), "حديد 16")
    await click(Array.from(document.querySelectorAll('[role="option"]')).find((o) => (o.textContent || "").includes("اسياخ حديد التسليح")))
    await click(byText("موقع تسليم آخر") || byText("مشروع آخر أو موقع تسليم"))
    const trash = Array.from(document.querySelectorAll('button[aria-label="احذف المجموعة"]'))
    expect(trash.length).toBeGreaterThan(0)
    await click(trash[0])
    expect(text()).toContain("تُحذف معها مادة واحدة.")
    await click(Array.from(document.querySelectorAll('[role="alertdialog"] button')).find((b) => (b.textContent || "").includes("احذف المجموعة")))
    expect(text()).not.toContain("اسياخ حديد التسليح")
    expect(text()).toMatch(/موقع واحد|مشروع واحد|—/)
    expect([...missingKeys]).toEqual([])
    v.unmount()
  })

  it("a member who builds requests (rfq.manage) sees «+ موقع جديد» (ED-22)", async () => {
    seed(`teamGroups/g_buy`, { organizationId: ORG, name: "مشتريات", key: null, permissions: ["rfq.manage", "rfq.create"] })
    seed(`users/buyer`, { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_buy", name: "المشتري", email: "b@test.sa", profileCompleted: true })
    setSignedIn("buyer")
    const v = render(<NewRfqPage />)
    await flush()
    expect(byText("موقع جديد")).toBeDefined()
    v.unmount()
  })
})

describe("step 2 and 3", () => {
  beforeEach(() => missingKeys.clear())
  const values = (over: Partial<PublishValues> = {}): PublishValues => ({ audience: "public", deadline: "2026-10-30", pricing: "line", title: "ت", terms: [{ pct: "100", days: "30" }], termsSet: true, notes: "", budget: "", attachments: [], recipients: null, directSupplierOrgId: "", directReason: "", directNote: "", link: null, ...over })
  const mount = (v: PublishValues, onChange: (p: Partial<PublishValues>) => void = () => undefined, extra: Partial<React.ComponentProps<typeof EditorPublish>> = {}) =>
    render(
      <EditorPublish
        values={v}
        onChange={onChange}
        publicReachCount={4}
        linesCount={2}
        favouriteName={null}
        recipientOptions={[
          { orgId: "s0", name: "مورد العمار", isFavorite: false },
          { orgId: "s1", name: "مورد الأفق", isFavorite: false },
        ]}
        recipientFacts={new Map([
          ["s0", { onTime: 70, crExpired: false }],
          ["s1", { onTime: 90, crExpired: false }],
        ])}
        selectedRecipients={["s1"]}
        directPool={[
          { orgId: "s0", name: "مورد العمار", platform: false, favourite: false },
          { orgId: "s1", name: "مورد الأفق", platform: false, favourite: false },
          { orgId: "p9", name: "مورد المنصة", platform: true, favourite: false },
        ]}
        matching={new Set(["s1"])}
        estimate={null}
        directCap={5000}
        firstDeadline="2026-10-22"
        deadlineHint="hint"
        onInvite={() => undefined}
        onUpload={() => undefined}
        uploading={false}
        onRemoveAttachment={() => undefined}
        showProblems={false}
        supplierSubs={new Map([["s1", ["البلك الاسمنتي", "الاسمنت العادي"]]])}
        {...extra}
      />,
    )

  it("switching to direct pre-selects the first «مختص» supplier who may be awarded (ED-13)", async () => {
    const onChange = jest.fn()
    const v = mount(values(), onChange)
    await click(byText("إسناد مباشر"))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ audience: "direct", directSupplierOrgId: "s1" }))
    v.unmount()
    const blocked = jest.fn()
    const w = mount(values(), blocked, { directFacts: new Map([["s1", { onTime: 90, crExpired: true, block: "cr_expired", matches: true }]]) })
    await click(byText("إسناد مباشر"))
    expect(blocked).toHaveBeenCalledWith(expect.objectContaining({ directSupplierOrgId: "" }))
    w.unmount()
  })

  it("direct is the private list's rows with radios, «مختص» first, his sub-categories under his name, the platform's tagged (ED-13, ED-14)", () => {
    const v = mount(values({ audience: "direct", directSupplierOrgId: "s1" }))
    const rows = Array.from(document.querySelectorAll("#rfq-direct label"))
    expect(rows.map((r) => (r.textContent || "").slice(0, 10))[0]).toContain("مورد الأفق")
    expect(rows[0].querySelector("input")?.getAttribute("type")).toBe("radio")
    expect((rows[0].querySelector("input") as HTMLInputElement).checked).toBe(true)
    expect(rows[0].textContent).toContain("البلك الاسمنتي · الاسمنت العادي")
    expect(rows.find((r) => (r.textContent || "").includes("مورد المنصة"))?.textContent).toContain("المنصة")
    expect([...missingKeys]).toEqual([])
    v.unmount()
  })

  const model = (over: Partial<ReviewModel> = {}): ReviewModel => ({ lines: 3, subs: 2, groups: 1, audience: "public", reach: 9, favourite: null, perSub: [], privateCount: 0, directName: null, deadline: "2026-10-25", daysToDeadline: 3, pricing: "line", link: true, terms: "100%", delivery: "x", files: [], budget: null, noSpec: [], outside: [], unitDiffers: [], ...over })

  it("a public RFQ warns for each sub-category no supplier covers, with «ادعُ مورداً» (ED-15, SP-05)", async () => {
    const onInvite = jest.fn()
    const v = render(<EditorReview model={model({ perSub: [{ name: "البلك الاسمنتي", count: 9 }, { name: "حجر نادر", count: 0 }] })} fmtDay={(d) => d} onInvite={onInvite} />)
    expect(text()).toContain("لا مورد مختص بـ«حجر نادر» في المنصة")
    expect(text()).not.toContain("لا مورد مختص بـ«البلك الاسمنتي»")
    await click(byText("ادعُ مورداً"))
    expect(onInvite).toHaveBeenCalled()
    expect([...missingKeys]).toEqual([])
    v.unmount()
  })

  it("the reach names the city, and a city that leaves a sub-category with nobody says how many are elsewhere (ED-21)", () => {
    const a = render(<EditorReview model={model({ reachCities: "الرياض", reach: 4, perSub: [{ name: "البلك الاسمنتي", count: 4, elsewhere: 0 }, { name: "حجر نادر", count: 0, elsewhere: 3 }] })} fmtDay={(d) => d} />)
    expect(text()).toContain("يصل 4 موردين مختصين في الرياض.")
    expect(text()).toContain("لا مورّد مختص بـ«حجر نادر» في الرياض — 3 موردين في مدن أخرى")
    a.unmount()
    const b = render(<EditorReview model={model({ reachCities: "الرياض", reach: 0, elsewhere: 5, perSub: [{ name: "حجر نادر", count: 0, elsewhere: 5 }] })} fmtDay={(d) => d} />)
    expect(text()).toContain("لا مورّد مختص في الرياض — 5 موردين في مدن أخرى")
    expect([...missingKeys]).toEqual([])
    b.unmount()
    const c = mount(values(), () => undefined, { reachCities: "الرياض أو جدة" })
    expect(text()).toContain("يصل 4 موردين مختصين في الرياض أو جدة.")
    c.unmount()
  })

  it("private names up to five then «و# آخرين»; delivery options as the supplier reads them (ED-16, ED-17)", () => {
    const names = ["أ", "ب", "ج", "د", "هـ", "و", "ز"]
    const v = render(<EditorReview model={model({ audience: "private", privateCount: 7, privateNames: names, deliveryOptions: ["التنزيل على المورّد · صباحاً — البوابة الشمالية"] })} fmtDay={(d) => d} />)
    expect(text()).toContain("خاص: أ، ب، ج، د، هـ وآخران")
    expect(text()).toContain("خيارات التسليم")
    expect(text()).toContain("البوابة الشمالية")
    expect([...missingKeys]).toEqual([])
    v.unmount()
  })
})

describe("after publishing and the pay-later window", () => {
  beforeEach(() => {
    resetFakeDb()
    calls.length = 0
    missingKeys.clear()
    seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان" })
    setSignedIn(ORG)
  })

  it("WhatsApp on the success panel opens the message the supplier receives (ED-18)", async () => {
    const v = render(<RfqPublishedPanel rfqId="R9" number="ط.ع-2026/009" reached={3} closesOn="30 أكتوبر" guestUrl="https://mdmaktech.sa/rfq/tok" title="بلك" openHref="/contractor/rfqs/R9" onNew={() => undefined} />)
    expect(document.querySelector('a[href^="https://wa.me"]')).toBeNull()
    await click(byText("واتساب"))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(calls.some((c) => c.url.includes("/api/rfq-share/create") && c.body?.rfqId === "R9")).toBe(true)
    v.unmount()
  })

  it("«أبلغني حين يُطلق» records the interest through the server (ED-20)", async () => {
    const onOpenChange = jest.fn()
    const v = render(<BnplSoonDialog open onOpenChange={onOpenChange} />)
    await click(byText("أبلغني حين يُطلق"))
    expect(calls.some((c) => c.url.includes("/api/procurement/soon-notify") && c.body?.topic === "bnpl")).toBe(true)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect([...missingKeys]).toEqual([])
    v.unmount()
  })
})
