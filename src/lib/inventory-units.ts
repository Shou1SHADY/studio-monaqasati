/**
 * Canonical unit-of-measure vocabulary for warehouse inventory.
 *
 * Units used to be a free-text field, which is how a single warehouse ended up
 * holding both «قطعة» and "meter". New items pick a `unitCode` from this list and
 * the localized label is resolved at render time, so the same physical unit reads
 * correctly in both locales instead of being frozen as whatever the creator typed.
 *
 * `unit` (the raw display string) is still written alongside `unitCode` — legacy
 * rows have only `unit`, and BOQ lines and waste records snapshot the label at the
 * time of the transaction, so historical documents keep reading the way they did.
 */
export const INVENTORY_UNIT_CODES = [
  "pcs", "m", "m2", "m3", "kg", "ton", "lt",
  "bag", "roll", "box", "bundle", "sheet", "drum", "set",
] as const

export type InventoryUnitCode = (typeof INVENTORY_UNIT_CODES)[number]

/** Message key for a unit code, e.g. "pcs" -> "inv_unit_pcs". */
export function unitMessageKey(code: string): `inv_unit_${string}` {
  return `inv_unit_${code}`
}

export function isKnownUnitCode(code: string | null | undefined): code is InventoryUnitCode {
  return !!code && (INVENTORY_UNIT_CODES as readonly string[]).includes(code)
}

/**
 * Localized label for an item's unit: the translated canonical label when the item
 * carries a known `unitCode`, otherwise the raw free-text `unit` it was created with.
 */
export function formatUnit(
  t: (key: string) => string,
  item: { unit?: string | null; unitCode?: string | null },
): string {
  if (isKnownUnitCode(item.unitCode)) return t(unitMessageKey(item.unitCode))
  return item.unit || ""
}
