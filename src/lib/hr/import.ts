// HR 1.0 — moving in (PRD IM-01…03, WF-02, PY-10). The HR manager downloads
// the template, fills it and uploads it; every row is validated and
// interpreted with a visible note — never invented — then reviewed as clean,
// with notes, or rejected; rejected rows are not saved. Opening balances: the
// actual join date (end of service follows from it), the leave balance today
// (capped at what could have accrued) and the outstanding advance. Imported
// staff enter payroll from the import month. Pure: no I/O.

import type { CreateEmployeeInput } from "./employee-writes"
import { docState } from "./documents"
import { openingFor } from "./leave"
import { foldSearchText } from "@/lib/search-text"
import { UNASSIGNED_SITE, type HrSite } from "./sites"
import { daysBetween } from "./statutory"
import { NATIONALITIES, TRADES, type NationalityCode } from "./trades"

/** The template: the prototype's fourteen columns, plus the ID number the Mudad and GOSI rows are keyed by. */
export const IMPORT_COLUMNS = [
  "name_ar",
  "name_en",
  "id_no",
  "nationality",
  "gender",
  "trade",
  "workplace",
  "join_date",
  "basic",
  "iqama_expiry",
  "passport_expiry",
  "insurance_expiry",
  "iban",
  "leave_balance",
  "advance_balance",
] as const
export type ImportColumn = (typeof IMPORT_COLUMNS)[number]

export const templateCsv = (headers: Record<ImportColumn, string>) =>
  "﻿" + IMPORT_COLUMNS.join(",") + "\r\n" + IMPORT_COLUMNS.map((c) => `"${headers[c].replace(/"/g, '""')}"`).join(",") + "\r\n"

/** A CSV (comma or semicolon, quoted fields, BOM) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  const src = text.replace(/^﻿/, "")
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === "," || ch === ";") {
      row.push(cell.trim())
      cell = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++
      row.push(cell.trim())
      if (row.some((c) => c !== "")) rows.push(row)
      row = []
      cell = ""
    } else cell += ch
  }
  row.push(cell.trim())
  if (row.some((c) => c !== "")) rows.push(row)
  return rows
}

export interface ImportNote {
  key: string
  params?: Record<string, string | number>
}

export interface ImportRow {
  line: number
  status: "clean" | "notes" | "rejected"
  notes: ImportNote[]
  errors: ImportNote[]
  input: (CreateEmployeeInput & { since: string; openingLeave: number; advanceBalance: number }) | null
  display: { name: string; trade: string | null; site: string | null }
}

export interface ImportContext {
  today: string
  sites: HrSite[]
  existing: Array<{ idNo?: string | null; names?: { en?: string | null; ar?: string } | null; join: string }>
  /** Label → key, in both languages, from the translations (interpretation). */
  tradeLabels: Record<string, string>
  nationalityLabels: Record<string, string>
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

/**
 * What a file writes in the nationality column: the country or its adjective,
 * in Arabic or English, whatever language the screen is in (the delivered
 * template writes "بنغلاديش" and "السعودية"). Compared folded — أ/ا, ة/ه, the case.
 */
const NATIONALITY_NAMES: Record<NationalityCode, string[]> = {
  sa: ["السعودية", "المملكة العربية السعودية", "سعودي", "سعودية", "saudi", "saudi arabia", "ksa"],
  eg: ["مصر", "مصري", "مصرية", "egypt", "egyptian"],
  in: ["الهند", "هندي", "هندية", "india", "indian"],
  pk: ["باكستان", "باكستاني", "باكستانية", "pakistan", "pakistani"],
  bd: ["بنغلاديش", "بنجلاديش", "بنغلادش", "بنغلاديشي", "بنغالي", "bangladesh", "bangladeshi"],
  ye: ["اليمن", "يمني", "يمنية", "yemen", "yemeni"],
  sd: ["السودان", "سوداني", "سودانية", "sudan", "sudanese"],
  ph: ["الفلبين", "فلبيني", "فلبينية", "philippines", "philippine", "filipino", "filipina"],
  np: ["نيبال", "نيبالي", "نيبالية", "nepal", "nepali", "nepalese"],
  sy: ["سوريا", "سورية", "سوري", "syria", "syrian"],
  jo: ["الأردن", "أردني", "أردنية", "jordan", "jordanian"],
  lb: ["لبنان", "لبناني", "لبنانية", "lebanon", "lebanese"],
}
const NATIONALITY_BY_NAME = new Map<string, NationalityCode>(
  (Object.entries(NATIONALITY_NAMES) as Array<[NationalityCode, string[]]>).flatMap(([code, names]) => names.map((n) => [foldSearchText(n), code] as [string, NationalityCode]))
)

