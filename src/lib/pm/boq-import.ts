// PM — the review window of «رفع جدول الكميات» (BOQ Import PM 1.0). One state for the
// three ways in — a file as received, the Mdmak template, items typed by hand — and
// one set of rules: a yellow line blocks adding until it is settled on the line, the
// items are reconciled with the file's own total and then with the award value (the
// award is a warning, never a block), and no row leaves silently. Pure: no I/O. The
// reading itself is the shared reader in @/lib/boq-import.

import { amountOf, matchAward, matchesFileTotal, needs, norm, pNum, MAX_ROWS } from "@/lib/boq-import"
import type { AwardMatch, ColumnRole, FileTotal, ReadItem, ReadResult, TitleRef, WhyFlag } from "@/lib/boq-import"
import { payloadBlocks, sectionLabel, type BoqImportPayload, type CurrentBoqLine } from "./boq-import-payload"

export { sectionLabel, MAX_ROWS }
export type { BoqImportPayload, CurrentBoqLine }

export type ReviewMode = "file" | "manual" | "edit"

export interface ReviewSection {
  key: string
  code: string
  text: string
  sheet: string
  user: boolean
  renamed: boolean
}

export interface ReviewItem extends ReadItem {
  id: string
  sec: string | null
  existingId: string | null
  edited: boolean
  src0: string | null
  choice: "calc" | "file" | null
}

export interface ReviewFile {
  name: string
  size: number
  enc: string | null
  eu: boolean
  sheets: number
  used: number
}

export type SkippedKind = "hdr2" | "total" | "grand" | "vat" | "noname" | "note" | "cont" | "hidden" | "summary" | "nosheet" | "emptysheet" | "removed"

export interface SkippedEntry {
  kind: SkippedKind
  sheet: string
  row: number | null
  text: string | null
  amt: number | null
  /** A line the user removed: the id that brings it back. */
  id?: string
}

export interface ReviewState {
  mode: ReviewMode
  file: ReviewFile | null
  items: ReviewItem[]
  sections: ReviewSection[]
  grand: FileTotal | null
  skipped: SkippedEntry[]
  guess: Array<{ sheet: string; how: "content" | "swap" }>
  seq: number
}

const sectionKeyOf = (t: TitleRef): string => `t:${t.sheet}#${t.row}`

const blank = (mode: ReviewMode, file: ReviewFile | null): ReviewState => ({ mode, file, items: [], sections: [], grand: null, skipped: [], guess: [], seq: 0 })

export const emptyManual = (file: ReviewFile | null = null): ReviewState => blank("manual", file)

const SKIPPED_ROW_KINDS: string[] = ["hdr2", "total", "grand", "vat", "noname", "note"]

export function fromRead(res: ReadResult, file: ReviewFile): ReviewState {
  const sections = new Map<string, ReviewSection>()
  const add = (t: TitleRef) => {
    const key = sectionKeyOf(t)
    if (!sections.has(key)) sections.set(key, { key, code: t.code, text: t.text, sheet: t.sheet, user: false, renamed: false })
    return key
  }
  res.titles.forEach((r) => r.tobj && add(r.tobj))
  const items: ReviewItem[] = res.items.map((R, i) => ({
    ...R,
    why: [...R.why],
    ok: [...(R.ok ?? [])],
    id: `i${i}`,
    sec: R.title ? add(R.title) : null,
    existingId: null,
    edited: false,
    src0: null,
    choice: null,
  }))
  const skipped: SkippedEntry[] = []
  res.ignored.forEach((x) => {
    if (!("row" in x) || x.row == null) skipped.push({ kind: x.kind as SkippedKind, sheet: x.sheet, row: null, text: null, amt: null })
  })
  res.sheets.forEach((S) =>
    S.rows.forEach((x) => {
      if (SKIPPED_ROW_KINDS.includes(x.kind)) skipped.push({ kind: x.kind as SkippedKind, sheet: x.sheet, row: x.row, text: x.kind === "hdr2" ? null : x.desc || x.code || null, amt: x.amt ?? null })
      else if (x.kind === "cont") skipped.push({ kind: "cont", sheet: x.sheet, row: x.row, text: x.desc || null, amt: null })
    }),
  )
  return markDuplicates({ mode: "file", file, items, sections: [...sections.values()], grand: res.grand, skipped, guess: res.guess ?? [], seq: items.length })
}

