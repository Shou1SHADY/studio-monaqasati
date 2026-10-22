/**
 * Procurement 2.0, SUP-01 / SUP-02 / NFR-03 — «مورّدونا» and «دليل موردي المنصة» are one list with one method: search ·
 * specialty from the tree · city · status · sort, «N من M», 24 at a time. And what the platform knows of a supplier (operations
 * he completed across all buyers, on-time, a rating COMPUTED from his orders) is a pure function of those orders.
 */

import {
  DIR_STATUSES,
  EMPTY_SUPPLIER_FILTER,
  OURS_STATUSES,
  SUPPLIER_PAGE_SIZE,
  filterSuppliers,
  listSuppliers,
  sortSuppliers,
  statusOf,
  supplierFacets,
  supplierFilterActive,
  type SupplierFilter,
  type SupplierListItem,
} from "@/lib/procurement/supplier-list"
import { RATING_MIN_ORDERS, buildCard, cardToItem, computedRating, platformStats, statsAreFresh } from "@/lib/procurement/supplier-stats"
import { guestSupplierKey, ordersOfGuest, addGuestRefusal, isGuestSupplierKey } from "@/lib/procurement/supplier-offplatform"
import type { PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"

const item = (over: Partial<SupplierListItem> & { id: string; name: string }): SupplierListItem => ({
  city: "الرياض",
  specialties: ["steel"],
  onPlatform: true,
  verified: true,
  preferred: false,
  ours: false,
  deals: 0,
  onTimePercent: null,
  rating: null,
  since: "2024-01-01",
  hasProfile: false,
  hasWorks: false,
  hasCerts: false,
  ...over,
})

const F = (over: Partial<SupplierFilter> = {}): SupplierFilter => ({ ...EMPTY_SUPPLIER_FILTER, ...over })

const FIXTURE: SupplierListItem[] = [
  item({ id: "a", name: "مصنع الشرق للحديد", city: "الدمام", specialties: ["steel"], deals: 301, rating: 4.7, since: "2022-03-01", preferred: true, ours: true, hasProfile: true, hasWorks: true, hasCerts: true }),
  item({ id: "b", name: "مؤسسة البحر للتوريدات", city: "جدة", specialties: ["steel", "cement"], deals: 120, rating: 4.1, since: "2023-06-01", ours: true, hasProfile: true }),
  item({ id: "c", name: "عبدالله الرواني لمواد البناء", city: "الرياض", specialties: ["blocks"], deals: 10, rating: null, since: "2025-09-01", ours: true, verified: false }),
  item({ id: "d", name: "مورد خارج المنصة", city: "الرياض", specialties: ["cement"], onPlatform: false, verified: false, deals: null, rating: null, since: null, ours: true }),
  item({ id: "e", name: "شركة الوادي", city: "جدة", specialties: ["blocks"], deals: 55, rating: 3.9, since: "2025-01-01", hasCerts: true }),
]

describe("SUP-01: one filter method for both lists", () => {
  it("«ours» statuses are the prototype's: preferred · verified · unverified · off-platform", () => {
    expect(OURS_STATUSES).toEqual(["all", "pref", "ver", "unver", "off"])
    const ids = (status: SupplierFilter["status"]) => filterSuppliers(FIXTURE, F({ status }), "ours").map((s) => s.id)
    expect(ids("pref")).toEqual(["a"])
    expect(ids("ver")).toEqual(["a", "b", "e"])
    expect(ids("unver")).toEqual(["c"])
    expect(ids("off")).toEqual(["d"])
  })

  it("the directory's statuses: with a profile · previous work · certificates · not ours yet", () => {
    expect(DIR_STATUSES).toEqual(["all", "prof", "works", "certs", "notours"])
    const ids = (status: SupplierFilter["status"]) => filterSuppliers(FIXTURE, F({ status }), "dir").map((s) => s.id)
    expect(ids("prof")).toEqual(["a", "b"])
    expect(ids("works")).toEqual(["a"])
    expect(ids("certs")).toEqual(["a", "e"])
    expect(ids("notours")).toEqual(["e"])
  })

  it("a status of the other list means «all», so a stale choice never empties a list", () => {
    expect(statusOf("ours", "certs")).toBe("all")
    expect(statusOf("dir", "off")).toBe("all")
    expect(statusOf("dir", "works")).toBe("works")
    expect(filterSuppliers(FIXTURE, F({ status: "certs" }), "ours")).toHaveLength(FIXTURE.length)
  })

  it("specialty and city filter, and search works across the name, the city and the specialty's words", () => {
    expect(filterSuppliers(FIXTURE, F({ specialty: "cement" }), "ours").map((s) => s.id)).toEqual(["b", "d"])
    expect(filterSuppliers(FIXTURE, F({ city: "جدة" }), "ours").map((s) => s.id)).toEqual(["b", "e"])
    expect(filterSuppliers(FIXTURE, F({ q: "حديد" }), "ours", (k) => (k === "steel" ? "حديد التسليح" : k)).map((s) => s.id)).toEqual(["a", "b"])
    expect(filterSuppliers(FIXTURE, F({ q: "وادي", city: "جدة", specialty: "blocks" }), "dir").map((s) => s.id)).toEqual(["e"])
  })

  it("sorts: most supplied · top rated · newest · by name — a supplier with nothing to count goes last", () => {
    const order = (sort: SupplierFilter["sort"]) => sortSuppliers(FIXTURE, sort).map((s) => s.id)
    expect(order("deals")).toEqual(["a", "b", "e", "c", "d"])
    expect(order("rate")).toEqual(["a", "b", "e", "c", "d"])
    expect(order("new")).toEqual(["c", "e", "b", "a", "d"])
    expect(order("name")).toEqual([...FIXTURE].sort((a, b) => a.name.localeCompare(b.name, "ar")).map((s) => s.id))
  })

  it("facets count each option under every OTHER filter, never its own", () => {
    const all = supplierFacets(FIXTURE, F(), "ours")
    expect(all.specialties).toEqual(expect.arrayContaining([["steel", 2], ["cement", 2], ["blocks", 2]]))
    expect(all.cities).toEqual(expect.arrayContaining([["الرياض", 2], ["جدة", 2], ["الدمام", 1]]))
    const inJeddah = supplierFacets(FIXTURE, F({ city: "جدة" }), "ours")
    expect(inJeddah.specialties.find(([k]) => k === "steel")?.[1]).toBe(1)
    expect(inJeddah.cities.find(([c]) => c === "الدمام")?.[1]).toBe(1)
    expect(supplierFilterActive(F({ sort: "name" }))).toBe(false)
    expect(supplierFilterActive(F({ city: "جدة" }))).toBe(true)
  })
})

describe("NFR-03: a list built for hundreds, 24 at a time", () => {
  const BIG: SupplierListItem[] = Array.from({ length: 300 }, (_, i) =>
    item({ id: `s${i}`, name: `مورد ${String(i).padStart(3, "0")}`, city: i % 3 === 0 ? "الرياض" : i % 3 === 1 ? "جدة" : "الدمام", specialties: [`sub${i % 12}`], deals: i, rating: (i % 5) + 1, since: `20${20 + (i % 6)}-0${1 + (i % 9)}-01`, hasProfile: i % 2 === 0, ours: i % 10 === 0 })
  )

  it("shows 24 of 300, says «24 من 300», and offers the next 24", () => {
    const page = listSuppliers(BIG, F(), "dir")
    expect(page.rows).toHaveLength(SUPPLIER_PAGE_SIZE)
    expect(page.matched).toBe(300)
    expect(page.total).toBe(300)
    expect(page.remaining).toBe(276)
    expect(page.more).toBe(24)
    expect(page.rows[0].deals).toBe(299)
  })

  it("the last page offers only what is left; a filter says «N من M»", () => {
    const rest = listSuppliers(BIG, F(), "dir", { limit: 290 })
    expect(rest.more).toBe(10)
    const filtered = listSuppliers(BIG, F({ city: "جدة", status: "prof" }), "dir")
    expect(filtered.matched).toBe(BIG.filter((s) => s.city === "جدة" && s.hasProfile).length)
    expect(filtered.total).toBe(300)
  })

  it("filtering, sorting and counting 300 suppliers takes a few milliseconds, not a second", () => {
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) {
      listSuppliers(BIG, F({ q: "مورد 1", sort: "rate" }), "dir")
      supplierFacets(BIG, F({ status: "prof" }), "dir")
    }
    expect((performance.now() - t0) / 20).toBeLessThan(150)
  })
})

