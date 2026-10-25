/**
 * Procurement 2.0 — the buyer's side of the visitor link (LNK-12, LNK-13, R-21, B-08): the composer shows the message the supplier
 * will receive BEFORE it goes (the WhatsApp bubble, the e-mail), opens WhatsApp / the mail client from the buyer's own device
 * without a single call to either, tells him how many times the link was opened, and the panel on the RFQ page leads to the
 * preview — which is not a view.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => {
  const base = jest.requireActual("@/test-utils/render-world").firebaseMock
  const React = jest.requireActual("react")
  return {
    ...base,
    useUser: () => {
      const got = base.useUser()
      const user = React.useMemo(() => (got.user ? { ...got.user, getIdToken: async () => "tok" } : null), [got.user])
      return { ...got, user }
    },
  }
})
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)

import React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setSignedIn } from "@/test-utils/render-world"
import { LinkComposer } from "@/components/procurement/rfq/LinkComposer"
import { RfqGuestLinkPanel } from "@/components/procurement/rfq/RfqGuestLinkPanel"

installDomShims()
jest.setTimeout(60_000)

const URL = "https://uat.mdmaktech.sa/rfq/abcdefghijklmnopqrstuv"
const text = () => document.body.textContent ?? ""
const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

let calls: Array<{ url: string; body: Record<string, unknown> | null }>
let opened: Array<{ href: string }>
let views = 3

beforeEach(() => {
  resetFakeDb()
  setLocale("ar")
  setSignedIn("u1")
  missingKeys.clear()
  seed("users/u1", { organizationId: "u1", name: "سعد", companyName: "الأمل" })
  calls = []
  opened = []
  views = 3
  window.open = jest.fn((href?: string | URL) => {
    opened.push({ href: String(href) })
    return null
  }) as unknown as typeof window.open
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    const ok = (d: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data: d }) })
    if (url.includes("/api/rfq-share/preview"))
      return ok({
        rfq: { number: "RFQ-2026/012", title: "زوايا حديد و خشب", places: [{ city: "الرياض", district: "السلي" }], closeDay: "2099-12-31", lines: [{}, {}], state: "open" },
        contractorName: "الأمل",
        stats: { views, reachedCount: 2, offersSubmitted: 1 },
      })
    return ok({ url: calls[calls.length - 1].body?.channel ? null : URL, expiresAt: "2099-12-31T20:59:59.999Z", invites: [], closed: false, validity: "deadline" })
  }) as unknown as typeof fetch
})

describe("the composer", () => {
  async function open() {
    render(<LinkComposer rfq={{ id: "R1", title: "t" }} isOpen onClose={() => undefined} />)
    await flush()
  }

  it("shows the link, then the message the supplier receives — the WhatsApp bubble with the ready text — before anything goes", async () => {
    await open()
    expect(document.querySelector<HTMLInputElement>("input[readonly]")?.value).toBe(URL)
    expect(text()).toContain("الرسالة التي تصل المورّد")
    const bubble = document.querySelector('[data-preview="wa"]') as HTMLElement
    expect(bubble.textContent).toContain("السلام عليكم،")
    expect(bubble.textContent).toContain("الأمل تطلب منكم عرض سعر عبر مدماك:")
    expect(bubble.textContent).toContain("«زوايا حديد و خشب» — مادتان، والتسليم في الرياض — السلي.")
    expect(bubble.textContent).toContain("قدّم عرضك بلا حساب من الرابط:")
    expect(bubble.textContent).toContain(URL)
    expect(opened).toEqual([])
    expect(missingKeys.size).toBe(0)
  })

  it("the e-mail preview has its subject and the same text", async () => {
    await open()
    fireEvent.click(screen.getByRole("button", { name: "البريد" }))
    const mail = document.querySelector('[data-preview="mail"]') as HTMLElement
    expect(mail.textContent).toContain("طلب عرض سعر — زوايا حديد و خشب")
    expect(mail.textContent).toContain(URL)
  })

  it("«افتح واتساب» opens wa.me from the buyer's device with the text — and fetches nothing of WhatsApp", async () => {
    await open()
    await act(async () => void fireEvent.click(screen.getByText("افتح واتساب")))
    await flush()
    expect(opened).toHaveLength(1)
    expect(opened[0].href).toMatch(/^https:\/\/wa\.me\/\?text=/)
    expect(decodeURIComponent(opened[0].href)).toContain(URL)
    expect(calls.some((c) => /wa\.me|whatsapp/i.test(c.url))).toBe(false)
    expect(calls.some((c) => c.body?.channel === "whatsapp")).toBe(true)
  })

  it("«افتح البريد» opens a mailto: with the subject and body", async () => {
    await open()
    fireEvent.click(screen.getByRole("button", { name: "البريد" }))
    await act(async () => void fireEvent.click(screen.getByText("افتح البريد")))
    await flush()
    expect(opened[0].href).toMatch(/^mailto:\?subject=.+&body=.+/)
    expect(calls.some((c) => c.body?.channel === "email")).toBe(true)
  })

  it("says how many times the link was opened, and that his own preview is not counted; the preview is a link, not a fetch of the link", async () => {
    await open()
    expect(document.querySelector("[data-views]")?.textContent).toContain("اطّلع عليه 3 مرات")
    expect(text()).toContain("معاينتك لا تُحسب اطّلاعاً")
    const as = screen.getByText("كما يراه المورّد").closest("a") as HTMLAnchorElement
    expect(as.getAttribute("href")).toBe("/contractor/rfqs/R1/preview/link")
  })

  it("the same dialog in English", async () => {
    setLocale("en")
    await open()
    expect(text()).toContain("The message the supplier receives")
    expect(text()).toContain("Open WhatsApp")
    expect(document.querySelector('[data-preview="wa"]')?.textContent).toContain("Quote without an account here:")
    expect(missingKeys.size).toBe(0)
  })
})

describe("the panel on the RFQ page", () => {
  it("shows the opens, copies the link, and leads to the preview", async () => {
    render(<RfqGuestLinkPanel rfqId="R1" canShare onShare={() => undefined} />)
    await flush()
    expect(document.querySelector("[data-views]")?.textContent).toContain("اطّلع عليه 3 مرات")
    expect(document.querySelector('a[href="/contractor/rfqs/R1/preview/link"]')).not.toBeNull()
    expect(calls.every((c) => !c.url.includes("/create"))).toBe(true)
    expect(missingKeys.size).toBe(0)
  })

  it("a look at the preview page never writes to the link: it reads through the authenticated route only", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require("fs").readFileSync("src/app/api/rfq-share/preview/route.ts", "utf8") as string
    expect(src).not.toMatch(/\.(update|set|add|create)\(/)
    expect(src).not.toMatch(/runTransaction/)
  })
})