/** The BOQ as it stands, reopened for hand edits (before any approved measurement). */
export function fromCurrent(lines: CurrentBoqLine[], file: ReviewFile | null = null): ReviewState {
  const sections = new Map<string, ReviewSection>()
  const items: ReviewItem[] = lines.map((b, i) => {
    let sec: string | null = null
    if (b.divisionName) {
      const key = `d:${b.divisionNo}|${b.divisionName}`
      if (!sections.has(key)) sections.set(key, { key, code: b.divisionNo, text: b.divisionName, sheet: "", user: true, renamed: false })
      sec = key
    }
    const desc = b.descriptionAr || b.descriptionEn
    return {
      ...manualBase(`i${i}`, b.sheet, sec),
      row: b.row,
      code: b.code,
      desc,
      alt: b.descriptionEn && b.descriptionEn !== desc ? b.descriptionEn : "",
      unit: b.unit,
      qty: b.quantity,
      rate: b.rate > 0 ? b.rate : null,
      why: [],
      manual: false,
      existingId: b.id,
    }
  })
  return markDuplicates({ ...blank("edit", file), items, sections: [...sections.values()], seq: items.length })
}

function manualBase(id: string, sheet: string, sec: string | null): ReviewItem {
  return {
    id,
    sec,
    sheet,
    row: null,
    code: "",
    desc: "",
    alt: "",
    spec: "",
    unitRaw: "",
    why: [],
    kind: "item",
    qRaw: "",
    unit: "",
    qty: null,
    rate: null,
    title: null,
    amtW: null,
    rateW: null,
    manual: true,
    existingId: null,
    edited: false,
    src0: null,
    choice: null,
  }
}

const replaceItem = (state: ReviewState, id: string, fn: (R: ReviewItem) => ReviewItem): ReviewState => ({ ...state, items: state.items.map((R) => (R.id === id ? fn(R) : R)) })

export const numIn = (text: string): number | null => (text.trim() === "" ? null : pNum(text, false).v)

/** Typing a quantity or a rate settles the lines the file raised and raises two it can know: none, and a negative one. A mismatch is only ever lifted — the user's own number is never second-guessed. */
function reflag(R: ReviewItem): ReviewItem {
  const why: WhyFlag[] = R.why.filter((w) => w !== "noqty" && w !== "neg")
  if (R.qty == null) why.push("noqty")
  else if (R.qty < 0) why.push("neg")
  if (why.includes("mismatch") && R.amtW != null && R.qty != null && R.rate != null && Math.abs(R.qty * R.rate - R.amtW) <= 1) why.splice(why.indexOf("mismatch"), 1)
  return { ...R, why }
}

function markDuplicates(state: ReviewState): ReviewState {
  const groups = new Map<string, number[]>()
  state.items.forEach((R, i) => {
    if (R.removed || !/\d/.test(R.code)) return
    const k = `${R.sheet}|${norm(R.code)}`
    groups.set(k, [...(groups.get(k) ?? []), i])
  })
  const items = state.items.map((R, i) => {
    const why = R.why.filter((w) => w !== "dup")
    const peers = R.removed || !/\d/.test(R.code) ? [] : (groups.get(`${R.sheet}|${norm(R.code)}`) ?? []).filter((j) => j !== i)
    if (!peers.length) return { ...R, why, dupOf: undefined }
    return { ...R, why: [...why, "dup" as WhyFlag], dupOf: peers.map((j) => state.items[j].row) }
  })
  return { ...state, items }
}

export function setQuantity(state: ReviewState, id: string, text: string): ReviewState {
  return replaceItem(state, id, (R) => {
    const qty = numIn(text)
    const why = R.qComma ? R.why.filter((w) => w !== "comma") : R.why
    return reflag({ ...R, qty, why })
  })
}

export function setRate(state: ReviewState, id: string, text: string): ReviewState {
  return replaceItem(state, id, (R) => {
    const why = R.qComma ? R.why : R.why.filter((w) => w !== "comma")
    return reflag({ ...R, rate: numIn(text), why, rateFromAmt: false, incl: false })
  })
}

const acked = (R: ReviewItem, w: WhyFlag): ReviewItem => (R.ok?.includes(w) ? R : { ...R, ok: [...(R.ok ?? []), w] })

export function chooseCalculated(state: ReviewState, id: string): ReviewState {
  return replaceItem(state, id, (R) => ({ ...acked(R, "mismatch"), choice: "calc" }))
}

export function chooseFileAmount(state: ReviewState, id: string): ReviewState {
  return replaceItem(state, id, (R) => {
    if (R.amtW == null || !R.qty) return R
    return { ...acked(reflag({ ...R, rate: R.amtW / R.qty }), "mismatch"), choice: "file" }
  })
}

export function acknowledge(state: ReviewState, id: string, why: WhyFlag): ReviewState {
  const target = state.items.find((R) => R.id === id)
  if (!target) return state
  const peers = why === "dup" ? new Set(state.items.filter((R) => R.id !== id && R.sheet === target.sheet && norm(R.code) === norm(target.code)).map((R) => R.id)) : new Set<string>()
  return { ...state, items: state.items.map((R) => (R.id === id || peers.has(R.id) ? acked(R, why) : R)) }
}

