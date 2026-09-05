// Quantity-based progress & IPC (مستخلصات) domain logic. Pure functions —
// the measurement ledger lives at projects/{id}/measurements (append-only,
// corrections are negative entries), executed totals are mirrored onto
// boqItems.executedQuantity, and claims snapshot their lines so history
// survives later BOQ edits.

export interface IpcTerms {
  retentionPercent: number
  advanceRecoveryPercent: number
  vatPercent: number
}

export const DEFAULT_IPC_TERMS: IpcTerms = {
  retentionPercent: 10,
  advanceRecoveryPercent: 0,
  vatPercent: 15,
}

export interface MeasurableBoqItem {
  id: string
  itemNo?: string
  descriptionAr?: string
  descriptionEn?: string
  unit?: string
  quantity: number
  unitPrice: number
  executedQuantity?: number
}

export interface MeasurementEntry {
  id: string
  boqItemId: string
  quantity: number
  measuredAt: string
  note?: string
  claimId?: string | null
}

export interface ClaimLine {
  boqItemId: string
  itemNo: string
  description: string
  unit: string
  unitPrice: number
  contractQty: number
  previousQty: number
  currentQty: number
  cumulativeQty: number
  amount: number
}

export interface ClaimTotals {
  gross: number
  retention: number
  advanceRecovery: number
  vat: number
  net: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Value-weighted physical progress across BOQ lines. */
export function computeProgress(items: MeasurableBoqItem[]): {
  percent: number
  contractValue: number
  executedValue: number
} {
  let contractValue = 0
  let executedValue = 0
  for (const item of items) {
    const qty = Number(item.quantity) || 0
    const price = Number(item.unitPrice) || 0
    const executed = Number(item.executedQuantity) || 0
    contractValue += qty * price
    // Overrun beyond the contract quantity doesn't push progress past 100%.
    executedValue += Math.min(executed, qty) * price
  }
  return {
    percent: contractValue > 0 ? round2((executedValue / contractValue) * 100) : 0,
    contractValue: round2(contractValue),
    executedValue: round2(executedValue),
  }
}

/** Cumulative quantity already claimed per BOQ item across prior claims. */
export function previouslyClaimedByItem(priorClaims: Array<{ lines?: ClaimLine[] }>): Map<string, number> {
  const map = new Map<string, number>()
  for (const claim of priorClaims) {
    for (const line of claim.lines || []) {
      map.set(line.boqItemId, (map.get(line.boqItemId) || 0) + line.currentQty)
    }
  }
  return map
}

/**
 * Turn unclaimed measurements into claim lines. Measurements for the same
 * BOQ item sum into one line; negative (reversal) entries net out; items
 * whose net movement is zero are dropped.
 */
export function buildClaimLines(
  measurements: MeasurementEntry[],
  boqItems: MeasurableBoqItem[],
  previousByItem: Map<string, number>,
  locale: string = "ar"
): ClaimLine[] {
  const itemById = new Map(boqItems.map((i) => [i.id, i]))
  const currentByItem = new Map<string, number>()
  for (const m of measurements) {
    if (m.claimId) continue
    currentByItem.set(m.boqItemId, (currentByItem.get(m.boqItemId) || 0) + (Number(m.quantity) || 0))
  }

  const lines: ClaimLine[] = []
  for (const [boqItemId, currentQty] of currentByItem) {
    if (currentQty === 0) continue
    const item = itemById.get(boqItemId)
    if (!item) continue
    const previousQty = previousByItem.get(boqItemId) || 0
    const unitPrice = Number(item.unitPrice) || 0
    lines.push({
      boqItemId,
      itemNo: item.itemNo || "",
      description:
        (locale === "ar" ? item.descriptionAr || item.descriptionEn : item.descriptionEn || item.descriptionAr) || "",
      unit: item.unit || "",
      unitPrice,
      contractQty: Number(item.quantity) || 0,
      previousQty: round2(previousQty),
      currentQty: round2(currentQty),
      cumulativeQty: round2(previousQty + currentQty),
      amount: round2(currentQty * unitPrice),
    })
  }
  return lines.sort((a, b) => a.itemNo.localeCompare(b.itemNo, undefined, { numeric: true }))
}

export function computeClaimTotals(lines: ClaimLine[], terms: IpcTerms): ClaimTotals {
  const gross = round2(lines.reduce((sum, l) => sum + l.amount, 0))
  const retention = round2((gross * (Number(terms.retentionPercent) || 0)) / 100)
  const advanceRecovery = round2((gross * (Number(terms.advanceRecoveryPercent) || 0)) / 100)
  const taxable = gross - retention - advanceRecovery
  const vat = round2((taxable * (Number(terms.vatPercent) || 0)) / 100)
  return { gross, retention, advanceRecovery, vat, net: round2(taxable + vat) }
}

export function nextClaimNumber(claims: Array<{ claimNumber?: number }>): number {
  return claims.reduce((max, c) => Math.max(max, Number(c.claimNumber) || 0), 0) + 1
}
