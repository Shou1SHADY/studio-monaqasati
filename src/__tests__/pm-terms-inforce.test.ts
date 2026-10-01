/**
 * PM 1.0 — a signed addendum reaches every consumer (AMD-04, CON-05, INV-22).
 * The original is frozen on the project (`pm.terms` / `pm.original`) and the
 * contract in force is original + signed addenda; but the addenda are readable
 * only by money or approve holders, so whoever measures — a site engineer —
 * could never compute it, and the measurement write read the FROZEN basis: a
 * signed "re-measurement → lump sum" changed nothing on site, and extra
 * quantity kept being approved and billed without a variation. Signing now
 * leaves the terms in force on the project (`pm.inForce`), where everyone on
 * it reads them.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { draftAddendum, signAddendum } from "@/lib/pm/addendum-writes"
import { todayDay } from "@/lib/pm/format"
import { writeSheet } from "@/lib/pm/measurement-writes"
import { certificatesApply, defaultTerms, termsNow, type ContractTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const pmA = { uid: "pm1", name: "Abdullah" }
const seA = { uid: "se1", name: "Omar" }
const original: ContractTerms = { ...defaultTerms(), basis: "rem" }
type Pm = { inForce?: ContractTerms; terms: ContractTerms; original: ContractTerms }
const block = () => (readDoc<{ pm: Pm }>("projects/p1") as { pm: Pm }).pm
const executed = () => (readDoc<{ executedQuantity: number }>("projects/p1/boqItems/i1") as { executedQuantity: number }).executedQuantity

beforeEach(() => {
  resetFakeDb()
  seed("projects/p1", { organizationId: "org", budget: 1_000_000, projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live", terms: original, original, startedAt: "2026-09-01T00:00:00Z" } })
  seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: "100", unitPrice: "10", executedQuantity: 90 })
})

describe("signing leaves the contract in force on the project", () => {
  it("the original stays as signed; `inForce` carries the amended term", async () => {
    const seq = await draftAddendum(db, pm, "p1", pmA, { next: { ...original, basis: "lump" }, reason: "client" })
    expect(block().inForce).toBeUndefined() // a draft changes nothing (AMD-02)
    await signAddendum(db, pm, "p1", pmA, seq, { signedOn: todayDay() })
    expect(block().original.basis).toBe("rem")
    expect(block().terms.basis).toBe("rem")
    expect(block().inForce?.basis).toBe("lump")
    expect(termsNow(block())?.basis).toBe("lump")
  })

  it("drafted and signed in one step: the same", async () => {
    await draftAddendum(db, pm, "p1", pmA, { next: { ...original, defectsDays: 730 }, reason: "client", signNow: { signedOn: todayDay() } })
    expect(termsNow(block())?.defectsDays).toBe(730)
  })

  it("before any addendum the terms in force are the original — or, before start, the terms being completed", () => {
    expect(termsNow({ terms: original, original })?.basis).toBe("rem")
    expect(termsNow({ terms: { ...original, basis: "lump" }, original: null })?.basis).toBe("lump")
    expect(termsNow({})).toBeNull()
  })
})

describe("measurement follows the basis in force (CON-05)", () => {
  it("after re-measurement → lump sum, a sheet beyond the remaining is refused to whoever measures", async () => {
    const seq = await draftAddendum(db, pm, "p1", pmA, { next: { ...original, basis: "lump" }, reason: "client" })
    await signAddendum(db, pm, "p1", pmA, seq, { signedOn: todayDay() })
    await expect(writeSheet(db, site, "p1", seA, { day: todayDay(), lines: [{ itemId: "i1", qty: 40 }] })).rejects.toMatchObject({ code: "blocked", blocks: ["over_remaining"] })
    expect(executed()).toBe(90)
  })

  it("and without the addendum the same sheet is written, as before", async () => {
    await writeSheet(db, site, "p1", seA, { day: todayDay(), lines: [{ itemId: "i1", qty: 40 }] })
    expect(executed()).toBe(90) // waits for approval; nothing moves yet
  })
})

describe("who pays, for certificates and for closing (AMD-09)", () => {
  const owner = { ...original, payer: "owner" as const }
  const none = { ...original, payer: "none" as const }
  it("an addendum to «nobody pays» does not switch certificates off by itself — section governance does", () => {
    expect(certificatesApply(owner, none)).toBe(true)
  })
  it("a contract that never had a payer has no certificates; one given a payer by addendum has", () => {
    expect(certificatesApply(none, none)).toBe(false)
    expect(certificatesApply(none, owner)).toBe(true)
    expect(certificatesApply(owner, owner)).toBe(true)
  })
})
