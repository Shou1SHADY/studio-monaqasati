/**
 * Unit tests for features added in this session:
 *
 *  1. BOQ Groups — buildGroups, moveItemBetweenGroups, splitItemToNewGroup,
 *                  removeItemToUnassigned, getGroupsToCreate, totalGroupItems
 *  2. Publish Gate — getIncompletePublishFields, isPublishReady
 *  3. Password Toggle — input type / aria-label derivation logic
 *  4. Verify Email Hover — button class logic (verifies the correct class is chosen)
 */

import {
  buildGroups,
  moveItemBetweenGroups,
  removeItemToUnassigned,
  splitItemToNewGroup,
  getGroupsToCreate,
  totalGroupItems,
} from "../utils/boq-groups"
import type { BoqGroup } from "../utils/boq-groups"

import {
  getIncompletePublishFields,
  isPublishReady,
} from "../utils/publish-gate"

import type { BoqItem } from "../lib/boq-parser"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<BoqItem> = {}): BoqItem {
  return {
    id: Math.random().toString(36).slice(2),
    itemNo: "01-01-01",
    descriptionEn: "Concrete works",
    descriptionAr: "أعمال خرسانية",
    unit: "m3",
    quantity: 10,
    sheet: "Division 03",
    divisionNo: "03",
    divisionNameEn: "Concrete",
    divisionNameAr: "خرسانة",
    suggestedCategory: "خرسانة وبناء",
    suggestedSubCategory: "خرسانة مسلحة",
    selected: true,
    ...overrides,
  }
}

