/**
 * PM 1.1 — money and contract (builder "money"). Each block ports a qa_fixes.js
 * step or a 1.1 requirement into a test that fails on the 1.0 code:
 *  - IPC-07 (FX-14, FX-15): the advance is frozen (`pm.advAmt`) and recovery is
 *    capped at what is left of it; "recovered" counts from submitted onward.
 *  - CST-05: one cash-in figure (frozen advance + collections − VAT) for the head and the money tab.
 *  - AMD-09 (FX-22): an addendum's cap is checked against CERTIFIED retention.
 *  - AMD-01 (FX-48): an addendum keeps its written drafting date.
 *  - AMD-10 (FX-49): the self-approval switch is the organisation owner's, set from Team & permissions.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, PmAccessError, type PmContext } from "@/lib/pm/access"
import { addendumNo, draftBlocks, type PmAddendum } from "@/lib/pm/addenda"
import { draftAddendum } from "@/lib/pm/addendum-writes"
import { setOrgSelfApproval } from "@/lib/pm/info-writes"
import { todayDay } from "@/lib/pm/format"
import { listCollection } from "@/test-utils/fake-firestore"
import { acceptHandover, localAcceptTransport } from "@/lib/pm/handover-writes"
import { acceptStepBlocks, boqSourcesFor, PM_HANDOVERS } from "@/lib/pm/handover"
import { archiveSnapshot, rfiReplyAverages } from "@/lib/pm/closeout"
import { importBoq, PmBoqError } from "@/lib/pm/boq-writes"
import { certifyBlocks } from "@/lib/pm/certificate"
import { pmAllowed } from "@/lib/pm/access"
import { stepBlocks, type PmVariation } from "@/lib/pm/variation"
import { logVariation, recordVariationProgress } from "@/lib/pm/variation-writes"
import { planAdvanceBackfill } from "@/lib/pm/advance-backfill"
import { certificateAmounts, certifiedRetention, collectionFigures, frozenAdvance, legacyClaimsCollected, projectCashIn, type CertificateFacts } from "@/lib/pm/certificate"
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

describe("AMD-09 (FX-22) — the cap is checked against the retention actually held", () => {
  it("only certified certificates hold retention — a draft or one still with the consultant holds nothing yet", () => {
    expect(certifiedRetention([facts({ status: "int", retention: 99 }), facts({ status: "sub", retention: 99 }), facts({ status: "appr", retention: 10 }), facts({ status: "paid", retention: 5 })])).toBe(15)
  })

  it("a cap the PREPARED retention would refuse is accepted while nothing of it is certified", async () => {
    project(1_000_000, { retentionHeld: 50_000 })
    seed("projects/p1/pmCertificates/01", { seq: 1, status: "sub", retention: 50_000 })
    // 4% × 1,000,000 = 40,000 < 50,000 prepared — but nothing is certified: the 1.0 code refused it.
    await expect(draftAddendum(db, pm, "p1", pmActor, { next: { ...terms, retentionCap: 0.04 }, reason: "client" })).resolves.toBe(1)
  })
})

describe("AMD-01 (FX-48) — the addendum keeps its real drafting date", () => {
  const today = todayDay()
  const ago = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)

  it("a written day is kept; never in the future, never before the last signed addendum", async () => {
    project(1_000_000)
    await draftAddendum(db, pm, "p1", pmActor, { next: { ...terms, paymentDays: 45 }, reason: "client", day: ago(5) })
    expect(readDoc<PmAddendum>(`projects/p1/pmAddenda/${addendumNo(1)}`)?.day).toBe(ago(5))
    await expect(draftAddendum(db, pm, "p1", pmActor, { next: { ...terms, paymentDays: 50 }, reason: "client", day: "2999-01-01" })).rejects.toMatchObject({ blocks: ["day_future"] })
  })

  it("the pure rule", () => {
    const base = { lifecycle: "live", archived: false, terms, next: { ...terms, paymentDays: 45 }, reason: "client" as const, contractValue: 1, retentionHeld: 0 }
    expect(draftBlocks({ ...base, day: "2026-05-01", today: "2026-06-01", lastSignedOn: "2026-05-10" })).toEqual(["day_before_last"])
    expect(draftBlocks({ ...base, day: "", today: "2026-06-01" })).toEqual(["no_day"])
    expect(draftBlocks({ ...base, day: "2026-05-20", today: "2026-06-01", lastSignedOn: "2026-05-10" })).toEqual([])
  })
})

describe("AMD-10 (FX-49) — self-approval is an organisation setting, the owner's", () => {
  it("the owner sets it; anyone else is refused before any write", async () => {
    await expect(setOrgSelfApproval(db, { owner: false }, "org", pmActor, true)).rejects.toBeInstanceOf(PmAccessError)
    expect(readDoc("pmSettings/org")).toBeNull()
    await setOrgSelfApproval(db, { owner: true }, "org", { uid: "org", name: "Owner" }, true)
    expect(readDoc("pmSettings/org")).toMatchObject({ selfApproval: true, selfApprovalBy: "org", selfApprovalByName: "Owner" })
  })

  it("the project page no longer carries the switch", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require("fs").readFileSync(require("path").join(process.cwd(), "src/components/pm/PmFilePanels.tsx"), "utf8") as string
    expect(src).not.toMatch(/setSelfApproval|setOrgSelfApproval/)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const team = require("fs").readFileSync(require("path").join(process.cwd(), "src/components/team-management.tsx"), "utf8") as string
    expect(team).toMatch(/<PmSelfApprovalSetting/)
  })
})

describe("CST-04 — the archive measures delay against the effective duration", () => {
  const base = { contractValue: 1_000_000, items: [], certificates: [], retentionHeld: 0, advanceRecovered: 0, durationDays: 300, startedAt: "2026-01-01T00:00:00Z", provisionalOn: "2027-01-06", finalOn: null, today: "2027-02-01" }
  it("original + granted extension days; the original kept beside it", () => {
    const f = archiveSnapshot({ ...base, grantedDays: 60 })
    expect(f.actualDays).toBe(370)
    expect(f.contractDays).toBe(360)
    expect(f.durOrig).toBe(300)
    expect(f.delayDays).toBe(10) // the 1.0 code read 70 — the granted 60 days are not delay
  })
  it("average RFI reply time, overall and per party, answered RFIs only", () => {
    const list = [
      { type: "rfi", party: "consultant", openOn: "2026-02-01", closeOn: "2026-02-05" },
      { type: "rfi", party: "consultant", openOn: "2026-03-01", closeOn: "2026-03-11" },
      { type: "rfi", party: "client", openOn: "2026-03-01", closeOn: "2026-03-04" },
      { type: "rfi", party: "client", openOn: "2026-04-01", closeOn: null },
      { type: "obs", party: "authority", openOn: "2026-04-01", closeOn: "2026-05-01" },
    ]
    expect(rfiReplyAverages(list)).toEqual({ overall: 5.7, byParty: { client: 3, consultant: 7 } })
    const f = archiveSnapshot({ ...base, obstacles: list })
    expect(f.rfiAvg).toBe(5.7)
    expect(f.rfiBy).toEqual({ client: 3, consultant: 7 })
    expect(archiveSnapshot(base).rfiAvg).toBeNull()
  })
})

describe("CON-03 — later pricing and no import after the start", () => {
  it("FX-64: the pricing duty is prep OR approve with money — the QS office prices an unpriced item", () => {
    expect(pmAllowed(qs, "item.price")).toBe(true)
    expect(pmAllowed(site, "item.price")).toBe(false)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require("fs").readFileSync(require("path").join(process.cwd(), "src/components/pm/PmBoqPanel.tsx"), "utf8") as string
    const line = src.split("\n").find((l) => l.includes("const canPrice")) ?? ""
    expect(line).toContain('access.allowed("item.price")')
    expect(line).not.toContain('access.has("approve")')
  })
  it("FX-54: a started project with NO lines refuses an import", async () => {
    project(1_000_000)
    const row = { line: 1, code: "03-01", description: "Concrete", unit: "m3", quantity: 10, rate: 100, cost: null, problems: [] }
    await expect(importBoq(db, pm, "p1", [row] as unknown as Parameters<typeof importBoq>[3])).rejects.toMatchObject({ code: "started" })
    await expect(importBoq(db, pm, "p1", [row] as unknown as Parameters<typeof importBoq>[3])).rejects.toBeInstanceOf(PmBoqError)
  })
})

describe("VO-03 (vopc) — the executed share: approve, never down, logged", () => {
  it("the pure rule refuses going down and an unchanged value", () => {
    expect(stepBlocks({ archived: false, status: "appr", step: "progress", executedPct: 0.3, billedPct: 0.1, currentPct: 0.5 })).toEqual(["below_current"])
    expect(stepBlocks({ archived: false, status: "wait", step: "progress", executedPct: 0.5, currentPct: 0.5 })).toEqual(["no_change"])
    expect(stepBlocks({ archived: false, status: "draft", step: "progress", executedPct: 0.6, currentPct: 0.5 })).toEqual([])
    expect(stepBlocks({ archived: false, status: "rej", step: "progress", executedPct: 0.6, currentPct: 0.5 })).toEqual(["wrong_state"])
  })
  it("recorded by approve only, appended to pcLog with who, when, from → to", async () => {
    project(1_000_000)
    const seq = await logVariation(db, qs, "p1", { uid: "qs1", name: "Huda" }, { title: "Canopy", source: "cons", value: 0, cost: 0, executedPct: 0.3 })
    // A vo holder's executed share at logging is not kept.
    expect(readDoc<PmVariation>("projects/p1/pmVariations/01")?.executedPct).toBe(0)
    await expect(recordVariationProgress(db, qs, "p1", { uid: "qs1", name: "Huda" }, seq, 0.4)).rejects.toBeInstanceOf(PmAccessError)
    await recordVariationProgress(db, pm, "p1", pmActor, seq, 0.4, "slab poured")
    await recordVariationProgress(db, pm, "p1", pmActor, seq, 0.7)
    await expect(recordVariationProgress(db, pm, "p1", pmActor, seq, 0.5)).rejects.toMatchObject({ blocks: ["below_current"] })
    const v = readDoc<PmVariation>("projects/p1/pmVariations/01") as PmVariation
    expect(v.executedPct).toBe(0.7)
    expect(v.pcLog?.map((e) => [e.from, e.to, e.by])).toEqual([
      [0, 0.4, "pm1"],
      [0.4, 0.7, "pm1"],
    ])
    expect(v.pcLog?.[0].note).toBe("slab poured")
  })
  it("the rules: a vo holder may no longer move the executed share; approve may, with its log", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rules = require("fs").readFileSync(require("path").join(process.cwd(), "firestore.rules"), "utf8") as string
    const vo = rules.slice(rules.indexOf("match /pmVariations/{voId}"), rules.indexOf("allow delete", rules.indexOf("match /pmVariations/{voId}")))
    expect(vo).toContain("changedKeys().hasOnly(['value', 'cost', 'instructionNo', 'status', 'days', 'files', 'updatedAt'])")
    expect(vo).toContain("pmDuty(projectId, changedKeys().hasAny(['executedPct', 'pcLog']) ? 'approve' : 'vo')")
  })
})

describe("the consultant's cut — above one riyal, 'other' stated", () => {
  it("rounding is not a cut; 'other' needs its text", () => {
    expect(certifyBlocks({ status: "sub", gross: 100_000, certified: 99_999.5 })).toEqual([])
    expect(certifyBlocks({ status: "sub", gross: 100_000, certified: 99_998 })).toEqual(["cut_reason"])
    expect(certifyBlocks({ status: "sub", gross: 100_000, certified: 99_000, reason: "oth" })).toEqual(["cut_text"])
    expect(certifyBlocks({ status: "sub", gross: 100_000, certified: 99_000, reason: "oth", reasonText: "Prelims disallowed" })).toEqual([])
  })
})

describe("CON-01 (FX-08) — a priced handover BOQ is transferred as it is, inside the acceptance", () => {
  const boq = [
    { code: "03-01", descriptionAr: "خرسانة", descriptionEn: "Concrete", unit: "m3", quantity: 100, rate: 1_000 },
    { code: "03-02", descriptionAr: "حديد", unit: "t", quantity: 20, rate: 4_000 },
    { code: "03-03", descriptionAr: "ملغى", unit: "m", quantity: 0, rate: 5 },
  ]
  function file(withBoq: boolean) {
    seed("crmOpportunities/o1", { organizationId: "org", state: "won" })
    seed(`${PM_HANDOVERS}/h1`, {
      organizationId: "org", status: "wait", to: "pm1", toName: "Abdullah", opportunityId: "o1", title: "Tower", clientName: "Client", clientType: "private",
      kind: "bld", location: "Riyadh", contractNumber: "C-1", value: 1_000_000, durationDays: 300, signedOn: "2026-09-01", startOn: "2026-10-01",
      advance: 0.1, retention: 0.05, note: null, requestedBy: "crm1", createdAt: "2026-09-20T00:00:00Z", ...(withBoq ? { boq } : {}),
    })
  }
  const base = { kind: "bld" as const, location: null, enabledSections: ["contract"], manager: { uid: "pm1", name: "Abdullah", groupId: null } }
  const t = () => localAcceptTransport(db, { uid: "pm1", owner: false })

  it("the wizard offers only «from the bid», and any other source is a block", () => {
    expect(boqSourcesFor({ boq })).toEqual(["crm"])
    expect(acceptStepBlocks({ source: "xl", managerUid: "u", xlItems: 5, xlLoaded: true, fileBoq: true })).toEqual(["boq_from_crm"])
    expect(acceptStepBlocks({ source: "crm", managerUid: "u", xlItems: 2, fileBoq: true })).toEqual([])
  })

  it("at save: Excel, typed or «later» on a file with a priced BOQ is refused, and nothing is created", async () => {
    file(true)
    for (const source of ["xl", "man", "later"] as const) {
      await expect(acceptHandover(db, pmActor, "h1", { ...base, source, lines: [{ itemNo: "X", descriptionAr: "x", descriptionEn: "x", unit: "m", quantity: 1, unitPrice: 1, groupId: null }] }, t())).rejects.toMatchObject({ code: "boq_from_crm" })
    }
    expect(listCollection("projects")).toHaveLength(0)
  })

  it("the file's own lines are written in the acceptance — whatever lines the screen sent", async () => {
    file(true)
    const tampered = [{ itemNo: "03-01", descriptionAr: "x", descriptionEn: "x", unit: "m3", quantity: 999, unitPrice: 1, groupId: null }]
    const { projectId, lines } = await acceptHandover(db, pmActor, "h1", { ...base, source: "crm", lines: tampered }, t())
    expect(lines).toBe(2)
    const items = listCollection<{ itemNo: string; quantity: number; unitPrice: number; descriptionEn: string }>(`projects/${projectId}/boqItems`)
    expect(items.map((i) => [i.itemNo, i.quantity, i.unitPrice]).sort()).toEqual([
      ["03-01", 100, 1_000],
      ["03-02", 20, 4_000],
    ])
    expect(items.find((i) => i.itemNo === "03-02")?.descriptionEn).toBe("حديد")
    // IPC-07 at birth: prj:ADV and the frozen advance in the same write.
    expect(readDoc<{ pm: { advAmt: number; boqFrom: string } }>(`projects/${projectId}`)?.pm).toMatchObject({ advAmt: 100_000, boqFrom: "crm" })
    expect(readDoc<{ status: string }>(`${PM_HANDOVERS}/h1`)?.status).toBe("acc")
  })

  it("a file without a BOQ takes an Excel / typed BOQ in the same transaction; «from the bid» is refused", async () => {
    file(false)
    await expect(acceptHandover(db, pmActor, "h1", { ...base, source: "crm" }, t())).rejects.toMatchObject({ code: "boq_from_crm" })
    const { projectId } = await acceptHandover(db, pmActor, "h1", { ...base, source: "man", lines: [{ itemNo: "01", descriptionAr: "حفر", descriptionEn: "Dig", unit: "m3", quantity: 50, unitPrice: 30, groupId: null }] }, t())
    expect(listCollection(`projects/${projectId}/boqItems`)).toHaveLength(1)
  })
})
