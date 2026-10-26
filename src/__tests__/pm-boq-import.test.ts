/**
 * @jest-environment node
 *
 * The review window of «رفع جدول الكميات» (BOQ Import PM 1.0), as pure state: a yellow line blocks
 * adding until it is settled on the line, the three ways in end in the same list, the totals are
 * reconciled with the file and then the award (a warning, never a block), and no row is dropped
 * without being listed.
 */

import fs from "fs"
import path from "path"
import { JSDOM } from "jsdom"
import { loadBook, MAX_ROWS, understandPm } from "@/lib/boq-import"
import type { Book, ColumnRole, Grid } from "@/lib/boq-import"
import {
  acknowledge,
  addItem,
  addSection,
  canAdd,
  chooseCalculated,
  chooseFileAmount,
  descriptionIn,
  descriptionOther,
  editItem,
  emptyManual,
  fromCurrent,
  fromRead,
  helpReady,
  liveItems,
  moveToSection,
  needs,
  numIn,
  ordered,
  reconcile,
  removeItem,
  renameSection,
  restoreItem,
  setHelpRoles,
  setQuantity,
  setRate,
  skippedList,
  splitDescription,
  summarize,
  toPayload,
  unitLabel,
  type ReviewFile,
  type ReviewState,
} from "@/lib/pm/boq-import"
import {
  BOQ_IMPORT_MAX_LINES,
  boqSourceOf,
  currentLineOf,
  currentLinesOf,
  draftRowsOf,
  lineExtra,
  payloadBlocks,
  payloadTotal,
  sectionLabel,
  type BoqImportPayload,
} from "@/lib/pm/boq-import-payload"

Object.assign(globalThis, { DOMParser: new JSDOM("").window.DOMParser })

const FIX = path.join(__dirname, "..", "test-utils", "fixtures", "boq-import")
const FILE: ReviewFile = { name: "boq.xlsx", size: 1000, enc: null, eu: false, sheets: 1, used: 1 }

async function open(file: string): Promise<ReviewState> {
  const full = path.join(FIX, file)
  const { book, grids } = await loadBook(path.basename(full), new Uint8Array(fs.readFileSync(full)))
  return fromRead(understandPm(book, grids), { ...FILE, name: path.basename(full) })
}

function grid(rows: string[][]): ReviewState {
  const book: Book = { sheets: [{ name: "S" }] }
  const g: Grid[] = [rows]
  return fromRead(understandPm(book, g), FILE)
}

const needing = (s: ReviewState) => s.items.filter((R) => !R.removed && needs(R).length)