function findNationality(v: string, labels: Record<string, string>): string | null {
  const raw = v.trim()
  if (!raw) return null
  if (NATIONALITIES.includes(raw.toLowerCase() as NationalityCode)) return raw.toLowerCase()
  return labels[norm(raw)] ?? NATIONALITY_BY_NAME.get(foldSearchText(raw)) ?? null
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** YYYY-MM-DD, or DD/MM/YYYY — anything else is not a date. */
export function parseDay(v: string): string | null {
  const s = v.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  const iso = (y: string, mo: string, d: string) => `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`
  let out: string | null = null
  if (m) out = iso(m[1], m[2], m[3])
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) out = iso(m[3], m[2], m[1])
  if (!out) return null
  const t = Date.parse(`${out}T00:00:00Z`)
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== out ? null : out
}

function findTrade(v: string, labels: Record<string, string>): { key: string; interpreted: boolean } | null {
  const n = norm(v)
  if (!n) return null
  const exact = TRADES.find((t) => t.key.toLowerCase() === n) ?? TRADES.find((t) => t.key === labels[n])
  if (exact) return { key: exact.key, interpreted: false }
  // IM-03 — the nearest trade, with a note; never a guess beyond two letters.
  let best: { key: string; d: number } | null = null
  for (const [label, key] of [...Object.entries(labels), ...TRADES.map((t) => [t.key.toLowerCase(), t.key] as [string, string])]) {
    const d = label.includes(n) || n.includes(label) ? 1 : editDistance(n, label)
    if (!best || d < best.d) best = { key, d }
  }
  return best && best.d <= 2 ? { key: best.key, interpreted: true } : null
}

