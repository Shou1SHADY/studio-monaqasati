/**
 * Activities (DEV-69, the Odoo "My activities"): the pure rules — which bucket a
 * due date falls in, how a person's list is grouped and ordered, what blocks a
 * new one, and who may change an open one.
 */
import {
  activityBlocks,
  activityFromDoc,
  bucketOf,
  countsOf,
  daysBetween,
  dueLabel,
  forRecord,
  groupMine,
  mayManage,
  recentlyDone,
  rescheduleBlock,
  targetKeyOf,
  type Activity,
} from "@/lib/activities"

const TODAY = "2026-10-05"

const act = (over: Partial<Activity> = {}): Activity => ({
  id: "a1",
  organizationId: "org",
  type: "todo",
  summary: "Call the supplier",
  note: null,
  dueOn: TODAY,
  assigneeId: "u1",
  assigneeName: "Mona",
  createdById: "u2",
  createdByName: "Omar",
  status: "open",
  target: null,
  targetKey: null,
  ...over,
})

describe("due dates", () => {
  it("counts whole days, negative when the date has passed", () => {
    expect(daysBetween("2026-10-05", "2026-10-08")).toBe(3)
    expect(daysBetween("2026-10-05", "2026-10-02")).toBe(-3)
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1)
  })

  it("puts a day before today in overdue, today in today, after in planned", () => {
    expect(bucketOf({ dueOn: "2026-10-04" }, TODAY)).toBe("overdue")
    expect(bucketOf({ dueOn: TODAY }, TODAY)).toBe("today")
    expect(bucketOf({ dueOn: "2026-10-06" }, TODAY)).toBe("planned")
  })

  it("says how far away it is", () => {
    expect(dueLabel({ dueOn: "2026-10-02" }, TODAY)).toEqual({ kind: "overdue", days: 3 })
    expect(dueLabel({ dueOn: TODAY }, TODAY)).toEqual({ kind: "today", days: 0 })
    expect(dueLabel({ dueOn: "2026-10-06" }, TODAY)).toEqual({ kind: "tomorrow", days: 1 })
    expect(dueLabel({ dueOn: "2026-10-12" }, TODAY)).toEqual({ kind: "in", days: 7 })
  })
})

describe("a person's list", () => {
  const all = [
    act({ id: "late-2", summary: "B", dueOn: "2026-10-03" }),
    act({ id: "late-1", summary: "A", dueOn: "2026-10-01" }),
    act({ id: "now", dueOn: TODAY }),
    act({ id: "next", dueOn: "2026-10-09" }),
    act({ id: "other", assigneeId: "u9", dueOn: "2026-10-01" }),
    act({ id: "closed", status: "done", doneOn: TODAY }),
    act({ id: "gone", status: "cancelled" }),
  ]

  it("holds only my open ones, grouped, the oldest overdue first", () => {
    const g = groupMine(all, "u1", TODAY)
    expect(g.overdue.map((a) => a.id)).toEqual(["late-1", "late-2"])
    expect(g.today.map((a) => a.id)).toEqual(["now"])
    expect(g.planned.map((a) => a.id)).toEqual(["next"])
  })

  it("counts what needs attention as overdue plus today", () => {
    expect(countsOf(groupMine(all, "u1", TODAY))).toEqual({ overdue: 2, today: 1, planned: 1, due: 3 })
    expect(countsOf(groupMine([], "u1", TODAY))).toEqual({ overdue: 0, today: 0, planned: 0, due: 0 })
  })

  it("lists what was done lately, newest first, and limits it", () => {
    const done = [
      act({ id: "d1", status: "done", doneOn: "2026-10-01" }),
      act({ id: "d2", status: "done", doneOn: "2026-10-04" }),
      act({ id: "open" }),
      act({ id: "d3", status: "done", doneOn: "2026-10-03" }),
    ]
    expect(recentlyDone(done).map((a) => a.id)).toEqual(["d2", "d3", "d1"])
    expect(recentlyDone(done, 2).map((a) => a.id)).toEqual(["d2", "d3"])
  })
})

