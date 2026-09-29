// Whether a BOQ item's materials come with its subcontract (prototype openItem
// `q.sub`: «يورّدها مقاول الباطن ضمن نطاقه — لا تُطلب ولا تُحسب علينا»). We keep
// no per-material "supplied by" flag: the item is in a registered subcontract's
// scope and no material of ours is rated on it in the project store — what we
// issue to a subcontractor stays ours and is rated like any other. Pure.

import type { PmSubcontract } from "./subcontract"

export function suppliedBySubcontractor(itemId: string, contracts: ReadonlyArray<Pick<PmSubcontract, "lines">>, ourMaterials: number): boolean {
  return ourMaterials === 0 && contracts.some((c) => c.lines.some((l) => l.itemId === itemId && l.qty > 0))
}
