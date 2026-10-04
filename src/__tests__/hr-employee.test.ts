/**
 * HR 1.0 — the employee record (EM-02…06, DC-02, DC-03, AS-01, RL-02/03).
 * A permanent number; pay kept apart and written only by those who may see
 * it; the new-employee blocks; an expired iqama never placed on a site; pay
 * changes with a date (one closed month back, via the supplementary payroll)
 * and never one's own; probation 90 → 180 with consent; a passport renewed
 * before the iqama; every event in an undeletable log.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import { assignBlocks, newEmployeeBlocks, payChangeBlocks, probationBlocks, probationEnd, renewalBlocks, type EmployeePay, type HrEmployee } from "@/lib/hr/employee"
import { assignEmployee, changePay, createEmployee, decideProbation, recordRenewal } from "@/lib/hr/employee-writes"
import { HrWriteError } from "@/lib/hr/write-guard"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const manager = ctx(["manager"], { uid: "hrm", employeeId: "hrm-emp" })
const gov = ctx(["gov"], { uid: "gro" })
const payroll = ctx(["payroll"], { uid: "pay" })
const actor = { uid: "hrm", name: "Sara" }
const today = new Date().toISOString().slice(0, 10)
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

const base = {
  source: "local" as const,
  nameAr: "أحمد",
  nameEn: "Ahmed",
  nationality: "bd",
  gender: "m" as const,
  idNo: "2123456789",
  trade: "mason",
  siteId: "s1",
  join: "2026-01-10",
  contractType: "open" as const,
  basic: 2_200,
  docs: { iqama: plusDays(300), passport: plusDays(900) },
}

const emp = (id: string) => readDoc<HrEmployee>(`employees/${id}`) as HrEmployee
const pay = (id: string) => readDoc<EmployeePay>(`employeePay/${id}`) as EmployeePay
const logOf = (id: string) => listCollection<{ kind: string; by: string }>(`employees/${id}/log`)

beforeEach(() => resetFakeDb())

describe("the pure rules", () => {
  it("new employee: no visas, Saudi-only trades, an expired iqama on a site, a fixed contract with no end", () => {
    expect(newEmployeeBlocks({ ...base, source: "visa" }, { visas: 0, today }).blocks).toEqual(["no_visas"])
    expect(newEmployeeBlocks({ ...base, trade: "security" }, { visas: 5, today }).blocks).toEqual(["saudi_only"])
    expect(newEmployeeBlocks({ ...base, docs: { iqama: plusDays(-1) } }, { visas: 5, today }).blocks).toEqual(["iqama_expired_site"])
    expect(newEmployeeBlocks({ ...base, docs: { iqama: plusDays(-1) }, siteId: null }, { visas: 5, today }).blocks).toEqual([])
    expect(newEmployeeBlocks({ ...base, contractType: "fixed" }, { visas: 5, today }).blocks).toEqual(["fixed_needs_end"])
    expect(newEmployeeBlocks({ ...base, nationality: "sa", basic: 3_500 }, { visas: 5, today }).warnings).toEqual(["saudi_below_nitaqat"])
    expect(newEmployeeBlocks({ ...base, basic: null }, { visas: 5, today }).warnings).toEqual(["no_basic"])
  })

  it("an expired iqama may go to unassigned, not to a site (DC-02)", () => {
    const e = { nationality: "bd", docs: { iqama: plusDays(-3) }, siteId: "s1", status: "active" as const }
    expect(assignBlocks(e, "s2", today, today)).toEqual(["iqama_expired"])
    expect(assignBlocks(e, null, today, today)).toEqual([])
    expect(assignBlocks(e, "s1", today, today)).toEqual(["same_place", "iqama_expired"])
  })

  it("pay change: a reason and a date, at most one closed month back; a cut warns", () => {
    const x = { basic: 2_000, currentBasic: 2_200, effectiveOn: "2026-08-15", reason: "", nationality: "bd", lastClosedMonthStart: "2026-08-01" }
    expect(payChangeBlocks(x).blocks).toEqual(["no_reason"])
    expect(payChangeBlocks({ ...x, reason: "x" }).warnings).toEqual(["pay_cut"])
    expect(payChangeBlocks({ ...x, reason: "x", effectiveOn: "2026-07-31" }).blocks).toEqual(["too_old"])
  })

  it("probation 90 days, extended only with consent and to 180 at most", () => {
    const e = { join: "2026-01-01", probation: { end: probationEnd("2026-01-01") } }
    expect(e.probation.end).toBe("2026-03-31")
    expect(probationBlocks(e, "extend", { to: "2026-06-29" })).toEqual(["extend_needs_consent"])
    expect(probationBlocks(e, "extend", { to: "2026-07-15", consentOn: "2026-03-20" })).toEqual(["extend_too_long"])
    expect(probationBlocks(e, "extend", { to: "2026-06-29", consentOn: "2026-03-20" })).toEqual([])
  })

  it("the passport before the iqama (DC-03)", () => {
    const docs = { passport: plusDays(40), iqama: plusDays(90) }
    expect(renewalBlocks(docs, "iqama", plusDays(455), today)).toEqual(["passport_first"])
    expect(renewalBlocks(docs, "passport", plusDays(1_800), today)).toEqual([])
    expect(renewalBlocks(docs, "passport", plusDays(10), today)).toEqual(["not_later"])
  })
})

describe("the writes", () => {
  it("the number is permanent and never reused; pay is kept apart; the log records it", async () => {
    const a = await createEmployee(db, manager, ORG, actor, base, { visas: 3 })
    const b = await createEmployee(db, manager, ORG, actor, { ...base, nameAr: "علي" }, { visas: 3 })
    expect([a.no, b.no]).toEqual([1, 2])
    expect(emp(a.id)).toMatchObject({ no: 1, status: "active", siteId: "s1", category: "labour", probation: { end: probationEnd("2026-01-10") } })
    expect(emp(a.id)).not.toHaveProperty("salary")
    expect(pay(a.id)).toMatchObject({ basic: 2_200, housing: 550, transport: 220 })
    expect(logOf(a.id).map((l) => l.kind)).toEqual(["created"])
    expect(readDoc(`hrCounters/${ORG}`)).toMatchObject({ lastEmployeeNo: 2 })
  })

  it("government relations records a joiner without pay; payroll cannot create one", async () => {
    const g = await createEmployee(db, gov, ORG, { uid: "gro", name: "Majed" }, base, { visas: 3 })
    expect(readDoc(`employeePay/${g.id}`)).toBeNull()
    await expect(createEmployee(db, payroll, ORG, actor, base, { visas: 3 })).rejects.toBeInstanceOf(HrWriteError)
  })

  it("a visa arrival uses one visa of the establishment file; the last one cannot be spent twice", async () => {
    seed(`hrSettings/${ORG}`, { organizationId: ORG, establishment: { visas: 1 } })
    await createEmployee(db, gov, ORG, { uid: "gro", name: "Majed" }, { ...base, source: "visa" }, { visas: 1 })
    expect(readDoc(`hrSettings/${ORG}`)).toMatchObject({ establishment: { visas: 0 } })
    // The screen still thinks one is left — the write reads the file again.
    await expect(createEmployee(db, gov, ORG, { uid: "gro", name: "Majed" }, { ...base, source: "visa" }, { visas: 1 })).rejects.toMatchObject({ blocks: ["no_visas"] })
  })

  it("the log names a pay change and its day, never the amounts (RL-03)", async () => {
    const { id } = await createEmployee(db, manager, ORG, actor, base, { visas: 3 })
    await changePay(db, manager, id, actor, { basic: 2_600, effectiveOn: today, reason: "annual", kind: "raise" })
    const entry = logOf(id).find((l) => l.kind === "pay_changed") as unknown as { params: Record<string, unknown> }
    expect(entry.params).toEqual({ on: today, reason: "annual", trade: null })
  })

  it("an expired iqama is refused a site, then moved to unassigned with history", async () => {
    const { id } = await createEmployee(db, manager, ORG, actor, { ...base, siteId: null }, { visas: 3 })
    seed(`employees/${id}`, { ...emp(id), docs: { iqama: plusDays(-2) } })
    await expect(assignEmployee(db, manager, id, actor, { siteId: "s2", effectiveOn: today })).rejects.toMatchObject({ blocks: ["iqama_expired"] })
    seed(`employees/${id}`, { ...emp(id), docs: { iqama: plusDays(200) } })
    await assignEmployee(db, manager, id, actor, { siteId: "s2", effectiveOn: today })
    expect(emp(id).siteId).toBe("s2")
    expect(logOf(id).map((l) => l.kind)).toEqual(["created", "moved"])
  })

  it("a pay change inside the last closed month adds a retro item; one's own is refused", async () => {
    const { id } = await createEmployee(db, manager, ORG, actor, base, { visas: 3 })
    // August's payroll is approved — the write finds it closed by itself.
    seed(`hrPayrolls/${ORG}__2026-08`, { organizationId: ORG, month: "2026-08", key: "2026-08", kind: "main", state: "approved", lines: [{ employeeId: id }] })
    const r = await changePay(db, manager, id, actor, { basic: 2_600, effectiveOn: "2026-08-17", reason: "Promotion to foreman", kind: "raise" }, { today: "2026-09-10" })
    // wage 2,970 → 3,510 (+540); 15 days of August → 540/30 × 15 = 270
    expect(r.retro).toBe(270)
    expect(pay(id)).toMatchObject({ basic: 2_600, housing: 650, transport: 260, retro: [{ month: "2026-08", amount: 270 }] })
    const self = ctx(["manager"], { uid: "hrm", employeeId: id })
    await expect(changePay(db, self, id, actor, { basic: 3_000, effectiveOn: today, reason: "x", kind: "raise" })).rejects.toMatchObject({ code: "own_request" })
  })

  it("probation extended with consent; a renewal is logged; payroll cannot renew documents", async () => {
    const { id } = await createEmployee(db, manager, ORG, actor, { ...base, join: "2026-01-01" }, { visas: 3 })
    await decideProbation(db, manager, id, actor, "extend", { to: "2026-06-29", consentOn: "2026-03-20" }, { today: "2026-03-25" })
    expect(emp(id).probation).toMatchObject({ end: "2026-06-29", consentOn: "2026-03-20" })
    await recordRenewal(db, gov, id, { uid: "gro", name: "Majed" }, { type: "passport", expiry: plusDays(1_800), fee: 300 })
    expect(emp(id).docs.passport).toBe(plusDays(1_800))
    await expect(recordRenewal(db, payroll, id, actor, { type: "iqama", expiry: plusDays(700) })).rejects.toBeInstanceOf(HrWriteError)
    expect(logOf(id).map((l) => l.kind)).toEqual(["created", "probation_extend", "renewed"])
  })
})
