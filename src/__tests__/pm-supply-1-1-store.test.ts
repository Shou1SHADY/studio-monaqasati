/**
 * @jest-environment node
 *
 * PM 1.1 — the project store (qa_fixes FX-38, FX-40): a subcontractor recovery
 * is an outgoing movement «charged to the sub» that lowers the project balance
 * and does NOT grow the engineer's hold (STK-04, settles STK-01); a transfer
 * from another project is confirmed or refused only by the receiving project,
 * never by its sender, and a refusal puts it back in the sender's balance —
 * written on the server, because the sender's line is another project's (STK-11).
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"
import type { Firestore } from "firebase/firestore"
import type { Firestore as AdminFirestore } from "firebase-admin/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { answeredTransfer, isCharge, storeBalance, storeOut, transferBlocks, type PmStoreLine, type StoreItem, type StoreMove } from "@/lib/pm/store"
import { engineerHold, ledgerCustody } from "@/lib/pm/subcontract"
import { recordStoreRecovery, recordSubStoreMove, registerSubcontract } from "@/lib/pm/subcontract-writes"
import { answerStoreTransfer } from "@/lib/pm/store-transfer-server"
import { todayDay } from "@/lib/pm/format"

const KEY = "n:al-itqan"
const items: StoreItem[] = [{ id: "i1", code: "04-02-01", description: "Plaster", unit: "m2", quantity: 1000, executed: 500 }]
const contracts = [{ partyKey: KEY, lines: [{ itemId: "i1", code: null, description: null, unit: null, qty: 1000, rate: 40, value: 40000, certified: 0 }] }]
const mv = (t: StoreMove["t"], q: number, on: string, extra: Partial<StoreMove> = {}): StoreMove => ({ t, q, on, by: "pm1", sub: t === "op" ? null : KEY, ...extra })
const line = (moves: StoreMove[]): PmStoreLine => ({ id: "m1", key: "cement|bag", name: "Cement", unit: "bag", rates: { i1: { r: 1.25, w: 1, ex0: 0, src: "rate" } }, moves })

describe("STK-04 (FX-38) — a recovery is charged to the sub, not returned", () => {
  // 2000 on the project, 800 issued to him, he earned 631.25, a count found 150 → 18.75 short.
  const counted = [mv("op", 2000, "2026-09-01"), mv("iss", 800, "2026-09-02"), mv("cnt", 150, "2026-09-20")]

  it("the charge lowers the balance and his custody; the engineer's hold does not move", () => {
    const before = line(counted)
    const after = line([...counted, mv("chg", 18.75, "2026-09-21")])
    expect(storeBalance(after, items) - storeBalance(before, items)).toBeCloseTo(-18.75)
    expect(ledgerCustody(after, items, contracts, KEY)).toMatchObject({ issued: 781.25, gap: 0 })
    expect(engineerHold(after, items, contracts)).toBeCloseTo(engineerHold(before, items, contracts))
  })

  it("a recovery booked before 1.1 (a `back` with recovery) reads the same way — no migration", () => {
    const legacy = line([...counted, mv("back", 18.75, "2026-09-21", { recovery: true })])
    const now = line([...counted, mv("chg", 18.75, "2026-09-21")])
    expect(isCharge(legacy.moves[3])).toBe(true)
    expect(storeOut(legacy)).toBe(storeOut(now))
    expect(engineerHold(legacy, items, contracts)).toBeCloseTo(engineerHold(now, items, contracts))
    expect(ledgerCustody(legacy, items, contracts, KEY).gap).toBe(0)
  })

  it("the write books `chg`, and a return after it is capped at issued − returned − charged", async () => {
    resetFakeDb()
    const db = fakeFirestore as unknown as Firestore
    const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
    const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
    const pmA = { uid: "pm1", name: "PM" }
    const today = todayDay()
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live" } })
    seed("projects/p1/boqItems/i1", { itemNo: "04-02-01", quantity: 1000, unitPrice: 55, executedQuantity: 500, descriptionAr: "لياسة", unit: "م2" })
    seed("projects/p1/pmStore/m1", { key: "cement|bag", name: "Cement", unit: "bag", rates: { i1: { r: 1.25, w: 1, ex0: 0, src: "rate" } }, moves: [{ t: "op", q: 2000, on: "2026-09-01", by: "pm1" }], recoveries: [] })
    await registerSubcontract(db, owner, "p1", { uid: "own", name: "Owner" }, { party: { name: "Al-Itqan" }, retentionPct: 10, startOn: "2026-09-01", endOn: null, note: null, lines: [{ itemId: "i1", qty: 1000, rate: 40 }] })
    await recordSubStoreMove(db, pm, "p1", pmA, "m1", { t: "iss", partyKey: KEY, q: 800, day: today, note: "bulk" })
    await recordSubStoreMove(db, pm, "p1", pmA, "m1", { t: "cnt", partyKey: KEY, q: 150, day: today, note: null })
    await recordStoreRecovery(db, pm, "p1", pmA, "m1", { partyKey: KEY, q: 18.75, rate: 3, double: false, note: null })
    const after = readDoc<PmStoreLine>("projects/p1/pmStore/m1")!
    expect(after.moves.at(-1)).toMatchObject({ t: "chg", q: 18.75, sub: KEY })
    await expect(recordSubStoreMove(db, pm, "p1", pmA, "m1", { t: "back", partyKey: KEY, q: 790, day: today, note: null })).rejects.toMatchObject({ blocks: ["over_return"] })
  })
})

describe("STK-11 (FX-40) — a transfer in is answered by the receiving project", () => {
  const xi: StoreMove = { t: "xi", q: 40, on: "2026-10-01", by: "sender", st: "wait", otherProjectId: "pA", otherProjectName: "Tower A", srcStoreId: "m1", srcMove: 1 }

  it("pure: never the sender, a refusal says why", () => {
    expect(transferBlocks({ archived: false, move: xi, actorUid: "sender", answer: "confirm" })).toEqual(["own_transfer"])
    expect(transferBlocks({ archived: false, move: xi, actorUid: "eng", answer: "refuse", why: " " })).toEqual(["why_text"])
    expect(transferBlocks({ archived: false, move: { ...xi, st: "done" }, actorUid: "eng", answer: "confirm" })).toEqual(["not_waiting"])
    expect(transferBlocks({ archived: false, move: xi, actorUid: "eng", answer: "confirm" })).toEqual([])
  })

  it("a refused transfer is back in the sender's balance", () => {
    const xo: StoreMove = { t: "xo", q: 40, on: "2026-10-01", by: "sender", st: "wait", otherProjectId: "pB" }
    const src = line([mv("op", 100, "2026-09-01"), xo])
    expect(storeBalance(src, [])).toBe(60)
    const refused = answeredTransfer(xi, "refuse", { uid: "eng", name: "Eng" }, "2026-10-02", "not needed")
    expect(storeBalance({ ...src, moves: [src.moves[0], refused.xo(xo)] }, [])).toBe(100)
    expect(refused.xi).toMatchObject({ st: "rej", refBy: "eng", refWhy: "not needed" })
  })

  describe("on the server", () => {
    const adb = new FakeAdminDb()
    const db = adb as unknown as AdminFirestore
    beforeEach(() => {
      adb.docs.clear()
      adb.writes.length = 0
      adb.seed("teamGroups/site", { organizationId: "org", permissions: ["pm.site"] })
      for (const u of ["sender", "eng", "both"]) adb.seed(`users/${u}`, { organizationId: "org", organizationRole: "member", defaultGroupId: "site", name: u })
      adb.seed("projects/pA", { organizationId: "org", projectManagerId: "pmA", pm: { no: "PJ-2026/001", lifecycle: "live" } })
      adb.seed("projects/pB", { organizationId: "org", projectManagerId: "pmB", pm: { no: "PJ-2026/002", lifecycle: "live" } })
      adb.seed("projects/pB/members/eng", { userId: "eng", pmRole: "site" })
      adb.seed("projects/pB/members/both", { userId: "both", pmRole: "site" })
      adb.seed("projects/pA/pmStore/m1", { key: "cement|bag", name: "Cement", unit: "bag", rates: {}, moves: [{ t: "op", q: 100, on: "2026-09-01", by: "sender" }, { t: "xo", q: 40, on: "2026-10-01", by: "both", st: "wait", otherProjectId: "pB" }] })
      adb.seed("projects/pB/pmStore/m1", { key: "cement|bag", name: "Cement", unit: "bag", rates: {}, moves: [{ ...xi, by: "both" }] })
    })
    const input = (answer: "confirm" | "refuse", why: string | null = null) => ({ projectId: "pB", storeId: "m1", index: 0, answer, why, costHint: 20 })
    const moves = (p: string) => (adb.get(`projects/${p}/pmStore/m1`) as { moves: StoreMove[] }).moves

    it("the sender cannot confirm his own, even seated on both teams", async () => {
      await expect(answerStoreTransfer(db, "both", input("confirm"))).rejects.toMatchObject({ code: "BLOCKED", blocks: ["own_transfer"] })
      expect(moves("pB")[0].st).toBe("wait")
    })

    it("someone off the receiving team is refused by the guard", async () => {
      await expect(answerStoreTransfer(db, "sender", input("confirm"))).rejects.toMatchObject({ code: "REFUSED", blocks: ["not_on_team"] })
    })

    it("the recipient confirms: both halves close and the cost moves (prj:XFER)", async () => {
      await answerStoreTransfer(db, "eng", input("confirm"))
      expect(moves("pB")[0]).toMatchObject({ st: "done", appr: "eng" })
      expect(moves("pA")[1]).toMatchObject({ st: "done" })
      expect(adb.get("pmEvents/org__prj:XFER:PJ-2026_002:m1:0")).toMatchObject({ kind: "XFER", amount: 800 })
    })

    it("the recipient refuses with a reason: it returns to the sender's balance", async () => {
      await expect(answerStoreTransfer(db, "eng", input("refuse"))).rejects.toMatchObject({ blocks: ["why_text"] })
      await answerStoreTransfer(db, "eng", input("refuse", "wrong grade"))
      expect(moves("pB")[0]).toMatchObject({ st: "rej", refBy: "eng", refWhy: "wrong grade" })
      expect(moves("pA")[1]).toMatchObject({ st: "rej", refBy: "eng" })
      expect(storeBalance(line(moves("pA")), [])).toBe(100)
      expect([...adb.docs.keys()].some((k) => k.startsWith("pmEvents/"))).toBe(false)
    })
  })
})
