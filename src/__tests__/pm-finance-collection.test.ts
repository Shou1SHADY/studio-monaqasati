/**
 * PM 1.0 — what Finance records on a certified certificate (IPC-04, INV-02),
 * as the audit of 2 Oct 2026 found it:
 *  - the collected share was rounded to four decimals, so on a large net the
 *    outstanding drifted by tens or hundreds of riyals, the true remainder was
 *    refused as "over", and a small collection (share still 0) could not be saved;
 *  - the certificate was marked collected BEFORE the ledger was asked: a date in
 *    a locked month left the certificate "paid" and the cash nowhere in the books;
 *  - the same on releasing retention: the flag the close-out gate reads and the
 *    ledger entry were written in an order that could leave one without the other.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { recordPmCollection, releasePmRetention } from "@/lib/accounting/pm-finance-writes"
import { ClosedPeriodError } from "@/lib/accounting/journal"
import { outstandingOf } from "@/lib/accounting/pm-postings"
import type { PostingContext } from "@/lib/accounting/posting-rules"
import type { PmEvent } from "@/lib/pm/events"

const db = fakeFirestore as unknown as Firestore
const ctx = { organizationId: "org", userId: "fin", userName: "Noura" } as PostingContext
const ipc: PmEvent = { key: "prj:IPC:PJ-1:01", kind: "IPC", organizationId: "org", projectId: "p1", projectNo: "PJ-1", amount: 0, params: { certificate: 1 }, by: "u", at: "2026-09-29T00:00:00Z" }
const hnd = (stage: string): PmEvent => ({ key: `prj:HND:PJ-1:${stage}`, kind: "HND", organizationId: "org", projectId: "p1", projectNo: "PJ-1", amount: 500, params: { stage, on: "2026-09-29" }, by: "u", at: "2026-09-29T00:00:00Z" })
type Cert = { status: string; net: number; collected?: number; collections?: Array<{ amount: number }> }
const cert = () => readDoc<Cert>("projects/p1/pmCertificates/01") as Cert
const collect = (amount: number, date = "2026-10-05", postToBooks = false) => recordPmCollection(db, ctx, { event: ipc, amount, date, postToBooks })

beforeEach(() => {
  resetFakeDb()
  seed("projects/p1", { organizationId: "org", pm: { no: "PJ-1", retentionHeld: 1000 } })
})

describe("collection is counted in riyals, not in a rounded share", () => {
  it("the true remainder of a large certificate is accepted, and settles it exactly", async () => {
    seed("projects/p1/pmCertificates/01", { status: "appr", net: 2_587_431.27 })
    await collect(1_000_000)
    expect(outstandingOf(cert().net, cert().collected ?? 0)).toBe(1_587_431.27)
    await collect(1_587_431.27)
    expect(cert()).toMatchObject({ status: "paid", collected: 1 })
    expect(cert().collections?.reduce((a, c) => a + c.amount, 0)).toBeCloseTo(2_587_431.27, 2)
  })

  it("a small collection on a large net still counts", async () => {
    seed("projects/p1/pmCertificates/01", { status: "appr", net: 10_000_000 })
    await collect(400)
    expect(cert().status).toBe("part")
    expect(cert().collected).toBeGreaterThan(0)
    expect(outstandingOf(cert().net, cert().collected ?? 0)).toBe(9_999_600)
  })

  it("more than what is left is still refused", async () => {
    seed("projects/p1/pmCertificates/01", { status: "appr", net: 1_000 })
    await collect(600)
    await expect(collect(400.02)).rejects.toMatchObject({ code: "over_outstanding" })
  })
})

describe("the books are asked first", () => {
  beforeEach(() => {
    seed("accounting_periods/org__2026-09", { organizationId: "org", period: "2026-09", status: "closed" })
    seed("projects/p1/pmCertificates/01", { status: "appr", net: 1_000 })
  })

  it("a collection dated in a locked month changes nothing on the certificate", async () => {
    await expect(collect(600, "2026-09-30", true)).rejects.toBeInstanceOf(ClosedPeriodError)
    expect(cert()).toMatchObject({ status: "appr", net: 1_000 })
    expect(cert().collected).toBeUndefined()
    expect(cert().collections).toBeUndefined()
  })

  it("a release dated in a locked month does not open the close-out gate", async () => {
    await expect(releasePmRetention(db, ctx, { event: hnd("final"), date: "2026-09-30", postToBooks: true })).rejects.toBeInstanceOf(ClosedPeriodError)
    expect(readDoc<{ pm: Record<string, unknown> }>("projects/p1")?.pm.retentionReleased).toBeUndefined()
  })
})
