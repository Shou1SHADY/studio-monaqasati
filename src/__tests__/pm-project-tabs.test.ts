/**
 * A project's screens grouped as the PM 1.0 prototype groups them: seven tabs
 * in a fixed order, each screen under one of them, empty groups hidden, and an
 * unknown screen falling under File rather than disappearing.
 */

import { groupOf, groupTabs, PROJECT_GROUPS } from "@/lib/pm/project-tabs"

describe("the project's seven tabs", () => {
  it("reads in the prototype's order", () => {
    expect(PROJECT_GROUPS).toEqual(["pulse", "contract", "exec", "supply", "money", "file", "settings"])
  })

  it("puts every screen under its group, an unknown one under File", () => {
    expect(groupOf("pmToday")).toBe("pulse")
    expect(groupOf("boq")).toBe("contract")
    expect(groupOf("pmMeasure")).toBe("exec")
    expect(groupOf("rfqs")).toBe("supply")
    expect(groupOf("ipc")).toBe("money")
    expect(groupOf("team")).toBe("settings")
    expect(groupOf("somethingNew")).toBe("file")
  })

  it("keeps the given order inside a group and hides the empty ones", () => {
    const tabs = [{ key: "info" }, { key: "boq" }, { key: "pmVo" }, { key: "rfqs" }, { key: "team" }]
    expect(groupTabs(tabs).map((g) => [g.group, g.tabs.map((t) => t.key)])).toEqual([
      ["contract", ["boq", "pmVo"]],
      ["supply", ["rfqs"]],
      ["file", ["info"]],
      ["settings", ["team"]],
    ])
  })
})
