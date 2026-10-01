import {
  AUTO_FORWARD_MAX_OVERDUE_DAYS,
  autoForwardSkip,
  isAutoForwarded,
  selectDueNotices,
  type AutoForwardInput,
} from "@/lib/procurement/auto-forward"
import { incomingPill, receiptLog, receiptTrail, type DeskDelivery, type IncomingRow } from "@/lib/procurement/receipt-desk"
import type { ProcReceiver } from "@/lib/procurement/receivers"
import { exceptions } from "@/lib/procurement/reports"
import { DEFAULT_POLICIES } from "@/lib/procurement/types"
import type { PurchaseOrder } from "@/lib/procurement/types"
import type { ProcWorld } from "@/lib/procurement/today"

const ORG = "org1"
const NOW = new Date("2026-09-22T09:00:00+03:00")

const notice = (over: Partial<DeskDelivery> & { id: string }): DeskDelivery =>
  ({
    status: "pending_confirmation",
    supplierName: "Al Rajhi",
    deliveryDate: "2026-09-22",
    poId: "po1",
    lines: [],
    ...over,
  }) as DeskDelivery

const receiver = (over: Partial<ProcReceiver> & { id: string }): ProcReceiver => ({
  organizationId: ORG,
  name: "Nasser",
  title: "Central store keeper",
  module: "inventory",
  phone: "0501234567",
  warehouseIds: [],
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdById: "owner1",
  ...over,
})

const input = (over: Partial<AutoForwardInput> = {}): AutoForwardInput => ({
  orgId: ORG,
  deliveries: [],
  policies: DEFAULT_POLICIES,
  receivers: [receiver({ id: "r1" })],
  projects: [],
  orders: [{ id: "po1", projectId: null }],
  now: NOW,
  ...over,
})

const why = (d: DeskDelivery, over: Partial<AutoForwardInput> = {}) => autoForwardSkip(d, input(over)).skip

describe("which notices the job forwards", () => {
  it("forwards a notice whose day is today — the window (1 day) has lapsed", () => {
    expect(why(notice({ id: "n1", deliveryDate: "2026-09-22" }))).toBeNull()
  })

  it("forwards a notice one day out (still inside the window of 1) and one already past", () => {
    expect(why(notice({ id: "n1", deliveryDate: "2026-09-23" }))).toBeNull()
    expect(why(notice({ id: "n1", deliveryDate: "2026-09-20" }))).toBeNull()
  })

  it("leaves a notice beyond the window to Procurement", () => {
    expect(why(notice({ id: "n1", deliveryDate: "2026-09-24" }))).toBe("in_window")
  })

  it("follows the policy: a window of 3 days takes a notice three days out", () => {
    expect(why(notice({ id: "n1", deliveryDate: "2026-09-25" }), { policies: { ...DEFAULT_POLICIES, forwardWindowDays: 3 } })).toBeNull()
    expect(why(notice({ id: "n1", deliveryDate: "2026-09-26" }), { policies: { ...DEFAULT_POLICIES, forwardWindowDays: 3 } })).toBe("in_window")
  })

  it(`leaves a notice more than ${AUTO_FORWARD_MAX_OVERDUE_DAYS} days overdue to a person — a first run must not text about last quarter's truck`, () => {
    expect(why(notice({ id: "n1", deliveryDate: "2026-09-15" }))).toBeNull()
    expect(why(notice({ id: "n1", deliveryDate: "2026-09-14" }))).toBe("too_old")
  })

  it("never touches a notice already forwarded, signed, or closed by a receipt", () => {
    const fw = { linkId: "l1", name: "X", userId: null, phoneMasked: "05xx", byName: "Buyer", at: "2026-09-21T08:00:00.000Z" }
    expect(why(notice({ id: "n1", forwardedTo: fw }))).toBe("told")
    expect(why(notice({ id: "n1", receiverReport: { signedAt: "x" } as DeskDelivery["receiverReport"] }))).toBe("told")
    expect(why(notice({ id: "n1", status: "confirmed" }))).toBe("not_pending")
    expect(why(notice({ id: "n1", closedByReceipt: { deliveryId: "d9", docNumber: "GR-2026/001" } }))).toBe("not_pending")
  })

  it("does nothing when the notice already reaches the receiver directly (noticeRouting both)", () => {
    expect(why(notice({ id: "n1" }), { policies: { ...DEFAULT_POLICIES, noticeRouting: "both" } as AutoForwardInput["policies"] })).toBe("told")
  })

  it("skips a truck that came with no notice, a hand-typed receipt, and a notice with no date", () => {
    expect(why(notice({ id: "n1", noNotice: true }))).toBe("no_notice")
    expect(why(notice({ id: "n1", source: "manual" }))).toBe("no_notice")
    expect(why(notice({ id: "n1", deliveryDate: null }))).toBe("no_date")
  })

  it("leaves it untouched when nobody in the register covers the place", () => {
    expect(why(notice({ id: "n1" }), { receivers: [] })).toBe("no_receiver")
    expect(why(notice({ id: "n1" }), { receivers: [receiver({ id: "r1", active: false })] })).toBe("no_receiver")
    expect(why(notice({ id: "n1" }), { receivers: [receiver({ id: "r1", warehouseIds: ["other"] })] })).toBe("no_receiver")
  })

  it("leaves it untouched when the receiver's number cannot take a code", () => {
    expect(why(notice({ id: "n1" }), { receivers: [receiver({ id: "r1", phone: "12" })] })).toBe("no_phone")
  })
})