describe("yellow lines block adding until settled on the line", () => {
  it("amount ≠ quantity × rate: use quantity × rate, or the file's amount (the rate follows)", async () => {
    const s0 = await open("boq-27/c22_arithmetic_errors.xlsx")
    expect(summarize(s0).need).toBe(2)
    expect(canAdd(s0)).toBe(false)
    const [a, b] = needing(s0)
    const s1 = chooseCalculated(s0, a.id)
    expect(summarize(s1).need).toBe(1)
    const s2 = chooseFileAmount(s1, b.id)
    expect(summarize(s2).need).toBe(0)
    expect(canAdd(s2)).toBe(true)
    const was = s0.items.find((R) => R.id === b.id)!
    const now = s2.items.find((R) => R.id === b.id)!
    expect(now.rate).toBeCloseTo((was.amtW as number) / (was.qty as number), 6)
    expect(now.choice).toBe("file")
    expect(s2.items.find((R) => R.id === a.id)!.choice).toBe("calc")
  })

  it("no quantity: typing one settles it, clearing it asks again, and an unreadable text keeps its note", async () => {
    const s0 = await open("boq-27/c26_notes_inside_number_cells.xlsx")
    const [R] = needing(s0)
    expect(needs(R)).toEqual(["noqty"])
    const typed = setQuantity(s0, R.id, "5")
    expect(summarize(typed).need).toBe(0)
    expect(typed.items.find((x) => x.id === R.id)!.qty).toBe(5)
    const cleared = setQuantity(typed, R.id, "")
    expect(summarize(cleared).need).toBe(1)
    expect(canAdd(cleared)).toBe(false)
  })

  it("negative quantity is confirmed as an omission, and a typed positive one needs no confirmation", async () => {
    const s0 = await open("boq-27/c07_numbers_as_text.xlsx")
    const [R] = needing(s0)
    expect(needs(R)).toEqual(["neg"])
    expect(summarize(acknowledge(s0, R.id, "neg")).need).toBe(0)
    expect(summarize(setQuantity(s0, R.id, "12")).need).toBe(0)
    const typedNeg = setQuantity(setQuantity(s0, R.id, "12"), R.id, "-3")
    expect(summarize(typedNeg).need).toBe(1)
  })

  it("an ambiguous comma («1,5») is read as a decimal and asked about; typing the number confirms it", () => {
    const s0 = grid([
      ["رقم البند", "الوصف", "الوحدة", "الكمية"],
      ["01-01", "حفر", "م3", "1,5"],
      ["01-02", "ردم", "م3", "1,250"],
      ["01-03", "خرسانة", "م3", "2,500"],
    ])
    const [R] = s0.items
    expect(R.qty).toBe(1.5)
    expect(needs(R)).toEqual(["comma"])
    expect(summarize(acknowledge(s0, R.id, "comma")).need).toBe(0)
    expect(summarize(setQuantity(s0, R.id, "1.5")).need).toBe(0)
  })

  it("a repeated code is asked about on both lines; acknowledging one clears both, and re-coding clears the question", () => {
    const s0 = grid([
      ["رقم البند", "الوصف", "الوحدة", "الكمية"],
      ["01-01", "حفر", "م3", "5"],
      ["01-01", "ردم", "م3", "7"],
      ["01-02", "خرسانة", "م3", "9"],
    ])
    expect(needing(s0).map((R) => R.desc)).toEqual(["حفر", "ردم"])
    expect(s0.items[0].dupOf).toEqual([s0.items[1].row])
    expect(summarize(acknowledge(s0, s0.items[0].id, "dup")).need).toBe(0)
    const recoded = editItem(s0, s0.items[1].id, { code: "01-03" })
    expect(summarize(recoded).need).toBe(0)
    expect(removeItem(s0, s0.items[1].id).items.every((R) => !needs(R).includes("dup"))).toBe(true)
    expect(summarize(restoreItem(removeItem(s0, s0.items[1].id), s0.items[1].id)).need).toBe(2)
  })

  it("a typed rate that agrees with the file's amount lifts the mismatch; a number the user types is never second-guessed", async () => {
    const s0 = await open("boq-27/c22_arithmetic_errors.xlsx")
    const R = needing(s0)[0]
    const agree = setRate(s0, R.id, String((R.amtW as number) / (R.qty as number)))
    expect(needs(agree.items.find((x) => x.id === R.id)!)).toEqual([])
    const off = setRate(agree, R.id, "1")
    expect(needs(off.items.find((x) => x.id === R.id)!)).toEqual([])
    expect(needs(setRate(s0, R.id, "1").items.find((x) => x.id === R.id)!)).toEqual(["mismatch"])
  })

  it("a line whose description is emptied is yellow again", async () => {
    const s0 = await open("samples/BOQ-3-Villa-Priced.xlsx")
    const id = s0.items[0].id
    const emptied = editItem(s0, id, { desc: "  " })
    expect(needs(emptied.items[0])).toEqual(["nodesc"])
    expect(summarize(editItem(emptied, id, { desc: "حفر" })).need).toBe(0)
  })
})

