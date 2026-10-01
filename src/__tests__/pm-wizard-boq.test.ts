import { blankDraftRow, draftRowProblems, draftTotal, isBlankDraftRow, judgeBoqRow, withDescription, type BoqDraftRow } from "@/lib/pm/boq"
import { acceptStepBlocks } from "@/lib/pm/handover"

const row = (over: Partial<BoqDraftRow>): BoqDraftRow => ({ ...blankDraftRow("r"), ...over })

describe("wizard BOQ rows", () => {
  it("a row nothing was typed into is blank and never a problem", () => {
    expect(isBlankDraftRow(blankDraftRow("a"))).toBe(true)
    expect(draftRowProblems([blankDraftRow("a")])).toEqual([[]])
  })

  it("flags a missing description, a non-positive quantity and a negative rate", () => {
    const rows = [row({ id: "1", itemNo: "1", quantity: 0, rate: -1 }), row({ id: "2", itemNo: "2", descriptionAr: "x", quantity: 3, rate: 0 })]
    expect(draftRowProblems(rows)).toEqual([["no_description", "bad_qty", "bad_rate"], []])
  })

  it("flags a repeated item code among filled rows", () => {
    const rows = [row({ id: "1", itemNo: "A", descriptionEn: "x", quantity: 1 }), row({ id: "2", itemNo: "A", descriptionEn: "y", quantity: 1 })]
    expect(draftRowProblems(rows).map((p) => p.includes("duplicate"))).toEqual([true, true])
  })

  it("editing a description fills the other language only while it still mirrors it", () => {
    const first = withDescription(blankDraftRow("a"), "en", "Tile")
    expect(first.descriptionAr).toBe("Tile")
    const second = withDescription(first, "en", "Tiles")
    expect(second.descriptionAr).toBe("Tiles")
    const own = withDescription({ ...second, descriptionAr: "بلاط" }, "en", "Floor tiles")
    expect(own.descriptionAr).toBe("بلاط")
    expect(own.descriptionEn).toBe("Floor tiles")
  })

  it("the total ignores blank rows", () => {
    expect(draftTotal([row({ quantity: 2, rate: 10.5, descriptionAr: "x" }), blankDraftRow("b")])).toBe(21)
  })

  it("a BOQ chosen in the wizard needs at least one item, and no row may be wrong", () => {
    expect(acceptStepBlocks({ source: "man", managerUid: "u", xlItems: 0 })).toEqual(["boq_no_lines"])
    expect(acceptStepBlocks({ source: "crm", managerUid: "u", xlItems: 3, xlBad: 1 })).toEqual(["boq_bad_rows"])
    expect(acceptStepBlocks({ source: "man", managerUid: "u", xlItems: 2, xlBad: 0 })).toEqual([])
  })
})

describe("judgeBoqRow", () => {
  const good = { code: "02-01-01", description: "Concrete", unit: "m3", quantity: "10", rate: "", cost: "" }

  it("passes a valid single item", () => {
    const r = judgeBoqRow(good, [])
    expect(r.problems).toEqual([])
    expect(r.quantity).toBe(10)
  })

  it("refuses a code that another item already holds", () => {
    expect(judgeBoqRow(good, ["02-01-01"]).problems).toContain("duplicate")
  })

  it("refuses a missing quantity and description", () => {
    const r = judgeBoqRow({ ...good, quantity: "", description: "" }, [])
    expect(r.problems).toEqual(expect.arrayContaining(["bad_qty", "no_description"]))
  })
})
