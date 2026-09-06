// Delivery notes (إشعار تسليم) — nothing manufactured lands in a warehouse
// silently. Finishing a work order hands its output over on a note that names
// who sent it; the receiving warehouse confirms (who received, when) and only
// then does the stock — and its value — arrive. Inventory → project movements
// already have this shape as withdrawal requests (see warehouse-requests.ts);
// this is the manufacturing side of the same principle.

import { collection, doc, writeBatch, serverTimestamp, type Firestore } from "firebase/firestore"
import { WORK_ORDERS, effectiveOutput, type WorkOrder, type WorkOrderDelivery } from "./manufacturing"

export const DELIVERY_NOTES = "deliveryNotes"

export type DeliveryNoteStatus = "in_transit" | "received" | "rejected"
export const DELIVERY_NOTE_STATUSES: DeliveryNoteStatus[] = ["in_transit", "received", "rejected"]

export interface DeliveryNote {
  id: string
  organizationId: string
  noteNumber: string
  source: { kind: "manufacturing"; workOrderId: string; workOrderNumber: number; title: string }
  item: { name: string; quantity: number; unit: string; unitCost: number | null }
  toWarehouseId: string
  toWarehouseName: string
  toKind: WorkOrderDelivery["kind"]
  toProjectId?: string | null
  status: DeliveryNoteStatus
  sentByUserId: string
  sentByUserName: string
  sentAt: string
  expectedReceiverUserId?: string | null
  expectedReceiverName?: string | null
  receivedByUserId?: string | null
  receivedByUserName?: string | null
  receivedAt?: string | null
  receivedNote?: string | null
  rejectedReason?: string | null
  createdAt?: unknown
  updatedAt?: unknown
}

export function generateDeliveryNoteNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let suffix = ""
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
  return `DN-${suffix}`
}

/** The virtual distribution warehouse has no keeper to sign — handing over
 * to it is received on the spot by the sender. Everything else waits. */
export function needsReceipt(destination: Pick<WorkOrderDelivery, "kind">): boolean {
  return destination.kind !== "outbound"
}

export interface HandoverInput {
  order: WorkOrder
  destination: WorkOrderDelivery & { projectId?: string | null }
  actor: { id: string; name: string }
  expectedReceiver?: { id: string; name: string } | null
  sentAt: string
  noteNumber: string
}

/** Pure: the note a handover writes. */
export function buildDeliveryNote(input: HandoverInput): Omit<DeliveryNote, "id" | "createdAt" | "updatedAt"> {
  const out = effectiveOutput(input.order)
  const unitCost =
    input.order.materialCost != null && out.quantity > 0
      ? Math.round((input.order.materialCost / out.quantity) * 100) / 100
      : null
  const autoReceived = !needsReceipt(input.destination)
  return {
    organizationId: input.order.organizationId,
    noteNumber: input.noteNumber,
    source: {
      kind: "manufacturing",
      workOrderId: input.order.id,
      workOrderNumber: input.order.orderNumber,
      title: input.order.title,
    },
    item: { name: out.name, quantity: out.quantity, unit: out.unit, unitCost },
    toWarehouseId: input.destination.warehouseId,
    toWarehouseName: input.destination.warehouseName,
    toKind: input.destination.kind,
    toProjectId: input.destination.projectId ?? null,
    status: autoReceived ? "received" : "in_transit",
    sentByUserId: input.actor.id,
    sentByUserName: input.actor.name,
    sentAt: input.sentAt,
    expectedReceiverUserId: input.expectedReceiver?.id ?? null,
    expectedReceiverName: input.expectedReceiver?.name ?? null,
    receivedByUserId: autoReceived ? input.actor.id : null,
    receivedByUserName: autoReceived ? input.actor.name : null,
    receivedAt: autoReceived ? input.sentAt : null,
    receivedNote: null,
    rejectedReason: null,
  }
}

/** The finished item lands as a NEW inventory row carrying the order's
 * material cost as its unitCost — the value that entered the order as raw
 * materials leaves it as finished-goods value, so total inventory value never
 * drifts (it becomes cost only at sale). */
