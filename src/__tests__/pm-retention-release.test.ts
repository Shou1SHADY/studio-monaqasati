/**
 * Finance releases the retention a handover made claimable. The provisional
 * half, once received, halves what the certificates still show as held; the
 * final release clears the close-out gate (the prototype's retHalf / retRel).
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { releasePmRetention } from "@/lib/accounting/pm-finance-writes"
import type { PostingContext } from "@/lib/accounting/posting-rules"
import type { PmEvent } from "@/lib/pm/events"

const db = fakeFirestore as unknown as Firestore
const ctx = {} as PostingContext
const event = (stage: string): PmEvent => ({ key: `prj:HND:PJ-1:${stage}`, kind: "HND", organizationId: "org", projectId: "p1", projectNo: "PJ-1", amount: 500, params: { stage, on: "2026-09-29" }, by: "u", at: "2026-09-29T00:00:00Z" })

beforeEach(() => {
  resetFakeDb()
  seed("projects/p1", { organizationId: "org", pm: { no: "PJ-1", retentionHeld: 1000 } })
})

it("the provisional half marks the retention half received; the final one releases it", async () => {
  await releasePmRetention(db, ctx, { event: event("prov"), date: "2026-09-29", postToBooks: false })
  expect(readDoc<{ pm: Record<string, unknown> }>("projects/p1")?.pm).toMatchObject({ retentionHalfReleased: true })
  expect(readDoc<{ pm: Record<string, unknown> }>("projects/p1")?.pm.retentionReleased).toBeUndefined()
  await releasePmRetention(db, ctx, { event: event("final"), date: "2026-09-29", postToBooks: false })
  expect(readDoc<{ pm: Record<string, unknown> }>("projects/p1")?.pm).toMatchObject({ retentionHalfReleased: true, retentionReleased: true })
})

it("a delivery unit's release marks neither", async () => {
  await releasePmRetention(db, ctx, { event: event("unit"), date: "2026-09-29", postToBooks: false })
  expect(readDoc<{ pm: Record<string, unknown> }>("projects/p1")?.pm).toEqual({ no: "PJ-1", retentionHeld: 1000 })
})
