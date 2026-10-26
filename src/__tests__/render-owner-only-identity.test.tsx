/**
 * DEV-60 (meeting 4 Oct, point 6): the company's registration and tax numbers, papers and bank account are the owner's
 * alone. The two account pages (contractor, supplier on the full plan) and the free supplier's company account show them
 * to the owner and to a legacy solo account (no organizationRole — the rules call it an owner), and to a team member
 * only the owner-only notice, with the number nowhere on the page.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => {
  const { useMemo } = jest.requireActual<typeof import("react")>("react")
  const base = jest.requireActual("@/test-utils/render-world").firebaseMock
  return {
    ...base,
    useUser: () => {
      const { user, ...rest } = base.useUser()
      return { ...rest, user: useMemo(() => (user ? { ...user, providerData: [] } : null), [user]) }
    },
  }
})
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: null }), sendEmailVerification: jest.fn() }))
jest.mock("firebase/storage", () => ({ ref: jest.fn(), uploadBytes: jest.fn(), getDownloadURL: jest.fn(), deleteObject: jest.fn() }))

let mockFree: Record<string, unknown> = {}
jest.mock("@/components/supplier-free/useFree", () => ({ useFree: () => mockFree }))
jest.mock("@/components/supplier-free/FreeWorldProvider", () => ({ useFreeWorld: () => mockFree, useWorldReady: () => true }))

import React from "react"
import { act, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, intlMock, missingKeys, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import ContractorProfilePage from "@/app/[locale]/(contractor)/contractor/profile/page"
import { FreeAccount } from "@/components/supplier-free/FreeAccount"
import { OwnerOnlyGate } from "@/components/OwnerOnlyGate"

installDomShims()
jest.setTimeout(60_000)

const CR = "1010123456"
const VAT = "300000000000003"
const NOTICE = "متاح لمالك الحساب فقط"

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const text = () => document.body.textContent ?? ""
const fieldValues = () => Array.from(document.querySelectorAll("input, textarea")).map((el) => (el as HTMLInputElement).value)
const shows = (needle: string) => text().includes(needle) || fieldValues().some((v) => v.includes(needle))

function seedCompany(role: "owner" | "member" | "legacy") {
  resetFakeDb()
  const identity = { name: "المالك", companyName: "شركة البنيان", phone: "+966500000001", city: "الرياض", location: "حي العليا", crNumber: CR, taxNumber: VAT, email: "o@test.sa" }
  if (role === "legacy") {
    seed("users/solo", identity)
    return "solo"
  }
  seed("users/own", { ...identity, organizationId: "own", organizationRole: "owner" })
  if (role === "owner") return "own"
  seed("users/mem", { name: "نورة", email: "m@test.sa", organizationId: "own", organizationRole: "member", defaultGroupId: "g_all" })
  seed("teamGroups/g_all", { organizationId: "own", name: "all", key: null, permissions: ["*"] })
  return "mem"
}

beforeEach(() => {
  setLocale("ar")
  missingKeys.clear()
  window.localStorage.setItem("profile_tour_seen", "true")
})

describe("the contractor's company profile", () => {
  beforeEach(() => setPathname("/contractor/profile", ""))

  it("the owner sees the registration and tax numbers", async () => {
    setSignedIn(seedCompany("owner"))
    render(<ContractorProfilePage />)
    await flush()
    expect(shows(CR)).toBe(true)
    expect(shows(VAT)).toBe(true)
    expect(text()).not.toContain(NOTICE)
  })

  it("a legacy solo account (no organizationRole) is the owner and sees them", async () => {
    setSignedIn(seedCompany("legacy"))
    render(<ContractorProfilePage />)
    await flush()
    expect(shows(CR)).toBe(true)
    expect(text()).not.toContain(NOTICE)
  })

  it("a team member — even with every permission — gets the owner-only notice and no number", async () => {
    setSignedIn(seedCompany("member"))
    render(<ContractorProfilePage />)
    await flush()
    expect(text()).toContain(NOTICE)
    expect(shows(CR)).toBe(false)
    expect(shows(VAT)).toBe(false)
    expect([...missingKeys]).toEqual([])
  })
})

describe("the free supplier's company account", () => {
  beforeEach(() => {
    setPathname("/supplier/profile", "")
    const t = intlMock.useTranslations("SupplierFree")
    mockFree = {
      ready: true,
      t,
      locale: "ar",
      isAr: true,
      pos: [],
      world: { deals: [] },
      profile: {
        uid: "x",
        orgId: "own",
        name: "المالك",
        companyName: "شركة النور",
        phone: "+966500000001",
        email: "o@test.sa",
        city: "الرياض",
        specializations: [],
        specialtyIds: [],
        coverageCities: [],
        isVerified: false,
        raw: { crNumber: CR, taxNumber: VAT, nationalAddress: "حي العليا", legalDocuments: {} },
      },
    }
    seed("companyIdentity/own", { iban: "SA0380000000608010167519", bankName: "الراجحي" })
  })

  it("the owner sees the registration number and the bank account", async () => {
    setSignedIn(seedCompany("owner"))
    seed("companyIdentity/own", { iban: "SA0380000000608010167519", bankName: "الراجحي" })
    render(<FreeAccount />)
    await flush()
    expect(shows(CR)).toBe(true)
    expect(shows(VAT)).toBe(true)
    expect(text()).not.toContain(NOTICE)
  })

  it("a legacy solo account is the owner and sees the registration number", async () => {
    setSignedIn(seedCompany("legacy"))
    render(<FreeAccount />)
    await flush()
    expect(shows(CR)).toBe(true)
    expect(text()).not.toContain(NOTICE)
  })

  it("a team member gets the owner-only notice: no number, no tax number, no bank account, none of the tabs", async () => {
    setSignedIn(seedCompany("member"))
    seed("companyIdentity/own", { iban: "SA0380000000608010167519", bankName: "الراجحي" })
    render(<FreeAccount />)
    await flush()
    expect(text()).toContain(NOTICE)
    for (const secret of [CR, VAT, "SA0380000000608010167519", "الراجحي"]) expect(shows(secret)).toBe(false)
    expect(document.querySelectorAll("input, textarea, [role=tab], [role=tablist]").length).toBe(0)
    expect([...missingKeys]).toEqual([])
  })
})

describe("OwnerOnlyGate", () => {
  it("hides what it wraps from a member and shows it to the owner", async () => {
    setSignedIn(seedCompany("member"))
    const member = render(
      <OwnerOnlyGate>
        <p>secret-child</p>
      </OwnerOnlyGate>
    )
    await flush()
    expect(text()).toContain(NOTICE)
    expect(text()).not.toContain("secret-child")
    member.unmount()

    setSignedIn("own")
    render(
      <OwnerOnlyGate>
        <p>secret-child</p>
      </OwnerOnlyGate>
    )
    await flush()
    expect(text()).toContain("secret-child")
  })
})
