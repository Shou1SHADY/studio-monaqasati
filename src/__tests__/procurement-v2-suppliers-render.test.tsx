jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => {
  const user = { uid: "acme", email: "acme@test.sa", getIdToken: async () => "id-token" }
  return { ...jest.requireActual("@/test-utils/render-world").firebaseMock, useUser: () => ({ user, isUserLoading: false, userError: null }) }
})
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/hooks/useMaterialTree", () => ({ useMaterialTree: () => ({ index: null }) }))
jest.mock("@/hooks/useSupplierVat", () => ({ useSupplierVat: () => "" }))

/**
 * Procurement 2.0, SUP-01..03 / NFR-03 — the two supplier lists are one component: the same filter bar and counts, rows or
 * cards, 24 and then «عرض N أخرى»; the off-platform supplier's file holds what we know, our orders and the two acts — and no
 * platform-profile slots; at 375px nothing needs a sideways scroll.
 */

import React, { useState } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { installDomShims, missingKeys, setLocale } from "@/test-utils/render-world"
import { OurSuppliersTable, type SupplierRow } from "@/components/procurement/OurSuppliersTable"
import { SupplierList } from "@/components/procurement/SupplierList"
import { SupplierFileDrawer } from "@/components/procurement/SupplierFileDrawer"
import { PriceHistoryView } from "@/components/procurement/PriceHistoryView"
import { AgreementsPanel } from "@/components/procurement/AgreementsPanel"
import { agreementRows, materialKey, type CappedAgreementLine, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { EMPTY_SUPPLIER_FILTER, listSuppliers, supplierFacets, type SupplierFilter, type SupplierListItem } from "@/lib/procurement/supplier-list"
import type { PlatformSupplier } from "@/hooks/useSupplierDirectory"
import type { ProcActor, PurchaseOrder } from "@/lib/procurement/types"
import ar from "../../messages/ar.json"

installDomShims()
jest.setTimeout(30_000)

const S = (ar as unknown as { Portal: { ProcSuppliers: { list: Record<string, string>; file2: Record<string, string> } } }).Portal.ProcSuppliers
const L = Object.assign({}, S.list, { file2: S.file2 })
const NOW = new Date("2026-10-21T09:00:00Z")

const item = (i: number, over: Partial<SupplierListItem> = {}): SupplierListItem => ({
  id: `s${i}`,
  name: `مورد ${String(i).padStart(3, "0")}`,
  city: i % 2 ? "جدة" : "الرياض",
  specialties: [`sub${i % 3}`],
  onPlatform: true,
  verified: true,
  preferred: false,
  ours: false,
  deals: i,
  onTimePercent: 90,
  rating: 4,
  since: "2024-01-01",
  hasProfile: i % 2 === 0,
  hasWorks: false,
  hasCerts: false,
  ...over,
})

function Harness({ items, kind = "dir", onAdd }: { items: SupplierListItem[]; kind?: "ours" | "dir"; onAdd?: (id: string) => void }) {
  const [filter, setFilter] = useState<SupplierFilter>(EMPTY_SUPPLIER_FILTER)
  const [layout, setLayout] = useState<"rows" | "cards">("rows")
  const [limit, setLimit] = useState(24)
  const page = listSuppliers(items, filter, kind, { limit })
  return (
    <SupplierList
      kind={kind}
      rows={page.rows}
      matched={page.matched}
      total={page.total}
      more={page.more}
      facets={supplierFacets(items, filter, kind)}
      filter={filter}
      onFilter={(f) => {
        setFilter(f)
        setLimit(24)
      }}
      layout={layout}
      onLayout={setLayout}
      specialtyLabel={(k) => `تخصص ${k}`}
      onOpen={() => {}}
      onAdd={onAdd}
      onShowMore={() => setLimit((n) => n + 24)}
    />
  )
}

beforeEach(() => {
  missingKeys.clear()
  setLocale("ar")
  window.innerWidth = 1024
})

describe("one list for both screens", () => {
  const many = Array.from({ length: 60 }, (_, i) => item(i))

  it("shows «24 من 60» and offers «عرض 24 أخرى», then «عرض 12 أخرى» on the last page", () => {
    render(<Harness items={many} />)
    expect(screen.getByRole("status").textContent).toBe(L.count.replace("{matched}", "60").replace("{total}", "60"))
    expect(screen.getAllByRole("row")).toHaveLength(25)
    fireEvent.click(screen.getByRole("button", { name: L.show_more.replace("{count}", "24") }))
    fireEvent.click(screen.getByRole("button", { name: L.show_more.replace("{count}", "12") }))
    expect(screen.getAllByRole("row")).toHaveLength(61)
    expect(screen.queryByRole("button", { name: /عرض \d+ أخرى/ })).toBeNull()
    expect(missingKeys.size).toBe(0)
  })

  it("filters by search and by city, says «N من M», and clears the filters from the empty state", () => {
    render(<Harness items={many} />)
    fireEvent.change(screen.getByPlaceholderText(L.search), { target: { value: "مورد 007" } })
    expect(screen.getByRole("status").textContent).toContain("1")
    fireEvent.change(screen.getByPlaceholderText(L.search), { target: { value: "لا يوجد أبداً" } })
    expect(screen.getByText(L.empty)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: L.clear }))
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1)
    fireEvent.change(screen.getByLabelText(L.all_cities), { target: { value: "جدة" } })
    expect(screen.getByRole("status").textContent).toBe(L.count.replace("{matched}", "30").replace("{total}", "60"))
  })

  it("the directory's statuses are the directory's, ours are ours", () => {
    const { unmount } = render(<Harness items={many} kind="dir" />)
    const options = (screen.getByLabelText(L.status_label) as HTMLSelectElement).options
    expect([...options].map((o) => o.text)).toEqual([L.dst_all, L.dst_prof, L.dst_works, L.dst_certs, L.dst_notours])
    unmount()
    render(<Harness items={many} kind="ours" />)
    expect([...(screen.getByLabelText(L.status_label) as HTMLSelectElement).options].map((o) => o.text)).toEqual([L.st_all, L.st_pref, L.st_ver, L.st_unver, L.st_off])
  })

  it("rows or cards with the same rows; the add button only for a supplier who is not ours yet", () => {
    const onAdd = jest.fn()
    render(<Harness items={[item(1, { ours: true }), item(2)]} onAdd={onAdd} />)
    expect(screen.getAllByRole("button", { name: L.add })).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: L.view_cards }))
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getAllByRole("button", { name: L.add })).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: L.add }))
    expect(onAdd).toHaveBeenCalledWith("s2")
    expect(screen.getAllByText(L.ours).length).toBeGreaterThan(0)
  })

  it("at 375px the rows become a card each — no table to scroll sideways", () => {
    window.innerWidth = 375
    render(<Harness items={many.slice(0, 5)} />)
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getAllByRole("listitem")).toHaveLength(5)
  })

  it("an off-platform supplier is marked and has no platform numbers", () => {
    render(<Harness items={[item(1, { onPlatform: false, verified: false, deals: null, onTimePercent: null, rating: null })]} kind="ours" />)
    expect(screen.getAllByText(L.off).length).toBeGreaterThan(0)
    expect(screen.getByText(L.no_platform_file)).toBeTruthy()
  })
})

