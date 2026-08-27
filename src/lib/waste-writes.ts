import {
  doc,
  increment,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore"
import { logFinanceAudit } from "@/lib/finance-audit"
import { wasteRecordsCollection, type WasteScope } from "@/hooks/useProjectWasteStats"

/** One line of an "issue from warehouse" — what left, what was used, why the difference. */
export type ConsumeRow = {
  inventoryItemId: string
  itemName: string
  quantityTaken: number
  quantityUsed: number
  unit: string
  unitCode?: string | null
  /** Snapshotted at issue time so later price edits can't rewrite historical waste value. */
  unitCost?: number | null
  /** Canonical waste category — only meaningful when this row actually wasted something. */
  reasonCode?: string | null
  reasonNote?: string | null
  unitIds?: string[]
  unitBarcodes?: string[]
  wastedUnitBarcodes?: string[]
  boqItemId?: string | null
}

/** Firestore caps a batch at 500 operations. */
const BATCH_LIMIT = 500

export interface RecordWasteInput {
  rows: ConsumeRow[]
  /** The warehouse the stock leaves. */
  warehouseId: string
  /** Where the records go — the project when there is one, else the warehouse. */
  scope: WasteScope
  /** Stamped on consumed barcode units so the unit knows what it went into. */
  projectName?: string | null
  /** The over-target justification, when the batch exceeded it. */
  exceptionReason?: string | null
  wasteTargetPercent: number
  userId: string
  userName: string
}

/**
 * Deduct stock, flip barcode units, and write the waste records — in ONE batch.
 *
 * These used to be separate awaits in a loop, so a failure on row 3 left rows
 * 1–2 deducted with no record to show for it. A batch either lands whole or not
 * at all. Throws `too_many_writes` when the batch would exceed Firestore's cap:
 * splitting silently would put us back to partial commits, so the caller tells
 * the user to issue in two passes instead.
 *
 * Shared by the project page (where a BOQ line is appended first) and the
 * standalone waste page (where there is no BOQ at all).
 */
export async function recordWasteConsumption(firestore: Firestore, input: RecordWasteInput): Promise<string> {
  const { rows, warehouseId, scope, userId, userName } = input
  const batchId = `issue_${Date.now()}`
  const unitWrites = rows.reduce((n, r) => n + (r.unitIds?.length || 0), 0)
  const totalWrites = rows.length * 2 + unitWrites
  if (totalWrites > BATCH_LIMIT) throw new Error("too_many_writes")

  const records = wasteRecordsCollection(firestore, scope)
  const batch = writeBatch(firestore)
  for (const r of rows) {
    batch.update(
      doc(firestore, "warehouses", warehouseId, "inventoryItems", r.inventoryItemId),
      { quantity: increment(-r.quantityTaken), updatedAt: serverTimestamp() }
    )
    for (const unitId of r.unitIds || []) {
      batch.update(
        doc(firestore, "warehouses", warehouseId, "inventoryItems", r.inventoryItemId, "units", unitId),
        {
          status: "consumed",
          consumedAt: serverTimestamp(),
          consumedProjectId: scope.projectId ?? null,
          consumedProjectName: input.projectName ?? null,
          updatedAt: serverTimestamp(),
        }
      )
    }
    const wasted = Math.max(0, r.quantityTaken - r.quantityUsed)
    batch.set(doc(records), {
      type: "consumption",
      batchId,
      // Needed to reverse this row later: without the source item id (and the
      // unit ids, not just their barcodes) a correction can't put the stock back.
      inventoryItemId: r.inventoryItemId,
      warehouseId,
      projectId: scope.projectId ?? null,
      unitIds: r.unitIds?.length ? r.unitIds : null,
      boqItemId: r.boqItemId ?? null,
      itemName: r.itemName,
      unit: r.unit,
      unitCode: r.unitCode ?? null,
      quantityTaken: r.quantityTaken,
      quantityUsed: r.quantityUsed,
      wastePercent: r.quantityTaken > 0 ? parseFloat(((wasted / r.quantityTaken) * 100).toFixed(1)) : 0,
      // Cost is snapshotted, never joined at read time — repricing an item
      // must not silently rewrite what past waste cost.
      unitCost: r.unitCost ?? null,
      wasteValue: r.unitCost != null ? parseFloat((wasted * r.unitCost).toFixed(2)) : null,
      reasonCode: wasted > 0 ? (r.reasonCode ?? null) : null,
      reasonNote: wasted > 0 && r.reasonNote ? r.reasonNote : null,
      // The over-target justification lives on every row of its batch, so the
      // ledger can answer "why" from the record itself instead of a side channel.
      exceptionReason: input.exceptionReason ?? null,
      unitBarcodes: r.unitBarcodes || null,
      wastedUnitBarcodes: r.wastedUnitBarcodes?.length ? r.wastedUnitBarcodes : null,
      recordedByUserId: userId,
      recordedByUserName: userName,
      createdAt: serverTimestamp(),
    })
  }
  await batch.commit()

  // The finance trail is per project — a warehouse has no ledger to write to.
  if (input.exceptionReason && scope.projectId) {
    const totalTaken = rows.reduce((s, r) => s + r.quantityTaken, 0)
    const totalUsed = rows.reduce((s, r) => s + r.quantityUsed, 0)
    const overallWastePercent = totalTaken > 0
      ? parseFloat((((totalTaken - totalUsed) / totalTaken) * 100).toFixed(1))
      : 0
    logFinanceAudit(firestore, scope.projectId, {
      action: "waste_threshold_exceeded",
      actorId: userId,
      actorName: userName,
      targetType: "wasteConsumption",
      targetId: `consume_${Date.now()}`,
      amount: Math.max(0, totalTaken - totalUsed),
      reason: input.exceptionReason,
      meta: {
        itemName: rows.map((r) => r.itemName).join("، "),
        unit: rows[0]?.unit || "",
        wastePercent: overallWastePercent,
        targetPercent: input.wasteTargetPercent,
      },
    })
  }

  return batchId
}

/** Default waste target when nothing more specific is configured. */
export const DEFAULT_WASTE_TARGET_PERCENT = 12
