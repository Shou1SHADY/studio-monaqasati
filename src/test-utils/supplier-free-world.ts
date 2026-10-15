// The prototype's 144-deal demo world (Prototype-Supplier-v13, "today" = 11 Oct 2026),
// mapped onto our `Deal` shape: a line carries its accepted / not accepted / cancelled
// quantities, and an invoice carries the receipts it covers (one per receipt).

import seed from "./fixtures/supplier-free-seed.json"
import type { ContractorRef, Deal, DealInvoice, PaymentTerm, PoLineFact, World } from "@/lib/supplier-free/types"

interface ProtoShip {
  st: "ok" | "wait"
  items?: Record<string, number>
  got?: Record<string, number>
  grn?: string
}

interface ProtoDeal extends Omit<Deal, "invs" | "po"> {
  inv?: Omit<DealInvoice, "grns"> | null
  po: (Omit<NonNullable<Deal["po"]>, "lines"> & { lines: { it: string; qty: number; price: number }[]; cancel?: Record<string, number> }) | null
}

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))

function toDeal(p: ProtoDeal, terms: Record<string, PaymentTerm[]>): Deal {
  const { inv, po, ...rest } = p
  let nextPo: Deal["po"] = null
  if (po) {
    const ships = (p.ship as ProtoShip[]).filter((s) => s.st === "ok")
    const lines: PoLineFact[] = po.lines.map((l) => {
      let got = 0
      let rej = 0
      for (const s of ships) {
        const q = (s.items && s.items[l.it]) || 0
        if (!q) continue
        const g = s.got && s.got[l.it] != null ? s.got[l.it] : q
        got += g
        rej += q - g
      }
      return { it: l.it, qty: l.qty, price: l.price, got, rej, can: (po.cancel && po.cancel[l.it]) || 0 }
    })
    const { cancel: _cancel, ...poRest } = po
    nextPo = { ...poRest, lines, terms: po.terms }
  }
  const grns = (p.ship as ProtoShip[]).filter((s) => s.st === "ok").map((s) => s.grn as string)
  return { ...(rest as Omit<Deal, "po" | "invs">), po: nextPo, invs: inv ? [{ ...inv, grns }] : [], terms: terms[p.c] }
}

export function protoWorld(): { today: string; world: World } {
  const s = clone(seed) as unknown as {
    today: string
    terms: Record<string, PaymentTerm[]>
    world: { deals: ProtoDeal[]; contractors: Record<string, ContractorRef>; invites: World["invites"]; arch: Record<string, 1> }
  }
  return {
    today: s.today,
    world: {
      deals: s.world.deals.map((d) => toDeal(d, s.terms)),
      contractors: s.world.contractors,
      invites: s.world.invites,
      requests: [],
      arch: s.world.arch,
      seen: {},
    },
  }
}
