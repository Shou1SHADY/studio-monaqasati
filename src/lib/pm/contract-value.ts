// PM 1.0 — the contract value in force (PRD §8, INV-01): Σ(quantity × rate) of
// the PRICED items + Σ approved variations; a project with no priced BOQ yet
// carries its handover value. An unpriced item adds nothing (CON-02), and
// pricing it later adds it (CON-03). It is what the retention cap, the advance
// and an addendum's cap check are measured against (RET-01, INV-04, AMD-09):
// the handover's figure alone ignored every approved variation — and was zero
// on a project created without a value, so nothing was ever retained on it.

import { collection, getDocs, type Firestore } from "firebase/firestore"
import { approvedValue, PM_VARIATIONS, type PmVariation } from "./variation"

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

export function liveContractValue(input: { budget: number | null | undefined; items: Array<{ quantity: number; rate: number }>; approvedVariations: number }): number {
  const priced = input.items.reduce((a, i) => a + (i.rate > 0 && i.quantity > 0 ? i.quantity * i.rate : 0), 0)
  return r2((priced > 0 ? priced : input.budget ?? 0) + input.approvedVariations)
}

/**
 * The contract value for a write. Read beside the transaction, not inside it (a
 * transaction cannot read a whole collection): an item's quantity and rate are
 * frozen once the project starts and a variation's value once it is submitted,
 * so what is read here is what the transaction would have read.
 */
export async function readContractValue(firestore: Firestore, projectId: string, budget: number | null | undefined): Promise<number> {
  const [boq, vos] = await Promise.all([getDocs(collection(firestore, "projects", projectId, "boqItems")), getDocs(collection(firestore, "projects", projectId, PM_VARIATIONS))])
  const items = boq.docs.map((d) => {
    const x = d.data() as { quantity?: unknown; unitPrice?: unknown }
    return { quantity: num(x.quantity), rate: num(x.unitPrice) }
  })
  const variations = vos.docs.map((d) => d.data() as Pick<PmVariation, "status" | "value">)
  return liveContractValue({ budget, items, approvedVariations: approvedValue(variations) })
}
