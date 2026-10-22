/**
 * Procurement 2.0 — «قبل الشراء» and «بالمادة — قارن واجمع» rendered for real (WP-S2-04/09): a card whose material waits for the
 * stores says so and offers no «امضِ بالشراء» (the window fails open by itself); the panel's «قبل الشراء» column shows the
 * answers and «اسأل الورشة» only for stone with Manufacturing in the package; the view toggle reads the same requests by material,
 * totals the same material from two requests and opens the picked ones in one draft.
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
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { getIdToken: async () => "tok" } }) }))
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

import React from "react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import RequestsPage from "@/app/[locale]/(contractor)/contractor/rfqs/requests/page"
import { newTeamRequest } from "@/lib/procurement/incoming-ingest"
import { incomingDocId, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { WORKSHOP_MAKE_SUBS, askStock } from "@/lib/procurement/stock-check"
import { DEFAULT_RESOLVED_POLICIES } from "@/lib/procurement/policies"
import type { MaterialPick } from "@/lib/materials/types"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const tree = readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")

beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    if (String(url).includes("material-tree")) return { ok: true, json: async () => JSON.parse(tree) }
    return { ok: true, json: async () => ({ success: true, data: {} }) }
  })
})

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const text = () => document.body.textContent ?? ""
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === label) as HTMLButtonElement | undefined
const tab = (label: string) => (Array.from(document.querySelectorAll('[role="tab"]')) as HTMLButtonElement[]).find((t) => (t.textContent || "").startsWith(label))

const DAY = 86_400_000
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
const stone = (): MaterialPick => ({ nodeId: WORKSHOP_MAKE_SUBS[0], subId: WORKSHOP_MAKE_SUBS[0], rootId: "floors", path: [{ ar: "الارضيات والجدران", en: "Floors" }, { ar: "الرخام", en: "Marble" }], specs: [{ name: { ar: "السمك", en: "Thickness" }, value: { ar: "20 مم", en: "20 mm" } }] })

const asked = (id: string, no: string, lines: Array<{ name: string; unit: string; quantity: number; material?: MaterialPick }>): IncomingDoc => {
  const made = newTeamRequest({
    organizationId: ORG,
    id,
    no,
    seq: Number(no.slice(-3)),
    lines,
    needBy: day(30),
    place: { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" },
    requestedBy: { id: "eng1", name: "م. فهد العتيبي" },
    requestedFor: { kind: "member", id: "eng1", name: "م. فهد العتيبي" },
    at: new Date().toISOString(),
  })
  const res = askStock(made, { now: new Date(), policies: DEFAULT_RESOLVED_POLICIES })
  if (typeof res === "string") throw new Error(res)
  return { ...made, lines: res.lines }
}
const put = (doc: IncomingDoc) => seed(`procIncoming/${incomingDocId(ORG, doc.mrKey)}`, doc as unknown as Record<string, unknown>)
const answer = (doc: IncomingDoc, patch: (l: IncomingDoc["lines"][number]) => IncomingDoc["lines"][number]): IncomingDoc => ({ ...doc, lines: doc.lines.map(patch) })

beforeEach(() => {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
  seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management"] })
  seed(`procurementSettings/${ORG}`, { organizationId: ORG })
  setSignedIn(ORG)
  missingKeys.clear()
})

describe("a card whose materials wait for the stores", () => {
  it("says «بانتظار ردّ المخزون», is not offered for publishing, and has no «امضِ بالشراء»", async () => {
    put(asked("a", "MAT-2026/021", [{ name: "البلك الاسمنتي", unit: "حبة", quantity: 2000 }]))
    setPathname("/contractor/rfqs/requests", "")
    const view = render(<RequestsPage />)
    await flush()
    expect(text()).toContain("ط.م-2026/021")
    expect(text()).toContain("بانتظار ردّ المخزون")
    expect(button("امضِ بالشراء")).toBeUndefined()
    expect(text()).not.toContain("امضِ بالشراء")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("an answered line reads what the stores issue and what is bought — «يُشترى 1,500 من 2,000»", async () => {
    const doc = answer(asked("a", "MAT-2026/021", [{ name: "البلك الاسمنتي", unit: "حبة", quantity: 2000 }]), (l) => ({ ...l, stk: { st: "part", give: 500, at: new Date().toISOString(), until: day(1), src: "proc", rv: 1, wh: { id: "w1", name: "المستودع المركزي" } } }))
    put(doc)
    setPathname("/contractor/rfqs/requests", "publish=team%3Aa&step=1")
    const view = render(<RequestsPage />)
    await flush()
    expect(text()).toContain("قبل الشراء")
    expect(text()).toContain("يصرف المخزون 500 من المستودع المركزي")
    expect(text()).toContain("يُشترى 1,500 من 2,000")
    expect(text()).toContain("المخزون يصرف مادة واحدة")
    view.unmount()
  })
})

describe("«اسأل الورشة» (B-04, B-05)", () => {
  it("is offered for stone in the panel with Manufacturing in the package, and posts the question", async () => {
    put(answer(asked("s", "MAT-2026/030", [{ name: "رخام بيج", unit: "م²", quantity: 22, material: stone() }]), (l) => ({ ...l, stk: { st: "none", at: new Date().toISOString(), src: "proc", rv: 1 } })))
    setPathname("/contractor/rfqs/requests", "publish=team%3As&step=1")
    const view = render(<RequestsPage />)
    await flush()
    expect(button("اسأل الورشة")).toBeDefined()
    await act(async () => void fireEvent.click(button("اسأل الورشة") as HTMLButtonElement))
    await flush()
    expect(text()).toContain("اسأل الورشة: نصنّعها بدل أن نشتريها؟")
    expect(text()).toContain("لا سعر سابق")
    await act(async () => void fireEvent.click(button("أرسل إلى الورشة") as HTMLButtonElement))
    await flush()
    const call = (global.fetch as jest.Mock).mock.calls.find((c) => String(c[1]?.body || "").includes("ask-mfg"))
    expect(JSON.parse(call?.[1].body)).toMatchObject({ action: "ask-mfg", mrKey: "team:s", lines: [1] })
    view.unmount()
  })

  it("B-05: without Manufacturing in the package there is no «اسأل الورشة»", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management", "manufacturing"] })
    put(answer(asked("s", "MAT-2026/030", [{ name: "رخام بيج", unit: "م²", quantity: 22, material: stone() }]), (l) => ({ ...l, stk: { st: "none", at: new Date().toISOString(), src: "proc", rv: 1 } })))
    setPathname("/contractor/rfqs/requests", "publish=team%3As&step=1")
    const view = render(<RequestsPage />)
    await flush()
    expect(button("اسأل الورشة")).toBeUndefined()
    view.unmount()
  })
})

describe("«بالمادة — قارن واجمع»", () => {
  const twoRequests = () => {
    const reply = (l: IncomingDoc["lines"][number]): IncomingDoc["lines"][number] => ({ ...l, stk: { st: "none", at: new Date().toISOString(), src: "proc", rv: 1 } })
    put(answer(asked("a", "MAT-2026/021", [{ name: "رخام بيج", unit: "م²", quantity: 30, material: stone() }]), reply))
    put(answer(asked("b", "MAT-2026/022", [{ name: "رخام بيج", unit: "م²", quantity: 26, material: stone() }]), reply))
  }

  it("the toggle reads the same requests by material: 56 m² from two requests, 'no earlier purchase of this specification'", async () => {
    twoRequests()
    setPathname("/contractor/rfqs/requests", "view=mat")
    const view = render(<RequestsPage />)
    await flush()
    expect(tab("بالمادة — قارن واجمع")?.getAttribute("aria-selected")).toBe("true")
    expect(text()).toContain("56")
    expect(text()).toContain("من طلبين")
    expect(text()).toContain("ط.م-2026/021")
    expect(text()).toContain("ط.م-2026/022")
    expect(text()).toContain("لا شراء سابق بهذه المواصفة")
    expect(tab("مُجهَّزة")).toBeUndefined()
    expect(text()).toContain("2 جديدة")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("picking a material offers «اجمعها في طلب عروض واحد», a link to the editor on exactly its lines", async () => {
    twoRequests()
    setPathname("/contractor/rfqs/requests", "view=mat")
    const view = render(<RequestsPage />)
    await flush()
    expect(document.body.querySelector('a[href*="/contractor/rfqs/new"]')).toBeNull()
    await act(async () => void fireEvent.click(document.querySelector('[role="checkbox"]') as HTMLElement))
    await flush()
    const href = (document.querySelector('a[href*="/contractor/rfqs/new"]') as HTMLAnchorElement | null)?.getAttribute("href") || ""
    expect(decodeURIComponent(href)).toContain("requests=team:a|team:b")
    expect(decodeURIComponent(href)).toContain("lines=team:a@0|team:b@0")
    expect(text()).toContain("اجمعها في طلب عروض واحد")
    view.unmount()
  })
})
