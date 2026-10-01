/**
 * PM 1.0 — subcontractor certificates (SC-01…04, INV-05): a certificate never
 * takes more recovery than it can bear, a prepared one can be withdrawn before
 * approval, a one-person company approves what it prepared (recorded), and the
 * quantity let on a BOQ line is checked against the contracts the transaction
 * itself read.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, firestoreModule, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import type { PmStoreLine } from "@/lib/pm/store"
import {
  fitRecoveries,
  lineKey,
  recoveryRoom,
  stampRecoveries,
  subApproveRefusal,
  subCertificateAmounts,
  subWithdrawRefusal,
  unstampRecoveries,
  type PmSubcontract,
  type PmSubCertificate,
  type PmSubCustody,
} from "@/lib/pm/subcontract"
import { approveSubCertificate, openCustody, prepareSubCertificate, recordCustodyMove, recordRecovery, registerSubcontract, withdrawSubCertificate } from "@/lib/pm/subcontract-writes"

const db = fakeFirestore as unknown as Firestore
const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const pmA = { uid: "pm1", name: "PM" }
const qsA = { uid: "qs1", name: "QS" }
const ownA = { uid: "own", name: "Owner" }
const KEY = "n:al-itqan"
const k = lineKey(1, 0)

describe("what a certificate can bear (SC-03, INV-05)", () => {
  const lines = [{ amount: 10000, retentionRate: 0.1 }]

  it("takes recovery up to work less retention — the net is never negative", () => {
    expect(recoveryRoom(lines)).toBe(9000)
    expect(subCertificateAmounts(lines, 9500)).toEqual({ gross: 10000, retention: 1000, recovery: 9000, net: 0 })
    expect(subCertificateAmounts(lines, 20000)).toEqual({ gross: 10000, retention: 1000, recovery: 9000, net: 0 })
    expect(subCertificateAmounts(lines, 1500)).toEqual({ gross: 10000, retention: 1000, recovery: 1500, net: 7500 })
  })

  it("fits the recoveries in order; the one that straddles the room is cut, the rest wait", () => {
    const due = [
      { custodySeq: 1, index: 0, amount: 4000 },
      { custodySeq: 0, storeId: "m1", index: 2, amount: 7000 },
      { custodySeq: 0, storeId: "m2", index: 0, amount: 500 },
    ]
    const fit = fitRecoveries(due, 9000)
    expect(fit.taken).toEqual([
      { custodySeq: 1, index: 0, amount: 4000, rest: 0 },
      { custodySeq: 0, storeId: "m1", index: 2, amount: 5000, rest: 2000 },
    ])
    expect(fit.carried).toBe(2500)
    expect(fitRecoveries(due, 0)).toEqual({ taken: [], carried: 11500 })
  })

  it("stamps what was taken, leaves the remainder awaiting, and a withdrawal frees it again", () => {
    const r = (amount: number, certSeq: number | null) => ({ q: amount / 10, rate: 10, double: false, amount, day: "2026-09-20", by: "u", certSeq })
    const stamped = stampRecoveries([r(300, 2), r(7000, null)], [{ index: 1, amount: 5000, rest: 2000 }], 5)
    expect(stamped.map((x) => [x.amount, x.certSeq, x.q])).toEqual([
      [300, 2, 30],
      [5000, 5, 500],
      [2000, null, 200],
    ])
    expect(unstampRecoveries(stamped, 5).map((x) => [x.amount, x.certSeq])).toEqual([
      [300, 2],
      [5000, null],
      [2000, null],
    ])
  })
})

describe("who may approve and who may withdraw (SC-02)", () => {
  it("the preparer approves only under the company's recorded self-approval — still within the limit", () => {
    const base = { archived: false, ipcOk: true, actorUid: "own", prep: "own", amount: 50000, limit: Number.POSITIVE_INFINITY }
    expect(subApproveRefusal(base)).toBe("self_approval")
    expect(subApproveRefusal({ ...base, selfApproval: true })).toBeNull()
    expect(subApproveRefusal({ ...base, selfApproval: true, limit: 10000 })).toBe("over_limit")
    expect(subApproveRefusal({ ...base, selfApproval: true, ipcOk: false })).toBe("no_duty")
  })

  it("before approval only: its preparer, or whoever approves certificates", () => {
    const base = { archived: false, status: "int" as const, actorUid: "qs1", prep: "qs1", sub: true, ipcOk: false }
    expect(subWithdrawRefusal(base)).toBeNull()
    expect(subWithdrawRefusal({ ...base, actorUid: "pm1", sub: true, ipcOk: true })).toBeNull()
    expect(subWithdrawRefusal({ ...base, actorUid: "qs2" })).toBe("no_duty")
    expect(subWithdrawRefusal({ ...base, status: "ok" })).toBe("wrong_state")
    expect(subWithdrawRefusal({ ...base, status: "void" })).toBe("wrong_state")
    expect(subWithdrawRefusal({ ...base, archived: true })).toBe("archived")
  })
})

describe("the writes", () => {
  beforeEach(() => {
    resetFakeDb()
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live" } })
    // 1,000 m² let at 40 with 10% retention; 250 measured → 25% = 10,000 of work.
    seed("projects/p1/boqItems/i1", { itemNo: "04-02-01", quantity: 1000, unitPrice: 55, executedQuantity: 250, descriptionAr: "لياسة", unit: "م2" })
  })

  const register = (ctx: PmContext, uid: string, qty = 1000, rate = 40) =>
    registerSubcontract(db, ctx, "p1", { uid, name: uid }, { party: { name: "Al-Itqan" }, retentionPct: 10, startOn: "2026-09-01", endOn: null, note: null, lines: [{ itemId: "i1", qty, rate }] })

  /** A count 4,000 short on a legacy custody line, recovered at 5 a unit = 20,000. */
  const wasteOf = async (q: number, rate: number) => {
    await openCustody(db, pm, "p1", pmA, { subcontractSeq: 1, itemId: "i1", material: "Block", unit: "pc", unitCost: rate, perUnit: 12.5, waste: 4, issueQty: 10000, day: todayDay(), note: null })
    await recordCustodyMove(db, pm, "p1", pmA, 1, { t: "cnt", q: 10000 - q, day: todayDay(), note: null })
    return recordRecovery(db, pm, "p1", pmA, 1, { q, rate, double: false, note: null })
  }

  it("a recovery larger than the certificate can bear is taken in part — the rest stays for his next one", async () => {
    await register(owner, "own")
    expect(await wasteOf(4000, 5)).toBe(20000)

    const r = await prepareSubCertificate(db, qs, "p1", qsA, { partyKey: KEY, percents: { [k]: 25 } })
    expect(r).toEqual({ seq: 1, gross: 10000, recovery: 9000 })
    const cert = readDoc<PmSubCertificate>("projects/p1/pmSubCertificates/01")!
    expect(cert).toMatchObject({ gross: 10000, retention: 1000, recovery: 9000, net: 0 })
    expect(cert.recoveries).toEqual([{ custodySeq: 1, index: 0, amount: 9000 }])
    const recs = readDoc<PmSubCustody>("projects/p1/pmSubCustody/01")!.recoveries
    expect(recs.map((x) => [x.amount, x.certSeq])).toEqual([
      [9000, 1],
      [11000, null],
    ])
    expect(recs.reduce((a, x) => a + x.q, 0)).toBeCloseTo(4000)

    // Finance is sent a net of zero, never a negative one.
    await approveSubCertificate(db, pm, "p1", pmA, 1)
    expect(readDoc<{ params: { net: number; recovery: number } }>("pmEvents/org__prj:SC:PJ-2026_003:01")!.params).toMatchObject({ net: 0, recovery: 9000 })

    // The next certificate takes what was left, again only what it can bear.
    seed("projects/p1/boqItems/i1", { itemNo: "04-02-01", quantity: 1000, unitPrice: 55, executedQuantity: 300 })
    const next = await prepareSubCertificate(db, qs, "p1", qsA, { partyKey: KEY, percents: { [k]: 30 } })
    expect(next).toEqual({ seq: 2, gross: 2000, recovery: 1800 })
    expect(readDoc<PmSubCustody>("projects/p1/pmSubCustody/01")!.recoveries.map((x) => [x.amount, x.certSeq])).toEqual([
      [9000, 1],
      [1800, 2],
      [9200, null],
    ])
  })

  it("a recovery on the store ledger is cut the same way", async () => {
    await register(owner, "own")
    const rec = { sub: KEY, subName: "Al-Itqan", q: 950, rate: 10, double: false, amount: 9500, on: todayDay(), by: "pm1", certSeq: null }
    seed("projects/p1/pmStore/m1", { key: "block|pc", name: "Block", unit: "pc", rates: {}, moves: [], recoveries: [rec] })
    await prepareSubCertificate(db, qs, "p1", qsA, { partyKey: KEY, percents: { [k]: 25 } })
    expect(readDoc<PmSubCertificate>("projects/p1/pmSubCertificates/01")).toMatchObject({ recovery: 9000, net: 0, recoveries: [{ custodySeq: 0, storeId: "m1", index: 0, amount: 9000 }] })
    expect(readDoc<PmStoreLine>("projects/p1/pmStore/m1")!.recoveries!.map((x) => [x.amount, x.certSeq])).toEqual([
      [9000, 1],
      [500, null],
    ])
  })

  it("a prepared certificate is withdrawn before approval: void, its recoveries free again, the number never reused", async () => {
    await register(owner, "own")
    await wasteOf(100, 3)
    await prepareSubCertificate(db, qs, "p1", qsA, { partyKey: KEY, percents: { [k]: 20 } })
    expect(readDoc<PmSubCustody>("projects/p1/pmSubCustody/01")!.recoveries[0].certSeq).toBe(1)

    // The site engineer holds neither duty; the QS who prepared it does.
    await expect(withdrawSubCertificate(db, site, "p1", { uid: "se1", name: "SE" }, 1)).rejects.toBeInstanceOf(PmAccessError)
    const qs2: PmContext = { ...qs, seat: { uid: "qs2", role: "qs" } }
    await expect(withdrawSubCertificate(db, qs2, "p1", { uid: "qs2", name: "QS2" }, 1)).rejects.toMatchObject({ code: "no_duty" })
    await withdrawSubCertificate(db, qs, "p1", qsA, 1)

    expect(readDoc<PmSubCertificate>("projects/p1/pmSubCertificates/01")).toMatchObject({ status: "void", voidBy: "qs1", voidByName: "QS", voidOn: todayDay() })
    expect(readDoc<PmSubCustody>("projects/p1/pmSubCustody/01")!.recoveries[0].certSeq).toBeNull()
    expect(readDoc<PmSubcontract>("projects/p1/pmSubcontracts/01")!.lines[0].certified).toBe(0)
    expect(readDoc("pmEvents/org__prj:SC:PJ-2026_003:01")).toBeNull()

    // Withdrawn is terminal, and the subcontractor is free for a new certificate — numbered 02.
    await expect(withdrawSubCertificate(db, qs, "p1", qsA, 1)).rejects.toMatchObject({ code: "wrong_state" })
    await expect(approveSubCertificate(db, pm, "p1", pmA, 1)).rejects.toMatchObject({ code: "wrong_state" })
    const again = await prepareSubCertificate(db, qs, "p1", qsA, { partyKey: KEY, percents: { [k]: 25 } })
    expect(again).toEqual({ seq: 2, gross: 10000, recovery: 300 })
    expect(readDoc<PmSubCustody>("projects/p1/pmSubCustody/01")!.recoveries[0].certSeq).toBe(2)
  })

  it("whoever approves certificates withdraws someone else's; an approved one is never withdrawn", async () => {
    await register(owner, "own")
    await prepareSubCertificate(db, qs, "p1", qsA, { partyKey: KEY, percents: { [k]: 10 } })
    await withdrawSubCertificate(db, pm, "p1", pmA, 1)
    expect(readDoc<PmSubCertificate>("projects/p1/pmSubCertificates/01")!.status).toBe("void")

    await prepareSubCertificate(db, qs, "p1", qsA, { partyKey: KEY, percents: { [k]: 10 } })
    await approveSubCertificate(db, pm, "p1", pmA, 2)
    await expect(withdrawSubCertificate(db, pm, "p1", pmA, 2)).rejects.toMatchObject({ code: "wrong_state" })
  })

  it("a one-person company approves what it prepared — only under the recorded setting, and it is recorded", async () => {
    await register(owner, "own")
    await prepareSubCertificate(db, owner, "p1", ownA, { partyKey: KEY, percents: { [k]: 25 } })
    await expect(approveSubCertificate(db, owner, "p1", ownA, 1)).rejects.toMatchObject({ code: "self_approval" })

    seed("pmSettings/org", { organizationId: "org", selfApproval: true })
    await approveSubCertificate(db, owner, "p1", ownA, 1)
    expect(readDoc<PmSubCertificate>("projects/p1/pmSubCertificates/01")).toMatchObject({ status: "ok", appr: "own", apprName: "Owner", selfApp: true })
    expect(readDoc<{ kind: string }>("pmEvents/org__prj:SC:PJ-2026_003:01")).toMatchObject({ kind: "SC" })
  })

  it("someone else's approval is not marked as a self-approval", async () => {
    await register(owner, "own")
    seed("pmSettings/org", { organizationId: "org", selfApproval: true })
    await prepareSubCertificate(db, qs, "p1", qsA, { partyKey: KEY, percents: { [k]: 25 } })
    await approveSubCertificate(db, pm, "p1", pmA, 1)
    expect(readDoc<PmSubCertificate>("projects/p1/pmSubCertificates/01")!.selfApp).toBe(false)
  })

  it("the free quantity of a line is read inside the registration, not from a list fetched before it", async () => {
    await register(owner, "own", 1000)
    // The list fetched outside the transaction is stale: it missed contract 01.
    const stale = jest.spyOn(firestoreModule, "getDocs").mockImplementation(async () => ({ docs: [], empty: true, size: 0, forEach: () => undefined }) as never)
    try {
      await expect(register(owner, "own", 500)).rejects.toMatchObject({ blocks: ["over_free"] })
    } finally {
      stale.mockRestore()
    }
    expect(readDoc<{ pm: { subcontractCount: number } }>("projects/p1")!.pm.subcontractCount).toBe(1)
  })
})
