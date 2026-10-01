/**
 * PM 1.0 — "stale drawing" has one definition (MS-05, DOC-01): a revision
 * issued after the last APPROVED MEASUREMENT. The register and its tab badge
 * asked the last certificate instead, so a project with approved sheets and no
 * certificate yet showed the new revision as current, with no alert — while
 * the look-ahead, reading the measurement, dropped its current-drawing
 * constraint for the same drawing.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import { isStale, lastCertificateDay, lastMeasuredDay, PM_DOCS, staleDrawings, type PmDocument } from "@/lib/pm/documents"
import { issueRevision, registerDocument } from "@/lib/pm/documents-writes"
import { todayDay } from "@/lib/pm/format"
import { lastApprovedDay, PM_SHEETS, type PmSheet } from "@/lib/pm/measurement"
import { writeSheet } from "@/lib/pm/measurement-writes"
import { defaultTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const pmA = { uid: "pm1", name: "Abdullah" }

const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const rev = (code: string, day: string) => ({ code, day, by: "pm1" })
const revised = { type: "dwg" as const, revisions: [rev("R01", "2026-01-01"), rev("R02", "2026-06-10")] }

describe("a drawing is stale against the last approved measurement", () => {
  it("the yardstick is the last approved sheet's day — the one the look-ahead reads", () => {
    const sheets = [
      { status: "ok", day: "2026-05-20" },
      { status: "ok", day: "2026-06-01" },
      { status: "wait", day: "2026-06-20" },
      { status: "no", day: "2026-07-01" },
    ]
    expect(lastMeasuredDay(sheets)).toBe("2026-06-01")
    expect(lastMeasuredDay(sheets)).toBe(lastApprovedDay(sheets as Array<Pick<PmSheet, "status" | "day">>))
    expect(lastMeasuredDay([])).toBeNull()
  })

  it("revised after it: stale, with no certificate on the project at all", () => {
    expect(staleDrawings([revised], [{ status: "ok", day: "2026-06-01" }])).toHaveLength(1)
    // A sheet still waiting measured nothing yet; nothing measured, nothing stale.
    expect(staleDrawings([revised], [{ status: "wait", day: "2026-06-01" }])).toEqual([])
    expect(staleDrawings([revised], [])).toEqual([])
    // Measured again after the revision: the work was measured against it — current again.
    expect(staleDrawings([revised], [{ status: "ok", day: "2026-06-01" }, { status: "ok", day: "2026-06-15" }])).toEqual([])
    expect(staleDrawings([{ ...revised, type: "spec" as const }], [{ status: "ok", day: "2026-06-01" }])).toEqual([])
  })

  it("on a project with an approved sheet and no certificate, the revised drawing is flagged", async () => {
    resetFakeDb()
    const today = todayDay()
    const terms = { ...defaultTerms({ retention: 0.1 }), basis: "rem" as const }
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/014", lifecycle: "live", terms, original: terms } })
    seed("projects/p1/boqItems/i1", { itemNo: "01", quantity: "100", unitPrice: "1000", executedQuantity: 0 })
    await registerDocument(db, pm, "p1", pmA, { name: "Architectural drawings", type: "dwg", code: "R01", day: shift(today, -30) })
    await writeSheet(db, pm, "p1", pmA, { day: shift(today, -10), lines: [{ itemId: "i1", qty: 20 }] })
    await writeSheet(db, site, "p1", { uid: "se1", name: "Omar" }, { day: today, lines: [{ itemId: "i1", qty: 5 }] })
    await issueRevision(db, pm, "p1", pmA, 1, { code: "R02", day: shift(today, -3) })

    const docs = listCollection<PmDocument>(`projects/p1/${PM_DOCS}`)
    const sheets = listCollection<PmSheet>(`projects/p1/${PM_SHEETS}`)
    // What the register used to ask: no certificate, so "nothing is stale".
    const certDay = lastCertificateDay(listCollection<{ status: string; prepOn?: string | null }>(`projects/p1/${PM_CERTIFICATES}`))
    expect(certDay).toBeNull()
    expect(docs.filter((d) => isStale(d, certDay))).toEqual([])
    // What it asks now — the waiting sheet of today does not move the yardstick.
    expect(lastMeasuredDay(sheets)).toBe(shift(today, -10))
    expect(staleDrawings(docs, sheets).map((d) => d.name)).toEqual(["Architectural drawings"])
  })
})
