/**
 * PM 1.1 — money and contract (builder "money"). Each block ports a qa_fixes.js
 * step or a 1.1 requirement into a test that fails on the 1.0 code:
 *  - IPC-07 (FX-14, FX-15): the advance is frozen (`pm.advAmt`) and recovery is
 *    capped at what is left of it; "recovered" counts from submitted onward.
 *  - CST-05: one cash-in figure (frozen advance + collections − VAT) for the head and the money tab.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { planAdvanceBackfill } from "@/lib/pm/advance-backfill"
import { certificateAmounts, collectionFigures, frozenAdvance, legacyClaimsCollected, projectCashIn, type CertificateFacts } from "@/lib/pm/certificate"
import { prepareCertificate, type PmCertificate } from "@/lib/pm/certificate-writes"
import { approveSheet, writeSheet } from "@/lib/pm/measurement-writes"
import { goLive, startProject } from "@/lib/pm/project-writes"
import { defaultTerms, type ContractTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const terms: ContractTerms = { ...defaultTerms({ advance: 0.1, retention: 0.1 }), retentionCap: 0.05 }
const pmActor = { uid: "pm1", name: "Abdullah" }

function project(budget: number, block: Record<string, unknown> = {}, t: ContractTerms = terms) {
  seed("projects/p1", { organizationId: "org", budget, projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/009", lifecycle: "live", terms: t, original: t, ...block } })
}
async function measure(qty: number) {
  const r = await writeSheet(db, site, "p1", { uid: "se1", name: "Omar" }, { day: "2026-09-27", lines: [{ itemId: "i1", qty }] })
  await approveSheet(db, pm, "p1", pmActor, r.seq)
}
const cert = (n = "01") => readDoc<PmCertificate>(`projects/p1/pmCertificates/${n}`) as PmCertificate
const facts = (over: Partial<CertificateFacts>): CertificateFacts => ({ seq: 1, status: "appr", gross: 100_000, net: 100_000, vat: 12_000, retention: 10_000, recovery: 10_000, prepOn: "2026-05-01", ...over })

beforeEach(() => resetFakeDb())

describe("IPC-07 — the advance is received once and frozen", () => {
  it("frozenAdvance: the stored figure wins; before the freeze, the ORIGINAL rate × the value; nobody pays → 0", () => {
    expect(frozenAdvance({ advAmt: 100_000, original: { advance: 0.2, payer: "owner" } }, 5_000_000)).toBe(100_000)
    expect(frozenAdvance({ original: { advance: 0.1, payer: "owner" }, terms: { advance: 0.3, payer: "owner" } }, 1_000_000)).toBe(100_000)
    expect(frozenAdvance({ original: { advance: 0.1, payer: "none" } }, 1_000_000)).toBe(0)
  })

  it("FX-14: an approved variation does not raise the advance — recovery is capped at what is left of the frozen one", () => {
    // Frozen at 100,000 on a 1,000,000 contract; a variation took the value to 1,500,000; 95,000 already recovered.
    const a = certificateAmounts({ gross: 500_000, terms: { ...terms, advAmt: 100_000 }, contractValue: 1_500_000, held: 0, recovered: 95_000 })
    expect(a.recovery).toBe(5_000)
    // Without a frozen figure (a certificate from before the freeze) the old base stands.
    expect(certificateAmounts({ gross: 500_000, terms, contractValue: 1_500_000, held: 0, recovered: 95_000 }).recovery).toBe(50_000)
  })

  it("FX-15: preparing over the store — a variation approved after the start leaves the advance where it froze, and the certificate keeps it", async () => {
    project(1_000_000, { advAmt: 100_000, advanceRecovered: 90_000 })
    seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: "1000", unitPrice: "1000", executedQuantity: 0 })
    seed("projects/p1/pmVariations/01", { status: "appr", value: 500_000, executedPct: 0, billedPct: 0 })
    await measure(300)
    const { amounts } = await prepareCertificate(db, qs, "p1", { uid: "qs1", name: "Huda" }, { itemIds: ["i1"] })
    // 10% × 300,000 = 30,000, but only 10,000 is left of the frozen 100,000 (the 1.0 code read 150,000 − 90,000).
    expect(amounts.recovery).toBe(10_000)
    expect(cert().terms.advAmt).toBe(100_000)
    expect(cert().terms.advance).toBe(0.1) // the preparation-day rate (1.1 advPc) is kept beside it
  })

  it("Start freezes the advance in the transaction that sends prj:ADV — the value that day × the rate", async () => {
    seed("projects/p1", { organizationId: "org", budget: 1_000_000, projectManagerId: "pm1", status: "approved_waiting_start", pm: { no: "PJ-2026/001", lifecycle: "plan", terms, original: null, durationDays: 100 } })
    seed("projects/p1/boqItems/i1", { itemNo: "03-01", unit: "m3", quantity: 100, unitPrice: 5_000, executedQuantity: 0, billedQuantity: 0 })
    await startProject(db, pm, "p1", 1, pmActor)
    expect(readDoc<{ pm: { advAmt: number } }>("projects/p1")?.pm.advAmt).toBe(50_000)
  })

  it("Start after prj:ADV went at birth freezes what Finance holds, and sends nothing more", async () => {
    seed("projects/p1", { organizationId: "org", budget: 1_000_000, projectManagerId: "pm1", status: "approved_waiting_start", pm: { no: "PJ-2026/001", lifecycle: "plan", terms, original: null, durationDays: 100 } })
    seed("projects/p1/boqItems/i1", { itemNo: "03-01", unit: "m3", quantity: 100, unitPrice: 5_000, executedQuantity: 0, billedQuantity: 0 })
    seed("pmEvents/org__prj:ADV:PJ-2026_001", { key: "prj:ADV:PJ-2026/001", kind: "ADV", organizationId: "org", projectId: "p1", amount: 100_000 })
    await startProject(db, pm, "p1", 1, pmActor)
    expect(readDoc<{ pm: { advAmt: number } }>("projects/p1")?.pm.advAmt).toBe(100_000)
  })

  it("goLive keeps an advance it is given and leaves the block alone without one", () => {
    expect((goLive({ terms }, "start", 12_345.678) as { advAmt?: number }).advAmt).toBe(12_345.68)
    expect("advAmt" in goLive({ terms }, "start")).toBe(false)
  })

  it("'recovered' is shown from submitted certificates onward; what is left reads the frozen advance", () => {
    const f = collectionFigures({
      certs: [facts({ seq: 1, status: "appr" }), facts({ seq: 2, status: "sub" }), facts({ seq: 3, status: "int" })],
      today: "2026-09-28",
      contractValue: 2_000_000,
      advance: 0.1,
      advanceTotal: 100_000,
      started: true,
      retentionReleased: false,
    })
    expect(f.advanceTotal).toBe(100_000)
    expect(f.advanceRecovered).toBe(20_000)
    expect(f.advanceLeft).toBe(80_000)
  })

  it("the backfill: prj:ADV's amount › nothing owed › the first certificate's value × the original rate › the handover's figure", () => {
    const base = { lifecycle: "live", budget: 1_000_000, pm: { original: { advance: 0.1, payer: "owner" } }, eventAmount: null, certificates: [] }
    expect(planAdvanceBackfill({ ...base, eventAmount: 80_000 })).toEqual({ advAmt: 80_000, source: "event" })
    expect(planAdvanceBackfill({ ...base, pm: { original: { advance: 0.1, payer: "none" } } })).toEqual({ advAmt: 0, source: "none" })
    expect(planAdvanceBackfill({ ...base, certificates: [{ seq: 2, status: "appr", contractValue: 1_400_000 }, { seq: 1, status: "appr", contractValue: 1_200_000 }] })).toEqual({ advAmt: 120_000, source: "first_certificate" })
    expect(planAdvanceBackfill(base)).toEqual({ advAmt: 100_000, source: "budget" })
    expect(planAdvanceBackfill({ ...base, lifecycle: "plan" })).toBeNull()
    expect(planAdvanceBackfill({ ...base, pm: { ...base.pm, advAmt: 5 } })).toBeNull()
  })
})

describe("CST-05 — one cash-in figure", () => {
  it("the frozen advance once started + collected + legacy claims − the VAT in it", () => {
    const certs = [facts({ seq: 1, status: "paid", collected: 1 }), facts({ seq: 2, status: "appr", collected: 0 })]
    expect(projectCashIn({ certs, advanceTotal: 100_000, started: true, legacyCollected: 5_000 })).toBe(100_000 + 100_000 + 5_000 - 12_000)
    expect(projectCashIn({ certs, advanceTotal: 100_000, started: false })).toBe(100_000 - 12_000)
    // The money tab's figure is the same function.
    const f = collectionFigures({ certs, today: "2026-09-28", contractValue: 0, advance: 0, advanceTotal: 100_000, started: true, legacyCollected: 5_000, retentionReleased: false })
    expect(f.cashIn).toBe(193_000)
  })

  it("legacy claims count only when collected", () => {
    expect(legacyClaimsCollected([{ status: "collected", amount: 1_000 }, { status: "submitted", amount: 9_000 }, { status: "collected", amount: "250" }])).toBe(1_250)
  })
})