export const removeItem = (state: ReviewState, id: string): ReviewState => markDuplicates(replaceItem(state, id, (R) => ({ ...R, removed: true })))

export const restoreItem = (state: ReviewState, id: string): ReviewState => markDuplicates(replaceItem(state, id, (R) => ({ ...R, removed: false })))

const touched = (R: ReviewItem): ReviewItem => (R.edited ? R : { ...R, edited: true, src0: R.desc })

export interface ItemPatch {
  code?: string
  desc?: string
  alt?: string
  unit?: string
}

export function editItem(state: ReviewState, id: string, patch: ItemPatch): ReviewState {
  const next = replaceItem(state, id, (R) => {
    let out = touched(R)
    if (patch.code !== undefined) out = { ...out, code: patch.code }
    if (patch.alt !== undefined) out = { ...out, alt: patch.alt }
    if (patch.unit !== undefined) out = { ...out, unit: patch.unit }
    if (patch.desc !== undefined) {
      const why = out.why.filter((w) => w !== "nodesc")
      out = { ...out, desc: patch.desc, why: patch.desc.trim() ? why : [...why, "nodesc" as WhyFlag] }
    }
    return out
  })
  return patch.code === undefined ? next : markDuplicates(next)
}

export const moveToSection = (state: ReviewState, id: string, sec: string | null): ReviewState => replaceItem(state, id, (R) => ({ ...touched(R), sec }))

export function renameSection(state: ReviewState, key: string, patch: { code?: string; text?: string }): ReviewState {
  return { ...state, sections: state.sections.map((s) => (s.key === key ? { ...s, code: patch.code ?? s.code, text: patch.text ?? s.text, renamed: true } : s)) }
}

const newItem = (state: ReviewState, sec: string | null): { state: ReviewState; id: string } => {
  const id = `n${state.seq}`
  const sheet = state.items[0]?.sheet ?? ""
  const item = reflag({ ...manualBase(id, sheet, sec), why: ["nodesc"] })
  return { state: { ...state, items: [...state.items, item], seq: state.seq + 1 }, id }
}

/** A new line goes under the section of the last line still in the list, or the last section. */
export function addItem(state: ReviewState): { state: ReviewState; id: string } {
  const last = [...state.items].reverse().find((R) => !R.removed)
  return newItem(state, last ? last.sec : (state.sections[state.sections.length - 1]?.key ?? null))
}

export const nextSectionKey = (state: ReviewState): string => `u${state.seq}`

export function createSection(state: ReviewState, text: string): { state: ReviewState; section: string } {
  const key = nextSectionKey(state)
  const section: ReviewSection = { key, code: "", text, sheet: state.items[0]?.sheet ?? "", user: true, renamed: false }
  return { state: { ...state, sections: [...state.sections, section], seq: state.seq + 1 }, section: key }
}

export function addSection(state: ReviewState, text: string): { state: ReviewState; id: string; section: string } {
  const created = createSection(state, text)
  const moved = newItem(created.state, created.section)
  return { ...moved, section: created.section }
}

export const sectionOf = (state: ReviewState, key: string | null): ReviewSection | null => (key ? (state.sections.find((s) => s.key === key) ?? null) : null)

/** The list in the order it is shown and written: lines without a section, then each section in turn. */
export function ordered(state: ReviewState): ReviewItem[] {
  const rank = new Map<string | null, number>([[null, 0]])
  state.sections.forEach((s, i) => rank.set(s.key, i + 1))
  return state.items
    .map((R, i) => ({ R, i }))
    .sort((a, b) => (rank.get(a.R.sec) ?? 0) - (rank.get(b.R.sec) ?? 0) || a.i - b.i)
    .map((o) => o.R)
}

export const liveItems = (state: ReviewState): ReviewItem[] => ordered(state).filter((R) => !R.removed)

export interface ReviewSummary {
  n: number
  ready: number
  need: number
  unpriced: number
  sections: number
  sum: number
  /** Some line carries a rate: an unpriced one is then worth saying so. */
  anyPriced: boolean
}

export function summarize(state: ReviewState): ReviewSummary {
  const live = state.items.filter((R) => !R.removed)
  const need = live.filter((R) => needs(R).length).length
  const sections = new Set(live.map((R) => (R.sec ? `${R.sheet}|${R.sec}` : R.sheet))).size
  return { n: live.length, ready: live.length - need, need, unpriced: live.filter((R) => R.rate == null).length, sections, sum: live.reduce((a, R) => a + amountOf(R), 0), anyPriced: live.some((R) => R.rate != null) }
}

