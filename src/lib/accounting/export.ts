// "Export to" (تصدير إلى) — every accounting screen with numbers leaves the
// system in three forms (finance review, 23 Sep 2026): Excel, PDF and XBRL.
//
// A screen describes what it shows ONCE, as an ExportDoc — sections of rows
// with typed columns — and this module turns that into each format. Figures
// are always exported in exact riyals, never in the on-screen thousands or
// millions: a file is re-used in other tools, and a scaled number there is a
// wrong number.
//
// XBRL comes in two shapes, chosen by the screen:
//   ifrs  the statements, as facts of the IFRS taxonomy (the Ministry of
//         Commerce's Qawaem filings are IFRS-based)
//   gl    journal-type reports (journal, ledger, account statement) as an
//         XBRL GL instance — the taxonomy made for transaction-level data
//   ext   the tax and zakat schedules, whose figures have no public taxonomy:
//         facts in the platform's own namespace, for data exchange
// The instance is well-formed and uses real taxonomy element names; it has not
// been validated against a regulator's filing rules, which may add their own.

import { escapeHtml, openPrintWindow } from "@/components/accounting/print"
import { round2 } from "./journal"

export type ExportCellKind = "text" | "money" | "number" | "date" | "percent"

export interface ExportColumn {
  header: string
  kind: ExportCellKind
}

export interface ExportRow {
  cells: Array<string | number | null>
  /** Indent of the first cell (0 = flush). */
  level?: number
  emphasis?: "header" | "subtotal" | "total"
}

export interface ExportSection {
  title?: string
  columns: ExportColumn[]
  rows: ExportRow[]
}

export interface XbrlFact {
  /** Prefixed concept name — `ifrs-full:Revenue`, `mdmak:ZakatBase`. */
  concept: string
  value: number
  /** duration: the report's period · instant: its end · opening: the day before it starts. */
  context: "duration" | "instant" | "opening"
}

export interface XbrlGlLine {
  account: string
  accountName: string
  amount: number
  side: "D" | "C"
  note?: string | null
}

export interface XbrlGlEntry {
  number: number
  date: string
  description: string
  enteredBy: string
  kind: string
  lines: XbrlGlLine[]
}

export type XbrlSpec =
  | { kind: "ifrs"; facts: XbrlFact[] }
  | { kind: "ext"; facts: XbrlFact[] }
  | { kind: "gl"; entriesType: "journal" | "ledger" | "account"; entries: XbrlGlEntry[] }

export interface ExportDoc {
  title: string
  subtitle?: string
  /** Without extension; sanitized on the way out. */
  fileName: string
  locale: string
  organizationId: string
  period: { from: string; to: string }
  sections: ExportSection[]
  /** Absent: the screen has no XBRL form (the menu says so). */
  xbrl?: XbrlSpec
}

export type ExportFormat = "xlsx" | "pdf" | "xbrl"

export function safeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|[\]]+/g, " ")
      .replace(/\s+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "export"
  )
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const INDENT = "    "