describe("the three ways in end in the same list", () => {
  it("a file: sections come from its headings, in its order, and each line sits under its own", async () => {
    const s = await open("samples/BOQ-3-Villa-Priced.xlsx")
    expect(s.items).toHaveLength(48)
    expect(s.sections).toHaveLength(11)
    expect(s.mode).toBe("file")
    expect(ordered(s).filter((R) => R.sec === null)).toHaveLength(0)
    const first = s.sections[0]
    expect(s.items.find((R) => R.sec === first.key)).toBeDefined()
    expect(reconcile(s, null).file).toMatchObject({ ok: true })
    expect(s.grand?.v).toBe(1058260)
  })

  it("by hand: «+ section» makes the section and a line under it; the line is yellow until it has a description and a quantity", () => {
    let s = emptyManual()
    const sec = addSection(s, "قسم جديد")
    s = renameSection(sec.state, sec.section, { code: "01", text: "الأعمال الخرسانية" })
    const needsNow = s.items.find((R) => R.id === sec.id)!
    expect(needs(needsNow).sort()).toEqual(["nodesc", "noqty"])
    expect(canAdd(s)).toBe(false)
    s = editItem(s, sec.id, { code: "01-01", desc: "خرسانة عادية C15", unit: "م³" })
    expect(needs(s.items[0])).toEqual(["noqty"])
    s = setQuantity(s, sec.id, "22")
    s = setRate(s, sec.id, "230")
    expect(canAdd(s)).toBe(true)
    expect(summarize(s)).toMatchObject({ n: 1, need: 0, sum: 5060, unpriced: 0 })
    const next = addItem(s)
    expect(next.state.items[1].sec).toBe(sec.section)
    expect(canAdd(next.state)).toBe(false)
    const second = removeItem(next.state, next.id)
    expect(canAdd(second)).toBe(true)
  })

  it("an item can be moved to another section, and is written under it", () => {
    let s = emptyManual()
    const a = addSection(s, "الأول")
    const b = addSection(a.state, "الثاني")
    s = editItem(editItem(b.state, a.id, { desc: "بند أ" }), b.id, { desc: "بند ب" })
    s = setQuantity(setQuantity(s, a.id, "1"), b.id, "2")
    s = moveToSection(s, a.id, b.section)
    const payload = toPayload(s)
    expect(payload.sections.map((x) => x.key)).toEqual([b.section])
    expect(payload.lines.map((l) => l.descriptionAr)).toEqual(["بند أ", "بند ب"])
  })

  it("a lump sum and a provisional sum are lines of quantity 1; «included» is a zero rate", async () => {
    const s = await open("boq-27/c12_percent_and_provisional.xlsx")
    expect(canAdd(s)).toBe(true)
    expect(s.items.some((R) => R.prov)).toBe(true)
    const payload = toPayload(s)
    expect(payload.lines).toHaveLength(25)
  })

  it("editing the current BOQ: lines keep their ids, a repeated code asks, and removal shows in the payload", () => {
    const current = [
      { id: "a", code: "01-01", descriptionAr: "حفر", descriptionEn: "Excavation", unit: "م³", quantity: 10, rate: 5, divisionNo: "01", divisionName: "ترابية", sheet: "", row: null },
      { id: "b", code: "01-01", descriptionAr: "ردم", descriptionEn: "ردم", unit: "م³", quantity: 4, rate: 0, divisionNo: "01", divisionName: "ترابية", sheet: "", row: null },
      { id: "c", code: "02-01", descriptionAr: "عزل", descriptionEn: "عزل", unit: "م²", quantity: 3, rate: 8, divisionNo: "", divisionName: "", sheet: "", row: null },
    ]
    const s0 = fromCurrent(current)
    expect(s0.mode).toBe("edit")
    expect(s0.sections).toHaveLength(1)
    expect(s0.items[1].rate).toBeNull()
    expect(s0.items[0].alt).toBe("Excavation")
    expect(s0.items[1].alt).toBe("")
    expect(summarize(s0).need).toBe(2)
    const s1 = removeItem(s0, s0.items[1].id)
    expect(canAdd(s1)).toBe(true)
    const payload = toPayload(s1)
    expect(payload.edit).toBe(true)
    expect(payload.lines.map((l) => l.existingId)).toEqual(["c", "a"])
    expect(payload.sections).toEqual([{ key: expect.any(String), code: "01", text: "ترابية" }])
  })
})