describe("«مورّدونا» keeps what is ours", () => {
  const supplier = (over: Partial<PlatformSupplier> = {}): SupplierRow =>
    ({
      orgId: "s1",
      memberIds: ["s1"],
      name: "مصنع الشرق",
      city: "الدمام",
      coverageCities: [],
      categories: [],
      subIds: [],
      certificates: [],
      worksCount: 0,
      bio: null,
      phone: null,
      email: null,
      international: false,
      since: "2023-02-01",
      platformVerified: true,
      profileVat: null,
      profileHasVat: false,
      profileCrExpiry: null,
      reviews: [],
      rating: null,
      isMine: true,
      isFavorite: true,
      isExplicitFavorite: true,
      linkId: "l1",
      linkRequestedBy: null,
      record: null,
      score: { orders: 0, onTimePercent: null, rejectPercent: null, responsePercent: null },
      open: 2,
      ...over,
    }) as SupplierRow

  it("lays the platform's own numbers beside our docs state and open orders", () => {
    render(
      <OurSuppliersTable
        rows={[supplier()]}
        cards={new Map([["s1", { orgId: "s1", completedOps: 214, onTimePercent: 92, rating: 4.5 } as never]])}
        today="2026-10-21"
        filter={EMPTY_SUPPLIER_FILTER}
        onFilter={() => {}}
        layout="rows"
        onLayout={() => {}}
        specialtiesOf={() => ["steel"]}
        specialtyLabel={(k) => k}
        onOpen={() => {}}
      />
    )
    expect(screen.getByText("214")).toBeTruthy()
    expect(screen.getByText("92%")).toBeTruthy()
    expect(screen.getByText("4.5")).toBeTruthy()
    expect(screen.getByText(/★/)).toBeTruthy()
    const row = screen.getAllByRole("row")[1]
    expect(within(row).getByText(ar.Portal.ProcSuppliers.docs.no_vat)).toBeTruthy()
  })
})