export function interpretRows(rows: string[][], ctx: ImportContext): ImportRow[] {
  if (!rows.length) return []
  const header = rows[0].map((h) => norm(h))
  const idx = (c: ImportColumn) => header.indexOf(c)
  const hasHeader = idx("name_ar") >= 0
  const body = hasHeader ? rows.slice(1) : rows
  const col = (r: string[], c: ImportColumn) => {
    const i = hasHeader ? idx(c) : IMPORT_COLUMNS.indexOf(c)
    return i >= 0 ? (r[i] ?? "").trim() : ""
  }
  const month = ctx.today.slice(0, 7)
  const seenIds = new Set<string>()
  // The template's own row of column labels — the row right under the header,
  // and only that one — is skipped, not rejected. Any other row whose join date
  // is not a date is a row of the file: it is rejected by name, never dropped.
  const labelRow = (r: string[], i: number) => hasHeader && i === 0 && Boolean(col(r, "join_date")) && !parseDay(col(r, "join_date")) && !/\d/.test(col(r, "join_date"))

  return body
    // The line is the file's line, counted before anything is skipped.
    .map((r, i) => ({ r, line: i + (hasHeader ? 2 : 1), skip: labelRow(r, i) }))
    .filter((x) => !x.skip)
    .map(({ r, line }) => {
      const notes: ImportNote[] = []
      const errors: ImportNote[] = []
      const nameEn = col(r, "name_en")
      // A name in English alone is a name (the prototype imports it): it stands as the name on the record.
      const nameAr = col(r, "name_ar") || nameEn
      if (!nameAr) errors.push({ key: "no_name" })

      const natRaw = col(r, "nationality")
      const nat = findNationality(natRaw, ctx.nationalityLabels)
      if (!nat) errors.push({ key: "bad_nationality", params: { value: natRaw || "—" } })

      const g = norm(col(r, "gender"))
      const gender = ["m", "male", "ذكر"].includes(g) ? "m" : ["f", "female", "أنثى", "انثى"].includes(g) ? "f" : null
      if (!gender) errors.push({ key: "bad_gender", params: { value: g || "—" } })

      const tr = findTrade(col(r, "trade"), ctx.tradeLabels)
      if (!tr) errors.push({ key: "bad_trade", params: { value: col(r, "trade") || "—" } })
      else if (tr.interpreted) notes.push({ key: "trade_interpreted", params: { value: col(r, "trade"), trade: tr.key } })
      const trade = tr ? TRADES.find((t) => t.key === tr.key)! : null
      if (trade?.saudiOnly && nat && nat !== "sa") errors.push({ key: "saudi_only" })

      const join = parseDay(col(r, "join_date"))
      if (!join) errors.push({ key: "bad_join", params: { value: col(r, "join_date") || "—" } })
      // Moving in is for people already at work; someone still to join is a new employee.
      else if (join > ctx.today) errors.push({ key: "future_join", params: { value: join } })

      const idNo = col(r, "id_no") || null
      if (idNo && (seenIds.has(idNo) || ctx.existing.some((e) => e.idNo === idNo))) errors.push({ key: "duplicate_id" })
      if (idNo) seenIds.add(idNo)
      if (!idNo) notes.push({ key: "no_id" })
      if (nameEn && join && ctx.existing.some((e) => (e.names?.en ?? "").toLowerCase() === nameEn.toLowerCase() && e.join === join)) errors.push({ key: "duplicate" })

      const docs: CreateEmployeeInput["docs"] = {}
      for (const [c, k] of [["iqama_expiry", "iqama"], ["passport_expiry", "passport"], ["insurance_expiry", "insurance"]] as const) {
        const v = col(r, c)
        if (!v) continue
        const d = parseDay(v)
        if (d) docs[k] = d
        else notes.push({ key: "bad_date_ignored", params: { column: c, value: v } })
      }

      const wp = col(r, "workplace")
      let siteId: string | null = null
      if (wp) {
        const s = ctx.sites.find((x) => norm(x.name) === norm(wp))
        if (s) siteId = s.id
        else notes.push({ key: "site_unknown", params: { value: wp } })
      }
      // An expired iqama may not be on a site (DC-02): placed unassigned, said.
      if (siteId && nat !== "sa" && docState(docs.iqama, ctx.today) === "expired") {
        notes.push({ key: "iqama_expired_unassigned" })
        siteId = null
      }

      const basicRaw = col(r, "basic")
      const basic = basicRaw ? Number(basicRaw.replace(/,/g, "")) : null
      if (basicRaw && !(basic! > 0)) errors.push({ key: "bad_basic", params: { value: basicRaw } })
      if (!basicRaw) notes.push({ key: "no_basic" })

      const ibanRaw = col(r, "iban").replace(/\s+/g, "").toUpperCase()
      const iban = /^SA\d{22}$/.test(ibanRaw) ? ibanRaw : null
      if (ibanRaw && !iban) notes.push({ key: "bad_iban" })
      else if (!ibanRaw) notes.push({ key: "no_iban" })

      // IM-02 — the leave balance today, capped at what could accrue.
      let openingLeave = 0
      const lbRaw = col(r, "leave_balance")
      if (lbRaw && join) {
        let lb = Number(lbRaw)
        if (!Number.isFinite(lb) || lb < 0) notes.push({ key: "bad_leave_ignored", params: { value: lbRaw } })
        else {
          const cap = Math.floor((Math.max(0, daysBetween(join, ctx.today)) / 365) * 30) + 30
          if (lb > cap) {
            notes.push({ key: "leave_capped", params: { value: lb, cap } })
            lb = cap
          }
          openingLeave = openingFor(join, ctx.today, lb)
        }
      }
      const abRaw = col(r, "advance_balance")
      const advanceBalance = abRaw ? Number(abRaw.replace(/,/g, "")) : 0
      if (abRaw && !(advanceBalance >= 0)) errors.push({ key: "bad_advance", params: { value: abRaw } })
      if (advanceBalance > 0 && !(basic! > 0)) notes.push({ key: "advance_without_wage" })

      const rejected = errors.length > 0
      return {
        line,
        status: rejected ? "rejected" : notes.length ? "notes" : "clean",
        notes,
        errors,
        display: { name: nameAr || nameEn || "—", trade: trade?.key ?? null, site: siteId ? (ctx.sites.find((s) => s.id === siteId)?.name ?? null) : null },
        input: rejected
          ? null
          : {
              source: "local",
              nameAr,
              nameEn: nameEn || null,
              nationality: nat!,
              gender: gender!,
              idNo,
              trade: trade!.key,
              siteId: siteId ?? UNASSIGNED_SITE,
              join: join!,
              contractType: "open",
              contractEnd: null,
              basic: basic && basic > 0 ? basic : null,
              docs,
              iban,
              since: month,
              openingLeave,
              advanceBalance: advanceBalance > 0 && basic && basic > 0 ? advanceBalance : 0,
            },
      } satisfies ImportRow
    })
}