function cellText(value: string | number | null, kind: ExportCellKind): string {
  if (value === null || value === undefined || value === "") return ""
  if (typeof value === "number") {
    if (kind === "percent") return `${round2(value * 100)}%`
    if (kind === "money") return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return value.toLocaleString("en-US")
  }
  return value
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

/** The sheet's rows, and which section each row belongs to (−1: a heading). */
function buildAoa(doc: ExportDoc): { aoa: Array<Array<string | number | null>>; rowSection: number[] } {
  const aoa: Array<Array<string | number | null>> = [[doc.title]]
  const rowSection: number[] = [-1]
  const push = (row: Array<string | number | null>, section: number) => {
    aoa.push(row)
    rowSection.push(section)
  }
  if (doc.subtitle) push([doc.subtitle], -1)
  push([`${doc.period.from} → ${doc.period.to}`], -1)
  doc.sections.forEach((section, si) => {
    push([], -1)
    if (section.title) push([section.title], -1)
    push(section.columns.map((c) => c.header), -1)
    for (const row of section.rows) {
      push(
        row.cells.map((cell, i) => {
          const kind = section.columns[i]?.kind ?? "text"
          if (i === 0 && typeof cell === "string" && row.level) return INDENT.repeat(row.level) + cell
          if (typeof cell === "number" && kind === "money") return round2(cell)
          return cell ?? ""
        }),
        si
      )
    }
  })
  return { aoa, rowSection }
}

/** The sheet's rows, as the workbook writer takes them. Exported for tests. */
export function exportAoa(doc: ExportDoc): Array<Array<string | number | null>> {
  return buildAoa(doc).aoa
}

/** Excel number formats by column kind — applied per section, since one sheet
 * holds sections whose columns mean different things. */
const XLSX_FORMAT: Partial<Record<ExportCellKind, string>> = { money: "#,##0.00", percent: "0.00%" }

async function toXlsx(doc: ExportDoc): Promise<Blob> {
  const XLSX = await import("xlsx")
  const { aoa, rowSection } = buildAoa(doc)
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) continue
    const cell = ws[key] as { t?: string; z?: string }
    if (cell.t !== "n") continue
    const { r, c } = XLSX.utils.decode_cell(key)
    const section = doc.sections[rowSection[r]]
    const format = section ? XLSX_FORMAT[section.columns[c]?.kind ?? "text"] : undefined
    if (format) cell.z = format
  }
  const widest = Math.max(...doc.sections.map((s) => s.columns.length), 1)
  ws["!cols"] = Array.from({ length: widest }, (_, i) => ({ wch: i === 0 ? 48 : 18 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, safeFileName(doc.title).slice(0, 31) || "Sheet1")
  if (doc.locale === "ar") wb.Workbook = { Views: [{ RTL: true }] }
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
}

// ---------------------------------------------------------------------------
// PDF — the print window, saved as PDF from the browser's dialog
// ---------------------------------------------------------------------------

export function exportHtml(doc: ExportDoc): string {
  const sections = doc.sections
    .map((s) => {
      const head = s.columns.map((c) => `<th class="${c.kind === "text" || c.kind === "date" ? "" : "num"}">${escapeHtml(c.header)}</th>`).join("")
      const body = s.rows
        .map((r) => {
          const cls = r.emphasis === "total" || r.emphasis === "subtotal" ? "total" : r.emphasis === "header" ? "group" : ""
          const tds = r.cells
            .map((cell, i) => {
              const kind = s.columns[i]?.kind ?? "text"
              const pad = i === 0 && r.level ? ` style="padding-inline-start:${8 + r.level * 14}px"` : ""
              return `<td class="${kind === "text" || kind === "date" ? "" : "num"}"${pad}>${escapeHtml(cellText(cell, kind))}</td>`
            })
            .join("")
          return `<tr class="${cls}">${tds}</tr>`
        })
        .join("")
      return `${s.title ? `<h2 style="font-size:13px;margin:16px 0 6px">${escapeHtml(s.title)}</h2>` : ""}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
    })
    .join("")
  return `<div class="head"><div><h1>${escapeHtml(doc.title)}</h1>${doc.subtitle ? `<div class="muted">${escapeHtml(doc.subtitle)}</div>` : ""}</div>
<div class="muted" dir="ltr">${escapeHtml(doc.period.from)} → ${escapeHtml(doc.period.to)}</div></div>
<style>tr.group td{background:#f1f5f9;font-weight:700}</style>${sections}`
}

// ---------------------------------------------------------------------------
// XBRL
// ---------------------------------------------------------------------------

const IFRS_NS = "https://xbrl.ifrs.org/taxonomy/2024-03-27/ifrs-full"
const IFRS_SCHEMA = "https://xbrl.ifrs.org/taxonomy/2024-03-27/full_ifrs_entry_point_2024-03-27.xsd"
const GL_COR_NS = "http://www.xbrl.org/int/gl/cor/2015-03-25"
const GL_BUS_NS = "http://www.xbrl.org/int/gl/bus/2015-03-25"
const GL_SCHEMA = "http://www.xbrl.org/int/gl/plt/2015-03-25/gl-plt-oth-2015-03-25.xsd"
const EXT_NS = "https://mdmaktech.sa/xbrl/accounting/2026"
const EXT_SCHEMA = "https://mdmaktech.sa/xbrl/accounting/2026/mdmak-accounting.xsd"
const ENTITY_SCHEME = "https://mdmaktech.sa/organization"

const xml = (v: unknown) => escapeHtml(v)

function dayBefore(iso: string): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function entity(orgId: string): string {
  return `<xbrli:entity><xbrli:identifier scheme="${ENTITY_SCHEME}">${xml(orgId)}</xbrli:identifier></xbrli:entity>`
}

const UNIT = `<xbrli:unit id="SAR"><xbrli:measure>iso4217:SAR</xbrli:measure></xbrli:unit>`

export function exportXbrl(doc: ExportDoc): string | null {
  const spec = doc.xbrl
  if (!spec) return null
  const head = `<?xml version="1.0" encoding="UTF-8"?>`
  if (spec.kind === "gl") {
    const ctx = `<xbrli:context id="now">${entity(doc.organizationId)}<xbrli:period><xbrli:instant>${xml(doc.period.to)}</xbrli:instant></xbrli:period></xbrli:context>`
    const c = `contextRef="now"`
    const entries = spec.entries
      .map((e) => {
        const lines = e.lines
          .map(
            (l, i) => `
      <gl-cor:entryDetail>
        <gl-cor:lineNumber ${c}>${i + 1}</gl-cor:lineNumber>
        <gl-cor:account>
          <gl-cor:accountMainID ${c}>${xml(l.account)}</gl-cor:accountMainID>
          <gl-cor:accountMainDescription ${c}>${xml(l.accountName)}</gl-cor:accountMainDescription>
        </gl-cor:account>
        <gl-cor:amount ${c} unitRef="SAR" decimals="2">${round2(l.amount).toFixed(2)}</gl-cor:amount>
        <gl-cor:debitCreditCode ${c}>${l.side}</gl-cor:debitCreditCode>
        <gl-cor:postingDate ${c}>${xml(e.date)}</gl-cor:postingDate>${l.note ? `
        <gl-cor:detailComment ${c}>${xml(l.note)}</gl-cor:detailComment>` : ""}
      </gl-cor:entryDetail>`
          )
          .join("")
        return `
    <gl-cor:entryHeader>
      <gl-cor:postedDate ${c}>${xml(e.date)}</gl-cor:postedDate>
      <gl-cor:enteredBy ${c}>${xml(e.enteredBy)}</gl-cor:enteredBy>
      <gl-cor:sourceJournalID ${c}>gj</gl-cor:sourceJournalID>
      <gl-cor:entryType ${c}>${e.kind === "manual" ? "adjusting" : "standard"}</gl-cor:entryType>
      <gl-cor:entryNumber ${c}>${e.number}</gl-cor:entryNumber>
      <gl-cor:entryComment ${c}>${xml(e.description)}</gl-cor:entryComment>${lines}
    </gl-cor:entryHeader>`
      })
      .join("")
    return `${head}
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:gl-cor="${GL_COR_NS}" xmlns:gl-bus="${GL_BUS_NS}">
  <link:schemaRef xlink:type="simple" xlink:href="${GL_SCHEMA}"/>
  ${ctx}
  ${UNIT}
  <gl-cor:accountingEntries>
    <gl-cor:documentInfo>
      <gl-cor:entriesType ${c}>${spec.entriesType}</gl-cor:entriesType>
      <gl-cor:uniqueID ${c}>${xml(safeFileName(doc.fileName))}</gl-cor:uniqueID>
      <gl-cor:language ${c}>iso639:${doc.locale === "ar" ? "ar" : "en"}</gl-cor:language>
      <gl-cor:creationDate ${c}>${new Date().toISOString().slice(0, 10)}</gl-cor:creationDate>
      <gl-cor:periodCoveredStart ${c}>${xml(doc.period.from)}</gl-cor:periodCoveredStart>
      <gl-cor:periodCoveredEnd ${c}>${xml(doc.period.to)}</gl-cor:periodCoveredEnd>
    </gl-cor:documentInfo>
    <gl-cor:entityInformation>
      <gl-bus:organizationIdentifiers>
        <gl-bus:organizationIdentifier ${c}>${xml(doc.organizationId)}</gl-bus:organizationIdentifier>
      </gl-bus:organizationIdentifiers>
    </gl-cor:entityInformation>${entries}
  </gl-cor:accountingEntries>
</xbrli:xbrl>
`
  }

  const ifrs = spec.kind === "ifrs"
  const contexts = `
  <xbrli:context id="D">${entity(doc.organizationId)}<xbrli:period><xbrli:startDate>${xml(doc.period.from)}</xbrli:startDate><xbrli:endDate>${xml(doc.period.to)}</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="I">${entity(doc.organizationId)}<xbrli:period><xbrli:instant>${xml(doc.period.to)}</xbrli:instant></xbrli:period></xbrli:context>
  <xbrli:context id="I0">${entity(doc.organizationId)}<xbrli:period><xbrli:instant>${dayBefore(doc.period.from)}</xbrli:instant></xbrli:period></xbrli:context>`
  const ctxId = { duration: "D", instant: "I", opening: "I0" } as const
  // One fact per concept and context — XBRL forbids inconsistent duplicates.
  const seen = new Set<string>()
  const facts = spec.facts
    .filter((f) => Number.isFinite(f.value))
    .filter((f) => {
      const k = `${f.concept}|${f.context}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .map((f) => `  <${f.concept} contextRef="${ctxId[f.context]}" unitRef="SAR" decimals="2">${round2(f.value).toFixed(2)}</${f.concept}>`)
    .join("\n")
  return `${head}
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" ${ifrs ? `xmlns:ifrs-full="${IFRS_NS}"` : `xmlns:mdmak="${EXT_NS}"`}>
  <link:schemaRef xlink:type="simple" xlink:href="${ifrs ? IFRS_SCHEMA : EXT_SCHEMA}"/>${contexts}
  ${UNIT}
${facts}
</xbrli:xbrl>
`
}

/** Produce the file and hand it to the browser. False when the browser refused
 * (a blocked print window) or the screen has no such form. */
export async function exportDocument(doc: ExportDoc, format: ExportFormat): Promise<boolean> {
  const base = safeFileName(doc.fileName)
  if (format === "xlsx") {
    download(await toXlsx(doc), `${base}.xlsx`)
    return true
  }
  if (format === "pdf") {
    return openPrintWindow({ title: doc.title, dir: doc.locale === "ar" ? "rtl" : "ltr", bodyHtml: exportHtml(doc) })
  }
  const text = exportXbrl(doc)
  if (!text) return false
  download(new Blob([text], { type: "application/xml" }), `${base}.xbrl`)
  return true
}
