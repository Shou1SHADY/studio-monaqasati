// A BOQ item's commitments (the prototype's openItem «الالتزامات على هذا البند»):
// the purchase orders Procurement placed for it and the subcontracts let on it,
// each with its date, its value and how much of it has come in — and what share
// of the item's scope they cover («ملتزم به بأوامر وعقود (X% من النطاق)»).
// A PO line belongs to the item by its `boqItemId`, or — on an order raised from
// one of the project's material requests before lines carried the item — by the
// request line's material on that order. Pure: no I/O.

export interface CommitPoLine {
  name: string
  unit: string
  quantity: number
  unitPrice: number | null
  accepted: number
  cancelled: number
  boqItemId?: string | null
}

export interface CommitPo {
  id: string
  docNumber: string
  supplierName: string
  status: string
  createdAt: string
  approvedAt?: string | null
  sentAt?: string | null
  lines: CommitPoLine[]
}

export interface CommitSub {
  id: string
  seq: number
  party: { name: string }
  on: string
  startOn?: string | null
  lines: Array<{ itemId: string; qty: number; value: number; certified: number }>
}

export interface CommitmentRow {
  kind: "po" | "sub"
  id: string
  /** The PO's number, or the subcontract's sequence. */
  no: string | number
  party: string
  day: string
  value: number
  /** Received (a PO) or certified (a subcontract), 0–1. */
  recv: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const key = (name: string, unit: string) => `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`

export function itemCommitments(input: {
  itemId: string
  /** The item's budget (quantity × estimated unit cost); 0 = unknown. */
  budget: number
  /** The item's contracted quantity — a subcontract's share of scope when there is no budget. */
  quantity: number
  subs: CommitSub[]
  pos: CommitPo[]
  /** Request lines on this item that went onto an order. */
  requestLines?: Array<{ poId: string | null | undefined; name: string; unit: string }>
}): { rows: CommitmentRow[]; value: number; share: number | null } {
  const byPo = new Map<string, Set<string>>()
  for (const l of input.requestLines ?? []) {
    if (!l.poId) continue
    const set = byPo.get(l.poId) ?? new Set<string>()
    set.add(key(l.name, l.unit))
    byPo.set(l.poId, set)
  }
  const rows: CommitmentRow[] = []
  let subQty = 0
  for (const c of input.subs) {
    const mine = c.lines.filter((l) => l.itemId === input.itemId)
    if (!mine.length) continue
    const value = mine.reduce((a, l) => a + l.value, 0)
    subQty += mine.reduce((a, l) => a + l.qty, 0)
    rows.push({ kind: "sub", id: c.id, no: c.seq, party: c.party.name, day: (c.startOn || c.on).slice(0, 10), value: r2(value), recv: value > 0 ? mine.reduce((a, l) => a + l.value * l.certified, 0) / value : 0 })
  }
  for (const po of input.pos) {
    if (po.status === "cancelled") continue
    const names = byPo.get(po.id)
    const mine = po.lines.filter((l) => l.boqItemId === input.itemId || (!l.boqItemId && names?.has(key(l.name, l.unit))))
    if (!mine.length) continue
    const ordered = mine.reduce((a, l) => a + Math.max(0, l.quantity - l.cancelled), 0)
    rows.push({
      kind: "po",
      id: po.id,
      no: po.docNumber,
      party: po.supplierName,
      day: (po.sentAt || po.approvedAt || po.createdAt).slice(0, 10),
      value: r2(mine.reduce((a, l) => a + Math.max(0, l.quantity - l.cancelled) * (l.unitPrice ?? 0), 0)),
      recv: ordered > 0 ? Math.min(1, mine.reduce((a, l) => a + l.accepted, 0) / ordered) : 0,
    })
  }
  rows.sort((a, b) => a.day.localeCompare(b.day))
  const value = r2(rows.reduce((a, r) => a + r.value, 0))
  const share = input.budget > 0 ? value / input.budget : input.quantity > 0 && subQty > 0 ? subQty / input.quantity : rows.length ? null : 0
  return { rows, value, share }
}
