import { buildDeliveryNote, generateDeliveryNoteNumber, needsReceipt } from "@/lib/delivery-notes"
import type { WorkOrder } from "@/lib/manufacturing"

const order: WorkOrder = {
  id: "wo-3",
  organizationId: "org",
  orderNumber: 3,
  title: "أبواب حديد",
  items: [],
  materialCost: 1000,
  output: { name: "باب حديد", quantity: 4, unit: "قطعة" },
  source: { kind: "manual" },
  status: "done",
  currentStageIndex: 0,
  stages: [],
  createdByUserId: "u",
  createdByUserName: "u",
}
const actor = { id: "u-omar", name: "عمر" }
const sentAt = "2026-09-06T09:00:00.000Z"

describe("delivery notes", () => {
  it("numbers notes as DN- plus six unambiguous characters", () => {
    for (let i = 0; i < 20; i++) expect(generateDeliveryNoteNumber()).toMatch(/^DN-[A-HJ-NP-Z2-9]{6}$/)
  })

  it("waits for a signature everywhere except the virtual distribution warehouse", () => {
    expect(needsReceipt({ kind: "project" })).toBe(true)
    expect(needsReceipt({ kind: "central" })).toBe(true)
    expect(needsReceipt({ kind: "outbound" })).toBe(false)
  })

  it("writes an in-transit note that names the sender, the receiver and the item's cost", () => {
    const note = buildDeliveryNote({
      order,
      destination: { warehouseId: "site", warehouseName: "مستودع الموقع", kind: "project", projectId: "p1" },
      actor,
      expectedReceiver: { id: "u-keeper", name: "أمين المستودع" },
      sentAt,
      noteNumber: "DN-TEST01",
    })
    expect(note).toMatchObject({
      organizationId: "org",
      noteNumber: "DN-TEST01",
      status: "in_transit",
      source: { kind: "manufacturing", workOrderId: "wo-3", workOrderNumber: 3, title: "أبواب حديد" },
      item: { name: "باب حديد", quantity: 4, unit: "قطعة", unitCost: 250 },
      toWarehouseId: "site",
      toKind: "project",
      toProjectId: "p1",
      sentByUserId: "u-omar",
      sentByUserName: "عمر",
      sentAt,
      expectedReceiverUserId: "u-keeper",
      expectedReceiverName: "أمين المستودع",
      receivedByUserId: null,
      receivedAt: null,
    })
  })

  it("receives a handover to the distribution warehouse on the spot, signed by the sender", () => {
    const note = buildDeliveryNote({
      order: { ...order, materialCost: null },
      destination: { warehouseId: "out", warehouseName: "مستودع التوزيع", kind: "outbound" },
      actor,
      sentAt,
      noteNumber: "DN-TEST02",
    })
    expect(note).toMatchObject({
      status: "received",
      item: { unitCost: null },
      receivedByUserId: "u-omar",
      receivedByUserName: "عمر",
      receivedAt: sentAt,
      expectedReceiverUserId: null,
    })
  })
})
