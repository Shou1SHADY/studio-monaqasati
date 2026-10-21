// «الأكثر طلباً» (CAT-03): six materials one tap away under the row's search box. Each is defined by its
// path in the tree and the spec values it presets — never by an id — and resolved on the live tree, so a
// renamed or re-ordered tree keeps the chips right, and a chip whose material the platform team hid or
// removed simply does not appear.

import { foldSearchText } from "@/lib/search-text"
import { pathOf, specsOf, type MaterialHit, type MaterialIndex } from "./tree"

interface PopularDef {
  /** `Portal.Materials.popular_<key>` is the chip's words. */
  key: string
  /** The material's path, root first, in the tree's Arabic words. */
  path: string[]
  /** Spec name → option, in the tree's Arabic words. */
  specs: Record<string, string>
}

export const POPULAR: readonly PopularDef[] = [
  { key: "rebar16", path: ["الحديد", "حديد التسليح", "اسياخ حديد التسليح"], specs: { المقاس: "16 مم", الدرجة: "G60" } },
  { key: "rebar12", path: ["الحديد", "حديد التسليح", "اسياخ حديد التسليح"], specs: { المقاس: "12 مم", الدرجة: "G60" } },
  { key: "opc", path: ["الاسمنت والمواد اللاصقة", "الاسمنت العادي"], specs: { الوزن: "50 كجم" } },
  { key: "block20", path: ["بلك ومنتجات اسمنتية", "البلك الاسمنتي"], specs: { النوع: "بلوك اسمنتي مفرغ", القياس: "20×20×40 سم" } },
  { key: "c30", path: ["الخرسانة الجاهزة", "خرسانة جاهزة للإنشاءات"], specs: { القوة: "C30" } },
  { key: "plasterSand", path: ["الردم", "الرمل", "رمل لياسة"], specs: {} },
]

export interface PopularChip {
  key: string
  /** Shaped as a search hit, so a chip is added exactly as a result is. */
  hit: MaterialHit
}

const fold = (s: string) => foldSearchText(s)

export function popularChips(index: MaterialIndex | null): PopularChip[] {
  if (!index) return []
  const out: PopularChip[] = []
  for (const def of POPULAR) {
    const wanted = def.path.map(fold)
    const node = index.materials.find((m) => {
      const path = pathOf(index, m.id)
      return path.length === wanted.length && path.every((p, i) => fold(p.ar) === wanted[i])
    })
    if (!node) continue
    const specs = specsOf(index, node.id)
    const preset: MaterialHit["preset"] = []
    for (const [name, value] of Object.entries(def.specs)) {
      const spec = specs.find((s) => fold(s.ar) === fold(name))
      const option = spec?.options.find((o) => fold(o.ar) === fold(value))
      if (spec && option) preset.push({ spec, value: option })
    }
    out.push({ key: def.key, hit: { node, path: pathOf(index, node.id), preset, score: 0 } })
  }
  return out
}
