/**
 * PM 1.0 — subcontractors (WF-11, WF-12, SC-01…03). A sub is never certified
 * beyond our own measurement; retention at his contract's rate; waste recovered
 * from his next certificate; approved by someone else within their limit, and
 * then prj:SC reaches Finance.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import {
  custodyFigures,
  lineCap,
  lineKey,
  moveBlocks,
  partyKey,
  pmApprovalLimit,
  recoveryAmount,
  recoveryDue,
  subApproveRefusal,
  subCertBlocks,
  subCertificateAmounts,
  subCertificateEvent,
  subCertificateLines,
  subcontractBlocks,
  subSummaries,
  type PmSubcontract,
  type PmSubCertificate,
  type PmSubCustody,
} from "@/lib/pm/subcontract"
import { approveSubCertificate, openCustody, PmSubError, prepareSubCertificate, recordCustodyMove, recordRecovery, registerSubcontract } from "@/lib/pm/subcontract-writes"

const db = fakeFirestore as unknown as Firestore
const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }

const contract = (over: Partial<PmSubcontract> = {}): PmSubcontract => ({
  id: "01",
  seq: 1,
  party: { name: "Al-Itqan" },
  partyKey: "n:al-itqan",
  retention: 0.1,
  startOn: "2026-09-01",
  endOn: null,
  note: null,
  lines: [{ itemId: "i1", code: "04-02-01", description: null, unit: "m2", qty: 1000, rate: 40, value: 40000, certified: 0.2 }],
  value: 40000,
  paid: 5000,
  by: "pm1",
  on: "2026-09-01",
  ...over,
})

describe("approval limits and parties", () => {
  it("owner unlimited · project manager 75,000 · everyone else none", () => {
    expect(pmApprovalLimit(owner.ceiling)).toBe(Number.POSITIVE_INFINITY)
    expect(pmApprovalLimit(pm.ceiling)).toBe(75000)
    expect(pmApprovalLimit(qs.ceiling)).toBe(0)
  })

  it("one party across contracts: the linked account, else the folded name", () => {
    expect(partyKey({ name: "  Al  Itqan " })).toBe(partyKey({ name: "al itqan" }))
    expect(partyKey({ name: "X", supplierId: "u9" })).toBe("s:u9")
  })
})

describe("registering a subcontract (SC-01)", () => {
  const base = { archived: false, partyName: "Al-Itqan", retentionPct: 10, startOn: "2026-09-01", endOn: null, limit: 75000 }
  it("needs a party, a priced line, free quantity, sane retention and dates, within the limit", () => {
    expect(subcontractBlocks({ ...base, lines: [{ itemId: "i1", qty: 100, rate: 40, free: 500 }] })).toEqual([])
    expect(subcontractBlocks({ ...base, partyName: " ", lines: [] })).toEqual(["no_party", "no_lines"])
    expect(subcontractBlocks({ ...base, lines: [{ itemId: "i1", qty: 600, rate: 40, free: 500 }] })).toEqual(["over_free"])
    expect(subcontractBlocks({ ...base, retentionPct: 25, endOn: "2026-08-01", lines: [{ itemId: "i1", qty: 1, rate: 1, free: null }] })).toEqual(["bad_retention", "bad_dates"])
    expect(subcontractBlocks({ ...base, lines: [{ itemId: "i1", qty: 2000, rate: 40, free: null }] })).toEqual(["over_limit"])
  })
})

describe("the certificate ceiling is OUR measurement (E-24)", () => {
  it("executed over the quantity let to subs on the line, at most 100%", () => {
    expect(lineCap({ executed: 400, itemQty: 1000, letQty: 1000 })).toBe(0.4)
    expect(lineCap({ executed: 400, itemQty: 1000, letQty: 500 })).toBe(0.8)
    expect(lineCap({ executed: 900, itemQty: 1000, letQty: 500 })).toBe(1)
    expect(lineCap({ executed: 0, itemQty: 0, letQty: 0 })).toBe(0)
  })

  it("a line typed beyond the cap or below what is certified blocks; blank is unchanged", () => {
    const c = contract()
    const k = lineKey(1, 0)
    const ok = subCertificateLines([c], { [k]: 35 }, { [k]: 0.4 })
    expect(ok.over).toEqual([])
    expect(ok.lines).toHaveLength(1)
    expect(ok.lines[0]).toMatchObject({ from: 0.2, to: 0.35, amount: 6000, retentionRate: 0.1 })
    expect(subCertificateLines([c], { [k]: 45 }, { [k]: 0.4 }).over).toEqual([k])
    expect(subCertificateLines([c], { [k]: 10 }, { [k]: 0.4 }).below).toEqual([k])
    expect(subCertificateLines([c], {}, { [k]: 0.4 }).lines).toEqual([])
  })

  it("retention at each contract's rate, recovery, net before VAT", () => {
    const a = subCertificateAmounts(
      [
        { amount: 6000, retentionRate: 0.1 },
        { amount: 4000, retentionRate: 0.05 },
      ],
      1500
    )
    expect(a).toEqual({ gross: 10000, retention: 800, recovery: 1500, net: 7700 })
  })

  it("zero, pending, over-measured all block", () => {
    expect(subCertBlocks({ archived: false, gross: 0, over: 1, below: 0, pending: true })).toEqual(["pending", "over_measured", "zero"])
    expect(subCertBlocks({ archived: false, gross: 10, over: 0, below: 0, pending: false })).toEqual([])
  })
})

describe("approval (SC-02)", () => {
  it("ipcOk, not the preparer, within the limit", () => {
    const base = { archived: false, ipcOk: true, actorUid: "pm1", prep: "qs1", amount: 50000, limit: 75000 }
    expect(subApproveRefusal(base)).toBeNull()
    expect(subApproveRefusal({ ...base, prep: "pm1" })).toBe("self_approval")
    expect(subApproveRefusal({ ...base, amount: 80000 })).toBe("over_limit")
    expect(subApproveRefusal({ ...base, ipcOk: false })).toBe("no_duty")
    expect(subApproveRefusal({ ...base, archived: true })).toBe("archived")
  })

  it("prj:SC carries the certificate's figures", () => {
    const e = subCertificateEvent({
      organizationId: "org",
      projectId: "p1",
      projectNo: "PJ-2026/003",
      cert: { seq: 4, party: { name: "Al-Itqan" }, gross: 10000, retention: 1000, recovery: 500, net: 8500, lines: [{ subcontractSeq: 2 } as PmSubCertificate["lines"][number]] },
      by: "pm1",
      at: "2026-09-28T00:00:00Z",
    })
    expect(e.key).toBe("prj:SC:PJ-2026/003:04")
    expect(e.kind).toBe("SC")
    expect(e.amount).toBe(10000)
    expect(e.params).toMatchObject({ certificate: "04", subcontractor: "Al-Itqan", contracts: "02", retention: 1000, recovery: 500, net: 8500 })
  })
})

describe("summary (E-23)", () => {
  it("per subcontractor across contracts: certified, paid, due, retention, progress", () => {
    const rows = subSummaries([contract(), contract({ id: "02", seq: 2, retention: 0.05, lines: [{ itemId: "i2", code: null, description: null, unit: null, qty: 10, rate: 1000, value: 10000, certified: 0.5 }], value: 10000, paid: 0 })])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ value: 50000, certified: 13000, paid: 5000, due: 8000, retention: 1050, contracts: [1, 2] })
    expect(rows[0].progress).toBeCloseTo(0.26)
  })
})

describe("custody reconciliation (E-25, STK-04)", () => {
  const c = {
    moves: [
      { t: "iss" as const, q: 1000, day: "2026-09-01", by: "se1" },
      { t: "back" as const, q: 50, day: "2026-09-10", by: "se1" },
      { t: "cnt" as const, q: 100, day: "2026-09-20", by: "se1" },
    ],
    perUnit: 12.5,
    waste: 4,
    executedAtStart: 10,
    unitCost: 3,
  }
  it("book = issued − returned − (theoretical + allowed); the gap to the count is his waste", () => {
    const f = custodyFigures(c, 70)
    expect(f).toMatchObject({ issued: 950, theoretical: 750, allowed: 30, book: 170, gap: 70, gapValue: 210 })
  })
  it("no count, no gap", () => {
    expect(custodyFigures({ ...c, moves: c.moves.slice(0, 1) }, 10).gap).toBeNull()
  })
  it("recovery doubles only when the contract says so; only undeducted ones are due", () => {
    expect(recoveryAmount(70, 3, false)).toBe(210)
    expect(recoveryAmount(70, 3, true)).toBe(420)
    const r = (amount: number, certSeq: number | null) => ({ q: 1, rate: amount, double: false, amount, day: "2026-09-20", by: "u", certSeq })
    expect(recoveryDue([{ partyKey: "a", recoveries: [r(100, null), r(50, 2)] }, { partyKey: "b", recoveries: [r(10, null)] }], "a")).toBe(100)
  })
  it("a return never exceeds what he holds; a count may be zero; never dated ahead", () => {
    expect(moveBlocks({ archived: false, kind: "back", q: 60, issued: 50, day: "2026-09-01", today: "2026-09-28" })).toEqual(["over_return"])
    expect(moveBlocks({ archived: false, kind: "cnt", q: 0, issued: 50, day: "2026-09-01", today: "2026-09-28" })).toEqual([])
    expect(moveBlocks({ archived: false, kind: "iss", q: 0, issued: 0, day: "2026-10-01", today: "2026-09-28" })).toEqual(["bad_qty", "future"])
  })
})

describe("the writes", () => {
  beforeEach(() => {
    resetFakeDb()
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live" } })
    seed("projects/p1/boqItems/i1", { itemNo: "04-02-01", quantity: 1000, unitPrice: 55, executedQuantity: 400, descriptionAr: "لياسة", unit: "م2" })
  })

  const register = (ctx: PmContext, uid: string, qty = 1000, rate = 40) =>
    registerSubcontract(db, ctx, "p1", { uid, name: uid }, { party: { name: "Al-Itqan" }, retentionPct: 10, startOn: "2026-09-01", endOn: null, note: null, lines: [{ itemId: "i1", qty, rate }] })

  it("registers within the limit, numbers it, and refuses one above it or over the free quantity", async () => {
    expect(await register(pm, "pm1")).toBe(1)
    const c = readDoc<PmSubcontract>("projects/p1/pmSubcontracts/01")!
    expect(c).toMatchObject({ value: 40000, retention: 0.1, partyKey: "n:al-itqan" })
    expect(readDoc<{ pm: { subcontractCount: number } }>("projects/p1")!.pm.subcontractCount).toBe(1)
    await expect(register(pm, "pm1", 10)).rejects.toMatchObject({ blocks: ["over_free"] })
    await expect(register(qs, "qs1")).rejects.toBeInstanceOf(PmSubError)
    await expect(register(site, "se1")).rejects.toBeInstanceOf(PmAccessError)
  })

  it("prepares capped at our measurement, deducts recoveries once, and approval sends prj:SC", async () => {
    await register(owner, "own")
    await openCustody(db, pm, "p1", { uid: "pm1", name: "PM" }, { subcontractSeq: 1, itemId: "i1", material: "Block", unit: "pc", unitCost: 3, perUnit: 12.5, waste: 4, issueQty: 6000, day: todayDay(), note: null })
    await recordCustodyMove(db, pm, "p1", { uid: "pm1", name: "PM" }, 1, { t: "cnt", q: 5800, day: todayDay(), note: null })
    // Counting and recovering are the approver's (the prototype's CAN('approve')), not the QS's or the site's.
    await expect(recordRecovery(db, qs, "p1", { uid: "qs1", name: "QS" }, 1, { q: 100, rate: 3, double: false, note: null })).rejects.toBeInstanceOf(PmAccessError)
    await expect(recordCustodyMove(db, site, "p1", { uid: "se1", name: "SE" }, 1, { t: "cnt", q: 5800, day: todayDay(), note: null })).rejects.toBeInstanceOf(PmAccessError)
    const amt = await recordRecovery(db, pm, "p1", { uid: "pm1", name: "PM" }, 1, { q: 100, rate: 3, double: false, note: null })
    expect(amt).toBe(300)

    const k = lineKey(1, 0)
    await expect(prepareSubCertificate(db, qs, "p1", { uid: "qs1", name: "QS" }, { partyKey: "n:al-itqan", percents: { [k]: 45 } })).rejects.toMatchObject({ blocks: ["over_measured"] })
    const r = await prepareSubCertificate(db, qs, "p1", { uid: "qs1", name: "QS" }, { partyKey: "n:al-itqan", percents: { [k]: 40 } })
    expect(r).toEqual({ seq: 1, gross: 16000, recovery: 300 })
    const cert = readDoc<PmSubCertificate>("projects/p1/pmSubCertificates/01")!
    expect(cert).toMatchObject({ status: "int", gross: 16000, retention: 1600, recovery: 300, net: 14100 })
    expect(readDoc<PmSubCustody>("projects/p1/pmSubCustody/01")!.recoveries[0].certSeq).toBe(1)

    await expect(approveSubCertificate(db, qs, "p1", { uid: "qs1", name: "QS" }, 1)).rejects.toBeInstanceOf(PmAccessError)
    await approveSubCertificate(db, pm, "p1", { uid: "pm1", name: "PM" }, 1)
    expect(readDoc<PmSubCertificate>("projects/p1/pmSubCertificates/01")!.status).toBe("ok")
    expect(readDoc<PmSubcontract>("projects/p1/pmSubcontracts/01")!.lines[0].certified).toBeCloseTo(0.4)
    expect(readDoc<{ kind: string; amount: number }>("pmEvents/prj:SC:PJ-2026_003:01")).toMatchObject({ kind: "SC", amount: 16000 })
  })

  it("the preparer never approves; above the limit only the owner does", async () => {
    await register(owner, "own", 1000, 100)
    seed("projects/p1/boqItems/i1", { itemNo: "04-02-01", quantity: 1000, unitPrice: 55, executedQuantity: 1000 })
    const k = lineKey(1, 0)
    await prepareSubCertificate(db, pm, "p1", { uid: "pm1", name: "PM" }, { partyKey: "n:al-itqan", percents: { [k]: 100 } })
    await expect(approveSubCertificate(db, pm, "p1", { uid: "pm1", name: "PM" }, 1)).rejects.toMatchObject({ code: "self_approval" })
    const pm2: PmContext = { ...pm, seat: { uid: "pm2", role: "pm" } }
    seed("projects/p1/pmSubCertificates/01", { ...readDoc<PmSubCertificate>("projects/p1/pmSubCertificates/01")!, prep: "qs1" })
    await expect(approveSubCertificate(db, pm2, "p1", { uid: "pm2", name: "PM2" }, 1)).rejects.toMatchObject({ blocks: ["over_limit"] })
    await approveSubCertificate(db, owner, "p1", { uid: "own", name: "Owner" }, 1)
    expect(readDoc<PmSubCertificate>("projects/p1/pmSubCertificates/01")!.status).toBe("ok")
  })

  it("a second certificate waits until the first is approved", async () => {
    await register(owner, "own")
    const k = lineKey(1, 0)
    await prepareSubCertificate(db, qs, "p1", { uid: "qs1", name: "QS" }, { partyKey: "n:al-itqan", percents: { [k]: 20 } })
    await expect(prepareSubCertificate(db, qs, "p1", { uid: "qs1", name: "QS" }, { partyKey: "n:al-itqan", percents: { [k]: 30 } })).rejects.toMatchObject({ blocks: ["pending"] })
  })
})
