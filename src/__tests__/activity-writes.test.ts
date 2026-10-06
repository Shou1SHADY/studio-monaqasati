/**
 * Activity writes: planning a follow-up for a person, finishing, moving and
 * cancelling an open one — who is told, who is turned away, and that nothing is
 * ever deleted.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { ActivityError, cancelActivity, completeActivity, createActivity, rescheduleActivity } from "@/lib/activity-writes"
import { todayDay } from "@/lib/pm/format"

const db = fakeFirestore as unknown as Firestore
const today = todayDay()
const later = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

const omar = { uid: "u2", name: "Omar" }
const mona = { uid: "u1", name: "Mona" }
const input = { type: "call" as const, summary: " Confirm the date ", dueOn: later(2), assignee: { id: "u1", name: "Mona" } }

type Stored = Record<string, unknown>
const all = () => listCollection<Stored & { id?: string }>("activities")

beforeEach(() => resetFakeDb())

describe("planning a follow-up", () => {
  it("stores it open, trimmed, with who planned it, for whom, and the document key", async () => {
    const target = { kind: "po" as const, id: "po1", label: "PO-2026/012", href: "/contractor/rfqs/orders?po=po1" }
    const id = await createActivity(db, omar, "org", "contractor", { ...input, note: "  ring twice ", target })
    expect(readDoc(`activities/${id}`)).toMatchObject({
      organizationId: "org",
      type: "call",
      summary: "Confirm the date",
      note: "ring twice",
      dueOn: later(2),
      assigneeId: "u1",
      assigneeName: "Mona",
      createdById: "u2",
      createdByName: "Omar",
      status: "open",
      target,
      targetKey: "po:po1",
    })
  })

  it("tells the assignee — with the document named — and nobody else", async () => {
    await createActivity(db, omar, "org", "contractor", { ...input, target: { kind: "po", id: "po1", label: "PO-2026/012", href: "/h" } })
    const [n] = listCollection<{ type: string; link: string; i18n: { params: Record<string, unknown> } }>("users/u1/notifications")
    expect(n).toMatchObject({ type: "activity_assigned", link: "/contractor/activities", i18n: { params: { summary: "Confirm the date", type: "@pn_activity_type_call", due: later(2), about: "PO-2026/012" } } })
    expect(listCollection("users/u2/notifications")).toHaveLength(0)
  })

  it("says 'none' when it is about no document, and links the supplier portal for a supplier", async () => {
    await createActivity(db, omar, "org", "supplier", input)
    const [n] = listCollection<{ link: string; i18n: { params: Record<string, unknown> } }>("users/u1/notifications")
    expect(n.link).toBe("/supplier/activities")
    expect(n.i18n.params.about).toBe("@pn_activity_about_none")
  })

  it("does not notify a person who plans something for himself", async () => {
    await createActivity(db, mona, "org", "contractor", input)
    expect(listCollection("users/u1/notifications")).toHaveLength(0)
    expect(all()).toHaveLength(1)
  })

  it("refuses an incomplete one and writes nothing", async () => {
    await expect(createActivity(db, omar, "org", "contractor", { ...input, summary: " " })).rejects.toMatchObject({ code: "blocked", blocks: ["no_summary"] })
    await expect(createActivity(db, omar, "org", "contractor", { ...input, dueOn: later(-1) })).rejects.toMatchObject({ blocks: ["past_due"] })
    expect(all()).toHaveLength(0)
    expect(listCollection("users/u1/notifications")).toHaveLength(0)
  })
})

describe("finishing, moving and cancelling", () => {
  let id = ""
  beforeEach(async () => {
    id = await createActivity(db, omar, "org", "contractor", input)
  })

  it("the assignee finishes it with the outcome, and the planner is told", async () => {
    await completeActivity(db, mona, "contractor", id, "  confirmed for Sunday ")
    expect(readDoc(`activities/${id}`)).toMatchObject({ status: "done", doneOn: today, doneById: "u1", doneByName: "Mona", feedback: "confirmed for Sunday" })
    const [n] = listCollection<{ type: string; link: string }>("users/u2/notifications")
    expect(n).toMatchObject({ type: "activity_done", link: "/contractor/activities" })
  })

  it("the planner finishing his own for someone else tells nobody back", async () => {
    await completeActivity(db, omar, "contractor", id)
    expect(readDoc(`activities/${id}`)).toMatchObject({ status: "done", feedback: null })
    expect(listCollection("users/u2/notifications")).toHaveLength(0)
  })

  it("someone else is turned away, the owner is not", async () => {
    await expect(completeActivity(db, { uid: "u3", name: "Sara" }, "contractor", id)).rejects.toMatchObject({ code: "not_allowed" })
    expect(readDoc(`activities/${id}`)).toMatchObject({ status: "open" })
    await completeActivity(db, { uid: "u3", name: "Sara", isOwner: true }, "contractor", id)
    expect(readDoc(`activities/${id}`)).toMatchObject({ status: "done", doneById: "u3" })
  })

  it("a closed one cannot be finished, moved or cancelled again", async () => {
    await completeActivity(db, mona, "contractor", id)
    await expect(completeActivity(db, mona, "contractor", id)).rejects.toMatchObject({ code: "closed" })
    await expect(rescheduleActivity(db, mona, id, later(5))).rejects.toMatchObject({ code: "closed" })
    await expect(cancelActivity(db, mona, id)).rejects.toMatchObject({ code: "closed" })
  })

  it("moves the date to today or later only", async () => {
    await rescheduleActivity(db, mona, id, later(7))
    expect(readDoc(`activities/${id}`)).toMatchObject({ dueOn: later(7), status: "open" })
    await expect(rescheduleActivity(db, mona, id, later(-1))).rejects.toMatchObject({ code: "blocked", blocks: ["past_due"] })
    expect(readDoc(`activities/${id}`)).toMatchObject({ dueOn: later(7) })
  })

  it("cancelling keeps it on file, closed", async () => {
    await cancelActivity(db, omar, id)
    expect(readDoc(`activities/${id}`)).toMatchObject({ status: "cancelled", doneById: "u2" })
    expect(all()).toHaveLength(1)
  })

  it("a missing one is reported, not invented", async () => {
    await expect(completeActivity(db, mona, "contractor", "nope")).rejects.toBeInstanceOf(ActivityError)
    await expect(completeActivity(db, mona, "contractor", "nope")).rejects.toMatchObject({ code: "missing" })
  })

  it("keeps the outcome to 1000 characters", async () => {
    await expect(completeActivity(db, mona, "contractor", id, "x".repeat(1001))).rejects.toMatchObject({ blocks: ["note_long"] })
  })
})