describe("a document's own follow-ups", () => {
  const key = targetKeyOf({ kind: "po", id: "po1" })
  it("builds the key from kind and id", () => {
    expect(key).toBe("po:po1")
    expect(targetKeyOf(null)).toBeNull()
  })

  it("lists open ones by date first, then the closed ones, newest first", () => {
    const rows = forRecord(
      [
        act({ id: "c-old", targetKey: key, status: "done", doneOn: "2026-09-20" }),
        act({ id: "o-late", targetKey: key, dueOn: "2026-10-09" }),
        act({ id: "elsewhere", targetKey: "po:po2" }),
        act({ id: "c-new", targetKey: key, status: "cancelled", doneOn: "2026-10-02" }),
        act({ id: "o-soon", targetKey: key, dueOn: "2026-10-06" }),
      ],
      key as string
    )
    expect(rows.map((a) => a.id)).toEqual(["o-soon", "o-late", "c-new", "c-old"])
  })
})

describe("what blocks a new activity", () => {
  const ok = { type: "call", summary: "Ring him", dueOn: TODAY, assigneeId: "u1", today: TODAY }

  it("lets a complete one through, due today included", () => {
    expect(activityBlocks(ok)).toEqual([])
  })

  it("asks for what, a known type, a real date not in the past, and an owner", () => {
    expect(activityBlocks({ ...ok, summary: "   " })).toEqual(["no_summary"])
    expect(activityBlocks({ ...ok, type: "fax" })).toEqual(["bad_type"])
    expect(activityBlocks({ ...ok, dueOn: "yesterday" })).toEqual(["bad_due"])
    expect(activityBlocks({ ...ok, dueOn: "2026-10-04" })).toEqual(["past_due"])
    expect(activityBlocks({ ...ok, assigneeId: " " })).toEqual(["no_assignee"])
  })

  it("keeps the description and the note short", () => {
    expect(activityBlocks({ ...ok, summary: "x".repeat(121) })).toEqual(["summary_long"])
    expect(activityBlocks({ ...ok, summary: "x".repeat(120) })).toEqual([])
    expect(activityBlocks({ ...ok, note: "n".repeat(1001) })).toEqual(["note_long"])
  })

  it("moves a date to today or later only", () => {
    expect(rescheduleBlock(TODAY, TODAY)).toBeNull()
    expect(rescheduleBlock("2026-10-04", TODAY)).toBe("past_due")
    expect(rescheduleBlock("", TODAY)).toBe("bad_due")
  })
})

describe("who may change an open activity", () => {
  it("is the assignee, the one who planned it, or the owner — never anyone else", () => {
    const a = act()
    expect(mayManage(a, "u1", false)).toBe(true)
    expect(mayManage(a, "u2", false)).toBe(true)
    expect(mayManage(a, "u3", false)).toBe(false)
    expect(mayManage(a, "u3", true)).toBe(true)
  })

  it("is nobody once it is closed", () => {
    expect(mayManage(act({ status: "done" }), "u1", true)).toBe(false)
    expect(mayManage(act({ status: "cancelled" }), "u2", true)).toBe(false)
  })
})

describe("reading a stored document", () => {
  it("fills what is missing and keeps what is there", () => {
    const a = activityFromDoc("x", { organizationId: "org", type: "weird", summary: "S", dueOn: TODAY, assigneeId: "u1", status: "nope", target: { kind: "po", id: "p", label: "PO", href: "/h" }, targetKey: "po:p" })
    expect(a).toMatchObject({ id: "x", type: "todo", status: "open", note: null, feedback: null, targetKey: "po:p", target: { id: "p" } })
    expect(activityFromDoc("y", { target: {} }).target).toBeNull()
  })
})