describe("SUP-03: the off-platform supplier's file", () => {
  const actor = { isOwner: true, canApprove: true, canPrepare: true, seesPrices: true, uid: "u", name: "سعد" } as unknown as ProcActor
  const guest = {
    orgId: "guest_966561112299",
    memberIds: [],
    name: "أبو خالد",
    city: null,
    coverageCities: [],
    categories: [],
    subIds: [],
    certificates: [],
    worksCount: 0,
    bio: null,
    phone: "+966561112299",
    email: null,
    international: false,
    since: null,
    platformVerified: false,
    profileVat: null,
    profileHasVat: false,
    profileCrExpiry: null,
    reviews: [],
    rating: null,
    isMine: false,
    isFavorite: false,
    isExplicitFavorite: false,
    linkId: null,
    linkRequestedBy: null,
    record: { id: "r", organizationId: "acme", supplierOrgId: "guest_966561112299", supplierName: "أبو خالد", source: "guest_link", verified: false, kind: "mat" },
    contactName: "أبو خالد",
  } as unknown as PlatformSupplier
  const po = { id: "p1", docNumber: "PO-2026/011", supplierOrgId: "guest", isGuestSupplier: true, offerId: "of1", supplierName: "اسم آخر", status: "sent", lines: [{ id: "l1", name: "حديد", unit: "طن", quantity: 1, unitPrice: 10, accepted: 0, rejected: 0, held: 0, cancelled: 0 }], totalExVat: 10, vatRate: 0.15, log: [], createdAt: "2026-10-01T00:00:00Z" } as unknown as PurchaseOrder

  const open = (props: Partial<React.ComponentProps<typeof SupplierFileDrawer>> = {}) =>
    render(
      <SupplierFileDrawer
        supplier={guest}
        open
        onOpenChange={() => {}}
        score={null}
        invited={0}
        orders={[po]}
        offers={[{ id: "of1", guestContact: { phone: "0561112299" } }]}
        agreements={[]}
        actor={actor}
        orgId="acme"
        canManage
        now={NOW}
        onToggleFavorite={() => {}}
        onRemove={() => {}}
        onOpenAgreement={() => {}}
        {...props}
      />
    )

  it("says what we know and shows our orders — and none of the platform profile's slots", () => {
    open({ onInvite: jest.fn() })
    expect(screen.getByText(L.file2.off_platform)).toBeTruthy()
    expect(screen.getByText(L.file2.we_know)).toBeTruthy()
    expect(screen.getByText("+966561112299")).toBeTruthy()
    expect(screen.queryByText(new RegExp(L.file2.certs))).toBeNull()
    expect(screen.queryByText(L.file2.official)).toBeNull()
    expect(screen.getByText(/PO-2026\/011|ط\.ش-2026\/011/)).toBeTruthy()
    expect(missingKeys.size).toBe(0)
  })

  it("«ادعُه إلى المنصة» opens the invitation with his name and mobile", () => {
    const onInvite = jest.fn()
    open({ onInvite })
    fireEvent.click(screen.getByRole("button", { name: L.file2.invite }))
    expect(onInvite).toHaveBeenCalledWith({ companyName: "أبو خالد", contactName: "أبو خالد", contact: "+966561112299", specialtyIds: [] })
  })

  it("«أضِفه إلى موردينا» only when he is not ours and an offer names him", () => {
    open({ addTarget: { offerId: "of1" }, onInvite: jest.fn() })
    expect(screen.getByRole("button", { name: L.file2.add })).toBeTruthy()
  })

  it("a platform supplier's file has the official data and the three optional slots with their empty states", () => {
    open({
      supplier: { ...guest, orgId: "sup9", memberIds: ["sup9"], record: null, crNumber: "1010123456", address: "الرياض، حي السلي", contactName: "مدير" } as PlatformSupplier,
      card: { orgId: "sup9", completedOps: 214, onTimePercent: 92, rating: 4.5 } as never,
    })
    expect(screen.getByText(L.file2.official)).toBeTruthy()
    expect(screen.getByText("214")).toBeTruthy()
    expect(screen.getByText("1010123456")).toBeTruthy()
    for (const key of ["no_profile", "no_works", "no_certs"] as const) expect(screen.getByText(L.file2[key])).toBeTruthy()
    expect(screen.queryByText(L.file2.off_platform)).toBeNull()
  })
})

