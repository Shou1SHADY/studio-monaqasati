/**
 * PM 1.0 — the contract value money is measured against (INV-01, INV-04,
 * RET-01, §8): priced items + approved variations, the handover's figure only
 * while no BOQ is priced. Certificates and the addendum's cap check used the
 * handover value alone: an approved variation never widened the retention cap
 * or the advance, and a project created without a value (budget 0) never
 * retained or recovered anything.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { draftAddendum } from "@/lib/pm/addendum-writes"
import { prepareCertificate, type PmCertificate } from "@/lib/pm/certificate-writes"
import { liveContractValue, readContractValue } from "@/lib/pm/contract-value"
import { approveSheet, writeSheet } from "@/lib/pm/measurement-writes"
import { defaultTerms, type ContractTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const terms: ContractTerms = { ...defaultTerms({ advance: 0.1, retention: 0.1 }), retentionCap: 0.05 }

function project(budget: number, totals: Record<string, number> = {}, t: ContractTerms = terms) {
  seed("projects/p1", { organizationId: "org", budget, projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/009", lifecycle: "live", terms: t, original: t, ...totals } })
}
async function measure(qty: number) {
  const r = await writeSheet(db, site, "p1", { uid: "se1", name: "Omar" }, { day: "2026-09-27", lines: [{ itemId: "i1", qty }] })
  await approveSheet(db, pm, "p1", { uid: "pm1", name: "Abdullah" }, r.seq)
}
const prepare = () => prepareCertificate(db, qs, "p1", { uid: "qs1", name: "Huda" }, { itemIds: ["i1"] })
const cert = () => readDoc<PmCertificate>("projects/p1/pmCertificates/01") as PmCertificate

beforeEach(() => resetFakeDb())

describe("the value itself (INV-01)", () => {
  it("priced items + approved variations; an unpriced item adds nothing", () => {
    expect(liveContractValue({ budget: 9_999, items: [{ quantity: 1000, rate: 500 }, { quantity: 200, rate: 0 }], approvedVariations: 200_000 })).toBe(700_000)
  })
  it("with no priced BOQ the project carries its handover value", () => {
    expect(liveContractValue({ budget: 22_400_000, items: [], approvedVariations: 0 })).toBe(22_400_000)
    expect(liveContractValue({ budget: 22_400_000, items: [{ quantity: 10, rate: 0 }], approvedVariations: 50_000 })).toBe(22_450_000)
  })
  it("is read from the project's own BOQ and variations; only an APPROVED variation counts", async () => {
    project(1_000_000)
    seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: "1,000", unitPrice: "1000", executedQuantity: 0 })
    seed("projects/p1/pmVariations/01", { status: "appr", value: 200_000 })
    seed("projects/p1/pmVariations/02", { status: "wait", value: 900_000 })
    expect(await readContractValue(db, "p1", 1_000_000)).toBe(1_200_000)
  })
})

describe("the certificate is measured against it (RET-01, INV-04)", () => {
  it("an approved variation widens the retention cap and the advance", async () => {
    // Contract 1,000,000 + an approved variation of 200,000; 50,000 already held and 100,000 already recovered.
    project(1_000_000, { retentionHeld: 50_000, advanceRecovered: 100_000 })
    seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: "1000", unitPrice: "1000", executedQuantity: 0 })
    seed("projects/p1/pmVariations/01", { status: "appr", value: 200_000, executedPct: 0, billedPct: 0 })
    await measure(200)
    const { amounts } = await prepare()
    // cap 5% × 1,200,000 = 60,000 → 10,000 left; advance 10% × 1,200,000 = 120,000 → 20,000 left.
    expect(amounts).toEqual({ gross: 200_000, recovery: 20_000, retention: 10_000, vat: 27_000, net: 197_000 })
    expect(cert().contractValue).toBe(1_200_000)
  })

  it("a project created without a value retains and recovers on its priced BOQ", async () => {
    const t = { ...terms, retention: 0.05 }
    project(0, {}, t)
    seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: "4000", unitPrice: "500", executedQuantity: 0 })
    await measure(800)
    const { amounts } = await prepare()
    expect(amounts).toEqual({ gross: 400_000, recovery: 40_000, retention: 20_000, vat: 54_000, net: 394_000 })
  })
})

describe("an addendum's cap is checked against it (AMD-09)", () => {
  it("a cap that the handover value alone would refuse is accepted once a variation is approved", async () => {
    project(1_000_000, { retentionHeld: 50_000 })
    seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: "1000", unitPrice: "1000", executedQuantity: 0 })
    // 4.5% of 1,000,000 = 45,000 < 50,000 held → refused…
    await expect(draftAddendum(db, pm, "p1", { uid: "pm1", name: "Abdullah" }, { next: { ...terms, retentionCap: 0.045 }, reason: "client" })).rejects.toMatchObject({ code: "blocked" })
    // …but of 1,200,000 it is 54,000 ≥ 50,000.
    seed("projects/p1/pmVariations/01", { status: "appr", value: 200_000 })
    await expect(draftAddendum(db, pm, "p1", { uid: "pm1", name: "Abdullah" }, { next: { ...terms, retentionCap: 0.045 }, reason: "client" })).resolves.toBe(1)
  })
})