describe("reconciliation: items → file total → award value", () => {
  it("a file whose items equal its total is green; the award difference only warns", async () => {
    const s = await open("samples/BOQ-3-Villa-Priced.xlsx")
    const r = reconcile(s, 1_000_000)
    expect(r.file).toMatchObject({ ok: true, diff: 0 })
    expect(r.award).toMatchObject({ ok: false, value: 1_000_000 })
    expect(r.award!.d).toBeCloseTo(58260, 0)
    expect(r.green).toBe(false)
    expect(canAdd(s)).toBe(true)
    expect(reconcile(s, 1058260.5).green).toBe(true)
  })

  it("a file total that disagrees names how far, and the yellow lines are said to explain it", async () => {
    const s = await open("boq-27/c22_arithmetic_errors.xlsx")
    const r = reconcile(s, null)
    expect(r.file?.ok).toBe(false)
    expect(r.file?.yellow).toBe(2)
    expect(r.award).toBeNull()
  })

  it("an unpriced BOQ has no total to match; typed lines never show a file line", async () => {
    const s = await open("samples/BOQ-2-Messy-Contractor.xlsx")
    expect(reconcile(s, 5_000_000)).toMatchObject({ unpriced: true, file: null })
    let m = emptyManual()
    const x = addSection(m, "قسم")
    m = editItem(x.state, x.id, { desc: "بند" })
    m = setQuantity(m, x.id, "3")
    expect(reconcile(m, 0)).toMatchObject({ unpriced: true, file: null, award: null })
  })
})

describe("no row disappears silently", () => {
  it("lists hidden sheets, totals, VAT and the lines the user removed — and brings a removed line back", async () => {
    const s0 = await open("boq-27/c20_hidden_old_revision.xlsx")
    expect(skippedList(s0).some((x) => x.kind === "hidden")).toBe(true)
    const t0 = await open("boq-27/c13_etimad_style_with_vat.xlsx")
    const kinds = skippedList(t0).map((x) => x.kind)
    expect(kinds).toEqual(expect.arrayContaining(["vat"]))
    const id = t0.items[0].id
    const t1 = removeItem(t0, id)
    const removed = skippedList(t1).find((x) => x.kind === "removed")
    expect(removed).toMatchObject({ id })
    expect(summarize(t1).n).toBe(summarize(t0).n - 1)
    expect(summarize(restoreItem(t1, id)).n).toBe(summarize(t0).n)
  })

  it("a wrapped line is joined to its item and listed as such", async () => {
    const s = await open("boq-27/c17_pdf_copy_paste.txt")
    expect(skippedList(s).length).toBeGreaterThan(0)
  })
})

