/**
 * Procurement 2.0 — the sweep (QA pack 1/5, G-10, G-11): every contractor Procurement page — the incoming requests (every segment), the
 * RFQs, the RFQ page (offers, comparison, questions, details), the purchase orders (the list and an order's drawer), the chats, the
 * settings (every tab), the guide, «طلباتي» and the RFQ editor — rendered for real over ONE shared world, in each of the eight package
 * states and both languages. A closed connector must never break a screen: nothing throws, no message key is missing, and no raw
 * placeholder, «undefined» or «NaN» is left on the page.
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
jest.mock("next/navigation", () => {
  const nav = jest.requireActual("@/test-utils/render-world").navigationMock
  return { ...nav, useParams: () => ({ id: "R1", locale: "ar" }) }
})
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

import React from "react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import RequestsPage from "@/app/[locale]/(contractor)/contractor/rfqs/requests/page"
import RfqsPage from "@/app/[locale]/(contractor)/contractor/rfqs/page"
import OrdersPage from "@/app/[locale]/(contractor)/contractor/rfqs/orders/page"
import ChatsRootPage from "@/app/[locale]/(contractor)/contractor/chats/page"
import SettingsPage from "@/app/[locale]/(contractor)/contractor/rfqs/settings/page"
import GuidePage from "@/app/[locale]/(contractor)/contractor/rfqs/guide/page"
import MyRequestsPage from "@/app/[locale]/(contractor)/contractor/rfqs/my-requests/page"
import NewRfqPage from "@/app/[locale]/(contractor)/contractor/rfqs/new/page"
import { RfqOffersView } from "@/components/contractor/RfqOffersView"
import { fromMfgRequest, fromPmRequest, newTeamRequest } from "@/lib/procurement/incoming-ingest"
import { incomingDocId, type IncomingDoc } from "@/lib/procurement/incoming-state"
import type { ProjectRequestDoc } from "@/lib/procurement/needs"
import { PACKAGE_STATES, offFor } from "@/lib/procurement/package"
import { riyadhDay } from "@/lib/hr/format"

installDomShims()
jest.setTimeout(900_000)

const ORG = "own"
const TODAY = riyadhDay()
const addDay = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const tree = readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")

beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    const u = String(url)
    if (u.includes("material-tree")) return { ok: true, json: async () => JSON.parse(tree) }
    if (u.includes("team-requests")) return { ok: true, json: async () => ({ success: true, data: { requests: [] } }) }
    return { ok: true, json: async () => ({ success: true, data: {} }) }
  })
})

async function flush(n = 6) {
  for (let i = 0; i < n; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

const offerDoc = (id: string, name: string, lines: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => ({
  rfqId: "R1",
  contractorOrgId: ORG,
  organizationId: id,
  supplierId: id,
  companyName: name,
  status: "قيد المراجعة",
  vatRegistered: true,
  leadDays: 5,
  validUntil: addDay(30),
  createdAt: `${addDay(-1)}T08:00:00.000Z`,
  offerPdfUrl: "https://x/q.pdf",
  creditDays: 30,
  advancePercent: 0,
  price: "0",
  lines,
  versions: [{ n: 1 }],
  rev: 1,
  ...over,
})
const poLine = (id: string, name: string, quantity: number, over: Record<string, unknown> = {}) => ({ id, name, unit: "طن", quantity, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0, rfqProductIndex: 0, ...over })
const poDoc = (n: number, status: string, over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: `PO-2026/00${n}`,
  status,
  basis: "rfq",
  rfqId: "R2",
  rfqTitle: "حديد التسليح",
  offerId: `o${n}`,
  supplierOrgId: "east",
  supplierUserId: "east",
  supplierName: "الشرق",
  isGuestSupplier: false,
  lines: [poLine("l1", "حديد تسليح 16", 10)],
  totalExVat: 30000,
  vatRate: 0.15,
  preparedById: ORG,
  preparedByName: "المالك",
  createdAt: `${addDay(-9)}T08:00:00Z`,
  approverKind: "manager",
  leadTimeDays: 10,
  dueDate: addDay(6),
  log: [],
  ver: 1,
  versions: [{ n: 1, at: `${addDay(-8)}T08:00:00Z`, byName: "المالك", kind: "sent" }],
  ...over,
})

function world() {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
  seed(`procurementSettings/${ORG}`, { organizationId: ORG, deliverySites: [{ id: "site-1", kind: "site", name: "مجمع الياسمين", city: "الرياض", district: "الياسمين", address: "", receiverId: null }] })
  seed("projects/P1", { organizationId: ORG, contractorId: ORG, name: "برج الواحة", status: "in_progress", enabledSections: ["contract", "procure", "receive", "store"], pm: { no: "PJ-2026/001", lifecycle: "live", startOn: addDay(-60), durationDays: 300 } })

  seed("rfqs/R1", {
    organizationId: ORG,
    contractorId: ORG,
    createdByUserId: ORG,
    createdByUserName: "المالك",
    rfqNumber: "RFQ-2026/011",
    title: "زوايا حديد وخشب ألواح",
    status: "New",
    visibility: "public",
    category: "Construction Materials",
    city: "الرياض",
    pricingMode: "line",
    deadline: addDay(4),
    createdAt: `${addDay(-5)}T08:00:00.000Z`,
    offersCount: 6,
    reachedCount: 10,
    viewsCount: 19,
    paymentTermsList: [{ pct: 100, days: 30 }],
    products: [
      { name: "زوايا حديد 50×50×5 مم", quantity: 175, unitOfMeasure: "م" },
      { name: "خشب ألواح", quantity: 320, unitOfMeasure: "م" },
    ],
  })
  seed("rfqs/R2", { organizationId: ORG, contractorId: ORG, createdByUserId: ORG, rfqNumber: "RFQ-2026/009", title: "حديد التسليح", status: "Awarded", visibility: "private", city: "الرياض", pricingMode: "line", deadline: addDay(-3), createdAt: `${addDay(-14)}T08:00:00.000Z`, offersCount: 2, products: [{ name: "حديد تسليح 16", quantity: 10, unitOfMeasure: "طن" }] })
  seed("rfqs/R3", { organizationId: ORG, contractorId: ORG, createdByUserId: ORG, rfqNumber: "RFQ-2026/010", title: "بلوك خرساني", status: "New", visibility: "public", city: "الرياض", pricingMode: "line", deadline: addDay(-1), createdAt: `${addDay(-8)}T08:00:00.000Z`, offersCount: 0, products: [{ name: "بلوك 20 سم", quantity: 5000, unitOfMeasure: "حبة" }] })

  const two = (a: number, b: number, extra: Record<string, unknown> = {}) => [{ rfqProductIndex: 0, unitPrice: a, ...extra }, { rfqProductIndex: 1, unitPrice: b }]
  seed("offers/quality", offerDoc("quality", "مصنع الجودة", two(12.5, 3.6), { leadDays: 7 }))
  seed("offers/east", offerDoc("east", "الشرق", two(146, 3.8, { packLen: 12 }), { leadDays: 4 }))
  seed("offers/mid", offerDoc("mid", "الوسطى", two(74, 3.9, { packLen: 6 }), { creditDays: 60 }))
  seed("offers/hope", offerDoc("hope", "الأمل", [{ rfqProductIndex: 0, unitPrice: 80, packLen: 6 }, { rfqProductIndex: 1, unitPrice: 13.5, packLen: 4 }], { isGuestOffer: true, supplierId: "guest", organizationId: "guest", guestContact: { name: "سعد", phone: "0551112222" }, vatRegistered: false }))
  seed("offers/modern", offerDoc("modern", "البناء الحديث", [{ rfqProductIndex: 1, unitPrice: 14.2, packLen: 4 }], { skippedItems: [0] }))
  seed("offers/o2", { ...offerDoc("east", "الشرق", [{ rfqProductIndex: 0, unitPrice: 3000 }]), rfqId: "R2", status: "مقبول" })
  seed("offerDecisions/mid", { offerId: "mid", rfqId: "R1", organizationId: ORG, shortlist: null, exclusion: { code: "spec", text: null, at: "x", byId: ORG, byName: "المالك" }, log: [], updatedAt: "x" })
  seed("offerDecisions/quality", { offerId: "quality", rfqId: "R1", organizationId: ORG, shortlist: { at: "x", byId: ORG, byName: "المالك" }, exclusion: null, log: [], updatedAt: "x" })
  seed("rfqs/R1/inquiries/q1", { kind: "ask", question: "هل التسليم شامل التنزيل؟", from: { orgId: null, anon: true }, via: "link", answer: null, reply: null, createdAt: `${addDay(-2)}T09:00:00.000Z`, li: 0 })
  seed("rfqs/R1/inquiries/q2", { kind: "ask", question: "ما مدة الضمان؟", supplierName: "الشرق", organizationId: "east", from: { orgId: "east", anon: false }, via: "portal", answer: { text: "سنتان", all: true, at: `${addDay(-1)}T09:00:00.000Z`, byId: ORG, byName: "المالك" }, reply: "سنتان", sentToAll: true, createdAt: `${addDay(-3)}T09:00:00.000Z` })

  seed("purchaseOrders/po1", poDoc(1, "awaiting_approval", { versions: [], ver: 0 }))
  seed("purchaseOrders/po2", poDoc(2, "sent", { approvedAt: `${addDay(-8)}T08:00:00Z`, approvedById: "mgr", approvedByName: "منى", sentAt: `${addDay(-8)}T09:00:00Z`, sentChannel: "portal" }))
  seed("purchaseOrders/po3", poDoc(3, "accepted", { approvedAt: `${addDay(-8)}T08:00:00Z`, sentAt: `${addDay(-8)}T09:00:00Z`, supplierAcceptedAt: `${addDay(-7)}T09:00:00Z`, promisedDate: addDay(3), lines: [poLine("l1", "حديد تسليح 16", 10, { accepted: 4 })] }))
  seed("purchaseOrders/po4", poDoc(4, "accepted", { supplierName: "مؤسسة الرمال", isGuestSupplier: true, supplierOrgId: "guest", supplierUserId: null, approvedAt: `${addDay(-30)}T08:00:00Z`, sentAt: `${addDay(-30)}T09:00:00Z`, supplierAcceptedAt: `${addDay(-29)}T09:00:00Z`, promisedDate: addDay(-5), dueDate: addDay(-5) }))
  seed("purchaseOrders/po5", poDoc(5, "cancelled", { cancelledReason: "لم تعد الحاجة قائمة", cancelledAt: `${addDay(-4)}T08:00:00Z` }))
  seed("deliveries/n1", { contractorOrgId: ORG, supplierOrgId: "east", supplierName: "الشرق", rfqId: "R2", poId: "po3", poNumber: "PO-2026/003", status: "pending_confirmation", deliveryDate: addDay(1), noticeOnly: true, createdAt: `${addDay(-1)}T08:00:00Z` })
  seed("poMessages/po3__1", { poId: "po3", organizationId: ORG, supplierOrgId: "east", seq: 1, by: "sup", authorId: "east", authorName: "الشرق", text: "الشحنة غداً", file: null, channel: "portal", at: `${addDay(-1)}T10:00:00Z` })

  const team = newTeamRequest({
    organizationId: ORG,
    id: "t1",
    no: "MAT-2026/021",
    seq: 21,
    lines: [{ name: "الاسمنت العادي", unit: "كيس", quantity: 200 }, { name: "حديد 16", unit: "طن", quantity: 12 }],
    needBy: addDay(20),
    place: { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" },
    requestedBy: { id: "eng1", name: "م. فهد العتيبي" },
    requestedFor: { kind: "member", id: "eng1", name: "م. فهد العتيبي" },
    at: `${addDay(-2)}T08:00:00.000Z`,
  })
  const put = (doc: IncomingDoc) => seed(`procIncoming/${incomingDocId(ORG, doc.mrKey)}`, doc as unknown as Record<string, unknown>)
  put(team)
  put({ ...team, mrKey: "team:t2", no: "MAT-2026/022", seq: 22, lines: team.lines.map((l) => ({ ...l, ps: "rfq" as const, rfqId: "R1", rfqNumber: "RFQ-2026/011" })), st: "rfq" })
  put({ ...team, mrKey: "team:t3", no: "MAT-2026/023", seq: 23, st: "fail", status: "closed", lines: team.lines.map((l) => ({ ...l, ps: "fail" as const, fail: { code: "avail" as const, why: "المادة غير متوفرة في السوق", alt: "مكافئ من الخرج", at: `${addDay(-1)}T08:00:00Z`, by: "بدر" }, v: 2 })) })
  put({ ...team, mrKey: "team:t4", no: "MAT-2026/024", seq: 24, st: "wd", status: "closed", withdrawn: { at: `${addDay(-1)}T08:00:00Z`, by: "eng1", name: "م. فهد العتيبي" } })
  put(fromMfgRequest(ORG, { id: "WO1", ref: "WO-2026/052", context: "درج رخام — فيلا الملقا" }, { id: "PRQ1", itemName: "غراء رخام", unit: "كيس", quantity: 20, needBy: addDay(9), note: null, by: "ورشة", byId: "w1", at: `${addDay(-1)}T08:00:00Z`, state: "sent" } as never, { number: "MAT-2026/025", seq: 25 }))
  seed("projects/P1/purchaseRequests/01", {
    pm: true,
    seq: 1,
    title: "حديد للأعمدة",
    status: "approved",
    needBy: addDay(6),
    requestedByUserId: ORG,
    requestedByUserName: "المالك",
    approvedByName: "م. خالد",
    approvedOn: addDay(-2),
    createdAt: `${addDay(-3)}T08:00:00.000Z`,
    lines: [{ itemId: "b1", code: "03-01", key: "k1", name: "حديد تسليح 16 مم", unit: "طن", qty: 25 }],
    items: [{ name: "حديد تسليح 16 مم", unit: "طن", quantity: 25, itemId: "b1" }],
  })
  const approved = { id: "01", pm: true, seq: 1, title: "حديد للأعمدة", status: "approved", needBy: addDay(6), requestedByUserId: ORG, requestedByUserName: "المالك", approvedByName: "م. خالد", approvedOn: addDay(-2), createdAt: `${addDay(-3)}T08:00:00.000Z`, lines: [{ itemId: "b1", code: "03-01", key: "k1", name: "حديد تسليح 16 مم", unit: "طن", qty: 25 }], items: [{ name: "حديد تسليح 16 مم", unit: "طن", quantity: 25, itemId: "b1" }] }
  put(fromPmRequest(ORG, { id: "P1", name: "برج الواحة" }, approved as unknown as ProjectRequestDoc & Record<string, unknown>))
}

type Page = { id: string; path: string; search?: string; node: () => React.ReactElement; clickTabs?: boolean }
const PAGES: Page[] = [
  { id: "requests", path: "/contractor/rfqs/requests", node: () => <RequestsPage />, clickTabs: true },
  { id: "my-requests", path: "/contractor/rfqs/my-requests", node: () => <MyRequestsPage /> },
  { id: "rfqs", path: "/contractor/rfqs", node: () => <RfqsPage /> },
  { id: "rfq-offers", path: "/contractor/rfqs/R1/offers", search: "tab=list", node: () => <RfqOffersView rfqId="R1" /> },
  { id: "rfq-compare", path: "/contractor/rfqs/R1/offers", search: "tab=compare", node: () => <RfqOffersView rfqId="R1" /> },
  { id: "rfq-questions", path: "/contractor/rfqs/R1/offers", search: "tab=inquiries", node: () => <RfqOffersView rfqId="R1" /> },
  { id: "rfq-details", path: "/contractor/rfqs/R1/offers", search: "tab=details", node: () => <RfqOffersView rfqId="R1" /> },
  { id: "rfq-awarded", path: "/contractor/rfqs/R2/offers", search: "tab=list", node: () => <RfqOffersView rfqId="R2" /> },
  { id: "rfq-no-offers", path: "/contractor/rfqs/R3/offers", search: "tab=list", node: () => <RfqOffersView rfqId="R3" /> },
  { id: "orders", path: "/contractor/rfqs/orders", node: () => <OrdersPage />, clickTabs: true },
  { id: "order-waiting", path: "/contractor/rfqs/orders", search: "po=po1", node: () => <OrdersPage /> },
  { id: "order-sent", path: "/contractor/rfqs/orders", search: "po=po2", node: () => <OrdersPage /> },
  { id: "order-accepted", path: "/contractor/rfqs/orders", search: "po=po3", node: () => <OrdersPage /> },
  { id: "order-guest-late", path: "/contractor/rfqs/orders", search: "po=po4", node: () => <OrdersPage /> },
  { id: "order-cancelled", path: "/contractor/rfqs/orders", search: "po=po5", node: () => <OrdersPage /> },
  { id: "chats-root", path: "/contractor/chats", node: () => <ChatsRootPage /> },
  { id: "settings", path: "/contractor/rfqs/settings", node: () => <SettingsPage />, clickTabs: true },
  { id: "guide", path: "/contractor/rfqs/guide", node: () => <GuidePage /> },
  { id: "new-rfq", path: "/contractor/rfqs/new", node: () => <NewRfqPage /> },
]

const BAD = /MISSING|undefined|NaN|\[object|Infinity|\{[A-Za-z_]+\}/
const text = () => document.body.textContent ?? ""
const problems = (label: string): string[] => {
  const out: string[] = []
  const body = text()
  const m = body.match(BAD)
  if (m) out.push(`${label}: «${m[0]}» near «${body.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 30).replace(/\s+/g, " ")}»`)
  if ([...missingKeys].length) out.push(`${label}: missing keys ${[...missingKeys].slice(0, 5).join(", ")}`)
  return out
}

beforeAll(() => world())

describe.each(PACKAGE_STATES.map((s) => [s.id, s] as const))("the %s package", (_id, state) => {
  describe.each(["ar", "en"] as const)("in %s", (locale) => {
    it.each(PAGES.map((p) => [p.id, p] as const))("%s", async (_name, page) => {
      seed(`companyModules/${ORG}`, { organizationId: ORG, off: offFor(state.pkg) })
      setLocale(locale)
      setSignedIn(ORG)
      setPathname(page.path, page.search ?? "")
      missingKeys.clear()
      const view = render(page.node())
      await flush()
      const found = problems(`${state.id}/${locale}/${page.id}`)
      expect(text().length).toBeGreaterThan(40)
      if (page.clickTabs && (locale === "ar" || state.id === "full")) {
        const tabs = Array.from(document.querySelectorAll('[role="tab"]')) as HTMLElement[]
        for (const [i, tab] of tabs.slice(0, 10).entries()) {
          await act(async () => void fireEvent.click(tab))
          await flush(3)
          found.push(...problems(`${state.id}/${locale}/${page.id}#tab${i}`))
        }
      }
      view.unmount()
      setLocale("ar")
      expect(found).toEqual([])
    })
  })
})

// The package states switch Projects, Finance and Manufacturing; HR is a fourth switch of the contractor that stays on with Finance.
// With Finance on, HR can be off on its own — the four combinations the states above never reach.
describe.each(PACKAGE_STATES.filter((s) => s.pkg.fin).map((s) => [s.id, s] as const))("the %s package with HR switched off", (_id, state) => {
  describe.each(["ar", "en"] as const)("in %s", (locale) => {
    it.each(PAGES.map((p) => [p.id, p] as const))("%s", async (_name, page) => {
      seed(`companyModules/${ORG}`, { organizationId: ORG, off: [...offFor(state.pkg), "hr"] })
      setLocale(locale)
      setSignedIn(ORG)
      setPathname(page.path, page.search ?? "")
      missingKeys.clear()
      const view = render(page.node())
      await flush()
      const found = problems(`${state.id}+noHR/${locale}/${page.id}`)
      expect(text().length).toBeGreaterThan(40)
      view.unmount()
      setLocale("ar")
      expect(found).toEqual([])
    })
  })
})
