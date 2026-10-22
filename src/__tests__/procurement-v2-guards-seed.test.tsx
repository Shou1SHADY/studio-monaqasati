/**
 * Procurement 2.0 — the demo world is the same world every time (QA pack 4/5, G-12 · NFR-06): `scripts/seed-proc20-demo.ts` builds it from a
 * company and a day. Here: the same inputs give the same documents; a different day shifts every date and nothing else; the world is what the
 * brief promised (eight incoming requests across three sources, three RFQs with one holding eleven offers of every kind, a partial award, nine
 * orders in different states, a visitor link and an order link); every document carries the demo prefix; the script refuses production and a
 * missing company BEFORE it reads any credential; and the contractor's screens read the seeded world — the requests, the RFQ page, the orders.
 */

jest.mock("dotenv", () => ({ config: () => undefined }))
jest.mock("firebase-admin/app", () => ({ cert: () => ({}), getApps: () => [], initializeApp: () => ({ options: {} }) }))
jest.mock("firebase-admin/auth", () => ({ getAuth: () => ({}) }))
jest.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }))
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
jest.mock("next/navigation", () => {
  const nav = jest.requireActual("@/test-utils/render-world").navigationMock
  return { ...nav, useParams: () => ({ id: "p20_rfq_open", locale: "ar" }) }
})
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

import React from "react"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import { buildProc20World, DEMO_PREFIX, type DemoCtx } from "../../scripts/seed-proc20-demo"
import RequestsPage from "@/app/[locale]/(contractor)/contractor/rfqs/requests/page"
import OrdersPage from "@/app/[locale]/(contractor)/contractor/rfqs/orders/page"
import { RfqOffersView } from "@/components/contractor/RfqOffersView"
import type { IncomingDoc } from "@/lib/procurement/incoming-state"

installDomShims()
jest.setTimeout(120_000)

const ctx = (today: string): DemoCtx => ({ orgId: "own", ownerUid: "own", ownerName: "خالد البنيان", today })
const A = "2026-10-22"
const B = "2026-10-05"
const world = (today = A) => buildProc20World(ctx(today))
type Doc = Record<string, any>
const data = (w: ReturnType<typeof world>, collection: string): Doc[] => w.docs.filter((d) => d.path.split("/")[0] === collection && d.path.split("/").length === 2).map((d) => ({ id: d.path.split("/")[1], ...d.data }))

const relative = (w: ReturnType<typeof world>, today: string) => {
  const base = Date.parse(`${today}T00:00:00Z`)
  return JSON.stringify(w.docs).replace(/\d{4}-\d{2}-\d{2}/g, (m) => `D${Math.round((Date.parse(`${m}T00:00:00Z`) - base) / 86_400_000)}`)
}

describe("G-12 — the same world every time", () => {
  it("the same company and day build the very same documents", () => {
    expect(JSON.stringify(world())).toBe(JSON.stringify(world()))
  })

  it("another day moves every date by the same number of days and changes nothing else (relative dates, no fixed calendar)", () => {
    expect(relative(world(A), A)).toBe(relative(world(B), B))
    expect(JSON.stringify(world(A))).not.toBe(JSON.stringify(world(B)))
  })

  it("every document the script owns carries the demo prefix, so --reset deletes exactly it", () => {
    const w = world()
    const foreign = w.docs.filter((d) => !d.merge).filter((d) => !d.path.includes(DEMO_PREFIX))
    expect(foreign.map((d) => d.path)).toEqual([])
    expect(w.docs.filter((d) => d.merge).map((d) => d.path)).toEqual(["procurementSettings/own"])
    expect(new Set(w.docs.map((d) => d.path)).size).toBe(w.docs.length)
  })
})

