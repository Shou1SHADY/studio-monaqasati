/**
 * PM 1.0 — close and archive through one gate (ARC-01, CST-04, CON-04,
 * INV-10, INV-21; AC-12). Open money blocks closing; the snapshot is frozen;
 * an archived project accepts no change from anyone, the owner included.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { archiveSnapshot, closeBlocks, closeoutRows, type CloseInput } from "@/lib/pm/closeout"
import { closeAndArchive, PmCloseError } from "@/lib/pm/closeout-writes"
import { draftAddendum } from "@/lib/pm/addendum-writes"
import { raisePunch } from "@/lib/pm/punch-writes"
import { writeSheet } from "@/lib/pm/measurement-writes"
import { defaultTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const pmA = { uid: "pm1", name: "Abdullah" }

const base: CloseInput = {
  hasClient: true,
  acceptances: { prov: { on: "2026-06-01", by: "pm1" }, final: { on: "2026-09-01", by: "pm1" } },
  punch: [],
  items: [{ rate: 100, executed: 10, billed: 10 }],
  cutPool: 0,
  certificates: [{ status: "appr", net: 1000, dueOn: "2026-10-30", collected: 0 }],
  retentionHeld: 0,
  retentionReleased: false,
  today: "2026-09-27",
}

function seedDone(pmOver: Record<string, unknown> = {}) {
  const terms = defaultTerms()
  seed("projects/p1", {
    organizationId: "org",
    budget: 1000,
    projectManagerId: "pm1",
    status: "remaining_payment",
    pm: { no: "PJ-2026/005", lifecycle: "done", terms, original: terms, durationDays: 90, startedAt: "2026-05-01T00:00:00Z", acceptances: base.acceptances, retentionHeld: 0, ...pmOver },
  })
  seed("projects/p1/boqItems/i1", { itemNo: "01", quantity: "10", unitPrice: "100", executedQuantity: 10, billedQuantity: 10 })
}

beforeEach(() => resetFakeDb())

describe("the one gate", () => {
  it("a clean project passes", () => {
    expect(closeBlocks(closeoutRows(base))).toEqual([])
  })

  it("open money blocks: unbilled, a certificate in progress, overdue collection, retention held (AC-12)", () => {
    expect(closeBlocks(closeoutRows({ ...base, items: [{ rate: 100, executed: 12, billed: 10 }] })).map((r) => r.key)).toEqual(["unbilled"])
    expect(closeBlocks(closeoutRows({ ...base, certificates: [{ status: "sub", net: 5 }] })).map((r) => r.key)).toEqual(["in_progress"])
    expect(closeBlocks(closeoutRows({ ...base, today: "2026-11-01" })).map((r) => r.key)).toEqual(["overdue"])
    expect(closeBlocks(closeoutRows({ ...base, certificates: [{ status: "appr", net: 1000, dueOn: "2026-01-01", collected: 1 }] }))).toEqual([])
    expect(closeBlocks(closeoutRows({ ...base, retentionHeld: 500 })).map((r) => r.key)).toEqual(["retention"])
    expect(closeBlocks(closeoutRows({ ...base, retentionHeld: 500, retentionReleased: true }))).toEqual([])
  })

  it("paperwork: open punch, missing handovers, executed-but-unpriced work (CON-04)", () => {
    expect(closeBlocks(closeoutRows({ ...base, punch: [{ status: "fix" }] })).map((r) => r.key)).toEqual(["punch"])
    expect(closeBlocks(closeoutRows({ ...base, acceptances: {} })).map((r) => r.key)).toEqual(["prov", "final"])
    expect(closeBlocks(closeoutRows({ ...base, items: [...base.items, { rate: 0, executed: 4, billed: 0 }] })).map((r) => r.key)).toEqual(["unpriced"])
  })

  it("nobody pays: no money rows", () => {
    expect(closeoutRows({ ...base, hasClient: false }).map((r) => r.key)).toEqual(["punch", "prov", "final", "unpriced"])
  })

  it("the snapshot: value, earned, certified, durations and delay — no invented cost (CST-04)", () => {
    const s = archiveSnapshot({
      contractValue: 1000,
      items: [{ rate: 100, executed: 10 }],
      certificates: [{ status: "appr", gross: 900 }, { status: "void", gross: 50 }],
      retentionHeld: 0,
      advanceRecovered: 0,
      durationDays: 90,
      startedAt: "2026-05-01T08:00:00Z",
      finalOn: "2026-09-01",
      today: "2026-09-27",
    })
    expect(s).toMatchObject({ earned: 1000, certified: 900, contractDays: 90, actualDays: 123, delayDays: 33 })
  })
})

describe("close and archive (WF-26)", () => {
  it("refused before final acceptance, and while the gate is shut", async () => {
    seedDone({ lifecycle: "live" })
    await expect(closeAndArchive(db, pm, "p1", pmA)).rejects.toMatchObject({ code: "not_done" })
    seedDone({ retentionHeld: 100 })
    await expect(closeAndArchive(db, pm, "p1", pmA)).rejects.toMatchObject({ code: "blocked", blocks: ["retention"] })
  })

  it("freezes the snapshot, and afterwards nothing changes — the owner included (INV-21)", async () => {
    seedDone()
    await closeAndArchive(db, pm, "p1", pmA)
    const p = readDoc<Record<string, any>>("projects/p1") as Record<string, any>
    expect(p.pm).toMatchObject({ lifecycle: "closed", closedBy: "pm1", fin: { contractValue: 1000, earned: 1000 } })
    const ownerA = { uid: "own", name: "Owner" }
    await expect(raisePunch(db, owner, "p1", ownerA, { what: "x", location: "y", severity: "b", source: "int" })).rejects.toMatchObject({ code: "archived" })
    await expect(writeSheet(db, owner, "p1", ownerA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 1 }] })).rejects.toMatchObject({ code: "archived" })
    await expect(draftAddendum(db, owner, "p1", ownerA, { next: { ...defaultTerms(), paymentDays: 45 }, reason: "client" })).rejects.toMatchObject({ code: "archived" })
    await expect(closeAndArchive(db, owner, "p1", ownerA)).rejects.toBeInstanceOf(Error)
  })

  it("an open punch item refuses closing through the gate", async () => {
    seedDone()
    seed("projects/p1/pmPunch/01", { seq: 1, status: "open", what: "x", location: "y" })
    await expect(closeAndArchive(db, pm, "p1", pmA)).rejects.toBeInstanceOf(PmCloseError)
  })
})
