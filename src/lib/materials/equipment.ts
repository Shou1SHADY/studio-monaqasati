// Heavy-equipment rental is not a material (PUR-04): with Project Management it goes to the equipment
// desk there; without it, it is written as it is under «المعدات › معدات أخرى». Pure.

import { foldSearchText } from "@/lib/search-text"
import type { MaterialIndex } from "./tree"
import type { MaterialNode } from "./types"

const RENTAL = ["ايجار", "تاجير", "استئجار", "اجار", "rent", "rental", "hire"]
const HEAVY = [
  "حفار",
  "حفارة",
  "رافعة",
  "كرين",
  "ونش",
  "لودر",
  "بلدوزر",
  "جريدر",
  "مدحلة",
  "بوبكات",
  "باكهو",
  "شيول",
  "قلاب",
  "سطحة",
  "رافعة شوكية",
  "مضخة خرسانة",
  "معدات ثقيلة",
  "excavator",
  "crane",
  "loader",
  "bulldozer",
  "grader",
  "roller",
  "backhoe",
  "forklift",
  "dump truck",
  "heavy equipment",
]

const has = (text: string, words: string[]) =>
  words.some((w) => {
    const f = foldSearchText(w)
    return /^[a-z ]+$/.test(f) ? new RegExp(`\\b${f}\\b`).test(text) : text.includes(f)
  })

export function isHeavyEquipmentRental(text: string): boolean {
  const t = foldSearchText(text)
  return Boolean(t) && has(t, RENTAL) && has(t, HEAVY)
}

/** «المعدات › معدات أخرى» — the sub-category a rental typed as it is falls under. */
export function otherEquipmentSub(index: MaterialIndex | null): MaterialNode | null {
  if (!index) return null
  const root = index.roots.find((r) => foldSearchText(r.ar) === foldSearchText("المعدات"))
  return root?.children.find((c) => !c.hidden && foldSearchText(c.ar) === foldSearchText("معدات أخرى")) ?? null
}