describe("SUP-02: what the platform knows of a supplier is computed from orders", () => {
  const line = (accepted: number, quantity = 10, rejected = 0) => ({ id: "l1", name: "حديد", unit: "طن", quantity, unitPrice: 100, accepted, rejected, held: 0, cancelled: 0 })
  const po = (id: string, over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
    ({
      id,
      organizationId: "buyer1",
      docNumber: `PO-2026/${id}`,
      status: "accepted",
      basis: "rfq",
      supplierOrgId: "sup1",
      supplierName: "مصنع",
      supplierAcceptedAt: "2026-09-01T08:00:00Z",
      promisedDate: "2026-09-10",
      lines: [line(10)],
      totalExVat: 1000,
      vatRate: 0.15,
      log: [],
      ...over,
    }) as unknown as PurchaseOrder
  const receipt = (poId: string, day: string): ReceiptFact => ({ id: `r-${poId}`, poId, status: "confirmed", confirmedAt: `${day}T08:00:00Z`, deliveryDate: day, lines: [] }) as unknown as ReceiptFact
  const NOW = new Date("2026-10-20T08:00:00Z")

  it("counts the orders that ended with goods received, whoever the buyer was", () => {
    const orders = [po("1", { organizationId: "buyerA" }), po("2", { organizationId: "buyerB" }), po("3", { lines: [line(0)] }), po("4", { status: "cancelled" }), po("5", { supplierAcceptedAt: null })]
    const stats = platformStats(orders, [receipt("1", "2026-09-09"), receipt("2", "2026-09-09")], NOW)
    expect(stats.completedOps).toBe(2)
    expect(stats.judgedOrders).toBe(3)
  })

  it("on-time is the share of judged orders that arrived by the promise", () => {
    const orders = [po("1"), po("2"), po("3"), po("4")]
    const stats = platformStats(orders, [receipt("1", "2026-09-09"), receipt("2", "2026-09-10"), receipt("3", "2026-09-20"), receipt("4", "2026-09-08")], NOW)
    expect(stats.onTimePercent).toBe(75)
  })

  it("a rating needs three judged orders — one delivery is not a reputation", () => {
    expect(RATING_MIN_ORDERS).toBe(3)
    expect(computedRating({ orders: 2, onTimePercent: 100, rejectPercent: 0 })).toBeNull()
    expect(computedRating({ orders: 5, onTimePercent: null, rejectPercent: 0 })).toBeNull()
    expect(computedRating({ orders: 5, onTimePercent: 100, rejectPercent: 0 })).toBe(5)
    expect(computedRating({ orders: 5, onTimePercent: 0, rejectPercent: 100 })).toBe(1)
    expect(computedRating({ orders: 5, onTimePercent: 90, rejectPercent: 5 })).toBe(4.7)
  })

  it("a supplier with no orders has no numbers rather than a flattering default", () => {
    const stats = platformStats([], [], NOW)
    expect(stats).toMatchObject({ completedOps: 0, onTimePercent: null, rating: null })
  })

  it("a card keeps public facts only, becomes a list row, and goes stale after a day", () => {
    const card = buildCard(
      { orgId: "sup1", name: "مصنع", city: "الدمام", coverageCities: [], specialties: ["steel"], since: "2024-01-01", verified: true, bio: "نبذة", worksCount: 0, certificatesCount: 2, hasProfileFile: false },
      { completedOps: 214, judgedOrders: 230, onTimePercent: 92, rejectPercent: 1, rating: 4.5 },
      { avg: 4.2, count: 3 },
      NOW
    )
    expect(Object.keys(card)).not.toEqual(expect.arrayContaining(["phone", "email", "taxNumber"]))
    expect(card.hasProfile).toBe(true)
    expect(card.hasWorks).toBe(false)
    expect(card.hasCerts).toBe(true)
    expect(cardToItem(card, { ours: true })).toMatchObject({ id: "sup1", deals: 214, onTimePercent: 92, rating: 4.5, ours: true, onPlatform: true, verified: true })
    expect(statsAreFresh(NOW.toISOString(), new Date(NOW.getTime() + 3_600_000))).toBe(true)
    expect(statsAreFresh(NOW.toISOString(), new Date(NOW.getTime() + 25 * 3_600_000))).toBe(false)
    expect(statsAreFresh(null, NOW)).toBe(false)
  })
})

describe("SUP-03: the off-platform supplier is keyed by his verified mobile and has no file of his own", () => {
  it("one man is one key whatever the spelling of his number; a number that is no mobile is no key", () => {
    expect(guestSupplierKey("0561112299")).toBe("guest_966561112299")
    expect(guestSupplierKey("+966 56 111 2299")).toBe("guest_966561112299")
    expect(guestSupplierKey("966561112299")).toBe("guest_966561112299")
    expect(guestSupplierKey("123")).toBeNull()
    expect(guestSupplierKey(null)).toBeNull()
    expect(isGuestSupplierKey("guest_966561112299")).toBe(true)
    expect(isGuestSupplierKey("sup1")).toBe(false)
  })

  it("a guest can be added only when his mobile was proved and he has no account", () => {
    const facts = { name: "أبو خالد", phone: "0561112299", phoneVerified: true }
    expect(addGuestRefusal(facts, false)).toBeNull()
    expect(addGuestRefusal({ ...facts, phoneVerified: false }, false)).toBe("phone_not_verified")
    expect(addGuestRefusal({ ...facts, phone: "12" }, false)).toBe("phone_not_verified")
    expect(addGuestRefusal(facts, true)).toBe("not_a_guest")
    expect(addGuestRefusal(null, false)).toBe("not_found")
  })

  it("our orders with him: the ones whose offer carries his mobile, else the ones that carry his name — never another guest's", () => {
    const o = (id: string, over: Partial<PurchaseOrder> = {}) => ({ id, supplierOrgId: "guest", isGuestSupplier: true, supplierName: "أبو خالد", offerId: null, createdAt: `2026-10-0${id}T00:00:00Z`, ...over }) as unknown as PurchaseOrder
    const orders = [o("1", { offerId: "of1" }), o("2", { offerId: "of2", supplierName: "اسم مختلف" }), o("3", { offerId: "of3" }), o("4", { offerId: null }), o("5", { supplierOrgId: "sup1", isGuestSupplier: false })]
    const offers = [
      { id: "of1", guestContact: { phone: "0561112299" } },
      { id: "of2", guestContact: { phone: "0561112299" } },
      { id: "of3", guestContact: { phone: "0509998877" } },
    ]
    expect(ordersOfGuest(orders, offers, "guest_966561112299", "أبو خالد").map((x) => x.id)).toEqual(["4", "2", "1"])
  })
})
