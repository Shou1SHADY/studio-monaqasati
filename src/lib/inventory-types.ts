/**
 * Item-type vocabulary for warehouse inventory — the sections a warehouse's
 * stock is grouped into (materials, equipment such as excavators, …).
 *
 * Two built-in types ship with every org and are localized via message keys,
 * exactly like the unit vocabulary in `inventory-units.ts`. Beyond those, an
 * org defines its own types in the top-level `inventoryItemTypes` collection
 * (org-scoped so the same sections appear in every warehouse); an item stores
 * a `typeId` that is either a built-in code or a custom type's doc id.
 *
 * `typeId` is optional on items — rows created before types existed (and rows
 * created by flows that don't ask, e.g. goods receipt) resolve to the default
 * "materials" section rather than needing a data migration.
 */
export const BUILT_IN_ITEM_TYPES = ["materials", "equipment"] as const

export type BuiltInItemType = (typeof BUILT_IN_ITEM_TYPES)[number]

export const DEFAULT_ITEM_TYPE: BuiltInItemType = "materials"

/** Message key for a built-in type, e.g. "materials" -> "inv_type_materials". */
export function itemTypeMessageKey(code: string): `inv_type_${string}` {
  return `inv_type_${code}`
}

export function isBuiltInItemType(code: string | null | undefined): code is BuiltInItemType {
  return !!code && (BUILT_IN_ITEM_TYPES as readonly string[]).includes(code)
}

/** An org-defined type document in `inventoryItemTypes`. */
export type CustomItemType = {
  id: string
  organizationId: string
  name: string
}

/** A resolved section the UI can render: built-ins carry a localized label, customs their stored name. */
export type ItemTypeOption = {
  id: string
  label: string
  builtIn: boolean
}

/**
 * Full ordered section list: built-ins first (materials, then equipment), then
 * the org's custom types sorted by name with a locale-aware collator.
 */
export function composeItemTypeOptions(
  t: (key: string) => string,
  customTypes: CustomItemType[],
  locale: string,
): ItemTypeOption[] {
  const builtIns: ItemTypeOption[] = BUILT_IN_ITEM_TYPES.map((code) => ({
    id: code,
    label: t(itemTypeMessageKey(code)),
    builtIn: true,
  }))
  const customs: ItemTypeOption[] = customTypes
    .map((c) => ({ id: c.id, label: c.name, builtIn: false }))
    .sort((a, b) => a.label.localeCompare(b.label, locale === "ar" ? "ar" : "en"))
  return [...builtIns, ...customs]
}

/**
 * Which section an item belongs to. An unknown `typeId` (missing, or pointing
 * at a since-deleted custom type) falls back to the default section instead of
 * making the item invisible.
 */
export function resolveItemTypeId(
  typeId: string | null | undefined,
  options: ItemTypeOption[],
): string {
  if (typeId && options.some((o) => o.id === typeId)) return typeId
  return DEFAULT_ITEM_TYPE
}
