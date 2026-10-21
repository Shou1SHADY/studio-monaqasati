// «دليل موردي المنصة» (PUR-04/05): who is listed and by what. A supplier invited by a buyer is his
// buyer's «مورّدونا» from the day he joins, but stays out of the platform directory until the
// platform verifies him; and the directory is filtered by the material tree's sub-categories
// (an older category name stays a filter of its own).

import { specialtyKeys } from "@/lib/materials/subs"
import type { MaterialIndex } from "@/lib/materials/tree"

export const listedInDirectory = <T extends { platformVerified: boolean }>(suppliers: T[]): T[] => suppliers.filter((s) => s.platformVerified)

/** The suppliers with their `categories` replaced by the keys the directory filters and counts by. */
export function directoryEntries<T extends { subIds: string[]; categories: string[] }>(index: MaterialIndex | null, suppliers: T[]): T[] {
  return suppliers.map((s) => ({ ...s, categories: specialtyKeys(index, s.subIds, s.categories) }))
}
