// PM — what the review window hands over to be written, and what a stored line says
// about where it came from. Shared by the window (browser) and the route (server), so
// it carries no reader and no DOM: the shape, the fields a written line gets, and the
// structural check the server runs again.

import type { BoqDraftRow } from "./boq"

export const BOQ_IMPORT_MAX_LINES = 5000
const LIMIT = 1e12

export interface BoqImportSection {
  key: string
  code: string
  text: string
}

export interface BoqImportLine {
  key: string
  existingId: string | null
  code: string
  descriptionAr: string
  descriptionEn: string
  unit: string
  quantity: number
  rate: number | null
  section: string | null
  sheet: string
  row: number | null
}

export interface BoqImportPayload {
  source: "file" | "manual"
  fileName: string | null
  /** The current BOQ reopened for hand edits: lines that name an `existingId` are updated in place. */
  edit: boolean
  sections: BoqImportSection[]
  lines: BoqImportLine[]
}

export interface BoqImportStamp {
  kind: "file" | "manual"
  file: string | null
  by: string
  byName: string | null
  day: string
}

export type BoqItemExtra = Record<string, string | number | boolean | null>

export interface CurrentBoqLine {
  id: string
  code: string
  descriptionAr: string
  descriptionEn: string
  unit: string
  quantity: number
  rate: number
  divisionNo: string
  divisionName: string
  sheet: string
  row: number | null
}

export const sectionLabel = (s: Pick<BoqImportSection, "code" | "text">): string => (s.code ? `${s.code} · ${s.text}` : s.text)

const divisionOf = (code: string) => code.split(/[-.]/)[0] || ""

/** A section is a division on the stored line; a line with none keeps its code's own prefix. */
export function divisionExtra(line: Pick<BoqImportLine, "code">, section: BoqImportSection | undefined): BoqItemExtra {
  const name = section ? sectionLabel(section) : ""
  return { divisionNo: section ? section.code || divisionOf(line.code) : divisionOf(line.code), divisionNameAr: name, divisionNameEn: name }
}

export function sourceExtra(line: Pick<BoqImportLine, "sheet" | "row">, stamp: BoqImportStamp): BoqItemExtra {
  return { srcKind: stamp.kind, srcFile: stamp.file, srcSheet: line.sheet, srcRow: line.row, srcBy: stamp.by, srcByName: stamp.byName, srcDay: stamp.day }
}

/** The section and source fields a written line carries, beside its own quantity and rate. */
export const lineExtra = (line: BoqImportLine, section: BoqImportSection | undefined, stamp: BoqImportStamp): BoqItemExtra => ({ ...divisionExtra(line, section), ...sourceExtra(line, stamp) })

export interface PayloadBlock {
  code: "empty" | "too_many" | "no_description" | "bad_quantity" | "bad_rate" | "unknown_section" | "duplicate_line"
  line: number | null
}

/** What the server checks again: the shape, never the decisions a user took on a yellow line. */
export function payloadBlocks(p: BoqImportPayload): PayloadBlock[] {
  const out: PayloadBlock[] = []
  if (p.lines.length === 0) out.push({ code: "empty", line: null })
  if (p.lines.length > BOQ_IMPORT_MAX_LINES) out.push({ code: "too_many", line: null })
  const sections = new Set(p.sections.map((s) => s.key))
  const keys = new Set<string>()
  p.lines.forEach((l, i) => {
    if (!l.descriptionAr.trim() && !l.descriptionEn.trim()) out.push({ code: "no_description", line: i })
    if (!Number.isFinite(l.quantity) || Math.abs(l.quantity) > LIMIT) out.push({ code: "bad_quantity", line: i })
    if (l.rate !== null && !(Number.isFinite(l.rate) && l.rate >= 0 && l.rate <= LIMIT)) out.push({ code: "bad_rate", line: i })
    if (l.section && !sections.has(l.section)) out.push({ code: "unknown_section", line: i })
    if (keys.has(l.key)) out.push({ code: "duplicate_line", line: i })
    keys.add(l.key)
  })
  return out
}

/** A payload as the list the window edits — a wizard returns to the lines it already holds. */
export function currentLinesOf(p: BoqImportPayload): CurrentBoqLine[] {
  const sections = new Map(p.sections.map((s) => [s.key, s]))
  return p.lines.map((l) => {
    const s = l.section ? sections.get(l.section) : undefined
    return { id: l.key, code: l.code, descriptionAr: l.descriptionAr, descriptionEn: l.descriptionEn, unit: l.unit, quantity: l.quantity, rate: l.rate ?? 0, divisionNo: s?.code ?? "", divisionName: s?.text ?? "", sheet: l.sheet, row: l.row }
  })
}

export const payloadTotal = (p: BoqImportPayload): number => p.lines.reduce((a, l) => a + l.quantity * (l.rate ?? 0), 0)

// ---------------------------------------------------------------------------
// The source a stored BOQ shows
// ---------------------------------------------------------------------------

export interface BoqSourceInfo {
  kind: "file" | "manual"
  file: string | null
  byName: string | null
  day: string | null
  editedByName: string | null
  editedDay: string | null
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null)

/** Where the lines came from, read off the stored lines themselves: the first line that says, and the latest hand edit. */
export function boqSourceOf(docs: ReadonlyArray<Record<string, unknown>>): BoqSourceInfo | null {
  const first = docs.find((d) => d.srcKind === "file" || d.srcKind === "manual")
  if (!first) return null
  const edited = docs.filter((d) => str(d.srcEditedDay)).sort((a, b) => String(b.srcEditedDay).localeCompare(String(a.srcEditedDay)))[0]
  return {
    kind: first.srcKind === "file" ? "file" : "manual",
    file: str(first.srcFile),
    byName: str(first.srcByName),
    day: str(first.srcDay),
    editedByName: edited ? str(edited.srcEditedByName) : null,
    editedDay: edited ? str(edited.srcEditedDay) : null,
  }
}

/** The stored line as the editing window reads it. */
export function currentLineOf(id: string, d: Record<string, unknown>): CurrentBoqLine {
  const text = (v: unknown) => (typeof v === "string" ? v : "")
  const number = (v: unknown) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
    return Number.isFinite(n) ? n : 0
  }
  const divisionNo = text(d.divisionNo)
  let name = text(d.divisionNameAr) || text(d.divisionNameEn)
  if (divisionNo && name.startsWith(`${divisionNo} · `)) name = name.slice(divisionNo.length + 3)
  return {
    id,
    code: text(d.itemNo),
    descriptionAr: text(d.descriptionAr),
    descriptionEn: text(d.descriptionEn),
    unit: text(d.unit),
    quantity: number(d.quantity),
    rate: number(d.unitPrice),
    divisionNo: name ? divisionNo : "",
    divisionName: name,
    sheet: text(d.srcSheet),
    row: typeof d.srcRow === "number" ? d.srcRow : null,
  }
}

/** The new-project wizard holds its lines as draft rows; each carries the section and source fields it will be written with. */
export function draftRowsOf(p: BoqImportPayload, stamp: BoqImportStamp, idPrefix: string): BoqDraftRow[] {
  const sections = new Map(p.sections.map((s) => [s.key, s]))
  return p.lines.map((l, i) => ({
    id: `${idPrefix}-${i}`,
    itemNo: l.code,
    descriptionAr: l.descriptionAr,
    descriptionEn: l.descriptionEn,
    unit: l.unit,
    quantity: l.quantity,
    rate: l.rate ?? 0,
    groupId: null,
    extra: lineExtra(l, l.section ? sections.get(l.section) : undefined, stamp),
  }))
}