export const canAdd = (state: ReviewState): boolean => {
  const s = summarize(state)
  return s.n > 0 && s.need === 0 && s.n <= MAX_ROWS && payloadBlocks(toPayload(state)).length === 0
}

export interface Reconciliation {
  unpriced: boolean
  sum: number
  file: { grand: FileTotal; ok: boolean; diff: number; yellow: number } | null
  award: (AwardMatch & { value: number }) | null
  green: boolean
}

/** Items → the file's own total → the award value. The award difference warns; it never blocks. */
export function reconcile(state: ReviewState, award: number | null): Reconciliation {
  const s = summarize(state)
  const live = state.items.filter((R) => !R.removed)
  const grand = state.mode === "file" ? state.grand : null
  const fileOk = grand ? matchesFileTotal(s.sum, grand) : null
  const file = grand ? { grand, ok: fileOk === true, diff: Math.abs(grand.v - s.sum), yellow: live.filter((R) => needs(R).includes("mismatch")).length } : null
  const a = award != null && award > 0 ? { ...matchAward(s.sum, award), value: award } : null
  return { unpriced: s.n > 0 && s.unpriced === s.n, sum: s.sum, file, award: a, green: file?.ok !== false && (a?.ok ?? true) }
}

/** Rows and sheets left out, with the lines the user removed — nothing disappears without a word. */
export function skippedList(state: ReviewState): SkippedEntry[] {
  const removed = state.items.filter((R) => R.removed).map((R): SkippedEntry => ({ kind: "removed", sheet: R.sheet, row: R.row, text: [R.code, R.desc || R.alt].filter(Boolean).join(" · "), amt: null, id: R.id }))
  return [...state.skipped, ...removed]
}

/** «ساعدنا مرة واحدة»: the column chosen for a role takes it from whichever column held it before. */
export function setHelpRoles(roles: readonly ColumnRole[], role: "desc" | "qty" | "rate" | "unit", column: number): ColumnRole[] {
  const next: ColumnRole[] = roles.map((r) => (r === role ? "skip" : r))
  if (column >= 0) next[column] = role
  return next
}

export const helpReady = (roles: readonly ColumnRole[]): boolean => roles.includes("desc") && roles.includes("qty")

const UNIT_EN: Record<string, string> = { "م³": "m³", "م²": "m²", "م.ط": "lm", م: "m", طن: "ton", عدد: "no.", نقطة: "pt", مقطوعية: "LS", ساعة: "hr", يوم: "day", شهر: "month", كجم: "kg", لتر: "l" }

export const unitLabel = (unit: string, locale: string): string => (locale === "ar" ? unit : (UNIT_EN[unit] ?? unit))

const ARABIC = /[ء-ي]/
const LATIN = /[A-Za-z]/

export function descriptionIn(R: Pick<ReviewItem, "desc" | "alt">, locale: string): string {
  return locale === "ar" ? R.desc || R.alt : LATIN.test(R.alt) ? R.alt : R.desc
}

export function descriptionOther(R: Pick<ReviewItem, "desc" | "alt">, locale: string): string {
  const main = descriptionIn(R, locale)
  const other = main === R.desc ? R.alt : R.desc
  return other && other !== main ? other : ""
}

export function splitDescription(desc: string, alt: string): { ar: string; en: string } {
  const parts = [desc.trim(), alt.trim()].filter(Boolean)
  const ar = parts.find((p) => ARABIC.test(p)) ?? ""
  const en = parts.find((p) => !ARABIC.test(p)) ?? ""
  return { ar: ar || en, en: en || ar }
}

export { amountOf, needs }

// ---------------------------------------------------------------------------
// What is written
// ---------------------------------------------------------------------------

const cut = (text: string, max: number) => text.trim().slice(0, max)

/** Every text is cut to what the server accepts, so a long heading never refuses a whole BOQ. */
export function toPayload(state: ReviewState): BoqImportPayload {
  const live = liveItems(state)
  const used = new Set(live.map((R) => R.sec))
  return {
    source: state.mode === "file" ? "file" : "manual",
    fileName: state.mode === "file" && state.file ? cut(state.file.name, 300) : null,
    edit: state.mode === "edit",
    sections: state.sections.filter((s) => used.has(s.key)).map((s) => ({ key: s.key, code: cut(s.code, 60), text: cut(s.text, 300) })),
    lines: live.map((R) => {
      const { ar, en } = splitDescription(R.desc, R.alt)
      return {
        key: R.id,
        existingId: R.existingId,
        code: cut(R.code, 60),
        descriptionAr: ar.slice(0, 2000),
        descriptionEn: en.slice(0, 2000),
        unit: cut(R.unit, 40),
        quantity: R.qty ?? 0,
        rate: R.rate,
        section: R.sec,
        sheet: R.sheet.slice(0, 200),
        row: R.row,
      }
    }),
  }
}
