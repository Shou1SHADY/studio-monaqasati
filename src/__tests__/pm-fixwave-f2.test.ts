/**
 * Fix wave F (f2) — the closeout list as the prototype's closeRows, the open
 * money beneath it, the handover's retention phase, the ITP/NCR panels by
 * preset, the not-built sections list, and the subcontractor-supplied item.
 */

import { CLOSE_ROW_TAB, closeBlocks, closeoutRows, type CloseInput } from "@/lib/pm/closeout"
import { openCloseRows, openMoneyRows, shownCloseRows } from "@/lib/pm/closeout-view"
import { suppliedBySubcontractor } from "@/lib/pm/item-supply"
import { retentionPhase } from "@/lib/pm/retention-phase"
import { notBuiltYet, qualityPanelsOn, sectionsForKind } from "@/lib/pm/sections"
import { unbuiltSections } from "@/lib/pm/sections-governance"
import { SECTION_REGISTRY } from "@/lib/project-sections"

const base: CloseInput = {
  hasClient: true,
  acceptances: { prov: { on: "2026-06-01", by: "pm1" }, final: { on: "2026-09-01", by: "pm1" } },
  punch: [],
  items: [{ rate: 100, executed: 10, billed: 10 }],
  cutPool: 0,
  certificates: [],
  retentionHeld: 0,
  retentionReleased: false,
  today: "2026-09-27",
}

describe("V2-05 the closeout list follows closeRows", () => {
  it("lists «no executed work unpriced» only while the BOQ has an unpriced item", () => {
    expect(closeoutRows(base).some((r) => r.key === "unpriced")).toBe(false)
    const withUnpriced = closeoutRows({ ...base, items: [...base.items, { rate: 0, executed: 0, billed: 0 }] })
    expect(withUnpriced.find((r) => r.key === "unpriced")).toMatchObject({ ok: true, n: 0 })
    expect(closeBlocks(closeoutRows({ ...base, items: [...base.items, { rate: 0, executed: 3, billed: 0 }] })).map((r) => r.key)).toEqual(["unpriced"])
  })

  it("keeps the prototype's order: punch · ncr · unpriced · handovers · final IPC · retention", () => {
    const rows = closeoutRows({ ...base, items: [...base.items, { rate: 0, executed: 0, billed: 0 }] })
    expect(rows.map((r) => r.key)).toEqual(["punch", "ncr", "unpriced", "prov", "final", "unbilled", "retention", "in_progress", "overdue", "vo_pending"])
  })

  it("the handover rows open the File's contract details, where the handover panel is", () => {
    expect(CLOSE_ROW_TAB.prov).toBe("info")
    expect(CLOSE_ROW_TAB.final).toBe("info")
  })

  it("overdue collection, a certificate in progress and a pending priced VO are open money, not rows — still in the gate", () => {
    const rows = closeoutRows({
      ...base,
      certificates: [
        { status: "appr", net: 1000, dueOn: "2026-08-01", collected: 0 },
        { status: "sub", net: 500 },
      ],
      variations: [{ status: "wait", value: 10_000 }],
    })
    expect(closeBlocks(rows).map((r) => r.key)).toEqual(["in_progress", "overdue", "vo_pending"])
    expect(shownCloseRows(rows, true).map((r) => r.key)).toEqual(["punch", "ncr", "prov", "final", "unbilled", "retention"])
    expect(openCloseRows(rows, true)).toBe(0)
    expect(openMoneyRows(rows, true).map((r) => r.key)).toEqual(["in_progress", "overdue", "vo_pending"])
  })

  it("the site engineer sees neither the client-money rows nor the open money (the VO included)", () => {
    const rows = closeoutRows({ ...base, retentionHeld: 500, variations: [{ status: "wait", value: 10_000 }] })
    expect(shownCloseRows(rows, false).map((r) => r.key)).toEqual(["punch", "ncr", "prov", "final"])
    expect(openMoneyRows(rows, false)).toEqual([])
    expect(openCloseRows(rows, false)).toBe(0)
    expect(openCloseRows(rows, true)).toBe(1)
  })
})

describe("V4-07 where the retention stands", () => {
  it("held → half claimable (half term) → half released → claimable after final → released", () => {
    expect(retentionPhase({ acceptances: {}, release: "half" })).toBe("held")
    expect(retentionPhase({ acceptances: { prov: { on: "2026-06-01", by: "u" } }, release: "full" })).toBe("held")
    expect(retentionPhase({ acceptances: { prov: { on: "2026-06-01", by: "u" } }, release: "half" })).toBe("half_claimable")
    expect(retentionPhase({ acceptances: { prov: { on: "2026-06-01", by: "u" } }, release: "half", halfReleased: true })).toBe("half_released")
    expect(retentionPhase({ acceptances: { prov: { on: "2026-06-01", by: "u" }, final: { on: "2027-06-01", by: "u" } }, release: "half", halfReleased: true })).toBe("all_claimable")
    expect(retentionPhase({ acceptances: { prov: { on: "2026-06-01", by: "u" }, final: { on: "2027-06-01", by: "u" } }, release: "half", released: true })).toBe("released")
  })
})

describe("V3-05 ITP and NCR follow the prototype's qa section", () => {
  it("shows them on a building project, hides them on infra/road/mep/own unless records exist", () => {
    expect(qualityPanelsOn("bld", 0)).toBe(true)
    for (const k of ["infra", "road", "mep", "own", "ind", "mnt"] as const) expect(qualityPanelsOn(k, 0)).toBe(false)
    expect(qualityPanelsOn("infra", 2)).toBe(true)
  })

  it("a project with no recorded type keeps them", () => {
    expect(qualityPanelsOn(null, 0)).toBe(true)
    expect(qualityPanelsOn(undefined, undefined)).toBe(true)
  })
})

describe("V2-06 sections: cost is built and core; nothing built twice is listed as not built", () => {
  it("cost control is a built core section, on every preset", () => {
    expect(SECTION_REGISTRY.cost).toMatchObject({ status: "built", required: true, tabRoute: null })
    expect(sectionsForKind("road")).toContain("cost")
  })

  it("the «not built yet» list is empty (v21 lists none)", () => {
    expect(unbuiltSections().length).toBeGreaterThan(0)
    expect(notBuiltYet(unbuiltSections())).toEqual([])
  })
})

describe("V2-09 a material the subcontractor supplies", () => {
  const contracts = [{ lines: [{ itemId: "i1", code: "01", description: null, unit: "m2", qty: 50, rate: 20, value: 1000, certified: 0 }] }]
  it("reads as his when the item is in his scope and none of our materials is rated on it", () => {
    expect(suppliedBySubcontractor("i1", contracts, 0)).toBe(true)
    expect(suppliedBySubcontractor("i1", contracts, 1)).toBe(false)
    expect(suppliedBySubcontractor("i2", contracts, 0)).toBe(false)
    expect(suppliedBySubcontractor("i1", [], 0)).toBe(false)
  })
})