describe("the world is what the brief promised (NFR-06)", () => {
  const w = world()
  const incoming = data(w, "procIncoming") as unknown as IncomingDoc[]

  it("eight incoming requests across the team, the projects and the workshop; one for a receiver with no account, one in an RFQ, one ended, one withdrawn", () => {
    expect(incoming).toHaveLength(8)
    expect(incoming.reduce<Record<string, number>>((n, d) => ({ ...n, [d.src]: (n[d.src] || 0) + 1 }), {})).toEqual({ team: 5, pm: 2, mfg: 1 })
    expect(incoming.filter((d) => d.requestedFor?.kind === "receiver")).toHaveLength(1)
    expect(incoming.map((d) => d.st).sort()).toEqual(["fail", "new", "new", "new", "new", "new", "part", "wd"])
  })

  it("three RFQs: one open with eleven offers, one partly awarded, one closed waiting for the comparison", () => {
    const rfqs = data(w, "rfqs")
    expect(rfqs.map((r) => r.status).sort()).toEqual(["Awarded", "New", "New"])
    const offers = data(w, "offers")
    const byRfq = offers.reduce<Record<string, Doc[]>>((m, o) => ({ ...m, [o.rfqId]: [...(m[o.rfqId] || []), o] }), {})
    expect(Object.values(byRfq).map((l) => l.length).sort((a, b) => a - b)).toEqual([3, 3, 11])
    const open = byRfq["p20_rfq_open"]
    expect(open.filter((o) => o.isGuestOffer)).toHaveLength(2)
    expect(open.filter((o) => o.lines.some((l: Doc) => l.packLen))).toHaveLength(1)
    expect(open.filter((o) => (o.skippedItems || []).length)).toHaveLength(1)
    expect(open.filter((o) => o.validUntil < "2026-10-22")).toHaveLength(1)
    expect(data(w, "offerDecisions").map((d) => (d.shortlist ? "shortlist" : "exclusion")).sort()).toEqual(["exclusion", "shortlist"])
    const awarded = rfqs.find((r) => r.id === "p20_rfq_awarded") as Doc
    expect(awarded).toMatchObject({ awardSplit: true, unawardedLines: [2] })
  })

  it("nine orders in different states, two of them off the platform, one with its conversation and a delivery notice, and the two links", () => {
    const orders = data(w, "purchaseOrders")
    expect(orders).toHaveLength(9)
    expect(new Set(orders.map((o) => o.status))).toEqual(new Set(["awaiting_approval", "approved", "sent", "accepted", "cancelled"]))
    expect(orders.filter((o) => o.isGuestSupplier)).toHaveLength(2)
    expect(orders.filter((o) => o.supplierDecline)).toHaveLength(1)
    expect(data(w, "poMessages")).toHaveLength(2)
    expect(data(w, "deliveries")).toHaveLength(1)
    expect(w.links).toEqual({ rfqLinkId: "p20_link_rfq_open", orderLinkPoId: "p20_po_sent_guest" })
    expect(data(w, "rfqShareLinks")[0]).toMatchObject({ rfqId: "p20_rfq_open", revoked: false, tokenHashes: [] })
    expect(data(w, "orderLinks")[0]).toMatchObject({ poId: "p20_po_sent_guest", tokenHashes: [] })
    expect(orders.find((o) => o.id === "p20_po_sent_guest")).toMatchObject({ status: "sent", sentChannel: "whatsapp", isGuestSupplier: true })
  })

  it("sequences are raised to cover the seeded numbers", () => {
    expect(w.counters.map((c) => [c.path.split("__")[1], c.last]).sort()).toEqual([["MAT", 28], ["PO", 9], ["RFQ", 3]])
  })
})

describe("the script is safe to point at the wrong place", () => {
  const run = (...args: string[]) => spawnSync(join(process.cwd(), "node_modules/.bin", process.platform === "win32" ? "tsx.cmd" : "tsx"), ["scripts/seed-proc20-demo.ts", ...args], { encoding: "utf8", cwd: process.cwd(), shell: process.platform === "win32", timeout: 60_000 })

  it("refuses production, and refuses UAT without the company's e-mail — before it reads a credential", () => {
    const prod = run("prod", "--email", "x@example.com", "--apply")
    expect(prod.status).toBe(2)
    expect(`${prod.stdout}${prod.stderr}`).toMatch(/refusing.*UAT only/i)
    const none = run("uat")
    expect(none.status).toBe(2)
    expect(`${none.stdout}${none.stderr}`).toMatch(/--email/)
  })

  it("never creates a sign-in account and never writes outside the demo prefix", () => {
    const source = readFileSync(join(process.cwd(), "scripts/seed-proc20-demo.ts"), "utf8")
    expect(source).not.toMatch(/createUser\(|updateUser\(|setCustomUserClaims\(/)
    expect(source).toContain('target !== "uat"')
    expect(source).toContain("UAT_PROJECT")
  })
})

describe("the contractor's screens read the seeded world", () => {
  const w = world(new Date().toISOString().slice(0, 10))
  const flush = async (n = 8) => {
    for (let i = 0; i < n; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
  }
  const text = () => document.body.textContent ?? ""

  beforeAll(() => {
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
      if (String(url).includes("material-tree")) return { ok: true, json: async () => JSON.parse(readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")) }
      return { ok: true, json: async () => ({ success: true, data: { requests: [] } }) }
    })
  })

  beforeEach(() => {
    resetFakeDb()
    seed("users/own", { organizationId: "own", organizationRole: "owner", role: "Contractor", name: "خالد البنيان", companyName: "شركة البنيان الحديثة", email: "o@test.sa", isVerified: true, profileCompleted: true })
    seed("companyModules/own", { organizationId: "own", off: [] })
    for (const d of w.docs) seed(d.path, d.data)
    setLocale("ar")
    setSignedIn("own")
    missingKeys.clear()
  })

  it("«الواردة»: eight requests, none lost between the segments", async () => {
    setPathname("/contractor/rfqs/requests", "")
    const view = render(<RequestsPage />)
    await flush()
    const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map((t) => (t.textContent || "").trim())
    const all = tabs.find((t) => t.startsWith("الكل")) || ""
    expect(Number(all.replace("الكل", ""))).toBe(8)
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("the open RFQ's page lists its eleven offers", async () => {
    setPathname("/contractor/rfqs/p20_rfq_open/offers", "tab=list")
    const view = render(<RfqOffersView rfqId="p20_rfq_open" />)
    await flush()
    expect(document.querySelectorAll("[role=row][data-offer]")).toHaveLength(11)
    expect(text()).toContain(`RFQ-${new Date().getFullYear()}/001`)
    expect(text()).toContain("من خارج المنصة")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("the orders page lists the nine, and the order sent by WhatsApp opens", async () => {
    setPathname("/contractor/rfqs/orders", "filter=all")
    const view = render(<OrdersPage />)
    await flush()
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(text()).toMatch(new RegExp(`00${n}`))
    expect([...missingKeys]).toEqual([])
    view.unmount()
    setPathname("/contractor/rfqs/orders", "po=p20_po_sent_guest")
    const open = render(<OrdersPage />)
    await flush()
    expect(text()).toContain("مؤسسة الرمال للتجارة")
    expect([...missingKeys]).toEqual([])
    open.unmount()
  })
})
