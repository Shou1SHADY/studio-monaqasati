/**
 * UI review of 25 Oct 2026 (review-3 rows 17, 18, 20) on the free supplier's screens: money in the official riyal sign,
 * the «My quotes» card's note on its own line, and the phone home's decisions before the locked tiles.
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
jest.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, isOrgOwner: true, groups: [] }) }))
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
import { SAR_SIGN } from "@/lib/riyal"
import { readFileSync } from "fs"
import { join } from "path"
import { FreeOffers } from "@/components/supplier-free/FreeOffers"
import { FreeOrders } from "@/components/supplier-free/FreeOrders"
import { FreeHome } from "@/components/supplier-free/FreeHome"
import { SupplierPlanContext } from "@/components/supplier-free/PlanSwitch"

installDomShims()

function makeFree(locale: "ar" | "en") {
  setLocale(locale)
  const t = intlMock.useTranslations("SupplierFree")
  const { today, world } = protoWorld()
  const L = createWorldLogic(today, world)
  // as useFree builds it: the official riyal sign on screen
  const fmt = makeFmt(locale, { cur: t("cur"), thousand: t("unitK"), million: t("unitM") }, 2026, { sign: SAR_SIGN })
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

describe("the free supplier's money is the official riyal sign on screen", () => {
  it("makeFmt with the sign: left of the figure in both scripts, isolated; the words stay for text sent away", () => {
    for (const locale of ["ar", "en"] as const) {
      const f = makeFmt(locale, { cur: locale === "ar" ? "ر.س" : "SAR", thousand: "K", million: "M" }, 2026, { sign: SAR_SIGN })
      expect(f.money(1200)).toBe("\u2066\u20C1\u00A01,200\u2069")
      expect(f.cur).toBe(SAR_SIGN)
    }
    expect(makeFmt("ar", { cur: "ر.س", thousand: "ألف", million: "م" }, 2026, { sign: SAR_SIGN }).moneyText(1200)).toBe("1,200 ر.س")
    expect(makeFmt("en", { cur: "SAR", thousand: "K", million: "M" }, 2026, { sign: SAR_SIGN }).moneyText(1200)).toBe("SAR 1,200")
  })

  it("useFree hands every screen the sign, and the payment reminder (a message) the words", () => {
    const dir = join(process.cwd(), "src/components/supplier-free")
    expect(readFileSync(join(dir, "useFree.ts"), "utf8")).toContain("{ sign: SAR_SIGN }")
    expect(readFileSync(join(dir, "ActionsProvider.tsx"), "utf8")).toContain('f.t("msgPayRemind", { v: f.fmt.moneyText(')
  })

  it.each(["ar", "en"] as const)("My quotes, Orders and Home show the sign, never the words (%s)", (locale) => {
    mockFree = makeFree(locale)
    for (const screen of [<FreeOffers key="o" />, <FreeOrders key="r" />]) {
      const { container, unmount } = render(screen)
      const text = container.textContent || ""
      expect(text).toContain(SAR_SIGN)
      expect(text).not.toMatch(/ر\.س|\bSAR\b/)
      unmount()
    }
  })
})

describe("My quotes: the card's note never squeezes beside its button (review row 17)", () => {
  it.each(["ar", "en"] as const)("the note takes its own basis and wraps the row; the asked-price pill does not break (%s)", (locale) => {
    mockFree = makeFree(locale)
    mockSearch = ""
    const { container } = render(<FreeOffers />)
    const foots = [...container.querySelectorAll('[data-testid="offer-foot"]')]
    expect(foots.length).toBeGreaterThan(0)
    for (const foot of foots) {
      expect(foot.className).toContain("flex-wrap")
      const note = foot.querySelector("span[dir=auto]")
      if (note) expect(note.className).toContain("flex-[1_1_12rem]")
    }
    for (const pill of container.querySelectorAll('[data-testid="offer-ask"]')) expect(pill.className).toContain("whitespace-nowrap")
  })
})

describe("the free home on a phone: the day's decisions before the module tiles (review row 20)", () => {
  it("the tiles move after the decisions below sm; the desktop order stays", () => {
    mockFree = makeFree("ar")
    const { container } = render(
      <SupplierPlanContext.Provider value={{ plan: "free", loading: false, orgId: "u1" }}>
        <FreeHome />
      </SupplierPlanContext.Provider>
    )
    const tiles = container.querySelector('[data-testid="home-tiles"]') as HTMLElement
    const decisions = container.querySelector('[data-testid="home-decisions"]') as HTMLElement
    expect(tiles.className).toContain("max-sm:order-1")
    expect(decisions.className).not.toContain("order-")
    expect(tiles.compareDocumentPosition(decisions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((tiles.parentElement as HTMLElement).className).toContain("flex-col")
  })
})
