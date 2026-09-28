// «أمر مباشر لخدمة أو مقطوعية» (the prototype's poFree): transport, a daily
// rental, sundries — work that never arrives as a line from another module. One
// lump-sum line, quantity 1, at the value agreed with the supplier; charged to a
// project or to no project (a general expense). It is a direct order like any
// other and goes to approval — no competition rule, because a service has no
// material to compare. A subcontractor is not offered: his contract lives in
// Project Management. Pure; the write (`direct-writes.ts`) re-runs the check.

import { round2 } from "./po"
import type { PoLine } from "./types"

/** The lump-sum unit — stored like every unit, in the product's own words. */
export const LUMP_SUM_UNIT = "مقطوعية"

export interface ServiceOrderInput {
  description: string
  supplierName: string
  value: number | string | null
  /** «التنفيذ قبل», `YYYY-MM-DD`; optional. */
  dueBy?: string | null
}

export type ServiceOrderRefusal = "description_missing" | "supplier_missing" | "value_missing" | "due_past"

/** The prototype's order: «اكتب الوصف» → «اختر المورد» → «أدخل القيمة». */
export function serviceOrderRefusal(input: ServiceOrderInput, today: string): ServiceOrderRefusal | null {
  if (!(input.description || "").trim()) return "description_missing"
  if (!(input.supplierName || "").trim()) return "supplier_missing"
  const v = Number(String(input.value ?? "").replace(/,/g, ""))
  if (!Number.isFinite(v) || v <= 0) return "value_missing"
  if (input.dueBy && input.dueBy < today) return "due_past"
  return null
}

export const serviceOrderValue = (value: number | string | null): number => round2(Number(String(value ?? "").replace(/,/g, "")) || 0)

export function serviceOrderLine(description: string, value: number): PoLine {
  return { id: "l1", name: description.trim(), unit: LUMP_SUM_UNIT, quantity: 1, unitPrice: round2(value), accepted: 0, rejected: 0, held: 0, cancelled: 0, boqItemId: null, rfqProductIndex: null }
}

/** Suppliers a service order may go to: never a subcontractor. */
export const serviceSupplierOk = (kind: string | null | undefined): boolean => (kind || "mat") !== "sub"
