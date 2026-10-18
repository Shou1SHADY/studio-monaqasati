// The review-day kit's supplier profiles (Delivery-Supplier-1.0 R1-start/supplier-profile-template.csv) read into free
// supplier accounts. Pure — parsing, mapping and the reasons a row is refused — so the script that writes them
// (scripts/import-r1-suppliers.ts) and its tests read every row the same way. Nothing is invented: a missing VAT number
// or e-mail stays empty, as the review-day guide asks; a row with a bad CR, mobile, IBAN, city or specialty is refused
// with why, never "fixed".

import { PREDEFINED_CATEGORIES, SAUDI_CITIES } from "@/lib/constants"
import { ibanValid, normalIban } from "./profile"
import { normalizeCr, saudiMobileE164 } from "./phone-auth"

/** The specialty codes of R1-start/specialties-template.csv, by the platform's own category names. */
export const DEFAULT_SPECIALTY_CODES: Readonly<Record<string, string>> = {
  blocks: "طوب وبلوك",
  cement: "أسمنت وخرسانة",
  steel: "حديد ومعادن",
  insulation: "عزل وأسقف",
}

export interface R1Supplier {
  nameAr: string
  nameEn: string
  crNumber: string
  vatNumber: string
  city: string
  nationalAddress: string
  /** E.164 (+9665…) — the account's sign-in. */
  phone: string
  email: string
  iban: string
  specializations: string[]
  coverageCities: string[]
}

export type R1Problem = "name" | "cr" | "vat" | "city" | "address" | "mobile" | "email" | "iban" | "specialty" | "coverage" | "duplicate"

export type R1Row = { line: number; ok: true; supplier: R1Supplier } | { line: number; ok: false; problems: R1Problem[]; detail: string[] }

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and line breaks; a leading BOM is dropped. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "")
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += c
  }
  if (field !== "" || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""))
}

/** code → category name from specialties-template.csv (`code,name_ar,…`); unknown names are dropped. */
export function specialtyCodes(csv: string | null): Record<string, string> {
  if (!csv) return { ...DEFAULT_SPECIALTY_CODES }
  const [head, ...rows] = parseCsv(csv)
  const ci = head.indexOf("code")
  const ni = head.indexOf("name_ar")
  const out: Record<string, string> = {}
  for (const r of rows) {
    const code = (r[ci] || "").trim()
    const name = (r[ni] || "").trim()
    if (code && PREDEFINED_CATEGORIES.includes(name)) out[code] = name
  }
  return out
}

const digits = (v: string) => v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\s-]/g, "")
const list = (v: string) => v.split("|").map((x) => x.trim()).filter(Boolean)

export function readR1Suppliers(csv: string, codes: Record<string, string> = DEFAULT_SPECIALTY_CODES): R1Row[] {
  const [head, ...rows] = parseCsv(csv)
  const col = (r: string[], name: string) => (r[head.indexOf(name)] ?? "").trim()
  const seen = new Map<string, number>()
  return rows.map((r, i): R1Row => {
    const line = i + 2
    const problems: R1Problem[] = []
    const detail: string[] = []
    const nameAr = col(r, "name_ar")
    if (!nameAr) problems.push("name")
    const cr = normalizeCr(col(r, "cr_number"))
    if (!cr) problems.push("cr")
    const vatRaw = digits(col(r, "vat_number"))
    if (vatRaw && !/^3\d{13}3$/.test(vatRaw)) problems.push("vat")
    const city = col(r, "city")
    if (!(SAUDI_CITIES as readonly string[]).includes(city)) {
      problems.push("city")
      detail.push(city)
    }
    const nationalAddress = col(r, "national_address")
    if (!nationalAddress) problems.push("address")
    const phone = saudiMobileE164(col(r, "mobile"))
    if (!phone) problems.push("mobile")
    const email = col(r, "email").toLowerCase()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push("email")
    const ibanRaw = col(r, "iban")
    if (ibanRaw && !ibanValid(ibanRaw)) problems.push("iban")
    const specCodes = list(col(r, "specialties"))
    const unknownSpecs = specCodes.filter((c) => !codes[c])
    if (!specCodes.length || unknownSpecs.length) {
      problems.push("specialty")
      detail.push(...unknownSpecs)
    }
    const coverageCities = list(col(r, "coverage_cities"))
    const unknownCities = coverageCities.filter((c) => !(SAUDI_CITIES as readonly string[]).includes(c))
    if (!coverageCities.length || unknownCities.length) {
      problems.push("coverage")
      detail.push(...unknownCities)
    }
    // One account per mobile and per CR: a second row with either is refused, naming the first.
    for (const key of [phone && `m:${phone}`, cr && `cr:${cr}`]) {
      if (!key) continue
      if (seen.has(key)) {
        problems.push("duplicate")
        detail.push(`line ${seen.get(key)}`)
      } else seen.set(key, line)
    }
    if (problems.length) return { line, ok: false, problems: [...new Set(problems)], detail }
    return {
      line,
      ok: true,
      supplier: {
        nameAr,
        nameEn: col(r, "name_en"),
        crNumber: cr as string,
        vatNumber: vatRaw,
        city,
        nationalAddress,
        phone: phone as string,
        email,
        iban: ibanRaw ? normalIban(ibanRaw) : "",
        specializations: [...new Set(specCodes.map((c) => codes[c]))],
        coverageCities: [...new Set(coverageCities)],
      },
    }
  })
}
