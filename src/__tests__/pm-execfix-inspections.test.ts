/**
 * PM 1.0 — the inspection row (WIR-01/02). A request raised on 1 Oct for
 * 2 Oct read "raised … 2 Oct": the row showed the day the inspection is
 * BOOKED for as the day it was raised. Raised is the day the request was
 * created; the booked day is said as the booked day. And a refused
 * re-inspection said only "could not save" — the write's own reason
 * (`not_failed`, `no_date`, `archived`) has a message and was never shown.
 *
 * The panel is rendered for real, in Arabic, over the in-memory Firestore.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)

import React from "react"
import { render } from "@testing-library/react"
import type { Firestore } from "firebase/firestore"
import { fakeFirestore, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys } from "@/test-utils/render-world"
import { InspectionsPanel, raisedDay, wirRefusalKey } from "@/components/pm/InspectionsPanel"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { pmDate } from "@/lib/pm/format"
import { PmInspectionError, recordResult, reinspect, requestInspection } from "@/lib/pm/inspection-writes"

installDomShims()

const db = fakeFirestore as unknown as Firestore
const ctx: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const access = { ctx, uid: "se1", isLoading: false, duties: null, allowed: () => true, refusal: () => null, has: () => true } as unknown as PmAccess
const se = { uid: "se1", name: "Omar" }
const items = [{ id: "i1", code: "03-01", description: "Slab", unit: "m3", quantity: 100, rate: 10, executed: 0, gate: { pmInspect: true, pmWir: null } }]

const at = (day: string) => jest.setSystemTime(new Date(`${day}T09:00:00`))
const rowText = () => {
  const { container, unmount } = render(React.createElement(InspectionsPanel, { projectId: "p1", items: items as never, access, actor: se }))
  const text = (container.querySelector("li")?.textContent ?? "").replace(/\s+/g, " ")
  unmount()
  return text
}
const ar = (day: string) => pmDate(day, "ar")

describe("the inspection row: raised is the day it was created", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    resetFakeDb()
    missingKeys.clear()
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live" } })
    seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: 100, pmInspect: true })
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it("reads the creation stamp as the reader's day — a timestamp or its text, never the booked day", () => {
    expect(raisedDay({ createdAt: "2026-10-01T09:00:00.000Z" })).toBe("2026-10-01")
    expect(raisedDay({ createdAt: { toDate: () => new Date("2026-10-01T09:00:00") } })).toBe("2026-10-01")
    // Pending or missing: no day is better than the wrong one.
    expect(raisedDay({ createdAt: null })).toBeNull()
    expect(raisedDay({})).toBeNull()
  })

  it("raised 1 Oct for 2 Oct: the row says raised 1 Oct and due 2 Oct", async () => {
    at("2026-10-01")
    await requestInspection(db, ctx, "p1", se, { itemId: "i1", location: "Villa 4 slab", party: "consultant", on: "2026-10-02" })
    at("2026-10-05")
    const text = rowText()
    expect(text).toContain(`طلبه Omar ${ar("2026-10-01")}`)
    expect(text).not.toContain(`طلبه Omar ${ar("2026-10-02")}`)
    expect(text).toContain(`موعد الفحص ${ar("2026-10-02")}`)
    expect([...missingKeys]).toEqual([])
  })

  it("once decided it still says when it was raised, and the day it was booked for", async () => {
    at("2026-10-01")
    await requestInspection(db, ctx, "p1", se, { itemId: "i1", location: "Villa 4 slab", party: "consultant", on: "2026-10-02" })
    at("2026-10-04")
    await recordResult(db, ctx, "p1", se, 1, { result: "pass", note: "", on: "2026-10-03" })
    const text = rowText()
    expect(text).toContain(`طلبه Omar ${ar("2026-10-01")}`)
    expect(text).toContain(`يوم الفحص ${ar("2026-10-02")}`)
    expect(text).toContain(ar("2026-10-03"))
    expect([...missingKeys]).toEqual([])
  })
})

describe("a refused re-inspection states its reason", () => {
  it("maps the write's refusal to its own message, and only the unknown to 'could not save'", async () => {
    expect(wirRefusalKey(new PmInspectionError("blocked", ["not_failed"]))).toBe("wir.block.not_failed")
    expect(wirRefusalKey(new PmInspectionError("blocked", ["no_date"]))).toBe("wir.block.no_date")
    expect(wirRefusalKey(new PmInspectionError("blocked", ["archived"]))).toBe("wir.block.archived")
    expect(wirRefusalKey(new PmAccessError("no_duty", "qa.record"))).toBe("refused.no_duty")
    expect(wirRefusalKey(new PmInspectionError("missing"))).toBe("error.save")
    expect(wirRefusalKey(new Error("offline"))).toBe("error.save")

    // The refusal the write really raises for an inspection that did not fail.
    resetFakeDb()
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live" } })
    seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: 100, pmInspect: true })
    await requestInspection(db, ctx, "p1", se, { itemId: "i1", location: "Villa 4 slab", party: "consultant", on: "2026-10-02" })
    const err = await reinspect(db, ctx, "p1", se, 1, { on: "2026-10-03" }).catch((e: unknown) => e)
    expect(wirRefusalKey(err)).toBe("wir.block.not_failed")
  })
})
