/**
 * Supplier 1.0 — the package's render sweep (qa_sweep): every free screen, rendered over the prototype's 144-deal world
 * in both languages, shows no `undefined`, `NaN`, `[object`, unfilled `{var}` or old document code (ط.ش · ا.س · GRN- ·
 * PO-), and every button and link inside has a name.
 */

import React from "react"
import { render } from "@testing-library/react"

jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }
let mockSearch = ""
jest.mock("@/i18n/routing", () => {
  const R = jest.requireActual<typeof import("react")>("react")
  return {
    Link: R.forwardRef<HTMLAnchorElement, { href: string; children?: React.ReactNode }>(function Link({ href, children, ...rest }, ref) {
      const { scroll: _s, ...props } = rest as Record<string, unknown>
      return R.createElement("a", { ref, href, ...props }, children)
    }),
    usePathname: () => "/supplier",
    useRouter: () => mockRouter,
  }
})
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  usePathname: () => "/supplier",
  useParams: () => ({}),
  useRouter: () => mockRouter,
}))
jest.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join("/") }),
  updateDoc: jest.fn(),
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  addDoc: jest.fn(),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  deleteField: jest.fn(),
  serverTimestamp: jest.fn(),
  increment: jest.fn(),
  arrayUnion: jest.fn(),
  arrayRemove: jest.fn(),
  writeBatch: jest.fn(),
}))
jest.mock("@/firebase", () => ({
  useFirestore: () => null,
  useUser: () => ({ user: null, isUserLoading: false }),
  useCollection: () => ({ data: null, isLoading: false }),
  useDoc: () => ({ data: null, isLoading: false }),
  useMemoFirebase: (f: () => unknown) => f(),
  useStorage: () => null,
  useAuth: () => null,
}))
jest.mock("@/hooks/useResolvedProfile", () => ({ useResolvedProfile: () => ({ profile: null, organizationId: "u1", isLoading: false }) }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock("@/components/supplier-free/useFreeNotifications", () => ({
  stripEmoji: (s: string) => s,
  useFreeNotifications: () => ({ list: [], unread: [], markRead: jest.fn(), markAll: jest.fn() }),
}))
let mockFree: Record<string, unknown> = {}
jest.mock("@/components/supplier-free/ActionsProvider", () => ({ useActions: () => ({ open: jest.fn() }), useWriteEnv: () => null, poErrorText: () => "" }))
jest.mock("@/components/supplier-free/useFree", () => ({ useFree: () => mockFree }))
jest.mock("@/components/supplier-free/FreeWorldProvider", () => ({
  useFreeWorld: () => mockFree,
  useWorldReady: () => true,
  closeContractors: () => [],
}))

import { installDomShims, intlMock, setLocale } from "@/test-utils/render-world"
import { protoWorld } from "@/test-utils/supplier-free-world"
import { createWorldLogic } from "@/lib/supplier-free/world-logic"
import { fmtN, makeFmt, relKey } from "@/lib/supplier-free/format"
import { FreeOpps } from "@/components/supplier-free/FreeOpps"
import { FreeOffers } from "@/components/supplier-free/FreeOffers"
import { FreeOrders } from "@/components/supplier-free/FreeOrders"
import { FreeInvoices } from "@/components/supplier-free/FreeInvoices"
import { FreeConnections } from "@/components/supplier-free/FreeConnections"
import { FreeMessages, FreeNotifications, FreeSearch } from "@/components/supplier-free/FreeInbox"
import { FreeToday } from "@/components/supplier-free/FreeToday"

installDomShims()

function makeFree(locale: "ar" | "en") {
  setLocale(locale)
  const t = intlMock.useTranslations("SupplierFree")
  const { today, world } = protoWorld()
  const L = createWorldLogic(today, world)
  const fmt = makeFmt(locale, { cur: t("cur"), thousand: t("unitK"), million: t("unitM") }, 2026)
  const pl = (k: string, n: number) => t(k, { n, c: fmtN(n) })
  const rel = (iso: string) => {
    const r = relKey(L.daysTo(iso))
    return r.key === "inX" || r.key === "agoX" ? t(r.key, { x: pl("pl_day", r.days) }) : t(r.key)
  }
  return {
    ready: true,
    today,
    world,
    L,
    profile: { uid: "u1", orgId: "u1", name: "Sami Ali", companyName: "Al Noor Trading", phone: "+966512345678", email: "", city: "الرياض", specializations: ["حديد ومعادن"], coverageCities: ["الرياض"], isVerified: false, raw: {} },
    pos: [],
    refreshInvites: jest.fn(),
    rawRfq: () => null,
    rawOffer: () => null,
    poOf: () => null,
    archive: jest.fn(),
    markSeen: jest.fn(),
    t,
    tCat: t,
    locale,
    isAr: locale === "ar",
    fmt,
    pl,
    rel,
  }
}

const SCREENS: [string, () => React.ReactElement][] = [
  ["Today", () => <FreeToday />],
  ["Quote requests", () => <FreeOpps />],
  ["My quotes", () => <FreeOffers />],
  ["Orders", () => <FreeOrders />],
  ["Invoices", () => <FreeInvoices />],
  ["Contractors", () => <FreeConnections />],
  ["Messages", () => <FreeMessages />],
  ["Notifications", () => <FreeNotifications />],
  ["Search", () => <FreeSearch q="UAT" />],
]

describe.each(["ar", "en"] as const)("render sweep (%s)", (locale) => {
  it.each(SCREENS)("%s shows no placeholder leaks and every button has a name", (_name, screen) => {
    mockFree = makeFree(locale)
    mockSearch = ""
    const { container } = render(screen())
    const text = container.textContent || ""
    expect(text.length).toBeGreaterThan(20)
    expect(text).not.toMatch(/undefined|NaN|\[object|\{[a-zA-Z]+\}|ط\.ش|ا\.س|GRN-|\bPO-/)
    const unnamed = [...container.querySelectorAll("button,a")].filter((e) => !(e.textContent || "").trim() && !e.getAttribute("aria-label") && !e.getAttribute("title") && !e.querySelector("img[alt]"))
    expect(unnamed.map((e) => e.outerHTML.slice(0, 120))).toEqual([])
  })
})