describe("who receives it", () => {
  it("the person named for the place the goods land beats a stand-in for everywhere", () => {
    const standIn = receiver({ id: "r0", name: "Aaa relief", warehouseIds: [] })
    const named = receiver({ id: "r1", name: "Zaid at the project", warehouseIds: ["wh_p1"] })
    const due = selectDueNotices(input({ deliveries: [notice({ id: "n1", projectId: "p1" })], receivers: [standIn, named], projects: [{ id: "p1", warehouseId: "wh_p1" }] }))
    expect(due.map((d) => [d.delivery.id, d.receiver.id, d.warehouseId])).toEqual([["n1", "r1", "wh_p1"]])
  })

  it("lands on the central store when the order has no project, and the order's project when the notice names none", () => {
    const central = receiver({ id: "rc", warehouseIds: [`central_${ORG}`] })
    const site = receiver({ id: "rs", name: "Site", warehouseIds: ["wh_p2"] })
    const base = { receivers: [central, site], projects: [{ id: "p2", warehouseId: "wh_p2" }] }
    expect(selectDueNotices(input({ ...base, deliveries: [notice({ id: "n1" })] }))[0].receiver.id).toBe("rc")
    expect(selectDueNotices(input({ ...base, deliveries: [notice({ id: "n1" })], orders: [{ id: "po1", projectId: "p2" }] }))[0].receiver.id).toBe("rs")
  })

  it("returns the most overdue first, then by id", () => {
    const due = selectDueNotices(
      input({
        deliveries: [notice({ id: "b", deliveryDate: "2026-09-22" }), notice({ id: "a", deliveryDate: "2026-09-22" }), notice({ id: "c", deliveryDate: "2026-09-19" })],
      }),
    )
    expect(due.map((d) => d.delivery.id)).toEqual(["c", "a", "b"])
    expect(due.map((d) => d.daysToDelivery)).toEqual([-3, 0, 0])
  })

  it("selects nothing from an empty desk", () => {
    expect(selectDueNotices(input())).toEqual([])
  })
})

