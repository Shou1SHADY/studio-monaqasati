/**
 * Phased drawdown against a BOQ line: draws accumulate, the line locks only
 * when nothing is left, and releasing an RFQ's draw hands its quantity back.
 */
jest.mock("firebase/firestore", () => ({
  serverTimestamp: () => "SERVER_TS",
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  writeBatch: jest.fn(),
}))

import { applyDraw, boqRemaining, releaseAllDraws, releaseDraw, type BoqDraw } from "@/lib/boq-draws"

const at = "2026-08-27T10:00:00.000Z"

describe("boqRemaining", () => {
  it("is the total minus what has been drawn, never negative", () => {
    expect(boqRemaining({ quantity: 10000, drawnQuantity: 1000 })).toBe(9000)
    expect(boqRemaining({ quantity: "10000", drawnQuantity: undefined })).toBe(10000)
    expect(boqRemaining({ quantity: 5, drawnQuantity: 9 })).toBe(0)
  })
})

describe("applyDraw", () => {
  it("adds the draw and keeps the line open while quantity remains", () => {
    const next = applyDraw({ quantity: 10000, drawnQuantity: 0, draws: [] }, { rfqId: "r1", quantity: 1000, at })
    expect(next.drawnQuantity).toBe(1000)
    expect(next.draws).toHaveLength(1)
    expect(next.tenderId).toBe("r1")
    expect(next.isEditable).toBe(true)
  })

  it("locks the line once the last quantity is drawn", () => {
    const first: BoqDraw = { rfqId: "r1", quantity: 9000, at }
    const next = applyDraw({ quantity: 10000, drawnQuantity: 9000, draws: [first] }, { rfqId: "r2", quantity: 1000, at })
    expect(next.drawnQuantity).toBe(10000)
    expect(next.isEditable).toBe(false)
    expect(next.tenderId).toBe("r2")
    expect(next.draws.map((d) => d.rfqId)).toEqual(["r1", "r2"])
  })

  it("sums the draws rather than trusting the stored counter", () => {
    const next = applyDraw({ quantity: 100, drawnQuantity: 999, draws: [{ rfqId: "r1", quantity: 40, at }] }, { rfqId: "r2", quantity: 10, at })
    expect(next.drawnQuantity).toBe(50)
  })
})

describe("releaseDraw", () => {
  const draws: BoqDraw[] = [
    { rfqId: "r1", quantity: 1000, at },
    { rfqId: "r2", quantity: 500, at },
  ]

  it("hands one RFQ's quantity back and reopens the line", () => {
    const next = releaseDraw({ quantity: 1500, draws, tenderId: "r2" }, "r2")
    expect(next.drawnQuantity).toBe(1000)
    expect(next.draws.map((d) => d.rfqId)).toEqual(["r1"])
    expect(next.tenderId).toBe("r1")
    expect(next.isEditable).toBe(true)
  })

  it("clears the pointer when the last draw goes", () => {
    const next = releaseDraw({ quantity: 1000, draws: [draws[0]], tenderId: "r1" }, "r1")
    expect(next.drawnQuantity).toBe(0)
    expect(next.draws).toEqual([])
    expect(next.tenderId).toBeNull()
  })

  it("releaseAllDraws frees the whole line", () => {
    expect(releaseAllDraws()).toMatchObject({ draws: [], drawnQuantity: 0, tenderId: null, isEditable: true })
  })
})
