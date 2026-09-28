/**
 * Finance's side of PM's site events: an approved sub certificate is his
 * payable (work to subcontract cost, VAT, his retention held, recovered waste
 * off material cost) and paying it clears the payable and writes `paid` back on
 * each subcontract; a petty purchase, an approved loss and a transfer between
 * projects each post one balanced entry keyed on the event; the approved
 * estimate shows the highest revision per project.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { ACC } from "@/lib/accounting/accounts"
import { buildEntry, entryDocId, type JournalEntry } from "@/lib/accounting/journal"
import { PmFinanceError, paySubCertificate, postPmSiteCost, postPmSubCertificate } from "@/lib/accounting/pm-finance-writes"
import {
  pmCashPosting,
  pmEventDay,
  pmLatestEstimates,
  pmLossPosting,
  pmSubCertificatePosting,
  pmSubPayable,
  pmSubPaymentPosting,
  pmSubVat,
  pmTransferPosting,
  subWorkByContract,
} from "@/lib/accounting/pm-postings"
import type { PostingResult } from "@/lib/accounting/posting-rules"
import { eventDocId, type PmEvent } from "@/lib/pm/events"

const db = fakeFirestore as unknown as Firestore
const ctx = { organizationId: "org", userId: "fin1", userName: "Finance" }

const base = { organizationId: "org", projectId: "p1", projectNo: "PJ-2026/003", by: "u1", at: "2026-09-28T10:00:00.000Z" }
const sc: PmEvent = { ...base, key: "prj:SC:PJ-2026/003:01", kind: "SC", amount: 16000, params: { certificate: "01", subcontractor: "Al-Bina", supplierId: "s9", contracts: "01,02", gross: 16000, retention: 1600, recovery: 400, net: 14000 } }
const cash: PmEvent = { ...base, key: "prj:CASH:PJ-2026/003:04", kind: "CASH", amount: 850, params: { what: "Nails", supplier: "Hardware shop", receipt: "R-77", day: "2026-09-20" } }
const loss: PmEvent = { ...base, key: "prj:LOSS:PJ-2026/003:st1:3", kind: "LOSS", amount: 1200, params: { material: "Cement", unit: "bag", qty: 60, why: "damage", unitCost: 20 } }
const xfer: PmEvent = { ...base, key: "prj:XFER:PJ-2026/003:st1:2", kind: "XFER", amount: 5000, params: { material: "Rebar", unit: "t", qty: 2, fromProjectId: "p2", fromProject: "Tower", unitCost: 2500 } }

const sum = (lines: PostingResult["lines"], k: "debit" | "credit") => lines.reduce((a, l) => a + (l[k] ?? 0), 0)
const balanced = (r: PostingResult | null) => {
  expect(r).not.toBeNull()
  const lines = r?.lines ?? []
  expect(sum(lines, "debit")).toBeCloseTo(sum(lines, "credit"), 2)
  expect(() => buildEntry({ organizationId: "org", date: r!.date, kind: "auto", sourceType: r!.sourceType, sourceId: r!.sourceId, description: r!.description, lines, userId: "u", userName: "u" })).not.toThrow()
}

describe("a subcontractor certificate (prj:SC)", () => {
  it("is his payable: work to subcontract cost, VAT, retention held, waste recovered — balanced", () => {
    const vat = pmSubVat(sc, true)
    expect(vat).toBe(2340)
    const r = pmSubCertificatePosting(sc, { vat, projectName: "Villas" })
    balanced(r)
    expect(r?.sourceType).toBe("pm_sub_certificate")
    expect(r?.sourceId).toBe("prj:SC:PJ-2026_003:01")
    const line = (acc: string) => r?.lines.find((l) => l.account === acc)
    expect(line(ACC.costSubcontractors)?.debit).toBe(16000)
    expect(line(ACC.vatInput)?.debit).toBe(2340)
    expect(line(ACC.subcontractorRetentionPayable)?.credit).toBe(1600)
    expect(line(ACC.costMaterials)?.credit).toBe(400)
    expect(line(ACC.suppliersPayable)).toMatchObject({ credit: 16340, party: "s9", partyName: "Al-Bina" })
    expect(r?.lines.every((l) => l.project === "p1")).toBe(true)
  })
  it("takes VAT from the event when it carries one, none for an unregistered sub", () => {
    expect(pmSubVat({ ...sc, params: { ...sc.params, vat: 999 } }, false)).toBe(999)
    expect(pmSubVat(sc, false)).toBe(0)
    balanced(pmSubCertificatePosting(sc, { vat: 0 }))
    expect(pmSubPayable(sc, 0)).toBe(14000)
  })
  it("balances even when recoveries exceed what is due (he owes us)", () => {
    const e = { ...sc, params: { ...sc.params, gross: 1000, retention: 100, recovery: 1500 } }
    const r = pmSubCertificatePosting(e, { vat: 0 })
    balanced(r)
    expect(r?.lines.find((l) => l.account === ACC.suppliersPayable)?.debit).toBe(600)
  })
  it("posts nothing for another kind", () => {
    expect(pmSubCertificatePosting(cash, { vat: 0 })).toBeNull()
  })
  it("its payment clears the payable from the bank", () => {
    const r = pmSubPaymentPosting(sc, { amount: 16340, date: "2026-10-01" })
    balanced(r)
    expect(r.sourceType).toBe("pm_sub_payment")
    expect(r.lines).toEqual([expect.objectContaining({ account: ACC.suppliersPayable, debit: 16340 }), expect.objectContaining({ account: ACC.bankMain, credit: 16340 })])
  })
  it("splits the certified work by subcontract", () => {
    const by = subWorkByContract([
      { subcontractSeq: 1, amount: 10000 },
      { subcontractSeq: 2, amount: 4000 },
      { subcontractSeq: 1, amount: 2000 },
    ])
    expect([...by]).toEqual([
      [1, 12000],
      [2, 4000],
    ])
  })
})

describe("site costs", () => {
  it("a petty purchase is a direct site cost out of petty cash, on the purchase day", () => {
    const r = pmCashPosting(cash, "Villas")
    balanced(r)
    expect(r?.sourceType).toBe("pm_cash")
    expect(r?.date).toBe("2026-09-20")
    expect(entryDocId("org", r!.sourceType, r!.sourceId)).toBe("org__pm_cash__prj:CASH:PJ-2026_003:04")
    expect(r?.lines).toEqual([expect.objectContaining({ account: ACC.costDirectSite, debit: 850, project: "p1" }), expect.objectContaining({ account: ACC.pettyCash, credit: 850 })])
    expect(pmEventDay({ ...cash, params: { ...cash.params, day: "" } })).toBe("2026-09-28")
  })
  it("an approved loss is material cost out of stock", () => {
    const r = pmLossPosting(loss)
    balanced(r)
    expect(r?.sourceType).toBe("pm_loss")
    expect(r?.lines).toEqual([expect.objectContaining({ account: ACC.costMaterials, debit: 1200 }), expect.objectContaining({ account: ACC.inventoryMaterials, credit: 1200 })])
    expect(pmLossPosting({ ...loss, amount: 0 })?.empty).toBe(true)
  })
  it("a transfer moves the cost from the sending project to the receiving one", () => {
    const r = pmTransferPosting(xfer, { projectName: "Villas" })
    balanced(r)
    expect(r?.sourceType).toBe("pm_xfer")
    expect(r?.lines).toEqual([expect.objectContaining({ account: ACC.costMaterials, debit: 5000, project: "p1" }), expect.objectContaining({ account: ACC.costMaterials, credit: 5000, project: "p2" })])
    expect(pmTransferPosting({ ...xfer, params: { ...xfer.params, fromProjectId: "" } })?.empty).toBe(true)
  })
  it("each posts nothing for another kind", () => {
    expect(pmCashPosting(loss)).toBeNull()
    expect(pmLossPosting(xfer)).toBeNull()
    expect(pmTransferPosting(cash)).toBeNull()
  })
})

describe("the approved estimate at completion", () => {
  it("keeps the highest revision per project", () => {
    const bud = (projectId: string, rev: number, estimate: number): PmEvent => ({ ...base, projectId, key: `prj:BUD:${projectId}:${rev}`, kind: "BUD", amount: estimate, params: { rev, estimate } })
    const latest = pmLatestEstimates([bud("p1", 1, 100), bud("p1", 3, 300), bud("p1", 2, 200), bud("p2", 1, 50), cash])
    expect(latest.map((e) => [e.projectId, e.amount]).sort()).toEqual([
      ["p1", 300],
      ["p2", 50],
    ])
  })
})

describe("writes", () => {
  beforeEach(() => {
    resetFakeDb()
    seed("accounting_settings/org", { organizationId: "org", enabled: true })
    seed("projects/p1", { organizationId: "org", pm: { no: "PJ-2026/003" } })
    seed("projects/p1/pmSubcontracts/01", { seq: 1, paid: 1000, lines: [] })
    seed("projects/p1/pmSubcontracts/02", { seq: 2, paid: 0, lines: [] })
    seed("projects/p1/pmSubCertificates/01", { seq: 1, status: "ok", lines: [{ subcontractSeq: 1, amount: 12000 }, { subcontractSeq: 2, amount: 4000 }] })
  })

  it("posting a site cost twice lands on one entry", async () => {
    await postPmSiteCost(db, ctx, pmCashPosting(cash))
    await postPmSiteCost(db, ctx, pmCashPosting(cash))
    const entries = listCollection<JournalEntry>("accounting_journal")
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe(`org__pm_cash__${eventDocId(cash.key)}`)
    expect(entries[0].totalDebit).toBe(entries[0].totalCredit)
  })

  it("pays a posted sub certificate once: the payment entry, the certificate and each subcontract's paid", async () => {
    await postPmSubCertificate(db, ctx, sc, { vatRegistered: true })
    const res = await paySubCertificate(db, ctx, { event: sc, date: "2026-10-01", postToBooks: true, vatRegistered: true })
    expect(res.amount).toBe(16340)
    expect(readDoc<{ paidOn: string; paidAmount: number }>("projects/p1/pmSubCertificates/01")).toMatchObject({ paidOn: "2026-10-01", paidAmount: 16340 })
    expect(readDoc<{ paid: number }>("projects/p1/pmSubcontracts/01")?.paid).toBe(13000)
    expect(readDoc<{ paid: number }>("projects/p1/pmSubcontracts/02")?.paid).toBe(4000)
    const pay = readDoc<JournalEntry>(`accounting_journal/org__pm_sub_payment__${eventDocId(sc.key)}`)
    expect(pay?.totalDebit).toBe(16340)
    expect(pay?.totalCredit).toBe(16340)
    await expect(paySubCertificate(db, ctx, { event: sc, date: "2026-10-02", postToBooks: true, vatRegistered: true })).rejects.toMatchObject({ code: "already_paid" })
    expect(readDoc<{ paid: number }>("projects/p1/pmSubcontracts/01")?.paid).toBe(13000)
  })

  it("refuses paying through the books before the certificate is posted", async () => {
    await expect(paySubCertificate(db, ctx, { event: sc, date: "2026-10-01", postToBooks: true, vatRegistered: true })).rejects.toBeInstanceOf(PmFinanceError)
    expect(readDoc<{ paidOn?: string }>("projects/p1/pmSubCertificates/01")?.paidOn).toBeUndefined()
  })

  it("with the books off records the payment on the project only, at net + VAT", async () => {
    const res = await paySubCertificate(db, ctx, { event: sc, date: "2026-10-01", postToBooks: false, vatRegistered: false })
    expect(res.amount).toBe(14000)
    expect(listCollection("accounting_journal")).toHaveLength(0)
  })

  it("refuses a certificate that is not approved", async () => {
    seed("projects/p1/pmSubCertificates/01", { seq: 1, status: "int", lines: [] })
    await expect(paySubCertificate(db, ctx, { event: sc, date: "2026-10-01", postToBooks: false, vatRegistered: true })).rejects.toMatchObject({ code: "not_approved" })
  })
})