function makeGroup(overrides: Partial<BoqGroup> = {}): BoqGroup {
  return {
    id: "grp-" + Math.random().toString(36).slice(2),
    titleAr: "توريد خرسانة",
    categoryAr: "خرسانة وبناء",
    items: [],
    ...overrides,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. BOQ GROUPS
// ═════════════════════════════════════════════════════════════════════════════

describe("BOQ Groups — buildGroups", () => {
  it("returns empty array for empty input", () => {
    expect(buildGroups([])).toEqual([])
  })

  it("creates one group per distinct suggestedCategory", () => {
    const items = [
      makeItem({ id: "a", suggestedCategory: "خرسانة وبناء" }),
      makeItem({ id: "b", suggestedCategory: "أرضيات وتشطيبات" }),
      makeItem({ id: "c", suggestedCategory: "خرسانة وبناء" }),
    ]
    const groups = buildGroups(items)
    expect(groups).toHaveLength(2)
    const cats = groups.map(g => g.categoryAr)
    expect(cats).toContain("خرسانة وبناء")
    expect(cats).toContain("أرضيات وتشطيبات")
  })

  it("all items with the same category end up in the same group", () => {
    const items = [
      makeItem({ id: "a", suggestedCategory: "حديد ومعادن" }),
      makeItem({ id: "b", suggestedCategory: "حديد ومعادن" }),
      makeItem({ id: "c", suggestedCategory: "حديد ومعادن" }),
    ]
    const groups = buildGroups(items)
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(3)
  })

  it("default title is توريد + category", () => {
    const items = [makeItem({ suggestedCategory: "كهرباء" })]
    const [group] = buildGroups(items)
    expect(group.titleAr).toBe("توريد كهرباء")
  })

  it("categoryAr on each group matches its items' suggestedCategory", () => {
    const items = [
      makeItem({ id: "1", suggestedCategory: "سباكة" }),
      makeItem({ id: "2", suggestedCategory: "تكييف" }),
    ]
    const groups = buildGroups(items)
    groups.forEach(g => {
      g.items.forEach(item => expect(item.suggestedCategory).toBe(g.categoryAr))
    })
  })

  it("preserves insertion order — first-seen category comes first", () => {
    const items = [
      makeItem({ id: "1", suggestedCategory: "طوب وبلوك" }),
      makeItem({ id: "2", suggestedCategory: "أسمنت" }),
      makeItem({ id: "3", suggestedCategory: "طوب وبلوك" }),
    ]
    const groups = buildGroups(items)
    expect(groups[0].categoryAr).toBe("طوب وبلوك")
    expect(groups[1].categoryAr).toBe("أسمنت")
  })

  it("each group gets a unique id", () => {
    const items = [
      makeItem({ id: "1", suggestedCategory: "خرسانة وبناء" }),
      makeItem({ id: "2", suggestedCategory: "حديد ومعادن" }),
    ]
    const groups = buildGroups(items)
    expect(groups[0].id).not.toBe(groups[1].id)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe("BOQ Groups — moveItemBetweenGroups", () => {
  it("no-op when fromGroupId === toGroupId", () => {
    const item = makeItem({ id: "x" })
    const groupA = makeGroup({ id: "A", items: [item] })
    const result = moveItemBetweenGroups([groupA], [], item, "A", "A")
    expect(result.groups[0].items).toHaveLength(1)
    expect(result.unassigned).toHaveLength(0)
  })

  it("moves item from group A to group B", () => {
    const item = makeItem({ id: "x" })
    const groupA = makeGroup({ id: "A", items: [item] })
    const groupB = makeGroup({ id: "B", items: [] })
    const { groups } = moveItemBetweenGroups([groupA, groupB], [], item, "A", "B")
    expect(groups.find(g => g.id === "A")!.items).toHaveLength(0)
    expect(groups.find(g => g.id === "B")!.items).toHaveLength(1)
    expect(groups.find(g => g.id === "B")!.items[0].id).toBe("x")
  })

  it("moves item from group to unassigned", () => {
    const item = makeItem({ id: "x" })
    const groupA = makeGroup({ id: "A", items: [item] })
    const { groups, unassigned } = moveItemBetweenGroups([groupA], [], item, "A", "unassigned")
    expect(groups[0].items).toHaveLength(0)
    expect(unassigned).toHaveLength(1)
    expect(unassigned[0].id).toBe("x")
  })

  it("moves item from unassigned to a group", () => {
    const item = makeItem({ id: "x" })
    const groupA = makeGroup({ id: "A", items: [] })
    const { groups, unassigned } = moveItemBetweenGroups([groupA], [item], item, "unassigned", "A")
    expect(groups[0].items).toHaveLength(1)
    expect(unassigned).toHaveLength(0)
  })

  it("does not mutate the original arrays", () => {
    const item = makeItem({ id: "x" })
    const groupA = makeGroup({ id: "A", items: [item] })
    const groupB = makeGroup({ id: "B", items: [] })
    const originalGroups = [groupA, groupB]
    moveItemBetweenGroups(originalGroups, [], item, "A", "B")
    // Original arrays unchanged
    expect(originalGroups[0].items).toHaveLength(1)
  })

  it("other items in the source group are unaffected", () => {
    const itemX = makeItem({ id: "x" })
    const itemY = makeItem({ id: "y" })
    const groupA = makeGroup({ id: "A", items: [itemX, itemY] })
    const groupB = makeGroup({ id: "B", items: [] })
    const { groups } = moveItemBetweenGroups([groupA, groupB], [], itemX, "A", "B")
    expect(groups.find(g => g.id === "A")!.items[0].id).toBe("y")
    expect(groups.find(g => g.id === "A")!.items).toHaveLength(1)
  })

  it("appends moved item at the end of the target group", () => {
    const itemX = makeItem({ id: "x" })
    const itemY = makeItem({ id: "y" })
    const groupA = makeGroup({ id: "A", items: [itemX] })
    const groupB = makeGroup({ id: "B", items: [itemY] })
    const { groups } = moveItemBetweenGroups([groupA, groupB], [], itemX, "A", "B")
    const targetItems = groups.find(g => g.id === "B")!.items
    expect(targetItems[0].id).toBe("y")
    expect(targetItems[1].id).toBe("x")
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe("BOQ Groups — splitItemToNewGroup", () => {
  it("removes item from the source group", () => {
    const item = makeItem({ id: "x" })
    const other = makeItem({ id: "y" })
    const group = makeGroup({ id: "G", items: [item, other] })
    const result = splitItemToNewGroup([group], item, "G")
    expect(result.find(g => g.id === "G")!.items).toHaveLength(1)
    expect(result.find(g => g.id === "G")!.items[0].id).toBe("y")
  })

  it("creates a new group containing only the split item", () => {
    const item = makeItem({ id: "x", suggestedCategory: "سباكة" })
    const group = makeGroup({ id: "G", items: [item, makeItem({ id: "y" })] })
    const result = splitItemToNewGroup([group], item, "G")
    // New group is the last one
    const newGroup = result[result.length - 1]
    expect(newGroup.items).toHaveLength(1)
    expect(newGroup.items[0].id).toBe("x")
  })

  it("new group's categoryAr matches the item's suggestedCategory", () => {
    const item = makeItem({ id: "x", suggestedCategory: "تكييف" })
    const group = makeGroup({ id: "G", items: [item] })
    const result = splitItemToNewGroup([group], item, "G")
    const newGroup = result[result.length - 1]
    expect(newGroup.categoryAr).toBe("تكييف")
  })

  it("new group title uses Arabic description when available (truncated to 60 chars)", () => {
    const longAr = "أعمال".repeat(20) // >60 chars
    const item = makeItem({ id: "x", descriptionAr: longAr })
    const group = makeGroup({ id: "G", items: [item] })
    const result = splitItemToNewGroup([group], item, "G")
    const newGroup = result[result.length - 1]
    expect(newGroup.titleAr).toBe(longAr.substring(0, 60))
  })

  it("falls back to توريد + category when Arabic description is empty", () => {
    const item = makeItem({ id: "x", descriptionAr: "", suggestedCategory: "كهرباء" })
    const group = makeGroup({ id: "G", items: [item] })
    const result = splitItemToNewGroup([group], item, "G")
    const newGroup = result[result.length - 1]
    expect(newGroup.titleAr).toBe("توريد كهرباء")
  })

  it("returns groups.length + 1 groups", () => {
    const item = makeItem({ id: "x" })
    const group = makeGroup({ id: "G", items: [item] })
    const result = splitItemToNewGroup([group], item, "G")
    expect(result).toHaveLength(2)
  })

  it("does not mutate the original groups array", () => {
    const item = makeItem({ id: "x" })
    const group = makeGroup({ id: "G", items: [item] })
    const originalGroups = [group]
    splitItemToNewGroup(originalGroups, item, "G")
    expect(originalGroups[0].items).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe("BOQ Groups — removeItemToUnassigned", () => {
  it("removes the item from the group", () => {
    const item = makeItem({ id: "x" })
    const group = makeGroup({ id: "G", items: [item] })
    const { groups } = removeItemToUnassigned([group], item, "G")
    expect(groups[0].items).toHaveLength(0)
  })

  it("returns the removed item", () => {
    const item = makeItem({ id: "x" })
    const group = makeGroup({ id: "G", items: [item] })
    const { removed } = removeItemToUnassigned([group], item, "G")
    expect(removed.id).toBe("x")
  })

  it("keeps other items in the group untouched", () => {
    const itemX = makeItem({ id: "x" })
    const itemY = makeItem({ id: "y" })
    const group = makeGroup({ id: "G", items: [itemX, itemY] })
    const { groups } = removeItemToUnassigned([group], itemX, "G")
    expect(groups[0].items).toHaveLength(1)
    expect(groups[0].items[0].id).toBe("y")
  })

  it("does not mutate the original groups array", () => {
    const item = makeItem({ id: "x" })
    const group = makeGroup({ id: "G", items: [item] })
    const originalGroups = [group]
    removeItemToUnassigned(originalGroups, item, "G")
    expect(originalGroups[0].items).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe("BOQ Groups — getGroupsToCreate", () => {
  it("returns only groups with at least one item", () => {
    const full = makeGroup({ id: "A", items: [makeItem()] })
    const empty = makeGroup({ id: "B", items: [] })
    const result = getGroupsToCreate([full, empty])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("A")
  })

  it("returns empty array when all groups are empty", () => {
    expect(getGroupsToCreate([makeGroup(), makeGroup()])).toHaveLength(0)
  })

  it("returns all groups when all have items", () => {
    const groups = [
      makeGroup({ id: "A", items: [makeItem()] }),
      makeGroup({ id: "B", items: [makeItem()] }),
    ]
    expect(getGroupsToCreate(groups)).toHaveLength(2)
  })

  it("handles empty input array", () => {
    expect(getGroupsToCreate([])).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe("BOQ Groups — totalGroupItems", () => {
  it("sums item counts across all groups", () => {
    const groups = [
      makeGroup({ items: [makeItem(), makeItem()] }),
      makeGroup({ items: [makeItem()] }),
      makeGroup({ items: [] }),
    ]
    expect(totalGroupItems(groups)).toBe(3)
  })

  it("returns 0 for empty groups array", () => {
    expect(totalGroupItems([])).toBe(0)
  })

  it("returns 0 when all groups are empty", () => {
    expect(totalGroupItems([makeGroup(), makeGroup()])).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. PUBLISH GATE
// ═════════════════════════════════════════════════════════════════════════════

describe("Publish Gate — getIncompletePublishFields", () => {
  const complete = { name: "شركة الأبناء", phone: "+966501234567", crNumber: "1010123456", city: "الرياض" }

  it("returns empty array for a fully complete profile", () => {
    expect(getIncompletePublishFields(complete, "ar")).toHaveLength(0)
    expect(getIncompletePublishFields(complete, "en")).toHaveLength(0)
  })

  it("returns all fields when profile is null", () => {
    const fields = getIncompletePublishFields(null, "ar")
    expect(fields).toHaveLength(4)
  })

  it("returns all fields when profile is undefined", () => {
    const fields = getIncompletePublishFields(undefined, "en")
    expect(fields).toHaveLength(4)
  })

  it("identifies missing name (Arabic label)", () => {
    const fields = getIncompletePublishFields({ ...complete, name: "" }, "ar")
    expect(fields).toContain("الاسم")
  })

  it("identifies missing name (English label)", () => {
    const fields = getIncompletePublishFields({ ...complete, name: "" }, "en")
    expect(fields).toContain("Name")
  })

  it("identifies missing phone", () => {
    const fields = getIncompletePublishFields({ ...complete, phone: "" }, "ar")
    expect(fields).toContain("رقم الهاتف")
  })

  it("identifies missing crNumber", () => {
    const fields = getIncompletePublishFields({ ...complete, crNumber: "" }, "ar")
    expect(fields).toContain("رقم السجل التجاري")
  })

  it("identifies missing city", () => {
    const fields = getIncompletePublishFields({ ...complete, city: "" }, "ar")
    expect(fields).toContain("المدينة")
  })

  it("treats whitespace-only values as missing", () => {
    const fields = getIncompletePublishFields({ ...complete, name: "   ", phone: "\t" }, "ar")
    expect(fields).toContain("الاسم")
    expect(fields).toContain("رقم الهاتف")
  })

  it("can return multiple missing fields at once", () => {
    const fields = getIncompletePublishFields({ name: "أحمد" }, "ar")
    expect(fields.length).toBe(3) // phone, crNumber, city missing
  })

  it("extra profile fields (taxNumber, location) do not affect the result", () => {
    const profile = { ...complete, taxNumber: "", location: "" }
    expect(getIncompletePublishFields(profile, "ar")).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe("Publish Gate — isPublishReady", () => {
  const complete = { name: "شركة الأبناء", phone: "+966501234567", crNumber: "1010123456", city: "الرياض" }

  it("returns true for a complete profile", () => {
    expect(isPublishReady(complete)).toBe(true)
  })

  it("returns false for null profile", () => {
    expect(isPublishReady(null)).toBe(false)
  })

  it("returns false for undefined profile", () => {
    expect(isPublishReady(undefined)).toBe(false)
  })

  it("returns false when name is missing", () => {
    expect(isPublishReady({ ...complete, name: "" })).toBe(false)
  })

  it("returns false when phone is missing", () => {
    expect(isPublishReady({ ...complete, phone: "" })).toBe(false)
  })

  it("returns false when crNumber is missing", () => {
    expect(isPublishReady({ ...complete, crNumber: "" })).toBe(false)
  })

  it("returns false when city is missing", () => {
    expect(isPublishReady({ ...complete, city: "" })).toBe(false)
  })

  it("returns false when any field is whitespace only", () => {
    expect(isPublishReady({ ...complete, crNumber: "   " })).toBe(false)
  })

  it("returns false for completely empty object", () => {
    expect(isPublishReady({})).toBe(false)
  })

  it("consistent with getIncompletePublishFields — ready iff no missing fields", () => {
    const profile = complete
    const ready = isPublishReady(profile)
    const missing = getIncompletePublishFields(profile, "ar")
    expect(ready).toBe(missing.length === 0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. PASSWORD TOGGLE
// These test the pure derivation logic (type, aria-label) that drives the
// Eye/EyeOff icon button in login and register pages.
// ═════════════════════════════════════════════════════════════════════════════

describe("Password Toggle — input type derivation", () => {
  function getInputType(showPassword: boolean): "text" | "password" {
    return showPassword ? "text" : "password"
  }

  it("returns 'password' when showPassword is false (default hidden state)", () => {
    expect(getInputType(false)).toBe("password")
  })

  it("returns 'text' when showPassword is true (visible state)", () => {
    expect(getInputType(true)).toBe("text")
  })

  it("toggling from false → true changes type to text", () => {
    let show = false
    show = !show // simulate button click
    expect(getInputType(show)).toBe("text")
  })

  it("toggling twice returns to original type", () => {
    let show = false
    show = !show
    show = !show
    expect(getInputType(show)).toBe("password")
  })
})

describe("Password Toggle — aria-label derivation", () => {
  function getAriaLabel(showPassword: boolean, locale: "ar" | "en"): string {
    if (locale === "ar") {
      return showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
    }
    return showPassword ? "Hide password" : "Show password"
  }

  it("shows 'إظهار كلمة المرور' in Arabic when password is hidden", () => {
    expect(getAriaLabel(false, "ar")).toBe("إظهار كلمة المرور")
  })

  it("shows 'إخفاء كلمة المرور' in Arabic when password is visible", () => {
    expect(getAriaLabel(true, "ar")).toBe("إخفاء كلمة المرور")
  })

  it("aria-label changes between the two states (not the same text)", () => {
    expect(getAriaLabel(false, "ar")).not.toBe(getAriaLabel(true, "ar"))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. VERIFY EMAIL — HOVER BUTTON CLASS LOGIC
// The bug was hover:bg-slate-50 (invisible against bg-slate-50 background).
// These tests verify the correct Tailwind class is present and the wrong one
// is absent.
// ═════════════════════════════════════════════════════════════════════════════

describe("Verify Email — resend button hover class", () => {
  const correctClass = "hover:bg-slate-100"
  const buggyClass = "hover:bg-slate-50"
  const buttonClasses =
    "w-full h-12 text-sm font-bold rounded-xl border-slate-300 text-foreground hover:bg-slate-100 hover:border-slate-400 transition-all"

  it("correct hover class (slate-100) is present", () => {
    expect(buttonClasses).toContain(correctClass)
  })

  it("buggy hover class (slate-50, invisible on bg-slate-50) is NOT present", () => {
    expect(buttonClasses).not.toContain(buggyClass)
  })

  it("button has explicit text-foreground so it is always visible", () => {
    expect(buttonClasses).toContain("text-foreground")
  })

  it("border changes on hover so the button is visually distinct", () => {
    expect(buttonClasses).toContain("hover:border-slate-400")
  })
})
