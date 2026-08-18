/**
 * Unit tests for src/lib/project-status.ts
 *
 * Covers:
 *  1. PROJECT_STATUSES catalog shape
 *  2. resolveProjectStatus — legacy mapping, new-set passthrough, null/undefined fallback
 *  3. projectStatusLabelKey / PROJECT_STATUS_BADGE_CLASSES completeness
 */

import {
  PROJECT_STATUSES,
  resolveProjectStatus,
  projectStatusLabelKey,
  PROJECT_STATUS_BADGE_CLASSES,
  type ProjectStatus,
} from "../lib/project-status"

describe("PROJECT_STATUSES", () => {
  it("contains exactly the 8 kanban statuses", () => {
    expect(PROJECT_STATUSES).toEqual([
      "todo",
      "waiting_approval",
      "pricing",
      "approved_waiting_start",
      "working",
      "hold",
      "remaining_payment",
      "canceled",
    ])
  })
})

describe("resolveProjectStatus", () => {
  it("passes through any value already in the new set", () => {
    PROJECT_STATUSES.forEach((s) => {
      expect(resolveProjectStatus(s)).toBe(s)
    })
  })

  it("maps legacy 'active' to 'working'", () => {
    expect(resolveProjectStatus("active")).toBe("working")
  })

  it("maps legacy 'paused' to 'hold'", () => {
    expect(resolveProjectStatus("paused")).toBe("hold")
  })

  it("maps legacy 'completed' to 'working'", () => {
    expect(resolveProjectStatus("completed")).toBe("working")
  })

  it("falls back to 'todo' for null, undefined, empty string, or unknown values", () => {
    expect(resolveProjectStatus(null)).toBe("todo")
    expect(resolveProjectStatus(undefined)).toBe("todo")
    expect(resolveProjectStatus("")).toBe("todo")
    expect(resolveProjectStatus("some_unknown_value")).toBe("todo")
  })
})

describe("projectStatusLabelKey / PROJECT_STATUS_BADGE_CLASSES", () => {
  it("has a label key and badge class for every status", () => {
    PROJECT_STATUSES.forEach((s: ProjectStatus) => {
      expect(projectStatusLabelKey(s)).toBe(`proj_status_${s}`)
      expect(PROJECT_STATUS_BADGE_CLASSES[s]).toBeTruthy()
    })
  })
})