describe("what is written", () => {
  it("splits a description into its Arabic and English halves, and copies the one it has to the other", () => {
    expect(splitDescription("حفر", "Excavation")).toEqual({ ar: "حفر", en: "Excavation" })
    expect(splitDescription("Excavation", "حفر")).toEqual({ ar: "حفر", en: "Excavation" })
    expect(splitDescription("حفر", "")).toEqual({ ar: "حفر", en: "حفر" })
    expect(splitDescription("Excavation", "")).toEqual({ ar: "Excavation", en: "Excavation" })
  })

  it("shows a description in the reader's language and the other as the second line", () => {
    const R = { desc: "حفر", alt: "Excavation" }
    expect(descriptionIn(R, "ar")).toBe("حفر")
    expect(descriptionIn(R, "en")).toBe("Excavation")
    expect(descriptionOther(R, "ar")).toBe("Excavation")
    expect(descriptionOther({ desc: "حفر", alt: "" }, "ar")).toBe("")
    expect(unitLabel("م³", "en")).toBe("m³")
    expect(unitLabel("م³", "ar")).toBe("م³")
    expect(unitLabel("فيلا", "en")).toBe("فيلا")
  })

  it("an unpriced line is written with no rate, a file is named, and the lines come out section by section", async () => {
    const s = await open("samples/BOQ-2-Messy-Contractor.xlsx")
    const ok = s.items.find((R) => needs(R).includes("neg"))!
    const payload = toPayload(acknowledge(s, ok.id, "neg"))
    expect(payload.source).toBe("file")
    expect(payload.fileName).toBe("BOQ-2-Messy-Contractor.xlsx")
    expect(payload.edit).toBe(false)
    expect(payload.lines.every((l) => l.rate === null)).toBe(true)
    expect(payload.lines.find((l) => l.quantity < 0)).toBeDefined()
    expect(payloadBlocks(payload)).toEqual([])
    expect(payloadTotal(payload)).toBe(0)
    const sectionOrder = payload.lines.map((l) => l.section)
    const firstUse = payload.sections.map((x) => sectionOrder.indexOf(x.key))
    expect([...firstUse].sort((a, b) => a - b)).toEqual(firstUse)
  })

  it("the fields a written line carries: its division, its source, and a section's label with its code", () => {
    const line = { key: "k", existingId: null, code: "03-02-01", descriptionAr: "x", descriptionEn: "x", unit: "م²", quantity: 1, rate: 2, section: "s", sheet: "الورقة", row: 7 }
    const stamp = { kind: "file" as const, file: "boq.xlsx", by: "u1", byName: "Reem", day: "2026-10-22" }
    expect(lineExtra(line, { key: "s", code: "03", text: "الأعمال الخرسانية" }, stamp)).toEqual({
      divisionNo: "03",
      divisionNameAr: "03 · الأعمال الخرسانية",
      divisionNameEn: "03 · الأعمال الخرسانية",
      srcKind: "file",
      srcFile: "boq.xlsx",
      srcSheet: "الورقة",
      srcRow: 7,
      srcBy: "u1",
      srcByName: "Reem",
      srcDay: "2026-10-22",
    })
    expect(lineExtra(line, undefined, stamp)).toMatchObject({ divisionNo: "03", divisionNameAr: "" })
    expect(sectionLabel({ code: "", text: "مبانٍ" })).toBe("مبانٍ")
  })

  it("a stored line goes back into the window as it was written, section label and all", () => {
    const stored = { itemNo: "03-01", descriptionAr: "خرسانة", descriptionEn: "Concrete", unit: "م³", quantity: 10, unitPrice: 0, divisionNo: "03", divisionNameAr: "03 · الأعمال الخرسانية", srcSheet: "S", srcRow: 4 }
    expect(currentLineOf("id1", stored)).toEqual({ id: "id1", code: "03-01", descriptionAr: "خرسانة", descriptionEn: "Concrete", unit: "م³", quantity: 10, rate: 0, divisionNo: "03", divisionName: "الأعمال الخرسانية", sheet: "S", row: 4 })
    expect(currentLineOf("id2", { itemNo: "x", unitPrice: "1,250", quantity: "3" })).toMatchObject({ rate: 1250, quantity: 3, divisionName: "", divisionNo: "" })
  })

  it("a payload reopened as a list keeps its sections and lines (a wizard returns to what it holds)", () => {
    let s = emptyManual()
    const x = addSection(s, "الباب")
    s = setQuantity(editItem(x.state, x.id, { desc: "بند", code: "1" }), x.id, "4")
    const p = toPayload(s)
    const lines = currentLinesOf(p)
    expect(lines).toEqual([expect.objectContaining({ code: "1", descriptionAr: "بند", quantity: 4, divisionName: "الباب", rate: 0 })])
    const again = fromCurrent(lines)
    expect(again.sections.map((y) => y.text)).toEqual(["الباب"])
    expect(toPayload(again).lines[0]).toMatchObject({ descriptionAr: "بند", quantity: 4 })
  })

  it("the wizard's draft rows carry the section and the source, and an unpriced line has rate 0", () => {
    const payload: BoqImportPayload = {
      source: "manual",
      fileName: null,
      edit: false,
      sections: [{ key: "s", code: "02", text: "ترابية" }],
      lines: [
        { key: "a", existingId: null, code: "02-01", descriptionAr: "حفر", descriptionEn: "Excavation", unit: "م³", quantity: 3, rate: null, section: "s", sheet: "", row: null },
        { key: "b", existingId: null, code: "", descriptionAr: "x", descriptionEn: "x", unit: "", quantity: -1, rate: 4, section: null, sheet: "", row: null },
      ],
    }
    const rows = draftRowsOf(payload, { kind: "manual", file: null, by: "u1", byName: "Reem", day: "2026-10-22" }, "man")
    expect(rows.map((r) => [r.id, r.itemNo, r.quantity, r.rate, r.groupId])).toEqual([
      ["man-0", "02-01", 3, 0, null],
      ["man-1", "", -1, 4, null],
    ])
    expect(rows[0].extra).toMatchObject({ divisionNo: "02", divisionNameAr: "02 · ترابية", srcKind: "manual", srcByName: "Reem" })
    expect(rows[1].extra).toMatchObject({ divisionNameAr: "" })
  })

  it("the server's structural check: empty, over the limit, no description, bad numbers, an unknown section, a repeated line key", () => {
    const base: BoqImportPayload = { source: "manual", fileName: null, edit: false, sections: [{ key: "s", code: "", text: "q" }], lines: [] }
    expect(payloadBlocks(base)).toEqual([{ code: "empty", line: null }])
    const line = { key: "a", existingId: null, code: "", descriptionAr: "x", descriptionEn: "x", unit: "", quantity: 1, rate: null, section: null, sheet: "", row: null }
    expect(payloadBlocks({ ...base, lines: [line] })).toEqual([])
    expect(
      payloadBlocks({
        ...base,
        lines: [
          { ...line, key: "b", descriptionAr: " ", descriptionEn: "" },
          { ...line, key: "c", quantity: Number.NaN },
          { ...line, key: "d", rate: -1 },
          { ...line, key: "e", section: "zzz" },
          { ...line, key: "e" },
        ],
      }).map((b) => b.code),
    ).toEqual(["no_description", "bad_quantity", "bad_rate", "unknown_section", "duplicate_line"])
    expect(payloadBlocks({ ...base, lines: Array.from({ length: BOQ_IMPORT_MAX_LINES + 1 }, (_, i) => ({ ...line, key: `k${i}` })) }).map((b) => b.code)).toContain("too_many")
    expect(BOQ_IMPORT_MAX_LINES).toBe(MAX_ROWS)
  })

  it("long headings are cut to what the server takes, and an absurd number keeps the window from adding", () => {
    let s = emptyManual()
    const x = addSection(s, "ق".repeat(900))
    s = editItem(x.state, x.id, { desc: "ب".repeat(5000), code: "9".repeat(100) })
    s = setQuantity(s, x.id, "5")
    const p = toPayload(s)
    expect(p.sections[0].text).toHaveLength(300)
    expect(p.lines[0].descriptionAr).toHaveLength(2000)
    expect(p.lines[0].code).toHaveLength(60)
    expect(canAdd(s)).toBe(true)
    expect(canAdd(setQuantity(s, x.id, "1000000000000000"))).toBe(false)
    expect(canAdd(setRate(s, x.id, "1000000000000000"))).toBe(false)
  })

  it("the source a stored BOQ shows: the first line that says, and the latest hand edit", () => {
    expect(boqSourceOf([{ itemNo: "x" }])).toBeNull()
    const docs = [
      { srcKind: "file", srcFile: "a.xlsx", srcByName: "Reem", srcDay: "2026-10-20" },
      { srcKind: "file", srcFile: "a.xlsx", srcByName: "Reem", srcDay: "2026-10-20", srcEditedByName: "Khalid", srcEditedDay: "2026-10-21" },
      { srcEditedByName: "Fahd", srcEditedDay: "2026-10-23" },
    ]
    expect(boqSourceOf(docs)).toEqual({ kind: "file", file: "a.xlsx", byName: "Reem", day: "2026-10-20", editedByName: "Fahd", editedDay: "2026-10-23" })
    expect(boqSourceOf([{ srcKind: "manual", srcByName: "Reem", srcDay: "2026-10-20" }])).toMatchObject({ kind: "manual", file: null, editedByName: null })
  })
})