describe("how the tag reads", () => {
  const forwardedTo = { linkId: "l1", name: "Nasser", userId: null, phoneMasked: "05****67", byName: "Mdmak Tech", at: "2026-09-22T06:00:00.000Z", note: null }
  const row = (d: DeskDelivery): IncomingRow => ({ kind: "notice", id: d.id, delivery: d, po: null, state: "waiting" as never, day: "2026-09-22", daysFromNow: 0, afterPromise: 0 })

  it("isAutoForwarded is true only for the job's forward", () => {
    expect(isAutoForwarded(notice({ id: "n1", forwardedTo: { ...forwardedTo, auto: true } }))).toBe(true)
    expect(isAutoForwarded(notice({ id: "n1", forwardedTo }))).toBe(false)
    expect(isAutoForwarded(notice({ id: "n1" }))).toBe(false)
  })

  it("the row's pill says auto-forwarded — and a manual forward still reads as before", () => {
    expect(incomingPill(row(notice({ id: "n1", forwardedTo: { ...forwardedTo, auto: true } })))).toEqual({ kind: "auto_forwarded" })
    expect(incomingPill(row(notice({ id: "n1", forwardedTo })))).not.toEqual({ kind: "auto_forwarded" })
    expect(incomingPill(row(notice({ id: "n1" })))).toMatchObject({ kind: "to_forward" })
  })

  it("the pill gives way once the receiver has signed", () => {
    const signed = notice({ id: "n1", forwardedTo: { ...forwardedTo, auto: true }, receiverReport: { signedAt: "2026-09-22T07:00:00.000Z" } as DeskDelivery["receiverReport"] })
    expect(incomingPill(row(signed))).not.toEqual({ kind: "auto_forwarded" })
  })

  const po = { id: "po1", docNumber: "PO-2026/001", supplierName: "Al Rajhi", status: "approved", lines: [] } as unknown as PurchaseOrder
  const forwardedStep = (d: DeskDelivery) => receiptTrail(d, po).find((s) => s.key === "forwarded")

  it("the trail's forwarded step is the automatic variant", () => {
    expect(forwardedStep(notice({ id: "n1", forwardedTo: { ...forwardedTo, auto: true } }))).toMatchObject({ variant: "auto", at: forwardedTo.at, params: { name: "Nasser", phone: "05****67" } })
    expect(forwardedStep(notice({ id: "n1", forwardedTo }))).toMatchObject({ variant: "link" })
    expect(forwardedStep(notice({ id: "n1", forwardedTo: { ...forwardedTo, userId: "u1" } }))).toMatchObject({ variant: "member" })
  })

  it("the receipt's log carries a forwarded_auto entry, by the system", () => {
    const log = receiptLog(notice({ id: "n1", forwardedTo: { ...forwardedTo, auto: true } }), null)
    expect(log.filter((e) => e.action === "forwarded_auto")).toEqual([{ at: forwardedTo.at, action: "forwarded_auto", by: "Mdmak Tech", params: { name: "Nasser" } }])
    expect(receiptLog(notice({ id: "n1", forwardedTo }), null).map((e) => e.action)).toContain("forwarded")
  })
})

describe("the exceptions report", () => {
  const world = (receipts: unknown[]): ProcWorld => ({ orders: [], receipts, rfqs: [], offers: [], policies: DEFAULT_POLICIES, suppliers: [] }) as unknown as ProcWorld
  const autoNotice = (over: Record<string, unknown> = {}) => ({
    id: "n1",
    status: "pending_confirmation",
    supplierName: "Al Rajhi",
    deliveryDate: "2026-09-22",
    lines: [],
    forwardedTo: { linkId: "l1", name: "Nasser", userId: null, phoneMasked: "05****67", byName: "Mdmak Tech", at: "2026-09-22T06:00:00.000Z", auto: true },
    ...over,
  })

  it("lists an auto-forwarded notice on the day it was forwarded, naming the receiver", () => {
    const rows = exceptions(world([autoNotice()])).filter((e) => e.kind === "auto_forwarded")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ receiptId: "n1", day: "2026-09-22", supplierName: "Al Rajhi", params: { name: "Nasser" } })
  })

  it("keeps listing it after the goods are received", () => {
    const kinds = exceptions(world([autoNotice({ status: "confirmed", confirmedAt: "2026-09-23T08:00:00.000Z" })])).map((e) => e.kind)
    expect(kinds).toContain("auto_forwarded")
  })

  it("does not list a manual forward, nor a notice nobody forwarded", () => {
    const manual = autoNotice({ forwardedTo: { linkId: "l1", name: "Nasser", userId: null, phoneMasked: "05", byName: "Buyer", at: "2026-09-22T06:00:00.000Z" } })
    expect(exceptions(world([manual])).map((e) => e.kind)).not.toContain("auto_forwarded")
    expect(exceptions(world([autoNotice({ forwardedTo: null })])).map((e) => e.kind)).not.toContain("auto_forwarded")
  })

  it("honours the report period", () => {
    const inside = exceptions(world([autoNotice()]), { from: "2026-09-01", to: "2026-09-30" })
    const outside = exceptions(world([autoNotice()]), { from: "2026-10-01", to: "2026-10-31" })
    expect(inside.map((e) => e.kind)).toContain("auto_forwarded")
    expect(outside.map((e) => e.kind)).not.toContain("auto_forwarded")
  })
})