function landItem(firestore: Firestore, batch: ReturnType<typeof writeBatch>, note: Omit<DeliveryNote, "id" | "createdAt" | "updatedAt">) {
  const itemRef = doc(collection(firestore, "warehouses", note.toWarehouseId, "inventoryItems"))
  batch.set(itemRef, {
    organizationId: note.organizationId,
    warehouseId: note.toWarehouseId,
    name: note.item.name,
    quantity: note.item.quantity,
    unit: note.item.unit,
    unitCost: note.item.unitCost,
    isManufactured: true,
    sourceWorkOrderId: note.source.workOrderId,
    sourceWorkOrderNumber: note.source.workOrderNumber,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

type NotificationCopy = { title: string; message: string }

function queueNotification(firestore: Firestore, batch: ReturnType<typeof writeBatch>, uid: string, payload: Record<string, unknown>) {
  batch.set(doc(collection(firestore, "users", uid, "notifications")), { ...payload, userId: uid, read: false })
}

/**
 * Hand a finished order over. One batch: the note is written, the order is
 * stamped with where it went; if the destination needs a signature the stock
 * waits in transit and the expected receiver is told, otherwise it lands now.
 */
export async function handOverWorkOrder(
  firestore: Firestore,
  input: Omit<HandoverInput, "sentAt" | "noteNumber"> & { notification?: NotificationCopy | null }
): Promise<{ noteId: string; autoReceived: boolean }> {
  const sentAt = new Date().toISOString()
  const note = buildDeliveryNote({ ...input, sentAt, noteNumber: generateDeliveryNoteNumber() })
  const autoReceived = note.status === "received"
  const batch = writeBatch(firestore)
  const noteRef = doc(collection(firestore, DELIVERY_NOTES))
  batch.set(noteRef, { ...note, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  batch.update(doc(firestore, WORK_ORDERS, input.order.id), {
    deliveredTo: { warehouseId: input.destination.warehouseId, warehouseName: input.destination.warehouseName, kind: input.destination.kind },
    deliveredAt: sentAt,
    deliveryNoteId: noteRef.id,
    deliveryNoteNumber: note.noteNumber,
    receivedAt: autoReceived ? sentAt : null,
    receivedByUserId: autoReceived ? input.actor.id : null,
    receivedByUserName: autoReceived ? input.actor.name : null,
    updatedAt: serverTimestamp(),
  })
  if (autoReceived) landItem(firestore, batch, note)
  if (!autoReceived && input.expectedReceiver && input.expectedReceiver.id !== input.actor.id && input.notification) {
    queueNotification(firestore, batch, input.expectedReceiver.id, {
      organizationId: note.organizationId,
      type: "delivery_note_pending",
      title: input.notification.title,
      message: input.notification.message,
      deliveryNoteId: noteRef.id,
      deliveryNoteNumber: note.noteNumber,
      createdAt: sentAt,
    })
  }
  await batch.commit()
  return { noteId: noteRef.id, autoReceived }
}

/** The receiving side signs: stock lands, the note and the order are stamped
 * with who received it, and the sender hears back. */
export async function confirmDeliveryNote(
  firestore: Firestore,
  input: { note: DeliveryNote; actor: { id: string; name: string }; receivedNote: string | null; notification?: NotificationCopy | null }
): Promise<void> {
  const receivedAt = new Date().toISOString()
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, DELIVERY_NOTES, input.note.id), {
    status: "received",
    receivedByUserId: input.actor.id,
    receivedByUserName: input.actor.name,
    receivedAt,
    receivedNote: input.receivedNote,
    updatedAt: serverTimestamp(),
  })
  batch.update(doc(firestore, WORK_ORDERS, input.note.source.workOrderId), {
    receivedAt,
    receivedByUserId: input.actor.id,
    receivedByUserName: input.actor.name,
    updatedAt: serverTimestamp(),
  })
  landItem(firestore, batch, input.note)
  if (input.notification && input.note.sentByUserId && input.note.sentByUserId !== input.actor.id) {
    queueNotification(firestore, batch, input.note.sentByUserId, {
      organizationId: input.note.organizationId,
      type: "delivery_note_received",
      title: input.notification.title,
      message: input.notification.message,
      deliveryNoteId: input.note.id,
      deliveryNoteNumber: input.note.noteNumber,
      createdAt: receivedAt,
    })
  }
  await batch.commit()
}

/** The receiving side refuses: the note is closed with the reason and the
 * order goes back to "finished, undelivered" so it can be handed over again. */
export async function rejectDeliveryNote(
  firestore: Firestore,
  input: { note: DeliveryNote; actor: { id: string; name: string }; reason: string; notification?: NotificationCopy | null }
): Promise<void> {
  const at = new Date().toISOString()
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, DELIVERY_NOTES, input.note.id), {
    status: "rejected",
    receivedByUserId: input.actor.id,
    receivedByUserName: input.actor.name,
    receivedAt: at,
    rejectedReason: input.reason,
    updatedAt: serverTimestamp(),
  })
  batch.update(doc(firestore, WORK_ORDERS, input.note.source.workOrderId), {
    deliveredTo: null,
    deliveredAt: null,
    deliveryNoteId: null,
    deliveryNoteNumber: null,
    receivedAt: null,
    receivedByUserId: null,
    receivedByUserName: null,
    updatedAt: serverTimestamp(),
  })
  if (input.notification && input.note.sentByUserId && input.note.sentByUserId !== input.actor.id) {
    queueNotification(firestore, batch, input.note.sentByUserId, {
      organizationId: input.note.organizationId,
      type: "delivery_note_rejected",
      title: input.notification.title,
      message: input.notification.message,
      deliveryNoteId: input.note.id,
      deliveryNoteNumber: input.note.noteNumber,
      createdAt: at,
    })
  }
  await batch.commit()
}