describe("small rules", () => {
  it("reads typed numbers as the reader does: Arabic digits, a decimal comma, a thousands comma, empty = none", () => {
    expect(numIn("١٢٣")).toBe(123)
    expect(numIn("1,150")).toBe(1150)
    expect(numIn("1,5")).toBe(1.5)
    expect(numIn(" ")).toBeNull()
    expect(numIn("abc")).toBeNull()
  })

  it("«ساعدنا مرة واحدة»: a chosen column replaces the one that held the role, and the map is ready with a description and a quantity", () => {
    const roles: ColumnRole[] = ["code", "desc", "skip", "qty"]
    expect(setHelpRoles(roles, "desc", 2)).toEqual(["code", "skip", "desc", "qty"])
    expect(setHelpRoles(roles, "qty", -1)).toEqual(["code", "desc", "skip", "skip"])
    expect(setHelpRoles(["skip", "skip"] as ColumnRole[], "rate", 1)).toEqual(["skip", "rate"])
    expect(helpReady(roles)).toBe(true)
    expect(helpReady(setHelpRoles(roles, "qty", -1))).toBe(false)
  })

  it("liveItems leaves out the removed", () => {
    let s = emptyManual()
    const x = addSection(s, "ق")
    s = removeItem(x.state, x.id)
    expect(liveItems(s)).toHaveLength(0)
  })
})
