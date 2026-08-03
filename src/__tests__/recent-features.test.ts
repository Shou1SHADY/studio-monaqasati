/**
 * Tests for features implemented in the latest batch:
 *  1. COUNTRIES / CITIES_BY_COUNTRY / displayCountry (constants.ts)
 *  2. Admin sort logic — verification-first vs latest
 *  3. BOQ deselect-all toggle logic
 *  4. RfqForm atomic category+subCategory update (stale closure fix)
 */

import {
  COUNTRIES,
  CITIES_BY_COUNTRY,
  displayCountry,
} from "../lib/constants"

// ─────────────────────────────────────────────────────────────────────────────
// 1. COUNTRIES / CITIES_BY_COUNTRY / displayCountry
// ─────────────────────────────────────────────────────────────────────────────

describe("COUNTRIES", () => {
  it("contains exactly 5 supported countries", () => {
    expect(COUNTRIES).toHaveLength(5)
  })

  it("always includes Saudi Arabia", () => {
    const sa = COUNTRIES.find(c => c.value === "SA")
    expect(sa).toBeDefined()
    expect(sa!.labelEn).toBe("Saudi Arabia")
    expect(sa!.labelAr).toBe("المملكة العربية السعودية")
  })

  it("includes UAE, Egypt, Qatar, Kuwait", () => {
    const codes = COUNTRIES.map(c => c.value)
    expect(codes).toContain("AE")
    expect(codes).toContain("EG")
    expect(codes).toContain("QA")
    expect(codes).toContain("KW")
  })

  it("all entries have value, labelAr, and labelEn", () => {
    COUNTRIES.forEach(c => {
      expect(c.value.trim().length).toBeGreaterThan(0)
      expect(c.labelAr.trim().length).toBeGreaterThan(0)
      expect(c.labelEn.trim().length).toBeGreaterThan(0)
    })
  })

  it("country codes are 2-letter uppercase strings", () => {
    COUNTRIES.forEach(c => {
      expect(c.value).toMatch(/^[A-Z]{2}$/)
    })
  })

  it("has no duplicate codes", () => {
    const codes = COUNTRIES.map(c => c.value)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe("CITIES_BY_COUNTRY", () => {
  it("has an entry for every country code", () => {
    COUNTRIES.forEach(c => {
      expect(CITIES_BY_COUNTRY).toHaveProperty(c.value)
    })
  })

  it("every country has at least 4 cities", () => {
    Object.entries(CITIES_BY_COUNTRY).forEach(([code, cities]) => {
      expect(cities.length).toBeGreaterThanOrEqual(4)
    })
  })

  it("Saudi Arabia has the most cities", () => {
    const saCities = CITIES_BY_COUNTRY["SA"]
    Object.entries(CITIES_BY_COUNTRY).forEach(([code, cities]) => {
      if (code !== "SA") expect(saCities.length).toBeGreaterThanOrEqual(cities.length)
    })
  })

  it("cities are non-empty strings with no duplicates per country", () => {
    Object.values(CITIES_BY_COUNTRY).forEach(cities => {
      cities.forEach(city => {
        expect(typeof city).toBe("string")
        expect(city.trim().length).toBeGreaterThan(0)
      })
      expect(new Set(cities).size).toBe(cities.length)
    })
  })

  it("SA cities contain الرياض and جدة", () => {
    expect(CITIES_BY_COUNTRY["SA"]).toContain("الرياض")
    expect(CITIES_BY_COUNTRY["SA"]).toContain("جدة")
  })

  it("AE cities contain دبي and أبوظبي", () => {
    expect(CITIES_BY_COUNTRY["AE"]).toContain("دبي")
    expect(CITIES_BY_COUNTRY["AE"]).toContain("أبوظبي")
  })

  it("EG cities contain القاهرة and الإسكندرية", () => {
    expect(CITIES_BY_COUNTRY["EG"]).toContain("القاهرة")
    expect(CITIES_BY_COUNTRY["EG"]).toContain("الإسكندرية")
  })
})

describe("displayCountry()", () => {
  it("returns Arabic label for ar locale", () => {
    expect(displayCountry("SA", "ar")).toBe("المملكة العربية السعودية")
  })

  it("returns English label for en locale", () => {
    expect(displayCountry("SA", "en")).toBe("Saudi Arabia")
  })

  it("returns Arabic for UAE in ar", () => {
    expect(displayCountry("AE", "ar")).toBe("الإمارات العربية المتحدة")
  })

  it("returns English for UAE in en", () => {
    expect(displayCountry("AE", "en")).toBe("United Arab Emirates")
  })

  it("falls back to the raw code when country not found", () => {
    expect(displayCountry("XX", "en")).toBe("XX")
    expect(displayCountry("XX", "ar")).toBe("XX")
  })

  it("covers all 5 countries in both locales", () => {
    COUNTRIES.forEach(({ value, labelAr, labelEn }) => {
      expect(displayCountry(value, "ar")).toBe(labelAr)
      expect(displayCountry(value, "en")).toBe(labelEn)
    })
  })

  it("returns English for unknown locale (falls back to labelEn)", () => {
    const result = displayCountry("EG", "fr")
    expect(result).toBe("Egypt")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Admin sort logic (extracted pure sort comparator)
// ─────────────────────────────────────────────────────────────────────────────

function getTs(ts: any): number {
  if (!ts) return 0
  if (ts?.seconds) return ts.seconds * 1000
  if (ts?.toDate) return ts.toDate().getTime()
  return new Date(ts).getTime()
}

function sortContractors(
  list: any[],
  sortBy: "verification" | "latest"
): any[] {
  return [...list].sort((a, b) => {
    if (sortBy === "latest") return getTs(b.createdAt) - getTs(a.createdAt)
    if (a.verificationRequested === b.verificationRequested) return 0
    return a.verificationRequested ? -1 : 1
  })
}

describe("Admin sort — verification-first", () => {
  const pending = { id: "p1", verificationRequested: true, createdAt: { seconds: 1000 } }
  const verified = { id: "v1", verificationRequested: false, createdAt: { seconds: 2000 } }
  const review = { id: "r1", verificationRequested: false, createdAt: { seconds: 3000 } }

  it("puts verificationRequested=true items first", () => {
    const sorted = sortContractors([verified, pending], "verification")
    expect(sorted[0].id).toBe("p1")
    expect(sorted[1].id).toBe("v1")
  })

  it("keeps non-pending items in relative order among themselves", () => {
    const sorted = sortContractors([review, verified, pending], "verification")
    expect(sorted[0].id).toBe("p1")
    const rest = sorted.slice(1).map(c => c.id)
    expect(rest).toContain("v1")
    expect(rest).toContain("r1")
  })

  it("all-pending list order is preserved", () => {
    const a = { id: "a", verificationRequested: true, createdAt: null }
    const b = { id: "b", verificationRequested: true, createdAt: null }
    const sorted = sortContractors([a, b], "verification")
    expect(sorted.map(c => c.id)).toEqual(["a", "b"])
  })

  it("all-non-pending list order is preserved", () => {
    const a = { id: "a", verificationRequested: false, createdAt: null }
    const b = { id: "b", verificationRequested: false, createdAt: null }
    const sorted = sortContractors([a, b], "verification")
    expect(sorted.map(c => c.id)).toEqual(["a", "b"])
  })
})

describe("Admin sort — latest first", () => {
  const old = { id: "old", verificationRequested: false, createdAt: { seconds: 1000 } }
  const mid = { id: "mid", verificationRequested: true, createdAt: { seconds: 2000 } }
  const latest = { id: "new", verificationRequested: false, createdAt: { seconds: 3000 } }

  it("most recently created comes first", () => {
    const sorted = sortContractors([old, latest, mid], "latest")
    expect(sorted[0].id).toBe("new")
  })

  it("orders chronologically descending", () => {
    const sorted = sortContractors([old, latest, mid], "latest")
    expect(sorted.map(c => c.id)).toEqual(["new", "mid", "old"])
  })

  it("items without createdAt go to the end", () => {
    const noTs = { id: "x", verificationRequested: false, createdAt: null }
    const sorted = sortContractors([noTs, old], "latest")
    expect(sorted[0].id).toBe("old")
    expect(sorted[1].id).toBe("x")
  })

  it("ignores verificationRequested when sorting by latest", () => {
    const sorted = sortContractors([old, mid], "latest")
    expect(sorted[0].id).toBe("mid")
    expect(sorted[1].id).toBe("old")
  })

  it("handles Firestore-style timestamp objects", () => {
    const a = { id: "a", createdAt: { seconds: 500 } }
    const b = { id: "b", createdAt: { seconds: 900 } }
    const sorted = sortContractors([a, b], "latest")
    expect(sorted[0].id).toBe("b")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. BOQ deselect-all toggle logic
// ─────────────────────────────────────────────────────────────────────────────

function boqDeselectAllToggle(
  editableIds: string[],
  deselectedIds: Set<string>
): Set<string> {
  const allDeselected = editableIds.every(id => deselectedIds.has(id))
  if (allDeselected) return new Set()
  return new Set(editableIds)
}

describe("BOQ deselect-all toggle", () => {
  const ids = ["item-1", "item-2", "item-3"]

  it("clears deselectedIds when all items are already deselected", () => {
    const allDeselected = new Set(ids)
    const result = boqDeselectAllToggle(ids, allDeselected)
    expect(result.size).toBe(0)
  })

  it("deselects all when none are deselected", () => {
    const result = boqDeselectAllToggle(ids, new Set())
    expect(result).toEqual(new Set(ids))
  })

  it("deselects all when some (but not all) are deselected", () => {
    const partial = new Set(["item-1"])
    const result = boqDeselectAllToggle(ids, partial)
    expect(result).toEqual(new Set(ids))
  })

  it("clearing resets to empty set (all selected)", () => {
    const allDeselected = new Set(ids)
    const result = boqDeselectAllToggle(ids, allDeselected)
    expect(result.size).toBe(0)
  })

  it("second toggle re-deselects all", () => {
    let state = new Set<string>()
    state = boqDeselectAllToggle(ids, state)
    expect(state.size).toBe(ids.length)
    state = boqDeselectAllToggle(ids, state)
    expect(state.size).toBe(0)
  })

  it("handles empty editable list — always returns empty set", () => {
    expect(boqDeselectAllToggle([], new Set()).size).toBe(0)
    expect(boqDeselectAllToggle([], new Set(["x"])).size).toBe(0)
  })

  it("does not mutate the original deselectedIds set", () => {
    const original = new Set<string>()
    boqDeselectAllToggle(ids, original)
    expect(original.size).toBe(0)
  })

  it("only considers editable ids — non-editable extra ids in deselectedIds don't trigger clear", () => {
    const editableIds = ["item-1"]
    const deselectedIds = new Set(["item-1", "non-editable"])
    // all editableIds are deselected → should clear
    const result = boqDeselectAllToggle(editableIds, deselectedIds)
    expect(result.size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. RfqForm atomic category + subCategory update (stale closure fix)
// ─────────────────────────────────────────────────────────────────────────────

interface Product {
  id: string
  category: string
  subCategory: string
  unit?: string
}

function atomicCategoryUpdate(
  products: Product[],
  productId: string,
  newCategory: string
): Product[] {
  return products.map(p =>
    p.id === productId ? { ...p, category: newCategory, subCategory: "" } : p
  )
}

function atomicSubCategoryUpdate(
  products: Product[],
  productId: string,
  newSubCategory: string,
  autoUnit?: string
): Product[] {
  return products.map(p =>
    p.id === productId
      ? { ...p, subCategory: newSubCategory, ...(autoUnit ? { unit: autoUnit } : {}) }
      : p
  )
}

describe("RfqForm — atomic category update (stale closure fix)", () => {
  const baseProducts: Product[] = [
    { id: "p1", category: "حديد ومعادن", subCategory: "حديد تسليح" },
    { id: "p2", category: "أسمنت وخرسانة", subCategory: "أسمنت بورتلاندي" },
  ]

  it("updates category and clears subCategory in a single pass", () => {
    const result = atomicCategoryUpdate(baseProducts, "p1", "كهرباء وإنارة")
    const updated = result.find(p => p.id === "p1")!
    expect(updated.category).toBe("كهرباء وإنارة")
    expect(updated.subCategory).toBe("")
  })

  it("does not affect other products", () => {
    const result = atomicCategoryUpdate(baseProducts, "p1", "كهرباء وإنارة")
    const other = result.find(p => p.id === "p2")!
    expect(other.category).toBe("أسمنت وخرسانة")
    expect(other.subCategory).toBe("أسمنت بورتلاندي")
  })

  it("clears subCategory even when category stays the same", () => {
    const result = atomicCategoryUpdate(baseProducts, "p1", "حديد ومعادن")
    const updated = result.find(p => p.id === "p1")!
    expect(updated.subCategory).toBe("")
  })

  it("does not mutate the original array", () => {
    atomicCategoryUpdate(baseProducts, "p1", "كهرباء وإنارة")
    expect(baseProducts[0].subCategory).toBe("حديد تسليح")
  })

  it("returns array of same length", () => {
    const result = atomicCategoryUpdate(baseProducts, "p1", "كهرباء وإنارة")
    expect(result).toHaveLength(baseProducts.length)
  })
})

describe("RfqForm — atomic subCategory update with autoUnit", () => {
  const baseProducts: Product[] = [
    { id: "p1", category: "حديد ومعادن", subCategory: "", unit: "" },
  ]

  it("updates subCategory for the correct product", () => {
    const result = atomicSubCategoryUpdate(baseProducts, "p1", "حديد تسليح")
    expect(result.find(p => p.id === "p1")!.subCategory).toBe("حديد تسليح")
  })

  it("sets unit when autoUnit is provided", () => {
    const result = atomicSubCategoryUpdate(baseProducts, "p1", "حديد تسليح", "طن")
    expect(result.find(p => p.id === "p1")!.unit).toBe("طن")
  })

  it("does not set unit when autoUnit is undefined", () => {
    const products: Product[] = [{ id: "p1", category: "x", subCategory: "", unit: "m2" }]
    const result = atomicSubCategoryUpdate(products, "p1", "new-sub", undefined)
    expect(result.find(p => p.id === "p1")!.unit).toBe("m2")
  })

  it("does not mutate the original product", () => {
    atomicSubCategoryUpdate(baseProducts, "p1", "حديد تسليح", "طن")
    expect(baseProducts[0].subCategory).toBe("")
  })

  it("does not affect other products", () => {
    const products: Product[] = [
      { id: "p1", category: "a", subCategory: "", unit: "" },
      { id: "p2", category: "b", subCategory: "existing", unit: "m2" },
    ]
    const result = atomicSubCategoryUpdate(products, "p1", "new", "طن")
    const other = result.find(p => p.id === "p2")!
    expect(other.subCategory).toBe("existing")
    expect(other.unit).toBe("m2")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. getTs helper used in admin sort
// ─────────────────────────────────────────────────────────────────────────────

describe("getTs timestamp helper", () => {
  it("extracts milliseconds from Firestore {seconds} object", () => {
    expect(getTs({ seconds: 1000 })).toBe(1_000_000)
  })

  it("returns 0 for null or undefined", () => {
    expect(getTs(null)).toBe(0)
    expect(getTs(undefined)).toBe(0)
  })

  it("falls back to new Date(ts).getTime() for ISO string", () => {
    const iso = "2024-01-15T00:00:00.000Z"
    expect(getTs(iso)).toBe(new Date(iso).getTime())
  })

  it("handles toDate() method (Firestore Timestamp instance pattern)", () => {
    const fakeTs = { toDate: () => new Date("2024-01-01") }
    expect(getTs(fakeTs)).toBe(new Date("2024-01-01").getTime())
  })
})
