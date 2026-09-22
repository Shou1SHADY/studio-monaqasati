/**
 * Procurement PRD 3.0 §4 `RCVR` / §5.2-3 — who receives goods and where, and
 * whether a notice nobody has forwarded needs chasing.
 *
 * The forward dialog used to offer every member of the organisation, which asks
 * the wrong question: the right receiver for a truck going to the Narjes site is
 * the person who signs at Narjes, and they may have no account at all.
 */

import {
  RECEIVER_MODULES,
  cleanReceiver,
  forwardUrgency,
  phoneDigits,
  phoneUsable,
  receiverCovers,
  receiverMatches,
  receiverProblems,
  receiverRows,
  receiversForPlace,
  type ProcReceiver,
} from "@/lib/procurement/receivers"

const receiver = (over: Partial<ProcReceiver>): ProcReceiver =>
  ({
    id: "r1",
    organizationId: "org",
    name: "ماجد السالم",
    title: "أمين المستودع المركزي",
    module: "inventory",
    phone: "0551002210",
    userId: null,
    warehouseIds: ["w1"],
    active: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdById: "buyer",
    ...over,
  }) as ProcReceiver

describe("a mobile the code can reach", () => {
  it("reads a number however it was written", () => {
    expect(phoneDigits(" +966 55 100 2210 ")).toBe("966551002210")
    expect(phoneUsable("055-100-2210")).toBe(true)
  })

  it("refuses one too short to dial", () => {
    expect(phoneUsable("0551")).toBe(false)
    expect(phoneUsable("")).toBe(false)
    expect(phoneUsable(null)).toBe(false)
  })
})

describe("what a register entry must have", () => {
  it("accepts a complete one", () => {
    expect(receiverProblems({ name: "ماجد", title: "أمين مستودع", phone: "0551002210" })).toEqual([])
  })

  it("names what is missing, in the order a form should say it", () => {
    expect(receiverProblems({ name: "م", title: "", phone: "12" })).toEqual(["name", "phone", "title"])
  })

  it("trims, de-duplicates the places and keeps them in a stable order", () => {
    expect(
      cleanReceiver({ name: " ماجد ", title: " أمين ", module: "inventory", phone: " 0551002210 ", warehouseIds: ["w2", "w1", "w2", "", "  "] })
    ).toEqual({ name: "ماجد", title: "أمين", module: "inventory", phone: "0551002210", userId: null, warehouseIds: ["w1", "w2"] })
  })

  it("has exactly two modules — the desks goods actually reach", () => {
    expect(RECEIVER_MODULES).toEqual(["inventory", "projects"])
  })
})

describe("who covers a place", () => {
  it("covers the places named on the entry", () => {
    expect(receiverCovers(receiver({ warehouseIds: ["w1", "w2"] }), "w2")).toBe(true)
    expect(receiverCovers(receiver({ warehouseIds: ["w1"] }), "w2")).toBe(false)
  })

  it("treats an empty list as everywhere — a relief keeper stands in", () => {
    expect(receiverCovers(receiver({ warehouseIds: [] }), "w9")).toBe(true)
  })

  it("covers everything when the place is unknown", () => {
    expect(receiverCovers(receiver({ warehouseIds: ["w1"] }), null)).toBe(true)
  })
})

describe("the list the forward dialog offers", () => {
  const atPlace = receiver({ id: "at", name: "ياسر", warehouseIds: ["w2"] })
  const relief = receiver({ id: "relief", name: "خالد", warehouseIds: [] })
  const elsewhere = receiver({ id: "else", name: "سعود", warehouseIds: ["w4"] })
  const retired = receiver({ id: "old", name: "أحمد", warehouseIds: ["w2"], active: false })

  it("puts the people named for this place first, then whoever can stand in", () => {
    const list = receiversForPlace([relief, elsewhere, atPlace], "w2")
    expect(list.map((r) => r.id)).toEqual(["at", "relief"])
    expect(list[0].atThisPlace).toBe(true)
    expect(list[1].atThisPlace).toBe(false)
  })

  it("never offers a retired one", () => {
    // A list that still offers last year's keeper forwards a truck to a phone
    // nobody answers.
    expect(receiversForPlace([retired, atPlace], "w2").map((r) => r.id)).toEqual(["at"])
  })

  it("offers everybody live when the place is unknown", () => {
    expect(receiversForPlace([atPlace, relief, elsewhere], null).map((r) => r.id).sort()).toEqual(["at", "else", "relief"])
  })

  it("sorts by name inside a group", () => {
    const a = receiver({ id: "a", name: "أحمد", warehouseIds: ["w2"] })
    const b = receiver({ id: "b", name: "بدر", warehouseIds: ["w2"] })
    expect(receiversForPlace([b, a], "w2").map((r) => r.id)).toEqual(["a", "b"])
  })
})

describe("the register as settings shows it", () => {
  it("lists live entries before retired ones", () => {
    const rows = receiverRows([receiver({ id: "old", name: "ب", active: false }), receiver({ id: "live", name: "ج" })])
    expect(rows.map((r) => r.id)).toEqual(["live", "old"])
  })

  it("searches name, title and mobile, folded", () => {
    const r = receiver({ name: "ماجد السالم", title: "أمين المستودع", phone: "0551002210" })
    expect(receiverMatches(r, "مستودع")).toBe(true)
    expect(receiverMatches(r, "2210")).toBe(true)
    expect(receiverMatches(r, "055 100")).toBe(true)
    expect(receiverMatches(r, "")).toBe(true)
    expect(receiverMatches(r, "سعود")).toBe(false)
  })
})

describe("chasing a notice nobody has forwarded", () => {
  it("is due inside the window", () => {
    expect(forwardUrgency(1, 1)).toBe("due")
    expect(forwardUrgency(0, 1)).toBe("due")
  })

  it("is quiet while the delivery is still far off", () => {
    expect(forwardUrgency(5, 1)).toBe("none")
  })

  it("is overdue once the date has passed", () => {
    expect(forwardUrgency(-1, 1)).toBe("overdue")
  })

  it("says nothing about a notice with no date", () => {
    expect(forwardUrgency(null, 1)).toBe("none")
  })

  it("treats a window of zero as the delivery day itself", () => {
    expect(forwardUrgency(0, 0)).toBe("due")
    expect(forwardUrgency(1, 0)).toBe("none")
    // A negative policy cannot make the window wider than nothing.
    expect(forwardUrgency(1, -5)).toBe("none")
  })
})
