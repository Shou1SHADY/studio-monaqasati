import {
  BUILT_IN_ITEM_TYPES,
  DEFAULT_ITEM_TYPE,
  composeItemTypeOptions,
  isBuiltInItemType,
  itemTypeMessageKey,
  resolveItemTypeId,
} from "@/lib/inventory-types"

const t = (key: string) => `#${key}`

describe("itemTypeMessageKey", () => {
  it("builds the message key from the code", () => {
    expect(itemTypeMessageKey("materials")).toBe("inv_type_materials")
    expect(itemTypeMessageKey("equipment")).toBe("inv_type_equipment")
  })
})

describe("isBuiltInItemType", () => {
  it("accepts the built-in codes", () => {
    BUILT_IN_ITEM_TYPES.forEach((code) => expect(isBuiltInItemType(code)).toBe(true))
  })

  it("rejects custom doc ids, null and undefined", () => {
    expect(isBuiltInItemType("aBcD1234")).toBe(false)
    expect(isBuiltInItemType(null)).toBe(false)
    expect(isBuiltInItemType(undefined)).toBe(false)
  })
})

describe("composeItemTypeOptions", () => {
  it("puts built-ins first, localized via t", () => {
    const options = composeItemTypeOptions(t, [], "ar")
    expect(options.map((o) => o.id)).toEqual(["materials", "equipment"])
    expect(options[0].label).toBe("#inv_type_materials")
    expect(options.every((o) => o.builtIn)).toBe(true)
  })

  it("appends custom types sorted by name", () => {
    const options = composeItemTypeOptions(
      t,
      [
        { id: "b", organizationId: "org", name: "سقالات" },
        { id: "a", organizationId: "org", name: "حفارات" },
      ],
      "ar",
    )
    expect(options.map((o) => o.id)).toEqual(["materials", "equipment", "a", "b"])
    expect(options[2].builtIn).toBe(false)
  })
})

describe("resolveItemTypeId", () => {
  const options = composeItemTypeOptions(t, [{ id: "cst1", organizationId: "org", name: "حفارات" }], "ar")

  it("keeps a known built-in or custom id", () => {
    expect(resolveItemTypeId("equipment", options)).toBe("equipment")
    expect(resolveItemTypeId("cst1", options)).toBe("cst1")
  })

  it("falls back to the default section for legacy rows with no type", () => {
    expect(resolveItemTypeId(null, options)).toBe(DEFAULT_ITEM_TYPE)
    expect(resolveItemTypeId(undefined, options)).toBe(DEFAULT_ITEM_TYPE)
  })

  it("falls back for a type that was deleted, so its items never disappear", () => {
    expect(resolveItemTypeId("deleted-type-id", options)).toBe(DEFAULT_ITEM_TYPE)
  })
})
