/**
 * PM 1.0 — the certificate chain (IPC-01…03, RET-01, WF-05, INV-02…04; AC-08,
 * AC-09). Built from approved executed work not yet billed, never zero; §8.6
 * with the retention cap applied (a rate above the cap allowed); QS prepares,
 * someone else approves internally; the consultant certifies full or with a
 * deduction — recomputed, the deduction back to unbilled — and Finance hears the
 * certified amount once. The held retention feeds the addendum cap check.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { draftAddendum } from "@/lib/pm/addendum-writes"
import { certificateAmounts, certificateLines, certifyBlocks, dueDate, prepareBlocks, unbilledValue, type BillableItem } from "@/lib/pm/certificate"
import { approveCertificate, certifyCertificate, PmCertificateError, prepareCertificate, withdrawCertificate, type PmCertificate } from "@/lib/pm/certificate-writes"
import { PM_EVENTS } from "@/lib/pm/events"
import { approveSheet, writeSheet } from "@/lib/pm/measurement-writes"
import { defaultTerms, type ContractTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const qsA = { uid: "qs1", name: "Huda" }
const pmA = { uid: "pm1", name: "Abdullah" }
const seA = { uid: "se1", name: "Omar" }

const fidic: ContractTerms = { ...defaultTerms({ advance: 0.1, retention: 0.1 }), retentionCap: 0.05 }

function seedProject(terms: ContractTerms = fidic, value = 1_000_000) {
  seed("projects/p1", { organizationId: "org", budget: value, projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/009", lifecycle: "live", terms, original: terms } })
  seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: "1000", unitPrice: "500", executedQuantity: 0 })
  seed("projects/p1/boqItems/i2", { itemNo: "09-02-01", quantity: "200", unitPrice: "", executedQuantity: 0 })
}
async function measure(itemId: string, qty: number) {
  const r = await writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId, qty }] })
  await approveSheet(db, pm, "p1", pmA, r.seq)
}
const cert = (n: string) => readDoc<PmCertificate>(`projects/p1/pmCertificates/${n}`) as PmCertificate
const pmBlock = () => (readDoc<Record<string, any>>("projects/p1") as Record<string, any>).pm

beforeEach(() => resetFakeDb())

describe("§8.6 — the formula", () => {
  it("10% retention up to a 5% cap stops at the cap (RET-01, AC-08)", () => {
    const a = certificateAmounts({ gross: 600_000, terms: fidic, contractValue: 1_000_000, held: 30_000, recovered: 0 })
    expect(a.retention).toBe(20_000)
    const b = certificateAmounts({ gross: 100_000, terms: fidic, contractValue: 1_000_000, held: 50_000, recovered: 0 })
    expect(b.retention).toBe(0)
  })

  it("net = G − recovery − retention + VAT on (G − recovery) (INV-02)", () => {
    const a = certificateAmounts({ gross: 200_000, terms: fidic, contractValue: 1_000_000, held: 0, recovered: 0 })
    expect(a).toEqual({ gross: 200_000, recovery: 20_000, retention: 20_000, vat: 27_000, net: 187_000 })
  })

  it("the advance is never over-recovered (INV-04)", () => {
    expect(certificateAmounts({ gross: 500_000, terms: fidic, contractValue: 1_000_000, held: 0, recovered: 90_000 }).recovery).toBe(10_000)
  })

  it("only priced unbilled work is billed (CON-02); zero is refused; nobody-pays has none", () => {
    const items: BillableItem[] = [
      { id: "i1", rate: 500, executed: 10, billed: 4 },
      { id: "i2", rate: 0, executed: 50, billed: 0 },
    ]
    expect(unbilledValue(items[0])).toBe(3000)
    expect(certificateLines(items, new Set(["i1", "i2"]))).toEqual([{ itemId: "i1", code: null, qty: 6, rate: 500, amount: 3000 }])
    expect(prepareBlocks({ archived: false, lifecycle: "live", payer: "owner", gross: 0 })).toEqual(["zero"])
    expect(prepareBlocks({ archived: false, lifecycle: "live", payer: "none", gross: 10 })).toEqual(["no_client"])
  })

  it("the consultant certifies up to the submitted gross, a deduction with its reason", () => {
    expect(certifyBlocks({ status: "sub", gross: 100, certified: 101 })).toEqual(["over_gross"])
    expect(certifyBlocks({ status: "sub", gross: 100, certified: 90 })).toEqual(["cut_reason"])
    expect(certifyBlocks({ status: "int", gross: 100, certified: 100 })).toEqual(["not_submitted"])
    expect(dueDate("2026-09-27", 30)).toBe("2026-10-27")
  })
})

describe("the chain (WF-05, AC-09)", () => {
  it("measure → approve → certificate → internal approval by another → certification → one event at the certified amount", async () => {
    seedProject()
    await measure("i1", 400)
    await measure("i2", 20)
    const { seq, amounts } = await prepareCertificate(db, qs, "p1", qsA, { itemIds: ["i1", "i2"] })
    expect(amounts).toMatchObject({ gross: 200_000, recovery: 20_000, retention: 20_000, net: 187_000 })
    expect(cert("01")).toMatchObject({ status: "int", prep: "qs1", lines: [{ itemId: "i1", qty: 400 }] })
    expect(readDoc<Record<string, any>>("projects/p1/boqItems/i1")!.billedQuantity).toBe(400)
    expect(pmBlock()).toMatchObject({ ipcCount: 1, retentionHeld: 20_000, advanceRecovered: 20_000 })

    await expect(approveCertificate(db, qs, "p1", qsA, seq)).rejects.toBeInstanceOf(PmAccessError)
    await approveCertificate(db, pm, "p1", pmA, seq)
    expect(cert("01")).toMatchObject({ status: "sub", appr: "pm1", selfApp: false })

    const certified = await certifyCertificate(db, pm, "p1", pmA, seq, { certified: 180_000, reason: "Grid C finishes not accepted", consultantRef: "CONS-114" })
    expect(certified).toMatchObject({ gross: 180_000, recovery: 18_000, retention: 18_000, vat: 24_300, net: 168_300 })
    expect(cert("01")).toMatchObject({ status: "appr", certified: 180_000, cut: 20_000, submitted: { gross: 200_000 } })
    expect(pmBlock()).toMatchObject({ retentionHeld: 18_000, advanceRecovered: 18_000, cutPool: 20_000 })
    const events = listCollection<Record<string, any>>(PM_EVENTS)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ key: "prj:IPC:PJ-2026/009:01", kind: "IPC", amount: 180_000 })
  })

  it("the deduction returns to unbilled and is re-claimed in the next certificate", async () => {
    seedProject()
    await measure("i1", 100)
    await prepareCertificate(db, qs, "p1", qsA, { itemIds: ["i1"] })
    await approveCertificate(db, pm, "p1", pmA, 1)
    await certifyCertificate(db, pm, "p1", pmA, 1, { certified: 40_000, reason: "Partial" })
    await measure("i1", 20)
    const { amounts } = await prepareCertificate(db, qs, "p1", qsA, { itemIds: ["i1"] })
    expect(amounts.gross).toBe(20 * 500 + 10_000)
    expect(pmBlock().cutPool).toBe(0)
  })

  it("nothing unbilled — no certificate (IPC-01, INV-03)", async () => {
    seedProject()
    await measure("i2", 20)
    await expect(prepareCertificate(db, qs, "p1", qsA, { itemIds: ["i2"] })).rejects.toMatchObject({ blocks: ["zero"] })
    await measure("i1", 10)
    await prepareCertificate(db, qs, "p1", qsA, { itemIds: ["i1"] })
    await expect(prepareCertificate(db, qs, "p1", qsA, { itemIds: ["i1"] })).rejects.toBeInstanceOf(PmCertificateError)
  })

  it("withdrawing before submission undoes the billing and the totals", async () => {
    seedProject()
    await measure("i1", 100)
    await prepareCertificate(db, qs, "p1", qsA, { itemIds: ["i1"] })
    await expect(withdrawCertificate(db, site, "p1", seA, 1)).rejects.toBeInstanceOf(PmAccessError)
    await withdrawCertificate(db, qs, "p1", qsA, 1)
    expect(cert("01").status).toBe("void")
    expect(readDoc<Record<string, any>>("projects/p1/boqItems/i1")!.billedQuantity).toBe(0)
    expect(pmBlock()).toMatchObject({ retentionHeld: 0, advanceRecovered: 0 })
  })

  it("a certificate approved between drafting and signing makes a lower cap unsignable (AMD-09 through the chain)", async () => {
    seedProject({ ...fidic, retentionCap: 0.2 })
    await measure("i1", 1000)
    const { seq } = await prepareCertificate(db, qs, "p1", qsA, { itemIds: ["i1"] })
    expect(pmBlock().retentionHeld).toBe(50_000)
    await expect(draftAddendum(db, pm, "p1", pmA, { next: { ...fidic, retentionCap: 0.04 }, reason: "client" })).rejects.toMatchObject({ blocks: ["cap_below_held"] })
    await approveCertificate(db, pm, "p1", pmA, seq)
    expect(pmBlock().retentionHeld).toBe(50_000)
  })

  it("the site engineer prepares nothing; the preparer never approves their own", async () => {
    seedProject()
    await measure("i1", 10)
    await expect(prepareCertificate(db, site, "p1", seA, { itemIds: ["i1"] })).rejects.toBeInstanceOf(PmAccessError)
    await prepareCertificate(db, pm, "p1", pmA, { itemIds: ["i1"] })
    await expect(approveCertificate(db, pm, "p1", pmA, 1)).rejects.toMatchObject({ code: "self_approval" })
  })
})