describe("SUP-05 / SUP-06: price history and agreements on screen", () => {
  const TODAY = new Date().toISOString().slice(0, 10)
  const at = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
  const NAME = "حديد تسليح 16 مم"
  const KEY = materialKey(NAME, "طن")
  const rows: Array<[number, string, number]> = [
    [-150, "s1", 2720],
    [-120, "s1", 2750],
    [-70, "s1", 2810],
    [-45, "s1", 2840],
    [-31, "s1", 2900],
    [-14, "s1", 2880],
    [-4, "s4", 2780],
  ]
  const history: PriceHistoryEntry[] = rows.map(([off, sup, price], i) => ({ id: `po${i}__l1`, organizationId: "acme", materialKey: KEY, name: NAME, unit: "طن", supplierOrgId: sup, supplierName: `مورد ${sup}`, price, day: at(off), kind: "po", poId: `po${i}`, poNumber: `PO-2026/00${i}` }))
  const rfqs = [{ id: "r1", title: "حديد", rfqNumber: "RFQ-2026/001", products: [{ name: NAME, unitOfMeasure: "طن" }] }]
  const offers = [{ id: "off1", rfqId: "r1", status: "جديد", organizationId: "s11", supplierName: "مورد s11", createdAt: `${at(-39)}T08:00:00Z`, lines: [{ rfqProductIndex: 0, unitPrice: 2860 }] }]
  const agreement: PriceAgreement = { id: "a1", organizationId: "acme", docNumber: "AG-2026/01", supplierOrgId: "s7", supplierName: "خرسانة الشرق", from: at(-60), until: at(120), lines: [{ name: NAME, unit: "طن", price: 2850, cap: 600 } as CappedAgreementLine], preparedById: "u", preparedByName: "u", createdAt: at(-60) }
  const fmtDate = (v: unknown) => String(v)
  const view = (props: Partial<React.ComponentProps<typeof PriceHistoryView>> = {}) =>
    render(<PriceHistoryView history={history} orders={[]} receipts={[]} agreements={[agreement]} offers={offers} rfqs={rfqs} makeOrBuy={new Set()} locale="ar" fmtDate={fmtDate} query="" {...props} />)

  it("opens on a material: tiles with the prototype's figures, a chart with filled, hollow and square dots, and the table by source", () => {
    view({ agreements: [] })
    expect(screen.getByText("2,811.43")).toBeTruthy()
    expect(screen.getByText("−1.1%")).toBeTruthy()
    expect(document.querySelectorAll('[data-shape="hollow"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-shape="square"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-shape="filled"]').length).toBe(7)
    expect(screen.getAllByRole("row")).toHaveLength(1 + 7 + 1)
    expect(screen.getAllByText("−3.5%").length).toBeGreaterThan(0)
    expect(screen.getByText(ar.Portal.ProcPrices.hist2.source_offer)).toBeTruthy()
    expect(missingKeys.size).toBe(0)
  })

  it("with 300 purchases and 50 offers the table shows 24 and offers the next 24, and the page still renders", () => {
    const many: PriceHistoryEntry[] = Array.from({ length: 300 }, (_, i) => ({ id: `h${i}__l1`, organizationId: "acme", materialKey: KEY, name: NAME, unit: "طن", supplierOrgId: `s${i % 9}`, supplierName: `مورد ${i % 9}`, price: 2600 + (i % 40) * 10, day: at(-(i % 170)), kind: "po", poId: `h${i}`, poNumber: `PO-2026/${i}` }))
    const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `off${i}`, rfqId: "r1", status: "جديد", organizationId: `q${i}`, supplierName: `عارض ${i}`, createdAt: `${at(-(i * 3 + 1))}T08:00:00Z`, lines: [{ rfqProductIndex: 0, unitPrice: 2700 + i }] }))
    view({ history: many, offers: fifty, agreements: [] })
    expect(screen.getAllByRole("row")).toHaveLength(1 + 24)
    expect(screen.getByRole("button", { name: ar.Portal.ProcPrices.hist2.more.replace("{count}", "24") })).toBeTruthy()
  })

  it("a signed agreement is a square on the chart and a row marked «اتفاقية»", () => {
    view()
    expect(document.querySelectorAll('[data-shape="square"]')).toHaveLength(1)
    expect(screen.getAllByText(ar.Portal.ProcPrices.hist2.source_agreement).length).toBeGreaterThanOrEqual(2)
  })

  it("material chips switch the material; a search that matches none says so", () => {
    view({ history: [...history, { ...history[0], id: "x__l1", materialKey: materialKey("أسمنت", "كيس"), name: "أسمنت", unit: "كيس", price: 16 }] })
    fireEvent.click(screen.getByRole("button", { name: "أسمنت" }))
    expect(screen.getByRole("button", { name: "أسمنت" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.queryByText("2,811.43")).toBeNull()
  })

  it("the agreements table reads the cap and what the orders on it consumed", () => {
    const order = { id: "o1", agreementId: "a1", status: "approved", lines: [{ id: "l1", name: NAME, unit: "طن", quantity: 240, unitPrice: 2850, accepted: 0, rejected: 0, held: 0, cancelled: 0 }] } as unknown as PurchaseOrder
    render(<AgreementsPanel rows={agreementRows([agreement], TODAY)} orders={[order]} fmtDate={fmtDate} onOpen={() => {}} />)
    expect(screen.getByText(ar.Portal.ProcPrices.agr2.cap_of.replace("{used}", "240").replace("{cap}", "600").replace("{unit}", "طن"))).toBeTruthy()
    expect(screen.getByText(ar.Portal.ProcPrices.state.live)).toBeTruthy()
    expect(missingKeys.size).toBe(0)
  })

  it("an agreement with no cap says so; the table never claims one", () => {
    const noCap: PriceAgreement = { ...agreement, lines: [{ name: NAME, unit: "طن", price: 2850 }] }
    render(<AgreementsPanel rows={agreementRows([noCap], TODAY)} orders={[]} fmtDate={fmtDate} onOpen={() => {}} />)
    expect(screen.getByText(ar.Portal.ProcPrices.agr2.no_cap.replace("{consumed}", "0").replace("{unit}", "طن"))).toBeTruthy()
  })
})
